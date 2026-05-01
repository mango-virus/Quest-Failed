// MainMenu — Throne Room edition.
//
// First-person view from the dungeon boss's throne at the back of a vault.
// Adventurers periodically enter through a far doorway and die before
// reaching the camera. Each death stamps "QUEST FAILED" onto the scene as
// a death notification, the title literally accumulating from the game
// playing itself in the background.
//
// Five glowing floor runes serve as the menu (BEGIN DESCENT, RESUME, ROOM
// BUILDER, CHARACTER EDITOR, THE GRAVEYARD). Hovering ignites the rune;
// clicking starts the corresponding scene.
//
// Visual rule: deep blacks + cold purples + warm rune/torch oranges. Pure
// Phaser Graphics primitives, no shared UIKit helpers. Custom cursor (a
// claw tip) tracks the pointer.

import { SaveSystem }   from '../systems/SaveSystem.js'
import { TitleMusic }   from '../systems/TitleMusic.js'
import { GameplayMusic } from '../systems/GameplayMusic.js'
import { AudioControls } from '../ui/AudioControls.js'

const COLORS = {
  voidDeep:   0x040206,
  voidWarm:   0x0a0612,
  stoneFar:   0x14111a,
  stoneNear:  0x1f1c28,
  stoneLit:   0x33303c,
  mortar:     0x080610,
  doorGlow:   0x3a1e08,
  fire:       0xff7a1a,
  ember:      0xff5a18,
  fireDim:    0xa83010,
  fireSoft:   0x4a1808,
  bone:       0xc4a880,
  boneCold:   0x988c70,
  boneShadow: 0x4a4030,
  blood:      0x6a0008,
  bloodDeep:  0x3a0004,
  bloodInk:   0x9a1010,
  rune:       0xc83020,
  runeBright: 0xff8830,
  runeDim:    0x4a1808,
  runeStone:  0x16131c,
  text:       '#d8c8b0',
  textDim:    '#7a6e5a',
  textBright: '#ffd0a0',
  textBlood:  '#a01a18',
}

// Logical design size — camera zooms to fit any canvas resolution.
const W = 1280, H = 720

// Menu rune layout — 2–2–1 fan tuned to clear the foreground throne arms
// (which wedge in from the bottom corners) and the skull pile (which sits
// front-centre at the throne base). Back row sits highest + smallest, mid
// row flanks the centreline, BEGIN DESCENT is largest and front-centre.
const RUNES = [
  // Back row — flanking, smallest
  { id: 'corner',    label: 'CORNER EDITOR',     x: 300,  y: 470, size: 0.9 },
  { id: 'graveyard', label: 'THE GRAVEYARD',     x: 980,  y: 470, size: 0.9 },
  // Mid row — supporting actions
  { id: 'roomedit',  label: 'ROOM EDITOR',       x: 170,  y: 530, size: 1.0 },
  { id: 'continue',  label: 'RESUME',            x: 460,  y: 530, size: 1.0 },
  { id: 'tileset',   label: 'TILESET EDITOR',    x: 820,  y: 530, size: 1.0 },
  // Front centre — primary action, biggest, closest to camera
  { id: 'descent',   label: 'BEGIN DESCENT',     x: 640,  y: 600, size: 1.2 },
]

// Death types in the kill loop, with relative weights.
const KILLS = [
  { type: 'trap',   weight: 5 },
  { type: 'arrow',  weight: 3 },
  { type: 'minion', weight: 2 },
]

export class MainMenu extends Phaser.Scene {
  constructor() {
    super('MainMenu')
  }

  create() {
    // Title-screen music — every entry to MainMenu restarts the song
    // from the beginning (per design).  The forward flow MainMenu →
    // ArchetypeSelect → Game still carries the music seamlessly
    // (those scenes use ensurePlaying / duckForGameplay), but any
    // path that lands BACK on MainMenu (back button from the boss
    // picker, or from an editor) hard-restarts the loop.
    GameplayMusic.stop()
    TitleMusic.restart(this)

    this._setupCamera()
    // Defensive re-apply: Phaser sometimes settles canvas size a tick after
    // create() (font load, scrollbar appearance, post-load layout shifts).
    // Re-running _setupCamera on the next tick AND on every Scale resize
    // event guarantees the design stays centred even if the initial
    // measurement was stale.
    this.time.delayedCall(0, () => this._setupCamera())
    this.scale.on('resize', this._setupCamera, this)
    this.events.once('shutdown', () => this.scale.off('resize', this._setupCamera, this))

    this._hasSave = SaveSystem.hasSave()

    // Layered render groups — depth ordered front-to-back of the scene.
    this._gVoid       = this.add.graphics().setDepth(0)
    this._gWalls      = this.add.graphics().setDepth(1)
    this._gDoorBack   = this.add.graphics().setDepth(2)
    this._gDoorGlow   = this.add.graphics().setDepth(3)
    this._gFloor      = this.add.graphics().setDepth(4)
    this._gTorchGlow  = this.add.graphics().setDepth(5)
    this._cRunes      = this.add.container(0, 0).setDepth(6)
    this._cActors     = this.add.container(0, 0).setDepth(7)
    this._gFlame      = this.add.graphics().setDepth(8)
    this._cMotes      = this.add.container(0, 0).setDepth(9)
    this._gSkulls     = this.add.graphics().setDepth(11)
    this._gThrone     = this.add.graphics().setDepth(12)
    this._gClaws      = this.add.graphics().setDepth(13)
    this._cStamps     = this.add.container(0, 0).setDepth(15)
    this._cChrome     = this.add.container(0, 0).setDepth(17)
    this._gEyelid     = this.add.graphics().setDepth(20)
    this._gCursor     = this.add.graphics().setDepth(30)

    // Static composition.
    this._drawVoid()
    this._drawWalls()
    this._drawDoorway()
    this._drawFloor()
    this._drawTorches()
    this._drawSkulls()
    this._drawThroneAndClaws()
    this._buildRunes()
    this._drawTitle()
    this._drawChrome()

    // Live atmosphere.
    this._tickFlame()
    this._spawnDustMotes()
    this._setupCursor()

    // Intro wipe (eyes opening) + first kill.
    this._eyelidIntro()
    this._scheduleNextKill(2200)
  }

  _setupCamera() {
    const sw = this.scale.width
    const sh = this.scale.height
    const sf = Math.min(sw / W, sh / H)
    const cam = this.cameras.main
    cam.setZoom(sf)
    // Position the camera VIEWPORT inside the canvas instead of scrolling
    // the world. We give the camera a viewport sized exactly to the design
    // (W·sf × H·sf) and place that viewport at the canvas centre. The
    // design renders from world origin into that sub-rect; the rest of the
    // canvas shows the body background (#0a0514) — clean letterbox/pillar.
    // This avoids every scroll-centring math gotcha (Phaser's centerOn not
    // applying zoom, scroll-vs-position-vs-origin confusion, etc.).
    const vw = W * sf
    const vh = H * sf
    cam.setViewport(Math.round((sw - vw) / 2), Math.round((sh - vh) / 2), vw, vh)
    cam.setScroll(0, 0)
    cam.setOrigin(0, 0)
    this.uiW = sw / sf
    this.uiH = sh / sf
  }

  // ─── Static composition ──────────────────────────────────────────────

  _drawVoid() {
    const g = this._gVoid
    // Stretch the void far past the design rect so a wider-than-design canvas
    // (the camera now centres the design) shows void on both sides instead of
    // a hard edge against the page background.
    const overscan = Math.max(2000, this.uiW ?? 0)
    g.fillStyle(COLORS.voidDeep, 1)
      .fillRect(-overscan, -overscan, W + 2 * overscan, H + 2 * overscan)
    for (let r = 380; r > 0; r -= 40) {
      g.fillStyle(COLORS.voidWarm, 0.025)
      g.fillEllipse(W / 2, H * 0.55, r * 1.6, r * 1.1)
    }
  }

  _drawWalls() {
    const g = this._gWalls
    g.fillStyle(COLORS.stoneFar, 1)
    g.fillRect(0, 0, W, H * 0.42)
    // Vault ribs converging toward the doorway.
    g.lineStyle(2, COLORS.mortar, 0.7)
    const cx = W / 2, vy = H * 0.42
    for (let i = -3; i <= 3; i++) {
      g.beginPath()
      g.moveTo(cx + i * 180, 0)
      g.lineTo(cx + i * 16, vy)
      g.strokePath()
    }
    // Stone block courses.
    g.lineStyle(1, COLORS.mortar, 0.5)
    for (let y = 28; y < vy; y += 28) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.strokePath()
    }
    for (let y = 28; y < vy; y += 28) {
      const offset = ((y / 28) % 2) * 32
      for (let x = offset; x < W; x += 64) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 28); g.strokePath()
      }
    }
    // Side walls — angled wedges, narrowing toward centre to imply depth.
    g.fillStyle(COLORS.stoneFar, 1)
    g.fillPoints([
      { x: 0, y: vy }, { x: 0, y: H }, { x: W * 0.18, y: H * 0.78 }, { x: W * 0.30, y: vy },
    ], true)
    g.fillPoints([
      { x: W, y: vy }, { x: W, y: H }, { x: W * 0.82, y: H * 0.78 }, { x: W * 0.70, y: vy },
    ], true)
    // Lit-edge slivers.
    g.fillStyle(COLORS.stoneNear, 0.7)
    g.fillPoints([
      { x: W * 0.12, y: H }, { x: W * 0.18, y: H * 0.78 },
      { x: W * 0.30, y: vy }, { x: W * 0.32, y: vy },
      { x: W * 0.22, y: H * 0.80 }, { x: W * 0.18, y: H },
    ], true)
    g.fillPoints([
      { x: W * 0.88, y: H }, { x: W * 0.82, y: H * 0.78 },
      { x: W * 0.70, y: vy }, { x: W * 0.68, y: vy },
      { x: W * 0.78, y: H * 0.80 }, { x: W * 0.82, y: H },
    ], true)
  }

  _drawDoorway() {
    const cx = W / 2
    const dy = H * 0.30
    const dh = H * 0.26
    const dw = W * 0.10
    const left = cx - dw / 2, right = cx + dw / 2
    const arch = dy
    const base = dy + dh
    const peak = dy - dw / 2

    const gb = this._gDoorBack
    gb.fillStyle(0x000000, 1)
    gb.beginPath()
    gb.moveTo(left,  base)
    gb.lineTo(left,  arch)
    gb.lineTo(cx,    peak)
    gb.lineTo(right, arch)
    gb.lineTo(right, base)
    gb.closePath()
    gb.fillPath()

    const gg = this._gDoorGlow
    for (let i = 0; i < 6; i++) {
      gg.fillStyle(COLORS.doorGlow, 0.10 - i * 0.014)
      gg.fillEllipse(cx, peak + 12, dw * (1 + i * 0.4), 12 + i * 8)
    }
    gg.lineStyle(2, COLORS.stoneNear, 0.85)
    gg.beginPath()
    gg.moveTo(left  - 4, base)
    gg.lineTo(left  - 4, arch)
    gg.lineTo(cx,        peak - 6)
    gg.lineTo(right + 4, arch)
    gg.lineTo(right + 4, base)
    gg.strokePath()
    gg.fillStyle(COLORS.stoneLit, 0.7)
    gg.fillTriangle(cx - 8, peak + 4, cx + 8, peak + 4, cx, peak - 6)

    // Floor light spilling out of the door.
    for (let i = 0; i < 8; i++) {
      gg.fillStyle(COLORS.doorGlow, 0.06 - i * 0.006)
      const w = dw + i * 18
      const y = base + i * 20
      gg.fillTriangle(cx - w / 2, y, cx + w / 2, y, cx, base)
    }

    this._doorFront = { x: cx, y: base }
  }

  _drawFloor() {
    const g = this._gFloor
    const cx = W / 2
    const top = H * 0.42, bot = H

    g.fillStyle(COLORS.stoneNear, 1)
    g.fillRect(0, top, W, bot - top)
    g.lineStyle(1, COLORS.mortar, 0.6)
    for (let i = -7; i <= 7; i++) {
      const fx = cx + i * 90
      const tx = cx + i * 20
      g.beginPath(); g.moveTo(fx, bot); g.lineTo(tx, top); g.strokePath()
    }
    g.lineStyle(1, COLORS.mortar, 0.45)
    for (let i = 0; i < 10; i++) {
      const t = Math.pow(i / 10, 1.6)
      const y = bot - (bot - top) * t
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.strokePath()
    }
  }

  _drawTorches() {
    this._torches = [
      { x: W * 0.28, y: H * 0.50 },
      { x: W * 0.72, y: H * 0.50 },
    ]
    for (const t of this._torches) {
      const g = this._gFloor
      g.fillStyle(0x000000, 1)
      g.fillTriangle(t.x - 6, t.y + 14, t.x + 6, t.y + 14, t.x, t.y + 26)
      g.fillRect(t.x - 4, t.y + 4, 8, 14)
    }
    this._drawFlame()
    this._drawTorchGlow()
  }

  _drawFlame() {
    const g = this._gFlame
    g.clear()
    const wob = this._flameWobble ?? 1
    for (const t of this._torches) {
      g.fillStyle(COLORS.fire, 0.85)
      g.fillEllipse(t.x, t.y - 4 * wob, 12 * wob, 22 * wob)
      g.fillStyle(0xffd680, 0.9)
      g.fillEllipse(t.x, t.y, 6 * wob, 12 * wob)
      g.fillStyle(COLORS.ember, 0.6)
      g.fillEllipse(t.x, t.y - 12 * wob, 4 * wob, 8 * wob)
    }
  }

  _drawTorchGlow() {
    const g = this._gTorchGlow
    g.clear()
    const wob = this._flameWobble ?? 1
    for (const t of this._torches) {
      for (let i = 7; i > 0; i--) {
        const r = 70 + i * 22
        g.fillStyle(COLORS.fire, 0.018 * wob)
        g.fillEllipse(t.x, t.y, r * wob, r * 0.7 * wob)
      }
      g.fillStyle(COLORS.ember, 0.18 * wob)
      g.fillEllipse(t.x, t.y, 50 * wob, 40 * wob)
    }
  }

  _tickFlame() {
    this._flameWobble = 1
    this.tweens.add({
      targets: this,
      _flameWobble: { from: 0.85, to: 1.15 },
      duration: 320, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: () => { this._drawFlame(); this._drawTorchGlow() },
    })
  }

  _drawSkulls() {
    const g = this._gSkulls
    const cx = W / 2, base = H - 32
    g.fillStyle(COLORS.boneShadow, 0.6)
    g.fillEllipse(cx, base + 18, 480, 60)

    g.fillStyle(COLORS.boneCold, 0.9)
    this._femur(g, cx - 130, base - 4,  20)
    this._femur(g, cx + 130, base - 4, -20)

    const skulls = [
      { x: cx - 200, y: base - 6,  s: 1.0, lean: -8 },
      { x: cx - 110, y: base + 8,  s: 1.2, lean:  4 },
      { x: cx,       y: base - 18, s: 1.4, lean: -2 },
      { x: cx + 110, y: base + 6,  s: 1.1, lean: 12 },
      { x: cx + 200, y: base - 4,  s: 1.0, lean: 22 },
      { x: cx - 60,  y: base + 22, s: 0.9, lean: -18 },
      { x: cx + 60,  y: base + 24, s: 0.9, lean:  18 },
    ]
    for (const s of skulls) this._skull(g, s.x, s.y, s.s, s.lean)
  }

  _skull(g, cx, cy, scale = 1, lean = 0) {
    const w = 36 * scale, h = 30 * scale
    g.fillStyle(COLORS.bone, 1)
    g.fillEllipse(cx, cy, w, h)
    g.fillStyle(COLORS.boneCold, 1)
    g.fillEllipse(cx, cy + h * 0.35, w * 0.7, h * 0.45)
    g.fillStyle(0x000000, 1)
    g.fillEllipse(cx - w * 0.20 + lean * 0.4, cy - h * 0.05, w * 0.18, h * 0.20)
    g.fillEllipse(cx + w * 0.20 + lean * 0.4, cy - h * 0.05, w * 0.18, h * 0.20)
    g.fillTriangle(cx - 2, cy + h * 0.10, cx + 2, cy + h * 0.10, cx, cy + h * 0.25)
    g.fillStyle(COLORS.bone, 0.5)
    g.fillEllipse(cx, cy - h * 0.20, w * 0.6, h * 0.18)
  }

  _femur(g, cx, cy, rot) {
    const len = 130, th = 10
    const rad = rot * Math.PI / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const pt = (lx, ly) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos })
    g.fillPoints([
      pt(-len/2, -th/2), pt(len/2, -th/2), pt(len/2, th/2), pt(-len/2, th/2),
    ], true)
    const e1 = pt(-len/2, 0), e2 = pt(len/2, 0)
    g.fillCircle(e1.x - 4, e1.y - 6,  8)
    g.fillCircle(e1.x - 4, e1.y + 6,  8)
    g.fillCircle(e2.x + 4, e2.y - 6,  8)
    g.fillCircle(e2.x + 4, e2.y + 6,  8)
  }

  _drawThroneAndClaws() {
    const g = this._gThrone
    g.fillStyle(0x000000, 1)
    g.fillPoints([
      { x: 0,        y: H * 0.62 },
      { x: 0,        y: H + 40 },
      { x: 360,      y: H + 40 },
      { x: 280,      y: H * 0.78 },
      { x: 200,      y: H * 0.70 },
    ], true)
    g.fillPoints([
      { x: W,        y: H * 0.62 },
      { x: W,        y: H + 40 },
      { x: W - 360,  y: H + 40 },
      { x: W - 280,  y: H * 0.78 },
      { x: W - 200,  y: H * 0.70 },
    ], true)
    g.lineStyle(2, COLORS.fireSoft, 0.65)
    g.beginPath()
    g.moveTo(200, H * 0.70); g.lineTo(280, H * 0.78); g.lineTo(360, H + 40)
    g.strokePath()
    g.beginPath()
    g.moveTo(W - 200, H * 0.70); g.lineTo(W - 280, H * 0.78); g.lineTo(W - 360, H + 40)
    g.strokePath()

    this._drawClaws(this._gClaws, 230,    H * 0.74,  1)
    this._drawClaws(this._gClaws, W - 230, H * 0.74, -1)
  }

  _drawClaws(g, cx, cy, side) {
    g.fillStyle(0x000000, 1)
    g.fillPoints([
      { x: cx - 60 * side, y: cy - 4 },
      { x: cx + 70 * side, y: cy - 22 },
      { x: cx + 90 * side, y: cy + 18 },
      { x: cx - 40 * side, y: cy + 30 },
    ], true)
    const claws = [
      { len: 70, ang: -28 },
      { len: 80, ang: -10 },
      { len: 88, ang:   8 },
      { len: 80, ang:  26 },
      { len: 60, ang:  44 },
    ]
    for (const c of claws) {
      const ang = c.ang * Math.PI / 180
      const sx = cx + 70 * side, sy = cy - 12 + (c.ang * 0.6)
      const tx = sx + Math.cos(ang) * c.len * side
      const ty = sy + Math.sin(ang) * c.len
      g.fillStyle(0x000000, 1)
      g.fillTriangle(sx, sy - 4, sx, sy + 4, tx, ty)
      g.fillStyle(COLORS.fireSoft, 0.5)
      g.fillTriangle(sx, sy + 1, sx, sy + 4, tx, ty)
    }
  }

  // ─── Menu runes ───────────────────────────────────────────────────────

  _buildRunes() {
    this._runeEntries = []
    for (const r of RUNES) {
      const disabled = r.id === 'graveyard' ||
                       (r.id === 'continue' && !this._hasSave)
      this._runeEntries.push(this._makeRune(r, disabled))
    }
  }

  _makeRune(spec, disabled) {
    const sz = 76 * spec.size
    const g = this.add.graphics()
    let igniteState = disabled ? 0 : 0.25
    const drawTile = (factor) => {
      g.clear()
      g.fillStyle(COLORS.runeStone, 1)
      g.fillRect(spec.x - sz / 2, spec.y - sz / 2, sz, sz)
      g.lineStyle(1, COLORS.mortar, 0.9)
      g.strokeRect(spec.x - sz / 2, spec.y - sz / 2, sz, sz)
      g.lineStyle(2, COLORS.runeDim, 0.85)
      g.strokeCircle(spec.x, spec.y, sz * 0.34)
      this._drawGlyph(g, spec.x, spec.y, sz * 0.28, spec.id, factor, disabled)
      if (!disabled) {
        for (let i = 0; i < 6; i++) {
          g.fillStyle(COLORS.fire, 0.06 * factor)
          g.fillEllipse(spec.x, spec.y, sz * (1 + i * 0.25), sz * 0.5 * (1 + i * 0.25))
        }
      }
    }
    drawTile(igniteState)
    this._cRunes.add(g)

    const labelColor = disabled ? COLORS.textDim : COLORS.text
    const label = this.add.text(spec.x, spec.y - sz / 2 - 14, spec.label, {
      fontSize: '15px', color: labelColor, fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3, letterSpacing: 2,
    }).setOrigin(0.5, 1).setAlpha(disabled ? 0.5 : 0.8)
    this._cRunes.add(label)

    let igniteTween = null
    const setIgnition = (target) => {
      if (igniteTween) igniteTween.stop()
      const obj = { f: igniteState }
      igniteTween = this.tweens.add({
        targets: obj, f: target, duration: 200, ease: 'Sine.easeOut',
        onUpdate: () => { igniteState = obj.f; drawTile(obj.f) },
      })
    }

    if (!disabled) {
      const hit = this.add.rectangle(spec.x, spec.y, sz + 12, sz + 12, 0, 0)
        .setInteractive({ useHandCursor: false })
      this._cRunes.add(hit)
      hit.on('pointerover', () => {
        setIgnition(1.0)
        label.setColor(COLORS.textBright)
        label.setAlpha(1)
        this._spitEmbers(spec.x, spec.y, 4)
      })
      hit.on('pointerout', () => {
        setIgnition(0.25)
        label.setColor(labelColor)
        label.setAlpha(0.8)
      })
      hit.on('pointerdown', () => {
        setIgnition(1.4)
        this._spitEmbers(spec.x, spec.y, 14)
        this.time.delayedCall(120, () => this._fireRune(spec.id))
      })
    }

    return { spec, g, label, redraw: drawTile }
  }

  _drawGlyph(g, cx, cy, r, id, factor, disabled) {
    let c
    if (disabled) {
      c = COLORS.runeDim
    } else {
      const colour = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(COLORS.rune),
        Phaser.Display.Color.IntegerToColor(COLORS.runeBright),
        100, factor * 100)
      c = Phaser.Display.Color.GetColor(colour.r, colour.g, colour.b)
    }
    g.lineStyle(3, c, 0.95)
    switch (id) {
      case 'descent':
        g.beginPath()
        g.moveTo(cx, cy - r * 0.8); g.lineTo(cx, cy + r * 0.8)
        g.moveTo(cx - r * 0.5, cy + r * 0.2); g.lineTo(cx, cy + r * 0.8)
        g.moveTo(cx + r * 0.5, cy + r * 0.2); g.lineTo(cx, cy + r * 0.8)
        g.strokePath()
        break
      case 'continue':
        g.beginPath()
        g.moveTo(cx - r * 0.4, cy - r * 0.6); g.lineTo(cx + r * 0.4, cy)
        g.moveTo(cx + r * 0.4, cy);           g.lineTo(cx - r * 0.4, cy + r * 0.6)
        g.strokePath()
        break
      case 'corner':
        // Outer L-shape suggesting a corner block; inner pixel grid hint
        g.beginPath()
        g.moveTo(cx - r * 0.7, cy + r * 0.7); g.lineTo(cx - r * 0.7, cy - r * 0.7)
        g.lineTo(cx + r * 0.7, cy - r * 0.7)
        g.strokePath()
        g.strokeRect(cx - r * 0.4, cy - r * 0.4, r * 0.8, r * 0.8)
        break
      case 'roomedit':
        // Room outline with one filled cell inside — a "painted tile within
        // a room" suggestion.
        g.strokeRect(cx - r * 0.7, cy - r * 0.55, r * 1.4, r * 1.1)
        g.fillStyle(COLORS.fire, 0.35)
        g.fillRect(cx - r * 0.18, cy - r * 0.18, r * 0.36, r * 0.36)
        g.strokeRect(cx - r * 0.18, cy - r * 0.18, r * 0.36, r * 0.36)
        break
      case 'tileset':
        // 3×3 tile-grid glyph — small squares laid out in a grid suggest
        // sprite tiles being placed.
        {
          const cell = r * 0.42
          const off  = cell + 2
          for (let row = -1; row <= 1; row++) {
            for (let col = -1; col <= 1; col++) {
              g.strokeRect(cx + col * off - cell / 2, cy + row * off - cell / 2, cell, cell)
            }
          }
        }
        break
      case 'graveyard':
        g.beginPath()
        g.arc(cx, cy, r * 0.7, Math.PI, 0)
        g.lineTo(cx + r * 0.7, cy + r * 0.7)
        g.lineTo(cx - r * 0.7, cy + r * 0.7)
        g.closePath()
        g.strokePath()
        g.beginPath()
        g.moveTo(cx, cy - r * 0.4); g.lineTo(cx, cy + r * 0.5)
        g.moveTo(cx - r * 0.25, cy - r * 0.15); g.lineTo(cx + r * 0.25, cy - r * 0.15)
        g.strokePath()
        break
    }
  }

  _spitEmbers(x, y, n) {
    for (let i = 0; i < n; i++) {
      const dot = this.add.rectangle(x, y, 2, 2, COLORS.fire, 1).setDepth(10)
      const dx = (Math.random() - 0.5) * 60
      this.tweens.add({
        targets: dot,
        x: x + dx,
        y: y - 40 - Math.random() * 60,
        alpha: { from: 1, to: 0 },
        duration: 600 + Math.random() * 400, ease: 'Sine.easeOut',
        onComplete: () => dot.destroy(),
      })
    }
  }

  _fireRune(id) {
    if      (id === 'descent')   this._beginDescent()
    else if (id === 'continue')  this._continueRun()    // music carries into Game (ducked there)
    else if (id === 'corner')    { TitleMusic.stop(); this.scene.start('CornerEditor') }
    else if (id === 'tileset')   { TitleMusic.stop(); this.scene.start('TilesetEditor') }
    else if (id === 'roomedit')  { TitleMusic.stop(); this.scene.start('RoomTileEditor') }
  }

  // ─── Atmosphere ───────────────────────────────────────────────────────

  _spawnDustMotes() {
    const count = 38
    for (let i = 0; i < count; i++) {
      const t = this._torches[i % 2]
      const sx = t.x + (Math.random() - 0.5) * 90
      const sy = t.y + (Math.random() - 0.4) * 280
      const dot = this.add.rectangle(sx, sy,
        Math.random() < 0.7 ? 1 : 2, Math.random() < 0.7 ? 1 : 2,
        COLORS.fire, 0.18 + Math.random() * 0.25)
      this._cMotes.add(dot)
      this.tweens.add({
        targets: dot,
        y: sy - 60 - Math.random() * 100,
        x: sx + (Math.random() - 0.5) * 30,
        alpha: { from: dot.alpha, to: 0 },
        duration: 4000 + Math.random() * 3000,
        delay:    Math.random() * 4000,
        repeat:   -1,
        repeatDelay: 0,
        onRepeat: () => {
          dot.x = t.x + (Math.random() - 0.5) * 90
          dot.y = t.y + 100 + Math.random() * 180
          dot.alpha = 0.18 + Math.random() * 0.25
        },
      })
    }
  }

  _eyelidIntro() {
    const g = this._gEyelid
    const draw = (h) => {
      g.clear()
      g.fillStyle(0x000000, 1)
      g.fillRect(0, 0, W, h)
      g.fillRect(0, H - h, W, h)
    }
    const obj = { h: H / 2 }
    draw(obj.h)
    this.tweens.add({
      targets: obj, h: 0,
      duration: 1200, ease: 'Sine.easeOut',
      onUpdate: () => draw(obj.h),
      onComplete: () => g.clear(),
    })
  }

  // ─── Hero kill loop ───────────────────────────────────────────────────

  _scheduleNextKill(delayMs) {
    this.time.delayedCall(delayMs, () => this._runKillSequence())
  }

  _runKillSequence() {
    const hero = this._spawnHero()
    const kind = this._weightedPick(KILLS)
    const dieAtT = 0.45 + Math.random() * 0.30
    const onDeath = () => {}        // title is static now — no stamp on kill
    if (kind === 'trap')   this._killByTrap(hero, dieAtT, onDeath)
    if (kind === 'arrow')  this._killByArrow(hero, dieAtT, onDeath)
    if (kind === 'minion') this._killByMinion(hero, dieAtT, onDeath)
    this._scheduleNextKill(7000 + Math.random() * 6000)
  }

  _spawnHero() {
    const start = this._doorFront
    const c = this.add.container(start.x, start.y - 4).setScale(0.18)
    const body  = this.add.rectangle(0, 0, 14, 22, 0x0a0a14, 1)
    const head  = this.add.circle(0, -18, 6, 0x0a0a14, 1)
    const sword = this.add.rectangle(10, -2, 2, 22, 0x554a2a, 1)
    c.add([body, head, sword])
    this._cActors.add(c)
    return c
  }

  _walkHero(hero, t) {
    const start = { x: this._doorFront.x, y: this._doorFront.y - 4 }
    const end   = { x: W / 2,             y: H * 0.85 }
    const x = Phaser.Math.Linear(start.x, end.x, t)
    const y = Phaser.Math.Linear(start.y, end.y, t)
    const scale = Phaser.Math.Linear(0.18, 0.95, t)
    return this.tweens.add({
      targets: hero,
      x, y, scaleX: scale, scaleY: scale,
      duration: 2200 * t, ease: 'Sine.easeIn',
    })
  }

  _killByTrap(hero, dieAtT, onDeath) {
    const walk = this._walkHero(hero, dieAtT)
    walk.on('complete', () => {
      const flash = this.add.rectangle(hero.x, hero.y + 12, 80, 18, COLORS.blood, 0.7).setDepth(7)
      const spikes = this.add.graphics().setDepth(7)
      spikes.fillStyle(COLORS.bone, 0.95)
      const sp = (px, py) => spikes.fillTriangle(px - 4, py + 8, px + 4, py + 8, px, py - 14)
      for (let i = -2; i <= 2; i++) sp(hero.x + i * 10, hero.y + 14)
      this.tweens.add({
        targets: flash, alpha: 0, duration: 500,
        onComplete: () => flash.destroy(),
      })
      this.tweens.add({
        targets: hero, angle: 90, y: hero.y + 14, alpha: 0,
        duration: 600,
        onComplete: () => { hero.destroy(); spikes.destroy(); onDeath() },
      })
    })
  }

  _killByArrow(hero, dieAtT, onDeath) {
    const walk = this._walkHero(hero, dieAtT)
    walk.on('complete', () => {
      const fromLeft = Math.random() < 0.5
      const arrow = this.add.rectangle(
        fromLeft ? -20 : W + 20, hero.y - 4, 22, 2, 0x000000, 1).setDepth(7)
      this.tweens.add({
        targets: arrow, x: hero.x, duration: 110,
        onComplete: () => {
          this.tweens.add({
            targets: hero, angle: 25, y: hero.y + 8, alpha: 0,
            duration: 700,
            onComplete: () => { hero.destroy(); arrow.destroy(); onDeath() },
          })
        },
      })
    })
  }

  _killByMinion(hero, dieAtT, onDeath) {
    const walk = this._walkHero(hero, dieAtT)
    walk.on('complete', () => {
      const fromLeft = Math.random() < 0.5
      const startX = fromLeft ? hero.x - 200 : hero.x + 200
      const minion = this.add.container(startX, hero.y + 10).setDepth(7)
      const blob = this.add.ellipse(0, 0, 24, 18, 0x000000, 1)
      const eye  = this.add.circle(fromLeft ? 6 : -6, -2, 2, COLORS.fire, 1)
      minion.add([blob, eye])
      this.tweens.add({
        targets: minion, x: hero.x, duration: 220, ease: 'Quad.easeIn',
        onComplete: () => {
          this.tweens.add({
            targets: [hero, minion],
            x: fromLeft ? -40 : W + 40,
            angle: 30,
            duration: 500, ease: 'Quad.easeIn',
            onComplete: () => { hero.destroy(); minion.destroy(); onDeath() },
          })
        },
      })
    })
  }

  _weightedPick(items) {
    const total = items.reduce((s, it) => s + it.weight, 0)
    let r = Math.random() * total
    for (const it of items) { if ((r -= it.weight) <= 0) return it.type }
    return items[0].type
  }

  // ─── Static title ─────────────────────────────────────────────────────
  // Single permanent QUEST FAILED block above the doorway. No tween, no
  // accumulation — just sits there as the screen's masthead.

  _drawTitle() {
    const cx = W / 2
    const cy = H * 0.16
    // Drop shadow for depth.
    const shadow = this.add.text(cx + 4, cy + 4, 'QUEST FAILED', {
      fontSize: '88px', color: '#000000', fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0.55)
    // Main blood-ink title.
    const ink = this.add.text(cx, cy, 'QUEST FAILED', {
      fontSize: '88px', color: COLORS.textBlood, fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#3a0000', strokeThickness: 4,
    }).setOrigin(0.5)
    this._cStamps.add(shadow)
    this._cStamps.add(ink)
  }

  // ─── Custom cursor ────────────────────────────────────────────────────

  _setupCursor() {
    if (this.game.canvas?.style) this.game.canvas.style.cursor = 'none'
    const draw = (x, y) => {
      const g = this._gCursor
      g.clear()
      g.fillStyle(0x000000, 1)
      g.fillTriangle(x, y, x + 14, y + 6, x + 6, y + 16)
      g.lineStyle(1, COLORS.fire, 0.7)
      g.strokeTriangle(x, y, x + 14, y + 6, x + 6, y + 16)
    }
    draw(-100, -100)
    this.input.on('pointermove', (p) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y)
      draw(wp.x, wp.y)
    })
    this.events.once('shutdown', () => {
      if (this.game.canvas?.style) this.game.canvas.style.cursor = ''
    })
  }

  // ─── Chrome (version line) ────────────────────────────────────────────

  _drawChrome() {
    const v = this.add.text(W - 16, H - 12, 'Quest Failed  ·  v0.3', {
      fontSize: '11px', color: COLORS.textDim, fontFamily: 'serif',
    }).setOrigin(1, 1)
    this._cChrome.add(v)

    // Audio controls — bottom-LEFT, away from the version label so the
    // two pieces of corner chrome don't fight for the same anchor.
    // Width 130, height 24 (see AudioControls).  16 px from each edge.
    new AudioControls(this, 16, H - 16 - 24, { depth: 30 })
  }

  // ─── Menu actions ─────────────────────────────────────────────────────

  _beginDescent() {
    if (this._hasSave) this._confirmOverwrite()
    else               this.scene.start('ArchetypeSelect')
  }

  _continueRun() {
    if (!this._hasSave) return
    const state = SaveSystem.load()
    if (state) this.scene.start('Game', { gameState: state })
  }

  _confirmOverwrite() {
    const wash = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.78).setDepth(40)
    const txt = this.add.text(W / 2, H * 0.40, 'ABANDON CURRENT RUN?', {
      fontSize: '38px', color: COLORS.text, fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(41)
    const sub = this.add.text(W / 2, H * 0.46, 'Your dungeon will be lost forever.', {
      fontSize: '15px', color: COLORS.textDim, fontFamily: 'serif',
    }).setOrigin(0.5).setDepth(41)

    const teardown = () => {
      wash.destroy(); txt.destroy(); sub.destroy()
      tabletL.destroy(); tabletR.destroy()
    }
    const tabletL = this._stoneTablet(W / 2 - 130, H * 0.62, 'ABANDON', () => {
      SaveSystem.deleteSave()
      teardown()
      this.scene.start('ArchetypeSelect')
    })
    const tabletR = this._stoneTablet(W / 2 + 130, H * 0.62, 'CANCEL', teardown)
  }

  _stoneTablet(cx, cy, label, onClick) {
    const w = 200, h = 56
    const c = this.add.container(cx, cy).setDepth(42)
    const g = this.add.graphics()
    const draw = (hover) => {
      g.clear()
      g.fillStyle(hover ? COLORS.stoneLit : COLORS.runeStone, 1)
      g.fillRect(-w / 2, -h / 2, w, h)
      g.lineStyle(1, hover ? COLORS.fire : COLORS.fireSoft, hover ? 1 : 0.6)
      g.strokeRect(-w / 2, -h / 2, w, h)
    }
    draw(false)
    const t = this.add.text(0, 0, label, {
      fontSize: '17px', color: COLORS.text, fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3, letterSpacing: 2,
    }).setOrigin(0.5)
    const hit = this.add.rectangle(0, 0, w, h, 0, 0).setInteractive()
    hit.on('pointerover', () => { draw(true);  t.setColor(COLORS.textBright) })
    hit.on('pointerout',  () => { draw(false); t.setColor(COLORS.text) })
    hit.on('pointerdown', onClick)
    c.add([g, t, hit])
    return c
  }
}
