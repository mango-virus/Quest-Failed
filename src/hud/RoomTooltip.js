// RoomTooltip — DOM tooltip for in-game dungeon-view room hover.
//
// Subscribes to `SHOW_ROOM_TOOLTIP { room, defId, x, y, tab? }` and
// `HIDE_ROOM_TOOLTIP`. Two-tab body (STATS / HISTORY) — same shape the
// design's dungeon-view spec calls for.
//
// The hover-detection side (Phaser canvas → emit SHOW_ROOM_TOOLTIP) is
// glued in via a passive pointermove handler in HudRoot: it reads the
// active Game scene's camera, converts client coords to tile coords,
// and hit-tests against placed rooms.

import { h, mount } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class RoomTooltip {
  constructor() {
    this._el = null
    this._currentRoomId = null
    this._tab = 'stats'   // 'stats' | 'history'
    this._showListener = (payload) => this.showFor(payload)
    this._hideListener = () => this.hide()
    EventBus.on('SHOW_ROOM_TOOLTIP', this._showListener)
    EventBus.on('HIDE_ROOM_TOOLTIP', this._hideListener)
  }

  showFor({ room, x = 0, y = 0 } = {}) {
    if (!room) return
    // Suppress re-mount when the same room is hovered again — keeps the
    // tab state across pointermove ticks.
    if (this._currentRoomId === room.instanceId && this._el) {
      // Offset chosen so the tooltip clears the 42-px custom cursor
      // sprite (its hotspot is the top-left pixel; the body extends
      // down + right). y+44 puts the tooltip's top edge just below
      // the cursor's bottom edge; x+16 keeps it visually anchored to
      // the cursor hotspot.
      this._el.style.left = `${x + 16}px`
      this._el.style.top  = `${y + 44}px`
      return
    }
    this.hide()
    this._currentRoomId = room.instanceId
    this._tab = 'stats'
    this._render(room, x, y)
  }

  _render(room, x, y) {
    const name = (this._resolveRoomName(room) || room.definitionId || 'Room').toUpperCase()
    const isStats = this._tab === 'stats'
    this._el = h('div', {
      className: 'tooltip qf-roomtt',
      style: {
        position: 'fixed',
        // Same +16 / +44 offset as the same-room reposition path —
        // clears the 42-px custom cursor sprite.
        left: `${x + 16}px`,
        top:  `${y + 44}px`,
      },
    }, [
      h('div', { className: 'tt-head' }, [
        h('span', { className: 'tt-name' }, [
          h('span', { className: 'diamond sm' }),
          name,
        ]),
      ]),
      h('div', { className: 'tt-tabs' }, [
        h('div', {
          className: `tt-tab ${isStats ? 'active' : ''}`,
          on: { mouseenter: () => this._setTab('stats', room) },
        }, 'STATS'),
        h('div', {
          className: `tt-tab ${!isStats ? 'active' : ''}`,
          on: { mouseenter: () => this._setTab('history', room) },
        }, 'HISTORY'),
      ]),
      h('div', { className: 'tt-body' }, isStats
        ? this._renderStats(room)
        : this._renderHistory(room)),
    ])
    document.body.appendChild(this._el)
  }

  _setTab(tab, room) {
    if (this._tab === tab) return
    this._tab = tab
    // Patch just the body — keep position untouched.
    if (!this._el) return
    const body = this._el.querySelector('.tt-body')
    if (!body) return
    mount(body, tab === 'stats' ? this._renderStats(room) : this._renderHistory(room))
    // Update tab active state
    const tabs = this._el.querySelectorAll('.tt-tab')
    tabs[0]?.classList.toggle('active', tab === 'stats')
    tabs[1]?.classList.toggle('active', tab === 'history')
  }

  _resolveRoomName(room) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const defs = s.cache?.json?.get?.('rooms')
      if (Array.isArray(defs)) {
        const d = defs.find(x => x.id === room.definitionId)
        if (d) return d.name
      }
    }
    return null
  }

  _renderStats(room) {
    const rows = []
    if (room.width && room.height) {
      rows.push(['SIZE', `${room.width}×${room.height}`])
    }
    const def = this._roomDef(room)
    if (def?.goldCost != null) rows.push(['COST', `${def.goldCost}g`])
    if (def?.unlockLevel)      rows.push(['UNLOCK', `LV ${def.unlockLevel}`])
    const tagList = (def?.tags ?? []).slice(0, 4).join(' · ')
    if (tagList) rows.push(['TAGS', tagList.toUpperCase()])
    if (def?.description) {
      rows.push(['', def.description])
    }
    return rows.map(([k, v]) => h('div', { className: 'row' }, [
      h('span', null, k),
      h('b', null, v),
    ]))
  }

  _renderHistory(room) {
    // No per-room event log yet — synthesize a placeholder line.
    return [
      h('div', { className: 'row' }, [
        h('span', null, 'BUILT'),
        h('b', null, room.placedDay ? `DAY ${room.placedDay}` : '—'),
      ]),
      h('div', { className: 'row' }, [
        h('span', null, 'STATUS'),
        h('b', null, room.isActive === false ? 'INACTIVE' : 'ACTIVE'),
      ]),
      h('div', { className: 'row' }, [
        h('span', null, 'EVENTS'),
        h('b', null, '— history log TBD —'),
      ]),
    ]
  }

  _roomDef(room) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const defs = s.cache?.json?.get?.('rooms')
      if (Array.isArray(defs)) {
        const d = defs.find(x => x.id === room.definitionId)
        if (d) return d
      }
    }
    return null
  }

  hide() {
    this._el?.remove()
    this._el = null
    this._currentRoomId = null
  }

  destroy() {
    EventBus.off('SHOW_ROOM_TOOLTIP', this._showListener)
    EventBus.off('HIDE_ROOM_TOOLTIP', this._hideListener)
    this.hide()
  }
}
