// Phase 31C — Crypt-themed dungeon mini-map (left HUD column, top).
//
// Replaces the old MiniMap.js procedural-grid renderer with the design's
// abstract block-shape style: rooms as colored rectangles, accent for
// boss room, gold for treasury, soul-cyan blinking dots for adventurers.
// Header strip + bottom legend.
//
// Pure read-only viewer — no click-to-pan (the dungeon view itself is
// large enough for direct interaction). Polls gameState every frame; cheap.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel } from './UIKit.js'
import { Balance } from '../config/balance.js'

const HEADER_H = 22
const PADDING  = 8
const LEGEND_H = 20

// Colour-mapping: room.definitionId → block colour.
const ROOM_COLORS = {
  boss_chamber: CRYPT.accent,    // primary accent (red)
  throne_room:  CRYPT.accent,
  treasury:     CRYPT.gold,
  armory:       CRYPT.warn,
  crypt:        0x988170,
  catacombs:    0x988170,
  library_of_whispers: CRYPT.soul,
  // default: CRYPT.wall (handled in renderer)
}

export class MiniMapPanel {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._depth     = opts.depth ?? 60
    this._x         = opts.x ?? 12
    this._y         = opts.y ?? 72
    this._w         = opts.w ?? 230
    this._h         = opts.h ?? 168
    this._objects   = []
    this._dynObjects = []   // re-rendered each tick (room blocks + adv dots)
    this._lastSig   = ''    // change-detection signature so we don't redraw every frame

    this._build()
  }

  _build() {
    const D = this._depth
    const x = this._x, y = this._y, w = this._w, h = this._h

    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, x, y, w, h)
    this._objects.push(bg)

    // Header strip
    const headerG = this._scene.add.graphics().setDepth(D + 1)
    headerG.fillStyle(CRYPT.panel2, 1)
    headerG.fillRect(x + 2, y + 2, w - 4, HEADER_H)
    headerG.fillStyle(CRYPT.panelEdgeS, 1)
    headerG.fillRect(x + 2, y + 2 + HEADER_H, w - 4, 1)
    this._objects.push(headerG)

    this._scene.add.text(x + PADDING + 4, y + HEADER_H / 2 + 2, '◆', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.accent2Css,
    }).setOrigin(0, 0.5).setDepth(D + 2)
    this._scene.add.text(x + PADDING + 18, y + HEADER_H / 2 + 2, 'DUNGEON MAP', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2)

    this._levelT = this._scene.add.text(x + w - PADDING - 4, y + HEADER_H / 2 + 2,
      `L${this._gameState.meta?.dungeonLevel ?? 1}`, {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
    }).setOrigin(1, 0.5).setDepth(D + 2)
    this._objects.push(this._levelT)

    // Inner inset frame (the "map area")
    const mapY = y + 2 + HEADER_H + PADDING
    const mapH = h - HEADER_H - LEGEND_H - PADDING * 2 - 4
    this._mapX = x + PADDING
    this._mapY = mapY
    this._mapW = w - PADDING * 2
    this._mapH = mapH

    const innerG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(innerG, this._mapX, this._mapY, this._mapW, this._mapH, {
      fill: CRYPT.bgDeep, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    this._objects.push(innerG)

    // Legend strip at the bottom
    const legendY = y + h - LEGEND_H - 4
    this._legendT = this._scene.add.text(x + PADDING + 4, legendY + LEGEND_H / 2,
      this._legendText(), {
      fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.ink, letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(D + 2)
    this._objects.push(this._legendT)

    // Render rooms initially
    this._renderRooms()
  }

  _legendText() {
    const advs = this._gameState.adventurers?.active?.length ?? 0
    return `Advs ${advs}  Boss  Loot`
  }

  _renderRooms() {
    // Wipe dynamic
    this._dynObjects.forEach(o => o?.destroy?.())
    this._dynObjects = []
    if (this._blinkTween) { this._blinkTween.stop(); this._blinkTween = null }
    const D = this._depth + 2

    const dungeon = this._gameState.dungeon
    if (!dungeon) return
    const gw = dungeon.gridWidth ?? Balance.STARTING_GRID_WIDTH
    const gh = dungeon.gridHeight ?? Balance.STARTING_GRID_HEIGHT
    const sx = this._mapW / gw
    const sy = this._mapH / gh

    // Faint grid lines (every 4 tiles) — subtle pattern matching the design.
    const grid = this._scene.add.graphics().setDepth(D - 1)
    grid.lineStyle(1, 0xffffff, 0.04)
    for (let i = 4; i < gw; i += 4) {
      const lx = this._mapX + Math.round(i * sx)
      grid.lineBetween(lx, this._mapY, lx, this._mapY + this._mapH)
    }
    for (let j = 4; j < gh; j += 4) {
      const ly = this._mapY + Math.round(j * sy)
      grid.lineBetween(this._mapX, ly, this._mapX + this._mapW, ly)
    }
    this._dynObjects.push(grid)

    // Room blocks — wall-colored with thin 1-px outline.
    const g = this._scene.add.graphics().setDepth(D)
    for (const room of (dungeon.rooms ?? [])) {
      const px = this._mapX + Math.round(room.gridX * sx)
      const py = this._mapY + Math.round(room.gridY * sy)
      const pw = Math.max(2, Math.round(room.width * sx))
      const ph = Math.max(2, Math.round(room.height * sy))

      const col = ROOM_COLORS[room.definitionId] ?? CRYPT.wall
      g.fillStyle(col, 1)
      g.fillRect(px, py, pw, ph)
      g.lineStyle(1, 0x000000, 0.7)
      g.strokeRect(px, py, pw, ph)
    }
    this._dynObjects.push(g)

    // Live entity dots — boss / minions / adventurers. Each colour gets
    // its own graphics object so we can blink the whole layer with a
    // single tween rather than tweening individual fills.
    const dotSize = 3

    // Boss — accent red
    const bossG = this._scene.add.graphics().setDepth(D + 2)
    bossG.fillStyle(CRYPT.accent, 1)
    const boss = this._gameState.boss
    if (boss && boss.tileX != null) {
      const dx = this._mapX + Math.round(boss.tileX * sx)
      const dy = this._mapY + Math.round(boss.tileY * sy)
      bossG.fillRect(dx - 2, dy - 2, dotSize + 1, dotSize + 1)
    } else {
      // Boss tile unknown — fall back to the boss room centre.
      const bossRoom = (dungeon.rooms ?? []).find(r => r.definitionId === 'boss_chamber')
      if (bossRoom) {
        const dx = this._mapX + Math.round((bossRoom.gridX + bossRoom.width  / 2) * sx)
        const dy = this._mapY + Math.round((bossRoom.gridY + bossRoom.height / 2) * sy)
        bossG.fillRect(dx - 2, dy - 2, dotSize + 1, dotSize + 1)
      }
    }
    this._dynObjects.push(bossG)

    // Minions — soft warning yellow so they read distinct from advs.
    const minG = this._scene.add.graphics().setDepth(D + 2)
    minG.fillStyle(CRYPT.warn, 1)
    for (const m of (this._gameState.minions ?? [])) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 1) <= 0) continue
      const dx = this._mapX + Math.round((m.tileX ?? 0) * sx)
      const dy = this._mapY + Math.round((m.tileY ?? 0) * sy)
      minG.fillRect(dx - 1, dy - 1, dotSize, dotSize)
    }
    this._dynObjects.push(minG)

    // Adventurers — soul cyan
    const advG = this._scene.add.graphics().setDepth(D + 3)
    advG.fillStyle(CRYPT.soul, 1)
    for (const adv of (this._gameState.adventurers?.active ?? [])) {
      const dx = this._mapX + Math.round((adv.tileX ?? 0) * sx)
      const dy = this._mapY + Math.round((adv.tileY ?? 0) * sy)
      advG.fillRect(dx - 1, dy - 1, dotSize, dotSize)
    }
    this._dynObjects.push(advG)

    // Blink the boss + adventurer layers together — minions stay solid so
    // there's a stable "patrol" reference. 2-step alpha tween at ~0.9 s.
    this._blinkTween = this._scene.tweens.add({
      targets: [bossG, advG],
      alpha:   { from: 1, to: 0.35 },
      duration: 450, yoyo: true, repeat: -1,
    })
  }

  // Cheap signature for change-detection — rooms + adv + minion + boss positions.
  _signature() {
    const d = this._gameState.dungeon
    if (!d) return ''
    const r = (d.rooms ?? []).map(rm => `${rm.gridX},${rm.gridY},${rm.width}x${rm.height},${rm.definitionId}`).join('|')
    const a = (this._gameState.adventurers?.active ?? []).map(av => `${av.tileX},${av.tileY}`).join('|')
    const m = (this._gameState.minions ?? []).map(mn => `${mn.tileX},${mn.tileY},${mn.aiState}`).join('|')
    const b = this._gameState.boss ? `${this._gameState.boss.tileX},${this._gameState.boss.tileY}` : ''
    const lv = this._gameState.meta?.dungeonLevel ?? 1
    return `${r}#${a}#${m}#${b}#${lv}`
  }

  update() {
    const sig = this._signature()
    if (sig !== this._lastSig) {
      this._lastSig = sig
      this._renderRooms()
      this._levelT?.setText(`L${this._gameState.meta?.dungeonLevel ?? 1}`)
    }
    // legend reflects live adv count even when positions don't change-detect
    this._legendT?.setText(this._legendText())
  }

  destroy() {
    if (this._blinkTween) { this._blinkTween.stop(); this._blinkTween = null }
    this._dynObjects.forEach(o => o?.destroy?.())
    this._dynObjects = []
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
  }
}

export const MINIMAP_PANEL_HEIGHT = 168
