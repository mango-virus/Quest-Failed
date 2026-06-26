// Day/night drivers + wave generation on top of the headless runtime.
// Replicates the parts of DayPhase/NightPhase that matter for a balance sim,
// reusing the real systems for everything else.

import { boot, frame, EventBus } from './headless.mjs'
import { createAdventurer }      from '../../src/entities/Adventurer.js'
import { createMinion, applyMinionScaling } from '../../src/entities/Minion.js'
import { createTrap }            from '../../src/entities/Trap.js'
import { upgradeCost }           from '../../src/util/minionRevive.js'
import { pickWeightedClass }     from '../../src/util/classSpawn.js'
import { TILE }                  from '../../src/systems/DungeonGrid.js'
import { Balance, adventurerScaleMultipliers } from '../../src/config/balance.js'

let _seq = 0
const uid = (p) => `${p}_${++_seq}`

// ── Defense loadout — place scaled minions + traps near the boss ──────────────
const WALKABLE = new Set([TILE.FLOOR, TILE.BOSS_FLOOR])
function floorTilesNearBoss(grid, gs, n) {
  const b = gs.boss ?? {}; const cx = b.tileX ?? 10, cy = b.tileY ?? 10
  const out = []
  for (let r = 1; r <= 10 && out.length < n; r++)
    for (let dx = -r; dx <= r && out.length < n; dx++)
      for (let dy = -r; dy <= r && out.length < n; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = cx + dx, y = cy + dy
        if (x === cx && y === cy) continue
        if (WALKABLE.has(grid.getTileType?.(x, y))) out.push({ x, y })
      }
  return out
}

function occupiedTiles(gs) {
  const s = new Set()
  for (const m of gs.minions ?? []) s.add(`${m.tileX},${m.tileY}`)
  for (const t of gs.dungeon.traps ?? []) s.add(`${t.tileX},${t.tileY}`)
  return s
}
function nextFreeTile(grid, gs) {
  const occ = occupiedTiles(gs)
  for (const t of floorTilesNearBoss(grid, gs, 200)) if (!occ.has(`${t.x},${t.y}`)) return t
  return null
}
function placeOneMinion(scene, gs, grid, def, bossLv) {
  const t = nextFreeTile(grid, gs); if (!t) return false
  const roomId = grid.getRoomAtTile?.(gs.boss?.tileX, gs.boss?.tileY)?.instanceId ?? null
  const day = gs.meta?.dayNumber ?? 1
  const m = createMinion(def, { x: t.x, y: t.y }, roomId, { bossLevel: bossLv, dayNumber: day })
  applyMinionScaling(m, bossLv, day); m.aiState = 'idle'
  gs.minions.push(m); EventBus.emit('MINION_PLACED', {}); return true
}
function placeOneTrap(scene, gs, grid, def) {
  const t = nextFreeTile(grid, gs); if (!t) return false
  gs.dungeon.traps.push(createTrap(def, { tileX: t.x, tileY: t.y })); return true
}

// ── Functional rooms — attach to the entry hall (the connect hub) ─────────────
// Under the midpoint rule any room only connects when its facing-wall center
// aligns with the neighbour's, so the chain center-aligns each room on the
// shared axis. So we chain functional rooms outward from
// the entry's left and right edges. Their onNightStart behaviors (treasury
// stipend, crypt garrison Risen Bones) then fire on the NIGHT we already emit.
function attachRoom(grid, gs, def, anchor, side) {
  // Leave a ONE-TILE GAP between rooms — that gap is the connector under the
  // 1-gap model (see ROOM_CONNECTIONS.md); touching no longer connects.
  const x = side === 'L' ? anchor.gridX - def.width - 1 : anchor.gridX + anchor.width + 1
  // Center-align on the shared (vertical) axis so the facing-wall MIDPOINTS
  // coincide — required for a connection under the midpoint rule.
  const y = anchor.gridY + Math.floor((anchor.height - 2) / 2) - Math.floor((def.height - 2) / 2)
  if (x < 0 || y < 0) return null
  const room = grid.placeRoom(def, x, y, { noSnap: true, dungeonLevel: gs.boss?.level ?? 1 })
  if (!room) return null
  const edgeX = side === 'L' ? anchor.gridX : anchor.gridX + anchor.width - 1
  const y1 = Math.min(anchor.gridY + anchor.height, y + def.height)
  for (let yy = Math.max(anchor.gridY, y); yy < y1; yy++) grid.recheckAutoConnect?.(edgeX, yy)
  if ((grid.getDisconnectedRooms?.() ?? []).includes(room)) return room  // kept; behavior still fires
  return room
}

export function placeFunctionalRoom(scene, gs, grid, roomId) {
  const def = (scene.cache.json.get('rooms') ?? []).find(d => d.id === roomId)
  if (!def || (def.unlockLevel ?? 1) > (gs.boss?.level ?? 1)) return false
  const entry = gs.dungeon.rooms.find(r => r.definitionId === 'entry_hall')
  if (!entry) return false
  gs._funcChain ??= { left: entry, right: entry, n: 0 }
  const first = gs._funcChain.n % 2 === 0 ? 'L' : 'R'
  for (const side of [first, first === 'L' ? 'R' : 'L']) {
    const anchor = side === 'L' ? gs._funcChain.left : gs._funcChain.right
    const room = attachRoom(grid, gs, def, anchor, side)
    if (room) {
      if (side === 'L') gs._funcChain.left = room; else gs._funcChain.right = room
      gs._funcChain.n++
      openAllDoors(gs)
      return true
    }
  }
  return false
}

// ── Night-building policy — spend the night's gold on defenses ─────────────────
// A "competent player" model: take a stipend (abstracts economy buildings the sim
// doesn't construct), then (1) buy minions up to a level floor, (2) buy traps,
// (3) invest surplus gold in tier UPGRADES — evolving existing minions, the real
// quality multiplier (auto-evolve was removed 2026-05-29; upgrades are paid) —
// then (4) buy more minions up to a cap with any leftover. Quantity early, quality
// once the economy can afford it. Turns runGame into a growing-dungeon playthrough.
export function buildNightDefenses(scene, gs, grid, cfg = {}) {
  const {
    stipend = 25, minionFloorBase = 4, minionFloorPerLv = 1,
    minionCapBase = 4, minionCapPerLv = 2, trapCapBase = 2, trapCapPerLv = 0.5, upgrade = true,
    rooms = true, roomCap = 4, roomWishlist = ['treasury', 'crypt', 'treasury', 'crypt', 'starter_guard_post'],
  } = cfg
  const bossLv = gs.boss?.level ?? 1, day = gs.meta?.dayNumber ?? 1
  gs.player.gold = (gs.player.gold ?? 0) + stipend
  const roomDefsAll = scene.cache.json.get('rooms') ?? []

  // (0) functional rooms — income (treasury) + free garrison (crypt). Built before
  // minions because they're force-multipliers (income compounds; garrison is free).
  let spent = 0, upgrades = 0, roomsBuilt = 0
  if (rooms) {
    const FUNC = new Set(roomWishlist)
    const funcCount = () => (gs.dungeon.rooms ?? []).filter(r => FUNC.has(r.definitionId)).length
    for (const id of roomWishlist) {
      if (funcCount() >= roomCap) break
      const def = roomDefsAll.find(d => d.id === id)
      if (!def || (def.unlockLevel ?? 1) > bossLv || def.goldCost > gs.player.gold) continue
      if (placeFunctionalRoom(scene, gs, grid, id)) { gs.player.gold -= def.goldCost; spent += def.goldCost; roomsBuilt++ }
    }
  }
  const buyableM = (scene.cache.json.get('minionTypes') ?? []).filter(d => (d.unlockLevel ?? 1) <= bossLv && d.goldCost > 0).sort((a, b) => a.goldCost - b.goldCost)
  const buyableT = (scene.cache.json.get('trapTypes')   ?? []).filter(d => (d.unlockLevel ?? 1) <= bossLv && d.goldCost > 0).sort((a, b) => a.goldCost - b.goldCost)
  const mDefs  = scene.cache.json.get('minionTypes') ?? []
  const chains = scene.cache.json.get('minionEvolutions') ?? {}
  const evo    = scene.minionEvolutionSystem
  const minionCap = Math.round(minionCapBase + minionCapPerLv * bossLv)
  const floor     = Math.min(minionCap, Math.round(minionFloorBase + minionFloorPerLv * bossLv))
  const trapCap   = Math.round(trapCapBase + trapCapPerLv * bossLv)
  const aliveM = () => gs.minions.filter(m => m.aiState !== 'dead').length

  const buyMinionsUpTo = (target) => {
    while (aliveM() < target) {
      const aff = buyableM.filter(d => d.goldCost <= gs.player.gold)
      if (!aff.length) break
      const def = aff[aff.length - 1]               // priciest affordable ≈ strongest
      if (!placeOneMinion(scene, gs, grid, def, bossLv)) break
      gs.player.gold -= def.goldCost; spent += def.goldCost
    }
  }

  buyMinionsUpTo(floor)                              // (1) baseline quantity
  while ((gs.dungeon.traps?.length ?? 0) < trapCap) { // (2) traps
    const aff = buyableT.filter(d => d.goldCost <= gs.player.gold)
    if (!aff.length) break
    const def = aff[aff.length - 1]
    if (!placeOneTrap(scene, gs, grid, def)) break
    gs.player.gold -= def.goldCost; spent += def.goldCost
  }
  if (upgrade && evo) {                              // (3) invest surplus in quality
    let guard = 0
    while (guard++ < 300) {
      const cands = gs.minions
        .filter(m => m.aiState !== 'dead' && evo.canUpgrade?.(m))
        .map(m => ({ m, cost: upgradeCost(gs, m, mDefs, chains) }))
        .filter(x => x.cost > 0 && x.cost <= gs.player.gold)
        .sort((a, b) => a.cost - b.cost)             // cheapest (lowest-tier) first
      if (!cands.length) break
      const { m, cost } = cands[0]
      gs.player.gold -= cost; spent += cost
      if (evo.upgrade(m)) { applyMinionScaling(m, bossLv, day); upgrades++ }  // re-base HP to new tier now
    }
  }
  buyMinionsUpTo(minionCap)                          // (4) extra quantity with leftover

  const tiers = gs.minions.filter(m => m.aiState !== 'dead').map(m => evo?.tierOf?.(m) ?? 1)
  const funcRooms = (gs.dungeon.rooms ?? []).filter(r => !['boss_chamber', 'entry_hall'].includes(r.definitionId)).length
  return { spent, upgrades, roomsBuilt, minions: aliveM(), garrison: gs.minions.filter(m => m.class === 'garrison' && m.aiState !== 'dead').length, traps: gs.dungeon.traps?.length ?? 0, rooms: funcRooms, maxTier: tiers.length ? Math.max(...tiers) : 1 }
}

// loadout: { minions: ['skeleton1', ...], traps: ['shooting_arrows', ...] }
export function placeLoadout(scene, gs, grid, { minions = [], traps = [] } = {}) {
  if (!minions.length && !traps.length) return { minions: 0, traps: 0 }
  const tiles  = floorTilesNearBoss(grid, gs, minions.length + traps.length + 6)
  const bossLv = gs.boss?.level ?? 1, day = gs.meta?.dayNumber ?? 1
  const roomId = grid.getRoomAtTile?.(gs.boss?.tileX, gs.boss?.tileY)?.instanceId ?? null
  const mById  = Object.fromEntries((scene.cache.json.get('minionTypes') ?? []).map(d => [d.id, d]))
  const tById  = Object.fromEntries((scene.cache.json.get('trapTypes') ?? []).map(d => [d.id, d]))
  let used = 0, mc = 0, tc = 0
  for (const id of minions) {
    const def = mById[id], t = tiles[used]; if (!def || !t) continue
    const m = createMinion(def, { x: t.x, y: t.y }, roomId, { bossLevel: bossLv, dayNumber: day })
    applyMinionScaling(m, bossLv, day); m.aiState = 'idle'
    gs.minions.push(m); used++; mc++
  }
  for (const id of traps) {
    const def = tById[id], t = tiles[used]; if (!def || !t) continue
    gs.dungeon.traps.push(createTrap(def, { tileX: t.x, tileY: t.y })); used++; tc++
  }
  EventBus.emit('MINION_PLACED', {})
  return { minions: mc, traps: tc }
}

// ── Night: ensure a path entry_hall → boss (DevSandbox.arena, minimal) ────────
export function buildNight(scene, gs, grid) {
  const roomDefs = scene.cache.json.get('rooms')
  const defOf = id => roomDefs.find(d => d.id === id)
  if (gs.dungeon.rooms.some(r => r.definitionId === 'entry_hall')) return  // already built
  const boss = gs.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
  if (!boss) return
  const entryDef = defOf('entry_hall')
  const gy = boss.gridY - entryDef.height - 1        // one-tile gap above the boss
  const ex = boss.gridX + Math.floor((boss.width - 2) / 2) - Math.floor((entryDef.width - 2) / 2)
  grid.placeRoom(entryDef, ex, gy, { noSnap: true })
  for (let dx = 1; dx < entryDef.width - 1; dx++) grid.recheckAutoConnect?.(ex + dx, boss.gridY)
  openAllDoors(gs)
}

// Doors normally open via a renderer-driven animation that doesn't run headless.
// Pre-open every connection-point door so adventurers can traverse freely.
export function openAllDoors(gs) {
  for (const r of gs.dungeon.rooms ?? [])
    for (const cp of r.connectionPoints ?? []) { cp.open = true; cp.opening = false; cp.openProgress = 1 }
}

// ── Wave generation — DayPhase._spawnDailyAdventurers core (clean run) ────────
function scaleAdv(adv, bossLv, day) {
  if (bossLv <= 1 && day <= 1) return
  const { hpMul, atkMul } = adventurerScaleMultipliers(bossLv, day, 0)
  adv.resources.maxHp = Math.round(adv.resources.maxHp * hpMul)
  adv.resources.hp    = adv.resources.maxHp
  adv.stats.attack    = Math.round(adv.stats.attack * atkMul)
}

export function spawnWave(scene, gs, systems) {
  const all = scene.cache.json.get('adventurerClasses') ?? []
  const bossLv = gs.boss?.level ?? 1
  const day    = gs.meta?.dayNumber ?? 1
  const classes = all.filter(c =>
    (c.unlockLevel ?? 1) <= bossLv && (c.unlockDay ?? 1) <= day)
  if (!classes.length) return []

  let count = Balance.ADVENTURERS_PER_DAY_BASE + Math.floor((day - 1) / 2)
  count += Math.max(0, day - 9) * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
  count = Math.max(1, count)

  const { aiSystem, personalitySystem, knowledgeSystem } = systems
  const partyId = uid('party')
  const pCount = 1 + Math.floor((bossLv - 1) / 5)
  const spawned = []
  for (let i = 0; i < count; i++) {
    try {
      const cls = pickWeightedClass(classes) ?? classes[0]
      const tile = aiSystem.pickSpawnTile?.() ?? null
      if (!tile) continue
      const adv = createAdventurer(cls, { x: tile.x, y: tile.y })
      scaleAdv(adv, bossLv, day)
      adv.partyId = count > 1 ? partyId : null
      adv.personalityIds = personalitySystem?.rollPersonalities?.(pCount, bossLv) ?? []
      knowledgeSystem?.initKnowledgeForSpawn?.(adv, Balance.KNOWLEDGE_FRESH_INHERIT_CHANCE ?? 0)
      gs.adventurers.active.push(adv)
      spawned.push(adv)
      aiSystem.pickInitialGoal?.(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
    } catch (e) { /* skip broken slot, like DayPhase */ }
  }
  return spawned
}

// ── Run one day: spawn wave, tick until everyone is out / boss falls ──────────
export function runDay(ctx, { maxFrames = 20000 } = {}) {
  const { scene, gs, systems } = ctx
  const errors = []
  gs.meta.phase = 'day'
  EventBus.emit('DAY_PHASE_STARTED', { day: gs.meta.dayNumber })
  const wave = spawnWave(scene, gs, systems)

  const startKills = gs.player.totalKills ?? 0
  const bossDeaths0 = gs.boss?.deathsRemaining ?? 3
  let frames = 0, idle = 0
  for (; frames < maxFrames; frames++) {
    frame(scene, systems, { ts: 1, onError: (n, e) => errors.push(`${n}: ${e.message}`) })
    const active = gs.adventurers.active.length
    const fighting = !!(systems.bossSystem?._fighting)
    if (active === 0 && !fighting) { if (++idle > 40) break } else idle = 0
    if ((gs.boss?.deathsRemaining ?? 3) < bossDeaths0) break   // boss lost a life this day
  }

  const result = {
    day: gs.meta.dayNumber,
    bossLevel: gs.boss?.level,
    waveSize: wave.length,
    frames,
    kills: (gs.player.totalKills ?? 0) - startKills,
    escaped: gs.adventurers.active.length,   // anyone still active when we bailed
    graveyard: gs.adventurers.graveyard.length,
    bossHp: gs.boss?.hp, bossMaxHp: gs.boss?.maxHp,
    bossDeathsRemaining: gs.boss?.deathsRemaining,
    bossLostLife: (gs.boss?.deathsRemaining ?? 3) < bossDeaths0,
    errors: [...new Set(errors)].slice(0, 8),
  }
  return result
}

// ── End-of-day reset — mirrors DayPhase._endDay (boss+minion HP refill) ───────
export function endDay(gs) {
  const active = gs.adventurers.active
  while (active.length > 0) active.shift()              // force-despawn stragglers
  if (gs.boss) gs.boss.hp = gs.boss.maxHp               // boss refills for the next day
  for (const m of gs.minions ?? []) {                   // survivors top up; dead stay dead
    if (m.aiState === 'dead') continue
    if (m.resources?.maxHp > 0) m.resources.hp = m.resources.maxHp
  }
  gs.meta.dayNumber++
  gs.meta.phase = 'night'
  gs.player.totalDaysElapsed = (gs.player.totalDaysElapsed ?? 0) + 1
  EventBus.emit('DAY_PHASE_ENDED')
}

// ── Run a whole game: day/night until the boss dies 3× or maxDays ─────────────
export function runGame({ boss = 'lich', maxDays = 80, loadout = null, pacts = [], build = null, onDay = null } = {}) {
  const ctx = boot({ boss })
  const { gs, scene, grid, systems } = ctx
  // Seal any requested pacts before the run (player sealing = fresh seal effects).
  if (pacts.length) {
    gs.activeMechanics ??= []
    for (const p of pacts) { try { systems.dungeonMechanicSystem.activate(p) } catch { /* skip bad pact */ } }
  }
  const buildCfg = build === true ? {} : build
  EventBus.emit('NIGHT_PHASE_STARTED', { day: 1 })
  buildNight(scene, gs, grid)
  let placed = loadout ? placeLoadout(scene, gs, grid, loadout) : { minions: 0, traps: 0 }
  if (buildCfg) placed = buildNightDefenses(scene, gs, grid, buildCfg)   // night-1 build

  const days = []
  let outcome = 'survivedMaxDays', goldSpent = 0
  for (let d = 1; d <= maxDays; d++) {
    const r = runDay(ctx)
    days.push(r)
    onDay?.(gs, r, ctx)   // hook: soak-test invariant checks, instrumentation
    if ((gs.boss?.deathsRemaining ?? 3) <= 0) { outcome = 'bossDied'; break }
    // Night: end-of-day reset (boss/minion HP refill + day advance), then re-arm.
    endDay(gs)
    EventBus.emit('NIGHT_PHASE_STARTED', { day: gs.meta.dayNumber })
    openAllDoors(gs)
    if (buildCfg) { const b = buildNightDefenses(scene, gs, grid, buildCfg); goldSpent += b.spent; placed = b }
  }

  const livesHad = gs.boss?.totalLivesEverHad ?? 3
  return {
    boss, outcome, placed, goldSpent,
    daysSurvived: days.length,
    finalBossLevel: gs.boss?.level ?? 1,
    totalKills: gs.player?.totalKills ?? 0,
    bossLivesLost: livesHad - (gs.boss?.deathsRemaining ?? livesHad),
    peakWave: days.reduce((m, x) => Math.max(m, x.waveSize), 0),
    days,
  }
}

// ── Milestone test: boot, build a connected dungeon, run ONE day ──────────────
if (process.argv[1]?.endsWith('harness.mjs')) {
  const boss = process.argv[3] || 'lich'
  if (process.argv[2] === 'game') {
    const loadout = { minions: ['skeleton1', 'skeleton1', 'goblin1', 'goblin1', 'orc1', 'orc1'], traps: ['shooting_arrows', 'spike_pit'] }
    for (const [label, lo] of [['BARE', null], ['DEFENDED', loadout]]) {
      const t0 = Date.now()
      const g = runGame({ boss, maxDays: 60, loadout: lo })
      console.log(`\n${label} ${boss} (${Date.now() - t0}ms): outcome=${g.outcome} daysSurvived=${g.daysSurvived} finalLv=${g.finalBossLevel} kills=${g.totalKills} livesLost=${g.bossLivesLost} placed=${JSON.stringify(g.placed)}`)
      console.log('  per-day: ' + g.days.map(d => `d${d.day}(lv${d.bossLevel},w${d.waveSize},k${d.kills})`).join(' '))
    }
  } else {
    const ctx = boot({ boss })
    EventBus.emit('NIGHT_PHASE_STARTED', { day: 1 })
    buildNight(ctx.scene, ctx.gs, ctx.grid)
    const t0 = Date.now()
    const r = runDay(ctx)
    console.log(`day 1 (${Date.now() - t0}ms):`, JSON.stringify(r))
  }
}
