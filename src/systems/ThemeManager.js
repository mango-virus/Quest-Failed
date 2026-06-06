// Theme + sprite-library data model for the dungeon-tile editor.
//
// Two long-lived concepts:
//
//   1. Sprite library — a flat pool of every uploaded PNG, each tagged with
//      its source size (32 / 64 / 128) and render mode (scale | span). The
//      same sprite can appear in multiple slots across multiple themes.
//
//   2. Theme — a named bundle of slot → variant-array assignments. Slots
//      are floor + 10 wall slots + 24 door slots (3 states × 2 orientations
//      × 4 tiles). Each slot's value is an array of sprite ids; the renderer
//      picks one variant per cell at dungeon-build time.
//
// On disk:
//
//   assets/themes/manifest.json
//     → {
//         sprites: { <id>: { file, srcSize, mode, tags? } },
//         themes:  { <name>: { slots: { <slot>: [spriteId, …] } } },
//         active:  <themeName> | null,
//       }
//
//   assets/themes/sprites/<id>.png   (one PNG per sprite, dropped by editor)
//
// In-memory: the manifest is mirrored on the singleton, and the editor
// mutates it in place between saves. ThemeManager.serialize() returns the
// JSON the editor writes back via FsHandle. ThemeManager.load() rehydrates
// from a previously-saved manifest.
//
// Variant picking: pickVariant(slot, x, y, theme) returns a sprite id (or
// null). Hash currently uses Math.random rolled once per (slot, x, y) and
// cached in a per-dungeon map; consumer is expected to call resetRolls()
// when a new dungeon is generated.

// ── Slot vocabulary ────────────────────────────────────────────────────────

// 10 wall slots — match the existing TILE_KEYS in DungeonTileset.js so
// renderer integration in Phase C is a 1:1 mapping.
export const WALL_SLOTS = [
  'wall',            'wall_cap',
  'wall_bottom',     'wall_left',     'wall_right',
  'wall_corner_tl',  'wall_corner_tr',
  'wall_corner_bl', 'wall_corner_br',
]

export const FLOOR_SLOT = 'floor'

// 24 door slots — 3 states × 2 orientations × 4 tiles per door.  Doors are
// a 2×2 block of TILE.DOOR cells in this game (see DungeonRenderer.js
// docstring on door-tile painting); the four-tile layout is:
//
//     [tl][tr]
//     [bl][br]
//
// for each (state, orientation) combination.
export const DOOR_STATES       = ['closed', 'open',     'locked']
export const DOOR_ORIENTATIONS = ['v',      'h']           // vertical, horizontal
export const DOOR_CELL_KEYS    = ['tl', 'tr', 'bl', 'br']

export const DOOR_SLOTS = (() => {
  const out = []
  for (const state of DOOR_STATES) {
    for (const orient of DOOR_ORIENTATIONS) {
      for (const cell of DOOR_CELL_KEYS) {
        out.push(`door_${state}_${orient}_${cell}`)
      }
    }
  }
  return out
})()

// Master slot list (1 + 10 + 24 = 35 total). Order is stable so the editor
// can iterate this list to render its slot grid.
export const ALL_SLOTS = [FLOOR_SLOT, ...WALL_SLOTS, ...DOOR_SLOTS]

// Human-readable display name per slot, used by the editor's slot grid.
export function slotLabel(slot) {
  if (slot === FLOOR_SLOT) return 'Floor'
  if (WALL_SLOTS.includes(slot)) {
    return slot.replace('wall_', 'Wall ').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                .replace('Wall Wall', 'Wall').replace('Wall Cap', 'Wall Cap (top)')
                .replace('Wall Bottom', 'Wall (bottom)')
                .replace('Wall Left', 'Wall (left)').replace('Wall Right', 'Wall (right)')
                .replace('Wall Corner Tl', 'Corner TL').replace('Wall Corner Tr', 'Corner TR')
                .replace('Wall Corner Bl', 'Corner BL').replace('Wall Corner Br', 'Corner BR')
  }
  // door_<state>_<orient>_<cell>
  const parts = slot.split('_')
  // parts = ['door', state, orient, cell]
  const state  = parts[1].toUpperCase()
  const orient = parts[2] === 'v' ? 'Vert' : 'Horiz'
  const cell   = parts[3].toUpperCase()
  return `Door ${state} ${orient} ${cell}`
}

// Group slots for the editor's collapsible section UI.
export function slotGroups() {
  const door = {}
  for (const state of DOOR_STATES) {
    for (const orient of DOOR_ORIENTATIONS) {
      const groupId = `door-${state}-${orient}`
      const groupLabel = `Door · ${state.toUpperCase()} · ${orient === 'v' ? 'Vertical' : 'Horizontal'}`
      door[groupId] = {
        label: groupLabel,
        slots: DOOR_CELL_KEYS.map(c => `door_${state}_${orient}_${c}`),
      }
    }
  }
  return {
    floor: { label: 'Floor',                slots: [FLOOR_SLOT] },
    walls: { label: 'Walls (autotile)',     slots: WALL_SLOTS },
    ...door,
  }
}

// ── Sprite metadata ────────────────────────────────────────────────────────

export const VALID_SRC_SIZES = [32, 64, 128]
export const VALID_MODES     = ['scale', 'span']
// How many cells a single sprite occupies when placed.
//   1 = 1×1 tile slot  (default)
//   2 = 2×2 tile slots (anchor + right + down + diagonal)
//   4 = 4×4 tile slots
// Independent of the source PNG resolution: a 32×32 sprite at coverage 2
// scales UP to fill 64×64 px in the dungeon; a 128×128 sprite at coverage
// 1 scales DOWN to fit 32×32 px.
export const VALID_COVERAGES = [1, 2, 4]
// Non-square coverages, stored as 'WxH' strings. 1×2 = 1 cell wide, 2 tall
// (a tall/narrow tile); 2×1 = 2 wide, 1 tall. Square coverages stay numbers.
export const VALID_COVERAGE_STR = ['1x2', '2x1']

// Normalize a coverage value (from a manifest or a UI patch) to a stored form:
// a square number (1/2/4) or a non-square 'WxH' string, else null.
export function normCoverage(c) {
  if (typeof c === 'number' && VALID_COVERAGES.includes(c)) return c
  if (typeof c === 'string' && VALID_COVERAGE_STR.includes(c)) return c
  return null
}

// Parse any coverage value (number, 'WxH' string, or null) to {w, h} cells.
function _parseCoverWH(c) {
  if (typeof c === 'string') {
    const m = /^(\d+)x(\d+)$/.exec(c)
    if (m) return { w: +m[1], h: +m[2] }
  }
  if (typeof c === 'number' && VALID_COVERAGES.includes(c)) return { w: c, h: c }
  return null
}

export function makeSpriteId(name) {
  // Stable id from the dropped filename: lowercase, alnum + underscore only.
  const stem = (name || 'sprite').replace(/\.[^.]+$/, '')
  const id   = stem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return id || 'sprite'
}

export function spritePath(id) {
  return `assets/themes/sprites/${id}.png`
}

// Full-room "skin" images (Phase 4): a single PNG painted over a whole room's
// footprint, replacing per-tile floor/wall rendering. `room.backgroundImage`
// holds a skin id; the PNG lives at roomSkinPath(id) and loads as the texture
// roomSkinTextureKey(id).
export function roomSkinPath(id) {
  return `assets/themes/roomskins/${id}.png`
}
export function roomSkinTextureKey(id) {
  return `roomskin-${id}`
}

// Door "skin" images: a single PNG drawn over a doorway (one image, auto-rotated
// per door direction — like a room skin, but for a door). room.doorSkin[state]
// holds a skin id; the PNG lives at doorSkinPath(id) → texture doorSkinTextureKey(id).
export function doorSkinPath(id) {
  return `assets/themes/doorskins/${id}.png`
}
export function doorSkinTextureKey(id) {
  return `doorskin-${id}`
}

// Filename/id → theme slot, by convention, so dropping well-named PNGs
// (floor3, wall_corner_tl, door_closed_v_tl, …) auto-assigns to the right
// slot on upload. Returns a slot from ALL_SLOTS, or null when the id doesn't
// map cleanly — the editor drops those in an "unassigned" tray for a manual
// one-click pick. A trailing numeric variant suffix is stripped first
// (floor3 → floor) so multiple variants of one slot all land together.
const _SLOT_ALIASES = {
  wall_l: 'wall_left',   wall_r: 'wall_right',  wall_b: 'wall_bottom',
  wall_c: 'wall_cap',    wall_t: 'wall',        wall_top: 'wall',
  corner_tl: 'wall_corner_tl', corner_tr: 'wall_corner_tr',
  corner_bl: 'wall_corner_bl', corner_br: 'wall_corner_br',
}
export function autoSlotForId(id) {
  if (!id) return null
  const s = String(id).toLowerCase()
  const base = s.replace(/_?\d+$/, '') || s
  // 1) exact slot name (floor, wall, wall_cap, wall_corner_tl, door_<…>).
  if (ALL_SLOTS.includes(s)) return s
  if (ALL_SLOTS.includes(base)) return base
  // 2) known short aliases.
  if (_SLOT_ALIASES[s]) return _SLOT_ALIASES[s]
  if (_SLOT_ALIASES[base]) return _SLOT_ALIASES[base]
  // 3) loose prefix rules. Doors must be exact (state+orient+cell), so
  //    abbreviated door names fall through to the tray.
  if (/floor/.test(s)) return FLOOR_SLOT
  if (/^wall(\d+)?$/.test(base)) return 'wall'
  return null
}

// Cells covered by a sprite. Explicit `coverage` field wins; otherwise we
// derive from the legacy mode/srcSize convention so older manifests still
// behave correctly.
export function spriteCoverage(sprite) {
  const { w, h } = spriteCoverageHW(sprite)
  // Legacy single-number callers (doorway projection, etc.) get the bounding
  // square so a non-square sprite still reads as "a span" and never under-covers.
  return Math.max(w, h)
}

// Width×height footprint of a sprite in cells. Square sprites have w === h
// (identical to the old spriteCoverage number); non-square sprites carry a
// 'WxH' coverage string. This is the precise footprint — callers that paint /
// render / mark covered cells should prefer this over spriteCoverage().
export function spriteCoverageHW(sprite) {
  if (!sprite) return { w: 1, h: 1 }
  const explicit = _parseCoverWH(sprite.coverage)
  if (explicit) return explicit
  // Legacy mode/srcSize convention (square only).
  if (sprite.mode !== 'span') return { w: 1, h: 1 }
  if (sprite.srcSize === 64)  return { w: 2, h: 2 }
  if (sprite.srcSize === 128) return { w: 4, h: 4 }
  return { w: 1, h: 1 }
}

// Per-cell tileLayout entries can be either:
//   - a plain sprite id string (rot 0°, no flips)    → "floor1"
//   - an object with optional rotation + flips       → { id, rot?, flipH?, flipV? }
// readCellEntry normalizes both shapes to a fully-populated object. Missing
// rot defaults to 0; missing flipH/V default to false. writeCellEntry picks
// the compact string form when rot is 0 AND no flips are set, so an
// unmodified paint doesn't bloat rooms.json.
export const VALID_ROTATIONS = [0, 90, 180, 270]

export function readCellEntry(entry) {
  if (!entry) return null
  if (typeof entry === 'string') return { id: entry, rot: 0, flipH: false, flipV: false }
  if (typeof entry === 'object' && typeof entry.id === 'string') {
    const rot = VALID_ROTATIONS.includes(entry.rot) ? entry.rot : 0
    return {
      id:    entry.id,
      rot,
      flipH: !!entry.flipH,
      flipV: !!entry.flipV,
    }
  }
  return null
}

export function writeCellEntry(id, rot, flipH = false, flipV = false) {
  if (!id) return null
  const r = VALID_ROTATIONS.includes(rot) ? rot : 0
  if (r === 0 && !flipH && !flipV) return id
  const out = { id, rot: r }
  if (flipH) out.flipH = true
  if (flipV) out.flipV = true
  return out
}

// ── In-memory state ────────────────────────────────────────────────────────

const state = {
  sprites: Object.create(null),    // id → { file, srcSize, mode, coverage, theme, tags }
  themes:  Object.create(null),    // name → { slots: { <slot>: [spriteId,…] } }
  roomSkins: Object.create(null),  // id → { file }   (full-room skin PNGs)
  doorSkins: Object.create(null),  // id → { file }   (single-image door skins)
  active:  null,                   // active theme name (used by preview + game)
  rolls:   new Map(),              // (themeName|slot|x|y) → spriteId  (cache)
}

// ── Public API ─────────────────────────────────────────────────────────────

export const ThemeManager = {
  // Replace in-memory state from a deserialized manifest.json.
  load(manifest) {
    state.sprites = {}
    state.themes  = {}
    state.roomSkins = {}
    state.doorSkins = {}
    state.active  = null
    state.rolls.clear()
    if (!manifest) return
    if (manifest.sprites && typeof manifest.sprites === 'object') {
      for (const [id, s] of Object.entries(manifest.sprites)) {
        if (!s || typeof s !== 'object') continue
        state.sprites[id] = {
          file:     typeof s.file === 'string' ? s.file : spritePath(id),
          srcSize:  VALID_SRC_SIZES.includes(s.srcSize) ? s.srcSize : 32,
          mode:     VALID_MODES.includes(s.mode) ? s.mode : 'scale',
          coverage: normCoverage(s.coverage),
          // Owning theme (Phase-1 themed-tile authoring). Untagged sprites
          // from older manifests stay null = "shared / legacy".
          theme:    typeof s.theme === 'string' ? s.theme : null,
          tags:     Array.isArray(s.tags) ? s.tags.slice() : [],
        }
      }
    }
    if (manifest.themes && typeof manifest.themes === 'object') {
      for (const [name, t] of Object.entries(manifest.themes)) {
        if (!t || typeof t !== 'object') continue
        const slots = {}
        for (const slot of ALL_SLOTS) {
          const arr = t.slots?.[slot]
          slots[slot] = Array.isArray(arr) ? arr.filter(id => id in state.sprites) : []
        }
        state.themes[name] = { slots }
      }
    }
    if (manifest.roomSkins && typeof manifest.roomSkins === 'object') {
      for (const [id, s] of Object.entries(manifest.roomSkins)) {
        if (!s || typeof s !== 'object') continue
        state.roomSkins[id] = { file: typeof s.file === 'string' ? s.file : roomSkinPath(id) }
      }
    }
    if (manifest.doorSkins && typeof manifest.doorSkins === 'object') {
      for (const [id, s] of Object.entries(manifest.doorSkins)) {
        if (!s || typeof s !== 'object') continue
        state.doorSkins[id] = { file: typeof s.file === 'string' ? s.file : doorSkinPath(id) }
      }
    }
    if (manifest.active && manifest.active in state.themes) state.active = manifest.active
  },

  // Snapshot current state as a plain object suitable for JSON.stringify.
  serialize() {
    return {
      sprites:   structuredClone(state.sprites),
      themes:    structuredClone(state.themes),
      roomSkins: structuredClone(state.roomSkins),
      doorSkins: structuredClone(state.doorSkins),
      active:    state.active,
    }
  },

  // ── Sprite library ──
  listSprites() { return Object.entries(state.sprites).map(([id, s]) => ({ id, ...s })) },
  getSprite(id) { return state.sprites[id] || null },
  hasSprite(id) { return id in state.sprites },

  // Sprites owned by a theme (Phase-1 themed-tile authoring). Pass
  // includeLegacy to also return untagged (theme === null) shared sprites.
  spritesForTheme(name, includeLegacy = false) {
    return Object.entries(state.sprites)
      .filter(([, s]) => s.theme === name || (includeLegacy && s.theme == null))
      .map(([id, s]) => ({ id, ...s }))
  },

  addSprite(id, meta) {
    state.sprites[id] = {
      file:     meta.file || spritePath(id),
      srcSize:  VALID_SRC_SIZES.includes(meta.srcSize) ? meta.srcSize : 32,
      mode:     VALID_MODES.includes(meta.mode) ? meta.mode : 'scale',
      coverage: normCoverage(meta.coverage),
      theme:    typeof meta.theme === 'string' ? meta.theme : null,
      tags:     Array.isArray(meta.tags) ? meta.tags.slice() : [],
    }
    state.rolls.clear()
  },

  updateSprite(id, patch) {
    const s = state.sprites[id]
    if (!s) return
    if (patch.srcSize  != null && VALID_SRC_SIZES.includes(patch.srcSize))  s.srcSize  = patch.srcSize
    if (patch.mode     != null && VALID_MODES.includes(patch.mode))         s.mode     = patch.mode
    if (patch.coverage != null && normCoverage(patch.coverage) != null) s.coverage = normCoverage(patch.coverage)
    if (patch.theme !== undefined) s.theme = (typeof patch.theme === 'string' ? patch.theme : null)
    if (Array.isArray(patch.tags)) s.tags = patch.tags.slice()
    state.rolls.clear()
  },

  removeSprite(id) {
    delete state.sprites[id]
    // Cascade: pull from every theme's slot variants.
    for (const theme of Object.values(state.themes)) {
      for (const slot of ALL_SLOTS) {
        theme.slots[slot] = (theme.slots[slot] || []).filter(s => s !== id)
      }
    }
    state.rolls.clear()
  },

  // ── Themes ──
  listThemes() { return Object.keys(state.themes) },
  getTheme(name) { return state.themes[name] || null },
  hasTheme(name) { return name in state.themes },
  activeTheme() { return state.active },

  setActive(name) {
    if (name == null || name in state.themes) {
      state.active = name
      state.rolls.clear()
    }
  },

  createTheme(name) {
    if (!name || name in state.themes) return false
    const slots = {}
    for (const slot of ALL_SLOTS) slots[slot] = []
    state.themes[name] = { slots }
    if (state.active == null) state.active = name
    return true
  },

  renameTheme(oldName, newName) {
    if (!(oldName in state.themes) || !newName || newName in state.themes) return false
    state.themes[newName] = state.themes[oldName]
    delete state.themes[oldName]
    if (state.active === oldName) state.active = newName
    state.rolls.clear()
    return true
  },

  deleteTheme(name) {
    if (!(name in state.themes)) return false
    delete state.themes[name]
    if (state.active === name) state.active = Object.keys(state.themes)[0] || null
    state.rolls.clear()
    return true
  },

  // ── Full-room skins ──
  listRoomSkins() { return Object.entries(state.roomSkins).map(([id, s]) => ({ id, ...s })) },
  getRoomSkin(id) { return state.roomSkins[id] || null },
  hasRoomSkin(id) { return id in state.roomSkins },
  addRoomSkin(id, file) { state.roomSkins[id] = { file: file || roomSkinPath(id) } },
  removeRoomSkin(id) { delete state.roomSkins[id] },

  // ── Door skins (single-image, auto-rotated per door) ──
  listDoorSkins() { return Object.entries(state.doorSkins).map(([id, s]) => ({ id, ...s })) },
  getDoorSkin(id) { return state.doorSkins[id] || null },
  hasDoorSkin(id) { return id in state.doorSkins },
  addDoorSkin(id, file) { state.doorSkins[id] = { file: file || doorSkinPath(id) } },
  removeDoorSkin(id) { delete state.doorSkins[id] },

  // ── Slot variant edits (mutate the named theme) ──
  setSlotVariants(themeName, slot, ids) {
    const t = state.themes[themeName]
    if (!t || !ALL_SLOTS.includes(slot)) return
    t.slots[slot] = (Array.isArray(ids) ? ids : []).filter(id => id in state.sprites)
    state.rolls.clear()
  },

  addSlotVariant(themeName, slot, id) {
    const t = state.themes[themeName]
    if (!t || !ALL_SLOTS.includes(slot) || !(id in state.sprites)) return
    if (!t.slots[slot].includes(id)) t.slots[slot].push(id)
    state.rolls.clear()
  },

  removeSlotVariant(themeName, slot, id) {
    const t = state.themes[themeName]
    if (!t || !ALL_SLOTS.includes(slot)) return
    t.slots[slot] = t.slots[slot].filter(s => s !== id)
    state.rolls.clear()
  },

  // ── Variant pick (renderer + preview) ──
  // Returns the sprite id for a given slot at world cell (x, y), rolling once
  // per (theme, slot, x, y) and caching. Pass themeName explicitly if you
  // want to pick from something other than the active theme. Returns null
  // when the slot has no variants.
  pickVariant(slot, x, y, themeName = state.active) {
    if (!themeName) return null
    const t = state.themes[themeName]
    if (!t || !ALL_SLOTS.includes(slot)) return null
    const variants = t.slots[slot]
    if (!variants || variants.length === 0) return null
    const key = `${themeName}|${slot}|${x}|${y}`
    if (state.rolls.has(key)) return state.rolls.get(key)
    const choice = variants[(Math.random() * variants.length) | 0]
    state.rolls.set(key, choice)
    return choice
  },

  // Drop the per-cell roll cache. Called when a new dungeon is generated so
  // variants get re-rolled per game.
  resetRolls() { state.rolls.clear() },
}
