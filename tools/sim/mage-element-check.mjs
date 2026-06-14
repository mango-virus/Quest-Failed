// Headless effect-test for the Mage Elemental Arcana rework. Drives CombatSystem's
// element helpers directly against hand-built minions and asserts the EFFECTS
// (burn DoT / chill slow / lightning chain / wind knockback + the two burst
// shapes), since the flaky preview proxy can wedge on boot.
//   node tools/sim/mage-element-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { CombatSystem } from '../../src/systems/CombatSystem.js'
import { TILE } from '../../src/systems/DungeonGrid.js'

installGlobals()
const scene = makeScene()
// Stub a grid that reports every tile as open floor (so wind knockback can move).
scene.dungeonGrid = { getTileType: () => TILE.FLOOR }
const now = scene.time?.now ?? 0

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
const TS = 32
function mage(el) {
  return { instanceId: `mage${uid++}`, classId: 'mage', _element: el, tileX: 24, tileY: 28,
    worldX: 24 * TS + 16, worldY: 28 * TS + 16, resources: { hp: 25, maxHp: 25 }, stats: { attack: 12 } }
}
function minion(tx, ty) {
  return { instanceId: `m${uid++}`, definitionId: 'goblin1', faction: 'dungeon', aiState: 'idle',
    tileX: tx, tileY: ty, worldX: tx * TS + 16, worldY: ty * TS + 16,
    resources: { hp: 40, maxHp: 40 }, stats: { speed: 1, attack: 5, defense: 2 } }
}
function setup(extraMinions = []) {
  const gs = { adventurers: { active: [] }, minions: [...extraMinions], player: { gold: 0 }, _mechanicFlags: {} }
  return { gs, cb: new CombatSystem(scene, gs) }
}

// 1. FIRE — applies a burn DoT.
{
  const t = minion(24, 24); const { cb } = setup([t]); const m = mage('fire')
  cb._applyMageElement(m, t, 12, false)
  const burn = (t._dot ?? []).find(d => d.type === 'burn')
  check('fire: burn DoT applied', !!burn && burn.dmgPerTick >= 2 && burn.ticksLeft === 3, JSON.stringify(burn))
  // Re-apply refreshes (does NOT stack a 2nd dot).
  cb._applyMageElement(m, t, 12, false)
  check('fire: re-hit refreshes, no stacking', (t._dot ?? []).filter(d => d.type === 'burn').length === 1, `${(t._dot ?? []).length} dots`)
}

// 2. ICE — applies a movement slow.
{
  const t = minion(24, 24); const { cb } = setup([t]); const m = mage('ice')
  cb._applyMageElement(m, t, 12, false)
  check('ice: slow applied', (t._slowUntil ?? 0) > now && t._slowMult === 0.6, `until=${t._slowUntil} mult=${t._slowMult}`)
}

// 3. LIGHTNING — chains to a nearby minion, and the per-hit chain is gated.
{
  const t = minion(24, 24); const nbr = minion(25, 24); const { cb } = setup([t, nbr]); const m = mage('lightning')
  m._arcLastAt = -999999   // chain "ready" (far past)
  const before = nbr.resources.hp
  cb._applyMageElement(m, t, 12, false)
  check('lightning: chains to a neighbor', nbr.resources.hp < before, `nbr ${before}->${nbr.resources.hp}`)
  // Immediately again with the gate fresh → no further chain.
  const nbr2hp = nbr.resources.hp
  m._arcLastAt = scene.time?.now ?? now   // force "just chained"
  cb._applyMageElement(m, t, 12, false)
  check('lightning: per-hit chain is gated', nbr.resources.hp === nbr2hp, `nbr ${nbr2hp}->${nbr.resources.hp}`)
}

// 4. WIND — knocks the target back one tile, directly away from the mage.
{
  const t = minion(24, 24); const { cb } = setup([t]); const m = mage('wind')  // mage at y28, target at y24 (above)
  m._gustLastAt = -999999   // shove "ready" (far past)
  const beforeY = t.tileY
  cb._applyMageElement(m, t, 12, false)
  check('wind: knocks target away from mage', t.tileY === beforeY - 1, `tileY ${beforeY}->${t.tileY}`)
}

// 5. ARCANE BURST — lightning = a branching bolt hopping several minions.
{
  const t = minion(24, 24); const n1 = minion(25, 24); const n2 = minion(26, 24); const n3 = minion(27, 24)
  const { cb } = setup([t, n1, n2, n3]); const m = mage('lightning')
  const b = [n1, n2, n3].map(x => x.resources.hp)
  cb._fireArcaneBurst(m, t, 20, 'lightning')
  const hopped = [n1, n2, n3].filter((x, i) => x.resources.hp < b[i]).length
  check('burst lightning: bolt hops >=2 minions', hopped >= 2, `hopped ${hopped}`)
}

// 6. ARCANE BURST — fire = radial AoE that also burns the neighbors.
{
  const t = minion(24, 24); const n1 = minion(24, 25); const n2 = minion(25, 24)
  const { cb } = setup([t, n1, n2]); const m = mage('fire')
  const b = [n1, n2].map(x => x.resources.hp)
  cb._fireArcaneBurst(m, t, 20, 'fire')
  const splashed = [n1, n2].filter((x, i) => x.resources.hp < b[i]).length
  const burned = [n1, n2].filter(x => (x._dot ?? []).some(d => d.type === 'burn')).length
  check('burst fire: radial splashes neighbors', splashed === 2, `splashed ${splashed}`)
  check('burst fire: neighbors also burn', burned === 2, `burned ${burned}`)
}

console.log('\nMage Elemental Arcana effect checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
