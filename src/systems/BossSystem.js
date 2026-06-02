// Phase 10 — BossSystem.
//
// Owns the boss-fight resolution and the boss's "lives" counter. The boss
// is the player's avatar and never directly controlled — fights are auto-
// resolved by stat comparison with a small variance.
//
// Flow:
//   1. AISystem SEEK_BOSS reached → emits BOSS_FIGHT_INCOMING (and switches
//      adv.goal to 'AT_BOSS'; the adventurer just stops moving).
//   2. After a short pre-fight delay (so the player notices the auto-pause),
//      BossSystem._resolve() collects the party in/around boss_chamber and
//      computes outcome:
//        partyTotalAttack vs bossDefense -> bossHp damage
//        bossAttack       vs partyDefense -> total partyHp damage spread
//      Multiple rounds of this run until either bossHp <= 0 or all advs HP <= 0.
//   3. Emits BOSS_FIGHT_RESOLVED { winner: 'boss'|'party', deathsRemaining }.
//      - boss wins  → all in-room advs die (AISystem._kill via COMBAT_KILL
//        emit so loot/evolution etc. all chain naturally).
//      - party wins → boss loses one of BOSS_DEFEATS_TO_GAME_OVER lives.
//        Survivors flee with ADVENTURER_FLED reason='boss_defeated'.
//   4. When deathsRemaining hits 0 → emits BOSS_DEFEATED_FINAL → Game scene
//      stops everything and starts GameOver.
//
// State serialised as `gameState.boss = { hp, maxHp, deathsRemaining }`.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'
import { TILE }     from './DungeonGrid.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'

const PREFIGHT_DELAY_MS = 1000   // banner pause before the first combat round
const ROUND_INTERVAL_S  = 0.6    // seconds of cinematic combat between damage rounds

export class BossSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._listeners = []
    this._fighting = false

    // Wander runtime state — not serialised, reset each session
    this._bossRoom     = null
    this._wanderTarget = null
    this._wanderAccum  = 1500   // start wandering after ~1.5 s
    // Death-pose timestamp.  When > scene.time.now the boss skips its
    // wander tick and stays planted on its last position so the death
    // animation freezes on its last frame.  Set on _endFight('party')
    // when boss.hp dropped to 0.  Lasts 4 s for a non-final life loss
    // (so the player visibly sees the boss collapse before the next
    // run starts), and Infinity for the final death.  Cleared on
    // BOSS_FIGHT_INCOMING (next adv party arrives) and on
    // NIGHT_PHASE_STARTED (day flip resets everything).
    this._deathPoseUntil = 0

    this._init()
    this._wire()
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._fxGraphics?.destroy();   this._fxGraphics  = null
    this._arenaGlowG?.destroy();   this._arenaGlowG  = null
    this._decalsG?.destroy();      this._decalsG     = null
  }

  // Persisted state. Boss HP refreshes between fights — only deathsRemaining
  // is the run-long counter.
  _init() {
    const TS = Balance.TILE_SIZE
    const bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
    const cx = bossRoom ? bossRoom.gridX + Math.floor(bossRoom.width  / 2) : 0
    const cy = bossRoom ? bossRoom.gridY + Math.floor(bossRoom.height / 2) : 0

    if (this._gameState.boss) {
      // Boss already exists — migrate newer fields for saves from earlier phases.
      this._gameState.boss.unlockedAbilities ??= []
      this._gameState.boss.tileX    ??= cx
      this._gameState.boss.tileY    ??= cy
      this._gameState.boss.worldX   ??= cx * TS + TS / 2
      this._gameState.boss.worldY   ??= cy * TS + TS / 2
      this._gameState.boss.level    ??= this._gameState.meta?.dungeonLevel ?? 1
      this._gameState.boss.xp       ??= this._gameState.meta?.xp ?? 0
      this._gameState.boss.xpToNext ??= this._gameState.meta?.xpToNext ?? Balance.BOSS_XP_BASE
      // Stable id used by per-hit subscribers (HitSparkSystem,
      // CheaterAttackVfxSystem) to resolve the boss via `_findEntity`.
      // There's only ever one boss, so a sentinel string suffices —
      // adventurer instanceIds use `adv_<ts>_<rand>` so no collision.
      // Backfilled here for legacy saves; fresh-init below sets it too.
      this._gameState.boss.instanceId ??= 'boss'
      // Day-scaling recompute — covers the mango "JUMP TO DAY 50"
      // cheat and any legacy save loaded after the day-scaling system
      // landed. Without this, the boss HP bar shows the stale level-
      // only HP until the first fight kicks off.
      this._recomputeBossFightStats()
      return
    }

    const archId = this._gameState.player?.bossArchetypeId
    const archs  = this._scene.cache.json.get('bossArchetypes') ?? []
    const arch   = archs.find(a => a.id === archId)
    const fight  = arch?.baseFightStats ?? { hp: 200, attack: 12, defense: 10 }
    this._gameState.boss = {
      instanceId:       'boss',   // stable id for per-hit COMBAT_HIT subscribers
      hp:               fight.hp,
      maxHp:            fight.hp,
      attack:           fight.attack,
      defense:          fight.defense,
      deathsRemaining:  Balance.BOSS_DEFEATS_TO_GAME_OVER ?? 3,
      totalLivesEverHad: Balance.BOSS_DEFEATS_TO_GAME_OVER ?? 3,
      unlockedAbilities: [],
      tileX:  cx,
      tileY:  cy,
      worldX: cx * TS + TS / 2,
      worldY: cy * TS + TS / 2,
      level:    1,
      xp:       0,
      xpToNext: Balance.BOSS_XP_BASE,
    }
    // Fresh-init at day 1 — the recompute will produce the same numbers
    // as the literal init above (no level/day scaling at day 1, level 1)
    // but keep the call for parity with the migration branch above.
    this._recomputeBossFightStats()
  }

  // ── Ability tree (Phase 10b) ─────────────────────────────────────────────

  // Returns ability defs the player could buy right now (not already owned,
  // requirements met). Filters by power cost too if filterAffordable=true.
  getAvailableAbilities(filterAffordable = false) {
    const defs = this._scene.cache.json.get('bossAbilities') ?? []
    const owned = new Set(this._gameState.boss.unlockedAbilities ?? [])
    const xp = this._gameState.boss?.xp ?? 0
    return defs.filter(d => {
      if (owned.has(d.id)) return false
      for (const req of (d.requires ?? [])) if (!owned.has(req)) return false
      if (filterAffordable && (d.powerCost ?? 0) > xp) return false
      return true
    })
  }

  unlockAbility(abilityId) {
    const defs = this._scene.cache.json.get('bossAbilities') ?? []
    const def = defs.find(d => d.id === abilityId)
    if (!def) return false
    const owned = this._gameState.boss.unlockedAbilities
    if (owned.includes(abilityId)) return false
    if ((this._gameState.boss?.xp ?? 0) < (def.powerCost ?? 0)) return false
    for (const req of (def.requires ?? [])) {
      if (!owned.includes(req)) return false
    }
    this._gameState.boss.xp = Math.max(0, (this._gameState.boss.xp ?? 0) - (def.powerCost ?? 0))
    owned.push(abilityId)

    // Apply passive stat bonuses immediately
    if (def.effect === 'boss_defense_plus_5') this._gameState.boss.defense += 5
    if (def.effect === 'boss_attack_plus_4')  this._gameState.boss.attack  += 4

    EventBus.emit('BOSS_ABILITY_UNLOCKED', { abilityId, def })
    return true
  }

  // ── Wander update (called every frame from Game.update) ──────────────────

  update(delta) {
    const boss = this._gameState.boss
    if (!boss) return
    // Light Party duel owns its own scripted choreography (tweens + timers in
    // _scriptLightPartyDuel). The generic _tickFightAnim would fight it — it
    // conscripts the party into the orbit-dance, room-clamps their positions
    // (snapping the tweened sprites), runs its own damage model, and could
    // resolve the fight early via the 60s cap. Skip it entirely while the
    // light-party duel is live; the duel ticks its OWN per-frame layer here.
    if (this._lightPartyDuel) {
      this._tickLightPartyDuel(delta)
      return
    }
    // Aldric's Act IV climax duel owns its own scripted kinetic layer (movement,
    // HP curve, VFX, resolution) — same isolation as the Light Party duel.
    if (this._nemDuelActive) {
      this._tickNemesisDuel(delta)
      return
    }
    if (this._fighting) {
      this._tickFightAnim(delta)
      return
    }

    // ── Orphan-combatant watchdog ────────────────────────────────────
    // An adventurer can be stranded with goal 'AT_BOSS' and NO fight
    // running. AISystem hands a SEEK_BOSS adventurer to BossSystem by
    // setting goal 'AT_BOSS' and emitting BOSS_FIGHT_INCOMING — but
    // _onIncoming drops that event with `if (this._fighting) return`
    // when a previous fight is still resolving. If that prior fight
    // then ends before _syncFightParty folds the new arrival in, nobody
    // ever picks them up: AISystem freezes AT_BOSS advs in place (they
    // are BossSystem-owned), the active list never empties, and the day
    // never ends — exactly the "second boss fight freezes the game"
    // report. Because `update` only reaches here when _fighting is
    // false, any AT_BOSS adventurer found now is provably stranded.
    // Recover deterministically every frame: start a fresh fight for
    // them, or release them to flee when the boss is already finally
    // defeated (no lives + no phylactery).
    // hp > 0 excludes a just-killed adventurer whose corpse is still in
    // the active list playing its death animation before the splice —
    // its aiState may not have flipped to 'dead' yet on the same frame.
    const stranded = (this._gameState.adventurers?.active ?? []).filter(a =>
      a.goal?.type === 'AT_BOSS' &&
      a.aiState !== 'dead' && a.aiState !== 'fled' && a.aiState !== 'fleeing' &&
      (a.resources?.hp ?? 1) > 0)
    if (stranded.length > 0) {
      if (this.isFinalDeath()) {
        for (const a of stranded) {
          a.goal    = { type: 'FLEE', reason: 'boss_defeated' }
          a.path    = null
          a.aiState = 'fleeing'
        }
      } else {
        // Clear any lingering death-pose so _onIncoming doesn't bail,
        // then re-emit BOSS_FIGHT_INCOMING so EVERY listener (the DOM
        // BossFightOverlay, fight music, the death-pose clear, and our
        // own _onIncoming) re-syncs — not just our internal fight
        // start. _onIncoming will set _fighting = true synchronously,
        // so next frame skips this watchdog (the early _fighting
        // branch), and it fires exactly once per stranded party.
        this._deathPoseUntil = 0
        EventBus.emit('BOSS_FIGHT_INCOMING', { adventurer: stranded[0] })
      }
      return
    }

    // Death-pose freeze — boss collapsed at the end of the last fight
    // and is lingering on the last frame of its death animation.
    // Skip wander, advance the on-screen sprite stays planted.
    const now = this._scene.time?.now ?? 0
    if (this._deathPoseUntil > now) return

    const TS       = Balance.TILE_SIZE
    const SPEED    = 1.2    // tiles / second
    const INTERVAL = 3000   // ms between destination picks

    // Cache boss chamber reference
    if (!this._bossRoom) {
      this._bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
    }
    const room = this._bossRoom
    if (!room) return

    // Step toward current wander target
    if (this._wanderTarget) {
      const { tx, ty } = this._wanderTarget
      const targetWX = tx * TS + TS / 2
      const targetWY = ty * TS + TS / 2
      const dx = targetWX - boss.worldX
      const dy = targetWY - boss.worldY
      const dist = Math.hypot(dx, dy)
      const step = SPEED * TS * delta / 1000

      if (step >= dist || dist < 1) {
        boss.worldX = targetWX
        boss.worldY = targetWY
        boss.tileX  = tx
        boss.tileY  = ty
        this._wanderTarget = null
        this._wanderAccum  = 0
      } else {
        boss.worldX += (dx / dist) * step
        boss.worldY += (dy / dist) * step
        boss.tileX   = Math.floor(boss.worldX / TS)
        boss.tileY   = Math.floor(boss.worldY / TS)
      }
      return
    }

    // Idle — wait then pick next destination
    this._wanderAccum += delta
    if (this._wanderAccum < INTERVAL) return

    // Pick a random interior tile (1 tile inset from walls)
    const w = Balance.WALL_THICKNESS
    const x0 = room.gridX + w
    const y0 = room.gridY + w
    const x1 = room.gridX + room.width  - w - 1
    const y1 = room.gridY + room.height - w - 1
    if (x1 < x0 || y1 < y0) return   // room too small to wander

    const tx = x0 + Math.floor(Math.random() * (x1 - x0 + 1))
    const ty = y0 + Math.floor(Math.random() * (y1 - y0 + 1))
    this._wanderTarget = { tx, ty }
    this._wanderAccum  = 0
  }

  // ── Fight animation (cosmetic) ───────────────────────────────────────────
  // While _fighting is true and before _resolve() runs, drive an action-based
  // combat animation for the boss + every AT_BOSS adventurer.  Each combatant
  // has a small state machine of discrete actions (dash / strike / reposition
  // / knockback for advs; chase / lunge / slam / recover for the boss); when
  // the action timer expires, a new one is rolled with weighted probabilities.
  // All purely visual — combat math still happens in _resolve().  Mutates
  // worldX/worldY directly; AISystem leaves AT_BOSS adventurers alone (path
  // is null), so the mutations stick.
  _tickFightAnim(delta) {
    const dt = delta / 1000
    this._fightT = (this._fightT ?? 0) + dt

    // Combat-start gate. _onIncoming also schedules a scene.time
    // delayedCall to flip _combatStarted, but that timer rides the
    // Game scene's clock — which the killing-blow slow-mo scales, and
    // which can desync from this system's own _fightT accumulator.
    // Gating on _fightT (which advances purely from the scaled delta
    // every tick this fight runs) guarantees combat ALWAYS begins,
    // even if the delayedCall is delayed, dropped, or never fires.
    // Without a hard guarantee here a fight can animate forever
    // without exchanging damage — adventurers dance, nothing dies,
    // the active list never empties and the day never ends.
    if (!this._combatStarted && this._fightT >= PREFIGHT_DELAY_MS / 1000) {
      this._combatStarted = true
    }

    if (!this._fightStates) {
      this._fightStates = new Map()
      this._bossState   = {
        action: 'chase', actionT: 0, actionDur: 0.6,
        targetId: null, slamFired: false, windUpEmitted: false,
      }
    }

    // ── Hard fight-duration cap — absolute anti-freeze backstop ───────
    // With the round cap removed (2026-05-27), this 60-second
    // wall-clock ceiling is the ONLY safety net guaranteeing fights
    // resolve. Without it a stalemate (both sides regenerating, or
    // numbers tuned so neither can kill the other) would freeze the
    // game — _fighting would stay stuck true, the day would never end.
    //
    // _fightT advances purely from the scaled delta every tick this
    // fight runs, so this fires in bounded REAL time at EVERY speed
    // (≈7.5s real at 8×). Winner is decided by who still has HP.
    // _fightStates is non-null here (created above) so _endFight's
    // roster loop is safe.
    if (!this._fightEnded && !this._duelOutro && this._fightT > 60) {
      const boss = this._gameState.boss
      this._endFight(boss && (boss.hp ?? 0) > 0 ? 'boss' : 'party')
      return
    }

    if (!this._fxGraphics) {
      this._fxGraphics = this._scene.add.graphics().setDepth(2.7)
      this._fxParticles = []
    }
    // Tier 3 — boss-room atmosphere layers.
    //   _arenaGlowG : redrawn each tick while a fight is active. Tints the
    //                 boss-room floor red, intensifying as boss HP drops
    //                 below 50 % then 25 %. Sits above the floor (depth 1)
    //                 but below entities (~7).
    //   _decalsG    : persistent corpse splatters stamped during fights.
    //                 Cleared on NIGHT_PHASE_STARTED via _wire's listener.
    if (!this._arenaGlowG) {
      this._arenaGlowG = this._scene.add.graphics().setDepth(1.7).setBlendMode(Phaser.BlendModes.ADD)
    }
    if (!this._decalsG) {
      this._decalsG = this._scene.add.graphics().setDepth(1.55)
    }
    const room = this._bossRoom
      ?? (this._bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber'))
    if (!room) return

    this._syncFightParty()
    // Solo Leveling — when the sole combatant is the Shadow Monarch, the
    // standard orbit-dance is replaced by a bespoke 1:1 duel: both fighters
    // range across the whole arena trading blows (see _tickDuel). The damage
    // model (_runOneRound) is untouched — this only swaps the MOVEMENT layer.
    this._updateDuelMode()
    if (this._duelMode) {
      this._tickDuel(dt)
    } else {
      this._tickFightBoss(dt)
      // Slime King — each slime moves toward its own nearest adv every
      // tick. Boss centroid (boss.worldX/Y) is re-derived from the alive
      // slimes inside this call so the parent state machine that just
      // ran in _tickFightBoss gets a fresh anchor for its next pass.
      this._tickSlimes(dt)
      for (const fs of this._fightStates.values()) {
        this._tickFightAdv(fs, dt)
      }
    }
    if (this._combatStarted && !this._fightEnded) {
      this._tickFightCombat(dt)
    }
    this._tickFightFx(dt)
    this._tickArenaGlow()
  }

  // Boss-room floor glow — draws an additive red rectangle over the
  // boss room, with alpha proportional to "how hurt the boss is".
  // 100 % HP → invisible. 50 % HP → faint red. 25 % HP → strong red.
  // Drawn fresh each fight-tick and cleared when no fight is active.
  _tickArenaGlow() {
    const g = this._arenaGlowG
    if (!g) return
    g.clear()
    if (!this._fighting || this._fightEnded) return
    const room = this._bossRoom
    if (!room) return
    const boss = this._gameState.boss
    if (!boss) return
    const hpFrac = Math.max(0, Math.min(1, (boss.hp ?? 0) / Math.max(1, boss.maxHp ?? 1)))
    // Empirical curve: alpha 0 at full HP, ramps faster as HP drops.
    // (1 - hpFrac)² gives a soft start and a strong finish.
    const intensity = (1 - hpFrac) * (1 - hpFrac)
    if (intensity <= 0.01) return
    // Subtle slow pulse below 25 % so the room feels alive at low HP.
    const pulse = hpFrac < 0.25
      ? 0.85 + 0.15 * Math.sin((this._scene.time?.now ?? 0) / 220)
      : 1
    const alpha = Math.min(0.55, intensity * 0.55 * pulse)
    const TS = Balance.TILE_SIZE
    const WT = Balance.WALL_THICKNESS
    // Inset by wall thickness so the glow sits inside the masonry, not on top.
    const x = (room.gridX + WT) * TS
    const y = (room.gridY + WT) * TS
    const w = (room.width  - WT * 2) * TS
    const h = (room.height - WT * 2) * TS
    g.fillStyle(0xff2211, alpha)
    g.fillRect(x, y, w, h)
  }

  // Reconcile our internal fight-state map with the live AT_BOSS adventurer
  // list each tick, so late arrivals slot into the dance and dead/fled
  // combatants are pruned without leaving stale entries behind.
  _syncFightParty() {
    // 1) Conscript anyone on an INTERIOR FLOOR tile of the boss chamber
    //    who isn't already AT_BOSS.  Critically — exclude tiles that
    //    sit inside the wall thickness (the doorway block).  When a
    //    party member is still on a doorway tile they're at the room
    //    edge, but BossSystem's room-interior clamp (clampX/clampY)
    //    only allows positions past the wall thickness, so as soon as
    //    BossSystem starts ticking them their worldX/Y gets snapped
    //    several tiles into the room — a visible "teleport to the
    //    boss".  Waiting for them to walk fully through the doorway
    //    onto a real interior tile lets AISystem path them through
    //    the lane naturally; BossSystem's fast `dash` action then
    //    carries them smoothly from interior-edge to their orbit slot.
    //
    //    Critically — never re-conscript an adventurer who's already
    //    fleeing.  Without that guard, the moment _beginFlee sets goal
    //    to FLEE, this pass would yank them straight back into AT_BOSS
    //    on the same frame because they're still standing in the room.
    const room = this._bossRoom
    if (room) {
      const WT = Balance.WALL_THICKNESS
      for (const a of this._gameState.adventurers.active) {
        if (a.aiState === 'dead' || a.aiState === 'fled' || a.aiState === 'fleeing') continue
        if (a.goal?.type === 'AT_BOSS' || a.goal?.type === 'FLEE') continue
        const inInterior =
          a.tileX >= room.gridX + WT && a.tileX < room.gridX + room.width  - WT &&
          a.tileY >= room.gridY + WT && a.tileY < room.gridY + room.height - WT
        if (!inInterior) continue
        a.goal    = { type: 'AT_BOSS' }
        a.path    = null
        a.aiState = 'fighting'
      }
    }

    // 2) Reconcile fight-state map.  An adventurer should be in the map if:
    //      (a) they're an active AT_BOSS combatant, OR
    //      (b) they're fleeing but still physically inside the boss
    //          chamber — we want the boss to keep hitting them with round
    //          damage / slam AOE while they're in reach.  Once they
    //          actually leave the room they get pruned and are safe.
    //
    //    Important — a non-fleeing, non-AT_BOSS adventurer who's only
    //    in the room because they're still pathing through the doorway
    //    must NOT get a fight state here.  If they did, BossSystem
    //    would start ticking them (dash action + interior clamp) and
    //    snap them past the wall thickness — the same teleport fix as
    //    block 1 above.
    const classes   = this._scene.cache.json.get('adventurerClasses') ?? []
    const activeIds = new Set()
    for (const a of this._gameState.adventurers.active) {
      if (a.aiState === 'dead' || a.aiState === 'fled') continue
      const isAtBoss = a.goal?.type === 'AT_BOSS'
      const isFleeingInRoom = !!room &&
        a.aiState === 'fleeing' &&
        a.tileX >= room.gridX && a.tileX < room.gridX + room.width &&
        a.tileY >= room.gridY && a.tileY < room.gridY + room.height
      if (!isAtBoss && !isFleeingInRoom) continue
      activeIds.add(a.instanceId)
      if (this._fightStates.has(a.instanceId)) continue
      // New combatant — homeAngle spread relative to existing population.
      const idx      = this._fightStates.size
      const total    = idx + 1
      const phase    = (Math.PI * 2 * idx) / Math.max(2, total) + Math.random() * 0.4
      const classDef = classes.find(c => c.id === a.classId)
      const isRanged = !!classDef?.tags?.includes('ranged')
      a._bossFleeRolled = false   // fresh roll for every new fight entry
      this._fightStates.set(a.instanceId, {
        adv:        a,
        // Initial action — `approach` walks the new combatant from the
        // boss-room doorway to their orbit slot at the adventurer's
        // OWN walk speed, so they visibly run across the room instead
        // of insta-warping via a dash/reposition lerp.  Once they
        // arrive, _pickAdvAction transitions to the regular dance.
        action:     'approach',
        actionT:    0,
        actionDur:  4.0,    // long enough for any room; terminates on arrival
        homeAngle:  phase,
        vx: 0, vy: 0,
        strikeEmitted: false,
        isRanged,
        color:      a.color ?? 0xaabbcc,
      })
    }
    for (const id of [...this._fightStates.keys()]) {
      if (!activeIds.has(id)) this._fightStates.delete(id)
    }
  }

  _tickFightBoss(dt) {
    const TS   = Balance.TILE_SIZE
    const boss = this._gameState.boss
    const bs   = this._bossState
    const { clampX, clampY } = this._roomClamp()
    bs.actionT += dt
    if (bs.actionT >= bs.actionDur) this._pickBossAction(bs)

    const advs = [...this._fightStates.values()]
    switch (bs.action) {
      case 'chase': {
        // Aggro-weighted target pick: high aggro preferred, distance
        // penalty so close enemies aren't ignored.  Fleeing advs ARE
        // valid targets — if they built aggro before breaking, the boss
        // chases them (and tries to swing/slam in melee range).  Their
        // aggro decays naturally so eventually a fresh combatant wins
        // the focus.  Only dying / dodging are filtered out.
        let target = null, bestScore = -Infinity
        for (const fs of advs) {
          if (fs.action === 'dying' || fs.action === 'dodge') continue
          const d     = Math.hypot(fs.adv.worldX - boss.worldX, fs.adv.worldY - boss.worldY)
          const score = (fs.aggro ?? 0) - (d / TS) * 3
          if (score > bestScore) { bestScore = score; target = fs }
        }
        if (target) {
          bs.targetId = target.adv.instanceId
          const dx = target.adv.worldX - boss.worldX
          const dy = target.adv.worldY - boss.worldY
          const d  = Math.hypot(dx, dy) || 1
          const speed = 1.6 * TS
          boss.worldX += (dx / d) * speed * dt
          boss.worldY += (dy / d) * speed * dt
        }
        break
      }
      case 'lunge': {
        const target = advs.find(fs => fs.adv.instanceId === bs.targetId)
        if (target) {
          const dx = target.adv.worldX - boss.worldX
          const dy = target.adv.worldY - boss.worldY
          const d  = Math.hypot(dx, dy) || 1
          const speed = 7 * TS
          boss.worldX += (dx / d) * speed * dt
          boss.worldY += (dy / d) * speed * dt
          // Trail dot every frame
          this._emitFx({ kind: 'lunge_trail', x: boss.worldX, y: boss.worldY })
        }
        break
      }
      case 'slam': {
        const t = bs.actionT
        const WIND_UP = 0.3
        const STRIKE  = 0.45    // strike fires at this point
        if (!bs.windUpEmitted) {
          bs.windUpEmitted = true
          this._emitFx({ kind: 'wind_up', x: boss.worldX, y: boss.worldY })
          this._rollSlamDodges(boss)
        }
        if (t >= WIND_UP && t < STRIKE) {
          // Tiny anticipation hop — small recoil before strike
          // (no movement, just hold)
        } else if (t >= STRIKE && !bs.slamFired) {
          bs.slamFired = true
          this._emitFx({ kind: 'shockwave', x: boss.worldX, y: boss.worldY })
          const SLAM_RANGE      = 2.1 * TS
          const KNOCKBACK_SPEED = 14 * TS
          // Slam is the boss's signature AOE — every adventurer in range
          // eats 70% of boss attack on top of being knocked back.
          const SLAM_DMG_FRAC   = 0.7
          for (const fs of advs) {
            if (fs.action === 'dying') continue
            const dx = fs.adv.worldX - boss.worldX
            const dy = fs.adv.worldY - boss.worldY
            const d  = Math.hypot(dx, dy) || 0.01
            if (d > SLAM_RANGE) continue

            // AOE damage + hit-flash on each victim — fleeing adventurers
            // still take the hit while they're in range.
            const def   = fs.adv.stats?.defense ?? 0
            const taken = Math.max(1, Math.floor(this._bossAtkScaled(boss) * SLAM_DMG_FRAC - def))
            fs.adv.resources.hp = Math.max(0, fs.adv.resources.hp - taken)
            this._emitFx({ kind: 'strike', x: fs.adv.worldX, y: fs.adv.worldY })
            if (this._roundLog) {
              this._roundLog.push({ side: 'boss', damage: taken, targetId: fs.adv.instanceId, kind: 'slam' })
            }

            // Death triggers the dying animation immediately so the slam
            // can finish the kill within its own beat.
            if (fs.adv.resources.hp <= 0) {
              fs.action      = 'dying'
              fs.actionT     = 0
              fs.actionDur   = 0.6
              fs.dyingKilled = false
              continue
            }

            // Skip knockback for advs already fleeing — they're under
            // AISystem control, yanking them around with velocity would
            // fight the AI's pathfinding.
            if (fs.adv.aiState === 'fleeing') continue

            // Survivors get knocked back.
            const nx = dx / d, ny = dy / d
            fs.vx = nx * KNOCKBACK_SPEED
            fs.vy = ny * KNOCKBACK_SPEED
            fs.action    = 'knockback'
            fs.actionT   = 0
            fs.actionDur = 0.5
            fs.strikeEmitted = false
          }
        }
        break
      }
      case 'recover':
        // Catch breath, no motion
        break
    }

    // Sprite separation — never let the boss occupy an adventurer's tile.
    // Boss + adv sprites are ~0.8 tiles wide each; 0.9 TS keeps a visible
    // gap.  Skip dying/fleeing advs (they're transitioning out anyway).
    const MIN_SEP   = 0.9 * TS
    const PUSH_RATE = 12 * TS   // tiles/sec — same cap as the adv side
    for (const fs of this._fightStates.values()) {
      // Apply the no-overlap invariant to fleeing advs too — the boss is
      // allowed to chase and attack them, but never to occupy their tile.
      if (fs.action === 'dying') continue
      const dx = boss.worldX - fs.adv.worldX
      const dy = boss.worldY - fs.adv.worldY
      const d  = Math.hypot(dx, dy)
      if (d > 0.01 && d < MIN_SEP) {
        const push = Math.min(MIN_SEP - d, PUSH_RATE * dt)
        boss.worldX += (dx / d) * push
        boss.worldY += (dy / d) * push
      } else if (d <= 0.01) {
        boss.worldX += Math.min(MIN_SEP, PUSH_RATE * dt)
      }
    }

    boss.worldX = clampX(boss.worldX)
    boss.worldY = clampY(boss.worldY)
    boss.tileX  = Math.floor(boss.worldX / TS)
    boss.tileY  = Math.floor(boss.worldY / TS)
  }

  _pickBossAction(bs) {
    // Big-move actions always cool down into recover.
    if (bs.action === 'slam' || bs.action === 'lunge') {
      bs.action    = 'recover'
      bs.actionT   = 0
      bs.actionDur = 0.4 + Math.random() * 0.2
      bs.slamFired = false
      bs.windUpEmitted = false
      return
    }
    bs.slamFired = false
    bs.windUpEmitted = false
    // Hold to chase during the prefight banner so slam/lunge damage doesn't
    // land before the player has even registered the fight has begun.
    if (!this._combatStarted) {
      bs.action    = 'chase'
      bs.actionT   = 0
      bs.actionDur = 0.5
      return
    }
    // Phase 5c — if the highest-aggro target is fleeing, force chase so the
    // boss actually pursues toward them rather than wasting a beat on a
    // stationary slam/lunge while they cross the room. Boss is still
    // clamped to the room boundary so it stops at the doorway.
    const fleeingTarget = this._highestAggroFightState()
    if (fleeingTarget && fleeingTarget.adv?.aiState === 'fleeing') {
      bs.action    = 'chase'
      bs.actionT   = 0
      bs.actionDur = 0.4 + Math.random() * 0.3
      bs.targetId  = fleeingTarget.adv.instanceId
      return
    }
    const partyCount = this._fightStates.size
    const slamChance = partyCount >= 2 ? 0.40 : 0.12
    const lungeChance = 0.35
    const r = Math.random()
    if (r < slamChance) {
      bs.action    = 'slam'
      bs.actionT   = 0
      bs.actionDur = 1.0   // wind-up + strike + recover within action
    } else if (r < slamChance + lungeChance) {
      // Aggro-weighted random pick so taunting/striking adventurers are
      // more likely to be charged.  Filters out dodge/flee/dying.
      // Fleeing advs are valid lunge targets — if they had high aggro
      // when they broke, the boss commits to chasing them down.
      const advs = [...this._fightStates.values()].filter(fs =>
        fs.action !== 'dying' && fs.action !== 'dodge'
      )
      let tgt = null
      if (advs.length > 0) {
        const weights = advs.map(fs => 1 + (fs.aggro ?? 0) / 8)
        let total = 0
        for (const w0 of weights) total += w0
        let pick = Math.random() * total
        for (let i = 0; i < advs.length; i++) {
          pick -= weights[i]
          if (pick <= 0) { tgt = advs[i]; break }
        }
        if (!tgt) tgt = advs[advs.length - 1]
      }
      bs.action    = 'lunge'
      bs.actionT   = 0
      bs.actionDur = 0.5 + Math.random() * 0.3
      bs.targetId  = tgt?.adv?.instanceId ?? null
    } else {
      bs.action    = 'chase'
      bs.actionT   = 0
      bs.actionDur = 0.5 + Math.random() * 0.4
    }
  }

  _tickFightAdv(fs, dt) {
    // Fleeing adventurers' positioning is owned by AISystem (path back to
    // entry).  We keep their fightState entry so round damage and slam AOE
    // can still hit them while they're in the room — but we don't run the
    // BossSystem action loop on them, otherwise the orbit lerp would fight
    // the AI's pathfinding step and cause jitter.
    if (fs.adv.aiState === 'fleeing') {
      // Defensive: keep tile coords in sync with world position, and if a
      // fleeing adv has somehow drifted onto a non-walkable tile (e.g. the
      // last orbit position straddled a wall when flee triggered), snap
      // them back to the boss-room centre so AISystem's pathfinder has a
      // valid origin for the route home.
      const TS_  = Balance.TILE_SIZE
      fs.adv.tileX = Math.floor(fs.adv.worldX / TS_)
      fs.adv.tileY = Math.floor(fs.adv.worldY / TS_)
      const grid = this._scene.dungeonGrid
      if (grid && this._bossRoom) {
        const t = grid.getTileType(fs.adv.tileX, fs.adv.tileY)
        const blocked = (
          t === TILE.WALL || t === TILE.BOSS_WALL || t === TILE.VOID
        )
        if (blocked) {
          const room = this._bossRoom
          const cx = room.gridX + Math.floor(room.width  / 2)
          const cy = room.gridY + Math.floor(room.height / 2)
          fs.adv.tileX  = cx
          fs.adv.tileY  = cy
          fs.adv.worldX = cx * TS_ + TS_ / 2
          fs.adv.worldY = cy * TS_ + TS_ / 2
          fs.adv.path   = null
        }
      }
      return
    }

    const TS   = Balance.TILE_SIZE
    const adv  = fs.adv
    const boss = this._gameState.boss
    // Phase 1b.3 — Beholder Petrify Gaze: while frozen, the adv is locked in
    // place and skips its action loop entirely. Aggro stays paused too.
    const _now = this._scene?.time?.now ?? 0
    if ((adv._petrifiedUntil ?? 0) > _now) return
    const { clampX, clampY } = this._roomClamp()
    fs.actionT += dt
    // Aggro decays exponentially (~30 % / sec) so taunts and recent strikes
    // both fade if the adventurer stops engaging.
    if (fs.aggro) fs.aggro *= Math.pow(0.7, dt)

    // Velocity-driven motion (knockback)
    if (fs.vx !== 0 || fs.vy !== 0) {
      adv.worldX += fs.vx * dt
      adv.worldY += fs.vy * dt
      const decay = Math.pow(0.05, dt)
      fs.vx *= decay
      fs.vy *= decay
      if (Math.abs(fs.vx) < 5 && Math.abs(fs.vy) < 5) { fs.vx = 0; fs.vy = 0 }
    }

    if (fs.actionT >= fs.actionDur) this._pickAdvAction(fs)

    // Boss sprite is ~26 px (≈0.8 tiles).  Keep adventurer sprite centres
    // at least ~1.0 tile out so silhouettes never overlap; strike pulses to
    // 0.9 tiles — close enough to read as melee, far enough to keep a
    // visible seam.  Ranged classes (mage, ranger, cleric) hold far back
    // at ~3 tiles and use 'cast' instead of 'strike'.
    //
    // All movement is speed-based (tiles per second) instead of frame-
    // fraction lerps so motion stays smooth regardless of distance — a
    // doorway → orbit-slot move travels at the configured speed instead
    // of jumping a huge fraction in one frame.
    const RANGE_RANGED = 3.0 * TS
    const stepToward = (tx, ty, speed) => {
      const dx = tx - adv.worldX
      const dy = ty - adv.worldY
      const d  = Math.hypot(dx, dy)
      if (d <= 0.01) return
      const step = Math.min(d, speed * dt)
      adv.worldX += (dx / d) * step
      adv.worldY += (dy / d) * step
    }
    switch (fs.action) {
      case 'approach': {
        // Initial walk from the boss-room doorway to the orbit slot.
        // Uses the adventurer's own movement speed (typically 1.4–2.4
        // tiles/sec from adventurerClasses.json) so they visibly run
        // to the boss instead of dash-warping in.  Terminates early
        // (forces _pickAdvAction next tick) once within ~0.1 tile of
        // the orbit slot — at which point the regular combat dance
        // (dash/strike/reposition/cast) takes over.
        const RANGE = fs.isRanged ? RANGE_RANGED : 1.05 * TS
        const tx = boss.worldX + Math.cos(fs.homeAngle) * RANGE
        const ty = boss.worldY + Math.sin(fs.homeAngle) * RANGE
        const walk = (adv.stats?.speed ?? 1.5) * TS
        stepToward(tx, ty, walk)
        const d = Math.hypot(tx - adv.worldX, ty - adv.worldY)
        if (d < 0.1 * TS) fs.actionT = fs.actionDur
        break
      }
      case 'dash': {
        const RANGE = 1.05 * TS
        stepToward(
          boss.worldX + Math.cos(fs.homeAngle) * RANGE,
          boss.worldY + Math.sin(fs.homeAngle) * RANGE,
          7 * TS,    // tiles/sec — fast charge into melee
        )
        break
      }
      case 'strike': {
        const p     = fs.actionT / fs.actionDur
        const swing = Math.sin(p * Math.PI)         // 0..1..0
        const RANGE_OUT = 1.20 * TS
        const RANGE_IN  = 0.90 * TS
        const r = RANGE_OUT - (RANGE_OUT - RANGE_IN) * swing
        stepToward(
          boss.worldX + Math.cos(fs.homeAngle) * r,
          boss.worldY + Math.sin(fs.homeAngle) * r,
          9 * TS,    // tiles/sec — sharp lunge that keeps up with the sin sweep
        )
        if (!fs.strikeEmitted && p > 0.4 && p < 0.65) {
          fs.strikeEmitted = true
          fs.aggro = (fs.aggro ?? 0) + 5
          const midR = (RANGE_IN + 0.4 * TS) * 0.5 + 0.4 * TS
          const ix = boss.worldX + Math.cos(fs.homeAngle) * midR
          const iy = boss.worldY + Math.sin(fs.homeAngle) * midR
          this._emitFx({ kind: 'strike', x: ix, y: iy })
        }
        break
      }
      case 'cast': {
        stepToward(
          boss.worldX + Math.cos(fs.homeAngle) * RANGE_RANGED,
          boss.worldY + Math.sin(fs.homeAngle) * RANGE_RANGED,
          3 * TS,    // tiles/sec — slow re-anchor to firing position
        )
        const p = fs.actionT / fs.actionDur
        if (!fs.strikeEmitted && p > 0.35 && p < 0.6) {
          fs.strikeEmitted = true
          fs.aggro = (fs.aggro ?? 0) + 3
          this._emitFx({
            kind:  'cast',
            x:     adv.worldX,  y:  adv.worldY,
            tx:    boss.worldX, ty: boss.worldY,
            color: fs.color,
          })
        }
        break
      }
      case 'reposition': {
        const RANGE = fs.isRanged ? RANGE_RANGED : 1.40 * TS
        stepToward(
          boss.worldX + Math.cos(fs.homeAngle) * RANGE,
          boss.worldY + Math.sin(fs.homeAngle) * RANGE,
          3.5 * TS,  // tiles/sec — gentle slide to new orbit angle
        )
        break
      }
      case 'knockback':
        // Pure velocity motion — nothing else to do
        break
      case 'taunt': {
        // Plant feet — emit a coloured shield-ring once at start, bump
        // aggro so the boss prefers this adventurer next chase/lunge.
        if (!fs.tauntEmitted) {
          fs.tauntEmitted = true
          fs.aggro = (fs.aggro ?? 0) + 30
          this._emitFx({ kind: 'taunt', x: adv.worldX, y: adv.worldY, color: fs.color })
        }
        break
      }
      case 'dodge': {
        // Quick lateral leap to clear the slam radius.  No clamp issues
        // because the dodge target was placed inside the room.
        const dx = (fs.dodgeTargetX ?? adv.worldX) - adv.worldX
        const dy = (fs.dodgeTargetY ?? adv.worldY) - adv.worldY
        const d  = Math.hypot(dx, dy)
        if (d > 4) {
          const speed = 14 * TS
          const step  = Math.min(d, speed * dt)
          adv.worldX += (dx / d) * step
          adv.worldY += (dy / d) * step
        }
        break
      }
      case 'dying': {
        // No motion — adventurer is collapsing in place.  After actionDur
        // expires, _killAdv is dispatched (see _pickAdvAction transition).
        break
      }
    }

    // Wall collision: clamp + impact stop. If a knockback was just clipped
    // by the wall, kill velocity and sparks a wall-hit FX.
    const px = adv.worldX, py = adv.worldY
    adv.worldX = clampX(adv.worldX)
    adv.worldY = clampY(adv.worldY)

    // Sync tile coords from world position so MinionAI's range/path checks
    // see the adv's live orbit position. AISystem skips AT_BOSS advs so
    // these wouldn't otherwise update for the duration of the fight.
    adv.tileX = Math.floor(adv.worldX / TS)
    adv.tileY = Math.floor(adv.worldY / TS)
    if (fs.action === 'knockback' && (adv.worldX !== px || adv.worldY !== py)) {
      if (Math.hypot(fs.vx, fs.vy) > 2 * TS) {
        this._emitFx({ kind: 'wall_hit', x: adv.worldX, y: adv.worldY })
      }
      fs.vx = 0
      fs.vy = 0
    }

    // Sprite separation from the boss — strike lerp can occasionally
    // land an adventurer inside the boss sprite.  Push them out so the
    // two sprites never visually overlap.  Per-frame push is capped at
    // PUSH_RATE × dt so a sudden boss lunge can't yank the adv across
    // the room in one frame; over multiple frames the gap recovers
    // smoothly.
    if (fs.action !== 'dying' && fs.action !== 'flee') {
      const sdx = adv.worldX - boss.worldX
      const sdy = adv.worldY - boss.worldY
      const sd  = Math.hypot(sdx, sdy)
      const MIN_SEP   = 0.9 * TS
      const PUSH_RATE = 12 * TS    // tiles/sec
      if (sd > 0.01 && sd < MIN_SEP) {
        const push = Math.min(MIN_SEP - sd, PUSH_RATE * dt)
        adv.worldX += (sdx / sd) * push
        adv.worldY += (sdy / sd) * push
      } else if (sd <= 0.01) {
        // Direct stack — nudge a tile in the homeAngle direction; next
        // frame the regular push smooths the rest.
        const nudge = Math.min(MIN_SEP, PUSH_RATE * dt)
        adv.worldX = boss.worldX + Math.cos(fs.homeAngle) * nudge
        adv.worldY = boss.worldY + Math.sin(fs.homeAngle) * nudge
      }
      adv.worldX = clampX(adv.worldX)
      adv.worldY = clampY(adv.worldY)
    }
  }

  _pickAdvAction(fs) {
    if (fs.action === 'flee') {
      // Don't switch out of flee — _tickFightAdv finalises it on exit.
      fs.actionDur = 999
      return
    }
    if (fs.action === 'dying') {
      // Collapse animation finished — actually kill.
      if (!fs.dyingKilled) {
        fs.dyingKilled = true
        this._killAdv(fs.adv, 'boss')
      }
      fs.actionDur = 999
      return
    }
    if (fs.action === 'knockback') {
      fs.action     = 'reposition'
      fs.actionT    = 0
      fs.actionDur  = 0.4 + Math.random() * 0.2
      fs.homeAngle += (Math.random() - 0.5) * 0.6
      return
    }
    fs.strikeEmitted = false

    // Personality-weighted action picker — each adventurer picks their next
    // action with weights tilted by aggressionLevel and riskTolerance, so
    // they desynchronize: aggressive types strike fast and often, cautious
    // types reposition longer, and knights occasionally taunt to soak boss
    // aggro for the rest of the party.
    const ps         = this._scene.personalitySystem
    const w          = ps?.getWeights?.(fs.adv) ?? {}
    const aggression = w.aggressionLevel ?? 0.5
    const risk       = w.riskTolerance   ?? 0.5

    if (fs.isRanged) {
      // Cast more often when aggressive; reposition more when cautious.
      const castW  = 0.55 + aggression * 0.25
      const r      = Math.random()
      if (r < castW) {
        fs.action    = 'cast'
        fs.actionT   = 0
        fs.actionDur = 0.30 + (1 - aggression) * 0.30 + Math.random() * 0.15
      } else {
        fs.action     = 'reposition'
        fs.actionT    = 0
        fs.actionDur  = 0.40 + (1 - risk) * 0.30 + Math.random() * 0.20
        fs.homeAngle += (Math.random() - 0.5) * Math.PI * 0.5
      }
      return
    }

    // Melee: tank-leaning classes (knight) get a small chance to taunt.
    const canTaunt = fs.adv.classId === 'knight'
    const tauntW   = canTaunt ? 0.12 : 0
    const strikeW  = 0.25 + aggression * 0.20
    const dashW    = 0.30 + (1 - aggression) * 0.10
    const reposW   = 0.20 + (1 - risk)       * 0.15
    const total    = tauntW + strikeW + dashW + reposW
    let pick = Math.random() * total

    if (tauntW > 0 && pick < tauntW) {
      fs.action       = 'taunt'
      fs.actionT      = 0
      fs.actionDur    = 0.50 + Math.random() * 0.20
      fs.tauntEmitted = false
      return
    }
    pick -= tauntW

    if (pick < strikeW) {
      fs.action    = 'strike'
      fs.actionT   = 0
      // Aggressive personalities strike sharper / faster.
      fs.actionDur = 0.20 + (1 - aggression) * 0.18 + Math.random() * 0.05
      return
    }
    pick -= strikeW

    if (pick < dashW) {
      fs.action    = 'dash'
      fs.actionT   = 0
      fs.actionDur = 0.25 + Math.random() * 0.20
      return
    }

    // Reposition (fallthrough).  Cautious adventurers linger longer.
    fs.action     = 'reposition'
    fs.actionT    = 0
    fs.actionDur  = 0.45 + (1 - risk) * 0.30 + Math.random() * 0.20
    fs.homeAngle += (Math.random() - 0.5) * Math.PI * 0.6
  }

  // ── Solo Leveling — bespoke Shadow Monarch duel ─────────────────────────
  // The standard fight has every invader ORBIT the boss. For the Monarch's
  // 1-on-1 that reads as a trash-mob skirmish; instead both fighters roam the
  // whole arena, converge for a clash, break apart, and re-engage from a new
  // angle — a moving battle. Movement/FX only; _runOneRound still owns damage.

  // Enter/exit duel mode each tick. Active only when the SOLE combatant is the
  // Shadow Monarch (his shadows never join the throne — strict 1:1) and the
  // boss isn't a multi-entity Slime King (whose centroid is slime-derived).
  _updateDuelMode() {
    const states = this._fightStates ? [...this._fightStates.values()] : []
    const sole   = states.length === 1 ? states[0] : null
    const boss   = this._gameState.boss
    const on = !!(sole && sole.adv && sole.adv._shadowMonarch && boss && !boss.slimes)
    if (on && !this._duel) this._duel = this._makeDuelState(sole, boss)
    if (!on) this._duel = null
    this._duelMode = on
  }

  _makeDuelState(fs, boss) {
    const D = {
      phase: 'square_off', t: 0, dur: 0.7,
      advAnchor:  { x: fs.adv.worldX, y: fs.adv.worldY },
      bossAnchor: { x: boss.worldX,   y: boss.worldY },
      clash:      { x: boss.worldX,   y: boss.worldY },
      clashAngle: Math.random() * Math.PI * 2,
      clashSpin:  (Math.random() < 0.5 ? 1 : -1),
      nextFxT:    0,
      blinkFired: false,
      // Phase beats (fire once each): boss enrage at half HP, Monarch power
      // surge at quarter HP. enrageMul speeds the dance up once enraged.
      bossEnraged: false,
      monarchSurged: false,
      enrageMul: 1,
      hpEmitT: 0,   // throttle for the live duel-HUD HP feed
      // Occasional in-fight bark cadence. First line lands ~4-7s in (after the
      // opening square-off) so the duel doesn't open on chatter; then every
      // ~6-9s. Lines come from the shadowMonarchFight pool via _monarchSay,
      // which routes through SHADOW_MONARCH_SAY → ChatBubbles (bypasses the
      // duel suppression gate that mutes his generic exploring chatter).
      nextSayT: 4 + Math.random() * 3,
    }
    this._pickDuelAnchors(D)
    return D
  }

  // Pick two anchor points on OPPOSITE sides of the room (through its centre
  // at a random axis), plus a jittered clash point — so successive clashes
  // wander across the whole chamber instead of always meeting at centre.
  _pickDuelAnchors(D) {
    const { clampX, clampY } = this._roomClamp()
    const minX = clampX(-1e9), maxX = clampX(1e9)
    const minY = clampY(-1e9), maxY = clampY(1e9)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    const halfX = (maxX - minX) / 2, halfY = (maxY - minY) / 2
    const th = Math.random() * Math.PI * 2
    const s  = 0.62
    D.advAnchor  = { x: clampX(cx + Math.cos(th) * halfX * s), y: clampY(cy + Math.sin(th) * halfY * s) }
    D.bossAnchor = { x: clampX(cx - Math.cos(th) * halfX * s), y: clampY(cy - Math.sin(th) * halfY * s) }
    D.clash      = { x: clampX(cx + (Math.random() - 0.5) * halfX * 0.7),
                     y: clampY(cy + (Math.random() - 0.5) * halfY * 0.7) }
  }

  _tickDuel(dt) {
    const TS   = Balance.TILE_SIZE
    const boss = this._gameState.boss
    const states = this._fightStates ? [...this._fightStates.values()] : []
    const fs   = states[0]
    if (!fs || !boss) return
    const adv  = fs.adv

    // Duel resolved → the win/loss OUTRO cutscene owns movement now.
    if (this._duelOutro) { this._tickDuelOutro(dt); return }

    const { clampX, clampY } = this._roomClamp()

    // Once a side is down (or the fight is resolving) freeze the dance so the
    // collapse + climax play out cleanly — _runOneRound/_endFight take over.
    const advDown  = (adv.resources?.hp ?? 0) <= 0 || fs.action === 'dying'
    const bossDown = (boss.hp ?? 0) <= 0
    if (this._fightEnded || advDown || bossDown) {
      adv.tileX  = Math.floor(adv.worldX  / TS); adv.tileY  = Math.floor(adv.worldY  / TS)
      boss.tileX = Math.floor(boss.worldX / TS); boss.tileY = Math.floor(boss.worldY / TS)
      return
    }

    const D = this._duel ?? (this._duel = this._makeDuelState(fs, boss))
    D.t += dt
    this._checkDuelBeats(D, adv, boss)

    // Occasional in-fight bark — a line that matches Jinwoo and the moment.
    // Routes through _monarchSay so it bypasses ChatBubbles' duel-suppression
    // gate (his generic exploring chatter is muted for the whole duel).
    D.nextSayT -= dt
    if (D.nextSayT <= 0) {
      D.nextSayT = 6 + Math.random() * 3
      this._monarchSay(adv, this._monarchLine('shadowMonarchFight', 'Too weak.'), 2800)
    }

    // Feed the live duel HUD (Monarch vs boss HP bars), throttled ~8/s — CSS
    // width transitions smooth the steps between the 0.6s damage rounds.
    D.hpEmitT += dt
    if (D.hpEmitT >= 0.12) {
      D.hpEmitT = 0
      const aMax = adv.resources?.maxHp ?? adv.resources?.hp ?? 1
      const bMax = boss.maxHp ?? boss.hp ?? 1
      EventBus.emit('SHADOW_MONARCH_DUEL_HP', {
        advFrac:  aMax > 0 ? Math.max(0, Math.min(1, (adv.resources?.hp ?? 0) / aMax)) : 0,
        bossFrac: bMax > 0 ? Math.max(0, Math.min(1, (boss.hp ?? 0) / bMax)) : 0,
      })
    }

    const moveTo = (e, tx, ty, speed) => {
      const dx = tx - e.worldX, dy = ty - e.worldY
      const d  = Math.hypot(dx, dy)
      if (d <= 0.01) return 0
      const step = Math.min(d, speed * dt)
      e.worldX = clampX(e.worldX + (dx / d) * step)
      e.worldY = clampY(e.worldY + (dy / d) * step)
      return d - step
    }
    const shake = (dur, mag) => this._scene.cameras?.main?.shake?.(dur, mag)

    switch (D.phase) {
      case 'square_off': {
        // Both stride to opposite anchors and face off.
        moveTo(adv,  D.advAnchor.x,  D.advAnchor.y,  Math.max(2.4, (adv.stats?.speed ?? 2)) * TS)
        moveTo(boss, D.bossAnchor.x, D.bossAnchor.y, 2.8 * TS)
        if (D.t >= D.dur) {
          // Sometimes the Monarch blinks straight onto the boss instead.
          if (Math.random() < 0.28) { D.phase = 'blink'; D.t = 0; D.dur = 0.42; D.blinkFired = false }
          else                      { D.phase = 'charge'; D.t = 0; D.dur = 0.6 }
        }
        break
      }
      case 'charge': {
        // Both dash toward the clash point from their corners.
        moveTo(adv,  D.clash.x, D.clash.y, 11 * TS)
        moveTo(boss, D.clash.x, D.clash.y, 7.5 * TS)
        this._emitFx({ kind: 'shadow_trail', x: adv.worldX, y: adv.worldY })
        if (Math.random() < 0.5) this._emitFx({ kind: 'lunge_trail', x: boss.worldX, y: boss.worldY })
        const between = Math.hypot(adv.worldX - boss.worldX, adv.worldY - boss.worldY)
        if (between < 1.15 * TS || D.t >= D.dur) {
          D.phase = 'clash'; D.t = 0; D.dur = 0.7 + Math.random() * 0.3
          D.clashAngle = Math.atan2(adv.worldY - boss.worldY, adv.worldX - boss.worldX)
          D.nextFxT = 0
          this._emitFx({ kind: 'monarch_burst', x: (adv.worldX + boss.worldX) / 2, y: (adv.worldY + boss.worldY) / 2 })
          shake(120, 0.004)
          this._hitstop(60, 0.2)   // punch of weight as they collide
          EventBus.emit('SHADOW_MONARCH_DUEL_CLASH')
        }
        break
      }
      case 'clash': {
        // Whirl around the clash point on opposite sides, trading blows.
        D.clashAngle += dt * 5.2 * D.clashSpin * (D.enrageMul ?? 1)
        const R  = 0.62 * TS
        moveTo(adv,  D.clash.x + Math.cos(D.clashAngle) * R, D.clash.y + Math.sin(D.clashAngle) * R, 9 * TS)
        moveTo(boss, D.clash.x - Math.cos(D.clashAngle) * R, D.clash.y - Math.sin(D.clashAngle) * R, 9 * TS)
        D.nextFxT -= dt
        if (D.nextFxT <= 0) {
          D.nextFxT = 0.11 + Math.random() * 0.06
          const mx = (adv.worldX + boss.worldX) / 2, my = (adv.worldY + boss.worldY) / 2
          if (Math.random() < 0.6) this._emitFx({ kind: 'shadow_slash', x: mx, y: my, ang: D.clashAngle })
          else                     this._emitFx({ kind: 'strike', x: adv.worldX, y: adv.worldY, color: 0xff5544 })
          shake(60, 0.0018)
        }
        if (D.t >= D.dur) {
          D.phase = 'breakaway'; D.t = 0; D.dur = 0.4
          this._pickDuelAnchors(D)
          this._emitFx({ kind: 'monarch_burst', x: D.clash.x, y: D.clash.y })
        }
        break
      }
      case 'breakaway': {
        // Both leap back to fresh opposite anchors, then re-square.
        moveTo(adv,  D.advAnchor.x,  D.advAnchor.y,  10 * TS)
        moveTo(boss, D.bossAnchor.x, D.bossAnchor.y, 8 * TS)
        if (D.t >= D.dur) { D.phase = 'square_off'; D.t = 0; D.dur = 0.35 }
        break
      }
      case 'blink': {
        if (!D.blinkFired && D.t > 0.12) {
          D.blinkFired = true
          this._emitFx({ kind: 'shadow_dash', x: adv.worldX, y: adv.worldY })   // vanish
          const ba = Math.random() * Math.PI * 2
          adv.worldX = clampX(boss.worldX + Math.cos(ba) * 0.7 * TS)
          adv.worldY = clampY(boss.worldY + Math.sin(ba) * 0.7 * TS)
          this._emitFx({ kind: 'shadow_dash', x: adv.worldX, y: adv.worldY })   // reappear
          this._emitFx({ kind: 'shadow_slash', x: (adv.worldX + boss.worldX) / 2, y: (adv.worldY + boss.worldY) / 2, ang: ba })
          shake(90, 0.003)
          EventBus.emit('SHADOW_MONARCH_BLINK')
        }
        if (D.t >= D.dur) {
          D.phase = 'clash'; D.t = 0; D.dur = 0.7
          D.clash = { x: boss.worldX, y: boss.worldY }
          D.clashAngle = Math.atan2(adv.worldY - boss.worldY, adv.worldX - boss.worldX)
          D.nextFxT = 0
        }
        break
      }
    }

    // Keep tile coords live so AI range checks / room queries read the duel
    // positions (AISystem skips AT_BOSS advs, so nothing else updates these).
    adv.tileX  = Math.floor(adv.worldX  / TS); adv.tileY  = Math.floor(adv.worldY  / TS)
    boss.tileX = Math.floor(boss.worldX / TS); boss.tileY = Math.floor(boss.worldY / TS)
  }

  _duelBossName() {
    const archId = this._gameState.player?.bossArchetypeId
    return (this._scene?.cache?.json?.get?.('bossArchetypes') ?? [])
      .find(a => a.id === archId)?.name ?? 'YOUR BOSS'
  }

  // Rising-arc phase beats — each fires exactly once. The boss ENRAGES at half
  // HP (red burst + harder dance); the Monarch POWER-SURGES at quarter HP (blue
  // burst + a battle-cry line, routed through ChatBubbles). Pure presentation —
  // emits SHADOW_MONARCH_DUEL_BEAT for the DOM pulse/label + chat line.
  _checkDuelBeats(D, adv, boss) {
    if (this._fightEnded) return
    const bMax = boss.maxHp ?? boss.hp ?? 1
    if (!D.bossEnraged && bMax > 0 && (boss.hp ?? 0) / bMax <= 0.5) {
      D.bossEnraged = true
      D.enrageMul   = 1.18
      this._emitFx({ kind: 'shockwave', x: boss.worldX, y: boss.worldY })
      this._scene.cameras?.main?.shake?.(260, 0.007)
      EventBus.emit('SHADOW_MONARCH_DUEL_BEAT', { kind: 'enrage', adventurer: adv, boss, bossName: this._duelBossName() })
    }
    const aMax = adv.resources?.maxHp ?? adv.resources?.hp ?? 1
    if (!D.monarchSurged && aMax > 0 && (adv.resources?.hp ?? 0) / aMax <= 0.25) {
      D.monarchSurged = true
      this._emitFx({ kind: 'monarch_burst', x: adv.worldX, y: adv.worldY })
      this._emitFx({ kind: 'monarch_burst', x: adv.worldX, y: adv.worldY })
      this._scene.cameras?.main?.shake?.(220, 0.006)
      EventBus.emit('SHADOW_MONARCH_DUEL_BEAT', { kind: 'surge', adventurer: adv, boss })
    }
  }

  // Brief global hitstop — freeze the action for a beat so a clash lands with
  // weight. No-op once the fight is resolving (the killing-blow slow-mo in
  // _endFight owns the clock then). Restores to 1 — the Game scene's rest
  // timeScale, same value _endFight restores to — and only if the fight is
  // still live when the window expires, so it can't cut short a kill slow-mo.
  _hitstop(ms = 60, scale = 0.2) {
    if (this._fightEnded) return
    const t = this._scene?.time
    if (!t) return
    t.timeScale = scale
    window.setTimeout(() => {
      if (this._scene?.time && !this._fightEnded) this._scene.time.timeScale = 1
    }, ms)
  }

  // Phase 5c — returns the fight-state with the highest aggro (or just the
  // first non-dying/dodging entry if no aggro is tracked yet). Used by
  // _pickBossAction to detect "the target I should be focused on is running."
  _highestAggroFightState() {
    let best = null, bestAggro = -Infinity
    for (const fs of this._fightStates.values()) {
      if (fs.action === 'dying' || fs.action === 'dodge') continue
      const a = fs.aggro ?? 0
      if (a > bestAggro) { bestAggro = a; best = fs }
    }
    return best
  }

  _roomClamp() {
    const TS   = Balance.TILE_SIZE
    const w    = Balance.WALL_THICKNESS
    const room = this._bossRoom
    const minX = (room.gridX + w) * TS + TS / 2
    const maxX = (room.gridX + room.width  - w - 1) * TS + TS / 2
    const minY = (room.gridY + w) * TS + TS / 2
    const maxY = (room.gridY + room.height - w - 1) * TS + TS / 2
    return {
      clampX: (x) => Math.max(minX, Math.min(maxX, x)),
      clampY: (y) => Math.max(minY, Math.min(maxY, y)),
    }
  }

  _emitFx(p) {
    p.t = 0
    if      (p.kind === 'strike')      p.dur = 0.35
    else if (p.kind === 'wind_up')     p.dur = 0.40
    else if (p.kind === 'shockwave')   p.dur = 0.50
    else if (p.kind === 'wall_hit')    p.dur = 0.25
    else if (p.kind === 'lunge_trail') p.dur = 0.30
    else if (p.kind === 'cast')        p.dur = 0.28
    else if (p.kind === 'dodge')       p.dur = 0.30
    else if (p.kind === 'taunt')       p.dur = 0.55
    // Solo Leveling — Shadow Monarch duel VFX (blue-black).
    else if (p.kind === 'shadow_trail')  p.dur = 0.30
    else if (p.kind === 'shadow_dash')   p.dur = 0.28
    else if (p.kind === 'shadow_slash')  p.dur = 0.30
    else if (p.kind === 'monarch_burst') p.dur = 0.50
    else                                p.dur = 0.20
    // Hard cap the particle pool. _tickFightFx redraws every live
    // particle (each is ~10 Graphics ops) once per sub-step — up to
    // 10× per frame at 8×. A guild-raid fight emits fast enough to
    // pile up hundreds of particles; capped at 64 the redraw cost
    // stays bounded. Oldest particle is dropped to make room.
    if (this._fxParticles.length >= 64) this._fxParticles.shift()
    this._fxParticles.push(p)

    // Tier 2 cinematic feedback — physical screen shake on heavy hits so
    // the boss room feels weighty. Shockwave (slam AOE) gives a moderate
    // shake; the killing-blow case lives in _endFight where we know the
    // boss actually died.
    if (p.kind === 'shockwave') {
      this._scene.cameras?.main?.shake?.(200, 0.005)
    } else if (p.kind === 'wall_hit') {
      this._scene.cameras?.main?.shake?.(120, 0.003)
    }
  }

  // Float a rising damage number from world (worldX, worldY). Each hit
  // in _runOneRound calls this so the player can see numerical feedback
  // for every swing instead of guessing from the HP bar movement.
  //   color : CSS color string for the number text
  //   crit  : true → bigger, longer-lived, exclamation-prefixed
  _floatDamage(worldX, worldY, value, opts = {}) {
    if (!this._scene?.add?.text) return
    if (!value || value <= 0) return
    // Concurrent-floater cap. Each call allocates a Phaser Text object,
    // and every Text is a separate canvas + GPU texture upload. A
    // guild-raid boss fight (DOUBLE the wave — 12-16 combatants) at 8×
    // speed resolves damage rounds fast enough to call this hundreds of
    // times per second; uncapped, that storm of texture allocations
    // thrashes the GPU/GC hard enough to hang the tab. 24 simultaneous
    // numbers reads fine and bounds the cost. Counter is decremented in
    // the rise-tween's onComplete (and reset per fight in _onIncoming
    // as a belt-and-braces guard against a leaked count).
    this._activeFloaters = this._activeFloaters ?? 0
    if (this._activeFloaters >= 24) return
    const isCrit   = !!opts.crit
    const color    = opts.color ?? '#ff7777'
    const fontSize = isCrit ? '18px' : '13px'
    const label    = `${isCrit ? '!' : ''}${Math.round(value)}`
    const jitterX  = (Math.random() - 0.5) * 14
    const t = this._scene.add.text(worldX + jitterX, worldY - 12, label, {
      fontFamily: 'monospace', fontSize, color,
      fontStyle:  isCrit ? 'bold' : 'normal',
      stroke:     '#000000',
      strokeThickness: isCrit ? 4 : 3,
    }).setOrigin(0.5, 1).setDepth(11)
    this._activeFloaters++
    // Pop-in scale tween — crits punch harder (start smaller + bigger
    // overshoot) so they read as distinct from regular hits. Origin
    // (0.5, 1) keeps the text's bottom edge pinned at worldY - 12 while
    // it scales upward (preserving the original vertical position).
    t.setScale(isCrit ? 0.4 : 0.55)
    this._scene.tweens.add({
      targets:  t,
      scale:    1,
      duration: isCrit ? 220 : 160,
      ease:     'Back.easeOut',
    })
    this._scene.tweens.add({
      targets:  t,
      y:        t.y - (isCrit ? 44 : 30),
      alpha:    0,
      duration: isCrit ? 950 : 720,
      ease:     'Cubic.easeOut',
      onComplete: () => {
        t.destroy()
        this._activeFloaters = Math.max(0, (this._activeFloaters ?? 1) - 1)
      },
    })
  }

  // Float a short text label from world (worldX, worldY) — sibling of
  // _floatDamage for non-numeric fight callouts ("ILLUSION", "SHE SPLITS").
  // Shares the 24-floater concurrency cap.
  _floatText(worldX, worldY, label, color = '#ffffff') {
    if (!this._scene?.add?.text) return
    this._activeFloaters = this._activeFloaters ?? 0
    if (this._activeFloaters >= 24) return
    const t = this._scene.add.text(worldX, worldY - 12, label, {
      fontFamily: 'monospace', fontSize: '12px', color,
      fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(11)
    this._activeFloaters++
    t.setScale(0.5)
    this._scene.tweens.add({ targets: t, scale: 1, duration: 170, ease: 'Back.easeOut' })
    this._scene.tweens.add({
      targets: t, y: t.y - 34, alpha: 0, duration: 800, ease: 'Cubic.easeOut',
      onComplete: () => {
        t.destroy()
        this._activeFloaters = Math.max(0, (this._activeFloaters ?? 1) - 1)
      },
    })
  }

  // ── SUCCUBUS: Doppelgänger (boss-fight second ability) ──────────────────
  //
  // The Queen hides among illusory duplicates. Each combat round the
  // party's pooled damage may land on a decoy (round negated, decoy
  // shatters) instead of the real Queen. She re-conjures decoys when her
  // HP crosses a phase threshold. State is per-fight (instance fields, not
  // persisted) — _onIncoming() calls _initDoppelganger() for every fight.

  _doppelActive() {
    return (Balance.SUCCUBUS_DOPPEL_ENABLED ?? true) &&
           this._gameState?.player?.bossArchetypeId === 'succubus'
  }

  // Decoys conjured per split — base + 1 per N boss levels, capped.
  _doppelDecoyCount() {
    const lvl  = this._gameState?.boss?.level ?? 1
    const base = Balance.SUCCUBUS_DOPPEL_BASE_DECOYS ?? 2
    const per  = Math.max(1, Balance.SUCCUBUS_DOPPEL_LEVELS_PER_DECOY ?? 3)
    const cap  = Balance.SUCCUBUS_DOPPEL_MAX_DECOYS ?? 4
    return Math.min(cap, base + Math.floor((lvl - 1) / per))
  }

  // Called from _onIncoming for every fight. Resets the per-fight state to
  // a safe baseline (0 decoys / no splits) for non-succubus bosses too.
  _initDoppelganger() {
    this._doppelDecoys     = 0
    this._doppelSplitsLeft = []
    if (!this._doppelActive()) return
    this._doppelDecoys     = this._doppelDecoyCount()
    this._doppelSplitsLeft = [...(Balance.SUCCUBUS_DOPPEL_SPLIT_THRESHOLDS ?? [0.75, 0.5, 0.25])]
    EventBus.emit('SUCCUBUS_DOPPEL_SPLIT', { decoys: this._doppelDecoys, reason: 'fight_start' })
  }

  // Round-start hook: re-conjure a fresh set of decoys for every phase
  // threshold the boss has dropped past since the last round.
  _tickDoppelgangerSplit(boss) {
    if (!this._doppelActive() || !boss) return
    if (!this._doppelSplitsLeft?.length) return
    const frac = (boss.hp ?? 0) / Math.max(1, boss.maxHp ?? 1)
    let split = false
    while (this._doppelSplitsLeft.length && frac <= this._doppelSplitsLeft[0]) {
      this._doppelSplitsLeft.shift()
      split = true
    }
    if (!split) return
    this._doppelDecoys = this._doppelDecoyCount()
    EventBus.emit('SUCCUBUS_DOPPEL_SPLIT', { decoys: this._doppelDecoys, reason: 'phase' })
    if (Number.isFinite(boss.worldX)) {
      for (let i = 0; i < 3; i++) {
        this._emitFx({
          kind: 'cast',
          x: boss.worldX + (Math.random() - 0.5) * 56,
          y: boss.worldY + (Math.random() - 0.5) * 36,
          color: 0xd24858,
        })
      }
      this._floatText(boss.worldX, boss.worldY - 26, 'SHE SPLITS', '#d24858')
    }
  }

  // Round damage intercept. Returns true when the party's pooled damage
  // this round is absorbed by a decoy (which then shatters).
  // ── SLIME KING: full visual Mitosis (multi-entity boss fight) ─────
  //
  // The slime boss fight tracks N independent slime entities in
  // boss.slimes[]. Each entry: { id, hp, maxHp, worldX, worldY,
  // generation, hasSplit }.
  //
  // Math: when a slime drops to 50% of its maxHp, it splits into 2
  // children each with maxHp = parent.maxHp / 4. (Conservation: parent
  // had maxHp/2 of HP left at split, children sum to that exactly.)
  // Slimes at `generation >= 2` don't split further — the lifetime cap
  // is 1 → 2 → 4 entities. `boss.hp` is mirrored each tick as the sum
  // of all alive slimes' hp, so the existing `boss.hp <= 0` death
  // check still triggers when every slime is down.
  //
  // Damage is distributed evenly across alive slimes each round.
  // Boss.attack and any boss-side combat math is unchanged — the boss
  // entity itself drives the fight-round state machine; the slimes are
  // a damage-and-visuals layer on top.

  // Called from _onIncoming when the fight starts. Wipes any leftover
  // slimes from a prior fight and seeds one gen-0 entity at the boss's
  // position with the full maxHp.
  _initSlimesForFight(boss) {
    if (!boss) return
    if (this._archIdForBoss() !== 'slime') {
      boss.slimes = null
      return
    }
    // Each slime tracks its OWN absolute worldX/Y and moves
    // independently (see _tickSlimes). boss.worldX/Y is recomputed each
    // frame as the centroid of all alive slimes so the existing boss
    // state machine + attack-range checks still operate against "where
    // the cluster is". When the cluster scatters (each slime chasing a
    // different adv), the centroid sits at their midpoint — the
    // pooled-damage code path is now bypassed for slime via the
    // per-attacker / per-slime targeting in _runOneRound.
    //
    // HP carry-over: the gen-0 slime spawns with boss.hp (the boss's
    // CURRENT health, not its max) so multi-fight days work like every
    // other archetype — damage taken in fight 1 carries over to fight 2.
    // maxHp stays at boss.maxHp so the split threshold (50% of maxHp)
    // still measures against the full pool. Caller (_onIncoming) is
    // responsible for ordering: refill at hp<=0 + Soul Drain heal +
    // any other HP mutation must happen BEFORE this runs.
    const wx = Number.isFinite(boss.worldX) ? boss.worldX : 0
    const wy = Number.isFinite(boss.worldY) ? boss.worldY : 0
    const startHp = Math.max(1, Math.min(boss.maxHp, boss.hp ?? boss.maxHp))
    boss.slimes = [{
      id:         `slime_${Date.now()}_g0`,
      hp:         startHp,
      maxHp:      boss.maxHp,
      worldX:     wx,
      worldY:     wy,
      generation: 0,
      hasSplit:   false,
    }]
    // Keep the mirror clean from the start.
    this._syncBossHpFromSlimes(boss)
  }

  // Per-slime independent movement — each alive slime drifts toward its
  // own nearest live adventurer at a per-generation speed (smaller
  // slimes scoot faster). Skipped while the boss state machine is in
  // the lunge/slam action because those have their own positioning
  // tweens at the cluster level.
  _tickSlimes(dt) {
    const boss = this._gameState.boss
    if (!boss || !Array.isArray(boss.slimes) || boss.slimes.length === 0) return
    const advs = [...this._fightStates.values()].filter(fs =>
      fs.action !== 'dying' && fs.action !== 'dodge' &&
      (fs.adv.resources?.hp ?? 0) > 0)
    if (advs.length === 0) return
    const TS = Balance.TILE_SIZE
    const { clampX, clampY } = this._roomClamp()
    for (const s of boss.slimes) {
      if ((s.hp ?? 0) <= 0) continue
      // Pick the nearest adv to THIS slime — each slime chooses its
      // own target so the cluster naturally scatters when there are
      // multiple advs in the chamber.
      let target = null, bestD = Infinity
      for (const fs of advs) {
        const d = Math.hypot(fs.adv.worldX - s.worldX, fs.adv.worldY - s.worldY)
        if (d < bestD) { bestD = d; target = fs }
      }
      if (!target) continue
      const dx = target.adv.worldX - s.worldX
      const dy = target.adv.worldY - s.worldY
      const d = Math.hypot(dx, dy) || 1
      // Slow approach speed scaled by generation — bigger blobs (gen 0)
      // lumber, small ones (gen 2) skitter.
      const baseSpeed = 0.9 * TS
      const genMul = 1 + (s.generation ?? 0) * 0.25
      const speed = baseSpeed * genMul
      s.worldX += (dx / d) * speed * dt
      s.worldY += (dy / d) * speed * dt
      // Keep slimes inside the chamber.
      s.worldX = clampX(s.worldX)
      s.worldY = clampY(s.worldY)
    }
    // Re-derive the boss centroid so the parent state machine + every
    // existing `boss.worldX/Y`-based read (slam radius, lunge target,
    // VFX anchors, sprite-separation guard) operate on the cluster's
    // current centre.
    this._syncBossPosFromSlimes(boss)
  }

  // Average worldX/Y of all alive slimes → boss.worldX/Y. Single-slime
  // case (gen 0 alive only) trivially equals that slime's position.
  _syncBossPosFromSlimes(boss) {
    if (!boss?.slimes?.length) return
    let n = 0, sx = 0, sy = 0
    for (const s of boss.slimes) {
      if ((s.hp ?? 0) <= 0) continue
      sx += s.worldX ?? 0
      sy += s.worldY ?? 0
      n++
    }
    if (n > 0) {
      boss.worldX = sx / n
      boss.worldY = sy / n
    }
  }

  // Damage application — single entry point so the existing combat code
  // can swap `boss.hp = ...` for a method call and stay agnostic about
  // whether multiple slimes exist. For non-slime archetypes this is a
  // 1-liner; for slime, distribute evenly across alive slimes, then
  // check each for split, then sync the mirror.
  //
  // Emits BOSS_DAMAGED with the actual HP delta on every successful
  // damage application — listeners (AchievementSystem's Flawless Reign
  // tracker, future damage-dealt VFX) rely on this single emit point.
  // We wrap the existing logic in a before/after hp snapshot so the
  // emit's `amount` reflects what actually landed (after clamps).
  // LEGENDARY · scaled boss attack — Wrath Unbound (up to +100% as HP falls)
  // and Sudden Death (5x). Routed through EVERY boss-damage path (melee, slam,
  // and the ability/AOE attacks) so the legendary scales all of them, not just
  // the basic swing.
  _bossAtkScaled(boss) {
    const f = this._gameState?._mechanicFlags ?? {}
    let atk = boss?.attack ?? 0
    if (f.wrathUnbound) {
      const missing = 1 - Math.max(0, Math.min(1, (boss?.hp ?? 0) / Math.max(1, boss?.maxHp ?? 1)))
      atk *= (1 + (Balance.MECHANIC_WRATH_MAX_ATK_BONUS ?? 1) * missing)
    }
    if (f.suddenDeath) atk *= (Balance.MECHANIC_SUDDEN_DEATH_DMG_MULT ?? 5)
    return atk
  }

  _applyDamageToBoss(boss, dmg) {
    // LEGENDARY pact modifiers on incoming boss damage:
    const lf  = this._gameState?._mechanicFlags ?? {}
    const now = this._scene?.time?.now ?? 0
    // Avatar of Ruin — invincible for the first N seconds of the fight.
    if (lf.avatarOfRuin && this._fightStartedAt != null &&
        (now - this._fightStartedAt) < (Balance.MECHANIC_AVATAR_INVULN_MS ?? 10000)) {
      return
    }
    if (lf.wrathUnbound) dmg = Math.round(dmg * (Balance.MECHANIC_WRATH_DMG_TAKEN_MULT ?? 1.5))
    if (lf.suddenDeath)  dmg = Math.round(dmg * (Balance.MECHANIC_SUDDEN_DEATH_DMG_MULT ?? 5))
    const hpBefore = boss?.hp ?? 0
    if (this._archIdForBoss() === 'slime' && Array.isArray(boss.slimes) && boss.slimes.length > 0) {
      const alive = boss.slimes.filter(s => (s.hp ?? 0) > 0)
      if (alive.length === 0) {
        boss.hp = 0
      } else {
        // Distribute evenly. Round up so every slime takes at least 1 hp
        // per round when dmg < count (otherwise some rounds could deal 0
        // to particular slimes and the fight would drag).
        const per = Math.max(1, Math.ceil(dmg / alive.length))
        for (const s of alive) {
          s.hp = Math.max(0, (s.hp ?? 0) - per)
        }
        // Splits checked on a snapshot of `alive` — the array is mutated
        // by splits (parent removed, children added), so iterating the
        // post-mutation slimes would risk re-checking just-spawned children
        // on the same round and infinite-recursing.
        for (const s of alive) {
          this._maybeSplitSlime(s)
        }
        this._syncBossHpFromSlimes(boss)
      }
    } else {
      boss.hp = Math.max(0, (boss.hp ?? 0) - dmg)
    }
    const hpAfter = boss?.hp ?? 0
    const taken = Math.max(0, hpBefore - hpAfter)
    if (taken > 0) {
      EventBus.emit('BOSS_DAMAGED', { amount: taken, hpBefore, hpAfter, source: 'combat' })
    }
  }

  // Per-slime split gate. Generation 2 slimes are the cap — they die
  // normally. hasSplit guards against double-splitting on chained damage.
  _maybeSplitSlime(slime) {
    if (!slime || slime.hasSplit) return
    if ((slime.generation ?? 0) >= 2) return
    if ((slime.hp ?? 0) <= 0) return
    if ((slime.hp ?? 0) > (slime.maxHp ?? 1) * 0.5) return
    this._performSlimeSplit(slime)
  }

  // Replace `parent` in boss.slimes with 2 children. Children spawn at
  // parent's position with a small left/right offset so the visual reads
  // as a divide rather than a stack. Children's maxHp = parent.maxHp / 4
  // (parent's HP-at-split was maxHp/2; conserve total).
  _performSlimeSplit(parent) {
    const boss = this._gameState?.boss
    if (!boss?.slimes) return
    parent.hasSplit = true
    const idx = boss.slimes.indexOf(parent)
    if (idx < 0) return
    boss.slimes.splice(idx, 1)
    const childMaxHp = Math.max(1, Math.floor((parent.maxHp ?? 0) / 4))
    const OFFSET_PX = 26
    const childGen = (parent.generation ?? 0) + 1
    const parentX = parent.worldX ?? 0
    const parentY = parent.worldY ?? 0
    const created = []
    for (let i = 0; i < 2; i++) {
      const sign = (i === 0 ? -1 : 1)
      const child = {
        id:         `slime_${Date.now()}_g${childGen}_${i}_${Math.random().toString(36).slice(2, 5)}`,
        hp:         childMaxHp,
        maxHp:      childMaxHp,
        worldX:     parentX + sign * OFFSET_PX,
        worldY:     parentY,
        generation: childGen,
        hasSplit:   false,
      }
      boss.slimes.push(child)
      created.push(child)
    }
    EventBus.emit('SLIME_MITOSIS_SPLIT', {
      parentId:    parent.id,
      generation:  childGen,
      children:    created.map(c => ({ id: c.id, hp: c.hp, maxHp: c.maxHp })),
    })
    AbilityVfx.particleBurst(this._scene, parentX, parentY, {
      color: 0x55cc77, count: 22, durationMs: 700, speed: 95, depth: 60,
    })
    AbilityVfx.pulseRing(this._scene, parentX, parentY, {
      color: 0x55cc77, fromR: 8, toR: 64, alpha: 0.9, durationMs: 600, depth: 59,
    })
    this._floatText(parentX, parentY - 16, 'SPLIT!', '#aaffbb')
    for (const c of created) {
      AbilityVfx.particleBurst(this._scene, c.worldX, c.worldY, {
        color: 0x88ee99, count: 10, durationMs: 500, speed: 60, depth: 58,
      })
      AbilityVfx.pulseRing(this._scene, c.worldX, c.worldY, {
        color: 0x88ee99, fromR: 4, toR: 28, alpha: 0.85, durationMs: 450, depth: 57,
      })
    }
  }

  // Mirror boss.hp = sum of alive slime hps. Lets every existing
  // `boss.hp <= 0` check (in this file and the DOM HP-bar overlay)
  // keep working unchanged — when every slime is at 0, sum is 0,
  // _runOneRound's death check fires _endFight('party').
  _syncBossHpFromSlimes(boss) {
    if (!boss?.slimes) return
    let total = 0
    for (const s of boss.slimes) total += Math.max(0, s.hp ?? 0)
    boss.hp = total
  }

  _tryDoppelgangerAbsorb() {
    if (!this._doppelActive()) return false
    const D = this._doppelDecoys ?? 0
    if (D <= 0) return false
    // D decoys + 1 real Queen → D/(D+1) chance the swing finds an illusion.
    if (Math.random() >= D / (D + 1)) return false
    this._doppelDecoys = D - 1
    const boss = this._gameState?.boss
    if (boss && Number.isFinite(boss.worldX)) {
      this._emitFx({
        kind: 'wall_hit',
        x: boss.worldX + (Math.random() - 0.5) * 44,
        y: boss.worldY + (Math.random() - 0.5) * 20,
        color: 0xd24858,
      })
      this._floatText(boss.worldX, boss.worldY - 12, 'ILLUSION', '#e88aa0')
    }
    EventBus.emit('SUCCUBUS_DOPPEL_SHATTER', { decoysLeft: this._doppelDecoys })
    return true
  }

  _tickFightFx(dt) {
    const g = this._fxGraphics
    if (!g) return
    g.clear()
    const TS = Balance.TILE_SIZE
    for (const p of this._fxParticles) {
      p.t += dt
      const phase = p.t / p.dur
      if (phase >= 1) continue
      const alpha = 1 - phase

      switch (p.kind) {
        case 'strike': {
          // Bright multi-layer impact: white core, colored ring, and a
          // 4-spike cross flash. Color biases slightly red→yellow over
          // the lifetime so the spark feels like it's cooling off.
          const tintColor = p.color ?? 0xffe066
          const r  = 5 + phase * 14
          g.fillStyle(0xffffff, alpha * 0.95)
          g.fillCircle(p.x, p.y, r * 0.55)
          g.fillStyle(tintColor, alpha * 0.85)
          g.fillCircle(p.x, p.y, r)
          g.lineStyle(2, 0xffffff, alpha * 0.9)
          g.strokeCircle(p.x, p.y, r * 1.4)
          // Cross/star spikes — 4 thin lines radiating out, lengthening
          // as the spark expands. Gives the burst a "hit" punch instead
          // of a bland circle.
          const spikeLen = r * 2.2
          g.lineStyle(2, 0xffffff, alpha)
          for (let i = 0; i < 4; i++) {
            const a  = (Math.PI / 2) * i + Math.PI / 4
            const x2 = p.x + Math.cos(a) * spikeLen
            const y2 = p.y + Math.sin(a) * spikeLen
            g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(x2, y2); g.strokePath()
          }
          break
        }
        case 'wind_up': {
          // Big red telegraph: filled translucent disc + bold contracting
          // ring. Reads at a glance as "DANGER ZONE — slam incoming." The
          // disc fades faster than the ring so the ring is the last
          // visible warning before the slam fires.
          const baseR = 2.3 * TS
          const r     = (baseR) * (1 - phase * 0.4)
          g.fillStyle(0xff2211, alpha * 0.22)
          g.fillCircle(p.x, p.y, r)
          g.lineStyle(4, 0xff3322, alpha)
          g.strokeCircle(p.x, p.y, r)
          g.lineStyle(2, 0xffaa66, alpha * 0.7)
          g.strokeCircle(p.x, p.y, r * 0.6)
          break
        }
        case 'shockwave': {
          // Two expanding rings — outer red, inner orange
          const r = 0.5 * TS + phase * 2.5 * TS
          g.lineStyle(4, 0xff4422, alpha)
          g.strokeCircle(p.x, p.y, r)
          g.lineStyle(2, 0xffaa44, alpha * 0.6)
          g.strokeCircle(p.x, p.y, r * 0.65)
          break
        }
        case 'wall_hit': {
          // Yellow-white spark with radial spikes
          const r = 4 + phase * 6
          g.fillStyle(0xfff8cc, alpha)
          g.fillCircle(p.x, p.y, r)
          g.lineStyle(2, 0xffffff, alpha)
          for (let i = 0; i < 4; i++) {
            const a  = (Math.PI * 2 * i) / 4 + phase * 0.6
            const x2 = p.x + Math.cos(a) * r * 1.6
            const y2 = p.y + Math.sin(a) * r * 1.6
            g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(x2, y2); g.strokePath()
          }
          break
        }
        case 'lunge_trail': {
          g.fillStyle(0xaa44ff, alpha * 0.5)
          g.fillCircle(p.x, p.y, 5)
          break
        }
        case 'dodge': {
          // Quick directional puff at the dodge origin — small white
          // arcs trailing the leap.
          const r = 6 + phase * 4
          g.lineStyle(2, 0xddeeff, alpha * 0.8)
          g.strokeCircle(p.x, p.y, r)
          g.fillStyle(0xffffff, alpha * 0.4)
          g.fillCircle(p.x, p.y, r * 0.5)
          break
        }
        case 'taunt': {
          // Defensive ring around the taunting adventurer in their class
          // colour — pulses outward and fades.
          const color = p.color ?? 0xffaa44
          const r = 10 + phase * 14
          g.lineStyle(3, color, alpha * 0.85)
          g.strokeCircle(p.x, p.y, r)
          g.lineStyle(2, 0xffffff, alpha * 0.5)
          g.strokeCircle(p.x, p.y, r * 0.6)
          break
        }
        case 'cast': {
          // Class-coloured beam from caster to boss with a bright spark at
          // the impact end.  Beam thins as it fades.
          const color = p.color ?? 0xaaaaff
          const w = Math.max(1, Math.round(4 * alpha))
          g.lineStyle(w, color, alpha)
          g.beginPath()
          g.moveTo(p.x, p.y)
          g.lineTo(p.tx, p.ty)
          g.strokePath()
          // Impact spark
          g.fillStyle(color, alpha)
          g.fillCircle(p.tx, p.ty, 3 + phase * 5)
          g.lineStyle(2, 0xffffff, alpha * 0.7)
          g.strokeCircle(p.tx, p.ty, 5 + phase * 5)
          break
        }
        case 'shadow_trail': {
          // Faint blue after-image dot left by a charging/dashing Monarch.
          g.fillStyle(0x4aa0ff, alpha * 0.55)
          g.fillCircle(p.x, p.y, 5)
          g.fillStyle(0xbfe3ff, alpha * 0.45)
          g.fillCircle(p.x, p.y, 2.5)
          break
        }
        case 'shadow_dash': {
          // Vertical blue after-image streak marking a shadow-blink endpoint.
          const hgt = 26 + phase * 12
          g.lineStyle(3, 0x4aa0ff, alpha * 0.85)
          for (let i = -1; i <= 1; i++) {
            g.beginPath()
            g.moveTo(p.x + i * 4, p.y - hgt * 0.6)
            g.lineTo(p.x + i * 4, p.y + hgt * 0.4)
            g.strokePath()
          }
          g.fillStyle(0xffffff, alpha * 0.6)
          g.fillCircle(p.x, p.y, 3)
          break
        }
        case 'shadow_slash': {
          // Bright blue crescent arc swung along the clash angle.
          const ang = p.ang ?? 0
          const r   = 10 + phase * 16
          g.lineStyle(7, 0x4aa0ff, alpha * 0.6)
          g.beginPath(); g.arc(p.x, p.y, r * 0.92, ang - 0.8, ang + 0.8); g.strokePath()
          g.lineStyle(4, 0xffffff, alpha * 0.9)
          g.beginPath(); g.arc(p.x, p.y, r, ang - 0.9, ang + 0.9); g.strokePath()
          break
        }
        case 'monarch_burst': {
          // Blue shockwave ring — clash impact / breakaway burst.
          const r = 0.4 * TS + phase * 2.2 * TS
          g.lineStyle(4, 0x6ab8ff, alpha)
          g.strokeCircle(p.x, p.y, r)
          g.lineStyle(2, 0xdff0ff, alpha * 0.6)
          g.strokeCircle(p.x, p.y, r * 0.6)
          break
        }
      }
    }
    // Drop dead particles
    this._fxParticles = this._fxParticles.filter(p => p.t < p.dur)
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  _wire() {
    const onIncoming = (payload) => this._onIncoming(payload)
    // Clear death-pose freeze ONLY on NIGHT_PHASE_STARTED — the boss
    // stays visibly dead in the chamber for the rest of the day after
    // a life is lost. Releasing the pose on BOSS_FIGHT_INCOMING used to
    // be intentional (it let a same-day second party trigger a second
    // fight, costing another life), but that was the multi-life-per-day
    // bug — _onIncoming now refuses any post-death fight via the
    // `_diedThisDay` gate, so there's nothing for the pose to make way
    // for. Kept the BOSS_FIGHT_INCOMING binding off entirely.
    const onClearPose = () => {
      this._deathPoseUntil = 0
      // Day boundary also re-arms the per-day life-loss gate so the
      // boss can fight (and potentially lose another life) the next day.
      const b = this._gameState?.boss
      if (b) b._diedThisDay = false
    }
    // Tier 3 — blood decals get cleared at night so they don't bleed
    // (heh) into the next day's build phase.
    const onClearDecals = () => { this._decalsG?.clear?.() }
    // Stamp a blood splatter wherever an adventurer dies during a boss
    // fight. Outside fights this is a no-op.
    const onAdvDied = ({ adventurer }) => {
      if (!this._fighting || this._fightEnded) return
      if (!adventurer || !this._decalsG) return
      this._stampBloodDecal(adventurer.worldX, adventurer.worldY)
    }
    // BOSS_FIGHT_INCOMING used to also clear the death pose so a
    // second adv party could trigger a fresh fight the same day — that
    // was the bug. Removed; _onIncoming now bails on `_diedThisDay`
    // before any pose check would matter. Death pose only releases on
    // NIGHT_PHASE_STARTED, alongside the per-day life-loss gate reset.
    // Recompute boss stats on every level-up so the top-bar HP +
    // BossOverviewOverlay numbers reflect the new power immediately.
    // _init handles the save-load / mango-cheat case; _onIncoming
    // handles fight start. Since scaling is purely level-based now,
    // we don't need to refresh on day boundary.
    const onLeveledUp = () => this._recomputeBossFightStats()
    EventBus.on('BOSS_FIGHT_INCOMING',    onIncoming)
    EventBus.on('NIGHT_PHASE_STARTED',    onClearPose)
    EventBus.on('NIGHT_PHASE_STARTED',    onClearDecals)
    EventBus.on('ADVENTURER_DIED',        onAdvDied)
    EventBus.on('BOSS_LEVELED_UP',        onLeveledUp)
    // Damned pacts (Hollow Crown / Bleeding Crown) mutate boss-HP via flags
    // read in _recomputeBossFightStats; this lets them force an immediate
    // recompute so the top-bar reflects the curse without waiting for a fight.
    EventBus.on('BOSS_STATS_DIRTY',       onLeveledUp)
    this._listeners = [
      ['BOSS_FIGHT_INCOMING',    onIncoming],
      ['NIGHT_PHASE_STARTED',    onClearPose],
      ['NIGHT_PHASE_STARTED',    onClearDecals],
      ['ADVENTURER_DIED',        onAdvDied],
      ['BOSS_LEVELED_UP',        onLeveledUp],
      ['BOSS_STATS_DIRTY',       onLeveledUp],
    ]
  }

  // Stamp a small blood splatter at (worldX, worldY) onto the persistent
  // decals graphics layer. A few overlapping irregular blobs in dark red
  // give it a hand-painted feel without needing an actual texture.
  _stampBloodDecal(worldX, worldY) {
    const g = this._decalsG
    if (!g) return
    // Three jittered blobs — main pool + two splatter droplets.
    g.fillStyle(0x6a0a08, 0.85)
    g.fillCircle(worldX, worldY + 4, 6 + Math.random() * 2)
    g.fillStyle(0x8a1410, 0.7)
    g.fillCircle(worldX - 5 + Math.random() * 10, worldY + 6, 3 + Math.random() * 2)
    g.fillCircle(worldX + 4 + Math.random() * 6, worldY + 2, 2 + Math.random() * 2)
  }

  // ── Public API ───────────────────────────────────────────────────────────

  isFinalDeath() { return (this._gameState.boss?.deathsRemaining ?? 0) <= 0 }

  // Cheap accessor for the active boss archetype id — used by
  // archetype-specific fight branches (e.g. Slime King Mitosis).
  _archIdForBoss() { return this._gameState?.player?.bossArchetypeId ?? null }

  // Phase 9 — Batch G boss-attack-pact dispatcher. Called once per fight
  // round before the regular party/boss exchange. Each branch handles its
  // own cooldown via boss._<id>ReadyAt timestamps.
  _runBossPactAttacks(boss, defenders) {
    const flags = this._gameState._mechanicFlags ?? {}
    // Inquisition pact-BENEFIT purge (KR): the boss's pact-granted special
    // attacks are all dungeon upside, so while an inquisitor is in the dungeon
    // they all go dark (cooldowns simply don't advance until it leaves).
    if (flags._inqSuppress) return
    const now = this._scene?.time?.now ?? 0

    // ── Hellfire Breath ──
    if (flags.hellfireBreath) {
      if (boss._hellfireWindupUntil && now >= boss._hellfireWindupUntil) {
        // Windup complete — torch up to N front-most defenders.
        const targets = [...defenders]
          .sort((a, b) => Math.hypot(a.adv.worldX - boss.worldX, a.adv.worldY - boss.worldY) - Math.hypot(b.adv.worldX - boss.worldX, b.adv.worldY - boss.worldY))
          .slice(0, Balance.MECHANIC_HELLFIRE_TARGETS)
        const dmg = Math.max(1, Math.floor(this._bossAtkScaled(boss) * Balance.MECHANIC_HELLFIRE_DMG_MULT))
        for (const fs of targets) {
          fs.adv.resources.hp = Math.max(0, fs.adv.resources.hp - dmg)
        }
        boss._hellfireWindupUntil = null
        boss._hellfireReadyAt = now + Balance.MECHANIC_HELLFIRE_COOLDOWN_MS
        EventBus.emit('PACT_BOSS_HELLFIRE_FIRED', { x: boss.worldX, y: boss.worldY, targetIds: targets.map(t => t.adv.instanceId), damage: dmg })
      } else if (!boss._hellfireWindupUntil && (boss._hellfireReadyAt ?? 0) <= now) {
        boss._hellfireWindupUntil = now + Balance.MECHANIC_HELLFIRE_WINDUP_MS
        EventBus.emit('PACT_BOSS_HELLFIRE_WINDUP', { x: boss.worldX, y: boss.worldY, durationMs: Balance.MECHANIC_HELLFIRE_WINDUP_MS })
      }
    }

    // ── Lightning Strike ──
    if (flags.lightningStrike && (boss._lightningReadyAt ?? 0) <= now) {
      // Target the adv with highest damage dealt this fight (fallback: highest atk).
      let target = null, bestScore = -1
      for (const fs of defenders) {
        const score = (fs.dmgDealtThisFight ?? 0) + (fs.adv.stats?.attack ?? 0) * 0.5
        if (score > bestScore) { bestScore = score; target = fs }
      }
      if (target) {
        const dmg = Math.max(1, Math.floor(this._bossAtkScaled(boss) * Balance.MECHANIC_LIGHTNING_DMG_MULT))
        target.adv.resources.hp = Math.max(0, target.adv.resources.hp - dmg)
        const cost = Math.max(1, Math.floor((boss.maxHp ?? 0) * Balance.MECHANIC_LIGHTNING_BOSS_HP_COST_FRAC))
        boss.hp = Math.max(0, (boss.hp ?? 0) - cost)
        boss._lightningReadyAt = now + Balance.MECHANIC_LIGHTNING_COOLDOWN_MS
        EventBus.emit('PACT_BOSS_LIGHTNING_FIRED', { x: target.adv.worldX, y: target.adv.worldY, targetId: target.adv.instanceId, damage: dmg, selfCost: cost })
      }
    }

    // ── Shockwave Slam ──
    if (flags.shockwaveSlam && (boss._shockwaveReadyAt ?? 0) <= now && (boss._shockwaveStunUntil ?? 0) <= now) {
      const dmg = Math.max(1, Math.floor(this._bossAtkScaled(boss) * Balance.MECHANIC_SHOCKWAVE_DMG_MULT))
      for (const fs of defenders) {
        fs.adv.resources.hp = Math.max(0, fs.adv.resources.hp - dmg)
      }
      boss._shockwaveReadyAt = now + Balance.MECHANIC_SHOCKWAVE_COOLDOWN_MS
      boss._shockwaveStunUntil = now + Balance.MECHANIC_SHOCKWAVE_STUN_MS
      EventBus.emit('PACT_BOSS_SHOCKWAVE_FIRED', { x: boss.worldX, y: boss.worldY, damage: dmg, targets: defenders.map(d => d.adv.instanceId) })
    }

    // ── Spectral Reach ──
    if (flags.spectralReach && (boss._spectralReadyAt ?? 0) <= now) {
      let nearest = null, bestD = Infinity
      for (const fs of defenders) {
        const d = Math.hypot(fs.adv.worldX - boss.worldX, fs.adv.worldY - boss.worldY)
        if (d < bestD) { bestD = d; nearest = fs }
      }
      if (nearest) {
        boss.worldX = nearest.adv.worldX - Balance.TILE_SIZE
        boss.worldY = nearest.adv.worldY
        const dmg = Math.max(1, Math.floor(this._bossAtkScaled(boss) * Balance.MECHANIC_SPECTRAL_REACH_DMG_MULT))
        nearest.adv.resources.hp = Math.max(0, nearest.adv.resources.hp - dmg)
        boss._spectralReadyAt = now + Balance.MECHANIC_SPECTRAL_REACH_COOLDOWN_MS
        EventBus.emit('PACT_BOSS_SPECTRAL_FIRED', { x: boss.worldX, y: boss.worldY, targetId: nearest.adv.instanceId, damage: dmg })
      }
    }

    // ── Dark Vortex ──
    if (flags.darkVortex && (boss._vortexReadyAt ?? 0) <= now) {
      const pull = Balance.MECHANIC_DARK_VORTEX_PULL_TILES * Balance.TILE_SIZE
      for (const fs of defenders) {
        const dx = boss.worldX - fs.adv.worldX
        const dy = boss.worldY - fs.adv.worldY
        const d  = Math.hypot(dx, dy) || 1
        fs.adv.worldX += (dx / d) * pull
        fs.adv.worldY += (dy / d) * pull
      }
      // Also pull boss-room minions (tradeoff).
      const bossRoom = this._gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
      for (const m of (this._gameState.minions ?? [])) {
        if (m.faction !== 'dungeon' || m.aiState === 'dead') continue
        if (!bossRoom || m.assignedRoomId !== bossRoom.instanceId) continue
        const dx = boss.worldX - m.worldX, dy = boss.worldY - m.worldY
        const d  = Math.hypot(dx, dy) || 1
        m.worldX += (dx / d) * pull
        m.worldY += (dy / d) * pull
      }
      boss._vortexReadyAt = now + Balance.MECHANIC_DARK_VORTEX_COOLDOWN_MS
      EventBus.emit('PACT_BOSS_VORTEX_FIRED', { x: boss.worldX, y: boss.worldY })
    }

    // ── Soul Drain ──
    if (flags.soulDrain) {
      if (boss._soulDrainChannelUntil && now < boss._soulDrainChannelUntil) {
        // Mid-channel — apply ONE damage/heal tick per TICK_MS. This block
        // runs every frame, so without the interval gate the drain landed
        // ~60 hits/second instead of the ~3 the DMG mult is scaled for.
        if ((boss._soulDrainNextTick ?? 0) <= now) {
          boss._soulDrainNextTick = now + Balance.MECHANIC_SOUL_DRAIN_TICK_MS
          const target = defenders.find(fs => fs.adv.instanceId === boss._soulDrainTargetId)
          if (target) {
            const dmg = Math.max(1, Math.floor(this._bossAtkScaled(boss) * Balance.MECHANIC_SOUL_DRAIN_DMG_MULT * 0.34))
            target.adv.resources.hp = Math.max(0, target.adv.resources.hp - dmg)
            const heal = Math.floor(dmg * Balance.MECHANIC_SOUL_DRAIN_HEAL_FRAC)
            boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + heal)
          }
        }
      } else if (boss._soulDrainChannelUntil && now >= boss._soulDrainChannelUntil) {
        boss._soulDrainChannelUntil = null
        boss._soulDrainTargetId = null
        boss._soulDrainNextTick = 0
        boss._soulDrainReadyAt = now + Balance.MECHANIC_SOUL_DRAIN_COOLDOWN_MS
        EventBus.emit('PACT_BOSS_SOULDRAIN_ENDED', {})
      } else if ((boss._soulDrainReadyAt ?? 0) <= now && defenders.length > 0) {
        const target = defenders[Math.floor(Math.random() * defenders.length)]
        boss._soulDrainTargetId = target.adv.instanceId
        boss._soulDrainChannelUntil = now + Balance.MECHANIC_SOUL_DRAIN_CHANNEL_MS
        boss._soulDrainNextTick = now   // first tick fires immediately
        EventBus.emit('PACT_BOSS_SOULDRAIN_BEGUN', { targetId: target.adv.instanceId })
      }
    }

    // ── Doppelgangers ──
    if (flags.doppelgangers && (boss._doppelReadyAt ?? 0) <= now) {
      boss._doppelActiveUntil = now + Balance.MECHANIC_DOPPELGANGERS_DURATION_MS
      boss._doppelReadyAt = now + Balance.MECHANIC_DOPPELGANGERS_COOLDOWN_MS
      EventBus.emit('PACT_BOSS_DOPPELGANGERS_SPAWNED', { x: boss.worldX, y: boss.worldY, durationMs: Balance.MECHANIC_DOPPELGANGERS_DURATION_MS })
    }

    // ── Petrifying Stare ──
    if (flags.petrifyingStare && (boss._petrifyReadyAt ?? 0) <= now && defenders.length > 0) {
      if (Math.random() < Balance.MECHANIC_PETRIFY_BACKFIRE_CHANCE) {
        boss._petrifyBackfireUntil = now + Balance.MECHANIC_PETRIFY_BACKFIRE_STUN_MS
        EventBus.emit('PACT_BOSS_PETRIFY_BACKFIRE', { stunMs: Balance.MECHANIC_PETRIFY_BACKFIRE_STUN_MS })
      } else {
        const victim = defenders[Math.floor(Math.random() * defenders.length)]
        victim.adv._petrifiedUntil = now + Balance.MECHANIC_PETRIFY_DURATION_MS
        EventBus.emit('PACT_BOSS_PETRIFY_FIRED', { targetId: victim.adv.instanceId, durationMs: Balance.MECHANIC_PETRIFY_DURATION_MS })
        EventBus.emit('STATUS_APPLIED', { targetId: victim.adv.instanceId, label: 'PETRIFIED' })
      }
      boss._petrifyReadyAt = now + Balance.MECHANIC_PETRIFY_COOLDOWN_MS
    }
  }
  getState()     { return { ...this._gameState.boss } }

  // ── Internals ────────────────────────────────────────────────────────────

  // Recompute boss.maxHp / .attack / .defense from the archetype base
  // + boss-level scaling. Stats are purely a function of boss.level —
  // day count doesn't factor in. The boss grows when the player kills
  // adventurers (XP → level-ups).
  //
  // Math: stat = (baseFightStat + BOSS_*_PER_LEVEL × lvOver)
  //               × BOSS_*_PER_LEVEL_MUL ^ lvOver
  // The additive (BOSS_*_PER_LEVEL) and multiplicative (BOSS_*_PER_LEVEL_MUL)
  // components stack — additive keeps the per-level "+15 HP" feel that
  // BossLevelUpOverlay shows the player; multiplicative drives the
  // exponential late-game growth.
  //
  // Called from _init (so fresh saves + the mango "JUMP TO DAY 50"
  // cheat reflect the boss level immediately), BOSS_LEVELED_UP (so the
  // top-bar HP updates on each level), and _onIncoming (belt-and-
  // braces at fight start).
  //
  // Preserves the current HP fraction across rescale so a wounded
  // boss mid-day doesn't full-heal between fights.
  _recomputeBossFightStats() {
    const boss = this._gameState.boss
    if (!boss) return
    const archId = this._gameState.player?.bossArchetypeId
    const archs  = this._scene.cache.json.get('bossArchetypes') ?? []
    const arch   = archs.find(a => a.id === archId)
    const base   = arch?.baseFightStats ?? { hp: 200, attack: 12, defense: 10 }

    const level  = Math.max(1, boss.level ?? 1)
    const lvOver = level - 1

    // Additive linear baseline (matches BOSS_*_PER_LEVEL display in
    // BossLevelUpOverlay) — at lv 1 this collapses to the base stat.
    const lvlHp  = (base.hp      ?? 200) + (Balance.BOSS_HP_PER_LEVEL  ?? 15) * lvOver
    const lvlAtk = (base.attack  ?? 12)  + (Balance.BOSS_ATK_PER_LEVEL ?? 1)  * lvOver
    const lvlDef = (base.defense ?? 10)  + (Balance.BOSS_DEF_PER_LEVEL ?? 1)  * lvOver

    // Multiplicative per-level scaling — drives late-game exponential
    // growth so the boss keeps pace with adventurer power.
    const mulHp  = Math.pow(Balance.BOSS_HP_PER_LEVEL_MUL  ?? 1, lvOver)
    const mulAtk = Math.pow(Balance.BOSS_ATK_PER_LEVEL_MUL ?? 1, lvOver)
    const mulDef = Math.pow(Balance.BOSS_DEF_PER_LEVEL_MUL ?? 1, lvOver)

    const prevHpFrac = boss.maxHp > 0 ? (boss.hp / boss.maxHp) : 1
    // Sacrificial Altar boss-stat buff — multiplicative accumulator on
    // `player._altarBossStatBuff` (set by altar reward rolls). Applied
    // here in the recompute so the buff survives every BOSS_LEVELED_UP
    // rescale + every _onIncoming refresh. Same pattern as
    // applyMinionScaling's altar-minion-buff hook.
    const altarBuff = this._gameState?.player?._altarBossStatBuff ?? 0
    const altarMul  = 1 + altarBuff
    // Boss Ascension (KR P6 "dark ascension") — each act the boss absorbs the
    // fallen kingdom's power and surges. Tier = acts beyond the first (Act II→1,
    // III→2, IV→3), derived from meta.act.current so it survives save/load with
    // no separate counter and is a clean no-op when acts are off (meta.act
    // undefined → tier 0 → ×1). Compounding HP + attack, applied in the same
    // multiplicative chain as the altar buff so it persists across every
    // level-up rescale and fight refresh.
    const ascTier   = Math.max(0, (this._gameState?.meta?.act?.current ?? 1) - 1)
    const ascHpMul  = Math.pow(Balance.BOSS_ASCENSION_HP_MUL  ?? 1.28, ascTier)
    const ascAtkMul = Math.pow(Balance.BOSS_ASCENSION_ATK_MUL ?? 1.20, ascTier)
    // Pact stat modifiers (per-stat multipliers from flags):
    //   DAMNED curses — Hollow Crown halves max HP; Bleeding Crown sheds 2%/day.
    //   LEGENDARY boons — Colossus (HP x2, atk x0.5), Apex Tyrant (HP x2, atk
    //   & def x1.5), Avatar of Ruin (HP x0.5).
    const f = this._gameState?._mechanicFlags ?? {}
    let hpMulP = 1, atkMulP = 1, defMulP = 1
    if (f.hollowCrown) hpMulP *= (Balance.MECHANIC_HOLLOW_CROWN_HP_MULT ?? 0.5)
    if (f.theBleedingCrown && (f.bleedingCrownDays ?? 0) > 0) {
      hpMulP *= Math.pow(1 - (Balance.MECHANIC_BLEEDING_CROWN_HP_LOSS_PER_DAY ?? 0.02), f.bleedingCrownDays)
    }
    if (f.colossusHeart) { hpMulP *= (Balance.MECHANIC_COLOSSUS_HP_MULT ?? 2); atkMulP *= (Balance.MECHANIC_COLOSSUS_ATK_MULT ?? 0.5) }
    if (f.apexTyrant)    { hpMulP *= (Balance.MECHANIC_APEX_HP_MULT ?? 2); atkMulP *= (Balance.MECHANIC_APEX_ATK_MULT ?? 1.5); defMulP *= (Balance.MECHANIC_APEX_DEF_MULT ?? 1.5) }
    if (f.avatarOfRuin)  { hpMulP *= (Balance.MECHANIC_AVATAR_HP_MULT ?? 0.5) }
    boss.maxHp   = Math.max(1, Math.round(lvlHp  * mulHp  * altarMul * ascHpMul  * hpMulP))
    boss.attack  = Math.max(1, Math.round(lvlAtk * mulAtk * altarMul * ascAtkMul * atkMulP))
    boss.defense = Math.max(0, Math.round(lvlDef * mulDef * altarMul * defMulP))
    // Preserve HP fraction across the rescale. The downstream
    // refill-if-zero block in _onIncoming handles the post-respawn case.
    boss.hp = Math.max(0, Math.min(boss.maxHp, Math.round(boss.maxHp * prevHpFrac)))
  }

  _onIncoming({ adventurer }) {
    if (this._fighting) return
    const boss = this._gameState.boss
    const now  = this._scene.time?.now ?? 0
    // ONE LIFE PER DAY (2026-05-25): if the boss already fell this day
    // (life decremented in _resolveFight), any later adv reaching the
    // boss room must NOT trigger a fresh fight — the boss is a corpse
    // in the throne chamber until next night. Hand the adv off to flee
    // with 'boss_defeated' (same goal a winning party gets), so they
    // exit the dungeon instead of standing on the throne tile waiting
    // for a fight that will never start.
    if (boss?._diedThisDay) {
      if (adventurer) this._handOffToAIFlee(adventurer, 'boss_defeated')
      return
    }
    // Light Party — intercept BEFORE the normal fight setup runs and route
    // to the bespoke FFXIV-style cinematic duel. The party arrived at the
    // throne; the rest of the fight is scripted (see _runLightPartyDuel),
    // outcome rolled from healer HP + party state and animated. Other
    // light-party members heading to the boss room follow the same gate
    // (lightPartyDuel flag set immediately) and won't re-trigger this path.
    if (adventurer?._lightParty &&
        (this._gameState._eventFlags ?? {}).lightPartyActive &&
        !this._lightPartyDuel) {
      return this._runLightPartyDuel(adventurer)
    }
    // Aldric — the Act IV crowned Hero King reaches the throne. Intercept BEFORE
    // the normal fight setup and route to the bespoke choreographed climax duel
    // (see _runNemesisDuel). The flag guards re-entry while it plays.
    if (adventurer?._nemesisDuel && !this._nemDuelActive) {
      return this._runNemesisDuel(adventurer)
    }
    // Defensive: never start a fight on a dead-posed boss or after
    // final death. boss.hp <= 0 is NOT a sufficient block on its own —
    // between fights with deathsRemaining > 0 the boss still has lives
    // left but lingers at 0 hp until the next fight refreshes it. The
    // `_diedThisDay` gate above now catches the dominant case (life
    // already lost today); these stay as belt-and-braces.
    if (this._deathPoseUntil > now) return
    if (this.isFinalDeath()) return
    this._fighting       = true
    this._fightStartedAt = now    // LEGENDARY · Avatar of Ruin invincibility window
    this._combatStarted  = false
    this._fightEnded     = false
    this._fightCombatT   = 0
    this._roundLog       = []
    this._secondWindUsed = false
    this._roundsRun      = 0
    this._duelMode       = false   // Solo Leveling — recomputed per tick
    this._duel           = null
    this._duelOutro      = null
    // Belt-and-braces: clear any leaked floating-damage-number count
    // (e.g. tweens torn down without firing onComplete) so a fresh
    // fight always starts with the full concurrent-floater budget.
    this._activeFloaters = 0

    // Succubus Doppelgänger — conjure the opening set of decoy duplicates
    // for this fight (no-op for any other archetype).
    this._initDoppelganger()

    // Pre-fight setup; ability effects happen here so they are visible
    // during the prefight banner / opening dance.
    if (boss) {
      // Recompute effective fight stats from base + level + day scaling.
      // Mutates boss.maxHp / .attack / .defense in place and preserves
      // current HP fraction (so a survivor of an earlier same-day fight
      // doesn't full-heal between fights). See _recomputeBossFightStats.
      this._recomputeBossFightStats()
      const owned = new Set(boss.unlockedAbilities ?? [])
      // Respawn refresh — ONLY when the boss is actually down (drained to
      // 0 and lingering between fights after a non-final life loss). A
      // boss that SURVIVED its last fight keeps its damage: multiple
      // fights in one day must wear it down. HP otherwise only restores
      // via a healing ability, an external heal, or the day-end reset.
      if ((boss.hp ?? 0) <= 0) {
        boss.hp = boss.maxHp
      }
      // DAMNED · Sleepless Throne — the boss never enters a fight above 50%.
      if ((this._gameState._mechanicFlags ?? {}).sleeplessThrone) {
        const cap = Math.floor((boss.maxHp ?? 0) * (Balance.MECHANIC_SLEEPLESS_THRONE_START_HP_FRAC ?? 0.5))
        boss.hp = Math.max(1, Math.min(boss.hp ?? boss.maxHp, cap))
      }
      // Soul Drain ability — heals +25% maxHP at the start of every
      // fight (may overheal, capped at 125% maxHP). A deliberate healing
      // ability, so it fires whether the boss respawned or survived.
      if (owned.has('soul_drain')) {
        const cap = Math.floor((boss.maxHp ?? 0) * 1.25)
        boss.hp = Math.min(cap, (boss.hp ?? 0) + Math.floor((boss.maxHp ?? 0) * 0.25))
      }
      if (owned.has('summon_adds')) {
        const bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
        if (bossRoom) {
          EventBus.emit('BOSS_SUMMONED_ADDS', { count: 2 })
          _summonAddsNearBoss(this._scene, this._gameState, bossRoom, 2)
        }
      }
      // Solo Leveling — the Shadow Monarch duels the boss on equal terms:
      // his stats are set to the boss's right here (after the recompute),
      // then amplified by every shadow he extracted on the way in. Done
      // AFTER _recomputeBossFightStats so it reads the final boss numbers.
      if (adventurer?._shadowMonarch) this._matchShadowMonarchToBoss(adventurer, boss)
    }

    // Slime King Mitosis — initialise the slime-entity array for this
    // fight. The fight uses N independent boss entities (boss.slimes)
    // tracked through splits; boss.hp stays in sync as the sum of all
    // alive slimes so the standard `boss.hp <= 0` end-of-fight check
    // still works (all dead → sum is 0). MUST run AFTER the refill /
    // Soul Drain block above so the gen-0 slime spawns with the post-
    // refill HP value — otherwise a wounded boss going into fight 2
    // ends up at full HP because _initSlimesForFight read boss.hp
    // before refill applied.
    this._initSlimesForFight(boss)

    EventBus.emit('BOSS_FIGHT_STARTED', { triggeringAdventurer: adventurer })

    // Combat rounds begin after a banner pause — the cinematic dance plays
    // throughout, but no damage is exchanged until this fires.
    this._scene.time.delayedCall(PREFIGHT_DELAY_MS, () => {
      this._combatStarted = true
    })
  }

  // ── Aldric — the Act IV climax duel (KR P2-polish) ────────────────────────
  // The campaign's final set-piece: the boss vs Aldric, the crowned Hero King.
  // Unlike the Shadow Monarch orbit-dance (real damage, movement-only swap),
  // this is choreographed END-TO-END — a designed HP curve that SEE-SAWS so
  // either side always looks like it could win, both fighters firing signature
  // abilities, a blade-lock power-struggle, a knockback, and a slow-mo final
  // blow. THEMED by Aldric's adaptive form (gold "Radiant Hope" / crimson
  // "Vengeful Crown"). Outcome rolled up front from boss-vs-Aldric power so the
  // player's whole campaign build decides it; the choreography hides the result
  // until the last clash. Triggered from _onIncoming when `_nemesisDuel` Aldric
  // reaches the throne. Cinematic layer: AldricCinematic.js.
  _runNemesisDuel(adv) {
    const boss = this._gameState.boss
    if (!boss || !adv) return
    this._fighting       = true
    this._nemDuelActive  = true
    this._combatStarted  = true
    this._fightStartedAt  = this._scene.time?.now ?? 0
    this._fightEnded     = false
    this._duelMode       = false   // NOT the SL orbit dance
    this._nemResolved    = false

    this._recomputeBossFightStats()
    if ((boss.hp ?? 0) <= 0) boss.hp = boss.maxHp
    this._bossState = { action: 'idle' }

    // Roll the winner from relative power (HP×attack) so a stronger boss is
    // likelier to slay the Hero King — the player's build matters. Fed through
    // the same piecewise curve as the other duels.
    const bossPow = (boss.maxHp ?? 1) * (boss.attack ?? 1)
    const aldPow  = (adv.resources?.maxHp ?? 1) * (adv.stats?.attack ?? 1)
    const frac    = bossPow / Math.max(1, bossPow + aldPow)
    const bossWins = Math.random() < this._duelWinChance(frac)

    // Park Aldric — the choreography owns his position. `_nemDuel` tells the
    // AdventurerRenderer to face the boss + animate (walk base + strike pulses).
    adv.path = null; adv.goal = { type: 'AT_BOSS' }; adv._nemDuel = true; adv._nemStrikeAt = 0

    const a = this._nemAnchors()
    boss.worldX = a.throne.x; boss.worldY = a.throne.y   // boss holds the throne (north)
    adv.worldX  = a.south.x;  adv.worldY  = a.south.y    // Aldric strides in (south)

    const form = adv._aldricForm ?? this._gameState.meta?.nemesis?.form ?? null
    const col  = form === 'desperate' ? 0xff3b46 : form === 'radiant' ? 0xffd76a : 0xe8c860
    const col2 = form === 'desperate' ? 0xff8a78 : 0xfff3cf
    const bossName = this._duelBossName()

    EventBus.emit('ALDRIC_DUEL_BEGAN', { name: adv.name ?? 'ALDRIC', bossName, form, advFrac: 1, bossFrac: 1 })
    this._nemSfx('begin')

    this._nemDuel = {
      boss, adv, bossWins, form, bossName, anchors: a, col, col2,
      phase: null, t: 0, total: 0, watchdog: 0,
      advFrac: 1, bossFrac: 1, advFrom: 1, advTo: 1, bossFrom: 1, bossTo: 1,
      clash: { ...a.center }, hpEmitT: 0, nextFxT: 0, swap: false,
    }
    this._nemPlan = this._buildNemPlan(bossWins)
    this._nemPhaseIndex = -1
    this._nemAdvancePhase()
  }

  // Chamber positions the duel choreographs across.
  _nemAnchors() {
    const TS = Balance.TILE_SIZE
    const { clampX, clampY } = this._roomClamp()
    const room = this._bossRoom
    const cx = clampX((room.gridX + room.width  / 2) * TS)
    const cy = clampY((room.gridY + room.height / 2) * TS)
    const dx = room.width  * TS * 0.30
    const dy = room.height * TS * 0.30
    return {
      center: { x: cx, y: cy },
      throne: { x: cx, y: clampY(cy - dy * 1.05) },
      south:  { x: cx, y: clampY(cy + dy * 1.05) },
      west:   { x: clampX(cx - dx * 1.1), y: cy },
      east:   { x: clampX(cx + dx * 1.1), y: cy },
      nw: { x: clampX(cx - dx), y: clampY(cy - dy) }, ne: { x: clampX(cx + dx), y: clampY(cy - dy) },
      sw: { x: clampX(cx - dx), y: clampY(cy + dy) }, se: { x: clampX(cx + dx), y: clampY(cy + dy) },
    }
  }

  // The phase plan: HP keyframes per beat. Early phases are identical for both
  // outcomes (the swing reads the same); the late phases diverge to the rolled
  // resolution. `advTo`/`bossTo` are the HP fractions both bars ease toward over
  // the phase — designed so the lead trades hands: Aldric surges (dawnblade) →
  // the boss rallies (its ult) → blade-lock → knockback → Aldric REFUSES to
  // fall (heroic_resolve fakeout) → frantic exchange → hero-king apex → the
  // decisive blow. `W` = boss wins.
  _buildNemPlan(W) {
    return [
      { name: 'intro',          dur: 2.6, advTo: 1.00, bossTo: 1.00 },
      { name: 'first_clash',    dur: 1.8, advTo: 0.92, bossTo: 0.90, beat: 'clash' },
      { name: 'dawnblade',      dur: 2.7, advTo: 0.86, bossTo: 0.54, beat: 'dawnblade' },
      { name: 'boss_rally',     dur: 2.9, advTo: 0.46, bossTo: 0.52, beat: 'boss_ult' },
      { name: 'bladelock',      dur: 2.4, advTo: 0.42, bossTo: 0.48, beat: 'bladelock' },
      { name: 'knockback',      dur: 1.5, advTo: W ? 0.30 : 0.48, bossTo: W ? 0.48 : 0.30, beat: 'knockback' },
      { name: 'heroic_resolve', dur: 2.7, advTo: W ? 0.42 : 0.58, bossTo: W ? 0.40 : 0.30, beat: 'heroic_resolve' },
      { name: 'exchange',       dur: 2.9, advTo: W ? 0.26 : 0.34, bossTo: W ? 0.30 : 0.20 },
      { name: 'apex',           dur: 3.1, advTo: W ? 0.16 : 0.26, bossTo: W ? 0.24 : 0.12, beat: 'hero_king' },
      { name: 'final_clash',    dur: 2.3, advTo: W ? 0.00 : 0.20, bossTo: W ? 0.20 : 0.00, beat: 'finalblow' },
    ]
  }

  _nemAdvancePhase() {
    const D = this._nemDuel
    if (!D) return
    this._nemPhaseIndex += 1
    const ph = this._nemPlan?.[this._nemPhaseIndex]
    if (!ph) { this._resolveNemesisDuel(D.bossWins); return }
    D.phase = ph.name
    D.t = 0
    D.advFrom = D.advFrac; D.bossFrom = D.bossFrac
    D.advTo = ph.advTo; D.bossTo = ph.bossTo
    this._nemPhaseEnter(ph, D)
  }

  // Per-frame: ease both HP bars toward the phase target, commit to real HP,
  // feed the cinematic, run the kinetic movement + VFX, advance on time.
  // `deltaMs` is the raw (unscaled) frame delta from update(); we convert to
  // seconds and SCALE by timeScale so a hitstop/slow-mo actually freezes the
  // choreography — but the anti-freeze watchdog runs on RAW time so a stuck
  // slow-mo can never strand the duel.
  _tickNemesisDuel(deltaMs) {
    const D = this._nemDuel
    if (!D || this._nemResolved) return
    const { boss, adv } = D
    const TS = Balance.TILE_SIZE
    const { clampX, clampY } = this._roomClamp()
    const raw = Math.min(0.05, (deltaMs ?? 16) / 1000)
    const dt  = raw * (this._scene?.time?.timeScale ?? 1)
    D.total += dt; D.t += dt; D.watchdog += raw
    const ph = this._nemPlan[this._nemPhaseIndex]
    if (!ph) { this._resolveNemesisDuel(D.bossWins); return }

    // easeInOutQuad toward the phase HP target.
    const k = ph.dur > 0 ? Math.min(1, D.t / ph.dur) : 1
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
    D.advFrac  = D.advFrom  + (D.advTo  - D.advFrom)  * e
    D.bossFrac = D.bossFrom + (D.bossTo - D.bossFrom) * e
    adv.resources.hp = Math.max(0, Math.round((adv.resources.maxHp ?? 1) * D.advFrac))
    boss.hp          = Math.max(0, Math.round((boss.maxHp ?? 1) * D.bossFrac))

    D.hpEmitT += dt
    if (D.hpEmitT >= 0.1) { D.hpEmitT = 0; EventBus.emit('ALDRIC_DUEL_HP', { advFrac: D.advFrac, bossFrac: D.bossFrac }) }

    const moveTo = (en, tx, ty, speed) => {
      const dx = tx - en.worldX, dy = ty - en.worldY
      const d = Math.hypot(dx, dy)
      if (d <= 0.01) return 0
      const step = Math.min(d, speed * dt)
      en.worldX = clampX(en.worldX + (dx / d) * step)
      en.worldY = clampY(en.worldY + (dy / d) * step)
      return d - step
    }
    const shake = (dur, mag) => this._scene.cameras?.main?.shake?.(dur, mag)
    this._nemMove(ph.name, D, dt, TS, moveTo, shake)

    if (D.t >= ph.dur) this._nemAdvancePhase()
    if (D.watchdog > 45) this._resolveNemesisDuel(D.bossWins)   // anti-freeze backstop

    adv.tileX  = Math.floor(adv.worldX  / TS); adv.tileY  = Math.floor(adv.worldY  / TS)
    boss.tileX = Math.floor(boss.worldX / TS); boss.tileY = Math.floor(boss.worldY / TS)
  }

  // One-time entry effects + beat for a phase.
  _nemPhaseEnter(ph, D) {
    const sc = this._scene
    const { boss, adv, col, col2, anchors: A } = D
    const beat = (kind, label) => EventBus.emit('ALDRIC_DUEL_BEAT', { kind, label })
    const ring = (x, y, c, o = {}) => AbilityVfx.pulseRing?.(sc, x, y, { color: c, ...o })
    switch (ph.name) {
      case 'dawnblade':
        beat('dawnblade', D.form === 'desperate' ? 'VENGEANCE' : 'DAWNBLADE')
        AbilityVfx.chargeUp?.(sc, adv.worldX, adv.worldY, { color: col, radius: 40 })
        break
      case 'boss_rally': {
        beat('boss_ult', this._nemBossUltName())
        this._nemSfx('ult')
        AbilityVfx.chargeUp?.(sc, boss.worldX, boss.worldY, { color: 0xff5544, radius: 54 })
        AbilityVfx.groundTelegraph?.(sc, boss.worldX, boss.worldY, { color: 0xff3322, radius: 90, shape: 'circle' })
        break
      }
      case 'bladelock':
        beat('bladelock', null)
        break
      case 'knockback':
        beat('knockback', null)
        break
      case 'heroic_resolve':
        beat('heroic_resolve', D.form === 'desperate' ? 'I AM THEIR VENGEANCE' : 'HEROIC RESOLVE')
        this._nemSfx('resolve')
        ring(adv.worldX, adv.worldY, col, { radius: 70 })
        AbilityVfx.domeShield?.(sc, adv.worldX, adv.worldY, { color: col, radius: 56, durationMs: 1400 })
        if (D.form === 'radiant') AbilityVfx.godRays?.(sc, adv.worldX, adv.worldY, { color: col2, radius: 90 })
        else                       AbilityVfx.emberField?.(sc, adv.worldX, adv.worldY, { color: col, radius: 70 })
        sc?.cameras?.main?.shake?.(220, 0.006)
        EventBus.emit('ALDRIC_DUEL_BEAT', { kind: 'surge', label: 'THE TIDE TURNS' })
        break
      case 'apex':
        beat('hero_king', D.form === 'desperate' ? 'CROWN OF VENGEANCE' : 'HERO-KING')
        this._nemSfx('apex')
        AbilityVfx.screenFlash?.(sc, { color: col2, alpha: 0.5, durationMs: 320 })
        AbilityVfx.beamPillar?.(sc, adv.worldX, adv.worldY, { color: col, width: 46, durationMs: 1500 })
        AbilityVfx.magicCircle?.(sc, adv.worldX, adv.worldY, { color: col, radius: 64 })
        if (D.form === 'radiant') AbilityVfx.godRays?.(sc, adv.worldX, adv.worldY, { color: col2, radius: 120 })
        AbilityVfx.burstRays?.(sc, adv.worldX, adv.worldY, { color: col, count: 14, length: 90 })
        sc?.cameras?.main?.shake?.(300, 0.009)
        break
    }
  }

  // The kinetic layer — moves the boss + Aldric across the chamber per phase and
  // sprays the per-phase VFX. Mirrors _tickDuel's moveTo style but bespoke.
  _nemMove(phase, D, dt, TS, moveTo, shake) {
    const sc = this._scene
    const { boss, adv, col, col2, anchors: A } = D
    const now = sc?.time?.now ?? 0
    const mid = () => ({ x: (adv.worldX + boss.worldX) / 2, y: (adv.worldY + boss.worldY) / 2 })
    const blade = (x, y, c, ang) => AbilityVfx.bladeArc?.(sc, x, y, { color: c, radius: 38, angle: ang ?? Math.random() * Math.PI * 2, sweep: 2.4 })
    const impact = (x, y, c, big = false) => AbilityVfx.impactBurst?.(sc, x, y, { color: c, radius: big ? 70 : 44, sparks: big ? 10 : 6, debris: big ? 6 : 3, durationMs: big ? 460 : 340 })
    // Pulse Aldric's one-shot swing anim. The renderer plays it for `ms` then
    // falls back to the looping walk, so he never freezes on the held frame.
    const strike = (ms = 340) => { adv._nemStrikeAt = now; adv._nemStrikeKind = 'slash'; adv._nemStrikeMs = ms }
    // GAP keeps the two bodies ADJACENT (blades meeting) instead of stacked on
    // one tile — boss holds the throne (north) side of a clash, Aldric the south.
    const GAP = 1.35 * TS
    const clashBoss = { x: A.center.x, y: A.center.y - GAP / 2 }
    const clashAdv  = { x: A.center.x, y: A.center.y + GAP / 2 }
    const near = () => Math.hypot(adv.worldX - boss.worldX, adv.worldY - boss.worldY) < GAP + 0.35 * TS

    switch (phase) {
      case 'intro':
        moveTo(adv,  clashAdv.x,  clashAdv.y + 0.9 * TS,  3.4 * TS)
        moveTo(boss, clashBoss.x, clashBoss.y - 0.9 * TS, 2.8 * TS)
        break

      case 'first_clash': {
        moveTo(adv,  clashAdv.x,  clashAdv.y,  12 * TS)
        moveTo(boss, clashBoss.x, clashBoss.y, 8 * TS)
        if (!D._clashed && near()) {
          D._clashed = true; strike(); this._nemSfx('clash')
          const m = mid(); impact(m.x, m.y, col2, true); blade(m.x, m.y, col)
          AbilityVfx.shockwave?.(sc, m.x, m.y, { color: col, radius: 80 })
          shake(140, 0.006); this._hitstop(70, 0.18)
          AbilityVfx.screenFlash?.(sc, { color: 0xffffff, alpha: 0.35, durationMs: 200 })
        }
        break
      }

      case 'dawnblade': {
        // Aldric orbits the boss at arm's length, raining radiant cross-slashes.
        this._bossState = { action: 'idle' }
        D._ang = (D._ang ?? 0) + dt * 4.6
        const R = 1.4 * TS
        moveTo(adv, boss.worldX + Math.cos(D._ang) * R, boss.worldY + Math.sin(D._ang) * R, 11 * TS)
        D.nextFxT -= dt
        if (D.nextFxT <= 0) {
          D.nextFxT = 0.22; strike(220); this._nemSfx('slash')
          blade(adv.worldX, adv.worldY, col, D._ang + Math.PI / 2)
          impact(boss.worldX, boss.worldY, col2)
          AbilityVfx.pulseRing?.(sc, boss.worldX, boss.worldY, { color: col2, radius: 36 })
          shake(60, 0.0022)
        }
        break
      }

      case 'boss_rally': {
        // The boss unleashes its signature ult — chamber-wide. Aldric is hurled
        // back to the south and braces.
        this._bossState = { action: 'slam' }
        moveTo(adv,  A.south.x,  A.south.y,  7 * TS)
        moveTo(boss, A.center.x, A.center.y, 4 * TS)
        if (D.t > 0.7 && !D._ulted) {
          D._ulted = true
          AbilityVfx.shockwave?.(sc, boss.worldX, boss.worldY, { color: 0xff4433, radius: 180, core: true })
          AbilityVfx.burstRays?.(sc, boss.worldX, boss.worldY, { color: 0xff5533, count: 16, length: 140 })
          AbilityVfx.screenFlash?.(sc, { color: 0xff5533, alpha: 0.4, durationMs: 300 })
          shake(360, 0.012); this._hitstop(90, 0.2)
          impact(adv.worldX, adv.worldY, 0xff6644, true)
        }
        break
      }

      case 'bladelock': {
        // Both grind blade-to-blade, bodies a full stride apart, blades crossing
        // in the gap between — strain sparks + a trembling screen.
        this._bossState = { action: 'idle' }
        const jx = Math.sin(D.t * 36) * 0.05 * TS
        moveTo(adv,  clashAdv.x  + jx, clashAdv.y,  9 * TS)
        moveTo(boss, clashBoss.x - jx, clashBoss.y, 9 * TS)
        D.nextFxT -= dt
        if (D.nextFxT <= 0) {
          D.nextFxT = 0.07
          const m = mid()
          AbilityVfx.particleBurst?.(sc, m.x, m.y, { color: col2, count: 4, speed: 90, life: 260 })
          if (Math.random() < 0.45) { blade(m.x, m.y, col, Math.random() * Math.PI); strike(260); this._nemSfx('lock') }
          shake(50, 0.0016)
        }
        break
      }

      case 'knockback': {
        // The winner overpowers + SHOVES the loser flying back into the wall.
        const W = D.bossWins
        const winner = W ? boss : adv
        const loser  = W ? adv : boss
        const dest   = W ? A.south : A.throne
        if (W) this._bossState = { action: 'lunge' }
        else   { this._bossState = { action: 'idle' }; if (!D._shoved) strike(420) }
        moveTo(loser,  dest.x, dest.y, 18 * TS)
        moveTo(winner, A.center.x, A.center.y, 6 * TS)
        if (!D._shoved && Math.hypot(loser.worldX - dest.x, loser.worldY - dest.y) < 0.5 * TS) {
          D._shoved = true; this._nemSfx('knockback')
          AbilityVfx.crater?.(sc, loser.worldX, loser.worldY, { color: col, radius: 60 })
          AbilityVfx.impactBurst?.(sc, loser.worldX, loser.worldY, { color: col2, radius: 70, sparks: 10, debris: 8, durationMs: 480 })
          shake(300, 0.011); this._hitstop(80, 0.2)
        }
        break
      }

      case 'heroic_resolve': {
        // Aldric rises behind his aegis at center; the boss circles at range.
        this._bossState = { action: 'idle' }
        moveTo(adv, A.center.x, A.center.y, 5 * TS)
        D._ang = (D._ang ?? 0) + dt * 2.0
        moveTo(boss, A.center.x + Math.cos(D._ang) * 1.7 * TS, A.center.y + Math.sin(D._ang) * 1.4 * TS, 5 * TS)
        D.nextFxT -= dt
        if (D.nextFxT <= 0) { D.nextFxT = 0.4; AbilityVfx.pulseRing?.(sc, adv.worldX, adv.worldY, { color: col, radius: 50 }) }
        break
      }

      case 'exchange': {
        // Frantic back-and-forth — both dash to an adjacent clash, trade a blow,
        // then leap to opposite corners and charge back in.
        const corners = D.swap ? [A.nw, A.se] : [A.ne, A.sw]
        moveTo(adv,  clashAdv.x,  clashAdv.y,  13 * TS)
        moveTo(boss, clashBoss.x, clashBoss.y, 11 * TS)
        if (near()) {
          strike(200); this._nemSfx('clash')
          const m = mid(); impact(m.x, m.y, col2); blade(m.x, m.y, col, Math.random() * Math.PI * 2)
          shake(70, 0.003)
          D.swap = !D.swap
          adv.worldX = corners[0].x; adv.worldY = corners[0].y
          boss.worldX = corners[1].x; boss.worldY = corners[1].y
        }
        break
      }

      case 'apex': {
        // Aldric channels the crown at center; the boss withdraws, then both
        // charge for the apex clash (adjacent).
        this._bossState = { action: 'slam' }
        if (D.t < 1.4) {
          moveTo(adv,  A.center.x, A.center.y, 4 * TS)
          moveTo(boss, A.throne.x, A.throne.y, 5 * TS)
        } else {
          moveTo(adv,  clashAdv.x,  clashAdv.y,  14 * TS)
          moveTo(boss, clashBoss.x, clashBoss.y, 12 * TS)
          if (!D._apexClash && near()) {
            D._apexClash = true; strike(420); this._nemSfx('clash')
            const m = mid()
            AbilityVfx.shockwave?.(sc, m.x, m.y, { color: col, radius: 130, core: true })
            AbilityVfx.impactBurst?.(sc, m.x, m.y, { color: col2, radius: 90, sparks: 14, debris: 8, durationMs: 540 })
            AbilityVfx.screenFlash?.(sc, { color: 0xffffff, alpha: 0.55, durationMs: 260 })
            shake(360, 0.013); this._hitstop(110, 0.16)
          }
        }
        break
      }

      case 'final_clash': {
        // The decisive pass — they charge to an adjacent clash; time slows on the
        // blow, a white flash, then they pass SIDE-BY-SIDE to opposite ends (no
        // overlap). _resolveNemesisDuel (on phase end) delivers the killing blow.
        this._bossState = { action: D.bossWins ? 'slam' : 'idle' }
        if (D.t < 0.9) {
          moveTo(adv,  clashAdv.x,  clashAdv.y,  16 * TS)
          moveTo(boss, clashBoss.x, clashBoss.y, 14 * TS)
          if (!D._slowmo && near()) {
            D._slowmo = true; if (!D.bossWins) strike(600); this._nemSfx('finalblow')
            this._hitstop(420, 0.12)   // long freeze on the final blow
            AbilityVfx.screenFlash?.(sc, { color: 0xffffff, alpha: 0.85, durationMs: 360 })
            const m = mid()
            AbilityVfx.bladeArc?.(sc, m.x, m.y, { color: col2, radius: 70, angle: Math.PI / 4, sweep: 3 })
            shake(220, 0.01)
          }
        } else {
          // pass side-by-side to opposite ends (offset on x so they don't overlap)
          moveTo(adv,  A.throne.x - 0.9 * TS, A.throne.y, 7 * TS)
          moveTo(boss, A.south.x  + 0.9 * TS, A.south.y,  7 * TS)
        }
        break
      }
    }
  }

  // Per-archetype name for the boss's mid-duel signature ult (reuses the duel
  // cast-name flavour); falls back to a generic for any future archetype.
  _nemBossUltName() {
    const ULTS = {
      beholder: 'DISINTEGRATION RAY', demon: 'INFERNAL CATACLYSM', myconid: 'SPORE BLOOM',
      wraith: 'WAIL OF THE DAMNED', gnoll: 'BLOODMOON HOWL', golem: 'EARTHQUAKE',
      lich: 'NECROTIC NOVA', lizardman: 'TOXIC DELUGE', orc: 'WAR STOMP',
      vampire: 'BLOOD TEMPEST', slime: 'ENGULFING TIDE', succubus: "RAPTURE'S END",
    }
    return ULTS[this._gameState.player?.bossArchetypeId] ?? 'CATACLYSM'
  }

  // Fire a scripted-duel audio cue. SfxSystem._onNemesisDuelSfx maps each cue to
  // a sound (the duel emits no COMBAT_HIT, so it's silent without these).
  _nemSfx(cue) { EventBus.emit('NEMESIS_DUEL_SFX', { cue }) }

  _resolveNemesisDuel(bossWins) {
    const D = this._nemDuel
    if (!D || this._nemResolved) return
    this._nemResolved = true
    const { boss, adv, bossName } = D
    const sc = this._scene
    // The winner lands the killing blow — one last swing (the loser just falls).
    if (!bossWins) { adv._nemStrikeAt = sc?.time?.now ?? 0; adv._nemStrikeKind = 'slash'; adv._nemStrikeMs = 700 }

    // Killing-blow punch — hard shake + a beat of slow-mo + a white flash.
    sc?.cameras?.main?.shake?.(540, 0.02)
    AbilityVfx.screenFlash?.(sc, { color: 0xffffff, alpha: 0.9, durationMs: 380 })
    if (sc?.time) { sc.time.timeScale = 0.2; window.setTimeout(() => { if (sc?.time && !this._fightEnded) sc.time.timeScale = 1 }, 520) }

    EventBus.emit('ALDRIC_DUEL_END', { result: bossWins ? 'win' : 'loss', bossName })

    // Let the finale card breathe (~2.6s wall-clock) before the death cascade
    // fires the victory / game-over flow over the top of it.
    window.setTimeout(() => this._finishNemesisDuel(bossWins), 2600)
  }

  _finishNemesisDuel(bossWins) {
    const D = this._nemDuel
    if (!D) return
    const { boss, adv } = D
    if (this._scene?.time) this._scene.time.timeScale = 1
    this._fightEnded = true

    if (bossWins) {
      // Aldric falls → _killAdv → COMBAT_KILL → ADVENTURER_DIED (carries
      // `_nemesisDuel`) → NemesisSystem._onDied → NEMESIS_SLAIN → run victory.
      adv.resources.hp = 0
      this._killAdv(adv, 'boss')
      EventBus.emit('BOSS_FIGHT_RESOLVED', {
        winner: 'boss', bossHpRemaining: boss.hp ?? 0,
        deathsRemaining: boss.deathsRemaining ?? 0, rounds: 1, roundLog: [],
      })
    } else {
      // The Hero King prevails — the boss loses a life (run-loss if final).
      // Book-keeping mirrors a normal-fight party win.
      boss.hp = 0
      boss.deathsRemaining = Math.max(0, (boss.deathsRemaining ?? 0) - 1)
      boss._diedThisDay = true
      this._deathPoseUntil = Infinity
      EventBus.emit('BOSS_FIGHT_RESOLVED', {
        winner: 'party', bossHpRemaining: 0, deathsRemaining: boss.deathsRemaining,
        rounds: 1, roundLog: [],
      })
      if (boss.deathsRemaining <= 0) {
        EventBus.emit('BOSS_DEFEATED_FINAL', { totalDays: this._gameState.player?.totalDaysElapsed })
      }
      this._handOffToAIFlee?.(adv, 'boss_defeated')
    }
    this._endNemesisDuel()
  }

  _endNemesisDuel() {
    const D = this._nemDuel
    if (D?.adv) { D.adv._nemDuel = false; D.adv._nemStrikeAt = 0 }
    this._nemDuel = null
    this._nemPlan = null
    this._nemPhaseIndex = -1
    this._nemDuelActive = false
  }

  // ── Light Party — FFXIV-style cinematic duel ──────────────────────────
  // Replaces the normal _onIncoming → fight-round pipeline when the
  // Light Party (or Full Party) reaches the throne. The whole fight is
  // SCRIPTED: outcome is rolled at start from healer HP + party state,
  // then a fixed beat sequence plays out (cast bars → telegraphed AoE →
  // heal phase → stack mechanic → LB3 climax → resolution) over ~17s
  // while the cinematic UI (LightPartyCinematic) shows the FFXIV raid
  // HUD on top. On a party WIN, the boss loses a life (book-keeping
  // matches _endFight('party')); on a LOSS, the party wipes.
  _runLightPartyDuel(_triggerAdv) {
    const boss = this._gameState.boss
    if (!boss) return
    this._fighting        = true
    this._lightPartyDuel  = true
    this._combatStarted   = true                 // skip prefight gate; cinematic owns timing
    this._fightStartedAt  = this._scene.time?.now ?? 0
    this._fightEnded      = false

    // Recompute boss fight stats so the cinematic shows current values.
    // Mirrors what _onIncoming does for normal fights.
    this._recomputeBossFightStats()
    if ((boss.hp ?? 0) <= 0) boss.hp = boss.maxHp

    // Snapshot the party + roll the outcome before any beat fires. Party
    // members include living survivors only (dead members have already been
    // spliced from active by AISystem death handling).
    const party = (this._gameState.adventurers?.active ?? [])
      .filter(a => a?._lightParty && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
    // Outcome is decided by the party's COMBINED HP FRACTION fed through the
    // SAME piecewise win-chance curve as the Jinwoo duel (_duelWinChance) —
    // just applied to the group instead of a single fighter:
    //   combinedFrac = Σ current HP (living) / original combined max HP.
    // The denominator is the FULL roster's max HP captured at spawn
    // (lightPartyTotalMaxHp), so a member who died en route contributes 0 to
    // the numerator while their max still weighs the denominator down —
    // deaths drag the group's odds toward the boss, exactly like a single
    // fighter losing HP. Falls back to the living party's combined max if the
    // spawn stamp is missing (e.g. an old save mid-event).
    const combinedHp = party.reduce((s, a) => s + (a.resources?.hp ?? 0), 0)
    const totalMaxHp = (this._gameState._eventFlags ?? {}).lightPartyTotalMaxHp
      || party.reduce((s, a) => s + (a.resources?.maxHp ?? 0), 0)
    const combinedFrac = totalMaxHp > 0 ? Math.max(0, Math.min(1, combinedHp / totalMaxHp)) : 0
    const winChance  = this._duelWinChance(combinedFrac)
    const partyWins  = Math.random() < winChance
    // Stashed for the casualty layer — the live death rate scales off the same
    // combined-HP fraction that fed the win-roll (see _scriptLightPartyDuel).
    this._lpCombinedFrac = combinedFrac
    // Drive the boss's attack animation during the duel. BossRenderer._pickState
    // returns 'attack' when _bossState.action is 'slam'/'lunge'; we flip it for
    // each strike. Init to idle so the boss isn't frozen on a stale action.
    this._bossState = { action: 'idle' }

    // Park the party — null their paths so AISystem leaves them in place
    // while the cinematic plays. Same pattern as _shadowMonarch AT_BOSS.
    // `_lpInDuel` tells AdventurerRenderer to hold a weapon-out combat stance,
    // re-swing on a cadence, and always face the boss (cleared in _endLightPartyDuel).
    for (const a of party) { a.path = null; a.goal = { type: 'AT_BOSS' }; a._lpInDuel = true }

    // Boss name for the HUD.
    const archId   = this._gameState.player?.bossArchetypeId
    const bossName = (this._scene?.cache?.json?.get?.('bossArchetypes') ?? [])
      .find(a => a.id === archId)?.name ?? 'YOUR BOSS'

    // Per-archetype flavor cast names for the 3 telegraphed mechanics
    // (tank-buster / AoE / stack). Each cast still does the SAME mechanic —
    // only the name on the boss cast-bar changes — so the fight stays readable
    // while every boss feels distinct. Falls back to the generic names for any
    // archetype not in the table (e.g. a future boss).
    const CASTS = {
      beholder:  { tb: 'EYE OF TYRANNY',  aoe: 'DISINTEGRATION RAY', stack: 'PETRIFYING GAZE' },
      demon:     { tb: 'HELLFIRE BRAND',  aoe: 'INFERNAL CATACLYSM', stack: 'SOUL HARVEST' },
      myconid:   { tb: 'IMPALING STALK',  aoe: 'SPORE BLOOM',        stack: 'FUNGAL EMBRACE' },
      wraith:    { tb: 'SOUL REND',       aoe: 'WAIL OF THE DAMNED', stack: 'SHADOW SHROUD' },
      gnoll:     { tb: 'ALPHA STRIKE',    aoe: 'BLOODMOON HOWL',     stack: 'PACK FRENZY' },
      golem:     { tb: 'SEISMIC SLAM',    aoe: 'EARTHQUAKE',         stack: 'BOULDER BARRAGE' },
      lich:      { tb: 'DEATH COIL',      aoe: 'NECROTIC NOVA',      stack: 'GRASP OF UNDEATH' },
      lizardman: { tb: 'VENOM FANG',      aoe: 'TOXIC DELUGE',       stack: 'CONSTRICT' },
      orc:       { tb: 'SKULL CLEAVER',   aoe: 'WAR STOMP',          stack: 'BRUTAL RUSH' },
      vampire:   { tb: 'CRIMSON LANCE',   aoe: 'BLOOD TEMPEST',      stack: 'SANGUINE EMBRACE' },
      succubus:  { tb: 'HEARTPIERCER',    aoe: 'MAELSTROM OF DESIRE', stack: 'ENTHRALLING KISS' },
      slime:     { tb: 'GELID CRUSH',     aoe: 'ACID SPRAY',         stack: 'ENGULF' },
    }
    const casts = CASTS[archId] ?? { tb: 'TANK BUSTER', aoe: 'MEGAFLARE', stack: 'HOLY WRATH' }

    EventBus.emit('LIGHT_PARTY_DUEL_BEGAN', {
      bossName,
      bossHp:    Math.round(boss.hp),
      bossMaxHp: Math.round(boss.maxHp),
      winChance, partyWins,
      members:   party.map(a => ({
        instanceId: a.instanceId, name: a.name, _lightPartyRole: a._lightPartyRole,
        resources: { hp: a.resources?.hp, maxHp: a.resources?.maxHp },
      })),
    })
    EventBus.emit('BOSS_FIGHT_STARTED', { triggeringAdventurer: _triggerAdv })

    // Stage the arena: center the boss, fan the party into a pull formation
    // facing it, and pan the camera onto the throne so the live fight is
    // actually visible (Solo Leveling pans + locks the cam for its duel).
    // Without this the player only sees frozen statues + DOM text.
    this._setupLightPartyArena(boss, party)

    // Stash the duel context + reset the safety accumulator. _tickLightPartyDuel
    // counts REAL elapsed time (delta is unaffected by scene.time.timeScale) and
    // force-resolves if the scripted beat chain ever fails to finish — a hard
    // anti-freeze backstop mirroring _tickFightAnim's 60s cap.
    this._lpDuel = { boss, party, partyWins }
    this._lpDuelElapsed = 0

    this._scriptLightPartyDuel(boss, party, partyWins, casts)
  }

  // Arena staging. Tweens the boss to chamber centre, fans the party into an
  // arc below it (tank front, melee at the shoulders, ranged + healer back —
  // the FFXIV pull stack), and pans the camera onto the fight. Every Phaser
  // call is optional-chained so a missing tween/camera manager never crashes
  // the duel. Tweens are tracked on _lpDuelTweens for teardown.
  _setupLightPartyArena(boss, party) {
    this._lpDuelTweens = []
    const scene = this._scene
    const TS = Balance.TILE_SIZE
    const room = this._bossRoom
      ?? (this._gameState.dungeon?.rooms ?? []).find(r => r.definitionId === 'boss_chamber')
    const cx = room ? (room.gridX + room.width  / 2) * TS : (boss.worldX ?? 0)
    const cy = room ? (room.gridY + room.height / 2) * TS : (boss.worldY ?? 0)

    const tween = (target, props, ms = 600, ease = 'Sine.easeInOut') => {
      const t = scene?.tweens?.add?.({ targets: target, ...props, duration: ms, ease })
      if (t) this._lpDuelTweens.push(t)
    }

    // Boss drifts to centre, slightly up so the party fans below it.
    tween(boss, { worldX: cx, worldY: cy - TS * 0.5 }, 700)

    const slot = {
      tank:      { x: 0,         y: TS * 2.2 },
      meleeDps:  { x: -TS * 1.6, y: TS * 2.6 },
      rangedDps: { x:  TS * 2.0, y: TS * 3.4 },
      healer:    { x:  TS * 0.2, y: TS * 4.0 },
    }
    const seen = {}
    for (const a of party) {
      const r = a._lightPartyRole
      const base = slot[r] ?? { x: 0, y: TS * 3 }
      const dupN = (seen[r] = (seen[r] ?? 0) + 1) - 1
      const hx = cx + base.x + dupN * TS
      const hy = cy + base.y
      tween(a, { worldX: hx, worldY: hy }, 650)
      a._lpHomeX = hx; a._lpHomeY = hy   // resting pos for lunge/recoil tweens
    }
    this._lpBossX = cx
    this._lpBossY = cy - TS * 0.5

    // NOTE: do NOT pan/zoom the camera from here. Game._onBossFightZoomIn —
    // wired to LIGHT_PARTY_DUEL_BEGAN (emitted just before this runs) — does the
    // cinematic push-in onto the throne AND locks the camera (_duelCamLock) for
    // the whole duel + outro. A pan here would fight that zoom tween.
  }

  // Per-frame layer for the light-party duel. The fight is scripted on timers
  // (see _scriptLightPartyDuel) so all that's left to do every frame is keep
  // the boss's "wander home" drift suppressed + run the arena glow so the
  // throne reddens as the boss is worn down (matching the normal fight cam).
  // Deliberately tiny — the choreography lives in the tween-driven beats.
  _tickLightPartyDuel(delta) {
    // Reuse the standard arena glow so the floor reacts to boss HP. Guard
    // so a missing graphics layer can't throw mid-duel.
    try { this._tickArenaGlow?.() } catch {}
    // Once the duel resolves, an outro cutscene owns the rest of the timeline
    // (duty banner + dialogue + recall/death beats). Tick it and skip the
    // duel backstop below (which keys off _lpDuel, now null during the outro).
    if (this._lpOutro) { this._tickLightPartyOutro(delta); return }
    // ── Total-party-wipe → boss win (2026-05-31) ────────────────────────────
    // If EVERY party member is dead while the duel is still live, the boss has
    // won outright — resolve RIGHT NOW as a boss win (force partyWins=false,
    // regardless of the rolled outcome) so the loss outro plays immediately
    // instead of the day hanging on a field of corpses until the scripted
    // 20.5s resolution / 26s backstop. This can only ever trigger on a genuine
    // loss: the win path's downMember guard always spares the last member, so a
    // rolled-win duel is never fully wiped. Guarded on `_lpDuel && !_lpOutro`
    // so it can't double-resolve. (A mid-Raise healer is still `isLive`, so a
    // legitimate in-progress revive never reads as a wipe.)
    if (this._lpDuel) {
      const { boss, party } = this._lpDuel
      const anyAlive = party.some(a => a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
      if (!anyAlive) {
        this._lpDuel = null
        this._resolveLightPartyDuel(boss, party, false)   // boss win
        return
      }
    }
    // Anti-freeze backstop. `delta` is the raw frame delta — NOT scaled by
    // scene.time.timeScale — so this accumulator measures true wall-clock time
    // even if a stray slow-mo lingers. The scripted timeline resolves at ~20.5s;
    // if it hasn't by 26s (beat chain threw, clock stalled, etc.), force the
    // rolled outcome so the duel can never strand `_lightPartyDuel = true` and
    // freeze the day. Must sit COMFORTABLY past the natural resolution or it
    // would cut every fight short. Once it fires, _endLightPartyDuel clears
    // _lpDuel so this won't re-fire.
    this._lpDuelElapsed = (this._lpDuelElapsed ?? 0) + (delta ?? 0)
    if (this._lpDuelElapsed > 26000 && this._lpDuel) {
      const { boss, party, partyWins } = this._lpDuel
      this._lpDuel = null
      this._resolveLightPartyDuel(boss, party, partyWins)
    }
  }

  // Beat sequence — ~26s FFXIV-style raid fight. The win-roll (partyWins) only
  // decides the BOSS's fate; who SURVIVES on the party side is resolved LIVE,
  // mechanic by mechanic (casualties decoupled from outcome, 2026-05-30). The
  // boss actively attacks (slam anim + chunk), periodically focuses the healer
  // (a living tank's Provoke pulls aggro back), and downs members; a downed
  // member triggers a finite, INTERRUPTIBLE healer Raise — succeed = revived at
  // 50%, fail = permanent death (graveyard via _killAdv). A winning party can
  // still take casualties (Pyrrhic); a losing party isn't a guaranteed wipe.
  _scriptLightPartyDuel(boss, party, partyWins, casts = { tb: 'TANK BUSTER', aoe: 'MEGAFLARE', stack: 'HOLY WRATH' }) {
    const scene = this._scene
    const TS    = (ms, fn) => scene?.time?.delayedCall?.(ms, () => { if (!this._lpDuelOver) fn() })
    const TILE  = Balance.TILE_SIZE

    // ── Casualty tuning. lethalPerHit = chance a member targeted by a damaging
    //    mechanic is DOWNED. Scales off the same combined-HP fraction that fed
    //    the win-roll (weaker party bleeds more), much higher on the boss-wins
    //    path so a wipe is earned across the fight, not dumped at the end.
    const cf = this._lpCombinedFrac ?? 0.6
    const lethalPerHit = partyWins
      ? 0.07 + (1 - cf) * 0.13     // win:  ~7-20%  (Pyrrhic possible, FLAWLESS possible)
      : 0.30 + (1 - cf) * 0.32     // loss: ~30-62% (boss carves them down)
    // Reliable healer revives (user spec 2026-06-01): every downed member is
    // queued and Raised one at a time (3s each), then gets back up at 50% and
    // keeps fighting. A down only becomes PERMANENT when no healer is alive to
    // raise them. No finite cap, no interrupt. _lpReviveQueue holds the waiting.
    this._lpReviveQueue = []
    this._lpDuelOver = false
    this._lpLbFired = false         // gates the pre-climax boss-HP floor (hurtBoss)
    this._lpCasualties = []        // names of the permanently dead (finale text)
    this._lpRaise = null           // { healerId, deadAdv } while a Raise channels

    // ── live-roster helpers ──
    const isLive    = (a) => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0
    const aliveAll  = () => party.filter(isLive)
    const aliveRole = (r) => aliveAll().filter(a => a._lightPartyRole === r)
    const aliveTank   = () => aliveRole('tank')[0]   || null
    const aliveHealer = () => aliveRole('healer')[0] || null
    const dpsList     = () => aliveAll().filter(a => a._lightPartyRole === 'meleeDps' || a._lightPartyRole === 'rangedDps')
    const rndOf       = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null

    const emitHp = () => EventBus.emit('LIGHT_PARTY_DUEL_HP', {
      bossHp:    Math.max(0, Math.round(boss?.hp ?? 0)),
      bossMaxHp: Math.max(1, Math.round(boss?.maxHp ?? 1)),
      // Report ALL members (not just living) so a downed row greys + a raised
      // row flares back — the cinematic keys the dead-class off hp<=0.
      members:   party.map(a => ({
        instanceId: a.instanceId,
        hp:    Math.max(0, Math.round(a.resources?.hp ?? 0)),
        maxHp: Math.max(1, Math.round(a.resources?.maxHp ?? 1)),
      })),
    })
    // Drain the boss HP bar. Two rules layered on:
    //  (1) WIN, pre-climax: keep a 6% sliver alive until the LB beat fires, so
    //      chip-damage variance can't zero the bar early and rob the finale.
    //  (2) The instant the bar HITS 0 on a win, the boss dies RIGHT THEN —
    //      resolve immediately instead of waiting out the 25.5s timer. On a loss
    //      the chips never total 100%, so the bar stays up and the boss lives.
    const hurtBoss = (frac) => {
      if (!boss) return
      let next = Math.round((boss.hp ?? 0) - (boss.maxHp ?? 1) * frac)
      if (partyWins && !this._lpLbFired) next = Math.max(next, Math.round((boss.maxHp ?? 1) * 0.06))
      boss.hp = Math.max(0, next)
      if (partyWins && boss.hp <= 0 && !this._lpDuelOver) {
        emitHp()
        this._resolveLightPartyDuel(boss, party, partyWins)
      }
    }
    const healSurvivors = (frac) => {
      for (const a of aliveAll()) {
        a.resources.hp = Math.min(a.resources.maxHp ?? a.resources.hp,
          Math.round(a.resources.hp + (a.resources.maxHp ?? 1) * frac))
      }
    }

    // ── Juice helpers (all guarded so a missing manager never crashes) ──
    const shake = (dur, mag) => scene?.cameras?.main?.shake?.(dur, mag)
    const ring  = (x, y, color, opts = {}) => AbilityVfx.pulseRing?.(scene, x, y, { color, ...opts })
    const float = (x, y, text, color, size = '13px') => AbilityVfx.floatingText?.(scene, x, y, text, { color, fontSize: size })
    const track = (t) => { if (t) (this._lpDuelTweens ??= []).push(t) }
    const bx = () => this._lpBossX ?? boss.worldX
    const by = () => this._lpBossY ?? boss.worldY

    // A DPS dashes in at the boss, strikes, snaps back to its home slot.
    const lunge = (a) => {
      // Bail once the duel resolves so a stray post-resolution lunge can't
      // create a drift tween that survives into the outro.
      if (this._lpDuelOver || !isLive(a) || a._lpHomeX == null) return
      const tx = bx(), ty = by() + TILE * 0.6
      track(scene?.tweens?.add?.({
        targets: a, worldX: tx, worldY: ty, duration: 150, ease: 'Quad.easeIn',
        yoyo: true, hold: 60,
        onYoyo: () => {
          // Per-class strike signature on the connect: melee leaves a crescent
          // blade-arc; the caster conjures runes + a bolt. Both punch a small
          // layered impact on the boss.
          const melee = a._lightPartyRole === 'meleeDps'
          const c = melee ? 0xcfe8ff : 0xc9a9ff
          if (melee) {
            AbilityVfx.bladeArc?.(scene, tx, ty - TILE * 0.2, { color: c, radius: 34, angle: Math.PI * 0.5 + (Math.random() - 0.5) * 0.7, sweep: 2.4 })
          } else {
            AbilityVfx.runeSigil?.(scene, (a.worldX ?? tx), (a.worldY ?? ty) - TILE * 0.3, { color: c, count: 3 })
            AbilityVfx.lightning?.(scene, (a.worldX ?? tx), (a.worldY ?? ty) - 8, tx, ty, { color: c, thickness: 2 })
          }
          AbilityVfx.impactBurst?.(scene, tx, ty - TILE * 0.15, { color: c, radius: 48, sparks: 6, debris: 3, durationMs: 360 })
        },
        onComplete: () => { a.worldX = a._lpHomeX; a.worldY = a._lpHomeY },
      }))
      // Every visible strike now reflects on the boss HP bar (lunges used to be
      // pure animation with no damage). Small per-hit chip; the named beats do
      // the big chunks. On a loss these stay tiny so the bar never empties.
      hurtBoss(partyWins ? 0.012 : 0.004)
      emitHp()
    }
    const recoilBoss = (mag = TILE * 0.5) => {
      if (!boss || this._lpBossY == null) return
      track(scene?.tweens?.add?.({ targets: boss, worldY: this._lpBossY - mag, duration: 110, ease: 'Quad.easeOut', yoyo: true }))
    }
    const scatter = () => {
      for (const a of aliveAll()) {
        if (a._lpHomeX == null) continue
        const sgn = (a._lpHomeX - bx()) >= 0 ? 1 : -1
        track(scene?.tweens?.add?.({
          targets: a, worldX: a._lpHomeX + sgn * TILE * 1.4, duration: 200, ease: 'Quad.easeOut',
          yoyo: true, hold: 250, onComplete: () => { a.worldX = a._lpHomeX; a.worldY = a._lpHomeY },
        }))
      }
    }
    const stackUp = () => {
      const tank = aliveTank()
      const tx = tank?._lpHomeX ?? bx(), ty = tank?._lpHomeY ?? by()
      for (const a of aliveAll()) {
        if (a._lpHomeX == null || a === tank) continue
        track(scene?.tweens?.add?.({
          targets: a, worldX: tx + (Math.random() - 0.5) * TILE, worldY: ty + (Math.random() - 0.5) * TILE,
          duration: 240, ease: 'Quad.easeInOut', yoyo: true, hold: 300,
          onComplete: () => { a.worldX = a._lpHomeX; a.worldY = a._lpHomeY },
        }))
      }
    }
    // A member flinches (quick red ring) when hit.
    const flinch = (m) => ring(m.worldX ?? bx(), m.worldY ?? by(), 0xff5544, { radius: 12 })

    // ── Casualty + revive pipeline ──────────────────────────────────────
    // A member drops to 0 HP → death anim plays (corpse pose in the renderer).
    // If a healer is alive, the member is QUEUED and Raised one at a time (3s
    // channel each) → back up at 50% → keeps fighting. A down only sticks
    // (permanent) when no healer is alive to raise them.
    const permaKill = (m) => {
      if (!m || m.aiState === 'dead') return
      this._lpCasualties.push(m.name || 'A hero')
      // If the dying member is the healer mid-Raise, that Raise dies with them.
      if (this._lpRaise && this._lpRaise.healerId === m.instanceId) this._lpRaise = null
      // Drop them from the revive queue if they were waiting their turn.
      const qi = this._lpReviveQueue.indexOf(m); if (qi >= 0) this._lpReviveQueue.splice(qi, 1)
      this._killAdv(m, 'boss')   // graveyard + ADVENTURER_DIED + counters
      emitHp()
    }
    const deathMoment = (m) => {
      shake(220, 0.012)
      float(m.worldX ?? bx(), (m.worldY ?? by()) - TILE, `✖ ${m.name || ''}`, '#ff5544', '12px')
      // Micro slow-mo via window.setTimeout (real-time restore — immune to the
      // scaled clock, so it can never strand the beat timeline).
      if (scene?.time) { scene.time.timeScale = 0.45; window.setTimeout(() => { if (scene?.time) scene.time.timeScale = 1 }, 180) }
    }
    // Pull the next still-down member off the queue and Raise them — one channel
    // at a time. With no healer left, every queued down becomes permanent.
    const processReviveQueue = () => {
      if (this._lpDuelOver || this._lpRaise) return
      const healer = aliveHealer()
      if (!healer) {
        while (this._lpReviveQueue.length) {
          const d = this._lpReviveQueue.shift()
          if (d && d.aiState !== 'dead' && (d.resources?.hp ?? 0) <= 0) permaKill(d)
        }
        return
      }
      let next = null
      while (this._lpReviveQueue.length) {
        const d = this._lpReviveQueue.shift()
        if (d && d !== healer && d.aiState !== 'dead' && (d.resources?.hp ?? 0) <= 0) { next = d; break }
      }
      if (next) startRaise(healer, next)
    }
    const startRaise = (healer, dead) => {
      this._lpRaise = { healerId: healer.instanceId, deadAdv: dead }
      EventBus.emit('LIGHT_PARTY_RAISE_STARTED', { healerId: healer.instanceId, deadId: dead.instanceId, durationMs: 3000 })
      // World channel tell — gold motes gather on the corpse + a tether beam
      // from the healer, pulsed across the 3s cast so the Raise reads in-world.
      const channel = () => {
        if (this._lpDuelOver || this._lpRaise?.deadAdv !== dead || !isLive(healer)) return
        AbilityVfx.chargeUp?.(scene, dead.worldX ?? bx(), dead.worldY ?? by(), { color: 0xffe9a8, radius: 46, durationMs: 700 })
        AbilityVfx.lightning?.(scene, healer.worldX ?? bx(), (healer.worldY ?? by()) - 8, dead.worldX ?? bx(), dead.worldY ?? by(), { color: 0xffd66b, thickness: 2, jitter: 6 })
      }
      channel()
      scene?.time?.delayedCall?.(1000, channel)
      scene?.time?.delayedCall?.(2000, channel)
      TS(3000, () => {
        // Healer fell mid-channel → the member they were raising stays dead.
        if (!isLive(healer)) {
          if (this._lpRaise && this._lpRaise.deadAdv === dead) { this._lpRaise = null; permaKill(dead) }
          processReviveQueue()
          return
        }
        // Bring them back up at 50% — they re-enter the fight on the next tick.
        if (this._lpRaise && this._lpRaise.deadAdv === dead) {
          this._lpRaise = null
          dead.aiState = 'idle'
          dead.resources.hp = Math.max(1, Math.round((dead.resources.maxHp ?? 1) * 0.50))
          EventBus.emit('LIGHT_PARTY_RAISED', { healerId: healer.instanceId, raisedId: dead.instanceId })
          AbilityVfx.resurrectBeam?.(scene, dead.worldX ?? bx(), dead.worldY ?? by(), { color: 0xffe9a8 })
          float(dead.worldX ?? bx(), (dead.worldY ?? by()) - TILE, 'RAISED', '#ffd66b')
          emitHp()
        }
        processReviveQueue()   // start the next queued revive, if any
      })
    }
    const downMember = (m) => {
      if (!m || m.aiState === 'dead' || this._lpReviveQueue.includes(m)) return
      // Win path always leaves >=1 survivor to Recall out (per design: a win
      // means at least one hero walks home). If m is the last one standing on
      // a winning fight, spare them with a sliver of HP instead of downing.
      if (partyWins && aliveAll().filter(a => a !== m).length === 0) {
        m.resources.hp = Math.max(1, Math.round((m.resources.maxHp ?? 1) * 0.12))
        emitHp()
        return
      }
      m.resources.hp = 0
      emitHp()
      deathMoment(m)             // death anim plays out
      const healer = aliveHealer()
      if (healer && healer !== m) {
        this._lpReviveQueue.push(m)   // healer Raises them (3s each, in turn)
        processReviveQueue()
      } else {
        permaKill(m)             // no healer alive to raise them → permanent
      }
    }
    // Apply a damaging mechanic to one member: chunk + a downing roll.
    const strike = (m, dmgFrac, lethalMult = 1) => {
      if (!isLive(m)) return
      m.resources.hp = Math.max(0, Math.round(m.resources.hp - (m.resources.maxHp ?? 1) * dmgFrac))
      flinch(m)
      if (m.resources.hp <= 0 || Math.random() < lethalPerHit * lethalMult) downMember(m)
      else emitHp()
    }

    // ── Boss auto-attack loop (every ~2.6s) ─────────────────────────────
    // The boss slams a target with a real attack anim + lunge. It periodically
    // FOCUSES the healer; a living tank's Provoke redirects that to the tank
    // (he steps in front). Hitting the healer no longer interrupts a Raise
    // (revives are reliable) — it only chips her; killing her outright is what
    // ends future revives.
    this._lpDuelTimers = []
    const bossSlam = () => {
      if (this._lpDuelOver) return
      const tank = aliveTank(), healer = aliveHealer()
      const wantHealer = healer && Math.random() < 0.35
      // Provoke: if the boss wants the healer but a tank lives, the tank eats it.
      const target = (wantHealer && tank) ? tank : (wantHealer ? healer : (tank || rndOf(aliveAll())))
      if (!target) return
      // Boss faces + winds up: attack anim for ~420ms, lunge toward the target.
      this._bossState = { action: 'slam' }
      EventBus.emit('LIGHT_PARTY_DUEL_BOSS_ATTACK', { phase: 'windup' })   // SFX: boss swing
      scene?.time?.delayedCall?.(440, () => { if (!this._lpDuelOver) this._bossState = { action: 'idle' } })
      const tx = (target.worldX ?? bx()), ty = (target.worldY ?? by())
      // Wind-up tells: energy gathers on the boss + a quick red "incoming" ring
      // snaps onto the target so the slam reads before it lands.
      AbilityVfx.chargeUp?.(scene, bx(), by(), { color: 0xff6a3a, radius: 48, durationMs: 240 })
      AbilityVfx.pulseRing?.(scene, tx, ty, { color: 0xff5544, fromR: 8, toR: 30, thickness: 2, durationMs: 220 })
      track(scene?.tweens?.add?.({
        targets: boss, worldX: bx() + (tx - bx()) * 0.6, worldY: by() + (ty - by()) * 0.6,
        duration: 170, ease: 'Quad.easeIn', yoyo: true, hold: 40,
        onComplete: () => { boss.worldX = bx(); boss.worldY = by() },
      }))
      // Impact lands mid-lunge.
      TS(180, () => {
        const ix = target.worldX ?? tx, iy = target.worldY ?? ty
        flinch(target); shake(150, 0.008)
        AbilityVfx.impactBurst?.(scene, ix, iy, { color: 0xff6a3a, radius: 66, sparks: 8, debris: 4, durationMs: 380, decal: 1400 })
        // Auto-attacks chip but rarely one-shot — the named mechanics are the
        // real killers. Tank-targeted hits hurt less (he's built for it).
        const dmg = (target._lightPartyRole === 'tank' ? 0.05 : 0.08) + Math.random() * 0.03
        strike(target, dmg, 0.4)
        EventBus.emit('LIGHT_PARTY_DUEL_BOSS_ATTACK', { phase: 'hit', damage: Math.max(1, Math.round((target.resources?.maxHp ?? 1) * dmg)) })  // SFX: impact
        // Splash: shockwave from the slam chips every OTHER living member a
        // little so all four HP bars visibly march downward on every slam.
        // lethalMult 0 = purely cosmetic pressure (splash can never down anyone;
        // only the primary target above can be downed).
        for (const m of aliveAll()) {
          if (m === target) continue
          strike(m, 0.025 + Math.random() * 0.015, 0)
        }
      })
    }
    const slamLoop = scene?.time?.addEvent?.({ delay: 2600, loop: true, callback: bossSlam })
    if (slamLoop) this._lpDuelTimers.push(slamLoop)
    // Continuous DPS uptime so the party never looks idle between beats.
    const lungeLoop = scene?.time?.addEvent?.({
      delay: 850, loop: true,
      callback: () => { if (this._lpDuelOver) return; const a = rndOf(dpsList()); if (a) lunge(a) },
    })
    if (lungeLoop) this._lpDuelTimers.push(lungeLoop)

    // ── Beat timeline (~21s) ────────────────────────────────────────────
    // Tightened 5s on 2026-05-30 (was ~26s) — same beats, shorter gaps; the
    // three cast durationMs values match their cast→resolve gap exactly.
    // 0.8s — the pull. First contact.
    TS(800, () => {
      EventBus.emit('LIGHT_PARTY_DUEL_BEAT', { kind: 'aoe', label: 'PULL' })
      AbilityVfx.shockwave?.(scene, bx(), by(), { color: 0x6aaaff, toR: 110, thickness: 6, durationMs: 520 })
      AbilityVfx.impactBurst?.(scene, bx(), by(), { color: 0x6aaaff, radius: 90, sparks: 12, debris: 5, durationMs: 480 })
      shake(150, 0.005)
    })
    // 2.3s — boss winds up a TANK-BUSTER (cast bar + a red cleave-LINE telegraph
    // from the boss onto the tank that fills over the cast, then detonates).
    TS(2300, () => {
      EventBus.emit('LIGHT_PARTY_DUEL_CAST', { name: casts.tb, durationMs: 2000 })
      const t = aliveTank()
      if (t) {
        const ang = Math.atan2((t.worldY ?? by()) - by(), (t.worldX ?? bx()) - bx())
        AbilityVfx.groundTelegraph?.(scene, bx(), by(), { shape: 'line', color: 0xff3030, angle: ang, length: 240, width: 58, durationMs: 2000 })
        AbilityVfx.chargeUp?.(scene, bx(), by(), { color: 0xff5544, radius: 64, durationMs: 700 })
      }
    })
    // 4.3s — tank-buster lands. The tank pops Hallowed Ground if he can (gold
    // flash, survives); otherwise eats a heavy hit. DPS keep chipping the boss.
    TS(4300, () => {
      EventBus.emit('LIGHT_PARTY_DUEL_BEAT', { kind: 'tankbuster', label: 'TANK BUSTER' })
      const t = aliveTank()
      // Boss hurls a focused bolt at the tank; he either raises a gold shield
      // dome (Hallowed Ground) or eats it.
      if (t) {
        AbilityVfx.lightning?.(scene, bx(), by(), t.worldX, t.worldY, { color: 0xff5544, thickness: 4, jitter: 18 })
        if (Math.random() < 0.6) {
          AbilityVfx.domeShield?.(scene, t.worldX, t.worldY, { color: 0xffd66b, radius: 44, holdMs: 500 })
          AbilityVfx.burstRays?.(scene, t.worldX, t.worldY, { color: 0xfff2c0, count: 10, length: 70 })
          float(t.worldX, t.worldY - TILE, 'HALLOWED GROUND', '#ffd66b', '11px')
        } else { AbilityVfx.impactBurst?.(scene, t.worldX, t.worldY, { color: 0xff5544, radius: 96, sparks: 12, debris: 6, durationMs: 520, decal: 1600 }); strike(t, 0.34, 1.3) }
      }
      shake(260, 0.010); hurtBoss(partyWins ? 0.12 : 0.06); recoilBoss(); emitHp()
    })
    // 5.8s — DPS burst window.
    TS(5800, () => { for (const a of dpsList()) lunge(a); hurtBoss(partyWins ? 0.12 : 0.05); emitHp() })
    // 7s — boss winds up a raid-wide AoE: a huge filling circle telegraph + a
    //      summoning sigil on the boss.
    TS(7000, () => {
      EventBus.emit('LIGHT_PARTY_DUEL_CAST', { name: casts.aoe, durationMs: 2600 })
      AbilityVfx.groundTelegraph?.(scene, bx(), by(), { shape: 'circle', color: 0xff7a2a, radius: 200, durationMs: 2600 })
      AbilityVfx.magicCircle?.(scene, bx(), by(), { color: 0xff9a3a, radius: 120, durationMs: 2600 })
    })
    // 9.6s — AoE resolves: everyone scatters; the WHOLE party eats it so all
    //        bars drop together (tank takes a reduced share — mitigation).
    TS(9600, () => {
      EventBus.emit('LIGHT_PARTY_DUEL_BEAT', { kind: 'aoe', label: 'DODGE!' })
      scatter(); shake(380, 0.015)
      AbilityVfx.screenFlash?.(scene, { color: 0xff8a3a, durationMs: 240, intensity: 0.32 })
      AbilityVfx.impactBurst?.(scene, bx(), by(), { color: 0xff8a3a, radius: 200, sparks: 22, debris: 10, durationMs: 640, decal: 2000 })
      AbilityVfx.godRays?.(scene, bx(), by(), { color: 0xffb060, count: 14, length: 200, durationMs: 700 })
      AbilityVfx.emberField?.(scene, bx(), by(), { color: 0xff9a3a, count: 14, area: 200, durationMs: 1300 })
      for (const m of aliveAll()) strike(m, m._lightPartyRole === 'tank' ? 0.08 : 0.12, 1.0)
      hurtBoss(partyWins ? 0.10 : 0.05); recoilBoss(); emitHp()
    })
    // 11s — healer recovery window (green pulses, top up survivors).
    TS(11000, () => { healSurvivors(0.10); for (const a of aliveAll()) ring(a.worldX, a.worldY, 0x6ad497, { radius: 16 }); EventBus.emit('ALLY_HEALED', {}); emitHp() })
    // 12.6s — boss winds up a STACK marker on the tank (party clusters to share).
    TS(12600, () => {
      EventBus.emit('LIGHT_PARTY_DUEL_CAST', { name: casts.stack, durationMs: 2200 })
      const t = aliveTank()
      AbilityVfx.stackMarker?.(scene, t?.worldX ?? bx(), t?.worldY ?? by(), { color: 0xffd66b, radius: 64, durationMs: 2200 })
    })
    // 14.8s — stack resolves: cluster on the tank to share it; the whole party
    //        soaks together (tank takes a reduced share for clustering it).
    TS(14800, () => {
      EventBus.emit('LIGHT_PARTY_DUEL_BEAT', { kind: 'stack', label: 'STACK!' })
      stackUp(); shake(320, 0.012)
      const _tk = aliveTank()
      const sx = _tk?.worldX ?? bx(), sy = _tk?.worldY ?? by()
      AbilityVfx.impactBurst?.(scene, sx, sy, { color: 0xffd66b, radius: 112, sparks: 16, debris: 6, durationMs: 560 })
      AbilityVfx.burstRays?.(scene, sx, sy, { color: 0xfff2c0, count: 12, length: 92 })
      for (const m of aliveAll()) strike(m, m._lightPartyRole === 'tank' ? 0.08 : 0.12, 0.9)
      hurtBoss(partyWins ? 0.12 : 0.05); recoilBoss(); emitHp()
    })
    // 16.6s — DPS burst.
    TS(16600, () => { for (const a of dpsList()) lunge(a); hurtBoss(partyWins ? 0.14 : 0.05); emitHp() })
    // 18.5s — LB3 CLIMAX. Win: party converges, Limit Break craters the boss.
    //         Loss: a desperate LB that fails — the boss answers with carnage.
    TS(18500, () => {
      EventBus.emit('LIGHT_PARTY_DUEL_BEAT', { kind: 'lb3', label: partyWins ? 'METEOR!' : 'DESPERATE LB!' })
      shake(520, 0.02); scene?.time?.delayedCall?.(120, () => { if (!this._lpDuelOver) shake(300, 0.014) })
      if (partyWins) {
        this._lpLbFired = true   // releases the pre-climax HP floor in hurtBoss
        // ── METEOR finale — the showstopper. ──────────────────────────────
        // Wind-up: a summoning sigil blooms under the throne, every hero
        // converges + channels (converging motes), the screen warms, the title
        // punches in.
        AbilityVfx.magicCircle?.(scene, bx(), by(), { color: 0xffd66b, radius: 155, durationMs: 1400 })
        AbilityVfx.screenFlash?.(scene, { color: 0xfff2c0, durationMs: 300, intensity: 0.32 })
        for (const a of aliveAll()) {
          AbilityVfx.chargeUp?.(scene, a.worldX ?? bx(), a.worldY ?? by(), { color: 0xffe27a, radius: 62, durationMs: 520 })
          lunge(a)
          AbilityVfx.lightning?.(scene, a.worldX ?? bx(), (a.worldY ?? by()) - 10, bx(), by(), { color: 0xffe27a })
        }
        float(bx(), by() - TILE * 1.4, 'LIMIT BREAK', '#ffd66b', '17px')
        // Release (~450ms): the heavens open — god-rays, a colossal pillar, flash.
        scene?.time?.delayedCall?.(450, () => {
          if (this._lpDuelOver) return
          AbilityVfx.screenFlash?.(scene, { color: 0xffffff, durationMs: 420, intensity: 0.7 })
          AbilityVfx.godRays?.(scene, bx(), by(), { color: 0xfff2c0, count: 18, length: 260, durationMs: 1000 })
          AbilityVfx.beamPillar?.(scene, bx(), by(), { color: 0xfff7d8, height: 360, width: 72, durationMs: 800 })
          AbilityVfx.burstRays?.(scene, bx(), by(), { color: 0xfff2c0, count: 18, length: 170 })
        })
        // Meteor barrage — 8 staggered strikes cratering the throne; the LAST is
        // the killing blow (hit-stop + white flash + boss recoil + HP crater).
        const METEORS = 8
        for (let i = 0; i < METEORS; i++) {
          const last = i === METEORS - 1
          scene?.time?.delayedCall?.(500 + i * 95, () => {
            if (this._lpDuelOver) return
            const ox = bx() + (Math.random() - 0.5) * TILE * 2.6
            const oy = by() + (Math.random() - 0.5) * TILE * 1.6
            AbilityVfx.meteor?.(scene, ox, oy, { color: 0xff8a3a, onImpact: () => {
              AbilityVfx.impactBurst?.(scene, ox, oy, {
                color: 0xff7a2a, radius: last ? 180 : 92, sparks: last ? 22 : 8,
                debris: last ? 10 : 4, durationMs: last ? 640 : 420, decal: last ? 2400 : false })
              if (last) {
                AbilityVfx.hitStop?.(scene, 110)
                AbilityVfx.screenFlash?.(scene, { color: 0xffffff, durationMs: 320, intensity: 0.8 })
                AbilityVfx.emberField?.(scene, bx(), by(), { color: 0xff9a3a, count: 18, area: 220, durationMs: 1500 })
                recoilBoss(TILE * 1.6); hurtBoss(0.6)   // craters the boss → triggers the win resolve
              }
            } })
            shake(last ? 340 : 150, last ? 0.022 : 0.01)
          })
        }
      } else {
        // Desperate LB — a gold flicker that gutters out, then the boss ERUPTS,
        // a dark cataclysm cratering the throne + punishing 1-2 members hard.
        AbilityVfx.magicCircle?.(scene, bx(), by(), { color: 0x8a6a2a, radius: 120, durationMs: 600 })
        scene?.time?.delayedCall?.(420, () => {
          if (this._lpDuelOver) return
          AbilityVfx.hitStop?.(scene, 80)
          AbilityVfx.screenFlash?.(scene, { color: 0xff3b1e, durationMs: 380, intensity: 0.55 })
          AbilityVfx.impactBurst?.(scene, bx(), by(), { color: 0xff4422, radius: 190, sparks: 22, debris: 10, durationMs: 640, decal: 2200 })
          AbilityVfx.emberField?.(scene, bx(), by(), { color: 0xff5a2a, count: 16, area: 200, durationMs: 1400 })
          const pool = aliveAll(); const hits = pool.length > 1 ? 2 : 1
          for (let i = 0; i < hits; i++) {
            const m = rndOf(aliveAll())
            if (m) {
              AbilityVfx.lightning?.(scene, bx(), by(), m.worldX ?? bx(), m.worldY ?? by(), { color: 0xff6b4a, thickness: 4 })
              AbilityVfx.impactBurst?.(scene, m.worldX ?? bx(), m.worldY ?? by(), { color: 0xff4422, radius: 70, sparks: 8, debris: 4, durationMs: 420 })
              strike(m, 0.35, 1.5)
            }
          }
        })
      }
      emitHp()
    })
    // 20.5s — resolution.
    TS(20500, () => this._resolveLightPartyDuel(boss, party, partyWins))
  }

  _resolveLightPartyDuel(boss, party, partyWins) {
    if (!boss) { this._endLightPartyDuel(); return }
    // Stop the beat timeline + loops from firing into the resolution.
    this._lpDuelOver = true
    // The fight is decided — drop the live combat stance so members stop
    // swinging at (and facing) a now-dead boss through the multi-second outro.
    // (_endLightPartyDuel also deletes this; clearing here makes it stop the
    // instant the boss dies / the party wipes, not only at final teardown.)
    for (const a of party) { if (a) a._lpInDuel = false }
    const scene = this._scene
    // Freeze the arena for the outro: kill every movement tween + the
    // slam/lunge loop timers so the members (and the boss) hold position while
    // they speak their lines and Recall out. Without this the continuous lunge
    // loop keeps yanking the DPS toward the throne all through the cutscene.
    // Snap each member back to its resting formation slot in case a lunge was
    // mid-flight. (Idempotent — _endLightPartyDuel repeats the teardown.)
    for (const t of this._lpDuelTweens ?? []) { try { t.remove?.() ?? t.stop?.() } catch {} }
    this._lpDuelTweens = []
    for (const tm of this._lpDuelTimers ?? []) { try { tm.remove?.(false) } catch {} }
    this._lpDuelTimers = []
    for (const a of party) { if (a._lpHomeX != null) { a.worldX = a._lpHomeX; a.worldY = a._lpHomeY } }
    // A member still mid-Raise when the fight ends never gets brought back.
    if (this._lpRaise?.deadAdv && this._lpRaise.deadAdv.aiState !== 'dead') {
      const d = this._lpRaise.deadAdv
      this._lpCasualties ??= []
      this._lpCasualties.push(d.name || 'A hero')
      this._killAdv(d, 'boss')
    }
    this._lpRaise = null
    // Sweep any downed-but-not-dead stragglers (hp 0, no raise) into real deaths
    // so none linger in the active list.
    for (const a of party) {
      if (a.aiState !== 'dead' && (a.resources?.hp ?? 0) <= 0) {
        this._lpCasualties ??= []
        this._lpCasualties.push(a.name || 'A hero')
        this._killAdv(a, 'boss')
      }
    }

    const casualties = this._lpCasualties ?? []
    // Human-readable casualty list, capped so the finale sub doesn't overflow.
    const nameList = () => {
      if (casualties.length === 0) return ''
      if (casualties.length <= 2) return casualties.join(' and ')
      return `${casualties[0]}, ${casualties[1]} and ${casualties.length - 2} more`
    }

    // Killing-blow punch — hard shake (+ brief slow-mo on a boss death).
    scene?.cameras?.main?.shake?.(partyWins ? 480 : 320, partyWins ? 0.018 : 0.012)
    if (partyWins && scene?.time) {
      scene.time.timeScale = 0.25
      window.setTimeout(() => { if (scene?.time) scene.time.timeScale = 1 }, 400)
    }

    // Members still standing at resolution. The win casualty layer clamps the
    // last member alive (see downMember), so a win ALWAYS has >=1 survivor to
    // Recall out. nameList/casualties retained for any future use.
    void nameList
    const living = party.filter(a => a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)

    if (partyWins) {
      // Set up the WIN outro FIRST. BOSS_FIGHT_RESOLVED (emitted just below)
      // triggers Game._onBossFightZoomOut, which checks _lpOutro to decide
      // whether to release the camera lock. If _lpOutro weren't set yet, the
      // lock would drop the instant the boss falls and the whole outro (lines
      // -> Recall -> teleport) would play un-zoomed. Sequence once the banner
      // shows: DUTY COMPLETE -> victory lines (+ mourning if any fell) ->
      // Recall cast -> teleport out -> summary.
      this._lpOutro = {
        kind: 'win', phase: 'init', t: 0, watchdog: 0, said: 0,
        survivors: living, casualties: casualties.slice(),
      }
      // Boss falls NOW so the collapse reads under the DUTY COMPLETE banner.
      // Book-keeping mirrors a normal-fight party win.
      boss.hp = 0
      boss.deathsRemaining = Math.max(0, (boss.deathsRemaining ?? 0) - 1)
      boss._diedThisDay    = true
      this._deathPoseUntil = Infinity
      EventBus.emit('BOSS_FIGHT_RESOLVED', {
        winner: 'party', bossHpRemaining: 0, deathsRemaining: boss.deathsRemaining,
        rounds: 1, roundLog: [],
        party: party.map(a => ({ instanceId: a.instanceId, name: a.name, hp: a.resources?.hp ?? 0 })),
      })
      // Light Party VICTORY metric (gates the Warrior of Light achievement).
      EventBus.emit('LIGHT_PARTY_DEFEATED_BOSS', { partySize: party.length })
      if (boss.deathsRemaining <= 0) {
        EventBus.emit('BOSS_DEFEATED_FINAL', { totalDays: this._gameState.player?.totalDaysElapsed })
      }
    } else {
      // Boss wins. A lone survivor may flee to tell the tale (25% when anyone
      // is still up); the rest fall in the death-anim beat. The boss-side
      // BOSS_FIGHT_RESOLVED + LIGHT_PARTY_DUEL_END fire at outro finish.
      let fleer = null
      if (living.length > 0 && Math.random() < 0.25) fleer = living[Math.floor(Math.random() * living.length)]
      const doomed = living.filter(a => a !== fleer)
      this._lpOutro = {
        kind: 'loss', phase: 'init', t: 0, watchdog: 0, said: 0,
        doomed, fleer, casualties: casualties.slice(),
      }
    }
    // Stop the duel-timeline backstop now that an outro owns the timing.
    // _lpDuel = null so _tickLightPartyDuel won't re-resolve; _lightPartyDuel
    // stays TRUE so the boss keeps facing the party, the camera stays on the
    // throne, and DayPhase holds the day-end timer until the outro finishes.
    this._lpDuel = null
  }

  // ── Light Party win/loss OUTRO cutscene ────────────────────────────────
  // Driven by accumulating raw dt (ms) — NOT scene.time.delayedCall — so a
  // lingering slow-mo can't stall it (same robustness as Solo Leveling's
  // _tickDuelOutro). Ticked from _tickLightPartyDuel while this._lpOutro is set.
  _tickLightPartyOutro(dt) {
    const O = this._lpOutro
    if (!O) return
    O.t += dt; O.watchdog += dt
    if (O.watchdog > 20000) { this._finishLightPartyOutro(); return }  // hard backstop
    const scene = this._scene
    const TILE  = Balance.TILE_SIZE
    const ring  = (x, y, c, o = {}) => AbilityVfx.pulseRing?.(scene, x, y, { color: c, ...o })
    const float = (x, y, t, c, s = '12px') => { if (t) AbilityVfx.floatingText?.(scene, x, y, t, { color: c, fontSize: s }) }
    const banner = (kind) => EventBus.emit('LIGHT_PARTY_DUTY_BANNER', { kind })
    // SfxSystem has NO generic SFX_PLAY cue — it maps specific EventBus events
    // to sounds. ADVENTURER_TELEPORTED is the one whose only listener is
    // SfxSystem (-> sfx-teleport), so it's safe to fire for the Recall whoosh.
    // The win boom (sfx-boss-death) already played via BOSS_FIGHT_RESOLVED at
    // resolve, and loss death sounds play via _killAdv, so 'teleport' is the
    // only cue we still need to surface here; the rest are harmless no-ops.
    const sfx = (id) => { if (id === 'teleport') EventBus.emit('ADVENTURER_TELEPORTED', {}) }
    // Speak a scripted line as a REAL adventurer chat bubble (ChatBubbles
    // ADVENTURER_SAY) — identical format to ordinary adventurer chatter,
    // instead of floating combat text. Caller must speak BEFORE killing a
    // member (a dead adv's bubble is culled next frame).
    const say = (m, text, lifeMs = 2600) => { if (m && text) EventBus.emit('ADVENTURER_SAY', { adventurer: m, text, lifeMs }) }

    if (O.kind === 'win') {
      switch (O.phase) {
        case 'init':                                   // boss already collapsed in resolve
          if (O.t > 900) { O.phase = 'banner'; O.t = 0; banner('complete'); sfx('daystart') }
          break
        case 'banner':
          if (O.t > 2400) { O.phase = (O.casualties.length ? 'mourn' : 'lines'); O.t = 0; O.said = 0 }
          break
        case 'mourn':
          if (!O.mournSaid) {
            O.mournSaid = true
            const h = O.survivors.find(a => a._lightPartyRole === 'healer') || O.survivors[0]
            say(h, 'For the fallen.')
          }
          if (O.t > 2600) { O.phase = 'lines'; O.t = 0; O.said = 0 }
          break
        case 'lines': {
          if (O.said < O.survivors.length && O.t > O.said * 1300 + 300) {
            const m = O.survivors[O.said]; O.said++
            say(m, this._lpOutroLine(m._lightPartyRole, 'victory'))
          }
          if (O.said >= O.survivors.length && O.t > O.survivors.length * 1300 + 1200) { O.phase = 'recall'; O.t = 0 }
          break
        }
        case 'recall':
          if (!O.recallFired) {
            O.recallFired = true
            // One spoken "Recall…" (chorus would violate one-bubble-at-a-time);
            // the glow rings below play on EVERY survivor so all are clearly casting.
            say(O.survivors[0], 'Recall…', 3000)
            sfx('teleport')
          }
          // Blue shimmer building over the 3s cast — periodic rings on each.
          if (!O._lastGlow || O.t - O._lastGlow > 380) {
            O._lastGlow = O.t
            for (const m of O.survivors) ring(m.worldX, m.worldY, 0x6aaaff, { radius: 12 + (O.t / 3000) * 18 })
          }
          if (O.t > 3000) { O.phase = 'teleport'; O.t = 0 }
          break
        case 'teleport':
          if (!O.teleported) {
            O.teleported = true
            const active = this._gameState.adventurers?.active ?? []
            for (const m of O.survivors) {
              // Beam-up: stacked bright rings rising off the member, a flash,
              // then splice them from active so the sprite vanishes.
              ring(m.worldX, m.worldY, 0xcfe8ff, { radius: 46 })
              ring(m.worldX, m.worldY - TILE * 0.8, 0xaecbff, { radius: 30 })
              float(m.worldX, (m.worldY ?? 0) - TILE, '↑', '#cfe8ff', '16px')
              const i = active.indexOf(m); if (i >= 0) active.splice(i, 1)
              EventBus.emit('ADVENTURER_FLED', { adventurer: m, reason: 'light_party_recall' })
            }
            scene?.cameras?.main?.flash?.(220, 180, 210, 255)
          }
          if (O.t > 600) { O.phase = 'fade'; O.t = 0 }
          break
        case 'fade':
          if (O.t > 1600) { this._finishLightPartyOutro(); return }
          break
      }
    } else {
      // LOSS
      switch (O.phase) {
        case 'init':
          if (O.t > 400) { O.phase = 'death'; O.t = 0; O.said = 0 }
          break
        case 'death': {
          // Stagger each doomed member's fall. Speak the death line as a REAL
          // chat bubble (say) NOW, then run the actual kill ~750ms later — a
          // dead adv's bubble is culled next frame, so the kill must trail the
          // line or the player never reads it. The DayPhase day-end gate holds
          // while _lightPartyDuel is true.
          O.kills = O.kills || []
          if (O.said < O.doomed.length && O.t > O.said * 1400 + 200) {
            const m = O.doomed[O.said]; O.said++
            if (m && m.aiState !== 'dead') {
              scene?.cameras?.main?.shake?.(170, 0.009)
              say(m, this._lpOutroLine(m._lightPartyRole, 'death'))
              ring(m.worldX, m.worldY, 0xff5544, { radius: 16 })
              O.kills.push({ m, at: O.t + 800 })   // the death anim + book-keep lands after the line
            }
          }
          // Drain kills whose delay has elapsed.
          O.kills = O.kills.filter(k => {
            if (O.t >= k.at) { if (k.m.aiState !== 'dead') this._killAdv(k.m, 'boss'); return false }
            return true
          })
          if (O.said >= O.doomed.length && O.kills.length === 0 && O.t > O.doomed.length * 1400 + 1200) { O.phase = 'banner'; O.t = 0 }
          break
        }
        case 'banner':
          if (!O.bannerShown) { O.bannerShown = true; banner('failed'); sfx('error') }
          if (O.t > 2400) { this._finishLightPartyOutro(); return }
          break
      }
    }
  }

  // Outro teardown — fires the loss-side book-keeping (the win side already
  // fired at resolve), the achievement-gating LIGHT_PARTY_DUEL_END, flees a
  // lone loss-survivor, then ends the duel so the day can roll to the summary.
  _finishLightPartyOutro() {
    const O = this._lpOutro
    this._lpOutro = null
    if (O?.kind === 'loss') {
      const boss = this._gameState.boss
      EventBus.emit('BOSS_FIGHT_RESOLVED', {
        winner: 'boss',
        bossHpRemaining: Math.max(0, Math.round(boss?.hp ?? 0)),
        deathsRemaining: boss?.deathsRemaining ?? 0,
        rounds: 1, roundLog: [],
        party: [],
      })
      EventBus.emit('LIGHT_PARTY_DUEL_END', { outcome: 'loss' })
      if (O.fleer) this._handOffToAIFlee(O.fleer, 'boss_stalemate')
    } else {
      EventBus.emit('LIGHT_PARTY_DUEL_END', { outcome: 'win' })
    }
    this._endLightPartyDuel()
  }

  // Role-flavored outro one-liners (FFXIV-toned). kind: 'victory' | 'death'.
  _lpOutroLine(role, kind) {
    const L = {
      tank: {
        victory: ['The Light holds.', 'Our shield endures.', 'Duty fulfilled.'],
        death:   ['I... could not hold.', 'The line... is broken.', 'Stand... without me.'],
      },
      healer: {
        victory: ['Everyone, well done.', 'The Light protects us still.', 'Let us go home.'],
        death:   ["I'm sorry... I couldn't save them.", 'My light... fades.', 'Carry on...'],
      },
      meleeDps: {
        victory: ['A clean fight. Honor satisfied.', 'The blade prevails.', 'One cut. One breath.'],
        death:   ['A worthy... end.', 'My blade... falls.', 'No... regrets.'],
      },
      rangedDps: {
        victory: ['Burned to ash. As planned.', 'The arcane wins again.', 'Checkmate.'],
        death:   ['Out of... mana.', 'The spell... unfinished.', 'Impossible...'],
      },
    }
    const pool = (L[role] ?? L.tank)[kind] ?? ['...']
    return pool[Math.floor(Math.random() * pool.length)]
  }

  _endLightPartyDuel() {
    this._fighting        = false
    this._lightPartyDuel  = false
    this._combatStarted   = false
    this._fightEnded      = true
    this._lpDuelOver      = true
    // Clear the casualty / raise / boss-anim state so a later normal fight (or
    // a re-fired duel) starts clean. _bossState + _fightStates are nulled so the
    // generic _tickFightAnim rebuilds them fresh on the next ordinary fight.
    this._lpRaise        = null
    this._lpReviveQueue  = []
    this._lpCasualties   = null
    this._lpOutro        = null
    this._bossState     = null
    this._fightStates   = null
    // Clear the safety-net context so _tickLightPartyDuel can't re-resolve.
    this._lpDuel        = null
    this._lpDuelElapsed = 0
    // Tear down the duel's tweens + the continuous-lunge timer so none keep
    // mutating worldX/worldY (or firing) after the fight resolves.
    for (const t of this._lpDuelTweens ?? []) { try { t.remove?.() ?? t.stop?.() } catch {} }
    this._lpDuelTweens = []
    for (const tm of this._lpDuelTimers ?? []) { try { tm.remove?.(false) } catch {} }
    this._lpDuelTimers = []
    // Strip the transient formation / duel fields off any surviving party members.
    for (const a of this._gameState.adventurers?.active ?? []) {
      if (!a?._lightParty) continue
      delete a._lpHomeX; delete a._lpHomeY; delete a._lpInDuel
    }
    // NOTE: do NOT force timeScale=1 here — _resolveLightPartyDuel sets a
    // terminal 0.25× killing-blow slow-mo right before calling us, with its
    // own 400ms window.setTimeout restore. Resetting here would cancel that
    // slow-mo instantly. (The beats no longer touch timeScale at all, so
    // there's nothing else that could leave it stuck.)
    // Clear the arena glow that _tickLightPartyDuel kept drawing.
    try { this._arenaGlowG?.clear?.() } catch {}
  }

  // Solo Leveling — match Sung Jinwoo's combat stats to the boss for a 1:1
  // duel, then amplify by his shadow army: +10% per extracted shadow, capped
  // at +100% (10 shadows). With no shadows it's an even coin-flip; fed a big
  // army it's a near-unstoppable Monarch — so the player's hall defense (how
  // many minions he claimed en route) is the lever. His shadows themselves
  // are EXCLUDED from the throne fight (see the sideAllies filter) so the
  // duel stays strictly 1:1; the army's job was clearing the halls.
  _matchShadowMonarchToBoss(adv, boss) {
    if (!adv || !boss) return
    const shadows = Math.min(10, (this._gameState.minions ?? []).filter(m =>
      m?._shadowExtracted && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0).length)
    const buff = 1 + 0.10 * shadows
    adv.resources = adv.resources ?? {}
    // Match the boss's MAX HP, but preserve the HP fraction he walked in with
    // (he is NOT full-healed on entry). e.g. arrives at 50% → still 50% of the
    // new boss-matched max. Capture the fraction BEFORE swapping maxHp.
    const prevMax = adv.resources.maxHp ?? adv.resources.hp ?? 1
    const prevHp  = adv.resources.hp ?? prevMax
    const hpFrac  = prevMax > 0 ? Math.max(0, Math.min(1, prevHp / prevMax)) : 1
    // The duel OUTCOME is a weighted coin flip on this entry HP fraction (see
    // _duelWinChance + the scripted resolution in _runDuelRound). Stash it so
    // the winner is rolled once at the first combat round.
    this._duelEntryHpFrac = hpFrac
    adv.resources.maxHp = Math.max(1, Math.round(boss.maxHp ?? 1))
    adv.resources.hp    = Math.max(1, Math.round(adv.resources.maxHp * hpFrac))
    adv.stats = adv.stats ?? {}
    // Attack/defense still scale with the shadow army (he hits harder the more
    // shadows he's claimed); only MAX HP is a flat 1:1 match per design.
    adv.stats.attack    = Math.max(1, Math.round((boss.attack ?? 1) * buff))
    adv.stats.defense   = Math.max(0, Math.round((boss.defense ?? 0) * buff))
    const archId   = this._gameState.player?.bossArchetypeId
    const bossName = (this._scene?.cache?.json?.get?.('bossArchetypes') ?? [])
      .find(a => a.id === archId)?.name ?? 'YOUR BOSS'
    EventBus.emit('SHADOW_MONARCH_DUEL', {
      adventurer: adv, boss, shadows, buff, bossName,
      winChance: this._duelWinChance(hpFrac),
    })
  }

  // Solo Leveling — the duel's outcome is decided by a weighted coin flip on
  // Jinwoo's HP fraction WHEN THE FIGHT STARTS (not by the combat sim):
  //   90–100% HP → GUARANTEED Monarch win
  //   60–89%  HP → Monarch favoured (ramps 50% → 100% across the band)
  //   40–60%  HP → a true 50/50 coin flip
  //   10–39%  HP → boss favoured (down to 10% at one-tenth HP)
  // Low end is clamped to 10% so an upset (Monarch win) is still possible there.
  _duelWinChance(h) {
    h = Math.max(0, Math.min(1, h ?? 1))
    let p
    if      (h >= 0.90) p = 1.00                              // 90–100% → always win
    else if (h >= 0.60) p = 0.50 + (h - 0.60) / 0.30 * 0.50   // 0.60→.50 … 0.90→1.0
    else if (h >= 0.40) p = 0.50                              // coin-flip plateau
    else                p = 0.50 - (0.40 - h) / 0.30 * 0.40   // 0.40→.50 … 0.10→.10
    return Math.max(0.10, Math.min(1.00, p))
  }

  // Roll the winner once (weighted by entry HP) and lay out a HP-drain plan:
  // the loser bleeds to 0 over ~8–12 rounds while the winner settles at a
  // 30–55% survivor margin. _runDuelRound walks both bars to this outcome.
  _buildDuelScript(adv, boss) {
    const h = this._duelEntryHpFrac ??
      ((adv.resources?.maxHp ?? 0) > 0 ? (adv.resources.hp ?? 0) / adv.resources.maxHp : 1)
    const p = this._duelWinChance(h)
    const winner = Math.random() < p ? 'monarch' : 'boss'
    // Long, suspenseful duel — ~3.5× the old length. Rounds fire every
    // ROUND_INTERVAL_S (0.6s), so 30–44 rounds ≈ 18–26s of fight at 1× speed
    // (more clash cycles + later phase beats). Scales down with game speed.
    const totalRounds = 30 + Math.floor(Math.random() * 15)   // 30–44 rounds (~18–26s)
    const bossStart = boss.hp ?? boss.maxHp ?? 1
    const jinStart  = adv.resources?.hp ?? adv.resources?.maxHp ?? 1
    const winnerMax   = winner === 'monarch' ? (adv.resources?.maxHp ?? 1) : (boss.maxHp ?? 1)
    const winnerStart = winner === 'monarch' ? jinStart : bossStart
    let survivorTarget = Math.round(winnerMax * (0.30 + Math.random() * 0.25))
    survivorTarget = Math.max(1, Math.min(survivorTarget, winnerStart - 1))
    return { winner, totalRounds, round: 0, p, bossStart, jinStart, survivorTarget }
  }

  // One scripted duel round — walk both HP bars toward the planned outcome
  // (monotonic, no heals), with strike FX + floating numbers so it still reads
  // as a live exchange. Ends the fight when the loser's bar empties.
  _runDuelRound() {
    if (this._fightEnded || this._duelOutro) return
    const boss = this._gameState.boss
    const states = this._fightStates ? [...this._fightStates.values()] : []
    const fs = states[0]
    if (!fs || !boss) return
    const adv = fs.adv
    const D = this._duel
    if (!D) return
    if (!D.script) D.script = this._buildDuelScript(adv, boss)
    const sc = D.script
    sc.round++
    const last = sc.round >= sc.totalRounds
    const t = last ? 1 : Math.min(0.97, (sc.round / sc.totalRounds) * (0.9 + Math.random() * 0.2))
    const lerp = (a, b) => Math.max(0, Math.round(a + (b - a) * t))
    let bossTo, jinTo
    if (sc.winner === 'monarch') { bossTo = lerp(sc.bossStart, 0); jinTo = lerp(sc.jinStart, sc.survivorTarget) }
    else                         { jinTo  = lerp(sc.jinStart, 0);  bossTo = lerp(sc.bossStart, sc.survivorTarget) }
    // Loser bleeds toward 0, but only the FINAL round resolves (→ outro). Keep
    // it at ≥1 on non-final rounds so a jittered step can't end the duel early.
    if (!last) { if (sc.winner === 'monarch') bossTo = Math.max(1, bossTo); else jinTo = Math.max(1, jinTo) }
    const bossPrev = boss.hp ?? sc.bossStart
    const jinPrev  = adv.resources?.hp ?? sc.jinStart
    boss.hp = Math.min(bossPrev, Math.max(0, bossTo))            // never heal
    adv.resources.hp = Math.min(jinPrev, Math.max(0, jinTo))
    const bossDmg = Math.round(bossPrev - boss.hp)
    const jinDmg  = Math.round(jinPrev - adv.resources.hp)
    if (bossDmg > 0) {
      this._emitFx({ kind: 'strike', x: boss.worldX, y: boss.worldY, color: 0x4aa0ff })
      this._floatDamage(boss.worldX, boss.worldY - 12, bossDmg, { color: '#7fc0ff' })
    }
    if (jinDmg > 0) {
      this._emitFx({ kind: 'strike', x: adv.worldX, y: adv.worldY, color: 0xff5544 })
      this._floatDamage(adv.worldX, adv.worldY - 12, jinDmg, { color: '#ff8866' })
    }
    // Final round resolves the duel → hand off to the win/loss OUTRO cutscene
    // (rather than ending the fight immediately). The loser's bar shows empty;
    // on a WIN the boss falls to 0, on a LOSS Jinwoo is held at 1 HP so he can
    // stand and speak his closing lines before his death animation plays.
    if (last) {
      const aMx = adv.resources?.maxHp ?? 1
      const bMx = boss.maxHp ?? 1
      if (sc.winner === 'monarch') {
        boss.hp = 0
        EventBus.emit('SHADOW_MONARCH_DUEL_HP', { advFrac: aMx > 0 ? Math.max(0, (adv.resources?.hp ?? 0) / aMx) : 0, bossFrac: 0 })
        this._beginDuelOutro('win', adv, boss)
      } else {
        adv.resources.hp = 1
        EventBus.emit('SHADOW_MONARCH_DUEL_HP', { advFrac: 0, bossFrac: bMx > 0 ? Math.max(0, (boss.hp ?? 0) / bMx) : 0 })
        this._beginDuelOutro('loss', adv, boss)
      }
    }
  }

  // ── Solo Leveling — duel win/loss OUTRO cutscene ───────────────────────
  // After the duel resolves, a short scripted outro plays BEFORE the day ends.
  // Jinwoo stays in the active list the whole time (so the post-wave summary's
  // auto-timer doesn't fire) and the camera stays locked on the throne. Only
  // when the outro finishes do we run the real teardown (_endFight) — which
  // kills/removes him and lets the summary follow.

  _beginDuelOutro(kind, adv, boss) {
    if (this._duelOutro) return
    this._fireDuelClimaxFx(kind)   // boss-shatter / dark burst + finale card (+ win slow-mo)
    // WIN: collapse the boss now so "Arise." (BossRenderer _shadowRevived) reads
    // as a real revive. BossRenderer reads _deathPoseUntil for the down pose.
    if (kind === 'win') this._deathPoseUntil = Infinity
    this._duelOutro = {
      kind, phase: 'stand', t: 0, adv, boss,
      said: 0, ariseSaid: false, ariseDone: false, portalSpawned: false,
      portalSprite: null, portalX: 0, portalY: 0,
    }
  }

  // Climax FX at the killing blow — extracted so it fires at the START of the
  // outro (not at _endFight, which now runs at the END).
  _fireDuelClimaxFx(kind) {
    const boss = this._gameState.boss
    if (!boss) return
    const monarch = this._fightStates ? [...this._fightStates.values()][0]?.adv : null
    if (kind === 'win') {
      for (let i = 0; i < 6; i++) {
        this._emitFx({ kind: 'monarch_burst', x: boss.worldX + (Math.random() - 0.5) * 22, y: boss.worldY + (Math.random() - 0.5) * 22 })
      }
      this._emitFx({ kind: 'shadow_dash',  x: boss.worldX, y: boss.worldY })
      this._emitFx({ kind: 'shadow_slash', x: boss.worldX, y: boss.worldY, ang: Math.random() * Math.PI * 2 })
      this._scene.cameras?.main?.shake?.(380, 0.011)
      if (this._scene?.time) {   // slow-mo killing blow (restores to 1, Game's rest value)
        this._scene.time.timeScale = 0.25
        window.setTimeout(() => { if (this._scene?.time) this._scene.time.timeScale = 1 }, 400)
      }
      EventBus.emit('SHADOW_MONARCH_DUEL_END', { result: 'win', bossName: this._duelBossName() })
    } else {
      const fx = monarch ?? boss
      this._emitFx({ kind: 'shadow_dash',   x: fx.worldX, y: fx.worldY })
      this._emitFx({ kind: 'monarch_burst', x: fx.worldX, y: fx.worldY })
      this._scene.cameras?.main?.shake?.(300, 0.008)
      EventBus.emit('SHADOW_MONARCH_DUEL_END', { result: 'loss', bossName: this._duelBossName() })
    }
  }

  _monarchSay(adv, text, lifeMs = 2600) {
    if (adv && text) EventBus.emit('SHADOW_MONARCH_SAY', { adventurer: adv, text, lifeMs })
  }

  _monarchLine(poolKey, fallback) {
    const pool = this._scene?.cache?.json?.get?.('chatLines')?.[poolKey]
    if (Array.isArray(pool) && pool.length) return pool[Math.floor(Math.random() * pool.length)]
    return fallback
  }

  _tickDuelOutro(dt) {
    const O = this._duelOutro
    if (!O) return
    O.t += dt
    const TS   = Balance.TILE_SIZE
    const adv  = O.adv
    const boss = this._gameState.boss
    const syncTiles = (e) => { if (e) { e.tileX = Math.floor(e.worldX / TS); e.tileY = Math.floor(e.worldY / TS) } }
    // Drive the LPC renderer: stand idle through the cutscene; the win WALK
    // phase overrides to 'walking' so the proper directional walk anim plays
    // (otherwise his lingering 'fighting' state keeps him mid-swing).
    if (adv) adv.aiState = (O.kind === 'win' && O.phase === 'walk') ? 'walking' : 'idle'

    if (O.kind === 'loss') {
      // Stand in place, speak two defeat lines (held a beat each), THEN die.
      if (O.said < 1 && O.t > 0.4) { O.said = 1; this._monarchSay(adv, this._monarchLine('shadowMonarchDefeat', '...impossible.'), 3400) }
      if (O.said < 2 && O.t > 3.6) { O.said = 2; this._monarchSay(adv, this._monarchLine('shadowMonarchDefeat', 'Not... like this.'), 3400) }
      if (O.t > 6.8) { this._finishDuelOutro(); return }
      syncTiles(adv); syncTiles(boss)
      return
    }

    // WIN — stand → "Arise." (2s beat) → boss revives → portal → walk in → fade.
    switch (O.phase) {
      case 'stand':
        if (O.said < 1 && O.t > 0.4) { O.said = 1; this._monarchSay(adv, this._monarchLine('shadowMonarchVictory', 'Too weak.'), 3400) }
        if (O.said < 2 && O.t > 3.8) { O.said = 2; this._monarchSay(adv, this._monarchLine('shadowMonarchVictory', 'Kneel.'), 3400) }
        if (O.t > 7.2) { O.phase = 'arise'; O.t = 0 }
        break
      case 'arise':
        // Say "Arise." first, then wait 2s before the boss actually rises.
        if (!O.ariseSaid && O.t > 0.1) { O.ariseSaid = true; this._monarchSay(adv, 'Arise.', 3200) }
        if (!O.ariseDone && O.t > 2.1) {
          O.ariseDone = true
          boss.shadowClaimed = true                        // persists for the rest of the run
          EventBus.emit('BOSS_REVIVE_AS_SHADOW', { boss })  // BossRenderer: stand + blue flame
          this._emitFx({ kind: 'monarch_burst', x: boss.worldX, y: boss.worldY })
          this._scene.cameras?.main?.shake?.(180, 0.005)
        }
        if (O.t > 3.6) { O.phase = 'portal'; O.t = 0 }     // beat after the revive
        break
      case 'portal':
        if (!O.portalSpawned) { O.portalSpawned = true; this._spawnShadowPortal(O) }
        if (O.t > 0.9) { O.phase = 'walk'; O.t = 0 }
        break
      case 'walk': {
        const dx = O.portalX - adv.worldX, dy = O.portalY - adv.worldY
        const d  = Math.hypot(dx, dy)
        // Face the direction of travel so the walk anim points the right way.
        adv._lpcDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
        if (d > 6) {
          const step = Math.min(d, 3.5 * TS * dt)
          adv.worldX += (dx / d) * step
          adv.worldY += (dy / d) * step
          syncTiles(adv)
        } else {
          O.phase = 'fade'; O.t = 0
          EventBus.emit('SHADOW_MONARCH_FADE', { adventurer: adv })   // AdventurerRenderer fades him out
        }
        break
      }
      case 'fade':
        if (O.t > 0.8) { this._finishDuelOutro(); return }
        break
    }
  }

  // Spawn the blue shadow portal in the boss room + stash Jinwoo's walk target
  // (the room centre, so he visibly strides into it).
  _spawnShadowPortal(O) {
    const TS   = Balance.TILE_SIZE
    const adv  = O.adv
    const room = this._bossRoom
    let px = adv.worldX, py = adv.worldY - 2 * TS
    if (room) {
      px = (room.gridX + room.width  / 2) * TS
      py = (room.gridY + room.height / 2) * TS
    }
    O.portalX = px; O.portalY = py
    if (this._scene?.add?.sprite && this._scene.textures?.exists?.('shadow-portal')) {
      const p = this._scene.add.sprite(px, py, 'shadow-portal', 0)
        .setOrigin(0.5, 0.5)
        .setScale(2.4)
        .setDepth(6.4)
        .setAlpha(0)
      if (this._scene.anims?.exists?.('shadow-portal-spin')) p.anims.play('shadow-portal-spin', true)
      this._scene.tweens?.add?.({ targets: p, alpha: 1, duration: 500, ease: 'Sine.easeOut' })
      O.portalSprite = p
    }
  }

  _finishDuelOutro() {
    const O = this._duelOutro
    if (!O) return
    const { kind, adv, portalSprite } = O
    this._duelOutro = null
    if (portalSprite) {
      this._scene.tweens?.add?.({ targets: portalSprite, alpha: 0, duration: 500, ease: 'Sine.easeIn',
        onComplete: () => portalSprite.destroy() })
    }
    if (kind === 'win') {
      // Jinwoo faded through the portal — remove him; ADVENTURER_FLED lifts the
      // cinematic chrome + clears camera follow. Then the real teardown runs.
      const active = this._gameState.adventurers?.active ?? []
      const i = active.indexOf(adv); if (i >= 0) active.splice(i, 1)
      EventBus.emit('ADVENTURER_FLED', { adventurer: adv, reason: 'monarch_departed' })
      this._endFight('party', { monarchOutro: true })
    } else {
      // Boss slays him — the roster loop kills him (death anim) → ADVENTURER_DIED
      // (achievement + 1000g bounty via AISystem) → active empties → summary.
      // Solo Leveling — if this boss was wearing Jinwoo's claim (he beat it on
      // an earlier occurrence this run, so it's carried his shadow-flame + blue
      // tint since), killing him on the rematch BREAKS the claim the instant he
      // dies: drop shadowClaimed now so the boss sheds the flame + blue tint
      // immediately (BossRenderer tears down the visual the next frame it sees
      // the flag cleared). shadowClaimed is persisted, so the boss stays normal
      // across save/load from here on.
      const boss = this._gameState?.boss
      if (boss?.shadowClaimed) boss.shadowClaimed = false
      this._endFight('boss', { monarchOutro: true })
    }
  }

  // Runs every frame from _tickFightAnim once combat has started.  Fires one
  // damage round every ROUND_INTERVAL_S, then evaluates flee + death.
  _tickFightCombat(dt) {
    this._fightCombatT += dt
    // Drain the accumulator with a per-tick cap. Without this, a single
    // call with a huge dt (browser hitch + high speed setting) would run
    // ONE round and leave the rest queued — eventually catching up over
    // many frames. WITH a small per-tick loop the catch-up is faster but
    // still bounded so a 5s hitch can't try to simulate 8 rounds + 8
    // cascading death sequences + their FX in one frame. Cap at 3 rounds
    // per tick; remainder leaks to the next frame.
    let rounds = 0
    while (this._fightCombatT >= ROUND_INTERVAL_S && rounds < 3) {
      this._fightCombatT -= ROUND_INTERVAL_S
      // Solo Leveling — the duel uses a scripted HP-drain toward a winner rolled
      // from entry HP%, instead of the emergent combat sim. Movement/FX/beats
      // still run from _tickDuel; this just owns the HP + outcome.
      if (this._duelMode) this._runDuelRound()
      else                this._runOneRound()
      rounds++
      if (this._fightEnded) break
    }
    // Drop any remaining unprocessed time once we've hit the cap so the
    // accumulator can't grow without bound when the simulation can't
    // keep up — better to drop time than freeze.
    if (this._fightCombatT > ROUND_INTERVAL_S * 3) {
      this._fightCombatT = ROUND_INTERVAL_S
    }
  }

  _runOneRound() {
    if (this._fightEnded) return
    const boss = this._gameState.boss
    if (!boss) return

    // Two slices of the fight roster:
    //   attackers — actively engaging; deal damage to the boss this round.
    //   defenders — still inside the chamber; CAN be hit by the boss this
    //               round.  Adventurers in the 'flee' action are running for
    //               the door but still in the room, so they remain valid
    //               targets until the flee handoff (in _tickFightAdv)
    //               removes them from _fightStates as they cross the wall.
    const all       = [...this._fightStates.values()]
    const _nowR     = this._scene?.time?.now ?? 0
    // Phase 1b.3 — Beholder Petrify Gaze: petrified advs cannot attack the
    // boss this round (they remain valid defenders and can still take damage).
    const attackers = all.filter(fs =>
      fs.action !== 'flee' && fs.action !== 'dying' && fs.adv.resources.hp > 0
      && (fs.adv._petrifiedUntil ?? 0) <= _nowR
    )
    // Phase 5c — Rogue Invisibility: invisible adventurers are untargetable
    // by the boss (same rule as MinionAISystem). They can still die to
    // DoT effects applied before they went invisible, but the boss won't
    // pick them as targets and pact attacks won't hit them.
    const defenders = all.filter(fs =>
      fs.action !== 'dying' && fs.adv.resources.hp > 0 && !fs.adv._invisible
    )

    if (defenders.length === 0) {
      // Nobody left in the chamber — boss held the room.
      this._endFight('boss')
      return
    }
    if (boss.hp <= 0) {
      this._endFight('party')
      return
    }

    // Phase 9 — Boss-attack pacts (Batch G). Run special attacks on cooldown
    // before the regular party/boss exchange. Some apply ongoing state
    // (windup, channel, stun, dazed) consumed below.
    this._runBossPactAttacks(boss, defenders)

    // Round cap removed 2026-05-27 — fights now run until one side
    // actually dies (or until the 35s wall-clock backstop in
    // _tickFightAnim fires as the absolute anti-freeze net). The
    // previous 24-round cap (48 for Slime King) was tuned around the
    // pre-day-scaling boss, where 24 rounds was usually enough to
    // resolve. With the new day-scaling math the boss can survive
    // longer past day ~25, and a 24-round HP-fraction tie-break
    // resolved most late-game fights in the boss's favor too quickly.
    // Letting fights play out reveals the actual balance.
    this._roundsRun++

    // Succubus Doppelgänger — re-conjure decoys if boss HP has crossed a
    // phase threshold since the last round.
    this._tickDoppelgangerSplit(boss)

    const owned = new Set(boss.unlockedAbilities ?? [])

    // Party → boss (skipped if everyone left is in flee — they're too busy
    // running to swing at the boss).
    //
    // Aggro split: if minions are present in the boss chamber (boss
    // abilities or dark pacts displaced them here), an attacker may divert
    // their swing to a nearby minion instead of the boss. Their attack
    // contribution is removed from the boss damage pool and applied to the
    // minion directly (no boss-defense subtraction). This is option (c)
    // from the design — adventurers naturally pick the closest threat.
    // Necromancer-raised undead and beast-master tames standing in the
    // boss chamber join the fight as side-allies: they pile their attack
    // onto the party damage pool (counted below) and the boss can punch
    // back at one of them per round (after the main exchange resolves).
    const bossRoomForAllies = this._gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    const sideAllies = bossRoomForAllies
      ? (this._gameState.minions ?? []).filter(m =>
          m.faction === 'adventurer' &&
          (m.raisedByAdvId || m.tamedByAdvId) &&
          // Solo Leveling — Jinwoo's shadows DON'T pile onto the boss; the
          // throne is a strict 1:1 duel. (Necromancer / beast-master allies
          // still join normally.)
          !m._shadowExtracted &&
          m.aiState !== 'dead' &&
          (m.resources?.hp ?? 0) > 0 &&
          _pointInRoomBS(m.tileX, m.tileY, bossRoomForAllies))
      : []

    if (attackers.length > 0 || sideAllies.length > 0) {
      const bossRoom = bossRoomForAllies
      const liveMinions = bossRoom
        ? (this._gameState.minions ?? []).filter(m =>
            m.faction === 'dungeon' &&
            m.aiState !== 'dead' &&
            (m.resources?.hp ?? 0) > 0 &&
            _pointInRoomBS(m.tileX, m.tileY, bossRoom))
        : []
      const TSb = Balance.TILE_SIZE
      const MINION_AGGRO_RANGE = 1.6 * TSb
      const MINION_REDIRECT_PROB = 0.35

      // ── Collect each attacker's attack value AFTER minion-redirect ──
      // Pulled out of the pooled-damage path so the per-slime targeting
      // branch below can re-use the same redirect outcomes. Each entry:
      // { fs, advAtk } for advs that didn't get redirected to a minion.
      const advAttackContribs = []
      for (const fs of attackers) {
        const advAtk = fs.adv.stats?.attack ?? 5
        let nearest = null
        let nearestD = Infinity
        for (const m of liveMinions) {
          const d = Math.hypot((m.worldX ?? 0) - fs.adv.worldX, (m.worldY ?? 0) - fs.adv.worldY)
          if (d <= MINION_AGGRO_RANGE && d < nearestD) { nearest = m; nearestD = d }
        }
        if (nearest && Math.random() < MINION_REDIRECT_PROB) {
          const def = nearest.stats?.defense ?? 0
          const taken = Math.max(1, Math.floor(advAtk * (0.85 + Math.random() * 0.3) - def))
          nearest.resources.hp = Math.max(0, (nearest.resources.hp ?? 0) - taken)
          this._emitFx({ kind: 'strike', x: nearest.worldX ?? fs.adv.worldX, y: nearest.worldY ?? fs.adv.worldY, color: 0xffd166 })
          this._floatDamage(nearest.worldX ?? fs.adv.worldX, nearest.worldY ?? fs.adv.worldY, taken, { color: '#ffd166' })
          this._roundLog.push({ side: 'party', damage: taken, targetId: nearest.instanceId, kind: 'minion_strike' })
          if (nearest.resources.hp <= 0) {
            nearest.aiState = 'dead'
            nearest.deathDay = this._gameState.meta?.dayNumber ?? 0
            EventBus.emit('MINION_DIED', { minion: nearest, killerId: fs.adv.instanceId })
          }
        } else {
          advAttackContribs.push({ fs, advAtk })
        }
      }

      // ── Slime King: per-attacker, per-slime damage routing ──────────
      // Each adventurer (and side-ally) picks the slime nearest to THEM
      // and damages that slime only — damage applied to one slime does
      // NOT bleed into the others.
      //
      // CRITICAL: damage magnitude uses the SAME pooled formula as the
      // non-slime path (sum attacks, subtract defense once, scale by
      // variance). An earlier version subtracted boss.defense per hit
      // which divided effective damage by attackerCount — slime fights
      // dragged past the 24-round stalemate cap and resolved with
      // "INTRUDER WITHDREW" even on near-full party HP. We compute the
      // pool damage once, then split it across slimes proportional to
      // each attacker's share who targeted that slime. Net: one slime
      // can be focus-fired without affecting the others, while overall
      // DPS stays in line with the other archetypes.
      const isSlimeFight = this._archIdForBoss() === 'slime'
        && Array.isArray(boss.slimes) && boss.slimes.length > 0
      if (isSlimeFight) {
        const aliveSlimes = boss.slimes.filter(s => (s.hp ?? 0) > 0)
        if (aliveSlimes.length > 0) {
          // Sum the pool for the same formula the non-slime path uses.
          // Percentage defense (see BOSS_DEF_PERCENT_K — atk × (1 − def/(def+K)))
          // mirrors the non-slime path so the two share the same scaling
          // behaviour at high days.
          let pool = 0
          for (const ally of sideAllies) pool += ally.stats?.attack ?? 0
          for (const { advAtk } of advAttackContribs) pool += advAtk
          const sDefK   = Balance.BOSS_DEF_PERCENT_K ?? 50
          const sDefRed = (boss.defense ?? 0) / ((boss.defense ?? 0) + sDefK)
          const totalDmg = pool > 0
            ? Math.max(1, Math.floor(pool * (1 - sDefRed) * (0.85 + Math.random() * 0.3)))
            : 0
          if (totalDmg > 0 && pool > 0) {
            // Helper closure — pick the slime nearest to a given world point.
            const pickNearestSlime = (wx, wy) => {
              let best = aliveSlimes[0], bestD = Infinity
              for (const s of aliveSlimes) {
                if ((s.hp ?? 0) <= 0) continue
                const d = Math.hypot(s.worldX - wx, s.worldY - wy)
                if (d < bestD) { bestD = d; best = s }
              }
              return best
            }
            // Tally each attacker's share toward their nearest slime.
            // Slime-keyed: { slime → { atkShare, sourceWorldX, sourceWorldY, color } }
            const perSlime = new Map()
            const addContrib = (target, atkShare, sx, sy, color) => {
              const entry = perSlime.get(target)
                ?? { atk: 0, sx, sy, color }
              entry.atk += atkShare
              perSlime.set(target, entry)
            }
            for (const { fs, advAtk } of advAttackContribs) {
              const target = pickNearestSlime(fs.adv.worldX, fs.adv.worldY)
              if (target) addContrib(target, advAtk, fs.adv.worldX, fs.adv.worldY, '#ffd166')
            }
            for (const ally of sideAllies) {
              const advAtk = ally.stats?.attack ?? 0
              if (advAtk <= 0) continue
              const target = pickNearestSlime(ally.worldX ?? boss.worldX, ally.worldY ?? boss.worldY)
              if (target) addContrib(target, advAtk, ally.worldX ?? 0, ally.worldY ?? 0, '#a0d0ff')
            }
            // Apply each slime's slice of the pool. Math.round on the
            // share keeps totals close to totalDmg without overshooting
            // wildly on small-pool rounds.
            let appliedTotal = 0
            for (const [target, entry] of perSlime) {
              const slice = Math.max(1, Math.round(totalDmg * (entry.atk / pool)))
              target.hp = Math.max(0, (target.hp ?? 0) - slice)
              appliedTotal += slice
              this._floatDamage(target.worldX, target.worldY - 12, slice, { color: entry.color })
              // Check split immediately so a single big hit that crosses
              // the 50% threshold spawns children this same round.
              this._maybeSplitSlime(target)
            }
            this._syncBossHpFromSlimes(boss)
            this._roundLog.push({ side: 'party', damage: appliedTotal })
            // Per-attacker COMBAT_HIT for the slime path — mirrors the
            // non-slime emission above. Without this, hit-spark and the
            // cheater attack VFX go silent during the Mitosis fight.
            // Slimes use a `.id` field (not `.instanceId`) and aren't in
            // gameState.minions, so downstream `_findEntity` lookups
            // can't resolve them. Targeting the parent boss instanceId
            // is the pragmatic compromise — the VFX spawns at the boss's
            // recorded worldX/Y, slightly off from the specific slime
            // that took the hit but visually still inside the chamber.
            for (const { fs, advAtk } of advAttackContribs) {
              if (advAtk <= 0) continue
              const share = Math.max(1, Math.ceil(totalDmg * (advAtk / pool)))
              EventBus.emit('COMBAT_HIT', {
                sourceId:   fs.adv.instanceId,
                targetId:   boss.instanceId,
                damage:     share,
                damageType: fs.adv.damageType ?? 'physical',
                isCritical: false,
              })
            }
          }
        }
      } else {
        // Non-slime: pooled-damage path. Defense is applied as a
        // PERCENTAGE reduction (def / (def + K)) rather than flat
        // subtraction — the old `atkPool - boss.defense` formula broke
        // at high days when adv ATK scaled into the hundreds while
        // boss DEF stayed under 30. The percentage form asymptotes to
        // 100% reduction without ever reaching it, so the boss is
        // never invulnerable but always tankily mitigates.
        let bossAtkPool = 0
        for (const ally of sideAllies) bossAtkPool += ally.stats?.attack ?? 0
        for (const { advAtk } of advAttackContribs) bossAtkPool += advAtk
        const defK    = Balance.BOSS_DEF_PERCENT_K ?? 50
        const defRed  = (boss.defense ?? 0) / ((boss.defense ?? 0) + defK)
        let dmgToBoss = bossAtkPool > 0
          ? Math.max(1, Math.floor(bossAtkPool * (1 - defRed) * (0.85 + Math.random() * 0.3)))
          : 0
        if (dmgToBoss > 0 && this._tryDoppelgangerAbsorb()) dmgToBoss = 0
        if (dmgToBoss > 0) {
          this._applyDamageToBoss(boss, dmgToBoss)
          this._roundLog.push({ side: 'party', damage: dmgToBoss })
          const isHeavy = dmgToBoss >= Math.max(8, (boss.maxHp ?? 0) * 0.1)
          this._floatDamage(boss.worldX, boss.worldY - 12, dmgToBoss, {
            color: '#ffd166', crit: isHeavy,
          })
          // Emit per-attacker COMBAT_HIT events so per-hit subscribers
          // (HitSparkSystem, CheaterAttackVfxSystem, etc.) fire for
          // boss-fight swings the same way they do for minion fights.
          // Pre-existing boss combat is a pooled mechanic — one damage
          // roll for the whole party — so without these synthetic events
          // the cheater's wild attack VFX (and the standard hit spark)
          // were invisible inside the throne room. Damage attribution:
          // each attacker's share of dmgToBoss, proportional to their
          // advAtk contribution; ceil so low-attack advs still cross
          // the `damage > 0` gate in downstream listeners.
          for (const { fs, advAtk } of advAttackContribs) {
            if (advAtk <= 0) continue
            const share = Math.max(1, Math.ceil(dmgToBoss * (advAtk / bossAtkPool)))
            EventBus.emit('COMBAT_HIT', {
              sourceId:   fs.adv.instanceId,
              targetId:   boss.instanceId,
              damage:     share,
              damageType: fs.adv.damageType ?? 'physical',
              isCritical: isHeavy,
            })
          }
        }
      }

      // Phase 9 — Tyrant's Gaze: each boss-hit-taken costs minions in the
      // boss chamber 1 HP each.
      const tFlags = this._gameState._mechanicFlags ?? {}
      if (tFlags.tyrantsGaze) {
        const bossRoom = this._gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
        if (bossRoom) {
          for (const m of (this._gameState.minions ?? [])) {
            if (m.faction !== 'dungeon' || m.aiState === 'dead') continue
            if (m.assignedRoomId !== bossRoom.instanceId) continue
            m.resources.hp = Math.max(0, (m.resources.hp ?? 0) - Balance.MECHANIC_TYRANT_HP_LOSS_PER_TAKEN)
          }
        }
      }

      // Room redesign 2026-04-30 — Sanctum: boss regenerates between fight
      // rounds (8 HP per round per active Sanctum). Caps at maxHp.
      if (boss.hp > 0) {
        const sanctumCount = (this._gameState.dungeon.rooms ?? [])
          .filter(r => r.definitionId === 'sanctum' && r.isActive !== false).length
        if (sanctumCount > 0) {
          // Tinkerer's Workshop "Sanctum's Heart" — regen rate doubled
          // when the Sanctum type is upgraded (16/round instead of 8).
          const sanctumMul = (this._gameState._tinkeredRoomTypes ?? []).includes('sanctum') ? 2 : 1
          const regen = 8 * sanctumCount * sanctumMul
          const before = boss.hp
          boss.hp = Math.min(boss.maxHp, boss.hp + regen)
          if (boss.hp > before) {
            this._roundLog.push({ side: 'boss', regen: boss.hp - before, source: 'sanctum' })
          }
        }
      }

      if (!this._secondWindUsed && owned.has('second_wind') && boss.hp > 0 && boss.hp < boss.maxHp * 0.2) {
        boss.hp = Math.min(boss.maxHp, boss.hp + 30)
        this._secondWindUsed = true
        EventBus.emit('BOSS_SECOND_WIND')
      }
      // Phase 9 — Final Breath: once per run, if this hit would kill the boss,
      // revive at 50% HP, full-heal all minions, and mark the pact used.
      // Triggers BEFORE the lethal-check so deathsRemaining is untouched.
      const flags = this._gameState._mechanicFlags ?? {}
      // Inquisition purge (KR) — the boss's once-per-run cheat-death is a benefit;
      // an inquisitor in the dungeon strips that insurance (curses still apply).
      if (flags.finalBreath && !flags.finalBreathUsed && !flags._inqSuppress && boss.hp <= 1) {
        boss.hp = Math.max(1, Math.floor((boss.maxHp ?? 0) * 0.5))
        for (const m of (this._gameState.minions ?? [])) {
          if (m.faction !== 'dungeon') continue
          if (m.aiState === 'dead') {
            m.aiState = 'idle'
            m.tileX  = m.homeTileX
            m.tileY  = m.homeTileY
            m.worldX = (m.homeTileX ?? 0) * Balance.TILE_SIZE + Balance.TILE_SIZE / 2
            m.worldY = (m.homeTileY ?? 0) * Balance.TILE_SIZE + Balance.TILE_SIZE / 2
          }
          m.resources.hp = m.resources.maxHp
        }
        flags.finalBreathUsed = true
        EventBus.emit('FINAL_BREATH_TRIGGERED', { bossHp: boss.hp })
      }
      if (boss.hp <= 0) {
        this._endFight('party')
        return
      }
    }

    // Boss → side-allies. Each round the boss also lands a swing on one
    // adv-faction minion in the chamber (necromancer undead / beast-master
    // tame). They aren't full members of the party-vs-boss abstraction, so
    // this is a parallel damage pass — boss.attack vs minion.stats.defense
    // with the same randomization the party-vs-boss exchange uses.
    if (sideAllies.length > 0 && boss.hp > 0) {
      const victim = sideAllies[Math.floor(Math.random() * sideAllies.length)]
      const def    = victim.stats?.defense ?? 0
      const taken  = Math.max(1, Math.floor(this._bossAtkScaled(boss) * (0.85 + Math.random() * 0.3) - def))
      victim.resources.hp = Math.max(0, (victim.resources.hp ?? 0) - taken)
      this._roundLog.push({ side: 'boss', damage: taken, targetId: victim.instanceId, kind: 'ally_strike' })
      this._emitFx({ kind: 'strike', x: victim.worldX ?? boss.worldX, y: victim.worldY ?? boss.worldY, color: 0xff6644 })
      this._floatDamage(victim.worldX ?? boss.worldX, victim.worldY ?? boss.worldY, taken, { color: '#ff7777' })
      if (victim.resources.hp <= 0) {
        victim.aiState = 'dead'
        victim.deathDay = this._gameState.meta?.dayNumber ?? 0
        EventBus.emit('MINION_DIED', { minion: victim, killerId: null })
      }
    }

    // Lich Necromancy — raised undead standing in the boss chamber actively
    // swing at adventurers each cinematic round. They're already valid
    // redirect targets for adv swings (handled above in the attacker block),
    // so this completes the loop: they hit AND get hit. Scoped to
    // `_raisedFromAdvDeath` to avoid silently turning every dungeon minion
    // the player happened to park in the boss room into an active attacker
    // (that would change balance for archetypes that don't have raised dead).
    const raisedHere = bossRoomForAllies
      ? (this._gameState.minions ?? []).filter(m =>
          m._raisedFromAdvDeath &&
          m.faction === 'dungeon' &&
          m.aiState !== 'dead' &&
          (m.resources?.hp ?? 0) > 0 &&
          _pointInRoomBS(m.tileX, m.tileY, bossRoomForAllies))
      : []
    for (const m of raisedHere) {
      if (defenders.length === 0) break
      const fs  = defenders[Math.floor(Math.random() * defenders.length)]
      const atk = m.stats?.attack ?? 0
      const def = fs.adv.stats?.defense ?? 0
      const dmg = Math.max(1, Math.floor(atk * (0.85 + Math.random() * 0.3) - def))
      fs.adv.resources.hp = Math.max(0, (fs.adv.resources.hp ?? 0) - dmg)
      this._roundLog.push({
        side: 'minion', damage: dmg, targetId: fs.adv.instanceId,
        kind: 'raised_strike', sourceId: m.instanceId,
      })
      this._emitFx({ kind: 'strike', x: fs.adv.worldX, y: fs.adv.worldY, color: 0x9988cc })
      this._floatDamage(fs.adv.worldX, fs.adv.worldY - 8, dmg, { color: '#bb99dd' })
    }

    // Boss → single target.  Prefer whoever the boss is currently chasing
    // / lunging at (set by _tickFightBoss).  Falls back to nearest defender
    // when the tracked target is no longer in the room.  AOE attacks (slam,
    // necrotic aura) still hit multiple targets via their own paths.
    let target = null
    const focusId = this._bossState?.targetId
    if (focusId) {
      target = defenders.find(fs => fs.adv.instanceId === focusId)
    }
    if (!target) {
      let nearestD = Infinity
      for (const fs of defenders) {
        const d = Math.hypot(fs.adv.worldX - boss.worldX, fs.adv.worldY - boss.worldY)
        if (d < nearestD) { nearestD = d; target = fs }
      }
    }
    if (target) {
      // Boss is melee-only for now (future bosses + abilities will add
      // ranged attacks).  If the chosen target is outside arm's reach the
      // boss whiffs this round and has to close the distance.  Slam's
      // own range check (2.1 TS AOE) is independent.
      const TS_MELEE     = Balance.TILE_SIZE
      const MELEE_RANGE  = 1.4 * TS_MELEE
      const dToTarget    = Math.hypot(
        target.adv.worldX - boss.worldX,
        target.adv.worldY - boss.worldY,
      )
      if (dToTarget <= MELEE_RANGE) {
        // Phase 9 — Avenger's Rite: skip the boss attack while dazed (5s after first adv enters).
        const aFlags = this._gameState._mechanicFlags ?? {}
        const now = this._scene?.time?.now ?? 0
        // Phase 9 — Batch G suppressions: skip melee when winding up / channeling / stunned.
        const suppressed =
          (aFlags.hellfireBreath && boss._hellfireWindupUntil && now < boss._hellfireWindupUntil) ||
          (aFlags.shockwaveSlam && (boss._shockwaveStunUntil ?? 0) > now) ||
          (aFlags.soulDrain && boss._soulDrainChannelUntil && now < boss._soulDrainChannelUntil) ||
          (aFlags.petrifyingStare && (boss._petrifyBackfireUntil ?? 0) > now) ||
          (aFlags.spectralReach && Math.random() >= Balance.MECHANIC_SPECTRAL_REACH_SPEED_PENALTY)
        if (aFlags.avengersRite && (boss._avengerDazeUntil ?? 0) > now) {
          this._roundLog.push({ side: 'boss', damage: 0, targetId: target.adv.instanceId, kind: 'avenger_dazed' })
        } else if (suppressed) {
          this._roundLog.push({ side: 'boss', damage: 0, targetId: target.adv.instanceId, kind: 'pact_suppressed' })
        } else {
          let bossAtk = this._bossAtkScaled(boss)   // LEGENDARY Wrath/Sudden Death applied
          // Phase 9 — Avenger's Rite: +25% damage during 10s buff window after a minion died.
          if (aFlags.avengersRite && (boss._avengerBuffUntil ?? 0) > now) {
            bossAtk *= Balance.MECHANIC_AVENGER_BUFF_MULT
          }
          // Phase 9 — Final Breath aftermath: -25% damage permanently after the revive triggered.
          if (aFlags.finalBreath && aFlags.finalBreathUsed) {
            bossAtk *= 0.75
          }
          // Phase 9 — Doppelgangers: real boss only deals 50% damage during illusion window.
          if (aFlags.doppelgangers && (boss._doppelActiveUntil ?? 0) > now) {
            bossAtk *= Balance.MECHANIC_DOPPELGANGERS_BOSS_DMG_MULT
          }
          const def   = target.adv.stats?.defense ?? 0
          const taken = Math.max(1, Math.floor(bossAtk * (0.85 + Math.random() * 0.3) - def))
          target.adv.resources.hp = Math.max(0, target.adv.resources.hp - taken)
          this._roundLog.push({ side: 'boss', damage: taken, targetId: target.adv.instanceId })
          this._emitFx({ kind: 'strike', x: target.adv.worldX, y: target.adv.worldY, color: 0xff5544 })
          // Boss hit on the adv — float a red damage number; crit if it
          // was a "heavy" connection (≥30% of the adv's max HP).
          const advMax = target.adv.resources?.maxHp ?? 0
          const isHeavy = taken >= Math.max(8, advMax * 0.3)
          this._floatDamage(target.adv.worldX, target.adv.worldY - 8, taken, {
            color: '#ff7777', crit: isHeavy,
          })
          EventBus.emit('BOSS_MELEE_HIT', { targetId: target.adv.instanceId, damage: taken })

          // Phase 9 — Tyrant's Gaze: +1 atk to every minion in the boss chamber per landed hit.
          if (aFlags.tyrantsGaze) {
            const bossRoom = this._gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
            if (bossRoom) {
              for (const m of (this._gameState.minions ?? [])) {
                if (m.faction !== 'dungeon' || m.aiState === 'dead') continue
                if (m.assignedRoomId !== bossRoom.instanceId) continue
                m.stats.attack = (m.stats.attack ?? 0) + Balance.MECHANIC_TYRANT_ATK_PER_HIT
                m._tyrantStacksToday = (m._tyrantStacksToday ?? 0) + Balance.MECHANIC_TYRANT_ATK_PER_HIT
              }
            }
          }
        }
      } else {
        // Out of melee range — boss missed this round.  Logged as 0 damage
        // so the round log still records the attempt for future telemetry.
        this._roundLog.push({
          side:     'boss',
          damage:   0,
          targetId: target.adv.instanceId,
          kind:     'out_of_range',
        })
      }
    }

    // Necrotic Aura is a true AOE — it tags every defender every round.
    if (owned.has('necrotic_aura')) {
      for (const fs of defenders) {
        const dot = Math.max(1, Math.floor(fs.adv.resources.maxHp * 0.05))
        fs.adv.resources.hp = Math.max(0, fs.adv.resources.hp - dot)
      }
    }

    // Death + flee evaluation across defenders.  Already-fleeing
    // adventurers can die mid-flee but don't re-roll the flee decision.
    for (const fs of defenders) {
      if (fs.adv.resources.hp <= 0) {
        // Stamp attribution now so AISystem._kill reads 'boss' on its very
        // next tick — before _killAdv runs after the dying animation.
        fs.adv._lastHitBy   = 'boss'
        fs.adv._lastHitType = 'physical'
        fs.action       = 'dying'
        fs.actionT      = 0
        fs.actionDur    = 0.6
        fs.dyingKilled  = false
        this._emitFx({ kind: 'strike', x: fs.adv.worldX, y: fs.adv.worldY })
        continue
      }
      if (fs.action === 'flee') continue
      if (fs.adv.aiState === 'fleeing' || !this._fightStates.has(fs.adv.instanceId)) continue
      if (this._shouldFleeBoss(fs.adv)) {
        this._beginFlee(fs)
      }
    }
  }

  // Telegraph dodge: when the boss begins a slam wind-up, every adventurer
  // currently inside the slam radius rolls a dodge chance based on their
  // class speed stat and personality riskTolerance (reckless adventurers
  // tend to stand their ground).  On hit, they leap to a target just past
  // the danger zone and avoid the AOE damage entirely.
  _rollSlamDodges(boss) {
    if (!this._fightStates) return
    const TS         = Balance.TILE_SIZE
    const SLAM_RANGE = 2.1 * TS
    const ps         = this._scene.personalitySystem
    const { clampX, clampY } = this._roomClamp()
    for (const fs of this._fightStates.values()) {
      if (fs.action === 'flee'  || fs.action === 'dying' ||
          fs.action === 'dodge' || fs.action === 'taunt') continue
      const dx = fs.adv.worldX - boss.worldX
      const dy = fs.adv.worldY - boss.worldY
      const d  = Math.hypot(dx, dy)
      if (d > SLAM_RANGE) continue
      const w     = ps?.getWeights?.(fs.adv) ?? {}
      const speed = fs.adv.stats?.speed ?? 1
      // Base 25 % + speed bonus, scaled inversely with riskTolerance so
      // reckless types ignore the wind-up and eat the slam.
      let chance = 0.25 + Math.min(0.4, speed * 0.15)
      chance *= 1.3 - (w.riskTolerance ?? 0.5)
      chance = Math.min(0.85, Math.max(0.05, chance))
      if (Math.random() >= chance) continue
      const nx = dx / (d || 1)
      const ny = dy / (d || 1)
      fs.action       = 'dodge'
      fs.actionT      = 0
      fs.actionDur    = 0.35
      fs.dodgeTargetX = clampX(boss.worldX + nx * (SLAM_RANGE * 1.15))
      fs.dodgeTargetY = clampY(boss.worldY + ny * (SLAM_RANGE * 1.15))
      this._emitFx({ kind: 'dodge', x: fs.adv.worldX, y: fs.adv.worldY })
    }
  }

  // Personality-driven flee check.  Rolls once per threshold crossing so
  // most adventurers fight to the death — flee is rare, not guaranteed.
  // chance = threshold * 0.25: default(0.4)→10%, paranoid(0.6)→15%,
  // traumatized(0.95)→24%, speed_runner(0.12)→3%.
  _shouldFleeBoss(adv) {
    // Solo Leveling — Sung Jinwoo NEVER withdraws from the duel. He fights the
    // boss until one of them is dead, no HP-threshold retreat.
    if (adv?._shadowMonarch) return false
    const hp     = adv.resources.hp
    const maxHp  = adv.resources.maxHp ?? 1
    const hpFrac = hp / Math.max(1, maxHp)
    const ps     = this._scene.personalitySystem
    const w      = ps?.getWeights?.(adv) ?? {}
    const threshold = w.fleeThreshold ?? 0.4
    if (hpFrac >= threshold) {
      adv._bossFleeRolled = false   // HP recovered above threshold; allow re-roll if it drops again
      return false
    }
    if (adv._bossFleeRolled) return false   // already decided this threshold crossing
    adv._bossFleeRolled = true
    return Math.random() < threshold * 0.25
  }

  // Hand the adventurer straight to AISystem's FLEE goal.  We tried running
  // them to a "just outside the wall" target with a BossSystem animation,
  // but the wall clamp in _tickFightAdv kept them inside the room — they'd
  // slam against the interior boundary and never reach the handoff
  // threshold.  AISystem pathfinds through the actual doorway and the 2×
  // flee speed multiplier sells the "running away" feel.
  _beginFlee(fs) {
    EventBus.emit('ADVENTURER_BREAKING_FROM_BOSS', { adventurer: fs.adv })
    this._handOffToAIFlee(fs.adv, 'fled_from_boss', null)
  }

  _endFight(winner, opts = {}) {
    if (this._fightEnded) return
    this._fightEnded = true
    // Capture duel state BEFORE the reset block clears it — drives the bespoke
    // Shadow Monarch climax below.
    const wasDuel = !!this._duelMode

    const boss = this._gameState.boss

    // Slime King — wipe the multi-entity fight state so the boss reverts
    // to a single-entity render between encounters. If the player wins
    // another fight is staged via _onIncoming which re-initialises a
    // fresh gen-0 slime; if the party wins (boss survived), the same
    // re-init runs at the next BOSS_FIGHT_INCOMING so a multi-fight day
    // gets a clean slime tree per encounter.
    if (boss) boss.slimes = null

    // Tier 2 cinematic feedback — punctuate the killing blow with a
    // strong screen shake. The boss losing a life shakes harder than a
    // party defeat (the whole arena reels for the player's win).
    const shake = winner === 'party' ? { dur: 450, mag: 0.012 }
                                     : { dur: 250, mag: 0.006 }
    this._scene.cameras?.main?.shake?.(shake.dur, shake.mag)

    // Tier 3 — slow-motion killing blow. When the boss actually died on
    // this tick (party win + hp at 0), drop the global time scale to
    // 0.25 for 400 ms of REAL time, then restore the player's chosen
    // speed. Uses window.setTimeout so the restore isn't itself slowed
    // by the scaled timer (scene.time.delayedCall would take 1.6 s real).
    // The duel outro already fired its own slow-mo at the killing blow — don't
    // double it here when _endFight runs at the END of the outro.
    const isLethal = winner === 'party' && (boss?.hp ?? 0) <= 0
    if (isLethal && !opts.monarchOutro) {
      // Restore to 1, NOT to the captured pre-slowmo value. The Game
      // scene's time.timeScale is only ever touched here, so 1 is the
      // true rest value. Capturing `origScale` was unsafe: two lethal
      // killing blows close together (a second boss fight resolving
      // while the first's 400ms slow-mo is still in flight) would
      // capture origScale = 0.25 and "restore" the clock to 0.25
      // permanently — every subsequent delayedCall (including the next
      // fight's prefight gate) then runs at quarter speed.
      this._scene.time.timeScale = 0.25
      window.setTimeout(() => {
        if (this._scene?.time) this._scene.time.timeScale = 1
      }, 400)
    }

    // Solo Leveling — duel climax FX + finale card. Normally fired at the START
    // of the win/loss OUTRO (_beginDuelOutro); only fire here for the rare
    // non-outro path (the 60s anti-freeze cap resolving the duel directly).
    if (wasDuel && boss && !opts.monarchOutro) {
      this._fireDuelClimaxFx(winner === 'party' ? 'win' : 'loss')
    }
    const finalParty = []

    for (const fs of this._fightStates.values()) {
      const adv = fs.adv
      finalParty.push({ instanceId: adv.instanceId, name: adv.name, hp: adv.resources.hp })
      // Already in flight states for flee/dying are honoured: dying still
      // gets killed, flee still gets fled.  Survivors split by winner.
      if (fs.action === 'dying' || adv.resources.hp <= 0) {
        if (!fs.dyingKilled) {
          fs.dyingKilled = true
          this._killAdv(adv, 'boss')
        }
      } else if (winner === 'boss') {
        adv.resources.hp = 0
        this._killAdv(adv, 'boss')
      } else if (winner === 'party') {
        // Solo Leveling — the Monarch already left through his portal (handled
        // in _finishDuelOutro: spliced from active + ADVENTURER_FLED). Don't
        // hand him to the normal flee-to-exit, or he'd invisibly trudge to the
        // door and stall the summary.
        if (opts.monarchOutro) { /* already departed */ }
        else {
          // Distinguish real lethal win (boss.hp <= 0 → "fled in awe of
          // their slain foe") from the 24-round stalemate cap (boss still
          // alive → "withdrew from the chamber"). Same lives-lost guard
          // that's in the slate text — keeps the dungeon log consistent
          // with the result card.
          const lethal = (boss?.hp ?? 0) <= 0
          this._handOffToAIFlee(adv, lethal ? 'boss_defeated' : 'boss_stalemate')
        }
      }
    }

    // A life is lost ONLY on an actual defeat — boss HP drained to 0.
    // The 24-round stalemate cap can resolve as a 'party' win on
    // HP-fraction while the boss is still alive; that must NOT cost a
    // life (matches the death-pose gate below, which already checks
    // boss.hp <= 0). Without this guard the boss "lost a life" with HP
    // still on the clock.
    if (winner === 'party' && boss && (boss.hp ?? 0) <= 0) {
      boss.deathsRemaining = Math.max(0, boss.deathsRemaining - 1)
      // ONE LIFE PER DAY — _onIncoming reads this to refuse any later
      // boss fight today. Cleared on NIGHT_PHASE_STARTED (see _wire).
      boss._diedThisDay = true
    }

    // Phase 1b.4 — Lich Phylactery acts as a 4th life. When the boss runs
    // out of normal lives but the phylactery is still alive, instead of
    // ending the run we revive the boss for one more death.
    //
    // Archetype gate (2026-05-22): EXPLICITLY check `bossArchetypeId ===
    // 'lich'`. The BuildMenu's archetypeRestriction filter normally
    // prevents non-Lich players from ever placing a phylactery, but a
    // save imported between runs / a code path that bypasses the build
    // menu / a future pact that fabricates one could leave a phylactery
    // entity on a non-Lich boss's state. Without this guard, that boss
    // would silently regain a life — the user-reported "boss is gaining
    // a life on a non-Lich run" symptom. Defensive: even if
    // gameState.phylactery exists, only Lich's revive path fires.
    const phyl = this._gameState?.phylactery
    const phylAlive = phyl && (phyl.resources?.hp ?? 0) > 0
    const isLich    = this._gameState?.player?.bossArchetypeId === 'lich'
    if (winner === 'party' && boss && boss.deathsRemaining <= 0 && phylAlive && isLich) {
      boss.deathsRemaining = 1
      boss.hp              = boss.maxHp
      // Heart-life flag (2026-05-27): once the heart has revived the boss
      // for the first time, every subsequent life is "borrowed" from the
      // phylactery. BossArchetypeSystem reads this to drive desperation-
      // mode hunt behaviour, and AISystem reads it to redirect SEEK_BOSS
      // adventurers (who know about the heart) to HUNT_PHYLACTERY instead
      // of wasting trips to the throne. The flag is monotonic — once set,
      // it stays set for the rest of the run. The boss "going back to a
      // normal life" never happens in code (lives only decrement, heart
      // can only revive, not restore), so no clear-path is needed.
      boss._onHeartLife = true
      EventBus.emit('PHYLACTERY_REVIVED_BOSS', { phylactery: phyl })
    }

    // Death-pose — only when the boss actually died this round (hp
    // drained to 0; the 24-round stalemate cap can resolve in the
    // party's favour without killing the boss, and that path should
    // NOT play the death anim or freeze the boss).
    //
    // BOTH non-final and final life losses freeze on the last death
    // frame until something explicitly releases the pose. _wire()
    // releases it on BOSS_FIGHT_INCOMING (a same-day second adv party
    // is arriving, the boss must be ready to fight) and on
    // NIGHT_PHASE_STARTED (the next day begins, build phase needs the
    // boss alive). Crucially we do NOT release on SHOW_POST_WAVE_SUMMARY
    // anymore — the boss stays visibly dead in the chamber through the
    // end-of-day summary popup so the player's win reads as the boss
    // *staying down*, not magically up before the night even starts.
    // Final death stays Infinity-posed forever (game over; no later
    // event will fire to clear it).
    if (winner === 'party' && boss && boss.hp <= 0) {
      this._deathPoseUntil = Infinity
    }

    EventBus.emit('BOSS_FIGHT_RESOLVED', {
      winner,
      bossHpRemaining: boss?.hp ?? 0,
      deathsRemaining: boss?.deathsRemaining ?? 0,
      rounds:          this._roundsRun,
      roundLog:        this._roundLog ?? [],
      party:           finalParty,
    })

    // Final-death gate. Phylactery (Lich) acts as a 4th life — if it's
    // still alive when normal lives hit zero, the revive block above will
    // have already restored deathsRemaining=1, so we won't reach this path.
    if (boss && boss.deathsRemaining <= 0) {
      this._recordFinalBlow()
      EventBus.emit('BOSS_DEFEATED_FINAL', { totalDays: this._gameState.player.totalDaysElapsed })
    }

    // Reset
    this._fighting       = false
    this._combatStarted  = false
    this._fightT         = 0
    this._fightCombatT   = 0
    this._fightStates    = null
    this._bossState      = null
    this._duelMode       = false
    this._duel           = null
    this._duelOutro      = null
    if (this._fxGraphics)  this._fxGraphics.clear()
    if (this._fxParticles) this._fxParticles.length = 0
  }

  // The boss takes damage as a single pooled party attack — the sim has
  // no literal "last hit". Credit the final blow to the fight-party
  // adventurer who contributed the most attack to the killing pool
  // (preferring survivors; tie-break on display level). Stored on
  // gameState.run so the Game Over screen shows the real killer instead
  // of guessing the highest-level adventurer the player ever saw.
  _recordFinalBlow() {
    const states = this._fightStates ? [...this._fightStates.values()] : []
    const advs   = states.map(fs => fs?.adv).filter(Boolean)
    if (advs.length === 0) return
    const advLevel = (a) => a?.displayLevel ?? a?.level ?? 1
    // Survivors are the ones who killed the boss; fall back to the whole
    // party if the killing round happened to be a mutual wipe.
    const alive = advs.filter(a => (a.resources?.hp ?? 0) > 0)
    const pool  = alive.length > 0 ? alive : advs
    const killer = pool.reduce((best, a) => {
      const atkA = a.stats?.attack    ?? 0
      const atkB = best.stats?.attack ?? 0
      if (atkA > atkB) return a
      if (atkA === atkB && advLevel(a) > advLevel(best)) return a
      return best
    }, pool[0])
    this._gameState.run ??= {}
    this._gameState.run.finalBlow = {
      instanceId: killer.instanceId ?? null,
      name:       killer.name ?? '?',
      classId:    killer.classId ?? null,
      level:      advLevel(killer),
    }
  }

  // Reuse AISystem's death/flee plumbing by emitting events it already listens
  // to. We don't talk to AISystem directly (avoids circular wiring).
  _killAdv(adv, killerHint) {
    // Stamp before the event fires so AISystem._tickAdventurer reads 'boss'
    // when it calls _kill(adv, idx, adv._lastHitBy ?? 'unknown') next tick.
    adv._lastHitBy   = 'boss'
    adv._lastHitType = 'physical'
    EventBus.emit('COMBAT_KILL', {
      sourceId:   'boss',
      targetId:   adv.instanceId,
      damageType: 'physical',
      method:     'boss_fight',
      roomId:     adv.assignedRoomId ?? null,
      day:        this._gameState.meta.dayNumber,
    })
  }

  // Hand control of a fleeing adventurer to AISystem's FLEE goal so they
  // pathfind back toward the entry hall (potentially getting lost on the
  // way).  They're only spliced from active by AISystem when they actually
  // arrive at the entry — never here.
  _handOffToAIFlee(adv, reason, context = null) {
    const TS = Balance.TILE_SIZE
    // Sync tile coords from world position so AISystem starts pathing from
    // wherever our fight animation left them.
    adv.tileX   = Math.floor(adv.worldX / TS)
    adv.tileY   = Math.floor(adv.worldY / TS)
    adv.path    = null
    adv.goal    = { type: 'FLEE', reason, context }
    adv.aiState = 'fleeing'
    // We deliberately keep the fightState entry around — _syncFightParty
    // prunes it once the adventurer physically leaves the boss chamber.
    // Until then the boss can keep hitting them with round damage and
    // slam AOE; only their movement is handed off to AISystem.
  }
}

function _pointInRoomBS(tx, ty, room) {
  return tx >= room.gridX && tx < room.gridX + room.width &&
         ty >= room.gridY && ty < room.gridY + room.height
}

// Phase 10b — summon a small number of dungeon-faction skeletons near the
// boss chamber when the Summon Adds ability is unlocked. They join combat
// via the existing MinionAISystem next tick.
// `opts.defId` overrides the default 'skeleton1' summon (Slime King Mitosis
// passes its own slime def + sets `extraTags` so adds are skipped by Absorb).
// `opts.tagBossAdd` toggles the `isBossAdd` marker (default true).
// Returns the array of spawned minion objects so callers can attach VFX or
// per-instance flags afterward.
function _summonAddsNearBoss(scene, gameState, bossRoom, count, opts = {}) {
  const minionTypes = scene.cache.json.get('minionTypes') ?? []
  const defId = opts.defId ?? 'skeleton1'
  const def = minionTypes.find(d => d.id === defId) ?? minionTypes[0]
  if (!def) return []
  const TS = 32
  const w = Balance.WALL_THICKNESS
  const innerW = Math.max(1, bossRoom.width - 2 * w)
  const spawned = []
  for (let i = 0; i < count; i++) {
    const x = bossRoom.gridX + w + (i % innerW)
    const y = bossRoom.gridY + w
    const m = {
      instanceId:    `boss_add_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 4)}`,
      definitionId:  def.id,
      name:          opts.name ?? 'Boss Add',
      faction:       'dungeon',
      isBossAdd:     opts.tagBossAdd !== false,
      assignedRoomId: bossRoom.instanceId,
      homeTileX: x, homeTileY: y,
      tileX: x, tileY: y,
      worldX: x * TS + TS / 2, worldY: y * TS + TS / 2,
      stats: { ...(def.baseStats ?? { hp: 20, attack: 6, defense: 2, speed: 1 }) },
      resources: {
        hp:    def.baseStats?.hp ?? 20,
        maxHp: def.baseStats?.hp ?? 20,
      },
      aiState: 'idle', level: 1, xp: 0,
      tags: [...(def.tags ?? [])],
      equippedGear: [], killHistory: [], evolutionHistory: [],
      timesKilledAndRespawned: 0, lastAttackAt: 0, currentTargetId: null,
    }
    // Merge extra flag fields (e.g. `_isMitosisAdd: true`) from opts.flags.
    if (opts.flags) Object.assign(m, opts.flags)
    gameState.minions ??= []
    gameState.minions.push(m)
    spawned.push(m)
  }
  return spawned
}

function _inOrAdjacentToRoom(adv, room) {
  const inRoom =
    adv.tileX >= room.gridX && adv.tileX < room.gridX + room.width &&
    adv.tileY >= room.gridY && adv.tileY < room.gridY + room.height
  if (inRoom) return true
  const margin = 2
  return adv.tileX >= room.gridX - margin && adv.tileX < room.gridX + room.width + margin &&
         adv.tileY >= room.gridY - margin && adv.tileY < room.gridY + room.height + margin
}
