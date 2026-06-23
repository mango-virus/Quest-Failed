// Headless check for the StoryRecap engine (research briefing #8).
//   node tools/sim/story-recap-check.mjs
// Fires a day of varied fates through the real system + asserts the composed tale
// groups per-hero arcs (affliction+death = one beat), names killers, curates, and
// that the pure composeSaga() tells the run (deadliest day / nemesis / final blow / toll).
import { boot } from './headless.mjs'
import { EventBus } from '../../src/systems/EventBus.js'
import { composeSaga } from '../../src/systems/StoryRecapSystem.js'

const { gs } = boot({ boss: 'lich' })
let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

// ── A day of varied fates ──
gs.meta.dayNumber = 7
EventBus.emit('DAY_PHASE_STARTED')   // reset the buffer
// Aldric: nerve broke (hysteria) THEN died — should be ONE combined arc beat.
EventBus.emit('ADVENTURER_AFFLICTED', { advId: 'a1', type: 'hysteria' })
EventBus.emit('ADVENTURER_DIED', { adventurer: { name: 'Aldric', classId: 'knight', level: 5, instanceId: 'a1', goldDropped: 10 }, killerName: 'a giant rat', damageType: 'physical' })
// Brenna: fled with gold.
EventBus.emit('ADVENTURER_FLED', { adventurer: { name: 'Brenna', classId: 'mage', instanceId: 'a2', goldDropped: 50 } })
// Cael: died to a notable killer (acid trap).
EventBus.emit('ADVENTURER_DIED', { adventurer: { name: 'Cael', classId: 'rogue', instanceId: 'a3' }, killerName: 'an acid trap', damageType: 'acid' })
EventBus.emit('DAY_PHASE_ENDED')

const tale = gs.history.latestTale
const txt = (tale?.beats || []).join('  |  ')
check('tale composed + stored on history.latestTale', !!tale && Array.isArray(tale.beats) && tale.beats.length > 0, JSON.stringify(tale))
check('tale also pushed to history.days', (gs.history.days?.length ?? 0) >= 1)
check('toll counts deaths + flees', tale?.toll?.slain === 2 && tale?.toll?.fled === 1, JSON.stringify(tale?.toll))
check('afflicted+died = ONE combined arc beat (no duplicate Aldric beat)', (txt.match(/Aldric/g) || []).length === 1, txt)
check('the affliction colours the death beat', /Aldric/.test(txt) && /(own|turned|fear)/i.test(txt), txt)
check('a plain death names its killer', /(rat|acid)/i.test(txt), txt)
check('beats are curated (≤ 4)', (tale?.beats || []).length <= 4)
check('day title reflects the day', /DAY 7/.test(tale?.title || ''), tale?.title)

// ── End-of-run saga (pure) ──
gs.run.totals = { advsKilled: 12, advsEscaped: 4, gold: 999 }
gs.run.finalBlow = { name: 'Valen', classId: 'paladin', level: 9 }
gs.adventurers.known = [{ name: 'Nessa', classId: 'ranger', escapeCount: 3 }]
const saga = composeSaga(gs)
const stext = (saga.lines || []).join('  |  ')
check('saga has title + lines', saga.title === 'THE SAGA OF YOUR REIGN' && saga.lines.length >= 2, stext)
check('saga calls out the deadliest day (day 7)', /Day 7/i.test(stext), stext)
check('saga names the nemesis (3 escapes)', /Nessa/.test(stext) && /3/.test(stext), stext)
check('saga names the final blow (loss)', /Valen/.test(stext), stext)
check('saga states the toll', /12/.test(stext) && /4/.test(stext), stext)

// Victory framing — no "ended your reign" final-blow line; triumphant close.
const win = composeSaga(gs, { won: true })
const wtext = (win.lines || []).join('  |  ')
check('won saga omits the final-blow-against-you line', !/Valen/.test(wtext), wtext)
check('won saga still names the nemesis + toll', /Nessa/.test(wtext) && /12/.test(wtext), wtext)
check('won saga closes triumphantly (not "goes quiet")', !/goes quiet|reign ends/i.test(wtext) && /(won|eternal|fear the deep)/i.test(wtext), wtext)

console.log('\nStory recap (briefing #8) checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
