import { Balance } from '../config/balance.js'
import { EventBus } from './EventBus.js'

export const TILE = {
  VOID:       0,
  FLOOR:      1,
  WALL:       2,
  BOSS_FLOOR: 5,
  BOSS_WALL:  6,
  DOOR:       7,
  // Explicit wall-cap tile authored in Room Builder. Renders the
  // tile-WALL_CAP texture in-cell (vs the implicit cap layer that the
  // renderer auto-draws one row above top-edge walls — see pickCapKey).
  WALL_CAP:   8,
}

// Doorway direction → outward unit vector. Used both for placement
// snapping (a doorway facing E mates with a doorway facing W on the
// neighbour room) and for adventurer cross-room movement.
const DIR_VEC = {
  N: { dx:  0, dy: -1 },
  S: { dx:  0, dy:  1 },
  E: { dx:  1, dy:  0 },
  W: { dx: -1, dy:  0 },
}
const OPPOSITE_DIR = { N: 'S', S: 'N', E: 'W', W: 'E' }

// ── Entry-hall doorway geometry ───────────────────────────────────────────────
// The Entry Hall can be placed at any rotation. Its single external
// "entrance" connection point is rotated with the room (NightPhase._rotateCP
// updates the cp's x/y + direction), so the doorway can end up on any of the
// four edges. These helpers resolve the doorway from the cp's CURRENT
// position — never assume north. Pure functions of the placed-room object;
// safe to call from AI, renderers, and scene code.

// The entry hall's external entrance connection point (or null).
export function entryDoorCp(entry) {
  const cps = entry?.connectionPoints ?? []
  return cps.find(c => c.style === 'entrance')
      ?? cps.find(c => c.external)
      ?? cps.find(c => c.direction === 'N')
      ?? null
}

// Which edge the entrance doorway sits on: 'N' | 'S' | 'E' | 'W'. Derived
// from the cp's position (matches DungeonRenderer._doorBlockCells) so it
// stays correct however the room was rotated.
export function entryDoorSide(entry) {
  const cp = entryDoorCp(entry)
  if (!cp || !entry) return 'N'
  if (cp.y <= 0)                return 'N'
  if (cp.y >= entry.height - 1) return 'S'
  if (cp.x <= 0)                return 'W'
  if (cp.x >= entry.width - 1)  return 'E'
  return 'N'
}

// Dungeon-coords tile of the entrance doorway — the adventurer spawn point
// and the flee-exit target. The cp tile itself is the carved DOOR opening.
export function entryDoorTile(entry) {
  if (!entry) return null
  const cp = entryDoorCp(entry)
  if (!cp) return { x: entry.gridX + Math.floor(entry.width / 2), y: entry.gridY }
  return { x: entry.gridX + cp.x, y: entry.gridY + cp.y }
}

// World-space centre + anchor tile of the 2 × WALL_THICKNESS doorway block.
// Mirrors DungeonRenderer._doorBlockCells so the spawn / leave fade snaps the
// adventurer to exactly where the door art is drawn.
export function entryDoorWorldCenter(entry) {
  if (!entry) return null
  const TS = Balance.TILE_SIZE
  const cp = entryDoorCp(entry)
  if (!cp) {
    const x = entry.gridX + Math.floor(entry.width / 2)
    return { tileX: x, tileY: entry.gridY, worldX: x * TS + TS / 2, worldY: entry.gridY * TS + TS / 2 }
  }
  const WT = Balance.WALL_THICKNESS
  const onTop = cp.y <= 0
  const onBot = cp.y >= entry.height - 1
  if (onTop || onBot) {
    const alongDx = (cp.alongDx === 1 || cp.alongDx === -1)
      ? cp.alongDx
      : (((entry.width - 1) - cp.x) >= cp.x ? 1 : -1)
    const xStart = Math.min(cp.x, cp.x + alongDx)
    const yStart = onTop ? 0 : entry.height - WT
    const tileX  = entry.gridX + xStart
    const tileY  = entry.gridY + yStart
    return { tileX, tileY, worldX: tileX * TS + TS, worldY: tileY * TS + (WT * TS) / 2 }
  }
  const alongDy = (cp.alongDy === 1 || cp.alongDy === -1)
    ? cp.alongDy
    : (((entry.height - 1) - cp.y) >= cp.y ? 1 : -1)
  const yStart = Math.min(cp.y, cp.y + alongDy)
  const xStart = (cp.x <= 0) ? 0 : entry.width - WT
  const tileX  = entry.gridX + xStart
  const tileY  = entry.gridY + yStart
  return { tileX, tileY, worldX: tileX * TS + (WT * TS) / 2, worldY: tileY * TS + TS }
}

// Snap radius — how far away (in tiles, manhattan distance) a candidate
// position can be from the perfect alignment and still snap into place.
// Tight (=1) so the room only locks in when the cursor is essentially on
// top of the connecting position; preview otherwise tracks the cursor.
const SNAP_RADIUS = 1

function _uid() {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export class DungeonGrid {
  constructor(dungeonState) {
    // dungeonState is gameState.dungeon — mutated directly
    this._d = dungeonState
    // Fast lookup: `${x},${y}` → instanceId
    this._tileToRoom = {}
    // Fast lookup: instanceId → room object. Maintained in lockstep with
    // _tileToRoom by _rebuildLookup. Cheap O(1) for getRoomAtTile vs. the
    // previous rooms.find() linear scan — called 77+ times across hot
    // tick paths (AISystem, MinionAISystem, TrapSystem, KnowledgeSystem),
    // so the lookup cache is significant during day-phase waves.
    this._roomById = new Map()
    this._rebuildLookup()
  }

  // Room redesign 2026-04-30 — boss-level gating helpers. Pure (no class
  // state) so callers from other modules can reuse without an instance.
  static isUnlocked(definition, dungeonLevel = 1) {
    return (definition.unlockLevel ?? 1) <= dungeonLevel
  }

  // Returns the cap for `definition` at the given `dungeonLevel`, or null
  // for unlimited. Prefers placementRules.maxPerDungeonByBossLevel when
  // present (a sparse {level: cap} table); falls back to the static
  // maxPerDungeon for legacy rooms.
  //
  // Sparse-table baseline (fix 2026-05-22): when the table's lowest
  // entry is above the current dungeonLevel (e.g. throne_room's
  // `{"9":1,"10":2}` viewed at L1 — only reachable via the mango cheat
  // flattening unlockLevel to 1), the cap previously fell through to
  // `null` = unlimited, letting a cheat-mode player spam infinite
  // copies of any sparse-tabled room. Now we seed `cap` to the lowest
  // table entry's value, so a sparse table that starts at L9 enforces
  // its L9 cap from L1 onward. Cap still climbs normally as the
  // dungeonLevel reaches each higher entry.
  static effectiveMaxPerDungeon(definition, dungeonLevel = 1) {
    const byLevel = definition.placementRules?.maxPerDungeonByBossLevel
    if (byLevel != null) {
      const keys = Object.keys(byLevel)
        .map(k => parseInt(k, 10))
        .filter(n => Number.isFinite(n))
        .sort((a, b) => a - b)
      if (keys.length === 0) {
        return definition.placementRules?.maxPerDungeon ?? null
      }
      let cap = byLevel[keys[0]]   // baseline = lowest entry's value
      for (const l of keys) {
        if (l <= dungeonLevel) cap = byLevel[l]
      }
      return cap
    }
    return definition.placementRules?.maxPerDungeon ?? null
  }

  // Returns the gold cost to place ONE more instance of `definition`.
  // Honors:
  //   • `placementRules.freeFirstN` — the first N placements are free.
  //   • `costStep` (top-level room field) — escalating cost: each PAID copy
  //                     beyond the first costs `costStep` more gold than the
  //                     last, so spamming a strong multi-instance room
  //                     snowballs in price. 1st paid copy costs the base
  //                     `goldCost`. Omit `costStep` for a flat price.
  // `placedRooms` is typically gameState.dungeon.rooms (placed-room records).
  static effectiveRoomCost(definition, placedRooms = []) {
    const base = definition.goldCost ?? 0
    const freeFirstN = definition.placementRules?.freeFirstN ?? 0
    const count = placedRooms.filter(r => r.definitionId === definition.id).length
    if (count < freeFirstN) return 0
    const step = definition.costStep ?? 0
    if (!step) return base
    // paidIndex 0 = first paid copy (costs `base`), 1 = base + step, …
    const paidIndex = count - freeFirstN
    return base + step * paidIndex
  }

  // ── Decoration collision ────────────────────────────────────────────────────

  // Returns true if a solid decoration occupies this tile (blocks pathfinding).
  isSolidDecor(tx, ty) {
    return this._solidDecorTiles?.has(`${tx},${ty}`) ?? false
  }

  // True if a solid trap (cannon / bomb / spike pillar / rotating blades)
  // occupies this tile — adventurers and minions must path around it.
  isSolidTrap(tx, ty) {
    for (const t of this._d.traps ?? []) {
      if (!t.solid) continue
      const fp = t.footprint ?? { w: 1, h: 1 }
      if (tx >= t.tileX && tx < t.tileX + fp.w &&
          ty >= t.tileY && ty < t.tileY + fp.h) return true
    }
    return false
  }

  // True if a non-solid trap that has ALREADY been sprung occupies this
  // tile — spike pits stay open after the first victim falls in, so the
  // spikes are visible. Adventurers should detour around when they can.
  // Pathfinder treats these as SOFT_BLOCK_COST detours (passable as a
  // last resort) when the caller passes `opts.avoidSprungTraps`.
  isAvoidableSprungTrap(tx, ty) {
    for (const t of this._d.traps ?? []) {
      if (t.solid) continue
      if (!t.state?.revealed) continue
      const fp = t.footprint ?? { w: 1, h: 1 }
      if (tx >= t.tileX && tx < t.tileX + fp.w &&
          ty >= t.tileY && ty < t.tileY + fp.h) return true
    }
    return false
  }

  // Rebuild the entire solid-decor set from current placed rooms. Call after
  // _reapplyAllRoomDefs() or any batch room mutation.
  rebuildSolidDecors() {
    this._solidDecorTiles = new Set()
    for (const room of this._d.rooms) {
      this._addSolidDecors(room)
    }
  }

  _addSolidDecors(room) {
    if (!this._solidDecorTiles) this._solidDecorTiles = new Set()
    for (const d of (room.decorations ?? [])) {
      if (!d.solid) continue
      const sz = d.size ?? 1
      for (let dy = 0; dy < sz; dy++) {
        for (let dx = 0; dx < sz; dx++) {
          this._solidDecorTiles.add(`${room.gridX + d.x + dx},${room.gridY + d.y + dy}`)
        }
      }
    }
  }

  _removeSolidDecors(room) {
    if (!this._solidDecorTiles) return
    for (const d of (room.decorations ?? [])) {
      if (!d.solid) continue
      const sz = d.size ?? 1
      for (let dy = 0; dy < sz; dy++) {
        for (let dx = 0; dx < sz; dx++) {
          this._solidDecorTiles.delete(`${room.gridX + d.x + dx},${room.gridY + d.y + dy}`)
        }
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  // Place a room at (gridX, gridY). Returns the placed room or null.
  // Set `noSnap` to skip the auto-align (used internally by the boss
  // chamber seeding which must land at an exact centred coord).
  placeRoom(definition, gridX, gridY, opts = {}) {
    if (!opts.noSnap) {
      const snapped = this.findSnap(definition, gridX, gridY)
      if (snapped) { gridX = snapped.gridX; gridY = snapped.gridY }
    }

    const check = this.validatePlacement(definition, gridX, gridY, opts)
    if (!check.valid) return null

    // Multi-skin: when the default skin POOL has entries, bake a random pick now
    // so this placed instance keeps one stable look (saved + survives reload).
    // Each placement rolls independently, so two of the same room can differ.
    // The per-boss pool is resolved at render time instead — DungeonGrid has no
    // boss reference (see DungeonRenderer._roomSkinKeyFor).
    const _skinPool = Array.isArray(definition.backgroundImagePool)
      ? definition.backgroundImagePool.filter(s => typeof s === 'string') : null
    const _bgImage = (_skinPool && _skinPool.length)
      ? _skinPool[Math.floor(Math.random() * _skinPool.length)]
      : (typeof definition.backgroundImage === 'string' ? definition.backgroundImage : null)

    const room = {
      // `preserveInstanceId` lets NightPhase's MOVE-drop path reuse
      // the original room's id so adventurer knowledge keyed on it
      // (rooms / enemiesPerRoom / traps' roomId / etc.) carries
      // naturally across the move. Fresh placements pass null /
      // undefined and fall through to _uid().
      instanceId: opts.preserveInstanceId || _uid(),
      definitionId: definition.id,
      gridX,
      gridY,
      width: definition.width,
      height: definition.height,
      // Placement rotation (0/90/180/270). Set HERE — before the ROOM_PLACED
      // emit below — so the first render already knows it (DungeonRenderer rotates
      // the room skin by it). NightPhase used to set it only AFTER placeRoom
      // returned, so the placed skin rendered upright until the next full redraw.
      rotation: opts.rotation ?? 0,
      isActive: true,
      // Sprite-tiling fields copied from the room template — DungeonRenderer
      // reads these at draw time to overlay theme sprites on top of the
      // procedural wall/floor art. All default to safe empty values when
      // the template has no theme/painting assigned (most rooms today).
      // See RoomTileEditor for how these are authored.
      theme:      typeof definition.theme     === 'string' ? definition.theme     : null,
      doorTheme:  typeof definition.doorTheme === 'string' ? definition.doorTheme : null,
      tileLayout:   Array.isArray(definition.tileLayout) ? definition.tileLayout : [],
      doorTiles:    (definition.doorTiles && typeof definition.doorTiles === 'object')
                      ? definition.doorTiles : null,
      // Decorative door "apron" — a row painted one tile into the room below
      // each door (purely visual, no collision change). { <state>: [4 cells] }.
      doorApron:    (definition.doorApron && typeof definition.doorApron === 'object')
                      ? definition.doorApron : null,
      // Per-boss door swatches for the boss chamber: { <archetypeId>: { <state>: … } }.
      // The renderer picks the active boss's entry, falling back to doorTiles/doorApron.
      doorTilesByBoss: (definition.doorTilesByBoss && typeof definition.doorTilesByBoss === 'object')
                      ? definition.doorTilesByBoss : null,
      doorApronByBoss: (definition.doorApronByBoss && typeof definition.doorApronByBoss === 'object')
                      ? definition.doorApronByBoss : null,
      // Single-image door skins: { <state>: skinId } + per-boss override.
      doorSkin:       (definition.doorSkin && typeof definition.doorSkin === 'object')
                      ? definition.doorSkin : null,
      doorSkinByBoss: (definition.doorSkinByBoss && typeof definition.doorSkinByBoss === 'object')
                      ? definition.doorSkinByBoss : null,
      // Per-room-skin door overrides: { <roomSkinId>: { <state>: skinId } }.
      // Keyed by the instance's rolled room skin (backgroundImage); the
      // renderer (resolveDoorSkinId) checks these first. Connecting + entrance.
      doorSkinBySkin: (definition.doorSkinBySkin && typeof definition.doorSkinBySkin === 'object')
                      ? structuredClone(definition.doorSkinBySkin) : null,
      doorSkinEntranceBySkin: (definition.doorSkinEntranceBySkin && typeof definition.doorSkinEntranceBySkin === 'object')
                      ? structuredClone(definition.doorSkinEntranceBySkin) : null,
      // Optional per-room door-skin footprint override { w, h, nudge } in tiles
      // (e.g. the grand entrance renders a bigger gate than a normal door).
      doorSkinSize:   (definition.doorSkinSize && typeof definition.doorSkinSize === 'object')
                      ? definition.doorSkinSize : null,
      // Separate skin set + size for the MAIN ENTRANCE (external/entrance cp),
      // distinct from the connecting-door skin above. Falls back to doorSkin.
      doorSkinEntrance:     (definition.doorSkinEntrance && typeof definition.doorSkinEntrance === 'object')
                      ? definition.doorSkinEntrance : null,
      doorSkinSizeEntrance: (definition.doorSkinSizeEntrance && typeof definition.doorSkinSizeEntrance === 'object')
                      ? definition.doorSkinSizeEntrance : null,
      decorations:  Array.isArray(definition.decorations) ? definition.decorations : [],
      colorAdjust:  (definition.colorAdjust && typeof definition.colorAdjust === 'object')
                      ? definition.colorAdjust : null,
      // Full-room skin id (Phase 4) — when set + its texture loads, the
      // renderer paints one stretched image over the room instead of tiles.
      backgroundImage: _bgImage,
      // Per-boss skin overrides for the boss chamber: { <archetypeId>: skinId }.
      // The renderer picks the active boss's entry, falling back to
      // backgroundImage. Only the boss_chamber uses this.
      backgroundImageByBoss: (definition.backgroundImageByBoss && typeof definition.backgroundImageByBoss === 'object')
        ? structuredClone(definition.backgroundImageByBoss) : null,
      // Per-boss random-skin POOL (boss chamber). Resolved + cached into
      // backgroundImageByBoss at render time (DungeonRenderer has the active
      // boss); kept on the instance so it's available + saved.
      backgroundImagePoolByBoss: (definition.backgroundImagePoolByBoss && typeof definition.backgroundImagePoolByBoss === 'object')
        ? structuredClone(definition.backgroundImagePoolByBoss) : null,
      // Each cp gets `open: false` by default — doors start closed and
      // become open when adventurers walk through (or, for the entry_hall's
      // external cp, automatically at day-start). `style` defaults to
      // 'regular' if not specified in the room def. `external` cps don't
      // pair with other rooms (they face "outside the dungeon").
      // `opening` + `openProgress` drive the split animation: when
      // `opening=true`, openProgress ramps 0→1 and DungeonRenderer.update
      // flips `open=true` once it lands on 1.
      connectionPoints: (definition.connectionPoints ?? []).map(cp => ({
        style: 'regular',
        external: false,
        ...cp,
        open: false,
        opening: false,
        openProgress: 0,
      })),
      state: {},
    }

    this._writeTiles(room, definition)
    this._d.rooms.push(room)
    this._indexRoom(room)
    this._addSolidDecors(room)
    // Auto-connect: scan adjacent rooms for valid overlaps and create
    // matching cps + doors at the centre of each overlap. Skipped for
    // rooms loaded with pre-authored cps (e.g. entry_hall's external N).
    this._autoConnect(room)

    // `isMove` flags re-placement from NightPhase's MOVE-drop path so
    // listeners (e.g. RoomBehaviorSystem) can skip first-time spawn
    // logic that would otherwise duplicate carried-along inhabitants.
    EventBus.emit('ROOM_PLACED', { room, isMove: !!opts.isMove })
    return room
  }

  removeRoom(instanceId, opts = {}) {
    const idx = this._d.rooms.findIndex(r => r.instanceId === instanceId)
    if (idx === -1) return false
    const room = this._d.rooms[idx]
    this._removeSolidDecors(room)

    // Strip paired cps from every neighbour and re-paint their wall tiles
    // so the door visually disappears. Without this, removing a room would
    // leave dangling doors on its neighbours, and re-placing into the same
    // slot would skip _autoConnect because the wall is "already used".
    this._unpairNeighbourCps(room)

    this._eraseTiles(room)
    this._d.rooms.splice(idx, 1)
    this._rebuildLookup()

    // `isMove` flags MOVE pickup so listeners (KnowledgeSystem stale-
    // mark, RoomBehaviorSystem cleanup) can distinguish a real removal
    // from a transient "removed → about to be re-placed at same id" hop.
    EventBus.emit('ROOM_REMOVED', { room, isMove: !!opts.isMove })
    return true
  }

  // Re-run auto-connect for the room owning (tx,ty). Used when a wall trap
  // is removed so a doorway it was suppressing can finally form.
  recheckAutoConnect(tx, ty) {
    const room = this.getRoomAtTile(tx, ty)
    if (room) this._autoConnect(room)
  }

  _unpairNeighbourCps(room) {
    for (const cp of room.connectionPoints ?? []) {
      const v = DIR_VEC[cp.direction]
      if (!v || cp.external) continue
      // Clear this connection's gap connector cells back to void regardless of
      // whether the partner is still resolvable.
      this._clearConnectorCells(room, cp)
      const ox = room.gridX + cp.x + 2 * v.dx   // 2 steps: across the gap
      const oy = room.gridY + cp.y + 2 * v.dy
      const other = this.getRoomAtTile(ox, oy)
      if (!other || other.instanceId === room.instanceId) continue
      const oppDir = OPPOSITE_DIR[cp.direction]
      const oIdx = (other.connectionPoints ?? []).findIndex(ocp =>
        !ocp.external &&
        ocp.direction === oppDir &&
        other.gridX + ocp.x === ox &&
        other.gridY + ocp.y === oy)
      if (oIdx === -1) continue
      const ocp = other.connectionPoints[oIdx]
      other.connectionPoints.splice(oIdx, 1)
      this._unstampCpDoor(other, ocp)
    }
  }

  // Inverse of _stampCpDoor — repaints the 2 × WT door block as plain wall.
  _unstampCpDoor(room, cp) {
    const WT = Balance.WALL_THICKNESS
    const wallTile = (room.definitionId === 'boss_chamber') ? TILE.BOSS_WALL : TILE.WALL
    const onTop = (cp.y === 0)
    const onBot = (cp.y === room.height - 1)
    const onLft = (cp.x === 0)
    const onRgt = (cp.x === room.width  - 1)
    const onTopOrBot = onTop || onBot
    const onLftOrRgt = onLft || onRgt
    if (onTopOrBot && onLftOrRgt) return
    if (!onTopOrBot && !onLftOrRgt) return

    if (onTopOrBot) {
      const { alongDx } = this._cpAlong(room, cp)
      const yStart  = onTop ? 0 : room.height - WT
      const yEnd    = onTop ? WT - 1 : room.height - 1
      for (let iy = yStart; iy <= yEnd; iy++) {
        for (const ix of [cp.x, cp.x + alongDx]) {
          if (ix < 0 || ix >= room.width) continue
          this._d.tiles[room.gridY + iy][room.gridX + ix] = wallTile
        }
      }
    } else {
      const { alongDy } = this._cpAlong(room, cp)
      const xStart  = onLft ? 0 : room.width - WT
      const xEnd    = onLft ? WT - 1 : room.width - 1
      for (let ix = xStart; ix <= xEnd; ix++) {
        for (const iy of [cp.y, cp.y + alongDy]) {
          if (iy < 0 || iy >= room.height) continue
          this._d.tiles[room.gridY + iy][room.gridX + ix] = wallTile
        }
      }
    }
  }

  validatePlacement(definition, gridX, gridY, opts = {}) {
    const violations = []
    const w = definition.width
    const h = definition.height
    const gw = this._d.gridWidth
    const gh = this._d.gridHeight

    // Bounds
    if (gridX < 0 || gridY < 0 || gridX + w > gw || gridY + h > gh) {
      violations.push('Out of bounds')
    }

    // Fixed rooms cannot be placed by the player (boss seeding bypasses
    // this via opts.allowFixed during initial state creation).
    if (definition.placementRules?.fixed && !opts.allowFixed) {
      violations.push('Fixed room')
    }

    // Overlap check
    if (!violations.length) {
      for (let ty = gridY; ty < gridY + h; ty++) {
        for (let tx = gridX; tx < gridX + w; tx++) {
          if (this._d.tiles[ty][tx] !== TILE.VOID) {
            violations.push('Overlaps existing structure')
            break
          }
        }
        if (violations.length) break
      }
    }

    // FORBID TOUCHING — rooms now connect across a ONE-TILE GAP, so a
    // candidate may not be placed flush (0 gap) against an existing room.
    // Reject if any existing structure tile is orthogonally adjacent to the
    // candidate footprint. Diagonal touching is fine. Boss seeding bypasses
    // via opts.allowFixed. (See ROOM_CONNECTIONS.md.)
    if (!violations.length && !opts.allowFixed) {
      let touches = false
      // top & bottom edge rows
      for (let tx = gridX; tx < gridX + w && !touches; tx++) {
        for (const ty of [gridY - 1, gridY + h]) {
          if (ty < 0 || ty >= gh) continue
          if (this._d.tiles[ty][tx] !== TILE.VOID) { touches = true; break }
        }
      }
      // left & right edge cols
      for (let ty = gridY; ty < gridY + h && !touches; ty++) {
        for (const tx of [gridX - 1, gridX + w]) {
          if (tx < 0 || tx >= gw) continue
          if (this._d.tiles[ty][tx] !== TILE.VOID) { touches = true; break }
        }
      }
      if (touches) violations.push('Leave a 1-tile gap between rooms')
    }

    // Boss-level gating (Room redesign 2026-04-30)
    const dungeonLevel = opts.dungeonLevel ?? 1
    if (!DungeonGrid.isUnlocked(definition, dungeonLevel)) {
      violations.push(`Unlocks at dungeon level ${definition.unlockLevel}`)
    }
    // Max per dungeon — uses maxPerDungeonByBossLevel when present, falls
    // back to static maxPerDungeon for legacy rooms.
    const max = DungeonGrid.effectiveMaxPerDungeon(definition, dungeonLevel)
    if (max !== null && max !== undefined) {
      const count = this._d.rooms.filter(r => r.definitionId === definition.id).length
      if (count >= max) violations.push(`Max ${max} allowed`)
    }

    // Min depth from boss
    const minDepth = definition.placementRules?.minDepthFromBoss ?? 0
    if (minDepth > 0) {
      const bossRoom = this._d.rooms.find(r => r.definitionId === 'boss_chamber')
      if (bossRoom) {
        const bossDepth = this._bfsDepth(bossRoom, gridX, gridY, w, h)
        if (bossDepth < minDepth) violations.push(`Must be at least ${minDepth} room(s) from boss`)
      }
    }

    // Connectivity is now a SOFT constraint — placement is allowed even
    // when the new room is an island. The "Begin Day" gate (see Game.js)
    // blocks day-start until every room is reachable from entry_hall.

    return { valid: violations.length === 0, violations }
  }

  // Free placement — rooms no longer snap. Doors are auto-created at
  // adjacency time (see _autoConnect). Kept as a no-op for callers that
  // still ask for a snap; they all handle null cleanly.
  findSnap(_definition, _gridX, _gridY) {
    return null
  }

  getRoomAtTile(tileX, tileY) {
    const id = this._tileToRoom[`${tileX},${tileY}`]
    return id ? (this._roomById.get(id) ?? null) : null
  }

  // Find the connection point that owns a DOOR tile. Returns { room, cp } or
  // null. Used by AISystem to trigger the open animation when an adventurer
  // first walks onto a closed door's 2 × WALL_THICKNESS block.
  getCpForDoorTile(tileX, tileY) {
    const room = this.getRoomAtTile(tileX, tileY)
    if (!room) return null
    for (const cp of room.connectionPoints ?? []) {
      if (this._isTileInCpDoorBlock(room, cp, tileX, tileY)) return { room, cp }
    }
    return null
  }

  // Resolve the along-axis widen direction for a cp. Auto-connect cps store
  // an explicit `alongDx` / `alongDy` so paired rooms agree on which two
  // cells make up the door. Hand-authored cps (e.g. entry_hall's external
  // N) fall back to the "widen toward the longer half of the wall" rule.
  _cpAlong(room, cp) {
    const onTopOrBot = (cp.y === 0 || cp.y === room.height - 1)
    if (onTopOrBot) {
      const alongDx = (cp.alongDx === 1 || cp.alongDx === -1)
        ? cp.alongDx
        : (((room.width - 1) - cp.x) >= cp.x ? 1 : -1)
      return { alongDx, alongDy: 0 }
    }
    const alongDy = (cp.alongDy === 1 || cp.alongDy === -1)
      ? cp.alongDy
      : (((room.height - 1) - cp.y) >= cp.y ? 1 : -1)
    return { alongDx: 0, alongDy }
  }

  _isTileInCpDoorBlock(room, cp, tx, ty) {
    const WT = Balance.WALL_THICKNESS
    const onTop = cp.y === 0
    const onBot = cp.y === room.height - 1
    const onLft = cp.x === 0
    const onRgt = cp.x === room.width - 1
    if ((onTop || onBot) && (onLft || onRgt)) return false
    if (!onTop && !onBot && !onLft && !onRgt)  return false
    const lx = tx - room.gridX, ly = ty - room.gridY

    if (onTop || onBot) {
      const { alongDx } = this._cpAlong(room, cp)
      const xMin = Math.min(cp.x, cp.x + alongDx)
      const xMax = xMin + 1
      const yMin = onTop ? 0 : room.height - WT
      const yMax = onTop ? WT - 1 : room.height - 1
      return lx >= xMin && lx <= xMax && ly >= yMin && ly <= yMax
    }
    const { alongDy } = this._cpAlong(room, cp)
    const yMin = Math.min(cp.y, cp.y + alongDy)
    const yMax = yMin + 1
    const xMin = onLft ? 0 : room.width - WT
    const xMax = onLft ? WT - 1 : room.width - 1
    return lx >= xMin && lx <= xMax && ly >= yMin && ly <= yMax
  }

  // Wall-mounted traps suppress the auto-door at their wall segment — true
  // if any wall trap sits inside this cp's door block. The player must move
  // the trap before the rooms will connect there.
  _doorBlockOccupiedByWallTrap(room, cp) {
    for (const t of this._d.traps ?? []) {
      if (t.placement !== 'wall') continue
      if (this._isTileInCpDoorBlock(room, cp, t.tileX, t.tileY)) return true
    }
    return false
  }

  getTileType(tileX, tileY) {
    // Wraith Haunt ghosts (and anything else that lerps through tile space)
    // can pass fractional coords here. Without flooring, `tiles[23.99…]`
    // returns undefined and the next `[tileX]` indexing throws — which then
    // ate the AI tick mid-frame and froze the game.
    const tx = Math.floor(tileX)
    const ty = Math.floor(tileY)
    if (tx < 0 || ty < 0 || tx >= this._d.gridWidth || ty >= this._d.gridHeight) return TILE.VOID
    return this._d.tiles[ty][tx]
  }

  // Lane axis for a TILE.DOOR tile.  Returns 'y' (vertical travel —
  // top/bot wall) or 'x' (horizontal travel — left/right wall), or
  // null for non-door tiles or genuinely ambiguous cases.  Shared by
  // isDoorBlocked + getLaneCenterWorld so they agree.
  _doorwayLaneAxisAt(tx, ty) {
    if (this.getTileType(tx, ty) !== TILE.DOOR) return null
    const isFloor = (t) => t === TILE.FLOOR || t === TILE.BOSS_FLOOR
    // Doorways now span up to 2 × WT walls + 1 gap stub (so the gap-stub
    // DOOR tile between two rooms sits 2*WT+1 cells from the nearest
    // floor). Search that full depth so gap tiles still resolve a lane
    // axis — otherwise isDoorBlocked, getLaneCenterWorld, and the L-shape
    // lane gating in AISystem all fail at the gap, and adventurers stop
    // mid-corridor.
    const MAX_DEPTH = 2 * Balance.WALL_THICKNESS + 1
    for (let d = 1; d <= MAX_DEPTH; d++) {
      if (isFloor(this.getTileType(tx, ty - d)) || isFloor(this.getTileType(tx, ty + d))) return 'y'
      if (isFloor(this.getTileType(tx - d, ty)) || isFloor(this.getTileType(tx + d, ty))) return 'x'
    }
    return null
  }

  // Doorway-lane gating used by PathfinderSystem.
  //
  // Doors are stamped as a 2-tile-wide × WT-deep block (see _stampCpDoor).
  // Without any restriction, A* may diagonal-skim through the secondary
  // column and entities don't visibly traverse the doorway centre.  We
  // want every doorway crossing to look the same: walk straight through
  // the canonical lane (single file).
  //
  // Convention: the canonical lane is the column/row with the lower
  // along-axis coord — leftmost x for top/bot doorways, topmost y for
  // left/right doorways.  Both rooms sharing the doorway agree because
  // the choice is in world-tile space.  The OTHER column/row stays
  // visually a TILE.DOOR (so the opening still looks 2-wide), but the
  // pathfinder treats it as blocked.
  //
  // Returns false for non-DOOR tiles so the caller can use this as an
  // additional gate alongside isWalkable.
  isDoorBlocked(tx, ty) {
    const axis = this._doorwayLaneAxisAt(tx, ty)
    if (!axis) return false
    if (axis === 'y') return this.getTileType(tx - 1, ty) === TILE.DOOR
    return this.getTileType(tx, ty - 1) === TILE.DOOR
  }

  // Nearest open FLOOR / BOSS_FLOOR tile to (tx, ty): the tile itself when it's
  // already open floor, else a ring-by-ring search outward to `maxRing`. Used to
  // keep death-spawned things (corpses, blood/bone decals, raised minions, loot)
  // off wall / door / void tiles — a hero that dies in a doorway or is knocked
  // into a wall would otherwise drop them embedded in the wall. Returns null when
  // nothing open is within range (caller keeps its original tile as a fallback).
  nearestFloorTile(tx, ty, maxRing = 2) {
    const open = (x, y) => {
      const t = this.getTileType(x, y)
      return t === TILE.FLOOR || t === TILE.BOSS_FLOOR
    }
    if (open(tx, ty)) return { x: tx, y: ty }
    for (let r = 1; r <= maxRing; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue   // ring perimeter only
          if (open(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy }
        }
      }
    }
    return null
  }

  // Returns the lane-axis ('x' or 'y') if (tx, ty) is part of a doorway
  // CORRIDOR — meaning either a canonical lane DOOR tile or a floor
  // tile cardinally adjacent to one (the approach/exit tile flanking
  // the doorway).  Returns null otherwise.  Movement systems use this
  // to enforce L-shape motion: lateral correction happens BEFORE the
  // corridor (entering) and AFTER the corridor (exiting), so the
  // entire traversal through the doorway shadow is on a single
  // straight line along the lane axis.
  isLaneOrApproach(tx, ty) {
    const t = this.getTileType(tx, ty)
    if (t === TILE.DOOR) {
      if (this.isDoorBlocked(tx, ty)) return null
      return this._doorwayLaneAxisAt(tx, ty)
    }
    if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) {
      const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      for (const [dx, dy] of NB) {
        const nx = tx + dx, ny = ty + dy
        if (this.getTileType(nx, ny) !== TILE.DOOR) continue
        if (this.isDoorBlocked(nx, ny)) continue
        const axis = this._doorwayLaneAxisAt(nx, ny)
        if (axis) return axis
      }
    }
    return null
  }

  // World-coords target for an entity stepping onto (tx, ty).  Normally
  // this is the tile centre, but when (tx, ty) is the canonical lane
  // tile of a 2-wide doorway, the target is shifted ½-tile along the
  // along-axis so the entity walks through the GEOMETRIC CENTRE of the
  // doorway opening (the seam between the two visible door tiles).
  // Approach/exit floor tiles immediately adjacent to a canonical lane
  // tile get the same shift so the entire single-file traversal —
  // approach → lane → exit — is collinear and entry/exit happens via a
  // single ½-tile lateral adjustment one tile before/after the lane.
  getLaneCenterWorld(tx, ty) {
    const TS = Balance.TILE_SIZE
    let cx = tx * TS + TS / 2
    let cy = ty * TS + TS / 2
    const t = this.getTileType(tx, ty)
    let axis = null
    if (t === TILE.DOOR) {
      // Only canonical lane tiles get the shift — secondary tiles are
      // pathfinder-blocked and shouldn't be on any path anyway.
      if (!this.isDoorBlocked(tx, ty)) axis = this._doorwayLaneAxisAt(tx, ty)
    } else if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) {
      // Approach/exit tile = floor tile cardinally adjacent to a
      // canonical lane tile (its only legal entry/exit point given the
      // pathfinder lane gate).
      const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      for (const [dx, dy] of NB) {
        const nx = tx + dx, ny = ty + dy
        if (this.getTileType(nx, ny) !== TILE.DOOR) continue
        if (this.isDoorBlocked(nx, ny)) continue
        axis = this._doorwayLaneAxisAt(nx, ny)
        if (axis) break
      }
    }
    // Shift toward the seam between the canonical and secondary tiles.
    // Canonical = lower along-coord, so the shift is always +TS/2.
    if (axis === 'y')      cx += TS / 2   // top/bot doorway → shift x
    else if (axis === 'x') cy += TS / 2   // left/right doorway → shift y
    return { worldX: cx, worldY: cy }
  }

  // Direct access to the 2D tile array (used by PathfinderSystem for hot loops)
  getTiles() { return this._d.tiles }
  getGridSize() { return { width: this._d.gridWidth, height: this._d.gridHeight } }

  // Architectural rule: minions need a Barracks within N rooms (graph
  // distance). True if `roomId` is within `maxDistance` rooms of any
  // room with a "minion_home" tag.
  hasBarracksWithinDistance(roomId, maxDistance) {
    const target = this._d.rooms.find(r => r.instanceId === roomId)
    if (!target) return false

    const isBarracks = (room) => {
      if (room.tags?.includes?.('minion_home')) return true
      return room.definitionId === 'starter_barracks' || room.definitionId === 'crypt'
    }
    if (isBarracks(target)) return true

    const visited = new Set([target.instanceId])
    const queue = [[target.instanceId, 0]]
    while (queue.length) {
      const [id, d] = queue.shift()
      if (d >= maxDistance) continue
      for (const n of this.getNeighborRooms(id)) {
        if (visited.has(n.instanceId)) continue
        if (isBarracks(n)) return true
        visited.add(n.instanceId)
        queue.push([n.instanceId, d + 1])
      }
    }
    return false
  }

  // Two rooms are neighbours iff they have a pair of facing doorways across
  // their one-tile connector gap. Walks every doorway on `room` and checks
  // whether the cell TWO steps outward (across the gap to the other room's
  // outer wall) is owned by another room with an opposite-facing doorway
  // whose anchor lines up. (Was 1 step under the old wall-to-wall model.)
  getNeighborRooms(roomId) {
    const room = this._d.rooms.find(r => r.instanceId === roomId)
    if (!room) return []
    const neighborIds = new Set()

    for (const cp of room.connectionPoints ?? []) {
      const v = DIR_VEC[cp.direction]
      if (!v) continue
      if (cp.external) continue   // entrance cps face outside, no neighbour
      const ox = room.gridX + cp.x + 2 * v.dx
      const oy = room.gridY + cp.y + 2 * v.dy
      const other = this.getRoomAtTile(ox, oy)
      if (!other || other.instanceId === roomId) continue
      // The other room's doorway must face back at us.
      const oppDir = OPPOSITE_DIR[cp.direction]
      const matched = (other.connectionPoints ?? []).some(ocp =>
        !ocp.external &&
        ocp.direction === oppDir &&
        other.gridX + ocp.x === ox &&
        other.gridY + ocp.y === oy)
      if (matched) neighborIds.add(other.instanceId)
    }

    return [...neighborIds].map(id => this._d.rooms.find(r => r.instanceId === id)).filter(Boolean)
  }

  getDepthFromBoss(roomId) {
    const boss = this._d.rooms.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return 0
    if (boss.instanceId === roomId) return 0
    const visited = new Set([boss.instanceId])
    const queue = [[boss.instanceId, 0]]
    while (queue.length) {
      const [current, depth] = queue.shift()
      for (const neighbour of this.getNeighborRooms(current)) {
        if (!visited.has(neighbour.instanceId)) {
          if (neighbour.instanceId === roomId) return depth + 1
          visited.add(neighbour.instanceId)
          queue.push([neighbour.instanceId, depth + 1])
        }
      }
    }
    return Infinity
  }

  // Reachability gate for Begin Day. Returns the list of rooms NOT
  // reachable from ANY entry hall via the doorway graph. Empty array ==
  // fully connected. Boss chamber counts as disconnected if no path
  // exists; the player must place rooms bridging an entry_hall to it.
  //
  // Multi-source BFS: at boss level 5+ the game forces a 2nd entry hall
  // (3rd at lv10). Each entry hall is an independent spawn point, so
  // any room reachable from ANY entry hall counts as connected. Seeding
  // from only the first entry hall (the old behaviour) made the 2nd /
  // 3rd entry halls — and any wing connected only through them — show
  // up as disconnected, even when the dungeon was perfectly valid.
  // Matches the "at least one entry hall" rule the key-chest placement
  // validator already uses.
  getDisconnectedRooms() {
    const entries = this._d.rooms.filter(r => r.definitionId === 'entry_hall')
    if (entries.length === 0) return [...this._d.rooms]
    const reachable = new Set()
    const queue = []
    for (const e of entries) {
      reachable.add(e.instanceId)
      queue.push(e.instanceId)
    }
    while (queue.length) {
      const id = queue.shift()
      for (const n of this.getNeighborRooms(id)) {
        if (reachable.has(n.instanceId)) continue
        reachable.add(n.instanceId)
        queue.push(n.instanceId)
      }
    }
    return this._d.rooms.filter(r => !reachable.has(r.instanceId))
  }

  // Expand the dungeon grid to (newWidth, newHeight). When leftOffset /
  // topOffset are non-zero, the existing tiles are placed at that offset
  // inside the new grid — so the dungeon effectively gains space on the
  // LEFT (`leftOffset`) and TOP (`topOffset`) as well as the right /
  // bottom. All dungeon-side entities (rooms, traps, fountains, chests,
  // beacons, locks, lootPiles, phylactery, items, decorations) get their
  // tile coordinates shifted by (+leftOffset, +topOffset) to match. The
  // tile lookup is rebuilt at the end.
  //
  // External-to-dungeon entities (boss, minions, in-flight adventurers,
  // knowledge buckets in gameState.knowledge) live OUTSIDE this object's
  // ownership; the caller (Game._applyPendingGridGrowth) handles their
  // shift. We emit GRID_EXPANDED with both the new size AND the offset
  // so listeners can update accordingly.
  //
  // Backward-compatible: with leftOffset/topOffset both 0, behaves
  // exactly like the original right/bottom-only growth.
  expandGrid(newWidth, newHeight, leftOffset = 0, topOffset = 0) {
    const oldH = this._d.gridHeight
    const oldW = this._d.gridWidth
    if (leftOffset === 0 && topOffset === 0) {
      // Fast path — original behavior. Append-only.
      for (let y = 0; y < oldH; y++) {
        while (this._d.tiles[y].length < newWidth) this._d.tiles[y].push(TILE.VOID)
      }
      while (this._d.tiles.length < newHeight) {
        this._d.tiles.push(new Array(newWidth).fill(TILE.VOID))
      }
    } else {
      // Re-build the entire tile grid so old tiles land at (leftOffset, topOffset).
      const newTiles = []
      for (let y = 0; y < newHeight; y++) {
        newTiles.push(new Array(newWidth).fill(TILE.VOID))
      }
      for (let y = 0; y < oldH; y++) {
        const srcRow = this._d.tiles[y] ?? []
        const dstRow = newTiles[y + topOffset]
        if (!dstRow) continue
        for (let x = 0; x < oldW; x++) {
          dstRow[x + leftOffset] = srcRow[x] ?? TILE.VOID
        }
      }
      this._d.tiles = newTiles
      // Shift every dungeon-side entity coord by (+leftOffset, +topOffset)
      // so its in-grid position is unchanged after the re-anchor.
      const dx = leftOffset, dy = topOffset
      for (const room of this._d.rooms ?? []) {
        room.gridX += dx
        room.gridY += dy
      }
      for (const trap of this._d.traps ?? []) {
        if (typeof trap.tileX === 'number') { trap.tileX += dx; trap.tileY += dy }
      }
      for (const f of this._d.fountains ?? []) {
        if (typeof f.tileX === 'number') { f.tileX += dx; f.tileY += dy }
      }
      for (const c of this._d.treasureChests ?? []) {
        if (typeof c.tileX === 'number') { c.tileX += dx; c.tileY += dy }
      }
      for (const b of this._d.beacons ?? []) {
        if (typeof b.tileX === 'number') { b.tileX += dx; b.tileY += dy }
      }
      for (const p of this._d.lootPiles ?? []) {
        if (typeof p.tileX === 'number') { p.tileX += dx; p.tileY += dy }
      }
      for (const it of this._d.items ?? []) {
        if (typeof it.tileX === 'number') { it.tileX += dx; it.tileY += dy }
      }
      for (const lock of this._d.locks ?? []) {
        if (Array.isArray(lock.doorTiles)) {
          for (const t of lock.doorTiles) { t.x += dx; t.y += dy }
        }
      }
      if (this._d.phylactery && typeof this._d.phylactery.tileX === 'number') {
        this._d.phylactery.tileX += dx
        this._d.phylactery.tileY += dy
      }
      this._rebuildLookup()
    }
    this._d.gridWidth = newWidth
    this._d.gridHeight = newHeight
    EventBus.emit('GRID_EXPANDED', { newWidth, newHeight, leftOffset, topOffset })
  }

  // Call after loading a save to restore tile index
  rebuild() {
    this._rebuildLookup()
  }

  // Re-apply a room definition's tile layout to an already-placed room
  // instance. Use this when a room definition changes (e.g. Room Builder save)
  // and you need already-placed rooms to immediately reflect the new tile grid
  // without the player having to remove and re-place them.
  reapplyRoomDef(room, definition) {
    this._eraseTiles(room)
    this._writeTiles(room, definition)
    // Rebuild the tile→room lookup because _eraseTiles voids and then
    // _writeTiles may lay tiles that differ from the originals.
    this._rebuildLookup()
  }

  // ── Tile writing ─────────────────────────────────────────────────────────────

  _writeTiles(room, definition) {
    const isBoss = definition.id === 'boss_chamber'
    const floorTile = isBoss ? TILE.BOSS_FLOOR : TILE.FLOOR
    const wallTile  = isBoss ? TILE.BOSS_WALL  : TILE.WALL
    const WT        = Balance.WALL_THICKNESS

    if (Array.isArray(definition.tiles) && definition.tiles.length === room.height) {
      // Override path — paint the exact TILE values authored in Room Builder.
      // VOID inside the footprint stays VOID (lets the designer carve out
      // alcoves / courtyards on purpose).
      for (let dy = 0; dy < room.height; dy++) {
        const row = definition.tiles[dy]
        if (!row) continue
        for (let dx = 0; dx < room.width; dx++) {
          const t = row[dx] ?? TILE.VOID
          this._d.tiles[room.gridY + dy][room.gridX + dx] = t
        }
      }
    } else {
      // Default — WT-thick perimeter wall + interior floor.
      for (let dy = 0; dy < room.height; dy++) {
        for (let dx = 0; dx < room.width; dx++) {
          const isEdge = dy < WT || dy >= room.height - WT || dx < WT || dx >= room.width - WT
          this._d.tiles[room.gridY + dy][room.gridX + dx] = isEdge ? wallTile : floorTile
        }
      }
    }

    // Stamp doorways. See _stampCpDoor.
    for (const cp of room.connectionPoints) this._stampCpDoor(room, cp)
  }

  // Stamp the 2 × WT door block for one cp. 2 cells along the wall axis,
  // WT cells through the wall. Along-axis widening picks the side with
  // more wall space. Corner / interior cps are silently skipped.
  _stampCpDoor(room, cp) {
    const WT = Balance.WALL_THICKNESS
    const onTop = (cp.y === 0)
    const onBot = (cp.y === room.height - 1)
    const onLft = (cp.x === 0)
    const onRgt = (cp.x === room.width  - 1)
    const onTopOrBot = onTop || onBot
    const onLftOrRgt = onLft || onRgt
    if (onTopOrBot && onLftOrRgt) return
    if (!onTopOrBot && !onLftOrRgt) return

    if (onTopOrBot) {
      const { alongDx } = this._cpAlong(room, cp)
      const yStart  = onTop ? 0 : room.height - WT
      const yEnd    = onTop ? WT - 1 : room.height - 1
      for (let iy = yStart; iy <= yEnd; iy++) {
        for (const ix of [cp.x, cp.x + alongDx]) {
          if (ix < 0 || ix >= room.width) continue
          this._d.tiles[room.gridY + iy][room.gridX + ix] = TILE.DOOR
        }
      }
    } else {
      const { alongDy } = this._cpAlong(room, cp)
      const xStart  = onLft ? 0 : room.width - WT
      const xEnd    = onLft ? WT - 1 : room.width - 1
      for (let ix = xStart; ix <= xEnd; ix++) {
        for (const iy of [cp.y, cp.y + alongDy]) {
          if (iy < 0 || iy >= room.height) continue
          this._d.tiles[room.gridY + iy][room.gridX + ix] = TILE.DOOR
        }
      }
    }
  }

  // Stamp the 1-tile gap CONNECTOR between two 1-gap-apart rooms as DOOR
  // (2 cells wide along the wall). These cells sit OUTSIDE both rooms'
  // footprints (in the gap), so this writes dungeon-absolute coords. The
  // connector + both rooms' wall openings form the 2*WT+1-deep corridor.
  _stampConnectorCells(room, cp) {
    const v = DIR_VEC[cp.direction]
    if (!v) return
    const adx = cp.alongDx ?? 0, ady = cp.alongDy ?? 0
    const bx = room.gridX + cp.x + v.dx
    const by = room.gridY + cp.y + v.dy
    for (const [cx, cy] of [[bx, by], [bx + adx, by + ady]]) {
      if (cy < 0 || cy >= this._d.tiles.length) continue
      if (cx < 0 || cx >= this._d.tiles[cy].length) continue
      if (this._d.tiles[cy][cx] === TILE.VOID) this._d.tiles[cy][cx] = TILE.DOOR
    }
  }

  // Inverse — clear the gap connector cells back to VOID (room removed/moved).
  _clearConnectorCells(room, cp) {
    const v = DIR_VEC[cp.direction]
    if (!v) return
    const adx = cp.alongDx ?? 0, ady = cp.alongDy ?? 0
    const bx = room.gridX + cp.x + v.dx
    const by = room.gridY + cp.y + v.dy
    for (const [cx, cy] of [[bx, by], [bx + adx, by + ady]]) {
      if (cy < 0 || cy >= this._d.tiles.length) continue
      if (cx < 0 || cx >= this._d.tiles[cy].length) continue
      if (this._d.tiles[cy][cx] === TILE.DOOR) this._d.tiles[cy][cx] = TILE.VOID
    }
  }

  // Auto-create paired cps + doors between `newRoom` and any existing
  // room sharing a wall with a 1-tile gap. Constraints:
  //   - max 1 door per room per wall (so 4 max per regular room)
  //   - boss_chamber gets max 1 door total
  //   - overlap must be >= 2 cells along the shared axis (so the 2-wide
  //     door fits); smaller overlaps are silently allowed-without-door
  // The cp position is anchored so the door pair sits centred on the
  // overlap range, using the existing widen-toward-larger-half rule.
  _autoConnect(newRoom) {
    const pairs = this._computeAutoConnectPairs(newRoom)
    for (const { newCp, otherRoom, otherCp } of pairs) {
      newRoom.connectionPoints.push(newCp)
      otherRoom.connectionPoints.push(otherCp)
      this._stampCpDoor(newRoom, newCp)
      this._stampCpDoor(otherRoom, otherCp)
      this._stampConnectorCells(newRoom, newCp)   // the black connector in the gap
    }
  }

  // Pure (no mutation) version of the auto-connect pairing logic. Returns
  // an array of `{ newCp, otherRoom, otherCp }` entries describing every
  // door pair that *would* be created if `candidate` were placed. Used by
  // _autoConnect to do the work, and by NightPhase's placement preview to
  // show the player which doors will appear before they click.
  //
  // `candidate` must expose: gridX, gridY, width, height, definitionId,
  // connectionPoints (array; usually [] for fresh placements, but may
  // contain pre-authored cps like entry_hall's external N entrance).
  computeAutoConnectPairs(candidate) {
    return this._computeAutoConnectPairs(candidate)
  }

  _computeAutoConnectPairs(newRoom) {
    const out = []
    const isBossNew = newRoom.definitionId === 'boss_chamber'
    const seedCps   = (newRoom.connectionPoints ?? [])
    const usedWallsNew = new Set(seedCps.map(c => c.direction))
    let   newDoorCount = seedCps.length

    for (const other of this._d.rooms) {
      // Skip self when called from placeRoom (newRoom is in _d.rooms).
      if (other.instanceId && other.instanceId === newRoom.instanceId) continue
      const isBossOther = other.definitionId === 'boss_chamber'
      if (isBossNew && newDoorCount >= 1) break
      if (isBossOther && (other.connectionPoints ?? []).length >= 1) continue

      // Detect 1-tile-gap adjacency on each side of `newRoom` and the
      // overlap range along the shared axis.
      // newRoom edges in dungeon coords:
      const nL = newRoom.gridX, nR = newRoom.gridX + newRoom.width  - 1
      const nT = newRoom.gridY, nB = newRoom.gridY + newRoom.height - 1
      const oL = other.gridX,    oR = other.gridX   + other.width   - 1
      const oT = other.gridY,    oB = other.gridY   + other.height  - 1

      let dirNew = null   // direction the new room's wall faces toward `other`
      let oxRange = null  // [start, end] along X (for N/S adjacency)
      let oyRange = null  // [start, end] along Y (for E/W adjacency)
      // Rooms connect across a ONE-TILE GAP (not wall-to-wall) — the facing
      // edges are 2 cells apart (other's outer edge, the gap row, our outer
      // edge). See ROOM_CONNECTIONS.md.
      if (oB + 2 === nT) {                       // other is NORTH of new
        dirNew = 'N'
        oxRange = [Math.max(nL, oL), Math.min(nR, oR)]
      } else if (oT - 2 === nB) {                 // other is SOUTH of new
        dirNew = 'S'
        oxRange = [Math.max(nL, oL), Math.min(nR, oR)]
      } else if (oR + 2 === nL) {                 // other is WEST of new
        dirNew = 'W'
        oyRange = [Math.max(nT, oT), Math.min(nB, oB)]
      } else if (oL - 2 === nR) {                 // other is EAST of new
        dirNew = 'E'
        oyRange = [Math.max(nT, oT), Math.min(nB, oB)]
      } else continue

      if (usedWallsNew.has(dirNew)) continue
      const dirOther = OPPOSITE_DIR[dirNew]
      if ((other.connectionPoints ?? []).some(c => c.direction === dirOther)) continue

      // Both cps anchor on the SAME dungeon cell (the lower-coord cell of
      // the door pair). To avoid stamping doors into either room's corner
      // zone (the WT × WT area at each rect corner), wcenter is clamped to
      // the intersection of:
      //   - the overlap range minus 1 (so wcenter+1 stays in overlap)
      //   - newRoom's mid-wall band [gridY|X+WT, gridY|X+size-WT-2]
      //   - other's mid-wall band
      // If the intersection is empty, the rooms only graze each other near
      // the corners and no door is created (still allowed by validation —
      // they place as a doorless adjacency).
      const range = oxRange || oyRange
      if (range[1] - range[0] + 1 < 2) continue
      const WT = Balance.WALL_THICKNESS
      let lo, hi
      if (oxRange) {
        lo = Math.max(range[0],
                      newRoom.gridX + WT,
                      other.gridX   + WT)
        hi = Math.min(range[1] - 1,
                      newRoom.gridX + newRoom.width - WT - 2,
                      other.gridX   + other.width   - WT - 2)
      } else {
        lo = Math.max(range[0],
                      newRoom.gridY + WT,
                      other.gridY   + WT)
        hi = Math.min(range[1] - 1,
                      newRoom.gridY + newRoom.height - WT - 2,
                      other.gridY   + other.height   - WT - 2)
      }
      if (lo > hi) continue
      // Connection is allowed ONLY when both facing walls' MIDPOINTS coincide
      // on the same cell (the boss rule, now universal). Each room's wall-center
      // cell (the lower-coord cell of its 2-wide door) uses the boss formula
      // origin + floor((size - 2) / 2). If the centers differ, or the shared
      // center falls outside the legal mid-wall band [lo,hi], no door forms.
      let centerNew, centerOther
      if (oxRange) {
        centerNew   = newRoom.gridX + Math.floor((newRoom.width  - 2) / 2)
        centerOther = other.gridX   + Math.floor((other.width    - 2) / 2)
      } else {
        centerNew   = newRoom.gridY + Math.floor((newRoom.height - 2) / 2)
        centerOther = other.gridY   + Math.floor((other.height   - 2) / 2)
      }
      if (centerNew !== centerOther) continue
      const wcenter = centerNew
      if (wcenter < lo || wcenter > hi) continue

      let cpNew, cpOther
      if (oxRange) {
        const cpyNew   = (dirNew   === 'N') ? 0 : newRoom.height - 1
        const cpyOther = (dirOther === 'N') ? 0 : other.height   - 1
        const cpxNew   = wcenter - newRoom.gridX
        const cpxOther = wcenter - other.gridX
        cpNew   = { x: cpxNew,   y: cpyNew,   direction: dirNew,   alongDx:  1, alongDy: 0 }
        cpOther = { x: cpxOther, y: cpyOther, direction: dirOther, alongDx:  1, alongDy: 0 }
      } else {
        const cpxNew   = (dirNew   === 'W') ? 0 : newRoom.width - 1
        const cpxOther = (dirOther === 'W') ? 0 : other.width   - 1
        const cpyNew   = wcenter - newRoom.gridY
        const cpyOther = wcenter - other.gridY
        cpNew   = { x: cpxNew, y: cpyNew,   direction: dirNew,   alongDx: 0, alongDy: 1 }
        cpOther = { x: cpxOther, y: cpyOther, direction: dirOther, alongDx: 0, alongDy: 1 }
      }

      // Style propagation: boss-room cps render with the boss style.
      const styleNew   = isBossNew   ? 'boss' : 'regular'
      const styleOther = isBossOther ? 'boss' : 'regular'

      const fullNew = {
        style: styleNew, external: false, ...cpNew,
        open: false, opening: false, openProgress: 0,
      }
      const fullOther = {
        style: styleOther, external: false, ...cpOther,
        open: false, opening: false, openProgress: 0,
      }
      // A wall-mounted trap on either room's segment blocks this doorway.
      if (this._doorBlockOccupiedByWallTrap(newRoom, fullNew) ||
          this._doorBlockOccupiedByWallTrap(other, fullOther)) {
        continue
      }
      out.push({ newCp: fullNew, otherRoom: other, otherCp: fullOther })
      usedWallsNew.add(dirNew)
      newDoorCount++

      if (isBossNew && newDoorCount >= 1) break
    }
    return out
  }

  _eraseTiles(room) {
    for (let dy = 0; dy < room.height; dy++) {
      for (let dx = 0; dx < room.width; dx++) {
        this._d.tiles[room.gridY + dy][room.gridX + dx] = TILE.VOID
      }
    }
  }

  // ── Lookup helpers ───────────────────────────────────────────────────────────

  _rebuildLookup() {
    this._tileToRoom = {}
    this._roomById   = new Map()
    for (const room of this._d.rooms) {
      this._indexRoom(room)
    }
  }

  // Index a single room into BOTH lookup maps. Called by _rebuildLookup
  // (rebuilds everything) AND by placeRoom (single-room incremental
  // update). Bug 2026-05-25: _roomById was only being populated by
  // _rebuildLookup, so freshly-placed rooms had a tile→id mapping but
  // no id→room mapping — getRoomAtTile returned null for newly-placed
  // rooms, which broke MOVE / SELL pickup on rooms placed after grid
  // init. Both maps now live inside _indexRoom so any path that adds
  // a room keeps them in lockstep.
  _indexRoom(room) {
    this._roomById.set(room.instanceId, room)
    for (let dy = 0; dy < room.height; dy++) {
      for (let dx = 0; dx < room.width; dx++) {
        this._tileToRoom[`${room.gridX + dx},${room.gridY + dy}`] = room.instanceId
      }
    }
  }

  // BFS grid-distance from boss using rect-adjacency (used by minDepthFromBoss
  // checks at placement time, before the room is in the rooms list).
  _bfsDepth(bossRoom, gridX, gridY, w, h) {
    const candidate = { gridX, gridY, width: w, height: h }
    const visited = new Set([bossRoom.instanceId])
    const queue = [[bossRoom, 0]]
    while (queue.length) {
      const [room, d] = queue.shift()
      if (_rectsAdjacent(room, candidate)) return d + 1
      for (const other of this._d.rooms) {
        if (visited.has(other.instanceId)) continue
        if (_rectsAdjacent(room, other)) {
          visited.add(other.instanceId)
          queue.push([other, d + 1])
        }
      }
    }
    return Infinity
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function _rectsAdjacent(a, b) {
  // True if rects are within a ONE-TILE GAP of each other (rooms now connect
  // across a 1-tile gap, not wall-to-wall). Separated only when the gap is
  // >= 2 on an axis. Used by the minDepthFromBoss BFS at placement time.
  return !(a.gridX + a.width  - 1 < b.gridX - 1 ||
           b.gridX + b.width  - 1 < a.gridX - 1 ||
           a.gridY + a.height - 1 < b.gridY - 1 ||
           b.gridY + b.height - 1 < a.gridY - 1)
}
