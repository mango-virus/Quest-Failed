// Shared visual primitives used across all scenes.
// All drawing functions operate on caller-supplied Graphics objects
// so scenes retain full control over depth and camera assignment.

import { SfxVolume } from '../systems/SfxVolume.js'

// Module-level hover rate-limit so rapid mouse-overs across many buttons
// don't stack the hover sound.
let _lastBtnHoverAt = 0

// Exported helpers so non-pixelButton interactive elements (BuildMenu slots,
// BossTopBar, etc.) can play the same UI sounds without duplicating logic.
export function uiSfxHover(scene) {
  if (SfxVolume.isMuted()) return
  const now = Date.now()
  if (now - _lastBtnHoverAt < 80) return
  if (!scene.cache?.audio?.exists?.('sfx-btn-hover')) return
  _lastBtnHoverAt = now
  scene.sound.play('sfx-btn-hover', { volume: Math.min(1, 0.18 * SfxVolume.getVolume()) })
}
export function uiSfxClick(scene) {
  if (SfxVolume.isMuted()) return
  if (!scene.cache?.audio?.exists?.('sfx-btn-click')) return
  scene.sound.play('sfx-btn-click', { volume: Math.min(1, 0.88 * SfxVolume.getVolume()) })
}

// ── Master palette ────────────────────────────────────────────────────────────
export const PALETTE = {
  // Backgrounds
  void:        0x050a12,
  panelBg:     0x070d1a,
  panelBorder: 0x0d2a4a,

  // Dungeon world
  gridLine:    0x0d2035,
  roomFill:    0x080f1c,
  roomBorder:  0x0088cc,
  roomGlow:    0x004488,
  bossFill:    0x0e0620,
  bossBorder:  0xaa22ff,
  bossGlow:    0x550099,
  corridor:    0x0077bb,
  corridorGlow:0x003366,
  door:        0x00ccff,

  // UI accents
  accent:      0x9b32d4,
  accentBright:0xc64bff,
  accentDim:   0x4a1870,

  // Text (as CSS strings for Phaser text objects)
  textBright:  '#f0f4ff',
  textNormal:  '#aabbcc',
  textDim:     '#4a5a6a',
  textAccent:  '#c64bff',
  textCyan:    '#00ccff',
  textGold:    '#ddaa44',
  textRed:     '#cc3322',
  textGreen:   '#33cc77',

  // Bars
  goldFill:    0xcc3311,
  goldBg:      0x220a06,
  powerFill:   0x9b32d4,
  powerBg:     0x1a0a2e,
  healthFill:  0x22cc55,
  healthBg:    0x072010,
}

// ── Glow rectangle ────────────────────────────────────────────────────────────
// Draws a rectangle with layered outer glow (pure Graphics, no shader needed).
// g       : Phaser.GameObjects.Graphics
// x, y    : top-left pixel coords
// w, h    : size in pixels
// border  : bright inner border color (number)
// glow    : outer glow color (number)
export function glowRect(g, x, y, w, h, border, glow) {
  // Outermost halo
  g.lineStyle(8, glow, 0.08)
  g.strokeRect(x - 4, y - 4, w + 8, h + 8)

  g.lineStyle(5, glow, 0.18)
  g.strokeRect(x - 2, y - 2, w + 4, h + 4)

  g.lineStyle(3, glow, 0.35)
  g.strokeRect(x - 1, y - 1, w + 2, h + 2)

  // Crisp inner border
  g.lineStyle(1, border, 0.9)
  g.strokeRect(x, y, w, h)
}

// ── Progress bar ──────────────────────────────────────────────────────────────
// Returns { update(fraction) } where fraction is 0..1.
// Renders: background track + filled bar + optional glow on bar.
export function makeBar(scene, x, y, w, h, opts = {}) {
  const {
    bgColor   = PALETTE.panelBg,
    fillColor = PALETTE.goldFill,
    glowColor = null,
    depth     = 10,
  } = opts

  const bg   = scene.add.rectangle(x + w / 2, y + h / 2, w, h, bgColor).setDepth(depth)
  bg.setStrokeStyle(1, PALETTE.panelBorder)

  const fill = scene.add.rectangle(x, y + h / 2, 0, h - 2, fillColor)
    .setOrigin(0, 0.5).setDepth(depth + 1)

  function update(fraction) {
    const clamped = Phaser.Math.Clamp(fraction, 0, 1)
    fill.width = Math.max(0, (w - 2) * clamped)
    fill.x     = x + 1
  }

  update(1)
  return { bg, fill, update }
}

// ── Dark panel ────────────────────────────────────────────────────────────────
// Draws a filled dark card with glowing border.
export function glowPanel(g, x, y, w, h, opts = {}) {
  const {
    fill   = PALETTE.panelBg,
    border = PALETTE.panelBorder,
    glow   = PALETTE.accentDim,
    alpha  = 1,
  } = opts

  g.fillStyle(fill, alpha)
  g.fillRect(x, y, w, h)

  g.lineStyle(3, glow, 0.2)
  g.strokeRect(x - 1, y - 1, w + 2, h + 2)

  g.lineStyle(1, border, 0.8)
  g.strokeRect(x, y, w, h)
}

// ── Pixel icon shapes ─────────────────────────────────────────────────────────
// Simple 1-color pixel-art-style icons for room types, drawn with Graphics.
// cx, cy = center. size = approximate bounding box.
export function drawRoomIcon(g, cx, cy, roomId, color) {
  g.fillStyle(color, 0.85)
  const s = 8 // half-icon size

  switch (roomId) {
    case 'boss_chamber':
      // Skull shape: circle + two dots
      g.fillTriangle(cx, cy - s, cx - s, cy + s, cx + s, cy + s)
      g.fillStyle(PALETTE.void, 1)
      g.fillRect(cx - 4, cy - 1, 3, 3) // left eye
      g.fillRect(cx + 1, cy - 1, 3, 3) // right eye
      break

    case 'starter_barracks':
      // Z Z Z (sleep) — three small lines
      g.fillRect(cx - s, cy - 3, s * 2, 2)
      g.fillRect(cx - s + 3, cy + 1, s * 2 - 3, 2)
      g.fillRect(cx - s, cy + 5, s * 2, 2)
      break

    case 'starter_corridor':
      // Arrow (passage)
      g.fillRect(cx - s, cy - 1, s * 2, 2)
      g.fillTriangle(cx + 2, cy - 4, cx + s, cy, cx + 2, cy + 4)
      break

    case 'starter_guard_post':
      // Cross (four-way)
      g.fillRect(cx - 1, cy - s, 2, s * 2)
      g.fillRect(cx - s, cy - 1, s * 2, 2)
      break

    case 'trap_factory':
      // Gear: square with cross-hatch
      g.fillRect(cx - s, cy - s, s * 2, s * 2)
      g.fillStyle(PALETTE.void, 1)
      g.fillRect(cx - 1, cy - s, 2, s * 2)
      g.fillRect(cx - s, cy - 1, s * 2, 2)
      break

    case 'treasury':
      // Chest outline
      g.fillRect(cx - s, cy - 2, s * 2, s + 2)
      g.fillRect(cx - s, cy - s, s * 2, s - 2)
      g.fillStyle(PALETTE.void, 1)
      g.fillRect(cx - 1, cy - 2, 2, 4)
      break

    default:
      // Generic: filled square
      g.fillRect(cx - s / 2, cy - s / 2, s, s)
  }
}

// ── Ember particle system ─────────────────────────────────────────────────────
// Floating upward pixel sparks for atmospheric backgrounds.
// Returns a cleanup function.
export function spawnEmbers(scene, count = 24, opts = {}) {
  const {
    x = 0, y = 0, w, h,
    colors = [0x9b32d4, 0xc64bff, 0xff6622, 0xffaa44],
    depth  = 1,
  } = opts

  const canvasW = w  ?? scene.uiW ?? scene.scale.width
  const canvasH = h  ?? scene.uiH ?? scene.scale.height
  const embers  = []

  for (let i = 0; i < count; i++) {
    const ex    = x + Math.random() * canvasW
    const ey    = y + Math.random() * canvasH
    const size  = Math.random() < 0.6 ? 1 : 2
    const color = colors[Math.floor(Math.random() * colors.length)]
    const alpha = 0.15 + Math.random() * 0.45

    const dot = scene.add.rectangle(ex, ey, size, size, color, alpha).setDepth(depth)
    const delay = Math.random() * 4000

    scene.tweens.add({
      targets:  dot,
      y:        ey - 40 - Math.random() * 80,
      x:        ex + (Math.random() - 0.5) * 30,
      alpha:    { from: alpha, to: 0 },
      duration: 3000 + Math.random() * 3000,
      delay,
      repeat:   -1,
      repeatDelay: 0,
      onRepeat: () => {
        dot.x     = x + Math.random() * canvasW
        dot.y     = y + canvasH * 0.5 + Math.random() * canvasH * 0.5
        dot.alpha = alpha
      },
    })

    embers.push(dot)
  }

  return () => embers.forEach(e => e.destroy())
}

// ── Crypt theme (UI overhaul, see DESIGN.md → "UI / HUD overhaul (2026-05-01)") ──
// Cool stone grays + blood-red accent + soul-cyan + bone-white ink.
// Distinct from the reverted Dark Codex parchment/gold palette.
export const CRYPT = {
  // Backgrounds
  bgDeep:      0x0a0d12,
  bgStone1:    0x1a1d23,
  bgStone2:    0x242830,
  bgStone3:    0x2f343d,
  bgFloor:     0x3a3a44,
  bgFloor2:    0x44444f,

  // Panels
  panel:       0x14171c,
  panel2:      0x1d2128,
  panelEdgeH:  0x4a5260,   // top/left highlight
  panelEdgeS:  0x06080b,   // bottom/right shadow
  outline:     0x000000,

  // Ink (numbers below are CSS strings for Phaser text style.color)
  ink:         '#d8d2c2',
  inkDim:      '#8a8678',
  inkMute:     '#5a5648',
  inkHex:      0xd8d2c2,
  inkDimHex:   0x8a8678,
  inkMuteHex:  0x5a5648,

  // Accents (numbers + matching CSS strings)
  accent:      0xb03a48,   // blood red
  accent2:     0xd24858,
  accentCss:   '#b03a48',
  accent2Css:  '#d24858',
  soul:        0x6fd8d8,   // soul cyan
  soulCss:     '#6fd8d8',
  gold:        0xe8c34a,
  goldCss:     '#e8c34a',
  green:       0x6fa84a,
  greenCss:    '#6fa84a',
  warn:        0xd8893a,
  warnCss:     '#d8893a',

  // Dungeon-tile colours
  wall:        0x6a6a78,
  wallEdge:    0x2c2e36,
  door:        0x7a5a3a,
}

// Font families. Loaded via the Google Fonts <link> in index.html.
// Both head and body use Press Start 2P for a uniform pixel look — the
// design's VT323 body was abandoned (2026-05-01) per user feedback that
// only the chunky 8-bit pixel font should appear in the new UI.
export const FONT_HEAD = '"Press Start 2P", monospace'
export const FONT_BODY = '"Press Start 2P", monospace'

// ── Pixel diamond icon ────────────────────────────────────────────────────────
// Draws a small rotated-square diamond (the "◆" panel-header ornament). The
// Unicode ◆ glyph isn't part of Press Start 2P's char set so the text-based
// version falls back to a monospace font and looks misaligned next to the
// header label. Drawing it as a primitive keeps it crisp + on-baseline.
//
// g  : Phaser.GameObjects.Graphics
// cx, cy : centre point in pixels
// size   : half-diagonal in pixels (default 4 → 8x8 bounding diamond)
// color  : fill colour (default CRYPT.accent)
export function pixelDiamond(g, cx, cy, size = 4, color = CRYPT.accent) {
  // Pixel-art sprite path — `ui-diamond` is an 18×26 red gem image.
  // Anchored at center on the same scene as `g` and tied to `g`'s
  // lifetime via the destroy event, so callers don't need to track an
  // extra object for cleanup. Falls back to the procedural rhombus when
  // the texture isn't loaded (Boot scene, asset 404, etc).
  const scene = g?.scene
  if (scene?.textures?.exists?.('ui-diamond')) {
    // size=4 was the canonical procedural radius (~9 px tall); the new
    // sprite is 26 px tall, so 0.45 ≈ matches the old footprint and
    // scales linearly for any caller that passes size=3 or size=5.
    const scale = (size / 4) * 0.45
    const img = scene.add.image(cx, cy, 'ui-diamond')
      .setOrigin(0.5).setScale(scale)
      .setDepth((g.depth ?? 0) + 1)
    g.once('destroy', () => { try { img.destroy() } catch {} })
    return
  }
  // Procedural fallback (kept verbatim from the original implementation).
  g.fillStyle(color, 1)
  for (let i = 0; i <= size; i++) {
    const w = 1 + i * 2
    g.fillRect(cx - i, cy - size + i, w, 1)
  }
  for (let i = 0; i < size; i++) {
    const w = 1 + (size - 1 - i) * 2
    g.fillRect(cx - (size - 1 - i), cy + 1 + i, w, 1)
  }
}

// ── Pixel lock icon ───────────────────────────────────────────────────────────
// Draws a simple pixel-art lock — a U-shaped shackle on top of a filled
// body with a small keyhole. Used for locked build-menu slots so the
// "you can't place this yet" state reads instantly.
//
// g     : Phaser.GameObjects.Graphics
// cx, cy: centre of the lock
// scale : px per "lock unit" (default 2 → ~16x18 sprite)
// color : shackle + body fill (default CRYPT.inkDimHex)
export function pixelLock(g, cx, cy, scale = 2, color = 0x8a8678) {
  const s = scale
  // Shackle: two verticals + a horizontal cap, U-shape with mouth at bottom
  g.fillStyle(color, 1)
  g.fillRect(cx - 3 * s, cy - 5 * s, s,         3 * s) // left post
  g.fillRect(cx + 2 * s, cy - 5 * s, s,         3 * s) // right post
  g.fillRect(cx - 3 * s, cy - 5 * s, 6 * s,     s)     // top bar
  // Body — wider rectangle below the shackle
  g.fillRect(cx - 4 * s, cy - 2 * s, 9 * s,     6 * s)
  // Keyhole (dark dot + slit)
  g.fillStyle(0x000000, 1)
  g.fillRect(cx,         cy - 1 * s, s,     s)         // top of keyhole
  g.fillRect(cx - s / 2, cy,         s,     2 * s)     // slit
}

// ── Pixel-bevel panel ─────────────────────────────────────────────────────────
// Draws a hard-edged 2px-bevel panel onto the given Graphics object.
// Top/left edges get the highlight colour, bottom/right get the shadow,
// wrapped in a 2px black outer outline. No gradients — pure pixel chrome.
//
// g       : Phaser.GameObjects.Graphics (already added to scene)
// x, y, w, h : pixel rect (this is the body rect; the outer black outline
//              extends 2px beyond it on every side).
// opts.fill   : body fill colour (default CRYPT.panel)
// opts.edgeH  : top/left highlight colour (default CRYPT.panelEdgeH)
// opts.edgeS  : bottom/right shadow colour (default CRYPT.panelEdgeS)
// opts.inset  : if true, swap highlight↔shadow (recessed look)
// opts.outline: outer outline colour (default black; pass null to skip)
export function pixelPanel(g, x, y, w, h, opts = {}) {
  const {
    fill    = CRYPT.panel,
    edgeH   = CRYPT.panelEdgeH,
    edgeS   = CRYPT.panelEdgeS,
    inset   = false,
    outline = CRYPT.outline,
  } = opts

  // 2px black outer outline
  if (outline !== null) {
    g.fillStyle(outline, 1)
    g.fillRect(x - 2, y - 2, w + 4, h + 4)
  }

  // Body fill
  g.fillStyle(fill, 1)
  g.fillRect(x, y, w, h)

  const top   = inset ? edgeS : edgeH
  const left  = inset ? edgeS : edgeH
  const bot   = inset ? edgeH : edgeS
  const right = inset ? edgeH : edgeS

  // Bevel bands — top/bottom run full width, left/right run between them
  g.fillStyle(top, 1);   g.fillRect(x,         y,         w, 2)
  g.fillStyle(bot, 1);   g.fillRect(x,         y + h - 2, w, 2)
  g.fillStyle(left, 1);  g.fillRect(x,         y + 2,     2, h - 4)
  g.fillStyle(right, 1); g.fillRect(x + w - 2, y + 2,     2, h - 4)
}

// ── Pixel button ──────────────────────────────────────────────────────────────
// Beveled button with hover/active states + click handler.
// Returns { bg, label, hit, setEnabled(bool), setLabel(str), on(event,fn), destroy() }.
//
// scene   : Phaser.Scene
// x, y    : top-left of the button rect
// w, h    : button size
// text    : initial label string
// opts.primary  : primary (accent-filled) variant if true
// opts.danger   : danger variant (dim red bg, accent2 text) if true
// opts.fontSize : label font size px (default 10 for primary, 10 for normal)
// opts.depth    : base depth (default 100)
// opts.onClick  : convenience pointer-up handler (optional, can also use .on('pointerup', fn))
export function pixelButton(scene, x, y, w, h, text, opts = {}) {
  const {
    primary  = false,
    danger   = false,
    fontSize = 10,
    depth    = 100,
    onClick  = null,
  } = opts

  let enabled = true
  let hover   = false
  let pressed = false

  const bg = scene.add.graphics().setDepth(depth)
  const label = scene.add.text(x + w / 2, y + h / 2, text.toUpperCase(), {
    fontFamily: FONT_HEAD,
    fontSize:   `${fontSize}px`,
    color:      primary ? '#ffffff' : danger ? CRYPT.accent2Css : CRYPT.ink,
    align:      'center',
  }).setOrigin(0.5).setDepth(depth + 1)

  const hit = scene.add.zone(x, y, w, h).setOrigin(0).setDepth(depth + 2)
    .setInteractive({ useHandCursor: true })

  function repaint() {
    bg.clear()
    if (!enabled) {
      // Disabled: dim panel, no bevel-flip on press
      pixelPanel(bg, x, y, w, h, {
        fill: CRYPT.panel2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeS,
      })
      label.setAlpha(0.45)
      return
    }
    label.setAlpha(1)
    const fill = primary
      ? (pressed ? 0x7a242e : hover ? 0xc8404f : CRYPT.accent)
      : danger
        ? (pressed ? 0x2a0e0e : hover ? 0x4a1818 : 0x3a1414)
        : (pressed ? CRYPT.bgStone1 : hover ? CRYPT.bgStone2 : CRYPT.panel2)
    pixelPanel(bg, x + (pressed ? 1 : 0), y + (pressed ? 1 : 0), w, h, {
      fill,
      edgeH: primary ? 0xe06474 : CRYPT.panelEdgeH,
      edgeS: primary ? 0x6a1c24 : CRYPT.panelEdgeS,
      inset: pressed,
    })
    label.setPosition(x + w / 2 + (pressed ? 1 : 0), y + h / 2 + (pressed ? 1 : 0))
  }

  hit.on('pointerover', () => {
    hover = true
    if (enabled) {
      repaint()
      const now = Date.now()
      uiSfxHover(scene)
    }
  })
  hit.on('pointerout',  () => { hover = false; pressed = false; if (enabled) repaint() })
  hit.on('pointerdown', () => { pressed = true; if (enabled) repaint() })
  hit.on('pointerup',   (...args) => {
    const wasPressed = pressed
    pressed = false
    if (enabled) repaint()
    if (enabled && wasPressed && hover) {
      uiSfxClick(scene)
      if (onClick) onClick(...args)
    }
  })

  repaint()

  return {
    bg, label, hit,
    setEnabled(v) { enabled = !!v; hit.input.enabled = enabled; repaint() },
    setLabel(s)   { label.setText(s.toUpperCase()) },
    on(ev, fn)    { hit.on(ev, fn); return this },
    destroy()     { bg.destroy(); label.destroy(); hit.destroy() },
  }
}

// ── Pixel bar ─────────────────────────────────────────────────────────────────
// A pixel-bevel HP/progress bar with optional centered label.
// Returns { update(value, max?, label?), destroy() }.
//
// opts.color  : 'red' (default) | 'cyan' | 'gold' | 'green'
// opts.label  : initial centered label string (omit for no label)
// opts.depth  : base depth (default 100)
// opts.fontSize : label font px (default 12)
export function pixelBar(scene, x, y, w, h, value, max = 100, opts = {}) {
  const {
    color    = 'red',
    label    = null,
    depth    = 100,
    fontSize = 9,
  } = opts

  const fillCol = {
    red:   CRYPT.accent,
    cyan:  CRYPT.soul,
    gold:  CRYPT.gold,
    green: CRYPT.green,
  }[color] ?? CRYPT.accent

  const hiCol = {
    red:   CRYPT.accent2,
    cyan:  0xa8eaea,
    gold:  0xf4dd7a,
    green: 0x9bc878,
  }[color] ?? CRYPT.accent2

  const loCol = {
    red:   0x5a1a22,
    cyan:  0x355c5c,
    gold:  0x6f5a1d,
    green: 0x355020,
  }[color] ?? 0x5a1a22

  const g = scene.add.graphics().setDepth(depth)
  const txt = label !== null
    ? scene.add.text(x + w / 2, y + h / 2 + 1, label, {
        fontFamily: FONT_BODY,
        fontSize:   `${fontSize}px`,
        color:      '#ffffff',
        stroke:     '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5).setDepth(depth + 2)
    : null

  let curValue = value
  let curMax   = Math.max(1, max)
  let curLabel = label

  function repaint() {
    g.clear()
    // Black inset track
    g.fillStyle(CRYPT.outline, 1)
    g.fillRect(x - 2, y - 2, w + 4, h + 4)
    g.fillStyle(0x000000, 1)
    g.fillRect(x, y, w, h)
    // Inset shadow ring
    g.fillStyle(CRYPT.panelEdgeS, 1)
    g.fillRect(x, y, w, 2)
    g.fillRect(x, y + h - 2, w, 2)
    g.fillRect(x, y, 2, h)
    g.fillRect(x + w - 2, y, 2, h)

    const frac = Phaser.Math.Clamp(curValue / curMax, 0, 1)
    const fillW = Math.floor((w - 4) * frac)
    if (fillW > 0) {
      // Body
      g.fillStyle(fillCol, 1)
      g.fillRect(x + 2, y + 2, fillW, h - 4)
      // Top highlight stripe
      g.fillStyle(hiCol, 1)
      g.fillRect(x + 2, y + 2, fillW, 2)
      // Bottom shadow stripe
      g.fillStyle(loCol, 1)
      g.fillRect(x + 2, y + h - 5, fillW, 3)
    }
    if (txt) txt.setText(curLabel ?? '')
  }

  repaint()

  return {
    g, txt,
    update(value, max, label) {
      if (value !== undefined) curValue = value
      if (max   !== undefined) curMax   = Math.max(1, max)
      if (label !== undefined) curLabel = label
      repaint()
    },
    destroy() { g.destroy(); txt?.destroy() },
  }
}

// ── Pixel tabs ────────────────────────────────────────────────────────────────
// Horizontal tab strip. Active tab gets accent fill.
// Returns { setActive(idx), on(idx,'click',fn) shortcut via opts.onChange, destroy() }.
//
// scene  : Phaser.Scene
// x, y   : top-left of the strip
// w, h   : strip size; tabs split width equally
// labels : array of strings
// opts.activeIdx : initial active tab (default 0)
// opts.onChange  : (idx, label) => void
// opts.depth     : base depth (default 100)
// opts.fontSize  : label font px (default 9)
export function pixelTabs(scene, x, y, w, h, labels, opts = {}) {
  const {
    activeIdx = 0,
    onChange  = null,
    depth     = 100,
    fontSize  = 9,
  } = opts

  const n = labels.length
  const tabW = Math.floor(w / n)
  let active = activeIdx
  const hovers = labels.map(() => false)

  const bg = scene.add.graphics().setDepth(depth)
  const texts = labels.map((l, i) =>
    scene.add.text(x + tabW * i + tabW / 2, y + h / 2, l.toUpperCase(), {
      fontFamily: FONT_HEAD,
      fontSize:   `${fontSize}px`,
      color:      i === active ? '#ffffff' : CRYPT.inkDim,
    }).setOrigin(0.5).setDepth(depth + 1))
  const zones = labels.map((_, i) =>
    scene.add.zone(x + tabW * i, y, tabW, h).setOrigin(0).setDepth(depth + 2)
      .setInteractive({ useHandCursor: true }))

  function repaint() {
    bg.clear()
    bg.fillStyle(CRYPT.outline, 1)
    bg.fillRect(x - 2, y - 2, w + 4, h + 4)
    for (let i = 0; i < n; i++) {
      const isActive = i === active
      const isHover  = hovers[i]
      const tx = x + tabW * i
      const fill = isActive
        ? CRYPT.accent
        : isHover ? CRYPT.bgStone2 : CRYPT.panel2
      bg.fillStyle(fill, 1)
      bg.fillRect(tx, y, tabW, h)
      if (isActive) {
        bg.fillStyle(0xc8404f, 1)
        bg.fillRect(tx, y, tabW, 2)
        bg.fillStyle(0x6a1c24, 1)
        bg.fillRect(tx, y + h - 2, tabW, 2)
      }
      // separator
      if (i < n - 1) {
        bg.fillStyle(CRYPT.outline, 1)
        bg.fillRect(tx + tabW - 1, y, 2, h)
      }
      texts[i].setColor(isActive ? '#ffffff' : isHover ? CRYPT.ink : CRYPT.inkDim)
    }
  }

  zones.forEach((z, i) => {
    z.on('pointerover', () => { hovers[i] = true;  repaint(); uiSfxHover(scene) })
    z.on('pointerout',  () => { hovers[i] = false; repaint() })
    z.on('pointerup',   () => {
      if (active !== i) {
        active = i
        repaint()
        uiSfxClick(scene)
        if (onChange) onChange(i, labels[i])
      }
    })
  })

  repaint()

  return {
    bg, texts, zones,
    setActive(i) {
      if (i >= 0 && i < n && i !== active) {
        active = i
        repaint()
      }
    },
    getActive() { return active },
    destroy() {
      bg.destroy()
      texts.forEach(t => t.destroy())
      zones.forEach(z => z.destroy())
    },
  }
}

// ── Toast notification ────────────────────────────────────────────────────────
// Shows a brief dismissing message near the top of the screen.
// Works from any scene that has called applyUiCamera (scene.uiW is set).
//
// type: 'error' (default amber ⚠) | 'info' (blue) | 'success' (green ✓)
// duration: ms the toast stays fully visible before fading (default 2500)
//
// Calling showToast a second time while one is visible immediately replaces it.
// State is stored on the scene as scene._toast so each scene manages its own.
export function showToast(scene, message, opts = {}) {
  const {
    type     = 'error',
    duration = 2500,
  } = opts

  // Dismiss any existing toast on this scene immediately.
  if (scene._toast) {
    scene._toast.timer?.remove(false)
    for (const o of scene._toast.objs ?? []) o?.destroy?.()
    scene._toast = null
  }

  // Coordinates are in uiW space (logical pixels set by applyUiCamera).
  // applyUiCamera sets zoom=sf and compensates scroll so that world(0,0)
  // maps to screen(0,0) and screenX = worldX * sf.  This makes uiW-based
  // layout correct at every window size.
  //
  // DO NOT use setScrollFactor(0) here.  In a zoomed scene, scrollFactor=0
  // bypasses the scroll *compensation* that applyUiCamera relies on while
  // the zoom-around-viewport-centre still applies.  At sf>1 that pushes
  // y=14 to screenY = 14*sf + (sh/2)*(1−sf) which is *negative* (off the
  // top of the window) at full-screen sizes.
  const W  = scene.uiW ?? scene.scale?.width ?? 1280
  const tw = Math.min(W - 48, 520)
  const th = 40
  const tx = (W - tw) / 2
  const ty = 14

  const scheme = type === 'info'
    ? { fill: 0x04101a, border: 0x3388dd, glow: 0x1155aa, text: '#88ccff', icon: '●' }
    : type === 'success'
    ? { fill: 0x041a08, border: 0x33bb55, glow: 0x117733, text: '#88ffaa', icon: '✓' }
    : /* error */ { fill: 0x1a0804, border: 0xee8833, glow: 0xaa4400, text: '#ffd090', icon: '⚠' }

  const bg  = scene.add.graphics().setDepth(500)
  glowPanel(bg, tx, ty, tw, th, { fill: scheme.fill, border: scheme.border, glow: scheme.glow })

  const txt = scene.add.text(tx + tw / 2, ty + th / 2,
    `${scheme.icon}   ${message}`, {
      fontSize: '13px', color: scheme.text,
      fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(501)

  const objs  = [bg, txt]
  const timer = scene.time.delayedCall(duration, () => {
    scene.tweens.add({
      targets: objs, alpha: 0, duration: 400,
      onComplete: () => {
        for (const o of objs) o?.destroy?.()
        if (scene._toast?.objs === objs) scene._toast = null
      },
    })
  })

  scene._toast = { objs, timer }
}

// ── UI camera normaliser ───────────────────────────────────────────────────────
// Scale.RESIZE gives a canvas that matches the physical window so there is no
// CSS upscaling and text is always sharp.  We zoom the scene camera so a
// fixed-size unit (designH=720 of vertical space) maps to the canvas height,
// then return logical W/H that represent the actual canvas size in those
// units.  Scenes use the returned W/H for layout exactly as they used
// scale.width/height before — UI elements anchored to edges still land at
// the canvas edges, fonts at e.g. 12px stay at the same physical size as
// they were under FIT, and on wider-than-16:9 windows the playfield simply
// shows more horizontal space rather than being letterboxed.
export function applyUiCamera(scene, designW = 1280, designH = 720) {
  const sw  = scene.scale.width
  const sh  = scene.scale.height
  // Defensive: if the scale manager hasn't laid out yet (sw/sh of 0 or 1
  // happens during scene transitions and in throttled tabs), bail out
  // and let the next-tick re-apply or the resize event finish the job.
  // Without this guard we'd compute zoom = 1/1280 and the scene renders
  // into a 1-pixel viewport — invisible but technically still "rendered".
  if (sw < 32 || sh < 32) {
    // Set sane fallback ui values so dependent code (DOM positioning etc.)
    // doesn't get NaN. The next-tick re-apply will overwrite these once
    // the canvas size settles.
    scene.uiW  = designW
    scene.uiH  = designH
    scene.uiSf = 1
    return { width: designW, height: designH }
  }
  const sf  = Math.min(sw / designW, sh / designH)
  // Phaser's camera zoom pivots on the viewport CENTER (origin 0.5, 0.5), so
  // scroll (0,0) at zoom>1 leaves the world origin off-canvas to the left.
  // Compensate by scrolling so world (0,0) lands on canvas (0,0): the visible
  // world then spans 0..(sw/sf) in x, 0..(sh/sf) in y, which is what uiW/uiH
  // describe.
  // Reset viewport to the full canvas — some scenes (e.g. MainMenu) call
  // setViewport on their own camera, and although cameras are per-scene,
  // having this be explicit hedges against any future shared-camera path.
  scene.cameras.main.setViewport(0, 0, sw, sh)
  scene.cameras.main.setZoom(sf)
  scene.cameras.main.setScroll(
    (sw / 2) * (1 / sf - 1),
    (sh / 2) * (1 / sf - 1),
  )
  scene.uiW  = sw / sf
  scene.uiH  = sh / sf
  scene.uiSf = sf
  return { width: scene.uiW, height: scene.uiH }
}
