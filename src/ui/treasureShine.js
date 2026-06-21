// treasureShine — the shared "shine" glint used on every chest (treasure, key,
// cursed) and scattered across the Treasury floor. A small twinkling 4-point
// star (core dot + cross) that flashes on a per-seed stagger, so a field of them
// sparkles asynchronously. Extracted so chests and the room use the IDENTICAL
// look. Draws into a caller-supplied Graphics (cleared/redrawn each frame).
//
// `t` is elapsed seconds; `seed` desyncs each instance's twinkle phase.

const SHINE_COLOR = 0xfffdf0   // near-white warm glint (matches the old hoard glint)

export function drawTwinkle(g, x, y, t, seed = 0, color = SHINE_COLOR) {
  // Each point is bright only ~20% of its cycle → a sparse, twinkling field.
  const tw = (Math.sin(t * 2.1 + seed * 1.3) + 1) / 2
  if (tw < 0.8) return
  const k = (tw - 0.8) / 0.2
  const r = 3 * k + 1
  g.fillStyle(color, 0.9 * k)
  g.fillCircle(x, y, 1.1)                                  // circle-ok: shine core dot
  g.lineStyle(1, color, 0.9 * k)
  g.lineBetween(x - r, y, x + r, y)
  g.lineBetween(x, y - r, x, y + r)
}
