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
      return
    }

    const archId = this._gameState.player?.bossArchetypeId
    const archs  = this._scene.cache.json.get('bossArchetypes') ?? []
    const arch   = archs.find(a => a.id === archId)
    const fight  = arch?.baseFightStats ?? { hp: 200, attack: 12, defense: 10 }
    this._gameState.boss = {
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
    if (this._fighting) {
      this._tickFightAnim(delta)
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

    if (!this._fightStates) {
      this._fightStates = new Map()
      this._bossState   = {
        action: 'chase', actionT: 0, actionDur: 0.6,
        targetId: null, slamFired: false, windUpEmitted: false,
      }
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
    this._tickFightBoss(dt)
    for (const fs of this._fightStates.values()) {
      this._tickFightAdv(fs, dt)
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
            const taken = Math.max(1, Math.floor(boss.attack * SLAM_DMG_FRAC - def))
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
              this._witnessAdvDeath(fs)
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
    else                                p.dur = 0.20
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
    this._scene.tweens.add({
      targets:  t,
      y:        t.y - (isCrit ? 44 : 30),
      alpha:    0,
      duration: isCrit ? 950 : 720,
      ease:     'Cubic.easeOut',
      onComplete: () => t.destroy(),
    })
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
      }
    }
    // Drop dead particles
    this._fxParticles = this._fxParticles.filter(p => p.t < p.dur)
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  _wire() {
    const onIncoming = (payload) => this._onIncoming(payload)
    // Clear death-pose freeze whenever the world resets around the
    // boss — next adv party arriving (BOSS_FIGHT_INCOMING) replaces
    // the dead-pose with the prefight banner; the post-wave summary
    // popup is the natural release point at end of day; night phase
    // resets run-state defensively for the next day's party.
    const onClearPose = () => { this._deathPoseUntil = 0 }
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
    EventBus.on('BOSS_FIGHT_INCOMING',    onIncoming)
    EventBus.on('BOSS_FIGHT_INCOMING',    onClearPose)
    EventBus.on('SHOW_POST_WAVE_SUMMARY', onClearPose)
    EventBus.on('NIGHT_PHASE_STARTED',    onClearPose)
    EventBus.on('NIGHT_PHASE_STARTED',    onClearDecals)
    EventBus.on('ADVENTURER_DIED',        onAdvDied)
    this._listeners = [
      ['BOSS_FIGHT_INCOMING',    onIncoming],
      ['BOSS_FIGHT_INCOMING',    onClearPose],
      ['SHOW_POST_WAVE_SUMMARY', onClearPose],
      ['NIGHT_PHASE_STARTED',    onClearPose],
      ['NIGHT_PHASE_STARTED',    onClearDecals],
      ['ADVENTURER_DIED',        onAdvDied],
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

  // Phase 9 — Batch G boss-attack-pact dispatcher. Called once per fight
  // round before the regular party/boss exchange. Each branch handles its
  // own cooldown via boss._<id>ReadyAt timestamps.
  _runBossPactAttacks(boss, defenders) {
    const flags = this._gameState._mechanicFlags ?? {}
    const now = this._scene?.time?.now ?? 0

    // ── Hellfire Breath ──
    if (flags.hellfireBreath) {
      if (boss._hellfireWindupUntil && now >= boss._hellfireWindupUntil) {
        // Windup complete — torch up to N front-most defenders.
        const targets = [...defenders]
          .sort((a, b) => Math.hypot(a.adv.worldX - boss.worldX, a.adv.worldY - boss.worldY) - Math.hypot(b.adv.worldX - boss.worldX, b.adv.worldY - boss.worldY))
          .slice(0, Balance.MECHANIC_HELLFIRE_TARGETS)
        const dmg = Math.max(1, Math.floor(boss.attack * Balance.MECHANIC_HELLFIRE_DMG_MULT))
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
        const dmg = Math.max(1, Math.floor(boss.attack * Balance.MECHANIC_LIGHTNING_DMG_MULT))
        target.adv.resources.hp = Math.max(0, target.adv.resources.hp - dmg)
        const cost = Math.max(1, Math.floor((boss.maxHp ?? 0) * Balance.MECHANIC_LIGHTNING_BOSS_HP_COST_FRAC))
        boss.hp = Math.max(0, (boss.hp ?? 0) - cost)
        boss._lightningReadyAt = now + Balance.MECHANIC_LIGHTNING_COOLDOWN_MS
        EventBus.emit('PACT_BOSS_LIGHTNING_FIRED', { x: target.adv.worldX, y: target.adv.worldY, targetId: target.adv.instanceId, damage: dmg, selfCost: cost })
      }
    }

    // ── Shockwave Slam ──
    if (flags.shockwaveSlam && (boss._shockwaveReadyAt ?? 0) <= now && (boss._shockwaveStunUntil ?? 0) <= now) {
      const dmg = Math.max(1, Math.floor(boss.attack * Balance.MECHANIC_SHOCKWAVE_DMG_MULT))
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
        const dmg = Math.max(1, Math.floor(boss.attack * Balance.MECHANIC_SPECTRAL_REACH_DMG_MULT))
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
        // mid-channel — apply tick damage / heal each round
        const target = defenders.find(fs => fs.adv.instanceId === boss._soulDrainTargetId)
        if (target) {
          const dmg = Math.max(1, Math.floor(boss.attack * Balance.MECHANIC_SOUL_DRAIN_DMG_MULT * 0.34))  // ~3 ticks over channel
          target.adv.resources.hp = Math.max(0, target.adv.resources.hp - dmg)
          boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + dmg)
        }
      } else if (boss._soulDrainChannelUntil && now >= boss._soulDrainChannelUntil) {
        boss._soulDrainChannelUntil = null
        boss._soulDrainTargetId = null
        boss._soulDrainReadyAt = now + Balance.MECHANIC_SOUL_DRAIN_COOLDOWN_MS
        EventBus.emit('PACT_BOSS_SOULDRAIN_ENDED', {})
      } else if ((boss._soulDrainReadyAt ?? 0) <= now && defenders.length > 0) {
        const target = defenders[Math.floor(Math.random() * defenders.length)]
        boss._soulDrainTargetId = target.adv.instanceId
        boss._soulDrainChannelUntil = now + Balance.MECHANIC_SOUL_DRAIN_CHANNEL_MS
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
      }
      boss._petrifyReadyAt = now + Balance.MECHANIC_PETRIFY_COOLDOWN_MS
    }
  }
  getState()     { return { ...this._gameState.boss } }

  // ── Internals ────────────────────────────────────────────────────────────

  _onIncoming({ adventurer }) {
    if (this._fighting) return
    // Defensive: never start a fight on a dead-posed boss. AISystem already
    // redirects arriving advs to FLEE when boss.hp <= 0, but if anything
    // else fires BOSS_FIGHT_INCOMING during the death-pose window, ignore
    // it so no fight can begin until the post-wave summary clears the pose.
    const boss = this._gameState.boss
    const now  = this._scene.time?.now ?? 0
    if (boss && (boss.hp <= 0 || this._deathPoseUntil > now)) return
    this._fighting       = true
    this._combatStarted  = false
    this._fightEnded     = false
    this._fightCombatT   = 0
    this._roundLog       = []
    this._secondWindUsed = false
    this._roundsRun      = 0

    // Refresh boss HP up front; pre-fight ability effects happen here so they
    // are visible during the prefight banner / opening dance.
    if (boss) {
      boss.hp = boss.maxHp
      const owned = new Set(boss.unlockedAbilities ?? [])
      if (owned.has('soul_drain')) {
        boss.hp = Math.floor(boss.maxHp * 1.25)
      }
      if (owned.has('summon_adds')) {
        const bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
        if (bossRoom) {
          EventBus.emit('BOSS_SUMMONED_ADDS', { count: 2 })
          _summonAddsNearBoss(this._scene, this._gameState, bossRoom, 2)
        }
      }
    }

    EventBus.emit('BOSS_FIGHT_STARTED', { triggeringAdventurer: adventurer })

    // Combat rounds begin after a banner pause — the cinematic dance plays
    // throughout, but no damage is exchanged until this fires.
    this._scene.time.delayedCall(PREFIGHT_DELAY_MS, () => {
      this._combatStarted = true
    })
  }

  // Runs every frame from _tickFightAnim once combat has started.  Fires one
  // damage round every ROUND_INTERVAL_S, then evaluates flee + death.
  _tickFightCombat(dt) {
    this._fightCombatT += dt
    if (this._fightCombatT < ROUND_INTERVAL_S) return
    this._fightCombatT -= ROUND_INTERVAL_S
    this._runOneRound()
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

    if (this._roundsRun >= 24) {
      // Hard cap to break stalemates.
      const partyFrac = defenders.reduce((s, fs) =>
        s + fs.adv.resources.hp / Math.max(1, fs.adv.resources.maxHp), 0) / defenders.length
      const bossFrac  = boss.hp / Math.max(1, boss.maxHp)
      this._endFight(partyFrac > bossFrac ? 'party' : 'boss')
      return
    }
    this._roundsRun++

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

      let bossAtkPool = 0
      // Side-allies contribute their attack stat directly to the boss pool
      // (no minion-redirect — they're focused on the boss specifically).
      for (const ally of sideAllies) {
        bossAtkPool += ally.stats?.attack ?? 0
      }
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
          bossAtkPool += advAtk
        }
      }

      const dmgToBoss = bossAtkPool > 0
        ? Math.max(1, Math.floor((bossAtkPool - boss.defense) * (0.85 + Math.random() * 0.3)))
        : 0
      if (dmgToBoss > 0) {
        boss.hp = Math.max(0, boss.hp - dmgToBoss)
        this._roundLog.push({ side: 'party', damage: dmgToBoss })
        // Big collected damage hit on the boss — float a single number
        // (the pool result, not per-attacker) above the boss sprite.
        // Crit-flag when it shaves >=10% of maxHP in one round.
        const isHeavy = dmgToBoss >= Math.max(8, (boss.maxHp ?? 0) * 0.1)
        this._floatDamage(boss.worldX, boss.worldY - 12, dmgToBoss, {
          color: '#ffd166', crit: isHeavy,
        })
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
          const regen = 8 * sanctumCount
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
      if (flags.finalBreath && !flags.finalBreathUsed && boss.hp <= 1) {
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
      const taken  = Math.max(1, Math.floor((boss.attack ?? 0) * (0.85 + Math.random() * 0.3) - def))
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
          let bossAtk = boss.attack
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
        this._witnessAdvDeath(fs)
        continue
      }
      if (fs.action === 'flee') continue
      // _witnessAdvDeath above may have already flipped this fightState
      // into flee for us (panic).  Skip the fleeThreshold check so we
      // don't fire _beginFlee a second time for the same adventurer.
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

  // Watching a teammate drop is rough.  Each surviving fightState rolls a
  // personality-weighted panic chance; cowards break frequently, brave or
  // berserker types almost never.  Reuses _beginFlee so the panicked
  // adventurer gets the same handoff + 2× sprint as a normal flee.
  _witnessAdvDeath(deadFs) {
    if (!this._fightStates) return
    const ps = this._scene.personalitySystem
    for (const fs of this._fightStates.values()) {
      if (fs === deadFs) continue
      if (fs.action === 'flee' || fs.action === 'dying') continue
      if (fs.adv.resources.hp <= 0) continue
      const tags = ps?.getTags?.(fs.adv)
      if (tags && (tags.has?.('fearless') || tags.has?.('berserker'))) continue
      const w      = ps?.getWeights?.(fs.adv) ?? {}
      // fleeThreshold scales the panic chance — paranoid (0.6) → 24 %,
      // default (~0.3) → 12 %, speed_runner (0.12) → 4.8 %.
      const chance = (w.fleeThreshold ?? 0.3) * 0.4
      if (Math.random() < chance) {
        // Single emit — _beginFlee now folds the witnessed adventurer into
        // ADVENTURER_BREAKING_FROM_BOSS so the chat log only shows one
        // line per flee decision.
        this._beginFlee(fs, deadFs.adv)
      }
    }
  }

  // Personality-driven flee check.  Rolls once per threshold crossing so
  // most adventurers fight to the death — flee is rare, not guaranteed.
  // chance = threshold * 0.25: default(0.4)→10%, paranoid(0.6)→15%,
  // traumatized(0.95)→24%, speed_runner(0.12)→3%.
  _shouldFleeBoss(adv) {
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
  _beginFlee(fs, witnessedAdv = null) {
    EventBus.emit('ADVENTURER_BREAKING_FROM_BOSS', {
      adventurer: fs.adv,
      witnessed:  witnessedAdv,
    })
    this._handOffToAIFlee(
      fs.adv,
      witnessedAdv ? 'panic_witnessed_death' : 'fled_from_boss',
    )
  }

  _endFight(winner) {
    if (this._fightEnded) return
    this._fightEnded = true

    const boss = this._gameState.boss

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
    const isLethal = winner === 'party' && (boss?.hp ?? 0) <= 0
    if (isLethal) {
      const origScale = this._scene.time.timeScale ?? 1
      this._scene.time.timeScale = 0.25
      window.setTimeout(() => {
        if (this._scene?.time) this._scene.time.timeScale = origScale
      }, 400)
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
        this._handOffToAIFlee(adv, 'boss_defeated')
      }
    }

    if (winner === 'party' && boss) {
      boss.deathsRemaining = Math.max(0, boss.deathsRemaining - 1)
    }

    // Phase 1b.4 — Lich Phylactery acts as a 4th life. When the boss runs
    // out of normal lives but the phylactery is still alive, instead of
    // ending the run we revive the boss for one more death. Only the lich
    // archetype can have a phylactery, and only one is ever placed.
    const phyl = this._gameState?.phylactery
    const phylAlive = phyl && (phyl.resources?.hp ?? 0) > 0
    if (winner === 'party' && boss && boss.deathsRemaining <= 0 && phylAlive) {
      boss.deathsRemaining = 1
      boss.hp              = boss.maxHp
      EventBus.emit('PHYLACTERY_REVIVED_BOSS', { phylactery: phyl })
    }

    // Death-pose freeze — only when the boss actually died this round
    // (hp drained to 0; the 24-round stalemate cap can resolve in the
    // party's favour without killing the boss, and that path should
    // NOT play death anim or freeze the boss).  The freeze persists
    // until SHOW_POST_WAVE_SUMMARY (popup appears) or BOSS_FIGHT_INCOMING
    // (next party arrives that day) clears _deathPoseUntil — see _wire().
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
      EventBus.emit('BOSS_DEFEATED_FINAL', { totalDays: this._gameState.player.totalDaysElapsed })
    }

    // Reset
    this._fighting       = false
    this._combatStarted  = false
    this._fightT         = 0
    this._fightCombatT   = 0
    this._fightStates    = null
    this._bossState      = null
    if (this._fxGraphics)  this._fxGraphics.clear()
    if (this._fxParticles) this._fxParticles.length = 0
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
  _handOffToAIFlee(adv, reason) {
    const TS = Balance.TILE_SIZE
    // Sync tile coords from world position so AISystem starts pathing from
    // wherever our fight animation left them.
    adv.tileX   = Math.floor(adv.worldX / TS)
    adv.tileY   = Math.floor(adv.worldY / TS)
    adv.path    = null
    adv.goal    = { type: 'FLEE', reason }
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
function _summonAddsNearBoss(scene, gameState, bossRoom, count) {
  const minionTypes = scene.cache.json.get('minionTypes') ?? []
  const def = minionTypes.find(d => d.id === 'skeleton1') ?? minionTypes[0]
  if (!def) return
  const TS = 32
  const w = Balance.WALL_THICKNESS
  const innerW = Math.max(1, bossRoom.width - 2 * w)
  for (let i = 0; i < count; i++) {
    const x = bossRoom.gridX + w + (i % innerW)
    const y = bossRoom.gridY + w
    const m = {
      instanceId:    `boss_add_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 4)}`,
      definitionId:  def.id,
      name:          'Boss Add',
      faction:       'dungeon',
      isBossAdd:     true,
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
    gameState.minions ??= []
    gameState.minions.push(m)
  }
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
