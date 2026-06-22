// A door skin's frame edge is anti-aliased — its top ramps over a few rows from
// transparent to solid (alpha ~40→110→185→233→251). The occluder fill + sky mask
// must cover that whole ramp down to the first SOLIDLY-opaque pixel, not stop at
// the first faint one, or the semi-transparent ramp rows stay see-through (a 1px
// seam at the top of the gate / where rooms connect). This is that "solid" cutoff.
const DOOR_FRAME_SOLID_ALPHA = 250

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
// Flood-fill the enclosed near-black passage region and return its mask
// (Uint8Array, 1 = passage pixel). Shared by carveDoorOpening (→ alpha 0) and
// shadePassageInterior (→ recolour), so the two always operate on the EXACT
// same region. Seeds from the lower-centre band and crosses only near-black
// opaque pixels inside a border guard — see the file header for the rationale.
function floodPassageRegion(data, w, h, threshold) {
  const N = w * h
  const isDarkOpaque = (p) => {
    const i = p * 4
    return data[i + 3] > 0 && data[i] <= threshold && data[i + 1] <= threshold && data[i + 2] <= threshold
  }
  // Border guard: the door image is authored face-on with the arch/sky/seam at
  // the TOP and the SIDES, and the room threshold/floor at the BOTTOM. Never
  // cross into the top/left/right margin, so the outermost frame ring always
  // stays opaque — that's the edge that meets a room seam / the void, and a
  // hole there reads as see-through. The opening is interior, so it's
  // unaffected; the bottom (floor) edge is left open since the passage meets
  // the floor there and there's no seam below.
  const mx = Math.max(2, Math.round(w * 0.03))
  const inZone = (x, y) => x >= mx && x <= w - 1 - mx && y >= Math.max(2, Math.round(h * 0.03))
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
  return visited
}

export function carveDoorOpening(data, w, h, threshold = 24) {
  if (!data || !(w > 0) || !(h > 0)) return 0
  const visited = floodPassageRegion(data, w, h, threshold)
  let carved = 0
  for (let p = 0; p < w * h; p++) if (visited[p]) { data[p * 4 + 3] = 0; carved++ }
  return carved
}

const _lerp = (a, b, t) => a + (b - a) * t

// Repaint the passage interior of an OPEN door skin (the LOW, under-entity copy)
// so the opening reads as a RECESSED, softly-lit threshold instead of a flat
// black cutout — the hard pure-black opening was visually jarring against the
// warm lit stone. Stays top-down-flat (no implied tunnel / parallax); just three
// understated cues, all confined to the flooded passage region:
//   (A) vertical gradient — deep cool shadow at the back (under the lintel, low y)
//       easing a touch lighter toward the room-side threshold (high y).
//   (B) soft inner BEVEL — pixels near the stone frame lift toward a lip tone so
//       the lit-stone→passage transition ramps instead of hard-cutting; weighted
//       so the threshold lip catches more than the dark top, reading as depth.
//   (C) warm THRESHOLD spill — a subtle warm pool at the bottom edge (room
//       torchlight bleeding in). Drawn into the LOW copy, so the room's
//       colorAdjust.walls then tints it cohesively with the surrounding wall.
// In place on RGBA `data`. Returns the pixel count treated (0 = no passage found
// → caller keeps the raw skin). `threshold` matches carveDoorOpening.
export function shadePassageInterior(data, w, h, opts = {}) {
  if (!data || !(w > 0) || !(h > 0)) return 0
  const threshold = opts.threshold ?? 24
  const visited = floodPassageRegion(data, w, h, threshold)
  const N = w * h
  // For the SUNLIGHT entrance, also fill interior HOLES — dither/noise islands
  // inside the opening that the near-black flood skipped. Against bright daylight
  // those show as dark DOTS; we flood NON-passage pixels in from the image border
  // and treat whatever it can't reach as passage, closing the islands. Dark doors
  // don't need it (the islands vanish into shadow) → `paint` stays === `visited`
  // there, so they bake byte-identical.
  let paint = visited
  if (opts.sunlight) {
    // (1) fill fully-enclosed holes (border-flood the non-passage; whatever it
    // can't reach is an interior hole), then (2) a morphological CLOSE to also
    // swallow DITHERED speckle that forms thin non-passage paths to the edge (the
    // hole-fill's connectivity misses those). Together the bright daylight stays
    // CLEAN — no dark dots. Sunlight-only → dark doors bake byte-identical.
    const outside = new Uint8Array(N), st = []
    const seed = (p) => { if (!visited[p] && !outside[p]) { outside[p] = 1; st.push(p) } }
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
    while (st.length) { const p = st.pop(), x = p % w, y = (p - x) / w
      if (x > 0) seed(p - 1); if (x < w - 1) seed(p + 1); if (y > 0) seed(p - w); if (y < h - 1) seed(p + w) }
    const filled = new Uint8Array(N)
    for (let p = 0; p < N; p++) filled[p] = outside[p] ? 0 : 1
    // per-row SPAN fill: fill solid between the passage's left/right edge on each
    // row. Guarantees ZERO interior dots (dither/noise) under the bright daylight —
    // the opening is one contiguous span per row (no mullion), so this fills only
    // the opening, never the frame. (More robust here than a morphological close.)
    paint = new Uint8Array(N)
    for (let y = 0; y < h; y++) {
      const row = y * w
      let lo = -1, hi = -1
      for (let x = 0; x < w; x++) { if (filled[row + x]) { if (lo < 0) lo = x; hi = x } }
      if (lo >= 0) for (let x = lo; x <= hi; x++) paint[row + x] = 1
    }
  }
  // Vertical extent of the region → the gradient axis.
  let minY = h, maxY = -1, count = 0
  for (let p = 0; p < N; p++) { if (!paint[p]) continue; const y = (p - (p % w)) / w; if (y < minY) minY = y; if (y > maxY) maxY = y; count++ }
  if (!count || maxY <= minY) return 0
  // Distance-from-frame (in px) via multi-source BFS seeded on the region's
  // boundary pixels — drives the bevel lip (B).
  const dist = new Int16Array(N).fill(-1)
  const q = []
  for (let p = 0; p < N; p++) {
    if (!paint[p]) continue
    const x = p % w, y = (p - x) / w
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
      !paint[p - 1] || !paint[p + 1] || !paint[p - w] || !paint[p + w]
    if (edge) { dist[p] = 0; q.push(p) }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi], x = p % w, y = (p - x) / w, nd = dist[p] + 1
    const step = (pn) => { if (paint[pn] && dist[pn] < 0) { dist[pn] = nd; q.push(pn) } }
    if (x > 0) step(p - 1); if (x < w - 1) step(p + 1); if (y > 0) step(p - w); if (y < h - 1) step(p + w)
  }
  // Palette (matches DungeonRenderer's DOOR_PASSAGE_* / arch tones). SUN = warm
  // daylight, used only by the entrance's `sunlight` mode.
  const DARK = [18, 24, 38], LIGHT = [31, 41, 64], LIP = [44, 55, 74], WARM = [74, 50, 30], SUN = [205, 176, 122]
  const aoPx = Math.max(2, Math.round(Math.min(w, h) * 0.05))
  const span = maxY - minY
  // (A) When a FLOOR swatch is supplied, the room's floor continues INTO the
  // opening near the threshold (bottom, high t) and recedes into the shadow
  // toward the back (top) — "the floor goes on under the wall". The swatch is a
  // single floor tile (already scaled to the door's tile size); we tile it,
  // dimmed (it's in shadow), revealed only over the bottom "reach". Without a
  // swatch we fall back to the plain cool gradient.
  const floor = (opts.floor && opts.floor.data && opts.floor.w > 0 && opts.floor.h > 0) ? opts.floor : null
  // sunlight (opt-in, used ONLY for the grand ENTRANCE — it opens to the outside):
  // instead of receding into dark interior shadow, the floor at the sill flows UP
  // into warm, bright DAYLIGHT at the back. Default OFF → every other door keeps
  // its dark passage.
  const sunlight = !!opts.sunlight
  let minX = w
  if (floor) for (let p = 0; p < N; p++) { if (paint[p]) { const x = p % w; if (x < minX) minX = x } }
  for (let p = 0; p < N; p++) {
    if (!paint[p]) continue
    const x = p % w, y = (p - x) / w
    const t = Math.max(0, Math.min(1, (y - minY) / span))
    const tt = t * t                              // keep most of it dark; lighten toward the sill
    let r, g, b
    if (floor) {
      // Tile the swatch. With floorPhaseX/Y given (entrance), phase-align to the
      // WORLD tile grid so the doorway slab seams line up with the room floor
      // below; otherwise tile from the passage's own edge (approved doors).
      const fx = opts.floorPhaseX != null
        ? (((x + opts.floorPhaseX) % floor.w) + floor.w) % floor.w
        : (((x - minX) % floor.w) + floor.w) % floor.w
      const fy = opts.floorPhaseY != null
        ? (((y + opts.floorPhaseY) % floor.h) + floor.h) % floor.h
        : (((y - minY) % floor.h) + floor.h) % floor.h
      const fi = ((fy | 0) * floor.w + (fx | 0)) * 4   // integer pixel index (no half-pixel byte shift)
      if (sunlight) {
        // ENTRANCE: the room's tiled floor LEADS UP through most of the opening and
        // washes to CLEAN warm daylight only at the back/top (the way out). Blending
        // FROM sun TO floor (floor over the bottom ~70%) keeps the bright band pure
        // light, so no crack/moss speckle shows there.
        const fv = Math.max(0, Math.min(1, (t - 0.05) / 0.28)); const fvis = fv * fv * (3 - 2 * fv)
        const dim = 0.90
        const fr = floor.data[fi] * dim, fg = floor.data[fi + 1] * dim, fb = floor.data[fi + 2] * dim
        r = _lerp(SUN[0], fr, fvis); g = _lerp(SUN[1], fg, fvis); b = _lerp(SUN[2], fb, fvis)
      } else {
        const fv = Math.max(0, Math.min(1, (t - 0.40) / 0.60)), fvis = fv * fv   // short reach
        const dim = 0.50 + 0.32 * fvis              // threshold floor a touch brighter than the deep edge
        const fr = floor.data[fi] * dim, fg = floor.data[fi + 1] * dim, fb = floor.data[fi + 2] * dim
        const sr = _lerp(DARK[0], LIGHT[0], tt * 0.5), sg = _lerp(DARK[1], LIGHT[1], tt * 0.5), sb = _lerp(DARK[2], LIGHT[2], tt * 0.5)
        r = _lerp(sr, fr, fvis); g = _lerp(sg, fg, fvis); b = _lerp(sb, fb, fvis)
      }
    } else {
      r = _lerp(DARK[0], LIGHT[0], tt); g = _lerp(DARK[1], LIGHT[1], tt); b = _lerp(DARK[2], LIGHT[2], tt)
    }
    const d = dist[p]
    if (d >= 0 && d < aoPx) {                     // (B) edge
      if (sunlight) {                             // frame edge catches the light, fading at the sill
        const k = (1 - d / aoPx) * 0.5 * (1 - t)
        r = _lerp(r, SUN[0], k); g = _lerp(g, SUN[1], k); b = _lerp(b, SUN[2], k)
      } else {                                    // cool bevel lip — stronger low, faint at the dark top
        const k = (1 - d / aoPx) * (0.28 + 0.40 * t)
        r = _lerp(r, LIP[0], k); g = _lerp(g, LIP[1], k); b = _lerp(b, LIP[2], k)
      }
    }
    const warmK = sunlight ? 0 : (t * t * t) * 0.26   // (C) warm sill spill — n/a for the bright sunlit entrance
    r = _lerp(r, WARM[0], warmK); g = _lerp(g, WARM[1], warmK); b = _lerp(b, WARM[2], warmK)
    const i = p * 4
    data[i] = r | 0; data[i + 1] = g | 0; data[i + 2] = b | 0; data[i + 3] = 255
  }
  return count
}

// Fill the TRANSPARENT TOP MARGIN of a door skin (the empty space above the
// frame/arch — these skins are authored face-on with the arch at the top) with
// an opaque occluder, IN PLACE. Used to build the over-entity copy so a character
// walking through is hidden ABOVE the gate (its head no longer pokes out into the
// transparent sky). Per column, fills from the top edge DOWN to the first opaque
// pixel only — so the lit frame and the passage below it are untouched (the
// passage is carved separately, AFTER this, for open doors).
//
// When `rgb` ([r,g,b]) is given — the room's actual WALL colour, sampled by the
// caller from the room skin at the door — the sky is filled with it, so it reads
// as the wall continuing up. (Baking it into the skin image means the draw-time
// `colorAdjust.walls` then tints it the same as the surrounding rendered wall.)
// With no `rgb`, it falls back to a representative STONE tone sampled from the
// skin's OWN frame (mid-luminance opaque pixels) — still far better than black.
//
// `data` is RGBA bytes (canvas ImageData.data layout).
export function fillDoorTopOccluder(data, w, h, rgb = null) {
  if (!data || !(w > 0) || !(h > 0)) return 0
  let fr, fg, fb
  if (Array.isArray(rgb) && rgb.length >= 3) {
    fr = rgb[0] | 0; fg = rgb[1] | 0; fb = rgb[2] | 0
  } else {
    // Fallback: average of mid-luminance opaque pixels (the stone BODY, skipping
    // dark outlines/sky and bright highlights).
    let sr = 0, sg = 0, sb = 0, sn = 0
    for (let p = 0; p < w * h; p++) {
      const i = p * 4
      if (data[i + 3] < 200) continue
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (lum < 45 || lum > 225) continue
      sr += r; sg += g; sb += b; sn++
    }
    fr = sn ? (sr / sn) | 0 : 60
    fg = sn ? (sg / sn) | 0 : 56
    fb = sn ? (sb / sn) | 0 : 64
  }

  // Fill the transparent SKY above each column's frame. Only fill columns whose
  // frame starts reasonably high — guard against a lintel-less passage column
  // (transparent until the floor) so we never block a doorway opening. The carve
  // handles the actual passage; this is the SKY.
  const maxTop = Math.round(h * 0.6)
  let filled = 0
  for (let x = 0; x < w; x++) {
    let top = -1
    for (let y = 0; y < h; y++) { if (data[(y * w + x) * 4 + 3] >= DOOR_FRAME_SOLID_ALPHA) { top = y; break } }
    if (top <= 0 || top > maxTop) continue   // solid from the top, or no high frame → skip
    for (let y = 0; y < top; y++) {           // fills THROUGH the AA ramp → no see-through seam
      const i = (y * w + x) * 4
      data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = 255; filled++
    }
  }
  return filled
}

// Build a MASK image (RGBA, IN PLACE on `data`) for a door skin's SKY region:
// opaque WHITE exactly where fillDoorTopOccluder fills (the transparent margin
// above the frame), fully transparent everywhere else. Used as a Phaser bitmap
// mask so a copy of the room's wall skin shows ONLY in that sky region — giving
// the real wall texture above the gate. Same per-column / maxTop logic as the
// fill, so the two stay in lock-step. `data` starts as the door skin's pixels.
export function buildDoorSkyMask(data, w, h) {
  if (!data || !(w > 0) || !(h > 0)) return 0
  const maxTop = Math.round(h * 0.6)
  // Record which pixels are sky FIRST (reading alpha), then rewrite all pixels —
  // so rewriting earlier rows can't disturb the first-opaque scan of later cols.
  const sky = new Uint8Array(w * h)
  let n = 0
  for (let x = 0; x < w; x++) {
    let top = -1
    for (let y = 0; y < h; y++) { if (data[(y * w + x) * 4 + 3] >= DOOR_FRAME_SOLID_ALPHA) { top = y; break } }
    if (top <= 0 || top > maxTop) continue   // through the AA ramp, lock-step with fillDoorTopOccluder
    for (let y = 0; y < top; y++) { sky[y * w + x] = 1; n++ }
  }
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    if (sky[p]) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255 }
    else { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0 }
  }
  return n
}
