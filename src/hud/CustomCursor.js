// CustomCursor — replaces the native browser cursor with the pixel-art
// arrow + 3-frame click animation.
//
// Lives at the top of the DOM (fixed-position element on body) so it
// overlays BOTH the Phaser canvas and the DOM HUD layer with the same
// single cursor. Positioned via transform: translate(x, y) on every
// mousemove so it stays smooth.
//
// CSS in styles.css hides the native cursor (cursor: none) on every
// game element. Buttons / links / etc. inherit the hide too — we don't
// want to flip-flop between native pointer and our arrow.
//
// On mousedown: schedules a 3-frame click animation (~50 ms per frame
// → ~150 ms total) before reverting to the normal arrow. Re-clicks
// during the animation reset the sequence.
//
// Also plays the cursor-click SFX (sfx-cursor-click, loaded by
// Preload) on every primary-button click — routed through Phaser's
// global SoundManager and gated by SfxVolume so mute / slider works.

import { SfxVolume } from '../systems/SfxVolume.js'

// Base gain — multiplied by the user's SFX slider in SfxVolume.
// Bumped from 0.4 → 0.7 per user feedback (clicks were too quiet).
const CLICK_SOUND_GAIN = 0.7

// Playback rate (1.0 = source speed). Slight bump above 1.0 makes the
// click feel snappier — which also nudges pitch up a touch, but the
// source sample is short enough that the pitch shift reads as
// "crisper" rather than chipmunk-y.
const CLICK_SOUND_RATE = 1.2

const FRAMES = {
  normal: 'assets/sprites/cursor-normal.png',
  click1: 'assets/sprites/cursor-click-1.png',
  click2: 'assets/sprites/cursor-click-2.png',
  click3: 'assets/sprites/cursor-click-3.png',
}

const CLICK_FRAME_MS = 50
const CLICK_SEQUENCE = ['click1', 'click2', 'click3', 'normal']

let _el = null
let _timers = []
let _installed = false

function _setFrame(name) {
  if (!_el) return
  _el.style.backgroundImage = `url("${FRAMES[name]}")`
}

function _clearClickTimers() {
  for (const t of _timers) clearTimeout(t)
  _timers = []
}

function _onMove(e) {
  if (!_el) return
  // Position the element's top-left at the mouse — the arrow tip lives
  // at the source's top-left pixel, so (clientX, clientY) maps directly
  // to the click hotspot without an offset.
  _el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
}

// How long a non-primary button can be held before it's treated as a
// "hold" (camera-pan / drag) rather than a "click". Releases within
// this window fire the click cue on mouseup; longer holds stay silent.
const HOLD_AS_CLICK_MS = 250

// Per-button down timestamps for right / middle. Lets _onUp tell
// "quick click" apart from "held drag".
const _pendingDownAt = new Map()

function _playClickCue() {
  _clearClickTimers()
  _setFrame('click1')
  for (let i = 1; i < CLICK_SEQUENCE.length; i++) {
    _timers.push(setTimeout(() => _setFrame(CLICK_SEQUENCE[i]), CLICK_FRAME_MS * i))
  }
  _playClickSound()
}

function _onDown(e) {
  if (!_el) return
  const button = e?.button ?? 0
  if (button === 0) {
    // Left click — fire animation + sound IMMEDIATELY on press.
    // No release check; held left-click (e.g. drag-select if the
    // game ever uses it) still gets the initial click feedback.
    _playClickCue()
    return
  }
  // Right (2) / middle/wheel (1) / mouse-back+forward (3,4) — defer.
  // Record the press time and wait for mouseup; only fire if the
  // release came quickly (= a click), not after a held drag/pan.
  _pendingDownAt.set(button, performance.now())
}

function _onUp(e) {
  if (!_el) return
  const button = e?.button ?? 0
  if (button === 0) return    // left already fired on down
  const downAt = _pendingDownAt.get(button)
  _pendingDownAt.delete(button)
  if (downAt == null) return
  const heldMs = performance.now() - downAt
  if (heldMs > HOLD_AS_CLICK_MS) return    // a hold (pan / drag), stay silent
  _playClickCue()
}

function _playClickSound() {
  if (typeof window === 'undefined') return
  if (SfxVolume.isMuted?.()) return
  const game = window.__game
  if (!game?.sound?.play) return
  // Audio may not have loaded yet (Preload still running, or page
  // backgrounded so WebAudio is suspended). Skip silently in those
  // cases — clicks return to working as soon as the cache populates.
  if (game.sound.locked) return
  if (!game.cache?.audio?.exists?.('sfx-cursor-click')) return
  const vol = CLICK_SOUND_GAIN * (SfxVolume.getVolume?.() ?? 1)
  if (vol <= 0) return
  try { game.sound.play('sfx-cursor-click', { volume: vol, rate: CLICK_SOUND_RATE }) } catch {}
}

function _onOutOfWindow(e) {
  // mouseout fires whenever the mouse crosses an element boundary, but
  // only `e.relatedTarget === null` means it actually left the document.
  if (!_el || e.relatedTarget) return
  _el.style.opacity = '0'
}

function _onIntoWindow() {
  if (!_el) return
  _el.style.opacity = '1'
}

export function installCustomCursor() {
  if (_installed || typeof document === 'undefined') return
  _installed = true
  _el = document.createElement('div')
  _el.id = 'qf-cursor'
  // Park it offscreen until the first mousemove so we don't flash a
  // cursor at (0, 0) before the user touches the page.
  _el.style.transform = 'translate(-100px, -100px)'
  document.body.appendChild(_el)
  _setFrame('normal')
  window.addEventListener('mousemove', _onMove, { passive: true })
  window.addEventListener('mousedown', _onDown)
  window.addEventListener('mouseup',   _onUp)
  window.addEventListener('mouseout',  _onOutOfWindow)
  window.addEventListener('mouseover', _onIntoWindow)
}
