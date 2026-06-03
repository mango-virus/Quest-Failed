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
import { TILE } from './DungeonGrid.js'
import { createMinion, applyMinionScaling } from '../entities/Minion.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'

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
const ALLSTAR_SIG_BY_CLASS = { mage: 'stormcaller', rogue: 'shadowfax', ranger: 'trueshot', cleric: 'aldous' }

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
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.off('FORLORN_LAST_VOW', this._onForlornLastVow, this)
    EventBus.off('DAY_PHASE_STARTED', this._onMageDayStart, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._onMageNightStart, this)
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
      this._mageSealG?.clear(); this._polyG?.clear()
      if (this._polyTags) for (const t of this._polyTags.values()) t.setVisible(false)
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
    // Champion signature ability — the act boss's telegraphed boss move on cadence.
    this._tickChampionAbility(resp)
    // All-Stars — the crown VFX + the 4 heroes' signatures ride on the UNITS
    // (self-gating on _allStar / _allStarSig), so they also fire for a dev-spawned
    // raid card (which doesn't set the act response). No resp gate here.
    this._tickAllStarsVfx()
    this._tickAllStarAbilities()
    // World-VFX Graphics cleanup — clear any whose response isn't governing now
    // (kept OUT of the else-chain so a lingering buffer can't swallow a tick).
    if (resp !== 'pantheon'  && this._pantheonG) this._pantheonG.clear()
    if (resp !== 'forlorn_hope' && this._forlornG) { this._forlornG.clear(); this._forlornCounter?.setVisible(false) }
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
    if (this._champSeenAt == null) { this._champSeenAt = now; this._champAbilityAt = now + CHAMP_ABILITY_FIRST_MS }
    if (now < (this._champAbilityAt ?? 0)) return
    this._champAbilityAt = now + CHAMP_ABILITY_CD_MS
    // Dispatch on the CHAMPION's own response, not the ambient act response — so a
    // dev-spawned raid (which doesn't set meta.act.responses) still fires the right
    // signature. In a real act the two are identical.
    const sig = champ._championResponseId || resp
    switch (sig) {
      case 'plunderers':  this._champGrandHeist(champ);    break
      case 'inquisition': this._champExcommunicate(champ); break
      case 'mage_tower':  this._champPolymorph(champ);     break
      case 'pantheon':    this._champFinalJudgment(champ); break
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
    AbilityVfx.beamPillar?.(sc, x, y, { color: 0xfff3c4, width: big ? 44 : 22, height: 300, durationMs: big ? 720 : 460 })
    AbilityVfx.godRays?.(sc, x, y, { color: 0xfff8d8, count: big ? 18 : 9, length: big ? 150 : 64, durationMs: big ? 1000 : 560 })
    AbilityVfx.particleBurst?.(sc, x, y, { color: 0xfffbe6, count: big ? 18 : 7, speed: big ? 130 : 80, durationMs: 600 })
    if (big) {
      AbilityVfx.magicCircle?.(sc, x, y, { color: 0xffe08a, radius: 50, durationMs: 1000 })
      AbilityVfx.burstRays?.(sc, x, y, { color: 0xfff8d8, count: 14, length: 90 })
      AbilityVfx.shockwave?.(sc, x, y, { color: 0xfff3c4, toR: 110, thickness: 6, durationMs: 560 })
    } else {
      AbilityVfx.pulseRing?.(sc, x, y, { color: 0xffe6a0, fromR: 6, toR: 26, alpha: 0.7, durationMs: 420 })
    }
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
    const stars = (this._gs.adventurers?.active ?? []).filter(a => a._allStarSig && (a.resources?.hp ?? 0) > 0)
    for (const s of stars) {
      if (s._allStarAbilityAt == null) {
        s._allStarAbilityAt = now + ALLSTAR_FIRST_MS + (ALLSTAR_STAGGER[s._allStarSig] ?? 0)
      }
      if (now < s._allStarAbilityAt) continue
      s._allStarAbilityAt = now + ALLSTAR_CD_MS
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

  // Myrine the Stormcaller — CHAIN LIGHTNING: a bolt leaps from her through up to 4
  // nearest minions, arcing minion-to-minion with per-hop falloff.
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
      AbilityVfx.lightning?.(sc, from.x, from.y, best.worldX ?? 0, best.worldY ?? 0, { color: 0x9fe0ff, durationMs: 240, thickness: 3 })
      AbilityVfx.particleBurst?.(sc, best.worldX ?? 0, best.worldY ?? 0, { color: 0xbfe0ff, count: 8, speed: 110, durationMs: 360 })
      if ((best.resources?.hp ?? 0) > 0) best.resources.hp = Math.max(0, best.resources.hp - Math.round(base * (1 - i * 0.15)))
      hit.push(best)
      from = { x: best.worldX ?? 0, y: best.worldY ?? 0 }
    }
    AbilityVfx.screenFlash?.(sc, { color: 0x9fe0ff, intensity: 0.2, durationMs: 200 })
    this._emitAllStar(hero, 'Chain Lightning', 'CHAIN LIGHTNING', hit.length)
  }

  // Elenwe Trueshot — PIERCING VOLLEY: three arrows along her line of fire that
  // pierce EVERY minion within ~20px of the line (a skewering shot down the row).
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
    this._emitAllStar(hero, 'Piercing Volley', 'PIERCING VOLLEY', hit)
  }

  // Brother Aldous — MASS HEAL: a holy nova that restores every living All-Star
  // (incl. the leader Garreth) by a chunk — the squad's staying power.
  _asAldous(hero) {
    const sc = this._scene
    const allies = (this._gs.adventurers?.active ?? []).filter(a =>
      (a._allStar || a._kingdomChampion) && (a.resources?.hp ?? 0) > 0)
    const heal = 40 + Math.round(this._bossLv() * 12)
    for (const a of allies) {
      const before = a.resources.hp
      a.resources.hp = Math.min(a.resources.maxHp ?? before, before + heal)
      const restored = a.resources.hp - before
      AbilityVfx.pulseRing?.(sc, a.worldX ?? 0, a.worldY ?? 0, { color: 0xa8ffb0, fromR: 6, toR: 30, alpha: 0.85, durationMs: 480 })
      AbilityVfx.particleBurst?.(sc, a.worldX ?? 0, (a.worldY ?? 0) - 6, { color: 0xc8ffd0, count: 8, speed: 70, durationMs: 520 })
      if (restored > 0) AbilityVfx.floatingText?.(sc, a.worldX ?? 0, (a.worldY ?? 0) - 24, `+${restored}`, { color: '#a8ffb0', fontSize: '13px', driftY: -28, durationMs: 760 })
    }
    AbilityVfx.godRays?.(sc, hero.worldX ?? 0, hero.worldY ?? 0, { color: 0xc8ffd0, count: 12, length: 90, durationMs: 600 })
    AbilityVfx.pulseRing?.(sc, hero.worldX ?? 0, hero.worldY ?? 0, { color: 0xa8ffb0, fromR: 10, toR: 80, alpha: 0.7, durationMs: 600 })
    this._emitAllStar(hero, 'Mass Heal', 'MASS HEAL', allies.length)
  }

  // Shadowfax the Quick — BLINK-BACKSTAB: vanishes and reappears on your strongest
  // minion for a heavy strike (a single, decisive assassination beat).
  _asShadowfax(hero) {
    const sc = this._scene
    const pool = this._liveMinions()
    if (!pool.length) return
    let target = null, best = -Infinity
    for (const m of pool) { const v = (m.resources?.maxHp ?? 0) + (m.stats?.attack ?? 0) * 4; if (v > best) { best = v; target = m } }
    const ox = hero.worldX ?? 0, oy = hero.worldY ?? 0
    AbilityVfx.magicCircle?.(sc, ox, oy, { color: 0x9a6cf0, radius: 24, durationMs: 360 })
    AbilityVfx.particleBurst?.(sc, ox, oy, { color: 0x6a4aaa, count: 12, speed: 130, durationMs: 360 })
    const ang = (hero.tileX ?? 0) % 2 === 0 ? 0.7 : 3.9   // deterministic-ish offset (avoid Math.random churn)
    hero.worldX = (target.worldX ?? 0) + Math.cos(ang) * 22
    hero.worldY = (target.worldY ?? 0) + Math.sin(ang) * 22
    hero.tileX = target.tileX; hero.tileY = target.tileY; hero.path = null; hero.pathIndex = 0
    AbilityVfx.particleBurst?.(sc, hero.worldX, hero.worldY, { color: 0x9a6cf0, count: 10, speed: 110, durationMs: 320 })
    AbilityVfx.bladeArc?.(sc, target.worldX ?? 0, target.worldY ?? 0, { color: 0xe0d0ff, radius: 34, durationMs: 260 })
    AbilityVfx.impactBurst?.(sc, target.worldX ?? 0, target.worldY ?? 0, { color: 0xb9a4ff, radius: 22 })
    const dmg = 30 + Math.round(this._bossLv() * 8)
    if ((target.resources?.hp ?? 0) > 0) target.resources.hp = Math.max(0, target.resources.hp - dmg)
    this._emitAllStar(hero, 'Blink-Backstab', 'BLINK-BACKSTAB', 1)
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
    const cy = bestY * TILE + TILE / 2
    const widthPx = (this._gs.dungeon?.tiles?.[0]?.length ?? 60) * TILE
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
    const h = TILE * (JUDGMENT_BAND_TILES * 2 + 1)
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
      x: (r.gridX + (r.width  ?? 1) / 2) * TILE,
      y: (r.gridY + (r.height ?? 1) / 2) * TILE,
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
      AbilityVfx.shockwave?.(sc, x, y, { color: 0xff3a1a, toR: 150, thickness: 8, durationMs: 600 })
      AbilityVfx.burstRays?.(sc, x, y, { color: 0xff6a2a, count: 16, length: 110, durationMs: 560 })
      AbilityVfx.particleBurst?.(sc, x, y, { color: 0xff5a2a, count: 22, speed: 180, durationMs: 640 })
      AbilityVfx.pulseRing?.(sc, x, y, { color: 0xffb04a, fromR: 10, toR: 90, alpha: 0.9, durationMs: 520 })
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
