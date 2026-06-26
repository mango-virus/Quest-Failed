// Headless check — roomCardSkinSrc maps a room def to its skin-PNG icon URL
// (or null when the room has no skin). Guards the asset-path format and the
// set of skinned rooms against real rooms.json data.
//
//   node tools/sim/room-card-skin-check.mjs

import { readFileSync } from 'node:fs'
import { roomCardSkinSrc } from '../../src/hud/roomCardSkin.js'

const rooms = JSON.parse(readFileSync(new URL('../../src/data/rooms.json', import.meta.url), 'utf8'))
const byId = (id) => rooms.find(r => r.id === id)

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

console.log('\n[1] Skinned rooms map to assets/themes/roomskins/<skin>.png')
{
  ok(roomCardSkinSrc(byId('entry_hall'))       === 'assets/themes/roomskins/entry_room_1.png',  'entry_hall → entry_room_1.png')
  ok(roomCardSkinSrc(byId('starter_barracks')) === 'assets/themes/roomskins/barracks_room.png', 'starter_barracks → barracks_room.png')
  ok(roomCardSkinSrc(byId('treasury'))         === 'assets/themes/roomskins/treasure_room_1.png','treasury → treasure_room_1.png')
}

console.log('\n[2] Skinless rooms → null')
{
  ok(roomCardSkinSrc(byId('crypt')) === null, 'crypt (no backgroundImage) → null')
  ok(roomCardSkinSrc({ id: 'x' })   === null, 'def with no backgroundImage → null')
  ok(roomCardSkinSrc(null)          === null, 'null def → null (defensive)')
}

console.log('\n[3] Non-null count equals rooms with a string backgroundImage')
{
  const expected = rooms.filter(r => typeof r.backgroundImage === 'string').length
  const actual   = rooms.filter(r => roomCardSkinSrc(r) !== null).length
  ok(actual === expected, `${actual} skinned cards === ${expected} rooms with backgroundImage`)
}

console.log(fails === 0 ? '\n✅ room-card-skin-check: ALL PASS' : `\n❌ room-card-skin-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)
