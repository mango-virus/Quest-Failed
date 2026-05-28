// Shared speech-bubble factory for adventurer chat, death floats, and
// the streamer slot animation. Builds a pixel-art square bubble with
// a 2-pixel blocky tail pointing down at the speaker, wrapped Press
// Start 2P text inside (140 px max width, capped at 3 lines with
// ellipsis truncation), and a scale-pop entrance tween.
//
// All three callers (ChatBubbles, DayPhase._showLastWords,
// ClassAbilitySystem._fireSlotAnimation) share one visual language —
// kind = 'chat' | 'death' | 'streamer' picks the accent colour and
// some lifecycle differences (death uses a slower fade-up, streamer
// supports an eyebrow line).
//
// Container convention (matches existing ChatBubbles positioning):
//   container.x / container.y = the TAIL TIP — i.e. the world-space
//   point the bubble's tail points at. The bubble draws upward from
//   that point so callers can just set position = (advX, advY - 30)
//   the way the old single-line render did.

import { EventBus } from '../systems/EventBus.js'

const FONT_FAMILY = "'Press Start 2P', monospace"
const FONT_SIZE   = 7                  // shrunk 8 → 7 (2026-05-27)
const EYEBROW_FONT_SIZE = 5
const LINE_SPACING = 3
const MAX_WIDTH   = 120                // shrunk 140 → 120 to match smaller font
const MIN_WIDTH   = 40
const PAD_X       = 5                  // tighter horizontal padding
const PAD_Y       = 4                  // tighter vertical padding
const BORDER_W    = 2
const CORNER_R    = 4                  // rounded-rect radius — soft comic-book corners
const TAIL_TOP_W  = 5                  // wide tail base (smoothly continues the rounded bottom)
const TAIL_H      = 5                  // tip y = 0 (container origin); base y = -TAIL_H
const LINE_CAP    = 3                  // hard cap (audit shortens messages)
const ELLIPSIS    = '…'

// Per-kind visual treatment. All share the dark navy bg; the border
// colour, text colour, and lifecycle differ.
const KIND_STYLE = {
  chat: {
    borderColor: 0x7a8898,
    bgColor:     0x0e1424,
    textColor:   '#e0e6f0',
    popInMs:     150,
    fadeOutMs:   200,
  },
  death: {
    borderColor: 0xcc4444,
    bgColor:     0x100808,
    textColor:   '#ffd4d4',
    popInMs:     220,
    fadeOutMs:   500,
  },
  streamer: {
    borderColor: 0x9146ff,     // twitch purple
    bgColor:     0x100a1c,
    textColor:   '#ffffff',
    popInMs:     150,
    fadeOutMs:   400,
  },
  // Solo Leveling — Sung Jinwoo's bubbles. Inky dark bubble + a white→blue
  // vertical gradient on the text with a soft blue glow, echoing the
  // "ARISE" shadow-monarch typography.
  shadow: {
    borderColor: 0x2e6bff,
    bgColor:     0x070b16,
    textColor:   '#bfe0ff',    // flat fallback if gradient unsupported
    gradient:    [[0, '#ffffff'], [0.4, '#cfe9ff'], [0.75, '#5fa8ff'], [1, '#1e63ff']],
    glow:        { color: '#3a8bff', blur: 6 },
    stroke:      { color: '#0a224f', thickness: 1 },
    popInMs:     170,
    fadeOutMs:   280,
  },
}

/**
 * Create a speech bubble in the given scene at the given world position.
 *
 * @param {Phaser.Scene} scene
 * @param {object} opts
 * @param {number} opts.x         World X (tail tip).
 * @param {number} opts.y         World Y (tail tip).
 * @param {string} opts.text      Bubble body.
 * @param {string} [opts.kind]    'chat' | 'death' | 'streamer'.
 * @param {string} [opts.eyebrow] Tiny uppercase line above body
 *                                ('streamer' kind only — ignored
 *                                otherwise).
 * @param {number} [opts.lifeMs]  Auto-destroy after this many ms
 *                                (omit for manual lifecycle — e.g.
 *                                slot animation that updates text
 *                                in place).
 * @param {number} [opts.depth]   Phaser depth (default 11).
 *
 * Returns a Container with extra members:
 *   container.setBubbleText(newText)  — swap text in place (used by
 *                                       slot animation). Re-measures
 *                                       and reflows.
 *   container.killNow()                — destroy immediately.
 */
export function createBubble(scene, opts = {}) {
  const kind  = opts.kind ?? 'chat'
  const style = KIND_STYLE[kind] ?? KIND_STYLE.chat

  const container = scene.add.container(opts.x ?? 0, opts.y ?? 0)
    .setDepth(opts.depth ?? 11)

  // Build text first so we can measure for the bubble background.
  const text = _buildWrappedText(scene, opts.text ?? '', style)
  let eyebrow = null
  if (opts.eyebrow && kind === 'streamer') {
    eyebrow = scene.add.text(0, 0, String(opts.eyebrow).toUpperCase(), {
      fontSize:   `${EYEBROW_FONT_SIZE}px`,
      color:      style.textColor,
      fontFamily: FONT_FAMILY,
    }).setOrigin(0.5, 0).setAlpha(0.75)
  }

  // Measure
  const textW    = Math.ceil(text.width)
  const textH    = Math.ceil(text.height)
  const ebW      = eyebrow ? Math.ceil(eyebrow.width)  : 0
  const ebH      = eyebrow ? Math.ceil(eyebrow.height) : 0
  const innerW   = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.max(textW, ebW)))
  const innerH   = textH + (eyebrow ? ebH + 3 : 0)
  const bubbleW  = innerW + PAD_X * 2
  const bubbleH  = innerH + PAD_Y * 2

  // Bubble graphics — drawn so the tail tip is at container origin
  // (0, 0). Bubble bottom = (0, -TAIL_H); bubble top = (0, -TAIL_H -
  // bubbleH).
  const g = scene.add.graphics()
  _drawBubble(g, bubbleW, bubbleH, style.bgColor, style.borderColor)
  container.add(g)

  // Position text inside bubble. Origin (0.5, 0.5) → centered around
  // bubble centre point (0, -TAIL_H - bubbleH/2). For streamer with
  // an eyebrow, anchor text below the eyebrow.
  const bubbleCenterY = -TAIL_H - bubbleH / 2
  if (eyebrow) {
    const top = -TAIL_H - bubbleH + PAD_Y
    eyebrow.setPosition(0, top)
    text.setOrigin(0.5, 0).setPosition(0, top + ebH + 3)
    container.add(eyebrow)
  } else {
    text.setOrigin(0.5, 0.5).setPosition(0, bubbleCenterY)
  }
  container.add(text)

  // Stash dimensions for any future repositioning (e.g. anti-overlap
  // stacking we may add later).
  container._bubbleW = bubbleW
  container._bubbleH = bubbleH
  container._tailH   = TAIL_H

  // Scale-pop entrance — alpha 0 → 1 + scale 0.85 → 1 over popInMs.
  // For 'chat' and 'streamer' this feels peppy. For 'death' the
  // longer popInMs (220ms) gives the more somber rise.
  container.setScale(0.85).setAlpha(0)
  scene.tweens.add({
    targets:  container,
    scale:    1,
    alpha:    1,
    duration: style.popInMs,
    ease:     kind === 'death' ? 'Sine.out' : 'Back.out',
  })

  // Auto-lifecycle (optional). Caller can omit to manage destruction
  // manually (slot animation does this so it can swap text on a
  // cycle then trigger its own fade).
  if (opts.lifeMs != null && opts.lifeMs > 0) {
    container._lifeTimer = scene.time.delayedCall(opts.lifeMs, () => {
      _fadeOutAndDestroy(scene, container, style.fadeOutMs)
    })
  }

  // Helpers
  container.setBubbleText = (newText) => {
    text.setText(_fitTextToCap(scene, newText, text.style))
  }
  container.killNow = () => {
    if (container._lifeTimer?.remove) container._lifeTimer.remove(false)
    container.destroy()
  }
  container.fadeOut = (ms = style.fadeOutMs) => {
    if (container._lifeTimer?.remove) container._lifeTimer.remove(false)
    _fadeOutAndDestroy(scene, container, ms)
  }

  return container
}

// ── internals ─────────────────────────────────────────────────────

function _drawBubble(g, w, h, bg, border) {
  // Rounded comic-book bubble — soft corners + a slim solid
  // triangular tail pointing at the speaker. Container origin (0, 0)
  // is the tail tip; bubble extends upward, occupying y = -TAIL_H - h
  // to y = -TAIL_H.
  const x  = -w / 2
  const yT = -TAIL_H - h     // top edge of bubble
  const yB = -TAIL_H         // bottom edge of bubble (= base of tail)

  // Bubble body — fill + stroke a rounded rectangle.
  g.fillStyle(bg, 1)
  g.fillRoundedRect(x, yT, w, h, CORNER_R)
  g.lineStyle(BORDER_W, border, 1)
  g.strokeRoundedRect(x, yT, w, h, CORNER_R)

  // Tail — solid triangle in the border colour. Painted AFTER the
  // bubble so it visually attaches to the bubble's stroked bottom
  // edge (same colour → seamless). Reads as a small downward drip.
  g.fillStyle(border, 1)
  g.fillTriangle(
    -TAIL_TOP_W / 2, yB,        // base-left
     TAIL_TOP_W / 2, yB,        // base-right
     0,              0,         // tip (container origin)
  )
}

function _buildWrappedText(scene, content, style) {
  const opts = {
    fontSize:    `${FONT_SIZE}px`,
    color:       style.textColor,
    fontFamily:  FONT_FAMILY,
    wordWrap:    { width: MAX_WIDTH, useAdvancedWrap: true },
    lineSpacing: LINE_SPACING,
    align:       'center',
  }
  const t = scene.add.text(0, 0, _fitTextToCap(scene, content, opts), opts)
  // Optional glow + stroke (Jinwoo's 'shadow' kind). Set before the gradient
  // so the final fill re-render carries them.
  if (style.stroke) t.setStroke(style.stroke.color, style.stroke.thickness)
  if (style.glow)   t.setShadow(0, 0, style.glow.color, style.glow.blur, false, true)
  // Optional vertical gradient fill — a CanvasGradient spanning the text's
  // measured height (top → bottom colour stops). The text is already laid out
  // at this point so t.height is valid; chat bubbles never reflow in place so
  // the canvas-space gradient stays aligned for the bubble's whole life.
  if (style.gradient && t.context && typeof t.context.createLinearGradient === 'function') {
    const h = Math.max(1, t.height)
    const grad = t.context.createLinearGradient(0, 0, 0, h)
    for (const [stop, col] of style.gradient) grad.addColorStop(stop, col)
    t.setFill(grad)
  }
  return t
}

// Returns content trimmed to at most LINE_CAP wrapped lines at the
// configured MAX_WIDTH. If the source text fits, returned unchanged.
// If it overflows we trim and append ellipsis — defensive fallback;
// the data audit should keep this code from firing in normal play.
function _fitTextToCap(scene, content, opts) {
  if (!content) return ''
  // Probe with a throwaway Text to count wrapped lines.
  const probe = scene.add.text(0, 0, content, opts)
  const lines = probe.getWrappedText().length
  if (lines <= LINE_CAP) {
    probe.destroy()
    return content
  }
  // Binary search the longest prefix that still fits (with ellipsis).
  let lo = 0
  let hi = content.length
  let best = ELLIPSIS
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const cand = content.slice(0, mid).trimEnd() + ELLIPSIS
    probe.setText(cand)
    if (probe.getWrappedText().length <= LINE_CAP) {
      best = cand
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  probe.destroy()
  return best
}

function _fadeOutAndDestroy(scene, container, ms) {
  if (!container || !container.active) return
  scene.tweens.add({
    targets:  container,
    alpha:    0,
    scale:    0.9,
    duration: ms,
    ease:     'Sine.in',
    onComplete: () => container.destroy(),
  })
}

// Re-export EventBus consumer if any future bubble flavour wants to
// hook lifecycle events. Currently unused; placeholder for symmetry
// with the rest of the ui/ modules.
export const BUBBLE_EVENTS = { EMITTED: 'CHAT_BUBBLE_EMITTED' }
export { EventBus }
