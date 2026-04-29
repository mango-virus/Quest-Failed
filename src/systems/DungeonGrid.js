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
    this._rebuildLookup()
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

    const room = {
      instanceId: _uid(),
      definitionId: definition.id,
      gridX,
      gridY,
      width: definition.width,
      height: definition.height,
      isActive: true,
      upkeepCost: definition.upkeepCost ?? 0,
      connectionPoints: (definition.connectionPoints ?? []).map(cp => ({ ...cp })),
      state: {},
    }

    this._writeTiles(room, definition)
    this._d.rooms.push(room)
    this._indexRoom(room)

    EventBus.emit('ROOM_PLACED', { room })
    return room
  }

  removeRoom(instanceId) {
    const idx = this._d.rooms.findIndex(r => r.instanceId === instanceId)
    if (idx === -1) return false
    const room = this._d.rooms[idx]

    this._eraseTiles(room)
    this._d.rooms.splice(idx, 1)
    this._rebuildLookup()

    EventBus.emit('ROOM_REMOVED', { room })
    return true
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

    // Max per dungeon
    const max = definition.placementRules?.maxPerDungeon
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

    // Doorway connection requirement — every player-placed room must have
    // at least one doorway pair aligned with an existing room. Otherwise
    // it would be unreachable in a corridor-free dungeon. Boss chamber
    // skips this since it's the seed room.
    if (!violations.length && !opts.allowDisconnected && this._d.rooms.length > 0) {
      const candidate = { gridX, gridY, width: w, height: h, connectionPoints: definition.connectionPoints ?? [] }
      if (!this._hasDoorwayLink(candidate)) {
        violations.push('Doorway must align with an existing room')
      }
    }

    return { valid: violations.length === 0, violations }
  }

  // Try to nudge (gridX, gridY) so that a doorway on the placed room sits
  // facing a doorway on an existing room. Returns { gridX, gridY } if a
  // snap is found within SNAP_RADIUS, else null. The first matching pair
  // wins — multiple aligned doorways still all count as connections, this
  // just picks where to anchor the room.
  findSnap(definition, gridX, gridY) {
    const cps = definition.connectionPoints ?? []
    if (cps.length === 0) return null

    let best = null
    let bestDist = Infinity

    for (const cp of cps) {
      const v = DIR_VEC[cp.direction]
      if (!v) continue
      // Where this candidate doorway would land on the dungeon grid for
      // the proposed (gridX, gridY).
      for (const other of this._d.rooms) {
        for (const ocp of other.connectionPoints ?? []) {
          if (ocp.direction !== OPPOSITE_DIR[cp.direction]) continue
          // Other room's doorway in dungeon coords:
          const ox = other.gridX + ocp.x
          const oy = other.gridY + ocp.y
          // The placed room's doorway must sit one cell INWARD from the
          // other room's doorway along its outward direction.
          //   placed cp tile = (ox + v_other.dx, oy + v_other.dy)
          // (v_other points outward from `other` → that's the cell next
          // to it which the new room's doorway should occupy.)
          const ov = DIR_VEC[ocp.direction]
          const targetX = ox + ov.dx
          const targetY = oy + ov.dy
          // Solve for the room's gridX/gridY so its cp lands on target.
          const candX = targetX - cp.x
          const candY = targetY - cp.y
          const dx = candX - gridX
          const dy = candY - gridY
          const dist = Math.abs(dx) + Math.abs(dy)
          if (dist <= SNAP_RADIUS && dist < bestDist) {
            bestDist = dist
            best = { gridX: candX, gridY: candY, viaDoorway: cp, otherDoorway: ocp, otherRoomId: other.instanceId }
          }
        }
      }
    }
    return best
  }

  getRoomAtTile(tileX, tileY) {
    const id = this._tileToRoom[`${tileX},${tileY}`]
    return id ? this._d.rooms.find(r => r.instanceId === id) ?? null : null
  }

  getTileType(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= this._d.gridWidth || tileY >= this._d.gridHeight) return TILE.VOID
    return this._d.tiles[tileY][tileX]
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

  // Two rooms are neighbours iff they have a pair of facing doorways
  // (e.g. one E-facing and one W-facing) one tile apart. Walks every
  // doorway on `room` and checks whether the cell directly outside it
  // is owned by another room with an opposite-facing doorway.
  getNeighborRooms(roomId) {
    const room = this._d.rooms.find(r => r.instanceId === roomId)
    if (!room) return []
    const neighborIds = new Set()

    for (const cp of room.connectionPoints ?? []) {
      const v = DIR_VEC[cp.direction]
      if (!v) continue
      const ox = room.gridX + cp.x + v.dx
      const oy = room.gridY + cp.y + v.dy
      const other = this.getRoomAtTile(ox, oy)
      if (!other || other.instanceId === roomId) continue
      // The other room's doorway must face back at us.
      const oppDir = OPPOSITE_DIR[cp.direction]
      const matched = (other.connectionPoints ?? []).some(ocp =>
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

  expandGrid(newWidth, newHeight) {
    const oldH = this._d.gridHeight
    const oldW = this._d.gridWidth
    for (let y = 0; y < oldH; y++) {
      while (this._d.tiles[y].length < newWidth) this._d.tiles[y].push(TILE.VOID)
    }
    while (this._d.tiles.length < newHeight) {
      this._d.tiles.push(new Array(newWidth).fill(TILE.VOID))
    }
    this._d.gridWidth = newWidth
    this._d.gridHeight = newHeight
    EventBus.emit('GRID_EXPANDED', { newWidth, newHeight })
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
      // Default — perimeter wall + interior floor.
      for (let dy = 0; dy < room.height; dy++) {
        for (let dx = 0; dx < room.width; dx++) {
          const isEdge = dy === 0 || dy === room.height - 1 || dx === 0 || dx === room.width - 1
          this._d.tiles[room.gridY + dy][room.gridX + dx] = isEdge ? wallTile : floorTile
        }
      }
    }

    // Connection points always map to DOOR tiles, regardless of source.
    for (const cp of room.connectionPoints) {
      this._d.tiles[room.gridY + cp.y][room.gridX + cp.x] = TILE.DOOR
    }

    // Widen every doorway to 2 tiles. The extra door tile sits adjacent to
    // the connection point along the wall axis, on whichever side has more
    // wall remaining. Skipped if the connection point sits in a corner or
    // if the chosen neighbour isn't a wall (e.g. another door is already
    // there from an adjacent connection point).
    for (const cp of room.connectionPoints) {
      const onTopOrBot = (cp.y === 0 || cp.y === room.height - 1)
      const onLftOrRgt = (cp.x === 0 || cp.x === room.width  - 1)
      let dx = 0, dy = 0
      if (onTopOrBot && !onLftOrRgt) {
        // Horizontal wall — extend along X.
        const leftSpace  = cp.x
        const rightSpace = (room.width - 1) - cp.x
        dx = (rightSpace >= leftSpace) ? 1 : -1
      } else if (onLftOrRgt && !onTopOrBot) {
        // Vertical wall — extend along Y.
        const upSpace   = cp.y
        const downSpace = (room.height - 1) - cp.y
        dy = (downSpace >= upSpace) ? 1 : -1
      } else {
        continue   // corner or interior — leave alone
      }
      const tx = room.gridX + cp.x + dx
      const ty = room.gridY + cp.y + dy
      const cur = this._d.tiles[ty]?.[tx]
      if (cur === TILE.WALL || cur === TILE.BOSS_WALL || cur === TILE.WALL_CAP) {
        this._d.tiles[ty][tx] = TILE.DOOR
      }
    }
  }

  _eraseTiles(room) {
    for (let dy = 0; dy < room.height; dy++) {
      for (let dx = 0; dx < room.width; dx++) {
        this._d.tiles[room.gridY + dy][room.gridX + dx] = TILE.VOID
      }
    }
  }

  // ── Doorway adjacency check (placement validation) ─────────────────────────

  _hasDoorwayLink(candidate) {
    const cps = candidate.connectionPoints ?? []
    for (const cp of cps) {
      const v = DIR_VEC[cp.direction]
      if (!v) continue
      const ox = candidate.gridX + cp.x + v.dx
      const oy = candidate.gridY + cp.y + v.dy
      const other = this.getRoomAtTile(ox, oy)
      if (!other) continue
      const oppDir = OPPOSITE_DIR[cp.direction]
      const matched = (other.connectionPoints ?? []).some(ocp =>
        ocp.direction === oppDir &&
        other.gridX + ocp.x === ox &&
        other.gridY + ocp.y === oy)
      if (matched) return true
    }
    return false
  }

  // ── Lookup helpers ───────────────────────────────────────────────────────────

  _rebuildLookup() {
    this._tileToRoom = {}
    for (const room of this._d.rooms) {
      this._indexRoom(room)
    }
  }

  _indexRoom(room) {
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
  // True if rects share an edge OR are exactly tile-touching (the new
  // doorway-snap layout puts neighbouring rooms wall-to-wall, no gap).
  const gap = 1
  return !(a.gridX + a.width + gap < b.gridX ||
           b.gridX + b.width + gap < a.gridX ||
           a.gridY + a.height + gap < b.gridY ||
           b.gridY + b.height + gap < a.gridY)
}
