// KingdomModifierSystem — KR P4 (deep modifiers). Hosts the rule-bending
// signature mechanics that make each Kingdom Response feel UNIQUE, on top of the
// themed champion + retinue composition (which lives in DayPhase). One system
// owns the event/tick-driven modifier behaviours; the few that gate EXISTING
// systems (Inquisition pact-suppress, Betrayer trap-blackout) expose an
// `isActive(id)` helper those systems check.
//
// Gated behind the `acts` flag; Game.js only constructs it when acts are on.
// Built incrementally — one response's modifier at a time. See DESIGN.md →
// "Acts II & III — The Kingdom Responds" and the kr-response-* coverage rows.

import { EventBus } from './EventBus.js'
import { currentActResponseId } from '../config/acts.js'
import { Balance } from '../config/balance.js'
import { TILE } from './DungeonGrid.js'   // TILE is the tile-TYPE enum (FLOOR/WALL/…)
import { createMinion, applyMinionScaling } from '../entities/Minion.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'
import { PathfinderSystem } from './PathfinderSystem.js'   // A* — saboteur paths through halls, not walls

// Tile SIZE in px (32). NOT `TILE` — that's the type enum. Used for tile→world.
const TS = Balance.TILE_SIZE

// Ascension THRONE GUARD (KR P6 rebalance, 2026-06-02). Each ascension no longer
// fields an ever-growing swarm — instead the boss keeps a FIXED PAIR of its own
// kin that EVOLVE up their tier chain alongside it: Act II → 2 kin at T1, Act III
// → T2, Act IV → T3. The lines mirror minionEvolutions.json (chain[0..2]) so the
// tiers line up with the kill-evolution chain the player already knows. They
// garrison the boss chamber (no Barracks cap), are BOUND there (the player can't
// relocate them), and respawn at dawn at their current tier.
const GUARDIAN_KIN = {
  beholder:  ['beholder1', 'beholder2', 'beholder_tyrant'],
  demon:     ['demon1', 'demon2', 'demon_lord'],
  gnoll:     ['gnoll1', 'gnoll2', 'gnoll_alpha'],
  golem:     ['golem1', 'golem2', 'golem_warden'],
  lich:      ['lich1', 'lich2', 'elder_lich'],
  lizardman: ['lizardman1', 'lizardman2', 'serpent_captain'],
  myconid:   ['mushroom1', 'mushroom2', 'myconid_stalker'],
  orc:       ['orc1', 'orc2', 'orc_veteran'],
  slime:     ['slime3', 'slime7', 'slime8'],
  vampire:   ['vampire_minion1', 'vampire_minion2', 'vampire_sovereign'],
  wraith:    ['ghost1', 'ghost2', 'dark_wraith'],
  succubus:  ['imp1', 'imp2', 'imp3'],
  _default:  ['skeleton1', 'skeleton2', 'skeleton3'],
}
const GUARDIAN_COUNT = 2      // a fixed pair, every ascension
const GUARDIAN_BOOST = 1.5    // the throne guard hits ~50% harder than a normal kin of its tier

// Forlorn Hope — each fallen martyr stokes the survivors' fury. Per-death
// multipliers (compounding); a ~6-strong squad tops out around ×1.9 atk / ×1.5
// speed, so it ramps hard the longer you let the fight drag without ending it.
const FORLORN_ATK_PER_DEATH   = 1.12
const FORLORN_SPEED_PER_DEATH = 1.08
// When the captain (oath-binder) falls, the survivors' oath BREAKS: their fury
// collapses below baseline and they rout. The demoralize multiplier scales each
// survivor's pre-fury BASE stats (so it's independent of how high fury climbed).
const FORLORN_DEMORALIZE_MULT = 0.6
// Last Vow roar — the captain's death-save also super-charges the whole squad.
const FORLORN_LAST_VOW_STACKS = 3      // the roar instantly grants this many fury stacks
// Crimson fury ground-glow: base radius at 1 stack, grows with each stack.
const FORLORN_AURA_R          = 26
const FORLORN_AURA_R_PER_STACK = 5

// Mage Tower cadence (real-time ms while its act is active + a wave is present).
const MAGE_BLINK_INTERVAL  = 6500
const MAGE_SUMMON_INTERVAL = 8500
const MAGE_SUMMON_CAP      = 6     // live arcane constructs at once
// Mage Tower transmute — each COMBAT day, ~half your ability rooms are sealed
// (their special function disabled via the existing room.isActive gate, which the
// renderer already dims) and the pick RE-ROLLS the next day. Boss room excluded.
const MAGE_TRANSMUTE_FRACTION = 0.5
const MAGE_ABILITY_ROOM_CATS  = new Set(['special', 'combat', 'utility', 'trap'])
// Polymorph — Archmagus Velloran's signature: a minion is turned into a harmless
// critter (can't attack or move) for a few seconds, then poofs back.
const MAGE_POLY_MS = 5200
// Sabotage — the Turncoat's signature: briefly CHARMS one of your minions to fight
// for the raid (a temporary defection — reuses the faction='adventurer' handling
// the permanent defector already uses), then it snaps back to your side.
const SABOTAGE_MS = 6000
// Betrayer NIGHT-DASH intro — the strongest minion dashes trap-to-trap (2× speed),
// flips each, then exits via the entry and abandons you (removed, no respawn).
const BETRAYER_DASH_SPEED = 0.45   // px/ms — a fast, decisive dash

// Pantheon — a holy AURA around the angels (heal heroes / sear your minions) +
// the seraph resurrecting the fallen a limited number of times per raid.
const PANTHEON_AURA_INTERVAL  = 1500
const PANTHEON_AURA_RADIUS_PX = 96     // ~3 tiles (TILE=32)
const PANTHEON_RAISE_CAP      = 4
// Final Judgment (Aurelia's signature) — channel time before the row-wipe smite
// lands. If the Seraph is slain during the channel, judgment FIZZLES.
const JUDGMENT_CAST_MS        = 1500
const JUDGMENT_BAND_TILES     = 1.5    // ± this many tiles → the smitten "row"

// Inquisition — the holy law purges your undead minions while its act runs.
const INQUISITION_PURGE_INTERVAL = 2000

// Champion signature abilities (KR overhaul, 2026-06-03) — each act boss casts a
// powerful, telegraphed, themed signature on a cadence so it reads as a BOSS, not
// a buffed adventurer. First cast lands a few seconds after it arrives, then on a
// cooldown. Dispatched per response in _tickChampionAbility.
const CHAMP_ABILITY_FIRST_MS = 4500
const CHAMP_ABILITY_CD_MS    = 9000

// All-Stars — the 4 named heroes EACH fire their own signature on an independent
// cadence (a "deadly concert"), first-cast staggered so they don't all blast at
// once. Class → signature is fixed by the retinue (Garreth the knight has none).
const ALLSTAR_FIRST_MS = 3800
const ALLSTAR_CD_MS    = 7600
const ALLSTAR_STAGGER  = { stormcaller: 0, trueshot: 1100, shadowfax: 2200, aldous: 3300 }
// Reference only — the LIVE class→signature tagging lives in DayPhase's all_stars
// block (sets `_allStarSig`). Re-cast dream-team: necromancer=Soul Chain (stormcaller),
// monk=Hundred Fists (shadowfax), beast_master=Spear Volley (trueshot), templar=Holy
// Aegis (aldous). The signature KEYS are unchanged; only the heroes + labels are new.
const ALLSTAR_SIG_BY_CLASS = { necromancer: 'stormcaller', monk: 'shadowfax', beast_master: 'trueshot', templar: 'aldous' }

// Undead minion id patterns (skeleton/zombie/ghost/lich/wraith/…).
const _UNDEAD_RE = /ghost|lich|skelet|zombie|wraith|bone|undead|revenant|ghoul|vampire_sovereign/
function _isUndead(minion) {
  const id = (minion?.definitionId ?? minion?.type ?? minion?.typeId ?? '').toString().toLowerCase()
  return _UNDEAD_RE.test(id)
}

export class KingdomModifierSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs = gameState
    EventBus.on('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.on('FORLORN_LAST_VOW', this._onForlornLastVow, this)
    // Boss Ascension (KR P6) — when the act advances, the boss absorbs the
    // fallen kingdom's power and surges. We host the trigger here (already the
    // acts-gated modifier system with scene access to BossSystem); the sprite
    // swap is owned by BossRenderer, the cinematic by AscensionCinematic.
    EventBus.on('ACT_STARTED', this._onActStarted, this)
    // Mango dev — preview the ascension screen on demand (non-destructive).
    EventBus.on('DEV_TEST_ASCENSION', this._onDevTestAscension, this)
    // Plunderers (KR P5) — a fled thief absconds with a heist purse.
    EventBus.on('ADVENTURER_FLED', this._onAdventurerFled, this)
    // Mage Tower (KR overhaul) — room transmute: seal ~half your ability rooms
    // at the start of each combat day (gated on the mage_tower act), re-rolled
    // daily; restored at night so the build phase is clean.
    EventBus.on('DAY_PHASE_STARTED', this._onMageDayStart, this)
    EventBus.on('NIGHT_PHASE_STARTED', this._onMageNightStart, this)
    // Reckoning — Necrarch's grave-summon burst (graves erupt + risen dead claw up).
    EventBus.on('NECRARCH_SUMMON', this._onNecrarchSummon, this)
    // Betrayer — the night-phase sabotage dash (once per act, on the build phase).
    EventBus.on('NIGHT_PHASE_STARTED', this._onBetrayerNight, this)
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.off('FORLORN_LAST_VOW', this._onForlornLastVow, this)
    EventBus.off('DAY_PHASE_STARTED', this._onMageDayStart, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._onMageNightStart, this)
    EventBus.off('NECRARCH_SUMMON', this._onNecrarchSummon, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._onBetrayerNight, this)
    this._necrarchG?.destroy(); this._necrarchG = null
    this._mageRestoreRooms()
    this._mageSealG?.destroy(); this._mageSealG = null
    this._polyG?.destroy(); this._polyG = null
    EventBus.off('ACT_STARTED', this._onActStarted, this)
    EventBus.off('DEV_TEST_ASCENSION', this._onDevTestAscension, this)
    EventBus.off('ADVENTURER_FLED', this._onAdventurerFled, this)
    this._pantheonG?.destroy(); this._pantheonG = null
    this._allStarG?.destroy(); this._allStarG = null
    this._forlornG?.destroy(); this._forlornG = null
    this._forlornCounter?.destroy(); this._forlornCounter = null
    this._betrayerG?.destroy(); this._betrayerG = null
    this._sabotageG?.destroy(); this._sabotageG = null
    if (this._sabotageTags) { for (const t of this._sabotageTags.values()) t.destroy(); this._sabotageTags.clear() }
  }

  // Which Kingdom Response is governing the current act (or null). Act-wide
  // modifiers (Inquisition, Betrayer) gate on this; entity-behaviour modifiers
  // (Forlorn fury, etc.) self-gate on per-entity flags and don't need it.
  activeResponseId() {
    const act = this._gs.meta?.act?.current
    return act ? (this._gs.meta?.act?.responses?.[act] ?? null) : null
  }

  // True when `id`'s act-wide modifier should currently apply.
  isActive(id) {
    return this.activeResponseId() === id
  }

  // ── Boss Ascension trigger ──────────────────────────────────────────────────
  // The act just advanced (atRunStart === false). The boss ascends: its stat
  // surge is already baked into _recomputeBossFightStats (it derives the tier
  // from meta.act.current), so we force one recompute to apply it immediately,
  // capture the before/after for the cinematic readout, and emit BOSS_ASCENSION
  // for the renderer's sprite swap + the AscensionCinematic hero moment.
  _onActStarted({ act, atRunStart } = {}) {
    if (atRunStart || (act ?? 1) <= 1) return
    const boss = this._gs.boss
    const before = { hp: boss?.maxHp ?? 0, attack: boss?.attack ?? 0 }
    this._scene?.bossSystem?._recomputeBossFightStats?.()
    const after = { hp: boss?.maxHp ?? 0, attack: boss?.attack ?? 0 }
    EventBus.emit('BOSS_ASCENSION', {
      act,
      fromForm:  Math.max(1, act - 1),   // sprite tier it grew out of
      toForm:    act,                    // sprite tier it grew into
      archetype: this._gs.player?.bossArchetypeId ?? null,
      before, after,
    })
    // The throne guard answers: 2 of the boss's kin, evolved to this act's tier.
    this._ensureGuardians(act)
  }

  // Mango dev — fire a faithful ascension PREVIEW without advancing the act or
  // mutating the run: real archetype + form sprite, the current boss stats surged
  // by one ascension tier, and the throne-guard pair at this act's tier (names
  // only — nothing is deployed). `immediate` tells the cinematic to skip its
  // wait-for-reveal sequencing so it slams in the moment the button is clicked.
  _onDevTestAscension() {
    const gs = this._gs
    const boss = gs.boss ?? {}
    const arch = gs.player?.bossArchetypeId ?? 'beholder'
    const hpMul  = Balance.BOSS_ASCENSION_HP_MUL  ?? 1.28
    const atkMul = Balance.BOSS_ASCENSION_ATK_MUL ?? 1.20
    const before = { hp: boss.maxHp ?? 600, attack: boss.attack ?? 20 }
    const after  = { hp: Math.round(before.hp * hpMul), attack: Math.round(before.attack * atkMul) }
    const act    = Math.max(2, Math.min(4, gs.meta?.act?.current ?? 2))
    const tierIdx = act - 2

    // Throne-guard pair at this act's tier — names only, spawns nothing.
    const minionDefs = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const line     = GUARDIAN_KIN[arch] || GUARDIAN_KIN._default
    const targetId = line[Math.min(tierIdx, line.length - 1)]
    const name     = minionDefs.find(d => d.id === targetId)?.name || targetId
    const isElite  = tierIdx >= 2
    const members  = Array.from({ length: GUARDIAN_COUNT }, () => ({ name, elite: isElite }))

    // Reinforcements first so the cinematic folds them into the immediate reveal.
    EventBus.emit('BOSS_REINFORCEMENTS', { count: members.length, tier: tierIdx + 1, evolved: act > 2, elite: isElite, members })
    EventBus.emit('BOSS_ASCENSION', {
      act, fromForm: Math.max(1, act - 1), toForm: act, archetype: arch, before, after, immediate: true,
    })
  }

  // Re-field the throne guard at the ascension's tier. Drops the previous pair
  // (any tier, dead or alive) and spawns two fresh of the boss's kin at the
  // target tier (Act II→T1, III→T2, IV→T3) — the swap happens behind the
  // full-screen ascension cinematic, so it reads as "your kin evolved with you".
  // They're garrison class (no Barracks cap), `_ascGuardian`-tagged (so the
  // Roster REASSIGN flow refuses to move them), boss-room-homed, and the boost is
  // baked into the scaling base so it survives every dawn rescale / respawn.
  _ensureGuardians(act) {
    const gs = this._gs
    if (!Array.isArray(gs.minions)) return
    const tierIdx  = Math.max(0, Math.min(2, (act | 0) - 2))   // Act II→T1, III→T2, IV→T3
    const arch     = gs.player?.bossArchetypeId
    const line     = GUARDIAN_KIN[arch] || GUARDIAN_KIN._default
    const targetId = line[Math.min(tierIdx, line.length - 1)]
    const minionDefs = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const def = minionDefs.find(d => d.id === targetId)
    if (!def) return

    // Drop the old guard (mirrors respawnAll's array-replace pattern).
    gs.minions = gs.minions.filter(m => !m._ascGuardian)

    const tiles = this._guardianSpawnTiles()
    if (tiles.length === 0) return
    const bossRoom = gs.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    const bossLv   = gs.boss?.level ?? 1
    const day      = gs.meta?.dayNumber ?? 1
    const isElite  = tierIdx >= 2   // T3 = the elite / final kin form
    const members  = []
    for (let i = 0; i < GUARDIAN_COUNT && i < tiles.length; i++) {
      const tile = tiles[i]
      const m = createMinion(def, tile, bossRoom?.instanceId ?? null, { class: 'garrison' })
      m._ascGuardian        = true
      m._reinforcement      = true
      m._reinforcementElite = isElite
      m.homeTileX = tile.x
      m.homeTileY = tile.y
      // Bake the throne-guard boost into the scaling base so a later rescale /
      // dawn respawn keeps it (a raw resources.maxHp bump would be wiped).
      m._baseMaxHp = Math.round((def.baseStats?.hp     ?? m.resources.maxHp ?? 60) * GUARDIAN_BOOST)
      m._baseAtk   = Math.round((def.baseStats?.attack ?? m.stats.attack    ?? 10) * GUARDIAN_BOOST)
      applyMinionScaling(m, bossLv, day)
      m.resources.hp = m.resources.maxHp
      gs.minions.push(m)
      EventBus.emit('MINION_PLACED', { minion: m })
      members.push({ name: def.name || targetId, elite: isElite })
    }
    if (members.length) EventBus.emit('BOSS_REINFORCEMENTS', {
      count: members.length, tier: tierIdx + 1, evolved: (act | 0) > 2, elite: isElite, members,
    })
  }

  // The ascension throne guard flanks the boss: one kin on the WEST side, one on
  // the EAST, both at the chamber's vertical centre — so the pair reads as an
  // honour guard rather than bunching at the bottom (the old ring-scan dropped
  // both below the throne). Snaps each ideal point to the nearest free FLOOR
  // tile; falls back to the ring-scan for any slot it can't place.
  _guardianSpawnTiles() {
    const grid = this._scene?.dungeonGrid
    const gs = this._gs
    const bossRoom = gs?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom || typeof grid?.getTileType !== 'function') return this._chamberSpawnTiles(GUARDIAN_COUNT)
    const cx  = bossRoom.gridX + Math.floor(bossRoom.width  / 2)
    const cy  = bossRoom.gridY + Math.floor(bossRoom.height / 2)   // vertical centre
    const off = Math.max(2, Math.round(bossRoom.width * 0.28))     // how far out to each side
    const occupied = (tx, ty) => (gs.minions ?? []).some(m =>
      m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && m.tileX === tx && m.tileY === ty)
    const free = (tx, ty, taken) => {
      const t = grid.getTileType(tx, ty)
      return (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) && !occupied(tx, ty) && !taken.has(`${tx},${ty}`)
    }
    // Nearest free floor to an ideal point (expanding ring out to r=4).
    const snap = (ix, iy, taken) => {
      for (let r = 0; r <= 4; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const tx = ix + dx, ty = iy + dy
          if (free(tx, ty, taken)) return { x: tx, y: ty }
        }
      }
      return null
    }
    const taken = new Set()
    const out = []
    for (const ix of [cx - off, cx + off]) {   // west first, then east
      const t = snap(ix, cy, taken)
      if (t) { out.push(t); taken.add(`${t.x},${t.y}`) }
    }
    // Backfill any missing slot from the generic ring-scan.
    if (out.length < GUARDIAN_COUNT) {
      for (const t of this._chamberSpawnTiles(GUARDIAN_COUNT)) {
        if (out.length >= GUARDIAN_COUNT) break
        if (!taken.has(`${t.x},${t.y}`)) { out.push(t); taken.add(`${t.x},${t.y}`) }
      }
    }
    return out
  }

  // Collect up to `count` free FLOOR/BOSS_FLOOR tiles, ringing outward from the
  // boss (or chamber centre), skipping tiles a live minion already stands on.
  _chamberSpawnTiles(count) {
    const grid = this._scene?.dungeonGrid
    const gs = this._gs
    const bossRoom = gs?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    const boss = gs?.boss
    const ax = Number.isFinite(boss?.tileX) ? boss.tileX
      : (bossRoom ? bossRoom.gridX + Math.floor(bossRoom.width / 2) : null)
    const ay = Number.isFinite(boss?.tileY) ? boss.tileY
      : (bossRoom ? bossRoom.gridY + Math.floor(bossRoom.height / 2) : null)
    if (ax == null || ay == null || typeof grid?.getTileType !== 'function') return []
    const occupied = (tx, ty) => (gs.minions ?? []).some(m =>
      m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && m.tileX === tx && m.tileY === ty)
    const out = []
    const taken = new Set()
    for (let r = 1; r <= 4 && out.length < count; r++) {
      for (let dy = -r; dy <= r && out.length < count; dy++) {
        for (let dx = -r; dx <= r && out.length < count; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue   // ring perimeter only
          const tx = ax + dx, ty = ay + dy
          const key = `${tx},${ty}`
          if (taken.has(key)) continue
          const t = grid.getTileType(tx, ty)
          if ((t === TILE.FLOOR || t === TILE.BOSS_FLOOR) && !occupied(tx, ty)) {
            out.push({ x: tx, y: ty }); taken.add(key)
          }
        }
      }
    }
    return out
  }

  // Dark-ascension chamber aura — once the boss has ascended (act II+), it
  // radiates the absorbed power: adventurers caught near it in the chamber are
  // seared each pulse, the damage scaling with the ascension tier + boss level.
  // Modelled on _tickPantheonAura but targeting the invaders around the boss.
  _tickAscensionAura() {
    const tier = Math.max(0, (this._gs.meta?.act?.current ?? 1) - 1)
    if (tier <= 0) return
    const now = this._scene?.time?.now ?? 0
    const interval = Balance.BOSS_ASCENSION_AURA_INTERVAL ?? 1200
    if (!now || now - (this._ascAuraAt ?? 0) < interval) return
    this._ascAuraAt = now
    const boss = this._gs.boss
    if (!boss || (boss.hp ?? 0) <= 0) return
    const lv  = boss.level ?? 1
    const dmg = Math.max(1, Math.round(
      ((Balance.BOSS_ASCENSION_AURA_BASE ?? 5) + lv * (Balance.BOSS_ASCENSION_AURA_PER_LEVEL ?? 1.5)) * tier))
    const R   = Balance.BOSS_ASCENSION_AURA_RADIUS_PX ?? 132
    const R2  = R * R
    let seared = 0
    for (const a of (this._gs.adventurers?.active ?? [])) {
      if (a._monster && a._arcaneConstruct) continue   // don't sear your own summons
      if ((a.resources?.hp ?? 0) <= 0) continue
      const dx = (a.worldX ?? 0) - (boss.worldX ?? 0)
      const dy = (a.worldY ?? 0) - (boss.worldY ?? 0)
      if (dx * dx + dy * dy <= R2) {
        // Plot-armored scouts (Aldric, and the duel-bound event raiders) floor at
        // 10% — the aura sears Aldric while he recoils at the throne, but can't
        // finish him (he only dies in the Act IV duel).
        const fl = (a._nemesis || a._shadowMonarch || a._lightParty)
          ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.10)) : 0
        a.resources.hp = Math.max(fl, a.resources.hp - dmg); seared++
      }
    }
    if (seared) EventBus.emit('BOSS_ASCENSION_AURA', { seared, tier, dmg })
  }

  // ── per-frame tick (day phase only; wired in Game.update) ───────────────────
  update(_dt) {
    const resp = currentActResponseId(this._gs)
    const wave = (this._gs.adventurers?.active?.length ?? 0) > 0
    if (!wave) {
      this._pantheonG?.clear(); this._allStarG?.clear(); this._forlornG?.clear()
      this._forlornCounter?.setVisible(false)
      this._mageSealG?.clear(); this._polyG?.clear(); this._betrayerG?.clear(); this._sabotageG?.clear(); this._necrarchG?.clear()
      if (this._polyTags) for (const t of this._polyTags.values()) t.setVisible(false)
      if (this._sabotageTags) for (const t of this._sabotageTags.values()) t.setVisible(false)
      return
    }
    // Boss ascension dark aura — present in every ascended act (II+), regardless
    // of which Kingdom Response governs it. The dungeon radiates absorbed power.
    this._tickAscensionAura()
    // Mage Tower — reality-warping magic while its act runs.
    if (resp === 'mage_tower') this._tickMageTower()
    // Pantheon — the angels' holy aura pulses (mechanic) + the consecrated-ground
    // VFX renders every frame so the heal/sear radius is visible.
    else if (resp === 'pantheon') { this._tickPantheonAura(); this._tickPantheonAuraVfx() }
    // Inquisition — the holy law purges your undead minions.
    else if (resp === 'inquisition') this._tickInquisitionPurge()
    // Plunderers — the thieves pickpocket your treasury each pulse.
    else if (resp === 'plunderers') this._tickPlunderers()
    // Forlorn Hope — the martyrs' crimson fury aura glows + the fury counter
    // floats over the squad, both scaling with how many have fallen.
    else if (resp === 'forlorn_hope') this._tickForlornVfx()
    // Betrayer — your traps are flipped against you; mark each with a green ⇄.
    else if (resp === 'betrayer') this._tickBetrayerVfx()
    // Champion signature ability — the act boss's telegraphed boss move on cadence.
    this._tickChampionAbility(resp)
    // All-Stars — the crown VFX + the 4 heroes' signatures ride on the UNITS
    // (self-gating on _allStar / _allStarSig), so they also fire for a dev-spawned
    // raid card (which doesn't set the act response). No resp gate here.
    this._tickAllStarsVfx()
    this._tickAllStarAbilities()
    // Sabotage charm indicator rides on the minion flag (fires via the Betrayer
    // champion, which works regardless of the ambient act) — self-gating.
    this._tickSabotageVfx()
    // Necrarch's standing aura rides on the `_necrarch` unit (self-gating), so it
    // shows for a dev-summoned Necrarch too.
    this._tickNecrarchAura()
    // World-VFX Graphics cleanup — clear any whose response isn't governing now
    // (kept OUT of the else-chain so a lingering buffer can't swallow a tick).
    if (resp !== 'pantheon'  && this._pantheonG) this._pantheonG.clear()
    if (resp !== 'forlorn_hope' && this._forlornG) { this._forlornG.clear(); this._forlornCounter?.setVisible(false) }
    if (resp !== 'betrayer' && this._betrayerG) this._betrayerG.clear()
    if (resp !== 'mage_tower' && this._mageSealG) this._mageSealG.clear()
    if (resp !== 'mage_tower' && this._polyG) {
      this._polyG.clear()
      if (this._polyTags) for (const t of this._polyTags.values()) t.setVisible(false)
    }
  }

  // ── Plunderers (KR P5 response) ─────────────────────────────────────────────
  // Thieves drain GOLD, not HP — the only economic threat in the pool. Drains
  // are a % of the current treasury (rob the rich proportionally) with a flat
  // floor; killing a thief stops its bleed, but one that ESCAPES makes off with
  // a fat heist purse (_onAdventurerFled). TopBar polls player.gold, so the
  // treasury number visibly drops — no extra event needed for the HUD.
  _drainGold(amount) {
    const p = this._gs.player
    if (!p) return 0
    const before = p.gold ?? 0
    const taken = Math.min(before, Math.max(0, Math.round(amount)))
    if (taken <= 0) return 0
    p.gold = before - taken
    const meta = this._gs.meta
    if (meta?.act) meta.act._plunderStolen = (meta.act._plunderStolen ?? 0) + taken
    return taken
  }

  _tickPlunderers() {
    const now = this._scene?.time?.now ?? 0
    const interval = Balance.PLUNDER_PICKPOCKET_INTERVAL ?? 2000
    if (!now || now - (this._plunderAt ?? 0) < interval) return
    this._plunderAt = now
    const gold = this._gs.player?.gold ?? 0
    if (gold <= 0) return
    const thiefList = (this._gs.adventurers?.active ?? [])
      .filter(a => a.flags?.plundererThief && (a.resources?.hp ?? 0) > 0)
    if (thiefList.length === 0) return
    const per = Math.max(Balance.PLUNDER_PICKPOCKET_MIN ?? 2,
      Math.floor(gold * (Balance.PLUNDER_PICKPOCKET_PCT ?? 0.004)))
    const taken = this._drainGold(per * thiefList.length)
    if (taken > 0) {
      EventBus.emit('PLUNDER_PICKPOCKET', { taken, thieves: thiefList.length })
      // Coins flit up off each thief as it pockets your gold (capped so a big
      // crew doesn't spam). CoinBurstRenderer draws the steal burst + "−Xg".
      for (const th of thiefList.slice(0, 6)) {
        EventBus.emit('PLUNDER_DRAIN_VFX', { x: th.worldX, y: th.worldY, gold: per })
      }
    }
  }

  _onAdventurerFled({ adventurer } = {}) {
    if (!adventurer?.flags?.plundererThief) return
    const gold = this._gs.player?.gold ?? 0
    const heist = Math.max(Balance.PLUNDER_ESCAPE_MIN ?? 20,
      Math.floor(gold * (Balance.PLUNDER_ESCAPE_PCT ?? 0.03)))
    const taken = this._drainGold(heist)
    if (taken > 0) EventBus.emit('PLUNDER_ESCAPE', { name: adventurer.name, taken })
  }

  // ── Champion signature abilities (one boss move per act boss) ────────────────
  // Finds the live act champion and fires its themed signature on a cadence (first
  // cast ~CHAMP_ABILITY_FIRST_MS after it appears, then every CHAMP_ABILITY_CD_MS).
  // Each signature telegraphs, then resolves with VFX — so the boss reads as a
  // BOSS. New champions plug a `case` into the dispatch below.
  _tickChampionAbility(resp) {
    const champ = (this._gs.adventurers?.active ?? []).find(a =>
      a._kingdomChampion && (a.resources?.hp ?? 0) > 0)
    if (!champ) { this._champSeenAt = null; this._champAbilityAt = 0; return }
    const now = this._scene?.time?.now ?? 0
    // Dev sandbox (window.__qfDev.fastAbilities) collapses the cadence so a cast
    // is easy to screenshot; production cadence otherwise.
    const _fast = globalThis.__qfDevFastAbilities
    if (this._champSeenAt == null) { this._champSeenAt = now; this._champAbilityAt = now + (_fast ? 600 : CHAMP_ABILITY_FIRST_MS) }
    if (now < (this._champAbilityAt ?? 0)) return
    this._champAbilityAt = now + (_fast ? 2500 : CHAMP_ABILITY_CD_MS)
    // Dispatch on the CHAMPION's own response, not the ambient act response — so a
    // dev-spawned raid (which doesn't set meta.act.responses) still fires the right
    // signature. In a real act the two are identical.
    const sig = champ._championResponseId || resp
    switch (sig) {
      case 'plunderers':  this._champGrandHeist(champ);    break
      case 'inquisition': this._champExcommunicate(champ); break
      case 'mage_tower':  this._champPolymorph(champ);     break
      case 'pantheon':    this._champFinalJudgment(champ); break
      case 'betrayer':    this._champSabotage(champ);      break
      case 'reckoning_dead': this._champReanimate(champ);  break
      // (other champions' signatures added per response slice)
    }
  }

  // Plunderers — GRAND HEIST: the captain grabs a fat purse from your vault AND
  // calls a CANNON VOLLEY — telegraphed landing zones on up to 3 of your minions,
  // then flaming cannonballs arc down in a staggered barrage (each meteor impacts
  // with a shockwave + sparks + a scorch crater; the hit lands on impact).
  _champGrandHeist(champ) {
    const sc = this._scene
    const gold = this._gs.player?.gold ?? 0
    const grab = this._drainGold(Math.max(40, Math.floor(gold * 0.08)))
    const live = (this._gs.minions ?? []).filter(m => (m.resources?.hp ?? 0) > 0)
    for (let i = live.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [live[i], live[j]] = [live[j], live[i]] }
    const targets = live.slice(0, 3)
    const dmg = 12 + Math.round((this._gs.boss?.level ?? 1) * 4)
    for (const m of targets) AbilityVfx.groundTelegraph?.(sc, m.worldX, m.worldY, { color: 0xff4a1a, radius: 26, shape: 'circle', durationMs: 760 })
    EventBus.emit('CHAMPION_ABILITY', { responseId: 'plunderers', name: 'GRAND HEIST', champion: champ?.name, gold: grab })
    sc?.time?.delayedCall?.(760, () => {
      targets.forEach((m, i) => {
        const mx = m.worldX, my = m.worldY
        sc?.time?.delayedCall?.(i * 110, () => {
          AbilityVfx.meteor?.(sc, mx, my, {
            color: 0xff7a2a, fallMs: 360, fromDX: 110 - i * 70, fromDY: -330,
            onImpact: () => {
              if ((m.resources?.hp ?? 0) > 0) m.resources.hp = Math.max(0, m.resources.hp - dmg)
              AbilityVfx.crater?.(sc, mx, my, { color: 0x3a2410, radius: 20 })
            },
          })
        })
      })
      AbilityVfx.screenFlash?.(sc, { color: 0xffae4a, intensity: 0.32, durationMs: 240 })
      sc?.cameras?.main?.shake?.(300, 0.009)
    })
  }

  // A beautiful holy light column descending on (x,y): a bright pillar + radiant
  // god-rays + holy motes, with a ground sigil + sunburst on the BIG (Excommunicate)
  // variant. Used by the Inquisition purge (light) + Excommunicate (big).
  _holyLightColumn(x, y, { big = false } = {}) {
    const sc = this._scene
    if (!sc) return
    // VFX toolkit (2026-06-05): a glowing descending light column built on GPU
    // particles + additive + Glow post-FX, vs the old hand-drawn beamPillar/godRays.
    const w = big ? 30 : 16
    // descending holy beam column (from high above onto the target)
    AbilityVfx.beamFx?.(sc, x, y - 340, x, y, { color: 0xfff3c4, width: w, durationMs: big ? 760 : 500, depth: 9, sparks: big ? 14 : 8 })
    // radiant god-rays (complementary; no toolkit equivalent yet)
    AbilityVfx.godRays?.(sc, x, y, { color: 0xfff8d8, count: big ? 18 : 9, length: big ? 150 : 64, durationMs: big ? 1000 : 560 })
    // bright holy impact burst at the base + expanding shockring(s) + rising motes
    AbilityVfx.impactFx?.(sc, x, y, { palette: 'holy', count: big ? 30 : 16, durationMs: big ? 460 : 320, depth: 10 })
    AbilityVfx.shockwaveFx?.(sc, x, y, { palette: 'holy', toR: big ? 130 : 72, rings: big ? 2 : 1, durationMs: big ? 600 : 440, depth: 9 })
    AbilityVfx.burnFx?.(sc, x, y, { palette: 'holy', durationMs: big ? 680 : 440, rise: 95, spread: w, depth: 9 })
    if (big) AbilityVfx.glowPulseFx?.(sc, x, y, { palette: 'holy', r: 58, durationMs: 900, depth: 8 })
  }

  // Inquisition — EXCOMMUNICATE: a pillar of holy fire from the heavens vaporizes
  // your strongest UNDEAD (or, if none, your strongest minion of any type). Charge
  // tell -> big holy column -> the target is unmade. (Pact-suppression is the
  // act-wide half of the gimmick; this is the boss's hard, single-target smite.)
  _champExcommunicate(champ) {
    const sc = this._scene
    const live = (this._gs.minions ?? []).filter(m => (m.resources?.hp ?? 0) > 0)
    if (!live.length) return
    const undead = live.filter(_isUndead)
    const pool = undead.length ? undead : live
    let target = null, best = -Infinity
    for (const m of pool) {
      const v = (m.resources?.maxHp ?? 0) + (m.stats?.attack ?? 0) * 5
      if (v > best) { best = v; target = m }
    }
    if (!target) return
    const tx = target.worldX, ty = target.worldY
    EventBus.emit('CHAMPION_ABILITY', { responseId: 'inquisition', name: 'EXCOMMUNICATE', champion: champ?.name })
    AbilityVfx.chargeUp?.(sc, tx, ty, { color: 0xfff3c4, count: 16, radius: 72, durationMs: 620 })
    AbilityVfx.magicCircle?.(sc, tx, ty, { color: 0xffe08a, radius: 48, durationMs: 1000 })
    sc?.time?.delayedCall?.(620, () => {
      this._holyLightColumn(tx, ty, { big: true })
      AbilityVfx.screenFlash?.(sc, { color: 0xfff3c4, intensity: 0.42, durationMs: 300 })
      sc?.cameras?.main?.shake?.(260, 0.008)
      if ((target.resources?.hp ?? 0) > 0) target.resources.hp = 0   // unmade by holy fire
    })
  }

  // Inquisition undead purge — every ~2s your undead minions take holy purge
  // damage (MinionAISystem handles the kill at hp<=0). The act-wide pact-benefit
  // suppression is the other half — see DESIGN_COVERAGE kr-response-inquisition.
  _tickInquisitionPurge() {
    const now = this._scene?.time?.now ?? 0
    if (!now || now - (this._purgeAt ?? 0) < INQUISITION_PURGE_INTERVAL) return
    this._purgeAt = now
    const dmg = 10 + Math.round((this._gs.boss?.level ?? 1) * 3)
    const hit = []
    for (const m of (this._gs.minions ?? [])) {
      if ((m.resources?.hp ?? 0) <= 0) continue
      if (_isUndead(m)) { m.resources.hp -= dmg; hit.push(m) }
    }
    if (hit.length) {
      EventBus.emit('INQUISITION_PURGE', { purged: hit.length })
      // Holy light sears each undead each pulse (capped so a big undead army
      // doesn't flood the frame with beams).
      for (const m of hit.slice(0, 5)) this._holyLightColumn(m.worldX, m.worldY)
    }
  }

  // Pantheon holy aura — every ~1.5s the angels heal nearby kingdom heroes and
  // sear nearby player minions (holy ground, as a radius aura). MinionAISystem
  // handles a seared minion's death once its hp drops to 0.
  _tickPantheonAura() {
    const now = this._scene?.time?.now ?? 0
    if (!now || now - (this._pantheonAuraAt ?? 0) < PANTHEON_AURA_INTERVAL) return
    this._pantheonAuraAt = now
    const advs = this._gs.adventurers?.active ?? []
    const angels = advs.filter(a => a.flags?.pantheonHero && (a.resources?.hp ?? 0) > 0)
    if (angels.length === 0) return
    const lv = this._gs.boss?.level ?? 1
    const heal = 4 + lv * 2
    const sear = 6 + Math.round(lv * 2.5)
    const R2 = PANTHEON_AURA_RADIUS_PX * PANTHEON_AURA_RADIUS_PX
    const near = (a, b) => {
      const dx = (a.worldX ?? 0) - (b.worldX ?? 0), dy = (a.worldY ?? 0) - (b.worldY ?? 0)
      return dx * dx + dy * dy <= R2
    }
    let healed = 0, seared = 0
    for (const hHero of advs) {
      if (hHero._monster) continue
      const r = hHero.resources
      if (!r || r.hp <= 0 || r.hp >= r.maxHp) continue
      if (angels.some(an => near(an, hHero))) { r.hp = Math.min(r.maxHp, r.hp + heal); healed++ }
    }
    for (const m of (this._gs.minions ?? [])) {
      if ((m.resources?.hp ?? 0) <= 0) continue
      if (angels.some(an => near(an, m))) { m.resources.hp -= sear; seared++ }
    }
    if (healed || seared) EventBus.emit('PANTHEON_AURA', { healed, seared })
  }

  // Pantheon holy-ground VISUAL (KR polish) — a radiant consecrated zone painted
  // on the floor beneath each angel, so the heal/sear radius is SEEN, not just
  // logged. Per-frame canvas draw (Graphics, never an infinite CSS anim → safe
  // for preview_screenshot): layered golden ground-glow + a breathing boundary
  // ring + slowly-rotating light spokes + twinkling motes. Cleared when no angel
  // is present (day end / all angels down). Depth 1.6 = on the floor, under the
  // entities (it's holy GROUND).
  _tickPantheonAuraVfx() {
    const angels = (this._gs.adventurers?.active ?? [])
      .filter(a => a.flags?.pantheonHero && (a.resources?.hp ?? 0) > 0)
    if (angels.length === 0) { this._pantheonG?.clear(); return }
    const g = this._pantheonG ?? (this._pantheonG = this._scene.add.graphics().setDepth(1.6))
    g.clear()
    const now = this._scene.time?.now ?? 0
    const R = PANTHEON_AURA_RADIUS_PX
    const pulse = 0.5 + 0.5 * Math.sin(now / 420)            // 0..1 breathe
    const rot   = now / 2200
    for (const an of angels) {
      const x = an.worldX ?? 0, y = an.worldY ?? 0
      // Soft golden ground-glow — concentric fills, outer→inner rising alpha.
      const layers = [[1.04, 0.05], [0.8, 0.08], [0.55, 0.12], [0.3, 0.2], [0.14, 0.28]]
      for (const [f, a] of layers) { g.fillStyle(0xffe08a, a * (0.72 + 0.28 * pulse)); g.fillCircle(x, y, R * f) }
      // Slowly-rotating light spokes (god-ray fan).
      g.lineStyle(2, 0xfff8d8, 0.16 + 0.16 * pulse)
      for (let i = 0; i < 8; i++) {
        const ang = rot + i * (Math.PI / 4)
        g.beginPath()
        g.moveTo(x + Math.cos(ang) * R * 0.28, y + Math.sin(ang) * R * 0.28)
        g.lineTo(x + Math.cos(ang) * R * 0.96, y + Math.sin(ang) * R * 0.96)
        g.strokePath()
      }
      // Breathing boundary ring (the edge of consecrated ground).
      g.lineStyle(2.5, 0xfff3c4, 0.3 + 0.45 * pulse)
      g.strokeCircle(x, y, R * (0.9 + 0.07 * pulse))
      // Twinkling motes — phase-offset sparkles at fixed angular slots (no
      // per-mote lifecycle; the offsets give a "living" shimmer cheaply).
      for (let i = 0; i < 6; i++) {
        const ph = now / 300 + i * 1.7
        const tw = 0.5 + 0.5 * Math.sin(ph)
        if (tw < 0.35) continue
        const ma = i * 2.39996 + rot * 0.6                  // golden-angle spread
        const mr = R * (0.35 + 0.5 * ((i * 0.37) % 1))
        const mx = x + Math.cos(ma) * mr, my = y + Math.sin(ma) * mr - 4
        g.fillStyle(0xfffbe6, 0.5 * tw)
        g.fillCircle(mx, my, 1.6 + tw)
      }
    }
  }

  // All-Stars bespoke VFX (KR polish) — the Champions' League reads as generic
  // adventurers in-world otherwise. Crown each assembled champion with a twinkling
  // golden STAR floating over their head (halo + sparkle-cross), and thread golden
  // SYNERGY LINKS between nearby champions (the "deadly concert" — they fight in
  // concert). Per-frame canvas draw at depth 9 (above the entities), cleared when
  // no star remains. Palette matches the response accent (#ffd76a) + the ★ emblem.
  _tickAllStarsVfx() {
    const stars = (this._gs.adventurers?.active ?? [])
      .filter(a => a._allStar && (a.resources?.hp ?? 0) > 0)
    if (stars.length === 0) { this._allStarG?.clear(); return }
    const g = this._allStarG ?? (this._allStarG = this._scene.add.graphics().setDepth(9))
    g.clear()
    const now = this._scene.time?.now ?? 0
    const GOLD = 0xffd76a, WHITE = 0xfff6d8
    // Synergy links — golden threads between champions within range, flowing.
    const LINK_R = 180
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const a = stars[i], b = stars[j]
        const dx = (a.worldX ?? 0) - (b.worldX ?? 0), dy = (a.worldY ?? 0) - (b.worldY ?? 0)
        const d = Math.hypot(dx, dy)
        if (d > LINK_R || d < 1) continue
        const fade = 1 - d / LINK_R
        const flow = 0.55 + 0.45 * Math.sin(now / 280 + (i + j) * 0.9)
        g.lineStyle(1.5, GOLD, 0.36 * fade * flow)
        g.beginPath(); g.moveTo(a.worldX, (a.worldY ?? 0) - 18); g.lineTo(b.worldX, (b.worldY ?? 0) - 18); g.strokePath()
      }
    }
    // Per-champion floating star — halo + 5-point star + sparkle-cross, twinkling.
    for (let k = 0; k < stars.length; k++) {
      const s = stars[k]
      const x = s.worldX ?? 0, y = (s.worldY ?? 0) - 42
      const tw = 0.6 + 0.4 * Math.sin(now / 360 + k * 1.3)
      g.fillStyle(GOLD, 0.28 * tw); g.fillCircle(x, y, 12)
      g.fillStyle(GOLD, 0.46 * tw); g.fillCircle(x, y, 6.5)
      this._drawStar(g, x, y, 7.5 * tw, 3.2 * tw, WHITE, 0.7 + 0.3 * tw)
      g.lineStyle(1, WHITE, 0.45 * tw)
      g.beginPath()
      g.moveTo(x - 10 * tw, y); g.lineTo(x + 10 * tw, y)
      g.moveTo(x, y - 10 * tw); g.lineTo(x, y + 10 * tw)
      g.strokePath()
    }
  }

  // Filled 5-point star centered at (cx,cy), point-up.
  _drawStar(g, cx, cy, outer, inner, color, alpha) {
    g.fillStyle(color, alpha)
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 === 0) ? outer : inner
      const a = -Math.PI / 2 + i * (Math.PI / 5)
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py)
    }
    g.closePath(); g.fillPath()
  }

  // ── All-Stars signatures (one per named hero, independent cadences) ──────────
  // Each live `_allStarSig` hero fires its own move; first casts are staggered so
  // the squad reads as a coordinated concert, not a synchronized nuke.
  _tickAllStarAbilities() {
    const now = this._scene?.time?.now ?? 0
    if (!now) return
    const _fast = globalThis.__qfDevFastAbilities
    const stars = (this._gs.adventurers?.active ?? []).filter(a => a._allStarSig && (a.resources?.hp ?? 0) > 0)
    for (const s of stars) {
      if (s._allStarAbilityAt == null) {
        s._allStarAbilityAt = now + (_fast ? 400 : ALLSTAR_FIRST_MS) + (_fast ? 0 : (ALLSTAR_STAGGER[s._allStarSig] ?? 0))
      }
      if (now < s._allStarAbilityAt) continue
      s._allStarAbilityAt = now + (_fast ? 2200 : ALLSTAR_CD_MS)
      switch (s._allStarSig) {
        case 'stormcaller': this._asStormcaller(s); break
        case 'trueshot':    this._asTrueshot(s);    break
        case 'aldous':      this._asAldous(s);      break
        case 'shadowfax':   this._asShadowfax(s);   break
      }
    }
  }

  _bossLv() { return this._gs.boss?.level ?? 1 }
  _liveMinions() { return (this._gs.minions ?? []).filter(m => (m.resources?.hp ?? 0) > 0) }
  _emitAllStar(hero, move, name, hit) {
    EventBus.emit('CHAMPION_ABILITY', { responseId: 'all_stars', name, champion: hero?.name })
    EventBus.emit('ALLSTAR_ABILITY', { hero: hero?.name, move, hit })
  }
  // Perpendicular distance from point (px,py) to the segment (x1,y1)-(x2,y2).
  _distToLine(x1, y1, x2, y2, px, py) {
    const dx = x2 - x1, dy = y2 - y1
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return Math.hypot(px - x1, py - y1)
    let t = ((px - x1) * dx + (py - y1) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
  }

  // Mortessa the Soulbinder (necromancer) — SOUL CHAIN: a violet death-arc leaps
  // from her through up to 4 nearest minions, chaining soul-to-soul with falloff.
  // (Mechanic kept from the old "chain lightning"; re-skinned amethyst.)
  _asStormcaller(hero) {
    const sc = this._scene
    const pool = this._liveMinions()
    if (!pool.length) return
    let from = { x: hero.worldX ?? 0, y: hero.worldY ?? 0 }
    const base = 14 + Math.round(this._bossLv() * 4)
    const hops = Math.min(4, pool.length)
    const hit = []
    for (let i = 0; i < hops; i++) {
      let best = null, bd = Infinity
      for (const m of pool) {
        if (hit.includes(m)) continue
        const d = Math.hypot((m.worldX ?? 0) - from.x, (m.worldY ?? 0) - from.y)
        if (d < bd) { bd = d; best = m }
      }
      if (!best) break
      AbilityVfx.lightning?.(sc, from.x, from.y, best.worldX ?? 0, best.worldY ?? 0, { color: 0xb98cff, durationMs: 240, thickness: 3 })
      AbilityVfx.particleBurst?.(sc, best.worldX ?? 0, best.worldY ?? 0, { color: 0xd0b0ff, count: 8, speed: 110, durationMs: 360 })
      if ((best.resources?.hp ?? 0) > 0) best.resources.hp = Math.max(0, best.resources.hp - Math.round(base * (1 - i * 0.15)))
      hit.push(best)
      from = { x: best.worldX ?? 0, y: best.worldY ?? 0 }
    }
    AbilityVfx.screenFlash?.(sc, { color: 0xb98cff, intensity: 0.2, durationMs: 200 })
    this._emitAllStar(hero, 'Soul Chain', 'SOUL CHAIN', hit.length)
  }

  // Rourke Wolfsong (beast master) — SPEAR VOLLEY: hurls three hunting spears down
  // his line of fire, skewering EVERY minion within ~20px of the line (the row).
  _asTrueshot(hero) {
    const sc = this._scene
    const pool = this._liveMinions()
    if (!pool.length) return
    const hx = hero.worldX ?? 0, hy = hero.worldY ?? 0
    let target = null, bd = Infinity
    for (const m of pool) { const d = Math.hypot((m.worldX ?? 0) - hx, (m.worldY ?? 0) - hy); if (d < bd) { bd = d; target = m } }
    const ang = Math.atan2((target.worldY ?? 0) - hy, (target.worldX ?? 0) - hx)
    const ex = hx + Math.cos(ang) * 900, ey = hy + Math.sin(ang) * 900
    for (let k = 0; k < 3; k++) {
      sc?.time?.delayedCall?.(k * 90, () => AbilityVfx.projectile?.(sc, hx, hy, ex, ey, { color: 0xfff0aa, durationMs: 220, radius: 3 }))
    }
    const dmg = 16 + Math.round(this._bossLv() * 4)
    let hit = 0
    for (const m of pool) {
      if (this._distToLine(hx, hy, ex, ey, m.worldX ?? 0, m.worldY ?? 0) > 20) continue
      if ((m.resources?.hp ?? 0) > 0) m.resources.hp = Math.max(0, m.resources.hp - dmg)
      AbilityVfx.impactBurst?.(sc, m.worldX ?? 0, m.worldY ?? 0, { color: 0xfff0aa, radius: 18 })
      hit++
    }
    this._emitAllStar(hero, 'Spear Volley', 'SPEAR VOLLEY', hit)
  }

  // Ser Auberon the Unbroken (templar) — HOLY AEGIS: a holy nova that restores
  // every living All-Star (incl. the leader Garreth) by a chunk — the squad's
  // staying power. (Mechanic kept from the old "mass heal".)
  _asAldous(hero) {
    const sc = this._scene
    const allies = (this._gs.adventurers?.active ?? []).filter(a =>
      (a._allStar || a._kingdomChampion) && (a.resources?.hp ?? 0) > 0)
    const heal = 40 + Math.round(this._bossLv() * 12)
    for (const a of allies) {
      const before = a.resources.hp
      a.resources.hp = Math.min(a.resources.maxHp ?? before, before + heal)
      const restored = a.resources.hp - before
      AbilityVfx.holyAegisFx?.(sc, a.worldX ?? 0, a.worldY ?? 0)
      if (restored > 0) AbilityVfx.floatingText?.(sc, a.worldX ?? 0, (a.worldY ?? 0) - 24, `+${restored}`, { color: '#a8ffb0', fontSize: '13px', driftY: -28, durationMs: 760 })
    }
    AbilityVfx.holyAegisFx?.(sc, hero.worldX ?? 0, hero.worldY ?? 0)
    this._emitAllStar(hero, 'Holy Aegis', 'HOLY AEGIS', allies.length)
  }

  // Master Kael (monk) — HUNDRED FISTS: flash-steps onto your strongest minion and
  // unloads a heavy flurry (a single, decisive strike beat). Mechanic kept from the
  // old "blink-backstab"; re-skinned to gold ki.
  _asShadowfax(hero) {
    const sc = this._scene
    const pool = this._liveMinions()
    if (!pool.length) return
    let target = null, best = -Infinity
    for (const m of pool) { const v = (m.resources?.maxHp ?? 0) + (m.stats?.attack ?? 0) * 4; if (v > best) { best = v; target = m } }
    const ox = hero.worldX ?? 0, oy = hero.worldY ?? 0
    AbilityVfx.magicCircle?.(sc, ox, oy, { color: 0xffd76a, radius: 24, durationMs: 360 })
    AbilityVfx.particleBurst?.(sc, ox, oy, { color: 0xfff0c0, count: 12, speed: 130, durationMs: 360 })
    const ang = (hero.tileX ?? 0) % 2 === 0 ? 0.7 : 3.9   // deterministic-ish offset (avoid Math.random churn)
    hero.worldX = (target.worldX ?? 0) + Math.cos(ang) * 22
    hero.worldY = (target.worldY ?? 0) + Math.sin(ang) * 22
    hero.tileX = target.tileX; hero.tileY = target.tileY; hero.path = null; hero.pathIndex = 0
    AbilityVfx.particleBurst?.(sc, hero.worldX, hero.worldY, { color: 0xffd76a, count: 10, speed: 110, durationMs: 320 })
    AbilityVfx.bladeArc?.(sc, target.worldX ?? 0, target.worldY ?? 0, { color: 0xfff4d0, radius: 34, durationMs: 260 })
    AbilityVfx.impactBurst?.(sc, target.worldX ?? 0, target.worldY ?? 0, { color: 0xffe9a8, radius: 22 })
    const dmg = 30 + Math.round(this._bossLv() * 8)
    if ((target.resources?.hp ?? 0) > 0) target.resources.hp = Math.max(0, target.resources.hp - dmg)
    this._emitAllStar(hero, 'Hundred Fists', 'HUNDRED FISTS', 1)
  }

  // The seraph resurrects the fallen — when a pantheon hero dies, raise a Radiant
  // Guardian WHERE IT FELL (capped per raid), in a grand divine pillar of light.
  // Reuses DayPhase's retinue spawn, then repositions the raised unit onto the
  // corpse's tile so the resurrection reads in-place rather than at the entry.
  _pantheonRaise(fallen) {
    const meta = this._gs.meta
    if (!meta?.act) return
    meta.act._pantheonRaises ??= PANTHEON_RAISE_CAP
    if (meta.act._pantheonRaises <= 0) return
    const dayPhase = this._scene?.scene?.get?.('DayPhase')
    if (!dayPhase?.scene?.isActive?.() || typeof dayPhase._spawnRetinueSquad !== 'function') return
    meta.act._pantheonRaises--
    const allClasses = this._scene.cache?.json?.get?.('adventurerClasses') ?? []
    const raised = dayPhase._spawnRetinueSquad(
      { classId: 'paladin', count: 1, name: 'Raised Guardian', hpMul: 1.1, flags: ['pantheonHero'] },
      allClasses, this._gs.boss?.level ?? 1)
    const g0 = raised[0]
    const fx = fallen?.worldX, fy = fallen?.worldY
    if (g0 && Number.isFinite(fx) && Number.isFinite(fy)) {
      g0.tileX = fallen.tileX; g0.tileY = fallen.tileY
      g0.worldX = fx; g0.worldY = fy
      g0.path = null; g0.pathIndex = 0
    }
    for (const r of raised) r.goal = { type: 'SEEK_BOSS' }   // join the assault, not wander
    this._pantheonResurrectPillar(Number.isFinite(fx) ? fx : g0?.worldX, Number.isFinite(fy) ? fy : g0?.worldY)
    EventBus.emit('PANTHEON_RAISE', { name: fallen?.name, remaining: meta.act._pantheonRaises })
  }

  // A GRAND divine resurrection pillar — the canonical resurrect beam at its core,
  // wrapped in god-rays, a holy circle, a sunburst, rising motes, a shockwave ring
  // and a soft flash. The fallen hero rises in a shaft of light.
  _pantheonResurrectPillar(x, y) {
    const sc = this._scene
    if (!sc || !Number.isFinite(x) || !Number.isFinite(y)) return
    AbilityVfx.resurrectBeam?.(sc, x, y, { color: 0xfff8d8, durationMs: 950 })
    AbilityVfx.beamPillar?.(sc, x, y, { color: 0xfff8d8, width: 50, height: 340, durationMs: 900 })
    AbilityVfx.godRays?.(sc, x, y, { color: 0xffe9a8, count: 18, length: 150, durationMs: 950 })
    AbilityVfx.magicCircle?.(sc, x, y, { color: 0xffe9a8, radius: 54, durationMs: 1100 })
    AbilityVfx.burstRays?.(sc, x, y, { color: 0xfff8d8, count: 16, length: 100, durationMs: 720 })
    AbilityVfx.particleBurst?.(sc, x, y - 8, { color: 0xfffbe6, count: 22, speed: 90, durationMs: 900 })
    AbilityVfx.pulseRing?.(sc, x, y, { color: 0xffe9a8, fromR: 8, toR: 70, alpha: 0.9, durationMs: 700 })
    AbilityVfx.screenFlash?.(sc, { color: 0xfff3c4, intensity: 0.28, durationMs: 320 })
  }

  // ── Final Judgment (Aurelia's signature) ────────────────────────────────────
  // The Seraph channels a screen-wide smite over the minion ROW (horizontal band)
  // holding the most of your minions. A gold danger band + per-minion telegraphs
  // warn during the channel; if she's slain mid-channel it FIZZLES, otherwise holy
  // pillars sweep the band and devastate every minion in it.
  _champFinalJudgment(champ) {
    const sc = this._scene
    const minions = (this._gs.minions ?? []).filter(m => (m.resources?.hp ?? 0) > 0)
    if (!minions.length) return
    // Pick the tileY whose ±band holds the most minions (target your formation).
    let bestY = minions[0].tileY ?? 0, bestN = -1
    for (const m of minions) {
      const ty = m.tileY ?? 0
      const n = minions.reduce((acc, o) => acc + (Math.abs((o.tileY ?? 0) - ty) <= JUDGMENT_BAND_TILES ? 1 : 0), 0)
      if (n > bestN) { bestN = n; bestY = ty }
    }
    const inBand = m => Math.abs((m.tileY ?? 0) - bestY) <= JUDGMENT_BAND_TILES
    const cy = bestY * TS + TS / 2
    const widthPx = (this._gs.dungeon?.tiles?.[0]?.length ?? 60) * TS
    EventBus.emit('CHAMPION_ABILITY', { responseId: 'pantheon', name: 'FINAL JUDGMENT', champion: champ?.name })
    // Channel — Aurelia charges, the row glows with warning.
    AbilityVfx.chargeUp?.(sc, champ.worldX, champ.worldY, { color: 0xffe9a8, count: 18, radius: 84, durationMs: JUDGMENT_CAST_MS })
    const tele = this._judgmentBand(cy, widthPx, true)
    for (const m of minions.filter(inBand)) {
      AbilityVfx.groundTelegraph?.(sc, m.worldX, m.worldY, { color: 0xffd24a, radius: 22, shape: 'circle', durationMs: JUDGMENT_CAST_MS })
    }
    sc?.time?.delayedCall?.(JUDGMENT_CAST_MS, () => {
      tele?.destroy?.()
      // Interrupt — the Seraph fell during the channel; judgment is undone.
      if ((champ.resources?.hp ?? 0) <= 0) { EventBus.emit('PANTHEON_JUDGMENT', { fizzled: true }); return }
      // The smite — a sweeping band of holy fire; lethal-grade damage to the row.
      this._judgmentBand(cy, widthPx, false)
      AbilityVfx.godRays?.(sc, widthPx / 2, cy, { color: 0xfff8d8, count: 20, length: 200, durationMs: 720 })
      AbilityVfx.screenFlash?.(sc, { color: 0xfff3c4, intensity: 0.5, durationMs: 360 })
      sc?.cameras?.main?.shake?.(420, 0.012)
      const flat = 40 + Math.round((this._gs.boss?.level ?? 1) * 10)
      let hit = 0
      for (const m of (this._gs.minions ?? [])) {
        if ((m.resources?.hp ?? 0) <= 0 || !inBand(m)) continue
        AbilityVfx.beamPillar?.(sc, m.worldX, m.worldY, { color: 0xfff3c4, width: 30, height: 280, durationMs: 520 })
        const dmg = Math.max(flat, Math.ceil((m.resources.maxHp ?? 1) * 0.6))   // devastates, rarely one-shots a tank
        m.resources.hp = Math.max(0, m.resources.hp - dmg)
        hit++
      }
      EventBus.emit('PANTHEON_JUDGMENT', { hit })
    })
  }

  // A horizontal band of light across the play width at world-Y `cy`. `warning`
  // = a pulsing gold telegraph (returned so the caller destroys it at resolve);
  // otherwise a bright holy sweep that flashes then fades.
  _judgmentBand(cy, widthPx, warning) {
    const sc = this._scene
    const h = TS * (JUDGMENT_BAND_TILES * 2 + 1)
    const color = warning ? 0xffd24a : 0xfff3c4
    const g = sc.add.graphics().setDepth(warning ? 30 : 33)
    g.fillStyle(color, warning ? 0.12 : 0.42)
    g.fillRect(0, cy - h / 2, widthPx, h)
    g.lineStyle(2, color, warning ? 0.5 : 0.95)
    g.strokeRect(0, cy - h / 2, widthPx, h)
    if (warning) {
      sc.tweens.add({ targets: g, alpha: { from: 0.5, to: 1 }, yoyo: true, repeat: -1, duration: 220 })
      return g
    }
    sc.tweens.add({ targets: g, alpha: 0, duration: 540, ease: 'Quad.easeOut', onComplete: () => g.destroy() })
    return g
  }

  _tickMageTower() {
    const now = this._scene?.time?.now ?? 0
    if (!now) return
    if (now - (this._mageBlinkAt ?? 0) > MAGE_BLINK_INTERVAL)  { this._mageBlinkAt = now;  this._mageBlink() }
    if (now - (this._mageSummonAt ?? 0) > MAGE_SUMMON_INTERVAL) { this._mageSummonAt = now; this._mageSummon() }
    this._tickMageSealVfx()   // arcane rune shimmer over the transmuted rooms
    this._tickPolymorphVfx()  // critter bubble over any polymorphed minion
  }

  // Blink — the archmages teleport a minion OUT of position into a different room.
  // Prefer a partner in another room so the swap genuinely relocates both across
  // the dungeon (the "teleport minions to other rooms" gimmick); fall back to any
  // pair. Violet poofs telegraph the depart + arrival at both endpoints.
  _mageBlink() {
    const sc = this._scene
    const live = (this._gs.minions ?? []).filter(m => (m.resources?.hp ?? 0) > 0)
    if (live.length < 2) return
    const grid = sc?.dungeonGrid
    const roomOf = m => grid?.getRoomAtTile?.(m.tileX, m.tileY)?.instanceId ?? null
    const a = live[Math.floor(Math.random() * live.length)]
    const ra = roomOf(a)
    const others = live.filter(m => m !== a)
    const diff = others.filter(m => roomOf(m) !== ra)
    const pool = diff.length ? diff : others
    const b = pool[Math.floor(Math.random() * pool.length)]
    // Depart poof at each minion's current spot.
    this._blinkPoof(a.worldX, a.worldY)
    this._blinkPoof(b.worldX, b.worldY)
    for (const k of ['tileX', 'tileY', 'worldX', 'worldY']) { const t = a[k]; a[k] = b[k]; b[k] = t }
    // Drop stale paths so each minion re-paths cleanly from its new tile (else it
    // snaps back toward its old position — reads as a glitch, not a teleport).
    a.path = null; a.pathIndex = 0; b.path = null; b.pathIndex = 0
    // Arrival poof at the new spots a beat later.
    sc?.time?.delayedCall?.(120, () => { this._blinkPoof(a.worldX, a.worldY); this._blinkPoof(b.worldX, b.worldY) })
    EventBus.emit('MAGE_BLINK', { a: a.name, b: b.name })
  }

  // A compact violet teleport poof (arcane circle + sparkle puff + ring).
  _blinkPoof(x, y) {
    const sc = this._scene
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    AbilityVfx.magicCircle?.(sc, x, y, { color: 0x9a7cf0, radius: 26, durationMs: 420 })
    AbilityVfx.particleBurst?.(sc, x, y, { color: 0xb9a4ff, count: 12, speed: 120, durationMs: 420 })
    AbilityVfx.pulseRing?.(sc, x, y, { color: 0x8a9cf0, fromR: 4, toR: 28, alpha: 0.85, durationMs: 380 })
  }

  // ── Mage Tower room transmute ───────────────────────────────────────────────
  // The placed rooms that HAVE an ability worth sealing (special/combat/utility/
  // trap categories; never the boss room or pure-structural starters).
  _mageAbilityRooms() {
    const rooms = this._gs.dungeon?.rooms ?? []
    const defs  = this._scene?.cache?.json?.get?.('rooms') ?? []
    const cat   = new Map(defs.map(d => [d.id, d.category]))
    return rooms.filter(r =>
      r.definitionId !== 'boss_chamber' &&
      MAGE_ABILITY_ROOM_CATS.has(cat.get(r.definitionId)))
  }

  // Restore every room this system sealed (idempotent — safe to call any time).
  _mageRestoreRooms() {
    for (const r of (this._gs.dungeon?.rooms ?? [])) {
      if (r._arcaneSealed) { r.isActive = true; r._arcaneSealed = false }
    }
    this._mageSealG?.clear()
  }

  // Day start — if the Mage Tower act is governing, re-roll the transmute: restore
  // yesterday's seals, then seal a fresh random ~50% of the ability rooms (their
  // special function goes dark; the renderer dims them) and announce which.
  _onMageDayStart() {
    this._mageRestoreRooms()
    if (currentActResponseId(this._gs) !== 'mage_tower') return
    const pool = this._mageAbilityRooms()
    if (pool.length === 0) return
    // Shuffle, take ceil(fraction) — at least one when any ability room exists.
    const shuffled = pool.slice()
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
    const n = Math.max(1, Math.round(pool.length * MAGE_TRANSMUTE_FRACTION))
    const sealed = shuffled.slice(0, n)
    const names = []
    for (const r of sealed) {
      r.isActive = false
      r._arcaneSealed = true
      names.push(r.name || r.definitionId)
      // A transmute poof at the room centre so the seal reads as arcane, not a bug.
      this._sealPoof(r)
    }
    EventBus.emit('MAGE_TRANSMUTE', { sealed: names, count: sealed.length, total: pool.length })
  }

  // Night start — clear the day's seals so the build phase is un-dimmed (and the
  // act-end transition naturally restores everything via the same path).
  _onMageNightStart() { this._mageRestoreRooms() }

  // World-pixel centre of a room (tile coords × TILE).
  _roomCenterPx(r) {
    return {
      x: (r.gridX + (r.width  ?? 1) / 2) * TS,
      y: (r.gridY + (r.height ?? 1) / 2) * TS,
    }
  }

  // One-shot arcane seal burst when a room is transmuted.
  _sealPoof(r) {
    const sc = this._scene
    const { x, y } = this._roomCenterPx(r)
    AbilityVfx.magicCircle?.(sc, x, y, { color: 0x8a9cf0, radius: 46, durationMs: 900 })
    AbilityVfx.runeSigil?.(sc, x, y, { color: 0xb9a4ff, radius: 34, durationMs: 1000 })
    AbilityVfx.particleBurst?.(sc, x, y, { color: 0x9a7cf0, count: 16, speed: 110, durationMs: 700 })
    AbilityVfx.pulseRing?.(sc, x, y, { color: 0x8a9cf0, fromR: 8, toR: 52, alpha: 0.85, durationMs: 620 })
  }

  // Per-tick arcane shimmer over each sealed room so the "disabled" state reads as
  // ongoing transmutation (a slow violet rune ring + drifting glyph motes) layered
  // over the renderer's base dim.
  _tickMageSealVfx() {
    const sealed = (this._gs.dungeon?.rooms ?? []).filter(r => r._arcaneSealed)
    if (sealed.length === 0) { this._mageSealG?.clear(); return }
    const g = this._mageSealG ?? (this._mageSealG = this._scene.add.graphics().setDepth(1.7))
    g.clear()
    const now = this._scene.time?.now ?? 0
    const pulse = 0.5 + 0.5 * Math.sin(now / 520)
    const rot = now / 2600
    for (const r of sealed) {
      const { x, y } = this._roomCenterPx(r)
      const R = 22 + 6 * pulse
      g.lineStyle(2, 0x9a7cf0, 0.35 + 0.3 * pulse)
      g.strokeCircle(x, y, R)
      g.lineStyle(1.5, 0xb9a4ff, 0.25 + 0.25 * pulse)
      g.strokeCircle(x, y, R * 0.62)
      // Six glyph motes orbiting the seal.
      for (let i = 0; i < 6; i++) {
        const ang = rot + i * (Math.PI / 3)
        const mx = x + Math.cos(ang) * R, my = y + Math.sin(ang) * R
        g.fillStyle(0xd6c8ff, 0.5 + 0.4 * pulse)
        g.fillCircle(mx, my, 1.8)
      }
    }
  }

  // ── Polymorph (Velloran's signature) ────────────────────────────────────────
  // Turn a random living minion into a harmless critter for a few seconds: it
  // can't attack (CombatSystem gate) or move (MinionAISystem gate). A poof in,
  // a floating critter while it lasts, a poof back.
  _champPolymorph(champ) {
    const sc = this._scene
    const live = (this._gs.minions ?? []).filter(m => (m.resources?.hp ?? 0) > 0 && !m._polymorphed)
    if (!live.length) return
    const target = live[Math.floor(Math.random() * live.length)]
    const now = sc?.time?.now ?? 0
    target._polymorphed = true
    target._polyUntil = now + MAGE_POLY_MS
    EventBus.emit('CHAMPION_ABILITY', { responseId: 'mage_tower', name: 'POLYMORPH', champion: champ?.name })
    EventBus.emit('MINION_POLYMORPHED', { minionId: target.instanceId, name: target.name })
    const x = target.worldX ?? 0, y = target.worldY ?? 0
    AbilityVfx.magicCircle?.(sc, x, y, { color: 0x8a9cf0, radius: 40, durationMs: 700 })
    AbilityVfx.runeSigil?.(sc, x, y, { color: 0xb9a4ff, radius: 30, durationMs: 760 })
    AbilityVfx.particleBurst?.(sc, x, y, { color: 0x9a7cf0, count: 18, speed: 140, durationMs: 620 })
    AbilityVfx.pulseRing?.(sc, x, y, { color: 0x8a9cf0, fromR: 6, toR: 46, alpha: 0.9, durationMs: 560 })
    sc?.time?.delayedCall?.(MAGE_POLY_MS, () => {
      if (!target._polymorphed) return
      target._polymorphed = false
      target._polyUntil = 0
      const rx = target.worldX ?? x, ry = target.worldY ?? y
      AbilityVfx.particleBurst?.(sc, rx, ry, { color: 0xb9a4ff, count: 12, speed: 120, durationMs: 460 })
      AbilityVfx.pulseRing?.(sc, rx, ry, { color: 0x8a9cf0, fromR: 6, toR: 34, alpha: 0.85, durationMs: 420 })
      EventBus.emit('MINION_POLYMORPH_END', { minionId: target.instanceId })
    })
  }

  // Per-tick critter indicator over each polymorphed minion (a soft violet bubble
  // + a hopping "🐑" tag), so the debuffed minion reads as a harmless critter even
  // without a sprite swap (sprite-pass item).
  _tickPolymorphVfx() {
    const polys = (this._gs.minions ?? []).filter(m => m._polymorphed && (m.resources?.hp ?? 0) > 0)
    if (polys.length === 0) {
      this._polyG?.clear()
      if (this._polyTags) { for (const t of this._polyTags.values()) t.destroy(); this._polyTags.clear() }
      return
    }
    const g = this._polyG ?? (this._polyG = this._scene.add.graphics().setDepth(41))
    g.clear()
    this._polyTags ??= new Map()
    const now = this._scene.time?.now ?? 0
    const hop = Math.abs(Math.sin(now / 220)) * 5
    const seen = new Set()
    for (const m of polys) {
      const x = m.worldX ?? 0, y = m.worldY ?? 0
      seen.add(m.instanceId)
      g.fillStyle(0xb9a4ff, 0.16)
      g.fillCircle(x, y - 4, 13)
      g.lineStyle(1.5, 0x9a7cf0, 0.6)
      g.strokeCircle(x, y - 4, 13)
      let tag = this._polyTags.get(m.instanceId)
      if (!tag) {
        tag = this._scene.add.text(0, 0, '🐑', { fontSize: '14px' }).setOrigin(0.5).setDepth(42)
        this._polyTags.set(m.instanceId, tag)
      }
      tag.setVisible(true).setPosition(x, y - 20 - hop)
    }
    // Drop tags for minions that reverted/died.
    for (const [id, tag] of this._polyTags) { if (!seen.has(id)) { tag.destroy(); this._polyTags.delete(id) } }
  }

  // Summon — the mages conjure an arcane construct that joins the assault
  // (capped so it doesn't flood). Reuses DayPhase's retinue spawn.
  _mageSummon() {
    const dayPhase = this._scene?.scene?.get?.('DayPhase')
    if (!dayPhase?.scene?.isActive?.() || typeof dayPhase._spawnRetinueSquad !== 'function') return
    const live = (this._gs.adventurers?.active ?? []).filter(a => a._arcaneConstruct).length
    if (live >= MAGE_SUMMON_CAP) return
    const allClasses = this._scene.cache?.json?.get?.('adventurerClasses') ?? []
    const out = dayPhase._spawnRetinueSquad(
      { classId: 'monster_invader', count: 1, name: 'Arcane Construct', monster: true, flags: ['noFlee'] },
      allClasses, this._gs.boss?.level ?? 1)
    for (const c of out) { c._arcaneConstruct = true; c.goal = { type: 'SEEK_BOSS' } }   // march on the throne
    if (out.length) EventBus.emit('MAGE_SUMMON', { count: out.length })
  }

  // ── ADVENTURER_DIED router ──────────────────────────────────────────────────
  _onAdventurerDied({ adventurer } = {}) {
    if (!adventurer) return
    // Remember the freshest corpse so Necrarch's Reanimate can raise a thrall where
    // a unit just fell (Reckoning). worldX/Y are pixel coords; tile coords too.
    if (Number.isFinite(adventurer.worldX)) {
      this._lastCorpse = { x: adventurer.worldX, y: adventurer.worldY, tileX: adventurer.tileX, tileY: adventurer.tileY }
    }
    // Captain Halric falls → the binding oath SHATTERS: the surviving martyrs lose
    // their fury and rout. Routed first so the captain's own death deflates the
    // squad instead of stoking it (the binder is gone, not another martyr down).
    if (adventurer._kingdomChampion && adventurer._championResponseId === 'forlorn_hope') {
      this._forlornOathBreak(adventurer)
    } else if (adventurer.flags?.forlornMartyr) {
      this._forlornFury(adventurer)
    }
    if (adventurer.flags?.pantheonHero) this._pantheonRaise(adventurer)
  }

  // Apply one fury stack to a martyr. We stash its PRE-fury base atk/speed the first
  // time, then recompute from base each stack — so there's no rounding drift and the
  // buff can be cleanly reverted when the oath breaks.
  _applyFury(a) {
    a.stats ??= {}
    a._furyBaseAtk   ??= a.stats.attack ?? 10
    a._furyBaseSpeed ??= a.stats.speed ?? 1.4
    a._furyStacks      = (a._furyStacks ?? 0) + 1
    a.stats.attack = Math.round(a._furyBaseAtk   * (FORLORN_ATK_PER_DEATH   ** a._furyStacks))
    a.stats.speed  =           a._furyBaseSpeed * (FORLORN_SPEED_PER_DEATH ** a._furyStacks)
  }

  // Forlorn Hope (escalating fury). A martyr fell — every surviving martyr surges
  // with atk + speed, compounding per death (the captain counts too). Fires the
  // crimson rage-pulse VFX and bumps the fury-counter punch.
  _forlornFury(fallen) {
    const living = (this._gs.adventurers?.active ?? []).filter(a =>
      a !== fallen && a.flags?.forlornMartyr && (a.resources?.hp ?? 0) > 0)
    if (living.length === 0) return
    for (const a of living) this._applyFury(a)
    this._furyFlashAt = this._scene?.time?.now ?? 0
    this._forlornRagePulse(fallen, living)
    EventBus.emit('FORLORN_FURY', {
      stacks: living[0]?._furyStacks ?? 1, remaining: living.length, fallen: fallen.name,
    })
  }

  // The visual beat when a martyr falls: a dark-red death-ember implodes at the
  // fallen, then every survivor flares with a crimson rage-pulse (hotter w/ more
  // stacks) and a "FURY ×N" crackle rises over the lead. A faint red flash + micro-
  // shake sells the surge without drowning the screen.
  _forlornRagePulse(fallen, living) {
    const sc = this._scene
    if (!sc) return
    const fx = fallen?.worldX, fy = fallen?.worldY
    AbilityVfx.particleBurst?.(sc, fx, fy, { color: 0x8a1410, count: 12, speed: 120, durationMs: 520 })
    AbilityVfx.pulseRing?.(sc, fx, fy, { color: 0xc0241a, fromR: 6, toR: 34, alpha: 0.8, durationMs: 420 })
    for (const a of living) {
      const x = a.worldX ?? 0, y = a.worldY ?? 0
      const st = a._furyStacks ?? 1
      AbilityVfx.burstRays?.(sc, x, y, { color: 0xff5a2a, count: 9, length: 40 + st * 6, durationMs: 380 })
      AbilityVfx.pulseRing?.(sc, x, y, { color: 0xff3a1a, fromR: 8, toR: 28 + st * 4, alpha: 0.85, durationMs: 440 })
      AbilityVfx.particleBurst?.(sc, x, y - 6, { color: 0xff7a3a, count: 6, speed: 90, durationMs: 460 })
    }
    const lead = (this._gs.adventurers?.active ?? []).find(a => a._kingdomChampion && a.flags?.forlornMartyr)
      ?? living[0]
    if (lead) {
      AbilityVfx.floatingText?.(sc, lead.worldX ?? 0, (lead.worldY ?? 0) - 26,
        `FURY ×${lead._furyStacks ?? 1}`, { color: '#ff5a2a', fontSize: '15px', driftY: -34, durationMs: 900 })
    }
    AbilityVfx.screenFlash?.(sc, { color: 0xc0241a, intensity: 0.16, durationMs: 200 })
    sc?.cameras?.main?.shake?.(160, 0.004)
  }

  // Captain Halric is slain → the oath shatters. Every surviving martyr loses its
  // fury (collapsing BELOW base), drops its no-flee resolve, and routs for the exit.
  // A desaturating "oath breaks" implosion snuffs the crimson auras. (The champion's
  // death also clears the act at day-end — but the survivors linger that day, so the
  // rout is a visible reward for cutting down the binder.)
  _forlornOathBreak(captain) {
    const sc = this._scene
    const living = (this._gs.adventurers?.active ?? []).filter(a =>
      a !== captain && a.flags?.forlornMartyr && (a.resources?.hp ?? 0) > 0)
    for (const a of living) {
      a.stats ??= {}
      const baseAtk   = a._furyBaseAtk   ?? a.stats.attack ?? 10
      const baseSpeed = a._furyBaseSpeed ?? a.stats.speed ?? 1.4
      a.stats.attack = Math.max(1, Math.round(baseAtk * FORLORN_DEMORALIZE_MULT))
      a.stats.speed  = baseSpeed * FORLORN_DEMORALIZE_MULT
      a._furyStacks  = 0
      a._demoralized = true
      if (a.flags) a.flags.noFlee = false
      if (!['dead', 'fleeing', 'fled', 'leaving'].includes(a.aiState)) {
        a.goal    = { type: 'FLEE', reason: 'oath_broken' }
        a.aiState = 'fleeing'
        a.path    = null
      }
      const x = a.worldX ?? 0, y = a.worldY ?? 0
      AbilityVfx.pulseRing?.(sc, x, y, { color: 0x6a6a72, fromR: 30, toR: 6, alpha: 0.7, durationMs: 360 })
      AbilityVfx.particleBurst?.(sc, x, y, { color: 0x4a4a52, count: 8, speed: 70, durationMs: 420 })
    }
    this._furyFlashAt = 0
    this._forlornG?.clear()
    this._forlornCounter?.setVisible(false)
    if (living.length) {
      AbilityVfx.screenFlash?.(sc, { color: 0x2a2a30, intensity: 0.2, durationMs: 280 })
      EventBus.emit('FORLORN_OATH_BROKEN', { captain: captain?.name, routed: living.length })
    }
  }

  // Captain Halric's "Last Vow" fired (CombatSystem clamped a lethal hit to 1 HP).
  // He ROARS — a hot crimson eruption — and the whole martyr squad answers with an
  // instant surge of fury for his final stand. The champion bar flashes the move.
  _onForlornLastVow({ adventurer } = {}) {
    const sc = this._scene
    const champ = adventurer
    if (!champ) return
    const x = champ.worldX ?? 0, y = champ.worldY ?? 0
    EventBus.emit('CHAMPION_ABILITY', { responseId: 'forlorn_hope', name: 'LAST VOW', champion: champ?.name })
    AbilityVfx.chargeUp?.(sc, x, y, { color: 0xff3a1a, count: 16, radius: 70, durationMs: 240 })
    sc?.time?.delayedCall?.(180, () => {
      AbilityVfx.lastVowFx?.(sc, x, y)
      AbilityVfx.screenFlash?.(sc, { color: 0xc0241a, intensity: 0.4, durationMs: 320 })
      sc?.cameras?.main?.shake?.(360, 0.012)
      const squad = (this._gs.adventurers?.active ?? []).filter(a =>
        a.flags?.forlornMartyr && (a.resources?.hp ?? 0) > 0)
      for (const a of squad) {
        for (let i = 0; i < FORLORN_LAST_VOW_STACKS; i++) this._applyFury(a)
        AbilityVfx.pulseRing?.(sc, a.worldX ?? 0, a.worldY ?? 0,
          { color: 0xff3a1a, fromR: 8, toR: 34, alpha: 0.85, durationMs: 460 })
      }
      this._furyFlashAt = sc?.time?.now ?? 0
    })
  }

  // Forlorn Hope world VFX — a crimson fury pool glows under each living martyr
  // (bigger + hotter the more stacks it carries; a faint doomed presence even at
  // zero) and a "⚔ FURY ×N" counter floats over the squad lead, punching on each
  // fresh kill. Drawn every frame so it reads as a living, breathing rage.
  // Reanimate (Necrarch's signature) — raise a just-killed unit as an undead THRALL
  // that marches on your boss. Rises from the freshest corpse (or beside Necrarch),
  // in a green grave-burst. Reuses DayPhase's Risen-Dead spawn (zombie chassis).
  _champReanimate(champ) {
    const sc = this._scene
    const dayPhase = sc?.scene?.get?.('DayPhase')
    if (!dayPhase?.scene?.isActive?.() || typeof dayPhase._spawnRisenDead !== 'function') return
    const risen = dayPhase._spawnRisenDead(1, this._gs.boss?.level ?? 1)
    const z = risen?.[0]
    if (!z) return
    // Raise it where a unit just fell; else beside Necrarch.
    const at = (this._lastCorpse && Number.isFinite(this._lastCorpse.x))
      ? this._lastCorpse
      : { x: champ.worldX, y: champ.worldY, tileX: champ.tileX, tileY: champ.tileY }
    if (Number.isFinite(at.x)) {
      z.worldX = at.x; z.worldY = at.y
      if (at.tileX != null) { z.tileX = at.tileX; z.tileY = at.tileY }
      z.path = null; z.pathIndex = 0
    }
    z.goal = { type: 'SEEK_BOSS' }
    z.name = 'Reanimated Thrall'
    z._reanimated = true
    this._lastCorpse = null   // consume the corpse so the next cast finds a fresh one
    EventBus.emit('CHAMPION_ABILITY', { responseId: 'reckoning_dead', name: 'REANIMATE', champion: champ?.name })
    EventBus.emit('RECKONING_REANIMATE', { name: z.name })
    this._necroticRise(at.x ?? champ.worldX ?? 0, at.y ?? champ.worldY ?? 0)
  }

  // A green grave-burst: a necrotic light pillar, a sickly rune circle, bone-shard
  // particles, a sunburst, a grave crater + a pulse — the dead clawing up.
  _necroticRise(x, y) {
    const sc = this._scene
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    AbilityVfx.beamPillar?.(sc, x, y, { color: 0x6fce8a, width: 30, height: 230, durationMs: 660 })
    AbilityVfx.magicCircle?.(sc, x, y, { color: 0x6fce8a, radius: 40, durationMs: 840 })
    AbilityVfx.burstRays?.(sc, x, y, { color: 0x9ef0b0, count: 10, length: 64, durationMs: 500 })
    AbilityVfx.particleBurst?.(sc, x, y, { color: 0x9ef0b0, count: 16, speed: 120, durationMs: 660 })
    AbilityVfx.crater?.(sc, x, y, { color: 0x16240f, radius: 18 })
    AbilityVfx.pulseRing?.(sc, x, y, { color: 0x6fce8a, fromR: 6, toR: 46, alpha: 0.85, durationMs: 540 })
  }

  // Necrarch's grave-summon — a big necrotic eruption at the king + a STAGGERED
  // grave-burst at each risen-dead spawn (graves erupt across the entry, the dead
  // claw up). Driven by DayPhase._spawnNecrarchSummoner via NECRARCH_SUMMON.
  _onNecrarchSummon({ necrarch, risen } = {}) {
    const sc = this._scene
    if (!sc) return
    if (necrarch && Number.isFinite(necrarch.x)) {
      AbilityVfx.chargeUp?.(sc, necrarch.x, necrarch.y, { color: 0x6fce8a, count: 18, radius: 80, durationMs: 520 })
      AbilityVfx.magicCircle?.(sc, necrarch.x, necrarch.y, { color: 0x6fce8a, radius: 64, durationMs: 1400 })
      AbilityVfx.burstRays?.(sc, necrarch.x, necrarch.y, { color: 0x9ef0b0, count: 14, length: 92, durationMs: 720 })
      AbilityVfx.pulseRing?.(sc, necrarch.x, necrarch.y, { color: 0x6fce8a, fromR: 10, toR: 96, alpha: 0.8, durationMs: 760 })
      AbilityVfx.screenFlash?.(sc, { color: 0x2a4a30, intensity: 0.22, durationMs: 320 })
    }
    for (let i = 0; i < (risen?.length ?? 0); i++) {
      const p = risen[i]
      if (!Number.isFinite(p?.x)) continue
      sc?.time?.delayedCall?.(120 + i * 90, () => this._necroticRise(p.x, p.y))
    }
  }

  // A dark necrotic pool + skull-motes under the standing Necrarch, so the immune
  // summoner reads as a brooding presence at the entrance.
  _tickNecrarchAura() {
    const nec = (this._gs.adventurers?.active ?? []).find(a => a._necrarch && (a.resources?.hp ?? 0) > 0)
    if (!nec) { this._necrarchG?.clear(); return }
    const g = this._necrarchG ?? (this._necrarchG = this._scene.add.graphics().setDepth(1.7))
    g.clear()
    const now = this._scene.time?.now ?? 0
    const x = nec.worldX ?? 0, y = nec.worldY ?? 0
    const pulse = 0.5 + 0.5 * Math.sin(now / 520)
    for (const [f, a] of [[1.0, 0.06], [0.7, 0.1], [0.42, 0.15], [0.2, 0.22]]) {
      g.fillStyle(0x1c4028, a * (0.7 + 0.3 * pulse)); g.fillCircle(x, y, 32 * f)
    }
    g.lineStyle(2, 0x6fce8a, 0.3 + 0.35 * pulse); g.strokeCircle(x, y, 30 + 4 * pulse)
    for (let i = 0; i < 6; i++) {
      const ang = now / 1700 + i * (Math.PI / 3)
      const mr = 30 + 3 * Math.sin(now / 300 + i)
      g.fillStyle(0x9ef0b0, 0.35 + 0.4 * pulse)
      g.fillCircle(x + Math.cos(ang) * mr, y + Math.sin(ang) * mr - 4, 1.7)
    }
  }

  // Sabotage (the Turncoat's signature) — CHARM a random one of your minions to
  // fight for the raid for a few seconds (a temporary defection via faction flip),
  // then snap it back. Reuses the same faction='adventurer' path the permanent
  // defector uses, so the AI already knows how to run a turned minion.
  _champSabotage(champ) {
    const sc = this._scene
    const live = (this._gs.minions ?? []).filter(m =>
      (m.resources?.hp ?? 0) > 0 && m.faction === 'dungeon' && !m._sabotaged)
    if (!live.length) return
    const target = live[Math.floor(Math.random() * live.length)]
    const now = sc?.time?.now ?? 0
    target._sabotaged = true
    target._sabotagedUntil = now + SABOTAGE_MS
    target._origFaction = target.faction ?? 'dungeon'
    target.faction = 'adventurer'           // turns on your side (existing defection handling)
    target.currentTargetId = null
    target.aiState = 'idle'                  // re-evaluate allegiance next tick
    EventBus.emit('CHAMPION_ABILITY', { responseId: 'betrayer', name: 'SABOTAGE', champion: champ?.name })
    EventBus.emit('MINION_SABOTAGED', { minionId: target.instanceId, name: target.name })
    const x = target.worldX ?? 0, y = target.worldY ?? 0
    AbilityVfx.magicCircle?.(sc, x, y, { color: 0x7ec850, radius: 38, durationMs: 720 })
    AbilityVfx.runeSigil?.(sc, x, y, { color: 0x9ef070, radius: 30, durationMs: 760 })
    AbilityVfx.particleBurst?.(sc, x, y, { color: 0x9ef070, count: 16, speed: 130, durationMs: 620 })
    AbilityVfx.pulseRing?.(sc, x, y, { color: 0x7ec850, fromR: 6, toR: 44, alpha: 0.9, durationMs: 580 })
    sc?.time?.delayedCall?.(SABOTAGE_MS, () => {
      if (!target._sabotaged) return
      target._sabotaged = false
      target._sabotagedUntil = 0
      target.faction = target._origFaction ?? 'dungeon'
      target.currentTargetId = null
      target.aiState = 'idle'
      AbilityVfx.particleBurst?.(sc, target.worldX ?? x, target.worldY ?? y, { color: 0x9ef070, count: 10, speed: 100, durationMs: 440 })
      EventBus.emit('MINION_SABOTAGE_END', { minionId: target.instanceId })
    })
  }

  // Per-tick charm indicator over any sabotaged minion (a green ring + "⤝" tag),
  // so a turned minion reads clearly. Self-gating; runs every tick via update().
  _tickSabotageVfx() {
    const charmed = (this._gs.minions ?? []).filter(m => m._sabotaged && (m.resources?.hp ?? 0) > 0)
    if (charmed.length === 0) {
      this._sabotageG?.clear()
      if (this._sabotageTags) { for (const t of this._sabotageTags.values()) t.setVisible(false) }
      return
    }
    const g = this._sabotageG ?? (this._sabotageG = this._scene.add.graphics().setDepth(41))
    g.clear()
    this._sabotageTags ??= new Map()
    const now = this._scene.time?.now ?? 0
    const pulse = 0.5 + 0.5 * Math.sin(now / 240)
    const seen = new Set()
    for (const m of charmed) {
      const x = m.worldX ?? 0, y = m.worldY ?? 0
      seen.add(m.instanceId)
      g.lineStyle(2, 0x7ec850, 0.5 + 0.4 * pulse)
      g.strokeCircle(x, y - 4, 13)
      let tag = this._sabotageTags.get(m.instanceId)
      if (!tag) { tag = this._scene.add.text(0, 0, '⤝', { fontSize: '13px', color: '#9ef070', fontStyle: 'bold' }).setOrigin(0.5).setDepth(42); this._sabotageTags.set(m.instanceId, tag) }
      tag.setVisible(true).setPosition(x, y - 22)
    }
    for (const [id, tag] of this._sabotageTags) { if (!seen.has(id)) { tag.destroy(); this._sabotageTags.delete(id) } }
  }

  // Betrayer world VFX — a green "⇄ turned" mark pulses over each trap while the
  // flip is active, so the player SEES their own traps are now against them.
  _tickBetrayerVfx() {
    const traps = this._gs.dungeon?.traps ?? []
    if (traps.length === 0) { this._betrayerG?.clear(); return }
    const g = this._betrayerG ?? (this._betrayerG = this._scene.add.graphics().setDepth(1.7))
    g.clear()
    const now = this._scene.time?.now ?? 0
    const pulse = 0.5 + 0.5 * Math.sin(now / 400)
    for (const t of traps) {
      if (t.state?.exploded || t._broken) continue
      const x = (t.tileX + (t.footprint?.w ?? 1) / 2) * TS
      const y = (t.tileY + (t.footprint?.h ?? 1) / 2) * TS
      const R = 11 + 3 * pulse
      g.lineStyle(2, 0x7ec850, 0.35 + 0.4 * pulse)
      g.strokeCircle(x, y, R)
      // A small ⇄ — two opposed, arrow-tipped lines (the "turned against you" mark).
      g.lineStyle(2, 0x9ef070, 0.55 + 0.35 * pulse)
      g.lineBetween(x - 7, y - 3, x + 7, y - 3); g.lineBetween(x + 7, y - 3, x + 3, y - 6)
      g.lineBetween(x + 7, y + 3, x - 7, y + 3); g.lineBetween(x - 7, y + 3, x - 3, y + 6)
    }
  }

  // Betrayer NIGHT-DASH intro (once per act, on the first build phase). Gated trigger.
  _onBetrayerNight() {
    if (currentActResponseId(this._gs) !== 'betrayer') return
    const act = this._gs.meta?.act
    if (!act || act._betrayerDashDone) return
    act._betrayerDashDone = true
    // Small delay so the build scene is up + the dungeon rendered before the dash.
    this._scene?.time?.delayedCall?.(900, () => this._betrayerNightSabotage())
  }

  // The strongest minion turns traitor on-screen: it PATHS through the dungeon
  // (A* along walkable corridors/doors — NOT a beeline through walls) from trap to
  // trap, flipping each in a green sabotage burst, then walks out the entry and
  // ABANDONS you (removed, no respawn — it returns as the Turncoat at the climax).
  // A scripted frame-step mover (works at night; the minion is skipped by
  // MinionAISystem via `_saboteurDashing` so its AI can't fight the scripted move).
  _betrayerNightSabotage() {
    const sc = this._scene
    const minions = (this._gs.minions ?? []).filter(m => (m.resources?.hp ?? 0) > 0 && !m._saboteurDashing)
    if (!minions.length) return false
    const score = m => (m.level ?? 1) * 1e5 + (m.resources?.maxHp ?? 0)
    let sab = minions[0]; for (const m of minions) if (score(m) > score(sab)) sab = m
    // Ensure a valid start position (fall back from tile coords).
    if (!Number.isFinite(sab.worldX)) sab.worldX = (sab.tileX ?? 10) * TS + TS / 2
    if (!Number.isFinite(sab.worldY)) sab.worldY = (sab.tileY ?? 10) * TS + TS / 2
    sab._saboteurDashing = true   // MinionAISystem skips him while he dashes
    sab._invulnerable     = true  // flipped traps can't catch the traitor mid-dash
    EventBus.emit('BETRAYER_SABOTAGE_BEGINS', { minion: sab, name: sab.name })
    AbilityVfx.pulseRing?.(sc, sab.worldX, sab.worldY, { color: 0x7ec850, fromR: 6, toR: 32, alpha: 0.9, durationMs: 420 })
    AbilityVfx.burstRays?.(sc, sab.worldX, sab.worldY, { color: 0x9ef070, count: 10, length: 46, durationMs: 420 })
    // Sync the start tile to the world position (floor, not round — tile centre
    // (tx+0.5)*TS must map back to tx) so A* starts from the right tile.
    sab.tileX = Math.floor(sab.worldX / TS); sab.tileY = Math.floor(sab.worldY / TS)

    // ── Route: PATH THROUGH THE DUNGEON (walkable tiles only, like a real unit) ──
    // It used to BEELINE straight to each trap THROUGH WALLS. Now it A*-routes
    // along corridors/doors to a walkable tile beside each trap, flips it, then
    // walks out the entry door and abandons you.
    const grid   = sc?.dungeonGrid
    const gTiles = grid?.getTiles?.()
    const gW = gTiles?.[0]?.length ?? 0, gH = gTiles?.length ?? 0
    const isWalk = (x, y) => {
      if (!gTiles || x < 0 || y < 0 || x >= gW || y >= gH) return false
      if (!PathfinderSystem.isWalkable(gTiles[y][x])) return false
      if (grid?.isSolidTrap?.(x, y) || grid?.isSolidDecor?.(x, y) || grid?.isDoorBlocked?.(x, y)) return false
      return true
    }
    // The walkable tile to STAND ON to sabotage a trap: the trap's own tile if it
    // can be stood on, else the nearest walkable neighbour (solid traps + wall-
    // mounted arrow traps are flipped from beside them).
    const approachOf = (tx, ty) => {
      if (isWalk(tx, ty)) return { x: tx, y: ty }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]])
        if (isWalk(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy }
      return null
    }
    const trapInfo = (this._gs.dungeon?.traps ?? [])
      .filter(t => !t.state?.exploded && !t._broken)
      .map(t => ({
        appr: approachOf(t.tileX + Math.floor((t.footprint?.w ?? 1) / 2),
          t.tileY + Math.floor((t.footprint?.h ?? 1) / 2)),
        vfx:  { x: (t.tileX + (t.footprint?.w ?? 1) / 2) * TS, y: (t.tileY + (t.footprint?.h ?? 1) / 2) * TS },
      }))
      .filter(ti => ti.appr && Number.isFinite(ti.vfx.x))
    // Greedy nearest-neighbour tour from the saboteur so the dash weaves through
    // the halls naturally instead of zig-zagging in placement order.
    const ordered = []
    const pool = trapInfo.slice()
    let curX = sab.tileX, curY = sab.tileY
    while (pool.length) {
      let best = 0, bestD = Infinity
      for (let k = 0; k < pool.length; k++) {
        const d = Math.abs(pool[k].appr.x - curX) + Math.abs(pool[k].appr.y - curY)
        if (d < bestD) { bestD = d; best = k }
      }
      const [ti] = pool.splice(best, 1); ordered.push(ti); curX = ti.appr.x; curY = ti.appr.y
    }
    const entry = sc?.aiSystem?.pickSpawnTile?.()
    const stops = ordered.map(ti => ({ tile: ti.appr, flip: ti.vfx }))
    stops.push({ tile: entry ? { x: entry.x, y: entry.y } : null, exit: true })

    const finish = () => {
      const idx = (this._gs.minions ?? []).indexOf(sab); if (idx >= 0) this._gs.minions.splice(idx, 1)
      AbilityVfx.particleBurst?.(sc, sab.worldX, sab.worldY, { color: 0x7ec850, count: 16, speed: 150, durationMs: 520 })
      AbilityVfx.pulseRing?.(sc, sab.worldX, sab.worldY, { color: 0x9ef070, fromR: 6, toR: 36, alpha: 0.85, durationMs: 460 })
      EventBus.emit('BETRAYER_SABOTEUR_LEFT', { minion: sab, name: sab.name })
    }
    const flipTrap = (vfx) => {
      AbilityVfx.burstRays?.(sc, vfx.x, vfx.y, { color: 0x9ef070, count: 10, length: 44, durationMs: 360 })
      AbilityVfx.pulseRing?.(sc, vfx.x, vfx.y, { color: 0x7ec850, fromR: 6, toR: 30, alpha: 0.9, durationMs: 380 })
      AbilityVfx.particleBurst?.(sc, vfx.x, vfx.y, { color: 0x9ef070, count: 8, speed: 90, durationMs: 380 })
      EventBus.emit('BETRAYER_TRAP_FLIPPED', { x: vfx.x, y: vfx.y })
    }
    const move = BETRAYER_DASH_SPEED * 16   // px per ~16ms frame

    // Manual frame-step lerp ALONG THE A* WAYPOINTS (robust — Phaser tweens on
    // plain gameState objects can corrupt the coords).
    const goToStop = (idx) => {
      if (!sab._saboteurDashing) return
      if (idx >= stops.length) { finish(); return }
      const stop = stops[idx]
      const path = (grid && stop.tile)
        ? PathfinderSystem.findPath({ x: sab.tileX, y: sab.tileY }, stop.tile, grid, null, 0, null, { softTraps: true })
        : null
      // Unreachable (no grid / trap walled off / no entry tile): skip a trap, or
      // just leave-in-place at the exit — NEVER beeline through walls.
      if (!stop.tile || path == null) {
        if (stop.exit) { finish(); return }
        sc?.time?.delayedCall?.(40, () => goToStop(idx + 1)); return
      }
      const wps = path; let wi = 0   // path is [] when already on the tile → arrive immediately
      const arrive = () => {
        sab.worldX = (stop.tile.x + 0.5) * TS; sab.worldY = (stop.tile.y + 0.5) * TS
        sab.tileX = stop.tile.x; sab.tileY = stop.tile.y
        if (stop.flip) flipTrap(stop.flip)
        if (stop.exit) { finish(); return }
        sc?.time?.delayedCall?.(140, () => goToStop(idx + 1))   // a beat at each trap
      }
      const step = () => {
        if (!sab._saboteurDashing) return
        if (wi >= wps.length) { arrive(); return }
        const wp = wps[wi]
        // Open a closed door we're crossing — move like a real minion, not a ghost.
        const door = grid?.getCpForDoorTile?.(wp.x, wp.y)
        if (door && door.cp && !door.cp.open) sc?._dungeonRenderer?.openDoor?.(door.cp)
        const tx = (wp.x + 0.5) * TS, ty = (wp.y + 0.5) * TS
        const dx = tx - sab.worldX, dy = ty - sab.worldY
        const d = Math.hypot(dx, dy)
        if (d <= move + 1) {
          sab.worldX = tx; sab.worldY = ty; sab.tileX = wp.x; sab.tileY = wp.y
          wi++; sc?.time?.delayedCall?.(16, step); return
        }
        sab.worldX += (dx / d) * move; sab.worldY += (dy / d) * move
        sab.tileX = Math.floor(sab.worldX / TS); sab.tileY = Math.floor(sab.worldY / TS)
        sc?.time?.delayedCall?.(16, step)
      }
      step()
    }
    goToStop(0)
    return true
  }

  _tickForlornVfx() {
    const martyrs = (this._gs.adventurers?.active ?? [])
      .filter(a => a.flags?.forlornMartyr && (a.resources?.hp ?? 0) > 0)
    if (martyrs.length === 0) {
      this._forlornG?.clear()
      this._forlornCounter?.setVisible(false)
      return
    }
    const g = this._forlornG ?? (this._forlornG = this._scene.add.graphics().setDepth(1.6))
    g.clear()
    const now = this._scene.time?.now ?? 0
    const pulse = 0.5 + 0.5 * Math.sin(now / 260)        // fast, angry flicker
    let maxStacks = 0
    for (const a of martyrs) {
      const st = a._furyStacks ?? 0
      if (st > maxStacks) maxStacks = st
      const x = a.worldX ?? 0, y = a.worldY ?? 0
      const R = FORLORN_AURA_R + st * FORLORN_AURA_R_PER_STACK
      const intensity = 0.35 + Math.min(1, st / 5) * 0.65   // faint at 0 → full by ~5 stacks
      const hot = Math.min(1, st / 6)
      const layers = [[1.0, 0.05], [0.72, 0.09], [0.46, 0.14], [0.24, 0.2]]
      for (const [f, al] of layers) {
        g.fillStyle(0xff2a12, al * intensity * (0.6 + 0.4 * pulse))
        g.fillCircle(x, y, R * f)
      }
      g.fillStyle(0xff7a3a, (0.1 + 0.2 * hot) * (0.6 + 0.4 * pulse))
      g.fillCircle(x, y, R * 0.2)
      g.lineStyle(1.5 + hot * 2, 0xff5a2a, (0.3 + 0.4 * pulse) * intensity)
      g.strokeCircle(x, y, R * (0.9 + 0.06 * pulse))
      // Rising ember flecks (cheap fixed-slot shimmer drifting upward).
      for (let i = 0; i < 5; i++) {
        const tw = 0.5 + 0.5 * Math.sin(now / 220 + i * 1.6)
        if (tw < 0.4) continue
        const ea = i * 2.39996 + now / 1400
        const ex = x + Math.cos(ea) * R * (0.3 + 0.55 * ((i * 0.41) % 1))
        const ey = y - ((now / 6 + i * 40) % (R * 1.2))
        g.fillStyle(0xffb24a, 0.5 * tw * intensity)
        g.fillCircle(ex, ey, 1.4 + tw)
      }
    }
    // The fury counter — anchored over the captain (or the squad lead).
    const lead = martyrs.find(a => a._kingdomChampion) ?? martyrs[0]
    if (lead && maxStacks > 0) {
      const t = this._forlornCounter ?? (this._forlornCounter = this._scene.add.text(0, 0, '', {
        fontFamily: 'monospace', fontSize: '15px', color: '#ff5a2a', fontStyle: 'bold',
        stroke: '#1a0400', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(42))
      t.setVisible(true).setText(`⚔ FURY ×${maxStacks}`).setPosition(lead.worldX ?? 0, (lead.worldY ?? 0) - 34)
      const since = now - (this._furyFlashAt ?? 0)
      t.setScale(since < 360 ? 1 + 0.5 * (1 - since / 360) : 1)
      t.setColor(maxStacks >= 5 ? '#ffd24a' : maxStacks >= 3 ? '#ff8a2a' : '#ff5a2a')
    } else {
      this._forlornCounter?.setVisible(false)
    }
  }
}
