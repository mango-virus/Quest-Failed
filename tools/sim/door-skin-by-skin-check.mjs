// Headless check for resolveDoorSkinId — the per-room-skin door override
// resolution. Run standalone: `node tools/sim/door-skin-by-skin-check.mjs`
// (also picked up by `npm test`).
import { resolveDoorSkinId } from '../../src/ui/doorSkinResolve.js'

let failures = 0
const eq = (label, got, want) => {
  if (got !== want) { console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); failures++ }
  else console.log(`ok   ${label}`)
}

// A room that rolled skin "sk2", with a per-skin entrance + connecting override,
// plus the existing all-skins fields and a per-boss override.
const room = {
  backgroundImage: 'sk2',
  doorSkin:                 { closed: 'conn_all' },
  doorSkinEntrance:         { closed: 'ent_all' },
  doorSkinByBoss:           { orc: { closed: 'conn_orc' } },
  doorSkinBySkin:           { sk2: { closed: 'conn_sk2' } },
  doorSkinEntranceBySkin:   { sk2: { closed: 'ent_sk2' } },
}

// Per-skin wins for both roles.
eq('entrance per-skin wins',   resolveDoorSkinId(room, 'closed', { isEntrance: true }),  'ent_sk2')
eq('connecting per-skin wins', resolveDoorSkinId(room, 'closed', { isEntrance: false }), 'conn_sk2')

// Rolled skin with NO per-skin entry → falls back to today's chain.
const room2 = { ...room, backgroundImage: 'OTHER' }
eq('entrance fallback to all',   resolveDoorSkinId(room2, 'closed', { isEntrance: true }),  'ent_all')
eq('connecting fallback to boss', resolveDoorSkinId(room2, 'closed', { isEntrance: false, boss: 'orc' }), 'conn_orc')
eq('connecting fallback to all',  resolveDoorSkinId(room2, 'closed', { isEntrance: false }), 'conn_all')

// No backgroundImage at all → identical to legacy behavior.
const legacy = { doorSkin: { open: 'c' }, doorSkinEntrance: { open: 'e' } }
eq('legacy entrance',   resolveDoorSkinId(legacy, 'open', { isEntrance: true }),  'e')
eq('legacy connecting', resolveDoorSkinId(legacy, 'open', { isEntrance: false }), 'c')
eq('missing state → null', resolveDoorSkinId(legacy, 'locked', { isEntrance: true }), null)

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall passed')
