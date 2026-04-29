// Phase 9b — Paranoia Protocol indicator overlay.
//
// When the `paranoia_protocol` mechanic is active, paint a faux "10% trap"
// indicator above every healing fountain, treasure room, and (if any) door
// or chest. The whole point of the mechanic is that adventurers see the
// indicator on EVERY interactive object, regardless of whether it's actually
// trapped — making them paranoid.
//
// Renders as world-space text labels at depth 4.5 (above traps, below
// adventurers). Refresh once per second; toggles wholesale on
// MECHANIC_ACTIVATED / MECHANIC_DEACTIVATED events for paranoia_protocol.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE
const REFRESH_MS = 1000

const PARANOID_ROOM_TYPES = new Set([
  'healing_fountain',
  'treasure_room',
])

export class ParanoiaIndicator {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._labels = []
    this._enabled = false
    this._lastRefresh = 0

    EventBus.on('MECHANIC_ACTIVATED',   this._onMechanicChange, this)
    EventBus.on('MECHANIC_DEACTIVATED', this._onMechanicChange, this)
  }

  destroy() {
    EventBus.off('MECHANIC_ACTIVATED',   this._onMechanicChange, this)
    EventBus.off('MECHANIC_DEACTIVATED', this._onMechanicChange, this)
    this._clearLabels()
  }

  _onMechanicChange({ mechanicId }) {
    if (mechanicId !== 'paranoia_protocol') return
    const flags = this._gameState._mechanicFlags ?? {}
    this.setEnabled(!!flags.paranoiaProtocol)
  }

  setEnabled(on) {
    this._enabled = !!on
    if (!this._enabled) this._clearLabels()
    else this._refresh()
  }

  update() {
    if (!this._enabled) return
    const now = this._scene.time.now
    if (now - this._lastRefresh < REFRESH_MS) return
    this._lastRefresh = now
    this._refresh()
  }

  _refresh() {
    this._clearLabels()
    for (const room of this._gameState.dungeon.rooms ?? []) {
      if (!PARANOID_ROOM_TYPES.has(room.definitionId)) continue
      const cx = (room.gridX + room.width / 2) * TS
      const cy = (room.gridY + 1) * TS
      const t = this._scene.add.text(cx, cy, '⚠ 10%', {
        fontSize: '10px', color: '#ffaa44', fontFamily: 'monospace', fontStyle: 'bold',
        stroke: '#1a0a04', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(4.5)
      this._labels.push(t)
    }
  }

  _clearLabels() {
    for (const l of this._labels) l.destroy()
    this._labels = []
  }
}
