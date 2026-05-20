// SUPERSEDED (Phase 34) — replaced by the mini-map blueprint inside
// `src/hud/LeftPanels.js`. Phaser fallback under `?newhud=0`.
//
// Phase 31C — Crypt-themed dungeon mini-map (left HUD column, top).
//
// Replaces the old MiniMap.js procedural-grid renderer with the design's
// abstract block-shape style: rooms as colored rectangles, accent for
// boss room, gold for treasury, soul-cyan blinking dots for adventurers.
// Header strip + bottom legend.
//
// Pure read-only viewer — no click-to-pan (the dungeon view itself is
// large enough for direct interaction). Polls gameState every frame; cheap.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelDiamond } from './UIKit.js'
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

    const dia = this._scene.add.graphics().setDepth(D + 2)
    pixelDiamond(dia, x + PADDING + 6, y + HEADER_H / 2 + 2, 4, CRYPT.accent)
    this._objects.push(dia)
    this._scene.add.text(x + PADDING + 16, y + HEADER_H / 2 + 2, 'DUNGEON MAP', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2)

    this._levelT = this._scene.add.text(x + w - PADDING - 4, y + HEADER_H / 2 + 2,
      `L${this._gameState.boss?.level ?? 1}`, {
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

    // Legend strip at the bottom — color swatch + label per entity type.
    const legendY = y + h - LEGEND_H - 4
    const legendItems = [
      { color: CRYPT.accent2, label: 'BOSS' },
      { color: CRYPT.soul,    label: 'ADVS' },
      { color: CRYPT.green,   label: 'MINIONS' },
    ]
    const legendInnerW = w - PADDING * 2 - 8
    const colW = Math.floor(legendInnerW / legendItems.length)
    legendItems.forEach((it, i) => {
      const lx = x + PADDING + 4 + i * colW
      const ly = legendY + LEGEND_H / 2
      const sw = this._scene.add.graphics().setDepth(D + 2)
      sw.fillStyle(it.color, 1)
      sw.fillRect(lx, ly - 4, 8, 8)
      this._objects.push(sw)
      const lt = this._scene.add.text(lx + 12, ly, it.label, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.ink, letterSpacing: 1,
      }).setOrigin(0, 0.5).setDepth(D + 2)
      this._objects.push(lt)
    })

    // Render rooms initially
    this._renderRooms()
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
    // Single uniform scale so square dungeon tiles render as squares on
    // the panel — using mapW/gw and mapH/gh independently squashed boss
    // chambers into rectangles.
    const scale = Math.min(this._mapW / gw, this._mapH / gh)
    const sx = scale
    const sy = scale
    // Center the grid within the map area when the panel aspect doesn't
    // match the dungeon aspect.
    const offsetX = Math.round((this._mapW - gw * scale) / 2)
    const offsetY = Math.round((this._mapH - gh * scale) / 2)
    const baseX = this._mapX + offsetX
    const baseY = this._mapY + offsetY

    // Faint grid lines (every 4 tiles) — subtle pattern matching the design.
    const grid = this._scene.add.graphics().setDepth(D - 1)
    grid.lineStyle(1, 0xffffff, 0.04)
    for (let i = 4; i < gw; i += 4) {
      const lx = baseX + Math.round(i * sx)
      grid.lineBetween(lx, baseY, lx, baseY + gh * scale)
    }
    for (let j = 4; j < gh; j += 4) {
      const ly = baseY + Math.round(j * sy)
      grid.lineBetween(baseX, ly, baseX + gw * scale, ly)
    }
    this._dynObjects.push(grid)

    // Room blocks — wall-colored with thin 1-px outline.
    const g = this._scene.add.graphics().setDepth(D)
    for (const room of (dungeon.rooms ?? [])) {
      const px = baseX + Math.round(room.gridX * sx)
      const py = baseY + Math.round(room.gridY * sy)
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
    // its own graphics object so the boss + adv layers can blink in sync.
    // Sizes are big enough to read at the small minimap scale.
    const advSize    = 4
    const minionSize = 3
    const bossSize   = 6

    // Boss — bright accent2 red so it pops against rooms
    const bossG = this._scene.add.graphics().setDepth(D + 2)
    bossG.fillStyle(CRYPT.accent2, 1)
    const boss = this._gameState.boss
    let bossDX = null, bossDY = null
    if (boss && boss.tileX != null) {
      bossDX = baseX + Math.round(boss.tileX * sx)
      bossDY = baseY + Math.round(boss.tileY * sy)
    } else {
      const bossRoom = (dungeon.rooms ?? []).find(r => r.definitionId === 'boss_chamber')
      if (bossRoom) {
        bossDX = baseX + Math.round((bossRoom.gridX + bossRoom.width  / 2) * sx)
        bossDY = baseY + Math.round((bossRoom.gridY + bossRoom.height / 2) * sy)
      }
    }
    if (bossDX != null) {
      bossG.fillRect(bossDX - Math.floor(bossSize / 2), bossDY - Math.floor(bossSize / 2), bossSize, bossSize)
      // White inner pixel for contrast — reads as "alive" at small scale.
      bossG.fillStyle(0xffffff, 1)
      bossG.fillRect(bossDX - 1, bossDY - 1, 2, 2)
    }
    this._dynObjects.push(bossG)

    // Minions — green so they read distinct from boss (red) + advs (cyan).
    const minG = this._scene.add.graphics().setDepth(D + 2)
    minG.fillStyle(CRYPT.green, 1)
    for (const m of (this._gameState.minions ?? [])) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 1) <= 0) continue
      const dx = baseX + Math.round((m.tileX ?? 0) * sx)
      const dy = baseY + Math.round((m.tileY ?? 0) * sy)
      minG.fillRect(dx - 1, dy - 1, minionSize, minionSize)
    }
    this._dynObjects.push(minG)

    // Adventurers — soul cyan
    const advG = this._scene.add.graphics().setDepth(D + 3)
    advG.fillStyle(CRYPT.soul, 1)
    for (const adv of (this._gameState.adventurers?.active ?? [])) {
      const dx = baseX + Math.round((adv.tileX ?? 0) * sx)
      const dy = baseY + Math.round((adv.tileY ?? 0) * sy)
      advG.fillRect(dx - 2, dy - 2, advSize, advSize)
    }
    this._dynObjects.push(advG)

    // Blink the boss + adventurer layers together. Min alpha 0.6 so the
    // dots never flat-out disappear — the user reads them as "alive"
    // even mid-blink.
    this._blinkTween = this._scene.tweens.add({
      targets: [bossG, advG],
      alpha:   { from: 1, to: 0.6 },
      duration: 480, yoyo: true, repeat: -1,
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
    const lv = this._gameState.boss?.level ?? 1
    return `${r}#${a}#${m}#${b}#${lv}`
  }

  update() {
    const sig = this._signature()
    if (sig !== this._lastSig) {
      this._lastSig = sig
      this._renderRooms()
      this._levelT?.setText(`L${this._gameState.boss?.level ?? 1}`)
    }
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
