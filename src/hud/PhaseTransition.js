// PhaseTransition — ~2.4s phase-change cinematic (design port, hud-transition.jsx).
//
// Subscribes to `DAY_PHASE_BEGAN` / `NIGHT_PHASE_BEGAN`. Mounts a
// fullscreen overlay that plays the design's beat:
//   * a VEIL that wipes across to cover (clip-path sweep), day/night tinted
//   * a sweeping BAND of light/dark across the horizon
//   * expanding glow RAYS from center
//   * a PLATE: eyebrow ("⸺ The gates open ⸺" / "⸺ The dungeon stirs ⸺"),
//     a slammed-in DAY/NIGHT {n} stamp (scale + blur cleanup), and a
//     sub-line ("THE INVASION BEGINS" / "FORTIFY THE DEEP")
//   * (day only) an INCOMING ROSTER ribbon of adventurer sprite tiles
//   then the whole root fades out.
//
// Replaced the older bespoke sun/moon + speed-line + letterbox version
// (2026-06-15) so the in-game transition matches the design.
//
// Blocks input via pointer-events: auto on the full overlay so the
// player can't click through. Auto-dismisses after TRANSITION_MS.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { incomingWaveParty } from './wavePreview.js'
import { liveAdventurerEntity, warmAdvSnapshotsThen } from './inGameSnapshot.js'
import { pixelSprite } from './sprites.js'

const TRANSITION_MS = 2400

// Day-roster ribbon caps: above MAX_VISIBLE adventurers we show the first N as
// sprite tiles + a "+K" overflow chip so a big late-game wave still fits one
// centered row. Tile size shrinks as the wave grows.
const ROSTER_MAX_VISIBLE = 16
function rosterTileSize(n) {
  return n <= 6 ? 64 : n <= 10 ? 52 : 44
}

export class PhaseTransition {
  constructor(gameState) {
    this._gameState = gameState
    this._el = null
    this._timer = null
    this._listeners = []
    const sub = (event, fn) => { EventBus.on(event, fn); this._listeners.push([event, fn]) }
    sub('DAY_PHASE_BEGAN',   () => this.fire('day'))
    sub('NIGHT_PHASE_BEGAN', () => {
      // First-ever night begins UNDER the intro cinematic — don't pop the NIGHT 1
      // stamp on top of it. Defer until the player dismisses the intro and actually
      // enters the dungeon view. (On later runs introSeen is true → fires normally.)
      if (!this._gameState?.meta?.introSeen) { this._pendingPhase = 'night'; return }
      this.fire('night')
    })
    sub('INTRO_DISMISSED', () => { if (this._pendingPhase) { const p = this._pendingPhase; this._pendingPhase = null; this.fire(p) } })
  }

  fire(to) {
    // Cancel any in-flight transition before starting a new one.
    if (this._el) this._dismiss()
    const day = this._gameState.meta?.dayNumber ?? 1
    this._activePhase = to
    this._refs = {}
    // Day roster — the EXACT incoming wave, library-gated (empty when no
    // Library of Whispers / no preview, so the ribbon simply doesn't show).
    // DAY_PHASE_BEGAN fires BEFORE the spawn consumes nextWavePreview, so the
    // preview is still intact here.
    this._party = to === 'day' ? incomingWaveParty(this._gameState) : []
    this._el = this._render(to, day)
    // Warm the wave's on-demand LPC sheets so the tiles show real sprites (not
    // the procedural fallback); re-render the ribbon in place as they stream in.
    if (this._party.length) {
      warmAdvSnapshotsThen(this._party, () => this._rerenderRoster(), 'pt-roster')
    }
    // Mount on document.body (not #hud-stage) so the cinematic covers
    // the entire viewport. #hud-stage is the 1920×1080 logical stage
    // that transform-scales to FIT the viewport — on non-16:9 windows
    // the stage doesn't cover the full screen and the cinematic would
    // letterbox along with it (black bars top/bottom or left/right).
    // The cinematic is a screen-wide visual beat — it should overlap
    // even the letterbox.
    document.body.appendChild(this._el)
    this._timer = setTimeout(() => this._dismiss(), TRANSITION_MS)
  }

  _dismiss() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null }
    const finishedPhase = this._activePhase
    this._activePhase = null
    this._el?.remove()
    this._el = null
    // Signal completion so listeners (DayPhase's adventurer spawner,
    // TutorialSystem's welcome popup gating, etc.) can run AFTER the
    // 2.8s cinematic instead of underneath it.
    if (finishedPhase) {
      EventBus.emit('PHASE_TRANSITION_FINISHED', { phase: finishedPhase })
    }
  }

  _render(to, day) {
    const isDay = to === 'day'
    return h('div', {
      className: `pt-root ${isDay ? 'to-day' : 'to-night'}`,
    }, [
      // Veil wipes across to cover; band sweeps the horizon; rays bloom.
      h('div', { className: 'pt-veil' }),
      h('div', { className: 'pt-rays' }),
      h('div', { className: 'pt-band' }),
      // Plate — eyebrow + slammed-in DAY/NIGHT stamp + sub-line, with the
      // incoming-wave roster ribbon tucked directly beneath the sub (day only,
      // and only when a Library of Whispers has leaked the roster — otherwise
      // this._party is empty and the ribbon doesn't render).
      h('div', { className: 'pt-plate' }, [
        h('div', { className: 'sil pt-eye' },
          isDay ? '⸺  The gates open  ⸺' : '⸺  The dungeon stirs  ⸺'),
        h('div', { className: 'pix pt-stamp' }, `${isDay ? 'DAY' : 'NIGHT'} ${day}`),
        h('div', { className: 'pix pt-sub' },
          isDay ? 'THE INVASION BEGINS' : 'FORTIFY THE DEEP'),
        isDay && this._party.length ? this._buildRoster() : null,
      ].filter(Boolean)),
    ].filter(Boolean))
  }

  // The roster ribbon node — real, properly-framed adventurer sprites for the
  // whole incoming wave (capped with a "+N" chip for big late-game waves).
  _buildRoster() {
    return h('div', { className: 'pt-roster', ref: el => { this._refs.roster = el } },
      this._rosterTiles())
  }

  // Tiles for the current party — split out so the warmer can rebuild them in
  // place (with real sprites) as the on-demand LPC sheets finish loading.
  _rosterTiles() {
    const party = this._party || []
    const n = party.length
    const size = rosterTileSize(n)
    const shown = party.slice(0, ROSTER_MAX_VISIBLE)
    const overflow = n - shown.length
    const tiles = shown.map(adv => {
      const tile = h('div', {
        className: 'pt-rtile' + (adv.veteran ? ' vet' : ''),
        style: { width: `${size}px`, height: `${size}px` },
      })
      // Real in-game sprite (south-facing idle, auto-cropped) — falls back to
      // the procedural pixel sprite until the LPC sheet warms in.
      const snap = liveAdventurerEntity(adv, size) || pixelSprite(adv.classId, size)
      if (snap) tile.appendChild(snap)
      return tile
    })
    if (overflow > 0) {
      tiles.push(h('div', {
        className: 'pt-rtile pt-rtile-more',
        style: { width: `${size}px`, height: `${size}px` },
      }, [h('span', { className: 'pix pt-rtile-more-num' }, `+${overflow}`)]))
    }
    return tiles
  }

  _rerenderRoster() {
    if (this._refs?.roster) this._refs.roster.replaceChildren(...this._rosterTiles())
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this._dismiss()
  }
}
