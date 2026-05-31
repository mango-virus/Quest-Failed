// Trap behaviour kernel — 2026-05-20 redesign.
//
// Per-tick during the day phase. Evaluates every placed trap by its
// triggerCondition and applies damage through COMBAT_HIT / COMBAT_KILL so
// HitSparks, the combat log, kill attribution, and stats all see it.
//
// Trigger families:
//   los_lane / los_facing  → wall traps + cannon: fire down a straight lane
//   proximity              → bomb: 3s fuse, then a radius-5 explosion
//   radius / adjacent_contact → spike pillar / rotating blades: ring damage
//   stepped_on             → spike pit: springs underfoot, instakill chance
//   saw_overlap            → saw blade: travels a track, carves what it rolls over
//
// Knowledge: emitting TRAP_TRIGGERED lets KnowledgeSystem record the trap for
// adventurers in the room — that's the only way they learn a trap's location.
// Visuals: per-trap state flags (state.firedAt / fuseLit / revealed / sawPos)
// + TRAP_FIRED / TRAP_FUSE_LIT / TRAP_EXPLODED events drive TrapRenderer.

import { EventBus }   from './EventBus.js'
import { Balance }    from '../config/balance.js'
import { TILE }       from './DungeonGrid.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'
import { sawPosAt }   from '../entities/Trap.js'

const TS = Balance.TILE_SIZE

const DIR = {
  N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },  W: { dx: -1, dy: 0 },
}

const LOS_MAX_TILES   = 48      // safety cap on a line-of-sight scan
const POISON_TICK_MS  = 1000
const ANNOUNCE_GAP_MS = 2000    // throttle TRAP_TRIGGERED so continuous traps don't spam

// Wear-and-tear: each time a trap FIRES and damages an adventurer it has this
// chance to break apart. Rolled once per firing (deduped on state.firedAt) so
// multi-hit traps (saw blade) break at the same rate as single-shot ones.
const TRAP_BREAK_CHANCE = 0.05

export class TrapSystem {
  constructor(scene, gameState, dungeonGrid) {
    this._scene       = scene
    this._gameState   = gameState
    this._dungeonGrid = dungeonGrid
    this._defs        = {}
    this._loaded      = false
    // Per-trap last-rolled firing timestamp, so the 5% break roll fires once
    // per firing even when a single discharge emits TRAP_TRIGGERED per victim.
    this._breakRolledAt = {}
    this._onTrapTriggeredBreak = this._maybeBreakTrap.bind(this)
    EventBus.on('TRAP_TRIGGERED', this._onTrapTriggeredBreak)
  }

  destroy() {
    EventBus.off('TRAP_TRIGGERED', this._onTrapTriggeredBreak)
  }

  loadDefinitions() {
    if (this._loaded) return
    const defs = this._scene.cache.json.get('trapTypes') ?? []
    this._defs = Object.fromEntries(defs.map(d => [d.id, d]))
    this._loaded = true
  }

  getDefinition(id) { return this._defs[id] ?? null }

  // Re-arm every trap overnight (NIGHT_PHASE_STARTED).
  resetAll() {
    for (const trap of this._gameState.dungeon.traps ?? []) {
      trap.isTriggered     = false
      trap.cooldownUntil   = 0
      trap.state           = {}
      trap._disabledThisDay = false   // Ranger Trap Expert clears overnight
    }
  }

  // ── 1% wear-and-tear break ────────────────────────────────────────────────
  // Fired off TRAP_TRIGGERED. Rolls ONCE per firing (deduped on the firing
  // timestamp) when the trap actually damaged an adventurer. On a break the
  // trap shatters (sell FX), is pulled from the live array, and is recorded on
  // dungeon._brokenTraps so the night-phase REBUILD button can restore it.
  _maybeBreakTrap({ trap, def, adventurer, damaged } = {}) {
    if (!damaged || !trap || !def || !adventurer) return
    if (trap._broken) return
    const fired = trap.state?.firedAt ?? 0
    if ((this._breakRolledAt[trap.instanceId] ?? -1) === fired) return
    this._breakRolledAt[trap.instanceId] = fired
    if (Math.random() >= TRAP_BREAK_CHANCE) return
    this._breakTrap(trap, def)
  }

  _breakTrap(trap, def) {
    const dungeon = this._gameState.dungeon
    const traps = dungeon?.traps
    if (!traps) return
    // Only break traps still LIVE on the board. Consumables (bombs) splice
    // themselves out before emitting TRAP_TRIGGERED, so breaking one here would
    // resurrect a spent one-shot into _brokenTraps and let the player rebuild
    // it at half price — guard against that.
    const i = traps.indexOf(trap)
    if (i < 0) return
    // Shatter VFX FIRST (the sell break-into-pieces), while the live sprite
    // still exists for SellFxRenderer to clone. ENTITY_SOLD with no refund =
    // shatter only (no gold floater / coin sound).
    const fp = trap.footprint ?? { w: 1, h: 1 }
    EventBus.emit('ENTITY_SOLD', {
      kind: 'trap', instanceId: trap.instanceId,
      worldX: (trap.tileX + fp.w / 2) * TS, worldY: (trap.tileY + fp.h / 2) * TS,
      width: fp.w, height: fp.h,
    })
    // Pull it from the live array (splice-safe: the tick loops over a copy).
    traps.splice(i, 1)
    // Record a placement snapshot for the REBUILD button. Preserve the
    // instanceId so adventurer intel keyed on it isn't orphaned on rebuild.
    dungeon._brokenTraps ??= []
    dungeon._brokenTraps.push({
      definitionId: trap.definitionId,
      tileX: trap.tileX, tileY: trap.tileY,
      facing: trap.facing, placement: trap.placement,
      footprint: trap.footprint, rotation: trap.rotation ?? 0,
      instanceId: trap.instanceId,
    })
    EventBus.emit('TRAP_BROKEN', { def, tileX: trap.tileX, tileY: trap.tileY })
    // Placement "thunk" on break (per design — the build noise, not the sell one).
    const keys = ['sfx-build-1', 'sfx-build-2', 'sfx-build-3']
    const key  = keys[Math.floor(Math.random() * keys.length)]
    if (this._scene?.cache?.audio?.exists?.(key)) {
      try { this._scene.sound.play(key, { volume: 0.7 }) } catch {}
    }
  }

  // ── Per-tick ────────────────────────────────────────────────────────────────

  update(delta) {
    if (!this._loaded) this.loadDefinitions()
    const traps = this._gameState.dungeon.traps
    if (!traps?.length) { this._tickPoison(); this._clearTickCache(); return }

    // Build per-tick target caches ONCE so _targets(def) doesn't re-filter
    // the same arrays for every trap, and _isAdventurer can drop its
    // O(advs) .includes() to an O(1) Set.has(). Big win when many traps
    // share the same factionsHit value during day-phase waves.
    this._buildTickCache()

    this._tickPoison()

    // Saw movement + bomb fuses tick regardless of trigger evaluation.
    // Copy the list — _detonateBomb splices traps[] mid-loop.
    const now = this._scene.time.now
    for (const trap of [...traps]) {
      const def = this._defs[trap.definitionId]
      if (!def) continue
      if (trap._disabledThisDay || trap._broken) continue   // disarmed (Ranger/mechanic) or shattered (Brittle Engines)
      if (def.id === 'saw_blade') this._tickSaw(trap, def)
      if (def.triggerCondition === 'proximity' && trap.state.fuseLit &&
          !trap.state.exploded && now >= (trap.state.fuseEndsAt ?? Infinity)) {
        this._detonateBomb(trap, def)
      }
    }

    // Trigger evaluation — splice-safe copy (bomb detonation mutates traps[]).
    for (const trap of [...traps]) {
      if (trap.state?.exploded || trap._disabledThisDay || trap._broken) continue
      const def = this._defs[trap.definitionId]
      if (!def) continue
      this._evaluateTrap(trap, def)
    }

    this._clearTickCache()
  }

  // Per-tick caches consumed by _targets / _isAdventurer.
  //   _tickAdvs        — alive adv array (snapshot)
  //   _tickMinions     — alive minion array (snapshot)
  //   _tickAdvsAndMinions — concat reused for factionsHit==='all'
  //   _tickAdvIds      — Set of alive adv instanceIds for O(1) is-adv check
  // Cleared at end of update() so a stale snapshot can't leak across ticks.
  _buildTickCache() {
    this._tickAdvs = (this._gameState.adventurers.active ?? [])
      .filter(a => a.aiState !== 'dead' && a.resources?.hp > 0)
    this._tickMinions = (this._gameState.minions ?? [])
      .filter(m => m.aiState !== 'dead' && m.resources?.hp > 0)
    this._tickAdvsAndMinions = this._tickAdvs.concat(this._tickMinions)
    this._tickAdvIds = new Set()
    for (const a of this._tickAdvs) this._tickAdvIds.add(a.instanceId)
  }

  _clearTickCache() {
    this._tickAdvs = null
    this._tickMinions = null
    this._tickAdvsAndMinions = null
    this._tickAdvIds = null
  }

  _evaluateTrap(trap, def) {
    switch (def.triggerCondition) {
      case 'los_lane':
      case 'los_facing':       this._fireLosTrap(trap, def); break
      case 'proximity':        this._checkBomb(trap, def);   break
      case 'radius':
      case 'adjacent_contact': this._fireAreaTrap(trap, def); break
      case 'stepped_on':       this._checkSteppedOn(trap, def); break
      // saw_overlap is handled in _tickSaw
    }
  }

  // ── Line-of-sight traps (arrows / dragon / cannon) ──────────────────────────

  _fireLosTrap(trap, def) {
    const now = this._scene.time.now
    if (now < (trap.cooldownUntil ?? 0)) return
    const lane = this._losLane(trap)
    if (!lane) return
    const target = this._scanLane(lane)
    if (!target) return

    // Cooldown is spent whether or not the shot jams, so a jam costs a
    // full reload rather than retrying on the very next frame.
    trap.cooldownUntil = now + (def.cooldownMs ?? 2000)
    if (this._jammed(trap, target)) return

    const dmg    = this._modifiedDamage(trap, def)
    const roomId = this._roomIdAt(target.tileX, target.tileY)
    const damaged = !!this._hitEntity(trap, def, target, roomId, dmg)
    if (def.dot) this._applyPoison(target, def.dot, trap.instanceId)

    trap.state.firedAt = now
    EventBus.emit('TRAP_TRIGGERED', { trap, def, adventurer: target, roomId, damaged })
    EventBus.emit('TRAP_FIRED', { trap, def, targetId: target.instanceId })
  }

  // Starting tile + step vector for a trap's firing lane.
  _losLane(trap) {
    const d = DIR[trap.facing] ?? DIR.S
    const fp = trap.footprint ?? { w: 1, h: 1 }
    let x, y
    if (trap.placement === 'wall') {
      x = trap.tileX + d.dx
      y = trap.tileY + d.dy
    } else {
      // Cannon (2×2): fire from one tile past the footprint edge, centred.
      if      (trap.facing === 'N') { x = trap.tileX + (fp.w >> 1); y = trap.tileY - 1 }
      else if (trap.facing === 'S') { x = trap.tileX + (fp.w >> 1); y = trap.tileY + fp.h }
      else if (trap.facing === 'E') { x = trap.tileX + fp.w;        y = trap.tileY + (fp.h >> 1) }
      else                          { x = trap.tileX - 1;           y = trap.tileY + (fp.h >> 1) }
    }
    return { x, y, dx: d.dx, dy: d.dy }
  }

  // Walk the lane until the room boundary (wall/door/void), a solid trap,
  // or the first adventurer. Doors stop the scan so a trap's line of sight
  // never reaches into a neighbouring room.
  _scanLane(lane) {
    let { x, y } = lane
    for (let i = 0; i < LOS_MAX_TILES; i++) {
      const t = this._dungeonGrid.getTileType(x, y)
      if (t === TILE.WALL || t === TILE.BOSS_WALL || t === TILE.VOID || t === TILE.DOOR) return null
      if (this._solidTrapAt(x, y)) return null
      const hit = (this._gameState.adventurers.active ?? []).find(a =>
        a.aiState !== 'dead' && a.resources?.hp > 0 && a.tileX === x && a.tileY === y)
      if (hit) return hit
      x += lane.dx
      y += lane.dy
    }
    return null
  }

  // ── Bomb (proximity → fuse → explosion) ─────────────────────────────────────

  _checkBomb(trap, def) {
    if (trap.state.fuseLit) return
    const r = def.triggerRange ?? 2
    const lit = (this._gameState.adventurers.active ?? []).some(a =>
      a.aiState !== 'dead' && a.resources?.hp > 0 &&
      Math.abs(a.tileX - trap.tileX) <= r && Math.abs(a.tileY - trap.tileY) <= r)
    if (!lit) return
    trap.state.fuseLit    = true
    trap.state.fuseEndsAt = this._scene.time.now + (def.fuseMs ?? 3000)
    EventBus.emit('TRAP_FUSE_LIT', { trap, def })
  }

  _detonateBomb(trap, def) {
    trap.state.exploded = true
    const radius = def.splashRadius ?? 5
    const cx = trap.tileX + 0.5
    const cy = trap.tileY + 0.5
    const fullDmg = this._modifiedDamage(trap, def)
    const roomId  = this._roomIdAt(trap.tileX, trap.tileY)
    // Linear falloff with a floor — full damage at the bomb tile, scaled
    // down to BOMB_FALLOFF_FLOOR (30%) at the edge of the splash radius.
    // Computed per-victim so two advs in the same blast can take wildly
    // different damage depending on where they're standing.
    const floor = Balance.BOMB_FALLOFF_FLOOR ?? 0.30

    // Consumable — the bomb is gone once it blows. SPLICE FIRST so even
    // if downstream listeners (TRAP_TRIGGERED / TRAP_EXPLODED) or the
    // chain-detonate loop throws, the bomb cannot survive in the array
    // as a zombie. Use reference equality (`indexOf`) instead of an
    // instanceId lookup so the splice can't miss even if state is odd.
    const traps = this._gameState.dungeon.traps
    const idx = traps.indexOf(trap)
    if (idx >= 0) traps.splice(idx, 1)
    EventBus.emit('TRAP_REMOVED', { trap, reason: 'detonated' })

    const victims = this._targets(def).filter(e =>
      Math.hypot((e.tileX + 0.5) - cx, (e.tileY + 0.5) - cy) <= radius)
    let firstAdv = null
    let damaged  = false
    for (const v of victims) {
      if (!firstAdv && this._isAdventurer(v)) firstAdv = v
      const dist = Math.hypot((v.tileX + 0.5) - cx, (v.tileY + 0.5) - cy)
      const fall = Math.max(floor, 1 - dist / radius)
      const dmg  = Math.max(1, Math.round(fullDmg * fall))
      if (this._hitEntity(trap, def, v, roomId, dmg)) damaged = true
    }

    EventBus.emit('TRAP_TRIGGERED', { trap, def, adventurer: firstAdv, roomId, damaged })
    EventBus.emit('TRAP_EXPLODED', { trap, def, worldX: cx * TS, worldY: cy * TS, radius })

    // Chain-detonate nearby bombs — light their fuses on a short delay so
    // the cascade reads as a sequence rather than one instant blast.
    if (def.chainDetonate) {
      const now = this._scene.time.now
      for (const other of this._gameState.dungeon.traps ?? []) {
        if (other === trap || other.definitionId !== 'bomb') continue
        if (other.state?.exploded) continue
        if (Math.hypot((other.tileX + 0.5) - cx, (other.tileY + 0.5) - cy) > radius) continue
        other.state.fuseLit    = true
        other.state.fuseEndsAt = Math.min(other.state.fuseEndsAt ?? Infinity, now + 200)
      }
    }
  }

  // ── Area traps (spike pillar / rotating blades) ─────────────────────────────

  _fireAreaTrap(trap, def) {
    const now = this._scene.time.now
    if (now < (trap.cooldownUntil ?? 0)) return
    const r  = def.triggerRange ?? 1
    const fp = trap.footprint ?? { w: 1, h: 1 }
    const x0 = trap.tileX, x1 = trap.tileX + fp.w - 1
    const y0 = trap.tileY, y1 = trap.tileY + fp.h - 1
    // `radius` traps (Spike Pillar) hit only the tiles directly touching the
    // body — Manhattan distance excludes the diagonal corner tiles.
    // `adjacent_contact` (Rotating Blades) keeps the full square ring.
    const manhattan = def.triggerCondition === 'radius'
    const inRange = (e) => {
      const dx = Math.max(x0 - e.tileX, 0, e.tileX - x1)
      const dy = Math.max(y0 - e.tileY, 0, e.tileY - y1)
      return manhattan ? (dx + dy >= 1 && dx + dy <= r)
                       : (dx <= r && dy <= r)
    }

    const victims = this._targets(def).filter(inRange)
    if (!victims.length) return

    trap.cooldownUntil = now + (def.cooldownMs ?? 1000)
    if (this._jammed(trap, victims[0])) return

    const dmg    = this._modifiedDamage(trap, def)
    const roomId = this._roomIdAt(trap.tileX, trap.tileY)
    let damaged  = false
    for (const v of victims) {
      if (this._hitEntity(trap, def, v, roomId, dmg)) damaged = true
    }

    trap.state.firedAt = now
    this._announce(trap, def, roomId, victims.find(v => this._isAdventurer(v)), damaged)
    EventBus.emit('TRAP_FIRED', { trap, def })
  }

  // ── Spike pit (stepped on) ──────────────────────────────────────────────────

  _checkSteppedOn(trap, def) {
    const now = this._scene.time.now
    const fp  = trap.footprint ?? { w: 1, h: 1 }
    trap.state.hitAt ??= {}
    const reHit = def.cooldownMs ?? 600

    for (const e of this._targets(def)) {
      const onPit = e.tileX >= trap.tileX && e.tileX < trap.tileX + fp.w &&
                    e.tileY >= trap.tileY && e.tileY < trap.tileY + fp.h
      if (!onPit) continue
      if (now - (trap.state.hitAt[e.instanceId] ?? -Infinity) < reHit) continue
      // Snapshot the pre-hit revealed state. If the pit was ALREADY
      // sprung (someone fell in earlier today) the spikes are exposed,
      // so a victim forced over it now only takes HALF damage — they
      // can see what they're stepping on. Pathfinder also tries to
      // detour around revealed pits (see PathfinderSystem
      // opts.avoidSprungTraps), so re-triggers should be rare to begin
      // with — this is the "no other route" fallback.
      const wasRevealed = !!trap.state.revealed
      trap.state.hitAt[e.instanceId] = now
      trap.state.revealed = true
      trap.state.firedAt  = now

      let dmg = this._modifiedDamage(trap, def)
      if (wasRevealed) dmg = Math.max(1, Math.round(dmg * 0.5))
      const roomId = this._roomIdAt(e.tileX, e.tileY)
      const damaged = !!this._hitEntity(trap, def, e, roomId, dmg)
      EventBus.emit('TRAP_TRIGGERED', { trap, def, adventurer: this._isAdventurer(e) ? e : null, roomId, damaged })
      EventBus.emit('TRAP_FIRED', { trap, def })
    }
  }

  // ── Saw blade (travels a track) ─────────────────────────────────────────────

  _tickSaw(trap, def) {
    const st  = trap.state
    const now = this._scene.time.now
    // Position from a shared time-based wave — keeps the damage tile in
    // lockstep with TrapRenderer's blade animation.
    st.sawPos = sawPosAt(now, def.trackLength ?? 4, def.sawSpeed ?? 3)

    const horiz = trap.facing === 'E' || trap.facing === 'W'
    const i  = Math.round(st.sawPos)
    const sx = horiz ? trap.tileX + i : trap.tileX
    const sy = horiz ? trap.tileY     : trap.tileY + i

    const reHit = def.cooldownMs ?? 1000
    st.hitAt ??= {}
    for (const e of this._targets(def)) {
      if (e.tileX !== sx || e.tileY !== sy) continue
      if (now - (st.hitAt[e.instanceId] ?? -Infinity) < reHit) continue
      st.hitAt[e.instanceId] = now
      const dmg    = this._modifiedDamage(trap, def)
      const roomId = this._roomIdAt(sx, sy)
      const damaged = !!this._hitEntity(trap, def, e, roomId, dmg)
      st.firedAt = now
      this._announce(trap, def, roomId, this._isAdventurer(e) ? e : null, damaged)
      EventBus.emit('TRAP_FIRED', { trap, def })
    }
  }

  // ── Poison damage-over-time (shooting arrows) ───────────────────────────────

  _applyPoison(adv, dot, sourceId) {
    if (!adv) return
    adv.flags ??= {}
    const now = this._scene.time.now
    adv.flags.trapPoison = {
      dps:        Math.max(1, Math.round((dot.damagePerSec ?? 2) * this._bossDamageScale())),
      damageType: dot.damageType ?? 'poison',
      endsAt:     now + (dot.durationMs ?? 10000),
      nextTickAt: now + POISON_TICK_MS,
      sourceId,
    }
  }

  _tickPoison() {
    const now = this._scene.time.now
    for (const adv of this._gameState.adventurers.active ?? []) {
      const p = adv.flags?.trapPoison
      if (!p) continue
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) { adv.flags.trapPoison = null; continue }
      while (now >= p.nextTickAt && p.nextTickAt <= p.endsAt) {
        const _smFloor = (adv._shadowMonarch || adv._lightParty)
          ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
        adv.resources.hp = Math.max(_smFloor, adv.resources.hp - p.dps)
        EventBus.emit('COMBAT_HIT', {
          sourceId: p.sourceId, targetId: adv.instanceId,
          damage: p.dps, damageType: p.damageType, isCritical: false,
        })
        if (adv.resources.hp <= 0) {
          EventBus.emit('COMBAT_KILL', {
            sourceId: p.sourceId, targetId: adv.instanceId,
            damageType: p.damageType, method: 'trap_poison',
            roomId: this._roomIdAt(adv.tileX, adv.tileY),
            day: this._gameState.meta.dayNumber,
          })
          break
        }
        p.nextTickAt += POISON_TICK_MS
      }
      if (now >= p.endsAt) adv.flags.trapPoison = null
    }
  }

  // ── Damage application ──────────────────────────────────────────────────────

  // Apply `dmg` to one entity. Honours Monk Focus dodge and the spike pit's
  // instakill roll, and routes through COMBAT_HIT / COMBAT_KILL.
  _hitEntity(trap, def, entity, roomId, dmg) {
    if (!entity || entity.resources?.hp <= 0) return false
    // The Saboteur is invulnerable while disarming — traps can't touch them.
    if (entity._invulnerable) return false
    const now = this._scene.time.now
    // One-time-per-trap rule (2026-05-27): each ADVENTURER can be damaged
    // by a given trap instance only ONCE. trap.state is wiped every night
    // (resetAll) and advs don't persist across days, so this is
    // effectively "once per trap per adventurer." Each trap is a single
    // toll — re-crossings and continuous/area traps no longer chip the
    // same adv repeatedly. Marked only AFTER damage actually lands (so a
    // Monk dodge below doesn't burn the one-shot). Minions / boss are
    // exempt — the rule is adventurer-specific per design.
    const onceGated = this._isAdventurer(entity) && entity.instanceId && trap.state
    if (onceGated) {
      trap.state.hitOnce ??= {}
      if (trap.state.hitOnce[entity.instanceId]) return false
    }
    // Per-entity 4 s damage lockout REMOVED 2026-05-27. It sat on top of
    // each trap's own fire-rate cooldown (the per-entity `hitAt` gate on
    // stepped-on / saw traps, and the per-trap `cooldownUntil` on LOS /
    // area traps) and suppressed damage if the same entity contacted the
    // trap again within 4 s. Player-visible effect: crossing a 2×2 spike
    // pit, or stepping off-and-back-on, landed only ONE hit and the rest
    // read as "walked over the trap and took nothing." Per the design
    // call (keep room-level avoidance, but ANY actual contact must hurt),
    // each trap now damages purely on its own cooldownMs cadence. The
    // per-hit maxHp cap + instakill + Monk dodge below still apply, so a
    // single touch still can't one-shot (outside the spike pit's 1%
    // instakill roll).
    // Monk Focus — 30% dodge vs traps (adventurers only carry this flag).
    if (entity._focusActiveUntil && now < entity._focusActiveUntil && Math.random() < 0.30) {
      AbilityVfx.floatingText?.(this._scene, entity.worldX, entity.worldY - 18, 'DODGED', { color: '#eeeeff' })
      EventBus.emit('TRAP_DODGED', { trap, def, adventurer: entity })
      return false
    }
    let damage = dmg
    let instakill = false
    // Light Party + Shadow Monarch take trap DAMAGE but are immune to the
    // instant-kill roll — they die only to normal combat / the boss duel.
    const _instakillImmune = !!(entity?._lightParty || entity?._shadowMonarch)
    if (!_instakillImmune && def.instakillChance && this._isAdventurer(entity) && Math.random() < def.instakillChance) {
      damage = entity.resources.hp
      instakill = true
    }
    // Three-zone clamp (2026-05-27) — adventurers only, instakill exempt.
    // Damage is clamped between a per-trap FLOOR and a CAP, both % of the
    // victim's max HP:
    //   • CAP  (TRAP_MAX_ADV_DMG_FRAC, 30%) tames the near-lethal early
    //     game — a day-1 spike pit chunks ~30% instead of ~75%.
    //   • FLOOR (baseDamage × TRAP_MIN_ADV_DMG_PER_BASE × maxHp) keeps
    //     traps meaningful late game, where flat scaling otherwise drops
    //     to ~1% of a 4,000+ HP adventurer. Spike pit floors at 10%,
    //     arrow at 1.5%, etc. — relative danger preserved.
    // Between the two, the flat boss-level-scaled damage applies, so each
    // trap keeps its hand-tuned mid-game identity.
    if (!instakill && this._isAdventurer(entity)) {
      const maxHp = entity.resources?.maxHp ?? entity.resources?.hp ?? 0
      if (maxHp > 0) {
        const capFrac   = Balance.TRAP_MAX_ADV_DMG_FRAC ?? 0.30
        const floorFrac = (def.baseDamage ?? 0) * (Balance.TRAP_MIN_ADV_DMG_PER_BASE ?? 0)
        const cap   = Math.floor(maxHp * capFrac)
        const floor = Math.min(cap, Math.floor(maxHp * floorFrac))  // floor never exceeds cap
        damage = Math.max(floor, Math.min(damage, cap))
      }
    }
    // Solo Leveling — the Shadow Monarch takes 50% less trap damage
    // (mirrors his -50% minion-damage passive in CombatSystem). Applied
    // after the cap so it stacks on top of the squishy-protection clamp.
    if (entity._shadowMonarch) damage = Math.floor(damage * 0.5)
    if (damage <= 0) return false

    // Jinwoo + Light Party floor at 10% max HP — traps can't kill them; only
    // the boss duel can.
    const _smFloor = (entity._shadowMonarch || entity._lightParty)
      ? Math.max(1, Math.ceil((entity.resources.maxHp ?? 1) * 0.10)) : 0
    entity.resources.hp = Math.max(_smFloor, entity.resources.hp - damage)
    entity._lastHitBy   = trap.instanceId
    entity._lastHitType = def.damageType ?? 'physical'
    // Damage landed — burn this adv's one-shot for this trap (see the
    // one-time-per-trap gate at the top).
    if (onceGated) trap.state.hitOnce[entity.instanceId] = true

    EventBus.emit('COMBAT_HIT', {
      sourceId: trap.instanceId, targetId: entity.instanceId,
      damage, damageType: def.damageType ?? 'physical', isCritical: instakill,
    })
    if (entity.resources.hp <= 0) {
      EventBus.emit('COMBAT_KILL', {
        sourceId: trap.instanceId, targetId: entity.instanceId,
        damageType: def.damageType ?? 'physical',
        method: `trap_${def.id}`, roomId, day: this._gameState.meta.dayNumber,
      })
    }
    return true
  }

  // Base damage with pact / mechanic / Engineer modifiers folded in. Computed
  // once per fire so a 5× Brand bless is consumed by exactly one volley.
  _modifiedDamage(trap, def) {
    let dmg = def.baseDamage ?? 0
    if (dmg <= 0) return 0
    dmg *= this._bossDamageScale()
    const f = this._gameState._mechanicFlags ?? {}
    if (f.openBook)        dmg *= Balance.MECHANIC_OPEN_BOOK_TRAP_DAMAGE_MULT ?? 2
    if (f.trapDamageMult)  dmg *= f.trapDamageMult
    if (f.pactOfTheJester) dmg *= Balance.MECHANIC_JESTER_TRAP_DAMAGE_MULT ?? 1.5
    if (f.pactOfTheBrand && trap._brandBlessed) {
      dmg *= Balance.MECHANIC_BRAND_BLESSED_DAMAGE_MULT ?? 5
      trap._brandBlessed = false
    }
    const room = this._dungeonGrid.getRoomAtTile(trap.tileX, trap.tileY)
    if (room && this._engineerInRoom(room.instanceId)) {
      dmg *= Balance.ENGINEER_TRAP_DAMAGE_BUFF ?? 1.25
    }
    return Math.max(1, Math.round(dmg))
  }

  // Trap damage scales with boss level so traps keep pace with the
  // toughening adventurer waves — mirrors minion attack scaling.
  _bossDamageScale() {
    const lv = this._gameState.boss?.level ?? 1
    return 1 + (Balance.TRAP_DAMAGE_PER_BOSS_LV ?? 0.12) * Math.max(0, lv - 1)
  }

  // Hasty Architect — a trap may jam instead of firing (not consumed).
  _jammed(trap, sampleEntity) {
    const f = this._gameState._mechanicFlags ?? {}
    if (!f.hastyArchitect) return false
    if (Math.random() >= (Balance.MECHANIC_HASTY_ARCHITECT_JAM_CHANCE ?? 0.25)) return false
    if (sampleEntity) {
      AbilityVfx.floatingText?.(this._scene, sampleEntity.worldX, sampleEntity.worldY - 18,
        'JAMMED', { color: '#ffaa55' })
    }
    EventBus.emit('TRAP_JAMMED', { trap })
    return true
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Throttled TRAP_TRIGGERED — keeps continuous traps from spamming knowledge
  // updates / emotes every tick while still flagging them as discovered.
  _announce(trap, def, roomId, adventurer, damaged = false) {
    const now = this._scene.time.now
    if (now - (trap.state._lastAnnounce ?? -Infinity) < ANNOUNCE_GAP_MS) return
    trap.state._lastAnnounce = now
    EventBus.emit('TRAP_TRIGGERED', { trap, def, adventurer: adventurer ?? null, roomId, damaged })
  }

  // Entities a trap can damage — adventurers always; minions too when the
  // trap's factionsHit is 'all' (area / contact hazards). Returns the
  // per-tick cache built in update(); off-tick callers (e.g. tests) fall
  // back to a fresh filter so the contract still holds.
  _targets(def) {
    if (this._tickAdvs) {
      return def.factionsHit === 'all' ? this._tickAdvsAndMinions : this._tickAdvs
    }
    const advs = (this._gameState.adventurers.active ?? [])
      .filter(a => a.aiState !== 'dead' && a.resources?.hp > 0)
    if (def.factionsHit !== 'all') return advs
    const minions = (this._gameState.minions ?? [])
      .filter(m => m.aiState !== 'dead' && m.resources?.hp > 0)
    return advs.concat(minions)
  }

  _isAdventurer(entity) {
    if (this._tickAdvIds) return this._tickAdvIds.has(entity?.instanceId)
    return (this._gameState.adventurers.active ?? []).includes(entity)
  }

  _roomIdAt(x, y) {
    return this._dungeonGrid.getRoomAtTile(x, y)?.instanceId ?? null
  }

  _solidTrapAt(x, y) {
    for (const t of this._gameState.dungeon.traps ?? []) {
      if (!this._defs[t.definitionId]?.solid) continue
      const fp = t.footprint ?? { w: 1, h: 1 }
      if (x >= t.tileX && x < t.tileX + fp.w && y >= t.tileY && y < t.tileY + fp.h) return true
    }
    return false
  }

  _engineerInRoom(roomId) {
    return (this._gameState.minions ?? []).some(m =>
      m.aiState !== 'dead' && m.faction === 'dungeon' &&
      m.assignedRoomId === roomId && m.definitionId === 'engineer')
  }
}
