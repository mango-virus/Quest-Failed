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
//   _auraActiveUntil      (Knight Protective Aura)
//   _tauntActiveUntil     (Knight Taunt — read by MinionAISystem priority)
//   _inspireActiveUntil   (Bard Inspire Party — read by CombatSystem)
//   _songSpeedActiveUntil (Bard Song of Speed — read by AISystem movement)
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
  // Bard
  bard_inspire: { id: 'inspire_party',   cooldownMs: 14000, durationMs: 6000, label: 'Inspire Party', auraRangeTiles: 2, atkMul: 1.15 },
  bard_speed:   { id: 'song_of_speed',   cooldownMs: 16000, durationMs: 6000, label: 'Song of Speed', auraRangeTiles: 2, spdMul: 1.20 },
  // Bard's Encore is a passive — fires on death, no cooldown.
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
    // Death and flee are split so we can fire Bard's Encore on death only.
    this._onDied  = (payload) => this._onAdventurerRemoved({ ...payload, _isDeath: true })
    this._onFled  = (payload) => this._onAdventurerRemoved({ ...payload, _isDeath: false })
    EventBus.on('ADVENTURER_DIED', this._onDied, this)
    EventBus.on('ADVENTURER_FLED', this._onFled, this)
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAllSustained, this)
  }

  destroy() {
    EventBus.off('NEW_DAY_STARTED', this._onNewDay, this)
    EventBus.off('ADVENTURER_DIED', this._onDied, this)
    EventBus.off('ADVENTURER_FLED', this._onFled, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._clearAllSustained, this)
    this._clearAllSustained()
  }

  _onAdventurerRemoved(payload) {
    const adventurer = payload?.adventurer
    if (!adventurer) return

    // Bard passive — Encore: fires before any cleanup so the heal lands while
    // party members are still listed as active. Only fires on actual death,
    // not on flee. Heals every same-party adventurer (including ranged ones,
    // not just nearby) for 25% of their maxHp.
    if (
      adventurer.classId === 'bard' &&
      payload._isDeath === true &&
      adventurer.partyId
    ) {
      this._fireEncore(adventurer)
    }

    // Cancel any active buffs.
    adventurer._auraActiveUntil       = null
    adventurer._tauntActiveUntil      = null
    adventurer._inspireActiveUntil    = null
    adventurer._songSpeedActiveUntil  = null
    // Clean up any sustained VFX (e.g. the Knight's aura ring or Bard rings).
    const map = this._sustainedFx.get(adventurer.instanceId)
    if (map) {
      for (const slot of Object.keys(map)) this._endSustainedFx(adventurer.instanceId, slot)
      this._sustainedFx.delete(adventurer.instanceId)
    }
  }

  _fireEncore(bard) {
    let healedCount = 0
    for (const adv of this._gameState.adventurers.active ?? []) {
      if (adv === bard) continue
      if (adv.partyId !== bard.partyId) continue
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      const before = adv.resources.hp
      const heal = Math.floor((adv.resources.maxHp ?? 0) * 0.25)
      adv.resources.hp = Math.min(adv.resources.maxHp ?? heal, adv.resources.hp + heal)
      const restored = adv.resources.hp - before
      if (restored > 0) {
        healedCount++
        AbilityVfx.pulseRing(this._scene, adv.worldX, adv.worldY, { color: 0xff66bb, fromR: 8, toR: 22, durationMs: 450, alpha: 0.75 })
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 24, `+${restored}`, { color: '#ff99cc', fontSize: '12px' })
        EventBus.emit('ALLY_HEALED', { sourceId: bard.instanceId, targetId: adv.instanceId, amount: restored })
      }
    }
    if (healedCount > 0) {
      AbilityVfx.pulseRing(this._scene, bard.worldX, bard.worldY, { color: 0xff66bb, fromR: 8, toR: 64, durationMs: 700, alpha: 0.85 })
      AbilityVfx.floatingText(this._scene, bard.worldX, bard.worldY - 28, 'ENCORE', { color: '#ff99cc', fontSize: '14px' })
    }
    EventBus.emit('ABILITY_TRIGGERED', {
      adventurer: bard,
      abilityId: 'encore',
      message: `${bard.name}'s final note healed ${healedCount} ally${healedCount === 1 ? '' : 'ies'}.`,
    })
  }

  update(_delta) {
    const now = this._scene.time.now
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      this._tickActiveBuffs(adv, now)
      switch (adv.classId) {
        case 'knight': this._considerKnight(adv, now); break
        case 'bard':   this._considerBard(adv, now);   break
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
    if (adv._inspireActiveUntil && now >= adv._inspireActiveUntil) {
      adv._inspireActiveUntil = null
      this._endSustainedFx(adv.instanceId, 'inspire')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'inspire_party' })
    }
    if (adv._songSpeedActiveUntil && now >= adv._songSpeedActiveUntil) {
      adv._songSpeedActiveUntil = null
      this._endSustainedFx(adv.instanceId, 'song_speed')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'song_of_speed' })
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

  // ── Bard ──────────────────────────────────────────────────────────────────

  _considerBard(adv, now) {
    // Inspire Party — fire when a same-party ally within 2 tiles is fighting.
    // Boosts attack damage during combat.
    const inspireDef = ABILITY_DEFS.bard_inspire
    if (this._partyAllyEngagedWithin(adv, inspireDef.auraRangeTiles)) {
      const ready = AbilitySystem.canUse(adv, inspireDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, inspireDef, now)
        adv._inspireActiveUntil = now + inspireDef.durationMs
        this._fireInspireVfx(adv, inspireDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'inspire_party',
          message: `${adv.name} struck up an inspiring tune.`,
        })
      }
    }

    // Song of Speed — fire when a same-party ally within 2 tiles is fleeing
    // (or the bard is). Helps escape and chase.
    const speedDef = ABILITY_DEFS.bard_speed
    if (this._partyAllyFleeingWithin(adv, speedDef.auraRangeTiles)) {
      const ready = AbilitySystem.canUse(adv, speedDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, speedDef, now)
        adv._songSpeedActiveUntil = now + speedDef.durationMs
        this._fireSpeedSongVfx(adv, speedDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'song_of_speed',
          message: `${adv.name} began a Song of Speed.`,
        })
      }
    }
  }

  _partyAllyEngagedWithin(bard, rangeTiles) {
    if (bard.aiState === 'fighting') return true
    if (!bard.partyId) return false
    for (const adv of this._gameState.adventurers.active) {
      if (adv === bard || adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv.partyId !== bard.partyId) continue
      if (adv.aiState !== 'fighting') continue
      const d = Math.hypot(adv.tileX - bard.tileX, adv.tileY - bard.tileY)
      if (d <= rangeTiles + 0.01) return true
    }
    return false
  }

  _partyAllyFleeingWithin(bard, rangeTiles) {
    if (bard.aiState === 'fleeing') return true
    if (!bard.partyId) return false
    for (const adv of this._gameState.adventurers.active) {
      if (adv === bard || adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv.partyId !== bard.partyId) continue
      if (adv.aiState !== 'fleeing' && adv.goal?.type !== 'FLEE') continue
      const d = Math.hypot(adv.tileX - bard.tileX, adv.tileY - bard.tileY)
      if (d <= rangeTiles + 0.01) return true
    }
    return false
  }

  _fireInspireVfx(adv, durationMs) {
    const x = adv.worldX, y = adv.worldY
    AbilityVfx.pulseRing(this._scene, x, y, { color: 0xff5577, fromR: 8, toR: 30, durationMs: 350, alpha: 0.7 })
    // Sustained quiet ring (red-pink) while inspire is active.
    const ring = this._scene.add.circle(x, y, 26, 0xff5577, 0.0)
    ring.setStrokeStyle(1, 0xff5577, 0.32).setDepth(7)
    const followUpdate = () => { if (ring.active) ring.setPosition(adv.worldX ?? 0, adv.worldY ?? 0) }
    this._scene.events.on('update', followUpdate)
    this._scene.tweens.add({
      targets: ring, alpha: 0, duration: 400,
      delay: Math.max(0, durationMs - 400),
      onComplete: () => { this._scene.events.off('update', followUpdate); if (ring.active) ring.destroy() },
    })
    this._setSustainedFx(adv.instanceId, 'inspire', {
      gfx: ring, cleanup: () => this._scene.events.off('update', followUpdate),
    })
  }

  _fireSpeedSongVfx(adv, durationMs) {
    const x = adv.worldX, y = adv.worldY
    AbilityVfx.pulseRing(this._scene, x, y, { color: 0x66ccff, fromR: 8, toR: 30, durationMs: 350, alpha: 0.7 })
    const ring = this._scene.add.circle(x, y, 30, 0x66ccff, 0.0)
    ring.setStrokeStyle(1, 0x66ccff, 0.32).setDepth(7)
    const followUpdate = () => { if (ring.active) ring.setPosition(adv.worldX ?? 0, adv.worldY ?? 0) }
    this._scene.events.on('update', followUpdate)
    this._scene.tweens.add({
      targets: ring, alpha: 0, duration: 400,
      delay: Math.max(0, durationMs - 400),
      onComplete: () => { this._scene.events.off('update', followUpdate); if (ring.active) ring.destroy() },
    })
    this._setSustainedFx(adv.instanceId, 'song_speed', {
      gfx: ring, cleanup: () => this._scene.events.off('update', followUpdate),
    })
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
