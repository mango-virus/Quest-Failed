// Headless check — Adaptive-learning BESTIARY substrate (AI Intelligence, Phase 1).
//
//   node tools/sim/bestiary-check.mjs
//
// Drives the REAL KnowledgeSystem end-to-end (it only imports EventBus + Balance,
// no Phaser) to verify: minion-family facing accrues per-adv; reveal is binary;
// daysFaced increments once per day; ESCAPE commits to the shared pool while
// DEATH teaches nothing; mastery SUMS across survivors; staleness trips after the
// window and snaps back on re-facing; boss facing via BOSS_FIGHT_STARTED; the
// getBestiaryReport() shape (known / studyingNow / masteryTier / stale).

import { KnowledgeSystem } from '../../src/systems/KnowledgeSystem.js'
import { EventBus } from '../../src/systems/EventBus.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

// ── Minimal world ──────────────────────────────────────────────────────────
const bossRoom = { instanceId: 'boss', definitionId: 'boss_chamber', gridX: 0, gridY: 0, width: 10, height: 10 }
const r1       = { instanceId: 'r1', definitionId: 'crypt', gridX: 0, gridY: 0, width: 10, height: 10 }
const gs = {
  meta: { dayNumber: 1 },
  adventurers: { active: [] },
  dungeon: { rooms: [bossRoom, r1], traps: [] },
  minions: [],
  player: { bossArchetypeId: 'golem' },
  _mechanicFlags: {},
}
const grid = { getRoomAtTile: () => r1 }
const ks = new KnowledgeSystem({}, gs, grid)

const mkAdv = (id, over = {}) => ({
  instanceId: id, name: id, classId: 'knight', sigil: '✦', classColor: '#fff',
  personalityIds: [], pathHistory: [], resources: { hp: 50, maxHp: 50 },
  knowledge: {}, tileX: 2, tileY: 2, aiState: 'walking', ...over,
})
const golem = (id = 'golem2') => ({ definitionId: id, assignedRoomId: 'r1', tileX: 2, tileY: 2, abilities: [{ type: 'damageReduction' }], _camouflaged: false })
const flee = (adv) => { gs.adventurers.active = [adv]; EventBus.emit('ADVENTURER_FLED', { adventurer: adv }); gs.adventurers.active = [] }
const bestiaryEntry = (type) => ks.getBestiaryReport().entries.find(e => e.type === type)

// ── 1) Family facing accrues per-adv; reveal binary; daysFaced once/day ──────
console.log('\n[1] Minion-family facing (per-adv accrual)')
const a1 = mkAdv('Aria')
ks.observeMinion(a1, golem('golem2'))
ok(a1.knowledge.bestiary?.golem?.known === true, 'golem revealed (known) on first facing')
ok(a1.knowledge.bestiary?.golem?.daysFaced === 1, 'daysFaced = 1')
ok(a1.knowledge.bestiary?.golem?.abilities?.damageReduction === true, 'ability type recorded')
ks.observeMinion(a1, golem('golem3'))   // same family, same day
ok(a1.knowledge.bestiary?.golem?.daysFaced === 1, 'daysFaced stays 1 (same-day re-facing does not double-count)')
ok(ks._enemyFamily('golem3') === 'golem', '_enemyFamily strips tier (golem3 → golem)')

// ── 2) ESCAPE commits to the shared pool ─────────────────────────────────────
console.log('\n[2] Escape commits to the kingdom (shared pool)')
flee(a1)
ok(gs.knowledge.sharedPool.bestiary?.golem?.known === true, 'shared pool knows golem after escape')
ok(gs.knowledge.sharedPool.bestiary?.golem?.mastery === 1, 'kingdom mastery = 1')
const e2 = bestiaryEntry('golem')
ok(e2 && e2.known && e2.mastery === 1 && e2.masteryTier === 1 && !e2.stale, 'report: golem known, mastery 1, ★1, not stale')

// ── 3) DEATH teaches nothing ─────────────────────────────────────────────────
console.log('\n[3] Death teaches nothing')
const aDead = mkAdv('Doomed')
ks.observeMinion(aDead, golem())
EventBus.emit('ADVENTURER_DIED', { adventurer: aDead })   // died, not fled
ok((gs.knowledge.sharedPool.bestiary?.golem?.mastery ?? 0) === 1, 'mastery still 1 — a death did not commit')

// ── 4) Mastery SUMS across survivors; tier climbs ───────────────────────────
console.log('\n[4] Mastery accumulates across survivors')
for (const id of ['Bo', 'Cy', 'Di']) { const a = mkAdv(id); ks.observeMinion(a, golem()); flee(a) }
ok(gs.knowledge.sharedPool.bestiary.golem.mastery === 4, 'mastery = 4 after 4 distinct survivors')
ok(bestiaryEntry('golem').masteryTier === 2, '★★ at mastery 4 (T2)')
for (const id of ['Ed', 'Fi', 'Gu', 'Ha', 'Io']) { const a = mkAdv(id); ks.observeMinion(a, golem()); flee(a) }
ok(gs.knowledge.sharedPool.bestiary.golem.mastery === 9, 'mastery = 9 after 9 survivors')
ok(bestiaryEntry('golem').masteryTier === 3, '★★★ at mastery 9 (T3 — mastered)')

// ── 4b) getEnemyCounter — the Phase-4 counter-strength API + combat-edge math ─
console.log('\n[4b] getEnemyCounter (combat-edge counter)')
{
  const cGolem = ks.getEnemyCounter(golem())              // pass a minion → resolves family
  ok(cGolem.known && Math.abs(cGolem.strength - 1) < 1e-6 && !cGolem.stale, 'golem counter: known, strength 1.0 (mastered), fresh')
  const dmgMul = 1 + 0.25 * cGolem.strength               // adv hits studied golem harder
  const drMul  = 1 - 0.20 * cGolem.strength               // adv takes less from studied golem
  ok(Math.abs(dmgMul - 1.25) < 1e-6, 'adv→golem damage ×1.25 at full mastery')
  ok(Math.abs(drMul - 0.80) < 1e-6, 'golem→adv damage ×0.80 at full mastery')
  ok(ks.getEnemyCounter('skeleton').strength === 0 && !ks.getEnemyCounter('skeleton').known, 'unknown type → 0 strength (reveal gate)')
  ok(ks.getEnemyCounter(null).strength === 0, 'null target → 0 (safe)')
}

// ── 5) Staleness trips after the window, snaps back on re-facing ─────────────
console.log('\n[5] Staleness (stop using → stale; re-face → snaps back)')
gs.meta.dayNumber = 1 + 4 + 1   // STALE_DAYS=4 → day 6, last faced day 1
ok(bestiaryEntry('golem').stale === true, 'golem mastery goes STALE when unused past the window')
{
  const cs = ks.getEnemyCounter('golem')
  ok(cs.stale === true && Math.abs(cs.strength - 1 * 0.4) < 1e-6, 'stale counter strength = base×0.4 (counters weaken, not gone)')
}
const aRefresh = mkAdv('Refresher'); ks.observeMinion(aRefresh, golem()); flee(aRefresh)
ok(bestiaryEntry('golem').stale === false, 're-facing snaps it back to fresh')
ok(gs.knowledge.sharedPool.bestiary.golem.mastery >= 9, 'mastery retained through staleness (never reset)')

// ── 6) Boss facing via BOSS_FIGHT_STARTED ────────────────────────────────────
console.log('\n[6] Boss learning (BOSS_FIGHT_STARTED)')
const aBoss = mkAdv('Bosser', { tileX: 3, tileY: 3 })
gs.adventurers.active = [aBoss]
EventBus.emit('BOSS_FIGHT_STARTED', {})
ok(aBoss.knowledge.bestiary?.['boss:golem']?.known === true, 'adv in boss chamber faces boss:golem')
const aOut = mkAdv('Outsider', { tileX: 50, tileY: 50 })   // outside the boss room
gs.adventurers.active = [aBoss, aOut]
EventBus.emit('BOSS_FIGHT_STARTED', {})
ok(!aOut.knowledge.bestiary?.['boss:golem'], 'an adv OUTSIDE the boss chamber does not face the boss')
gs.adventurers.active = []
flee(aBoss)
const eb = bestiaryEntry('boss:golem')
ok(eb && eb.known && eb.isBoss && eb.label === 'Boss · Golem', 'report: boss:golem committed, isBoss, labelled')

// ── 7) studyingNow — currently facing, not yet committed ─────────────────────
console.log('\n[7] studyingNow (live, pre-escape)')
const aStudy = mkAdv('Scout')
ks.observeMinion(aStudy, { definitionId: 'skeleton1', assignedRoomId: 'r1', tileX: 2, tileY: 2, abilities: [], _camouflaged: false })
gs.adventurers.active = [aStudy]
const es = bestiaryEntry('skeleton')
ok(es && es.studyingNow === true && es.known === false, 'skeleton shows studyingNow + not yet known (no escape yet)')
ok(!gs.knowledge.sharedPool.bestiary?.skeleton, 'skeleton NOT committed to the shared pool pre-escape')
gs.adventurers.active = []

// ── 8) Party wipe keeps the bestiary BUCKET (no-survivors end-of-day reset) ──
console.log('\n[8] Total party wipe resets the pool but keeps the bestiary bucket')
gs.meta.dayNumber = 99   // no survivor fled on day 99 → wipe branch
ks.processEndOfDay()
ok(gs.knowledge.sharedPool.bestiary && typeof gs.knowledge.sharedPool.bestiary === 'object', 'sharedPool.bestiary still a {} after a total wipe (no crash on later reads)')
ok(Object.keys(gs.knowledge.sharedPool.bestiary).length === 0, 'bestiary cleared by the wipe (kingdom forgets on a full party wipe)')

ks.destroy()
console.log(fails === 0 ? '\n✅ bestiary-check: ALL PASS' : `\n❌ bestiary-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)
