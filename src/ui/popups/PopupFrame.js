// SUPERSEDED (Phase 34) — Phaser popups in this directory are replaced
// by DOM overlays in `src/hud/` under the new HUD. HudScene gates the
// legacy listeners behind `!useNewHud`. Fallback only.
//
// Shared modal-popup chrome for the four 31E popups (Adventurer Intel,
// Boss Overview, Minion Roster, Knowledge Map). Builds the dim backdrop,
// the centered pixel-bevel panel, the title bar with close button, and
// the Esc / click-outside dismissal hooks. Each popup just hands in its
// own _renderContent function and gets back a ready-to-show container.

import { CRYPT, FONT_HEAD, pixelPanel, pixelDiamond, pixelButton } from '../UIKit.js'
import { EventBus } from '../../systems/EventBus.js'

const TITLE_H = 32
const PADDING = 14
const DEFAULT_DEPTH = 200

// Build a popup. Returns an object with:
//   open()   — show it (idempotent)
//   close()  — hide + destroy children
//   isOpen() — current state
//   contentBounds — { x, y, w, h } of the inside-panel area available
//                   for the popup body (after title bar + padding)
//
// opts:
//   scene  : Phaser.Scene
//   w, h   : panel size (default 880x540)
//   title  : string shown in the title bar
//   depth  : base depth (default 200; backdrop=depth, frame=depth+1, content=depth+5)
//   onOpen : optional callback after open()
//   onClose: optional callback after close()
//   render : (panelX, panelY, contentX, contentY, contentW, contentH, addChild) => void
//            called inside open() to populate the popup. addChild registers a
//            game object for cleanup when close() runs.
export function makePopupFrame(opts) {
  const {
    scene,
    w = 880,
    h = 540,
    title = 'POPUP',
    depth = DEFAULT_DEPTH,
    onOpen = null,
    onClose = null,
    render = null,
    // When false the popup becomes mandatory: no X button, Esc does nothing,
    // and clicking the wash outside the panel does NOT close it. Used by
    // Dark Pact, which forces the player to commit to a choice.
    dismissable = true,
  } = opts

  const W = scene.uiW ?? 1280
  const H = scene.uiH ?? 720
  const px = Math.round((W - w) / 2)
  const py = Math.round((H - h) / 2)

  let isOpen = false
  let children = []
  let escHandler = null
  let backdropZone = null

  // Accept a rest list so callers can register multiple objects in one
  // shot (e.g. `addChild(btn.bg, btn.label, btn.hit)` from pixelButton,
  // or `addChild(bar.g, bar.txt)` from pixelBar). Previously this only
  // pushed the first arg, leaving the rest as orphans that survived
  // close() — the source of the "X" / number leftovers.
  function addChild(...objs) {
    for (const o of objs) if (o) children.push(o)
    return objs[0]
  }

  function close() {
    if (!isOpen) return
    isOpen = false
    if (escHandler) {
      scene.input.keyboard?.off('keydown-ESC', escHandler)
      escHandler = null
    }
    if (backdropZone) {
      backdropZone.destroy()
      backdropZone = null
    }
    children.forEach(o => o?.destroy?.())
    children = []
    onClose?.()
  }

  function open() {
    if (isOpen) return
    isOpen = true

    // Dim backdrop covering the full canvas. Click-through is intercepted
    // so a click outside the panel closes the popup. We require BOTH
    // pointerdown and pointerup to land on the wash before closing — a
    // pointerup-only trigger would let the release of whatever click
    // opened the popup (e.g. SELL → click room) immediately close it.
    const wash = scene.add.rectangle(0, 0, W, H, 0x000000, 0.78)
      .setOrigin(0).setDepth(depth)
      .setInteractive()
    if (dismissable) {
      let washPressed = false
      wash.on('pointerdown', () => { washPressed = true })
      wash.on('pointerup',   () => { if (washPressed) { washPressed = false; close() } })
      wash.on('pointerout',  () => { washPressed = false })
    }
    // When non-dismissable the wash is still interactive so it eats clicks
    // (preventing them from reaching scene UI behind the popup) but never
    // calls close().
    addChild(wash)

    // Pixel-bevel panel chrome
    const frame = scene.add.graphics().setDepth(depth + 1)
    pixelPanel(frame, px, py, w, h)
    addChild(frame)

    // Title bar strip
    const titleStrip = scene.add.graphics().setDepth(depth + 2)
    titleStrip.fillStyle(CRYPT.panel2, 1)
    titleStrip.fillRect(px + 2, py + 2, w - 4, TITLE_H)
    titleStrip.fillStyle(CRYPT.panelEdgeS, 1)
    titleStrip.fillRect(px + 2, py + 2 + TITLE_H, w - 4, 1)
    addChild(titleStrip)

    // Diamond ornament + title text
    const dia = scene.add.graphics().setDepth(depth + 3)
    pixelDiamond(dia, px + PADDING, py + 2 + TITLE_H / 2, 4, CRYPT.accent)
    addChild(dia)
    const titleT = scene.add.text(px + PADDING + 12, py + 2 + TITLE_H / 2, title, {
      fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(depth + 3)
    addChild(titleT)

    // Close button (top-right) — omitted when non-dismissable so the player
    // is forced to interact with the popup body.
    if (dismissable) {
      const closeBtn = pixelButton(scene, px + w - 32 - 4, py + 4, 32, 24, 'X', {
        depth: depth + 3, fontSize: 9, danger: true,
        onClick: () => close(),
      })
      addChild(closeBtn.bg, closeBtn.label, closeBtn.hit)
    }

    // Click-outside zone — clicks inside the panel are blocked by an
    // inner zone so they don't bubble to the wash.
    const innerZone = scene.add.zone(px, py, w, h).setOrigin(0)
      .setDepth(depth + 1).setInteractive()
    innerZone.on('pointerup', (p, _lx, _ly, e) => e.stopPropagation())
    addChild(innerZone)

    // Esc key closes — only when dismissable.
    if (dismissable) {
      escHandler = () => close()
      scene.input.keyboard?.on('keydown-ESC', escHandler)
    }

    // Content area — what the popup body has to work with
    const contentX = px + PADDING
    const contentY = py + 2 + TITLE_H + PADDING
    const contentW = w - PADDING * 2
    const contentH = h - (2 + TITLE_H + PADDING) - PADDING
    if (render) render(px, py, contentX, contentY, contentW, contentH, addChild)
    onOpen?.()
  }

  return {
    open, close,
    isOpen: () => isOpen,
    contentBounds: { px, py, w, h },
  }
}
