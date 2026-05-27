// AiDiagOverlay — on-screen per-adventurer debug labels for diagnosing
// pathing loops in the wild (anti-ping-pong investigation, 2026-05-27).
//
// Toggled with F4 via the global DebugOverlay store. When on, each active
// adventurer gets a tiny floating label above their head showing:
//
//   GOAL
//   d=DIST t=NO_PROG_SECONDS WALK?
//
// Colour codes the label by the time-since-last-progress:
//
//   green   — making progress (normal)
//   yellow  — no progress 1-3s (early signal)
//   orange  — no progress 3-5s (on the verge of watchdog firing)
//   red     — no progress 5s+ (loop confirmed)
//   pink    — panic-walk is currently active (watchdog already fired,
//             trap-cost weighting is off, adv should be walking through)
//
// Render is throttled to 150ms (≈7fps) — text doesn't need 60fps and
// updating Phaser Text objects every tick is the heaviest part. Labels
// are pooled by adv.instanceId so a long-running save doesn't leak
// thousands of stale text objects.
//
// All gameplay is untouched — purely a developer overlay.

import { EventBus }    from '../systems/EventBus.js'
import { DebugOverlay } from '../systems/DebugOverlay.js'

const TICK_MS = 150
const LABEL_Y_OFFSET = 38   // px above the adv's worldY

export class AiDiagOverlay {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs    = gameState
    this._labels = {}        // adv.instanceId → Phaser.GameObjects.Text

    this._tickEvent = scene.time.addEvent({
      delay:    TICK_MS,
      loop:     true,
      callback: () => this._tick(),
    })

    // F4 keybind — self-contained so we don't depend on mountDebugChips
    // (which exists in DebugOverlayChips.js but is never actually called
    // from any scene as of 2026-05-27). Attaches a window-level keydown
    // listener; cleaned up on destroy. Toggles aiDiagnostics on/off; the
    // _tick callback above reads that flag every frame and shows/hides
    // labels accordingly. NO console logs — purely visual on-screen.
    this._onKey = (e) => {
      if (e.key === 'F4' || e.key === 'f4') {
        DebugOverlay.toggle('aiDiagnostics')
        e.preventDefault?.()
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKey)
    }

    // Clean up labels for advs that leave the field.
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAll, this)
    EventBus.on('ADVENTURER_DIED',     this._onRemove, this)
    EventBus.on('ADVENTURER_FLED',     this._onRemove, this)
  }

  destroy() {
    this._tickEvent?.remove?.()
    this._tickEvent = null
    if (typeof window !== 'undefined' && this._onKey) {
      window.removeEventListener('keydown', this._onKey)
    }
    this._onKey = null
    this._clearAll()
    EventBus.off('NIGHT_PHASE_STARTED', this._clearAll, this)
    EventBus.off('ADVENTURER_DIED',     this._onRemove, this)
    EventBus.off('ADVENTURER_FLED',     this._onRemove, this)
  }

  _tick() {
    const enabled = DebugOverlay.aiDiagnostics
    if (!enabled) {
      // Hide all labels (cheaper than destroying — keeps the pool warm
      // for when the player flips the toggle back on).
      for (const id in this._labels) this._labels[id].setVisible(false)
      return
    }

    const advs = this._gs?.adventurers?.active ?? []
    const now  = this._scene.time.now
    const seen = new Set()

    for (const adv of advs) {
      if (!adv || adv.aiState === 'dead') continue
      if (typeof adv.worldX !== 'number' || typeof adv.worldY !== 'number') continue
      seen.add(adv.instanceId)

      const goal      = adv.goal?.type ?? '?'
      const tgt       = adv.pathTarget
      const dist      = (tgt && typeof tgt.x === 'number')
        ? (Math.abs(adv.tileX - tgt.x) + Math.abs(adv.tileY - tgt.y))
        : null
      const noProg    = now - (adv._loopBestAt ?? now)
      const noProgS   = (noProg / 1000).toFixed(1)
      const panic     = (adv._panicWalkUntil ?? 0) > now

      // Two-line label: goal on top, status on bottom. Trap side-bias
      // arrow removed 2026-05-27 with the move to room-level trap
      // avoidance — no per-adv side preference exists anymore.
      const text = `${goal}\nd=${dist ?? '?'} t=${noProgS}s${panic ? ' WALK' : ''}`

      let color = '#88ff88'                                  // green — moving fine
      if (panic)                  color = '#ff4488'           // pink — panic-walk active
      else if (noProg > 5000)     color = '#ff4444'           // red — confirmed loop
      else if (noProg > 3000)     color = '#ffaa44'           // orange — danger zone
      else if (noProg > 1000)     color = '#ffff44'           // yellow — early signal

      let label = this._labels[adv.instanceId]
      if (!label) {
        label = this._scene.add.text(0, 0, '', {
          fontFamily:      'monospace',
          fontSize:        '9px',
          backgroundColor: 'rgba(0, 0, 0, 0.78)',
          padding:         { x: 3, y: 1 },
          align:           'center',
        }).setOrigin(0.5, 1).setDepth(95)
        this._labels[adv.instanceId] = label
      }

      label.setPosition(adv.worldX, adv.worldY - LABEL_Y_OFFSET)
      label.setText(text)
      label.setColor(color)
      label.setVisible(true)
    }

    // Hide labels for advs that have left the field (didn't appear in
    // `advs` this tick). Don't destroy — pool them in case they come
    // back (rare but possible — undead returns / phylactery revives).
    // Object keys are strings; instanceId may be number OR string in
    // different code paths — compare both representations to be safe.
    for (const id in this._labels) {
      if (!seen.has(id) && !seen.has(Number(id))) {
        this._labels[id].setVisible(false)
      }
    }
  }

  _onRemove(payload) {
    const id = payload?.adventurer?.instanceId ?? payload?.adv?.instanceId
    if (id != null && this._labels[id]) {
      this._labels[id].destroy()
      delete this._labels[id]
    }
  }

  _clearAll() {
    for (const id in this._labels) {
      try { this._labels[id].destroy() } catch {}
    }
    this._labels = {}
  }
}
