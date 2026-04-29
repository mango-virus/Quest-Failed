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

    this._init()
    this._wire()
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._fxGraphics?.destroy()
    this._fxGraphics = null
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
      this._gameState.boss.tileX  ??= cx
      this._gameState.boss.tileY  ??= cy
      this._gameState.boss.worldX ??= cx * TS + TS / 2
      this._gameState.boss.worldY ??= cy * TS + TS / 2
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
    }
  }

  // ── Ability tree (Phase 10b) ─────────────────────────────────────────────

  // Returns ability defs the player could buy right now (not already owned,
  // requirements met). Filters by power cost too if filterAffordable=true.
  getAvailableAbilities(filterAffordable = false) {
    const defs = this._scene.cache.json.get('bossAbilities') ?? []
    const owned = new Set(this._gameState.boss.unlockedAbilities ?? [])
    const dp = this._gameState.player.darkPower ?? 0
    return defs.filter(d => {
      if (owned.has(d.id)) return false
      for (const req of (d.requires ?? [])) if (!owned.has(req)) return false
      if (filterAffordable && (d.powerCost ?? 0) > dp) return false
      return true
    })
  }

  unlockAbility(abilityId) {
    const defs = this._scene.cache.json.get('bossAbilities') ?? []
    const def = defs.find(d => d.id === abilityId)
    if (!def) return false
    const owned = this._gameState.boss.unlockedAbilities
    if (owned.includes(abilityId)) return false
    if ((this._gameState.player.darkPower ?? 0) < (def.powerCost ?? 0)) return false
    for (const req of (def.requires ?? [])) {
      if (!owned.includes(req)) return false
    }
    this._gameState.player.darkPower -= (def.powerCost ?? 0)
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
    const x0 = room.gridX + 1
    const y0 = room.gridY + 1
    const x1 = room.gridX + room.width  - 2
    const y1 = room.gridY + room.height - 2
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
  }

  // Reconcile our internal fight-state map with the live AT_BOSS adventurer
  // list each tick, so late arrivals slot into the dance and dead/fled
  // combatants are pruned without leaving stale entries behind.
  _syncFightParty() {
    // 1) Conscript anyone in/adjacent to the boss chamber who isn't already
    //    AT_BOSS.  AISystem only flips the one adventurer that crossed the
    //    threshold; without this conscription, party-mates already standing
    //    inside the room (or right next to it) just watch.
    //
    //    Critically — never re-conscript an adventurer who's already
    //    fleeing.  Without that guard, the moment _beginFlee sets goal to
    //    FLEE, this pass would yank them straight back into AT_BOSS on
    //    the same frame because they're still standing in the room.
    const room = this._bossRoom
    if (room) {
      for (const a of this._gameState.adventurers.active) {
        if (a.aiState === 'dead' || a.aiState === 'fled' || a.aiState === 'fleeing') continue
        if (a.goal?.type === 'AT_BOSS' || a.goal?.type === 'FLEE') continue
        if (!_inOrAdjacentToRoom(a, room)) continue
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
    const classes   = this._scene.cache.json.get('adventurerClasses') ?? []
    const activeIds = new Set()
    for (const a of this._gameState.adventurers.active) {
      if (a.aiState === 'dead' || a.aiState === 'fled') continue
      const isAtBoss = a.goal?.type === 'AT_BOSS'
      const isInRoom = !!room &&
        a.tileX >= room.gridX && a.tileX < room.gridX + room.width &&
        a.tileY >= room.gridY && a.tileY < room.gridY + room.height
      if (!isAtBoss && !isInRoom) continue
      activeIds.add(a.instanceId)
      if (this._fightStates.has(a.instanceId)) continue
      // New combatant — homeAngle spread relative to existing population.
      const idx      = this._fightStates.size
      const total    = idx + 1
      const phase    = (Math.PI * 2 * idx) / Math.max(2, total) + Math.random() * 0.4
      const classDef = classes.find(c => c.id === a.classId)
      const isRanged = !!classDef?.tags?.includes('ranged')
      this._fightStates.set(a.instanceId, {
        adv:        a,
        action:     isRanged ? 'reposition' : 'dash',
        actionT:    0,
        actionDur:  0.3 + Math.random() * 0.2,
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

  _roomClamp() {
    const TS   = Balance.TILE_SIZE
    const room = this._bossRoom
    const minX = (room.gridX + 1) * TS + TS / 2
    const maxX = (room.gridX + room.width  - 2) * TS + TS / 2
    const minY = (room.gridY + 1) * TS + TS / 2
    const maxY = (room.gridY + room.height - 2) * TS + TS / 2
    return {
      clampX: (x) => Math.max(minX, Math.min(maxX, x)),
      clampY: (y) => Math.max(minY, Math.min(maxY, y)),
    }
  }

  _emitFx(p) {
    p.t = 0
    if      (p.kind === 'strike')      p.dur = 0.18
    else if (p.kind === 'wind_up')     p.dur = 0.30
    else if (p.kind === 'shockwave')   p.dur = 0.40
    else if (p.kind === 'wall_hit')    p.dur = 0.25
    else if (p.kind === 'lunge_trail') p.dur = 0.30
    else if (p.kind === 'cast')        p.dur = 0.28
    else if (p.kind === 'dodge')       p.dur = 0.30
    else if (p.kind === 'taunt')       p.dur = 0.55
    else                                p.dur = 0.20
    this._fxParticles.push(p)
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
          // Small yellow burst with white outer ring at impact point
          const r = 4 + phase * 8
          g.fillStyle(0xffee66, alpha * 0.85)
          g.fillCircle(p.x, p.y, r)
          g.lineStyle(2, 0xffffff, alpha)
          g.strokeCircle(p.x, p.y, r * 1.25)
          break
        }
        case 'wind_up': {
          // Red telegraph ring contracting toward boss
          const r = (1.6 - phase * 0.5) * TS
          g.lineStyle(3, 0xff3322, alpha * 0.9)
          g.strokeCircle(p.x, p.y, r)
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
    EventBus.on('BOSS_FIGHT_INCOMING', onIncoming)
    this._listeners = [
      ['BOSS_FIGHT_INCOMING', onIncoming],
    ]
  }

  // ── Public API ───────────────────────────────────────────────────────────

  isFinalDeath() { return (this._gameState.boss?.deathsRemaining ?? 0) <= 0 }
  getState()     { return { ...this._gameState.boss } }

  // ── Internals ────────────────────────────────────────────────────────────

  _onIncoming({ adventurer }) {
    if (this._fighting) return
    this._fighting       = true
    this._combatStarted  = false
    this._fightEnded     = false
    this._fightCombatT   = 0
    this._roundLog       = []
    this._secondWindUsed = false
    this._roundsRun      = 0

    // Refresh boss HP up front; pre-fight ability effects happen here so they
    // are visible during the prefight banner / opening dance.
    const boss = this._gameState.boss
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
    const attackers = all.filter(fs =>
      fs.action !== 'flee' && fs.action !== 'dying' && fs.adv.resources.hp > 0
    )
    const defenders = all.filter(fs =>
      fs.action !== 'dying' && fs.adv.resources.hp > 0
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
    if (attackers.length > 0) {
      const totalAtk  = attackers.reduce((s, fs) => s + (fs.adv.stats?.attack ?? 5), 0)
      const dmgToBoss = Math.max(1, Math.floor((totalAtk - boss.defense) * (0.85 + Math.random() * 0.3)))
      boss.hp = Math.max(0, boss.hp - dmgToBoss)
      this._roundLog.push({ side: 'party', damage: dmgToBoss })

      if (!this._secondWindUsed && owned.has('second_wind') && boss.hp > 0 && boss.hp < boss.maxHp * 0.2) {
        boss.hp = Math.min(boss.maxHp, boss.hp + 30)
        this._secondWindUsed = true
        EventBus.emit('BOSS_SECOND_WIND')
      }
      if (boss.hp <= 0) {
        this._endFight('party')
        return
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
        const def   = target.adv.stats?.defense ?? 0
        const taken = Math.max(1, Math.floor(boss.attack * (0.85 + Math.random() * 0.3) - def))
        target.adv.resources.hp = Math.max(0, target.adv.resources.hp - taken)
        this._roundLog.push({ side: 'boss', damage: taken, targetId: target.adv.instanceId })
        this._emitFx({ kind: 'strike', x: target.adv.worldX, y: target.adv.worldY })
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

  // Personality-driven flee check.  fleeThreshold weight is the HP fraction
  // BELOW which the adventurer breaks — paranoid (0.6) bails early, speed
  // runner (0.12) holds out till nearly dead.
  _shouldFleeBoss(adv) {
    const hp     = adv.resources.hp
    const maxHp  = adv.resources.maxHp ?? 1
    const hpFrac = hp / Math.max(1, maxHp)
    const ps     = this._scene.personalitySystem
    const w      = ps?.getWeights?.(adv) ?? {}
    const threshold = w.fleeThreshold ?? 0.4
    return hpFrac < threshold
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

    EventBus.emit('BOSS_FIGHT_RESOLVED', {
      winner,
      bossHpRemaining: boss?.hp ?? 0,
      deathsRemaining: boss?.deathsRemaining ?? 0,
      rounds:          this._roundsRun,
      roundLog:        this._roundLog ?? [],
      party:           finalParty,
    })

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

// Phase 10b — summon a small number of dungeon-faction skeletons near the
// boss chamber when the Summon Adds ability is unlocked. They join combat
// via the existing MinionAISystem next tick.
function _summonAddsNearBoss(scene, gameState, bossRoom, count) {
  const minionTypes = scene.cache.json.get('minionTypes') ?? []
  const def = minionTypes.find(d => d.id === 'skeleton1') ?? minionTypes[0]
  if (!def) return
  const TS = 32
  for (let i = 0; i < count; i++) {
    const x = bossRoom.gridX + 1 + (i % bossRoom.width)
    const y = bossRoom.gridY + 1
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
