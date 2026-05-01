// Shared visual primitives used across all scenes.
// All drawing functions operate on caller-supplied Graphics objects
// so scenes retain full control over depth and camera assignment.

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
  essenceFill: 0xcc3311,
  essenceBg:   0x220a06,
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
    fillColor = PALETTE.essenceFill,
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
