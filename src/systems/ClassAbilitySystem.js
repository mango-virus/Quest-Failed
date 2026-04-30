// Phase 5c — class ability runtime.
//
// Per-tick brain for class-specific abilities. Decides when each adventurer
// should fire their abilities, applies effects, schedules expirations, and
// kicks off VFX. CombatSystem and MinionAISystem read `_auraActiveUntil` /
// `_tauntActiveUntil` to apply damage-reduction / aggro-override effects.
//
// Per-class consideration logic is added one class at a time. This file
// currently ships with Knight; Bard / Monk / Cleric / Mage / etc. will hang
// off the dispatch switch as their passes land.
//
// Buff fields written on the adventurer entity (transient, prefixed `_`):
//   _auraActiveUntil   (Knight Protective Aura)
//   _auraRingSprite    (ID/ref of the sustained-pulse VFX object)
//   _tauntActiveUntil  (Knight Taunt — read by MinionAISystem priority)
//
// Cooldowns + per-day budgets live on adv.cooldowns / adv.usesLeftToday
// per the AbilitySystem contract.

import { EventBus }       from './EventBus.js'
import { AbilitySystem }  from './AbilitySystem.js'
import { AbilityVfx }     from '../ui/AbilityVfx.js'
import { Balance }        from '../config/balance.js'

// Ability defs. Cooldown buckets are: small 5–8s, medium 12–18s, large 30–60s.
export const ABILITY_DEFS = {
  // Knight
  knight_aura:  { id: 'protective_aura', cooldownMs: 30000, durationMs: 6000, label: 'Protective Aura', auraRangeTiles: 1, dmgReduction: 0.25 },
  knight_taunt: { id: 'taunt',           cooldownMs: 12000, durationMs: 4000, label: 'Taunt' },
}

export class ClassAbilitySystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState

    // Sustained VFX refs keyed by adv.instanceId. Cleared on buff expiry.
    this._sustainedFx = new Map()

    // At day start, refresh per-day budgets for every active adventurer.
    EventBus.on('NEW_DAY_STARTED', this._onNewDay, this)
    // When an adventurer dies or flees, immediately end their buffs and
    // tear down any sustained VFX so we don't leave rings on the ground.
    EventBus.on('ADVENTURER_DIED', this._onAdventurerRemoved, this)
    EventBus.on('ADVENTURER_FLED', this._onAdventurerRemoved, this)
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAllSustained, this)
  }

  destroy() {
    EventBus.off('NEW_DAY_STARTED', this._onNewDay, this)
    EventBus.off('ADVENTURER_DIED', this._onAdventurerRemoved, this)
    EventBus.off('ADVENTURER_FLED', this._onAdventurerRemoved, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._clearAllSustained, this)
    this._clearAllSustained()
  }

  _onAdventurerRemoved({ adventurer }) {
    if (!adventurer) return
    // Cancel any active buffs.
    adventurer._auraActiveUntil  = null
    adventurer._tauntActiveUntil = null
    // Clean up any sustained VFX (e.g. the Knight's aura ring).
    const map = this._sustainedFx.get(adventurer.instanceId)
    if (map) {
      for (const slot of Object.keys(map)) this._endSustainedFx(adventurer.instanceId, slot)
      this._sustainedFx.delete(adventurer.instanceId)
    }
  }

  update(_delta) {
    const now = this._scene.time.now
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      this._tickActiveBuffs(adv, now)
      switch (adv.classId) {
        case 'knight': this._considerKnight(adv, now); break
        // (other classes ship one at a time)
      }
    }
  }

  // ── Buff lifecycle ─────────────────────────────────────────────────────────

  _tickActiveBuffs(adv, now) {
    if (adv._auraActiveUntil && now >= adv._auraActiveUntil) {
      adv._auraActiveUntil = null
      this._endSustainedFx(adv.instanceId, 'aura')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'protective_aura' })
    }
    if (adv._tauntActiveUntil && now >= adv._tauntActiveUntil) {
      adv._tauntActiveUntil = null
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'taunt' })
    }
  }

  _endSustainedFx(instanceId, slot) {
    const map = this._sustainedFx.get(instanceId)
    if (!map) return
    const obj = map[slot]
    if (!obj) return
    if (obj.tween && obj.tween.isPlaying()) obj.tween.stop()
    if (typeof obj.cleanup === 'function') obj.cleanup()
    if (obj.gfx && obj.gfx.active && obj.gfx.destroy) obj.gfx.destroy()
    delete map[slot]
  }

  _setSustainedFx(instanceId, slot, value) {
    if (!this._sustainedFx.has(instanceId)) this._sustainedFx.set(instanceId, {})
    this._sustainedFx.get(instanceId)[slot] = value
  }

  _clearAllSustained() {
    for (const id of [...this._sustainedFx.keys()]) {
      const map = this._sustainedFx.get(id)
      for (const slot of Object.keys(map)) this._endSustainedFx(id, slot)
    }
    this._sustainedFx.clear()
  }

  // ── Knight ────────────────────────────────────────────────────────────────

  _considerKnight(adv, now) {
    // Protective Aura — fire when self or any party ally within 1 tile
    // is below 70% HP. Aura buff lasts 6s and reduces damage by 25% on
    // the Knight + nearby same-party allies (CombatSystem reads it).
    const auraDef = ABILITY_DEFS.knight_aura
    if (this._allyInDangerNearby(adv, auraDef.auraRangeTiles)) {
      const ready = AbilitySystem.canUse(adv, auraDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, auraDef, now)
        adv._auraActiveUntil = now + auraDef.durationMs
        this._fireAuraVfx(adv, auraDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'protective_aura',
          message: `${adv.name} raised a Protective Aura.`,
        })
      }
    }

    // Taunt — fire when there's a hostile minion close enough to threaten
    // the party. MinionAISystem priority bumps the Knight to top target
    // for the duration so allies get breathing room.
    const tauntDef = ABILITY_DEFS.knight_taunt
    if (this._hostileMinionWithin(adv, 4)) {
      const ready = AbilitySystem.canUse(adv, tauntDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, tauntDef, now)
        adv._tauntActiveUntil = now + tauntDef.durationMs
        this._fireTauntVfx(adv)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'taunt',
          message: `${adv.name} taunted enemies!`,
        })
      }
    }
  }

  _allyInDangerNearby(knight, rangeTiles) {
    // Knight himself counts as an "ally" — protects himself when wounded.
    const selfFrac = knight.resources.maxHp > 0
      ? knight.resources.hp / knight.resources.maxHp : 1
    if (selfFrac < 0.7) return true
    if (!knight.partyId) return false
    for (const adv of this._gameState.adventurers.active) {
      if (adv === knight || adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv.partyId !== knight.partyId) continue
      const d = Math.hypot(adv.tileX - knight.tileX, adv.tileY - knight.tileY)
      if (d > rangeTiles + 0.01) continue
      const frac = adv.resources.maxHp > 0
        ? adv.resources.hp / adv.resources.maxHp : 1
      if (frac < 0.7) return true
    }
    return false
  }

  _hostileMinionWithin(adv, rangeTiles) {
    const minions = this._gameState.minions ?? []
    for (const m of minions) {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      if (m.faction === 'adventurer') continue // tamed/raised allies don't count
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d <= rangeTiles + 0.01) return true
    }
    return false
  }

  // ── VFX ───────────────────────────────────────────────────────────────────

  _fireAuraVfx(adv, durationMs) {
    const x = adv.worldX, y = adv.worldY
    // Single quick ring on activation — no particles, no floating text.
    AbilityVfx.pulseRing(this._scene, x, y, { color: 0xffe066, fromR: 8, toR: 26, durationMs: 350, alpha: 0.7 })

    // Sustained ring under the Knight while aura is active. Thin, soft,
    // doesn't pulse — just a quiet halo that says "this Knight is protecting
    // nearby allies." Auto-cleans on duration end OR ADVENTURER_DIED/FLED.
    const ring = this._scene.add.circle(x, y, 18, 0xffe066, 0.0)
    ring.setStrokeStyle(1, 0xffe066, 0.35).setDepth(7)
    const followUpdate = () => {
      if (!ring.active) return
      ring.setPosition(adv.worldX ?? 0, adv.worldY ?? 0)
    }
    this._scene.events.on('update', followUpdate)
    // Auto-fade just before duration ends so it doesn't pop off harshly.
    this._scene.tweens.add({
      targets: ring,
      alpha: 0,
      duration: 400,
      delay: Math.max(0, durationMs - 400),
      onComplete: () => {
        this._scene.events.off('update', followUpdate)
        if (ring.active) ring.destroy()
      },
    })
    this._setSustainedFx(adv.instanceId, 'aura', {
      gfx: ring,
      cleanup: () => this._scene.events.off('update', followUpdate),
    })
  }

  _fireTauntVfx(adv) {
    const x = adv.worldX, y = adv.worldY
    AbilityVfx.pulseRing(this._scene, x, y, { color: 0xff4444, fromR: 10, toR: 70, durationMs: 600, alpha: 0.95 })
    AbilityVfx.pulseRing(this._scene, x, y, { color: 0xffaa66, fromR: 8, toR: 50, durationMs: 800, alpha: 0.7 })
    AbilityVfx.floatingText(this._scene, x, y - 28, 'TAUNT!', { color: '#ff8866', fontSize: '14px' })
  }

  // ── Day-start hook ────────────────────────────────────────────────────────

  _onNewDay() {
    const defs = Object.values(ABILITY_DEFS)
    for (const adv of this._gameState.adventurers.active ?? []) {
      AbilitySystem.resetForNewDay(adv, defs)
    }
  }
}
