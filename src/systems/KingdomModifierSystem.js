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
import { createMinion, applyBossLevelToMinion } from '../entities/Minion.js'

// Boss-ascension REINFORCEMENTS (KR P6) — each ascension the dungeon fields the
// boss's own kin as free elite defenders (flavoured per archetype, mirroring the
// evolution). One archetype elite + `tier` grunts deploy into the boss chamber,
// scaled to the boss level with an elite/grunt stat boost. Ids are minionTypes
// entries; an archetype with no elite (null) fields one extra grunt instead.
const REINFORCEMENT_POOL = {
  beholder:  { elite: 'beholder_tyrant', grunts: ['beholder1', 'beholder2'] },
  demon:     { elite: 'demon_lord',      grunts: ['imp2', 'demon1', 'demon2'] },
  gnoll:     { elite: 'gnoll_alpha',     grunts: ['gnoll1', 'gnoll2'] },
  golem:     { elite: 'golem_warden',    grunts: ['golem1', 'golem2'] },
  lich:      { elite: 'elder_lich',      grunts: ['skeleton3', 'zombie2', 'lich1', 'lich2'] },
  lizardman: { elite: 'serpent_captain', grunts: ['lizardman1', 'lizardman2'] },
  myconid:   { elite: null,              grunts: ['mushroom1', 'mushroom2', 'ent2', 'plant3'] },
  orc:       { elite: null,              grunts: ['orc1', 'orc2', 'goblin3'] },
  slime:     { elite: null,              grunts: ['elder_slime2', 'slime6', 'slime8'] },
  vampire:   { elite: 'dark_wraith',     grunts: ['vampire_minion1', 'vampire_minion2'] },
  wraith:    { elite: 'dark_wraith',     grunts: ['ghost1', 'ghost2'] },
  succubus:  { elite: null,              grunts: ['imp3', 'vampire_minion2'] },
  _default:  { elite: null,              grunts: ['skeleton2', 'zombie2', 'goblin2'] },
}
const REINFORCE_ELITE_MUL = 1.5    // elite reinforcements hit ~50% harder/tougher
const REINFORCE_GRUNT_MUL = 1.18   // even the grunts come ascension-touched

// Forlorn Hope — each fallen martyr stokes the survivors' fury. Per-death
// multipliers (compounding); a ~6-strong squad tops out around ×1.9 atk / ×1.5
// speed, so it ramps hard the longer you let the fight drag without ending it.
const FORLORN_ATK_PER_DEATH   = 1.12
const FORLORN_SPEED_PER_DEATH = 1.08

// Mage Tower cadence (real-time ms while its act is active + a wave is present).
const MAGE_BLINK_INTERVAL  = 6500
const MAGE_SUMMON_INTERVAL = 8500
const MAGE_SUMMON_CAP      = 6     // live arcane constructs at once

// Pantheon — a holy AURA around the angels (heal heroes / sear your minions) +
// the seraph resurrecting the fallen a limited number of times per raid.
const PANTHEON_AURA_INTERVAL  = 1500
const PANTHEON_AURA_RADIUS_PX = 96     // ~3 tiles (TILE=32)
const PANTHEON_RAISE_CAP      = 4

// Inquisition — the holy law purges your undead minions while its act runs.
const INQUISITION_PURGE_INTERVAL = 2000

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
    // Boss Ascension (KR P6) — when the act advances, the boss absorbs the
    // fallen kingdom's power and surges. We host the trigger here (already the
    // acts-gated modifier system with scene access to BossSystem); the sprite
    // swap is owned by BossRenderer, the cinematic by AscensionCinematic.
    EventBus.on('ACT_STARTED', this._onActStarted, this)
    // Plunderers (KR P5) — a fled thief absconds with a heist purse.
    EventBus.on('ADVENTURER_FLED', this._onAdventurerFled, this)
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.off('ACT_STARTED', this._onActStarted, this)
    EventBus.off('ADVENTURER_FLED', this._onAdventurerFled, this)
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
    // The dungeon grows: free elite reinforcements rally into the chamber.
    this._deployReinforcements(Math.max(0, act - 1))
  }

  // Deploy `tier` grunts + one archetype elite (if any) as free garrison
  // defenders in the boss chamber. Garrison class → they don't eat the player's
  // Barracks cap; they persist in the roster + respawn at dawn like gooplings.
  _deployReinforcements(tier) {
    if (tier <= 0) return
    const gs = this._gs
    const minionDefs = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    if (!Array.isArray(minionDefs) || minionDefs.length === 0) return
    if (!Array.isArray(gs.minions)) return
    const has = (id) => minionDefs.some(d => d.id === id)
    const arch = gs.player?.bossArchetypeId
    const pool = REINFORCEMENT_POOL[arch] || REINFORCEMENT_POOL._default

    // Build the squad: the elite (if its def exists) + grunts. No elite → one
    // extra grunt so the squad size is consistent (tier + 1 bodies either way).
    const squad = []
    const hasElite = pool.elite && has(pool.elite)
    if (hasElite) squad.push({ id: pool.elite, elite: true })
    const grunts = pool.grunts.filter(has)
    if (grunts.length === 0 && !hasElite) return
    const gruntCount = hasElite ? tier : tier + 1
    for (let i = 0; i < gruntCount && grunts.length; i++) squad.push({ id: grunts[i % grunts.length], elite: false })
    if (squad.length === 0) return

    const tiles = this._chamberSpawnTiles(squad.length)
    if (tiles.length === 0) return
    const bossRoom = gs.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    const bossLv = gs.boss?.level ?? 1
    let placed = 0
    for (let i = 0; i < squad.length && i < tiles.length; i++) {
      const def = minionDefs.find(d => d.id === squad[i].id)
      if (!def) continue
      const tile = tiles[i]
      const m = createMinion(def, tile, bossRoom?.instanceId ?? null, { class: 'garrison' })
      // Elite/grunt boost BEFORE the level scaling so it's baked into the base
      // (applyMinionScaling records _baseMaxHp on first call) and survives every
      // dawn rescale rather than being washed out.
      const mul = squad[i].elite ? REINFORCE_ELITE_MUL : REINFORCE_GRUNT_MUL
      m.resources.maxHp = Math.round(m.resources.maxHp * mul)
      m.resources.hp    = m.resources.maxHp
      m.stats.attack    = Math.round(m.stats.attack * mul)
      applyBossLevelToMinion(m, bossLv)
      m._reinforcement      = true
      m._reinforcementElite = squad[i].elite
      m.homeTileX = tile.x
      m.homeTileY = tile.y
      gs.minions.push(m)
      EventBus.emit('MINION_PLACED', { minion: m })
      placed++
    }
    if (placed) EventBus.emit('BOSS_REINFORCEMENTS', { count: placed, tier, elite: hasElite })
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
      if (dx * dx + dy * dy <= R2) { a.resources.hp = Math.max(0, a.resources.hp - dmg); seared++ }
    }
    if (seared) EventBus.emit('BOSS_ASCENSION_AURA', { seared, tier, dmg })
  }

  // ── per-frame tick (day phase only; wired in Game.update) ───────────────────
  update(_dt) {
    const resp = currentActResponseId(this._gs)
    const wave = (this._gs.adventurers?.active?.length ?? 0) > 0
    if (!wave) return
    // Boss ascension dark aura — present in every ascended act (II+), regardless
    // of which Kingdom Response governs it. The dungeon radiates absorbed power.
    this._tickAscensionAura()
    // Mage Tower — reality-warping magic while its act runs.
    if (resp === 'mage_tower') this._tickMageTower()
    // Pantheon — the angels' holy aura pulses.
    else if (resp === 'pantheon') this._tickPantheonAura()
    // Inquisition — the holy law purges your undead minions.
    else if (resp === 'inquisition') this._tickInquisitionPurge()
    // Plunderers — the thieves pickpocket your treasury each pulse.
    else if (resp === 'plunderers') this._tickPlunderers()
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
    const thieves = (this._gs.adventurers?.active ?? [])
      .filter(a => a.flags?.plundererThief && (a.resources?.hp ?? 0) > 0).length
    if (thieves === 0) return
    const per = Math.max(Balance.PLUNDER_PICKPOCKET_MIN ?? 2,
      Math.floor(gold * (Balance.PLUNDER_PICKPOCKET_PCT ?? 0.004)))
    const taken = this._drainGold(per * thieves)
    if (taken > 0) EventBus.emit('PLUNDER_PICKPOCKET', { taken, thieves })
  }

  _onAdventurerFled({ adventurer } = {}) {
    if (!adventurer?.flags?.plundererThief) return
    const gold = this._gs.player?.gold ?? 0
    const heist = Math.max(Balance.PLUNDER_ESCAPE_MIN ?? 20,
      Math.floor(gold * (Balance.PLUNDER_ESCAPE_PCT ?? 0.03)))
    const taken = this._drainGold(heist)
    if (taken > 0) EventBus.emit('PLUNDER_ESCAPE', { name: adventurer.name, taken })
  }

  // Inquisition undead purge — every ~2s your undead minions take holy purge
  // damage (MinionAISystem handles the kill at hp<=0). The act-wide pact-benefit
  // suppression is the other half — see DESIGN_COVERAGE kr-response-inquisition.
  _tickInquisitionPurge() {
    const now = this._scene?.time?.now ?? 0
    if (!now || now - (this._purgeAt ?? 0) < INQUISITION_PURGE_INTERVAL) return
    this._purgeAt = now
    const dmg = 10 + Math.round((this._gs.boss?.level ?? 1) * 3)
    let purged = 0
    for (const m of (this._gs.minions ?? [])) {
      if ((m.resources?.hp ?? 0) <= 0) continue
      if (_isUndead(m)) { m.resources.hp -= dmg; purged++ }
    }
    if (purged) EventBus.emit('INQUISITION_PURGE', { purged })
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

  // The seraph resurrects the fallen — when a pantheon hero dies, raise a Radiant
  // Guardian in its place (capped per raid). Reuses DayPhase's retinue spawn.
  _pantheonRaise(fallen) {
    const meta = this._gs.meta
    if (!meta?.act) return
    meta.act._pantheonRaises ??= PANTHEON_RAISE_CAP
    if (meta.act._pantheonRaises <= 0) return
    const dayPhase = this._scene?.scene?.get?.('DayPhase')
    if (!dayPhase?.scene?.isActive?.() || typeof dayPhase._spawnRetinueSquad !== 'function') return
    meta.act._pantheonRaises--
    const allClasses = this._scene.cache?.json?.get?.('adventurerClasses') ?? []
    dayPhase._spawnRetinueSquad(
      { classId: 'paladin', count: 1, name: 'Raised Guardian', hpMul: 1.1, flags: ['pantheonHero'] },
      allClasses, this._gs.boss?.level ?? 1)
    EventBus.emit('PANTHEON_RAISE', { name: fallen?.name, remaining: meta.act._pantheonRaises })
  }

  _tickMageTower() {
    const now = this._scene?.time?.now ?? 0
    if (!now) return
    if (now - (this._mageBlinkAt ?? 0) > MAGE_BLINK_INTERVAL)  { this._mageBlinkAt = now;  this._mageBlink() }
    if (now - (this._mageSummonAt ?? 0) > MAGE_SUMMON_INTERVAL) { this._mageSummonAt = now; this._mageSummon() }
  }

  // Blink — the archmages teleport your minions out of position: swap two random
  // living minions' tiles so the formation you carefully placed scrambles.
  _mageBlink() {
    const minions = (this._gs.minions ?? []).filter(m => (m.resources?.hp ?? 0) > 0)
    if (minions.length < 2) return
    const i = Math.floor(Math.random() * minions.length)
    let j = Math.floor(Math.random() * minions.length)
    if (j === i) j = (j + 1) % minions.length
    const a = minions[i], b = minions[j]
    for (const k of ['tileX', 'tileY', 'worldX', 'worldY']) {
      const t = a[k]; a[k] = b[k]; b[k] = t
    }
    EventBus.emit('MAGE_BLINK', { a: a.name, b: b.name })
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
    for (const c of out) c._arcaneConstruct = true
    if (out.length) EventBus.emit('MAGE_SUMMON', { count: out.length })
  }

  // ── ADVENTURER_DIED router ──────────────────────────────────────────────────
  _onAdventurerDied({ adventurer } = {}) {
    if (!adventurer) return
    if (adventurer.flags?.forlornMartyr) this._forlornFury(adventurer)
    if (adventurer.flags?.pantheonHero) this._pantheonRaise(adventurer)
  }

  // Forlorn Hope (escalating fury). A martyr fell — every surviving martyr in the
  // squad surges with atk + speed. Compounds per death; the captain counts too.
  _forlornFury(fallen) {
    const living = (this._gs.adventurers?.active ?? []).filter(a =>
      a !== fallen && a.flags?.forlornMartyr && (a.resources?.hp ?? 0) > 0)
    if (living.length === 0) return
    for (const a of living) {
      a.stats ??= {}
      a.stats.attack = Math.round((a.stats.attack ?? 10) * FORLORN_ATK_PER_DEATH)
      a.stats.speed  = (a.stats.speed ?? 1.4) * FORLORN_SPEED_PER_DEATH
      a._furyStacks  = (a._furyStacks ?? 0) + 1
    }
    EventBus.emit('FORLORN_FURY', {
      stacks: living[0]?._furyStacks ?? 1, remaining: living.length, fallen: fallen.name,
    })
  }
}
