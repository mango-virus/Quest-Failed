// ─────────────────────────────────────────────────────────────────────────────
// Dev VFX Sandbox  (window.__qfDev)
//
// A scriptable dev console for verifying the Kingdom-Response set-pieces without
// hand-playing a whole run. Installed on the Game scene (cheat-name / localhost
// gated). Drives everything from JS so it can be run from the browser console OR
// an automated preview harness — no fragile canvas-clicking required.
//
// Typical flow (in an active DAY phase):
//   __qfDev.fastAbilities()            // signatures fire in ~0.6s, not 4.5s
//   __qfDev.populate()                 // mixed-tier minions (+ undead) + traps near the boss
//   __qfDev.champion('mage_tower')     // fire a champion raid → watch the signature
//   __qfDev.setResponse('betrayer')    // engage an act-wide gimmick (trap-flip / transmute…)
//
// Everything it creates is tagged `_devSandbox` so __qfDev.clear() removes it.
// ─────────────────────────────────────────────────────────────────────────────

import { createMinion, applyMinionScaling } from '../entities/Minion.js'
import { createTrap } from '../entities/Trap.js'
import { EventBus } from '../systems/EventBus.js'
import { currentActResponseId } from '../config/acts.js'
import { TILE } from '../systems/DungeonGrid.js'

const WALKABLE = new Set([TILE.FLOOR, TILE.BOSS_FLOOR])
// A mixed-tier roster, deliberately including UNDEAD so Inquisition/Excommunicate
// (which prefer undead targets) and the trap-flip have real things to chew on.
const SANDBOX_MINIONS = ['goblin1', 'skeleton1', 'ghost1', 'orc1', 'demon1', 'lich1', 'zombie1', 'gnoll1']
const SANDBOX_TRAPS   = ['arrow_trap', 'spike_pit', 'saw_blade']

export function installDevSandbox(scene) {
  const log = (...a) => console.log('[qfDev]', ...a)
  const gs   = () => scene.gameState ?? scene._gameState
  const grid = () => scene.dungeonGrid

  // Walkable tiles in rings around the boss (closest first), skipping the boss tile.
  function floorTilesNearBoss(n) {
    const g = gs(); const b = g?.boss ?? {}
    const cx = b.tileX ?? 10, cy = b.tileY ?? 10
    const out = []
    for (let r = 2; r <= 8 && out.length < n; r++) {
      for (let dx = -r; dx <= r && out.length < n; dx++) {
        for (let dy = -r; dy <= r && out.length < n; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue   // ring perimeter only
          const x = cx + dx, y = cy + dy
          if (x === cx && y === cy) continue
          if (WALKABLE.has(grid()?.getTileType?.(x, y))) out.push({ x, y })
        }
      }
    }
    return out
  }

  const api = {
    // Spawn `minions` test minions + `traps` traps near the boss so champion
    // abilities + the trap-flip have real targets. Returns the counts.
    populate({ minions = 8, traps = 3 } = {}) {
      const g = gs()
      if (!g) { log('no gameState'); return { ok: false } }
      const tiles = floorTilesNearBoss(minions + traps + 6)
      if (tiles.length === 0) { log('no walkable tiles near the boss — is a dungeon built?'); return { ok: false } }
      const bossLv = g.boss?.level ?? 8
      const day    = g.meta?.dayNumber ?? 1
      const roomId = grid()?.getRoomAtTile?.(g.boss?.tileX, g.boss?.tileY)?.instanceId ?? null

      const mDefs = scene.cache.json.get('minionTypes') ?? []
      const mById = Object.fromEntries(mDefs.map(d => [d.id, d]))
      let mc = 0
      for (let i = 0; i < minions && i < tiles.length; i++) {
        const def = mById[SANDBOX_MINIONS[i % SANDBOX_MINIONS.length]] ?? mDefs[i % mDefs.length]
        const t = tiles[i]; if (!def || !t) continue
        const m = createMinion(def, { x: t.x, y: t.y }, roomId, { bossLevel: bossLv, dayNumber: day })
        applyMinionScaling(m, bossLv, day)
        m.aiState = 'idle'; m._devSandbox = true
        g.minions.push(m)
        mc++
      }

      const tDefs = scene.cache.json.get('trapTypes') ?? []
      const tById = Object.fromEntries(tDefs.map(d => [d.id, d]))
      let tc = 0
      for (let i = 0; i < traps; i++) {
        const def = tById[SANDBOX_TRAPS[i % SANDBOX_TRAPS.length]] ?? tDefs[i % tDefs.length]
        const t = tiles[minions + i]; if (!def || !t) continue
        const trap = createTrap(def, { tileX: t.x, tileY: t.y })
        trap._devSandbox = true
        g.dungeon.traps.push(trap)
        tc++
      }
      EventBus.emit('MINION_PLACED', {})   // nudge the renderers to pick the new units up
      log(`populated ${mc} minions + ${tc} traps near the boss (now ${g.minions.length} minions, ${g.dungeon.traps.length} traps)`)
      return { ok: true, minions: mc, traps: tc }
    },

    // Fire a champion raid by responseId (spawns the champion + retinue). Needs an
    // active DayPhase — call __qfDev.startDay() first if you're still building.
    champion(responseId) {
      const dp = scene.scene.get('DayPhase')
      if (!dp?.scene?.isActive?.()) { log('not in a DayPhase — run __qfDev.startDay() (or click BEGIN DAY) first'); return { ok: false, reason: 'no-dayphase' } }
      EventBus.emit('DEV_FORCE_CHAMPION_RAID', { responseId })
      log(`fired champion raid: ${responseId}  (signature casts in ${globalThis.__qfDevFastAbilities ? '~0.6s' : '~4.5s'})`)
      return { ok: true }
    },

    // Force the current act's drafted Kingdom Response so its ACT-WIDE gimmick
    // engages (Betrayer trap-flip, Mage Tower transmute, Inquisition purge, …).
    setResponse(responseId) {
      const g = gs(); g.meta ??= {}; g.meta.act ??= {}
      const act = g.meta.act.current ?? 1
      g.meta.act.responses ??= {}
      g.meta.act.responses[act] = responseId
      log(`act ${act} response → '${responseId}'  (act-wide gimmick now active)`)
      return { act, responseId }
    },

    // Collapse the champion / All-Star ability cadences so signatures fire almost
    // immediately — essential for reliably screenshotting a cast.
    fastAbilities(on = true) {
      globalThis.__qfDevFastAbilities = !!on
      log(`fast abilities ${on ? 'ON  (first cast ~0.6s, cooldown ~2.5s)' : 'OFF (normal cadence)'}`)
      return !!on
    },

    // End the build phase and start the day's wave (so champion raids can spawn).
    startDay() {
      const np = scene.scene.get('NightPhase')
      if (np?.scene?.isActive?.() && typeof np._beginDay === 'function') { np._beginDay(); log('starting the day…'); return { ok: true } }
      const dp = scene.scene.get('DayPhase')
      if (dp?.scene?.isActive?.()) { log('already in DayPhase'); return { ok: true, already: true } }
      log('not in NightPhase — cannot start the day from here'); return { ok: false }
    },

    // Remove everything the sandbox created (minions, traps, raid units).
    clear() {
      const g = gs()
      const m0 = g.minions.length, t0 = g.dungeon.traps.length, a0 = g.adventurers?.active?.length ?? 0
      g.minions = g.minions.filter(m => !m._devSandbox)
      g.dungeon.traps = g.dungeon.traps.filter(t => !t._devSandbox)
      if (g.adventurers?.active) g.adventurers.active = g.adventurers.active.filter(a => !a._kingdomChampion && !a._allStar && !a._championResponseId && !a._defector)
      log(`cleared ${m0 - g.minions.length} minions, ${t0 - g.dungeon.traps.length} traps, ${a0 - (g.adventurers?.active?.length ?? 0)} raid units`)
      return { ok: true }
    },

    // Current sandbox state — handy for an automated harness to assert on.
    state() {
      const g = gs()
      const active = scene.scene?.manager?.scenes?.filter?.(s => s.scene.isActive())?.map?.(s => s.scene.key)
      return {
        activeScenes: active,
        day: g?.meta?.dayNumber, act: g?.meta?.act?.current,
        response: g ? currentActResponseId(g) : null,
        minions: g?.minions?.length, traps: g?.dungeon?.traps?.length,
        advs: g?.adventurers?.active?.length,
        champions: (g?.adventurers?.active ?? []).filter(a => a._kingdomChampion || a._allStar).map(a => ({ name: a.name, sig: a._allStarSig, resp: a._championResponseId })),
        fastAbilities: !!globalThis.__qfDevFastAbilities,
      }
    },

    help() {
      const h = [
        'window.__qfDev — Kingdom-Response VFX sandbox',
        "  .startDay()                      end build phase, start the wave (if in NightPhase)",
        "  .fastAbilities(true)             champion signatures fire in ~0.6s (no 4.5s wait)",
        "  .populate({minions=8,traps=3})   spawn mixed-tier minions (+undead) + traps near the boss",
        "  .setResponse('betrayer')         force the act response → engage its act-wide gimmick",
        "  .champion('pantheon')            fire a champion raid (needs an active DayPhase)",
        "  .state()                         dump sandbox state",
        "  .clear()                         remove sandbox minions/traps/raid units",
        '',
        "  responses: plunderers inquisition forlorn_hope mage_tower pantheon all_stars betrayer reckoning_dead rival",
        '',
        "  e.g.  __qfDev.fastAbilities(); __qfDev.populate(); __qfDev.champion('mage_tower')",
        "        __qfDev.setResponse('betrayer'); __qfDev.populate()   // watch traps flip green ⇄ + chew your minions",
      ].join('\n')
      console.log(h); return h
    },
  }

  window.__qfDev = api
  console.log('[qfDev] VFX sandbox installed — run window.__qfDev.help()')
  return api
}
