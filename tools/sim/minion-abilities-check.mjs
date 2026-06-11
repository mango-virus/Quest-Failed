// Headless correctness harness for the data-driven minion ability layer
// (Thread E runner + D signatures + Widen families + B flavor wires).
// Reuses the sim's fake scene (real JSON cache, no-op VFX) and drives the
// MinionAbilities trigger entrypoints directly, asserting state changes.
//
//   node tools/sim/minion-abilities-check.mjs
//
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'
import { MinionAISystem } from '../../src/systems/MinionAISystem.js'

installGlobals()   // stub global Phaser (BlendModes) so AbilityVfx.shockwaveFx runs
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0
const results = []
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  ✓ ${name}`) }
  else { fail++; results.push(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function room() { return { instanceId: 'r1', definitionId: 'starter_barracks', gridX: 0, gridY: 0, width: 12, height: 12 } }
function gs() {
  return { minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()], hazards: [] }, player: { gold: 0 }, _mechanicFlags: {} }
}
let _uid = 0
function minion(id, over = {}) {
  const d = byId[id]; const b = d.baseStats
  return {
    instanceId: `m${_uid++}`, definitionId: id, tags: [...(d.tags ?? [])],
    tileX: 5, tileY: 5, worldX: 160, worldY: 160, homeTileX: 5, homeTileY: 5,
    assignedRoomId: 'r1', faction: 'dungeon', behaviorType: d.behaviorType, damageType: b.damageType,
    attackRange: b.attackRange ?? 1, aiState: 'idle', currentTargetId: null,
    stats: { hp: b.hp, attack: b.attack, defense: b.defense ?? 0, speed: b.speed ?? 1, abilities: [] },
    resources: { hp: b.hp, maxHp: b.hp }, bossLevel: 1, ...over,
  }
}
function adv(over = {}) {
  return {
    instanceId: `a${_uid++}`, classId: 'knight', tileX: 5, tileY: 5, worldX: 160, worldY: 160,
    aiState: 'walking', nerve: 100, partyId: 'p1',
    stats: { speed: 1, defense: 4 }, resources: { hp: 100, maxHp: 100 }, ...over,
  }
}
function tick(ms) { scene.time.now += ms; return ms }

// ── onHit: slow (Vinekin/Frost/Web) ───────────────────────────────────────
{
  const g = gs(); const m = minion('plant1'); const a = adv(); g.minions.push(m); g.adventurers.active.push(a)
  MinionAbilities.runHitAbilities(scene, m, a, 5, g)
  check('plant1 slow applies _slowMult<1', (a._slowMult ?? 1) < 1 && a._slowUntil > scene.time.now)
  check('slowMult() query reflects slow', MinionAbilities.slowMult(a, scene.time.now) < 1)
}
// ── onHit: dot (zombie2 Rotbite) ──────────────────────────────────────────
{
  const g = gs(); const m = minion('zombie2'); const a = adv(); g.adventurers.active.push(a)
  MinionAbilities.runHitAbilities(scene, m, a, 5, g)
  const hasPoison = Array.isArray(a._dot) && a._dot.some(d => d.type === 'poison')
  check('zombie2 applies poison DoT', hasPoison)
  const before = a.resources.hp
  tick(1000); MinionAbilities.tickEntity(a, scene, 1000)
  check('DoT ticks damage', a.resources.hp < before, `hp ${before}->${a.resources.hp}`)
}
// ── onHit: root chance (ent3 Entangle) forced ─────────────────────────────
{
  const g = gs(); const m = minion('ent3'); const a = adv()
  const rr = Math.random; Math.random = () => 0  // force the 0.25 chance
  MinionAbilities.runHitAbilities(scene, m, a, 5, g)
  Math.random = rr
  check('ent3 Entangle roots (forced)', MinionAbilities.isRooted(a, scene.time.now))
}
// ── onHit: nerveDrain (ghost2 Sorrow Wisp) ────────────────────────────────
{
  const g = gs(); const m = minion('ghost2'); const a = adv({ nerve: 80 })
  MinionAbilities.runHitAbilities(scene, m, a, 5, g)
  check('ghost2 drains nerve by 16', a.nerve === 64, `nerve=${a.nerve}`)
}
// ── onHit: armorShred (rust1) ─────────────────────────────────────────────
{
  const g = gs(); const m = minion('rust1'); const a = adv()
  MinionAbilities.runHitAbilities(scene, m, a, 5, g)
  check('rust1 shreds armor', MinionAbilities.armorShredOf(a, scene.time.now) >= 2)
}
// ── passive: Shieldwall (skeleton3) requires same-room undead ally ─────────
{
  const g = gs(); const sk = minion('skeleton3'); const atk = minion('goblin1')
  // Alone — no reduction.
  const mulAlone = MinionAbilities.damageTakenMul(sk, atk, g, scene)
  // With an undead ally in room — reduction engages.
  g.minions.push(sk, minion('skeleton1'))
  const mulFormation = MinionAbilities.damageTakenMul(sk, atk, g, scene)
  check('skeleton3 Shieldwall inert when alone', mulAlone === 1, `mul=${mulAlone}`)
  check('skeleton3 Shieldwall reduces with ally', mulFormation < 1, `mul=${mulFormation}`)
}
// ── passive: Ent Gnarled Hide is handled in CombatSystem (not data) ────────
// (verified separately; ent abilities here only add Entangle.)

// ── onDeath: split (elder_slime1, all tiers) ──────────────────────────────
{
  const g = gs(); const m = minion('elder_slime1'); g.minions.push(m)
  MinionAbilities.runDeathAbilities(scene, m, g)
  const kids = g.minions.filter(x => x._isMiniSlime)
  check('elder_slime1 splits into 2', kids.length === 2, `kids=${kids.length}`)
  // mini-slime must not re-split
  const kid = kids[0]; const before = g.minions.length
  MinionAbilities.runDeathAbilities(scene, kid, g)
  check('mini-slime does not re-split', g.minions.length === before)
}
// ── onDeath: legacy aoe/staggerCloud still fire via old code path ──────────
// (imp1/mushroom1 remain hard-coded; exercised by soak.)

// ── onTick: healAura on ALL lich tiers (lich1 + elder_lich) ───────────────
for (const lid of ['lich1', 'lich2', 'elder_lich']) {
  const g = gs(); const l = minion(lid); const ally = minion('skeleton1')
  ally.resources.hp = 5  // wounded undead ally
  g.minions.push(l, ally)
  MinionAbilities.tickAbilities(l, scene, g, null, 3000)
  check(`${lid} heal aura heals wounded undead`, ally.resources.hp > 5, `hp=${ally.resources.hp}`)
}
// ── onTick: reviveAlly (elder_lich Raise Dead) ────────────────────────────
{
  const g = gs(); const l = minion('elder_lich'); const dead = minion('skeleton1', { aiState: 'dead' })
  dead.resources.hp = 0
  g.minions.push(l, dead)
  MinionAbilities.tickAbilities(l, scene, g, null, 14000)
  check('elder_lich Raise Dead revives a fallen undead', dead.aiState === 'idle' && dead.resources.hp > 0 && dead._raisedAdd === true)
}
// ── onTick: buffAura (cmd1 Rally) ─────────────────────────────────────────
{
  const g = gs(); const c = minion('cmd1'); const ally = minion('goblin1'); g.minions.push(c, ally)
  MinionAbilities.tickAbilities(c, scene, g, null, 1000)
  check('cmd1 Rally buffs ally ATK', (ally._rallyAtkMul ?? 1) > 1 && ally._rallyUntil > scene.time.now)
}
// ── onTick: contagionAura (zombie3 Crypt Lord) ────────────────────────────
{
  const g = gs(); const z = minion('zombie3'); const a = adv(); g.minions.push(z); g.adventurers.active.push(a)
  const before = a.resources.hp
  MinionAbilities.tickAbilities(z, scene, g, null, 1500)
  check('zombie3 contagion damages same-room adv', a.resources.hp < before, `hp ${before}->${a.resources.hp}`)
}
// ── onTick: summon (bone_totem1) + cap ────────────────────────────────────
{
  const g = gs(); const t = minion('bone_totem1'); g.minions.push(t)
  for (let i = 0; i < 5; i++) MinionAbilities.tickAbilities(t, scene, g, null, 6000)
  const adds = g.minions.filter(x => x._isSummonedAdd && x.definitionId === 'swarmling')
  check('bone_totem1 summons swarmlings', adds.length >= 1)
  check('bone_totem1 respects summon cap (3)', adds.length <= 3, `adds=${adds.length}`)
}
// ── onTick + tickHazards: hazardTrail (rust1) ─────────────────────────────
{
  const g = gs(); const m = minion('rust1', { tileX: 3, tileY: 3 }); g.minions.push(m)
  m._lastHazardTile = { x: 99, y: 99 }  // force "moved"
  MinionAbilities.tickAbilities(m, scene, g, null, 1500)
  check('rust1 drops a hazard zone', (g.dungeon.hazards ?? []).length === 1)
  const a = adv({ tileX: 3, tileY: 3 }); g.adventurers.active.push(a)
  const before = a.resources.hp
  tick(1000); MinionAbilities.tickHazards(scene, g, 1000)
  check('hazard zone damages adv standing in it', a.resources.hp < before, `hp ${before}->${a.resources.hp}`)
}

// ── Thread C: reactive wounded states ─────────────────────────────────────
{
  const arch = (id) => MinionAISystem.prototype._archetypeOf.call(null, minion(id))
  check('archetype: imp1 (range 3) = ranged', arch('imp1').ranged === true)
  check('archetype: ghost1 (range 5) = ranged', arch('ghost1').ranged === true)
  check('archetype: cmd1 (commander) = support', arch('cmd1').support === true)
  check('archetype: goblin1 = bruiser', arch('goblin1').bruiser === true)
  check('archetype: bone_totem1 (summoner) = support', arch('bone_totem1').support === true)
}
{
  // ENRAGE: a wounded bruiser flags _enraged (movement not owned → returns false).
  const stub = Object.create(MinionAISystem.prototype)
  stub._scene = scene; stub._dungeonGrid = null
  stub._gameState = { dungeon: { rooms: [room()] } }
  stub._combatSystem = { tryAttack() {} }
  const m = minion('goblin1'); m.resources.hp = 4  // ~17% of 24
  const a = adv({ tileX: 8, tileY: 8 })
  const owned = MinionAISystem.prototype._reactiveCombat.call(stub, m, a, 3, 1, 16)
  check('wounded bruiser becomes enraged', m._enraged === true)
  check('enrage does not own movement (falls through)', owned === false)
  // Healed above threshold clears it.
  m.resources.hp = 24
  MinionAISystem.prototype._reactiveCombat.call(stub, m, a, 3, 1, 16)
  check('enrage clears when healed', m._enraged === false)
  // Orc excluded (own Berserker Rage).
  const orc = minion('orc1'); orc.resources.hp = 2
  MinionAISystem.prototype._reactiveCombat.call(stub, orc, a, 3, 1, 16)
  check('orc excluded from generic enrage', !orc._enraged)
  // Ranged is not a bruiser → never enrages.
  const imp = minion('imp1'); imp.resources.hp = 2
  MinionAISystem.prototype._reactiveCombat.call(stub, imp, a, 5, 3, 16)
  check('ranged minion does not enrage', !imp._enraged)
}

// ── Thread E migration parity (legacy effects now data-driven) ────────────
{
  const g = gs(); const a = adv()
  MinionAbilities.runHitAbilities(scene, minion('rat1'), a, 5, g)
  check('migrated: rat1 poison DoT', Array.isArray(a._dot) && a._dot.some(d => d.type === 'poison'))
}
{
  const g = gs(); const a = adv()
  MinionAbilities.runHitAbilities(scene, minion('demon1'), a, 5, g)
  check('migrated: demon1 burn DoT', Array.isArray(a._dot) && a._dot.some(d => d.type === 'burn'))
}
{
  const g = gs(); const a = adv(); const rr = Math.random; Math.random = () => 0
  MinionAbilities.runHitAbilities(scene, minion('beholder1'), a, 5, g)
  Math.random = rr
  check('migrated: beholder1 Petrify roots (forced)', MinionAbilities.isRooted(a, scene.time.now))
}
{
  const g = gs(); const a = adv(); const rr = Math.random; Math.random = () => 0
  MinionAbilities.runHitAbilities(scene, minion('golem1'), a, 5, g)
  Math.random = rr
  check('migrated: golem1 Earthshake staggers (forced)', MinionAbilities.isStaggered(a, scene.time.now))
}
{
  const g = gs(); const m = minion('plant1'); const a = adv()
  MinionAbilities.runHitAbilities(scene, m, a, 5, g)
  check('migrated: plant1 snare roots first hit', MinionAbilities.isRooted(a, scene.time.now))
  // oncePerFight: a second hit on a fresh target should NOT re-root.
  const a2 = adv({ tileX: 6 })
  MinionAbilities.runHitAbilities(scene, m, a2, 5, g)
  check('migrated: plant1 snare is once-per-fight', !MinionAbilities.isRooted(a2, scene.time.now))
}
{
  const g = gs(); const imp = minion('imp1'); const a = adv({ tileX: 5, tileY: 5 })
  g.adventurers.active.push(a); const before = a.resources.hp
  MinionAbilities.runDeathAbilities(scene, imp, g)
  check('migrated: imp1 Self-Combust AoE damages nearby adv', a.resources.hp < before)
}
{
  const g = gs(); const mush = minion('mushroom1'); const a = adv({ tileX: 5, tileY: 5 })
  g.adventurers.active.push(a)
  MinionAbilities.runDeathAbilities(scene, mush, g)
  check('migrated: mushroom1 Confusion Spores stagger nearby adv', MinionAbilities.isStaggered(a, scene.time.now))
}

// ── Miniboss ults (novaBurst + gnoll buffAura) ────────────────────────────
{
  const g = gs(); const m = minion('demon_lord'); const a = adv({ tileX: 5, tileY: 5 })
  g.minions.push(m); g.adventurers.active.push(a); const before = a.resources.hp
  MinionAbilities.tickAbilities(m, scene, g, null, 6000)
  check('demon_lord Hellfire Nova damages room', a.resources.hp < before)
  check('demon_lord Nova applies burn', Array.isArray(a._dot) && a._dot.some(d => d.type === 'burn'))
}
{
  const g = gs(); const m = minion('vampire_sovereign'); m.resources.hp = 50  // wounded so heal shows
  const a = adv({ tileX: 5, tileY: 5 }); g.minions.push(m); g.adventurers.active.push(a)
  MinionAbilities.tickAbilities(m, scene, g, null, 6000)
  check('vampire_sovereign Sanguine Drain heals self', m.resources.hp > 50, `hp=${m.resources.hp}`)
}
{
  const g = gs(); const m = minion('beholder_tyrant'); const a = adv({ tileX: 6, tileY: 5 })
  g.minions.push(m); g.adventurers.active.push(a)
  MinionAbilities.tickAbilities(m, scene, g, null, 8000)
  check('beholder_tyrant Gaze roots the room', MinionAbilities.isRooted(a, scene.time.now))
}
{
  const g = gs(); const m = minion('golem_warden'); const near = adv({ tileX: 6, tileY: 5 }); const far = adv({ tileX: 11, tileY: 11 })
  g.minions.push(m); g.adventurers.active.push(near, far); const nb = near.resources.hp, fb = far.resources.hp
  MinionAbilities.tickAbilities(m, scene, g, null, 6000)
  check('golem_warden Seismic Slam hits within radius', near.resources.hp < nb)
  check('golem_warden Slam spares out-of-radius adv', far.resources.hp === fb)
  check('golem_warden Slam staggers', MinionAbilities.isStaggered(near, scene.time.now))
}
{
  const g = gs(); const m = minion('dark_wraith'); const a = adv({ tileX: 5, tileY: 5, nerve: 90 })
  g.minions.push(m); g.adventurers.active.push(a)
  MinionAbilities.tickAbilities(m, scene, g, null, 5000)
  check('dark_wraith Wail drains nerve', a.nerve < 90, `nerve=${a.nerve}`)
}
{
  const g = gs(); const m = minion('gnoll_alpha'); const ally = minion('gnoll1'); g.minions.push(m, ally)
  MinionAbilities.tickAbilities(m, scene, g, null, 1000)
  check('gnoll_alpha rallies the pack (ATK buff)', (ally._rallyAtkMul ?? 1) > 1)
}

console.log('\nMinion ability runner — correctness checks\n')
console.log(results.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
