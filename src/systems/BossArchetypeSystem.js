// BossArchetypeSystem — owns the per-archetype headline mechanics for the
// 10 monster bosses (Phase 1b). All hooks check `gameState.player.bossArchetypeId`
// before reacting, so a single system can host every archetype rule.
//
// Phase 1b.1 — ORC: Loot the Fallen + Warband (Phase 1b.12 followup)
//   Loot the Fallen: each orc minion keeps +1 ATK per adventurer it
//     personally kills (tracked on `_lootAtkBonus`). No cap, lost on death.
//   Warband: every orc-tagged minion gets +5% ATK and +5% DEF per OTHER
//     orc-tagged minion currently in the same room (live recompute each
//     frame from `_orcBaseAttack` / `_orcBaseDefense` baselines). Stacks
//     with Loot the Fallen multiplicatively.
//
// Phase 1b.2 — GOLEM: Living Architecture + Earthquake
//   Living Architecture: each placed room (incl. boss + corridor) gives the
//     boss +5 max HP and +1 DEF, permanently. Tracked via gameState.boss._golem
//     so save/load and dynamic placement/removal stay consistent.
//   Earthquake: 1×/day during day phase. Player clicks the Earthquake button
//     in the boss-archetype UI, then clicks a target room — every adv inside
//     takes (rooms placed × 2) damage. Camera shake VFX.
//
// Phase 1b.3 — BEHOLDER: Petrify Gaze + Anti-Magic Aura
//   Petrify Gaze: while the boss fight is active, every 6 s the boss freezes
//     every active fighter for 2 s. Eye-beam + stone-crackle VFX.
//   Anti-Magic Aura: at the start of each day, mark N random rooms (excluding
//     boss chamber) as anti-magic. N = 2 + (boss level - 1). Adventurers
//     inside those rooms cannot fire any class abilities for the day. Each
//     marked room gets a faint purple glow.
//
// Phase 1b.4 — LICH: Phylactery
//   Phylactery: at boss level 3 the Heart item unlocks (free, one per run).
//     Place it in any non-boss room. While the heart lives, it acts as a
//     4th boss life. Each spawned adv has a 15% chance to hunt the heart on
//     entry; when boss has 0 normal lives left, every adv auto-hunts it.
//     Reaching the heart's tile freezes the adv there and BossArchetypeSystem
//     ticks damage = adv.stats.attack every LICH_PHYLACTERY_DMG_INTERVAL_MS.
//
// Phase 1b.5 — LICH: Necromancy
//   Every adventurer killed in the dungeon raises as a free Skeleton minion
//   at the next dawn. Skeleton lasts one full day, then despawns. Tagged
//   with the dead adv's class — Cleric raises heal nearby minions, Mage
//   raises gain ranged attack, etc. Skeletons don't count toward minion cap.
//
// Phase 1b.6 — LIZARDMAN: Camouflage + Venom Stack
//   Camouflage: every lizardman-tagged minion spawns invisible to advs
//   (AISystem skip + KnowledgeSystem skip). Each minion individually
//   reveals on its first attack (CombatSystem hook clears _camouflaged).
//   Re-camouflage applies on NIGHT_PHASE_STARTED so each new day = fresh
//   ambush. Player still sees the minions, rendered at 0.5 alpha.
//   Venom Stack: every lizardman-minion hit on an adv adds 1 venom stack;
//   per-tick DoT (every 1 s) ticks -1 HP per stack until adv dies or flees.
//
// Phase 1b.7 — MYCONID: Spore Network + Corpse Bloom
//   Spore Network: every MYCONID_SPORE_INTERVAL_DAYS, all corridor-room
//   instances emit a poison cloud for the entire day. Advs inside take
//   `0.5 × bossLevel` HP/tick. Faint green cloud + spore-particle VFX.
//   Corpse Bloom: every adventurer that dies leaves a green-tinted fungal
//   corpse on its tile. Corpses last MYCONID_CORPSE_LIFESPAN_DAYS days.
//   Touching a fresh corpse adds MYCONID_CORPSE_VENOM_STACKS_ADDED stacks
//   to the adv (reuses the lizardman venom-tick pipeline). When the corpse
//   times out, it sprouts a free `plant1` (Vinekin) minion. Corpses
//   despawn early if the room they live in is removed.
//
// Phase 1b.11 — GNOLL: Hunters Pack + Bloodlust
//   Hunters Pack: a free `gnoll1` lives in the boss room. +1 free gnoll per
//     boss level above 1, capped at GNOLL_HUNTERS_PACK_MAX (5). They use
//     class:'garrison' (no minion-cap), evolve normally on kills, and are
//     re-spawned to fill missing slots at every NIGHT_PHASE_STARTED so the
//     pack rebuilds itself overnight.
//   Bloodlust: every adventurer killed by a minion or the boss adds
//     GNOLL_BLOODLUST_PCT_PER_KILL (3%) ATK to every gnoll for the rest of
//     the day, no cap. Each gnoll's daily baseline ATK is captured at dawn
//     so the buff can be cleanly reset. Red-flash VFX + "+3% ATK" floater
//     per stack.
//
// Phase 1b.10 — VAMPIRE: Charm + Blood Tax
//   Charm: at the start of each day the system marks one random adv from
//     the spawning party with `_charmed: true` + a CHARM_WALK goal (route
//     to the boss room). When they reach a boss-chamber tile, they're
//     converted into a thrall: a free `vampire_minion1` minion (no cap)
//     with `_isVampireThrall: true` + `_charmedClassId` retained for flavor.
//     Thralls roam the entire dungeon hunting advs (assignedRoomId rotates
//     every VAMPIRE_THRALL_ROAM_SWAP_MS — same pattern as Demon imps), and
//     do not respawn after death.
//   Blood Tax: every dungeon-faction minion's hit on an adv heals the boss
//     for the same damage amount (capped at boss.maxHp). Adv still loses
//     HP normally; adv still dies on lethal hits. Boss attacks unaffected.
//     Red-streak VFX from the adv to the boss for each tax tick.
//
// Phase 1b.9 — DEMON: Sacrifice Pact + Hellgate
//   Sacrifice Pact: 1×/day, player clicks the SACRIFICE button — it fires
//     immediately, auto-choosing the minion to burn (no pick step). 50%
//     chance to burn an expendable Hellgate Imp when any exist, else a
//     random dungeon minion. The burned minion permadies (no respawn) and
//     one randomly-chosen alive adv in the dungeon is instakilled.
//   Hellgate: a permanent infernal portal sits in a corner of the boss
//     chamber. Each dawn N free Imps spawn (N = boss level), stat-scaled
//     to 10% of imp1 base × (1 + bossLevel × 10%). Imps roam the whole
//     dungeon (assignedRoomId rotates each minute), persist forever, and
//     do not count toward the minion cap.
//
// Phase 1b.8 — WRAITH: Fear Meter + Haunting
//   Fear Meter: every adv carries `_fear` (0..100). +5 per corpse newly
//   seen, +10 per trap they trigger, +5 per minion newly observed,
//   +15 when an ally dies in front of them. At 50% fear they panic-flee
//   to a random non-exit room. At 75% they enter a 5 s friendly-fire window.
//   At 100% they die instantly — drop gold but no boss XP.
//   Haunting: every adv that dies (regardless of how) spawns a free
//   `ghost2` minion at the death tile. Ghost is permanent (no minion-cap),
//   patrols its spawn room, and wall-phases to adjacent connected rooms
//   to engage advs there, returning home if alive afterward.
//
// Future phases extend this file (Lizardman, Wraith, etc).

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'
import { createMinion, applyMinionScaling, applyBossLevelToMinion } from '../entities/Minion.js'
import { TILE }     from './DungeonGrid.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'

// Slime King Absorb & Excrete — Goopling roll pool, level-gated.
//
// Tier mapping comes from src/data/minionEvolutions.json — each of the
// three slime chains is laid out as [T1, T2, T3, T4-elder]:
//   Toxic   : slime3 → slime7 → slime8 → elder_slime1
//   Acid    : slime2 → slime9 → slime1 → elder_slime2
//   Frost   : slime4 → slime5 → slime6 → elder_slime3
//
// Per-tier pool = one entry from each chain at that tier so every spawn
// has visual variety (random palette + ability mix).
const GOOPLING_POOL_T1 = ['slime2', 'slime3', 'slime4']
const GOOPLING_POOL_T2 = ['slime5', 'slime7', 'slime9']
const GOOPLING_POOL_T3 = ['slime1', 'slime6', 'slime8']

function _gooplingPoolForBossLevel(bossLv) {
  if ((bossLv ?? 1) <= 4) return GOOPLING_POOL_T1
  if ((bossLv ?? 1) <= 8) return GOOPLING_POOL_T2
  return GOOPLING_POOL_T3
}

const MINION_TAG_ORC       = 'orc'
const MINION_TAG_LIZARDMAN = 'lizardman'

export class BossArchetypeSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState

    // Earthquake transient state — armed = waiting for room click.
    this._earthquakeArmed     = false
    // Sacrifice Pact transient state — armed = waiting for minion click.
    this._sacrificeArmed      = false

    // Beholder Petrify Gaze — active timer reference + per-fight VFX layer.
    this._petrifyTimer       = null
    this._petrifyFxGraphics  = null
    // Beholder Anti-Magic Aura — graphics layer for the daily purple glow.
    this._antiMagicFx        = null

    EventBus.on('ADVENTURER_DIED',    this._onAdvDied,        this)
    EventBus.on('MINION_DIED',        this._onMinionDied,     this)
    EventBus.on('ROOM_PLACED',        this._onRoomPlaced,     this)
    EventBus.on('ROOM_REMOVED',       this._onRoomRemoved,    this)
    EventBus.on('NIGHT_PHASE_STARTED', this._onNightStart,    this)
    EventBus.on('GOLEM_EARTHQUAKE_ARM',     this._armEarthquake,    this)
    EventBus.on('GOLEM_EARTHQUAKE_DISARM',  this._disarmEarthquake, this)
    EventBus.on('GOLEM_EARTHQUAKE_TARGET',  this._fireEarthquake,   this)
    // Beholder hooks
    EventBus.on('BOSS_FIGHT_STARTED',  this._onBossFightStarted, this)
    EventBus.on('BOSS_FIGHT_RESOLVED', this._onBossFightResolved, this)
    EventBus.on('DAY_PHASE_BEGAN',     this._onDayBegan,         this)
    // Lich hooks
    EventBus.on('ADVENTURERS_SPAWNED', this._onAdvsSpawned, this)
    EventBus.on('BOSS_LEVELED_UP',     this._onBossLeveledUp, this)
    // Lizardman hooks
    EventBus.on('MINION_PLACED',  this._onMinionPlaced, this)
    EventBus.on('COMBAT_HIT',     this._onCombatHit,    this)
    EventBus.on('ADVENTURER_FLED', this._onAdvFledOrDied, this)
    // Myconid hooks (corpse cleanup when a room gets sold/moved)
    EventBus.on('ROOM_REMOVED',   this._onRoomRemovedMyconid, this)
    // Wraith hooks
    EventBus.on('TRAP_TRIGGERED',           this._onTrapTriggered, this)
    EventBus.on('ADVENTURER_ROOM_CHANGED',  this._onAdvRoomChanged, this)
    EventBus.on('MINION_OBSERVED',          this._onMinionObserved, this)
    // Demon hooks
    EventBus.on('DEMON_SACRIFICE_ARM',     this._armSacrifice,    this)
    EventBus.on('DEMON_SACRIFICE_DISARM',  this._disarmSacrifice, this)
    EventBus.on('DEMON_SACRIFICE_TARGET',  this._fireSacrifice,   this)

    // Backfill Living Architecture for the rooms already placed at scene
    // boot (boss chamber, plus any rooms restored from a save).
    this._initLivingArchitecture()
    // Restore the daily anti-magic aura overlay if the day started before
    // this scene mounted (e.g. save loaded mid-day).
    this._renderAntiMagicAura()
    // Lich: re-fire the phylactery unlock toast on save load if the player
    // hit lvl 3 in a previous session and never saw the notice.
    this._maybeShowPhylacteryUnlockToast()
    // Demon: re-render the Hellgate portal in the boss room corner if a
    // save was loaded mid-run.
    this._renderHellgatePortal()
    // Demon: ensure daily-uses counter exists.
    if (this._archId() === 'demon') {
      // +0.333 uses per boss-lv (floor adds ~1 every 3 lv).
      const bossLv = this._gameState?.boss?.level ?? 1
      const dailyUses = Balance.DEMON_SACRIFICE_USES_PER_DAY
        + Math.floor(bossLv * Balance.DEMON_SACRIFICE_USES_PER_BOSS_LV)
      this._gameState._demon ??= { sacrificeUsesLeft: dailyUses }
    }
    // Orc: capture pristine baselines for every existing orc on save-load /
    // scene boot. Without this, _tickOrc would treat the post-buff stats as
    // the baseline and Warband would compound. Skipped if a baseline is
    // already stamped (so reload mid-day keeps the pristine value).
    if (this._archId() === 'orc') {
      for (const m of (this._gameState?.minions ?? [])) {
        if (!this._isOrcMinion(m)) continue
        if (m._orcBaseAttack != null) continue
        this._captureOrcBaseline(m)
      }
    }
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED',    this._onAdvDied,        this)
    EventBus.off('MINION_DIED',        this._onMinionDied,     this)
    EventBus.off('ROOM_PLACED',        this._onRoomPlaced,     this)
    EventBus.off('ROOM_REMOVED',       this._onRoomRemoved,    this)
    EventBus.off('NIGHT_PHASE_STARTED', this._onNightStart,    this)
    EventBus.off('GOLEM_EARTHQUAKE_ARM',     this._armEarthquake,    this)
    EventBus.off('GOLEM_EARTHQUAKE_DISARM',  this._disarmEarthquake, this)
    EventBus.off('GOLEM_EARTHQUAKE_TARGET',  this._fireEarthquake,   this)
    EventBus.off('BOSS_FIGHT_STARTED',  this._onBossFightStarted, this)
    EventBus.off('BOSS_FIGHT_RESOLVED', this._onBossFightResolved, this)
    EventBus.off('DAY_PHASE_BEGAN',     this._onDayBegan,         this)
    EventBus.off('ADVENTURERS_SPAWNED', this._onAdvsSpawned,    this)
    EventBus.off('BOSS_LEVELED_UP',     this._onBossLeveledUp,  this)
    EventBus.off('MINION_PLACED',       this._onMinionPlaced,   this)
    EventBus.off('COMBAT_HIT',          this._onCombatHit,      this)
    EventBus.off('ADVENTURER_FLED',     this._onAdvFledOrDied,  this)
    EventBus.off('ROOM_REMOVED',        this._onRoomRemovedMyconid, this)
    EventBus.off('TRAP_TRIGGERED',           this._onTrapTriggered,  this)
    EventBus.off('ADVENTURER_ROOM_CHANGED',  this._onAdvRoomChanged, this)
    EventBus.off('MINION_OBSERVED',          this._onMinionObserved, this)
    EventBus.off('DEMON_SACRIFICE_ARM',     this._armSacrifice,    this)
    EventBus.off('DEMON_SACRIFICE_DISARM',  this._disarmSacrifice, this)
    EventBus.off('DEMON_SACRIFICE_TARGET',  this._fireSacrifice,   this)
    this._hellgateFx?.destroy?.()
    this._hellgateFx = null
    this._clearSporeFx()
    this._stopPetrifyTimer()
    this._petrifyFxGraphics?.destroy?.()
    this._petrifyFxGraphics = null
    this._antiMagicFx?.destroy?.()
    this._antiMagicFx = null
  }

  _archId() {
    return this._gameState?.player?.bossArchetypeId ?? null
  }

  _findMinion(instanceId) {
    if (!instanceId || instanceId === 'boss' || instanceId === 'unknown') return null
    return this._gameState?.minions?.find(m => m.instanceId === instanceId) ?? null
  }

  // ── ORC: Loot the Fallen ────────────────────────────────────────────────

  _onAdvDied(payload) {
    // ORC: Loot the Fallen (per-orc kill counter). Just bumps the bonus
    // counter — the live `stats.attack` value is recomputed each frame in
    // `_tickOrc` from `_orcBaseAttack + lootAtkBonus`, then multiplied by
    // the Warband cluster bonus.
    if (this._archId() === 'orc') {
      const killer = this._findMinion(payload?.killerId)
      if (killer && Array.isArray(killer.tags) && killer.tags.includes(MINION_TAG_ORC)) {
        killer.lootAtkBonus = (killer.lootAtkBonus ?? 0) + 1
        EventBus.emit('LOOT_THE_FALLEN_TICK', {
          minionId: killer.instanceId,
          newBonus: killer.lootAtkBonus,
        })
      }
    }
    // LICH: Necromancy — queue this dead adv for raise at next dawn.
    if (this._archId() === 'lich') {
      const adv = payload?.adventurer
      if (adv) {
        this._gameState._lich ??= { pendingRaises: [] }
        this._gameState._lich.pendingRaises ??= []
        this._gameState._lich.pendingRaises.push({
          classId:       adv.classId ?? 'knight',
          name:          adv.name ?? 'Risen',
          level:         adv.level ?? 1,
          tileX:         adv.tileX,
          tileY:         adv.tileY,
          // Capture LPC sheet identity so MinionRenderer can render the
          // raised minion with the dead adventurer's sprite (tinted
          // darker), matching the "they look like the adventurer that
          // died" design intent.
          spriteVariant: adv.spriteVariant ?? null,
        })
      }
    }
    // WRAITH: Fear bump for any adv who watched a same-party member die,
    // plus Haunting ghost spawn at the death tile.
    if (this._archId() === 'wraith') {
      const dead = payload?.adventurer
      if (dead) {
        this._spawnHauntGhost(dead, payload?.roomId ?? null)
        const advs = this._gameState?.adventurers?.active ?? []
        for (const a of advs) {
          if (!a || a === dead) continue
          if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
          if (a.partyId && a.partyId !== dead.partyId) continue
          // "In front of them" — same room as the death OR within 5 tiles.
          const sameRoom = !!payload?.roomId &&
            this._scene?.dungeonGrid?.getRoomAtTile?.(a.tileX, a.tileY)?.instanceId === payload.roomId
          const close = (Math.abs(a.tileX - dead.tileX) + Math.abs(a.tileY - dead.tileY)) <= 5
          if (sameRoom || close) {
            this._addFear(a, Balance.WRAITH_FEAR_PER_ALLY_DIED_NEAR)
          }
        }
      }
    }
    // GNOLL: Bloodlust — every minion or boss kill on an adv stacks +3%
    // ATK on every alive gnoll-tagged minion for the rest of the day.
    if (this._archId() === 'gnoll') {
      const killerId = payload?.killerId
      const isMinionOrBoss =
        killerId && killerId !== 'unknown' && killerId !== 'venom' &&
        killerId !== 'spores' && killerId !== 'fear' &&
        (killerId === 'boss' || !!this._findMinion(killerId))
      if (isMinionOrBoss) {
        this._applyBloodlustStack()
      }
    }
    // MYCONID: Corpse Bloom — drop a 3-day fungal corpse at the death tile.
    if (this._archId() === 'myconid') {
      const adv = payload?.adventurer
      if (adv && typeof adv.tileX === 'number' && typeof adv.tileY === 'number') {
        const room = this._scene?.dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)
        this._gameState.fungalCorpses ??= []
        // Hard cap on simultaneous corpses — without it Myconid snowballs:
        // every adv kill is both gold AND a permanent venom tile AND a free
        // future minion. Skip new corpses once the cap is full; a slot opens
        // up when an existing corpse expires/sprouts or its room is moved.
        if (this._gameState.fungalCorpses.length >= Balance.MYCONID_CORPSE_MAX_ACTIVE) {
          EventBus.emit('MYCONID_CORPSE_CAPPED', {
            advId: adv.instanceId ?? null,
            cap:   Balance.MYCONID_CORPSE_MAX_ACTIVE,
          })
          return
        }
        // Capture the LPC sprite-sheet info so FungalCorpseRenderer can paint
        // the actual last frame of the adv's hurt animation tinted green
        // instead of the generic skull stand-in. spriteVariant is "<class>/<vNN>".
        const variantKey = adv.spriteVariant
          ? `adv-${adv.spriteVariant.replace('/', '-')}`
          : null
        let lastHurtFrame = null
        if (variantKey) {
          const animKey = `${variantKey}-hurt-down`
          const anim    = this._scene?.anims?.get?.(animKey)
          const frames  = anim?.frames
          if (Array.isArray(frames) && frames.length > 0) {
            const f = frames[frames.length - 1]
            // Phaser stores the spritesheet index on `frame.name`.
            lastHurtFrame = f?.frame?.name ?? null
          }
        }
        this._gameState.fungalCorpses.push({
          instanceId:    `fcor_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          // Track the source adv so the sprout can despawn the dead body
          // sprite that AdventurerRenderer leaves frozen on the death tile.
          advId:         adv.instanceId ?? null,
          tileX:         adv.tileX,
          tileY:         adv.tileY,
          roomId:        room?.instanceId ?? null,
          daysRemaining: Balance.MYCONID_CORPSE_LIFESPAN_DAYS,
          classId:       adv.classId ?? 'unknown',
          name:          adv.name    ?? 'Corpse',
          // Sprite-capture for the green-tinted corpse glyph.
          textureKey:    variantKey,
          lastHurtFrame,
        })
      }
    }
  }

  _onMinionDied(payload) {
    const m = payload?.minion
    if (!m) return

    // Slime King — Absorb & Excrete. Runs BEFORE the orc handler bails on
    // non-orc minions so it can fire for any of the player's dungeon
    // minions (which are obviously not orc-tagged).
    if (this._archId() === 'slime') {
      this._onSlimeMinionDied(m)
      // No early-return — we still let downstream orc/etc. handlers run
      // in case a future archetype layer wants to react to the same death.
    }

    if (!Array.isArray(m.tags) || !m.tags.includes(MINION_TAG_ORC)) return
    // Loot the Fallen now writes only `lootAtkBonus` (Warband owns the
    // live stats.attack recompute). Just zero the counter on death; the
    // next `_tickOrc` will see the missing orc and rebalance the cluster.
    m.lootAtkBonus = 0
  }

  // ── SLIME KING: Absorb & Excrete ──────────────────────────────────────
  //
  // Every player-side minion that dies in the dungeon gets swallowed by
  // the King — it disappears from the minion roster entirely (no respawn
  // at next dawn) and the King excretes a Goopling in his boss room. The
  // Goopling is a runtime CLONE of a random existing slime minion type
  // (slime1..slime9 + elder_slime1..3) — same sprite, same stats, same
  // abilities — tagged `_isGoopling = true` so it stays a one-shot life
  // (MinionAISystem.respawnAll skips it just like Hellgate imps).
  //
  // Spawn anchor is the boss room; we set the Goopling's `assignedRoomId`
  // to the original minion's home room so the patrol AI naturally
  // pathfinds it back toward where it came from. Adventurers it meets en
  // route trigger the standard chase/attack behaviour (no special-casing
  // needed — MinionAISystem already handles that).
  //
  // Exclusions match the user spec:
  //   • Mini-slime (Slime Split mini-spawns)        — would feedback-loop
  //   • Gooplings themselves                         — would feedback-loop
  //   • Other one-shot specials (Imp / Vinekin /
  //     Haunt Ghost / HoT spawn / Throne mini-boss
  //     / Mercenary)                                  — own death rules
  //   • Sacrificed / burnt minions                  — player chose this
  //   • Adventurer-faction minions (raises / tames) — not "yours"
  _onSlimeMinionDied(deadMinion) {
    if (this._shouldSkipSlimeAbsorb(deadMinion)) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    const minionDefs = this._scene.cache.json.get('minionTypes') ?? []

    // Level-gated tier pool — T1 (boss lv 1-4), T2 (5-8), T3 (9+).
    const bossLv = this._gameState?.boss?.level ?? 1
    const tieredPool = _gooplingPoolForBossLevel(bossLv)
    const pool = tieredPool.filter(id => minionDefs.some(d => d.id === id))
    if (pool.length === 0) return
    const pickId = pool[Math.floor(Math.random() * pool.length)]
    const def    = minionDefs.find(d => d.id === pickId)
    if (!def) return

    // Goopling literally pops OUT OF the boss — anchor the spawn at the
    // boss's live tile and search outward for the first walkable tile.
    // Boss world coords come from BossSystem (boss.tileX/tileY); falls
    // back to boss room centre if the boss hasn't been tile-stamped yet
    // (e.g. very early in a brand-new run before the first night tick).
    const grid = this._scene?.dungeonGrid
    const boss = this._gameState?.boss
    const anchorX = (Number.isFinite(boss?.tileX) ? boss.tileX
      : bossRoom.gridX + Math.floor(bossRoom.width / 2))
    const anchorY = (Number.isFinite(boss?.tileY) ? boss.tileY
      : bossRoom.gridY + Math.floor(bossRoom.height / 2))
    let sx = anchorX, sy = anchorY
    // 8-direction adjacent search from the boss's tile. Boss's own tile
    // is checked LAST — gooplings prefer to step out so the boss sprite
    // isn't obscured.
    const offsets = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [0, 0],
    ]
    for (const [ox, oy] of offsets) {
      const tx = anchorX + ox, ty = anchorY + oy
      const t = grid?.getTileType?.(tx, ty)
      if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) {
        const occupied = (this._gameState.minions ?? []).some(mm =>
          mm.aiState !== 'dead' && (mm.resources?.hp ?? 0) > 0 &&
          mm.tileX === tx && mm.tileY === ty)
        if (!occupied) { sx = tx; sy = ty; break }
      }
    }

    // The Goopling's "home" is the room the absorbed minion was assigned
    // to. The patrol AI uses assignedRoomId to pick wander targets and
    // pathfind; dropping the goopling in the boss room with assignedRoomId
    // pointing elsewhere makes it walk there on its own.
    const homeRoomId = deadMinion.assignedRoomId ?? null

    // Apply the boss's current scaling like any night-placed minion would
    // get. The 4th option is the standard 'garrison' class — matches how
    // Demon Hellgate imps are constructed. `bossLv` already captured for
    // tier-pool selection above; reuse it.
    const goopling = createMinion(def, { x: sx, y: sy }, homeRoomId, { class: 'garrison' })
    applyBossLevelToMinion(goopling, bossLv)
    goopling._isGoopling      = true
    goopling._gooplingHomeId  = homeRoomId
    goopling._gooplingOrigin  = deadMinion.id
    // Mirror Hellgate-imp style stamping for the patrol picker's home tile.
    const homeRoom = homeRoomId
      ? (this._gameState.dungeon.rooms ?? []).find(r => r.instanceId === homeRoomId)
      : null
    goopling.homeTileX = homeRoom
      ? homeRoom.gridX + Math.floor(homeRoom.width  / 2)
      : sx
    goopling.homeTileY = homeRoom
      ? homeRoom.gridY + Math.floor(homeRoom.height / 2)
      : sy

    this._gameState.minions.push(goopling)
    EventBus.emit('MINION_PLACED', { minion: goopling })

    // Splice the absorbed minion out of the roster entirely so it can't
    // respawn at dawn. (MinionAISystem.respawnAll's filters are all "this
    // dead minion stays dead but stays in the array" — for Absorb the
    // entity LITERALLY isn't there anymore.)
    const minions = this._gameState.minions
    const idx = minions.indexOf(deadMinion)
    if (idx >= 0) minions.splice(idx, 1)

    // +2 to the boss's max HP per absorption. Current HP also bumps so
    // the boss isn't sitting at a lower fraction post-absorb (purely a
    // small permanent buff, not a heal-and-cap interaction). `boss`
    // already captured above for tile-anchor calculation — reuse it.
    if (boss) {
      boss.maxHp = (boss.maxHp ?? 0) + 2
      boss.hp    = Math.min(boss.maxHp, (boss.hp ?? 0) + 2)
    }

    EventBus.emit('SLIME_ABSORBED', {
      victimId:    deadMinion.instanceId,
      gooplingId:  goopling.instanceId,
      gooplingDef: pickId,
      homeRoomId,
    })

    // ── VFX: absorb + excrete ────────────────────────────────────────
    // Three-part animation reads as "minion dissolves → boss squeezes →
    // goopling lands":
    //   1. At the death tile: green particle burst + ring + "ABSORBED".
    //   2. At the boss: one-shot "Slime excretion" overlay sprite —
    //      9-frame Craftpix animation that visually shows the boss
    //      birthing a goop blob. Played as a temporary sprite on top
    //      of the boss; destroyed on animation complete so it doesn't
    //      interfere with the boss's own state machine.
    //   3. After a beat: lighter-green burst + ring + "+ GOOPLING" at
    //      the Goopling's tile.
    const deathX = (deadMinion.worldX ?? deadMinion.tileX * 32 + 16)
    const deathY = (deadMinion.worldY ?? deadMinion.tileY * 32 + 16)
    const goopX  = goopling.worldX
    const goopY  = goopling.worldY
    const GREEN  = 0x55cc77
    const LIGHT_GREEN = 0x88ee99
    AbilityVfx.particleBurst(this._scene, deathX, deathY, {
      color: GREEN, count: 14, durationMs: 600, speed: 70, depth: 60,
    })
    AbilityVfx.pulseRing(this._scene, deathX, deathY, {
      color: GREEN, fromR: 4, toR: 38, alpha: 0.85, durationMs: 500, depth: 59,
    })
    AbilityVfx.floatingText(this._scene, deathX, deathY - 14, 'ABSORBED', {
      color: '#aaffbb', fontSize: '11px', durationMs: 900, driftY: -28, depth: 70,
    })
    // Boss spawn animation overlay — only fires if the texture loaded
    // (Preload registers `slime-spawn-sheet`). Centred on the boss's
    // live world position; runs once at the same scale as the boss
    // sprite, then destroys itself.
    this._playSlimeSpawnAnim()
    // Excretion burst comes ~250ms later so the eye can register the
    // distinct moments (death → spawn) instead of one flash.
    this._scene.time?.delayedCall?.(250, () => {
      if (!Number.isFinite(goopX) || !Number.isFinite(goopY)) return
      AbilityVfx.particleBurst(this._scene, goopX, goopY, {
        color: LIGHT_GREEN, count: 16, durationMs: 600, speed: 75, depth: 60,
      })
      AbilityVfx.pulseRing(this._scene, goopX, goopY, {
        color: LIGHT_GREEN, fromR: 4, toR: 30, alpha: 0.85, durationMs: 480, depth: 59,
      })
      AbilityVfx.floatingText(this._scene, goopX, goopY - 14, '+ GOOPLING', {
        color: '#bbffcc', fontSize: '11px', durationMs: 900, driftY: -28, depth: 70,
      })
    })
  }

  // Plays the slime-spawn overlay sprite on the boss. Lazy-creates the
  // animation on first call (avoids touching Phaser anim cache in
  // ctor before Preload has finished). Destroys itself on complete so
  // a rapid sequence of absorptions can stack overlays without leaking.
  _playSlimeSpawnAnim() {
    const scene = this._scene
    const boss  = this._gameState?.boss
    if (!scene || !boss) return
    if (!Number.isFinite(boss.worldX) || !Number.isFinite(boss.worldY)) return
    if (!scene.textures?.exists?.('slime-spawn-sheet')) return

    // Lazy anim registration. Frames 0..8 = first row of the 4-row sheet.
    // 18fps gives ~500ms total duration — long enough to read, short
    // enough that rapid absorptions don't overlap awkwardly.
    if (!scene.anims.exists('slime-spawn-anim')) {
      scene.anims.create({
        key: 'slime-spawn-anim',
        frames: scene.anims.generateFrameNumbers('slime-spawn-sheet', { start: 0, end: 8 }),
        frameRate: 18,
        repeat: 0,
      })
    }
    // Match the boss sprite scale so the overlay sits proportionally
    // over it. Boss sprite scale lives on the renderer; sample
    // conservatively (BossRenderer applies BOSS_SPRITE_SCALE = ~2.0 to
    // 128px sheets — same default here).
    const overlay = scene.add.sprite(boss.worldX, boss.worldY, 'slime-spawn-sheet', 0)
      .setOrigin(0.5, 0.55)        // slightly biased down so feet land near boss feet
      .setScale(2.0)
      .setDepth(65)                 // above particle burst (60), below floaters (70)
    if (overlay.texture?.setFilter) {
      overlay.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    overlay.play('slime-spawn-anim')
    overlay.once('animationcomplete', () => overlay.destroy())
    // Safety: if the anim somehow never completes (scene torn down, etc.)
    // GC the sprite after ~1.5s anyway.
    scene.time?.delayedCall?.(1500, () => {
      if (overlay.active) overlay.destroy()
    })
  }

  _shouldSkipSlimeAbsorb(m) {
    if (!m) return true
    if (m.faction !== 'dungeon') return true              // only player minions
    if (m._isGoopling)    return true                     // anti-feedback-loop
    if (m._isMiniSlime)   return true                     // Slime Split babies
    if (m._isMitosisAdd)  return true                     // boss-spawned adds — would feed boss its own splits
    if (m.isBossAdd)      return true                     // generic boss-fight adds
    if (m._isDemonImp)    return true
    if (m._myconidSprout) return true
    if (m._isHauntGhost)  return true
    if (m.isHallOfTrialsSpawn) return true
    if (m.isThroneMiniBoss)    return true
    if (m._mercenary)     return true
    if (m._sacrificed || m._burnt) return true            // deliberate destruction
    return false
  }

  // ── ORC: Warband (live cluster recompute) ──────────────────────────────

  // Manhattan room-membership lookup for every alive orc, tallied per
  // assigned-room id. Returns { [roomId]: count }.
  _orcCountsByRoom() {
    const counts = {}
    const grid = this._scene?.dungeonGrid
    for (const m of (this._gameState?.minions ?? [])) {
      if (!this._isOrcMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const room = grid?.getRoomAtTile?.(m.tileX, m.tileY)
      const id = room?.instanceId
      if (!id) continue
      counts[id] = (counts[id] ?? 0) + 1
    }
    return counts
  }

  _countOrcAlliesInRoom(self, roomId) {
    if (!roomId) return 0
    const grid = this._scene?.dungeonGrid
    let n = 0
    for (const m of (this._gameState?.minions ?? [])) {
      if (m === self) continue
      if (!this._isOrcMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const r = grid?.getRoomAtTile?.(m.tileX, m.tileY)
      if (r?.instanceId === roomId) n++
    }
    return n
  }

  // Per-frame: recompute every orc's stats.attack + stats.defense from
  //   stats.attack  = round((_orcBaseAttack + lootAtkBonus) × (1 + 5%·allies))
  //   stats.defense = round( _orcBaseDefense                × (1 + 5%·allies))
  // Cheap — there are only a handful of orcs in a dungeon and the room
  // lookup is a single tile-grid hit per orc.
  _tickOrc() {
    if (this._archId() !== 'orc') return
    const grid = this._scene?.dungeonGrid
    const minions = this._gameState?.minions ?? []
    if (minions.length === 0) return
    const counts = this._orcCountsByRoom()
    for (const m of minions) {
      if (!this._isOrcMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      // Capture baseline if missing (e.g. a minion that pre-existed before
      // the system tagged it — defensive).
      if (m._orcBaseAttack == null || m._orcBaseDefense == null) {
        this._captureOrcBaseline(m)
      }
      const room = grid?.getRoomAtTile?.(m.tileX, m.tileY)
      const roomCount = room ? (counts[room.instanceId] ?? 0) : 0
      const allies = Math.max(0, roomCount - 1)   // count is *including* self
      const atkMult = 1 + allies * Balance.ORC_WARBAND_ATK_PCT_PER_ALLY
      const defMult = 1 + allies * Balance.ORC_WARBAND_DEF_PCT_PER_ALLY
      const base    = m._orcBaseAttack  ?? 0
      const baseDef = m._orcBaseDefense ?? 0
      const loot    = m.lootAtkBonus    ?? 0
      m.stats         ??= {}
      m.stats.attack   = Math.max(1, Math.round((base + loot) * atkMult))
      m.stats.defense  = Math.max(0, Math.round(baseDef * defMult))
    }
  }

  // ── GOLEM: Living Architecture ──────────────────────────────────────────
  // Tracks (rooms-counted-so-far, hp-applied, def-applied) on
  // `gameState.boss._golem` so saves rehydrate consistently and dynamic
  // place/remove stays balanced.

  _initLivingArchitecture() {
    if (this._archId() !== 'golem') return
    const boss = this._gameState?.boss
    if (!boss) return
    boss._golem ??= { roomsCounted: 0, hpApplied: 0, defApplied: 0, firstUseToastShown: false, earthquakeUsesLeft: Balance.GOLEM_EARTHQUAKE_USES_PER_DAY }

    const currentRoomCount = this._gameState?.dungeon?.rooms?.length ?? 0
    const delta = currentRoomCount - (boss._golem.roomsCounted ?? 0)
    if (delta > 0) this._applyLivingArchDelta(delta)
  }

  _applyLivingArchDelta(delta) {
    const boss = this._gameState?.boss
    if (!boss) return
    boss._golem ??= { roomsCounted: 0, hpApplied: 0, defApplied: 0, earthquakeUsesLeft: Balance.GOLEM_EARTHQUAKE_USES_PER_DAY }
    const dHp  = delta * Balance.GOLEM_HP_PER_ROOM
    const dDef = delta * Balance.GOLEM_DEF_PER_ROOM
    boss.maxHp   = Math.max(0, (boss.maxHp ?? 0) + dHp)
    boss.hp      = Math.max(0, Math.min(boss.maxHp, (boss.hp ?? 0) + dHp))
    boss.defense = Math.max(0, (boss.defense ?? 0) + dDef)
    boss._golem.roomsCounted = (boss._golem.roomsCounted ?? 0) + delta
    boss._golem.hpApplied    = (boss._golem.hpApplied    ?? 0) + dHp
    boss._golem.defApplied   = (boss._golem.defApplied   ?? 0) + dDef
    EventBus.emit('GOLEM_LIVING_ARCH_TICK', {
      roomsCounted: boss._golem.roomsCounted,
      hpApplied:    boss._golem.hpApplied,
      defApplied:   boss._golem.defApplied,
    })
  }

  _onRoomPlaced() {
    if (this._archId() !== 'golem') return
    this._applyLivingArchDelta(+1)
  }

  _onRoomRemoved() {
    if (this._archId() !== 'golem') return
    this._applyLivingArchDelta(-1)
  }

  // ── GOLEM: Earthquake ───────────────────────────────────────────────────
  // Resets daily uses at the start of each night (i.e. before the next day).

  _onNightStart() {
    if (this._archId() === 'golem') {
      const boss = this._gameState?.boss
      if (boss?._golem) {
        boss._golem.earthquakeUsesLeft = Balance.GOLEM_EARTHQUAKE_USES_PER_DAY
      }
    }
    // Disarm via the proper API so the UI hears GOLEM_EARTHQUAKE_DISARMED
    // and resets its button label / room-pick listener. Without this, a
    // player who armed earthquake but didn't fire it ends up with the
    // button stuck on "PICK A ROOM" the next day.
    this._disarmEarthquake()
    // Beholder: clear yesterday's anti-magic markings the moment night begins
    // (the new selection happens on DAY_PHASE_BEGAN).
    this._clearAntiMagicMarks()
    // Lizardman: re-camouflage all surviving lizardman minions for the new
    // day so each new wave gets the free first ambush hit.
    if (this._archId() === 'lizardman') {
      for (const m of this._gameState?.minions ?? []) {
        if (this._isLizardmanMinion(m)) m._camouflaged = true
      }
    }
    // Myconid: clear yesterday's spore network overlay + active rooms.
    if (this._gameState?._myconid) {
      this._gameState._myconid.activeSporeRoomIds = []
    }
    this._clearSporeFx()
    // Demon: reset daily Sacrifice uses; top the Hellgate roster up to
    // N=bossLevel imps. Killed or sacrificed imps from prior days do NOT
    // revive (enforced by the dead-imp filter in MinionAISystem.respawnAll);
    // each dawn fills the open slots with brand-new imp instances. Surviving
    // imps from yesterday are kept — we just spawn enough fresh ones to
    // reach the N-slot ceiling, so total count never grows past N.
    if (this._archId() === 'demon') {
      this._gameState._demon ??= { sacrificeUsesLeft: 0 }
      // +0.333 uses per boss-lv (lv10 = +3 → 4 uses/day).
      const _demonBossLv = this._gameState?.boss?.level ?? 1
      this._gameState._demon.sacrificeUsesLeft = Balance.DEMON_SACRIFICE_USES_PER_DAY
        + Math.floor(_demonBossLv * Balance.DEMON_SACRIFICE_USES_PER_BOSS_LV)
      // Disarm via the proper API so the UI hears DEMON_SACRIFICE_DISARMED
      // and snaps the button back to SACRIFICE — silent state mutation here
      // was the source of the "stuck on PICK A MINION" bug.
      this._disarmSacrifice()
      const bossLv = this._gameState?.boss?.level ?? 1
      const N = Math.max(1, bossLv)
      const aliveImps = (this._gameState?.minions ?? [])
        .filter(m => m._isDemonImp && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0)
        .length
      const need = Math.max(0, N - aliveImps)
      if (need > 0) this._spawnHellgateImps(need)
    }
    // Gnoll: refresh Hunters Pack to its boss-level cap and reset Bloodlust.
    if (this._archId() === 'gnoll') {
      this._resetBloodlust()
      this._refillHuntersPack()
      this._captureBloodlustBaselines()
    }
  }

  _isLizardmanMinion(m) {
    return !!(m && Array.isArray(m.tags) && m.tags.includes(MINION_TAG_LIZARDMAN))
  }

  _earthquakeUsesLeft() {
    return this._gameState?.boss?._golem?.earthquakeUsesLeft ?? 0
  }

  _earthquakeAvailable() {
    if (this._archId() !== 'golem') return false
    if (this._gameState?.meta?.phase !== 'day')  return false
    return this._earthquakeUsesLeft() > 0
  }

  _armEarthquake() {
    if (!this._earthquakeAvailable()) return
    this._earthquakeArmed = true
    EventBus.emit('GOLEM_EARTHQUAKE_ARMED', {})
  }

  // Always emits GOLEM_EARTHQUAKE_DISARMED, even if our internal flag is
  // already false. Necessary because phase-change resets clear the system
  // flag silently — without an emit the BossArchetypeUI would stay armed
  // in its own state and the button would get stuck on "PICK A ROOM"
  // forever (clicking it would emit DISARM but the early-return here
  // would suppress the DISARMED event, leaving the UI mid-flight).
  _disarmEarthquake() {
    this._earthquakeArmed = false
    EventBus.emit('GOLEM_EARTHQUAKE_DISARMED', {})
  }

  // payload: { roomId } — fired by the UI after the player clicks a room
  // while the earthquake is armed.
  _fireEarthquake(payload) {
    if (!this._earthquakeArmed) return
    if (!this._earthquakeAvailable()) { this._disarmEarthquake(); return }
    const room = this._gameState?.dungeon?.rooms?.find(r => r.instanceId === payload?.roomId)
    if (!room) return

    const totalRooms = this._gameState?.dungeon?.rooms?.length ?? 0
    const dmg        = totalRooms * Balance.GOLEM_EARTHQUAKE_DMG_PER_ROOM

    // Apply damage to every adventurer currently inside the room.
    const advs = this._gameState?.adventurers?.active ?? []
    const hits = []
    for (const adv of advs) {
      if (!adv || (adv.resources?.hp ?? 0) <= 0) continue
      if (!_advInsideRoom(adv, room)) continue
      const before = adv.resources.hp
      adv.resources.hp = Math.max(0, before - dmg)
      hits.push({ advId: adv.instanceId, dmg })
      EventBus.emit('COMBAT_HIT', {
        sourceId:   'boss',
        targetId:   adv.instanceId,
        damage:     dmg,
        damageType: 'earthquake',
      })
      if (adv.resources.hp <= 0) {
        EventBus.emit('ADVENTURER_DIED', {
          adventurer: adv,
          killerId:   'boss',
          killerName: 'Earthquake',
          roomId:     room.instanceId,
          damageType: 'earthquake',
        })
      }
    }

    // Burn the use, disarm, and emit a fired event so the UI can play VFX.
    const boss = this._gameState?.boss
    if (boss?._golem) {
      boss._golem.earthquakeUsesLeft = Math.max(0, (boss._golem.earthquakeUsesLeft ?? 0) - 1)
    }
    this._earthquakeArmed = false
    EventBus.emit('GOLEM_EARTHQUAKE_FIRED', {
      roomId: room.instanceId,
      room,
      damage: dmg,
      hits,
    })
  }

  // ── BEHOLDER: Petrify Gaze ──────────────────────────────────────────────

  _onBossFightStarted() {
    // Track the active fight so per-archetype ticks (e.g. succubus charm)
    // can suspend during it. Boss fight runs in an overlay scene; spawning
    // dungeon-scene VFX mid-fight tangles the renderer pipeline and was
    // dropping every sprite to invisible until the next reload.
    this._bossFightActive = true
    // Abort any in-progress succubus flight so the boss isn't left hidden
    // (BossRenderer hides her during 'going'/'return' phases).
    if (this._archId() === 'succubus' && this._gameState?._succubus?.flight) {
      this._gameState._succubus.flight = null
      EventBus.emit('SUCCUBUS_FLIGHT_ENDED', {})
    }

    if (this._archId() !== 'beholder') return
    this._stopPetrifyTimer()
    // Schedule the gaze every BEHOLDER_PETRIFY_INTERVAL_MS while the fight runs.
    this._petrifyTimer = this._scene?.time?.addEvent?.({
      delay:    Balance.BEHOLDER_PETRIFY_INTERVAL_MS,
      loop:     true,
      callback: () => this._firePetrifyGaze(),
    })
  }

  _onBossFightResolved() {
    this._bossFightActive = false
    if (this._archId() !== 'beholder') return
    this._stopPetrifyTimer()
    // Clear any lingering petrify timestamps so an adv that survived doesn't
    // stay frozen after the fight ends (defensive — most fight-resolved paths
    // already drop the fight state, but corpses still keep the field).
    for (const a of this._gameState?.adventurers?.active ?? []) {
      if (a._petrifiedUntil) a._petrifiedUntil = 0
    }
  }

  _stopPetrifyTimer() {
    this._petrifyTimer?.remove?.(false)
    this._petrifyTimer = null
  }

  _firePetrifyGaze() {
    const boss = this._gameState?.boss
    if (!boss) return
    const now = this._scene?.time?.now ?? 0
    const advs = this._gameState?.adventurers?.active ?? []
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return

    // Boss-level scaling: longer freeze + more distinct targets per fire.
    // duration += 300ms per boss-lv beyond 1; targets = 1 + floor((lv-1)/3)
    // (lv4=2, lv7=3, lv10=4). Pick distinct advs; if fewer advs available,
    // freeze what's there.
    const bossLv = this._gameState?.boss?.level ?? 1
    const durationMs = Balance.BEHOLDER_PETRIFY_DURATION_MS
      + Math.max(0, bossLv - 1) * Balance.BEHOLDER_PETRIFY_DURATION_PER_BOSS_LV_MS
    const maxTargets = Balance.BEHOLDER_PETRIFY_TARGETS_BASE
      + Math.floor(Math.max(0, bossLv - 1) / Balance.BEHOLDER_PETRIFY_LEVELS_PER_TARGET)

    // Eligible advs: alive and currently inside the boss chamber (the active fighters).
    const eligible = []
    for (const a of advs) {
      if (!a || a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      if (!_advInsideRoom(a, bossRoom)) continue
      eligible.push(a)
    }
    if (eligible.length === 0) return

    // Fisher-Yates partial shuffle to pick `maxTargets` distinct advs uniformly.
    const pool = eligible.slice()
    const pickN = Math.min(maxTargets, pool.length)
    for (let i = 0; i < pickN; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i))
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp
    }
    const targets = pool.slice(0, pickN)
    for (const a of targets) {
      a._petrifiedUntil = now + durationMs
      // Status-text float (DungeonFx renders 'PETRIFIED' above the adv).
      EventBus.emit('STATUS_APPLIED', { targetId: a.instanceId, label: 'PETRIFIED' })
    }

    EventBus.emit('BEHOLDER_PETRIFY_FIRED', {
      targetIds:  targets.map(t => t.instanceId),
      durationMs,
    })
    this._renderPetrifyVfx(boss, targets, durationMs)
  }

  // Eye-beams from the boss to each target + a stone-crackle ring at the
  // target. Lives on a dedicated graphics layer that's redrawn each fire.
  _renderPetrifyVfx(boss, targets, durationMs) {
    const s = this._scene
    if (!s?.add?.graphics) return
    if (!this._petrifyFxGraphics) {
      this._petrifyFxGraphics = s.add.graphics().setDepth(8)
    }
    const g = this._petrifyFxGraphics
    g.clear()
    // Each beam: bright purple core + soft outer halo.
    for (const t of targets) {
      g.lineStyle(4, 0x88ddff, 0.95)
      g.lineBetween(boss.worldX ?? 0, boss.worldY ?? 0, t.worldX, t.worldY)
      g.lineStyle(1, 0xffffff, 0.7)
      g.lineBetween(boss.worldX ?? 0, boss.worldY ?? 0, t.worldX, t.worldY)
      // Stone-crackle ring on each target.
      g.lineStyle(2, 0xc4a484, 0.85)
      g.strokeCircle(t.worldX, t.worldY, 14)
      g.lineStyle(1, 0x6a4a30, 0.7)
      g.strokeCircle(t.worldX, t.worldY, 18)
    }
    // Fade the whole layer over the freeze window. Kill any prior fade so
    // back-to-back fires don't end up with stacked tweens.
    s.tweens?.killTweensOf?.(g)
    g.alpha = 1
    s.tweens.add({
      targets: g,
      alpha:   0,
      duration: durationMs,
      ease:    'Cubic.easeOut',
      onComplete: () => g.clear(),
    })
  }

  // ── BEHOLDER: Anti-Magic Aura ───────────────────────────────────────────

  _onDayBegan() {
    if (this._archId() === 'beholder') {
      this._clearAntiMagicMarks()
      this._rollAntiMagicRooms()
      this._renderAntiMagicAura()
    }
    // Lich: cull expired raised skeletons, then raise yesterday's kills.
    if (this._archId() === 'lich') {
      this._cullExpiredRaised()
      this._raiseQueuedDead()
    }
    // Myconid: tick fungal corpse lifespans (sprout if expired) + roll spore
    // network if today is a multiple of MYCONID_SPORE_INTERVAL_DAYS.
    if (this._archId() === 'myconid') {
      this._tickFungalCorpseDay()
      this._rollSporeNetwork()
      this._renderSporeOverlay()
    }
    // Succubus: refresh daily charm uses. One use per boss level (L1=1,
    // L2=2, L3=3, ... L10=10). Stamp a random delay before the FIRST
    // charm attempt so it doesn't fire the instant adventurers arrive —
    // feels more organic when she lurks briefly.
    if (this._archId() === 'succubus') {
      const lv  = this._gameState?.boss?.level ?? 1
      const now = this._scene?.time?.now ?? 0
      this._gameState._succubus ??= {}
      this._gameState._succubus.usesLeft = Math.max(1, lv)
      // First use: a longer lurk (≈10–18s) before the day's first charm.
      this._gameState._succubus.cooldownUntil = now + 10000 + Math.floor(Math.random() * 8000)
      this._gameState._succubus.flight = null
    }
  }

  _clearAntiMagicMarks() {
    const rooms = this._gameState?.dungeon?.rooms ?? []
    for (const r of rooms) {
      if (r._antiMagic) r._antiMagic = false
    }
    this._gameState._antiMagicRoomIds = []
    this._antiMagicFx?.clear?.()
  }

  _rollAntiMagicRooms() {
    const rooms = this._gameState?.dungeon?.rooms ?? []
    // Eligible: any non-boss room.
    const pool = rooms.filter(r => r.definitionId !== 'boss_chamber')
    if (pool.length === 0) return
    const bossLv = this._gameState?.boss?.level ?? 1
    const count = Math.min(
      pool.length,
      Balance.BEHOLDER_ANTIMAGIC_BASE_ROOMS
        + Math.max(0, bossLv - 1) * Balance.BEHOLDER_ANTIMAGIC_PER_BOSS_LV,
    )
    // Fisher-Yates partial shuffle for a uniform random pick of `count`.
    const picks = pool.slice()
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(Math.random() * (picks.length - i))
      const tmp = picks[i]; picks[i] = picks[j]; picks[j] = tmp
    }
    const chosen = picks.slice(0, count)
    for (const r of chosen) r._antiMagic = true
    this._gameState._antiMagicRoomIds = chosen.map(r => r.instanceId)
    EventBus.emit('BEHOLDER_ANTIMAGIC_ROOMS_SET', {
      roomIds: this._gameState._antiMagicRoomIds,
    })
  }

  _renderAntiMagicAura() {
    if (this._archId() !== 'beholder') return
    const s  = this._scene
    if (!s?.add?.graphics) return
    if (!this._antiMagicFx) {
      this._antiMagicFx = s.add.graphics().setDepth(2.6)
    }
    const g = this._antiMagicFx
    g.clear()
    const TS = Balance.TILE_SIZE
    const rooms = this._gameState?.dungeon?.rooms ?? []
    for (const r of rooms) {
      if (!r._antiMagic) continue
      const x = r.gridX * TS
      const y = r.gridY * TS
      const w = r.width  * TS
      const h = r.height * TS
      g.fillStyle(0x9b32d4, 0.10)
      g.fillRect(x, y, w, h)
      g.lineStyle(3, 0xc64bff, 0.55)
      g.strokeRect(x + 1, y + 1, w - 2, h - 2)
      g.lineStyle(1, 0xffe6ff, 0.45)
      g.strokeRect(x + 4, y + 4, w - 8, h - 8)
    }
  }

  // ── LICH: Phylactery ────────────────────────────────────────────────────
  // 1) Show a unlock toast the first time the player hits boss level 3 with
  //    the lich archetype. Persisted on gameState so it doesn't re-fire.
  // 2) On adv spawn, roll 15% per adv (or 100% when the boss has 0 normal
  //    lives) to set _huntPhylactery + initial HUNT_PHYLACTERY goal.
  // 3) Per-frame damage tick — handled in `tick(delta)` from Game.update.

  _onBossLeveledUp(payload) {
    if (this._archId() === 'lich') {
      this._maybeShowPhylacteryUnlockToast()
    }
    if (this._archId() === 'orc') {
      // applyBossLevelToMinion on BOSS_LEVELED_UP rescales every minion's
      // stats.attack — re-capture orc baselines so the post-scale value
      // becomes the new pristine number for Warband math.
      for (const m of (this._gameState?.minions ?? [])) {
        if (!this._isOrcMinion(m)) continue
        if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        // Subtract any active buff before re-baselining. stats.attack at this
        // point is `(oldBase + loot) × oldWarband × scaleRatio`, but Game.js
        // applies `newAtkM/oldAtkM` multiplicatively to the LIVE value, so a
        // clean baseline = current_after_scale ÷ warband_mult − loot.
        const room = this._scene?.dungeonGrid?.getRoomAtTile?.(m.tileX, m.tileY)
        const allies = this._countOrcAlliesInRoom(m, room?.instanceId ?? null)
        const warbandMult = 1 + allies * Balance.ORC_WARBAND_ATK_PCT_PER_ALLY
        const loot = m.lootAtkBonus ?? 0
        const inferredBase = Math.max(1,
          Math.round(((m.stats?.attack ?? 0) / Math.max(0.0001, warbandMult)) - loot))
        m._orcBaseAttack  = inferredBase
        m._orcBaseDefense = m.stats?.defense ?? 0
      }
    }
    if (this._archId() === 'gnoll') {
      // Top up the Hunters Pack to the new cap on level-up. Capture
      // baselines for the new pack members ONLY (don't wipe the active
      // bloodlust stack), then re-apply the current stacks to everyone so
      // the new arrivals immediately match the existing pack's ATK.
      this._refillHuntersPack()
      const stacks = this._gameState?._gnoll?.bloodlustStacks ?? 0
      for (const m of (this._gameState?.minions ?? [])) {
        if (!this._isGnollMinion(m)) continue
        if (m._baselineAttack == null) m._baselineAttack = m.stats?.attack ?? 1
      }
      if (stacks > 0) {
        const mult = 1 + Balance.GNOLL_BLOODLUST_PCT_PER_KILL * stacks
        for (const m of (this._gameState?.minions ?? [])) {
          if (!this._isGnollMinion(m)) continue
          if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
          const base = m._baselineAttack ?? (m.stats?.attack ?? 1)
          m.stats ??= {}
          m.stats.attack = Math.max(1, Math.round(base * mult))
        }
      }
    }
  }

  _maybeShowPhylacteryUnlockToast() {
    if (this._archId() !== 'lich') return
    const boss  = this._gameState?.boss
    if (!boss) return
    if ((boss.level ?? 1) < Balance.LICH_PHYLACTERY_UNLOCK_LEVEL) return
    boss._lich ??= {}
    if (boss._lich.unlockToastShown) return
    boss._lich.unlockToastShown = true
    EventBus.emit('PHYLACTERY_UNLOCKED', {})
  }

  _onAdvsSpawned(payload) {
    const advs = payload?.adventurers ?? []
    if (advs.length === 0) return

    // LICH: Phylactery hunt rolls.
    //
    // Knowledge gate (2026-05-27): hunts require the adv to actually
    // KNOW about the heart — via personal observation last run or via
    // inherited shared-pool intel. An adv with no knowledge of the heart
    // will never auto-target it from spawn (matches every other beelining
    // goal in the system: SEEK_TREASURE, SEEK_HEAL, SEEK_KEY_CHEST are
    // all knowledge-gated the same way). Room-find rolls in
    // `_lichOnAdvRoomChanged` are NOT gated because the adv is standing
    // in the heart's room — observation is automatic at that point.
    //
    // Heart-life gate (2026-05-27): when the boss is currently kept alive
    // by the heart (`boss._onHeartLife`), every adv WHO KNOWS about the
    // heart auto-hunts. Without knowledge they fall through to normal
    // wave behaviour — they'll head to the throne, get bounced by the
    // _diedThisDay handoff, and flee. The previous `noNormalLivesLeft`
    // gate never fired in practice because the revive at fight-resolution
    // bumps deathsRemaining back to 1 immediately.
    if (this._archId() === 'lich') {
      const phyl = this._gameState?.phylactery
      const boss = this._gameState?.boss
      const onHeartLife = !!boss?._onHeartLife
      // Heart-life gate (2026-05-27, design refresh): the heart is
      // invisible-as-target until it has saved the boss once. Before
      // the first revive, NO adventurer auto-hunts the heart at spawn
      // — the player is free to hide the heart and have it sit
      // unmolested while the normal-life economy plays out. The moment
      // the heart revives the boss (`boss._onHeartLife` flips true in
      // BossSystem._resolveFight), every knowledgeable adv in every
      // subsequent wave commits to the heart instead of the throne.
      // Replaces the prior 15%-baseline spawn-roll
      // (LICH_PHYLACTERY_HUNT_CHANCE) which leaked pre-revive hunters
      // and conflicted with the "only after revive" intent.
      //
      // Same-day rest gate: also pause on `_diedThisDay`. The day the
      // boss falls (revive or not), no new hunters spawn — the heart
      // gets a guaranteed safe day before the dungeon resumes hunting.
      if (onHeartLife && !boss?._diedThisDay && phyl && (phyl.resources?.hp ?? 0) > 0) {
        for (const adv of advs) {
          if (!adv) continue
          // Knowledge gate — adv must have heart in their personal
          // knowledge bucket (KnowledgeSystem copies from shared pool on
          // spawn so inherited intel counts).
          const knowsHeart = !!adv.knowledge?.items?.[phyl.instanceId]
          if (!knowsHeart) continue
          adv._huntPhylactery = true
          adv.goal = { type: 'HUNT_PHYLACTERY', roomId: phyl.roomId }
          adv.path = null
        }
      }
    }

    // VAMPIRE: charm N random advs per spawning batch (one per day baseline,
    // +0.25 per boss-lv → 1 extra every 4 lv; lv10 = 1 + floor(10*0.25) = 3).
    if (this._archId() === 'vampire') {
      const bossLv = this._gameState?.boss?.level ?? 1
      const charmCount = Balance.VAMPIRE_CHARM_USES_PER_DAY_BASE
        + Math.floor(bossLv * Balance.VAMPIRE_CHARM_USES_PER_BOSS_LV)
      const eligible = advs.filter(a => a && (a.resources?.hp ?? 0) > 0)
      if (eligible.length > 0) {
        const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
        if (bossRoom) {
          // Fisher-Yates partial shuffle to pick distinct advs uniformly.
          const pool = eligible.slice()
          const pickN = Math.min(charmCount, pool.length)
          for (let i = 0; i < pickN; i++) {
            const j = i + Math.floor(Math.random() * (pool.length - i))
            const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp
          }
          for (let i = 0; i < pickN; i++) {
            const pick = pool[i]
            pick._charmed = true
            EventBus.emit('STATUS_APPLIED', { targetId: pick.instanceId, label: 'CHARMED' })
            // Detach from party for the walk so allies don't drag them back via
            // FOLLOW_LEADER goals later.
            pick._charmedFormerPartyId = pick.partyId ?? null
            pick.partyId = null
            pick.goal = { type: 'CHARM_WALK', roomId: bossRoom.instanceId }
            pick.path = null
            EventBus.emit('VAMPIRE_CHARM_MARKED', { advId: pick.instanceId })
          }
        }
      }
    }
  }

  // Called from Game.update once per frame. Dispatches per-archetype tick
  // logic (Lich phylactery damage, Lizardman venom DoT, Myconid spores +
  // corpse contact, etc). Per-archetype gates are inside each helper.
  tick(delta) {
    // Venom stack DoT — runs whenever ANY adv has stacks (Lizardman applies
    // them on hit, Myconid applies them on corpse contact, etc).
    this._tickVenom()
    // Myconid spore-cloud damage + corpse-touch venom-stack application.
    this._tickMyconid(delta)
    // Wraith fear-threshold reactions + haunt-ghost wall-phasing.
    this._tickWraith()
    // Demon imp roaming (rotates assignedRoomId every ~6 s).
    this._tickDemonImps(this._scene?.time?.now ?? 0)
    // Vampire charm-conversion + thrall roaming.
    this._tickVampire(this._scene?.time?.now ?? 0)
    // Succubus shapeshifter+seductress: trigger + bat flight + charm.
    this._tickSuccubus(delta, this._scene?.time?.now ?? 0)
    // Orc Loot+Warband live recompute.
    this._tickOrc()
    if (this._archId() !== 'lich') return
    const phyl = this._gameState?.phylactery
    if (!phyl) return
    if ((phyl.resources?.hp ?? 0) <= 0) {
      // First-time-zero — emit the destroyed event, route survivors into FLEE.
      if (!phyl._destroyedEmitted) {
        phyl._destroyedEmitted = true
        EventBus.emit('PHYLACTERY_DESTROYED', { phylactery: phyl })
        // Drop the entity from gameState now that VFX/UI has had its event.
        this._gameState.phylactery = null
        // One heart per run (2026-05-27): destruction is permanent. The
        // player can't place a new phylactery for the rest of this run.
        // Latches on the player state so it survives save/load and the
        // night build phase. ONLY destruction (this path) sets the flag —
        // selling or moving the heart emits PHYLACTERY_REMOVED instead
        // and leaves the flag clear, so the player can freely reposition
        // a still-alive heart without losing the option to re-place it.
        this._gameState.player ??= {}
        this._gameState.player._phylacteryDestroyedThisRun = true
        // Heart destruction = end-of-day (2026-05-27). Mirror the "boss
        // killed" path: every active adv flees as if the boss had just
        // fallen, and `_diedThisDay` latches on the boss so any later-
        // arriving wave is bounced by `_onIncoming`'s existing handoff.
        // The boss itself is still alive (revive bumped deathsRemaining
        // to 1 earlier); they just can't be fought again until tomorrow.
        //
        // AT_BOSS advs are skipped — they're inside an active fight
        // BossSystem owns; the fight runs to its natural resolution and
        // BossSystem dispatches its own flee on survivors. Already-
        // fleeing advs are also skipped so we don't reset their reason.
        const boss = this._gameState?.boss
        if (boss) boss._diedThisDay = true
        for (const a of this._gameState?.adventurers?.active ?? []) {
          if (!a) continue
          if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
          if (a.goal?.type === 'AT_BOSS') continue
          a._huntPhylactery = false
          if (a.goal?.type !== 'FLEE') {
            a.goal = { type: 'FLEE', reason: 'phylactery_destroyed' }
            a.aiState = 'fleeing'
            a.path = null
          }
        }
      }
      return
    }
    const boss = this._gameState?.boss
    // Same-day rest period (2026-05-27): once the boss has fallen this
    // day (whether or not the fall triggered a heart-revive), no more
    // damage lands on the heart for the rest of the day. The flag is
    // `_diedThisDay`, set in BossSystem._resolveFight and cleared in
    // _onNightStartedAI overnight. Combined with the gates on
    // _onAdvsSpawned / _lichOnAdvRoomChanged / SEEK_BOSS-redirect,
    // this makes the day OF a death/revive a guaranteed "wounds are
    // licked" pause — the dungeon-wide heart hunt resumes next day.
    // We bail BEFORE _lastTickAt advances so subsequent fresh days
    // resume on a clean 800ms cadence rather than firing a backlog.
    if (boss?._diedThisDay) {
      // One-shot cleanup of in-flight hunters when _diedThisDay flips.
      // Runs every tick during the rest period but no-ops after the
      // first pass when no HUNT_PHYLACTERY advs remain. Sends them home
      // with the same `boss_defeated` reason any post-fight flee uses
      // — to them, the boss is "gone" and there's nothing more to do.
      for (const a of this._gameState?.adventurers?.active ?? []) {
        if (a?.goal?.type !== 'HUNT_PHYLACTERY') continue
        if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
        a._huntPhylactery = false
        a.goal = { type: 'FLEE', reason: 'boss_defeated' }
        a.aiState = 'fleeing'
        a.path = null
      }
      return
    }
    const now = this._scene?.time?.now ?? 0
    phyl._lastTickAt ??= 0
    if (now - phyl._lastTickAt < Balance.LICH_PHYLACTERY_DMG_INTERVAL_MS) return
    phyl._lastTickAt = now

    const advs = this._gameState?.adventurers?.active ?? []
    let totalDmg = 0
    let totalBossBleed = 0
    let attackerName = null
    for (const a of advs) {
      if (!a || a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      if (a.goal?.type !== 'HUNT_PHYLACTERY') continue
      if (Math.abs(a.tileX - phyl.tileX) + Math.abs(a.tileY - phyl.tileY) > 1) continue
      const dmg = Math.max(1, a.stats?.attack ?? 1)
      phyl.resources.hp = Math.max(0, (phyl.resources.hp ?? 0) - dmg)
      totalDmg += dmg
      attackerName = attackerName ?? a.name
      EventBus.emit('COMBAT_HIT', {
        sourceId:   a.instanceId,
        targetId:   phyl.instanceId,
        damage:     dmg,
        damageType: 'phylactery_attack',
      })
      // Heart→boss damage mirror (2026-05-27, balance nerf). The heart
      // is bound to the boss's life force, so every blow that lands on
      // the heart bleeds the boss for the same amount. 1:1 magnitude.
      //
      // Notes on the wipe-windows: between fights with boss.hp==0,
      // `_onIncoming` refills hp to maxHp on the next BOSS_FIGHT_INCOMING,
      // so chip damage in death-pose is wasted. Damage during an active
      // fight, between fights with hp>0 (boss survived last fight), and
      // pre-first-fight chip damage all carry into the next fight.
      //
      // No COMBAT_HIT emit for this — that event triggers VFX (damage
      // numbers floating above the target) and aggro/retaliation, both
      // of which would misfire on the boss sitting in its chamber out-
      // of-fight. The dedicated BOSS_HEART_BLEED event below lets any
      // future HP-bar or VFX layer subscribe deliberately.
      if (boss) {
        boss.hp = Math.max(0, (boss.hp ?? 0) - dmg)
        totalBossBleed += dmg
      }
      if (phyl.resources.hp <= 0) break
    }
    if (totalDmg > 0) {
      EventBus.emit('PHYLACTERY_DAMAGED', {
        phylactery:  phyl,
        damage:      totalDmg,
        attackerName,
        hp:          phyl.resources.hp,
      })
    }
    if (totalBossBleed > 0 && boss) {
      EventBus.emit('BOSS_HEART_BLEED', {
        damage:       totalBossBleed,
        attackerName,
        hp:           boss.hp,
        maxHp:        boss.maxHp,
      })
    }
    // Lich Necromancy: per-tick ability ticks for raised dead.
    this._tickRaisedClerics()
    this._tickRaisedBards()
  }

  // ── LICH: Necromancy ────────────────────────────────────────────────────
  // Adv kills queue onto gameState._lich.pendingRaises in _onAdvDied. At the
  // next dawn (DAY_PHASE_BEGAN) we cull expired skeletons and raise the
  // queue. Skeletons live for one full day, then despawn at the following
  // dawn.

  _cullExpiredRaised() {
    if (!Array.isArray(this._gameState?.minions)) return
    const today = this._gameState.meta?.dayNumber ?? 1
    const before = this._gameState.minions.length
    this._gameState.minions = this._gameState.minions.filter(m => {
      if (!m._raisedFromAdvDeath) return true
      // Spawned at dawn N, expires at end of dawn N+LIFESPAN — we cull the
      // morning of dawn N+LIFESPAN+1. With LIFESPAN=1, that's dawn N+2.
      return today < (m._expireAtDay ?? 0)
    })
    const removed = before - this._gameState.minions.length
    if (removed > 0) {
      EventBus.emit('NECROMANCY_RAISED_EXPIRED', { count: removed })
    }
  }

  _raiseQueuedDead() {
    const queue = this._gameState?._lich?.pendingRaises
    if (!Array.isArray(queue) || queue.length === 0) return
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const skeletonDef = minionTypes.find(m => m.id === 'skeleton1')
    if (!skeletonDef) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) { queue.length = 0; return }

    const today    = this._gameState.meta?.dayNumber ?? 1
    const bossLv   = this._gameState.boss?.level ?? 1
    // Spawn at dawn N, expire at dawn (N + LIFESPAN). With LIFESPAN=1 the
    // skeleton lives exactly through one day and is culled at the very next
    // dawn (cull rule: today < _expireAtDay).
    const expireOn = today + Balance.NECROMANCY_LIFESPAN_DAYS

    const TS = Balance.TILE_SIZE
    const cx = bossRoom.gridX + Math.floor(bossRoom.width  / 2)
    const cy = bossRoom.gridY + Math.floor(bossRoom.height / 2)

    // Cap the Lich's standing undead army. Count skeletons still alive
    // from earlier days, then raise only enough to reach the cap — a big
    // kill day can't flood the dungeon. Excess queued dead are dropped
    // (the queue is drained below regardless).
    const aliveRaised = (this._gameState.minions ?? []).filter(
      m => m._raisedFromAdvDeath && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0,
    ).length
    // +0.5 cap per boss-lv (lv10 = +5 → 10 raised). bossLv already captured above.
    const raisedCap = Balance.NECROMANCY_MAX_RAISED
      + Math.floor(bossLv * Balance.NECROMANCY_MAX_RAISED_PER_BOSS_LV)
    const raiseCount = Math.max(0, Math.min(
      queue.length,
      raisedCap - aliveRaised,
    ))

    const raised = []
    for (let i = 0; i < raiseCount; i++) {
      const entry = queue[i]
      // Spread spawn tiles in a small ring around boss-chamber center so they
      // don't all stack on the same tile.
      const angle = (i / Math.max(1, raiseCount)) * Math.PI * 2
      const r = 2 + (i % 2)
      const tx = cx + Math.round(Math.cos(angle) * r)
      const ty = cy + Math.round(Math.sin(angle) * r)

      const minion = createMinion(
        skeletonDef,
        { x: tx, y: ty },
        bossRoom.instanceId,
        { class: 'garrison', bossLevel: bossLv },
      )
      minion.isUndead             = true
      minion._raisedFromAdvDeath  = true
      minion._raisedClassId       = entry.classId
      minion._raisedAdvName       = entry.name
      minion._raisedSpriteVariant = entry.spriteVariant ?? null
      minion._expireAtDay         = expireOn

      // Lightweight class retention — boost the skeleton based on the
      // adventurer's old class. Cleric heal is handled in _tickRaisedClerics.
      this._applyClassRetentionBuffs(minion, entry.classId)
      // Re-apply boss+day scaling on top of any base-stat tweaks above.
      applyMinionScaling(minion, bossLv, this._gameState?.meta?.dayNumber ?? 1)

      this._gameState.minions.push(minion)
      raised.push(minion)
      EventBus.emit('MINION_PLACED', { minion })
    }
    // Drain the queue.
    queue.length = 0
    if (raised.length > 0) {
      EventBus.emit('NECROMANCY_RAISED', { count: raised.length, minionIds: raised.map(m => m.instanceId) })
    }
  }

  _applyClassRetentionBuffs(minion, classId) {
    if (!classId) return
    minion.stats ??= {}
    switch (classId) {
      case 'cleric': {
        // Cleric raises heal nearby allied minions every couple seconds —
        // their attack stat reads "wisdom" for mood; combat is handled
        // by the heal tick. Mark range so MinionAISystem treats them like a
        // standoff caster. Defense bumped so they're not first-pick targets.
        minion.stats.defense = (minion.stats.defense ?? 0) + 2
        minion.attackRange   = 2
        minion.tags          = [...(minion.tags ?? []), 'caster', 'support']
        break
      }
      case 'mage': {
        // Mage raise: ranged attacker with a small ATK bump.
        minion.stats.attack  = (minion.stats.attack ?? 0) + 2
        minion.attackRange   = 3
        minion.damageType    = 'arcane'
        minion.tags          = [...(minion.tags ?? []), 'caster']
        break
      }
      case 'ranger': {
        minion.stats.attack  = (minion.stats.attack ?? 0) + 1
        minion.attackRange   = 3
        break
      }
      case 'knight': {
        minion.resources.maxHp = (minion.resources.maxHp ?? 16) + 8
        minion.resources.hp    = minion.resources.maxHp
        minion.stats.defense   = (minion.stats.defense ?? 0) + 2
        break
      }
      case 'barbarian': {
        minion.stats.attack    = (minion.stats.attack ?? 0) + 3
        minion.stats.defense   = Math.max(0, (minion.stats.defense ?? 0) - 1)
        break
      }
      case 'monk': {
        minion.stats.attack    = (minion.stats.attack ?? 0) + 1
        minion.stats.speed     = (minion.stats.speed   ?? 1) * 1.15
        break
      }
      case 'rogue': {
        minion.stats.attack    = (minion.stats.attack ?? 0) + 2
        minion.stats.speed     = (minion.stats.speed   ?? 1) * 1.10
        break
      }
      case 'bard':
      case 'beast_master':
      case 'twitch_streamer':
      case 'necromancer':
      default: {
        minion.stats.attack    = (minion.stats.attack ?? 0) + 1
        break
      }
    }
  }

  // ── LIZARDMAN: Camouflage + Venom Stack ────────────────────────────────

  _onMinionPlaced(payload) {
    const m = payload?.minion
    if (!m) return
    // LIZARDMAN: stamp camouflage on freshly placed lizardman-tagged minions.
    if (this._archId() === 'lizardman' && this._isLizardmanMinion(m)) {
      m._camouflaged = true
    }
    // ORC: capture this minion's pristine baseline (for Loot+Warband recompute).
    if (this._archId() === 'orc' && this._isOrcMinion(m)) {
      this._captureOrcBaseline(m)
    }
  }

  _isOrcMinion(m) {
    return !!(m && Array.isArray(m.tags) && m.tags.includes(MINION_TAG_ORC))
  }

  _captureOrcBaseline(m) {
    if (!m) return
    // Strip any active Loot/Warband contribution so the captured value is
    // truly the un-buffed baseline. lootAtkBonus is additive; Warband is
    // multiplicative; we only ever read from the canonical baseline forward.
    m._orcBaseAttack  = Math.max(0, (m.stats?.attack  ?? 0) - (m.lootAtkBonus ?? 0))
    m._orcBaseDefense = m.stats?.defense ?? 0
  }

  _onCombatHit(payload) {
    const dmg = payload?.damage ?? 0
    if (dmg <= 0) return

    // LIZARDMAN — Venom Stack accrual on minion hit.
    if (this._archId() === 'lizardman') {
      const m = this._findMinion(payload?.sourceId)
      if (this._isLizardmanMinion(m)) {
        const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.targetId)
        if (adv) {
          const wasClean = !adv._venomStacks
          adv._venomStacks = (adv._venomStacks ?? 0) + 1
          // First-stack-only float so a venom-storm doesn't spam POISONED.
          if (wasClean) {
            EventBus.emit('STATUS_APPLIED', { targetId: adv.instanceId, label: 'POISONED' })
          }
          EventBus.emit('LIZARDMAN_VENOM_APPLIED', {
            advId:  adv.instanceId,
            stacks: adv._venomStacks,
          })
        }
      }
    }

    // VAMPIRE — Blood Tax. Any dungeon-faction minion's damage on an adv
    // heals the boss for the same amount.
    if (this._archId() === 'vampire') {
      const m = this._findMinion(payload?.sourceId)
      if (m && m.faction !== 'adventurer') {
        const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.targetId)
        if (adv) {
          const boss = this._gameState?.boss
          if (boss) {
            const before = boss.hp ?? 0
            boss.hp = Math.min(boss.maxHp ?? before, before + dmg)
            const healed = boss.hp - before
            if (healed >= Balance.VAMPIRE_BLOOD_TAX_VFX_MIN_DMG) {
              EventBus.emit('VAMPIRE_BLOOD_TAX_TICK', {
                fromX: adv.worldX, fromY: adv.worldY,
                toX:   boss.worldX, toY: boss.worldY,
                amount: healed,
              })
            }
          }
        }
      }
    }
  }

  _onAdvFledOrDied(payload) {
    const adv = payload?.adventurer
    if (!adv) return
    if (adv._venomStacks) adv._venomStacks = 0
  }

  _tickVenom() {
    // Generic venom-stack DoT — runs whenever an adv has stacks, regardless
    // of which archetype put them there (Lizardman attacks, Myconid corpse
    // contact, future hooks). Cheap when nobody is poisoned.
    const advs = this._gameState?.adventurers?.active ?? []
    const now = this._scene?.time?.now ?? 0
    for (const adv of advs) {
      if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const stacks = adv._venomStacks ?? 0
      if (stacks <= 0) continue
      adv._venomLastTickAt ??= 0
      if (now - adv._venomLastTickAt < Balance.LIZARDMAN_VENOM_TICK_INTERVAL_MS) continue
      adv._venomLastTickAt = now
      // +0.5 dmg/stack per boss-lv (floor): lv10 = +5 → 6 dmg/stack/tick.
      const bossLv = this._gameState?.boss?.level ?? 1
      const dmgPerStack = Balance.LIZARDMAN_VENOM_DMG_PER_STACK
        + Math.floor(bossLv * Balance.LIZARDMAN_VENOM_DMG_PER_BOSS_LV)
      const tickDmg = stacks * dmgPerStack
      const before = adv.resources.hp
      adv.resources.hp = Math.max(0, before - tickDmg)
      EventBus.emit('COMBAT_HIT', {
        sourceId:   'venom',
        targetId:   adv.instanceId,
        damage:     tickDmg,
        damageType: 'poison',
      })
      if (adv.resources.hp <= 0) {
        EventBus.emit('ADVENTURER_DIED', {
          adventurer: adv,
          killerId:   'venom',
          killerName: 'Venom',
          roomId:     null,
          damageType: 'poison',
        })
      }
    }
  }

  _tickRaisedClerics() {
    if (this._archId() !== 'lich') return
    const minions = this._gameState?.minions ?? []
    const now = this._scene?.time?.now ?? 0
    for (const m of minions) {
      if (!m._raisedFromAdvDeath || m._raisedClassId !== 'cleric') continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m._lastClericHealAt ??= 0
      if (now - m._lastClericHealAt < Balance.NECROMANCY_CLERIC_HEAL_INTERVAL_MS) continue
      m._lastClericHealAt = now
      // Heal the most-wounded ally minion within Manhattan dist 3.
      let target = null
      let bestDeficit = 0
      for (const ally of minions) {
        if (ally === m) continue
        if (ally.aiState === 'dead' || (ally.resources?.hp ?? 0) <= 0) continue
        if (ally.faction && ally.faction !== 'dungeon') continue
        const max = ally.resources?.maxHp ?? 0
        const cur = ally.resources?.hp    ?? 0
        const def = max - cur
        if (def <= 0) continue
        if (Math.abs(ally.tileX - m.tileX) + Math.abs(ally.tileY - m.tileY) > 3) continue
        if (def > bestDeficit) { bestDeficit = def; target = ally }
      }
      if (!target) continue
      // +1 heal-per-tick per boss-lv beyond 1 (lv10 = +9 → 13/tick).
      const bossLv = this._gameState?.boss?.level ?? 1
      const healAmount = Balance.NECROMANCY_CLERIC_HEAL_AMOUNT
        + (bossLv - 1) * Balance.NECROMANCY_CLERIC_HEAL_PER_BOSS_LV
      const heal = Math.min(bestDeficit, healAmount)
      target.resources.hp += heal
      EventBus.emit('NECROMANCY_CLERIC_HEAL', {
        sourceId: m.instanceId,
        targetId: target.instanceId,
        amount:   heal,
      })
    }
  }

  // Raised Bard aura — every tick, every dungeon minion within
  // NECROMANCY_BARD_AURA_RANGE_TILES of a raised bard gets a +15% ATK
  // baseline-aware buff for the next ~250 ms (re-stamped each frame the
  // minion is in range, so the buff persists while inside and decays
  // naturally when leaving). Does not stack between bards.
  _tickRaisedBards() {
    if (this._archId() !== 'lich') return
    const minions = this._gameState?.minions ?? []
    if (minions.length === 0) return
    const now    = this._scene?.time?.now ?? 0
    const range  = Balance.NECROMANCY_BARD_AURA_RANGE_TILES ?? 4
    const buffMs = 250                  // refreshed every tick, decays if out of range
    const mul    = 1 + (Balance.NECROMANCY_BARD_AURA_ATK_PCT ?? 0.15)
    for (const bard of minions) {
      if (!bard._raisedFromAdvDeath || bard._raisedClassId !== 'bard') continue
      if (bard.aiState === 'dead' || (bard.resources?.hp ?? 0) <= 0) continue
      for (const ally of minions) {
        if (ally === bard) continue
        if (ally.aiState === 'dead' || (ally.resources?.hp ?? 0) <= 0) continue
        if (ally.faction && ally.faction !== 'dungeon') continue
        const d = Math.abs(ally.tileX - bard.tileX) + Math.abs(ally.tileY - bard.tileY)
        if (d > range) continue
        // Stamp baseline once so the buff is reversible without losing
        // intermediate adjustments (orc warband, evolution, etc).
        if (ally._raisedBardBaselineAtk == null) {
          ally._raisedBardBaselineAtk = ally.stats?.attack ?? 0
        }
        ally.stats.attack = Math.round(ally._raisedBardBaselineAtk * mul)
        ally._raisedBardBuffUntil = now + buffMs
      }
    }
    // Decay pass — any minion whose buff has expired reverts to baseline
    // and the baseline tag is cleared so future bards can re-stamp.
    for (const m of minions) {
      if (m._raisedBardBuffUntil == null) continue
      if (now < m._raisedBardBuffUntil) continue
      if (m._raisedBardBaselineAtk != null) {
        m.stats.attack = m._raisedBardBaselineAtk
        m._raisedBardBaselineAtk = null
      }
      m._raisedBardBuffUntil = null
    }
  }

  // ── MYCONID: Spore Network + Corpse Bloom ──────────────────────────────

  _onRoomRemovedMyconid(payload) {
    if (this._archId() !== 'myconid') return
    const room = payload?.room
    if (!room) return
    const list = this._gameState?.fungalCorpses ?? []
    if (list.length === 0) return
    this._gameState.fungalCorpses = list.filter(c => c.roomId !== room.instanceId)
  }

  _isCorridorRoom(room) {
    if (!room) return false
    if (room.definitionId === 'starter_corridor') return true
    if (Array.isArray(room.tags) && room.tags.includes('corridor')) return true
    return false
  }

  _rollSporeNetwork() {
    if (this._archId() !== 'myconid') return
    const today = this._gameState?.meta?.dayNumber ?? 1
    this._gameState._myconid ??= { activeSporeRoomIds: [] }
    if (today % Balance.MYCONID_SPORE_INTERVAL_DAYS !== 0) {
      this._gameState._myconid.activeSporeRoomIds = []
      return
    }
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const ids = []
    for (const r of rooms) {
      if (this._isCorridorRoom(r)) ids.push(r.instanceId)
    }
    this._gameState._myconid.activeSporeRoomIds = ids
    EventBus.emit('MYCONID_SPORE_DAY_BEGAN', { roomIds: ids, day: today })
  }

  _clearSporeFx() {
    const fx = this._sporeFx
    if (!fx) return
    fx.container?.destroy?.(true)
    this._sporeFx = null
  }

  _renderSporeOverlay() {
    if (this._archId() !== 'myconid') return
    const s = this._scene
    if (!s?.add?.container) return

    // Tear down any previous-day VFX so we never leak particles between
    // spore-network days.
    this._clearSporeFx()

    const ids = this._gameState?._myconid?.activeSporeRoomIds ?? []
    if (ids.length === 0) return

    const TS    = Balance.TILE_SIZE
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const container = s.add.container(0, 0).setDepth(2.5)
    const roomFx = []

    for (const r of rooms) {
      if (!ids.includes(r.instanceId)) continue
      const px = r.gridX * TS
      const py = r.gridY * TS
      const pw = r.width  * TS
      const ph = r.height * TS

      // Deterministic seed → cloud shapes don't rearrange across saves.
      let seed = ((r.gridX + 1) * 73856093 ^ (r.gridY + 1) * 19349663) >>> 0
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
      }

      // Layered cloud puffs — overlapping translucent green discs with a
      // bright inner core, scattered across the room interior. Animated
      // alpha+scale via the per-frame _tickSporeVfx loop (NOT Phaser
      // tweens) — using infinite-yoyo tweens for every puff stalled the
      // main loop on days with many spore corridors.
      const inset  = TS * 0.45
      const minX   = px + inset
      const maxX   = px + pw - inset
      const minY   = py + inset
      const maxY   = py + ph - inset
      const area = r.width * r.height
      const puffCount = Math.min(6, Math.max(3, Math.floor(area / 10)))
      const puffs = []
      for (let i = 0; i < puffCount; i++) {
        const cx = minX + rand() * Math.max(1, (maxX - minX))
        const cy = minY + rand() * Math.max(1, (maxY - minY))
        const radius = TS * (0.75 + rand() * 0.55)
        const halo = s.add.circle(cx, cy, radius,        0x6abf3d, 0.10)
        const core = s.add.circle(cx, cy, radius * 0.55, 0x9ee870, 0.20)
        container.add([halo, core])
        puffs.push({
          halo, core,
          phase: rand() * Math.PI * 2,   // staggered breathing per puff
          freq:  0.0010 + rand() * 0.0008, // rad/ms
        })
      }

      // Drifting pixel spores — tiny green specks with random velocity
      // that wander across the room and fade in/out over their lifetime.
      // Animated per-frame in `_tickSporeVfx`.
      const particles = []
      const partCount = Math.min(18, Math.max(8, Math.floor(area / 5)))
      const bounds = {
        minX: px + 2, maxX: px + pw - 2,
        minY: py + 2, maxY: py + ph - 2,
      }
      for (let i = 0; i < partCount; i++) {
        const sprite = s.add.rectangle(
          bounds.minX + rand() * (bounds.maxX - bounds.minX),
          bounds.minY + rand() * (bounds.maxY - bounds.minY),
          2, 2,
          rand() < 0.25 ? 0xffffaa : 0xccff88,
          0.0,
        )
        container.add(sprite)
        const maxLife = 1800 + rand() * 1800
        particles.push({
          sprite,
          // px/ms — slow drift with a faint upward bias.
          vx:      (rand() - 0.5) * 0.030,
          vy:      (rand() - 0.5) * 0.030 - 0.012,
          life:    rand() * maxLife,
          maxLife,
          bounds,
        })
      }

      roomFx.push({ roomId: r.instanceId, particles, puffs })
    }

    this._sporeFx = { container, rooms: roomFx, elapsed: 0 }
  }

  // Per-frame spore drift + cloud-puff breathing. Manual animation
  // avoids the per-puff infinite-yoyo Phaser tweens that piled up on
  // big spore-network days and froze the main loop.
  _tickSporeVfx(deltaMs) {
    const fx = this._sporeFx
    if (!fx?.rooms?.length) return
    const dt = Math.max(1, Math.min(64, deltaMs))
    fx.elapsed = (fx.elapsed ?? 0) + dt
    const t = fx.elapsed
    for (const r of fx.rooms) {
      // Cloud puff breath — sin-curve alpha + slight core scale. Cheaper
      // than tweens because we only touch alpha/scale on a handful of
      // already-allocated Arc objects per room.
      for (const puff of (r.puffs ?? [])) {
        const ph = Math.sin(t * puff.freq + puff.phase)
        // halo breathes 0.18 ↔ 0.32 — the wide soft outer green wash
        puff.halo.setAlpha(0.25 + 0.07 * ph)
        // core breathes 0.40 ↔ 0.60 with scale 1.00 ↔ 1.18 — the bright
        // inner billow that reads as the cloud's mass
        puff.core.setAlpha(0.50 + 0.10 * ph)
        const sc = 1.09 + 0.09 * ph
        puff.core.setScale(sc, sc)
      }
      for (const p of r.particles) {
        p.life -= dt
        if (p.life <= 0) {
          const b = p.bounds
          p.sprite.x  = b.minX + Math.random() * (b.maxX - b.minX)
          p.sprite.y  = b.minY + Math.random() * (b.maxY - b.minY)
          p.vx        = (Math.random() - 0.5) * 0.030
          p.vy        = (Math.random() - 0.5) * 0.030 - 0.012
          p.maxLife   = 1800 + Math.random() * 1800
          p.life      = p.maxLife
          continue
        }
        p.sprite.x += p.vx * dt
        p.sprite.y += p.vy * dt
        const b = p.bounds
        if (p.sprite.x < b.minX)      { p.sprite.x = b.minX; p.vx = -p.vx }
        else if (p.sprite.x > b.maxX) { p.sprite.x = b.maxX; p.vx = -p.vx }
        if (p.sprite.y < b.minY)      { p.sprite.y = b.minY; p.vy = -p.vy }
        else if (p.sprite.y > b.maxY) { p.sprite.y = b.maxY; p.vy = -p.vy }
        // Sin-curve alpha — fade in then back out over the particle's life.
        const lt = 1 - (p.life / p.maxLife)
        p.sprite.setAlpha(0.15 + 0.75 * Math.sin(Math.PI * lt))
      }
    }
  }

  _tickFungalCorpseDay() {
    const list = this._gameState?.fungalCorpses ?? []
    if (list.length === 0) return
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const plantDef    = minionTypes.find(m => m.id === 'plant1')
    const bossLv      = this._gameState?.boss?.level ?? 1

    const remaining = []
    for (const c of list) {
      c.daysRemaining = (c.daysRemaining ?? 0) - 1
      if (c.daysRemaining > 0) {
        remaining.push(c)
        continue
      }
      // Sprout a free Vinekin in the corpse tile (if the room still exists).
      const room = this._gameState?.dungeon?.rooms?.find(r => r.instanceId === c.roomId)
      if (plantDef && room) {
        try {
          // bossLevel option already triggers applyBossLevelToMinion inside
          // createMinion — DO NOT call it a second time or stats double-scale.
          const minion = createMinion(
            plantDef,
            { x: c.tileX, y: c.tileY },
            c.roomId,
            { class: 'garrison', bossLevel: bossLv },
          )
          minion._myconidSprout = true
          this._gameState.minions.push(minion)
          EventBus.emit('MINION_PLACED', { minion })
          EventBus.emit('MYCONID_CORPSE_SPROUTED', {
            corpseId: c.instanceId,
            minionId: minion.instanceId,
            advId:    c.advId ?? null,
            tileX:    c.tileX,
            tileY:    c.tileY,
          })
        } catch (err) {
          // Don't let a sprout throw drag the entire DAY_PHASE_BEGAN tick
          // (and every other archetype/system listener after it) into a
          // halt. Log so we can see what failed and continue.
          console.error('[Myconid] Vinekin sprout failed:', err, { corpse: c })
          EventBus.emit('MYCONID_CORPSE_EXPIRED', { corpseId: c.instanceId })
        }
      } else {
        EventBus.emit('MYCONID_CORPSE_EXPIRED', { corpseId: c.instanceId })
      }
    }
    this._gameState.fungalCorpses = remaining
  }

  // ── GNOLL: Hunters Pack + Bloodlust ────────────────────────────────────

  _isHuntersPackGnoll(m) {
    return !!(m && m._isHuntersPackGnoll)
  }

  _expectedHuntersPackCount() {
    const lv = this._gameState?.boss?.level ?? 1
    // +0.5 pack-max per boss-lv (floor): lv10 = +5 → cap 10. Pack size still
    // scales with boss level (1-for-1) and is clamped by the new effective cap.
    const cap = Balance.GNOLL_HUNTERS_PACK_MAX
      + Math.floor(lv * Balance.GNOLL_HUNTERS_PACK_MAX_PER_BOSS_LV)
    return Math.min(cap, Math.max(1, lv))
  }

  // Spawn enough free gnoll1 minions in the boss chamber to bring the pack
  // back up to its expected count. Existing pack members (alive or culled
  // by night-respawn) keep their evolution / kill history.
  _refillHuntersPack() {
    if (this._archId() !== 'gnoll') return
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const gnollDef = minionTypes.find(m => m.id === 'gnoll1')
    if (!gnollDef) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    const minions = this._gameState?.minions ?? []
    // Count ALL pack gnolls (alive + dead) — dead ones will be revived by
    // respawnAll moments after this runs. Using alive-only would spawn a
    // replacement for every gnoll that died during the day, then respawnAll
    // would also revive the original, producing one extra gnoll per death.
    const totalCount = minions.filter(m => this._isHuntersPackGnoll(m)).length
    const need = this._expectedHuntersPackCount() - totalCount
    if (need <= 0) return

    const bossLv = this._gameState?.boss?.level ?? 1
    const cx = bossRoom.gridX + Math.floor(bossRoom.width  / 2)
    const cy = bossRoom.gridY + Math.floor(bossRoom.height / 2)

    // Use the effective (lv-scaled) cap for ring distribution so spawns spread
    // evenly across the larger pack at high boss-lv.
    const effectiveCap = Balance.GNOLL_HUNTERS_PACK_MAX
      + Math.floor(bossLv * Balance.GNOLL_HUNTERS_PACK_MAX_PER_BOSS_LV)
    for (let i = 0; i < need; i++) {
      const idx   = totalCount + i
      const angle = (idx / Math.max(1, effectiveCap)) * Math.PI * 2
      const r = 2 + (idx % 2)
      const tx = cx + Math.round(Math.cos(angle) * r)
      const ty = cy + Math.round(Math.sin(angle) * r)
      const minion = createMinion(
        gnollDef,
        { x: tx, y: ty },
        bossRoom.instanceId,
        { class: 'garrison', bossLevel: bossLv },
      )
      minion._isHuntersPackGnoll = true
      // bossLevel option already triggers applyBossLevelToMinion inside
      // createMinion — DO NOT call it a second time or stats double-scale.
      this._gameState.minions.push(minion)
      EventBus.emit('MINION_PLACED', { minion })
    }
    EventBus.emit('GNOLL_HUNTERS_PACK_REFILLED', { spawned: need, total: totalCount + need })
  }

  // Capture each gnoll-tagged minion's current ATK as the day's baseline so
  // Bloodlust can be cleanly recomputed and reset.
  _captureBloodlustBaselines() {
    const gs = this._gameState
    if (!gs) return
    gs._gnoll ??= { bloodlustStacks: 0 }
    gs._gnoll.bloodlustStacks = 0
    for (const m of (gs.minions ?? [])) {
      if (!this._isGnollMinion(m)) continue
      m._baselineAttack = m.stats?.attack ?? 1
    }
  }

  _isGnollMinion(m) {
    if (!m) return false
    if (this._isHuntersPackGnoll(m)) return true
    return Array.isArray(m.tags) && m.tags.includes('gnoll')
  }

  _applyBloodlustStack() {
    const gs = this._gameState
    if (!gs) return
    gs._gnoll ??= { bloodlustStacks: 0 }
    gs._gnoll.bloodlustStacks = (gs._gnoll.bloodlustStacks ?? 0) + 1
    const stacks = gs._gnoll.bloodlustStacks
    const mult = 1 + Balance.GNOLL_BLOODLUST_PCT_PER_KILL * stacks
    let touched = 0
    for (const m of (gs.minions ?? [])) {
      if (!this._isGnollMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const base = m._baselineAttack ?? (m.stats?.attack ?? 1)
      m._baselineAttack = base
      m.stats ??= {}
      m.stats.attack = Math.max(1, Math.round(base * mult))
      touched++
    }
    EventBus.emit('GNOLL_BLOODLUST_STACK', {
      stacks,
      bonusPct: Balance.GNOLL_BLOODLUST_PCT_PER_KILL * stacks,
      gnollsBuffed: touched,
    })
  }

  _resetBloodlust() {
    const gs = this._gameState
    if (!gs) return
    gs._gnoll ??= { bloodlustStacks: 0 }
    gs._gnoll.bloodlustStacks = 0
    for (const m of (gs.minions ?? [])) {
      if (!this._isGnollMinion(m)) continue
      if (m._baselineAttack != null) {
        m.stats ??= {}
        m.stats.attack = m._baselineAttack
      }
    }
  }

  // ── VAMPIRE: Charm + Blood Tax ─────────────────────────────────────────

  _tickVampire(now) {
    if (this._archId() !== 'vampire') return
    this._tickCharmConversion(now)
    this._tickThrallRoaming(now)
  }

  // ── SUCCUBUS: Shapeshifter + Seductress ─────────────────────────────────
  //
  // Day-phase loop. While uses-left > 0 and the cooldown has elapsed and
  // there is at least one targetable adv, kick off a flight. Phases:
  //   'transform_out' (300ms) — boss visible, transform+smoke VFX on her
  //   'going'         (1.5s)  — boss hidden, bat sprite flies → target
  //   'return'        (1.5s)  — boss hidden, bat sprite flies back
  //   'transform_in'  (300ms) — boss visible again, transform+smoke VFX
  //   null                    — idle; cooldown counts down to next charm
  //
  // Phase transitions emit events (SUCCUBUS_TRANSFORM_OUT/IN, SUCCUBUS_BAT_
  // FLYING_OUT/BACK, SUCCUBUS_CHARM_APPLIED, SUCCUBUS_FLIGHT_ENDED) so the
  // renderers can react. Boss visibility is driven off `flight.phase` —
  // BossRenderer hides the boss whenever phase is 'going' or 'return'.
  _tickSuccubus(delta, now) {
    if (this._archId() !== 'succubus') return
    // Day phase only — skip during night/build phase.
    if ((this._gameState?.meta?.phase ?? '') !== 'day') return
    // Boss fight runs in an overlay scene that doesn't compose well with
    // mid-flight VFX (sprites can disappear). Suspend during the fight.
    if (this._bossFightActive) return
    const s = (this._gameState._succubus ??= { usesLeft: 1, cooldownUntil: 0, flight: null })

    // Active flight in progress — advance its phase
    if (s.flight) {
      const f = s.flight
      if (now < f.until) return

      if (f.phase === 'transform_out') {
        // Transform finished — bat takes off
        f.phase     = 'going'
        f.startedAt = now
        f.until     = now + 1500
        EventBus.emit('SUCCUBUS_BAT_FLYING_OUT', {
          fromX: f.fromX, fromY: f.fromY, toX: f.toX, toY: f.toY,
        })
        return
      }

      if (f.phase === 'going') {
        // Apply charm at the bat's arrival. Tear down any AT_BOSS / FLEE /
        // pathing state so the charmed adv enters _tickCharmedAdv with a
        // clean slate — otherwise leftover goals can immediately re-trigger
        // and the adv just stands still.
        const target = this._gameState.adventurers?.active?.find(a => a.instanceId === f.targetId)
        if (target && target.aiState !== 'dead' && (target.resources?.hp ?? 0) > 0) {
          target.aiState     = 'charmed'
          target._charmedAt  = now
          target._charmedKills = 0
          target._charmedAloneTimer = 0
          target._charmerId  = 'succubus'
          target._charmedFormerPartyId = target.partyId ?? null
          target.partyId       = null
          target.path          = null
          target.pathIndex     = 0
          target.goal          = { type: 'CHARMED' }
          target.goalStack     = []
          target._charmedAtkAcc  = 0
          target._charmedPathAt  = 0
          EventBus.emit('SUCCUBUS_CHARM_APPLIED', { targetId: target.instanceId })
        }
        // Return flight — swap from/to so the bat heads back to boss room
        const newFromX = f.toX, newFromY = f.toY
        f.phase     = 'return'
        f.startedAt = now
        f.until     = now + 1500
        f.fromX     = newFromX
        f.fromY     = newFromY
        f.toX       = f.bossX
        f.toY       = f.bossY
        EventBus.emit('SUCCUBUS_BAT_FLYING_BACK', {
          fromX: f.fromX, fromY: f.fromY, toX: f.toX, toY: f.toY,
        })
        return
      }

      if (f.phase === 'return') {
        // Bat landed — boss-side reverse-transform begins
        f.phase     = 'transform_in'
        f.startedAt = now
        f.until     = now + 300
        EventBus.emit('SUCCUBUS_TRANSFORM_IN', { bossX: f.bossX, bossY: f.bossY })
        return
      }

      if (f.phase === 'transform_in') {
        // Reverse transform finished — boss is back, end the flight cycle.
        // Randomize cooldown so subsequent charms don't clump.
        EventBus.emit('SUCCUBUS_FLIGHT_ENDED', {})
        s.flight = null
        // -1s base + rand per boss-lv beyond 1; floored at 5000ms/4000ms so
        // it doesn't collapse to zero (lv10 lands at 11000/7000 ms).
        const _succBossLv = this._gameState?.boss?.level ?? 1
        const _reduction = Math.max(0, _succBossLv - 1) * Balance.SUCCUBUS_CHARM_COOLDOWN_REDUCTION_PER_LV_MS
        const _cdBase = Math.max(5000,
          (Balance.SUCCUBUS_CHARM_COOLDOWN_BASE_MS ?? 20000) - _reduction)
        const _cdRand = Math.max(4000,
          (Balance.SUCCUBUS_CHARM_COOLDOWN_RAND_MS ?? 16000) - _reduction)
        s.cooldownUntil = now + _cdBase + Math.floor(Math.random() * _cdRand)
        return
      }
      return
    }

    // No active flight — try to start one if uses + cooldown allow it
    if ((s.usesLeft ?? 0) <= 0) return
    if ((s.cooldownUntil ?? 0) > now) return

    const advs = this._gameState?.adventurers?.active ?? []
    const eligible = advs.filter(a =>
      a && a.aiState !== 'dead' && a.aiState !== 'charmed' &&
      a.aiState !== 'fleeing' && a.aiState !== 'fled' &&
      (a.resources?.hp ?? 0) > 0
    )
    if (eligible.length === 0) return

    const target = eligible[Math.floor(Math.random() * eligible.length)]
    // Boss origin: prefer the boss's live worldX/Y (she may be wandering
    // her chamber); fall back to room center if the field is missing.
    const TS = Balance.TILE_SIZE
    const boss = this._gameState?.boss
    let bossX = boss?.worldX, bossY = boss?.worldY
    if (bossX == null || bossY == null) {
      const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
      if (!bossRoom) return
      bossX = (bossRoom.gridX + bossRoom.width  / 2) * TS
      bossY = (bossRoom.gridY + bossRoom.height / 2) * TS
    }
    const toX = target.worldX ?? (target.tileX * TS + TS / 2)
    const toY = target.worldY ?? (target.tileY * TS + TS / 2)

    s.flight = {
      phase:     'transform_out',
      targetId:  target.instanceId,
      startedAt: now,
      until:     now + 300,
      fromX:     bossX,
      fromY:     bossY,
      toX, toY,
      bossX, bossY,           // pinned for the return-flight target
    }
    s.usesLeft -= 1
    EventBus.emit('SUCCUBUS_FLIGHT_STARTED', { targetId: target.instanceId, fromX: bossX, fromY: bossY, toX, toY })
    EventBus.emit('SUCCUBUS_TRANSFORM_OUT',  { bossX, bossY, dx: toX - bossX })
  }

  _tickCharmConversion(now = 0) {
    const advs = this._gameState?.adventurers?.active ?? []
    if (advs.length === 0) return
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const bossRoom = rooms.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    // Non-boss rooms the thrall can be planted in. A converted thrall must
    // NOT be left standing on the adventurer's old tile — that tile sits
    // inside/next to the boss chamber, and a thrall only relocates via
    // MinionAI (day phase only) or respawnAll's home-snap (night-start
    // only). A conversion that lands late in the day or during the build
    // phase would otherwise strand the thrall, invisible, on the boss
    // floor until the next day's AI walks it out. Planting it directly in
    // a real room makes it appear immediately in any phase.
    const roamPool = rooms.filter(r => r.definitionId !== 'boss_chamber')
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const thrallDef = minionTypes.find(m => m.id === 'vampire_minion1')
    if (!thrallDef) return
    const bossLv = this._gameState?.boss?.level ?? 1

    let converted = 0
    for (let i = advs.length - 1; i >= 0; i--) {
      const adv = advs[i]
      if (!adv?._charmed) continue
      if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const boss = this._gameState.boss
      if (!boss) continue
      const dist = Math.hypot(
        (adv.worldX ?? adv.tileX * 32) - (boss.worldX ?? boss.tileX * 32),
        (adv.worldY ?? adv.tileY * 32) - (boss.worldY ?? boss.tileY * 32),
      )
      if (dist > 48) continue  // ~1.5 tiles — must physically touch the boss

      // Convert: spawn a vampire_minion1 thrall, then remove the adv from
      // the active list. The thrall is planted directly in a random
      // non-boss room (full live + home position) so it's standing
      // somewhere visible the instant it converts — see roamPool comment
      // above. Falls back to the adv's tile only if the dungeon somehow
      // has no rooms outside the boss chamber.
      let spawnTileX  = adv.tileX
      let spawnTileY  = adv.tileY
      let spawnRoomId = bossRoom.instanceId
      if (roamPool.length > 0) {
        const room = roamPool[Math.floor(Math.random() * roamPool.length)]
        spawnTileX  = room.gridX + Math.floor(room.width  / 2)
        spawnTileY  = room.gridY + Math.floor(room.height / 2)
        spawnRoomId = room.instanceId
      }
      const minion = createMinion(
        thrallDef,
        { x: spawnTileX, y: spawnTileY },
        spawnRoomId,
        { class: 'garrison', bossLevel: bossLv },
      )
      minion._isVampireThrall   = true
      minion._charmedClassId    = adv.classId ?? 'unknown'
      minion._charmedAdvName    = adv.name    ?? 'Thrall'
      // A thrall roams in the open — it must never inherit vampire_minion1's
      // Sleep on Ceiling hide flag. Clear it explicitly so the thrall is
      // visible the instant it converts, even before its first AI tick or
      // when converted during the build phase (AI doesn't tick at night).
      minion._hidden            = false
      // Stamp the roam clock to "now" so the thrall settles in its spawn
      // room for a full swap interval before it starts wandering.
      minion._thrallRoamLastSwapAt = now
      minion.isUndead           = true   // permadeath: respawnAll strips dead undead
      // Light class retention to mirror Lich Necromancy.
      this._applyClassRetentionBuffs(minion, adv.classId)
      applyMinionScaling(minion, bossLv, this._gameState?.meta?.dayNumber ?? 1)
      this._gameState.minions.push(minion)
      EventBus.emit('MINION_PLACED', { minion })
      EventBus.emit('VAMPIRE_THRALL_CONVERTED', {
        advId:    adv.instanceId,
        minionId: minion.instanceId,
        classId:  adv.classId,
      })

      // Remove from active and push to graveyard so ADVENTURER_DIED
      // triggers DayPhase's "all out" check and the day progresses.
      advs.splice(i, 1)
      this._gameState.adventurers.graveyard.push({
        ...adv,
        diedOnDay:  this._gameState.meta?.dayNumber ?? 0,
        killedBy:   'vampire_charm',
        killerName: 'Vampire',
        damageType: 'unholy',
      })
      EventBus.emit('ADVENTURER_DIED', {
        adventurer: adv,
        killerId:   'vampire_charm',
        killerName: 'Vampire',
        roomId:     this._scene?.dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)?.instanceId ?? null,
        damageType: 'unholy',
      })
      // Turning an adventurer into a thrall counts as a kill for the boss —
      // award XP just like a normal defeat (conversion bypasses _killAdv).
      this._scene?.aiSystem?._awardBossXp?.()
      converted++
    }
    if (converted > 0) {
      EventBus.emit('VAMPIRE_THRALL_BATCH_CONVERTED', { count: converted })
    }
  }

  _tickThrallRoaming(now) {
    const minions = this._gameState?.minions ?? []
    const rooms   = this._gameState?.dungeon?.rooms ?? []
    if (minions.length === 0 || rooms.length === 0) return
    const roamPool = rooms.filter(r => r.definitionId !== 'boss_chamber')
    if (roamPool.length === 0) return
    const SWAP = Balance.VAMPIRE_THRALL_ROAM_SWAP_MS
    for (const m of minions) {
      if (!m._isVampireThrall) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m._thrallRoamLastSwapAt ??= 0
      if (now - m._thrallRoamLastSwapAt < SWAP) continue
      m._thrallRoamLastSwapAt = now
      const pick = roamPool[Math.floor(Math.random() * roamPool.length)]
      const cx = pick.gridX + Math.floor(pick.width  / 2)
      const cy = pick.gridY + Math.floor(pick.height / 2)
      m.assignedRoomId = pick.instanceId
      m.homeTileX = cx
      m.homeTileY = cy
    }
  }

  // ── DEMON: Sacrifice Pact + Hellgate ───────────────────────────────────

  _sacrificeUsesLeft() {
    return this._gameState?._demon?.sacrificeUsesLeft ?? 0
  }

  _sacrificeAvailable() {
    if (this._archId() !== 'demon') return false
    if (this._sacrificeUsesLeft() <= 0) return false
    // Need at least one minion to burn.
    return (this._gameState?.minions ?? []).some(m =>
      m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && m.faction === 'dungeon',
    )
  }

  // The SACRIFICE button fires immediately — no minion-pick step. The
  // minion to burn is auto-chosen by _pickSacrificeMinion(); we flip the
  // transient _sacrificeArmed flag on so the shared _fireSacrifice() guard
  // passes for this synchronous call. DEMON_SACRIFICE_ARMED is intentionally
  // NOT emitted, so the UI never enters a "PICK A MINION" state.
  _armSacrifice() {
    if (!this._sacrificeAvailable()) return
    const m = this._pickSacrificeMinion()
    if (!m) { this._disarmSacrifice(); return }
    this._sacrificeArmed = true
    this._fireSacrifice({ minionId: m.instanceId })
  }

  // Auto-pick the minion the Sacrifice Pact burns. 50% chance to prefer an
  // expendable Hellgate Imp (this archetype's other ability spawns Imps for
  // free), so on average half of all sacrifices cost only a free imp rather
  // than a minion the player paid for. Falls back to the other pool when
  // the preferred one is empty.
  _pickSacrificeMinion() {
    const alive = (this._gameState?.minions ?? []).filter(m =>
      m && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && m.faction === 'dungeon')
    if (alive.length === 0) return null
    const imps    = alive.filter(m => m._isDemonImp)
    const nonImps = alive.filter(m => !m._isDemonImp)
    const preferImp = Math.random() < 0.5
    let pool = preferImp
      ? (imps.length    ? imps    : nonImps)
      : (nonImps.length ? nonImps : imps)
    if (pool.length === 0) pool = alive
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // Always emits DEMON_SACRIFICE_DISARMED, even if we believed we were
  // already disarmed. The UI may be holding stale armed state (e.g. if the
  // night reset cleared us silently in the past) — broadcasting the event
  // unconditionally lets the UI self-heal back to the SACRIFICE label.
  _disarmSacrifice() {
    this._sacrificeArmed = false
    EventBus.emit('DEMON_SACRIFICE_DISARMED', {})
  }

  // payload: { minionId } — fired by the UI when the player clicks one of
  // their own minions while the sacrifice is armed.
  _fireSacrifice(payload) {
    if (!this._sacrificeArmed) return
    if (!this._sacrificeAvailable()) { this._disarmSacrifice(); return }
    const m = this._gameState?.minions?.find(x => x.instanceId === payload?.minionId)
    if (!m || m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) {
      this._disarmSacrifice()
      return
    }
    // Pick a random alive adv in the dungeon.
    const advs = (this._gameState?.adventurers?.active ?? [])
      .filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
    if (advs.length === 0) {
      this._disarmSacrifice()
      EventBus.emit('DEMON_SACRIFICE_NO_TARGETS', {})
      return
    }
    const victim = advs[Math.floor(Math.random() * advs.length)]

    // Burn the minion (permanent — flag stops the night respawn).
    const burnX = m.worldX, burnY = m.worldY
    m._sacrificeBurned = true   // (defensive marker; we drop the entity below)
    m.resources.hp = 0
    m.aiState = 'dead'
    EventBus.emit('MINION_DIED', { minion: m, killerId: 'sacrifice_pact' })
    EventBus.emit('DEMON_SACRIFICE_BURN_VFX', { x: burnX, y: burnY })
    // Permadeath: strip from gameState.minions so the night respawn pass
    // doesn't revive it.
    this._gameState.minions = (this._gameState.minions ?? [])
      .filter(x => x.instanceId !== m.instanceId)

    // Instakill the chosen victim.
    victim.resources.hp = 0
    EventBus.emit('COMBAT_HIT', {
      sourceId: 'sacrifice_pact',
      targetId: victim.instanceId,
      damage:   victim.resources?.maxHp ?? 9999,
      damageType: 'fire',
    })
    EventBus.emit('ADVENTURER_DIED', {
      adventurer: victim,
      killerId:   'sacrifice_pact',
      killerName: 'Sacrifice Pact',
      roomId:     this._scene?.dungeonGrid?.getRoomAtTile?.(victim.tileX, victim.tileY)?.instanceId ?? null,
      damageType: 'fire',
    })

    // Burn the daily use, disarm.
    this._gameState._demon ??= { sacrificeUsesLeft: 0 }
    this._gameState._demon.sacrificeUsesLeft = Math.max(0, this._gameState._demon.sacrificeUsesLeft - 1)
    this._sacrificeArmed = false
    EventBus.emit('DEMON_SACRIFICE_FIRED', {
      burnedMinionId: m.instanceId,
      victimAdvId:    victim.instanceId,
    })
  }

  // Permanent infernal portal placed in the top-left corner of the boss
  // chamber. Visual-only; spawn logic is in _spawnHellgateImps.
  _renderHellgatePortal() {
    if (this._archId() !== 'demon') return
    const s = this._scene
    if (!s?.add?.sprite) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    if (this._hellgateFx) return  // already placed; animation loops itself
    if (!s.textures.exists('demon-portal')) return
    const TS = Balance.TILE_SIZE
    const cx = (bossRoom.gridX + 3) * TS
    const cy = (bossRoom.gridY + 3) * TS
    this._hellgateFx = s.add.sprite(cx, cy, 'demon-portal')
      .setDepth(2.7)
      .setScale(2)
    if (s.anims.exists('demon-portal-spin')) {
      this._hellgateFx.play('demon-portal-spin')
    }
  }

  _impStatScaleForLevel(bossLv) {
    const base = Balance.DEMON_HELLGATE_BASE_STAT_FRAC
    const bonus = Math.max(0, bossLv) * Balance.DEMON_HELLGATE_STAT_PER_LV
    return base * (1 + bonus)
  }

  // Spawn `count` imps in a ring around the boss-room corner. Returns the
  // number actually placed (may be 0 if the boss room or imp def is missing).
  _spawnHellgateImps(count) {
    if (this._archId() !== 'demon') return 0
    if (count <= 0) return 0
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const impDef = minionTypes.find(m => m.id === 'imp1')
    if (!impDef) return 0
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return 0
    const bossLv = this._gameState?.boss?.level ?? 1
    const scale = this._impStatScaleForLevel(bossLv)

    const cx = bossRoom.gridX + 3
    const cy = bossRoom.gridY + 3

    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2
      const r = 1
      const tx = cx + Math.round(Math.cos(angle) * r)
      const ty = cy + Math.round(Math.sin(angle) * r)
      const minion = createMinion(
        impDef,
        { x: tx, y: ty },
        bossRoom.instanceId,
        { class: 'garrison' },   // note: NOT applying boss-level scaling here;
                                 // we want the explicit scale fraction below.
      )
      const base = impDef.baseStats ?? {}
      minion.resources.maxHp = Math.max(1, Math.round((base.hp     ?? 14) * scale))
      minion.resources.hp    = minion.resources.maxHp
      minion.stats.attack    = Math.max(1, Math.round((base.attack ?? 5)  * scale))
      minion.stats.defense   = Math.max(0, Math.round((base.defense ?? 1) * scale))
      minion._isDemonImp        = true
      minion._impRoamLastSwapAt = 0
      this._gameState.minions.push(minion)
      EventBus.emit('MINION_PLACED', { minion })
    }
    EventBus.emit('DEMON_HELLGATE_SPAWNED', { count, statScale: scale })
    return count
  }

  // Per-frame: rotate every demon imp's assignedRoomId every ~6 seconds so
  // they roam the dungeon instead of orbiting the boss room. The base
  // patrol AI handles intra-room movement; we just retarget where "home" is.
  _tickDemonImps(now) {
    if (this._archId() !== 'demon') return
    const minions = this._gameState?.minions ?? []
    const rooms   = this._gameState?.dungeon?.rooms ?? []
    if (minions.length === 0 || rooms.length === 0) return
    const ROAM_SWAP_MS = 6000
    const roamPool = rooms.filter(r => r.definitionId !== 'boss_chamber')
    if (roamPool.length === 0) return
    for (const m of minions) {
      if (!m._isDemonImp) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m._impRoamLastSwapAt ??= 0
      if (now - m._impRoamLastSwapAt < ROAM_SWAP_MS) continue
      m._impRoamLastSwapAt = now
      const pick = roamPool[Math.floor(Math.random() * roamPool.length)]
      const cx = pick.gridX + Math.floor(pick.width  / 2)
      const cy = pick.gridY + Math.floor(pick.height / 2)
      m.assignedRoomId = pick.instanceId
      m.homeTileX = cx
      m.homeTileY = cy
      // The base patrol AI will path the imp toward this new home; no
      // direct teleport needed.
    }
  }

  // ── WRAITH: Fear Meter + Haunting ──────────────────────────────────────

  _addFear(adv, amount) {
    if (this._archId() !== 'wraith') return
    if (!adv) return
    if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) return
    if (amount <= 0) return
    const cap = Balance.WRAITH_FEAR_MAX
    const before = adv._fear ?? 0
    adv._fear = Math.min(cap, before + amount)
    if (adv._fear !== before) {
      EventBus.emit('WRAITH_FEAR_CHANGED', {
        advId:  adv.instanceId,
        fear:   adv._fear,
        delta:  adv._fear - before,
      })
    }
  }

  _onTrapTriggered(payload) {
    if (this._archId() !== 'wraith') return
    const adv = payload?.adventurer
    if (!adv) return
    this._addFear(adv, Balance.WRAITH_FEAR_PER_TRAP_TRIGGERED)
  }

  _onMinionObserved(payload) {
    if (this._archId() !== 'wraith') return
    const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.advId)
    this._addFear(adv, Balance.WRAITH_FEAR_PER_MINION_SIGHTED)
  }

  // Corpse-seen fear bump fires when an adv enters a room that contains an
  // adventurer's body. AdventurerRenderer keeps dead adv sprites parked
  // until NIGHT_PHASE_STARTED, so room-change is the cleanest trigger.
  _onAdvRoomChanged(payload) {
    const archId = this._archId()
    if (archId === 'lich') this._lichOnAdvRoomChanged(payload)
    if (archId !== 'wraith') return
    const adv = payload?.adventurer
    const roomId = payload?.toRoomId
    if (!adv || !roomId) return
    const grid = this._scene?.dungeonGrid
    if (!grid) return
    const room = this._gameState?.dungeon?.rooms?.find(r => r.instanceId === roomId)
    if (!room) return
    const corpseHere = (this._gameState?.adventurers?.active ?? []).some(a => {
      if (!a || a === adv) return false
      if (a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0) return false
      const r = grid.getRoomAtTile?.(a.tileX, a.tileY)
      return r?.instanceId === roomId
    })
    if (corpseHere) this._addFear(adv, Balance.WRAITH_FEAR_PER_CORPSE_SEEN)
  }

  // LICH: when an adventurer walks into the phylactery's room, roll once
  // (LICH_PHYLACTERY_ROOM_FIND_CHANCE) to convert them into a hunter. Once
  // rolled (pass or fail) the adv is sticky — they won't keep rolling on
  // re-entry, so the chance stays meaningful instead of "eventually 100%
  // if they pace through enough." Spawn-time rolls remain independent.
  _lichOnAdvRoomChanged(payload) {
    const adv = payload?.adventurer
    const roomId = payload?.toRoomId
    if (!adv || !roomId) return
    const phyl = this._gameState?.phylactery
    if (!phyl || (phyl.resources?.hp ?? 0) <= 0) return
    if (phyl.roomId !== roomId) return
    if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) return
    if (adv._huntPhylactery) return
    if (adv._phylRoomRolled) return
    const t = adv.goal?.type
    if (t === 'HUNT_PHYLACTERY' || t === 'AT_BOSS' || t === 'CHARM_WALK' ||
        t === 'FLEE' || adv.aiState === 'fleeing' || adv.aiState === 'charmed') {
      return
    }
    adv._phylRoomRolled = true
    // Heart-life gate (2026-05-27, design refresh): the heart is
    // invisible-as-target until it has saved the boss once. Pre-revive,
    // an adventurer can walk through the heart's room without forming
    // any intent to attack it — they just take note (observation still
    // records it in adv.knowledge.items, so they'll act on it later if
    // the boss ever heart-revives during their lifetime). Post-revive,
    // every adv crossing the room commits, no roll. Replaces the prior
    // 20%-baseline LICH_PHYLACTERY_ROOM_FIND_CHANCE that leaked
    // pre-revive conversions.
    //
    // Same-day rest gate: also pause on `_diedThisDay` so the day of a
    // boss death/revive doesn't auto-convert anyone — the heart gets
    // its safe day before hunters mobilise again next morning.
    const boss = this._gameState?.boss
    const onHeartLife = !!boss?._onHeartLife
    if (!onHeartLife || boss?._diedThisDay) return
    adv._huntPhylactery = true
    adv.goalStack ??= []
    if (adv.goal) adv.goalStack.push(adv.goal)
    adv.goal = { type: 'HUNT_PHYLACTERY', roomId: phyl.roomId }
    adv.path = null
  }

  // Per-frame: react to fear thresholds + tick the friendly-fire window.
  _tickWraith() {
    if (this._archId() !== 'wraith') return
    const advs = this._gameState?.adventurers?.active ?? []
    const now = this._scene?.time?.now ?? 0
    const rooms = this._gameState?.dungeon?.rooms ?? []
    // -2 from each threshold per boss-lv beyond 1, clamped to floors so even
    // lv10 leaves panic-death at 80, friendly-fire at 55, flee at 30.
    const bossLv = this._gameState?.boss?.level ?? 1
    const reduction = Math.max(0, bossLv - 1) * Balance.WRAITH_FEAR_THRESHOLD_REDUCTION_PER_LV
    const fleeThresh = Math.max(30, Balance.WRAITH_FEAR_FLEE_THRESHOLD            - reduction)
    const ffThresh   = Math.max(55, Balance.WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD   - reduction)
    const pdThresh   = Math.max(80, Balance.WRAITH_FEAR_PANIC_DEATH_THRESHOLD     - reduction)
    for (const adv of advs) {
      if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const fear = adv._fear ?? 0
      // 50% (lv-scaled) — panic flee to a random non-entry room (one-shot).
      if (fear >= fleeThresh && !adv._fearFleeTriggered) {
        adv._fearFleeTriggered = true
        const candidates = rooms.filter(r =>
          r.definitionId !== 'entry_hall' && r.definitionId !== 'boss_chamber',
        )
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)]
          adv.goal = { type: 'EXPLORE_ROOM', roomId: pick.instanceId }
          adv.path = null
          EventBus.emit('WRAITH_FEAR_FLEE', { advId: adv.instanceId, roomId: pick.instanceId })
        }
      }
      // 75% — friendly-fire window. Single-shot per threshold crossing:
      // armed once when fear first hits 75, runs for FRIENDLY_FIRE_WINDOW_MS,
      // then clears so the adv resumes normal AI until they either hit 100%
      // panic-die or the run ends. _fearAttackArmed prevents re-arm.
      if (fear >= ffThresh) {
        if (!adv._fearAttackArmed) {
          adv._fearAttackArmed = true
          adv._fearAttackUntil = now + Balance.WRAITH_FEAR_FRIENDLY_FIRE_WINDOW_MS
          const party = adv.partyId
            ? advs.filter(a => a !== adv && a.partyId === adv.partyId && (a.resources?.hp ?? 0) > 0)
            : advs.filter(a => a !== adv && (a.resources?.hp ?? 0) > 0)
          if (party.length > 0) {
            const target = party[Math.floor(Math.random() * party.length)]
            adv.goal = { type: 'ATTACK_ALLY', allyId: target.instanceId, source: 'wraith_fear' }
            adv.path = null
            EventBus.emit('WRAITH_FRIENDLY_FIRE', { advId: adv.instanceId, targetId: target.instanceId })
          }
        } else if (adv._fearAttackUntil && now >= adv._fearAttackUntil &&
                   adv.goal?.type === 'ATTACK_ALLY' && adv.goal?.source === 'wraith_fear') {
          // Window expired — route back to a random non-entry, non-boss
          // room so the adv resumes wandering. AISystem._goalToTile reads
          // .type unguarded, so we hand it a valid goal rather than null.
          const rooms = this._gameState?.dungeon?.rooms ?? []
          const candidates = rooms.filter(r =>
            r.definitionId !== 'entry_hall' && r.definitionId !== 'boss_chamber',
          )
          if (candidates.length > 0) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)]
            adv.goal = { type: 'EXPLORE_ROOM', roomId: pick.instanceId }
          } else {
            adv.goal = { type: 'FLEE', reason: 'wraith_fear_window_ended' }
          }
          adv.path = null
        }
      }
      // 100% — instant panic death. Drop gold like a normal kill, no XP.
      if (fear >= pdThresh && !adv._fearPanicDeathTriggered) {
        adv._fearPanicDeathTriggered = true
        adv.resources.hp = 0
        this._gameState.player ??= {}
        this._gameState.player.gold = (this._gameState.player.gold ?? 0) + Balance.GOLD_PER_KILL
        EventBus.emit('RESOURCES_AWARDED', { gold: Balance.GOLD_PER_KILL, source: 'wraith_panic' })
        EventBus.emit('ADVENTURER_DIED', {
          adventurer: adv,
          killerId:   'fear',
          killerName: 'Fear',
          roomId:     this._scene?.dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)?.instanceId ?? null,
          damageType: 'fear',
          _noBossXp:  true,
        })
      }
    }
    // Move haunt ghosts (wall-phase) — runs every tick so they hunt smoothly.
    this._tickHauntGhosts(now)
  }

  // Spawn a free ghost2 at the death tile when the wraith is the active boss.
  _spawnHauntGhost(deadAdv, roomId) {
    if (this._archId() !== 'wraith') return
    if (!deadAdv) return
    // Hard cap on simultaneous haunts. Without it Wraith snowballs: every
    // adv kill stacks another permanent wall-phasing predator. New kills
    // past the cap simply don't spawn a ghost; a slot opens up when an
    // existing haunt dies (one-shot — see respawnAll filter).
    const liveHauntCount = (this._gameState?.minions ?? []).filter(m =>
      m._isHauntGhost && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0
    ).length
    // +0.5 max per boss-lv (lv10 = +5 → cap 10 ghosts).
    const _hauntBossLv = this._gameState?.boss?.level ?? 1
    const hauntCap = Balance.WRAITH_HAUNT_MAX_ACTIVE
      + Math.floor(_hauntBossLv * Balance.WRAITH_HAUNT_MAX_PER_BOSS_LV)
    if (liveHauntCount >= hauntCap) {
      EventBus.emit('WRAITH_HAUNT_CAPPED', {
        cap: hauntCap,
        advId: deadAdv.instanceId ?? null,
      })
      return
    }
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const ghostDef = minionTypes.find(m => m.id === 'ghost2')
    if (!ghostDef) return
    const bossLv = this._gameState?.boss?.level ?? 1
    // Resolve the haunt's home room — prefer the room of death; otherwise
    // grid-lookup at the death tile.
    const grid = this._scene?.dungeonGrid
    const homeRoomId = roomId
      ?? grid?.getRoomAtTile?.(deadAdv.tileX, deadAdv.tileY)?.instanceId
      ?? null
    const tx = deadAdv.tileX ?? 0
    const ty = deadAdv.tileY ?? 0
    const minion = createMinion(
      ghostDef,
      { x: tx, y: ty },
      homeRoomId,
      { class: 'garrison', bossLevel: bossLv },
    )
    minion._isHauntGhost   = true
    minion._hauntHomeRoomId = homeRoomId
    minion._hauntHomeTileX  = tx
    minion._hauntHomeTileY  = ty
    minion._hauntPhase      = 'home'   // 'home' | 'hunt' | 'return'
    minion.isSpectral       = true
    // bossLevel option already triggers applyBossLevelToMinion inside
    // createMinion — DO NOT call it a second time or stats double-scale.
    this._gameState.minions.push(minion)
    EventBus.emit('MINION_PLACED', { minion })
    EventBus.emit('WRAITH_HAUNT_SPAWNED', { minionId: minion.instanceId, roomId: homeRoomId })
  }

  // Haunt ghosts ignore pathfinding and walk directly through walls toward
  // the nearest detected adventurer in their spawn room or any directly-
  // connected adjacent room. When alone, they drift back to home tile.
  _tickHauntGhosts(now) {
    const minions = this._gameState?.minions ?? []
    if (minions.length === 0) return
    const advs = this._gameState?.adventurers?.active ?? []
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const lastTick = this._lastHauntTickAt ?? now
    const dt = Math.min(0.25, (now - lastTick) / 1000)   // clamp huge gaps
    this._lastHauntTickAt = now
    if (dt <= 0) return
    const speed = Balance.WRAITH_HAUNT_PHASE_SPEED_TILES_PER_SEC

    const TS = Balance.TILE_SIZE
    for (const m of minions) {
      if (!m._isHauntGhost) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const homeRoom = rooms.find(r => r.instanceId === m._hauntHomeRoomId)
      // Pick a target adv: any adv in spawn room or any adj-connected room.
      let target = null
      let bestD = Infinity
      for (const a of advs) {
        if (!a || (a.resources?.hp ?? 0) <= 0) continue
        const d = Math.hypot(a.tileX - m.tileX, a.tileY - m.tileY)
        if (d > Balance.WRAITH_HAUNT_DETECT_RANGE_TILES) continue
        if (d < bestD) { bestD = d; target = a }
      }
      let goal
      if (target) {
        goal = { x: target.tileX, y: target.tileY }
        m._hauntPhase = 'hunt'
        m.aiState = 'engaging'
      } else if (homeRoom) {
        goal = { x: m._hauntHomeTileX, y: m._hauntHomeTileY }
        const dHome = Math.hypot(m._hauntHomeTileX - m.tileX, m._hauntHomeTileY - m.tileY)
        m._hauntPhase = dHome > 0.5 ? 'return' : 'home'
        m.aiState = m._hauntPhase === 'home' ? 'idle' : 'walking'
      } else {
        continue
      }
      // Direct linear interpolation through walls.
      const dx = goal.x - m.tileX
      const dy = goal.y - m.tileY
      const dist = Math.hypot(dx, dy)
      if (dist <= 0.05) {
        m.tileX = goal.x; m.tileY = goal.y
      } else {
        const step = Math.min(dist, speed * dt)
        m.tileX += (dx / dist) * step
        m.tileY += (dy / dist) * step
      }
      m.worldX = m.tileX * TS + TS / 2
      m.worldY = m.tileY * TS + TS / 2
      // Engage if adjacent — let the existing combat system swing.
      if (target) {
        const inMelee = Math.hypot(target.tileX - m.tileX, target.tileY - m.tileY) <= 1.0
        if (inMelee) {
          this._scene?.combatSystem?.tryAttack?.(m, target)
        }
      }
    }
  }

  // Per-frame: damage advs in active spore rooms; apply corpse-touch venom.
  _tickMyconid(deltaMs) {
    if (this._archId() !== 'myconid') return
    // Animate the drifting spore particles + cloud puffs every frame.
    this._tickSporeVfx(deltaMs)
    const now = this._scene?.time?.now ?? 0
    const advs = this._gameState?.adventurers?.active ?? []
    const bossLv = this._gameState?.boss?.level ?? 1

    // Spore Network damage.
    const sporeIds = this._gameState?._myconid?.activeSporeRoomIds ?? []
    if (sporeIds.length > 0) {
      const rooms = this._gameState?.dungeon?.rooms ?? []
      const sporeRooms = rooms.filter(r => sporeIds.includes(r.instanceId))
      for (const adv of advs) {
        if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
        let inside = false
        for (const r of sporeRooms) {
          if (_advInsideRoom(adv, r)) { inside = true; break }
        }
        if (!inside) continue
        adv._sporeLastTickAt ??= 0
        if (now - adv._sporeLastTickAt < Balance.MYCONID_SPORE_TICK_INTERVAL_MS) continue
        adv._sporeLastTickAt = now
        // Switched to % maxHP per tick so spores keep biting through late-game
        // adv HP curves. MYCONID_SPORE_DMG_PER_BOSS_LV (above) is superseded
        // and left in place only for save / lookup compat.
        const dmg = Math.max(1, Math.floor((adv.resources?.maxHp ?? 0) * Balance.MYCONID_SPORE_DMG_PCT_PER_TICK))
        const before = adv.resources.hp
        adv.resources.hp = Math.max(0, before - dmg)
        EventBus.emit('COMBAT_HIT', {
          sourceId:   'spores',
          targetId:   adv.instanceId,
          damage:     dmg,
          damageType: 'poison',
        })
        if (adv.resources.hp <= 0) {
          EventBus.emit('ADVENTURER_DIED', {
            adventurer: adv,
            killerId:   'spores',
            killerName: 'Spore Cloud',
            roomId:     null,
            damageType: 'poison',
          })
        }
      }
    }

    // Corpse Bloom contact: each corpse that an adv hasn't already touched
    // adds MYCONID_CORPSE_VENOM_STACKS_ADDED to that adv's venom stack count
    // (which the existing _tickVenom pipeline ticks down per second).
    const corpses = this._gameState?.fungalCorpses ?? []
    if (corpses.length > 0) {
      for (const adv of advs) {
        if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
        adv._fungalCorpsesStung ??= []
        for (const c of corpses) {
          if (adv.tileX !== c.tileX || adv.tileY !== c.tileY) continue
          if (adv._fungalCorpsesStung.includes(c.instanceId)) continue
          adv._fungalCorpsesStung.push(c.instanceId)
          const wasClean = !adv._venomStacks
          adv._venomStacks = (adv._venomStacks ?? 0) + Balance.MYCONID_CORPSE_VENOM_STACKS_ADDED
          if (wasClean) {
            EventBus.emit('STATUS_APPLIED', { targetId: adv.instanceId, label: 'POISONED' })
          }
          EventBus.emit('MYCONID_CORPSE_TOUCHED', {
            advId:    adv.instanceId,
            corpseId: c.instanceId,
            stacks:   adv._venomStacks,
          })
        }
      }
    }
  }
}

// Adv-inside-room check. Adventurers carry tileX/tileY (per-tick AISystem
// updates). Rooms have gridX/gridY/width/height.
function _advInsideRoom(adv, room) {
  if (!adv || !room) return false
  const tx = adv.tileX, ty = adv.tileY
  if (typeof tx !== 'number' || typeof ty !== 'number') return false
  return tx >= room.gridX && tx <  room.gridX + room.width
      && ty >= room.gridY && ty <  room.gridY + room.height
}
