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
    // Mango dev — preview the ascension screen on demand (non-destructive).
    EventBus.on('DEV_TEST_ASCENSION', this._onDevTestAscension, this)
    // Plunderers (KR P5) — a fled thief absconds with a heist purse.
    EventBus.on('ADVENTURER_FLED', this._onAdventurerFled, this)
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.off('ACT_STARTED', this._onActStarted, this)
    EventBus.off('DEV_TEST_ASCENSION', this._onDevTestAscension, this)
    EventBus.off('ADVENTURER_FLED', this._onAdventurerFled, this)
    this._pantheonG?.destroy(); this._pantheonG = null
    this._allStarG?.destroy(); this._allStarG = null
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

    const tiles = this._chamberSpawnTiles(GUARDIAN_COUNT)
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
    if (!wave) { this._pantheonG?.clear(); this._allStarG?.clear(); return }
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
    // All-Stars — crown each champion with a star + thread synergy links.
    else if (resp === 'all_stars') this._tickAllStarsVfx()
    // World-VFX Graphics cleanup — clear any whose response isn't governing now
    // (kept OUT of the else-chain so a lingering buffer can't swallow a tick).
    if (resp !== 'pantheon'  && this._pantheonG) this._pantheonG.clear()
    if (resp !== 'all_stars' && this._allStarG) this._allStarG.clear()
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
    const raised = dayPhase._spawnRetinueSquad(
      { classId: 'paladin', count: 1, name: 'Raised Guardian', hpMul: 1.1, flags: ['pantheonHero'] },
      allClasses, this._gs.boss?.level ?? 1)
    for (const r of raised) r.goal = { type: 'SEEK_BOSS' }   // join the assault, not wander
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
    // Drop stale paths so each minion re-paths cleanly from its new tile (else it
    // snaps back toward its old position — reads as a glitch, not a teleport).
    a.path = null; a.pathIndex = 0; b.path = null; b.pathIndex = 0
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
    for (const c of out) { c._arcaneConstruct = true; c.goal = { type: 'SEEK_BOSS' } }   // march on the throne
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
