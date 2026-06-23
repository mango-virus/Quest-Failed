// Headless runtime for the Quest Failed sim — runs the real game systems in
// Node with no Phaser canvas. Proven feasible by tools/_hsim_spike.mjs.
//
// It does three things:
//   1. installGlobals()  — stub the browser globals the systems touch.
//   2. makeScene()       — a fake Phaser scene: real JSON cache (backed by the
//                          src/data files via Preload's key→file map), an
//                          advancing clock, no-op events. Systems get attached
//                          onto it as properties exactly like Game.js does to
//                          `this`, so cross-system `this._scene.bossSystem`
//                          lookups resolve.
//   3. boot()            — construct GameState + the SIM subset of Game.js's
//                          systems (skipping renderers/VFX/audio/acts), in the
//                          same order, with the same loadDefinitions() calls.
//   4. frame()           — replicate Game.update()'s day-phase tick faithfully
//                          (fixed sub-stepping + the AI 1-in-3 throttle).
//
// Source of truth for the construction list + tick is src/scenes/Game.js. If
// that file's system wiring changes materially, mirror it here.

import { readFileSync } from 'node:fs'

// ── 1. Globals ────────────────────────────────────────────────────────────────
const setGlobal = (k, v) => { try { globalThis[k] = v } catch { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }) } catch {} } }

function chainable() {
  const fn = function () { return chainable() }
  return new Proxy(fn, {
    get(_t, p) {
      if (p === Symbol.toPrimitive || p === 'then' || p === Symbol.iterator) return undefined
      if (p === 'valueOf' || p === 'toString') return () => 0
      return chainable()
    },
    apply() { return chainable() },
  })
}

function memStore() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size } }
}

let _globalsInstalled = false
export function installGlobals() {
  if (_globalsInstalled) return
  _globalsInstalled = true
  setGlobal('window', new Proxy({ __perfStats: {}, __perfCounts: {} }, { get(t, p) { if (p in t) return t[p]; if (p === 'localStorage') return globalThis.localStorage; return chainable() }, set(t, p, v) { t[p] = v; return true } }))
  setGlobal('localStorage', memStore())
  setGlobal('document', new Proxy({}, { get() { return chainable() } }))
  setGlobal('navigator', { userAgent: 'qf-headless' })
  setGlobal('requestAnimationFrame', cb => setTimeout(() => cb(0), 0))
  setGlobal('cancelAnimationFrame', () => {})
  setGlobal('Phaser', {
    BlendModes: { ADD: 1, NORMAL: 0, MULTIPLY: 2, SCREEN: 3, ERASE: 17 },
    Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } },
    Math: {
      Between: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
      FloatBetween: (a, b) => a + Math.random() * (b - a),
      Clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
      Linear: (a, b, t) => a + (b - a) * t,
      Wrap: (v, lo, hi) => { const r = hi - lo; return lo + ((((v - lo) % r) + r) % r) },
      RadToDeg: r => r * 180 / Math.PI, DegToRad: d => d * Math.PI / 180,
      Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1), Squared: (x1, y1, x2, y2) => (x2 - x1) ** 2 + (y2 - y1) ** 2 },
      Angle: { Between: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1), Wrap: a => Math.atan2(Math.sin(a), Math.cos(a)) },
      RND: { pick: a => a[Math.floor(Math.random() * a.length)], between: (a, b) => a + Math.floor(Math.random() * (b - a + 1)) },
    },
    Utils: { Array: { GetRandom: a => a[Math.floor(Math.random() * a.length)], Shuffle: a => a, Remove: (a, x) => { const i = a.indexOf(x); if (i >= 0) a.splice(i, 1); return x } } },
    Geom: { Rectangle: function (x, y, w, h) { return { x, y, width: w, height: h, contains: () => false } } },
  })
}

// ── 2. Fake scene ─────────────────────────────────────────────────────────────
const ROOT = new URL('../../', import.meta.url)   // tools/sim/ → repo root

function buildJsonCache() {
  const preload = readFileSync(new URL('src/scenes/Preload.js', ROOT), 'utf8')
  const map = {}
  for (const m of preload.matchAll(/load\.json\(\s*['"]([\w]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)) map[m[1]] = m[2]
  const cache = {}
  const get = (key) => {
    if (key in cache) return cache[key]
    const rel = map[key]
    if (!rel) return null
    try { cache[key] = JSON.parse(readFileSync(new URL(rel, ROOT), 'utf8')) } catch { cache[key] = null }
    return cache[key]
  }
  return { json: { get, has: k => k in map, exists: k => k in map } }
}

export function makeScene() {
  const real = {
    cache: buildJsonCache(),
    time: { now: 0, delayedCall: (_d, cb) => { if (cb) cb(); return { remove() {} } }, addEvent: () => ({ remove() {} }) },
    events: { on() {}, off() {}, once() {}, emit() {} },
    sys: { settings: { active: true } },
    _aiSubstepCounter: 0,
    isHeadless: true,
  }
  // Headless door opener. The real DungeonRenderer.openDoor only sets
  // cp.opening; cp.open flips when the 500ms animation (DungeonRenderer.update)
  // completes — which never runs headless, so adventurers freeze at the first
  // door. Open instantly instead (same end state, no animation).
  real._dungeonRenderer = {
    openDoor(cp) { if (cp) { cp.open = true; cp.opening = false; cp.openProgress = 1 } return true },
    closeDoor(cp) { if (cp) { cp.open = false; cp.opening = false; cp.openProgress = 0 } },
    redrawDoors() {}, redraw() {}, update() {},
  }
  // scene.scene.get('Game') etc. → return the scene itself (it holds the systems)
  real.scene = { key: 'Game', isActive: () => true, get: () => proxy, isPaused: () => false }
  const proxy = new Proxy(real, { get(t, p) { if (p in t) return t[p]; return chainable() }, set(t, p, v) { t[p] = v; return true } })
  return proxy
}

// ── 3. Boot — construct GameState + the sim system set ────────────────────────
import { createGameState }        from '../../src/state/GameState.js'
import { DungeonGrid }            from '../../src/systems/DungeonGrid.js'
import { PersonalitySystem }      from '../../src/systems/PersonalitySystem.js'
import { CombatSystem }           from '../../src/systems/CombatSystem.js'
import { KnowledgeSystem }        from '../../src/systems/KnowledgeSystem.js'
import { AISystem }               from '../../src/systems/AISystem.js'
import { MinionAISystem }         from '../../src/systems/MinionAISystem.js'
import { TrapSystem }             from '../../src/systems/TrapSystem.js'
import { EvolutionSystem }        from '../../src/systems/EvolutionSystem.js'
import { MinionEvolutionSystem }  from '../../src/systems/MinionEvolutionSystem.js'
import { DungeonMechanicSystem }  from '../../src/systems/DungeonMechanicSystem.js'
import { StoryRecapSystem }       from '../../src/systems/StoryRecapSystem.js'
import { InquisitorSystem }       from '../../src/systems/InquisitorSystem.js'
import { BossSystem }             from '../../src/systems/BossSystem.js'
import { BossArchetypeSystem }    from '../../src/systems/BossArchetypeSystem.js'
import { EventSystem }            from '../../src/systems/EventSystem.js'
import { RoomBehaviorSystem }     from '../../src/systems/RoomBehaviorSystem.js'
import { ClassAbilitySystem }     from '../../src/systems/ClassAbilitySystem.js'
import { RunHistorySystem }       from '../../src/systems/RunHistorySystem.js'
import { EventBus }               from '../../src/systems/EventBus.js'

export { EventBus }

// Silence the game's internal diagnostic chatter (oscillation-break warnings,
// etc.) during batch sims. Keeps console.error so real failures still surface.
// Returns a restore fn.
export function silenceConsole() {
  const orig = {}
  for (const k of ['log', 'info', 'warn', 'debug']) { orig[k] = console[k]; console[k] = () => {} }
  return () => { for (const k of Object.keys(orig)) console[k] = orig[k] }
}

// boot({ boss }) → { scene, gs, grid, systems }
export function boot({ boss = 'lich' } = {}) {
  installGlobals()
  // EventBus is a process-wide singleton. Each boot constructs a fresh system
  // set that subscribes to it; without clearing, a batch of N games would stack
  // N× listeners (stale games' handlers firing on the live game's events —
  // perf rot + cross-talk). In headless the only subscribers ARE the systems we
  // rebuild here, so a clean slate per game is correct.
  EventBus.removeAllListeners()
  const scene = makeScene()
  const roomDefs = scene.cache.json.get('rooms')
  const gs = createGameState(boss, roomDefs)
  gs.player.bossArchetypeId = boss
  scene.gameState = gs

  const grid = new DungeonGrid(gs.dungeon)
  scene.dungeonGrid = grid

  const systems = {}
  const add = (name, inst) => { systems[name] = inst; scene[name] = inst; return inst }

  add('personalitySystem', new PersonalitySystem(scene)); systems.personalitySystem.loadDefinitions?.()
  add('combatSystem',      new CombatSystem(scene, gs))
  add('knowledgeSystem',   new KnowledgeSystem(scene, gs, grid))
  add('aiSystem',          new AISystem(scene, gs, grid, systems.personalitySystem, systems.combatSystem, systems.knowledgeSystem))
  add('minionAiSystem',    new MinionAISystem(scene, gs, grid, systems.combatSystem))
  add('trapSystem',        new TrapSystem(scene, gs, grid)); systems.trapSystem.loadDefinitions?.()
  add('evolutionSystem',   new EvolutionSystem(scene, gs)); systems.evolutionSystem.loadDefinitions?.()
  add('minionEvolutionSystem', new MinionEvolutionSystem(scene, gs))
  add('dungeonMechanicSystem', new DungeonMechanicSystem(scene, gs)); systems.dungeonMechanicSystem.loadDefinitions?.()
  add('storyRecapSystem',  new StoryRecapSystem(scene, gs))
  add('inquisitorSystem',  new InquisitorSystem(scene, gs, systems.dungeonMechanicSystem, systems.personalitySystem))
  add('bossSystem',        new BossSystem(scene, gs))
  add('bossArchetypeSystem', new BossArchetypeSystem(scene, gs))  // per-archetype boss behavior (the differentiator)
  add('eventSystem',       new EventSystem(scene, gs))
  add('roomBehaviorSystem', new RoomBehaviorSystem(scene, gs))
  add('classAbilitySystem', new ClassAbilitySystem(scene, gs))
  add('runHistorySystem',  new RunHistorySystem(scene, gs))

  return { scene, gs, grid, systems }
}

// ── 4. frame — one Game.update() day-phase tick (ts = time scale, default 1) ──
export function frame(scene, systems, { ts = 1, onError } = {}) {
  const realCapped = 16
  const totalScaled = realCapped * ts
  const MAX_STEP = 40
  const steps = Math.max(1, Math.ceil(totalScaled / MAX_STEP))
  const stepDt = totalScaled / steps
  const tick = (name, fn) => { try { fn() } catch (e) { if (onError) onError(name, e); } }

  // Archetype system ticks once per frame on real delta (matches Game.update:1991,
  // which runs it OUTSIDE the day-phase scaled branch — phylactery damage etc.).
  tick('bossArchetypeSystem', () => systems.bossArchetypeSystem?.tick?.(realCapped))

  for (let i = 0; i < steps; i++) {
    scene._aiSubstepCounter = ((scene._aiSubstepCounter ?? 0) + 1) % 3
    const skipAi = scene._aiSubstepCounter !== 0
    scene.time.now += stepDt
    tick('bossSystem', () => systems.bossSystem?.update?.(stepDt))
    if (!skipAi) {
      tick('aiSystem',       () => systems.aiSystem?.update?.(stepDt * 3))
      tick('minionAiSystem', () => systems.minionAiSystem?.update?.(stepDt * 3))
    }
    tick('trapSystem',            () => systems.trapSystem?.update?.(stepDt))
    tick('dungeonMechanicSystem', () => systems.dungeonMechanicSystem?.tickDay?.(stepDt))
    tick('classAbilitySystem',    () => systems.classAbilitySystem?.update?.(stepDt))
  }
}
