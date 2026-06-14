// Headless correctness check for the GHOST chain — mechanic: FEAR (nerve warfare).
//   node tools/sim/ghost-fear-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'

installGlobals()
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
const near = (a, b, e = 0.01) => Math.abs(a - b) < e

let uid = 0
function room() { return { instanceId: 'r1', definitionId: 'crypt', gridX: 0, gridY: 0, width: 12, height: 12 } }
function gs() { return { minions: [], adventurers: { active: [], graveyard: [] }, dungeon: { rooms: [room()], hazards: [] }, player: {}, boss: { level: 4 }, _mechanicFlags: {} } }
function ghost(id, over = {}) {
  const d = byId[id], b = d.baseStats
  return { instanceId: `m${uid++}`, definitionId: id, tags: [...(d.tags ?? [])], tileX: 6, tileY: 6, worldX: 192, worldY: 192, assignedRoomId: 'r1', faction: 'dungeon', aiState: 'fighting', stats: { attack: b.attack, defense: b.defense, speed: b.speed }, resources: { hp: b.hp, maxHp: b.hp }, ...over }
}
function adv(over = {}) { return { instanceId: `a${uid++}`, classId: 'knight', tileX: 6, tileY: 6, worldX: 192, worldY: 192, assignedRoomId: 'r1', partyId: 'p1', aiState: 'fighting', nerve: 80, mood: 'bold', resources: { hp: 100, maxHp: 100 }, ...over } }
const abOf = (id, type) => (byId[id].abilities ?? []).find(a => a.type === type)

// ── T1 Dread — fear-on-hit drains the struck hero's nerve + updates the band ──
{
  const g = gs(); const gh = ghost('ghost1'); const a = adv({ nerve: 80, mood: 'bold' })
  g.minions.push(gh); g.adventurers.active.push(a)
  MinionAbilities._applyHitAbility(scene, gh, a, 5, g, abOf('ghost1', 'fear'))
  check('T1 fear-on-hit drains nerve', a.nerve === 71, `nerve=${a.nerve}`)
  check('T1 fear updates the mood band (bold→steady)', a.mood === 'steady', `mood=${a.mood}`)
}
// _applyFear clamps at 0 and reports nerve lost; a non-adv (no nerve) is ignored.
{
  const g = gs(); const a = adv({ nerve: 5 })
  check('_applyFear clamps nerve at 0', (MinionAbilities._applyFear(a, -20, scene), a.nerve === 0))
  check('_applyFear returns the amount lost', MinionAbilities._applyFear(adv({ nerve: 50 }), -12, scene) === 12)
  check('_applyFear ignores a non-adventurer (no nerve)', MinionAbilities._applyFear({ aiState: 'fighting' }, -10, scene) === null)
}

// ── T1 Dread presence — dreadAura bleeds nerve off nearby advs, not far/non-adv ──
{
  const g = gs(); const gh = ghost('ghost1', { tileX: 6, tileY: 6 })
  const nearA = adv({ tileX: 7, tileY: 6, nerve: 80 }); const farA = adv({ tileX: 11, tileY: 11, nerve: 80 })
  g.minions.push(gh); g.adventurers.active.push(nearA, farA)
  MinionAbilities._dreadAura(gh, scene, g, abOf('ghost1', 'dreadAura'))
  check('T1 dread aura bleeds nerve off a NEARBY hero', nearA.nerve < 80, `nerve=${nearA.nerve}`)
  check('T1 dread aura does NOT reach a far hero', farA.nerve === 80, `nerve=${farA.nerve}`)
}

// ── T2 Haunt — onHit sets the haunt window; tickGhost bleeds nerve then expires ──
{
  const g = gs(); const gh = ghost('ghost2'); const a = adv({ nerve: 70, mood: 'steady' })
  g.minions.push(gh); g.adventurers.active.push(a)
  MinionAbilities._applyHitAbility(scene, gh, a, 5, g, abOf('ghost2', 'haunt'))
  check('T2 haunt sets a haunt window', (a._hauntedUntil ?? 0) > scene.time.now)
  const before = a.nerve
  MinionAbilities.tickGhost(scene, g, 1000)   // 1s of haunt
  check('T2 tickGhost bleeds a haunted hero\'s nerve', a.nerve < before, `before=${before} after=${a.nerve}`)
  // window expires
  scene.time.now += 6000
  MinionAbilities.tickGhost(scene, g, 16)
  check('T2 haunt expires after its window', (a._hauntedUntil ?? 0) === 0, `until=${a._hauntedUntil}`)
}

// ── T2 Contagion — a haunted hero leaks dread to a nearby party-mate, not a far one ──
{
  const g = gs(); const gh = ghost('ghost2'); g.minions.push(gh)
  const h = adv({ tileX: 6, tileY: 6, nerve: 60 })
  const mate = adv({ tileX: 7, tileY: 6, nerve: 80, partyId: 'p1' })
  const far = adv({ tileX: 11, tileY: 11, nerve: 80, partyId: 'p1' })
  g.adventurers.active.push(h, mate, far)
  MinionAbilities._applyHitAbility(scene, gh, h, 5, g, abOf('ghost2', 'haunt'))
  MinionAbilities.tickGhost(scene, g, 1000)
  check('T2 contagion bites a NEARBY party-mate', mate.nerve < 80, `nerve=${mate.nerve}`)
  check('T2 contagion does NOT reach a far party-mate', far.nerve === 80, `nerve=${far.nerve}`)
}

// ── T2 Fumble — a HAUNTED, Spooked/Breaking hero fights worse; others normal ──
{
  const now = scene.time.now
  const haunted = adv({ nerve: 15, mood: 'breaking', _hauntedUntil: now + 5000, _hauntFumbleMul: 0.65 })
  const hauntedCalm = adv({ nerve: 70, mood: 'steady', _hauntedUntil: now + 5000, _hauntFumbleMul: 0.65 })
  const plain = adv({ nerve: 15, mood: 'breaking' })
  check('T2 fumble: haunted + Breaking hero deals reduced damage', near(MinionAbilities.fearAtkMul(haunted, now), 0.65), `mul=${MinionAbilities.fearAtkMul(haunted, now)}`)
  check('T2 fumble: haunted but CALM (Steady) hero is unaffected', near(MinionAbilities.fearAtkMul(hauntedCalm, now), 1))
  check('T2 fumble: an un-haunted Breaking hero is unaffected', near(MinionAbilities.fearAtkMul(plain, now), 1))
}

// ── T3 Pall of Dread — craters every room hero's nerve to the floor (mass rout) ──
{
  const g = gs(); const w = ghost('dark_wraith'); g.minions.push(w)
  const a1 = adv({ tileX: 2, tileY: 2, nerve: 85, mood: 'bold' })
  const a2 = adv({ tileX: 10, tileY: 10, nerve: 60, mood: 'steady' })
  const aLow = adv({ tileX: 6, tileY: 6, nerve: 6, mood: 'breaking' })   // already below the floor
  g.adventurers.active.push(a1, a2, aLow)
  const ab = abOf('dark_wraith', 'pallOfDread')
  MinionAbilities._pallOfDread(w, scene, g, ab)
  check('T3 Pall craters a bold hero to the floor', a1.nerve === ab.nerveFloor, `nerve=${a1.nerve}`)
  check('T3 Pall craters a steady hero to the floor', a2.nerve === ab.nerveFloor, `nerve=${a2.nerve}`)
  check('T3 Pall sends them to Breaking (→ rout)', a1.mood === 'breaking' && a2.mood === 'breaking', `${a1.mood}/${a2.mood}`)
  check('T3 Pall never RAISES a hero already below the floor', aLow.nerve === 6, `nerve=${aLow.nerve}`)
}

// ── Data wiring ──
check('ghost1 has Dread (fear + dreadAura)', !!abOf('ghost1', 'fear') && !!abOf('ghost1', 'dreadAura'))
check('ghost2 has Haunt (+ keeps fear)', !!abOf('ghost2', 'haunt') && !!abOf('ghost2', 'fear'))
check('dark_wraith has the Pall of Dread ult (+ fear + haunt)', !!abOf('dark_wraith', 'pallOfDread') && !!abOf('dark_wraith', 'haunt') && !!abOf('dark_wraith', 'fear'))
check('ghost2 stays UPGRADE-only (unlock 99, gold 0)', byId['ghost2'].unlockLevel === 99 && byId['ghost2'].goldCost === 0, `unlock=${byId['ghost2'].unlockLevel} gold=${byId['ghost2'].goldCost}`)
check('dark_wraith stays a miniboss', (byId['dark_wraith'].tags ?? []).includes('miniboss'))

console.log('\nGhost — FEAR kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
