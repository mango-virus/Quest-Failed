// Headless correctness check for the NERVE → PLAYER-POSITIVE rework.
//   node tools/sim/nerve-rework-check.mjs
// Uses the real CombatSystem + AISystem (via boot) plus a standalone NerveSystem,
// and MinionAbilities directly, to assert: panic-in-place (not flee), bold = no
// retreat, flee gold-drop, panic/flee damage vulnerability + attack-suppress,
// guild panic-spread, and Pall of Dread = mass panic.
import { boot } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'
import { NerveSystem } from '../../src/systems/NerveSystem.js'
import { EventBus } from '../../src/systems/EventBus.js'

const { scene, gs, grid, systems } = boot({ boss: 'lich' })
const ai = systems.aiSystem, cs = systems.combatSystem

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
let uid = 0
const adv = (o = {}) => ({ instanceId: `a${uid++}`, classId: 'knight', faction: 'adventurer', tileX: 5, tileY: 5, worldX: 160, worldY: 160, aiState: 'walking', nerve: 80, mood: 'steady', goal: { type: 'EXPLORE_ROOM' }, resources: { hp: 100, maxHp: 100 }, stats: { attack: 10, defense: 0, speed: 1 }, ...o })

// ── A: morale break → a DISTINCT, player-positive affliction (briefing #5, 2026-06-23) ──
// A break no longer ALWAYS panics in place — it rolls one of several breakdown beats
// (terror/rout/despair/paranoia/hysteria). EVERY outcome must still cash out as a
// player win (helpless, or committed to a flee/attack), never a clean free escape.
{
  gs.minions = [{ instanceId: 'm1', faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, resources: { hp: 10 } }]
  const seen = {}; let allPositive = true; let badT = null
  for (let i = 0; i < 60; i++) {
    scene.time.now += 100
    const a = adv({ mood: 'breaking', nerve: 5, resources: { hp: 50, maxHp: 100 } })
    gs.adventurers.active = [a]; gs.player.gold = 1000
    ai._afflict(a)
    const t = a._affliction?.type; seen[t] = (seen[t] ?? 0) + 1
    const positive =
      (t === 'terror'   && (a._panickedUntil ?? 0) > scene.time.now) ||
      (t === 'despair'  && (a._despairUntil ?? 0) > scene.time.now && a.aiState === 'fleeing') ||
      (t === 'rout'     && a.aiState === 'fleeing') ||
      (t === 'paranoia' && a.aiState === 'fleeing' && a.goal?.paranoiaBreakaway === true)
    if (!positive) { allPositive = false; badT = t }
  }
  check('A: every morale break yields a player-positive affliction', allPositive, `bad=${badT} seen=${JSON.stringify(seen)}`)
  check('A: breaks are VARIED (≥2 distinct afflictions seen)', Object.keys(seen).length >= 2, `seen=${JSON.stringify(seen)}`)
  check('A: terror (panic-in-place) is still in the mix', (seen.terror ?? 0) > 0, `seen=${JSON.stringify(seen)}`)
  // a calm (non-breaking) hero never breaks
  const b = adv({ mood: 'steady', nerve: 70 }); gs.adventurers.active = [b]
  for (let i = 0; i < 7; i++) { scene.time.now += 100; ai._checkMoraleBreak(b, 100) }
  check('A: a steady hero never breaks', !b._affliction && !(b._panickedUntil > scene.time.now))
}

// ── A2: each affliction's onset is correct + player-positive ──
{
  const t = adv({ mood: 'breaking' }); t._affliction = {}; gs.adventurers.active = [t]
  ai._afflictTerror(t, scene.time.now)
  check('A2 terror: panic freeze, no FLEE goal', (t._panickedUntil ?? 0) > scene.time.now && t.goal?.type !== 'FLEE', `until=${t._panickedUntil} goal=${t.goal?.type}`)

  const d = adv({ mood: 'breaking' }); d._affliction = {}; gs.adventurers.active = [d]; gs.player.gold = 100
  ai._afflictDespair(d, scene.time.now)
  check('A2 despair: slow trudge, exposed, gold dropped', (d._despairUntil ?? 0) > scene.time.now && d.aiState === 'fleeing' && d.goal?.reason === 'despair' && gs.player.gold > 100, `until=${d._despairUntil} gold=${gs.player.gold}`)

  const p = adv({ mood: 'breaking' }); p._affliction = {}; gs.adventurers.active = [p]; gs.player.gold = 100
  ai._afflictParanoia(p, scene.time.now)
  check('A2 paranoia: breakaway flee + gold', p.aiState === 'fleeing' && p.goal?.paranoiaBreakaway === true && gs.player.gold > 100, `goal=${JSON.stringify(p.goal)} gold=${gs.player.gold}`)

  const r = adv({ mood: 'breaking' }); r._affliction = {}; gs.adventurers.active = [r]; gs.player.gold = 100
  ai._afflictRout(r, scene.time.now)
  check('A2 rout: flee to exit + gold', r.aiState === 'fleeing' && gs.player.gold > 100, `goal=${r.goal?.type} gold=${gs.player.gold}`)

  const h1 = adv({ mood: 'breaking', partyId: 'P1' }); const h2 = adv({ partyId: 'P1' })
  h1._affliction = {}; gs.adventurers.active = [h1, h2]
  ai._afflictHysteria(h1, scene.time.now)
  check('A2 hysteria: turns on a party-mate (ATTACK_ALLY)', h1.goal?.type === 'ATTACK_ALLY' && h1.goal?.allyId === h2.instanceId, `goal=${JSON.stringify(h1.goal)}`)
}

// ── A3: HUBRIS commits the hero — they will NOT flee ──
{
  const a = adv({ mood: 'bold' }); a._hubris = true; gs.adventurers.active = [a]; gs.player.gold = 100
  ai._setFleeGoal(a, 'low_hp_retreat')
  check('A3 hubris: a committed hero refuses to flee', a.goal?.type !== 'FLEE' && a.aiState !== 'fleeing', `goal=${a.goal?.type}`)
}

// ── A4: a freeze NEVER lasts forever — capped + cooldown lockout (user 2026-06-23) ──
{
  const a = adv({ mood: 'breaking' }); gs.adventurers.active = [a]
  scene.time.now += 1000; const start = scene.time.now
  let capHitAt = null
  for (let i = 0; i < 25; i++) { scene.time.now += 100; const p = ai._pinPanic(a, scene.time.now); if (!p && capHitAt === null) capHitAt = scene.time.now - start }   // 2.5s of pressure
  check('A4: freeze RELEASES quickly (capped ≤ ~1.6s, never forever)', capHitAt !== null && capHitAt <= 1700 && (a._panicCooldownUntil ?? 0) > start, `capHitAt=${capHitAt}`)
  const midCd = (a._panicCooldownUntil ?? 0) - 200; scene.time.now = midCd
  const pinned = ai._pinPanic(a, scene.time.now)
  check('A4: cannot re-freeze during the cooldown (they break out + move)', pinned === false && !((a._panickedUntil ?? 0) > scene.time.now), `pinned=${pinned} until=${a._panickedUntil}`)
}

// ── B: Bold = reckless — no low-HP retreat ──
{
  const a = adv({ mood: 'bold', nerve: 90, resources: { hp: 20, maxHp: 100 } }); a.goal = { type: 'EXPLORE_ROOM' }
  gs.adventurers.active = [a]
  let fled = false
  for (let i = 0; i < 60; i++) { a._fleeRolled = false; ai._checkFleeTrigger(a); if (a.goal?.type === 'FLEE' || a.goal?.type === 'TACTICAL_RETREAT') { fled = true; break } }
  check('B: a BOLD hero never breaks off at low HP (fights to the death)', !fled, `goal=${a.goal?.type}`)
  const c = adv({ mood: 'spooked', nerve: 20, resources: { hp: 15, maxHp: 100 } }); c.goal = { type: 'EXPLORE_ROOM' }
  gs.adventurers.active = [c]
  let fled2 = false
  for (let i = 0; i < 400; i++) { c._fleeRolled = false; ai._checkFleeTrigger(c); if (c.goal?.type === 'FLEE' || c.goal?.type === 'TACTICAL_RETREAT') { fled2 = true; break } }
  check('B(control): a low-nerve hero still CAN flee', fled2, `goal=${c.goal?.type}`)
}

// ── C: Punish true flee — gold drop ──
{
  const a = adv({ mood: 'spooked', resources: { hp: 20, maxHp: 100 } })
  gs.adventurers.active = [a]; gs.player.gold = 100
  try { ai._setFleeGoal(a, 'last_survivor_break') } catch (e) {}
  check('C: a fleeing hero DROPS gold to the player', gs.player.gold > 100, `gold=${gs.player.gold}`)
  const afterFirst = gs.player.gold
  try { ai._setFleeGoal(a, 'last_survivor_break') } catch (e) {}
  check('C: flee gold-drop is once per hero', gs.player.gold === afterFirst, `gold=${gs.player.gold}`)
}

// ── C: panic/flee VULNERABILITY + attack-suppress (CombatSystem, stub grid) ──
{
  const savedGrid = scene.dungeonGrid
  const stubRoom = { instanceId: 'rC' }
  scene.dungeonGrid = { getTileType: () => 'floor', getRoomAtTile: () => stubRoom }
  const minion = () => ({ instanceId: `min${uid++}`, faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, damageType: 'physical', stats: { attack: 20, defense: 0, speed: 1 }, resources: { hp: 100, maxHp: 100 }, lastAttackAt: 0 })
  const swingSum = (target, mut = {}) => {
    let sum = 0; const m = minion()
    for (let i = 0; i < 24; i++) {
      target.resources.hp = 100000; m.lastAttackAt = 0; scene.time.now += 5000
      Object.assign(target, mut)
      cs.tryAttack(m, target)
      sum += 100000 - target.resources.hp
    }
    return sum
  }
  const calmT = adv({ resources: { hp: 100000, maxHp: 100000 }, stats: { attack: 0, defense: 0 } })
  const calmSum = swingSum(calmT)
  const panT = adv({ resources: { hp: 100000, maxHp: 100000 }, stats: { attack: 0, defense: 0 } })
  const panSum = swingSum(panT, { _panickedUntil: scene.time.now + 5_000_000, mood: 'breaking' })
  check('C: a panicked target takes MORE damage (vuln)', panSum > calmSum * 1.2, `calm=${calmSum} panicked=${panSum}`)
  const fleeT = adv({ resources: { hp: 100000, maxHp: 100000 }, stats: { attack: 0, defense: 0 } })
  const fleeSum = swingSum(fleeT, { aiState: 'fleeing' })
  check('C: a fleeing target takes MORE damage (vuln)', fleeSum > calmSum * 1.2, `calm=${calmSum} fleeing=${fleeSum}`)

  // attack-suppress: a panicked / fleeing HERO can't swing back
  scene.time.now += 10000
  const tgtMin = () => ({ instanceId: `tm${uid++}`, faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, resources: { hp: 100, maxHp: 100 } })
  const pAtk = adv({ stats: { attack: 30, speed: 1 }, lastAttackAt: 0, _panickedUntil: scene.time.now + 5000 })
  const tm1 = tgtMin(); const r1 = cs.tryAttack(pAtk, tm1)
  check('C: a panicked hero cannot attack', r1 === null && tm1.resources.hp === 100, `r=${r1} hp=${tm1.resources.hp}`)
  const fAtk = adv({ stats: { attack: 30, speed: 1 }, lastAttackAt: 0, aiState: 'fleeing' })
  const tm2 = tgtMin(); const r2 = cs.tryAttack(fAtk, tm2)
  check('C: a fleeing hero cannot attack back', r2 === null && tm2.resources.hp === 100, `r=${r2} hp=${tm2.resources.hp}`)
  // control: a calm hero CAN attack
  const cAtk = adv({ stats: { attack: 30, speed: 1 }, lastAttackAt: 0 })
  const tm3 = tgtMin(); cs.tryAttack(cAtk, tm3)
  check('C(control): a calm hero attacks normally', tm3.resources.hp < 100, `hp=${tm3.resources.hp}`)
  scene.dungeonGrid = savedGrid
}

// ── D: guild PANIC-SPREAD lowers next-wave nerve (NerveSystem) ──
{
  const ns = new NerveSystem(scene, gs, grid, systems.personalitySystem)
  gs._guildPanic = 0
  const a1 = adv(); delete a1.nerve; delete a1.mood; a1._nerveSeeded = false
  ns._seed(a1); const base = a1.nerve
  gs._guildPanic = 22
  const a2 = adv(); delete a2.nerve; delete a2.mood; a2._nerveSeeded = false
  ns._seed(a2)
  check('D: guild panic lowers a new hero\'s starting nerve', a2.nerve < base, `base=${base} panicked=${a2.nerve}`)
  gs._guildPanic = 22; ns._onNightNerve()
  check('D: guild panic decays each night', gs._guildPanic < 22 && gs._guildPanic >= 0, `gp=${gs._guildPanic}`)

  // ROUT cascade — a party-mate bolting in terror craters nearby allies' nerve.
  const r = adv({ partyId: 'PC' }); const mate = adv({ partyId: 'PC', tileX: 5, tileY: 5 })
  mate.nerve = 80; mate.mood = 'bold'; mate._nerveSeeded = true
  gs.adventurers.active = [r, mate]
  EventBus.emit('ADVENTURER_AFFLICTED', { advId: r.instanceId, type: 'rout' })
  check('D: ROUT cascades panic to a party-mate (nerve drops)', mate.nerve < 80, `mate=${mate.nerve}`)
}

// ── E: Pall of Dread = MASS PANIC in place ──
{
  const room = { instanceId: 'rP', gridX: 0, gridY: 0, width: 12, height: 12 }
  const g2 = { minions: [], adventurers: { active: [] }, dungeon: { rooms: [room] } }
  const w = { instanceId: 'w', definitionId: 'dark_wraith', assignedRoomId: 'rP', worldX: 160, worldY: 160, tileX: 6, tileY: 6, faction: 'dungeon' }
  const v = { instanceId: 'v', classId: 'knight', faction: 'adventurer', tileX: 6, tileY: 6, worldX: 160, worldY: 160, aiState: 'walking', nerve: 85, mood: 'bold', resources: { hp: 100, maxHp: 100 } }
  const bb = { instanceId: 'bb', classId: 'barbarian', faction: 'adventurer', tileX: 6, tileY: 6, worldX: 160, worldY: 160, aiState: 'walking', nerve: 85, mood: 'bold', resources: { hp: 100, maxHp: 100 } }
  g2.minions.push(w); g2.adventurers.active.push(v, bb)
  scene.time.now += 50000
  MinionAbilities._pallOfDread(w, scene, g2, { type: 'pallOfDread', nerveFloor: 12, panicMs: 2600 })
  check('E: Pall of Dread craters every room hero\'s nerve to the floor', v.nerve === 12, `nerve=${v.nerve}`)
  check('E: Pall of Dread PANICS the room IN PLACE (not a rout)', (v._panickedUntil ?? 0) > scene.time.now)
  check('E: a barbarian is immune to forced panic', !((bb._panickedUntil ?? 0) > scene.time.now))
}

console.log('\nNerve → player-positive rework checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
