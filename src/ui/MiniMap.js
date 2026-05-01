// MiniMap renders a top-down overview of the dungeon and a viewport
// indicator showing where the world camera is currently looking.
//
// Lives in HudScene (a separate Phaser scene). HudScene's camera has
// zoom 1 / scroll 0, so all UI here can use plain pixel coordinates with
// zero camera-transform compensation. The world camera lives on the
// Game scene and is read via the gameScene reference for the indicator
// math only.

import { EventBus } from '../systems/EventBus.js'
import { TILE }     from '../systems/DungeonGrid.js'
import { Balance }  from '../config/balance.js'

const MAP_W   = 180
const MAP_H   = 180
const PADDING = 12
const BORDER  = 1
// Reserve clearance so the minimap doesn't land underneath the
// NightPhase / DayPhase bottom HUD strip (BEGIN DAY / END DAY button,
// hint text). Both scenes use a 56-px bottom bar; pad a bit beyond that.
const BOTTOM_UI_CLEARANCE = 72
const BTN_SIZE = 18

// Minimap tile colours (condensed palette)
const MM_COLORS = {
  [TILE.VOID]:       0x0a0514,
  [TILE.FLOOR]:      0x4a3070,
  [TILE.WALL]:       0x5a4080,
  [TILE.BOSS_FLOOR]: 0x9b32d4,
  [TILE.BOSS_WALL]:  0xc64bff,
  [TILE.DOOR]:       0xff88ff,
}

export class MiniMap {
  /**
   * @param {Phaser.Scene} hudScene - the HUD scene we render into
   * @param {object}       gameState
   * @param {Phaser.Scene} gameScene - the Game scene whose world camera we
   *                                    read for the viewport indicator
   */
  constructor(hudScene, gameState, gameScene, opts = {}) {
    this._scene     = hudScene
    this._gameState = gameState
    this._cam       = gameScene.cameras.main   // world camera (zoom-aware)

    const W = hudScene.uiW
    const H = hudScene.uiH
    // Phase 31C — caller can override the default bottom-right anchor with
    // explicit x/y opts (HudScene now positions us in the left column).
    this._mx = opts.x ?? (W - MAP_W - PADDING)
    this._my = opts.y ?? (H - MAP_H - BOTTOM_UI_CLEARANCE)
    const mx = this._mx
    const my = this._my

    // Backdrop
    this._bg = hudScene.add.rectangle(
      mx + MAP_W / 2,
      my + MAP_H / 2,
      MAP_W + BORDER * 2,
      MAP_H + BORDER * 2,
      0x1a0a2e,
    ).setStrokeStyle(1, 0x9b32d4).setDepth(10)

    // Dungeon image — Graphics drawn directly at screen pixel coords.
    this._rt         = hudScene.add.graphics().setDepth(11)
    // Entity dots — redrawn every frame on top of the dungeon layer.
    this._rtEntities = hudScene.add.graphics().setDepth(11.5)

    // Click-to-pan hitbox (Graphics is awkward to make interactive, a
    // Rectangle is simpler).
    this._hit = hudScene.add.rectangle(mx, my, MAP_W, MAP_H, 0x000000, 0.001)
      .setOrigin(0, 0)
      .setDepth(11)
      .setInteractive({ useHandCursor: true })

    // Viewport indicator (white outlined rectangle).
    this._vp = hudScene.add.rectangle(0, 0, 10, 10)
      .setOrigin(0.5)
      .setStrokeStyle(1, 0xffffff, 0.7)
      .setFillStyle(0xffffff, 0.08)
      .setDepth(12)

    // Mask shape so the indicator never bleeds outside the map rect even
    // when the camera's view extends past the dungeon edges.
    this._maskShape = hudScene.add.rectangle(
      mx + MAP_W / 2, my + MAP_H / 2, MAP_W, MAP_H, 0xffffff,
    ).setVisible(false)
    this._vp.setMask(this._maskShape.createGeometryMask())

    // "MAP" label
    this._label = hudScene.add.text(mx + 4, my + 4, 'MAP', {
      fontSize: '9px', color: '#664488', fontFamily: 'monospace',
    }).setDepth(13)

    // Toggle button — sits just above the top-right corner of the map.
    const btnX = mx + MAP_W - BTN_SIZE / 2
    const btnY = my - BTN_SIZE / 2 - 4
    this._toggleBg = hudScene.add.rectangle(btnX, btnY, BTN_SIZE, BTN_SIZE, 0x1a0a2e, 0.95)
      .setStrokeStyle(1, 0x9b32d4, 0.9)
      .setDepth(14)
    this._toggleLabel = hudScene.add.text(btnX, btnY, '−', {
      fontSize: '12px', color: '#c64bff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(15)
    this._toggleHit = hudScene.add.rectangle(btnX, btnY, BTN_SIZE, BTN_SIZE, 0x000000, 0.001)
      .setDepth(16)
      .setInteractive({ useHandCursor: true })

    this._toggleHit.on('pointerover', () => {
      this._toggleBg.setStrokeStyle(1, 0xff88ff, 1)
      this._toggleLabel.setColor('#ffaaff')
    })
    this._toggleHit.on('pointerout', () => {
      this._toggleBg.setStrokeStyle(1, 0x9b32d4, 0.9)
      this._toggleLabel.setColor('#c64bff')
    })
    this._toggleHit.on('pointerdown', () => this.toggleVisible())

    // Click + drag on the map to move the world camera.
    this._dragging = false
    this._hit.on('pointerdown', (p, lx, ly) => {
      this._dragging = true
      this._panToMap(lx, ly)
    })
    this._onPointerMove = (p) => {
      if (!this._dragging) return
      const lp = this._screenToMapLocal(p.x, p.y)
      if (!lp) return
      this._panToMap(lp.x, lp.y)
    }
    this._onPointerUp = () => { this._dragging = false }
    hudScene.input.on('pointermove', this._onPointerMove)
    hudScene.input.on('pointerup',   this._onPointerUp)

    // Refresh on dungeon change
    EventBus.on('ROOM_PLACED',            this.refresh, this)
    EventBus.on('ROOM_REMOVED',           this.refresh, this)
    EventBus.on('GRID_EXPANDED',          this.refresh, this)

    this._visible = true
    this.refresh()
  }

  toggleVisible() {
    this._visible = !this._visible
    const items = [this._bg, this._rt, this._rtEntities, this._vp, this._label, this._hit]
    for (const o of items) o?.setVisible(this._visible)
    this._toggleLabel.setText(this._visible ? '−' : '▣')
  }

  refresh() {
    if (this._destroyed || !this._rt?.scene) return
    const { gridWidth: gw, gridHeight: gh, tiles } = this._gameState.dungeon
    const tw = MAP_W / gw
    const th = MAP_H / gh
    this._tw = tw
    this._th = th

    const mx = this._mx
    const my = this._my

    this._rt.clear()
    for (let ty = 0; ty < gh; ty++) {
      for (let tx = 0; tx < gw; tx++) {
        const tileId = tiles[ty][tx]
        if (tileId === TILE.VOID) continue
        const color = MM_COLORS[tileId] ?? 0x444444
        this._rt.fillStyle(color, 1)
        this._rt.fillRect(mx + tx * tw, my + ty * th, Math.max(1, tw), Math.max(1, th))
      }
    }
    this._updateViewport()
  }

  update() {
    this._updateViewport()
    this._updateEntities()
  }

  _updateViewport() {
    if (this._destroyed || !this._vp?.scene || !this._visible) return
    if (!this._tw) return

    const tw = this._tw
    const th = this._th
    const TS = Balance.TILE_SIZE
    const cam = this._cam

    // Use cam.worldView, which Phaser keeps up-to-date with the camera's
    // current scrollX/Y/zoom and viewport size each frame. This is more
    // reliable than recomputing from cam.scrollX + scale.width — earlier
    // attempts using scale-based math drifted whenever the world camera's
    // viewport differed from the global scaleManager (e.g. zoom-to-cursor
    // adjustments leave fractional scrollX values).
    const view = cam.worldView   // {x, y, width, height} in WORLD coords
    const camCentreWorldX = view.x + view.width  / 2
    const camCentreWorldY = view.y + view.height / 2

    // Convert the world view into minimap pixels.
    const sw = (view.width  / TS) * tw
    const sh = (view.height / TS) * th

    // Indicator centre in screen pixels (HUD scene = literal pixel space).
    const screenCx = this._mx + (camCentreWorldX / TS) * tw
    const screenCy = this._my + (camCentreWorldY / TS) * th

    // Resize and re-anchor. updateDisplayOrigin keeps the rect's centre
    // glued to its position after a size change — Phaser's Rectangle
    // .setSize() does not update displayOrigin on its own.
    this._vp.setSize(sw, sh)
    this._vp.updateDisplayOrigin()
    this._vp.setPosition(screenCx, screenCy)
  }

  _updateEntities() {
    if (this._destroyed || !this._rtEntities?.scene || !this._visible) return
    if (!this._tw) return

    const g  = this._rtEntities
    const TS = Balance.TILE_SIZE
    const mx = this._mx
    const my = this._my
    const tw = this._tw
    const th = this._th

    g.clear()

    // World-pixel → minimap-pixel helpers
    const toSX = (wx) => mx + (wx / TS) * tw
    const toSY = (wy) => my + (wy / TS) * th
    const inMap = (sx, sy) =>
      sx >= mx && sx < mx + MAP_W && sy >= my && sy < my + MAP_H

    // Minions — blue for dungeon faction, green for defected
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 1) <= 0) continue
      if (m.isMimic && m.hiddenAsLoot) continue
      const sx = toSX(m.worldX)
      const sy = toSY(m.worldY)
      if (!inMap(sx, sy)) continue
      const col = m.faction === 'adventurer' ? 0x33cc77 : 0x44aaff
      g.fillStyle(col, 0.9)
      g.fillRect(sx - 1.5, sy - 1.5, 3, 3)
    }

    // Adventurers — gold
    for (const a of this._gameState.adventurers?.active ?? []) {
      if (a.aiState === 'dead' || a.aiState === 'fled') continue
      const sx = toSX(a.worldX)
      const sy = toSY(a.worldY)
      if (!inMap(sx, sy)) continue
      g.fillStyle(0xffcc44, 1)
      g.fillRect(sx - 2, sy - 2, 4, 4)
    }

    // Boss — purple
    const boss = this._gameState.boss
    if (boss?.worldX !== undefined) {
      const sx = toSX(boss.worldX)
      const sy = toSY(boss.worldY)
      if (inMap(sx, sy)) {
        g.fillStyle(0xcc44ff, 1)
        g.fillRect(sx - 2.5, sy - 2.5, 5, 5)
      }
    }
  }

  _panToMap(lx, ly) {
    const { gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const TS = Balance.TILE_SIZE
    const fracX = Phaser.Math.Clamp(lx / MAP_W, 0, 1)
    const fracY = Phaser.Math.Clamp(ly / MAP_H, 0, 1)
    this._cam.centerOn(fracX * gw * TS, fracY * gh * TS)
  }

  _screenToMapLocal(sx, sy) {
    const world = this._scene.cameras.main.getWorldPoint(sx, sy)
    const lx = world.x - this._mx
    const ly = world.y - this._my
    return {
      x: Phaser.Math.Clamp(lx, 0, MAP_W),
      y: Phaser.Math.Clamp(ly, 0, MAP_H),
    }
  }

  destroy() {
    this._destroyed = true
    EventBus.off('ROOM_PLACED',           this.refresh, this)
    EventBus.off('ROOM_REMOVED',          this.refresh, this)
    EventBus.off('GRID_EXPANDED',         this.refresh, this)
    if (this._onPointerMove) this._scene.input.off('pointermove', this._onPointerMove)
    if (this._onPointerUp)   this._scene.input.off('pointerup',   this._onPointerUp)
    this._vp?.clearMask?.(true)
    this._maskShape?.destroy()
    this._bg?.destroy()
    this._rt?.destroy()
    this._rtEntities?.destroy()
    this._hit?.destroy()
    this._vp?.destroy()
    this._label?.destroy()
    this._toggleBg?.destroy()
    this._toggleLabel?.destroy()
    this._toggleHit?.destroy()
  }
}
