// AudioControls — dual-row volume widget.
//
// Renders two labelled slider rows stacked vertically:
//
//   MUSIC  [♪]  [──────•──────────────────────]
//   SFX    [♪]  [──────•──────────────────────]
//
// The Music row drives TitleMusic (and GameplayMusic mirrors it).
// The SFX row drives SfxVolume (SfxSystem reads it per-sound).
//
// Width is caller-supplied via opts.w so the widget stretches to fill
// whatever panel it lives in (PauseMenu / Options).
// Height is always AUDIO_CONTROLS_HEIGHT — export it for layout math.
//
// Used by:
//   PauseMenu  — settings sub-screen
//   Options    — audio section

import { TitleMusic } from '../systems/TitleMusic.js'
import { SfxVolume }  from '../systems/SfxVolume.js'

const COL = {
  bg:        0x0a0612,
  bgHover:   0x140820,
  border:    0x3a1e08,
  trackBg:   0x1a1018,
  trackFill: 0xff7a1a,
  trackFillSfx: 0x4aabff,   // blue tint for SFX row
  thumb:     0xffd0a0,
  thumbSfx:  0xaaddff,
  iconOn:    '#ffd0a0',
  iconOnSfx: '#aaddff',
  iconOff:   '#6a4a30',
  iconHover: '#ffe0b0',
  labelCol:  '#8a8090',
}

const ROW_H     = 24
const ROW_GAP   = 6
const LABEL_W   = 42   // "MUSIC" / "SFX  " label column
const MUTE_W    = 24
const SLIDER_PAD = 8   // left gap before slider + right margin

export const AUDIO_CONTROLS_HEIGHT = ROW_H * 2 + ROW_GAP

const DEFAULT_W = 300

export class AudioControls {
  constructor(scene, x, y, opts = {}) {
    this._scene    = scene
    this._depth    = opts.depth ?? 100
    this._w        = opts.w ?? DEFAULT_W
    this._unsubs   = []
    this._dragging = null   // null | 'music' | 'sfx'

    this._container = scene.add.container(x, y).setDepth(this._depth)

    // Background panel covering both rows
    this._bg = scene.add.graphics()
    this._drawBg(false)
    this._container.add(this._bg)

    // Build the two rows
    this._music = this._makeRow(0,           'MUSIC', TitleMusic, COL.trackFill,   COL.thumb,    COL.iconOn)
    this._sfx   = this._makeRow(ROW_H + ROW_GAP, 'SFX',   SfxVolume,  COL.trackFillSfx, COL.thumbSfx, COL.iconOnSfx)

    // Scene-wide pointer tracking for drag
    scene.input.on('pointermove', this._onPointerMove, this)
    scene.input.on('pointerup',   this._onPointerUp,   this)

    // Subscribe to both APIs for live UI sync
    this._unsubs.push(TitleMusic.onChange(() => this._refreshRow(this._music, TitleMusic)))
    this._unsubs.push(SfxVolume.onChange(()   => this._refreshRow(this._sfx,  SfxVolume)))

    this._refreshRow(this._music, TitleMusic)
    this._refreshRow(this._sfx,   SfxVolume)

    scene.events.once('shutdown', () => this.destroy())
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this._unsubs.forEach(u => u())
    this._scene.input.off('pointermove', this._onPointerMove, this)
    this._scene.input.off('pointerup',   this._onPointerUp,   this)
    this._container?.destroy()
    this._container = null
  }

  // ── Row builder ──────────────────────────────────────────────────────────

  _makeRow(rowY, label, api, fillColor, thumbColor, iconOnColor) {
    const sliderX = LABEL_W + MUTE_W + SLIDER_PAD
    const sliderW = this._w - sliderX - 4

    // Label
    const labelT = this._scene.add.text(0, rowY + ROW_H / 2, label, {
      fontSize: '8px', fontFamily: '"Press Start 2P", monospace',
      color: COL.labelCol,
    }).setOrigin(0, 0.5).setResolution(2)
    this._container.add(labelT)

    // Mute hit zone + icon
    const muteHit = this._scene.add.rectangle(LABEL_W, rowY, MUTE_W, ROW_H, 0xffffff, 0.001)
      .setOrigin(0, 0).setInteractive({ useHandCursor: true })
    this._container.add(muteHit)

    const muteIcon = this._scene.add.text(LABEL_W + MUTE_W / 2, rowY + ROW_H / 2,
      api.isMuted() ? '—' : '♪', {
        fontSize: '13px', fontFamily: 'monospace',
        color: api.isMuted() ? COL.iconOff : iconOnColor,
        fontStyle: 'bold',
      }).setOrigin(0.5).setResolution(2)
    this._container.add(muteIcon)

    muteHit.on('pointerover', () => muteIcon.setColor(COL.iconHover))
    muteHit.on('pointerout',  () => muteIcon.setColor(api.isMuted() ? COL.iconOff : iconOnColor))
    muteHit.on('pointerdown', () => { api.toggleMuted(); this._drawBg(true) })

    // Track
    const trackY = rowY + ROW_H / 2
    const track = this._scene.add.rectangle(sliderX, trackY, sliderW, 4, COL.trackBg)
      .setOrigin(0, 0.5)
    track.setStrokeStyle(1, 0x1a0a1a, 0.8)
    this._container.add(track)

    const fill = this._scene.add.rectangle(sliderX, trackY, 1, 4, fillColor)
      .setOrigin(0, 0.5)
    this._container.add(fill)

    const thumb = this._scene.add.rectangle(sliderX, trackY, 6, 12, thumbColor)
      .setOrigin(0.5)
    thumb.setStrokeStyle(1, 0x3a1c0a, 1)
    this._container.add(thumb)

    // Slider hit zone
    const sliderHit = this._scene.add.rectangle(sliderX, rowY, sliderW, ROW_H, 0xffffff, 0.001)
      .setOrigin(0, 0).setInteractive({ useHandCursor: true })
    this._container.add(sliderHit)

    sliderHit.on('pointerdown', (p) => {
      this._dragging = api
      this._setFromPointer(p, api, sliderX, sliderW)
    })

    // Hover glow on entire widget
    muteHit.on('pointerover',   () => this._drawBg(true))
    muteHit.on('pointerout',    () => this._drawBg(false))
    sliderHit.on('pointerover', () => this._drawBg(true))
    sliderHit.on('pointerout',  () => this._drawBg(false))

    return { muteIcon, fill, thumb, sliderX, sliderW, fillColor, thumbColor, iconOnColor }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  _drawBg(hover) {
    this._bg.clear()
    this._bg.fillStyle(hover ? COL.bgHover : COL.bg, 0.85)
    this._bg.fillRoundedRect(0, 0, this._w, AUDIO_CONTROLS_HEIGHT, 4)
    this._bg.lineStyle(1, COL.border, 0.6)
    this._bg.strokeRoundedRect(0, 0, this._w, AUDIO_CONTROLS_HEIGHT, 4)
  }

  _setFromPointer(p, api, sliderX, sliderW) {
    const wx = p.worldX ?? p.x
    const wy = p.worldY ?? p.y
    const local = this._container.getLocalPoint(wx, wy)
    const t = (local.x - sliderX) / sliderW
    const v = Math.max(0, Math.min(1, t))
    api.setVolume(v)
    if (api.isMuted() && v > 0) api.setMuted(false)
  }

  _onPointerMove(p) {
    if (!this._dragging) return
    const row = this._dragging === TitleMusic ? this._music : this._sfx
    this._setFromPointer(p, this._dragging, row.sliderX, row.sliderW)
  }

  _onPointerUp() { this._dragging = null }

  _refreshRow(row, api) {
    if (!this._container) return
    const v     = api.getVolume()
    const muted = api.isMuted()
    const fillW = Math.max(1, row.sliderW * v)
    row.fill.width = fillW
    row.fill.setFillStyle(muted ? 0x333333 : row.fillColor)
    row.thumb.x = row.sliderX + fillW
    row.thumb.setFillStyle(muted ? 0x666666 : row.thumbColor)
    row.muteIcon.setText(muted ? '—' : '♪')
    row.muteIcon.setColor(muted ? COL.iconOff : row.iconOnColor)
  }
}
