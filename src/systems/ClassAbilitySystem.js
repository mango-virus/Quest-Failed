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
  }

  destroy() {
    EventBus.off('NEW_DAY_STARTED', this._onNewDay, this)
    this._clearAllSustained()
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
    if (obj.gfx && obj.gfx.destroy) obj.gfx.destroy()
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
    AbilityVfx.pulseRing(this._scene, x, y, { color: 0xffe066, fromR: 8, toR: 48, durationMs: 500, alpha: 0.95 })
    AbilityVfx.particleBurst(this._scene, x, y, { color: 0xffe066, count: 14, durationMs: 700, speed: 80 })
    AbilityVfx.floatingText(this._scene, x, y - 28, 'AURA', { color: '#ffe066' })

    // Sustained ring under the Knight while aura is active. Pulses gently
    // so the player can read "this Knight is protecting nearby allies."
    const ring = this._scene.add.circle(x, y, 22, 0xffe066, 0.0)
    ring.setStrokeStyle(2, 0xffe066, 0.65).setDepth(7)
    const tween = this._scene.tweens.add({
      targets: ring,
      radius: 28,
      alpha: 0.4,
      duration: 700,
      yoyo: true,
      repeat: Math.floor(durationMs / 1400),
      ease: 'Sine.easeInOut',
    })
    // Track the world position each frame so it follows the Knight.
    const followUpdate = () => {
      if (!ring.active) return
      ring.setPosition(adv.worldX, adv.worldY)
    }
    this._scene.events.on('update', followUpdate)
    this._setSustainedFx(adv.instanceId, 'aura', {
      gfx: ring,
      tween,
      cleanup: () => this._scene.events.off('update', followUpdate),
    })
    // Hook destruction cleanup so the update listener is removed.
    const origDestroy = ring.destroy.bind(ring)
    ring.destroy = (...args) => {
      this._scene.events.off('update', followUpdate)
      return origDestroy(...args)
    }
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
