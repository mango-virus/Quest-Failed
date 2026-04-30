// AudioControls — small mute + volume widget that drives TitleMusic.
//
// Compact horizontal layout:
//   [♪/—] [───•──────────]
//    mute   slider
//
// Consumed by:
//   - MainMenu (bottom-right, beside the version label)
//   - HudScene (top-right, away from the mini-map / boss HP bar)
//
// Stays in sync across scenes via TitleMusic.onChange — opening the
// HudScene control with a particular slider position will reflect
// any changes made on the MainMenu control later (and vice versa).

import { TitleMusic } from '../systems/TitleMusic.js'

const COL = {
  bg:        0x0a0612,
  bgHover:   0x140820,
  border:    0x3a1e08,
  trackBg:   0x1a1018,
  trackFill: 0xff7a1a,
  thumb:     0xffd0a0,
  iconOn:    '#ffd0a0',
  iconOff:   '#6a4a30',
  iconHover: '#ffe0b0',
}

const W      = 130
const H      = 24
const ICON_W = 28
const SLIDER_X = ICON_W + 4
const SLIDER_W = W - SLIDER_X - 6
const TRACK_H  = 4
const THUMB_W  = 6
const THUMB_H  = 12

export class AudioControls {
  // x/y = top-left corner.  depth defaults high so it floats above
  // the rest of the scene.
  constructor(scene, x, y, opts = {}) {
    this._scene = scene
    this._depth = opts.depth ?? 100
    this._dragging = false

    this._container = scene.add.container(x, y).setDepth(this._depth)

    // Background panel
    this._bg = scene.add.graphics()
    this._drawBg(false)
    this._container.add(this._bg)

    // ─── Mute button ─────────────────────────────────────────────────
    this._muteHit = scene.add.rectangle(0, 0, ICON_W, H, 0xffffff, 0.001)
      .setOrigin(0, 0).setInteractive({ useHandCursor: true })
    this._container.add(this._muteHit)

    this._muteIcon = scene.add.text(ICON_W / 2, H / 2,
      this._iconChar(),
      {
        fontSize: '15px',
        fontFamily: 'monospace',
        color: TitleMusic.isMuted() ? COL.iconOff : COL.iconOn,
        fontStyle: 'bold',
      },
    ).setOrigin(0.5).setResolution(2)
    this._container.add(this._muteIcon)

    this._muteHit.on('pointerover', () => this._muteIcon.setColor(COL.iconHover))
    this._muteHit.on('pointerout',  () => this._muteIcon.setColor(this._iconRestColor()))
    this._muteHit.on('pointerdown', () => TitleMusic.toggleMuted())

    // ─── Volume slider ──────────────────────────────────────────────
    // Track background
    const trackY = H / 2
    scene.add.existing(
      this._track = scene.add.rectangle(SLIDER_X, trackY, SLIDER_W, TRACK_H, COL.trackBg)
        .setOrigin(0, 0.5),
    )
    this._track.setStrokeStyle(1, 0x1a0a1a, 0.8)
    this._container.add(this._track)

    // Track fill (scales with volume)
    this._fill = scene.add.rectangle(SLIDER_X, trackY, 1, TRACK_H, COL.trackFill)
      .setOrigin(0, 0.5)
    this._container.add(this._fill)

    // Thumb (visual only — interactive zone is the track-wide hit rect)
    this._thumb = scene.add.rectangle(SLIDER_X, trackY, THUMB_W, THUMB_H, COL.thumb)
      .setOrigin(0.5)
    this._thumb.setStrokeStyle(1, 0x6a3010, 1)
    this._container.add(this._thumb)

    // Wide hit rect over the slider for forgiving click + drag
    this._sliderHit = scene.add.rectangle(SLIDER_X, 0, SLIDER_W, H, 0xffffff, 0.001)
      .setOrigin(0, 0).setInteractive({ useHandCursor: true })
    this._container.add(this._sliderHit)

    this._sliderHit.on('pointerdown', (p) => {
      this._dragging = true
      this._setFromPointer(p)
    })
    // Drag continues even when pointer leaves the hit rect — we listen
    // on the scene-wide input manager so the slider tracks fully across
    // the screen until pointer-up.
    scene.input.on('pointermove', this._onPointerMove, this)
    scene.input.on('pointerup',   this._onPointerUp,   this)

    // Hover affordance on the panel as a whole
    this._muteHit.on('pointerover', () => this._drawBg(true))
    this._muteHit.on('pointerout',  () => this._drawBg(false))
    this._sliderHit.on('pointerover', () => this._drawBg(true))
    this._sliderHit.on('pointerout',  () => this._drawBg(false))

    // Sync to current TitleMusic state
    this._unsubscribe = TitleMusic.onChange(() => this._refresh())
    this._refresh()

    // Tear down on scene shutdown
    scene.events.once('shutdown', () => this.destroy())
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this._unsubscribe?.()
    this._scene.input.off('pointermove', this._onPointerMove, this)
    this._scene.input.off('pointerup',   this._onPointerUp,   this)
    this._container?.destroy()
    this._container = null
  }

  // ─── Internals ─────────────────────────────────────────────────────

  _drawBg(hover) {
    this._bg.clear()
    this._bg.fillStyle(hover ? COL.bgHover : COL.bg, 0.85)
    this._bg.fillRoundedRect(0, 0, W, H, 4)
    this._bg.lineStyle(1, COL.border, 0.6)
    this._bg.strokeRoundedRect(0, 0, W, H, 4)
  }

  _iconChar() {
    // Use musical-note glyphs that work in any font without emoji
    // support — the title-bar icon font shipped by Phaser/browser
    // doesn't always include 🔊/🔇.
    return TitleMusic.isMuted() ? '—' : '♪'
  }

  _iconRestColor() {
    return TitleMusic.isMuted() ? COL.iconOff : COL.iconOn
  }

  _setFromPointer(p) {
    // p.x is in scene/world space; the container also lives in scene
    // space, so we convert to local x within the container.
    const local = this._container.getLocalPoint(p.x, p.y)
    const t = (local.x - SLIDER_X) / SLIDER_W
    const v = Math.max(0, Math.min(1, t))
    TitleMusic.setVolume(v)
    // Setting volume while muted would hide the change; auto-unmute so
    // dragging the slider always produces audible feedback.
    if (TitleMusic.isMuted() && v > 0) TitleMusic.setMuted(false)
  }

  _onPointerMove(p) {
    if (!this._dragging) return
    this._setFromPointer(p)
  }

  _onPointerUp() { this._dragging = false }

  _refresh() {
    if (!this._container) return
    const v = TitleMusic.getVolume()
    const muted = TitleMusic.isMuted()
    // Slider visuals
    const fillW = Math.max(1, SLIDER_W * v)
    this._fill.width = fillW
    this._fill.setFillStyle(muted ? 0x333333 : COL.trackFill)
    this._thumb.x = SLIDER_X + fillW
    this._thumb.setFillStyle(muted ? 0x666666 : COL.thumb)
    // Mute icon
    this._muteIcon.setText(this._iconChar())
    this._muteIcon.setColor(this._iconRestColor())
  }
}
