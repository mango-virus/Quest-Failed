// SUPERSEDED (Phase 34) — folded into `src/hud/ToastQueue.js` as the
// 'bounty' kind under the new DOM HUD. Phaser fallback under
// `?newhud=0`. Kept per CLAUDE.md.
//
// Phase 7b — wanted-poster popup notification.
// Subscribes to MINION_BOUNTY_POSTED. When a minion crosses the kill threshold,
// shows a parchment-styled popup at the top-right with name + kills + gear count.
// Auto-dismisses after ~5s.

import { EventBus } from '../systems/EventBus.js'
import { PALETTE, glowPanel } from './UIKit.js'

export class WantedPoster {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._stack = []   // active poster nodes

    this._handler = ({ minion }) => this._showPoster(minion)
    EventBus.on('MINION_BOUNTY_POSTED', this._handler)
  }

  destroy() {
    EventBus.off('MINION_BOUNTY_POSTED', this._handler)
    for (const p of this._stack) p.objects.forEach(o => o.destroy?.())
    this._stack = []
  }

  _showPoster(minion) {
    if (!minion) return
    const W = this._scene.uiW
    const pw = 240, ph = 88
    const px = W - pw - 16
    const py = 16 + this._stack.length * (ph + 6)

    const g = this._scene.add.graphics().setDepth(40)
    glowPanel(g, px, py, pw, ph, {
      fill: 0x18120a, border: 0xddaa44, glow: 0x886622,
    })

    const title = this._scene.add.text(px + pw / 2, py + 10, '★ WANTED ★', {
      fontSize: '11px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(41)

    const name = this._scene.add.text(px + 12, py + 28,
      minion.name ?? minion.definitionId, {
        fontSize: '12px', color: '#f0f4ff', fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(41)

    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    const typeName = minionTypes.find(d => d.id === minion.definitionId)?.name ?? minion.definitionId

    const meta = this._scene.add.text(px + 12, py + 46,
      `${typeName}  ·  ${minion.bountyKillCount ?? 0} kills  ·  ${minion.equippedGear?.length ?? 0} gear`, {
        fontSize: '9px', color: '#ccaa66', fontFamily: 'monospace',
      }).setDepth(41)

    const flavor = this._scene.add.text(px + 12, py + 62,
      'Hunters approach. Reinforce the wing.', {
        fontSize: '8px', color: '#aa8844', fontFamily: 'monospace', fontStyle: 'italic',
      }).setDepth(41)

    const node = { objects: [g, title, name, meta, flavor] }
    this._stack.push(node)

    this._scene.time.delayedCall(5000, () => {
      this._scene.tweens.add({
        targets: node.objects, alpha: 0, duration: 600,
        onComplete: () => {
          node.objects.forEach(o => o.destroy?.())
          const idx = this._stack.indexOf(node)
          if (idx >= 0) this._stack.splice(idx, 1)
        },
      })
    })
  }
}
