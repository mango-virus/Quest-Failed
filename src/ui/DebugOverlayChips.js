// Mounts the COLLISION / DOORS toggle chips into a scene's UI camera.
// Used by HudScene (during gameplay) and NightPhase (dungeon planning) so
// the designer sees the same controls wherever the dungeon is visible.
//
// Usage:
//   const chips = mountDebugChips(this)   // in scene.create()
//   chips.destroy()                        // in scene.shutdown()

import { PALETTE }      from './UIKit.js'
import { DebugOverlay } from '../systems/DebugOverlay.js'
import { EventBus }     from '../systems/EventBus.js'

export function mountDebugChips(scene, opts = {}) {
  const W = scene.uiW ?? scene.scale.width
  const H = scene.uiH ?? scene.scale.height
  const x = opts.x ?? 12
  const y = opts.y ?? (H - 56)
  const depth = opts.depth ?? 60

  const chips = []
  const objects = []

  const addChip = (cx, cw, label, key) => {
    const cy = y, ch = 22
    const g  = scene.add.graphics().setDepth(depth)
    const txt = scene.add.text(cx + cw / 2, cy + ch / 2, label, {
      fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(depth + 1)
    const draw = () => {
      const a = DebugOverlay[key]
      g.clear()
      g.fillStyle(a ? 0x1a3a20 : 0x0a0518, 0.85).fillRect(cx, cy, cw, ch)
      g.lineStyle(1, a ? 0x33cc77 : PALETTE.panelBorder, a ? 1 : 0.5).strokeRect(cx, cy, cw, ch)
      txt.setColor(a ? PALETTE.textBright : PALETTE.textDim)
    }
    draw()
    const hit = scene.add.rectangle(cx + cw / 2, cy + ch / 2, cw, ch, 0, 0)
      .setDepth(depth + 2).setInteractive({ useHandCursor: true })
    hit.on('pointerdown', () => DebugOverlay.toggle(key))
    chips.push({ key, draw })
    objects.push(g, txt, hit)
  }

  addChip(x,        110, 'COLLISION (F2)', 'showCollision')
  addChip(x + 118,   92, 'DOORS (F3)',     'showDoors')

  const onChanged = () => chips.forEach(c => c.draw())
  EventBus.on('DEBUG_OVERLAY_CHANGED', onChanged)

  // Keyboard shortcuts — installed once per mount so each scene with chips
  // also gets F2/F3. The DebugOverlay is global so toggling once flips it
  // everywhere even if multiple scenes have chips.
  const onKey = (e) => {
    if (e.key === 'F2') { DebugOverlay.toggle('showCollision'); e.preventDefault?.() }
    else if (e.key === 'F3') { DebugOverlay.toggle('showDoors'); e.preventDefault?.() }
  }
  scene.input.keyboard.on('keydown', onKey)

  return {
    destroy() {
      EventBus.off('DEBUG_OVERLAY_CHANGED', onChanged)
      scene.input.keyboard.off('keydown', onKey)
      for (const o of objects) o.destroy()
    }
  }
}
