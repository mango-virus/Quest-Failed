// Rival Dungeon event — shared sprite rolling so the IncomingWave
// preview (NightPhase._rollNextWavePreview) and the actual spawn
// (DayPhase._spawnRivalDungeon) agree on exactly which creatures the
// invading pack wears.
//
// The pack: 4 `monster_invader`s in minion sheets (slots 0-1 wear a T1
// minion, 2-3 a T2 minion) + 1 `rival_boss_invader` in a T3
// boss-archetype skin (never the player's own archetype).

// The 10 boss-archetype skins a rival boss can wear.
const ARCHETYPES = ['beholder', 'demon', 'gnoll', 'golem', 'lich',
                    'lizardman', 'myconid', 'orc', 'vampire', 'wraith']

// `minion-<id>` sprite-sheet keys for every minion at evolution `tier`
// (0 = T1 starter, 1 = T2). Reads minionEvolutions.json's chain[tier].
function _minionSheetKeysAtTier(evolutions, tier) {
  const keys = []
  for (const id of Object.keys(evolutions ?? {})) {
    if (id.startsWith('_')) continue   // skip the `_comment` doc entry
    const chain = evolutions[id]?.chain
    const minionId = Array.isArray(chain) ? chain[tier] : null
    if (minionId) keys.push(`minion-${minionId}`)
  }
  return keys
}

// Roll the Rival Dungeon pack's sprites.
//   evolutions        — minionEvolutions.json
//   playerArchetypeId — the player's boss archetype (excluded from the
//                       rival-boss skin so the visual contrast reads)
//   count             — number of monster sheets to roll (default 4 — the
//                       IncomingWave preview's fixed forecast size; the
//                       actual pack can be larger and passes PACK_SIZE)
// Returns { minionSheets: string[count], bossSkin: string }.
export function rollRivalDungeonSprites(evolutions, playerArchetypeId, count = 4) {
  const t1 = _minionSheetKeysAtTier(evolutions, 0)
  const t2 = _minionSheetKeysAtTier(evolutions, 1)
  const pick = (arr) => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : null)
  const minionSheets = []
  const half = Math.floor(count / 2)
  for (let i = 0; i < count; i++) {
    // The first half of the pack wears T1 sheets, the rest T2.
    minionSheets.push(pick(i < half ? t1 : t2) ?? pick(t1) ?? pick(t2))
  }
  const candidates = ARCHETYPES.filter(a => a !== playerArchetypeId)
  const bossSkin = candidates[Math.floor(Math.random() * candidates.length)]
    ?? ARCHETYPES[0]
  return { minionSheets, bossSkin }
}
