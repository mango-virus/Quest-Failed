// AudioControls — small mute + volume widget that drives TitleMusic.
//
// Compact horizontal layout:
//   [♪/—] [───•──────────]
//    mute   slider
//
// When mounted with a `playlist` option (a GameplayMusic-shaped module
// exposing previous() / next() / isActive()), two extra transport
// buttons appear:
//
//   [♪/—] [<<] [>>] [───•──────────]
//          prev next
//
// Volume + mute always drive TitleMusic (the source of truth for the
// shared music preference).  GameplayMusic mirrors via TitleMusic.onChange,
// so the slider drives both modules simultaneously.
//
// Consumed by:
//   - MainMenu (bottom-right, beside the version label) — no playlist
//   - HudScene (top-right, away from the mini-map / boss HP bar) — playlist enabled

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
  btnDisabled: '#4a3020',
}

const H        = 24
const ICON_W   = 28
const BTN_W    = 22
const TRACK_H  = 4
const THUMB_W  = 6
const THUMB_H  = 12
const SLIDER_W_DEFAULT = 130 - (ICON_W + 4) - 6  // = 92, original slider width

// Compute total widget width given options, so callers can position
// the widget against a screen edge before the constructor runs.
export function audioControlsWidth(opts = {}) {
  const hasPlaylist = !!opts.playlist
  const buttonsW = hasPlaylist ? (BTN_W * 2 + 4) : 0
  return ICON_W + buttonsW + 4 + SLIDER_W_DEFAULT + 6
}

export class AudioControls {
  // x/y = top-left corner.  depth defaults high so it floats above
  // the rest of the scene.
  constructor(scene, x, y, opts = {}) {
    this._scene = scene
    this._depth = opts.depth ?? 100
    this._playlist = opts.playlist ?? null
    this._dragging = false

    const W = audioControlsWidth(opts)
    this._W = W

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

    // ─── Optional transport buttons (prev/next track) ────────────────
    let cursorX = ICON_W + 2
    if (this._playlist) {
      this._prevBtn = this._makeTransportButton(cursorX, '<<', () => {
        this._playlist.previous(this._scene)
      })
      cursorX += BTN_W + 2

      this._nextBtn = this._makeTransportButton(cursorX, '>>', () => {
        this._playlist.next(this._scene)
      })
      cursorX += BTN_W + 2
    }

    // ─── Volume slider ──────────────────────────────────────────────
    const sliderX = cursorX + 2
    const sliderW = SLIDER_W_DEFAULT
    this._sliderX = sliderX
    this._sliderW = sliderW

    const trackY = H / 2
    this._track = scene.add.rectangle(sliderX, trackY, sliderW, TRACK_H, COL.trackBg)
      .setOrigin(0, 0.5)
    this._track.setStrokeStyle(1, 0x1a0a1a, 0.8)
    this._container.add(this._track)

    this._fill = scene.add.rectangle(sliderX, trackY, 1, TRACK_H, COL.trackFill)
      .setOrigin(0, 0.5)
    this._container.add(this._fill)

    this._thumb = scene.add.rectangle(sliderX, trackY, THUMB_W, THUMB_H, COL.thumb)
      .setOrigin(0.5)
    this._thumb.setStrokeStyle(1, 0x6a3010, 1)
    this._container.add(this._thumb)

    this._sliderHit = scene.add.rectangle(sliderX, 0, sliderW, H, 0xffffff, 0.001)
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

  _makeTransportButton(x, label, onClick) {
    const hit = this._scene.add.rectangle(x, 0, BTN_W, H, 0xffffff, 0.001)
      .setOrigin(0, 0).setInteractive({ useHandCursor: true })
    this._container.add(hit)

    const txt = this._scene.add.text(x + BTN_W / 2, H / 2, label, {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: COL.iconOn,
      fontStyle: 'bold',
    }).setOrigin(0.5).setResolution(2)
    this._container.add(txt)

    hit.on('pointerover', () => { txt.setColor(COL.iconHover); this._drawBg(true) })
    hit.on('pointerout',  () => { txt.setColor(COL.iconOn);    this._drawBg(false) })
    hit.on('pointerdown', () => onClick())
    return { hit, txt }
  }

  _drawBg(hover) {
    this._bg.clear()
    this._bg.fillStyle(hover ? COL.bgHover : COL.bg, 0.85)
    this._bg.fillRoundedRect(0, 0, this._W, H, 4)
    this._bg.lineStyle(1, COL.border, 0.6)
    this._bg.strokeRoundedRect(0, 0, this._W, H, 4)
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
    // The container lives in world space, so we need the pointer's world
    // coords (camera-transformed). Phaser's `p.x/p.y` is screen pixels —
    // wrong when the scene's camera zoom != 1 (which applyUiCamera sets
    // on every UI scene). `p.worldX/p.worldY` accounts for zoom + scroll.
    const wx = (p.worldX != null) ? p.worldX : p.x
    const wy = (p.worldY != null) ? p.worldY : p.y
    const local = this._container.getLocalPoint(wx, wy)
    const t = (local.x - this._sliderX) / this._sliderW
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
    const fillW = Math.max(1, this._sliderW * v)
    this._fill.width = fillW
    this._fill.setFillStyle(muted ? 0x333333 : COL.trackFill)
    this._thumb.x = this._sliderX + fillW
    this._thumb.setFillStyle(muted ? 0x666666 : COL.thumb)
    // Mute icon
    this._muteIcon.setText(this._iconChar())
    this._muteIcon.setColor(this._iconRestColor())
  }
}
