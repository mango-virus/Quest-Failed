// Carve the enclosed passage opening out of an OPEN door skin's RGBA pixel
// buffer, in place. Used to build the "frame-only" over-entity copy of a door
// skin so a character walking out always shows OVER the dark passage and only
// UNDER the lit frame — emerging from under the door frame, whatever shape the
// opening is.
//
// Naive "make every black pixel transparent" is too blunt: a skin's dark sky
// behind the arch, its corners, and its mortar detail lines are the SAME black
// as the passage, so keying all of them punches see-through holes in the frame
// and at room seams. Instead we FLOOD-FILL the connected near-black region the
// hero walks through, seeded from the lower-centre (where the doorway always
// is) and crossing ONLY near-black opaque pixels. The lit stone frame and the
// already-transparent margins both BOUND the flood, so the passage is carved
// while the dark sky, corners, and detail lines (all separated from the passage
// by lit stone) are preserved.
//
// `data` is a Uint8ClampedArray/Uint8Array of RGBA bytes (canvas ImageData.data
// or a sharp raw buffer — same layout). Returns the number of pixels carved
// (0 = nothing matched → caller can treat the copy as unchanged).
export function carveDoorOpening(data, w, h, threshold = 24) {
  if (!data || !(w > 0) || !(h > 0)) return 0
  const N = w * h
  const isDarkOpaque = (p) => {
    const i = p * 4
    return data[i + 3] > 0 && data[i] <= threshold && data[i + 1] <= threshold && data[i + 2] <= threshold
  }
  // Border guard: the door image is authored face-on with the arch/sky/seam at
  // the TOP and the SIDES, and the room threshold/floor at the BOTTOM. Never
  // carve into the top/left/right margin, so the outermost frame ring always
  // stays opaque — that's the edge that meets a room seam / the void, and a
  // hole there reads as see-through. The opening is interior, so it's
  // unaffected; the bottom (floor) edge is left open since the passage meets
  // the floor there and there's no seam below.
  const mx = Math.max(2, Math.round(w * 0.03))
  const my = Math.max(2, Math.round(h * 0.03))
  const inZone = (x, y) => x >= mx && x <= w - 1 - mx && y >= my  // bottom edge allowed
  const visited = new Uint8Array(N)
  const stack = []
  // Seed from the lower-centre band: the passage base is reliably here (the
  // very bottom is usually transparent, the opening sits just above it), and
  // staying low avoids seeding upper-centre detail (keystone runes, etc.).
  const x0 = Math.floor(w * 0.38), x1 = Math.ceil(w * 0.62)
  const y0 = Math.floor(h * 0.45), y1 = Math.ceil(h * 0.95)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * w + x
      if (!visited[p] && inZone(x, y) && isDarkOpaque(p)) { visited[p] = 1; stack.push(p) }
    }
  }
  // Flood through 4-connected near-black opaque neighbours inside the carve zone
  // (lit frame, transparent margins, and the border guard all block the spread).
  const tryN = (pn, nx, ny) => {
    if (!visited[pn] && inZone(nx, ny) && isDarkOpaque(pn)) { visited[pn] = 1; stack.push(pn) }
  }
  while (stack.length) {
    const p = stack.pop()
    const x = p % w, y = (p - x) / w
    if (x > 0)     tryN(p - 1, x - 1, y)
    if (x < w - 1) tryN(p + 1, x + 1, y)
    if (y > 0)     tryN(p - w, x, y - 1)
    if (y < h - 1) tryN(p + w, x, y + 1)
  }
  let carved = 0
  for (let p = 0; p < N; p++) if (visited[p]) { data[p * 4 + 3] = 0; carved++ }
  return carved
}

// Fill the TRANSPARENT TOP MARGIN of a door skin (the empty space above the
// frame/arch — these skins are authored face-on with the arch at the top) with
// an opaque occluder, IN PLACE. Used to build the over-entity copy so a character
// walking through is hidden ABOVE the gate (its head no longer pokes out into the
// transparent sky). Per column, fills from the top edge DOWN to the first opaque
// pixel only — so the lit frame and the passage below it are untouched (the
// passage is carved separately, AFTER this, for open doors).
//
// The fill uses a single representative STONE tone sampled from the skin's own
// frame (the mid-luminance opaque pixels — excluding dark outlines/sky and bright
// highlights), so it reads as the wall/frame continuing up rather than a flat
// black patch or a dark streak off the frame's shadowed top edge.
//
// `data` is RGBA bytes (canvas ImageData.data layout).
export function fillDoorTopOccluder(data, w, h) {
  if (!data || !(w > 0) || !(h > 0)) return 0
  // --- Pass 1: representative stone tone = average of mid-luminance opaque pixels.
  // Skip near-black (outlines, shadow, the dark passage/sky) and near-white
  // (specular highlights) so the result is the stone BODY colour, not its edges.
  let sr = 0, sg = 0, sb = 0, sn = 0
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    if (data[i + 3] < 200) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    if (lum < 45 || lum > 225) continue
    sr += r; sg += g; sb += b; sn++
  }
  // Fall back to a neutral dark stone if the skin had no mid-tone body (rare).
  const fr = sn ? (sr / sn) | 0 : 60
  const fg = sn ? (sg / sn) | 0 : 56
  const fb = sn ? (sb / sn) | 0 : 64

  // --- Pass 2: fill the transparent SKY above each column's frame with it.
  // Only fill columns whose frame starts reasonably high — guard against a
  // lintel-less passage column (transparent until the floor) so we never block
  // a doorway opening. The carve handles the actual passage; this is the SKY.
  const maxTop = Math.round(h * 0.6)
  let filled = 0
  for (let x = 0; x < w; x++) {
    let top = -1
    for (let y = 0; y < h; y++) { if (data[(y * w + x) * 4 + 3] > 16) { top = y; break } }
    if (top <= 0 || top > maxTop) continue   // opaque from the top, or no high frame → skip
    for (let y = 0; y < top; y++) {
      const i = (y * w + x) * 4
      data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = 255; filled++
    }
  }
  return filled
}
