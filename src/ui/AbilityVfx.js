// Phase 5b — small reusable VFX primitives for ability activations.
//
// Goal: visually impressive but not overwhelming (per design call). Each
// helper is short-lived (≤1.5s), kills itself when done, and doesn't block
// gameplay. All take a Phaser scene + world-space (x, y) as the anchor.
//
// Primitives:
//   pulseRing(scene, x, y, opts)       — expanding circle ring
//   particleBurst(scene, x, y, opts)   — small burst of particles
//   floatingText(scene, x, y, str, opts) — drifting text label
//   tintFlash(target, color, opts)     — flash tint on a sprite, then revert
//   alphaSet(target, alpha)            — instant alpha set (for invis state)
//
// Each returns the created object so callers can chain or cancel if needed.

const DEFAULTS = {
  // Tuned 2026-04-30: rings dialed way down so they don't cover LPC sprites.
  ring:    { color: 0xffe066, fromR: 4, toR: 18, alpha: 0.55, durationMs: 300, depth: 6 },
  particles: { color: 0xffe066, count: 6, durationMs: 450, depth: 6, speed: 45 },
  text:    { color: '#ffe066', fontSize: '11px', driftY: -22, durationMs: 700, depth: 11 },
  tint:    { color: 0xffffff, durationMs: 200 },
}

// Phase 5c — defensive guard. If a caller passes undefined/null/NaN
// coordinates (most often because the source adv has been removed from
// the active list and its worldX/Y is now undefined), the underlying
// Phaser draw silently lands at world (0, 0) which manifests as black
// VFX shapes flashing in the upper-left corner of the dungeon. Skip the
// draw entirely instead.
function _validXY(x, y) {
  return Number.isFinite(x) && Number.isFinite(y)
}

// Room-containment for flood / ground VFX (cracks, geysers, puddles, fissures).
// When `opts.roomRect` (world {x,y,w,h} of the room's FLOOR area) is supplied the
// effect centres on the ROOM and every scattered point is clamped inside it — so
// ground decals never paint onto walls or spill outside the room the minion is
// in. Falls back to a minion-centred box (ox,oy ± rectW/rectH) for the dev
// VFX-Lab / any caller that doesn't know the room.
function _floodField(ox, oy, opts) {
  const r = opts.roomRect
  if (r && r.w > 0 && r.h > 0) {
    const clamp = (px, py) => [
      Math.max(r.x, Math.min(r.x + r.w, px)),
      Math.max(r.y, Math.min(r.y + r.h, py)),
    ]
    return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, halfW: r.w / 2, halfH: r.h / 2, rect: r, clamp }
  }
  const hw = (opts.rectW ?? 220) / 2, hh = (opts.rectH ?? 140) / 2
  return { cx: ox, cy: oy, halfW: hw, halfH: hh, rect: { x: ox - hw, y: oy - hh, w: hw * 2, h: hh * 2 }, clamp: (px, py) => [px, py] }
}

// Phase 34C.5 — Particles quality setting. Inline localStorage read
// instead of importing src/hud/userSettings.js to keep src/ui/ free of
// HUD dependencies. Defaults to 'high' (multiplier 1.0). The 5 levels:
//   off → 0    (skip emit entirely)
//   low → 0.4
//   med → 0.7
//   high → 1.0  (default)
function _particlesMult() {
  try {
    const lvl = localStorage.getItem('qf.video.particles') ?? 'high'
    if (lvl === 'off')  return 0
    if (lvl === 'low')  return 0.4
    if (lvl === 'med')  return 0.7
    return 1.0
  } catch { return 1.0 }
}

// ── Cheap universal upgraders (2026-06-05) ───────────────────────────────────
// _add: additive blend so bright overlapping shapes BLOOM into light on the dark
// dungeon instead of reading as flat fills — the single biggest cheap win for any
// glow effect. (Never use on dark decals like crater — additive black = invisible.)
// _glow: a soft Glow post-FX halo (WebGL only; silent no-op on Canvas). Use on
// SINGLE-object effects only — per-object glow on a 16-dot burst would be wasteful.
function _add(obj) { try { obj?.setBlendMode?.(Phaser.BlendModes.ADD) } catch (e) {} return obj }
function _glow(obj, color = 0xffffff, strength = 4, distance = 10) {
  try { obj?.postFX?.addGlow(color, strength, 0, false, 0.1, distance) } catch (e) {}
  return obj
}
// Draw a DETAILED bone spike into a Graphics (local coords: base at 0,0, tip at
// 0,-h), as a layered, shaded silhouette — drop shadow + bone body + lower-right
// shade + bright left-edge ridge + surface cracks. `lean` slants the tip. Scaling
// the graphics' Y grows the spike up from its ground base.
function _drawBoneSpike(g, h, bw, lean = 0, bone = 0xe8e0c8) {
  const tip = lean
  const path = [
    [-bw, 0], [-bw * 0.55, -h * 0.30], [-bw * 0.95, -h * 0.46],
    [-bw * 0.28, -h * 0.62], [tip - 1.4, -h * 0.92], [tip, -h],
    [tip + 1.4, -h * 0.92], [bw * 0.28, -h * 0.62],
    [bw * 0.85, -h * 0.42], [bw * 0.5, -h * 0.28], [bw, 0],
  ]
  const fill = (pts, color, alpha, dx = 0, dy = 0) => {
    g.fillStyle(color, alpha); g.beginPath(); g.moveTo(pts[0][0] + dx, pts[0][1] + dy)
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + dx, pts[i][1] + dy)
    g.closePath(); g.fillPath()
  }
  fill(path, 0x16241a, 0.7, 1.5, 1.5)   // drop shadow (offset, dark necrotic)
  fill(path, bone, 1)                    // bone body
  fill([[0, 0], [bw, 0], [bw * 0.5, -h * 0.28], [bw * 0.28, -h * 0.62], [tip, -h * 0.55], [tip, 0]], 0xb6aa8c, 0.6) // lower-right shade
  g.lineStyle(1.2, 0xfff8e6, 0.9)        // bright left-edge ridge
  g.beginPath(); g.moveTo(-bw * 0.95, -h * 0.46); g.lineTo(-bw * 0.28, -h * 0.62); g.lineTo(tip, -h); g.strokePath()
  g.lineStyle(0.8, 0x4a4534, 0.7)        // surface cracks
  g.beginPath(); g.moveTo(-bw * 0.2, -h * 0.2); g.lineTo(bw * 0.1, -h * 0.5); g.strokePath()
  g.beginPath(); g.moveTo(bw * 0.22, -h * 0.34); g.lineTo(0, -h * 0.7); g.strokePath()
}

// Draw a small irregular bone CHIP into a Graphics (centred at 0,0): shadow +
// shaded body + dark outline + a tiny highlight. For shard bursts.
function _drawBoneChip(g, s, bone = 0xe8e0c8) {
  const pts = [[-s, 0], [-s * 0.3, -s * 0.85], [s * 0.5, -s * 0.6], [s, 0.2], [s * 0.25, s * 0.75], [-s * 0.6, s * 0.5]]
  const fill = (color, alpha, dx = 0, dy = 0) => {
    g.fillStyle(color, alpha); g.beginPath(); g.moveTo(pts[0][0] + dx, pts[0][1] + dy)
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + dx, pts[i][1] + dy)
    g.closePath(); g.fillPath()
  }
  fill(0x16241a, 0.55, 1, 1)             // shadow
  fill(bone, 1)                          // body
  g.fillStyle(0x9b927a, 0.5); g.beginPath(); g.moveTo(0, 0); g.lineTo(s, 0.2); g.lineTo(s * 0.25, s * 0.75); g.closePath(); g.fillPath() // shade wedge
  g.lineStyle(0.8, 0x5a5340, 0.8); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.strokePath() // outline
  g.fillStyle(0xfff8e6, 0.75); g.fillCircle(-s * 0.2, -s * 0.25, Math.max(0.6, s * 0.18)) // highlight
}

// Draw a layered FLAME TONGUE into a Graphics (local: base at 0,0, tip at 0,-h):
// 3 concentric tones (deep red → orange → hot core) for a flame with depth, plus a
// couple of inner crack/lick lines. Additive blend on the graphics makes it bloom.
function _drawFlameTongue(g, h, w) {
  const base = [
    [-w, 0], [-w * 0.6, -h * 0.34], [-w * 0.82, -h * 0.56], [-w * 0.22, -h * 0.8],
    [w * 0.05, -h], [w * 0.32, -h * 0.72], [w * 0.72, -h * 0.5], [w * 0.5, -h * 0.24], [w, 0],
  ]
  const layer = (k, color, alpha) => {
    g.fillStyle(color, alpha); g.beginPath(); g.moveTo(base[0][0] * k, base[0][1] * k)
    for (let i = 1; i < base.length; i++) g.lineTo(base[i][0] * k, base[i][1] * k)
    g.closePath(); g.fillPath()
  }
  layer(1, 0x9c1800, 1)        // deep-red outer body (opaque → crisp silhouette)
  layer(0.72, 0xff6a12, 1)     // orange mid
  layer(0.42, 0xffc24a, 1)     // amber inner
  layer(0.2, 0xffe89a, 1)      // hot near-white core
}

// A teardrop FLAME silhouette (base at 0,0, tip at -h): WIDE rounded base tapering
// through stable shoulders to a point near centre that flickers only slightly
// (`tipDX` is a SMALL tip offset — NOT a body-bending lateral swing, which reads as
// a worm). Layered in 4 fire tones. Animate via HEIGHT flicker in flameLickFx.
function _drawFlame(g, h, w, tipDX) {
  const tones = [[0x9c1800, 1.0], [0xff6a12, 0.72], [0xffc24a, 0.46], [0xffe89a, 0.22]]
  for (const [col, k] of tones) {
    const ww = w * k, hh = h * (0.78 + 0.22 * k)
    const tx = (tipDX || 0) * (0.4 + 0.6 * k)
    g.fillStyle(col, 1); g.beginPath()
    g.moveTo(-ww, 0)                          // wide base, left
    g.lineTo(-ww * 0.95, -hh * 0.16)
    g.lineTo(-ww * 0.6, -hh * 0.46)           // left shoulder (straight, no drift)
    g.lineTo(tx * 0.5 - ww * 0.16, -hh * 0.82)
    g.lineTo(tx, -hh)                          // tip (only a small offset)
    g.lineTo(tx * 0.5 + ww * 0.16, -hh * 0.82)
    g.lineTo(ww * 0.6, -hh * 0.46)            // right shoulder
    g.lineTo(ww * 0.95, -hh * 0.16)
    g.lineTo(ww, 0)                            // wide base, right
    g.closePath(); g.fillPath()
  }
}

// Draw a detailed GOLD COIN into a Graphics (centred at 0,0, radius r): rim + face +
// a shine crescent + a stamped notch, so it reads as a minted coin, not a yellow dot.
function _drawCoin(g, r) {
  g.fillStyle(0x070707, 0.45); g.fillCircle(1, 1.5, r)             // drop shadow
  g.fillStyle(0xb8860b, 1); g.fillCircle(0, 0, r)                  // dark rim
  g.fillStyle(0xffd23f, 1); g.fillCircle(0, 0, r * 0.82)           // gold face
  g.fillStyle(0xfff1a8, 0.9); g.fillCircle(-r * 0.28, -r * 0.3, r * 0.28) // top-left shine
  g.lineStyle(Math.max(0.6, r * 0.12), 0xb8860b, 0.9)              // inner ring detail
  g.strokeCircle(0, 0, r * 0.55)
  g.lineStyle(Math.max(0.5, r * 0.1), 0x8a6508, 0.8)               // stamped notch
  g.beginPath(); g.moveTo(-r * 0.2, -r * 0.2); g.lineTo(r * 0.2, r * 0.2); g.strokePath()
}

// Draw a small wet BLOOD DROPLET into a Graphics (centred 0,0, radius s): shadow +
// dark-crimson body + a wet highlight. For blood-fleck spatter.
function _drawBloodDroplet(g, s) {
  g.fillStyle(0x2a0306, 0.5); g.fillCircle(0.6, 0.9, s * 1.05)        // shadow
  g.fillStyle(0x9e0b18, 1); g.fillCircle(0, 0, s)                     // blood body
  g.fillStyle(0x5a0710, 0.9); g.fillCircle(s * 0.2, s * 0.25, s * 0.5) // dark underside
  g.fillStyle(0xe2606a, 0.85); g.fillCircle(-s * 0.28, -s * 0.32, s * 0.38) // wet shine
}

// Draw a wet gooey SLIME BLOB into a Graphics (centred 0,0, radius r): ground
// shadow + a bumpy translucent body + a pooled dark underside + a glossy highlight.
// `color` is the slime's base hue (0xRRGGBB).
function _drawSlimeBlob(g, r, color) {
  const dark = _lerpColor(color, 0x000000, 0.5), lite = _lerpColor(color, 0xffffff, 0.55)
  g.fillStyle(0x000000, 0.28); g.fillEllipse(1, r * 0.7, r * 2.1, r * 0.8)   // ground shadow
  g.fillStyle(color, 0.9)
  g.fillCircle(0, 0, r)
  g.fillCircle(-r * 0.5, r * 0.2, r * 0.55)                                    // bumps break the silhouette
  g.fillCircle(r * 0.5, r * 0.15, r * 0.5)
  g.fillStyle(dark, 0.5); g.fillCircle(0, r * 0.4, r * 0.7)                    // pooled underside
  g.fillStyle(lite, 0.85); g.fillCircle(-r * 0.35, -r * 0.4, r * 0.3)         // glossy sheen
  g.fillStyle(0xffffff, 0.75); g.fillCircle(-r * 0.42, -r * 0.46, r * 0.12)   // hot spec dot
}

// An erupting acid column (geyser) at the local origin: base at y=0, crest at -h.
// Layered dark→body→bright tapered silhouette + a molten cap, so it reads as a
// liquid spout, not a triangle. Used by acidGeyser / acidFloodFx.
function _drawAcidColumn(g, h, w, color, dark) {
  dark = dark ?? _lerpColor(color, 0x223300, 0.45)
  const bright = _lerpColor(color, 0xffffff, 0.5)
  const top = -h
  const col = (ww, ty) => {
    g.beginPath()
    g.moveTo(-ww, 0)
    g.lineTo(-ww * 0.78, ty * 0.34)
    g.lineTo(-ww * 0.40, ty * 0.72)
    g.lineTo(-ww * 0.20, ty)
    g.lineTo(ww * 0.20, ty)
    g.lineTo(ww * 0.40, ty * 0.72)
    g.lineTo(ww * 0.78, ty * 0.34)
    g.lineTo(ww, 0)
    g.closePath()
  }
  g.fillStyle(dark, 0.9);   col(w, top);             g.fillPath()
  g.fillStyle(color, 0.92); col(w * 0.72, top * 0.98); g.fillPath()
  g.fillStyle(bright, 0.95); col(w * 0.34, top * 0.95); g.fillPath()
  g.fillStyle(bright, 1);    g.fillCircle(0, top, w * 0.36)            // molten crest
  g.fillStyle(0xffffff, 0.8); g.fillCircle(-w * 0.12, top - w * 0.1, w * 0.16)
}

// A lumpy, shaded miasma puff (cloud lobe) — breaks the perfect-circle read of
// the plague clouds. Drawn at local origin; caller scales/tweens it.
function _drawMiasmaPuff(g, r, green, purple) {
  const mid = _lerpColor(green, purple, 0.4)
  g.fillStyle(_lerpColor(mid, 0x000000, 0.32), 0.5); g.fillCircle(0, r * 0.18, r)                 // dark base lobe
  g.fillStyle(mid, 0.5); g.fillCircle(-r * 0.62, 0, r * 0.62); g.fillCircle(r * 0.58, -r * 0.1, r * 0.66)   // side lobes
  g.fillStyle(_lerpColor(green, 0xffffff, 0.35), 0.42); g.fillCircle(-r * 0.2, -r * 0.46, r * 0.42)         // light wisp top
}

// An irregular, lobed acid pool (shaded) — a caustic puddle, not a clean ellipse.
function _drawAcidBlob(g, r, color) {
  const dark = _lerpColor(color, 0x000000, 0.38), lite = _lerpColor(color, 0xffffff, 0.4)
  g.fillStyle(dark, 0.5); g.fillEllipse(0, r * 0.2, r * 2.3, r * 1.05)          // pooled underside
  g.fillStyle(color, 0.58); g.fillEllipse(0, 0, r * 2, r * 0.9)
  g.fillCircle(-r * 0.72, r * 0.06, r * 0.5); g.fillCircle(r * 0.78, -r * 0.05, r * 0.46)   // lobes break the ellipse
  g.fillStyle(lite, 0.4); g.fillEllipse(-r * 0.3, -r * 0.22, r * 0.7, r * 0.34)              // surface sheen
}

// A lumpy congealed blood-clot/platelet (shaded) — the building block of the
// vampire blood-shield husk. Dark, glossy, irregular; not a clean disc.
function _drawBloodClot(g, r, color) {
  const dark = _lerpColor(color, 0x000000, 0.45), lite = _lerpColor(color, 0xff5577, 0.5)
  g.fillStyle(dark, 0.88); g.fillCircle(0, r * 0.2, r)
  g.fillStyle(color, 0.9); g.fillCircle(-r * 0.42, 0, r * 0.62); g.fillCircle(r * 0.46, -r * 0.12, r * 0.56)   // lobes
  g.fillStyle(lite, 0.7); g.fillCircle(-r * 0.22, -r * 0.34, r * 0.3)                                          // glossy highlight
  g.fillStyle(0xffffff, 0.55); g.fillCircle(-r * 0.28, -r * 0.4, r * 0.12)                                     // hot spec
}

// A tiny shaded RAT silhouette into a Graphics (centred at 0,0), snout pointing
// RIGHT (caller flips scaleX to face the other way). Body + snout + ear + eye +
// belly highlight + a thin curling tail. The swarm/vermin building block.
function _drawRat(g, s, color) {
  const dark = _lerpColor(color, 0x000000, 0.5), lite = _lerpColor(color, 0xffffff, 0.25)
  g.fillStyle(0x000000, 0.35); g.fillEllipse(0, s * 0.7, s * 2.0, s * 0.55)        // ground shadow
  g.lineStyle(Math.max(0.6, s * 0.16), dark, 0.95)                                  // curling tail behind (left)
  g.beginPath(); g.moveTo(-s * 0.85, s * 0.15); g.lineTo(-s * 1.5, -s * 0.15); g.lineTo(-s * 2.05, s * 0.25); g.strokePath()
  g.fillStyle(color, 0.96); g.fillEllipse(0, 0, s * 1.8, s * 1.05)                  // body
  g.fillTriangle(s * 0.7, -s * 0.22, s * 0.7, s * 0.3, s * 1.55, s * 0.04)          // pointed snout
  g.fillCircle(-s * 0.72, -s * 0.55, s * 0.32)                                       // ear
  g.fillStyle(lite, 0.45); g.fillEllipse(-s * 0.1, s * 0.22, s * 1.05, s * 0.45)     // belly highlight
  g.fillStyle(0x140b08, 0.9); g.fillCircle(s * 0.92, -s * 0.06, s * 0.11)            // beady eye
}

// A SWARM RAT — uses the real `rat1` idle sheet (128px, frame 12 = side-view facing
// LEFT) so the vermin read like actual rats, not procedural blobs. `dirRight` flips
// it to face the way it's scurrying. Falls back to `_drawRat` if the sheet isn't
// loaded. Returns the GameObject (Image or Graphics).
const RAT_SHEET = 'minion-rat1-idle', RAT_SIDE_FRAME = 12
// (dx,dy) = scurry direction. Sheet rows: up(0) / down(6) / side(12, faces LEFT).
// Vertical movement picks the up/down row; otherwise the side frame, flipped for right.
function _swarmRat(scene, x, y, dx, dy, scale = 0.22, depth = 12, tint = null) {
  if (scene.textures.exists(RAT_SHEET)) {
    let frame = RAT_SIDE_FRAME, flip = false
    if (Math.abs(dy) > Math.abs(dx)) frame = dy < 0 ? 6 : 0
    else flip = dx >= 0
    const img = scene.add.image(x, y, RAT_SHEET, frame).setDepth(depth)
    img.setScale(flip ? -scale : scale, scale)
    if (tint != null) img.setTint(tint)
    return img
  }
  const g = scene.add.graphics().setPosition(x, y).setDepth(depth).setScale(dx >= 0 ? -1 : 1, 1)
  _drawRat(g, 2.4 + scale * 6, tint ?? 0x6b5238)
  return g
}

// A weathered TOMBSTONE into a Graphics (base at 0,0; arched top at -y). Grey
// slab w/ a rounded top, a darker 3D under-edge, a left bevel highlight, a crack
// and two engraving lines, on a small earth mound. Clean, iconic — the mass-grave
// building block (the green glow is added by the FX, not the stone).
function _drawTombstone(g, s, _color) {
  const stone = 0x9298a0, edge = 0x33363b, lite = 0xc2c6cc, dark = 0x565b62
  g.fillStyle(0x241810, 0.6); g.fillEllipse(0, s * 0.15, s * 2.6, s * 0.7)                 // disturbed earth mound
  g.fillStyle(edge, 1); g.fillRect(-s * 0.68, -s * 2.0, s * 1.5, s * 2.05); g.fillCircle(s * 0.07, -s * 2.0, s * 0.76)   // 3D under-edge
  g.fillStyle(stone, 1); g.fillRect(-s * 0.75, -s * 2.05, s * 1.5, s * 2.05); g.fillCircle(0, -s * 2.05, s * 0.75)        // front face (arched top)
  g.fillStyle(lite, 0.3); g.fillRect(-s * 0.75, -s * 2.05, s * 0.22, s * 2.0)              // left bevel highlight
  g.lineStyle(Math.max(0.6, s * 0.11), edge, 0.85)                                          // crack
  g.beginPath(); g.moveTo(-s * 0.05, -s * 1.85); g.lineTo(s * 0.08, -s * 1.1); g.lineTo(-s * 0.06, -s * 0.4); g.strokePath()
  g.lineStyle(Math.max(0.5, s * 0.09), dark, 0.65)                                          // engraving lines
  g.beginPath(); g.moveTo(-s * 0.4, -s * 1.45); g.lineTo(s * 0.4, -s * 1.45); g.strokePath()
  g.beginPath(); g.moveTo(-s * 0.4, -s * 1.15); g.lineTo(s * 0.35, -s * 1.15); g.strokePath()
}

// A jagged angular ROCK SHARD into a Graphics (centred ~0,0): an irregular faceted
// stone chunk — drop-shadow + body + a bright top facet + a crack. The golem
// bulwark/bastion building block. Organic + angular, never a clean shape.
function _drawRockShard(g, s, color) {
  const dark = _lerpColor(color, 0x000000, 0.5), lite = _lerpColor(color, 0xffffff, 0.32)
  const pts = [[-s, 0.2 * s], [-0.72 * s, -0.62 * s], [0.12 * s, -s], [0.82 * s, -0.5 * s], [0.9 * s, 0.32 * s], [0.18 * s, 0.72 * s]]
  const poly = (dx, dy) => { g.beginPath(); g.moveTo(pts[0][0] + dx, pts[0][1] + dy); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + dx, pts[i][1] + dy); g.closePath(); g.fillPath() }
  g.fillStyle(0x14110c, 0.5); poly(1.5, 1.5)                  // drop shadow
  g.fillStyle(color, 1); poly(0, 0)                            // body
  g.fillStyle(lite, 0.5); g.beginPath(); g.moveTo(-0.72 * s, -0.62 * s); g.lineTo(0.12 * s, -s); g.lineTo(0.82 * s, -0.5 * s); g.lineTo(0, -0.32 * s); g.closePath(); g.fillPath()  // top facet
  g.fillStyle(dark, 0.45); g.beginPath(); g.moveTo(0.9 * s, 0.32 * s); g.lineTo(0.18 * s, 0.72 * s); g.lineTo(0, -0.1 * s); g.closePath(); g.fillPath()   // shade facet
  g.lineStyle(Math.max(0.5, s * 0.08), dark, 0.7); g.beginPath(); g.moveTo(0.12 * s, -s); g.lineTo(-0.05 * s, 0.2 * s); g.strokePath()                    // crack
}

// A chunky BEVELLED STONE BLOCK (centred at 0, cyOff) — lit top/left bevels, dark
// bottom/right, an inset face with cracks + embedded specks. The hero silhouette
// of the Golem's bulwark plates + pillars. `cyOff` shifts the block vertically
// (e.g. -h/2 to root a pillar's base at local y=0 so it grows from the floor).
function _drawStoneSlab(g, w, h, color, cyOff = 0) {
  const dark = _lerpColor(color, 0x000000, 0.5), edge = _lerpColor(color, 0x000000, 0.3)
  const lite = _lerpColor(color, 0xffffff, 0.3), pale = _lerpColor(color, 0xffffff, 0.12)
  const hw = w / 2, hh = h / 2, b = Math.min(w, h) * 0.2, cy = cyOff
  g.fillStyle(0x14110c, 0.4); g.fillRect(-hw + 2, -hh + cy + 2, w, h)                      // drop shadow
  g.fillStyle(edge, 1); g.fillRect(-hw, -hh + cy, w, h)                                    // dark base block
  g.fillStyle(lite, 0.95); g.beginPath(); g.moveTo(-hw, -hh + cy); g.lineTo(hw, -hh + cy); g.lineTo(hw - b, -hh + b + cy); g.lineTo(-hw + b, -hh + b + cy); g.closePath(); g.fillPath()  // top bevel
  g.fillStyle(pale, 0.95); g.beginPath(); g.moveTo(-hw, -hh + cy); g.lineTo(-hw + b, -hh + b + cy); g.lineTo(-hw + b, hh - b + cy); g.lineTo(-hw, hh + cy); g.closePath(); g.fillPath()  // left bevel
  g.fillStyle(color, 1); g.fillRect(-hw + b, -hh + b + cy, w - 2 * b, h - 2 * b)           // main face
  g.fillStyle(dark, 0.92); g.beginPath(); g.moveTo(hw, -hh + cy); g.lineTo(hw, hh + cy); g.lineTo(hw - b, hh - b + cy); g.lineTo(hw - b, -hh + b + cy); g.closePath(); g.fillPath()      // right bevel
  g.fillStyle(dark, 0.8); g.beginPath(); g.moveTo(-hw, hh + cy); g.lineTo(hw, hh + cy); g.lineTo(hw - b, hh - b + cy); g.lineTo(-hw + b, hh - b + cy); g.closePath(); g.fillPath()       // bottom bevel
  // face cracks
  g.lineStyle(1, dark, 0.6); g.beginPath(); g.moveTo(-hw * 0.34, -hh + b + cy); g.lineTo(-hw * 0.08, cy); g.lineTo(hw * 0.22, hh - b + cy); g.strokePath()
  g.lineStyle(0.8, dark, 0.5); g.beginPath(); g.moveTo(hw * 0.42, -hh * 0.2 + cy); g.lineTo(hw - b, hh * 0.12 + cy); g.strokePath()
  // embedded specks
  g.fillStyle(lite, 0.5); g.fillRect(-hw * 0.42, hh * 0.32 + cy, 2, 2)
  g.fillStyle(dark, 0.6); g.fillRect(hw * 0.12, -hh * 0.42 + cy, 2, 2)
  g.lineStyle(1.2, 0x1c1610, 0.85); g.strokeRect(-hw, -hh + cy, w, h)                      // outline
}

// A spectral WAIL-FACE — a ghostly hollow visage (lobed teardrop head tapering to
// a wispy chin, two dark hollow eye-sockets, an elongated wailing mouth). The hero
// silhouette of the Ghost FEAR kit; drawn additive so it reads as cold light.
function _drawWailFace(g, s, color) {
  const pale = _lerpColor(color, 0xffffff, 0.55), dark = _lerpColor(color, 0x05060f, 0.7)
  // head — an organic lobed teardrop, longer below (the trailing chin-wisp).
  g.fillStyle(color, 0.5); g.beginPath()
  const N = 16
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2
    const lower = Math.sin(a) > 0                               // bottom half tapers/lengthens
    const ry = lower ? 1.32 : 0.92
    const wob = 0.84 + 0.2 * Math.sin(a * 3 + 0.5)
    const px = Math.cos(a) * s * 0.78 * wob
    const py = Math.sin(a) * s * ry * wob
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py)
  }
  g.closePath(); g.fillPath()
  g.fillStyle(pale, 0.3); g.fillEllipse(0, -0.12 * s, s * 1.0, s * 1.2)   // inner cold glow
  // hollow eyes + a wailing mouth (fictional features — dark voids).
  g.fillStyle(dark, 0.92)
  g.fillEllipse(-0.34 * s, -0.16 * s, 0.32 * s, 0.46 * s)
  g.fillEllipse(0.34 * s, -0.16 * s, 0.32 * s, 0.46 * s)
  g.fillEllipse(0, 0.46 * s, 0.3 * s, 0.56 * s)
}

// A pale jagged FRIGHT-MARK ("!") that stabs up over a frightened unit's head.
function _drawFrightMark(g, color) {
  const pale = _lerpColor(color, 0xffffff, 0.6)
  g.fillStyle(0x05060f, 0.45); g.beginPath(); g.moveTo(-2 + 1, -7 + 1); g.lineTo(2.4 + 1, -7 + 1); g.lineTo(1.1 + 1, 2.6 + 1); g.lineTo(-1.1 + 1, 2.6 + 1); g.closePath(); g.fillPath()  // shadow
  g.fillStyle(color, 0.96); g.beginPath(); g.moveTo(-2, -7); g.lineTo(2.4, -7); g.lineTo(1.1, 2.6); g.lineTo(-1.1, 2.6); g.closePath(); g.fillPath()                                       // stem
  g.fillStyle(color, 0.96); g.fillCircle(0, 6, 1.9)                                                                                                                                       // dot
  g.fillStyle(pale, 0.6); g.beginPath(); g.moveTo(-2, -7); g.lineTo(0.2, -7); g.lineTo(-0.4, 2); g.lineTo(-1.1, 2.6); g.closePath(); g.fillPath()                                          // highlight edge
}

// A spectral EYE — a pale almond/lens eye with a cold glowing pupil, for the dread
// presence (eyes opening in the dark, watching). Drawn additive.
function _drawSpectralEye(g, s, color) {
  const pale = _lerpColor(color, 0xffffff, 0.62)
  const N = 12
  // almond lens body (upper + lower arc)
  g.fillStyle(color, 0.5); g.beginPath()
  for (let i = 0; i <= N; i++) { const t = i / N, px = (-1 + 2 * t) * s, py = -Math.sin(t * Math.PI) * s * 0.5; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) }
  for (let i = 0; i <= N; i++) { const t = i / N, px = (1 - 2 * t) * s, py = Math.sin(t * Math.PI) * s * 0.5; g.lineTo(px, py) }
  g.closePath(); g.fillPath()
  // bright pale lid-rim along the top
  g.lineStyle(Math.max(0.6, s * 0.13), pale, 0.75); g.beginPath()
  for (let i = 0; i <= N; i++) { const t = i / N, px = (-1 + 2 * t) * s, py = -Math.sin(t * Math.PI) * s * 0.5; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) }
  g.strokePath()
  // cold pupil + dark slit core
  g.fillStyle(pale, 0.95); g.fillCircle(0, 0, s * 0.28)
  g.fillStyle(0x070d18, 0.85); g.fillCircle(0, 0, s * 0.14)
}

// A CLAW-RAKE — three parallel tapered gashes (bright core + blood halo) along the
// local x-axis. The caller rotates it (setAngle) to point the rake. For the Gnoll hunt.
function _drawClawSlash(g, len, color) {
  const blood = _lerpColor(color, 0xcc2a1a, 0.65)
  const gashes = 3, spacing = len * 0.26
  for (let k = 0; k < gashes; k++) {
    const off = (k - (gashes - 1) / 2) * spacing
    const sliver = (col, al, ww) => {
      g.fillStyle(col, al); g.beginPath()
      g.moveTo(-len / 2, off)
      g.lineTo(-len * 0.1, off - ww); g.lineTo(len * 0.2, off - ww)
      g.lineTo(len / 2, off)
      g.lineTo(len * 0.2, off + ww); g.lineTo(-len * 0.1, off + ww)
      g.closePath(); g.fillPath()
    }
    sliver(blood, 0.5, len * 0.1)     // blood halo
    sliver(0xffffff, 0.85, len * 0.04) // bright core
  }
}

// A vicious CLAW-RAKE — three tapered gashes, each a layered wound (dark torn interior
// + blood fill + a bright torn upper edge). Richer than _drawClawSlash. Local x-axis.
function _drawClawGashes(g, len) {
  const gashes = 3, spacing = len * 0.24
  const sliver = (off, w, col, al) => {
    g.fillStyle(col, al); g.beginPath()
    g.moveTo(-len / 2, off); g.lineTo(-len * 0.12, off - w); g.lineTo(len * 0.22, off - w)
    g.lineTo(len / 2, off); g.lineTo(len * 0.22, off + w); g.lineTo(-len * 0.12, off + w)
    g.closePath(); g.fillPath()
  }
  for (let k = 0; k < gashes; k++) {
    const off = (k - (gashes - 1) / 2) * spacing
    sliver(off, len * 0.1, 0x2a0303, 0.92)    // dark wound interior
    sliver(off, len * 0.055, 0xb81212, 0.95)  // blood fill
    g.fillStyle(0xff7a66, 0.5); g.beginPath(); g.moveTo(-len / 2, off); g.lineTo(-len * 0.12, off - len * 0.1); g.lineTo(len * 0.22, off - len * 0.1); g.lineTo(len / 2, off); g.closePath(); g.fillPath()   // bright torn edge
  }
}

// A heavy BLOOD GOB — a fat shaded droplet (shadow + body + dark side + glossy highlight).
function _drawGoreGob(g, s) {
  g.fillStyle(0x2a0202, 0.45); g.fillCircle(0.7, 0.9, s * 1.05)
  g.fillStyle(0xb01010, 0.95); g.fillCircle(0, 0, s)
  g.fillStyle(0x6a0606, 0.55); g.fillCircle(s * 0.32, s * 0.32, s * 0.52)
  g.fillStyle(0xff8a78, 0.6);  g.fillCircle(-s * 0.3, -s * 0.36, s * 0.3)
}

// A tapered BLOOD COLUMN/GEYSER silhouette (drop-shadow + body + dark spine + bright crest)
// — for the Blood Frenzy gore eruptions. h = height, w = base half-width.
function _drawBloodColumn(g, h, w) {
  const tip = -h
  const path = (sw, col, al, dx) => { g.fillStyle(col, al); g.beginPath(); g.moveTo(dx - sw, 0); g.lineTo(dx - sw * 0.5, -h * 0.5); g.lineTo(dx, tip); g.lineTo(dx + sw * 0.5, -h * 0.5); g.lineTo(dx + sw, 0); g.closePath(); g.fillPath() }
  path(w * 1.05, 0x2a0202, 0.4, 1.5)     // shadow
  path(w, 0xb81212, 0.95, 0)             // body
  path(w * 0.55, 0x6a0606, 0.6, w * 0.3) // dark spine
  path(w * 0.4, 0xff6a55, 0.6, -w * 0.2) // bright crest edge
}

// A curved wooden THORN/BARB — a tapered barb that hooks to a sharp tip (drop-shadow +
// woody body + bright wood highlight). Drawn along local +x; the caller rotates it.
function _drawThorn(g, len, color) {
  const dark = _lerpColor(color, 0x201404, 0.55), lite = _lerpColor(color, 0xffe9b0, 0.45)
  const w = len * 0.2, curve = len * 0.22
  const barb = (col, al, ww, off) => {
    g.fillStyle(col, al); g.beginPath()
    g.moveTo(0, -ww + off); g.lineTo(0, ww + off)
    g.lineTo(len * 0.6, ww * 0.3 + curve * 0.5 + off)
    g.lineTo(len, curve + off)                       // hooked sharp tip
    g.lineTo(len * 0.55, -ww * 0.2 + curve * 0.2 + off)
    g.closePath(); g.fillPath()
  }
  barb(dark, 0.5, w, 1.3)            // drop shadow
  barb(color, 1, w, 0)               // woody body
  barb(lite, 0.5, w * 0.4, -w * 0.32) // top highlight
}

// A small LEAF — a pointed oval blade with a centre vein. For regrowth.
function _drawLeaf(g, s, color) {
  const dark = _lerpColor(color, 0x103808, 0.45), lite = _lerpColor(color, 0xffffff, 0.3)
  g.fillStyle(color, 0.95); g.beginPath(); g.moveTo(0, -s)
  for (let k = 1; k <= 8; k++) { const t = k / 8; g.lineTo(Math.sin(t * Math.PI) * s * 0.52, -s + t * 2 * s) }
  for (let k = 1; k <= 8; k++) { const t = k / 8; g.lineTo(-Math.sin(t * Math.PI) * s * 0.52, s - t * 2 * s) }
  g.closePath(); g.fillPath()
  g.fillStyle(lite, 0.35); g.beginPath(); g.moveTo(0, -s); for (let k = 1; k <= 8; k++) { const t = k / 8; g.lineTo(Math.sin(t * Math.PI) * s * 0.26, -s + t * 1.4 * s) } g.lineTo(0, -s + s * 0.2); g.closePath(); g.fillPath()
  g.lineStyle(Math.max(0.5, s * 0.1), dark, 0.6); g.beginPath(); g.moveTo(0, -s * 0.9); g.lineTo(0, s * 0.9); g.strokePath()
}

// A necrotic SOUL-WISP — a teardrop flame-head with a trailing wispy tail and a
// hot core, drawn additive so it reads as cold spectral fire. The hero element of
// the Lich SOUL HARVEST kit; deliberately a flame/tail silhouette (NOT a circle).
function _drawSoulWisp(g, s, color) {
  const dark = _lerpColor(color, 0x002a14, 0.55), pale = _lerpColor(color, 0xffffff, 0.6)
  // wispy upward tail — a thin flickering streamer behind the head
  g.fillStyle(dark, 0.4); g.beginPath()
  g.moveTo(-s * 0.16, s * 0.2); g.lineTo(s * 0.16, s * 0.2)
  g.lineTo(s * 0.05, s * 1.5); g.lineTo(-s * 0.05, s * 1.5); g.closePath(); g.fillPath()
  // flame head — a lobed teardrop, pointed at the top
  g.fillStyle(color, 0.62); g.beginPath()
  const N = 14
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2
    const top = Math.cos(a) > 0.2
    const ry = top ? 1.25 : 0.92
    const wob = 0.82 + 0.22 * Math.sin(a * 3 + 1.1)
    const px = Math.sin(a) * s * 0.7 * wob
    const py = -Math.cos(a) * s * ry * wob + s * 0.1
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py)
  }
  g.closePath(); g.fillPath()
  g.fillStyle(pale, 0.55); g.fillCircle(0, -s * 0.05, s * 0.34)        // hot core
  g.fillStyle(0xffffff, 0.6); g.fillCircle(-s * 0.06, -s * 0.16, s * 0.14)  // spec
}

// A flowing DREAD-SPIRIT — a faceless ghost/soul form: a luminous rounded head
// trailing THREE frayed wisp-tails that taper to points, a faint hollow for depth, a
// hot core + spec. Baked head-UP (tails trailing down) so it banks to face its flight.
// Richer than the Lich's single-tail _drawSoulWisp; cold spectral light (drawn additive).
function _drawDreadSpirit(g, s, color) {
  const cold = color, deep = _lerpColor(color, 0x0a1430, 0.6), pale = _lerpColor(color, 0xffffff, 0.62)
  // soft glow halo — a few faint discs behind everything (cold light bleeding out)
  for (let i = 5; i >= 1; i--) { g.fillStyle(cold, 0.045); g.fillCircle(0, 0, i * s * 0.34) }
  // 3 frayed tails trailing DOWN (behind the head), each a wavy tapering ribbon to a point
  // with a brighter inner spine so it reads as flowing soul-light, not a faint smudge.
  const ribbon = (kx, len, baseW, ph, col, al, wmul) => {
    g.fillStyle(col, al); g.beginPath()
    const segs = 9
    for (let i = 0; i <= segs; i++) { const t = i / segs, y = s * 0.18 + t * len, w = baseW * wmul * (1 - t) * (0.68 + 0.32 * Math.sin(t * 7 + ph)), cx = kx + Math.sin(t * 4 + ph) * s * 0.2 * t; const px = cx - w; if (i === 0) g.moveTo(px, y); else g.lineTo(px, y) }
    for (let i = segs; i >= 0; i--) { const t = i / segs, y = s * 0.18 + t * len, w = baseW * wmul * (1 - t) * (0.68 + 0.32 * Math.sin(t * 7 + ph + 1)), cx = kx + Math.sin(t * 4 + ph) * s * 0.2 * t; g.lineTo(cx + w, y) }
    g.closePath(); g.fillPath()
  }
  const tail = (kx, len, baseW, ph) => { ribbon(kx, len, baseW, ph, cold, 0.42, 1); ribbon(kx, len * 0.86, baseW, ph, pale, 0.4, 0.42) }
  tail(-s * 0.26, s * 1.7, s * 0.16, 0.5)
  tail(s * 0.02, s * 2.15, s * 0.2, 2.1)
  tail(s * 0.27, s * 1.5, s * 0.14, 3.5)
  // head — a flowing rounded ghost head (faceless), pointed slightly at the top
  g.fillStyle(cold, 0.6); g.beginPath()
  const N = 16
  for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, top = Math.cos(a) > 0, ry = top ? 1.06 : 0.82, wob = 0.85 + 0.18 * Math.sin(a * 3 + 0.7); const px = Math.sin(a) * s * 0.72 * wob, py = -Math.cos(a) * s * ry * wob; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) }
  g.closePath(); g.fillPath()
  g.fillStyle(deep, 0.28); g.fillEllipse(0, s * 0.1, s * 0.66, s * 0.66)        // faint inner hollow (depth, not a flat blob)
  g.fillStyle(pale, 0.78); g.fillCircle(0, -s * 0.18, s * 0.32)                 // hot cold-light core
  g.fillStyle(0xffffff, 0.78); g.fillCircle(-s * 0.08, -s * 0.27, s * 0.13)     // spec glint
}

// A detailed SOUL / departed spirit (centred near 0,0, head up): a cold halo,
// THREE frayed soul-tails trailing down, a flowing robed veil, and a ghost head
// with HOLLOW eyes + an open WAILING mouth — the unmistakable "this is a soul"
// read. Tinted any soul hue (green/violet); drawn additive so it glows.
function _drawSoul(g, s, color) {
  const cold = color
  const pale = _lerpColor(color, 0xffffff, 0.62)
  const dark = _lerpColor(color, 0x05060f, 0.80)
  // soft cold halo bleeding out behind everything
  for (let i = 5; i >= 1; i--) { g.fillStyle(cold, 0.05); g.fillCircle(0, -s * 0.1, i * s * 0.32) }
  // 3 frayed, wavy soul-tails tapering to points (flowing spectral light)
  const ribbon = (kx, len, baseW, ph, col, al, wmul) => {
    g.fillStyle(col, al); g.beginPath()
    const segs = 9
    for (let i = 0; i <= segs; i++) { const t = i / segs, y = s * 0.3 + t * len, w = baseW * wmul * (1 - t) * (0.66 + 0.34 * Math.sin(t * 7 + ph)), cx = kx + Math.sin(t * 4 + ph) * s * 0.22 * t; const px = cx - w; if (i === 0) g.moveTo(px, y); else g.lineTo(px, y) }
    for (let i = segs; i >= 0; i--) { const t = i / segs, y = s * 0.3 + t * len, w = baseW * wmul * (1 - t) * (0.66 + 0.34 * Math.sin(t * 7 + ph + 1)), cx = kx + Math.sin(t * 4 + ph) * s * 0.22 * t; g.lineTo(cx + w, y) }
    g.closePath(); g.fillPath()
  }
  const tail = (kx, len, baseW, ph) => { ribbon(kx, len, baseW, ph, cold, 0.4, 1); ribbon(kx, len * 0.85, baseW, ph, pale, 0.34, 0.4) }
  tail(-s * 0.34, s * 1.7, s * 0.18, 0.5)
  tail(s * 0.0, s * 2.1, s * 0.22, 2.1)
  tail(s * 0.34, s * 1.55, s * 0.16, 3.5)
  // flowing robed veil flaring under the head (frayed lower hem)
  g.fillStyle(cold, 0.5); g.beginPath()
  g.moveTo(-s * 0.34, -s * 0.2); g.lineTo(s * 0.34, -s * 0.2)
  g.lineTo(s * 0.8, s * 0.55); g.lineTo(s * 0.3, s * 0.42); g.lineTo(0, s * 0.62); g.lineTo(-s * 0.3, s * 0.42); g.lineTo(-s * 0.8, s * 0.55)
  g.closePath(); g.fillPath()
  // ghost head — rounded, slightly pointed at the crown
  g.fillStyle(cold, 0.64); g.beginPath()
  const N = 16
  for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, top = Math.cos(a) > 0, ry = top ? 1.12 : 0.86, wob = 0.85 + 0.18 * Math.sin(a * 3 + 0.7); const px = Math.sin(a) * s * 0.66 * wob, py = -Math.cos(a) * s * ry * wob - s * 0.5; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) }
  g.closePath(); g.fillPath()
  g.fillStyle(pale, 0.3); g.fillCircle(0, -s * 0.62, s * 0.4)                  // inner cold glow
  // FACE — hollow eye voids + an open wailing mouth
  g.fillStyle(dark, 0.94)
  g.fillEllipse(-s * 0.24, -s * 0.72, s * 0.2, s * 0.34)
  g.fillEllipse(s * 0.24, -s * 0.72, s * 0.2, s * 0.34)
  g.fillEllipse(0, -s * 0.3, s * 0.18, s * 0.32)
  g.fillStyle(pale, 0.7); g.fillCircle(0, -s * 0.55, s * 0.15)                 // hot core
  g.fillStyle(0xffffff, 0.8); g.fillCircle(-s * 0.18, -s * 0.84, s * 0.12)     // spec glint
}

// A "soul" rendered from the actual T1 GHOST minion sprite (animated idle frames
// → reads as a living ghostly creature, not a static blob), RECOLORED via tint so
// it doesn't match the in-game ghost minion, with a spectral glow. Falls back to
// the drawn _drawSoul if the ghost sheet isn't loaded. Default faces the viewer
// ('down'); pass dir for directional travel. Caller owns position/alpha tweens.
function _makeSoulSprite(scene, x, y, opts = {}) {
  if (!scene || typeof scene.add?.sprite !== 'function') return null   // headless-safe
  const o = { color: 0x9affc0, depth: 15, scale: 0.55, dir: 'down', alpha: 0.95, flipX: false, ...opts }
  if (scene.textures && scene.textures.exists('minion-ghost1-idle')) {
    const sp = scene.add.sprite(x, y, 'minion-ghost1-idle').setDepth(o.depth).setScale(o.scale).setAlpha(o.alpha)
    sp.setTint(o.color)
    if (o.flipX) sp.setFlipX(true)
    const anim = `minion-ghost1-idle-${o.dir}`
    try { if (scene.anims.exists(anim)) sp.play(anim) } catch (e) {}
    try { sp.postFX.addGlow(o.color, 2.5, 0, false, 0.1, 8) } catch (e) {}
    return sp
  }
  const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(o.scale * 1.8).setAlpha(o.alpha)
  _drawSoul(g, 9, o.color); _glow(g, o.color, 3, 10)
  return g
}

// Pick the ghost idle facing for a travel vector (so a soul faces where it goes).
function _soulDir(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

// Depth + perspective cue for an element ORBITING a sprite on a tilted ellipse
// (y = cy + sin(ang)·Ry). BEHIND at the top of the ring (sin<0 → depth below the
// sprite so it's occluded) and IN FRONT at the bottom (sin>0 → above), with a
// smooth size+brightness falloff toward the back. `baseDepth` = the orbited
// sprite's render depth. The standard for any orbiting aura element.
function _orbitCue(ang, baseDepth, baseScale = 1, baseAlpha = 1, spread = 0.7) {
  const sa = Math.sin(ang), front = (sa + 1) / 2
  return { depth: baseDepth + sa * spread, scale: baseScale * (0.72 + 0.42 * front), alpha: baseAlpha * (0.5 + 0.5 * front) }
}

// ── Shared SOUL-AURA pieces (used by BossRenderer's live aura AND the lab
// preview primitive, so they can never visually drift) ───────────────────────
// Saturation → aura colour: cold teal → green → violet → bright violet, then
// lerped toward searing white-violet through the overflow band.
function _soulAuraColor(sat, overK) {
  let col
  if (sat < 0.4)       col = _lerpColor(0x3aa0a0, 0x66dd88, sat / 0.4)
  else if (sat < 0.75) col = _lerpColor(0x66dd88, 0x9a6cff, (sat - 0.4) / 0.35)
  else                 col = _lerpColor(0x9a6cff, 0xc0a0ff, (sat - 0.75) / 0.25)
  if (overK > 0) col = _lerpColor(col, 0xf0e6ff, overK * 0.8)
  return col
}
// The "real aura" parameters — a Glow postFX that traces the sprite silhouette
// (same technique as the demon's burning wreath). Returns { color, strength } for
// `sprite.postFX.addGlow(color, strength, …)`; strength pulses + scales with
// saturation/overflow so the outline breathes and brightens with the hoard.
function _soulGlowParams(sat, overK, now) {
  const col   = _soulAuraColor(sat, overK)
  const pulse = 0.78 + 0.22 * Math.sin((now || 0) * 0.005) + overK * 0.25 * Math.sin((now || 0) * 0.013)
  const base  = 0.6 + 3.4 * sat + overK * 1.8
  return { color: col, strength: Math.max(0.4, base * pulse) }
}

// Generic boss AURA glow params (the standard pulsing Glow-OUTLINE aura) — colour
// lerps lo→hi by saturation, strength pulses + scales with saturation. For any
// boss whose aura is a single hue ramp (e.g. the Slime's green Mass aura).
function _auraGlowParams(sat, now, lo, hi) {
  const s = Math.max(0, Math.min(1, sat))
  const pulse = 0.78 + 0.22 * Math.sin((now || 0) * 0.005)
  const base  = 0.6 + 3.2 * s
  return { color: _lerpColor(lo, hi, s), strength: Math.max(0.4, base * pulse) }
}
// A small ghostly wisp that rises off a point and fades (world-space, self-cleaning).
function _spawnSoulWispGfx(scene, x, y, dsz, col, depth) {
  if (typeof scene.add?.graphics !== 'function') return null
  const ox = (Math.random() - 0.5) * dsz * 0.5
  const w = scene.add.graphics().setPosition(x + ox, y - dsz * 0.1).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0)
  w.fillStyle(col, 0.55); w.fillEllipse(0, 0, 5, 8)
  w.fillStyle(0xffffff, 0.4); w.fillCircle(0, -1, 1.6)
  scene.tweens.add({ targets: w, y: w.y - 22 - Math.random() * 14, x: w.x + (Math.random() - 0.5) * 12, alpha: 0.8, duration: 320, ease: 'Sine.easeOut',
    onComplete: () => scene.tweens.add({ targets: w, y: w.y - 16, alpha: 0, duration: 360, onComplete: () => w.destroy() }) })
  return w
}

// A cracked PHYLACTERY soul-gem — a faceted diamond-cut gem with a jagged crack
// and an inner soul-glow. The Lich's death/rebirth vessel.
function _drawPhylactery(g, s, color) {
  const dark = _lerpColor(color, 0x001a10, 0.6), lite = _lerpColor(color, 0xffffff, 0.5)
  const facet = (col, al, k) => {
    g.fillStyle(col, al); g.beginPath()
    g.moveTo(0, -s * 1.15 * k)
    g.lineTo(s * 0.7 * k, -s * 0.25 * k)
    g.lineTo(0, s * 1.15 * k)
    g.lineTo(-s * 0.7 * k, -s * 0.25 * k)
    g.closePath(); g.fillPath()
  }
  facet(dark, 0.7, 1.12)            // dark under-edge
  facet(color, 0.95, 1)             // gem body
  g.fillStyle(lite, 0.45); g.beginPath()   // left light facet
  g.moveTo(0, -s * 1.15); g.lineTo(-s * 0.7, -s * 0.25); g.lineTo(0, 0); g.closePath(); g.fillPath()
  g.fillStyle(_lerpColor(color, 0xffffff, 0.75), 0.7); g.fillCircle(0, -s * 0.1, s * 0.26)   // inner soul-glow
  g.lineStyle(Math.max(0.6, s * 0.12), 0x06140d, 0.85)               // jagged crack
  g.beginPath(); g.moveTo(-s * 0.12, -s * 0.85); g.lineTo(s * 0.1, -s * 0.1); g.lineTo(-s * 0.08, s * 0.5); g.strokePath()
}

// A small reptile SCALE — a shaded rounded-diamond plate with a glossy highlight.
// The Lizardman camouflage building block (scatters on a vanish, bursts on a strike).
function _drawScaleFleck(g, s, color) {
  const dark = _lerpColor(color, 0x06160a, 0.5), lite = _lerpColor(color, 0xeaffe0, 0.55)
  g.fillStyle(dark, 0.85); g.beginPath()
  g.moveTo(0, -s * 1.15); g.lineTo(s * 0.78, 0); g.lineTo(0, s * 1.1); g.lineTo(-s * 0.78, 0); g.closePath(); g.fillPath()
  g.fillStyle(color, 0.92); g.beginPath()
  g.moveTo(0, -s * 0.92); g.lineTo(s * 0.62, 0); g.lineTo(0, s * 0.88); g.lineTo(-s * 0.62, 0); g.closePath(); g.fillPath()
  g.fillStyle(lite, 0.5); g.fillEllipse(-s * 0.14, -s * 0.28, s * 0.5, s * 0.34)   // glossy highlight
}

// A small EMBER — a shaded upward flame-mote (teardrop pointed up + hot core).
// The Imp blink building block (puffs out on a teleport, scatters on arrival).
function _drawEmber(g, s, color) {
  const hot = _lerpColor(color, 0xffe8a0, 0.6)
  g.fillStyle(_lerpColor(color, 0x661100, 0.4), 0.7); g.beginPath()
  g.moveTo(0, -s * 1.4); g.lineTo(s * 0.6, s * 0.2); g.lineTo(0, s * 0.7); g.lineTo(-s * 0.6, s * 0.2); g.closePath(); g.fillPath()
  g.fillStyle(color, 0.85); g.beginPath()
  g.moveTo(0, -s); g.lineTo(s * 0.42, s * 0.2); g.lineTo(0, s * 0.5); g.lineTo(-s * 0.42, s * 0.2); g.closePath(); g.fillPath()
  g.fillStyle(hot, 0.7); g.fillCircle(0, s * 0.05, s * 0.3)
}

// A curling VINE tendril (stroked wavy taper + two little leaves), drawn along the
// local +x axis from the origin. The caller rotates/scales it. Plant entangle block.
function _drawVine(g, len, color) {
  const dark = _lerpColor(color, 0x0c2a08, 0.5), lite = _lerpColor(color, 0xcfe89a, 0.45)
  const segs = 10, amp = len * 0.16
  const px = (k) => k * len, py = (k) => Math.sin(k * Math.PI * 2.4) * amp * (1 - k * 0.4)
  g.lineStyle(Math.max(1.4, len * 0.09), dark, 0.9); g.beginPath(); g.moveTo(0, 0)
  for (let i = 1; i <= segs; i++) { const k = i / segs; g.lineTo(px(k), py(k)) } g.strokePath()
  g.lineStyle(Math.max(0.8, len * 0.05), color, 0.95); g.beginPath(); g.moveTo(0, 0)
  for (let i = 1; i <= segs; i++) { const k = i / segs; g.lineTo(px(k), py(k)) } g.strokePath()
  for (const k of [0.45, 0.78]) { g.fillStyle(lite, 0.7); g.fillEllipse(px(k), py(k) - len * 0.06, len * 0.12, len * 0.06) }
}

// A tiny TOADSTOOL — a domed cap (with spots) on a pale stalk. The Mushroom
// hallucination building block (a few puff out of a spore cloud).
function _drawSporeCap(g, s, color) {
  const dark = _lerpColor(color, 0x2a1040, 0.45), lite = _lerpColor(color, 0xffffff, 0.45)
  g.fillStyle(0xe8dcc0, 0.85); g.fillRect(-s * 0.16, -s * 0.15, s * 0.32, s * 0.72)   // stalk
  g.fillStyle(dark, 0.85); g.fillEllipse(0, -s * 0.02, s * 1.7, s * 0.5)              // cap rim (underside)
  g.fillStyle(color, 0.95); g.fillEllipse(0, -s * 0.26, s * 1.55, s * 0.92)           // domed cap
  g.fillStyle(lite, 0.6); g.fillCircle(-s * 0.3, -s * 0.42, s * 0.16); g.fillCircle(s * 0.28, -s * 0.32, s * 0.12)   // spots
}

// ── Orc Veteran (Trophy Hunter) weapon silhouettes ──────────────────────────
// Drawn into a Graphics centred at 0,0, pointing +X (blade/head to the right) so
// callers can rotate the whole graphics to any direction. Shaded iron with a
// drop shadow + bright edge so they read as forged metal, not flat shapes.

// A heavy double-bitted WAR AXE (haft along X, head at +X). `s` ≈ head size.
function _drawWarAxe(g, s, iron = 0xc7ccd6) {
  const dark = _lerpColor(iron, 0x000000, 0.45), lite = _lerpColor(iron, 0xffffff, 0.5)
  g.fillStyle(0x3a2a18, 1); g.fillRect(-s * 1.6, -s * 0.12, s * 2.3, s * 0.24)        // wooden haft
  g.fillStyle(0x5a4326, 1); g.fillRect(-s * 1.6, -s * 0.12, s * 2.3, s * 0.10)        // haft highlight
  // axe head — two crescent bits around the haft top
  const bit = (dir) => {
    g.fillStyle(dark, 1); g.beginPath()
    g.moveTo(s * 0.5, 0)
    g.lineTo(s * 0.62, dir * s * 0.95)
    g.lineTo(s * 1.18, dir * s * 0.62)
    g.lineTo(s * 1.05, 0)
    g.closePath(); g.fillPath()
    g.fillStyle(iron, 1); g.beginPath()
    g.moveTo(s * 0.5, 0); g.lineTo(s * 0.58, dir * s * 0.82)
    g.lineTo(s * 1.08, dir * s * 0.55); g.lineTo(s * 0.98, 0); g.closePath(); g.fillPath()
    g.lineStyle(1.2, lite, 0.9); g.beginPath(); g.moveTo(s * 0.58, dir * s * 0.82); g.lineTo(s * 1.08, dir * s * 0.55); g.strokePath()  // edge glint
  }
  bit(-1); bit(1)
  g.fillStyle(0x2a2f38, 1); g.fillRect(s * 0.38, -s * 0.3, s * 0.22, s * 0.6)         // iron collar
}

// A KITE SHIELD (boss faces +X). `s` ≈ shield height. `color` tints the boss.
function _drawKiteShield(g, s, color = 0xc9a23f) {
  const dark = _lerpColor(color, 0x000000, 0.5), lite = _lerpColor(color, 0xffffff, 0.5)
  g.fillStyle(0x111316, 0.5); g.fillEllipse(2, 2, s * 0.9, s * 1.15)                  // shadow
  g.fillStyle(0x6a6f78, 1); g.beginPath()                                            // iron body
  g.moveTo(0, -s * 0.6); g.lineTo(s * 0.42, -s * 0.36); g.lineTo(s * 0.42, s * 0.12)
  g.lineTo(0, s * 0.62); g.lineTo(-s * 0.42, s * 0.12); g.lineTo(-s * 0.42, -s * 0.36)
  g.closePath(); g.fillPath()
  g.fillStyle(0x868c96, 1); g.beginPath()                                            // lit left face
  g.moveTo(0, -s * 0.6); g.lineTo(0, s * 0.62); g.lineTo(-s * 0.42, s * 0.12); g.lineTo(-s * 0.42, -s * 0.36); g.closePath(); g.fillPath()
  g.fillStyle(color, 0.9); g.fillCircle(0, -s * 0.05, s * 0.2)                        // boss emblem
  g.fillStyle(lite, 0.8); g.fillCircle(-s * 0.05, -s * 0.1, s * 0.08)
  g.lineStyle(2, 0x3a3e44, 1); g.beginPath()                                          // rim
  g.moveTo(0, -s * 0.6); g.lineTo(s * 0.42, -s * 0.36); g.lineTo(s * 0.42, s * 0.12)
  g.lineTo(0, s * 0.62); g.lineTo(-s * 0.42, s * 0.12); g.lineTo(-s * 0.42, -s * 0.36); g.closePath(); g.strokePath()
}

// A CHAINED ORB of stolen magic (centred 0,0): glowing core + 4 crude iron chain
// links rattling around it. `s` ≈ orb radius. `color` is the arcane hue.
function _drawChainedOrb(g, s, color = 0x9a6cff) {
  const lite = _lerpColor(color, 0xffffff, 0.6)
  g.fillStyle(0x4a3a6a, 1)                                                            // 4 iron links around the orb
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + 0.4, lx = Math.cos(a) * s * 1.25, ly = Math.sin(a) * s * 1.25
    g.fillRoundedRect(lx - s * 0.36, ly - s * 0.22, s * 0.72, s * 0.44, s * 0.2)
    g.fillStyle(0x2a2030, 1); g.fillRoundedRect(lx - s * 0.2, ly - s * 0.1, s * 0.4, s * 0.2, s * 0.08)
    g.fillStyle(0x4a3a6a, 1)
  }
  g.fillStyle(color, 0.95); g.fillCircle(0, 0, s)                                     // arcane core
  g.fillStyle(lite, 0.9); g.fillCircle(-s * 0.28, -s * 0.3, s * 0.4)                  // hot inner
  g.fillStyle(0xffffff, 0.85); g.fillCircle(-s * 0.34, -s * 0.36, s * 0.16)           // glint
}

// A crescent CLEAVE arc band centred on 0,0, spanning ±half around +X, between
// radius rIn..rOut. Iron body + bright class-color edge. The hero shape of Cleave.
function _drawCrescentBand(g, rOut, rIn, half, iron, edge) {
  g.fillStyle(iron, 0.92); g.beginPath()
  g.arc(0, 0, rOut, -half, half, false)
  g.arc(0, 0, rIn, half, -half, true)
  g.closePath(); g.fillPath()
  g.lineStyle(2.6, edge, 0.95); g.beginPath(); g.arc(0, 0, rOut, -half, half, false); g.strokePath()        // leading edge glint
  g.lineStyle(1.2, _lerpColor(iron, 0xffffff, 0.4), 0.6); g.beginPath(); g.arc(0, 0, rIn, -half, half, false); g.strokePath()
}

// Linear-interpolate two 0xRRGGBB colours (t in 0..1). For stack-scaled tints.
function _lerpColor(a, b, t) {
  const k = Math.max(0, Math.min(1, t))
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
  return ((Math.round(ar + (br - ar) * k) << 16) |
          (Math.round(ag + (bg - ag) * k) << 8) |
           Math.round(ab + (bb - ab) * k))
}

// Soft radial-gradient dot texture for GPU particle emitters — generated once
// per scene and cached. White so it can be tinted any colour; additive blend
// turns it into a glowing mote. (Phaser has no built-in soft-particle texture.)
function _softDotTexture(scene) {
  const key = '__qf_softdot'
  if (scene.textures.exists(key)) return key
  const R = 16
  const g = scene.make.graphics({ x: 0, y: 0, add: false })
  for (let r = R; r > 0; r--) { g.fillStyle(0xffffff, 0.05); g.fillCircle(R, R, r) }
  g.generateTexture(key, R * 2, R * 2)
  g.destroy()
  return key
}

// Named effect palettes — keep VFX visually coherent + on-brand. Each: a primary
// + accent tint. Pass `palette: 'fire'` to the toolkit helpers (resolved by _pal).
export const VfxPalette = {
  fire:   { color: 0xff6622, accent: 0xffd23f },
  ice:    { color: 0x66ccff, accent: 0xeaffff },
  holy:   { color: 0xffe066, accent: 0xffffff },
  shadow: { color: 0x9b59ff, accent: 0x3a1d6e },
  poison: { color: 0x66dd33, accent: 0xccff66 },
  arcane: { color: 0xff5fbf, accent: 0x66e0ff },
  blood:  { color: 0xcc1133, accent: 0xff5566 },
}
function _pal(opts = {}) {
  const p = opts.palette && VfxPalette[opts.palette]
  if (p) { if (opts.color == null) opts.color = p.color; if (opts.accent == null) opts.accent = p.accent }
  return opts
}

// Beholder Eye Tyrant — the on-hit motif drawn at a ray's target. Each ray
// kind gets a distinct geometric silhouette (stone crackle / siphon chevrons /
// hex sigil / disintegration burst / null-rune / tar-web). Graphics-only.
function _drawRayImpact(g, kind, p, tier) {
  switch (kind) {
    case 'petrify': {
      g.lineStyle(2, p.hit, 0.9);  g.strokeCircle(0, 0, 12)
      g.lineStyle(1, _lerpColor(p.hit, 0x000000, 0.4), 0.8); g.strokeCircle(0, 0, 16)
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.lineStyle(1.4, p.core, 0.7); g.beginPath(); g.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); g.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); g.strokePath() }
      break
    }
    case 'drain': {
      for (let i = 0; i < 4; i++) { const r = 6 + i * 5; g.lineStyle(2, p.core, 0.85 - i * 0.15); g.beginPath(); g.moveTo(-r, -r * 0.7); g.lineTo(0, 0); g.lineTo(-r, r * 0.7); g.strokePath() }
      g.fillStyle(p.hit, 0.5); g.fillCircle(0, 0, 5)
      break
    }
    case 'hex': {
      const tri = (rad, rot, col, a) => { g.lineStyle(2, col, a); g.beginPath(); for (let i = 0; i < 3; i++) { const an = rot + i * (Math.PI * 2 / 3), px = Math.cos(an) * rad, py = Math.sin(an) * rad; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.closePath(); g.strokePath() }
      tri(15, -Math.PI / 2, p.core, 0.9); tri(15, Math.PI / 2, p.hit, 0.7)
      g.fillStyle(p.core, 0.6); g.fillCircle(0, 0, 3)
      break
    }
    case 'disintegrate': {
      g.fillStyle(0xffffff, 0.9); g.fillCircle(0, 0, 6)
      g.lineStyle(1.5, p.edge, 0.85)
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, r1 = 18 + tier * 2; g.beginPath(); g.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.strokePath() }
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, d = 6 + i * 1.7; g.fillStyle(p.hit, 0.7); g.fillRect(Math.cos(a) * d - 1.5, Math.sin(a) * d - 1.5, 3, 3) }
      break
    }
    case 'silence': {
      g.lineStyle(2, p.core, 0.9); g.strokeCircle(0, 0, 11)
      g.lineStyle(2.4, p.hit, 0.95); g.beginPath(); g.moveTo(-8, -8); g.lineTo(8, 8); g.strokePath()
      break
    }
    case 'slow': {
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.lineStyle(1.4, p.core, 0.7); g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 15, Math.sin(a) * 15); g.strokePath() }
      g.lineStyle(1.2, p.hit, 0.6)
      for (let ring = 1; ring <= 2; ring++) { g.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2, r = ring * 6, px = Math.cos(a) * r, py = Math.sin(a) * r; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.strokePath() }
      break
    }
  }
}

// Beholder ray palette — bright core / dark edge / on-hit accent, per ray kind.
const _BEHOLDER_RAY_PAL = {
  petrify:      { core: 0xe8dcc0, edge: 0xb98a5a, hit: 0xc4a484 },
  drain:        { core: 0xff6a7a, edge: 0x8a1020, hit: 0xff3a55 },
  hex:          { core: 0xc9a6ff, edge: 0x5a2a8a, hit: 0x9a6cff },
  disintegrate: { core: 0xffffff, edge: 0x9a6cff, hit: 0xe8d0ff },
  silence:      { core: 0xbfc6e8, edge: 0x33406a, hit: 0x8a96c8 },
  slow:         { core: 0x9adcff, edge: 0x1a4a7a, hit: 0x5ab0e0 },
}

// ── Beholder per-ray BEAM BODIES — each ray gets a distinct silhouette, motion,
// and impact (not a recoloured lance). All drawn at the eye, rotated to target.
// Particle-driven + continuously animated; each returns made[] + owns its tweens.

// Petrify — a jagged STONE bolt crystallizes from the eye toward the target,
// kicking up rock-dust, then bursts into a crackle-ring + flying shards. Opaque.
function _beamPetrify(scene, x, y, ang, len, p, tier, depth, holdMs) {
  const made = [], mult = _particlesMult(), cos = Math.cos(ang), sin = Math.sin(ang), w = 4 + tier
  const g = scene.add.graphics().setPosition(x, y).setRotation(ang).setDepth(depth); made.push(g)
  const n = Math.max(5, Math.round(len / 18))
  const drawTo = (frac) => {
    g.clear(); const lim = len * frac
    for (let i = 0; i < n; i++) {
      const fx = (len * i) / n; if (fx > lim) break
      const nx = Math.min(lim, (len * (i + 1)) / n), jit = (i * 7) % 5 - 2, hw = w * (0.7 + ((i * 13) % 7) / 10)
      g.fillStyle(_lerpColor(p.edge, 0x000000, 0.32), 0.96); g.beginPath(); g.moveTo(fx, -hw + jit); g.lineTo(nx, -hw * 0.6); g.lineTo(nx, hw * 0.6); g.lineTo(fx, hw + jit); g.closePath(); g.fillPath()
      g.fillStyle(_lerpColor(p.core, 0xffffff, 0.28), 0.9); g.beginPath(); g.moveTo(fx, -hw + jit); g.lineTo(nx, -hw * 0.6); g.lineTo((fx + nx) / 2, -hw * 0.1); g.closePath(); g.fillPath()
    }
  }
  const head = scene.add.graphics().setDepth(depth + 1); made.push(head)
  head.fillStyle(_lerpColor(p.core, 0xffffff, 0.45), 1); head.fillCircle(0, 0, w)
  let dust = null
  if (mult > 0) { dust = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 240, max: 460 }, speed: { min: 18, max: 70 }, scale: { start: 0.36, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [p.hit, _lerpColor(p.edge, 0x000000, 0.3)] }); dust.setDepth(depth + 0.5); made.push(dust) }
  scene.tweens.addCounter({ from: 0, to: 1, duration: 150, ease: 'Quad.easeOut',
    onUpdate: (tw) => { const f = tw.getValue(); drawTo(f); const hx = x + cos * len * f, hy = y + sin * len * f; head.setPosition(hx, hy); if (dust) dust.setPosition(hx, hy) },
    onComplete: () => {
      if (dust) dust.stop(); head.destroy()
      const tx = x + cos * len, ty = y + sin * len
      const burst = scene.add.graphics().setPosition(tx, ty).setDepth(depth + 1); made.push(burst)
      _drawRayImpact(burst, 'petrify', p, tier); burst.setScale(0.4)
      const holdHit = (holdMs ?? 0) > 0
      scene.tweens.add({ targets: burst, scale: 1, duration: 130, ease: 'Back.easeOut', onComplete: () => scene.tweens.add({ targets: burst, alpha: 0, duration: holdHit ? Math.min(holdMs, 2600) : 380, delay: 160, onComplete: () => burst.destroy() }) })
      for (let k = 0; k < 5 + tier; k++) { const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 22, sh = scene.add.graphics().setPosition(tx, ty).setDepth(depth + 1); made.push(sh); sh.fillStyle(_lerpColor(p.edge, 0x000000, 0.18), 0.95); sh.fillRect(-2, -2, 4, 4); scene.tweens.add({ targets: sh, x: tx + Math.cos(a) * d, y: ty + Math.sin(a) * d, alpha: 0, angle: 80 + Math.random() * 120, duration: 320 + Math.random() * 200, ease: 'Quad.easeOut', onComplete: () => sh.destroy() }) }
      scene.tweens.add({ targets: g, alpha: 0, duration: 420, delay: 240, onComplete: () => g.destroy() })
      if (dust) scene.time.delayedCall(520, () => { try { dust.destroy() } catch (e) {} })
    } })
  return made
}

// Drain — a SIPHON: a pulsing wavy crimson thread with blood-globule particles
// streaming from the target back INTO the eye, which brightens as it feeds.
function _beamDrain(scene, x, y, ang, len, p, tier, depth) {
  const made = [], mult = _particlesMult(), cos = Math.cos(ang), sin = Math.sin(ang)
  const ex = x + cos * len, ey = y + sin * len, amp = 3 + tier
  const g = scene.add.graphics().setPosition(x, y).setRotation(ang).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD); made.push(g); _glow(g, p.core, 3, 9)
  let ph = 0
  const draw = () => {
    g.clear()
    g.lineStyle(2.6, p.edge, 0.5); g.beginPath(); for (let i = 0; i <= 24; i++) { const t = i / 24, px = t * len, py = Math.sin(t * 9 + ph) * amp * (0.3 + t * 0.7); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.strokePath()
    g.lineStyle(1.3, p.core, 0.95); g.beginPath(); for (let i = 0; i <= 24; i++) { const t = i / 24, px = t * len, py = Math.sin(t * 9 + ph) * amp * (0.3 + t * 0.7); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.strokePath()
  }
  draw()
  let em = null
  if (mult > 0) { em = scene.add.particles(ex, ey, _softDotTexture(scene), { lifespan: 360, frequency: 32, quantity: 1, x: { min: -3, max: 3 }, y: { min: -amp, max: amp }, tint: [p.hit, 0xffffff], scale: { start: 0.5, end: 0.14 }, alpha: { start: 0.95, end: 0 }, blendMode: 'ADD', moveToX: x, moveToY: y }); em.setDepth(depth + 1); made.push(em) }
  const feed = scene.add.graphics().setPosition(x, y).setDepth(depth + 0.5).setBlendMode(Phaser.BlendModes.ADD); made.push(feed)
  feed.fillStyle(p.core, 0.85); feed.fillCircle(0, 0, 4); _glow(feed, p.core, 4, 10)
  scene.tweens.add({ targets: feed, scale: 2, duration: 200, yoyo: true, repeat: 1 })
  const tw = scene.tweens.addCounter({ from: 0, to: 1, duration: 480, onUpdate: () => { ph += 0.6; draw() } })
  scene.tweens.add({ targets: [g, feed], alpha: 0, duration: 180, delay: 420, onComplete: () => { tw.stop?.(); g.destroy(); feed.destroy(); if (em) { em.stop(); scene.time.delayedCall(400, () => { try { em.destroy() } catch (e) {} }) } } })
  return made
}

// Hex — a writhing CURSE RIBBON unfurls toward the target (undulating, glyph
// ticks), blooming into a spinning sigil + a puff of rune-motes.
function _beamHex(scene, x, y, ang, len, p, tier, depth) {
  const made = [], mult = _particlesMult(), cos = Math.cos(ang), sin = Math.sin(ang)
  const amp = 6 + tier * 1.6, w = 3 + tier
  const g = scene.add.graphics().setPosition(x, y).setRotation(ang).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD); made.push(g); _glow(g, p.core, 4, 11)
  const draw = (ph, frac) => {
    g.clear(); const lim = 24 * frac
    g.fillStyle(p.edge, 0.5); g.beginPath()
    for (let i = 0; i <= lim; i++) { const t = i / 24, px = t * len, py = Math.sin(t * 8 + ph) * amp - w * 0.5; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) }
    for (let i = Math.floor(lim); i >= 0; i--) { const t = i / 24, px = t * len, py = Math.sin(t * 8 + ph) * amp + w * 0.5; g.lineTo(px, py) }
    g.closePath(); g.fillPath()
    g.lineStyle(1.5, p.core, 0.95); g.beginPath()
    for (let i = 0; i <= lim; i++) { const t = i / 24, px = t * len, py = Math.sin(t * 8 + ph) * amp; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.strokePath()
    for (let i = 3; i < lim; i += 4) { const t = i / 24, px = t * len, py = Math.sin(t * 8 + ph) * amp; g.lineStyle(1.5, p.core, 0.85); g.beginPath(); g.moveTo(px, py - 4); g.lineTo(px, py + 4); g.strokePath() }
  }
  let ph = 0
  scene.tweens.addCounter({ from: 0, to: 1, duration: 300, ease: 'Quad.easeOut', onUpdate: (t) => { ph += 0.5; draw(ph, t.getValue()) },
    onComplete: () => {
      const tx = x + cos * len, ty = y + sin * len
      const sig = scene.add.graphics().setPosition(tx, ty).setDepth(depth + 1).setBlendMode(Phaser.BlendModes.ADD); made.push(sig)
      _drawRayImpact(sig, 'hex', p, tier); sig.setScale(0.4)
      scene.tweens.add({ targets: sig, scale: 1, duration: 150, ease: 'Back.easeOut' })
      scene.tweens.add({ targets: sig, rotation: Math.PI * 1.5, duration: 720, ease: 'Linear' })
      scene.tweens.add({ targets: sig, alpha: 0, duration: 380, delay: 320, onComplete: () => sig.destroy() })
      if (mult > 0) { const em = scene.add.particles(tx, ty, _softDotTexture(scene), { lifespan: { min: 300, max: 600 }, speed: { min: 20, max: 70 }, scale: { start: 0.42, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [p.core, p.hit], blendMode: 'ADD', emitting: false }); em.setDepth(depth + 1); em.explode(Math.round((8 + tier * 2) * mult)); made.push(em); scene.time.delayedCall(700, () => { try { em.destroy() } catch (e) {} }) }
      let ph2 = ph; const tw2 = scene.tweens.addCounter({ from: 0, to: 1, duration: 280, onUpdate: () => { ph2 += 0.5; draw(ph2, 1) } })
      scene.tweens.add({ targets: g, alpha: 0, duration: 220, delay: 200, onComplete: () => { tw2.stop?.(); g.destroy() } })
    } })
  return made
}

// Disintegrate — a DEATH-RAY: a thick searing-white beam snaps on, jagged edges
// re-flickering every frame, ending in a white blast + particle spray + shake.
function _beamDisintegrate(scene, x, y, ang, len, p, tier, depth) {
  const made = [], mult = _particlesMult(), cos = Math.cos(ang), sin = Math.sin(ang)
  const tx = x + cos * len, ty = y + sin * len, w = 6 + tier * 1.6
  const g = scene.add.graphics().setPosition(x, y).setRotation(ang).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD); made.push(g); _glow(g, 0xffffff, 7 + tier, 18)
  const draw = () => {
    g.clear()
    g.fillStyle(p.edge, 0.35); g.fillRect(0, -w * 1.5, len, w * 3)
    g.fillStyle(_lerpColor(p.hit, 0xffffff, 0.5), 0.6); g.fillRect(0, -w * 0.9, len, w * 1.8)
    g.fillStyle(0xffffff, 0.95); g.fillRect(0, -w * 0.42, len, w * 0.84)
    g.lineStyle(1.6, p.core, 0.9); for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, s * w * 0.7); for (let i = 1; i <= 14; i++) { const px = (len * i) / 14, py = s * (w * 0.7 + Math.random() * w * 1.1); g.lineTo(px, py) } g.strokePath() }
  }
  draw()
  const blast = scene.add.graphics().setPosition(tx, ty).setDepth(depth + 1).setBlendMode(Phaser.BlendModes.ADD); made.push(blast)
  blast.fillStyle(0xffffff, 0.9); blast.fillCircle(0, 0, 7); _glow(blast, p.hit, 6, 14)
  scene.tweens.add({ targets: blast, scale: 3, alpha: 0, duration: 320, ease: 'Expo.easeOut', onComplete: () => blast.destroy() })
  if (mult > 0) { const em = scene.add.particles(tx, ty, _softDotTexture(scene), { lifespan: { min: 200, max: 500 }, speed: { min: 60, max: 200 }, scale: { start: 0.5, end: 0 }, alpha: { start: 0.95, end: 0 }, tint: [0xffffff, p.edge], blendMode: 'ADD', emitting: false }); em.setDepth(depth + 1); em.explode(Math.round((14 + tier * 3) * mult)); made.push(em); scene.time.delayedCall(600, () => { try { em.destroy() } catch (e) {} }) }
  const tw = scene.tweens.addCounter({ from: 0, to: 1, duration: 240, onUpdate: () => { if (Math.random() < 0.6) draw() } })
  scene.tweens.add({ targets: g, alpha: 0, duration: 160, delay: 200, onComplete: () => { tw.stop?.(); g.destroy() } })
  scene.cameras?.main?.shake?.(140, 0.005)
  return made
}

// Silence — a NULL TUBE zips shut from eye to target (hollow muted-indigo rails +
// dashed crossbars appear progressively), then a crossed null-rune snaps in with
// faint static. Quiet by design (anti-magic).
function _beamSilence(scene, x, y, ang, len, p, tier, depth) {
  const made = [], mult = _particlesMult(), cos = Math.cos(ang), sin = Math.sin(ang)
  const tx = x + cos * len, ty = y + sin * len, w = 3 + tier
  const g = scene.add.graphics().setPosition(x, y).setRotation(ang).setDepth(depth); made.push(g)
  const draw = (frac) => {
    g.clear(); const lim = len * frac
    g.lineStyle(1.6, p.core, 0.55); g.beginPath(); g.moveTo(0, -w); g.lineTo(lim, -w); g.moveTo(0, w); g.lineTo(lim, w); g.strokePath()
    g.lineStyle(1.2, p.hit, 0.5); for (let fx = 6; fx < lim; fx += 10) { g.beginPath(); g.moveTo(fx, -w); g.lineTo(fx, w); g.strokePath() }
  }
  scene.tweens.addCounter({ from: 0, to: 1, duration: 150, ease: 'Quad.easeOut', onUpdate: (t) => draw(t.getValue()),
    onComplete: () => {
      const rune = scene.add.graphics().setPosition(tx, ty).setDepth(depth + 1); made.push(rune)
      _drawRayImpact(rune, 'silence', p, tier); rune.setScale(0.4)
      scene.tweens.add({ targets: rune, scale: 1, duration: 120, ease: 'Back.easeOut', onComplete: () => scene.tweens.add({ targets: rune, alpha: 0, duration: 300, delay: 160, onComplete: () => rune.destroy() }) })
      if (mult > 0) { const em = scene.add.particles(tx, ty, _softDotTexture(scene), { lifespan: { min: 200, max: 400 }, speed: { min: 10, max: 40 }, scale: { start: 0.26, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [p.core, p.hit] }); em.setDepth(depth + 1); em.explode(Math.round(6 * mult)); made.push(em); scene.time.delayedCall(420, () => { try { em.destroy() } catch (e) {} }) }
      scene.tweens.add({ targets: g, alpha: 0, duration: 220, delay: 200, onComplete: () => g.destroy() })
    } })
  return made
}

// Slow — a TAR GLOB lurches slowly from the eye to the target, wobbling and
// dripping a viscous trail, then splats into a tar-web. Heavy, low glow.
function _beamSlow(scene, x, y, ang, len, p, tier, depth) {
  const made = [], mult = _particlesMult(), cos = Math.cos(ang), sin = Math.sin(ang)
  const tx = x + cos * len, ty = y + sin * len, w = 4 + tier
  const g = scene.add.graphics().setPosition(x, y).setRotation(ang).setDepth(depth); made.push(g)
  const drawTrail = (frac) => {
    g.clear(); const lim = len * frac, n = Math.max(4, Math.round(lim / 18))
    for (let i = 0; i <= n; i++) { const fx = (lim * i) / n, bulge = w * (0.6 + 0.45 * Math.abs(Math.sin(i * 1.3))); g.fillStyle(_lerpColor(p.edge, 0x000000, 0.18), 0.55); g.fillEllipse(fx, 0, bulge * 2.2, bulge * 1.8) }
    g.fillStyle(p.core, 0.45); g.fillRect(0, -w * 0.4, lim, w * 0.8)
  }
  const head = scene.add.graphics().setDepth(depth + 1); made.push(head); _glow(head, p.hit, 2, 8)
  const drawHead = (s) => { head.clear(); head.fillStyle(_lerpColor(p.edge, 0x000000, 0.15), 0.85); head.fillEllipse(0, 0, (w + 3) * 2 * s, (w + 2) * 2 * s); head.fillStyle(_lerpColor(p.core, 0xffffff, 0.2), 0.6); head.fillCircle(-w * 0.3, -w * 0.3, w * 0.5 * s) }
  drawHead(1)
  let dripT = 0
  scene.tweens.addCounter({ from: 0, to: 1, duration: 360, ease: 'Sine.easeIn',
    onUpdate: (t) => {
      const f = t.getValue(); drawTrail(f); const hx = x + cos * len * f, hy = y + sin * len * f
      head.setPosition(hx, hy + Math.sin(f * 30) * 2); drawHead(0.8 + 0.2 * Math.sin(f * 20))
      if ((dripT++ % 6) === 0) { const dp = scene.add.graphics().setPosition(hx, hy).setDepth(depth + 0.5); dp.fillStyle(_lerpColor(p.edge, 0x000000, 0.15), 0.7); dp.fillCircle(0, 0, w * 0.4); made.push(dp); scene.tweens.add({ targets: dp, y: hy + 18 + Math.random() * 14, alpha: 0, scaleX: 0.6, scaleY: 1.4, duration: 420, ease: 'Quad.easeIn', onComplete: () => dp.destroy() }) }
    },
    onComplete: () => {
      head.destroy()
      const web = scene.add.graphics().setPosition(tx, ty).setDepth(depth + 1); made.push(web)
      _drawRayImpact(web, 'slow', p, tier); web.setScale(0.4)
      scene.tweens.add({ targets: web, scale: 1, duration: 160, ease: 'Back.easeOut', onComplete: () => scene.tweens.add({ targets: web, alpha: 0, duration: 420, delay: 260, onComplete: () => web.destroy() }) })
      if (mult > 0) { const em = scene.add.particles(tx, ty, _softDotTexture(scene), { lifespan: { min: 300, max: 600 }, speedX: { min: -50, max: 50 }, speedY: { min: -30, max: 60 }, gravityY: 120, scale: { start: 0.4, end: 0.1 }, alpha: { start: 0.8, end: 0 }, tint: [p.core, p.hit] }); em.setDepth(depth + 1); em.explode(Math.round((8 + tier * 2) * mult)); made.push(em); scene.time.delayedCall(700, () => { try { em.destroy() } catch (e) {} }) }
      scene.tweens.add({ targets: g, alpha: 0, duration: 380, delay: 300, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    } })
  return made
}

const _BEHOLDER_BEAM_BUILDERS = {
  petrify: _beamPetrify, drain: _beamDrain, hex: _beamHex,
  disintegrate: _beamDisintegrate, silence: _beamSilence, slow: _beamSlow,
}

export const AbilityVfx = {
  // ── POC (2026-06-05): the same "burst" as particleBurst() but rebuilt on
  // Phaser 3.60's GPU particle emitter + additive blend + a Glow post-FX, vs the
  // hand-drawn tweened circles below. Demonstrates the quality jump from
  // procedural Graphics → real engine VFX. `opts.slow` stretches the lifetime
  // for slow-mo filmstrip capture. Falls back gracefully on the Canvas renderer.
  particleBurstFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe066, count: 26, durationMs: 520, depth: 7, speed: 130, ...opts }
    const slow = o.slow ?? 1
    const life = o.durationMs * slow
    const mult = _particlesMult()
    if (mult <= 0) return null
    const created = []
    const tex = _softDotTexture(scene)

    // 1) GPU particle burst — soft glowing motes, additive, fading + shrinking.
    const emitter = scene.add.particles(x, y, tex, {
      lifespan: { min: life * 0.6, max: life },
      speed: { min: o.speed * 0.35, max: o.speed },
      angle: { min: 0, max: 360 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.95, end: 0 },
      tint: o.color,
      blendMode: 'ADD',
      emitting: false,
    })
    emitter.setDepth(o.depth)
    emitter.explode(Math.max(3, Math.round(o.count * mult)))
    created.push(emitter)
    scene.lightingSystem?.flash(x, y, { color: o.color, radius: 78, durationMs: Math.max(300, o.durationMs), intensity: 0.7 })

    // 2) bright additive core flash with a Glow post-FX (WebGL only).
    const core = scene.add.circle(x, y, 6, o.color, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: small additive flash/glow core
    try { core.postFX.addGlow(o.color, 6, 0, false, 0.1, 14) } catch (e) {}
    created.push(core)
    scene.tweens.add({ targets: core, scale: 3.4, alpha: 0, duration: life * 0.7, ease: 'Cubic.easeOut', onComplete: () => core.destroy() })

    // 3) expanding glow shockring.
    const ring = scene.add.circle(x, y, 6, 0x000000, 0).setStrokeStyle(3, o.color, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)  // circle-ok: thin accent rim, not the hero shape
    try { ring.postFX.addGlow(o.color, 5, 0, false, 0.1, 10) } catch (e) {}
    created.push(ring)
    scene.tweens.add({ targets: ring, radius: 52, alpha: 0, duration: life, ease: 'Quint.easeOut', onComplete: () => ring.destroy() })

    scene.time.delayedCall(life + 120, () => { try { emitter.destroy() } catch (e) {} })
    return created
  },

  // ── VFX toolkit (2026-06-05) ────────────────────────────────────────────────
  // Next-gen primitives built on Phaser 3.60 GPU particles + additive blend +
  // Glow post-FX, vs the hand-drawn Graphics primitives further down. Compose
  // these for new effects. All: Canvas-safe (postFX in try/catch), quality-aware
  // (_particlesMult), self-cleaning, anchored at world (x,y), honour opts.slow
  // (stretches lifetimes for slow-mo filmstrip capture). See particleBurstFx above.

  // Punchy hit — white core flash (squash), dense radial spray, snap ring + glow.
  impactFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffffff, tint: 0xffd060, count: 22, durationMs: 360, depth: 8, speed: 200, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult()
    const made = []
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), {
        lifespan: { min: life * 0.4, max: life }, speed: { min: o.speed * 0.3, max: o.speed },
        angle: { min: 0, max: 360 }, scale: { start: 0.5, end: 0 }, alpha: { start: 1, end: 0 },
        tint: o.tint, blendMode: 'ADD', emitting: false,
      })
      em.setDepth(o.depth); em.explode(Math.max(4, Math.round(o.count * mult))); made.push(em)
      scene.time.delayedCall(life + 120, () => { try { em.destroy() } catch (e) {} })
    }
    const core = scene.add.circle(x, y, 5, o.color, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: small additive flash/glow core
    try { core.postFX.addGlow(o.tint, 7, 0, false, 0.1, 12) } catch (e) {}
    made.push(core)
    scene.tweens.add({ targets: core, scale: 4, alpha: 0, duration: life * 0.5, ease: 'Expo.easeOut', onComplete: () => core.destroy() })
    made.push(this.shockwaveFx(scene, x, y, { color: o.tint, toR: 40, durationMs: o.durationMs, slow, depth: o.depth }))  // circle-ok: deliberate shock-ring accent, not the sole read
    return made
  },

  // Expanding glow ring(s) — clean energy shockwave, no particles.
  shockwaveFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe066, fromR: 6, toR: 56, durationMs: 480, depth: 6, rings: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    for (let i = 0; i < o.rings; i++) {
      const ring = scene.add.circle(x, y, o.fromR, 0x000000, 0).setStrokeStyle(3, o.color, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)
      try { ring.postFX.addGlow(o.color, 5, 0, false, 0.1, 10) } catch (e) {}
      made.push(ring)
      scene.tweens.add({ targets: ring, radius: o.toR, alpha: 0, duration: life, delay: i * life * 0.18, ease: 'Quint.easeOut', onComplete: () => ring.destroy() })
    }
    return made
  },

  // Glowing beam/bolt from A→B — additive core line + glow + travelling sparks.
  beamFx(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { color: 0xff5577, width: 4, durationMs: 420, depth: 8, sparks: 10, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const line = scene.add.line(0, 0, x1, y1, x2, y2, o.color, 1).setOrigin(0, 0).setLineWidth(o.width).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)
    try { line.postFX.addGlow(o.color, 6, 0, false, 0.1, 12) } catch (e) {}
    made.push(line)
    scene.tweens.add({ targets: line, alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => line.destroy() })
    if (mult > 0) {
      const em = scene.add.particles(x2, y2, _softDotTexture(scene), {
        lifespan: { min: life * 0.4, max: life }, speed: { min: 20, max: 90 }, angle: { min: 0, max: 360 },
        scale: { start: 0.45, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: o.color, blendMode: 'ADD', emitting: false,
      })
      em.setDepth(o.depth + 1); em.explode(Math.max(3, Math.round(o.sparks * mult))); made.push(em)
      scene.time.delayedCall(life + 120, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // Soft pulsing aura + slow rising motes — for charges / heals / auras.
  glowPulseFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x66ddff, r: 22, durationMs: 700, depth: 6, motes: 10, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const aura = scene.add.circle(x, y, o.r, o.color, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)
    try { aura.postFX.addGlow(o.color, 8, 0, false, 0.1, 18) } catch (e) {}
    made.push(aura)
    scene.tweens.add({ targets: aura, scale: 1.4, alpha: 0, duration: life, ease: 'Sine.easeOut', onComplete: () => aura.destroy() })
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), {
        lifespan: { min: life * 0.5, max: life }, speedY: { min: -60, max: -20 }, speedX: { min: -25, max: 25 },
        scale: { start: 0.4, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: o.color, blendMode: 'ADD',
        emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, o.r) }, emitting: false,
      })
      em.setDepth(o.depth + 1); em.explode(Math.max(3, Math.round(o.motes * mult))); made.push(em)
      scene.time.delayedCall(life + 150, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // A few twinkling motes that pop + fade — pickups / small accents.
  sparkleFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffffff, count: 8, r: 16, durationMs: 520, depth: 9, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult()
    if (mult <= 0) return null
    const em = scene.add.particles(x, y, _softDotTexture(scene), {
      lifespan: { min: life * 0.4, max: life }, speed: { min: 0, max: 30 },
      scale: { start: 0, end: 0.5, ease: 'Sine.easeOut' }, alpha: { start: 1, end: 0 },
      tint: o.color, blendMode: 'ADD',
      emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, o.r) }, emitting: false,
    })
    em.setDepth(o.depth); em.explode(Math.max(2, Math.round(o.count * mult)))
    scene.time.delayedCall(life + 120, () => { try { em.destroy() } catch (e) {} })
    return em
  },

  // SUSTAINED status/elemental emitter — rising motes for a DURATION, then stops
  // and self-cleans. For burn/poison DoTs, channels, lingering auras. Returns the
  // emitter (call .stop() to end early). Use palette:'fire'|'poison'|… for colour.
  burnFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = _pal({ color: 0xff7733, accent: 0xffcc33, durationMs: 1200, depth: 7, rate: 36, spread: 13, rise: 70, ...opts })
    const slow = o.slow ?? 1, dur = o.durationMs * slow, mult = _particlesMult()
    if (mult <= 0) return null
    const em = scene.add.particles(x, y, _softDotTexture(scene), {
      frequency: o.rate, quantity: 1, lifespan: 520 * slow,
      speedY: { min: -o.rise, max: -o.rise * 0.5 }, speedX: { min: -16, max: 16 },
      x: { min: -o.spread, max: o.spread },
      scale: { start: 0.5, end: 0 }, alpha: { start: 0.85, end: 0 },
      tint: [o.color, o.accent], blendMode: 'ADD',
    })
    em.setDepth(o.depth)
    scene.time.delayedCall(dur, () => { try { em.stop() } catch (e) {} ; scene.time.delayedCall(700 * slow, () => { try { em.destroy() } catch (e) {} }) })
    return em
  },

  // PERSISTENT status aura — a continuous, subtle stream of rising tinted motes
  // that marks an entity as afflicted (poison/burn DoT) for as long as the status
  // lasts. UNLIKE burnFx this NEVER auto-stops: the caller owns the lifecycle —
  // reposition it each frame (em.setPosition) to follow a moving entity, then
  // em.stop()+destroy() when the status clears. Driven by StatusVfxSystem. Kept
  // low-rate + low-alpha so many afflicted units on screen stay cheap + readable.
  // Returns the emitter (null if particles are off). Use palette:'poison'|'fire'.
  statusAuraFx(scene, x, y, opts = {}) {
    if (_particlesMult() <= 0) return null
    const o = _pal({ color: 0x66dd33, accent: 0xccff66, depth: 7, rate: 150, rise: 34, spread: 9, ...opts })
    const em = scene.add.particles(x, y, _softDotTexture(scene), {
      frequency: o.rate, quantity: 1, lifespan: 640,
      speedY: { min: -o.rise, max: -o.rise * 0.45 }, speedX: { min: -10, max: 10 },
      x: { min: -o.spread, max: o.spread }, y: { min: -2, max: 7 },
      scale: { start: 0.34, end: 0 }, alpha: { start: 0.7, end: 0 },
      tint: [o.color, o.accent], blendMode: 'ADD',
    })
    em.setDepth(o.depth)
    return em
  },

  // ── Brute / impact toolkit (2026-06-10) — deliberately NON-ring shapes for VFX
  // variety: rising fury haze, sonic cry arcs, ground fissures, motion streaks, shake.

  // FURY AURA (BLOODLUST) — a blood-soaked battle frenzy that intensifies with
  // `intensity` (0..1): roiling crimson blood-mist rising off the body + wet blood
  // flecks spitting off. Denser/redder with rage. NOT flames.
  furyAura(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { intensity: 0.5, depth: 7, durationMs: 640, ...opts }
    const k = Math.max(0, Math.min(1, o.intensity))
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult()
    const blood = 0x9e0b18, dark = 0x4a0510
    const made = []
    const cy = y - 14   // anchor around the torso, not the feet

    // Roiling crimson BLOOD-MIST rising off the body — dark, wet, translucent
    // blobs that swell and lift (NOT additive — keeps it dark/visceral, not pink).
    const blobs = 3 + Math.round(4 * k)
    for (let i = 0; i < blobs; i++) {
      const bx = x + (Math.random() - 0.5) * (16 + 10 * k)
      const r = 4 + 4 * k + Math.random() * 3
      const rise = 14 + 24 * k + Math.random() * 8
      const b = scene.add.ellipse(bx, y - 2, r * 2, r * 1.6, _lerpColor(blood, 0xc41525, Math.random()), 0.55 + 0.2 * k)  // circle-ok: incidental particle (droplet/bubble/spore/ember)
        .setDepth(o.depth + 2.3 + i * 0.01)
      _glow(b, 0xc41525, 4, 7); made.push(b)
      scene.tweens.add({
        targets: b, y: y - 2 - rise, scaleX: { from: 0.7, to: 1.3 }, scaleY: { from: 0.6, to: 1.4 },
        alpha: { from: 0.55 + 0.15 * k, to: 0 }, duration: life * (0.7 + Math.random() * 0.4), ease: 'Sine.easeOut', onComplete: () => b.destroy(),
      })
    }

    // BLOOD FLECKS spitting off — wet droplets arc out and fall (the "lust").
    const flecks = 4 + Math.round(5 * k)
    for (let i = 0; i < flecks; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2
      const dist = 14 + Math.random() * (18 + 22 * k)
      const s = 1.5 + Math.random() * 2
      const d = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 3.6)
      _drawBloodDroplet(d, s); made.push(d)
      scene.tweens.add({
        targets: d, x: x + Math.cos(ang) * dist, y: cy + Math.sin(ang) * dist + 24,
        angle: (Math.random() - 0.5) * 180, alpha: { from: 1, to: 0 },
        duration: life * (0.55 + Math.random() * 0.4), ease: 'Quad.easeIn', onComplete: () => d.destroy(),
      })
    }
    return made
  },

  // SOUND WAVE — a sonic shout: broken arc-bands sweeping outward (a sound ripple, NOT
  // a solid ring) + a central "mouth" flare. Reusable for any cry/roar/sonic ability.
  soundWave(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff7a2a, edge: 0xffe6a0, arcs: 3, toR: 100, durationMs: 580, depth: 7, spreadDeg: 300, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const span = o.spreadDeg * Math.PI / 180
    // 1) Concentric shout bands — a BRIGHT thick leading edge + softer trailing
    //    bands, each sweeping out. Two-tone (hot inner stroke under a bright rim).
    for (let i = 0; i < o.arcs; i++) {
      const g = scene.add.graphics().setDepth(o.depth + (i === 0 ? 0.2 : 0)).setBlendMode(Phaser.BlendModes.ADD)
      _glow(g, o.color, i === 0 ? 7 : 4, 12); made.push(g)
      const rot = (Math.random() - 0.5) * 0.5
      const lead = i === 0
      scene.tweens.addCounter({
        from: 0, to: 1, duration: life, delay: i * life * 0.15, ease: 'Quart.easeOut',
        onUpdate: (tw) => {
          const p = tw.getValue(), r = 8 + (o.toR - 8) * p
          g.clear()
          g.lineStyle(Math.max(1, (lead ? 6 : 3.5) * (1 - p)), o.color, (lead ? 1 : 0.7) * (1 - p))
          g.beginPath(); g.arc(x, y, r, -span / 2 + rot, span / 2 + rot, false); g.strokePath()
          if (lead) { g.lineStyle(Math.max(0.8, 2.4 * (1 - p)), o.edge, (1 - p)); g.beginPath(); g.arc(x, y, r + 2, -span / 2 + rot, span / 2 + rot, false); g.strokePath() }
        },
        onComplete: () => g.destroy(),
      })
    }
    // 2) Radial pressure chevrons (>>) shooting out — the "force" of the shout.
    const chev = 5
    for (let i = 0; i < chev; i++) {
      const a = (i / chev) * span - span / 2 + (Math.random() - 0.5) * 0.2
      const g = scene.add.graphics().setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD)
      _glow(g, o.edge, 4, 8); made.push(g)
      const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux
      scene.tweens.addCounter({
        from: 0, to: 1, duration: life * 0.7, delay: 40, ease: 'Cubic.easeOut',
        onUpdate: (tw) => {
          const p = tw.getValue(), d = 18 + (o.toR * 0.8) * p, cx = x + ux * d, cy = y + uy * d, s = 6 * (1 - p * 0.4)
          g.clear(); g.lineStyle(2.4 * (1 - p), o.edge, 0.9 * (1 - p))
          g.beginPath(); g.moveTo(cx - ux * s + px * s, cy - uy * s + py * s); g.lineTo(cx, cy); g.lineTo(cx - ux * s - px * s, cy - uy * s - py * s); g.strokePath()
        },
        onComplete: () => g.destroy(),
      })
    }
    // 3) Mouth muzzle-flash at the origin.
    const core = scene.add.circle(x, y, 6, o.edge, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1).setAlpha(0)  // circle-ok: small additive flash/glow core
    _glow(core, o.color, 7, 14); made.push(core)
    scene.tweens.add({ targets: core, scale: { from: 0.4, to: 3 }, alpha: { from: 1, to: 0 }, duration: life * 0.4, ease: 'Expo.easeOut', onComplete: () => core.destroy() })
    return made
  },

  // GROUND CRACK — a fissure decal: jagged DARK cracks radiating from the point with a
  // hot glowing seam, plus a low brown dust puff. Cracks are opaque (never additive on a
  // dark decal); only the seam + dust glow. Reusable for slams / stomps / quakes.
  groundCrack(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff5a1e, cracks: 6, radius: 46, durationMs: 900, depth: 5, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const dark = scene.add.graphics().setDepth(o.depth)
    const hot  = scene.add.graphics().setDepth(o.depth + 0.1).setBlendMode(Phaser.BlendModes.ADD)
    _glow(hot, o.color, 5, 8); made.push(dark, hot)
    for (let c = 0; c < o.cracks; c++) {
      const a0 = (c / o.cracks) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
      const segs = 3 + Math.floor(Math.random() * 2)
      let px = x, py = y, ang = a0; const pts = [[px, py]]
      for (let s = 0; s < segs; s++) {
        ang += (Math.random() - 0.5) * 0.8
        const len = (o.radius / segs) * (0.7 + Math.random() * 0.6)
        px += Math.cos(ang) * len; py += Math.sin(ang) * len; pts.push([px, py])
      }
      dark.lineStyle(3, 0x140a06, 0.9); hot.lineStyle(1.4, o.color, 0.95)
      for (const gfx of [dark, hot]) {
        gfx.beginPath(); gfx.moveTo(pts[0][0], pts[0][1])
        for (let p = 1; p < pts.length; p++) gfx.lineTo(pts[p][0], pts[p][1])
        gfx.strokePath()
      }
    }
    scene.tweens.add({ targets: [dark, hot], alpha: 0, duration: life, ease: 'Cubic.easeIn', onComplete: () => { dark.destroy(); hot.destroy() } })
    // A fast low dust shock-ring kicked out from the impact.
    const sring = scene.add.ellipse(x, y, 12, 6, 0x000000, 0).setStrokeStyle(3, 0x8a6f55, 0.7).setDepth(o.depth + 0.6)  // circle-ok: thin accent rim, not the hero shape
    made.push(sring)
    scene.tweens.add({ targets: sring, width: o.radius * 2.2, height: o.radius * 0.9, alpha: 0, duration: life * 0.6, ease: 'Quint.easeOut', onComplete: () => sring.destroy() })
    // Chunks of broken earth flung up + out, tumbling and falling back.
    const chunks = 5 + Math.floor(Math.random() * 3)
    for (let i = 0; i < chunks; i++) {
      const a = (i / chunks) * Math.PI * 2 + (Math.random() - 0.5) * 0.6
      const dist = o.radius * (0.4 + Math.random() * 0.6)
      const cs = 2.5 + Math.random() * 2.5
      const ch = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.7).setAngle(Math.random() * 360)
      ch.fillStyle(0x120a06, 0.5); ch.fillRect(-cs + 1, -cs + 1, cs * 2, cs * 1.6)          // shadow
      ch.fillStyle(0x4a3322, 1); ch.fillRect(-cs, -cs, cs * 2, cs * 1.6)                      // dirt clod
      ch.fillStyle(0x6b5240, 0.9); ch.fillRect(-cs, -cs, cs * 2, cs * 0.6)                    // lit top
      made.push(ch)
      scene.tweens.add({
        targets: ch, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist + 20,
        angle: ch.angle + (Math.random() - 0.5) * 360, alpha: { from: 1, to: 0 }, scaleX: 0.5, scaleY: 0.5,
        duration: life * (0.6 + Math.random() * 0.3), ease: 'Quad.easeIn', onComplete: () => ch.destroy(),
      })
    }
    const mult = _particlesMult()
    if (mult > 0) {
      const dust = scene.add.particles(x, y, _softDotTexture(scene), {
        lifespan: { min: life * 0.4, max: life * 0.7 }, speed: { min: 20, max: 70 },
        angle: { min: 200, max: 340 }, scale: { start: 0.5, end: 0 }, alpha: { start: 0.5, end: 0 },
        tint: [0x6b5240, 0x8a6f55], emitting: false,
      })
      dust.setDepth(o.depth + 1); dust.explode(Math.round(14 * mult)); made.push(dust)
      scene.time.delayedCall(life, () => { try { dust.destroy() } catch (e) {} })
    }
    return made
  },

  // STREAK DASH — motion-blur speed lines from A→B for charges/dashes: parallel additive
  // streaks offset perpendicular to the path, fast fade. Reusable for any dash/lunge.
  streakDash(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { color: 0xffd0b0, edge: 0xfff3e0, lines: 5, width: 4, durationMs: 280, depth: 9, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux
    // TAPERED streaks: each a thin triangle (fat at the start, sharp at the leading
    // point) — reads as a speed line, not a flat rule. Bright core + glow.
    for (let i = 0; i < o.lines; i++) {
      const off = (i - (o.lines - 1) / 2) * 6, ox = nx * off, oy = ny * off
      const taper = Math.max(1.2, o.width * (1 - Math.abs(off) / 36))
      const sx = x1 + ox, sy = y1 + oy, ex = x2 + ox, ey = y2 + oy
      const g = scene.add.graphics().setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD)
      _glow(g, o.color, 4, 8); made.push(g)
      g.fillStyle(o.color, 0.9)
      g.beginPath()
      g.moveTo(sx + nx * taper, sy + ny * taper); g.lineTo(sx - nx * taper, sy - ny * taper); g.lineTo(ex, ey)
      g.closePath(); g.fillPath()
      g.lineStyle(1, o.edge, 0.9); g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.strokePath()  // bright core
      scene.tweens.add({ targets: g, alpha: 0, x: ux * 8, y: uy * 8, duration: life, delay: i * 10, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    // A bright leading-edge flash at the destination — where the charge lands.
    const flash = scene.add.circle(x2, y2, 5, o.edge, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1).setAlpha(0)  // circle-ok: small additive flash/glow core
    _glow(flash, o.color, 6, 12); made.push(flash)
    scene.tweens.add({ targets: flash, scale: { from: 0.4, to: 2.6 }, alpha: { from: 1, to: 0 }, duration: life * 1.2, ease: 'Expo.easeOut', onComplete: () => flash.destroy() })
    return made
  },

  // SCREEN SHAKE — guarded camera shake for heavy impacts (stomps, ult hits). Thin
  // wrapper so kits don't each re-handle the try/catch + intensity scale.
  screenShake(scene, opts = {}) {
    const o = { intensity: 0.006, durationMs: 200, ...opts }
    try { scene.cameras.main.shake(o.durationMs * (o.slow ?? 1), o.intensity) } catch (e) {}
  },

  // ── Bone / necrotic toolkit (2026-06-10) — angular bone shards + green-white
  // undeath, NOT soft glowing motes. The skeleton family's own visual language.

  // BONE SHATTER — a burst of shaded bone CHIPS flung outward (spinning, tumbling,
  // falling under gravity, fading). Each chip is a small irregular shaded polygon,
  // not a flat sliver. For the collapse + the Boneguard shard ring.
  boneShatter(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xe8e0c8, count: 12, spread: 46, durationMs: 620, depth: 8, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult()
    const n = Math.max(4, Math.round(o.count * (mult > 0 ? mult : 0.5))), made = []
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.7
      const dist = o.spread * (0.5 + Math.random() * 0.7)
      const s = 2.2 + Math.random() * 2.2
      const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setAngle(Math.random() * 360)
      _drawBoneChip(g, s, o.color); made.push(g)
      scene.tweens.add({
        targets: g, x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist + 16,
        angle: g.angle + (Math.random() - 0.5) * 560, alpha: { from: 1, to: 0 }, scaleX: 0.35, scaleY: 0.35,
        duration: life * (0.7 + Math.random() * 0.4), ease: 'Quad.easeIn', onComplete: () => g.destroy(),
      })
    }
    return made
  },

  // BONE KNIT — the reassembly rise: bone chips spiral INWARD from a ring to the
  // centre, then a necrotic green-white flash + a quick upward bone-light bursts as
  // they meet. Inward (not a burst) — reads as bones clattering back together.
  boneKnit(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xe8e0c8, glow: 0x9fe0a0, count: 11, fromR: 34, durationMs: 540, depth: 8, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, n = Math.max(5, o.count), made = []
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const r = o.fromR * (0.8 + Math.random() * 0.45)
      const s = 2 + Math.random() * 2
      const g = scene.add.graphics().setPosition(x + Math.cos(ang) * r, y + Math.sin(ang) * r).setDepth(o.depth).setAngle(Math.random() * 360)
      _drawBoneChip(g, s, o.color); made.push(g)
      // spiral in: curve via a mid control by tweening angle + position with easeIn
      scene.tweens.add({
        targets: g, x, y, angle: g.angle + 220, alpha: { from: 1, to: 0.3 }, scaleX: 0.6, scaleY: 0.6,
        duration: life * 0.82, delay: i * 7, ease: 'Quad.easeIn', onComplete: () => g.destroy(),
      })
    }
    // necrotic flash as they meet + a thin upward bone-light column
    const core = scene.add.circle(x, y, 4, o.glow, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1).setAlpha(0)  // circle-ok: small additive flash/glow core
    _glow(core, o.glow, 7, 14); made.push(core)
    scene.tweens.add({ targets: core, scale: { from: 0.4, to: 3.2 }, alpha: { from: 1, to: 0 }, delay: life * 0.6, duration: life * 0.5, ease: 'Cubic.easeOut', onComplete: () => core.destroy() })
    const beam = scene.add.ellipse(x, y - 2, 6, 4, o.glow, 0.0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: vertical glow beam
    _glow(beam, o.glow, 5, 10); made.push(beam)
    scene.tweens.add({ targets: beam, height: 40, y: y - 18, alpha: { from: 0.75, to: 0 }, delay: life * 0.6, duration: life * 0.45, ease: 'Quad.easeOut', onComplete: () => beam.destroy() })
    return made
  },

  // NECROTIC ERUPT — the Undying Legion pulse. A choreographed composition: a scorch
  // crater + glowing necrotic ground cracks, a triple shock pulse (core flash + glow
  // disc + bone shock-ring), DETAILED bone spikes that punch up with anticipation +
  // overshoot + a dirt kick + a shadow pool, then crumble; plus green soul-wisps and
  // rising spirit motes. The dead clawing up from the ground.
  necroticErupt(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x7fe089, bone: 0xe8e0c8, radius: 90, spikes: 9, durationMs: 860, depth: 6, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []

    // 1) Ground impact — dark scorch crater + glowing necrotic cracks fanning out.
    const crater = scene.add.ellipse(x, y, o.radius * 1.7, o.radius * 0.85, 0x0b1810, 0.5).setDepth(o.depth - 0.1)  // circle-ok: flat ground pool/crater accent
    made.push(crater)
    scene.tweens.add({ targets: crater, alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => crater.destroy() })
    // Short, low necrotic seams just around the rim (kept subtle so the BONE
    // SPIKES are the star — not a radial crack field).
    const seams = scene.add.graphics().setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD)
    _glow(seams, o.color, 4, 7); made.push(seams)
    for (let c = 0; c < 5; c++) {
      let px = x, py = y, ang = (c / 5) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      seams.lineStyle(1.4, o.color, 0.55); seams.beginPath(); seams.moveTo(px, py)
      for (let s = 0; s < 2; s++) { ang += (Math.random() - 0.5) * 0.6; const len = (o.radius / 4) * (0.6 + Math.random() * 0.4); px += Math.cos(ang) * len; py += Math.sin(ang) * len * 0.45; seams.lineTo(px, py) }
      seams.strokePath()
    }
    scene.tweens.add({ targets: seams, alpha: 0, duration: life * 0.7, delay: life * 0.25, ease: 'Quad.easeIn', onComplete: () => seams.destroy() })

    // 2) Triple shock pulse — glow disc + bone shock-ring + bright core flash.
    const disc = scene.add.ellipse(x, y, 20, 10, o.color, 0.45).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)  // circle-ok: flat ground pool/crater accent
    made.push(disc)
    scene.tweens.add({ targets: disc, width: o.radius * 2.2, height: o.radius * 1.1, alpha: 0, duration: life * 0.8, ease: 'Quint.easeOut', onComplete: () => disc.destroy() })
    const ring = scene.add.ellipse(x, y, 16, 8, 0x000000, 0).setStrokeStyle(3, o.bone, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 0.2)  // circle-ok: thin accent rim, not the hero shape
    _glow(ring, o.color, 6, 12); made.push(ring)
    scene.tweens.add({ targets: ring, width: o.radius * 2, height: o.radius, alpha: { from: 0.95, to: 0 }, duration: life, ease: 'Quint.easeOut', onComplete: () => ring.destroy() })
    const core = scene.add.circle(x, y, 6, 0xeafff0, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1).setAlpha(0)  // circle-ok: small additive flash/glow core
    _glow(core, o.color, 8, 16); made.push(core)
    scene.tweens.add({ targets: core, scale: { from: 0.3, to: 4 }, alpha: { from: 1, to: 0 }, duration: life * 0.5, ease: 'Expo.easeOut', onComplete: () => core.destroy() })

    // 3) Detailed bone spikes — anticipation, overshoot, dirt kick, shadow pool, crumble.
    const sp = Math.max(4, o.spikes)
    for (let i = 0; i < sp; i++) {
      const ang = (i / sp) * Math.PI * 2 + (Math.random() - 0.5) * 0.35
      const rr = o.radius * (0.30 + Math.random() * 0.55)
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * (rr * 0.45)
      const h = 24 + Math.random() * 28, bw = 5 + Math.random() * 3.5   // bigger, jagged spikes
      const lean = (Math.random() - 0.5) * (h * 0.22)
      const delay = i * 24 + Math.random() * 60
      const sh = scene.add.ellipse(px, py + 1, bw * 3, bw * 1.3, 0x000000, 0).setDepth(o.depth + 1.4)  // circle-ok: soft ground shadow
      made.push(sh)
      scene.tweens.add({ targets: sh, alpha: { from: 0, to: 0.4 }, delay, duration: 120, onComplete: () => scene.tweens.add({ targets: sh, alpha: 0, delay: life * 0.4, duration: life * 0.4, onComplete: () => sh.destroy() }) })
      // Depth above the entity band so the erupting spikes are never hidden
      // behind the caster (the y-sort band is ~7 + worldY*0.0005).
      const g = scene.add.graphics().setPosition(px, py).setDepth(o.depth + 1.5 + i * 0.01)
      _drawBoneSpike(g, h, bw, lean, o.bone); _glow(g, o.color, 4, 7)
      g.scaleY = 0; g.scaleX = 0.7; made.push(g)
      scene.tweens.add({
        targets: g, scaleY: { from: 0, to: 1 }, scaleX: { from: 0.7, to: 1 }, delay, duration: 175 * slow, ease: 'Back.easeOut',
        onComplete: () => {
          if (mult > 0) {
            const dirt = scene.add.particles(px, py, _softDotTexture(scene), { lifespan: { min: 200, max: 440 }, speed: { min: 30, max: 95 }, angle: { min: 205, max: 335 }, scale: { start: 0.42, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [0x4a3b2a, 0x6b5240], emitting: false })
            dirt.setDepth(o.depth + 0.6); dirt.explode(Math.round(7 * mult)); made.push(dirt)
            scene.time.delayedCall(480, () => { try { dirt.destroy() } catch (e) {} })
          }
          scene.tweens.add({ targets: g, alpha: 0, scaleY: 0.82, y: py + 3, delay: life * 0.4, duration: life * 0.4, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
        },
      })
    }

    // 4) Soul-wisps (green flame tongues) + rising spirit motes.
    for (let i = 0; i < 3; i++) {
      const wx = x + (Math.random() - 0.5) * o.radius * 0.5, wh = 18 + Math.random() * 14
      const t = scene.add.triangle(wx, y - 2, -3, 0, 3, 0, 0, -wh, o.color, 0.7).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)
      _glow(t, o.color, 4, 8); made.push(t)
      scene.tweens.add({ targets: t, y: y - 12, scaleY: { from: 0.5, to: 1.25 }, alpha: { from: 0.7, to: 0 }, delay: 130 + i * 60, duration: life * 0.7, ease: 'Sine.easeOut', onComplete: () => t.destroy() })
    }
    if (mult > 0) {
      const motes = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: -52, max: -16 }, speedX: { min: -28, max: 28 }, x: { min: -o.radius * 0.5, max: o.radius * 0.5 }, y: { min: -4, max: 4 }, scale: { start: 0.35, end: 0 }, alpha: { start: 0.55, end: 0 }, tint: [o.color, 0x2f7a3e], blendMode: 'ADD', emitting: false })
      motes.setDepth(o.depth + 1); motes.explode(Math.round(16 * mult)); made.push(motes)
      scene.time.delayedCall(life, () => { try { motes.destroy() } catch (e) {} })
    }
    return made
  },

  // TRAVELLING projectile — glowing orb tweened A→B with a particle trail, then an
  // impact burst on arrival. For fireballs/bolts/orbs. palette-aware.
  projectileFx(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = _pal({ color: 0xff8844, r: 7, durationMs: 450, depth: 8, ...opts })
    const slow = o.slow ?? 1, dur = o.durationMs * slow, mult = _particlesMult()
    const orb = scene.add.circle(x1, y1, o.r, o.color, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)  // circle-ok: projectile orb (round by nature)
    try { orb.postFX.addGlow(o.color, 8, 0, false, 0.1, 16) } catch (e) {}
    let trail = null
    if (mult > 0) {
      trail = scene.add.particles(0, 0, _softDotTexture(scene), {
        lifespan: 360 * slow, speed: { min: 0, max: 22 }, scale: { start: 0.42, end: 0 },
        alpha: { start: 0.75, end: 0 }, tint: o.color, blendMode: 'ADD', frequency: 14,
      })
      trail.setDepth(o.depth - 1); trail.startFollow(orb)
    }
    scene.tweens.add({
      targets: orb, x: x2, y: y2, duration: dur, ease: 'Quad.easeIn',
      onComplete: () => {
        try { trail?.stop() } catch (e) {}
        this.impactFx(scene, x2, y2, { tint: o.accent ?? o.color, color: 0xffffff, slow })
        scene.lightingSystem?.flash(x2, y2, { color: o.accent ?? o.color, radius: 88, durationMs: 360 })
        scene.time.delayedCall(420 * slow, () => { try { trail?.destroy() } catch (e) {} })
        orb.destroy()
      },
    })
    return orb
  },

  // ── Gold / greed toolkit (2026-06-10) — minted coins, not yellow dots ──────

  // GOLD STAMP — a coin BRAND slams onto a hero (Goblin Mark for Plunder): a minted
  // coin spins down from above and impacts with a gold shock-ring + flash + sparkle +
  // glints flying off + a tiny shake, then settles. (The persistent over-head brand is
  // PlunderMarkRenderer; this is the one-shot "stamp on" moment.)
  goldStamp(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd23f, r: 9, durationMs: 620, depth: 11, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const coin = scene.add.graphics().setPosition(x, y - 36).setDepth(o.depth).setScale(1.6).setAngle(-160)
    _drawCoin(coin, o.r); made.push(coin)
    scene.tweens.add({
      targets: coin, y, scaleX: 1, scaleY: 1, angle: 0, duration: life * 0.34, ease: 'Back.easeIn',
      onComplete: () => {
        const ring = scene.add.circle(x, y, 6, 0x000000, 0).setStrokeStyle(3, o.color, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)  // circle-ok: thin accent rim, not the hero shape
        _glow(ring, o.color, 6, 12); made.push(ring)
        scene.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: life * 0.5, ease: 'Quint.easeOut', onComplete: () => ring.destroy() })
        const flash = scene.add.circle(x, y, 7, 0xfff4c0, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: small additive flash/glow core
        _glow(flash, o.color, 7, 14); made.push(flash)
        scene.tweens.add({ targets: flash, scale: { from: 1.2, to: 3 }, alpha: 0, duration: life * 0.35, ease: 'Expo.easeOut', onComplete: () => flash.destroy() })
        this.sparkleFx?.(scene, x, y, { color: o.color })
        this.screenShake?.(scene, { intensity: 0.003, durationMs: 110, slow })
        const mult = _particlesMult()
        if (mult > 0) {
          const gl = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 220, max: 480 }, speed: { min: 40, max: 110 }, angle: { min: 0, max: 360 }, scale: { start: 0.4, end: 0 }, alpha: { start: 0.95, end: 0 }, tint: [0xffe27a, o.color], blendMode: 'ADD', emitting: false })
          gl.setDepth(o.depth + 1); gl.explode(Math.round(8 * mult)); made.push(gl)
          scene.time.delayedCall(520, () => { try { gl.destroy() } catch (e) {} })
        }
        scene.tweens.add({ targets: coin, alpha: 0, y: y - 6, duration: life * 0.45, delay: life * 0.1, ease: 'Quad.easeIn', onComplete: () => coin.destroy() })
      },
    })
    return made
  },

  // COIN RAIN — a shower of minted coins falling over an area (Goblin Grand Heist): each
  // coin fades in above, tumbles down, lands with a tiny bounce, fades. Hero element of
  // the Plunder King ult.
  coinRain(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd23f, count: 14, radius: 80, durationMs: 900, depth: 11, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, n = Math.max(5, o.count), made = []
    for (let i = 0; i < n; i++) {
      const tx = x + (Math.random() - 0.5) * o.radius * 2
      const startY = y - 50 - Math.random() * 44
      const r = 4 + Math.random() * 3
      const coin = scene.add.graphics().setPosition(tx, startY).setDepth(o.depth).setAngle(Math.random() * 360).setAlpha(0)
      _drawCoin(coin, r); made.push(coin)
      const delay = Math.random() * life * 0.4
      const landY = y + (Math.random() - 0.5) * 22
      scene.tweens.add({ targets: coin, alpha: 1, duration: 80, delay })
      scene.tweens.add({
        targets: coin, y: landY, angle: coin.angle + (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 200),
        duration: life * 0.55, delay, ease: 'Quad.easeIn',
        onComplete: () => {
          scene.tweens.add({ targets: coin, y: landY - 4, yoyo: true, duration: 90 })
          scene.tweens.add({ targets: coin, alpha: 0, duration: 220, delay: 150, onComplete: () => coin.destroy() })
        },
      })
    }
    return made
  },

  // ── Ooze / slime toolkit (2026-06-11) ─────────────────────────────────────

  // SLIME SPLIT — a gooey mitosis: the blob pinches into TWO shaded slime blobs that
  // separate with an overshoot + jiggle, a stretching goo string that thins and snaps
  // between them, and a splat of goo droplets. `color` = the slime's hue.
  slimeSplit(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    let color = opts.color ?? 0x66cc44
    if (typeof color === 'string') color = parseInt(color.replace(/^0x/i, ''), 16) || 0x66cc44
    // Depth above the entity y-sort band (~7 + worldY*0.0005) so the gooey blobs
    // pop in FRONT, not hidden behind the splitting slime.
    const o = { durationMs: 560, depth: 11, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const dir = Math.random() < 0.5 ? 1 : -1, spread = 22 + Math.random() * 10
    // two child blobs splitting apart
    for (const s of [-1, 1]) {
      const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setScale(0.5)
      _drawSlimeBlob(g, 9, color); made.push(g)
      scene.tweens.add({
        targets: g, x: x + s * dir * spread, y: y - 2 + Math.random() * 4, scaleX: { from: 0.5, to: 1 }, scaleY: { from: 0.5, to: 1 },
        duration: life * 0.55, ease: 'Back.easeOut',
        onComplete: () => {
          scene.tweens.add({ targets: g, scaleX: 1.18, scaleY: 0.82, yoyo: true, duration: 90 * slow, repeat: 1 })  // jiggle
          scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.4, delay: life * 0.3, onComplete: () => g.destroy() })
        },
      })
    }
    // stretching goo string between them, thinning until it snaps
    const str = scene.add.graphics().setDepth(o.depth - 0.1); made.push(str)
    scene.tweens.addCounter({
      from: 0, to: 1, duration: life * 0.5, ease: 'Quad.easeIn',
      onUpdate: (tw) => { const p = tw.getValue(); str.clear(); str.lineStyle(Math.max(0.5, 4.5 * (1 - p)), color, 0.85 * (1 - p)); str.beginPath(); str.moveTo(x - dir * spread * p, y); str.lineTo(x + dir * spread * p, y); str.strokePath() },
      onComplete: () => str.destroy(),
    })
    // goo-droplet splat
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2, dist = 8 + Math.random() * 16, ds = 1.5 + Math.random() * 2
      const d = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.2)
      d.fillStyle(_lerpColor(color, 0x000000, 0.25), 0.9); d.fillCircle(0, 0, ds)
      d.fillStyle(_lerpColor(color, 0xffffff, 0.4), 0.7); d.fillCircle(-ds * 0.3, -ds * 0.3, ds * 0.4)
      made.push(d)
      scene.tweens.add({ targets: d, x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist + 10, alpha: { from: 1, to: 0 }, scaleX: 0.3, scaleY: 0.3, duration: life * (0.5 + Math.random() * 0.3), ease: 'Quad.easeIn', onComplete: () => d.destroy() })
    }
    return made
  },

  // ── Plague / contagion toolkit (2026-06-11) — sickly green-purple disease ──

  // PLAGUE BURST — an infection splat on a hero: bubbling green-purple miasma puffs
  // swelling + rising spores + a few dark sick bubbles popping. The "you're infected" hit.
  plagueBurst(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { green: 0x88cc33, purple: 0x9b59ff, durationMs: 600, depth: 11, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // sick splat on the ground (irregular, fades)
    const splat = scene.add.graphics().setPosition(x, y + 4).setDepth(o.depth - 0.3).setScale(0.5).setAlpha(0.7)
    _drawAcidBlob(splat, 6, _lerpColor(o.green, o.purple, 0.3)); made.push(splat)
    scene.tweens.add({ targets: splat, scaleX: 1.5, scaleY: 1.5, alpha: 0, duration: life, ease: 'Quad.easeOut', onComplete: () => splat.destroy() })
    // lumpy miasma puffs swelling + rising (not perfect circles)
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 8
      const g = scene.add.graphics().setPosition(x + Math.cos(a) * d, y + Math.sin(a) * d).setDepth(o.depth).setScale(0.4).setBlendMode(Phaser.BlendModes.ADD)
      _drawMiasmaPuff(g, 6, o.green, o.purple); _glow(g, o.green, 4, 7); made.push(g)
      scene.tweens.add({ targets: g, scale: 1.5 + Math.random() * 0.5, y: g.y - 8 - Math.random() * 6, alpha: { from: 0.85, to: 0 }, angle: (Math.random() - 0.5) * 40, duration: life * (0.6 + Math.random() * 0.4), ease: 'Sine.easeOut', onComplete: () => g.destroy() })
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 8
      const b = scene.add.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, 2 + Math.random() * 2, _lerpColor(o.green, 0x000000, 0.4), 0.85).setDepth(o.depth + 0.5); made.push(b)  // circle-ok: incidental particle (droplet/bubble/spore/ember)
      scene.tweens.add({ targets: b, scale: { from: 1, to: 1.7 }, alpha: 0, duration: life * 0.5, delay: Math.random() * life * 0.3, onComplete: () => b.destroy() })
    }
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.5, max: life }, speedY: { min: -40, max: -12 }, speedX: { min: -20, max: 20 }, x: { min: -8, max: 8 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [o.green, o.purple], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(10 * mult)); made.push(em); scene.time.delayedCall(life + 120, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // PLAGUE AURA — the persistent "this hero is infected" tell: a couple of small
  // green-purple miasma motes wisp up off the body. Fired on a slow cadence by
  // AdventurerRenderer while `_infectUntil` is active (cheap, in-front depth).
  plagueAuraFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { green: 0x88cc33, purple: 0x9b59ff, depth: 43, durationMs: 820, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y - 16
    for (let i = 0; i < 2; i++) {
      const px = x + (Math.random() * 16 - 8)
      const g = scene.add.graphics().setPosition(px, cy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(g)
      _drawMiasmaPuff(g, 4 + Math.random() * 2, o.green, o.purple)
      scene.tweens.add({ targets: g, y: cy - 14 - Math.random() * 8, scale: 0.85, alpha: 0.5, duration: life * 0.45, ease: 'Sine.easeOut', delay: i * 130,
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scale: 1, duration: life * 0.4, onComplete: () => g.destroy() }) })
    }
    return made
  },

  // CONTAGION TENDRIL — a writhing green tendril that snakes from an infected hero to
  // a new victim and bursts into a plague splat on arrival. The plague "jumping".
  contagionTendril(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { green: 0x9fe04a, purple: 0x9b59ff, durationMs: 520, depth: 11, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const g = scene.add.graphics().setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); _glow(g, o.green, 5, 9); made.push(g)
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, phase = Math.random() * Math.PI * 2
    scene.tweens.addCounter({
      from: 0, to: 1, duration: life, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const p = tw.getValue(), grow = Math.min(1, p * 1.6), fade = Math.max(0, 1 - (p - 0.55) / 0.45)
        g.clear(); g.lineStyle(2.6 * fade, o.green, 0.9 * fade)
        const segs = 14; g.beginPath()
        for (let i = 0; i <= segs * grow; i++) {
          const t = i / segs, wob = Math.sin(t * Math.PI * 3 + phase + p * 6) * 6 * (1 - Math.abs(t - 0.5) * 1.4)
          const px = x1 + dx * t + nx * wob, py = y1 + dy * t + ny * wob
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py)
        }
        g.strokePath()
      },
      onComplete: () => g.destroy(),
    })
    scene.time.delayedCall(life * 0.5, () => this.plagueBurst?.(scene, x2, y2 - 6, { green: o.green, purple: o.purple, slow }))
    return made
  },

  // PLAGUE CLOUD — the Pandemic outbreak: a billowing toxic cloud of overlapping
  // green-purple puffs expanding to fill the room + rising spores + a sick central flash.
  plagueCloud(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { green: 0x6fae2a, purple: 0x7a3a9e, radius: 100, durationMs: 1100, depth: 10, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const puffs = 10
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + (Math.random() - 0.5) * 0.5, rr = o.radius * (0.3 + Math.random() * 0.6)
      const pf = scene.add.graphics().setPosition(x, y).setDepth(o.depth + i * 0.01).setScale(0.5).setBlendMode(Phaser.BlendModes.ADD)
      _drawMiasmaPuff(pf, 9 + Math.random() * 5, o.green, o.purple); _glow(pf, o.green, 4, 8); made.push(pf)
      scene.tweens.add({ targets: pf, x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr * 0.7, scale: { from: 0.5, to: 2.1 }, alpha: { from: 0.55, to: 0 }, angle: (Math.random() - 0.5) * 50, duration: life * (0.7 + Math.random() * 0.3), ease: 'Sine.easeOut', onComplete: () => pf.destroy() })
    }
    const core = scene.add.circle(x, y, 10, o.green, 0.6).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1); _glow(core, o.purple, 7, 14); made.push(core)  // circle-ok: small additive flash/glow core
    scene.tweens.add({ targets: core, scale: { from: 0.5, to: 3 }, alpha: 0, duration: life * 0.5, ease: 'Cubic.easeOut', onComplete: () => core.destroy() })
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.5, max: life }, speedY: { min: -50, max: -16 }, speedX: { min: -40, max: 40 }, x: { min: -o.radius * 0.5, max: o.radius * 0.5 }, y: { min: -6, max: 6 }, scale: { start: 0.4, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [o.green, o.purple], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(24 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ── Acid / corrosion toolkit (2026-06-11) ─────────────────────────────────

  // ACID SPLASH — a caustic puddle splatters down: a flat green pool spreads, bubbles
  // pop on its surface, hissing steam rises, and droplets fling out. Fired when an acid
  // puddle is laid (the lingering damage ZONE itself is the HazardRenderer).
  acidSplash(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    let color = opts.color ?? 0xaadd33
    if (typeof color === 'string') color = parseInt(color.replace(/^0x/i, ''), 16) || 0xaadd33
    const o = { durationMs: 700, depth: 6, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // Scale the whole splat to the puddle's tile radius so higher slime tiers
    // visibly burst bigger (0.9 tiles = baseline ×1). Bubble/droplet COUNT scales
    // a touch too so a big pool reads busier.
    const sc = Math.max(0.7, Math.min(2.4, (o.radiusTiles ?? 0.9) / 0.9))
    const nBub = Math.round(5 * Math.min(1.6, sc)), nDrop = Math.round(3 * Math.min(1.7, sc))
    // flat ground puddle — an irregular lobed pool spreading + fading
    const puddle = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setScale(0.4 * sc).setAlpha(0.85)
    _drawAcidBlob(puddle, 7, color); _glow(puddle, color, 3, 6 * sc); made.push(puddle)
    scene.tweens.add({ targets: puddle, scaleX: 2.0 * sc, scaleY: 2.0 * sc, alpha: { from: 0.85, to: 0.3 }, duration: life * 0.5, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: puddle, alpha: 0, duration: life * 0.4, onComplete: () => puddle.destroy() }) })
    // bubbles popping on the surface
    for (let i = 0; i < nBub; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 10 * sc
      const b = scene.add.circle(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5, (1.5 + Math.random() * 2) * sc, _lerpColor(color, 0xffffff, 0.3), 0.8).setDepth(o.depth + 0.5); made.push(b)  // circle-ok: incidental particle (droplet/bubble/spore/ember)
      scene.tweens.add({ targets: b, scale: { from: 0.5, to: 1.6 }, alpha: 0, duration: 200 + Math.random() * 300, delay: Math.random() * life * 0.4, ease: 'Quad.easeOut', onComplete: () => b.destroy() })
    }
    // acid droplets flinging out
    for (let i = 0; i < nDrop; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI, dist = (10 + Math.random() * 14) * sc
      const dr = scene.add.circle(x, y, (1.5 + Math.random() * 1.5) * sc, color, 0.9).setDepth(o.depth + 0.6); made.push(dr)  // circle-ok: incidental particle (droplet/bubble/spore/ember)
      scene.tweens.add({ targets: dr, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist + 8, alpha: 0, scale: 0.4, duration: life * 0.5, ease: 'Quad.easeIn', onComplete: () => dr.destroy() })
    }
    // hissing steam rising
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.5, max: life }, speedY: { min: -30, max: -10 }, speedX: { min: -12, max: 12 }, x: { min: -10 * sc, max: 10 * sc }, scale: { start: 0.25 * sc, end: 0 }, alpha: { start: 0.4, end: 0 }, tint: [color, 0xddffaa], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(8 * mult * Math.min(1.6, sc))); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ACID GEYSER — a single column of acid erupts UP through the floor: a base
  // bulge swells, the layered column shoots up (overshoot), flings droplets that
  // arc back down, then collapses into a bubbling splat. The unit the flood is
  // built from (also fireable on its own).
  acidGeyser(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    let color = opts.color ?? 0xaadd33
    if (typeof color === 'string') color = parseInt(color.replace(/^0x/i, ''), 16) || 0xaadd33
    const o = { durationMs: 620, depth: 12, h: 34 + Math.random() * 20, w: 6 + Math.random() * 3, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, h = o.h, w = o.w, made = []
    // base bulge (anticipation) — the floor swells before it bursts
    const base = scene.add.ellipse(x, y, w * 2.4, w * 1.2, color, 0.5).setDepth(o.depth - 0.2); _glow(base, color, 3, 6); made.push(base)  // circle-ok: ground bulge/pool the column erupts from
    scene.tweens.add({ targets: base, scaleX: { from: 0.3, to: 1.5 }, scaleY: { from: 0.3, to: 1 }, alpha: { from: 0.6, to: 0 }, duration: life, ease: 'Quad.easeOut', onComplete: () => base.destroy() })
    // the column — squashed flat, then shoots up, then collapses
    const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setScale(1, 0.05); made.push(g)
    _drawAcidColumn(g, h, w, color); _glow(g, color, 4, 8)
    scene.tweens.add({ targets: g, scaleY: { from: 0.05, to: 1 }, duration: life * 0.34, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: g, scaleY: 0.1, scaleX: 1.3, alpha: 0, duration: life * 0.52, ease: 'Quad.easeIn', onComplete: () => g.destroy() }) })
    // droplets flung off the crest, arcing back down
    const nd = 4 + Math.round(Math.random() * 3)
    for (let i = 0; i < nd; i++) {
      const dx = (Math.random() - 0.5) * w * 2.6
      const dr = scene.add.circle(x, y - h * 0.7, 1.4 + Math.random() * 1.6, color, 0.95).setDepth(o.depth + 0.3); made.push(dr)  // circle-ok: incidental particle (droplet/bubble/spore/ember)
      const peakY = y - h - Math.random() * 14
      scene.tweens.add({ targets: dr, x: x + dx * 1.6, y: peakY, duration: life * 0.3, ease: 'Quad.easeOut', delay: life * 0.22,
        onComplete: () => scene.tweens.add({ targets: dr, y: y + 5, x: x + dx * 2.4, alpha: 0, scale: 0.4, duration: life * 0.4, ease: 'Quad.easeIn', onComplete: () => dr.destroy() }) })
    }
    return made
  },

  // ACID FLOOD — The Dissolving's room-wide deluge. The floor dissolves: an
  // irregular caustic sheet floods across it (foaming jagged rim, NOT a ring),
  // a green tint washes the room, and a battery of acid GEYSERS erupts in a wave
  // that sweeps outward from the slime. Composed + choreographed, no circles.
  // (ox,oy) = slime world pos; rectW/rectH ≈ room size — the spread region.
  acidFloodFx(scene, ox, oy, opts = {}) {
    if (!_validXY(ox, oy)) return null
    let color = opts.color ?? 0xaadd33
    if (typeof color === 'string') color = parseInt(color.replace(/^0x/i, ''), 16) || 0xaadd33
    const o = { durationMs: 1300, depth: 11, rectW: 220, rectH: 140, geysers: 7, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // Contain the flood to the room floor (no acid on walls / next room).
    const F = _floodField(ox, oy, o), cx = F.cx, cy = F.cy, halfW = F.halfW, halfH = F.halfH
    const maxR = Math.hypot(halfW, halfH) * 1.05
    // 1. green tint washes over the room floor, then recedes
    const wash = scene.add.rectangle(cx, cy, halfW * 2, halfH * 2, color, 0).setDepth(o.depth - 2); made.push(wash)
    scene.tweens.add({ targets: wash, fillAlpha: 0.16, duration: life * 0.25, ease: 'Sine.easeOut',
      onComplete: () => scene.tweens.add({ targets: wash, fillAlpha: 0, duration: life * 0.6, onComplete: () => wash.destroy() }) })
    // 2. irregular coating sheet flooding across the floor (jagged lobed edge + foaming rim)
    const sheet = scene.add.graphics().setDepth(o.depth - 1); made.push(sheet)
    const V = 18, noise = Array.from({ length: V }, () => 0.55 + Math.random() * 0.7), rim = _lerpColor(color, 0xffffff, 0.35)
    const ring = (rf, p) => { for (let i = 0; i <= V; i++) { const a = i / V * Math.PI * 2, r = maxR * p * noise[i % V] * rf * (1 + 0.06 * Math.sin(i * 1.7 + p * 5)); const [px, py] = F.clamp(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6); if (i === 0) sheet.moveTo(px, py); else sheet.lineTo(px, py) } }
    scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.5, ease: 'Cubic.easeOut',
      onUpdate: (tw) => { const p = tw.getValue(); sheet.clear()
        sheet.fillStyle(color, 0.18); sheet.beginPath(); ring(1, p); sheet.closePath(); sheet.fillPath()
        sheet.fillStyle(color, 0.16); sheet.beginPath(); ring(0.66, p); sheet.closePath(); sheet.fillPath()
        sheet.lineStyle(2.5, rim, 0.55 * (1 - p * 0.6)); sheet.beginPath(); ring(1, p); sheet.closePath(); sheet.strokePath() },
      onComplete: () => scene.tweens.add({ targets: sheet, alpha: 0, duration: life * 0.4, onComplete: () => sheet.destroy() }) })
    // 3. geysers erupting in a wave that sweeps OUTWARD across the room floor
    for (let i = 0; i < o.geysers; i++) {
      const [gx, gy] = F.clamp(cx + (Math.random() * 2 - 1) * halfW * 0.92, cy + (Math.random() * 2 - 1) * halfH * 0.92)
      const delay = (Math.hypot(gx - cx, gy - cy) / maxR) * life * 0.42 + Math.random() * 60
      scene.time.delayedCall(delay, () => this.acidGeyser?.(scene, gx, gy, { color, depth: o.depth + 1, slow, h: 30 + Math.random() * 22, w: 5.5 + Math.random() * 3 }))
    }
    // 4. sheeting steam rising across the room floor
    if (mult > 0) {
      const em = scene.add.particles(cx, cy, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: -46, max: -14 }, speedX: { min: -24, max: 24 }, x: { min: -halfW, max: halfW }, y: { min: -halfH * 0.5, max: halfH * 0.5 }, scale: { start: 0.32, end: 0 }, alpha: { start: 0.4, end: 0 }, tint: [color, 0xddffaa], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 2); em.explode(Math.round(26 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ── Vampire / blood toolkit (2026-06-11) — crimson life-drain ─────────────

  // BLOOD THREAD — lifesteal: a crimson ribbon whips off the bitten hero (x1,y1),
  // its near-end reeling INTO the vampire (x2,y2) as the life is drawn, with a fang
  // bite-mark, droplets sliding the strand, and a heal-flare at the vampire.
  bloodThread(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { dark: 0x6e0a18, mid: 0xc01530, bright: 0xff5577, durationMs: 420, depth: 11, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
    const phase = ((x1 + x2 + y1) % 6)   // deterministic per-thread wobble (no Math.random in the path)
    const g = scene.add.graphics().setDepth(o.depth); _glow(g, o.mid, 4, 7); made.push(g)
    // fang bite — two dark puncture dots at the hero
    for (const s of [-1, 1]) {
      const p = scene.add.circle(x1 + nx * 2 * s, y1 + ny * 2 * s, 1.6, 0x4a0510, 0.95).setDepth(o.depth + 0.3); made.push(p)  // circle-ok: tiny fang puncture mark
      scene.tweens.add({ targets: p, alpha: 0, scale: 0.4, duration: life * 0.6, delay: life * 0.2, onComplete: () => p.destroy() })
    }
    const ribbon = (sx, sy, width, col, alpha) => {
      g.lineStyle(width, col, alpha); g.beginPath()
      const segs = 12
      for (let i = 0; i <= segs; i++) {
        const t = i / segs, wob = Math.sin(t * Math.PI * 2 + phase + 5) * 5 * (1 - Math.abs(t - 0.5) * 1.3)
        const px = sx + (x2 - sx) * t + nx * wob, py = sy + (y2 - sy) * t + ny * wob
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py)
      }
      g.strokePath()
    }
    scene.tweens.addCounter({ from: 0, to: 1, duration: life, ease: 'Quad.easeIn',
      onUpdate: (tw) => { const p = tw.getValue(), fade = Math.max(0, 1 - p * 0.7), w = 3.4 * fade
        const sx = x1 + dx * p * 0.92, sy = y1 + dy * p * 0.92   // near-end reels toward the vampire
        g.clear()
        ribbon(sx, sy, w + 2, o.dark, 0.5 * fade)
        ribbon(sx, sy, w, o.mid, 0.85 * fade)
        ribbon(sx, sy, Math.max(0.5, w * 0.4), o.bright, 0.9 * fade)
      }, onComplete: () => g.destroy() })
    // droplets sliding the strand toward the vampire
    for (let i = 0; i < 3; i++) {
      const d = scene.add.circle(x1, y1, 1.5, o.mid, 0.95).setDepth(o.depth + 0.4); made.push(d)  // circle-ok: blood droplet sliding the thread
      scene.tweens.add({ targets: d, x: x2, y: y2, alpha: 0, duration: life * 0.7, delay: life * (0.1 + i * 0.18), ease: 'Quad.easeIn', onComplete: () => d.destroy() })
    }
    // heal-flare wisps rising at the vampire
    if (mult > 0) {
      const em = scene.add.particles(x2, y2, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: -34, max: -10 }, speedX: { min: -12, max: 12 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [o.bright, o.mid], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(6 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // BLOOD SHIELD — Bloodgorge overheal: congealed blood-clots swirl inward and
  // clot into a rotating husk around the vampire; thicker with higher `strength`.
  bloodShieldFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x8a0d1e, durationMs: 620, depth: 11, strength: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const N = Math.round(7 + 4 * Math.min(2, o.strength)), R = 18 + 6 * Math.min(2, o.strength)
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const g = scene.add.graphics().setDepth(o.depth).setScale(0.4).setPosition(x + Math.cos(a) * R * 1.8, y + Math.sin(a) * R * 1.1)
      _drawBloodClot(g, 3 + (i % 2), o.color); made.push(g)
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * R, y: y + Math.sin(a) * R * 0.6, scale: 1, duration: life * 0.45, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, scale: 0.5, alpha: 0, duration: life * 0.45, delay: life * 0.1, onComplete: () => g.destroy() }) })
      scene.tweens.add({ targets: g, angle: (i % 2 ? 60 : -60), duration: life, ease: 'Sine.easeInOut' })
    }
    return made
  },

  // BLOOD SHIELD HIT — the husk soaks a blow: clot shards shatter off + splatter.
  bloodShieldHit(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x8a0d1e, durationMs: 360, depth: 12, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, dist = 9 + Math.random() * 12
      const g = scene.add.graphics().setDepth(o.depth).setPosition(x, y); _drawBloodClot(g, 2 + Math.random() * 1.5, o.color); made.push(g)
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, angle: (Math.random() - 0.5) * 180, alpha: 0, scale: 0.4, duration: life, ease: 'Quad.easeOut', onComplete: () => g.destroy() })
    }
    return made
  },

  // BLOOD FEAST — the Sovereign's ULT: a thread reels from EVERY hero into the
  // vampire at once, a blood-geyser column rises at the centre, the husk swells,
  // and a dark crimson pulse wells across the floor. Threads converge INWARD.
  bloodFeastFx(scene, x, y, targets = [], opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { dark: 0x6e0a18, mid: 0xc01530, depth: 12, durationMs: 900, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    // 1. a thread reeling from each hero into the vampire
    for (const t of (targets || [])) {
      if (!t || !_validXY(t.x, t.y)) continue
      const m = this.bloodThread(scene, t.x, t.y, x, y, { durationMs: o.durationMs * 0.7, depth: o.depth, slow })
      if (m) made.push(...m)
    }
    // 2. dark crimson ground pulse (lobed, not a ring)
    const pulse = scene.add.graphics().setPosition(x, y + 6).setDepth(o.depth - 1).setScale(0.4).setAlpha(0.5)
    _drawAcidBlob(pulse, 10, o.dark); made.push(pulse)
    scene.tweens.add({ targets: pulse, scaleX: 2.6, scaleY: 1.6, alpha: 0, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => pulse.destroy() })
    // 3. the husk swells as it gorges
    const sh = this.bloodShieldFx(scene, x, y, { strength: 2, durationMs: o.durationMs, slow })
    if (sh) made.push(...sh)
    return made
  },

  // ── Rat / swarm toolkit (2026-06-11) — skittering vermin ──────────────────

  // SWARM BITE — on a packed rat's hit, a clutch of tiny rats skitters IN from all
  // sides, lunges a bite at the target, then scatters back out + kicked grime. More
  // rats the bigger the pack (opts.count). Reads as a swarm, never a ring.
  swarmBiteFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6b5238, durationMs: 420, depth: 12, count: 4, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const n = Math.max(2, Math.min(8, o.count))
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, dist = 15 + Math.random() * 14
      const sx = x + Math.cos(a) * dist, sy = y + Math.sin(a) * dist
      const g = scene.add.graphics().setDepth(o.depth).setPosition(sx, sy); made.push(g)
      g.setScale(sx > x ? -1 : 1, 1)                          // snout faces the target
      _drawRat(g, 2.3 + Math.random() * 1.2, _lerpColor(o.color, 0x000000, Math.random() * 0.3))
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * 5, y: y + Math.sin(a) * 5, duration: life * 0.4, ease: 'Quad.easeIn',
        onComplete: () => scene.tweens.add({ targets: g, x: sx, y: sy, alpha: 0, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => g.destroy() }) })
    }
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speedX: { min: -50, max: 50 }, speedY: { min: -40, max: -5 }, scale: { start: 0.18, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0x6b5238, 0x3a2a1c], emitting: false })
      em.setDepth(o.depth - 0.5); em.explode(Math.round(8 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // GNASH — a single rat bite: a quick gnashing chomp (fang rows snap shut) on the
  // hero + a tiny twin puncture + a few skitter motes. Small & fast (bites are
  // frequent) — but a whole pack biting reads as being SWARMED and gnawed.
  gnashFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x7a5c3a, depth: 44, durationMs: 240, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y - 12, dir = o.dir ?? (Math.random() < 0.5 ? 1 : -1)
    // chomp — upper + lower fang rows that snap shut (scaleY 0 → 1 → 0)
    const jaw = scene.add.graphics().setPosition(x + dir * 4, cy).setDepth(o.depth).setScale(1, 0); made.push(jaw)
    const row = (yOff, pt) => { jaw.fillStyle(0xfff4e0, 0.92); for (let i = 0; i < 3; i++) { const fx = (i - 1) * 4; jaw.fillTriangle(fx - 1.6, yOff, fx + 1.6, yOff, fx, yOff + pt * 4) } }
    row(-3, 1); row(3, -1)
    scene.tweens.add({ targets: jaw, scaleY: 1, duration: life * 0.42, ease: 'Quad.easeIn', yoyo: true, hold: life * 0.08, onComplete: () => jaw.destroy() })
    // twin red puncture on the hero
    const bite = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.2).setAlpha(0.9); made.push(bite)
    bite.fillStyle(0x8a1410, 0.85); bite.fillCircle(-1.6, 0, 1.3); bite.fillCircle(1.6, 0, 1.3)
    scene.tweens.add({ targets: bite, alpha: 0, scale: 0.5, duration: life * 1.2, delay: life * 0.3, onComplete: () => bite.destroy() })
    // skitter motes flicking off
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2
      const g = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.1); made.push(g)
      g.fillStyle(_lerpColor(o.color, 0x000000, 0.3), 0.85); g.fillCircle(0, 0, 1.2)
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * (8 + Math.random() * 8), y: cy + Math.sin(a) * 6 + 6, alpha: 0, duration: life * 1.3, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    return made
  },

  // VERMIN TIDE — the Dire Vermin's ULT: a writhing CARPET of real rats (the rat1
  // sheet, red frenzy-tinted) surges outward across the room while the floor darkens
  // and a dust-wash + grime kicks up. The infestation flood. rectW/rectH ≈ room size.
  verminTideFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 12, durationMs: 1300, rectW: 220, rectH: 140, count: 28, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // Contain the tide to the room floor — rats / grime stay off walls + corridor.
    const F = _floodField(x, y, o), cx = F.cx, cy0 = F.cy, halfW = F.halfW, halfH = F.halfH, maxR = Math.hypot(halfW, halfH)
    // 0) the room darkens as the tide rises (a dark lobed floor-wash welling up)
    const dark = scene.add.graphics().setDepth(o.depth - 1.5).setScale(0.3).setAlpha(0); made.push(dark)
    const dv = 16, dn = Array.from({ length: dv }, () => 0.6 + Math.random() * 0.5); dark.fillStyle(0x1a0c08, 0.5); dark.beginPath()
    for (let i = 0; i <= dv; i++) { const ang = i / dv * Math.PI * 2, r = maxR * dn[i % dv]; const [px, py] = F.clamp(cx + Math.cos(ang) * r, cy0 + Math.sin(ang) * r * 0.62); if (i === 0) dark.moveTo(px, py); else dark.lineTo(px, py) }
    dark.closePath(); dark.fillPath()
    scene.tweens.add({ targets: dark, scale: 1, alpha: 0.45, duration: life * 0.32, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: dark, alpha: 0, duration: life * 0.45, onComplete: () => dark.destroy() }) })
    // 1) a writhing carpet of real rats surging outward (red frenzy tint)
    const N = Math.min(52, Math.round(o.count * (mult > 0 ? mult : 0.5)))
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, dist = 0.4 + Math.random() * 0.7
      const [tx, ty] = F.clamp(x + Math.cos(a) * halfW * dist, y + Math.sin(a) * halfH * dist)
      const sc = 0.15 + Math.random() * 0.12
      const r = _swarmRat(scene, x + Math.cos(a) * 6, y + Math.sin(a) * 4, tx - x, ty - y, sc, o.depth + (ty > y ? 0.4 : 0), 0xc24632)
      r.setAlpha(0); made.push(r)
      scene.tweens.add({ targets: r, x: tx, y: ty, alpha: 1, duration: life * (0.4 + Math.random() * 0.25), delay: Math.random() * life * 0.35, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: r, alpha: 0, duration: life * 0.3, onComplete: () => r.destroy() }) })
    }
    // 2) kicked grime particles
    if (mult > 0) {
      const em = scene.add.particles(cx, cy0, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speedX: { min: -70, max: 70 }, speedY: { min: -34, max: 12 }, x: { min: -halfW * 0.5, max: halfW * 0.5 }, scale: { start: 0.26, end: 0 }, alpha: { start: 0.42, end: 0 }, tint: [0x6b5238, 0x3a2a1c], emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(22 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ── Zombie / undead toolkit (2026-06-11) — rotten reanimation ─────────────

  // REANIMATE — a slain hero rises: a dark grave-crack spreads, green necrotic
  // energy wells UP out of it, and sickly mist + grave-dirt rise. The "it gets
  // back up as yours" moment (no clawing hands — just the necrotic upwelling).
  reanimateFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x5e7a3a, glow: 0x6fe39a, durationMs: 640, depth: 12, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // dark grave-crack / disturbed earth (lobed, not a ring)
    const crack = scene.add.graphics().setDepth(o.depth - 1).setPosition(x, y + 6).setScale(0.5).setAlpha(0.7)
    _drawAcidBlob(crack, 8, 0x2a1c0e); made.push(crack)
    scene.tweens.add({ targets: crack, scaleX: 1.8, scaleY: 1.1, alpha: 0, duration: life * 0.7, ease: 'Quad.easeOut', onComplete: () => crack.destroy() })
    // green necrotic energy welling up out of the grave
    const pulse = scene.add.graphics().setDepth(o.depth).setPosition(x, y + 2).setScale(0.4).setAlpha(0.85).setBlendMode(Phaser.BlendModes.ADD)
    _drawAcidBlob(pulse, 6, o.glow); _glow(pulse, o.glow, 4, 8); made.push(pulse)
    scene.tweens.add({ targets: pulse, scaleX: 1.7, scaleY: 1.3, y: y - 9, alpha: 0, duration: life * 0.75, ease: 'Quad.easeOut', onComplete: () => pulse.destroy() })
    // sickly necrotic mist + grave dirt rising
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.85 }, speedY: { min: -34, max: -10 }, speedX: { min: -18, max: 18 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.55, end: 0 }, tint: [o.color, o.glow], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(12 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // MASS GRAVE — the Crypt Lord's ULT, corpse-anchored "the ground heaves": the floor
  // CONVULSES — radial cracked-earth fissures race out from the crypt (NOT a ring) over
  // a sickly-green floor pall + a screen-shake — and at EACH spot a hero actually fell
  // (`opts.risePts`) the ground bulges and cracks, grave-dirt erupts, a green necrotic
  // pillar surges up (the corpse clawing free), green soul-motes rise, and a cloud of
  // carrion flies boils out across the room. (x,y) = crypt pos. Reads as "everywhere a
  // hero fell here, it's rising — as yours."
  massGraveFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { glow: 0x6fe39a, depth: 12, durationMs: 1700, rectW: 240, rectH: 160, risePts: null, count: 5, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const GREEN = o.glow, DARK = 0x2a1c0e, DIRT = 0x3a2a1c
    // Contain the eruption to the room floor — cracks must not run onto walls.
    const F = _floodField(x, y, o)
    // Cap a fissure's length so its far end stays inside the room floor rect,
    // given an origin (ox0,oy0) and a (non-unit) per-len direction (dirX,dirY).
    const capLen = (ox0, oy0, dirX, dirY, len) => {
      const r = F.rect; let t = len
      if (dirX > 0) t = Math.min(t, (r.x + r.w - ox0) / dirX); else if (dirX < 0) t = Math.min(t, (r.x - ox0) / dirX)
      if (dirY > 0) t = Math.min(t, (r.y + r.h - oy0) / dirY); else if (dirY < 0) t = Math.min(t, (r.y - oy0) / dirY)
      return Math.max(0, Math.min(len, t))
    }
    // 0) the whole room floods sickly green — a floor pall that swells then fades
    const pall = scene.add.graphics().setDepth(o.depth - 1.5); made.push(pall)
    scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.3, ease: 'Quad.easeOut',
      onUpdate: (tw) => { const p = tw.getValue(); pall.clear(); pall.fillStyle(0x1e3a1e, 0.16 * (1 - p * 0.3)); pall.fillEllipse(F.cx, F.cy, F.halfW * 2 * p, F.halfH * 2 * p) },
      onComplete: () => scene.tweens.add({ targets: pall, alpha: 0, duration: life * 0.4, onComplete: () => pall.destroy() }) })
    // 1) the ground splits — jagged cracked-earth fissures race outward from the crypt
    const fiss = 7
    for (let i = 0; i < fiss; i++) {
      const a = (i / fiss) * Math.PI * 2 + (Math.random() * 0.4 - 0.2)
      const len = capLen(x, y + 4, Math.cos(a), Math.sin(a) * 0.55, (o.rectW * 0.26) * (0.7 + Math.random() * 0.5))
      const cr = scene.add.graphics().setDepth(o.depth - 0.8).setPosition(x, y + 4).setScale(0.2, 0.2).setAlpha(0); made.push(cr)
      const pts = [[0, 0]]; const seg = 5
      for (let s = 1; s <= seg; s++) { const t = s / seg; pts.push([Math.cos(a) * len * t + (Math.random() * 10 - 5), Math.sin(a) * len * 0.55 * t + (Math.random() * 8 - 4)]) }
      cr.lineStyle(3, DARK, 0.9); cr.beginPath(); cr.moveTo(0, 0); for (const [qx, qy] of pts) cr.lineTo(qx, qy); cr.strokePath()
      cr.lineStyle(1.2, GREEN, 0.85); cr.beginPath(); cr.moveTo(0, 0); for (const [qx, qy] of pts) cr.lineTo(qx, qy); cr.strokePath()
      scene.tweens.add({ targets: cr, scaleX: 1, scaleY: 1, alpha: 1, duration: life * 0.22, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: cr, alpha: 0, duration: life * 0.5, delay: life * 0.2, onComplete: () => cr.destroy() }) })
    }
    this.screenShake?.(scene, { intensity: 0.008, durationMs: 380 })
    // 2) GROUND-HEAVE eruption at each spot a hero fell (fallback: erupt at the crypt)
    const pts = (Array.isArray(o.risePts) && o.risePts.length) ? o.risePts.slice(0, 6) : [{ x, y }]
    pts.forEach((ptRaw, i) => {
      const [cpx, cpy] = F.clamp(ptRaw.x, ptRaw.y); const pt = { x: cpx, y: cpy }
      scene.time.delayedCall(i * 90 + Math.random() * 40, () => {
        if (!_validXY(pt.x, pt.y)) return
        // floor bulge + dark crack
        const crack = scene.add.graphics().setDepth(o.depth - 0.5).setPosition(pt.x, pt.y + 5).setScale(0.4, 0.28).setAlpha(0.82)
        _drawAcidBlob(crack, 8, DARK); made.push(crack)
        scene.tweens.add({ targets: crack, scaleX: 1.6, scaleY: 1.0, alpha: 0, duration: life * 0.6, ease: 'Quad.easeOut', onComplete: () => crack.destroy() })
        // green necrotic pillar surges up (corpse clawing free), then sinks back
        const col = scene.add.graphics().setDepth(o.depth + 0.6).setPosition(pt.x, pt.y).setScale(1, 0).setBlendMode(Phaser.BlendModes.ADD); made.push(col)
        _drawAcidColumn(col, 26, 10, GREEN, 0x1e5a32); _glow(col, GREEN, 3, 8)
        scene.tweens.add({ targets: col, scaleY: 1, duration: life * 0.2, ease: 'Back.easeOut',
          onComplete: () => scene.tweens.add({ targets: col, scaleY: 0.2, alpha: 0, y: pt.y - 6, duration: life * 0.35, ease: 'Quad.easeIn', onComplete: () => col.destroy() }) })
        if (mult > 0) {
          const d = scene.add.particles(pt.x, pt.y + 2, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.45 }, speedY: { min: -70, max: -28 }, speedX: { min: -40, max: 40 }, scale: { start: 0.32, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [DIRT, DARK, 0x241810], emitting: false })
          d.setDepth(o.depth + 0.4); d.explode(Math.round(10 * mult)); made.push(d); scene.time.delayedCall(life * 0.5, () => { try { d.destroy() } catch (e) {} })
          const sm = scene.add.particles(pt.x, pt.y - 6, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speedY: { min: -30, max: -10 }, speedX: { min: -14, max: 14 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [GREEN, 0xbfffd0], blendMode: 'ADD', emitting: false })
          sm.setDepth(o.depth + 0.7); sm.explode(Math.round(6 * mult)); made.push(sm); scene.time.delayedCall(life * 0.7, () => { try { sm.destroy() } catch (e) {} })
        }
      })
    })
    // 3) a cloud of carrion flies boils out across the room
    const flyN = Math.min(14, 6 + (o.count ?? 5))
    for (let i = 0; i < flyN; i++) {
      const f = this._flySprite(scene, x, y - 4, 0.26, o.depth + 1).setAlpha(0); made.push(f)
      const a = Math.random() * Math.PI * 2, r = (o.rectW * 0.3) * (0.4 + Math.random() * 0.7)
      const [tx, ty] = F.clamp(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6 - 6)
      f.setScale((tx >= x ? 1 : -1) * 0.26, 0.26)   // face travel direction (art faces right)
      scene.tweens.add({ targets: f, alpha: 0.9, duration: 150, delay: i * 18 })
      scene.tweens.addCounter({ from: 0, to: 1, duration: life * (0.7 + Math.random() * 0.4), delay: i * 18, ease: 'Linear',
        onUpdate: (tw) => { const p = tw.getValue(); f.x = x + (tx - x) * p + Math.sin(p * 30 + i) * 5; f.y = (y - 4) + (ty - (y - 4)) * p + Math.cos(p * 42 + i) * 4 },
        onComplete: () => { try { f.destroy() } catch (e) {} } })
      scene.tweens.add({ targets: f, alpha: 0, duration: life * 0.3, delay: life * 0.7 })
    }
    return made
  },

  // GRAVE ROT — the Zombie's Contagion Bite (reskin of the old shared plagueBurst).
  // Reads as DECAYING FLESH, not the slime's bright acid spores: a wet necrotic splat,
  // dark gore-chunks flung out on a gravity arc, a low brown-green bile waft that
  // SLUMPS rather than rising bright, and a couple of flies kicked up off the wound
  // (tying into the zombie's persistent fly-swarm). Opaque/wet palette, not additive.
  graveRotFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 12, durationMs: 620, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const ROT = 0x5a6b2c, DARK = 0x2c2410, BILE = 0x7d8a3a
    // wet necrotic splat on the ground (opaque, lobed)
    const splat = scene.add.graphics().setPosition(x, y + 5).setDepth(o.depth - 0.4).setScale(0.45).setAlpha(0.82)
    _drawAcidBlob(splat, 7, ROT); made.push(splat)
    scene.tweens.add({ targets: splat, scaleX: 1.45, scaleY: 1.2, alpha: 0, duration: life, ease: 'Quad.easeOut', onComplete: () => splat.destroy() })
    // flung GORE CHUNKS — dark-rot blobs arc out and fall, then squash on landing
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 18 + Math.random() * 26
      const c = scene.add.graphics().setPosition(x, y - 4).setDepth(o.depth + 0.4).setScale(0.4 + Math.random() * 0.3)
      _drawAcidBlob(c, 2.4 + Math.random() * 1.6, Math.random() < 0.5 ? DARK : ROT); made.push(c)
      const land = y + 6 + Math.random() * 8
      scene.tweens.add({ targets: c, x: x + Math.cos(a) * sp, y: land, duration: life * 0.6, ease: 'Quad.easeIn',
        onComplete: () => scene.tweens.add({ targets: c, alpha: 0, scaleX: 1.4, scaleY: 0.5, duration: life * 0.3, onComplete: () => c.destroy() }) })
    }
    // low brown-green bile waft (opaque-ish, only drifts up a little — reads as decay)
    for (let i = 0; i < 2; i++) {
      const g = scene.add.graphics().setPosition(x + (Math.random() * 10 - 5), y - 2).setDepth(o.depth).setScale(0.4).setAlpha(0.5)
      _drawMiasmaPuff(g, 6, ROT, BILE); made.push(g)
      scene.tweens.add({ targets: g, scale: 1.3, y: g.y - 7, alpha: 0, duration: life * (0.7 + Math.random() * 0.3), ease: 'Sine.easeOut', onComplete: () => g.destroy() })
    }
    // a few flies kicked up off the bite (erratic flight, then disperse)
    for (let i = 0; i < 3; i++) {
      const f = this._flySprite(scene, x, y - 6, 0.28, o.depth + 1).setAlpha(0); made.push(f)
      const tx = x + (Math.random() * 40 - 20), ty = y - 10 - Math.random() * 16
      f.setScale((tx >= x ? 1 : -1) * 0.28, 0.28)   // face travel direction (art faces right)
      scene.tweens.add({ targets: f, alpha: 0.9, duration: life * 0.18 })
      scene.tweens.addCounter({ from: 0, to: 1, duration: life * (0.9 + Math.random() * 0.4), ease: 'Linear',
        onUpdate: (tw) => { const p = tw.getValue(); f.x = x + (tx - x) * p + Math.sin(p * 40 + i) * 4; f.y = (y - 6) + (ty - (y - 6)) * p + Math.cos(p * 53 + i * 2) * 3 },
        onComplete: () => { try { f.destroy() } catch (e) {} } })
      scene.tweens.add({ targets: f, alpha: 0, duration: life * 0.3, delay: life * 0.7 })
    }
    // GPU rot motes
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: -30, max: -6 }, speedX: { min: -22, max: 22 }, scale: { start: 0.26, end: 0 }, alpha: { start: 0.55, end: 0 }, tint: [ROT, DARK], emitting: false })
      em.setDepth(o.depth + 0.6); em.explode(Math.round(8 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ROT AURA — the persistent "this hero is rotting and WILL rise" tell, fired on a
  // slow cadence by AdventurerRenderer while `_rotInfectedUntil` is active: a fly or
  // two buzzing up off the corpse-in-waiting + a dark rot mote. (Cheap; the heavy
  // legibility is carried by the ashen ColorMatrix + DOOMED skull pip in the renderer.)
  rotAuraFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const made = []
    const n = 1 + (Math.random() < 0.5 ? 1 : 0)
    for (let i = 0; i < n; i++) {
      const f = this._flySprite(scene, x + (Math.random() * 14 - 7), y - 2, 0.26, 12).setAlpha(0); made.push(f)
      const tx = x + (Math.random() * 22 - 11), ty = y - 14 - Math.random() * 10
      f.setScale((tx >= f.x ? 1 : -1) * 0.26, 0.26)   // face travel direction (art faces right)
      scene.tweens.add({ targets: f, alpha: 0.85, duration: 160 })
      scene.tweens.addCounter({ from: 0, to: 1, duration: 700 + Math.random() * 300, ease: 'Linear',
        onUpdate: (tw) => { const p = tw.getValue(); f.x = x + (tx - x) * p + Math.sin(p * 36 + i) * 3.5; f.y = (y - 2) + (ty - (y - 2)) * p + Math.cos(p * 48 + i) * 2.5 },
        onComplete: () => { try { f.destroy() } catch (e) {} } })
      scene.tweens.add({ targets: f, alpha: 0, duration: 220, delay: 560 })
    }
    const mult = _particlesMult()
    if (mult > 0) {
      const em = scene.add.particles(x, y - 2, _softDotTexture(scene), { lifespan: { min: 360, max: 620 }, speedY: { min: -22, max: -8 }, speedX: { min: -10, max: 10 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.4, end: 0 }, tint: [0x4a5526, 0x2c2410], emitting: false })
      em.setDepth(12); em.explode(Math.round(3 * mult)); made.push(em); scene.time.delayedCall(640, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ── Demon / hellfire toolkit (2026-06-11) — brimstone immolation ──────────

  // A cached FLAME-TONGUE texture (baked once) so the demon can WEAR a persistent
  // fire wreath cheaply (flickering Images) + the combust/inferno bursts can fling
  // upright flames. Origin = base-centre (use setOrigin(0.5,1) so it licks UP).
  flameTongueTexture(scene) {
    const key = '__qf_flametongue'
    if (scene.textures.exists(key)) return key
    const W = 22, H = 34
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H - 1)
    _drawFlameTongue(g, H - 3, W * 0.42)
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // EMBER RISE — a cheap puff of rising ADD embers. Fired on a fast cadence under the
  // demon's fire wreath (MinionRenderer) so it constantly sheds sparks.
  emberRiseFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const mult = _particlesMult(); if (mult <= 0) return null
    const o = { depth: 13, count: 3, spread: 8, originW: 14, ...opts }
    // Embers spawn ACROSS the body width (`x` range) so they rise spread out, not in
    // one straight column.
    const em = scene.add.particles(x, y, _softDotTexture(scene), { x: { min: -o.originW, max: o.originW }, lifespan: { min: 320, max: 620 }, speedY: { min: -46, max: -18 }, speedX: { min: -o.spread, max: o.spread }, scale: { start: 0.16, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [0xffb04a, 0xff5511], blendMode: 'ADD', emitting: false })
    em.setDepth(o.depth); em.explode(Math.max(1, Math.round(o.count * mult)))
    scene.time.delayedCall(640, () => { try { em.destroy() } catch (e) {} })
    return [em]
  },

  // HEAT SHIMMER — the persistent "this hero is heating up" tell, fired on a cadence
  // by AdventurerRenderer while the hero carries Hellfire heat. `opts.k` (0..1) is the
  // heat ratio: hotter heroes shed more, brighter, near-white motes (the build-up to
  // Combustion). The reddening Glow is carried by the renderer; this is the wisp.
  heatShimmerFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 12, k: 0.5, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const hot = _lerpColor(0xff8a3a, 0xfff0c0, o.k)
    const em = scene.add.particles(x, y - 2, _softDotTexture(scene), { lifespan: { min: 300, max: 560 }, speedY: { min: -40, max: -14 }, speedX: { min: -10, max: 10 }, scale: { start: 0.12 + 0.1 * o.k, end: 0 }, alpha: { start: 0.4 + 0.4 * o.k, end: 0 }, tint: [hot, 0xff5511], blendMode: 'ADD', emitting: false })
    em.setDepth(o.depth); em.explode(Math.max(1, Math.round((1 + 2 * o.k) * mult)))
    scene.time.delayedCall(580, () => { try { em.destroy() } catch (e) {} })
    return [em]
  },

  // FLAME LICK — a single ANIMATED, flickering flame at (x,y): its tip licks side to
  // side and its height wobbles each frame (no rigid static spike), rising then
  // guttering out, + a wisp of embers. The reusable "real fire" unit.
  flameLickFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 12, durationMs: 750, h: 18, w: 6, embers: true, emberCount: 3, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); made.push(g)
    const seed = ((x * 0.7 + y * 1.3) % 6.283)
    scene.tweens.addCounter({ from: 0, to: 1, duration: life, ease: 'Linear',
      onUpdate: (tw) => { const p = tw.getValue()
        const env = Math.sin(p * Math.PI)                                  // grow → gutter out
        // flicker is VERTICAL (the tip darts up + the body pinches), not a lateral swing
        const flick = Math.sin(p * 34 + seed) * 0.5 + Math.sin(p * 57 + seed * 2.1) * 0.3
        const hh = o.h * (0.55 + 0.45 * env) * (1 + 0.22 * flick)          // height darts
        const ww = o.w * (0.82 + 0.2 * env) * (1 - 0.1 * flick)            // pinches when it shoots up
        const tipDX = o.w * Math.sin(p * 21 + seed) * 0.16                 // only a small tip waver
        g.clear(); g.setAlpha((0.55 + 0.4 * env) * (0.9 + 0.1 * flick))
        _drawFlame(g, hh, ww, tipDX)
      },
      onComplete: () => g.destroy() })
    if (o.embers && mult > 0) {
      const em = scene.add.particles(x, y - o.h * 0.45, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.7 }, speedY: { min: -42, max: -14 }, speedX: { min: -10, max: 10 }, scale: { start: 0.15, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [0xffcc44, 0xff5511], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 0.5); em.explode(Math.round(o.emberCount * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // HELLFIRE AURA — the demon's roiling bonfire: a ring of FLICKERING flames licks up
  // around it, a heat-shimmer glows on the floor, embers rise. Fired each aura tick.
  hellfireAuraFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 11, durationMs: 900, radius: 60, flames: true, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const R = o.radius
    // roiling, IRREGULAR heat-glow on the floor (layered + breathing) — not a flat oval
    const glow = scene.add.graphics().setPosition(x, y + 4).setDepth(o.depth - 1).setBlendMode(Phaser.BlendModes.ADD).setScale(0.9); made.push(glow)
    const gv = 14, gn = Array.from({ length: gv }, () => 0.7 + Math.random() * 0.6)
    const heat = (rf, col, al) => { glow.fillStyle(col, al); glow.beginPath()
      for (let i = 0; i <= gv; i++) { const a = i / gv * Math.PI * 2, rr = R * rf * gn[i % gv] * (1 + 0.09 * Math.sin(i * 1.7)); const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.5; if (i === 0) glow.moveTo(px, py); else glow.lineTo(px, py) } glow.closePath(); glow.fillPath() }
    heat(1.0, 0xff3300, 0.10); heat(0.72, 0xff6611, 0.11); heat(0.44, 0xffb347, 0.12)
    scene.tweens.add({ targets: glow, scaleX: 1.12, scaleY: 1.12, alpha: 0, duration: life, ease: 'Sine.easeOut', onComplete: () => glow.destroy() })
    // Flame-spike ring around the aura edge — omitted for T1 (opts.flames=false), so
    // its Burning Aura reads as just the floor heat-glow + embers (tier progression).
    if (o.flames !== false) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.4
        const fx = x + Math.cos(a) * R * 0.85, fy = y + Math.sin(a) * R * 0.5
        const m = this.flameLickFx(scene, fx, fy, { depth: o.depth + (fy > y ? 0.3 : 0), durationMs: o.durationMs, h: 15 + Math.random() * 8, w: 4.5 + Math.random() * 2, embers: false, slow })
        if (m) made.push(...m)
      }
    }
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.5, max: life }, speedY: { min: -42, max: -14 }, speedX: { min: -20, max: 20 }, x: { min: -R * 0.7, max: R * 0.7 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [0xffaa33, 0xff5511], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(8 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // COMBUST — a max-Hellfire hero detonates: a hot flash, a cluster of flickering
  // flames flares up, + a hard radial ember spray.
  combustFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 13, durationMs: 560, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const flash = scene.add.circle(x, y, 8, 0xffe89a, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: small additive flash/glow core
    _glow(flash, 0xff7722, 5, 12); made.push(flash)
    scene.tweens.add({ targets: flash, scale: 3.2, alpha: 0, duration: life * 0.45, ease: 'Quad.easeOut', onComplete: () => flash.destroy() })
    // fire SHOCKWAVE — upright flames blast radially OUTWARD (the detonation throws
    // fire onto nearby allies). Detailed flame silhouettes flung out, not a plain ring.
    const SHN = 9
    for (let i = 0; i < SHN; i++) {
      const a = (i / SHN) * Math.PI * 2 + Math.random() * 0.3, dist = 24 + Math.random() * 16
      const fl = scene.add.image(x, y, this.flameTongueTexture(scene)).setOrigin(0.5, 1).setDepth(o.depth + 0.4).setScale(0.55).setBlendMode(Phaser.BlendModes.ADD); made.push(fl)
      scene.tweens.add({ targets: fl, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist * 0.7, scaleX: 0.95, scaleY: 0.45, alpha: 0, duration: life * 0.7, ease: 'Quad.easeOut', onComplete: () => fl.destroy() })
    }
    for (let i = 0; i < 5; i++) {
      const dx = (Math.random() - 0.5) * 16, dy = (Math.random() - 0.5) * 8
      const m = this.flameLickFx(scene, x + dx, y + dy, { depth: o.depth + (dy > 0 ? 0.3 : 0), durationMs: life * 0.85, h: 18 + Math.random() * 8, w: 5 + Math.random() * 2, embers: false, slow })
      if (m) made.push(...m)
    }
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: -70, max: -10 }, speedX: { min: -80, max: 80 }, scale: { start: 0.26, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [0xffcc44, 0xff5511], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(16 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // INFERNO — the Demon Lord's ULT: the whole room erupts. A heat wash, then columns
  // of FLICKERING flame erupt across the room in a wave sweeping outward, + ember
  // rain. (x,y) = demon pos; rectW/rectH ≈ room size.
  infernoFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 12, durationMs: 1500, rectW: 220, rectH: 140, count: 10, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const halfW = o.rectW / 2, halfH = o.rectH / 2, maxR = Math.hypot(halfW, halfH)
    // soft IRREGULAR heat pall over the room (layered lobed blob) — not a hard square
    const pall = scene.add.graphics().setPosition(x, y).setDepth(o.depth - 2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(pall)
    const wv = 18, wn = Array.from({ length: wv }, () => 0.72 + Math.random() * 0.52)
    const wash = (rf, col, al) => { pall.fillStyle(col, al); pall.beginPath()
      for (let i = 0; i <= wv; i++) { const a = i / wv * Math.PI * 2, rr = wn[i % wv] * rf * (1 + 0.06 * Math.sin(i * 2.3)); const px = Math.cos(a) * halfW * 1.1 * rr, py = Math.sin(a) * halfH * 1.14 * rr; if (i === 0) pall.moveTo(px, py); else pall.lineTo(px, py) } pall.closePath(); pall.fillPath() }
    wash(1.0, 0xff3300, 0.11); wash(0.66, 0xff5511, 0.12); wash(0.36, 0xffaa44, 0.10)
    scene.tweens.add({ targets: pall, alpha: 1, duration: life * 0.22, ease: 'Sine.easeOut',
      onComplete: () => scene.tweens.add({ targets: pall, alpha: 0, duration: life * 0.6, onComplete: () => pall.destroy() }) })
    // central ERUPTION — the Demon Lord belches a tall column of hellfire; the room
    // ignites FROM it outward. A hot flash + a flame pillar that heaves up then settles.
    const flash = scene.add.circle(x, y, 16, 0xffe89a, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 0.9)  // circle-ok: detonation flash core
    _glow(flash, 0xff7722, 6, 14); made.push(flash)
    scene.tweens.add({ targets: flash, scale: 3.2, alpha: 0, duration: life * 0.35, ease: 'Quad.easeOut', onComplete: () => flash.destroy() })
    const erupt = scene.add.image(x, y + 2, this.flameTongueTexture(scene)).setOrigin(0.5, 1).setDepth(o.depth + 1).setBlendMode(Phaser.BlendModes.ADD).setScale(1.4, 0).setAlpha(0.95); made.push(erupt)
    scene.tweens.add({ targets: erupt, scaleY: 3.4, scaleX: 1.8, duration: life * 0.16, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: erupt, scaleY: 1.0, scaleX: 1.2, alpha: 0, duration: life * 0.42, ease: 'Quad.easeIn', onComplete: () => erupt.destroy() }) })
    // ground fires erupt across the room FLOOR (clamped — no flames on walls)
    const F = _floodField(x, y, o)
    const N = Math.min(16, o.count)
    for (let i = 0; i < N; i++) {
      const [bx, by] = F.clamp(x + (Math.random() * 2 - 1) * halfW * 0.95, y + (Math.random() * 2 - 1) * halfH * 0.95)
      const delay = (Math.hypot(bx - x, by - y) / maxR) * life * 0.42 + Math.random() * 60
      scene.time.delayedCall(delay, () => {
        if (!_validXY(bx, by)) return
        const m = this.flameLickFx(scene, bx, by, { depth: o.depth + (by > y ? 0.3 : 0.1), durationMs: life * 0.5, h: 24 + Math.random() * 14, w: 6 + Math.random() * 2, embers: false, slow })
        if (m) made.push(...m)
      })
    }
    if (mult > 0) {
      const em = scene.add.particles(F.cx, F.cy, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.85 }, speedY: { min: -50, max: -12 }, speedX: { min: -30, max: 30 }, x: { min: -F.halfW, max: F.halfW }, y: { min: -F.halfH * 0.5, max: F.halfH * 0.5 }, scale: { start: 0.28, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [0xffaa33, 0xff4411], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 2); em.explode(Math.round(24 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ── Golem / stone toolkit (2026-06-11) — fortress bulwark ─────────────────

  // BULWARK — the golem soaks a blow: a clutch of jagged stone chips spalls off +
  // a dust puff. Fired when a construct takes a damage-reduced hit.
  bulwarkFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x8b8678, depth: 13, durationMs: 400, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // CLANG — a hard bright deflection flash where the blow bounced off the stone,
    // plus a spray of fast hot sparks. Sells "the hit glanced off, no damage got in".
    const flash = scene.add.circle(x, y - 6, 5, 0xfff4d8, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: small additive clang/impact flash core
    _glow(flash, 0xcdd6e0, 4, 9); made.push(flash)
    scene.tweens.add({ targets: flash, scale: 2.3, alpha: 0, duration: life * 0.55, ease: 'Quad.easeOut', onComplete: () => flash.destroy() })
    if (mult > 0) {
      const sp = scene.add.particles(x, y - 6, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.45 }, speed: { min: 60, max: 150 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xfff4d8, 0xcdd6e0], blendMode: 'ADD', emitting: false })
      sp.setDepth(o.depth + 0.6); sp.explode(Math.round(6 * mult)); made.push(sp); scene.time.delayedCall(life, () => { try { sp.destroy() } catch (e) {} })
    }
    const n = 3 + Math.round(Math.random() * 2)
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4, dist = 13 + Math.random() * 14
      const g = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth); _drawRockShard(g, 2.2 + Math.random() * 1.6, o.color); made.push(g)
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * dist, y: y - 6 + Math.sin(a) * dist + 10, angle: (Math.random() - 0.5) * 240, alpha: 0, scale: 0.5, duration: life, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    if (mult > 0) {
      const em = scene.add.particles(x, y - 4, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speedY: { min: -18, max: 6 }, speedX: { min: -26, max: 26 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0xb8b0a0, 0x6a6458], emitting: false })
      em.setDepth(o.depth - 0.5); em.explode(Math.round(7 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // HARDEN — the per-ally read of Bastion: a few stone plates snap onto the unit's
  // body + a grey "petrified" flash, ON the sprite (not a ring around it). Used by
  // bastionFx for every protected ally. (x,y) = ally sprite centre.
  _hardenFlashFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x8b8678, depth: 13, durationMs: 520, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    // grey petrified pulse over the body (irregular lobed blob — additive, ON the unit)
    const bv = 10, bn = Array.from({ length: bv }, () => 0.72 + Math.random() * 0.46)
    const blob = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55).setAlpha(0); made.push(blob)
    blob.fillStyle(0xd8d2c0, 0.5); blob.beginPath()
    for (let i = 0; i <= bv; i++) { const a = i / bv * Math.PI * 2, r = 8 * bn[i % bv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.15; if (i === 0) blob.moveTo(px, py); else blob.lineTo(px, py) }
    blob.closePath(); blob.fillPath()
    scene.tweens.add({ targets: blob, alpha: 0.5, scaleX: 1.25, scaleY: 1.3, duration: life * 0.32, ease: 'Sine.easeOut',
      onComplete: () => scene.tweens.add({ targets: blob, alpha: 0, duration: life * 0.45, onComplete: () => blob.destroy() }) })
    // 3 small plates clamp onto chest + shoulders
    const slots = [[0, -8, 1], [-7, -4, 0.85], [7, -4, 0.85]]
    for (let i = 0; i < slots.length; i++) {
      const [dx, dy, sm] = slots[i], sa = Math.random() * Math.PI * 2, sd = 15 + Math.random() * 10
      const g = scene.add.graphics().setPosition(x + Math.cos(sa) * sd, y - 6 + Math.sin(sa) * sd).setDepth(o.depth + 0.3).setScale(0.4).setAlpha(0).setAngle(Math.random() * 360)
      _drawRockShard(g, (3.4 + Math.random()) * sm, o.color); made.push(g)
      scene.tweens.add({ targets: g, x: x + dx, y: y - 6 + dy, scale: 0.9, alpha: 1, angle: (Math.random() - 0.5) * 28, duration: life * 0.36, delay: i * 30, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.4, delay: life * 0.2, onComplete: () => g.destroy() }) })
    }
    return made
  },

  // BASTION — the Golem Warden's ULT, reimagined as ARMOUR ASSEMBLY (not a ring of
  // slabs): interlocking stone plates fly INWARD from every direction and CLAMP onto
  // the golem's body at anatomical slots (helm, pauldrons, chest, vambraces, greaves),
  // sheathing it in a faceted carapace, while the body flashes petrified-grey. Each
  // protected ally hardens too (_hardenFlashFx). Converge+lock, on the unit — the
  // opposite of the erupt-outward ult pattern. (x,y) = golem centre; opts.allies = [{x,y}].
  bastionFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x8b8678, depth: 13, durationMs: 1600, allies: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // Anatomical armour slots: [dx, dy, scale, depthBias]. Lower/front plates layer
    // over the body; helm sits highest. Asymmetric body coverage, NOT a circle.
    const slots = [
      [0, -5, 1.5, 0.6],    // chest plate (hero)
      [-10, -13, 1.05, 0.4], [10, -13, 1.05, 0.4],   // pauldrons
      [0, -23, 0.85, 0.5],  // helm
      [-13, -4, 0.85, 0.5], [13, -4, 0.85, 0.5],     // vambraces
      [-7, 5, 1.0, 0.7], [7, 5, 1.0, 0.7],           // greaves (front-most)
    ]
    let landed = 0
    slots.forEach(([dx, dy, sm, db], i) => {
      const fx = x + dx, fy = y - 6 + dy
      const sa = Math.random() * Math.PI * 2, sd = 36 + Math.random() * 20   // start FAR out, random dir
      const g = scene.add.graphics().setPosition(x + Math.cos(sa) * sd, y - 6 + Math.sin(sa) * sd)
        .setDepth(o.depth + db).setScale(0.35).setAlpha(0).setAngle(Math.random() * 360)
      _drawRockShard(g, (6.5 + Math.random() * 1.6) * sm, o.color); made.push(g)
      const delay = i * 48 + Math.random() * 24
      scene.tweens.add({ targets: g, x: fx, y: fy, scale: 1, alpha: 1, angle: (Math.random() - 0.5) * 36,
        duration: life * 0.26, delay, ease: 'Back.easeOut',
        onComplete: () => {
          // CLAMP flash — a quick bright spall at the lock point, then hold + fade out
          if (mult > 0) {
            const sp = scene.add.particles(fx, fy, _softDotTexture(scene), { lifespan: { min: life * 0.1, max: life * 0.26 }, speed: { min: 18, max: 60 }, scale: { start: 0.16, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [0xfff4d8, 0xc9c2ac, 0x8a8472], emitting: false })
            sp.setDepth(o.depth + db + 0.1); sp.explode(Math.round(5 * mult)); made.push(sp); scene.time.delayedCall(life * 0.4, () => { try { sp.destroy() } catch (e) {} })
          }
          landed++
          scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.42, delay: life * 0.34, onComplete: () => g.destroy() })
        } })
    })
    // PETRIFY pulse — a grey-white hardened wash washes ON the body as the carapace sets
    // (~mid-assembly), irregular lobed (no flat shape). Reads as flesh→stone.
    const pv = 12, pn = Array.from({ length: pv }, () => 0.7 + Math.random() * 0.5)
    const petr = scene.add.graphics().setPosition(x, y - 7).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(petr)
    petr.fillStyle(0xe6e0cc, 0.5); petr.beginPath()
    for (let i = 0; i <= pv; i++) { const a = i / pv * Math.PI * 2, r = 15 * pn[i % pv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.2; if (i === 0) petr.moveTo(px, py); else petr.lineTo(px, py) }
    petr.closePath(); petr.fillPath()
    scene.tweens.add({ targets: petr, alpha: 0.55, scaleX: 1.3, scaleY: 1.35, duration: life * 0.34, delay: life * 0.18, ease: 'Sine.easeOut',
      onComplete: () => scene.tweens.add({ targets: petr, alpha: 0, duration: life * 0.5, onComplete: () => petr.destroy() }) })
    // LOCK-SLAM — one heavy dust burst at the feet when the carapace finishes setting.
    scene.time.delayedCall(life * 0.42, () => {
      if (mult <= 0 || !_validXY(x, y)) return
      const d = scene.add.particles(x, y + 8, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.55 }, speedX: { min: -52, max: 52 }, speedY: { min: -18, max: 2 }, x: { min: -12, max: 12 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.62, end: 0 }, tint: [0xc4bca8, 0x8a8270, 0x5e5848], emitting: false })
      d.setDepth(o.depth - 0.5); d.explode(Math.round(14 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
    })
    // ALLIES harden too — a quick stone-plate snap + petrify flash on each protected unit.
    for (const al of (o.allies || [])) {
      const m = this._hardenFlashFx(scene, al.x, al.y, { color: o.color, depth: o.depth, slow })
      if (m) made.push(...m)
    }
    return made
  },

  // A cached AEGIS-DOME texture (baked once) so a guardian golem can WEAR a persistent
  // protection bubble cheaply (one Image, squashed to the floor + breathed each frame).
  // A translucent stone-steel field rimmed with studded plates — a shield zone, not a
  // plain ring. Used by MinionRenderer for the otherwise-invisible Aegis aura.
  aegisDomeTexture(scene) {
    const key = '__qf_aegisdome'
    if (scene.textures.exists(key)) return key
    const W = 128, H = 128, R = 60
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H / 2)
    g.fillStyle(0x86a0bc, 0.09); g.fillCircle(0, 0, R)            // soft stone-steel field…
    g.fillStyle(0x6a86a2, 0.08); g.fillCircle(0, 0, R * 0.66)    // …denser core
    const seg = 14
    for (let i = 0; i < seg; i++) {                              // studded plate rim (diamonds = rotation-safe)
      const a = (i / seg) * Math.PI * 2, px = Math.cos(a) * R, py = Math.sin(a) * R, d = 5.5
      g.fillStyle(0x3a4654, 0.7); g.beginPath(); g.moveTo(px, py - d - 0.6); g.lineTo(px + d, py + 0.4); g.lineTo(px, py + d + 0.4); g.lineTo(px - d, py + 0.4); g.closePath(); g.fillPath()
      g.fillStyle(0x9fb6cc, 1); g.beginPath(); g.moveTo(px, py - d); g.lineTo(px + d * 0.85, py); g.lineTo(px, py + d); g.lineTo(px - d * 0.85, py); g.closePath(); g.fillPath()
      g.fillStyle(0xdcebfa, 0.85); g.fillCircle(px - 1, py - 1.4, 1.1)
    }
    g.lineStyle(2, 0xbcd6ee, 0.4); g.strokeCircle(0, 0, R)        // thin bright rim
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // A cached ROCK-PLATE texture (baked once) so an ally inside an Aegis dome can WEAR a
  // faint multi-rock shield — a few small stone plates overlaid on its sprite. Used by
  // MinionRenderer's aegis-protected tell.
  rockPlateTexture(scene) {
    const key = '__qf_rockplate'
    if (scene.textures.exists(key)) return key
    const W = 22, H = 22
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H / 2)
    _drawRockShard(g, 8, 0x9aa6b4)
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // A cached DREAD-FIELD texture (baked once) — a soft cold gloom blob with a feathered
  // falloff (concentric layers, brighter core → vanishing edge; NO hard rim, so it reads
  // as a pool of dread, not a ring). Laid squashed on the floor under a ghost, alpha
  // modulated by how much fear it's currently projecting. Drawn NORMAL (a cold haze).
  dreadFieldTexture(scene) {
    const key = '__qf_dreadfield'
    if (scene.textures.exists(key)) return key
    const W = 160, H = 160, cx = W / 2, cy = H / 2
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    const steps = 16
    for (let i = steps; i >= 1; i--) {
      const t = i / steps, r = 78 * t
      g.fillStyle(_lerpColor(0x21304f, 0xaebfe8, 1 - t), 0.06 * (1 - t) + 0.012)
      g.fillCircle(cx, cy, r)
    }
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },



  // AEGIS SHIMMER — the persistent "this ally is shielded" tell, fired on a slow cadence
  // by AdventurerRenderer… no, MinionRenderer for each minion inside an Aegis dome: a
  // faint stone-blue plate glint + a couple of rising motes. Cheap.
  aegisShimmerFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 12, ...opts }
    const made = []
    const gl = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(gl)
    gl.fillStyle(0xcfe2f4, 0.4); gl.fillEllipse(0, 0, 14, 11)
    scene.tweens.add({ targets: gl, alpha: 0.4, scaleX: 1.1, scaleY: 1.1, duration: 240, yoyo: true, onComplete: () => gl.destroy() })
    const mult = _particlesMult()
    if (mult > 0) {
      const em = scene.add.particles(x, y - 6, _softDotTexture(scene), { lifespan: { min: 360, max: 640 }, speedY: { min: -16, max: 4 }, speedX: { min: -10, max: 10 }, x: { min: -8, max: 8 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.4, end: 0 }, tint: [0xbcd6ee, 0x7f97ad], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth); em.explode(Math.max(1, Math.round(2 * mult))); made.push(em); scene.time.delayedCall(660, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ── Ghost · FEAR toolkit ──────────────────────────────────────────────────
  // FEAR STRIKE — a spectral wail-face LUNGES from the ghost (from) into the
  // target (to), bursts, and the target BLANCHES (pale cold wash) with a
  // fright-mark stabbing up. Directional + on-the-unit — not a ring.
  fearStrikeFx(scene, fromX, fromY, toX, toY, opts = {}) {
    if (!_validXY(fromX, fromY) || !_validXY(toX, toY)) return null
    const o = { color: 0x9fb6e8, depth: 13, durationMs: 620, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // 1. the wail-face lunges along the path, stretching as it strikes.
    const face = scene.add.graphics().setPosition(fromX, fromY).setDepth(o.depth + 0.4).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(face)
    _drawWailFace(face, 9, o.color)
    scene.tweens.add({ targets: face, x: toX, y: toY - 8, scaleX: 1.05, scaleY: 1.28, alpha: 0.92, duration: life * 0.44, ease: 'Cubic.easeIn',
      onComplete: () => scene.tweens.add({ targets: face, scaleX: 1.6, scaleY: 0.55, alpha: 0, duration: life * 0.3, ease: 'Quad.easeOut', onComplete: () => face.destroy() }) })
    // 2. cold wisps trail off the strike point.
    if (mult > 0) {
      const tr = scene.add.particles(toX, toY - 6, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.45 }, speed: { min: 14, max: 48 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0xcdd9f2, 0x6f86c0], emitting: false })
      tr.setDepth(o.depth + 0.1); scene.time.delayedCall(life * 0.44, () => tr.explode(Math.round(6 * mult))); made.push(tr); scene.time.delayedCall(life * 1.2, () => { try { tr.destroy() } catch (e) {} })
    }
    // 3. target blanches + a fright-mark pops over its head.
    scene.time.delayedCall(life * 0.42, () => {
      if (!_validXY(toX, toY)) return
      const blanch = scene.add.graphics().setPosition(toX, toY - 6).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(blanch)
      const bv = 11, bn = Array.from({ length: bv }, () => 0.7 + Math.random() * 0.45)
      blanch.fillStyle(0xcdd9f2, 0.5); blanch.beginPath()
      for (let i = 0; i <= bv; i++) { const a = i / bv * Math.PI * 2, r = 9 * bn[i % bv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.18; if (i === 0) blanch.moveTo(px, py); else blanch.lineTo(px, py) }
      blanch.closePath(); blanch.fillPath()
      scene.tweens.add({ targets: blanch, alpha: 0.5, scale: 1.25, duration: life * 0.2, yoyo: true, hold: life * 0.12, onComplete: () => blanch.destroy() })
      const mk = scene.add.graphics().setPosition(toX, toY - 28).setDepth(o.depth + 0.6).setScale(0.4).setAlpha(0); made.push(mk)   // centred, just above the head
      _drawFrightMark(mk, o.color)
      scene.tweens.add({ targets: mk, y: toY - 36, scale: 1.05, alpha: 1, duration: life * 0.22, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: mk, alpha: 0, y: toY - 40, duration: life * 0.3, delay: life * 0.16, onComplete: () => mk.destroy() }) })
    })
    return made
  },

  // DREAD AURA — the ghost's PRESENCE: pale spectral EYES blink open in the dark
  // around it, holding a cold stare toward the nearest prey, then lid shut. A
  // distinct fear-read (being watched) — not a mist/cloud/ring/tendril. Lightweight:
  // fires on the dread-aura tick cadence (a couple of eyes per beat).
  dreadAuraFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xb2c6ee, depth: 12, durationMs: 920, targets: [], radiusTiles: 3.5, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const R = (o.radiusTiles ?? 3.5) * 32 * 0.72
    // gaze direction — eyes cluster toward the nearest frightened adv.
    const tgts = (o.targets || []).filter(t => _validXY(t.x, t.y))
    let dir = null
    if (tgts.length) { let n = tgts[0], bd = Infinity; for (const t of tgts) { const d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; n = t } } dir = Math.atan2(n.y - y, n.x - x) }
    const N = o.count ?? (2 + (Math.round(x + y) % 2))   // 2–3 eyes (or forced count for ambient idle blinks)
    for (let i = 0; i < N; i++) {
      const base = dir != null ? dir : Math.random() * Math.PI * 2
      const ang = base + (Math.random() * 1.5 - 0.75)
      const rr = R * (0.34 + Math.random() * 0.66)
      const ex = x + Math.cos(ang) * rr, ey = (y - 8) + Math.sin(ang) * rr * 0.66
      if (!_validXY(ex, ey)) continue
      const s = 5 + Math.random() * 2.6
      const g = scene.add.graphics().setPosition(ex, ey).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(1, 0.04).setAlpha(0).setAngle((Math.random() * 16 - 8)); made.push(g)
      _drawSpectralEye(g, s, o.color)
      const dly = i * 85 + Math.random() * 60
      // open (lid up + fade in) → hold the stare → blink shut.
      scene.tweens.add({ targets: g, scaleY: 1, alpha: 0.85, duration: life * 0.2, delay: dly, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, scaleY: 0.04, alpha: 0, duration: life * 0.2, delay: life * 0.32, ease: 'Quad.easeIn', onComplete: () => g.destroy() }) })
    }
    return made
  },

  // HAUNT CLOAK — a translucent wail-face that CLINGS to / orbits a haunted adv,
  // bobbing in and out of the body. Capped to a brief clinging flicker (it re-fires
  // on each ghost hit, so it stays attached as the adv moves). On-the-unit, sticky.
  hauntCloakFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x86a0d8, depth: 13, durationMs: 5000, ...opts }
    const slow = o.slow ?? 1, life = Math.min(o.durationMs, 1500) * slow, made = []
    const face = scene.add.graphics().setDepth(o.depth + 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(face)
    _drawWailFace(face, 6.5, o.color)
    scene.tweens.addCounter({ from: 0, to: 1, duration: life, onUpdate: (tw) => {
      const p = tw.getValue(), ang = p * Math.PI * 3
      face.setPosition(x + Math.cos(ang) * 13, y - 14 + Math.sin(ang) * 6)
      face.setScale(0.72 + 0.12 * Math.sin(ang * 1.5))
      const a = p < 0.14 ? p / 0.14 : p > 0.8 ? (1 - p) / 0.2 : 1
      face.setAlpha(0.5 * a)
      face.setDepth(o.depth + (Math.sin(ang) >= 0 ? 0.6 : -0.6))   // orbit in front of / behind the body
    }, onComplete: () => face.destroy() })
    return made
  },

  // PALL OF DREAD (ULT) — "the room dies." The lights go out across the WHOLE room the
  // wraith stands in (a uniform dark fill over the room's exact rect — the inverse of
  // every additive tell), then a wail of cold force blasts outward in radial wind-streaks;
  // as it reaches each victim (staggered by distance) they BLANCH and recoil with a
  // fright-mark; then the light creeps back. The darkness is the hero read.
  // Grounded, in-world VFX — NO camera move / screen flash / shake (it's a room minion).
  pallOfDreadFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x8298cc, depth: 14, durationMs: 2600, rectW: 240, rectH: 160, victims: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const halfW = o.rectW / 2, halfH = o.rectH / 2
    const pale = _lerpColor(o.color, 0xffffff, 0.6)
    const apexMs = life * 0.34   // the scream lands here (room fully dark → wail blasts)

    // 1. THE ROOM DIES — the lights go out in the WHOLE room the wraith stands in: a
    //    uniform dark fill over the room's exact rectangle (a touch outset so the walls
    //    dim too), with a feathered edge so it isn't a razor rectangle. Drawn NORMAL
    //    (darkens) at depth 9.7 — above the floor, entities AND the overhead wall-caps —
    //    so everything in the room reads as blacked out, while the apparition + victims'
    //    marks render ABOVE it (depth ≥14) as the only light. Naturally clipped to the
    //    room rect (we only paint inside it) → corridors / neighbouring rooms stay lit.
    const rr = o.roomRect || { x: x - o.rectW / 2, y: y - o.rectH / 2, w: o.rectW, h: o.rectH }
    const out = 26, fe = 22
    const rx = rr.x - out, ry = rr.y - out, rw = rr.w + out * 2, rh = rr.h + out * 2
    const dark = scene.add.graphics().setDepth(9.7).setBlendMode(Phaser.BlendModes.NORMAL).setAlpha(0); made.push(dark)
    const darkCol = 0x04050b
    dark.fillStyle(darkCol, 1); dark.fillRect(rx + fe, ry + fe, Math.max(1, rw - 2 * fe), Math.max(1, rh - 2 * fe))   // solid interior
    for (let d = fe - 1; d >= 0; d--) {                                   // feathered border: 1px rings, alpha ramps in
      const a = (d + 1) / fe
      dark.fillStyle(darkCol, a)
      dark.fillRect(rx + d, ry + d, rw - 2 * d, 1); dark.fillRect(rx + d, ry + rh - d - 1, rw - 2 * d, 1)
      dark.fillRect(rx + d, ry + d, 1, rh - 2 * d); dark.fillRect(rx + rw - d - 1, ry + d, 1, rh - 2 * d)
    }
    scene.tweens.add({ targets: dark, alpha: 0.8, duration: life * 0.24, ease: 'Cubic.easeOut',         // lights die → hold → return
      onComplete: () => scene.tweens.add({ targets: dark, alpha: 0, duration: life * 0.4, delay: life * 0.2, ease: 'Sine.easeIn', onComplete: () => dark.destroy() }) })

    // 1b. THE HOST OF SPIRITS — a swarm of flowing soul-wisps bursts out of the wraith
    //     into the dark and weaves around the room on drifting curved orbits, banking to
    //     face their flight + trailing a soft shimmer. They glow ABOVE the darkness
    //     (depth 10.6) — only readable because the room went dark — then dissolve as the
    //     light returns. Each spirit's loop-centre slowly drifts so they roam the room.
    const NSPR = 8, spLife = life * 0.84
    const insX = rr.x + 50, insY = rr.y + 50, insW = Math.max(24, rr.w - 100), insH = Math.max(24, rr.h - 100)
    for (let i = 0; i < NSPR; i++) {
      const sp = scene.add.image(x, y, AbilityVfx.spiritWispTexture(scene)).setOrigin(0.5, 0.31).setDepth(10.6).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.62); made.push(sp)
      const tr = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 220 * slow, max: 460 * slow }, speed: { min: 3, max: 14 }, scale: { start: 0.17, end: 0 }, alpha: { start: 0.4, end: 0 }, tint: [0xbcd4f4, 0x6f93cc], blendMode: 'ADD', frequency: 55, quantity: 1 }); tr.setDepth(10.5); made.push(tr)
      const ocx = insX + Math.random() * insW, ocy = insY + Math.random() * insH          // loop centre (roams)
      const orad = 22 + (i % 4) * 13, spin = (i % 2 ? 1 : -1) * (1.3 + (i % 3) * 0.45)
      const a0 = (i / NSPR) * Math.PI * 2, dphX = Math.random() * 6, dphY = Math.random() * 6
      const burst = 0.16
      let lastX = x, lastY = y
      scene.tweens.addCounter({ from: 0, to: 1, duration: spLife, onUpdate: (tw) => {
        const p = tw.getValue()
        const cxp = ocx + Math.sin(p * 2.1 + dphX) * insW * 0.16, cyp = ocy + Math.cos(p * 1.7 + dphY) * insH * 0.16   // centre drifts → roams the room
        const ang = a0 + spin * p * Math.PI * 2
        const tx = cxp + Math.cos(ang) * orad, ty = cyp + Math.sin(ang) * orad * 0.7 + Math.sin(p * 9 + i) * 6
        let sx, sy
        if (p < burst) { const e = 1 - Math.pow(1 - p / burst, 2); sx = x + (tx - x) * e; sy = y + (ty - y) * e }   // burst out of the wraith
        else { sx = tx; sy = ty }
        sp.setPosition(sx, sy)
        const dx = sx - lastX, dy = sy - lastY
        if (dx * dx + dy * dy > 0.25) sp.rotation = Math.atan2(dy, dx) + Math.PI / 2   // bank to face flight
        lastX = sx; lastY = sy
        const fade = p < 0.1 ? p / 0.1 : p > 0.84 ? (1 - p) / 0.16 : 1
        sp.setAlpha(Math.max(0, fade) * (0.82 + 0.18 * Math.sin(p * 34 + i * 2)))       // shimmer flicker
        sp.setScale(0.62 * (0.85 + 0.15 * Math.sin(p * 17 + i)))
        tr.setPosition(sx, sy)
      }, onComplete: () => { sp.destroy(); tr.stop(); scene.time.delayedCall(520 * slow, () => { try { tr.destroy() } catch (e) {} }) } })
    }

    // 2. THE WAIL — at the apex a blast of cold force erupts from the wraith: radial
    //    wind-streaks shoot outward across the room floor (squashed for perspective) and
    //    fade. A force blast, not a clean ring.
    scene.time.delayedCall(apexMs, () => {
      const wave = scene.add.graphics().setPosition(x, y - halfH * 0.12).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD); made.push(wave)
      const NS = 18, streaks = Array.from({ length: NS }, (_, i) => ({ a: (i / NS) * Math.PI * 2 + (Math.random() * 0.22 - 0.11), len: 0.72 + Math.random() * 0.5 }))
      scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.42, ease: 'Cubic.easeOut', onUpdate: (tw) => {
        const p = tw.getValue(), al = 1 - p
        wave.clear()
        for (const st of streaks) {
          const ca = Math.cos(st.a), sa = Math.sin(st.a) * 0.62           // squashed → floor perspective
          const r0 = halfW * 0.12 + p * halfW * 0.95 * st.len, r1 = r0 + halfW * 0.3 * (1 - p * 0.55)
          wave.lineStyle(2.6 * (1 - p * 0.6), pale, 0.62 * al); wave.beginPath(); wave.moveTo(ca * r0, sa * r0); wave.lineTo(ca * r1, sa * r1); wave.strokePath()
          wave.lineStyle(1.1 * (1 - p * 0.6), 0xffffff, 0.5 * al); wave.beginPath(); wave.moveTo(ca * r0, sa * r0); wave.lineTo(ca * (r0 + (r1 - r0) * 0.5), sa * (r0 + (r1 - r0) * 0.5)); wave.strokePath()
        }
      }, onComplete: () => wave.destroy() })
    })

    // 3. TERROR LANDS — as the wail reaches each victim (staggered by distance from the
    //    wraith) they BLANCH (a pale cold wash) and recoil with a centred fright-mark.
    for (const v of (o.victims || [])) {
      if (!_validXY(v.x, v.y)) continue
      const dist = Math.hypot(v.x - x, v.y - y)
      const reach = apexMs + Math.min(life * 0.26, (dist / Math.max(1, halfW)) * life * 0.2)
      scene.time.delayedCall(reach, () => {
        if (!_validXY(v.x, v.y)) return
        const bl = scene.add.graphics().setPosition(v.x, v.y - 6).setDepth(o.depth + 0.5).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(bl)
        const bv = 11, bn = Array.from({ length: bv }, () => 0.7 + Math.random() * 0.42)
        bl.fillStyle(0xcdd9f2, 0.5); bl.beginPath()
        for (let i = 0; i <= bv; i++) { const a = i / bv * Math.PI * 2, r = 10 * bn[i % bv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.2; if (i === 0) bl.moveTo(px, py); else bl.lineTo(px, py) }
        bl.closePath(); bl.fillPath()
        scene.tweens.add({ targets: bl, alpha: 0.55, scale: 1.3, duration: life * 0.13, yoyo: true, hold: life * 0.1, onComplete: () => bl.destroy() })
        const mk = scene.add.graphics().setPosition(v.x, v.y - 30).setDepth(o.depth + 0.9).setScale(0.4).setAlpha(0); made.push(mk)
        _drawFrightMark(mk, 0xdce6fb)
        scene.tweens.add({ targets: mk, y: v.y - 38, scale: 1.15, alpha: 1, duration: life * 0.14, ease: 'Back.easeOut',
          onComplete: () => scene.tweens.add({ targets: mk, alpha: 0, y: v.y - 44, duration: life * 0.3, delay: life * 0.16, onComplete: () => mk.destroy() }) })
      })
    }

    return made
  },

  // PANIC STATE — the readable "this hero is terror-frozen" tell, fired on a cadence
  // while a hero is panicking (AISystem). Sweat beads flick off the head, the head
  // trembles (jitter ticks), and a small terror emote pops — so the player can SEE a
  // helpless, cowering kill. On-the-unit, organic (no ring).
  panicStateFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xbcd0f4, depth: 41, durationMs: 640, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const hy = y - 18
    // teardrop sweat bead (tip up, round bottom) — a small incidental shape.
    const tear = (g, s, col, al) => {
      g.fillStyle(col, al); g.beginPath(); g.moveTo(0, -s * 1.7)
      for (let k = 0; k <= 10; k++) { const a = -0.3 + (Math.PI + 0.6) * (k / 10); g.lineTo(Math.cos(a) * s * 0.9, s * 0.25 + Math.sin(a) * s * 0.9) }
      g.closePath(); g.fillPath()
    }
    // 1. sweat beads flick off the head and fall.
    for (let i = 0; i < 3; i++) {
      const side = i % 2 === 0 ? 1 : -1
      const bx = x + side * (6 + Math.random() * 4), by = hy - 2 + Math.random() * 4
      const g = scene.add.graphics().setPosition(bx, by).setDepth(o.depth).setAlpha(0); made.push(g)
      tear(g, 2.5, 0x0a1020, 0.35); tear(g, 2.2, o.color, 0.92); g.fillStyle(0xffffff, 0.7); g.fillCircle(-0.6, -1.2, 0.7)
      scene.tweens.add({ targets: g, x: bx + side * (7 + Math.random() * 6), y: by + 13 + Math.random() * 8, alpha: 1, duration: life * 0.42, delay: i * 70, ease: 'Quad.easeIn',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.2, onComplete: () => g.destroy() }) })
    }
    // 2. the head TREMBLES — short jitter ticks each side.
    const jit = scene.add.graphics().setDepth(o.depth + 0.1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(jit)
    scene.tweens.addCounter({ from: 0, to: 1, duration: life, onUpdate: (tw) => {
      const p = tw.getValue(), ph = Math.sin(p * Math.PI * 9)
      jit.clear(); jit.setAlpha(Math.sin(p * Math.PI) * 0.7); jit.lineStyle(1.6, o.color, 0.7)
      for (const sx of [-11, 11]) { jit.beginPath(); for (let k = 0; k < 4; k++) { const yy = hy - 6 + k * 4, xx = x + sx + (k % 2 ? 2 : -2) * ph; if (k === 0) jit.moveTo(xx, yy); else jit.lineTo(xx, yy) } jit.strokePath() }
    }, onComplete: () => jit.destroy() })
    // 3. a small terror emote pops over the head.
    const mk = scene.add.graphics().setPosition(x, hy - 11).setDepth(o.depth + 0.3).setScale(0.3).setAlpha(0); made.push(mk)
    _drawFrightMark(mk, o.color)
    scene.tweens.add({ targets: mk, scale: 0.68, alpha: 1, y: hy - 15, duration: life * 0.26, ease: 'Back.easeOut', yoyo: true, hold: life * 0.22, onComplete: () => mk.destroy() })
    return made
  },

  // ── Beholder · GAZE / DOMINATION toolkit ──────────────────────────────────
  // A wavering, iris-textured GAZE-RAY from the eye to a target (not a clean laser:
  // it snakes + flickers). Shared by mesmerizeFx + manyEyesFx.
  _gazeRayFx(scene, fromX, fromY, toX, toY, opts = {}) {
    if (!_validXY(fromX, fromY) || !_validXY(toX, toY)) return []
    const o = { color: 0xc060ff, depth: 13, durationMs: 720, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const dx = toX - fromX, dy = toY - (fromY - 4), len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux
    const ray = scene.add.graphics().setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(ray)
    const draw = (p, ph) => {
      ray.clear()
      const segs = 16
      const stroke = (w, col, al) => { ray.lineStyle(w, col, al); ray.beginPath(); for (let i = 0; i <= segs; i++) { const f = i / segs, along = f * len * p, wob = Math.sin(f * 7 + ph) * 3 * (1 - Math.abs(f - 0.5) * 1.4); const px = fromX + ux * along + nx * wob, py = (fromY - 4) + uy * along + ny * wob; if (i === 0) ray.moveTo(px, py); else ray.lineTo(px, py) } ray.strokePath() }
      stroke(5, _lerpColor(o.color, 0xffffff, 0.2), 0.22); stroke(2.4, o.color, 0.7); stroke(1, 0xffffff, 0.6)
    }
    scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.5, ease: 'Quad.easeOut', onUpdate: (tw) => { const p = tw.getValue(); ray.setAlpha(Math.min(1, p * 2)); draw(p, p * 22) }, onComplete: () => scene.tweens.add({ targets: ray, alpha: 0, duration: life * 0.32, onComplete: () => ray.destroy() }) })
    return made
  },

  // A spinning double-SPIRAL hypnotic swirl over a charmed hero's head (the "dominated"
  // tell). On-the-unit, organic curves — not a ring.
  _hypnoSwirlFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return []
    const o = { color: 0xc060ff, depth: 41, durationMs: 950, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(g)
    const arm = (rot, col, w) => { g.lineStyle(w, col, 0.8); g.beginPath(); const pts = 40; for (let i = 0; i <= pts; i++) { const t = i / pts, a = rot + t * 2.4 * Math.PI * 2, r = t * 6.5; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.7; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.strokePath() }
    scene.tweens.addCounter({ from: 0, to: 1, duration: life, onUpdate: (tw) => { const p = tw.getValue(), a = p < 0.16 ? p / 0.16 : p > 0.82 ? (1 - p) / 0.18 : 1; g.clear(); g.setAlpha(0.85 * a); arm(p * Math.PI * 5, o.color, 1.8); arm(-p * Math.PI * 5 + Math.PI, _lerpColor(o.color, 0xffffff, 0.4), 1.2) }, onComplete: () => g.destroy() })
    return made
  },

  // The MASS-HYPNOSIS (T2) tell — DELIBERATELY distinct from the single-spiral mesmerize
  // so the player can tell them apart: a clutch of dazed little stars ORBITING the head
  // on a tilted ring (the classic "seeing stars / out of it" read). Different shape +
  // motion (orbiting motes, not a spinning spiral) + a lavender tint.
  _hypnoDazeFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return []
    // GOLD "seeing stars" — deliberately a different HUE from mesmerize's purple swirl
    // (the player reads single-charm vs mass-charm by both shape AND colour).
    const o = { color: 0xffd24a, depth: 41, durationMs: 1050, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const N = 4
    // a small 4-point star, drawn at (cx,cy) with size s.
    const star = (g, cx, cy, s, col, al) => { g.fillStyle(col, al); g.beginPath(); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = (k % 2 ? s * 0.42 : s); const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.closePath(); g.fillPath() }
    const g = scene.add.graphics().setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(g)
    scene.tweens.addCounter({ from: 0, to: 1, duration: life, onUpdate: (tw) => {
      const p = tw.getValue(), a0 = p * Math.PI * 3.4, fade = p < 0.14 ? p / 0.14 : p > 0.84 ? (1 - p) / 0.16 : 1
      g.clear(); g.setAlpha(fade)
      const order = []
      for (let i = 0; i < N; i++) { const a = a0 + i / N * Math.PI * 2; order.push({ a, depth: Math.sin(a) }) }
      order.sort((p1, p2) => p1.depth - p2.depth)   // back-to-front so "front" stars sit on top
      for (const m of order) { const front = m.depth >= 0, ox = Math.cos(m.a) * 12, oy = y - 17 - Math.sin(m.a) * 4.5; star(g, x + ox, oy, front ? 3 : 2, _lerpColor(o.color, 0xffffff, front ? 0.5 : 0.1), front ? 0.95 : 0.45) }
    }, onComplete: () => g.destroy() })
    return made
  },

  // EYE IGNITE — the beholder's OWN eye blazes (positioned on the sprite's central eye,
  // NOT a floating cartoon eye): a hot radiant bloom wells up + a bright IRIS RING snaps
  // INWARD as it focuses and locks on. Welds the gaze to the actual art. Shared by all
  // three gaze abilities; the renderer also flashes a violet Glow on the sprite itself.
  _eyeIgniteFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return []
    const o = { color: 0xc060ff, depth: 13, durationMs: 560, size: 9, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = [], pale = _lerpColor(o.color, 0xffffff, 0.5), s = o.size
    const glow = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.35).setAlpha(0); made.push(glow)
    glow.fillStyle(o.color, 0.34); glow.fillCircle(0, 0, s * 1.7)        // radiant bloom from the eye (no white sclera blob)
    glow.fillStyle(pale, 0.55); glow.fillCircle(0, 0, s * 0.95)
    glow.fillStyle(0xffffff, 0.85); glow.fillCircle(0, 0, s * 0.42)
    scene.tweens.add({ targets: glow, scale: 1.2, alpha: 0.95, duration: life * 0.16, ease: 'Quad.easeOut', yoyo: true, hold: life * 0.34, onComplete: () => glow.destroy() })
    const ring = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.42).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(ring)
    scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.52, ease: 'Cubic.easeIn', onUpdate: (tw) => { const p = tw.getValue(), r = s * (1.9 - 1.35 * p), a = p < 0.18 ? p / 0.18 : (1 - p); ring.clear(); ring.lineStyle(2.4 * (1 - p * 0.4), pale, 0.85 * a); ring.strokeCircle(0, 0, r); ring.lineStyle(1, 0xffffff, 0.7 * a); ring.strokeCircle(0, 0, r * 0.5) }, onComplete: () => ring.destroy() })   // iris-ring snaps INWARD (focusing), not a generic expanding ring
    return made
  },

  // PETRIFY BEAM — a RIGID straight petrifying gaze-beam (deliberately un-wavering, unlike
  // the snaking charm ray) that lances out then HARDENS to stone-grey as it fades. The
  // Tyrant's Glare barrage fires one of these from the eye + eyestalks at every victim.
  _petrifyBeamFx(scene, fromX, fromY, toX, toY, opts = {}) {
    if (!_validXY(fromX, fromY) || !_validXY(toX, toY)) return []
    const o = { color: 0xc77bff, depth: 14, durationMs: 700, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = [], stone = 0x9a90a8
    const beam = scene.add.graphics().setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(beam)
    const dx = toX - fromX, dy = toY - fromY, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
    const draw = (p, hard) => {
      beam.clear()
      const ex = fromX + ux * len * p, ey = fromY + uy * len * p
      const stroke = (w, col, al) => { beam.lineStyle(w, col, al); beam.beginPath(); beam.moveTo(fromX, fromY); beam.lineTo(ex, ey); beam.strokePath() }
      stroke(7, _lerpColor(o.color, stone, hard), 0.22); stroke(3.2, _lerpColor(o.color, stone, hard * 0.7), 0.75); stroke(1.2, 0xffffff, 0.7 * (1 - hard * 0.5))
    }
    scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.3, ease: 'Expo.easeOut', onUpdate: (tw) => { beam.setAlpha(1); draw(tw.getValue(), 0) },
      onComplete: () => scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.55, onUpdate: (tw) => { const h = tw.getValue(); draw(1, h); beam.setAlpha(1 - h * 0.85) }, onComplete: () => beam.destroy() }) })
    return made
  },

  // MESMERIZE (T1) — the beholder's OWN eye blazes (welded to the sprite), a wavering ray
  // lances to the hero, and a hypnotic swirl spins over them (now charmed → attacks allies).
  mesmerizeFx(scene, fromX, fromY, toX, toY, opts = {}) {
    if (!_validXY(fromX, fromY) || !_validXY(toX, toY)) return null
    const o = { color: 0xc060ff, depth: 13, durationMs: 760, ...opts }
    const slow = o.slow ?? 1, made = [], ey = fromY - 3   // the sprite's central eye sits ~here
    made.push(...this._eyeIgniteFx(scene, fromX, ey, { color: o.color, slow, size: 9 }))
    const sy = toY - 18
    made.push(...this._gazeRayFx(scene, fromX, ey, toX, sy, { color: o.color, slow }))
    made.push(...this._hypnoSwirlFx(scene, toX, sy, { color: o.color, slow }))
    return made
  },

  // MASS HYPNOSIS (T2) — the central eye blazes wider AND the RIM eyestalk-eyes glint/fire
  // too; a FAN of gaze-rays lances to several heroes at once, each falling under a daze.
  manyEyesFx(scene, x, y, targets, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xcc77ff, depth: 13, durationMs: 760, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = [], ey = y - 3
    made.push(...this._eyeIgniteFx(scene, x, ey, { color: o.color, slow, size: 12 }))
    // the rim eyestalk-eyes fire too — quick gaze-glints around the body perimeter
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, rr = 15 + Math.random() * 4, gx = x + Math.cos(a) * rr, gy = ey + Math.sin(a) * rr * 0.9
      const gl = scene.add.graphics().setPosition(gx, gy).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(gl)
      gl.fillStyle(o.color, 0.5); gl.fillCircle(0, 0, 4.5); gl.fillStyle(_lerpColor(o.color, 0xffffff, 0.5), 0.9); gl.fillCircle(0, 0, 2.4)   // a stalk-eye glint, not a generic dot
      scene.tweens.add({ targets: gl, scale: 1, alpha: 0.9, duration: life * 0.12, delay: i * 22, yoyo: true, hold: life * 0.1, onComplete: () => gl.destroy() })
    }
    for (const t of (targets || [])) { if (!_validXY(t.x, t.y)) continue; const sy = t.y - 17; made.push(...this._gazeRayFx(scene, x, ey, t.x, sy, { color: o.color, slow })); made.push(...this._hypnoDazeFx(scene, t.x, t.y, { slow })) }
    return made
  },

  // TYRANT'S GLARE (ULT) — the Tyrant's OWN eye blazes huge (welded to the sprite via the
  // renderer Glow + an in-world bloom) and the eye + eyestalks fire a BARRAGE of rigid
  // petrifying gaze-beams at EVERY victim at once; each crusts to stone with a hex-flash,
  // over a faint violet ground pulse. The "all eyes fire, everyone turns to stone" read —
  // no floating cartoon eye.
  tyrantGlareFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xc77bff, depth: 14, durationMs: 2000, rectW: 240, rectH: 160, victims: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = [], ey = y - 4
    // the Tyrant's eye blazes huge (the renderer also flashes a big Glow on the sprite)
    made.push(...this._eyeIgniteFx(scene, x, ey, { color: o.color, slow, size: 18, durationMs: 760 }))
    // a faint violet ground pulse under the Tyrant (soft, no hard ring)
    const pulse = scene.add.graphics().setPosition(x, y + 8).setDepth(o.depth - 0.5).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(pulse)
    pulse.fillStyle(o.color, 0.32); pulse.fillEllipse(0, 0, o.rectW * 0.46, o.rectH * 0.3)
    scene.tweens.add({ targets: pulse, alpha: 0.32, scale: 1.5, duration: life * 0.4, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: pulse, alpha: 0, duration: life * 0.3, onComplete: () => pulse.destroy() }) })
    const vs = (o.victims || []).filter(v => _validXY(v.x, v.y))
    vs.forEach((v, i) => {
      const sy = v.y - 12
      // the barrage — a main petrify-beam from the central eye + thinner echo beams from
      // two eyestalk offsets (the many eyes firing), all at once (slightly staggered).
      scene.time.delayedCall(life * 0.16 + i * 45, () => {
        made.push(...this._petrifyBeamFx(scene, x, ey, v.x, sy, { color: o.color, slow }))
        for (const off of [[-13, -1], [13, -1]]) made.push(...this._petrifyBeamFx(scene, x + off[0], ey + off[1], v.x, sy, { color: o.color, slow, durationMs: 600 }))
      })
      // the victim crusts to STONE + hex-flash as its beam lands
      scene.time.delayedCall(life * 0.34 + i * 45, () => {
        if (!_validXY(v.x, v.y)) return
        const fl = scene.add.graphics().setPosition(v.x, v.y - 6).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(fl)
        const bv = 10, bn = Array.from({ length: bv }, () => 0.7 + Math.random() * 0.5); fl.fillStyle(o.color, 0.5); fl.beginPath()
        for (let k = 0; k <= bv; k++) { const a = k / bv * Math.PI * 2, r = 9 * bn[k % bv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.15; if (k === 0) fl.moveTo(px, py); else fl.lineTo(px, py) }
        fl.closePath(); fl.fillPath()
        scene.tweens.add({ targets: fl, alpha: 0.5, scale: 1.2, duration: life * 0.16, yoyo: true, onComplete: () => fl.destroy() })
        // (no stone-crust rock / stone-dust — the victim's own petrify GRAYSCALE carries the
        // "turned to stone" read; AdventurerRenderer desaturates while _petrifiedUntil holds.)
      })
    })
    return made
  },

  // ── Gnoll · BLOOD HUNT toolkit ────────────────────────────────────────────
  // BLEED SLASH — a vicious 3-claw rake across the CENTRE of the hero's sprite, a
  // directional arterial spray (gravity-pulled), heavy gore gobs flung out, and a red
  // impact flash. Centred + in front so the hit reads.
  bleedSlashFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xcc1818, depth: 14, durationMs: 540, stacks: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cx = x, cy = y - 10, st = Math.min(6, o.stacks ?? 1), ang = -28 + Math.random() * 56
    const fl = scene.add.graphics().setPosition(cx, cy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(fl)
    fl.fillStyle(0xff3020, 0.5); fl.fillCircle(0, 0, 11)
    scene.tweens.add({ targets: fl, alpha: 0.6, scale: 1.2, duration: life * 0.12, yoyo: true, onComplete: () => fl.destroy() })
    const claw = scene.add.graphics().setPosition(cx, cy).setDepth(o.depth + 0.5).setAngle(ang).setScale(0.25, 1).setAlpha(0); made.push(claw)
    _drawClawGashes(claw, 28)
    scene.tweens.add({ targets: claw, scaleX: 1.25, alpha: 1, duration: life * 0.12, ease: 'Expo.easeOut',
      onComplete: () => scene.tweens.add({ targets: claw, alpha: 0, scaleX: 1.5, duration: life * 0.42, onComplete: () => claw.destroy() }) })
    if (mult > 0) {
      // radial arterial BURST — sprays outward in all directions (not raining down)
      const d = scene.add.particles(cx, cy, _softDotTexture(scene), { lifespan: { min: life * 0.35, max: life * 0.8 }, speed: { min: 70, max: 200 }, angle: { min: 0, max: 360 }, gravityY: 30, scale: { start: 0.28, end: 0 }, alpha: { start: 0.95, end: 0 }, tint: [0xe01a1a, 0xaa0e0e, 0x6a0606], emitting: false })
      d.setDepth(o.depth + 0.6); d.explode(Math.round((10 + st * 3) * mult)); made.push(d); scene.time.delayedCall(life * 1.1, () => { try { d.destroy() } catch (e) {} })
    }
    for (let i = 0; i < 2 + Math.min(4, st); i++) {
      const a = Math.random() * Math.PI * 2, dist = 18 + Math.random() * 24   // heavy gobs fling outward too
      const g = scene.add.graphics().setPosition(cx, cy).setDepth(o.depth + 0.4).setScale(0.6 + Math.random() * 0.5); made.push(g)
      _drawGoreGob(g, 2.6)
      scene.tweens.add({ targets: g, x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist + Math.random() * 6, duration: life * 0.5, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.25, onComplete: () => g.destroy() }) })
    }
    return made
  },

  // BLEEDING AURA — the persistent "this hero is bleeding" tell, scaling HARD with stacks:
  // a pulsing wound-glow + welling beads + (at high stacks) gushing rivulets down the body
  // + heavier drips. In FRONT of the sprite (depth 43) so it always reads.
  bleedingAuraFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xc01414, depth: 43, durationMs: 1000, stacks: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y - 10, st = Math.min(6, o.stacks ?? 1), f = st / 6
    const glow = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(glow)
    const gv = 12, gn = Array.from({ length: gv }, () => 0.7 + Math.random() * 0.5); glow.fillStyle(0xd01010, 0.5); glow.beginPath()
    for (let i = 0; i <= gv; i++) { const a = i / gv * Math.PI * 2, r = (7 + f * 9) * gn[i % gv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.15; if (i === 0) glow.moveTo(px, py); else glow.lineTo(px, py) }
    glow.closePath(); glow.fillPath()
    scene.tweens.add({ targets: glow, alpha: 0.18 + 0.32 * f, scaleX: 1.15, scaleY: 1.2, duration: life * 0.4, yoyo: true, onComplete: () => glow.destroy() })
    const bead = (gg, s, col, al) => { gg.fillStyle(col, al); gg.beginPath(); gg.moveTo(0, -s * 1.6); for (let k = 0; k <= 8; k++) { const a = -0.3 + (Math.PI + 0.6) * (k / 8); gg.lineTo(Math.cos(a) * s * 0.85, s * 0.2 + Math.sin(a) * s * 0.85) } gg.closePath(); gg.fillPath() }
    const nb = 1 + Math.round(f * 4)
    for (let i = 0; i < nb; i++) {
      const bx = x + (Math.random() * 18 - 9), by = cy - 4 + Math.random() * 8, bs = 2.2 + f * 1.4
      const g = scene.add.graphics().setPosition(bx, by).setDepth(o.depth).setAlpha(0); made.push(g)
      bead(g, bs + 0.4, 0x4a0808, 0.5); bead(g, bs, o.color, 0.95); g.fillStyle(0xff8866, 0.5); g.fillCircle(-bs * 0.3, -bs * 0.5, bs * 0.3)
      scene.tweens.add({ targets: g, y: by + 14 + Math.random() * 10, alpha: 1, duration: life * 0.55, delay: i * 70, ease: 'Quad.easeIn',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.2, onComplete: () => g.destroy() }) })
    }
    if (st >= 3) {
      const streams = st >= 5 ? 3 : 2
      for (let i = 0; i < streams; i++) {
        const sx = x + (i - (streams - 1) / 2) * 7 + (Math.random() * 3 - 1.5), top = cy - 6
        const g = scene.add.graphics().setDepth(o.depth + 0.1).setAlpha(0); made.push(g)
        const drawStream = (p) => { g.clear(); const len = (16 + f * 12) * p; g.fillStyle(0x8a0a0a, 0.5); g.fillRect(sx - 1.6, top, 3.2, len); g.fillStyle(0xc01414, 0.95); g.fillRect(sx - 1, top, 2, len); g.fillStyle(0xff6a55, 0.5); g.fillRect(sx - 1, top, 0.8, len); g.fillStyle(0xc01414, 1); g.fillCircle(sx, top + len, 1.9) }
        scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.6, delay: i * 60, ease: 'Sine.easeIn', onUpdate: (tw) => { const p = tw.getValue(); g.setAlpha(Math.min(1, p * 1.6)); drawStream(p) }, onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.25, onComplete: () => g.destroy() }) })
      }
    }
    return made
  },

  // BLOOD TRAIL — a dark splat dripped under a moving bleeder; lingers + fades. Richer at
  // higher stacks (bigger pool + a glossy spot + more flecks).
  bloodTrailFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x7a0e0e, depth: 5, durationMs: 2600, stacks: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const st = Math.min(6, o.stacks ?? 1), sc = 0.7 + Math.min(0.7, st * 0.1)
    const g = scene.add.graphics().setPosition(x + (Math.random() * 6 - 3), y).setDepth(o.depth).setScale(sc).setAlpha(0); made.push(g)
    const sv = 10, sn = Array.from({ length: sv }, () => 0.55 + Math.random() * 0.8)
    g.fillStyle(0x4a0606, 0.5); g.beginPath(); for (let i = 0; i <= sv; i++) { const a = i / sv * Math.PI * 2, r = 4 * sn[i % sv]; const px = Math.cos(a) * r + 0.8, py = Math.sin(a) * r * 0.6 + 0.8; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.closePath(); g.fillPath()
    g.fillStyle(o.color, 0.9); g.beginPath(); for (let i = 0; i <= sv; i++) { const a = i / sv * Math.PI * 2, r = 3.6 * sn[i % sv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.58; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) } g.closePath(); g.fillPath()
    g.fillStyle(0xa01818, 0.7); g.fillCircle(-1, -0.6, 1.3)
    for (let i = 0; i < 2 + st; i++) { const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 5; g.fillStyle(0x6a0808, 0.8); g.fillCircle(Math.cos(a) * r, Math.sin(a) * r * 0.6, 0.7 + Math.random() * 0.9) }
    scene.tweens.add({ targets: g, alpha: 0.85, duration: life * 0.05,
      onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.6, delay: life * 0.35, onComplete: () => g.destroy() }) })
    return made
  },

  // RUPTURE — a hero's bleed violently bursts: a red core flash, radiating blood streaks, a
  // big gravity blood spray, and heavy gore gobs flung out. Scales hard with stacks.
  ruptureFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xd01818, depth: 14, durationMs: 760, stacks: 4, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 10, mag = Math.min(6, o.stacks ?? 4)
    const fl = scene.add.graphics().setPosition(x, cy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(fl)
    fl.fillStyle(0xff2a18, 0.6); fl.fillCircle(0, 0, 8 + mag * 1.6)
    scene.tweens.add({ targets: fl, alpha: 0.7, scale: 1.5, duration: life * 0.16, yoyo: true, onComplete: () => fl.destroy() })
    // BLOOD DRENCH — the hero is soaked: a big layered blood coating splatters over the
    // body, then lingers + slides down + drips. The main read = blood ON the adventurer.
    const dr = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.2).setScale(0.4).setAlpha(0).setAngle(Math.random() * 30 - 15); made.push(dr)
    const dv = 16, dn = Array.from({ length: dv }, () => 0.55 + Math.random() * 0.8)
    const layer = (rf, col, al) => { dr.fillStyle(col, al); dr.beginPath(); for (let i = 0; i <= dv; i++) { const a = i / dv * Math.PI * 2, r = (4.5 + mag * 1.1) * rf * dn[i % dv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.2; if (i === 0) dr.moveTo(px, py); else dr.lineTo(px, py) } dr.closePath(); dr.fillPath() }
    layer(1, 0x4a0606, 0.9); layer(0.78, 0xc01414, 0.95); layer(0.42, 0xff5a48, 0.4)
    // drip rivulets running off the drench (count + length by stacks)
    for (let i = 0; i < 1 + Math.round(mag / 2); i++) { const dx = (Math.random() * 2 - 1) * (3 + mag * 0.8), top = (2 + mag * 0.5) * 0.5; dr.fillStyle(0x6a0808, 0.85); dr.fillRect(dx - 1, top, 2, 3 + Math.random() * (4 + mag)); dr.fillStyle(0xb01414, 0.9); dr.fillRect(dx - 0.5, top, 1, 3 + Math.random() * (3 + mag)) }
    scene.tweens.add({ targets: dr, scale: 1.1, alpha: 0.96, duration: life * 0.14, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: dr, alpha: 0, y: cy + 6, duration: life * 0.55, delay: life * 0.28, onComplete: () => dr.destroy() }) })
    // a lighter outward splatter (so it still bursts, but the body coating dominates)
    if (mult > 0) {
      const d = scene.add.particles(x, cy, _softDotTexture(scene), { lifespan: { min: life * 0.35, max: life * 0.8 }, speed: { min: 40, max: 70 + mag * 16 }, angle: { min: 0, max: 360 }, gravityY: 60, scale: { start: 0.24, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xe01a1a, 0x9a0c0c, 0x4a0606], emitting: false })
      d.setDepth(o.depth + 0.4); d.explode(Math.round((5 + mag * 2) * mult)); made.push(d); scene.time.delayedCall(life * 1.1, () => { try { d.destroy() } catch (e) {} })
    }
    for (let i = 0; i < 2 + Math.round(mag / 2); i++) { const a = Math.random() * Math.PI * 2, dist = 14 + Math.random() * 14 + mag; const g = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.3).setScale(0.7 + Math.random() * 0.5); made.push(g); _drawGoreGob(g, 2.8); scene.tweens.add({ targets: g, x: x + Math.cos(a) * dist, y: cy + Math.sin(a) * dist + Math.random() * 6, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.25, onComplete: () => g.destroy() }) }) }
    return made
  },

  // BLOOD FRENZY (ULT) — the alpha's HOWL erupts as a feral red core + a radial gore-burst,
  // a red blood-moon pulse washes the room, and every bleeding hero gets DRENCHED as their
  // bleed ruptures (ruptureFx). No geyser spikes — the gore stays on the heroes.
  bloodFrenzyFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xe0201a, depth: 14, durationMs: 1500, victims: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 10
    try { scene.cameras?.main?.flash?.(260, 90, 6, 6, false) } catch (e) {}
    const core = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.6).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(core)
    core.fillStyle(0xff3a20, 0.6); core.fillCircle(0, 0, 16)
    scene.tweens.add({ targets: core, alpha: 0.72, scale: 1.8, duration: life * 0.16, yoyo: true, onComplete: () => core.destroy() })
    // a feral gore-burst sprays OUT from the alpha (radial, gravity-light) + gore gobs
    if (mult > 0) {
      const d = scene.add.particles(x, cy, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.85 }, speed: { min: 90, max: 240 }, angle: { min: 0, max: 360 }, gravityY: 40, scale: { start: 0.32, end: 0 }, alpha: { start: 0.95, end: 0 }, tint: [0xe01a1a, 0xaa0e0e, 0x4a0606], emitting: false })
      d.setDepth(o.depth + 0.5); d.explode(Math.round(22 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
    }
    for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, dist = 22 + Math.random() * 26; const g = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.4).setScale(0.7 + Math.random() * 0.6); made.push(g); _drawGoreGob(g, 3); scene.tweens.add({ targets: g, x: x + Math.cos(a) * dist, y: cy + Math.sin(a) * dist + Math.random() * 8, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.25, onComplete: () => g.destroy() }) }) }
    for (const v of (o.victims || [])) {
      if (!_validXY(v.x, v.y)) continue
      scene.time.delayedCall(life * 0.12 + Math.random() * life * 0.18, () => {
        const r = this.ruptureFx(scene, v.x, v.y, { stacks: Math.max(4, Math.round((v.burst ?? 28) / 6)), slow }); if (r) made.push(...r)
      })
    }
    return made
  },

  // ── Ent · THORNS / OLD GROWTH toolkit ─────────────────────────────────────
  // THORN GUARD — fired ON the ent the instant it reflects a melee hit: its bark FLEXES
  // (a quick hardening shell-ring pulses around the body) and a crown of woody thorns
  // BRISTLES outward from it, then retracts — so the reflect reads as coming from the
  // ent's own thorny defence (the barbs then fly to the attacker via thornLashFx).
  thornGuardFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6f8a3a, depth: 13, durationMs: 430, amped: false, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = [], cy = y - 8, bark = 0x6b4a2a
    // 1. bark FLEX — a hardening bark shell-ring pulses around the body (solid, lobed)
    const shell = scene.add.graphics().setPosition(x, cy).setDepth(o.depth).setScale(0.72).setAlpha(0); made.push(shell)
    const sv = 12, sn = Array.from({ length: sv }, () => 0.8 + Math.random() * 0.35)
    const ring = (rf, col, al, w) => { shell.lineStyle(w, col, al); shell.beginPath(); for (let i = 0; i <= sv; i++) { const a = i / sv * Math.PI * 2, r = 11 * rf * sn[i % sv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.12; if (i === 0) shell.moveTo(px, py); else shell.lineTo(px, py) } shell.closePath(); shell.strokePath() }
    ring(1, _lerpColor(bark, 0x000000, 0.2), 0.7, 2.8); ring(0.96, _lerpColor(bark, 0xffe9b0, 0.3), 0.5, 1.2)
    scene.tweens.add({ targets: shell, scale: 1.18, alpha: 0.95, duration: life * 0.18, ease: 'Back.easeOut', yoyo: true, hold: life * 0.12, onComplete: () => shell.destroy() })
    // 2. a CROWN of thorns bristles OUTWARD from the body (juts out → retracts). Sharper +
    //    more thorns while the Thornburst amp is up.
    const nT = o.amped ? 9 : 6, baseR = 9
    for (let i = 0; i < nT; i++) {
      const a = (i / nT) * Math.PI * 2 + (Math.random() * 0.3 - 0.15), deg = a * 180 / Math.PI
      const tx = x + Math.cos(a) * baseR, ty = cy + Math.sin(a) * baseR * 0.9
      const g = scene.add.graphics().setPosition(tx, ty).setDepth(o.depth + 0.4).setAngle(deg).setScale(0.2, 1).setAlpha(0); made.push(g)
      _drawThorn(g, 9 + (o.amped ? 4 : 0), o.color)
      scene.tweens.add({ targets: g, scaleX: 1, alpha: 1, duration: life * 0.16, delay: i * 10, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, scaleX: 0.15, alpha: 0, duration: life * 0.3, delay: life * 0.12, ease: 'Quad.easeIn', onComplete: () => g.destroy() }) })
    }
    return made
  },

  // THORN LASH — a hero who struck the ent gets pricked: a few wooden barbs stab INTO
  // them (pointing inward toward the wound) + a wood-chip & blood-fleck puff.
  thornLashFx(scene, fromX, fromY, toX, toY, opts = {}) {
    if (!_validXY(toX, toY)) return null
    const o = { color: 0x6f8a3a, depth: 14, durationMs: 440, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const ang = (_validXY(fromX, fromY) ? Math.atan2((toY - 8) - (fromY - 6), toX - fromX) : -Math.PI / 2) * 180 / Math.PI
    const cx = toX, cy = toY - 8
    for (let i = 0; i < 3; i++) {
      const a = ang + (i - 1) * 26, ar = a * Math.PI / 180, reach = 13
      // start out from the body, jab IN toward the centre (point inward → +180)
      const sx = cx + Math.cos(ar) * reach, sy = cy + Math.sin(ar) * reach
      const g = scene.add.graphics().setPosition(sx, sy).setDepth(o.depth + 0.4).setAngle(a + 180).setScale(0.25, 1).setAlpha(0); made.push(g)
      _drawThorn(g, 12, o.color)
      scene.tweens.add({ targets: g, scaleX: 1.2, x: cx + Math.cos(ar) * 3, y: cy + Math.sin(ar) * 3, alpha: 1, duration: life * 0.2, delay: i * 30, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.4, onComplete: () => g.destroy() }) })
    }
    if (mult > 0) {
      const d = scene.add.particles(cx, cy, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speed: { min: 30, max: 90 }, angle: { min: 0, max: 360 }, gravityY: 120, scale: { start: 0.2, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [0x6a8a3a, 0x3a5a1a, 0xa01818], emitting: false })
      d.setDepth(o.depth + 0.5); d.explode(Math.round(6 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
    }
    return made
  },

  // REGROW — a soft green-gold healing glow + leaves and a new shoot spiral up the trunk.
  // Fired on the regrow tick; gentle.
  regrowFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6fbf3a, depth: 12, durationMs: 950, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y - 8
    const glow = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.3).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(glow)
    const gv = 12, gn = Array.from({ length: gv }, () => 0.74 + Math.random() * 0.5); glow.fillStyle(0x9be05a, 0.4); glow.beginPath()
    for (let i = 0; i <= gv; i++) { const a = i / gv * Math.PI * 2, r = 13 * gn[i % gv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.15; if (i === 0) glow.moveTo(px, py); else glow.lineTo(px, py) }
    glow.closePath(); glow.fillPath()
    scene.tweens.add({ targets: glow, alpha: 0.4, scaleX: 1.15, scaleY: 1.2, duration: life * 0.4, yoyo: true, onComplete: () => glow.destroy() })
    for (let i = 0; i < 4; i++) {
      const lx = x + (Math.random() * 22 - 11), ly = cy + 6 + Math.random() * 6
      const g = scene.add.graphics().setPosition(lx, ly).setDepth(o.depth + 0.2).setScale(0.5).setAlpha(0).setAngle(Math.random() * 360); made.push(g)
      _drawLeaf(g, 3 + Math.random() * 1.5, i % 2 ? 0x7fcf45 : 0xbfe06a)
      scene.tweens.add({ targets: g, y: ly - 22 - Math.random() * 12, x: lx + (Math.random() * 14 - 7), angle: '+=' + (Math.random() * 180 - 90), alpha: 1, duration: life * 0.7, delay: i * 80, ease: 'Sine.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.2, onComplete: () => g.destroy() }) })
    }
    return made
  },

  // THORNBURST (ULT) — the oak surges with regrowth (a big green bloom) and a thorn-THICKET
  // erupts: woody barbs jut up from the ground in an irregular spread, and each hero is
  // raked by jabbing thorns. Organic thicket (not a clean ring) + a healing bloom.
  thornburstFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6f8a3a, depth: 14, durationMs: 1400, victims: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 8
    // 1. regrowth bloom on the oak — a big green-gold glow surge + a burst of leaves
    const bloom = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(bloom)
    const bv = 14, bn = Array.from({ length: bv }, () => 0.7 + Math.random() * 0.5); bloom.fillStyle(0x9be05a, 0.45); bloom.beginPath()
    for (let i = 0; i <= bv; i++) { const a = i / bv * Math.PI * 2, r = 22 * bn[i % bv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.1; if (i === 0) bloom.moveTo(px, py); else bloom.lineTo(px, py) }
    bloom.closePath(); bloom.fillPath()
    scene.tweens.add({ targets: bloom, alpha: 0.5, scale: 1.4, duration: life * 0.22, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: bloom, alpha: 0, scale: 1.7, duration: life * 0.4, onComplete: () => bloom.destroy() }) })
    for (let i = 0; i < 8; i++) { const lx = x + (Math.random() * 30 - 15), ly = cy + (Math.random() * 14 - 7); const g = scene.add.graphics().setPosition(lx, ly).setDepth(o.depth + 0.2).setScale(0.4).setAlpha(0).setAngle(Math.random() * 360); made.push(g); _drawLeaf(g, 3.5 + Math.random() * 2, i % 2 ? 0x7fcf45 : 0xbfe06a); scene.tweens.add({ targets: g, y: ly - 18 - Math.random() * 20, x: lx + (Math.random() * 26 - 13), angle: '+=' + (Math.random() * 240 - 120), alpha: 1, scale: 0.9, duration: life * 0.55, delay: i * 30, ease: 'Sine.easeOut', onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.25, onComplete: () => g.destroy() }) }) }
    // 2. thorn THICKET — barbs jut up from the ground around the oak (irregular spread)
    const nT = 10
    for (let i = 0; i < nT; i++) {
      const ang = (i / nT) * Math.PI * 2 + (Math.random() * 0.5 - 0.25), rr = 16 + Math.random() * 26
      const tx = x + Math.cos(ang) * rr, ty = cy + 8 + Math.sin(ang) * rr * 0.5
      if (!_validXY(tx, ty)) continue
      const g = scene.add.graphics().setPosition(tx, ty + 10).setDepth(o.depth + (ty - cy) * 0.02 + 0.1).setAngle(-90 + (Math.random() * 24 - 12)).setScale(1, 0.1).setAlpha(0); made.push(g)
      _drawThorn(g, 12 + Math.random() * 6, o.color)
      scene.time.delayedCall(i * 28 + Math.random() * 30, () => {
        scene.tweens.add({ targets: g, y: ty, scaleY: 1, alpha: 1, duration: life * 0.16, ease: 'Back.easeOut',
          onComplete: () => scene.tweens.add({ targets: g, alpha: 0, y: ty + 3, duration: life * 0.4, delay: life * 0.3, onComplete: () => g.destroy() }) })
      })
    }
    // 3. per-victim thorn rake
    for (const v of (o.victims || [])) { if (!_validXY(v.x, v.y)) continue; scene.time.delayedCall(life * 0.1 + Math.random() * life * 0.15, () => { const m = this.thornLashFx(scene, x, cy, v.x, v.y, { slow }); if (m) made.push(...m) }) }
    if (mult > 0) { const d = scene.add.particles(x, cy + 8, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.5 }, speedX: { min: -40, max: 40 }, speedY: { min: -20, max: 2 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0x5a4a2a, 0x3a5a1a], emitting: false }); d.setDepth(o.depth - 0.5); d.explode(Math.round(8 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} }) }
    return made
  },

  // ── LICH · SOUL HARVEST ─────────────────────────────────────────────────
  // A cached BLOOD-CLOT texture (baked once) so the Vampire can wear a cheap blood-
  // shield carapace — a ring of congealed clots. Used by MinionRenderer's shield tell.
  bloodClotTexture(scene) {
    const key = '__qf_bloodclot'
    if (scene.textures.exists(key)) return key
    const W = 18, H = 18
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H / 2)
    _drawBloodClot(g, 5, 0x8a0d1e)
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // A cached BLOOD-RUNE texture (baked once) so the Orc can wear cheap rage pips —
  // one per Bloodlust stack. A jagged red blood-spike. Used by MinionRenderer.
  rageRuneTexture(scene) {
    const key = '__qf_ragerune'
    if (scene.textures.exists(key)) return key
    const W = 20, H = 24, s = 7
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H / 2)
    const spike = (col, al, k, dx, dy) => { g.fillStyle(col, al); g.beginPath(); g.moveTo(dx, -s * 1.05 * k + dy); g.lineTo(s * 0.55 * k + dx, dy); g.lineTo(dx, s * 1.05 * k + dy); g.lineTo(-s * 0.55 * k + dx, dy); g.closePath(); g.fillPath() }
    spike(0x2a0306, 0.5, 1.05, 0.6, 1)        // shadow
    spike(0xc41525, 1, 1, 0, 0)               // blood body
    spike(0x5a0710, 0.9, 0.62, 0, s * 0.28)   // dark lower facet
    g.fillStyle(0xffd0c0, 0.8); g.fillCircle(-s * 0.16, -s * 0.34, s * 0.22)   // hot shine
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // A cached FLY texture (baked once) so zombies can wear a cheap buzzing fly-swarm
  // and the rot effects can kick flies loose. A tiny dark carrion fly + wing smudges.
  flyTexture(scene) {
    const key = '__qf_fly'
    if (scene.textures.exists(key)) return key
    const W = 16, H = 12
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H / 2)
    // pale translucent wings — give the silhouette width so it reads as a fly, not a dot
    g.fillStyle(0xb8c0a0, 0.5); g.fillEllipse(-2.4, -1.8, 6.5, 3.4); g.fillEllipse(2.4, -1.8, 6.5, 3.4)
    g.fillStyle(0x16180f, 1); g.fillEllipse(0, 0.6, 5.2, 3.8)                  // dark carapace body
    g.fillStyle(0x3e7a4a, 0.9); g.fillEllipse(-0.4, -0.2, 3.4, 2.2)            // iridescent green sheen…
    g.fillStyle(0x6fae5a, 0.85); g.fillEllipse(-0.6, -0.6, 1.8, 1.2)          // …so it pops against dark floors
    g.fillStyle(0xeaffd8, 0.95); g.fillCircle(-1, -1, 0.9)                     // hot glint — catches the eye when tiny
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // An ANIMATED carrion fly (the `fly-sheet` wing-flap loop) — used by the zombie
  // tell + rot VFX. Each starts on a random frame so a swarm never beats in sync.
  // Falls back to the baked static `flyTexture` if the sheet hasn't loaded.
  _flySprite(scene, x, y, scale = 0.26, depth = 13) {
    if (scene.textures.exists('fly-sheet')) {
      const f = scene.add.sprite(x, y, 'fly-sheet').setDepth(depth).setScale(scale)
      if (scene.anims.exists('fly-buzz')) f.play({ key: 'fly-buzz', startFrame: Math.floor(Math.random() * 8) })
      return f
    }
    return scene.add.image(x, y, this.flyTexture(scene)).setDepth(depth).setScale(scale * 1.9)
  },

  // A cached DOOMED-skull texture (baked once) — the pip that bobs over a rot-infected
  // hero so the player reads "this one rises as yours if it dies." Ashen bone cranium +
  // jaw with necrotic-green glowing eye sockets. Used by AdventurerRenderer's rot tell.
  doomSkullTexture(scene) {
    const key = '__qf_doomskull'
    if (scene.textures.exists(key)) return key
    const W = 18, H = 18
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H / 2)
    g.fillStyle(0x0c0e08, 0.55); g.fillEllipse(0.6, 1.2, 12, 12)                        // drop shadow
    g.fillStyle(0xc8d0b0, 1); g.fillEllipse(0, -1, 11, 10)                              // cranium (ashen bone)
    g.fillStyle(0xc8d0b0, 1); g.fillRect(-3.4, 2, 6.8, 5)                               // jaw
    g.fillStyle(0x1a2410, 1); g.fillEllipse(-3, -1.2, 3.6, 4.2); g.fillEllipse(3, -1.2, 3.6, 4.2)  // sockets
    g.fillStyle(0x6fae3a, 0.95); g.fillCircle(-3, -1, 1.2); g.fillCircle(3, -1, 1.2)    // glowing eyes
    g.fillStyle(0x1a2410, 1); g.beginPath(); g.moveTo(0, 0.4); g.lineTo(1.3, 2.8); g.lineTo(-1.3, 2.8); g.closePath(); g.fillPath()  // nose
    g.lineStyle(0.8, 0x1a2410, 1); g.beginPath(); g.moveTo(-1.6, 2.4); g.lineTo(-1.6, 6.6); g.moveTo(0, 2.4); g.lineTo(0, 6.6); g.moveTo(1.6, 2.4); g.lineTo(1.6, 6.6); g.strokePath()  // teeth gaps
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // A cached soul-wisp texture (baked once) so the Lich can wear cheap orbiting
  // soul Images — one per banked soul. Used by MinionRenderer's power tell.
  soulWispTexture(scene) {
    const key = '__qf_soulwisp'
    if (scene.textures.exists(key)) return key
    const W = 28, H = 40
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H * 0.55)
    _drawSoulWisp(g, 9, 0x6affb0)
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // A cached DREAD-SPIRIT texture (baked once) — the flowing faceless soul-wisp (head +
  // 3 frayed tails + glow halo) used by Pall of Dread's host of spirits. Baked head-up so
  // each spirit Image rotates to bank into its flight; origin sits on the head.
  spiritWispTexture(scene) {
    const key = '__qf_dreadspirit'
    if (scene.textures.exists(key)) return key
    const W = 48, H = 64
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, 20)   // head near the top → tails trail down into the canvas
    _drawDreadSpirit(g, 9, 0x9fc0f0)
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // SOUL HARVEST — the corpse exhales its spirit; a green soul-wisp tears free,
  // trails a wake of motes as it homes into the Lich (toX,toY), and the Lich
  // flares as it drinks the soul in. A death → travel → payoff transfer.
  soulHarvestFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x4cff9e, depth: 44, durationMs: 660, toX: x, toY: y - 30, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // 0) the corpse exhales its spirit — a pale gasp rising off the body
    const gasp = scene.add.graphics().setPosition(x, y - 2).setDepth(o.depth - 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.3).setAlpha(0); made.push(gasp)
    gasp.fillStyle(0xdffff0, 0.5); gasp.fillEllipse(0, 0, 16, 9)
    scene.tweens.add({ targets: gasp, y: y - 14, scaleX: 1.3, scaleY: 1.1, alpha: 0.5, duration: life * 0.22, ease: 'Sine.easeOut', onComplete: () => scene.tweens.add({ targets: gasp, alpha: 0, scaleX: 1.8, duration: life * 0.2, onComplete: () => gasp.destroy() }) })
    // 1) the soul-wisp tears free of the body
    const wisp = scene.add.graphics().setPosition(x, y - 4).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0).setAlpha(0); made.push(wisp)
    _drawSoulWisp(wisp, 9, o.color); _glow(wisp, o.color, 4, 8)
    const riseX = x + (Math.random() * 16 - 8), riseY = y - 18 - Math.random() * 8
    scene.tweens.add({ targets: wisp, scale: 1, alpha: 0.95, duration: life * 0.22, ease: 'Quad.easeOut' })
    // a faint mote trail follows the wisp the whole way
    let trail = null
    if (mult > 0) { trail = scene.add.particles(0, 0, _softDotTexture(scene), { lifespan: { min: life * 0.16, max: life * 0.3 }, speed: { min: 4, max: 14 }, scale: { start: 0.15, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0x4cff9e, 0x7CFFB2], frequency: 22, quantity: 1 }); trail.setDepth(o.depth - 0.1).startFollow(wisp); made.push(trail) }
    // 2) lift off, then 3) home into the Lich, shrinking as it's drunk in
    scene.tweens.add({ targets: wisp, x: riseX, y: riseY, duration: life * 0.32, ease: 'Sine.easeOut',
      onComplete: () => scene.tweens.add({ targets: wisp, x: o.toX, y: o.toY, scale: 0.25, alpha: 0, duration: life * 0.5, ease: 'Sine.easeIn',
        onComplete: () => {
          wisp.destroy()
          if (trail) { try { trail.stop() } catch (e) {} scene.time.delayedCall(life * 0.3, () => { try { trail.destroy() } catch (e) {} }) }
          // 4) intake flare on the Lich — it drinks the soul in
          if (_validXY(o.toX, o.toY)) {
            const fl = scene.add.graphics().setPosition(o.toX, o.toY).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(fl)
            fl.fillStyle(0xbfffd8, 0.6); fl.fillCircle(0, 0, 8); fl.fillStyle(0x4cff9e, 0.5); fl.fillCircle(0, 0, 13)
            scene.tweens.add({ targets: fl, alpha: 0.85, scale: 1.5, duration: life * 0.14, yoyo: true, ease: 'Quad.easeOut', onComplete: () => fl.destroy() })
          }
        } }) })
    return made
  },

  // SOUL CONDUIT (T2+) — wavy green soul-threads tether the Lich (x,y) to each
  // nearby undead ally, with beads of soul-light FLOWING down the thread (Lich →
  // ally, so the transfer direction reads) and a green flame-lick of empower
  // licking up the ally. Directional tethers, deliberately NOT a ring.
  soulConduitFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x4cff9e, depth: 43, durationMs: 580, targets: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const sx = x, sy = y - 12
    for (const t of (o.targets || [])) {
      if (!_validXY(t.x, t.y)) continue
      const tx = t.x, ty = t.y - 10
      const nx = (ty - sy), ny = -(tx - sx); const nl = Math.hypot(nx, ny) || 1
      const pt = (k, wob) => ({ x: sx + (tx - sx) * k + (nx / nl) * Math.sin(k * Math.PI) * wob, y: sy + (ty - sy) * k + (ny / nl) * Math.sin(k * Math.PI) * wob })
      const ln = scene.add.graphics().setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(ln)
      const drawThread = (c, al, wob) => { ln.lineStyle(2, c, al); ln.beginPath(); ln.moveTo(sx, sy); for (let i = 1; i <= 6; i++) { const p = pt(i / 6, wob); ln.lineTo(p.x, p.y) } ln.strokePath() }
      drawThread(_lerpColor(o.color, 0xffffff, 0.4), 0.85, 5); drawThread(o.color, 0.5, -3)
      scene.tweens.add({ targets: ln, alpha: 1, duration: life * 0.3, yoyo: true, hold: life * 0.25, onComplete: () => ln.destroy() })
      // beads of soul-light flow Lich → ally (transfer direction)
      for (let b = 0; b < 3; b++) {
        const bead = scene.add.graphics().setDepth(o.depth + 0.1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(bead)
        bead.fillStyle(0xeafff4, 0.9); bead.fillCircle(0, 0, 2.4); bead.fillStyle(o.color, 0.55); bead.fillCircle(0, 0, 4.4)
        scene.tweens.addCounter({ from: 0, to: 1, duration: life * 0.5, delay: b * (life * 0.12), ease: 'Sine.easeIn',
          onUpdate: (tw) => { const k = tw.getValue(); const p = pt(k, 4); bead.setPosition(p.x, p.y).setAlpha(0.9 * (1 - k * 0.35)) },
          onComplete: () => bead.destroy() })
      }
      // arrival empower — a green flame-lick climbs the ally (not a circle)
      scene.time.delayedCall(life * 0.5, () => {
        const lick = scene.add.graphics().setPosition(tx, ty + 4).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.6, 0.35).setAlpha(0); made.push(lick)
        const lf = (c, al, w, h) => { lick.fillStyle(c, al); lick.beginPath(); lick.moveTo(-w, h * 0.4); lick.lineTo(-w * 0.3, -h); lick.lineTo(0, -h * 1.3); lick.lineTo(w * 0.3, -h); lick.lineTo(w, h * 0.4); lick.lineTo(0, h * 0.6); lick.closePath(); lick.fillPath() }
        lf(0x1a6a3a, 0.5, 10, 20); lf(0x4cff9e, 0.6, 6, 24); lf(0xbfffd8, 0.6, 3, 20)
        scene.tweens.add({ targets: lick, scaleX: 1, scaleY: 1.1, alpha: 0.8, duration: life * 0.2, ease: 'Quad.easeOut', yoyo: true, onComplete: () => lick.destroy() })
      })
    }
    return made
  },

  // SOUL STORM (ULT) — the banked souls RUSH IN from a wide ring, compress into a
  // blinding core, then ERUPT: a soul-bolt streaks out and slams each hero (a real
  // hit, not a wash) over green flame-tongues raking the floor. The bigger the
  // bank, the more bolts. A short punchy flash — no room-filling green fill.
  soulStormFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x4cff9e, depth: 45, durationMs: 1300, souls: 6, victims: [], rectW: 300, rectH: 200, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 8
    const souls = Math.max(1, o.souls || 1)
    const reach = Math.min(o.rectW, o.rectH) * 0.5
    // ── Phase 1: GATHER — souls rush IN from a wide ring and collapse to the core ──
    const nIn = Math.min(18, 8 + Math.round(souls * 0.7))
    for (let i = 0; i < nIn; i++) {
      const a0 = (i / nIn) * Math.PI * 2 + Math.random() * 0.3, R = 70 + Math.random() * 60
      const ix = x + Math.cos(a0) * R, iy = cy + Math.sin(a0) * R * 0.6
      if (!_validXY(ix, iy)) continue
      const w = scene.add.graphics().setPosition(ix, iy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0).setAlpha(0).setAngle(Math.atan2(cy - iy, x - ix) * 180 / Math.PI + 90); made.push(w)
      _drawSoulWisp(w, 7 + Math.random() * 3, i % 2 ? 0x7CFFB2 : o.color)
      scene.tweens.add({ targets: w, scale: 1, alpha: 0.9, duration: life * 0.12, delay: i * 7 })
      scene.tweens.add({ targets: w, x, y: cy, scale: 0.2, duration: life * 0.34, delay: i * 7, ease: 'Quad.easeIn', onComplete: () => w.destroy() })
    }
    // a blinding nucleus builds as the souls pour in, then bursts
    const core = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.5).setBlendMode(Phaser.BlendModes.ADD).setScale(0.2).setAlpha(0); made.push(core)
    core.fillStyle(0x4cff9e, 0.5); core.fillCircle(0, 0, 16); core.fillStyle(0xbfffd8, 0.7); core.fillCircle(0, 0, 9); core.fillStyle(0xffffff, 0.95); core.fillCircle(0, 0, 4)
    _glow(core, 0x7CFFB2, 6, 14)
    scene.tweens.add({ targets: core, scale: 1.1, alpha: 0.95, duration: life * 0.42, ease: 'Quad.easeIn',
      onComplete: () => scene.tweens.add({ targets: core, scale: 2.6, alpha: 0, duration: life * 0.16, ease: 'Quad.easeOut', onComplete: () => core.destroy() }) })
    // a single bright impact burst at a hit point
    const soulBurst = (bx, by) => {
      const g = scene.add.graphics().setPosition(bx, by).setDepth(o.depth + 0.5).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(g)
      g.fillStyle(0xeafff4, 0.7); g.fillCircle(0, 0, 5); g.fillStyle(0x7CFFB2, 0.5); g.fillCircle(0, 0, 11)
      scene.tweens.add({ targets: g, alpha: 0.85, scale: 1.6, duration: life * 0.12, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scale: 2, duration: life * 0.16, onComplete: () => g.destroy() }) })
      for (let k = 0; k < 3; k++) { const a = Math.random() * Math.PI * 2; const s2 = scene.add.graphics().setPosition(bx, by).setDepth(o.depth + 0.45).setBlendMode(Phaser.BlendModes.ADD).setAngle(Math.random() * 360).setScale(0.5).setAlpha(0.9); made.push(s2); _drawSoulWisp(s2, 4, 0x7CFFB2); scene.tweens.add({ targets: s2, x: bx + Math.cos(a) * 18, y: by + Math.sin(a) * 18, alpha: 0, duration: life * 0.22, ease: 'Quad.easeOut', onComplete: () => s2.destroy() }) }
    }
    // ── Phase 2: ERUPT (at ~0.44 life) — bolts streak out to each hero + flame-tongues ──
    const erupt = () => {
      try { scene.cameras.main.flash(Math.min(150, 110 * Math.sqrt(slow)), 90, 240, 150, false) } catch (e) {}
      try { scene.cameras.main.shake(Math.min(420, 260 * slow), 0.006) } catch (e) {}
      // green flame-tongues rake the floor outward (irregular spread, not a ring)
      const nF = 12
      for (let i = 0; i < nF; i++) {
        const a = (i / nF) * Math.PI * 2 + (Math.random() * 0.4 - 0.2)
        const fl = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.3).setBlendMode(Phaser.BlendModes.ADD).setAngle(a * 180 / Math.PI + 90).setScale(0.5, 0.2).setAlpha(0); made.push(fl)
        const len = reach * (0.55 + Math.random() * 0.4)
        const lf = (c, al, w, h) => { fl.fillStyle(c, al); fl.beginPath(); fl.moveTo(-w, 0); fl.lineTo(-w * 0.3, -h * 0.7); fl.lineTo(0, -h); fl.lineTo(w * 0.3, -h * 0.7); fl.lineTo(w, 0); fl.lineTo(0, h * 0.3); fl.closePath(); fl.fillPath() }
        lf(0x1a6a3a, 0.5, 13, len); lf(0x4cff9e, 0.6, 8, len * 1.05); lf(0xbfffd8, 0.5, 3, len * 0.8)
        scene.tweens.add({ targets: fl, scaleX: 1, scaleY: 1, alpha: 0.8, duration: life * 0.14, delay: i * 5, ease: 'Quad.easeOut',
          onComplete: () => scene.tweens.add({ targets: fl, alpha: 0, scaleY: 0.6, duration: life * 0.22, onComplete: () => fl.destroy() }) })
      }
      // a soul-bolt streaks from the core to each hero and bursts on the hit
      for (const v of (o.victims || [])) {
        if (!_validXY(v.x, v.y)) continue
        const vy = v.y - 8
        const bolt = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.4).setBlendMode(Phaser.BlendModes.ADD).setAngle(Math.atan2(vy - cy, v.x - x) * 180 / Math.PI + 90).setAlpha(0); made.push(bolt)
        _drawSoulWisp(bolt, 9, 0x7CFFB2); _glow(bolt, o.color, 4, 8)
        scene.tweens.add({ targets: bolt, x: v.x, y: vy, alpha: 0.95, duration: life * 0.16, ease: 'Quad.easeIn', onComplete: () => { bolt.destroy(); soulBurst(v.x, vy) } })
      }
      // extra ambient bolts (no target) for density, scaled by the bank
      const extra = Math.min(10, souls)
      for (let i = 0; i < extra; i++) {
        const a = Math.random() * Math.PI * 2, dist = reach * (0.5 + Math.random() * 0.5)
        const ex = x + Math.cos(a) * dist, ey = cy + Math.sin(a) * dist * 0.7
        if (!_validXY(ex, ey)) continue
        const b = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setAngle(a * 180 / Math.PI + 90).setScale(0.8).setAlpha(0); made.push(b)
        _drawSoulWisp(b, 6, i % 2 ? 0x7CFFB2 : o.color)
        scene.tweens.add({ targets: b, x: ex, y: ey, alpha: 0.8, duration: life * 0.18, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: b, alpha: 0, scale: 0.2, duration: life * 0.14, onComplete: () => b.destroy() }) })
      }
      if (mult > 0) { const d = scene.add.particles(x, cy, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.45 }, speed: { min: 80, max: 220 }, angle: { min: 0, max: 360 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [0x4cff9e, 0x7CFFB2, 0xeafff4], emitting: false }); d.setDepth(o.depth + 0.3); d.explode(Math.round(22 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} }) }
    }
    scene.time.delayedCall(life * 0.44, erupt)
    return made
  },

  // PHYLACTERY SHATTER — fired the instant the Elder Lich is "killed": its soul-gem
  // flares and bursts into shards while a soul-wisp escapes upward (it's not over).
  phylacteryShatterFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x4cff9e, depth: 44, durationMs: 720, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y - 12
    const gem = scene.add.graphics().setPosition(x, cy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(1).setAlpha(0); made.push(gem)
    _drawPhylactery(gem, 12, o.color); _glow(gem, o.color, 5, 10)
    scene.tweens.add({ targets: gem, alpha: 1, scale: 1.25, duration: life * 0.18, yoyo: true, hold: life * 0.08, onComplete: () => gem.destroy() })
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2
      const sh = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9).setAngle(Math.random() * 360); made.push(sh)
      _drawPhylactery(sh, 3 + Math.random() * 2, o.color)
      scene.tweens.add({ targets: sh, x: x + Math.cos(a) * (20 + Math.random() * 22), y: cy + Math.sin(a) * (16 + Math.random() * 18), alpha: 0, angle: '+=' + (Math.random() * 200 - 100), duration: life * 0.7, ease: 'Quad.easeOut', onComplete: () => sh.destroy() })
    }
    const w = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(w)
    _drawSoulWisp(w, 10, 0x7CFFB2)
    scene.tweens.add({ targets: w, y: cy - 26, scale: 1, alpha: 0.9, duration: life * 0.5, ease: 'Sine.easeOut', onComplete: () => scene.tweens.add({ targets: w, alpha: 0, duration: life * 0.3, onComplete: () => w.destroy() }) })
    return made
  },

  // PHYLACTERY REVIVE — the soul that ESCAPED on shatter is dragged back down into
  // the body (closing the loop), then a green soul-flame column erupts and the gem
  // reknits at the heart. The "you didn't actually kill it" beat.
  phylacteryReviveFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x4cff9e, depth: 45, durationMs: 1200, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 8
    // 0) the escaped soul returns — a wisp plunges back down from above into the body
    const ret = scene.add.graphics().setPosition(x, cy - 34).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(ret)
    _drawSoulWisp(ret, 10, 0x7CFFB2); _glow(ret, o.color, 4, 8)
    scene.tweens.add({ targets: ret, y: cy - 4, scale: 1, alpha: 0.95, duration: life * 0.3, ease: 'Sine.easeIn',
      onComplete: () => scene.tweens.add({ targets: ret, alpha: 0, scale: 0.3, duration: life * 0.1, onComplete: () => ret.destroy() }) })
    // 1) the flame column erupts once the soul lands (~0.3 life)
    const col = scene.add.graphics().setPosition(x, cy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.3).setAlpha(0); made.push(col)
    const flame = (c, al, w, h) => { col.fillStyle(c, al); col.beginPath(); col.moveTo(-w, h * 0.4); col.lineTo(-w * 0.4, -h); col.lineTo(0, -h * 1.3); col.lineTo(w * 0.4, -h); col.lineTo(w, h * 0.4); col.lineTo(0, h * 0.7); col.closePath(); col.fillPath() }
    flame(0x1a6a3a, 0.5, 22, 40); flame(0x4cff9e, 0.6, 15, 46); flame(0xbfffd8, 0.7, 7, 40)
    scene.tweens.add({ targets: col, scaleX: 1, scaleY: 1.2, alpha: 0.85, delay: life * 0.28, duration: life * 0.34, ease: 'Quad.easeOut', yoyo: true, hold: life * 0.12, onComplete: () => col.destroy() })
    const gem = scene.add.graphics().setPosition(x, cy - 6).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(2).setAlpha(0); made.push(gem)
    _drawPhylactery(gem, 11, o.color); _glow(gem, o.color, 5, 10)
    scene.tweens.add({ targets: gem, scale: 1, alpha: 1, delay: life * 0.3, duration: life * 0.34, ease: 'Back.easeOut', onComplete: () => scene.tweens.add({ targets: gem, alpha: 0, scale: 0.6, duration: life * 0.26, onComplete: () => gem.destroy() }) })
    scene.time.delayedCall(life * 0.3, () => {
      if (mult > 0) { const d = scene.add.particles(x, cy + 10, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedX: { min: -26, max: 26 }, speedY: { min: -90, max: -30 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [0x4cff9e, 0x7CFFB2], emitting: false }); d.setDepth(o.depth - 0.3); d.explode(Math.round(14 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} }) }
      try { scene.cameras.main.flash(Math.min(170, 130 * Math.sqrt(slow)), 70, 230, 150, false) } catch (e) {}
    })
    return made
  },

  // ── LIZARDMAN · CAMOUFLAGE ──────────────────────────────────────────────
  // CAMOUFLAGE (vanish) — the lizardman blinks out: a quick green heat-shimmer
  // ripple + a scatter of scale-flecks settling into the terrain. A "you lost it"
  // beat, deliberately scattered/organic (never a ring).
  camouflageFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x5a9c52, depth: 16, durationMs: 520, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y - 8
    // heat-shimmer ripple — a soft lobed green veil that swells and dissolves
    const veil = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(veil)
    const vv = 12, vn = Array.from({ length: vv }, () => 0.78 + Math.random() * 0.4); veil.fillStyle(_lerpColor(o.color, 0xbfffb0, 0.4), 0.32); veil.beginPath()
    for (let i = 0; i <= vv; i++) { const a = i / vv * Math.PI * 2, r = 18 * vn[i % vv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.1; if (i === 0) veil.moveTo(px, py); else veil.lineTo(px, py) }
    veil.closePath(); veil.fillPath()
    scene.tweens.add({ targets: veil, alpha: 0.4, scale: 1.2, duration: life * 0.3, ease: 'Sine.easeOut', onComplete: () => scene.tweens.add({ targets: veil, alpha: 0, scale: 1.5, duration: life * 0.4, onComplete: () => veil.destroy() }) })
    // scale-flecks scatter outward and settle (fade) — the camo "dissolve"
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5, d = 10 + Math.random() * 20
      const fk = scene.add.graphics().setPosition(x + Math.cos(a) * 4, cy + Math.sin(a) * 3).setDepth(o.depth + 0.2).setScale(0.5).setAlpha(0).setAngle(Math.random() * 360); made.push(fk)
      _drawScaleFleck(fk, 3 + Math.random() * 1.6, i % 3 ? o.color : _lerpColor(o.color, 0x2a5a2a, 0.4))
      scene.tweens.add({ targets: fk, x: x + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.7 + 4, alpha: 0.9, scale: 0.9, duration: life * 0.3, delay: i * 12, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: fk, alpha: 0, scaleX: 0.2, duration: life * 0.4, onComplete: () => fk.destroy() }) })
    }
    return made
  },

  // CAMO SHIMMER — the small "actively blending" flick fired on a cadence WHILE a
  // lizardman is cloaked: a couple of green scale-glints twinkle near the body so the
  // held camo state reads as a shimmering stalker, not a flat translucent ghost.
  camoShimmerFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6fdf7a, depth: 16, durationMs: 440, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    for (let i = 0; i < 2; i++) {
      const gx = x + (Math.random() * 22 - 11), gy = y + (Math.random() * 20 - 10)
      const fk = scene.add.graphics().setPosition(gx, gy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0).setAngle(Math.random() * 360); made.push(fk)
      _drawScaleFleck(fk, 2.4 + Math.random() * 1.2, _lerpColor(o.color, 0xeaffe0, 0.35))
      scene.tweens.add({ targets: fk, alpha: 0.75, scale: 0.9, duration: life * 0.34, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => fk.destroy() })
    }
    return made
  },

  // AMBUSH STRIKE (reveal) — the lizardman SNAPS into view to bite, hard: a bright reveal
  // burst + an outward shock of scale-flecks (the materialise snap), a sharp DOUBLE
  // claw-rake (crossing slashes), and flecks reassembling inward. The "it was invisible,
  // now it's on you" beat.
  ambushStrikeFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6fae5e, depth: 17, durationMs: 460, angle: -30, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 10
    // reveal POP — a punchy bright flash where it materialises (bigger + hotter core)
    const pop = scene.add.graphics().setPosition(x, cy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.25).setAlpha(0); made.push(pop)
    pop.fillStyle(0xffffff, 0.9); pop.fillCircle(0, 0, 6); pop.fillStyle(0xeaffe0, 0.65); pop.fillCircle(0, 0, 12); pop.fillStyle(o.color, 0.4); pop.fillCircle(0, 0, 19)
    scene.tweens.add({ targets: pop, alpha: 0.95, scale: 1.7, duration: life * 0.16, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: pop, alpha: 0, scale: 2.0, duration: life * 0.2, onComplete: () => pop.destroy() }) })
    // an outward SHOCK of scale-flecks bursting as it snaps into being
    if (mult > 0) {
      const d = scene.add.particles(x, cy, _softDotTexture(scene), { lifespan: { min: life * 0.25, max: life * 0.5 }, speed: { min: 80, max: 200 }, angle: { min: 0, max: 360 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xbfffb0, 0x6fae5e, 0x2a5a2a], emitting: false })
      d.setDepth(o.depth + 0.2); d.explode(Math.round(10 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
    }
    // a sharp DOUBLE claw-rake (two crossing slashes) lunging from the body
    for (let s = 0; s < 2; s++) {
      const ang = o.angle + (s ? 34 : 0)
      const slash = scene.add.graphics().setPosition(x + 6, cy).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setAngle(ang).setScale(0.35, 0.85).setAlpha(0); made.push(slash)
      _drawClawSlash(slash, 30, o.color)
      scene.tweens.add({ targets: slash, scaleX: 1.25, alpha: 1, duration: life * 0.14, delay: s * 70, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: slash, alpha: 0, x: x + 18, duration: life * 0.28, onComplete: () => slash.destroy() }) })
    }
    // scale-flecks reassemble inward (the body re-forming)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, dd = 18 + Math.random() * 14
      const fk = scene.add.graphics().setPosition(x + Math.cos(a) * dd, cy + Math.sin(a) * dd * 0.7).setDepth(o.depth + 0.1).setScale(0.85).setAlpha(0.9).setAngle(Math.random() * 360); made.push(fk)
      _drawScaleFleck(fk, 3, o.color)
      scene.tweens.add({ targets: fk, x, y: cy, alpha: 0, scale: 0.2, duration: life * 0.22, delay: i * 5, ease: 'Quad.easeIn', onComplete: () => fk.destroy() })
    }
    return made
  },

  // VANISHING WARBAND (ULT) — the captain hisses and the whole pack blinks out: a
  // quick green camo-shimmer sweeps the room (low, textured — not a wash) + a vanish
  // puff at the captain and several scattered around where the reptiles slip away.
  vanishingWarbandFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x5a9c52, depth: 18, durationMs: 900, rectW: 300, rectH: 200, count: 5, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y - 8
    // a low, lobed shimmer sweep across the room (brief + faint so it never washes)
    const sweep = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.4).setBlendMode(Phaser.BlendModes.ADD).setScale(0.2).setAlpha(0); made.push(sweep)
    const sv = 18, sn = Array.from({ length: sv }, () => 0.7 + Math.random() * 0.5); sweep.fillStyle(_lerpColor(o.color, 0xbfffb0, 0.45), 0.22); sweep.beginPath()
    for (let i = 0; i <= sv; i++) { const a = i / sv * Math.PI * 2, r = Math.min(o.rectW, o.rectH) * 0.5 * sn[i % sv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.6; if (i === 0) sweep.moveTo(px, py); else sweep.lineTo(px, py) }
    sweep.closePath(); sweep.fillPath()
    scene.tweens.add({ targets: sweep, alpha: 0.28, scale: 1.1, duration: life * 0.28, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: sweep, alpha: 0, scale: 1.3, duration: life * 0.3, onComplete: () => sweep.destroy() }) })
    // the captain's own vanish + scattered pack vanishes around the room
    const m0 = this.camouflageFx(scene, x, y, { slow }); if (m0) made.push(...m0)
    const n = Math.min(8, o.count)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, d = 40 + Math.random() * Math.min(o.rectW, o.rectH) * 0.4
      const px = x + Math.cos(a) * d, py = cy + Math.sin(a) * d * 0.6
      if (!_validXY(px, py)) continue
      scene.time.delayedCall(i * 40 + Math.random() * 60, () => { const mm = this.camouflageFx(scene, px, py + 8, { slow }); if (mm) made.push(...mm) })
    }
    return made
  },

  // ── IMP · BLINK ─────────────────────────────────────────────────────────
  // BLINK — a SNAPPY fire-teleport. OUT: embers rush INWARD + the imp's fire compresses
  // to a vertical sliver (sucked through a slit) + an ash puff. A quick streak to the IN
  // point, where it SLAMS back: a hot flash + a crown of flame-tongues licking outward +
  // an ash poof + ember scatter. Crisp implode → burst, not a flat circle pop.
  blinkFx(scene, fromX, fromY, toX, toY, opts = {}) {
    if (!_validXY(toX, toY)) return null
    const o = { color: 0xff6633, depth: 17, durationMs: 440, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const ty = toY - 8
    // OUT — the imp IMPLODES through a slit
    if (_validXY(fromX, fromY)) {
      const fy = fromY - 8
      for (let i = 0; i < 8; i++) {                                     // embers rush inward
        const a = (i / 8) * Math.PI * 2, r0 = 20
        const e = scene.add.graphics().setPosition(fromX + Math.cos(a) * r0, fy + Math.sin(a) * r0 * 0.82).setDepth(o.depth + 0.1).setBlendMode(Phaser.BlendModes.ADD).setScale(0.7).setAlpha(0.95).setAngle(Math.random() * 360); made.push(e)
        _drawEmber(e, 3, i % 2 ? 0xffd23f : o.color)
        scene.tweens.add({ targets: e, x: fromX, y: fy, alpha: 0, scale: 0.15, duration: life * 0.26, ease: 'Quad.easeIn', onComplete: () => e.destroy() })
      }
      const sliver = scene.add.graphics().setPosition(fromX, fy).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(1, 0.6).setAlpha(0); made.push(sliver)
      sliver.fillStyle(0xffe8b0, 0.85); sliver.fillEllipse(0, 0, 12, 16); sliver.fillStyle(o.color, 0.5); sliver.fillEllipse(0, 0, 18, 22)
      scene.tweens.add({ targets: sliver, scaleX: 0.07, scaleY: 1.75, alpha: 0.95, duration: life * 0.24, ease: 'Quad.easeIn', onComplete: () => sliver.destroy() })   // compress to a vertical slit
      const ash = scene.add.graphics().setPosition(fromX, fy).setDepth(o.depth - 0.3).setScale(0.5).setAlpha(0); made.push(ash)
      ash.fillStyle(0x2a2422, 0.5); ash.fillCircle(0, 0, 8)
      scene.tweens.add({ targets: ash, y: fy - 9, scale: 1.5, alpha: 0.4, duration: life * 0.3, onComplete: () => scene.tweens.add({ targets: ash, alpha: 0, duration: life * 0.3, onComplete: () => ash.destroy() }) })
      const streak = scene.add.graphics().setDepth(o.depth - 0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(streak)
      streak.lineStyle(2.5, 0xffd23f, 0.85); streak.beginPath(); streak.moveTo(fromX, fy); streak.lineTo(toX, ty); streak.strokePath()
      scene.tweens.add({ targets: streak, alpha: 0.8, duration: life * 0.1, yoyo: true, onComplete: () => streak.destroy() })
    }
    // IN — it SLAMS back into being: hot flash + a crown of flame-tongues + ash poof
    const flash = scene.add.graphics().setPosition(toX, ty).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.15).setAlpha(0); made.push(flash)
    flash.fillStyle(0xffffff, 0.9); flash.fillCircle(0, 0, 5); flash.fillStyle(0xffe8b0, 0.55); flash.fillCircle(0, 0, 11); _glow(flash, o.color, 4, 8)
    scene.time.delayedCall(life * 0.1, () => scene.tweens.add({ targets: flash, alpha: 0.95, scale: 1.6, duration: life * 0.14, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: flash, alpha: 0, scale: 1.9, duration: life * 0.18, onComplete: () => flash.destroy() }) }))
    const NT = 6
    for (let i = 0; i < NT; i++) {
      const a = (i / NT) * Math.PI * 2 + 0.25
      const fl = scene.add.image(toX, ty, this.flameTongueTexture(scene)).setOrigin(0.5, 1).setDepth(o.depth + 0.25).setBlendMode(Phaser.BlendModes.ADD).setRotation(a + Math.PI / 2).setScale(0.1).setAlpha(0); made.push(fl)
      scene.time.delayedCall(life * 0.1, () => scene.tweens.add({ targets: fl, scaleX: 0.42, scaleY: 0.6, alpha: 0.9, duration: life * 0.14, ease: 'Back.easeOut', onComplete: () => scene.tweens.add({ targets: fl, scaleY: 0.12, alpha: 0, duration: life * 0.2, onComplete: () => fl.destroy() }) }))
    }
    const ash2 = scene.add.graphics().setPosition(toX, ty).setDepth(o.depth - 0.2).setScale(0.4).setAlpha(0); made.push(ash2)
    ash2.fillStyle(0x2a2422, 0.45); ash2.fillCircle(0, 0, 9)
    scene.time.delayedCall(life * 0.12, () => scene.tweens.add({ targets: ash2, y: ty - 10, scale: 1.5, alpha: 0.36, duration: life * 0.34, onComplete: () => scene.tweens.add({ targets: ash2, alpha: 0, duration: life * 0.3, onComplete: () => ash2.destroy() }) }))
    if (mult > 0) {
      const d = scene.add.particles(toX, ty, _softDotTexture(scene), { lifespan: { min: life * 0.25, max: life * 0.5 }, speed: { min: 50, max: 130 }, angle: { min: 0, max: 360 }, gravityY: 40, scale: { start: 0.2, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xffd23f, 0xff6633, 0x8a2a0e], blendMode: 'ADD', emitting: false })
      d.setDepth(o.depth + 0.2); scene.time.delayedCall(life * 0.1, () => d.explode(Math.round(8 * mult))); made.push(d); scene.time.delayedCall(life * 1.1, () => { try { d.destroy() } catch (e) {} })
    }
    return made
  },

  // HELLRIFT (ULT) — a vertical hellfire rift tears open + a faint room fire-pulse +
  // scattered blink-sparks (the pack frenzy) + per-victim fire bursts.
  hellriftFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff6633, depth: 18, durationMs: 1100, rectW: 300, rectH: 200, victims: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 10
    // vertical rift — a tall jagged fire tear
    const rift = scene.add.graphics().setPosition(x, cy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3, 0.2).setAlpha(0); made.push(rift)
    const tear = (c, al, w, h) => {
      rift.fillStyle(c, al); rift.beginPath(); const segs = 7
      rift.moveTo(0, -h)
      for (let i = 1; i <= segs; i++) { const yy = -h + (2 * h) * (i / segs); rift.lineTo((Math.random() * 2 - 1) * w * (1 - Math.abs(i / segs - 0.5) * 1.2), yy) }
      for (let i = segs; i >= 0; i--) { const yy = -h + (2 * h) * (i / segs); rift.lineTo((Math.random() * 2 - 1) * w * 0.4 * (1 - Math.abs(i / segs - 0.5) * 1.2), yy) }
      rift.closePath(); rift.fillPath()
    }
    tear(0x661111, 0.6, 18, 46); tear(o.color, 0.7, 11, 50); tear(0xffd23f, 0.7, 4, 40)
    scene.tweens.add({ targets: rift, scaleX: 1, scaleY: 1.1, alpha: 0.9, duration: life * 0.2, ease: 'Quad.easeOut', yoyo: true, hold: life * 0.2, onComplete: () => rift.destroy() })
    // faint low fire-pulse across the room (deliberately low alpha — not a wash)
    const pulse = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.4).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(pulse)
    const pv = 16, pn = Array.from({ length: pv }, () => 0.7 + Math.random() * 0.5); pulse.fillStyle(_lerpColor(o.color, 0xffd23f, 0.4), 0.22); pulse.beginPath()
    for (let i = 0; i <= pv; i++) { const a = i / pv * Math.PI * 2, r = Math.min(o.rectW, o.rectH) * 0.5 * pn[i % pv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.6; if (i === 0) pulse.moveTo(px, py); else pulse.lineTo(px, py) }
    pulse.closePath(); pulse.fillPath()
    scene.tweens.add({ targets: pulse, alpha: 0.28, scale: 1.2, duration: life * 0.3, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: pulse, alpha: 0, scale: 1.4, duration: life * 0.3, onComplete: () => pulse.destroy() }) })
    // scattered blink-sparks (the pack flying into a frenzy)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4, d = 40 + Math.random() * Math.min(o.rectW, o.rectH) * 0.4
      const sx = x + Math.cos(a) * d, sy = cy + Math.sin(a) * d * 0.6
      if (!_validXY(sx, sy)) continue
      scene.time.delayedCall(i * 40 + Math.random() * 120, () => { const e = scene.add.graphics().setPosition(sx, sy).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(e); e.fillStyle(0xffd23f, 0.7); e.fillCircle(0, 0, 4); e.fillStyle(o.color, 0.5); e.fillCircle(0, 0, 8); scene.tweens.add({ targets: e, alpha: 0.85, scale: 1.3, duration: life * 0.12, yoyo: true, onComplete: () => e.destroy() }) })
    }
    // per-victim fire burst
    for (const v of (o.victims || [])) {
      if (!_validXY(v.x, v.y)) continue
      scene.time.delayedCall(life * 0.2 + Math.random() * life * 0.15, () => { const b = scene.add.graphics().setPosition(v.x, v.y - 8).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(b); b.fillStyle(0xffd23f, 0.6); b.fillCircle(0, 0, 5); b.fillStyle(o.color, 0.5); b.fillCircle(0, 0, 11); scene.tweens.add({ targets: b, alpha: 0.8, scale: 1.5, duration: life * 0.16, yoyo: true, onComplete: () => b.destroy() }) })
    }
    if (mult > 0) { const d = scene.add.particles(x, cy, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speed: { min: 50, max: 160 }, angle: { min: 0, max: 360 }, gravityY: 40, scale: { start: 0.3, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [0xff6633, 0xffd23f, 0x661111], emitting: false }); d.setDepth(o.depth + 0.1); d.explode(Math.round(18 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} }) }
    return made
  },

  // ── PLANT · ENTANGLE ────────────────────────────────────────────────────
  // A cached ROOT-VINE CUFF (baked once) — a cluster of intertwined vines wrapping a
  // leg-cuff, studded with little thorns + leaves. Worn on a ROOTED hero's legs for the
  // whole root window (the held entangle tell), so the snare reads the entire time.
  rootVineTexture(scene) {
    const key = '__qf_rootvine'
    if (scene.textures.exists(key)) return key
    const W = 46, H = 30
    const g = scene.make.graphics({ x: 0, y: 0, add: false })
    g.translateCanvas(W / 2, H / 2)
    const dark = 0x2f5c1a, mid = 0x4f8c2f, lite = 0x86c24a
    for (let s = 0; s < 4; s++) {                                   // intertwined vine strands wrapping the cuff
      const ph = s * 1.3, col = s % 2 ? mid : dark
      g.lineStyle(Math.max(1, 3 - s * 0.45), col, 0.92); g.beginPath()
      const segs = 22
      for (let i = 0; i <= segs; i++) { const t = i / segs, a = t * Math.PI * 2 + ph, rx = 17 * (0.82 + 0.18 * Math.sin(t * 6 + ph)), ry = 9 * (0.82 + 0.18 * Math.cos(t * 5 + ph)); const px = Math.cos(a) * rx, py = Math.sin(a) * ry; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) }
      g.strokePath()
    }
    for (let i = 0; i < 6; i++) {                                   // thorns jutting outward
      const a = (i / 6) * Math.PI * 2 + 0.4, rx = 15, ry = 8, bx = Math.cos(a) * rx, by = Math.sin(a) * ry, tx = Math.cos(a) * (rx + 5), ty = Math.sin(a) * (ry + 4), nx = -Math.sin(a) * 2, ny = Math.cos(a) * 2
      g.fillStyle(dark, 0.95); g.beginPath(); g.moveTo(bx + nx, by + ny); g.lineTo(bx - nx, by - ny); g.lineTo(tx, ty); g.closePath(); g.fillPath()
    }
    for (const [lx, ly] of [[-12, -7], [11, 6], [4, -8]]) { g.fillStyle(mid, 0.95); g.fillEllipse(lx, ly, 6, 3.2); g.fillStyle(lite, 0.6); g.fillEllipse(lx - 1, ly - 0.6, 3, 1.6) }   // small leaves
    g.generateTexture(key, W, H)
    g.destroy()
    return key
  },

  // ENTANGLE — vines whip up from the ground around the hero's feet and CINCH the
  // legs (a snare), with a tightening flutter of leaves. Organic, never a ring.
  entangleFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6fae3a, depth: 16, durationMs: 620, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y + 4   // at the feet
    const n = 4
    for (let i = 0; i < n; i++) {
      const ang = -90 + (i - (n - 1) / 2) * 38 + (Math.random() * 16 - 8)   // mostly upward, fanned
      const v = scene.add.graphics().setPosition(x + (Math.random() * 10 - 5), cy + 8).setDepth(o.depth + 0.3).setAngle(ang).setScale(0.3, 1).setAlpha(0); made.push(v)
      _drawVine(v, 22 + Math.random() * 8, o.color)
      scene.tweens.add({ targets: v, scaleX: 1, alpha: 0.95, angle: ang + (i % 2 ? 12 : -12), duration: life * 0.28, delay: i * 30, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: v, alpha: 0, scaleX: 0.6, duration: life * 0.4, delay: life * 0.18, onComplete: () => v.destroy() }) })
    }
    // a low cinch at the ankles — leaves draw inward (tightening), not a ring
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const lf = scene.add.graphics().setPosition(x + Math.cos(a) * 14, cy + Math.sin(a) * 6).setDepth(o.depth + 0.4).setScale(0.4).setAlpha(0).setAngle(Math.random() * 360); made.push(lf)
      _drawLeaf(lf, 3 + Math.random() * 1.5, i % 2 ? 0x7fcf45 : 0x5a9c2a)
      scene.tweens.add({ targets: lf, x: x + Math.cos(a) * 5, y: cy + Math.sin(a) * 3, alpha: 0.9, scale: 0.9, duration: life * 0.24, delay: i * 14, ease: 'Quad.easeIn',
        onComplete: () => scene.tweens.add({ targets: lf, alpha: 0, duration: life * 0.4, delay: life * 0.12, onComplete: () => lf.destroy() }) })
    }
    return made
  },

  // STRANGLETHORN (ULT) — a briar thicket ERUPTS across the room (vines jut up from
  // the ground in an irregular spread), grasping vines cinch each hero, and a
  // blood-drain mote stream is siphoned from each victim back to the briar.
  stranglethornFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6fae3a, depth: 18, durationMs: 1300, rectW: 300, rectH: 200, victims: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 8
    // 1) briar thicket erupts around the briar — vines jut up (irregular spread)
    const nV = 10
    for (let i = 0; i < nV; i++) {
      const ang = (i / nV) * Math.PI * 2 + (Math.random() * 0.5 - 0.25), rr = 14 + Math.random() * 30
      const vx = x + Math.cos(ang) * rr, vy = cy + 8 + Math.sin(ang) * rr * 0.5
      if (!_validXY(vx, vy)) continue
      const v = scene.add.graphics().setPosition(vx, vy + 12).setDepth(o.depth + (vy - cy) * 0.02).setAngle(-90 + (Math.random() * 30 - 15)).setScale(0.5, 0.1).setAlpha(0); made.push(v)
      _drawVine(v, 18 + Math.random() * 10, o.color)
      scene.time.delayedCall(i * 26 + Math.random() * 40, () => scene.tweens.add({ targets: v, y: vy, scaleX: 1, scaleY: 1, alpha: 0.9, duration: life * 0.16, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: v, alpha: 0, y: vy + 3, duration: life * 0.4, delay: life * 0.3, onComplete: () => v.destroy() }) }))
    }
    // 2) per-victim cinch + a blood-drain mote stream siphoned back to the briar
    for (const vct of (o.victims || [])) {
      if (!_validXY(vct.x, vct.y)) continue
      scene.time.delayedCall(life * 0.1 + Math.random() * life * 0.12, () => { const m = this.entangleFx(scene, vct.x, vct.y, { slow }); if (m) made.push(...m) })
      if (mult > 0) {
        scene.time.delayedCall(life * 0.22, () => {
          const d = scene.add.particles(vct.x, vct.y - 8, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.5 }, scale: { start: 0.18, end: 0 }, alpha: { start: 0.75, end: 0 }, tint: [0xaa1133, 0xcc3344], moveToX: x, moveToY: cy, emitting: false })
          d.setDepth(o.depth + 0.3); d.explode(6); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
        })
      }
    }
    // a dark-red feed glow pulses on the briar as it drinks
    const glow = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(glow)
    glow.fillStyle(0xaa1f33, 0.4); glow.fillCircle(0, 0, 16); glow.fillStyle(0xcc3344, 0.3); glow.fillCircle(0, 0, 9)
    scene.time.delayedCall(life * 0.25, () => scene.tweens.add({ targets: glow, alpha: 0.5, scale: 1.3, duration: life * 0.3, yoyo: true, onComplete: () => glow.destroy() }))
    return made
  },

  // ── MUSHROOM · HALLUCINATION ────────────────────────────────────────────
  // DAZE — over the hero's head: drifting spore motes + a wobbling "dizzy" spiral
  // (a spiral, never a ring) — the read for "this hero is hallucinating / will miss".
  dazeFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xb98fd0, depth: 44, durationMs: 900, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const hy = y - 30   // over the head
    if (mult > 0) {
      const d = scene.add.particles(x, hy, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedX: { min: -18, max: 18 }, speedY: { min: -30, max: -4 }, scale: { start: 0.18, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [0xb98fd0, 0x9966cc, 0xd9b8ec], frequency: 55, quantity: 1 })
      d.setDepth(o.depth - 0.1).setBlendMode(Phaser.BlendModes.ADD); made.push(d)
      scene.time.delayedCall(life * 0.6, () => { try { d.stop() } catch (e) {} }); scene.time.delayedCall(life * 1.6, () => { try { d.destroy() } catch (e) {} })
    }
    // a wobbling dizzy spiral
    const sw = scene.add.graphics().setPosition(x, hy).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(sw)
    sw.lineStyle(2, o.color, 0.85); sw.beginPath()
    for (let i = 0; i <= 26; i++) { const t = i / 26, a = t * Math.PI * 3.5, r = 2 + t * 7; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.7; if (i === 0) sw.moveTo(px, py); else sw.lineTo(px, py) }
    sw.strokePath()
    scene.tweens.add({ targets: sw, alpha: 0.9, scale: 1, angle: 130, duration: life * 0.42, ease: 'Sine.easeOut', yoyo: true, hold: life * 0.12, onComplete: () => sw.destroy() })
    return made
  },

  // SPORE CLOUD (T2) — the cap belches a spreading spore haze: a lobed purple veil
  // (low alpha — drifting, not a wash) + rising motes + a couple of little caps.
  sporePuffFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9966cc, depth: 15, durationMs: 1100, radius: 80, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 6
    const haze = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(haze)
    const hv = 14, hn = Array.from({ length: hv }, () => 0.7 + Math.random() * 0.5); haze.fillStyle(_lerpColor(o.color, 0xd9b8ec, 0.4), 0.2); haze.beginPath()
    for (let i = 0; i <= hv; i++) { const a = i / hv * Math.PI * 2, r = o.radius * hn[i % hv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.7; if (i === 0) haze.moveTo(px, py); else haze.lineTo(px, py) }
    haze.closePath(); haze.fillPath()
    scene.tweens.add({ targets: haze, alpha: 0.25, scale: 1.2, duration: life * 0.35, ease: 'Sine.easeOut', onComplete: () => scene.tweens.add({ targets: haze, alpha: 0, scale: 1.5, duration: life * 0.5, onComplete: () => haze.destroy() }) })
    if (mult > 0) { const d = scene.add.particles(x, cy, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speed: { min: 20, max: o.radius }, angle: { min: 0, max: 360 }, gravityY: -12, scale: { start: 0.2, end: 0 }, alpha: { start: 0.55, end: 0 }, tint: [0xb98fd0, 0x9966cc, 0xd9b8ec], emitting: false }); d.setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); d.explode(Math.round(16 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} }) }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.random(), dd = o.radius * (0.3 + Math.random() * 0.4)
      const cap = scene.add.graphics().setPosition(x + Math.cos(a) * dd, cy + Math.sin(a) * dd * 0.6 + 6).setDepth(o.depth + 0.2).setScale(0.3).setAlpha(0); made.push(cap)
      _drawSporeCap(cap, 5 + Math.random() * 2, o.color)
      scene.tweens.add({ targets: cap, y: '-=10', scale: 0.9, alpha: 0.85, duration: life * 0.3, delay: i * 50, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: cap, alpha: 0, duration: life * 0.4, onComplete: () => cap.destroy() }) })
    }
    return made
  },

  // SPORE STORM (ULT) — a room-wide hallucinogenic bloom: a faint room haze + a
  // gust of rising spore motes + a per-hero daze puff (everyone fights blind).
  sporeStormFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9966cc, depth: 18, durationMs: 1300, rectW: 300, rectH: 200, victims: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cy = y - 8
    const haze = scene.add.graphics().setPosition(x, cy).setDepth(o.depth - 0.4).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(haze)
    const hv = 18, hn = Array.from({ length: hv }, () => 0.7 + Math.random() * 0.5); haze.fillStyle(_lerpColor(o.color, 0xd9b8ec, 0.4), 0.18); haze.beginPath()
    for (let i = 0; i <= hv; i++) { const a = i / hv * Math.PI * 2, r = Math.min(o.rectW, o.rectH) * 0.5 * hn[i % hv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.6; if (i === 0) haze.moveTo(px, py); else haze.lineTo(px, py) }
    haze.closePath(); haze.fillPath()
    scene.tweens.add({ targets: haze, alpha: 0.24, scale: 1.15, duration: life * 0.35, ease: 'Sine.easeOut', onComplete: () => scene.tweens.add({ targets: haze, alpha: 0, scale: 1.3, duration: life * 0.4, onComplete: () => haze.destroy() }) })
    if (mult > 0) { const d = scene.add.particles(x, cy, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.9 }, speed: { min: 30, max: Math.min(o.rectW, o.rectH) * 0.6 }, angle: { min: 0, max: 360 }, gravityY: -14, scale: { start: 0.22, end: 0 }, alpha: { start: 0.55, end: 0 }, tint: [0xb98fd0, 0x9966cc, 0xd9b8ec], emitting: false }); d.setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); d.explode(Math.round(30 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} }) }
    for (const v of (o.victims || [])) { if (!_validXY(v.x, v.y)) continue; scene.time.delayedCall(life * 0.15 + Math.random() * life * 0.15, () => { const m = this.dazeFx(scene, v.x, v.y, { slow }); if (m) made.push(...m) }) }
    return made
  },

  // JUICE — tie a world impact to camera feel: impactFx + camera shake + (opt) flash.
  // The thing that makes a hit LAND. Native Phaser camera FX (own ScreenShakeSystem
  // not required). opts: shake (0–1 intensity), shakeMs, flash (0 = off), color.
  juice(scene, x, y, opts = {}) {
    const o = _pal({ color: 0xffd060, shake: 0.008, shakeMs: 180, flash: 0, flashRGB: [255, 220, 120], ...opts })
    const slow = o.slow ?? 1
    const made = [this.impactFx(scene, x, y, { tint: o.color, color: 0xffffff, slow })]
    try { scene.cameras.main.shake(o.shakeMs * slow, o.shake) } catch (e) {}
    if (o.flash > 0) { try { scene.cameras.main.flash(140 * slow, o.flashRGB[0], o.flashRGB[1], o.flashRGB[2], false) } catch (e) {} }
    return made
  },

  // FLIPBOOK — play an authored 64×64 vfx sprite-sheet (assets/sprites/vfx/, loaded
  // as 'vfx-*') as a one-shot animation, with optional additive blend + Glow. Lazily
  // registers the anim from the full sheet. Composes authored art into any effect.
  flipbookFx(scene, x, y, sheetKey, opts = {}) {
    if (!scene.textures.exists(sheetKey)) return null
    const o = { frameRate: 28, scale: 1, color: null, glow: false, blend: false, depth: 8, ...opts }
    const animKey = '__qf_fb_' + sheetKey
    if (!scene.anims.exists(animKey)) {
      try { scene.anims.create({ key: animKey, frames: scene.anims.generateFrameNumbers(sheetKey), frameRate: o.frameRate, hideOnComplete: true }) } catch (e) { return null }
    }
    const spr = scene.add.sprite(x, y, sheetKey).setDepth(o.depth).setScale(o.scale)
    if (o.color) spr.setTint(o.color)
    if (o.blend) spr.setBlendMode(Phaser.BlendModes.ADD)
    try { if (o.glow) spr.postFX.addGlow(o.color ?? 0xffffff, 4, 0, false, 0.1, 8) } catch (e) {}
    spr.play(animKey)
    if (o.slow) { try { spr.anims.timeScale = 1 / o.slow } catch (e) {} }
    spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => spr.destroy())
    scene.time.delayedCall(6000, () => { try { spr.destroy() } catch (e) {} })
    return spr
  },

  pulseRing(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { ...DEFAULTS.ring, ...opts }
    const ring = scene.add.circle(x, y, o.fromR, 0x000000, 0)
    ring.setStrokeStyle(2, o.color, o.alpha)
    ring.setDepth(o.depth)
    _add(ring); _glow(ring, o.color, 4, 8)
    scene.tweens.add({
      targets: ring,
      radius: o.toR,
      alpha: 0,
      duration: o.durationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    })
    return ring
  },

  particleBurst(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { ...DEFAULTS.particles, ...opts }
    // Scale by the user's particles quality setting. At 'off' we skip
    // the emit entirely; at 'low' we cut count to ~40% (rounded so a
    // 6-dot burst still emits 2 dots), etc.
    const mult = _particlesMult()
    if (mult <= 0) return null
    const count = Math.max(1, Math.round(o.count * mult))
    const created = []
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const dist = o.speed * (0.6 + Math.random() * 0.6) * (o.durationMs / 1000)
      const dot = scene.add.circle(x, y, 2 + Math.random() * 1.5, o.color, 0.95)  // circle-ok: incidental particle (droplet/bubble/spore/ember)
      dot.setDepth(o.depth); _add(dot)
      created.push(dot)
      scene.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        duration: o.durationMs,
        ease: 'Quad.easeOut',
        onComplete: () => dot.destroy(),
      })
    }
    return created
  },

  floatingText(scene, x, y, str, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { ...DEFAULTS.text, ...opts }
    const txt = scene.add.text(x, y, str, {
      fontSize: o.fontSize,
      color: o.color,
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(o.depth)
    // Pop-in: start small and overshoot to 1.0 with Back.easeOut so damage
    // numbers / status labels punch in instead of drifting in linearly.
    // Runs in parallel with the drift+fade tween below — multiple tweens
    // per target are fine in Phaser.
    txt.setScale(0.55)
    scene.tweens.add({
      targets: txt,
      scale:   1,
      duration: 160,
      ease:    'Back.easeOut',
    })
    scene.tweens.add({
      targets: txt,
      y: y + o.driftY,
      alpha: 0,
      duration: o.durationMs,
      ease: 'Quad.easeOut',
      onComplete: () => txt.destroy(),
    })
    return txt
  },

  tintFlash(target, color, opts = {}) {
    if (!target || typeof target.setTint !== 'function') return null
    const o = { ...DEFAULTS.tint, color, ...opts }
    target.setTint(o.color)
    if (target.scene && target.scene.time) {
      target.scene.time.delayedCall(o.durationMs, () => {
        if (target.active && typeof target.clearTint === 'function') target.clearTint()
      })
    }
    return target
  },

  alphaSet(target, alpha) {
    if (!target) return null
    target.setAlpha?.(alpha)
    return target
  },

  // Projectile — small dot tweened from (fromX,fromY) to (toX,toY).
  // Used for ranged minion attacks (lich heal beam, ghost spook,
  // mimic snap, etc.) so range > 1 reads visually instead of damage
  // appearing instantly at the target.
  //
  // Options: color (hex), durationMs, radius, depth.
  projectile(scene, fromX, fromY, toX, toY, opts = {}) {
    if (!_validXY(fromX, fromY) || !_validXY(toX, toY)) return null
    const o = {
      color:      opts.color      ?? 0xfff0aa,
      durationMs: opts.durationMs ?? 220,
      radius:     opts.radius     ?? 3,
      depth:      opts.depth      ?? 12,
    }
    const dot = scene.add.graphics().setDepth(o.depth)
    _add(dot); _glow(dot, o.color, 5, 10)
    dot.fillStyle(o.color, 1).fillCircle(0, 0, o.radius)
    dot.setPosition(fromX, fromY)
    scene.tweens.add({
      targets:  dot,
      x:        toX,
      y:        toY,
      duration: o.durationMs,
      ease:     'Sine.easeIn',
      onComplete: () => dot.destroy(),
    })
    return dot
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Composite "limit-break-grade" effects. Bigger, layered, self-destroying.
  // Built for ability / Limit Break moments that need to read as STUNNING, not
  // a single ring. World-space; depth 29-33 draws above all world sprites
  // (sprites sit at ~7-8; the HUD is separate DOM, so high depths are safe).
  // All respect _validXY + the particles quality multiplier where heavy.
  // ─────────────────────────────────────────────────────────────────────────

  // Thick expanding shockwave ring (+ optional bright fading core).
  shockwave(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe066, fromR: 8, toR: 120, thickness: 6, alpha: 0.9,
      durationMs: 520, depth: 30, core: true, ...opts }
    const ring = scene.add.circle(x, y, o.fromR, 0x000000, 0)  // circle-ok: thin accent rim, not the hero shape
    ring.setStrokeStyle(o.thickness, o.color, o.alpha).setDepth(o.depth)
    _add(ring); _glow(ring, o.color, 4, 10)
    scene.tweens.add({ targets: ring, radius: o.toR, alpha: 0, duration: o.durationMs,
      ease: 'Cubic.easeOut', onComplete: () => ring.destroy() })
    if (o.core) {
      const core = scene.add.circle(x, y, o.fromR, o.color, 0.5).setDepth(o.depth - 1)  // circle-ok: small additive flash/glow core
      _add(core)
      scene.tweens.add({ targets: core, radius: o.toR * 0.55, alpha: 0,
        duration: o.durationMs * 0.7, ease: 'Quad.easeOut', onComplete: () => core.destroy() })
    }
    return ring
  },

  // N radial light rays bursting outward from a point (sunburst).
  burstRays(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xfff2c0, count: 12, length: 90, thickness: 3, durationMs: 450, depth: 30, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(4, Math.round(o.count * mult))
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2
      const g = scene.add.graphics().setDepth(o.depth)
      _add(g)
      g.lineStyle(o.thickness, o.color, 0.95)
      g.lineBetween(0, 0, Math.cos(ang) * o.length * 0.3, Math.sin(ang) * o.length * 0.3)
      g.setPosition(x, y)
      scene.tweens.add({ targets: g, scaleX: 3.3, scaleY: 3.3, alpha: 0,
        duration: o.durationMs, ease: 'Cubic.easeOut', onComplete: () => g.destroy() })
    }
    return null
  },

  // Particles converging INWARD to a point — sells a charge / wind-up.
  chargeUp(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9ad0ff, count: 14, radius: 70, durationMs: 600, depth: 29, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(4, Math.round(o.count * mult))
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5
      const sx = x + Math.cos(ang) * o.radius, sy = y + Math.sin(ang) * o.radius
      const dot = _add(scene.add.circle(sx, sy, 2 + Math.random() * 2, o.color, 0.95).setDepth(o.depth))  // circle-ok: incidental particle (droplet/bubble/spore/ember)
      scene.tweens.add({ targets: dot, x, y, alpha: 0.4,
        duration: o.durationMs * (0.7 + Math.random() * 0.3), ease: 'Cubic.easeIn',
        onComplete: () => dot.destroy() })
    }
    return null
  },

  // A column of energy rising from a point (holy beam, revive, boss-ability
  // pillar, the dominion overload, …). Built from LAYERED additive light — a wide
  // haze, a coloured body, and a white-hot core — capped by an impact disc at the
  // base and a flare at the tip, with motes streaking up it. Replaces the old flat
  // single rectangle (which read as a basic solid block). Same API + anchor: it
  // extends UP from (x, y) so every existing caller's colour/size still works.
  beamPillar(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffffff, width: 46, height: 260, durationMs: 520, depth: 31, ...opts }
    const ADD = Phaser.BlendModes.ADD
    const baseY = y + 6
    const topY  = baseY - o.height
    const tIn   = Math.max(110, o.durationMs * 0.20)
    const hold  = Math.max(120, o.durationMs * 0.34)
    const tOut  = Math.max(170, o.durationMs * 0.46)
    const objs = []
    const mk = (ob) => { objs.push(ob); return ob }

    // Three stacked columns: wide soft haze → coloured body → thin white-hot core.
    // Additive blend so the overlaps bloom into "light" instead of a flat fill.
    const cols = [
      mk(scene.add.rectangle(x, baseY, o.width * 2.3, o.height, o.color, 0.16)),
      mk(scene.add.rectangle(x, baseY, o.width,        o.height, o.color, 0.5)),
      mk(scene.add.rectangle(x, baseY, Math.max(4, o.width * 0.30), o.height, 0xffffff, 0.92)),
    ]
    cols.forEach((c, i) => c.setOrigin(0.5, 1).setDepth(o.depth + i).setBlendMode(ADD).setScale(0.22, 1))
    // Slam open from a thin line to full width with a touch of overshoot.
    scene.tweens.add({ targets: cols, scaleX: 1, duration: tIn, ease: 'Back.easeOut' })

    // Light pooling at each end — a bright impact disc at the base + a flare cap
    // at the tip — sells the beam as touching down rather than floating.
    const disc = mk(scene.add.ellipse(x, baseY, o.width * 2.1, o.width * 0.8, 0xffffff, 0.85)  // circle-ok: flat ground pool/crater accent
      .setDepth(o.depth + 3).setBlendMode(ADD).setScale(0.3))
    const cap  = mk(scene.add.circle(x, topY, o.width * 0.7, o.color, 0.8)  // circle-ok: small additive flash/glow core
      .setDepth(o.depth + 2).setBlendMode(ADD).setScale(0.3))
    scene.tweens.add({ targets: [disc, cap], scale: 1, duration: tIn, ease: 'Back.easeOut' })

    // Fade the whole stack out together, then clean up.
    scene.tweens.add({ targets: objs, alpha: 0, duration: tOut, delay: tIn + hold,
      ease: 'Quad.easeIn', onComplete: () => objs.forEach(ob => ob.destroy()) })

    // Energy motes streaking up the beam (quality-gated).
    const mult = _particlesMult()
    if (mult > 0) {
      const n = Math.max(2, Math.round(4 * mult))
      for (let i = 0; i < n; i++) {
        const mx = x + (Math.random() - 0.5) * o.width * 0.5
        const mote = scene.add.circle(mx, baseY, 2 + Math.random() * 2.5, 0xffffff, 0.95)  // circle-ok: incidental particle (droplet/bubble/spore/ember)
          .setDepth(o.depth + 4).setBlendMode(ADD)
        scene.tweens.add({ targets: mote, y: topY + Math.random() * 24, alpha: 0,
          duration: o.durationMs * (0.55 + Math.random() * 0.4), delay: tIn * 0.4 + i * 70,
          ease: 'Cubic.easeOut', onComplete: () => mote.destroy() })
      }
    }
    return cols[2]
  },

  // A meteor streak falling from off-screen-up to (x,y), then a big impact.
  meteor(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff9a3a, fallMs: 420, fromDX: -120, fromDY: -340, depth: 32, onImpact: null, ...opts }
    const head = _glow(_add(scene.add.circle(x + o.fromDX, y + o.fromDY, 9, o.color, 1).setDepth(o.depth)), o.color, 5, 10)  // circle-ok: small additive flash/glow core
    const glow = _add(scene.add.circle(head.x, head.y, 17, o.color, 0.3).setDepth(o.depth - 1))  // circle-ok: small additive flash/glow core
    const trail = scene.time.addEvent({ delay: 16, repeat: Math.floor(o.fallMs / 16), callback: () => {
      const t = scene.add.circle(head.x, head.y, 6, o.color, 0.5).setDepth(o.depth - 2)  // circle-ok: fading trail puff
      scene.tweens.add({ targets: t, alpha: 0, scale: 0.3, duration: 260, onComplete: () => t.destroy() })
    } })
    scene.tweens.add({ targets: [head, glow], x, y, duration: o.fallMs, ease: 'Quad.easeIn',
      onComplete: () => {
        head.destroy(); glow.destroy(); trail.remove(false)
        AbilityVfx.shockwave(scene, x, y, { color: o.color, toR: 150, thickness: 8, durationMs: 600 })
        AbilityVfx.particleBurst(scene, x, y, { color: o.color, count: 18, speed: 130, durationMs: 600 })
        scene.lightingSystem?.flash(x, y, { color: o.color, radius: 150, durationMs: 650, intensity: 1.0 })
        if (typeof o.onImpact === 'function') o.onImpact()
      } })
    return head
  },

  // Jagged lightning bolt between two points — flashes then fades.
  lightning(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { color: 0xbfe0ff, segments: 6, jitter: 14, thickness: 3, durationMs: 220, depth: 32, ...opts }
    const g = scene.add.graphics().setDepth(o.depth)
    _add(g); _glow(g, o.color, 5, 10)
    g.lineStyle(o.thickness, o.color, 1).beginPath()
    g.moveTo(x1, y1)
    for (let i = 1; i < o.segments; i++) {
      const t = i / o.segments
      g.lineTo(x1 + (x2 - x1) * t + (Math.random() - 0.5) * o.jitter * 2,
               y1 + (y2 - y1) * t + (Math.random() - 0.5) * o.jitter * 2)
    }
    g.lineTo(x2, y2); g.strokePath()
    scene.tweens.add({ targets: g, alpha: 0, duration: o.durationMs, ease: 'Quad.easeIn',
      onComplete: () => g.destroy() })
    return g
  },

  // Full-screen color flash via the camera (guarded wrapper).
  screenFlash(scene, opts = {}) {
    const o = { color: 0xffffff, durationMs: 260, intensity: 0.6, ...opts }
    const r = (o.color >> 16) & 255, gg = (o.color >> 8) & 255, b = o.color & 255
    try {
      scene.cameras?.main?.flash?.(o.durationMs,
        Math.round(r * o.intensity), Math.round(gg * o.intensity), Math.round(b * o.intensity))
    } catch {}
  },

  // A holding dome / shield that pops in over a target and fades after a hold.
  domeShield(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd66b, radius: 54, holdMs: 600, depth: 30, ...opts }
    const dome = scene.add.circle(x, y, o.radius, o.color, 0.12).setDepth(o.depth)  // circle-ok: shield dome volume (round by nature)
    dome.setStrokeStyle(3, o.color, 0.9).setScale(0.2)
    _add(dome); _glow(dome, o.color, 4, 12)
    scene.tweens.add({ targets: dome, scale: 1, duration: 220, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: dome, alpha: 0, delay: o.holdMs, duration: 400,
      ease: 'Quad.easeIn', onComplete: () => dome.destroy() })
    return dome
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Cinematic-grade primitives (Light Party duel overhaul, 2026-06-01).
  // Ground markers draw BELOW sprites (depth ~4-6); impacts/rays/arcs draw
  // ABOVE (29-33). All self-destroy and respect _validXY + the quality mult.
  // ─────────────────────────────────────────────────────────────────────────

  // FFXIV-style ground telegraph that FILLS over `durationMs` then detonates
  // (a bright flash) so a mechanic reads before it lands. shape: 'circle'
  // (radius), 'line' (length+width at `angle`), or 'cone' (length, ±0.5rad).
  groundTelegraph(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { shape: 'circle', color: 0xff5544, radius: 84, length: 180, width: 52,
      angle: 0, durationMs: 2000, depth: 5, ...opts }
    const g = scene.add.graphics().setDepth(o.depth)
    const cosA = Math.cos(o.angle), sinA = Math.sin(o.angle)
    const px = -sinA, py = cosA, hw = o.width / 2
    const linePts = () => {
      const ex = x + cosA * o.length, ey = y + sinA * o.length
      return [
        { x: x + px * hw, y: y + py * hw }, { x: x - px * hw, y: y - py * hw },
        { x: ex - px * hw, y: ey - py * hw }, { x: ex + px * hw, y: ey + py * hw },
      ]
    }
    const shape = (stroke) => {
      if (o.shape === 'line') {
        if (stroke) g.strokePoints(linePts(), true); else g.fillPoints(linePts(), true)
      } else if (o.shape === 'cone') {
        g.beginPath(); g.slice(x, y, o.length, o.angle - 0.5, o.angle + 0.5, false); g.closePath()
        if (stroke) g.strokePath(); else g.fillPath()
      } else {
        if (stroke) g.strokeCircle(x, y, o.radius); else g.fillCircle(x, y, o.radius)
      }
    }
    const proxy = { a: 0 }
    const render = () => {
      g.clear()
      g.fillStyle(o.color, 0.10 + proxy.a * 0.42)
      shape(false)
      g.lineStyle(2.5, o.color, 0.55 + proxy.a * 0.4)
      shape(true)
    }
    render()
    scene.tweens.add({ targets: proxy, a: 1, duration: o.durationMs, ease: 'Sine.easeIn',
      onUpdate: render,
      onComplete: () => {
        g.clear(); g.fillStyle(0xffffff, 0.55); shape(false); g.lineStyle(3, o.color, 1); shape(true)
        scene.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() })
      } })
    return g
  },

  // "Stack here" marker — a pulsing ringed circle with inward chevrons that
  // rotate over the cast, then flash. Reads as the FFXIV stack mechanic.
  stackMarker(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd66b, radius: 60, arrows: 6, durationMs: 2200, depth: 5, ...opts }
    const cont = scene.add.container(x, y).setDepth(o.depth)
    const g = scene.add.graphics()
    g.lineStyle(2.5, o.color, 0.9)
    g.strokeCircle(0, 0, o.radius)
    g.strokeCircle(0, 0, o.radius * 0.62)
    for (let i = 0; i < o.arrows; i++) {
      const a = (i / o.arrows) * Math.PI * 2
      const ox = Math.cos(a), oy = Math.sin(a)
      const tipR = o.radius * 0.78, baseR = o.radius * 1.02, wob = 0.16
      g.fillStyle(o.color, 0.85)
      g.fillPoints([
        { x: ox * tipR, y: oy * tipR },
        { x: Math.cos(a - wob) * baseR, y: Math.sin(a - wob) * baseR },
        { x: Math.cos(a + wob) * baseR, y: Math.sin(a + wob) * baseR },
      ], true)
    }
    cont.add(g)
    cont.setScale(0.3).setAlpha(0)
    scene.tweens.add({ targets: cont, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: cont, angle: 30, duration: o.durationMs, ease: 'Sine.easeInOut' })
    scene.tweens.add({ targets: g, alpha: 0.4, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    scene.time.delayedCall(o.durationMs, () => {
      AbilityVfx.shockwave(scene, x, y, { color: o.color, toR: o.radius * 1.6, thickness: 5, durationMs: 320 })
      scene.tweens.add({ targets: cont, alpha: 0, scale: 1.3, duration: 200, onComplete: () => cont.destroy() })
    })
    return cont
  },

  // Layered impact — core flash + shockwave + sparks + tumbling debris (+ an
  // optional lingering scorch decal). The default heavy "something just HIT".
  impactBurst(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff8a3a, coreColor: 0xffffff, sparks: 16, debris: 7,
      radius: 130, decal: false, durationMs: 540, depth: 31, ...opts }
    const core = scene.add.circle(x, y, 6, o.coreColor, 0.95).setDepth(o.depth + 1)  // circle-ok: small additive flash/glow core
    scene.tweens.add({ targets: core, radius: o.radius * 0.32, alpha: 0,
      duration: 200, ease: 'Quad.easeOut', onComplete: () => core.destroy() })
    AbilityVfx.shockwave(scene, x, y, { color: o.color, toR: o.radius, thickness: 6, durationMs: o.durationMs })
    AbilityVfx.particleBurst(scene, x, y, { color: o.color, count: o.sparks, speed: 165, durationMs: o.durationMs })
    const mult = _particlesMult()
    if (mult > 0) {
      const n = Math.max(2, Math.round(o.debris * mult))
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2, dist = o.radius * (0.35 + Math.random() * 0.6)
        const sz = 2 + Math.random() * 3
        const d = scene.add.rectangle(x, y, sz, sz, o.color, 0.9).setDepth(o.depth).setAngle(Math.random() * 360)
        const tx = x + Math.cos(ang) * dist
        const peakY = y - 18 - Math.random() * 26, ty = y + 8 + Math.random() * 18
        scene.tweens.add({ targets: d, x: tx, angle: d.angle + 220, duration: o.durationMs, ease: 'Quad.easeOut' })
        scene.tweens.add({ targets: d, y: peakY, duration: o.durationMs * 0.4, ease: 'Quad.easeOut',
          onComplete: () => scene.tweens.add({ targets: d, y: ty, alpha: 0, duration: o.durationMs * 0.6,
            ease: 'Quad.easeIn', onComplete: () => d.destroy() }) })
      }
    }
    if (o.decal) AbilityVfx.crater(scene, x, y, { color: 0x140a02, radius: o.radius * 0.42, holdMs: o.decal === true ? 2200 : o.decal })
    return null
  },

  // Rotating radial god-rays that bloom out + fade — the holy/LB "the heavens
  // open" layer. Persistent for `durationMs`, slow rotation.
  godRays(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xfff2c0, count: 14, length: 220, durationMs: 900, depth: 31, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(6, Math.round(o.count * mult))
    const cont = scene.add.container(x, y).setDepth(o.depth)
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2
      const g = _add(scene.add.graphics())
      g.fillStyle(o.color, 0.22)
      g.beginPath(); g.moveTo(0, 0)
      g.lineTo(Math.cos(ang - 0.035) * o.length, Math.sin(ang - 0.035) * o.length)
      g.lineTo(Math.cos(ang + 0.035) * o.length, Math.sin(ang + 0.035) * o.length)
      g.closePath(); g.fillPath()
      cont.add(g)
    }
    cont.setScale(0.15)
    scene.tweens.add({ targets: cont, scale: 1, duration: o.durationMs * 0.4, ease: 'Cubic.easeOut' })
    scene.tweens.add({ targets: cont, angle: 36, duration: o.durationMs, ease: 'Sine.easeInOut' })
    scene.tweens.add({ targets: cont, alpha: 0, delay: o.durationMs * 0.5, duration: o.durationMs * 0.5,
      onComplete: () => cont.destroy() })
    return cont
  },

  // Expanding, rotating summoning sigil on the ground (two rings + radial
  // ticks). The "channel a big spell" floor layer.
  magicCircle(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd66b, radius: 92, ticks: 12, durationMs: 1400, depth: 5, ...opts }
    const cont = scene.add.container(x, y).setDepth(o.depth)
    const g = scene.add.graphics()
    _add(g); _glow(g, o.color, 3, 9)
    g.lineStyle(2.5, o.color, 0.9)
    g.strokeCircle(0, 0, o.radius)
    g.strokeCircle(0, 0, o.radius * 0.66)
    for (let i = 0; i < o.ticks; i++) {
      const a = (i / o.ticks) * Math.PI * 2
      g.lineBetween(Math.cos(a) * o.radius * 0.66, Math.sin(a) * o.radius * 0.66,
        Math.cos(a) * o.radius, Math.sin(a) * o.radius)
    }
    cont.add(g)
    cont.setScale(0).setAlpha(0)
    scene.tweens.add({ targets: cont, scale: 1, alpha: 1, duration: o.durationMs * 0.25, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: cont, angle: 50, duration: o.durationMs, ease: 'Linear' })
    scene.tweens.add({ targets: cont, alpha: 0, delay: o.durationMs * 0.6, duration: o.durationMs * 0.4,
      onComplete: () => cont.destroy() })
    return cont
  },

  // A crescent blade-slash trail that sweeps + fades fast — melee swing signature.
  bladeArc(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffffff, radius: 36, angle: 0, sweep: 2.1, thickness: 5, durationMs: 240, depth: 33, ...opts }
    const g = scene.add.graphics().setDepth(o.depth).setPosition(x, y)
    _add(g); _glow(g, o.color, 4, 9)
    const start = o.angle - o.sweep / 2
    g.lineStyle(o.thickness, o.color, 0.95)
    g.beginPath(); g.arc(0, 0, o.radius, start, start + o.sweep, false); g.strokePath()
    g.setScale(0.6)
    scene.tweens.add({ targets: g, scaleX: 1.25, scaleY: 1.25, alpha: 0, duration: o.durationMs,
      ease: 'Cubic.easeOut', onComplete: () => g.destroy() })
    return g
  },

  // Floating arcane runes rising off a caster — spellcast signature.
  runeSigil(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xc9a9ff, count: 4, durationMs: 540, depth: 33, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(2, Math.round(o.count * mult))
    for (let i = 0; i < n; i++) {
      const dx = (Math.random() - 0.5) * 30
      const r = _add(scene.add.rectangle(x + dx, y + (Math.random() - 0.5) * 10, 6, 6, o.color, 0.9)
        .setDepth(o.depth).setAngle(45))
      scene.tweens.add({ targets: r, y: r.y - 26 - Math.random() * 16, angle: r.angle + 180, alpha: 0,
        duration: o.durationMs, ease: 'Quad.easeOut', onComplete: () => r.destroy() })
    }
    return null
  },

  // Lingering ground scorch / crater decal that fades after a hold.
  crater(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x140a02, radius: 42, holdMs: 2000, depth: 4, ...opts }
    const e = scene.add.ellipse(x, y, o.radius * 2, o.radius * 1.05, o.color, 0.5).setDepth(o.depth).setScale(0.4)  // circle-ok: flat ground pool/crater accent
    scene.tweens.add({ targets: e, scaleX: 1, scaleY: 1, duration: 180, ease: 'Quad.easeOut' })
    scene.tweens.add({ targets: e, alpha: 0, delay: o.holdMs, duration: 600, onComplete: () => e.destroy() })
    return e
  },

  // Drifting embers rising over an area — post-impact atmosphere.
  emberField(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff9a3a, count: 10, area: 90, durationMs: 1200, depth: 32, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(3, Math.round(o.count * mult))
    for (let i = 0; i < n; i++) {
      const sx = x + (Math.random() - 0.5) * o.area, sy = y + (Math.random() - 0.5) * o.area * 0.5
      const d = _add(scene.add.circle(sx, sy, 1.5 + Math.random() * 1.5, o.color, 0.9).setDepth(o.depth))  // circle-ok: incidental particle (droplet/bubble/spore/ember)
      scene.tweens.add({ targets: d, x: sx + (Math.random() - 0.5) * 30, y: sy - 30 - Math.random() * 40,
        alpha: 0, duration: o.durationMs * (0.6 + Math.random() * 0.4), ease: 'Sine.easeOut',
        onComplete: () => d.destroy() })
    }
    return null
  },

  // Micro freeze-frame for impact weight. Near-zero timeScale for `ms` (REAL
  // time, restored via setTimeout so the scaled clock can't strand it). Use
  // sparingly on hero beats (the LB killing blow) — overlapping slow-mos just
  // race to restore 1.0, which is a cosmetic blip, not a hang.
  hitStop(scene, ms = 90) {
    if (!scene?.time) return
    try {
      scene.time.timeScale = 0.0001
      window.setTimeout(() => { if (scene?.time) scene.time.timeScale = 1 }, ms)
    } catch {}
  },

  // Descending resurrection beam — gold pillar + halo ring + rising motes +
  // a soft sunburst. The Raise "they get back up" moment.
  resurrectBeam(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe9a8, durationMs: 700, depth: 31, ...opts }
    AbilityVfx.beamPillar(scene, x, y, { color: o.color, width: 34, height: 210, durationMs: o.durationMs })
    AbilityVfx.pulseRing(scene, x, y, { color: 0xffd66b, fromR: 6, toR: 36, thickness: 3, durationMs: o.durationMs })  // circle-ok: deliberate shock-ring accent, not the sole read
    AbilityVfx.burstRays(scene, x, y, { color: o.color, count: 10, length: 64, durationMs: o.durationMs * 0.6 })
    const mult = _particlesMult()
    if (mult > 0) {
      const n = Math.max(3, Math.round(8 * mult))
      for (let i = 0; i < n; i++) {
        const dx = (Math.random() - 0.5) * 28
        const d = scene.add.circle(x + dx, y + 6, 1.5 + Math.random() * 1.5, o.color, 0.95).setDepth(o.depth)  // circle-ok: incidental particle (droplet/bubble/spore/ember)
        scene.tweens.add({ targets: d, y: y - 40 - Math.random() * 30, alpha: 0,
          duration: o.durationMs * (0.7 + Math.random() * 0.4), ease: 'Sine.easeOut',
          onComplete: () => d.destroy() })
      }
    }
    return null
  },

  // Tumbling d6 that pops up over a point, spins while cycling random faces,
  // then settles on `face` (1-6) with a little jackpot ring. The Gambler's
  // "Roll the Dice" VFX (procedural pip-die — no sprite sheet needed).
  diceRoll(scene, x, y, face, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { size: 19, faceColor: 0xfafafa, pipColor: 0x232329, durationMs: 1100, depth: 33, ...opts }
    const s = o.size, q = s * 0.26, pr = s * 0.085
    const PIP = { c: [0, 0], tl: [-q, -q], tr: [q, -q], bl: [-q, q], br: [q, q], ml: [-q, 0], mr: [q, 0] }
    const FACES = { 1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'], 4: ['tl', 'tr', 'bl', 'br'],
      5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'] }
    const cont = scene.add.container(x, y).setDepth(o.depth)
    const g = scene.add.graphics()
    const draw = (f) => {
      g.clear()
      g.fillStyle(o.faceColor, 1).fillRoundedRect(-s / 2, -s / 2, s, s, 5)
      g.lineStyle(2, 0x000000, 0.35).strokeRoundedRect(-s / 2, -s / 2, s, s, 5)
      g.fillStyle(o.pipColor, 1)
      for (const k of (FACES[f] || ['c'])) { const [px, py] = PIP[k]; g.fillCircle(px, py, pr) }
    }
    draw(1 + Math.floor(Math.random() * 6))
    cont.add(g)
    cont.setScale(0.2).setAlpha(0)
    scene.tweens.add({ targets: cont, scale: 1, alpha: 1, y: y - 16, duration: 260, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: cont, angle: 360, duration: 720, ease: 'Cubic.easeOut' })
    scene.time.addEvent({ delay: 80, repeat: 7, callback: () => draw(1 + Math.floor(Math.random() * 6)) })
    scene.time.delayedCall(740, () => {
      if (!cont.active) return
      draw(face); cont.angle = 0; _glow(g, 0xffe066, 2, 8)
      scene.tweens.add({ targets: cont, scaleX: 1.18, scaleY: 0.85, duration: 90, yoyo: true, ease: 'Quad.easeOut' })
      const good = face === 6, whiff = face === 1, fc = good ? 0xffe066 : whiff ? 0x9a9aa2 : 0xffd27a
      AbilityVfx.pulseRing(scene, x, y - 16, { color: fc, fromR: 6, toR: 22, thickness: 3, durationMs: 280, alpha: 0.75 })  // circle-ok: deliberate result shock-ring accent, not the sole read
      const mult = _particlesMult()
      if (mult > 0) {
        const cnt = good ? 14 : whiff ? 5 : 8
        const p = scene.add.particles(x, y - 16, _softDotTexture(scene), { lifespan: { min: 200, max: 500 }, speed: { min: good ? 60 : 30, max: good ? 160 : 80 }, scale: { start: good ? 0.2 : 0.14, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: good ? [0xffe066, 0xfff6b0] : whiff ? [0x9a9aa2, 0x666666] : [0xffd27a, 0xffe066], blendMode: good ? 'ADD' : 'NORMAL', emitting: false })
        p.setDepth(o.depth + 1); p.explode(Math.round(cnt * mult)); scene.time.delayedCall(600, () => { try { p.destroy() } catch (e) {} })
      }
    })
    scene.time.delayedCall(o.durationMs, () => {
      if (cont.active) scene.tweens.add({ targets: cont, alpha: 0, y: y - 32, duration: 220, onComplete: () => cont.destroy() })
    })
    return cont
  },

  // Spinning coin that flips (edge-on scaleY oscillation), then lands on a gold
  // (win) or grey (lose) face with a ring. The Gambler's "Double or Nothing" VFX.
  coinFlip(scene, x, y, win, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { r: 10, durationMs: 1000, depth: 33, ...opts }
    const cont = scene.add.container(x, y).setDepth(o.depth)
    const g = scene.add.graphics()
    const drawCoin = (c) => {
      g.clear()
      g.fillStyle(c, 1).fillCircle(0, 0, o.r)
      g.lineStyle(2, 0x8a6a1a, 0.9).strokeCircle(0, 0, o.r)
      g.fillStyle(0xffffff, 0.25).fillCircle(-o.r * 0.3, -o.r * 0.3, o.r * 0.32)
    }
    drawCoin(0xf0c645)
    cont.add(g)
    cont.setAlpha(0).setScale(0.3)
    scene.tweens.add({ targets: cont, alpha: 1, scale: 1, y: y - 20, duration: 220, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: g, scaleY: 0.12, duration: 110, yoyo: true, repeat: 5, ease: 'Sine.easeInOut' })
    scene.time.delayedCall(740, () => {
      if (!cont.active) return
      drawCoin(win ? 0xffe066 : 0x9a9aa2)
      const col = win ? 0xffe066 : 0x9a9aa2
      if (win) _glow(g, 0xffe066, 3, 10)
      scene.tweens.add({ targets: cont, scaleX: 1.2, scaleY: 0.8, duration: 90, yoyo: true, ease: 'Quad.easeOut' })
      AbilityVfx.pulseRing(scene, x, y - 20, { color: col, fromR: 6, toR: 28, thickness: 3, durationMs: 320, alpha: 0.85 })  // circle-ok: deliberate result shock-ring accent, not the sole read
      // glint streaks off the landed coin (sharper for a win)
      for (let i = 0; i < (win ? 4 : 2); i++) {
        const a = Math.random() * Math.PI * 2, gl = scene.add.graphics().setPosition(x, y - 20).setDepth(o.depth + 1).setBlendMode(Phaser.BlendModes.ADD).setRotation(a).setAlpha(0.9)
        gl.fillStyle(win ? 0xfff6b0 : 0xcfcfd6, 0.9); gl.fillTriangle(0, -1.2, 16 + Math.random() * 8, 0, 0, 1.2)
        scene.tweens.add({ targets: gl, scaleX: 1.6, alpha: 0, duration: 300, ease: 'Quad.easeOut', onComplete: () => gl.destroy() })
      }
    })
    scene.time.delayedCall(o.durationMs, () => {
      if (cont.active) scene.tweens.add({ targets: cont, alpha: 0, y: y - 36, duration: 220, onComplete: () => cont.destroy() })
    })
    return cont
  },

  // ════════════════════════════════════════════════════════════════════════
  // ADVENTURER ABILITY VFX — one bespoke visual language per class. Built to the
  // anti-generic bar (custom shaded silhouettes + composed sub-elements + motion,
  // never a bare ring/burst). Lab-testable via RAW_VFX_GROUPS in VfxLab.js.
  // ════════════════════════════════════════════════════════════════════════

  // BARBARIAN · Reckless Charge — TELEGRAPH. The brute coils: grit kicked back
  // under braced feet + a low forward-lean dust skid + a hot rage ember swelling
  // at the shoulder. Reads "about to bull-rush" with NO ring. opts.dir = +1/-1.
  chargeWindupFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff5a2a, depth: 12, durationMs: 420, dir: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const dir = o.dir >= 0 ? 1 : -1
    if (mult > 0) {
      const g = scene.add.particles(x - 6 * dir, y + 9, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.85 }, speedX: { min: -80 * dir, max: -22 * dir }, speedY: { min: -34, max: -4 }, scale: { start: 0.28, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [0xb8a888, 0x7a6a4a, 0x4a3820], emitting: false })
      g.setDepth(o.depth - 0.5); g.explode(Math.round(11 * mult)); made.push(g); scene.time.delayedCall(life, () => { try { g.destroy() } catch (e) {} })
    }
    // shoulder rage ember — a hot core that swells then snaps (the coil release tell)
    const em = scene.add.circle(x + 4 * dir, y - 8, 4, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: small additive charge-ember core
    _glow(em, o.color, 4, 11); made.push(em)
    scene.tweens.add({ targets: em, alpha: 0.9, scale: 1.9, duration: life * 0.62, yoyo: true, ease: 'Sine.easeIn', onComplete: () => em.destroy() })
    // forward-lean dust skid building under his feet (asymmetric wedge, not a ring)
    const g2 = scene.add.graphics().setPosition(x, y + 10).setDepth(o.depth - 0.6).setScale(0.4, 1).setAlpha(0); made.push(g2)
    g2.fillStyle(0x6b5a3a, 0.36); g2.beginPath()
    g2.moveTo(-10 * dir, 2); g2.lineTo(17 * dir, -3); g2.lineTo(23 * dir, 2); g2.lineTo(15 * dir, 5); g2.closePath(); g2.fillPath()
    scene.tweens.add({ targets: g2, scaleX: 1.15, alpha: 0.5, duration: life * 0.52, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: g2, alpha: 0, duration: life * 0.4, onComplete: () => g2.destroy() }) })
    return made
  },

  // BARBARIAN · Reckless Charge — DASH + IMPACT. A bull-rush from (x1,y1)→(x2,y2):
  // tapered grit speed-streaks rake the path, a churning dust trail chases him, and
  // the landing detonates a FORWARD cracked-earth fan (asymmetric, opens in the
  // charge dir) + flung rock shards + a low dust pall. Not a ring anywhere.
  recklessChargeFx(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { color: 0xff5a2a, depth: 13, durationMs: 360, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
    const nx = -uy, ny = ux   // perpendicular
    // grit speed-streaks — tapered dirt slashes raking along the dash line
    for (let i = 0; i < 5; i++) {
      const off = (i - 2) * 5, sx = x1 + nx * off, sy = y1 + ny * off
      const ex = x2 + nx * off * 0.5, ey = y2 + ny * off * 0.5
      const g = scene.add.graphics().setDepth(o.depth).setAlpha(0); made.push(g)
      const w = 2.4 + Math.random() * 1.6, tone = [0xb8a888, 0x8a6a3a, 0xcfc0a0][i % 3]
      g.fillStyle(tone, 0.7); g.beginPath()
      g.moveTo(sx - nx * w, sy - ny * w); g.lineTo(sx + nx * w, sy + ny * w)
      g.lineTo(ex + nx * 0.4, ey + ny * 0.4); g.lineTo(ex - nx * 0.4, ey - ny * 0.4); g.closePath(); g.fillPath()
      scene.tweens.add({ targets: g, alpha: 0.75, duration: life * 0.22, delay: i * 12, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.4, onComplete: () => g.destroy() }) })
    }
    // churning dust trail along the path
    if (mult > 0) {
      const steps = 4
      for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1), px = x1 + dx * t, py = y1 + dy * t
        scene.time.delayedCall(life * 0.1 * i, () => {
          if (!_validXY(px, py)) return
          const d = scene.add.particles(px, py + 4, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.7 }, speedX: { min: -34, max: 34 }, speedY: { min: -26, max: 2 }, scale: { start: 0.26, end: 0 }, alpha: { start: 0.42, end: 0 }, tint: [0xb8a888, 0x7a6a4a], emitting: false })
          d.setDepth(o.depth - 0.6); d.explode(Math.round(5 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
        })
      }
    }
    // IMPACT — bright ram flash + forward cracked-earth fan + shards + dust pall
    const flash = scene.add.circle(x2, y2 - 4, 6, 0xffe2b0, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: additive ram-impact flash core
    _glow(flash, o.color, 5, 12); made.push(flash)
    scene.tweens.add({ targets: flash, scale: 2.6, alpha: 0, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => flash.destroy() })
    // forward cracked-earth fan (3 jagged fissures opening in the charge dir)
    const baseAng = Math.atan2(uy, ux)
    for (let c = 0; c < 3; c++) {
      const ca = baseAng + (c - 1) * 0.5, fl = 20 + Math.random() * 14
      const g = scene.add.graphics().setPosition(x2, y2 + 2).setDepth(o.depth - 0.3).setAlpha(0); made.push(g)
      g.lineStyle(2.6, 0x2a1d10, 0.9); g.beginPath(); g.moveTo(0, 0)
      let px = 0, py = 0, a = ca
      for (let s = 0; s < 3; s++) { a += (Math.random() - 0.5) * 0.7; const sl = fl / 3; px += Math.cos(a) * sl; py += Math.sin(a) * sl * 0.6; g.lineTo(px, py) }
      g.strokePath()
      g.lineStyle(1.4, 0xff6a2a, 0.6); g.strokePath()   // hot seam in the crack
      scene.tweens.add({ targets: g, alpha: 1, duration: life * 0.2, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 1.6, onComplete: () => g.destroy() }) })
    }
    for (let i = 0; i < 6; i++) {
      const a = baseAng + (Math.random() - 0.5) * 1.6, d = 16 + Math.random() * 22
      const g = scene.add.graphics().setPosition(x2, y2 - 2).setDepth(o.depth + 0.2); made.push(g)
      _drawRockShard(g, 2.4 + Math.random() * 1.8, 0x6b5a3a)
      scene.tweens.add({ targets: g, x: x2 + Math.cos(a) * d, y: y2 - 2 + Math.sin(a) * d - 8, angle: (Math.random() - 0.5) * 300, alpha: 0, duration: life * 1.1, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    if (mult > 0) {
      const pall = scene.add.particles(x2, y2 + 5, _softDotTexture(scene), { lifespan: { min: life * 0.5, max: life }, speedX: { min: -70, max: 70 }, speedY: { min: -22, max: 2 }, x: { min: -10, max: 10 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0xc4bca8, 0x8a8270, 0x5e5848], emitting: false })
      pall.setDepth(o.depth - 0.7); pall.explode(Math.round(16 * mult)); made.push(pall); scene.time.delayedCall(life * 2, () => { try { pall.destroy() } catch (e) {} })
    }
    return made
  },

  // BARBARIAN · per-minion KNOCKBACK — a quick "WHUMP": a 4-point impact star
  // punches in + a dirt puff + two spinning grit chips + a dazed wobble. Fired on
  // each minion the charge bowls through. Bespoke, on the unit (no ring).
  staggerHitFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffce6b, depth: 14, durationMs: 360, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // 4-point impact star (custom path), punches outward then fades
    const star = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(star)
    star.fillStyle(0xfff0c8, 0.95); star.beginPath()
    const sp = [[0, -9], [2.4, -2.4], [9, 0], [2.4, 2.4], [0, 9], [-2.4, 2.4], [-9, 0], [-2.4, -2.4]]
    sp.forEach((p, i) => { i === 0 ? star.moveTo(p[0], p[1]) : star.lineTo(p[0], p[1]) }); star.closePath(); star.fillPath()
    _glow(star, o.color, 3, 8)
    scene.tweens.add({ targets: star, scale: 1.25, alpha: 1, angle: 40, duration: life * 0.3, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: star, alpha: 0, scale: 1.6, duration: life * 0.5, onComplete: () => star.destroy() }) })
    if (mult > 0) {
      const d = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.7 }, speed: { min: 30, max: 90 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.55, end: 0 }, tint: [0xb8a888, 0x7a6a4a], emitting: false })
      d.setDepth(o.depth - 0.5); d.explode(Math.round(6 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
    }
    for (let i = 0; i < 2; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2, dist = 10 + Math.random() * 12
      const g = scene.add.graphics().setPosition(x, y - 4).setDepth(o.depth - 0.2); made.push(g)
      _drawRockShard(g, 1.8 + Math.random(), 0x6b5a3a)
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * dist, y: y - 4 + Math.sin(a) * dist + 8, angle: (Math.random() - 0.5) * 260, alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    return made
  },

  // BARD · Crescendo — the hymn SWELLS. Glowing musical notes (head + stem + flag)
  // lift off the bard on a warm rose-gold bloom; more + brighter notes per stack.
  // opts.stacks 1..4 scales count/brightness. The hero read is the rising notes.
  crescendoFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff8ad6, accent: 0xffe0a0, depth: 14, durationMs: 900, stacks: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const n = Math.min(4, Math.max(1, o.stacks))
    for (let i = 0; i < n; i++) {
      const sx = x + (i - (n - 1) / 2) * 9 + (Math.random() - 0.5) * 4
      const g = scene.add.graphics().setPosition(sx, y - 6).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.6); made.push(g)
      const col = i % 2 ? o.accent : o.color
      g.fillStyle(col, 0.95); g.fillEllipse(0, 0, 5.2, 3.6)        // note head
      g.fillRect(1.9, -8.4, 1.1, 8.4)                              // stem
      g.beginPath(); g.moveTo(3.0, -8.4); g.lineTo(6.0, -6.0); g.lineTo(3.0, -4.6); g.closePath(); g.fillPath()  // flag
      _glow(g, o.color, 2, 7)
      const sway = (Math.random() - 0.5) * 14
      scene.tweens.add({ targets: g, y: y - 42 - i * 6, x: sx + sway, alpha: 1, scale: 1, angle: sway, duration: life * 0.5, delay: i * 70, ease: 'Sine.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, y: g.y - 16, alpha: 0, duration: life * 0.45, onComplete: () => g.destroy() }) })
    }
    const bloom = scene.add.circle(x, y - 8, 5 + n * 1.5, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: additive sound-bloom glow, secondary to the rising notes
    _glow(bloom, o.accent, 3, 9); made.push(bloom)
    scene.tweens.add({ targets: bloom, alpha: 0.4 + n * 0.08, scale: 1.5, duration: life * 0.35, yoyo: true, ease: 'Sine.easeOut', onComplete: () => bloom.destroy() })
    return made
  },

  // BARD · Crescendo SHATTER — a solid hit breaks the song: a note CRACKS in two
  // along a jagged split + grey dissonance shards scatter. Cold grey, the inverse
  // of the warm swell.
  discordShatterFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9aa7b4, depth: 14, durationMs: 520, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    for (const side of [-1, 1]) {
      const g = scene.add.graphics().setPosition(x, y - 18).setDepth(o.depth).setAlpha(0.95); made.push(g)
      g.fillStyle(0xb9c2cc, 0.95); g.beginPath()
      g.moveTo(0, -4 * side); g.lineTo(side * 5, -5); g.lineTo(side * 6, 2); g.lineTo(side * 1.5, 5); g.lineTo(0, 1); g.closePath(); g.fillPath()
      g.fillRect(side * 2, -16, 1.6, 12)
      scene.tweens.add({ targets: g, x: x + side * (10 + Math.random() * 10), y: y - 6 + Math.random() * 8, angle: side * (60 + Math.random() * 60), alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    if (mult > 0) {
      const sh = scene.add.particles(x, y - 14, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.7 }, speed: { min: 40, max: 110 }, scale: { start: 0.16, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [0xb9c2cc, 0x7a828c, 0x555c66], emitting: false })
      sh.setDepth(o.depth - 0.4); sh.explode(Math.round(9 * mult)); made.push(sh); scene.time.delayedCall(life, () => { try { sh.destroy() } catch (e) {} })
    }
    return made
  },

  // BARD · Encore (death finale) — a last grand CHORD: golden-rose notes spiral
  // outward on a sound-bloom + radiant motes lift as the party is healed.
  encoreFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff66bb, accent: 0xffe0a0, depth: 15, durationMs: 1100, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const bloom = scene.add.circle(x, y - 10, 8, o.accent, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: additive finale-chord bloom, notes are the hero read
    _glow(bloom, o.color, 5, 14); made.push(bloom)
    scene.tweens.add({ targets: bloom, alpha: 0.6, scale: 3.4, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: bloom, alpha: 0, duration: life * 0.4, onComplete: () => bloom.destroy() }) })
    const N = 8
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, dist = 40 + Math.random() * 22
      const g = scene.add.graphics().setPosition(x, y - 10).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.5); made.push(g)
      const col = i % 2 ? o.accent : o.color
      g.fillStyle(col, 0.95); g.fillEllipse(0, 0, 5, 3.4); g.fillRect(1.8, -8, 1, 8); _glow(g, o.color, 2, 7)
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * dist, y: y - 10 + Math.sin(a) * dist * 0.7 - 6, alpha: 1, scale: 1, angle: (Math.random() - 0.5) * 90, duration: life * 0.5, delay: i * 18, ease: 'Sine.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, y: g.y - 12, duration: life * 0.4, onComplete: () => g.destroy() }) })
    }
    if (mult > 0) {
      const m = scene.add.particles(x, y - 6, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: -50, max: -16 }, speedX: { min: -30, max: 30 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [o.accent, o.color, 0xffffff], blendMode: 'ADD', emitting: false })
      m.setDepth(o.depth - 0.3); m.explode(Math.round(14 * mult)); made.push(m); scene.time.delayedCall(life, () => { try { m.destroy() } catch (e) {} })
    }
    return made
  },

  // MONK · Focus / Riposte STANCE — a swift martial READY: a crescent guard-sweep
  // (blade-of-hand arc) + a calm chi glow settling. opts.dir faces the threat.
  focusStanceFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xcfe9ff, depth: 13, durationMs: 520, dir: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const dir = o.dir >= 0 ? 1 : -1
    const g = scene.add.graphics().setPosition(x, y - 8).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.5, 1); made.push(g)
    g.lineStyle(3, o.color, 0.9); g.beginPath(); g.arc(0, 0, 16, -1.1 * dir, 1.1 * dir, dir < 0); g.strokePath()
    g.lineStyle(1.4, 0xffffff, 0.85); g.beginPath(); g.arc(0, 0, 16, -1.0 * dir, 1.0 * dir, dir < 0); g.strokePath()
    _glow(g, o.color, 3, 9)
    scene.tweens.add({ targets: g, scaleX: 1.1 * dir, alpha: 1, angle: 12 * dir, duration: life * 0.32, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.5, onComplete: () => g.destroy() }) })
    const chi = scene.add.circle(x, y - 6, 6, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: gentle additive chi-focus glow, the crescent sweep is the read
    _glow(chi, o.color, 2, 8); made.push(chi)
    scene.tweens.add({ targets: chi, alpha: 0.4, scale: 1.5, duration: life * 0.5, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => chi.destroy() })
    return made
  },

  // MONK · Riposte COUNTER — the dodge is an opening: a bright crescent PARRY arc
  // deflects the blow, then a tapered counter-slash snaps toward the attacker with
  // a chi-spark spray. opts.dir = toward attacker (+1/-1).
  riposteFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xcfe9ff, accent: 0xffffff, depth: 15, durationMs: 380, dir: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const dir = o.dir >= 0 ? 1 : -1
    const p = scene.add.graphics().setPosition(x, y - 8).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.95); made.push(p)
    p.lineStyle(3, o.color, 0.95); p.beginPath(); p.arc(0, 0, 14, -1.2 * dir, 0.5 * dir, dir < 0); p.strokePath(); _glow(p, o.color, 3, 8)
    scene.tweens.add({ targets: p, alpha: 0, scaleX: 1.3, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => p.destroy() })
    const sx = x + 6 * dir, ex = x + 30 * dir
    const s = scene.add.graphics().setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(s)
    s.fillStyle(o.accent, 0.95); s.beginPath(); s.moveTo(sx, y - 12); s.lineTo(ex, y - 7); s.lineTo(ex, y - 5); s.lineTo(sx, y - 4); s.closePath(); s.fillPath(); _glow(s, o.color, 3, 8)
    scene.tweens.add({ targets: s, alpha: 1, duration: life * 0.2, delay: life * 0.15, ease: 'Quad.easeOut', onComplete: () => scene.tweens.add({ targets: s, alpha: 0, duration: life * 0.4, onComplete: () => s.destroy() }) })
    if (mult > 0) {
      const sp = scene.add.particles(x + 16 * dir, y - 8, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.5 }, speedX: { min: 20 * dir, max: 120 * dir }, speedY: { min: -40, max: 40 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [0xffffff, o.color], blendMode: 'ADD', emitting: false })
      sp.setDepth(o.depth + 0.3); sp.explode(Math.round(7 * mult)); made.push(sp); scene.time.delayedCall(life, () => { try { sp.destroy() } catch (e) {} })
    }
    return made
  },

  // MONK · Stunning Palm — a focused concussive strike: a bright open-PALM force
  // print punches into the target + radial force lines, and dazed stars wheel
  // above its head (the STUN read). Bespoke, on the unit.
  stunningPalmFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe9a8, accent: 0xfff6d8, depth: 15, durationMs: 720, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const palm = scene.add.graphics().setPosition(x, y - 8).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(palm)
    // a clear OPEN HAND, palm-out: a rounded palm pad + 4 fanned tapered fingers + a thumb
    const hs = 13, col = o.accent
    palm.fillStyle(col, 0.92); palm.fillRoundedRect(-hs * 0.5, -hs * 0.12, hs, hs * 0.7, hs * 0.24)   // palm pad
    const fxs = [-0.36, -0.12, 0.12, 0.36], fls = [0.95, 1.12, 1.06, 0.85]
    for (let k = 0; k < 4; k++) { const bx = fxs[k] * hs, a = -Math.PI / 2 + fxs[k] * 0.6, len = hs * 0.55 * fls[k]
      palm.lineStyle(hs * 0.2, col, 0.92); palm.beginPath(); palm.moveTo(bx, -hs * 0.1); palm.lineTo(bx + Math.cos(a) * len, -hs * 0.1 + Math.sin(a) * len); palm.strokePath()
      palm.fillStyle(col, 0.92); palm.fillCircle(bx + Math.cos(a) * len, -hs * 0.1 + Math.sin(a) * len, hs * 0.1) }
    palm.lineStyle(hs * 0.22, col, 0.92); palm.beginPath(); palm.moveTo(-hs * 0.5, hs * 0.22); palm.lineTo(-hs * 0.8, -hs * 0.04); palm.strokePath()   // thumb
    palm.fillStyle(col, 0.92); palm.fillCircle(-hs * 0.8, -hs * 0.04, hs * 0.11)
    palm.fillStyle(0xffcf6b, 0.3); palm.fillEllipse(0, hs * 0.22, hs * 0.5, hs * 0.22)               // palm-crease shade
    _glow(palm, o.color, 4, 10)
    scene.tweens.add({ targets: palm, scale: 1.2, alpha: 1, duration: life * 0.18, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: palm, alpha: 0, scale: 1.5, duration: life * 0.3, onComplete: () => palm.destroy() }) })
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, g = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth - 0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9); made.push(g)
      g.lineStyle(2, o.color, 0.8); g.beginPath(); g.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); g.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); g.strokePath()
      scene.tweens.add({ targets: g, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: life * 0.35, ease: 'Quad.easeOut', onComplete: () => g.destroy() })
    }
    const ring = scene.add.container(x, y - 24).setDepth(o.depth + 0.5).setAlpha(0); made.push(ring)
    for (let i = 0; i < 3; i++) {
      const st = scene.add.graphics(), col = [0xffe9a8, 0xfff6d8, 0xffd36b][i]
      st.fillStyle(col, 0.95); st.beginPath()
      const pts = [[0, -3.5], [1, -1], [3.5, 0], [1, 1], [0, 3.5], [-1, 1], [-3.5, 0], [-1, -1]]
      pts.forEach((p, k) => k === 0 ? st.moveTo(p[0], p[1]) : st.lineTo(p[0], p[1])); st.closePath(); st.fillPath()
      const a0 = (i / 3) * Math.PI * 2; st.setPosition(Math.cos(a0) * 11, Math.sin(a0) * 4); ring.add(st)
    }
    scene.tweens.add({ targets: ring, alpha: 1, duration: life * 0.2 })
    scene.tweens.add({ targets: ring, angle: 360, duration: life * 1.4, ease: 'Linear' })
    scene.tweens.add({ targets: ring, alpha: 0, duration: life * 0.4, delay: life * 0.9, onComplete: () => ring.destroy() })
    return made
  },

  // MAGE · FIRE element — a small bonfire CLINGS to the struck minion: a cluster
  // of ANIMATED flickering flame tongues (the demon's flameLickFx — height darts,
  // body pinches, tip wavers) + a floor heat-glow + rising embers. Reuses the
  // demon's living-fire flame so it reads like real fire, not a static shape.
  emberBurnFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff6622, accent: 0xffd23f, depth: 14, durationMs: 700, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // bright IGNITE flash at the base — the moment it catches fire
    const ig = scene.add.circle(x, y + 2, 8, 0xffd23f, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 0.8)  // circle-ok: additive ignite flash core, the flames are the read
    _glow(ig, 0xff5511, 4, 12); made.push(ig)
    scene.tweens.add({ targets: ig, scale: 2.2, alpha: 0, duration: life * 0.35, ease: 'Quad.easeOut', onComplete: () => ig.destroy() })
    // breathing heat-glow pooled at the feet (irregular, additive — not a flat oval)
    const gv = 12, gn = Array.from({ length: gv }, () => 0.7 + Math.random() * 0.5)
    const glow = scene.add.graphics().setPosition(x, y + 6).setDepth(o.depth - 1).setBlendMode(Phaser.BlendModes.ADD).setScale(0.6).setAlpha(0); made.push(glow)
    glow.fillStyle(0xff5511, 0.22); glow.beginPath()
    for (let i = 0; i <= gv; i++) { const a = i / gv * Math.PI * 2, rr = 22 * gn[i % gv]; const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.5; if (i === 0) glow.moveTo(px, py); else glow.lineTo(px, py) }
    glow.closePath(); glow.fillPath()
    scene.tweens.add({ targets: glow, scale: 1.15, alpha: 0.6, duration: life * 0.3, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => glow.destroy() })
    // 5 big animated flickering flame tongues engulfing the body, centre tallest
    const flames = 5
    for (let i = 0; i < flames; i++) {
      const off = i - (flames - 1) / 2
      const fx2 = x + off * 6 + (Math.random() - 0.5) * 3, fy2 = y + 6
      const m = this.flameLickFx(scene, fx2, fy2, {
        depth: o.depth + 0.2 + i * 0.05,
        durationMs: o.durationMs * (0.75 + Math.random() * 0.4),
        h: 26 + Math.random() * 8 - Math.abs(off) * 3, w: 6 + Math.random() * 2.2,
        embers: false, slow: o.slow,
      })
      if (m) made.push(...m)
    }
    if (mult > 0) {
      const em = scene.add.particles(x, y - 4, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.95 }, speedY: { min: -72, max: -26 }, speedX: { min: -18, max: 18 }, x: { min: -10, max: 10 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [o.accent, o.color, 0xff3311], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 0.6); em.explode(Math.round(14 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // MAGE · ICE element — jagged ice crystals grow on the struck minion + frost
  // vapor curls off. Custom angular crystal shards, not a ring.
  frostChillFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x66ccff, accent: 0xeaffff, depth: 14, durationMs: 760, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const drawShard = (g, h, col) => {
      g.fillStyle(col, 0.85); g.beginPath(); g.moveTo(0, 0); g.lineTo(-h * 0.22, -h * 0.5); g.lineTo(0, -h); g.lineTo(h * 0.22, -h * 0.5); g.closePath(); g.fillPath()
      g.fillStyle(0xffffff, 0.55); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -h); g.lineTo(h * 0.1, -h * 0.5); g.closePath(); g.fillPath()
    }
    const slots = [[-6, 4, 0.9], [5, 5, 0.8], [0, 7, 1.1], [-3, -2, 0.7], [4, -1, 0.7]]
    slots.forEach(([dx, dy, sm], i) => {
      const g = scene.add.graphics().setPosition(x + dx, y + dy).setDepth(o.depth).setScale(0.2).setAlpha(0).setAngle((Math.random() - 0.5) * 40); made.push(g)
      drawShard(g, (10 + Math.random() * 5) * sm, i % 2 ? o.accent : o.color); _glow(g, o.color, 1, 5)
      scene.tweens.add({ targets: g, scale: sm, alpha: 0.9, duration: life * 0.25, delay: i * 30, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.5, delay: life * 0.15, onComplete: () => g.destroy() }) })
    })
    if (mult > 0) {
      const v = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.5, max: life }, speedY: { min: -22, max: -6 }, speedX: { min: -16, max: 16 }, scale: { start: 0.24, end: 0 }, alpha: { start: 0.4, end: 0 }, tint: [0xeaffff, 0x9fd8ff], emitting: false })
      v.setDepth(o.depth - 0.5); v.explode(Math.round(8 * mult)); made.push(v); scene.time.delayedCall(life, () => { try { v.destroy() } catch (e) {} })
    }
    return made
  },

  // MAGE · LIGHTNING element — a real jagged forking BOLT A→B: glow underlayer +
  // bright zigzag core + a fork branch + a strike spark. (Replaces beamFx for arcs.)
  arcBoltFx(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { color: 0xffff66, accent: 0xffffff, depth: 15, durationMs: 260, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const segs = 6, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
    const pts = []
    for (let i = 0; i <= segs; i++) { const t = i / segs, j = (i === 0 || i === segs) ? 0 : (Math.random() - 0.5) * 16; pts.push([x1 + dx * t + nx * j, y1 + dy * t + ny * j]) }
    const stroke = (g, w, col, al) => { g.lineStyle(w, col, al); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.strokePath() }
    const g = scene.add.graphics().setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); made.push(g)
    stroke(g, 5, o.color, 0.45); stroke(g, 2.2, o.accent, 0.95)
    const [bx, by] = pts[3]; let px = bx, py = by, a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.4
    g.lineStyle(1.8, o.accent, 0.85); g.beginPath(); g.moveTo(bx, by)
    for (let s = 0; s < 2; s++) { a += (Math.random() - 0.5) * 0.8; px += Math.cos(a) * 14; py += Math.sin(a) * 14; g.lineTo(px, py) }
    g.strokePath(); _glow(g, o.color, 4, 10)
    scene.tweens.add({ targets: g, alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    const fl = scene.add.circle(x2, y2, 4, o.accent, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 0.5)  // circle-ok: additive bolt-strike spark core
    _glow(fl, o.color, 3, 8); made.push(fl)
    scene.tweens.add({ targets: fl, scale: 2, alpha: 0, duration: life * 1.4, onComplete: () => fl.destroy() })
    return made
  },

  // MAGE · WIND element — a GREEN gale: curved green air-slash crescents sweep in
  // the push direction + real tumbling LEAVES caught in the gust + swept grit.
  // opts.dir = push dir (+1/-1).
  gustFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x88dd55, accent: 0xccff99, depth: 14, durationMs: 520, dir: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const dir = o.dir >= 0 ? 1 : -1
    // green air-slash crescents
    for (let i = 0; i < 3; i++) {
      const g = scene.add.graphics().setPosition(x, y - 8 + (i - 1) * 6).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.5 * dir, 0.7); made.push(g)
      g.lineStyle(2.4 - i * 0.4, o.color, 0.85); g.beginPath(); g.arc(0, 0, 12 + i * 4, -1.0, 1.0, false); g.strokePath(); _glow(g, o.color, 2, 6)
      scene.tweens.add({ targets: g, x: x + 26 * dir, alpha: 0.9, scaleX: 1.1 * dir, duration: life * 0.4, delay: i * 40, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, x: g.x + 14 * dir, duration: life * 0.4, onComplete: () => g.destroy() }) })
    }
    // tumbling LEAVES caught in the gust (recognizable, drift + spin in the push dir)
    const leafCols = [0x6abf3a, 0x88dd55, 0xb8e08a, 0xd8c468]
    for (let i = 0; i < 4; i++) {
      const ly = y - 12 + (Math.random() - 0.5) * 16
      const g = scene.add.graphics().setPosition(x - dir * 6 + (Math.random() - 0.5) * 6, ly).setDepth(o.depth + 0.2).setScale(0.7 + Math.random() * 0.4).setAngle(Math.random() * 360); made.push(g)
      _drawLeaf(g, 3.2 + Math.random() * 1.6, leafCols[i % leafCols.length])
      scene.tweens.add({ targets: g, x: x + dir * (44 + Math.random() * 40), y: ly + (Math.random() - 0.5) * 22, angle: g.angle + (180 + Math.random() * 360) * dir, alpha: 0, duration: life * (0.8 + Math.random() * 0.3), ease: 'Quad.easeOut', onComplete: () => g.destroy() })
    }
    if (mult > 0) {
      const d = scene.add.particles(x, y - 4, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.9 }, speedX: { min: 40 * dir, max: 160 * dir }, speedY: { min: -30, max: 30 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.55, end: 0 }, tint: [0xccff99, 0x88dd55, 0x6abf3a], emitting: false })
      d.setDepth(o.depth - 0.3); d.explode(Math.round(9 * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
    }
    return made
  },

  // MAGE · Arcane Burst CHARGE — the queued empowerment: element-tinted rune
  // glyphs spiral INWARD to a gathering core (the next hit is loaded).
  arcaneChargeFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xcc99ff, accent: 0xffffff, depth: 14, durationMs: 600, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const N = 7
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, r0 = 30 + Math.random() * 10
      const g = scene.add.graphics().setPosition(x + Math.cos(a) * r0, y - 8 + Math.sin(a) * r0).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(g)
      g.lineStyle(2, i % 2 ? o.accent : o.color, 0.9); g.beginPath(); g.moveTo(-3, -3); g.lineTo(3, -3); g.lineTo(0, 3); g.closePath(); g.strokePath(); _glow(g, o.color, 2, 6)
      scene.tweens.add({ targets: g, x, y: y - 8, alpha: 1, angle: 180, duration: life * 0.55, delay: i * 20, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    const core = scene.add.circle(x, y - 8, 4, o.accent, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 0.5)  // circle-ok: additive spell-charge core, glyphs are the read
    _glow(core, o.color, 4, 11); made.push(core)
    scene.tweens.add({ targets: core, alpha: 0.85, scale: 2, duration: life * 0.6, ease: 'Quad.easeIn', onComplete: () => scene.tweens.add({ targets: core, alpha: 0, scale: 0.5, duration: life * 0.3, onComplete: () => core.destroy() }) })
    return made
  },

  // MAGE · Arcane Burst DETONATION — element-tinted: bright core + angular rune
  // glints flung outward (bespoke shrapnel, not round) + element shock motes.
  arcaneBurstFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xcc99ff, accent: 0xffffff, depth: 15, durationMs: 520, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const core = scene.add.circle(x, y, 7, o.accent, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: additive arcane-detonation flash core
    _glow(core, o.color, 5, 13); made.push(core)
    scene.tweens.add({ targets: core, scale: 3, alpha: 0, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => core.destroy() })
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.3, d = 28 + Math.random() * 18
      const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); made.push(g)
      g.lineStyle(2, i % 2 ? o.accent : o.color, 0.9); g.beginPath(); g.moveTo(-3, 0); g.lineTo(3, 0); g.moveTo(0, -3); g.lineTo(0, 3); g.strokePath()
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, angle: 180, alpha: 0, scale: 0.4, duration: life, ease: 'Quad.easeOut', onComplete: () => g.destroy() })
    }
    if (mult > 0) {
      const p = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.7 }, speed: { min: 50, max: 150 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [o.accent, o.color], blendMode: 'ADD', emitting: false })
      p.setDepth(o.depth - 0.3); p.explode(Math.round(14 * mult)); made.push(p); scene.time.delayedCall(life, () => { try { p.destroy() } catch (e) {} })
    }
    return made
  },

  // CLERIC · Heal — a holy CROSS glints in and descends onto the ally + a warm
  // restoring bloom + gentle light motes raining down. Soft, not a ring.
  healLightFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xfff4a8, accent: 0xffffff, depth: 15, durationMs: 620, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const cross = scene.add.graphics().setPosition(x, y - 30).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.5); made.push(cross)
    cross.fillStyle(o.accent, 0.9); cross.fillRect(-1.6, -8, 3.2, 16); cross.fillRect(-6, -3.2, 12, 3.2); _glow(cross, o.color, 3, 9)
    scene.tweens.add({ targets: cross, y: y - 12, alpha: 1, scale: 1, duration: life * 0.45, ease: 'Sine.easeIn',
      onComplete: () => scene.tweens.add({ targets: cross, alpha: 0, scale: 1.4, duration: life * 0.4, onComplete: () => cross.destroy() }) })
    const bloom = scene.add.circle(x, y - 6, 8, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: additive holy restore glow, the cross + motes are the read
    _glow(bloom, o.accent, 3, 10); made.push(bloom)
    scene.tweens.add({ targets: bloom, alpha: 0.5, scale: 1.8, duration: life * 0.4, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => bloom.destroy() })
    if (mult > 0) {
      const m = scene.add.particles(x, y - 30, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: 20, max: 55 }, speedX: { min: -16, max: 16 }, x: { min: -10, max: 10 }, scale: { start: 0.18, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [o.accent, o.color], blendMode: 'ADD', emitting: false })
      m.setDepth(o.depth - 0.3); m.explode(Math.round(9 * mult)); made.push(m); scene.time.delayedCall(life, () => { try { m.destroy() } catch (e) {} })
    }
    return made
  },

  // CLERIC · Resurrection — a radiant COLUMN of light rises from the fallen + a
  // ground gather-halo + ascending feathers & motes lift the soul. Grand raise.
  resurrectionFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xfff4a8, accent: 0xffffff, depth: 16, durationMs: 1100, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const col = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.5, 0.4); made.push(col)
    col.fillStyle(o.color, 0.45); col.beginPath(); col.moveTo(-14, 4); col.lineTo(-7, -64); col.lineTo(7, -64); col.lineTo(14, 4); col.closePath(); col.fillPath()
    col.fillStyle(o.accent, 0.6); col.beginPath(); col.moveTo(-6, 4); col.lineTo(-3, -64); col.lineTo(3, -64); col.lineTo(6, 4); col.closePath(); col.fillPath(); _glow(col, o.color, 5, 16)
    scene.tweens.add({ targets: col, scaleX: 1, scaleY: 1, alpha: 1, duration: life * 0.4, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: col, alpha: 0, scaleX: 1.4, duration: life * 0.5, onComplete: () => col.destroy() }) })
    const halo = scene.add.circle(x, y + 4, 14, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: additive ground-light gather, the column + feathers are the read
    _glow(halo, o.accent, 4, 12); made.push(halo)
    scene.tweens.add({ targets: halo, alpha: 0.55, scaleX: 1.6, scaleY: 0.7, duration: life * 0.5, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => halo.destroy() })
    if (mult > 0) {
      const m = scene.add.particles(x, y + 2, _softDotTexture(scene), { lifespan: { min: life * 0.5, max: life }, speedY: { min: -90, max: -40 }, speedX: { min: -18, max: 18 }, x: { min: -10, max: 10 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [o.accent, o.color, 0xffe9b0], blendMode: 'ADD', emitting: false })
      m.setDepth(o.depth + 0.3); m.explode(Math.round(18 * mult)); made.push(m); scene.time.delayedCall(life, () => { try { m.destroy() } catch (e) {} })
    }
    for (let i = 0; i < 4; i++) {
      const fx2 = x + (Math.random() - 0.5) * 18
      const g = scene.add.graphics().setPosition(fx2, y).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9); made.push(g)
      g.fillStyle(0xfff8e0, 0.9); g.beginPath(); g.moveTo(0, 0); g.lineTo(2, -7); g.lineTo(0, -12); g.lineTo(-2, -7); g.closePath(); g.fillPath()
      scene.tweens.add({ targets: g, y: y - 50 - Math.random() * 20, x: fx2 + (Math.random() - 0.5) * 20, angle: (Math.random() - 0.5) * 120, alpha: 0, duration: life, ease: 'Sine.easeOut', onComplete: () => g.destroy() })
    }
    return made
  },

  // NECROMANCER · Summon Undead — skeletal CLAW-HANDS burst up out of a sickly
  // green soul-pool + grave dirt kicks. The dead claw their way up to serve.
  necroSummonFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x66dd55, accent: 0xccff99, depth: 14, durationMs: 820, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const pv = 10, pn = Array.from({ length: pv }, () => 0.7 + Math.random() * 0.5)
    const pool = scene.add.graphics().setPosition(x, y + 6).setDepth(o.depth - 0.6).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(pool)
    pool.fillStyle(o.color, 0.4); pool.beginPath()
    for (let i = 0; i <= pv; i++) { const a = i / pv * Math.PI * 2, r = 16 * pn[i % pv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.5; if (i === 0) pool.moveTo(px, py); else pool.lineTo(px, py) }
    pool.closePath(); pool.fillPath(); _glow(pool, o.color, 3, 10)
    scene.tweens.add({ targets: pool, alpha: 0.5, scaleX: 1.4, scaleY: 1, duration: life * 0.4, yoyo: true, ease: 'Sine.easeOut', onComplete: () => pool.destroy() })
    // a clawing SKELETAL HAND: bony palm + 4 fingers of 2 phalanges each (knuckle
    // joints), curling inward like a claw, + a thumb. Rises out of the ground.
    const drawHand = (g, s) => {
      const bone = 0xe8e2d0, joint = 0xc8c0a8
      g.fillStyle(bone, 0.96); g.fillEllipse(0, s * 0.18, s * 0.52, s * 0.34)   // bony palm/wrist
      const fingers = [-0.52, -0.18, 0.18, 0.52]
      for (const fa of fingers) {
        const bx = fa * s * 0.42, a1 = -Math.PI / 2 + fa * 0.55
        const j1x = bx + Math.cos(a1) * s * 0.46, j1y = s * 0.05 + Math.sin(a1) * s * 0.46
        g.lineStyle(s * 0.14, bone, 1); g.beginPath(); g.moveTo(bx, s * 0.05); g.lineTo(j1x, j1y); g.strokePath()
        g.fillStyle(joint, 1); g.fillCircle(j1x, j1y, s * 0.1)                  // knuckle
        const a2 = a1 + 0.6, tx = j1x + Math.cos(a2) * s * 0.32, tyy = j1y + Math.sin(a2) * s * 0.32
        g.lineStyle(s * 0.11, bone, 1); g.beginPath(); g.moveTo(j1x, j1y); g.lineTo(tx, tyy); g.strokePath()
        g.fillStyle(bone, 1); g.fillCircle(tx, tyy, s * 0.06)                   // clawed tip
      }
      // thumb (off to one side, also clawed)
      const ta = -Math.PI / 2 + 1.1, tj = { x: -s * 0.34 + Math.cos(ta) * s * 0.36, y: s * 0.1 + Math.sin(ta) * s * 0.36 }
      g.lineStyle(s * 0.14, bone, 1); g.beginPath(); g.moveTo(-s * 0.34, s * 0.12); g.lineTo(tj.x, tj.y); g.strokePath()
      g.fillStyle(joint, 1); g.fillCircle(tj.x, tj.y, s * 0.09)
    }
    const hands = 2 + Math.round(Math.random())
    for (let i = 0; i < hands; i++) {
      const hx = x + (i - (hands - 1) / 2) * 13 + (Math.random() - 0.5) * 6
      const g = scene.add.graphics().setPosition(hx, y + 12).setDepth(o.depth + i * 0.1).setScale(0.8).setAlpha(0).setAngle((Math.random() - 0.5) * 24); made.push(g)
      drawHand(g, 14 + Math.random() * 3)
      scene.tweens.add({ targets: g, y: y - 4, alpha: 1, duration: life * 0.32, delay: i * 80, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, y: g.y - 6, alpha: 0, duration: life * 0.45, delay: life * 0.12, onComplete: () => g.destroy() }) })
    }
    if (mult > 0) {
      const m = scene.add.particles(x, y + 6, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.7 }, speedY: { min: -70, max: -20 }, speedX: { min: -40, max: 40 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [0x4a3820, 0x66dd55, 0x335522], emitting: false })
      m.setDepth(o.depth - 0.4); m.explode(Math.round(12 * mult)); made.push(m); scene.time.delayedCall(life, () => { try { m.destroy() } catch (e) {} })
    }
    return made
  },

  // NECROMANCER · Bone Armor — a RIBCAGE assembles around the torso: a central
  // spine bone (with vertebra knobs) + curved rib bones (filled, tapered, knobby
  // ends) swing in from the sides and clamp on. Reads as real bone, not arc-rings.
  boneArmorFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xe8e2d0, shade: 0xb8ad95, depth: 14, durationMs: 950, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const cy = y - 16   // sit the ribcage up on the chest, not the waist
    // one curved rib bone (filled tapered band around radius R, arc a0→a1) + outer knob
    const drawRib = (g, R, a0, a1, hw) => {
      const n = 7; g.fillStyle(o.color, 1); g.beginPath()
      for (let i = 0; i <= n; i++) { const t = i / n, a = a0 + (a1 - a0) * t, w = hw * (1 - 0.35 * t), r = R + w; const px = Math.cos(a) * r, py = Math.sin(a) * r; i === 0 ? g.moveTo(px, py) : g.lineTo(px, py) }
      for (let i = n; i >= 0; i--) { const t = i / n, a = a0 + (a1 - a0) * t, w = hw * (1 - 0.35 * t), r = R - w; g.lineTo(Math.cos(a) * r, Math.sin(a) * r) }
      g.closePath(); g.fillPath()
      g.fillStyle(o.shade, 0.7); g.fillCircle(Math.cos(a1) * R, Math.sin(a1) * R, hw * 0.9)   // outer knob
      g.fillStyle(o.color, 1); g.fillCircle(Math.cos(a0) * R, Math.sin(a0) * R, hw * 0.7)      // inner attach
    }
    // central SPINE bone (drawn local, vertical) + 3 vertebra knobs
    const spine = scene.add.graphics().setPosition(x, cy).setDepth(o.depth + 0.2).setScale(0.5, 0.3).setAlpha(0); made.push(spine)
    spine.fillStyle(o.color, 1); spine.fillRoundedRect(-2, -15, 4, 30, 2)
    spine.fillStyle(o.shade, 0.8); for (let k = -2; k <= 2; k++) spine.fillCircle(0, k * 6, 3.2)
    scene.tweens.add({ targets: spine, scaleX: 1, scaleY: 1, alpha: 1, duration: life * 0.22, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: spine, alpha: 0, duration: life * 0.4, delay: life * 0.3, onComplete: () => spine.destroy() }) })
    // ribs: 3 per side, curving forward around the torso, flying in from out wide
    const ribs = [[-1, -8], [-1, 0], [-1, 8], [1, -8], [1, 0], [1, 8]]
    ribs.forEach(([sideSign, ry], i) => {
      const g = scene.add.graphics().setDepth(o.depth).setAlpha(0); made.push(g)
      // local rib arc: from spine (near 0/PI) sweeping down-and-out
      const base = sideSign < 0 ? Math.PI : 0
      const a0 = base, a1 = base + sideSign * 0.95
      drawRib(g, 11, a0, a1, 2.4)
      g.setPosition(x + sideSign * (34 + Math.random() * 14), cy + ry * 0.4)
      scene.tweens.add({ targets: g, x: x, y: cy + ry, alpha: 1, duration: life * 0.3, delay: 120 + i * 40, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.4, delay: life * 0.22, onComplete: () => g.destroy() }) })
    })
    const fl = scene.add.circle(x, cy, 7, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.4)  // circle-ok: additive armour-set flash, the ribcage is the read
    _glow(fl, 0xfff4d8, 3, 10); made.push(fl)
    scene.tweens.add({ targets: fl, alpha: 0.45, scale: 2, duration: life * 0.4, delay: life * 0.4, yoyo: true, ease: 'Sine.easeOut', onComplete: () => fl.destroy() })
    return made
  },

  // RANGER · Piercing Shot — a real ARROW flies the line (shaft + head + fletching)
  // along a bright afterimage trail. Reads as a true directional pierce, not a beam.
  piercingArrowFx(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { color: 0xaaffaa, accent: 0xeafff0, depth: 15, durationMs: 280, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const ang = Math.atan2(y2 - y1, x2 - x1)
    const trail = scene.add.graphics().setDepth(o.depth - 0.3).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.85); made.push(trail)
    trail.lineStyle(2.4, o.color, 0.45); trail.beginPath(); trail.moveTo(x1, y1); trail.lineTo(x2, y2); trail.strokePath()
    trail.lineStyle(0.8, o.accent, 0.9); trail.beginPath(); trail.moveTo(x1, y1); trail.lineTo(x2, y2); trail.strokePath(); _glow(trail, o.color, 2, 6)
    scene.tweens.add({ targets: trail, alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => trail.destroy() })
    const arrow = scene.add.graphics().setPosition(x1, y1).setDepth(o.depth).setRotation(ang); made.push(arrow)
    arrow.fillStyle(0xcfc0a0, 1); arrow.fillRect(-9, -0.9, 16, 1.8)
    arrow.fillStyle(0xe8e2d0, 1); arrow.beginPath(); arrow.moveTo(7, 0); arrow.lineTo(2, -3); arrow.lineTo(2, 3); arrow.closePath(); arrow.fillPath()
    arrow.fillStyle(0xaaccaa, 1); arrow.beginPath(); arrow.moveTo(-9, 0); arrow.lineTo(-12, -3); arrow.lineTo(-7, 0); arrow.lineTo(-12, 3); arrow.closePath(); arrow.fillPath()
    scene.tweens.add({ targets: arrow, x: x2, y: y2, duration: life * 0.8, ease: 'Quad.easeIn',
      onComplete: () => scene.tweens.add({ targets: arrow, alpha: 0, duration: life * 0.2, onComplete: () => arrow.destroy() }) })
    return made
  },

  // RANGER · Trap Expert — a pair of WIRECUTTERS (pivot + jaws + handles) works the
  // trap and the jaws SNAP SHUT to snip it + a clean green spark (success), or the
  // jaws slip with a red sputter (opts.fail). A recognizable tool, not crossed lines.
  disarmFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const fail = !!opts.fail
    const o = { color: fail ? 0xff6644 : 0xaaffaa, accent: fail ? 0xffaa66 : 0xeafff0, depth: 15, durationMs: 480, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const metal = 0xcfd6e0, handle = 0x6a5a3a
    const cut = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setScale(0.5).setAlpha(0).setAngle(fail ? -20 : 0); made.push(cut)
    const draw = (jaw) => {
      cut.clear()
      cut.lineStyle(2.6, handle, 1); cut.beginPath(); cut.moveTo(0, 0); cut.lineTo(-5, 11); cut.moveTo(0, 0); cut.lineTo(5, 11); cut.strokePath()   // handles
      cut.lineStyle(2.2, metal, 1); cut.beginPath(); cut.moveTo(0, 0); cut.lineTo(-Math.sin(jaw) * 9, -Math.cos(jaw) * 9); cut.moveTo(0, 0); cut.lineTo(Math.sin(jaw) * 9, -Math.cos(jaw) * 9); cut.strokePath()  // jaws
      cut.fillStyle(0xe8eef6, 1); cut.fillCircle(0, 0, 2.1)   // pivot rivet
    }
    draw(0.55)
    scene.tweens.add({ targets: cut, alpha: 1, scale: 1, duration: life * 0.2, ease: 'Back.easeOut' })
    const tw = { v: 0.55 }
    scene.tweens.add({ targets: tw, v: fail ? 0.5 : 0.08, duration: life * 0.22, delay: life * 0.2, ease: 'Quad.easeIn', onUpdate: () => { if (cut.active) draw(tw.v) },
      onComplete: () => scene.tweens.add({ targets: cut, alpha: 0, angle: cut.angle + (fail ? 44 : 0), duration: life * 0.4, onComplete: () => cut.destroy() }) })
    if (mult > 0) scene.time.delayedCall(life * 0.42, () => {
      if (!_validXY(x, y)) return
      const sp = scene.add.particles(x, y - 8, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.5 }, speed: { min: fail ? 60 : 30, max: fail ? 140 : 80 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: fail ? [0xff6644, 0xffaa44] : [o.accent, o.color], blendMode: 'ADD', emitting: false })
      sp.setDepth(o.depth + 0.3); sp.explode(Math.round((fail ? 8 : 5) * mult)); scene.time.delayedCall(life, () => { try { sp.destroy() } catch (e) {} })
    })
    return made
  },

  // BEAST MASTER · Tame Beast — a calming BOND: a soft heart rises over the beast +
  // a pink calm glow + settling motes (success); a grey "broke free" puff (opts.fail).
  tameFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const fail = !!opts.fail
    const o = { color: 0xff99cc, accent: 0xffd6e8, depth: 15, durationMs: 640, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    if (fail) {
      if (mult > 0) { const p = scene.add.particles(x, y - 6, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speed: { min: 30, max: 80 }, scale: { start: 0.16, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0x999999, 0x666666], emitting: false }); p.setDepth(o.depth); p.explode(Math.round(7 * mult)); made.push(p); scene.time.delayedCall(life, () => { try { p.destroy() } catch (e) {} }) }
      return made
    }
    const heart = scene.add.graphics().setPosition(x, y - 10).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(heart)
    heart.fillStyle(o.color, 0.9); heart.fillCircle(-2.6, -2, 3); heart.fillCircle(2.6, -2, 3); heart.fillTriangle(-5.2, -1, 5.2, -1, 0, 6); _glow(heart, o.color, 2, 8)
    scene.tweens.add({ targets: heart, y: y - 30, scale: 1, alpha: 1, duration: life * 0.45, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: heart, alpha: 0, y: heart.y - 10, duration: life * 0.4, onComplete: () => heart.destroy() }) })
    const glow = scene.add.circle(x, y - 6, 7, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: additive calming-bond glow, the heart is the read
    _glow(glow, o.accent, 2, 9); made.push(glow)
    scene.tweens.add({ targets: glow, alpha: 0.45, scale: 1.6, duration: life * 0.5, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => glow.destroy() })
    if (mult > 0) { const p = scene.add.particles(x, y - 4, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: -30, max: -8 }, speedX: { min: -16, max: 16 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [o.accent, o.color], blendMode: 'ADD', emitting: false }); p.setDepth(o.depth - 0.3); p.explode(Math.round(7 * mult)); made.push(p); scene.time.delayedCall(life, () => { try { p.destroy() } catch (e) {} }) }
    return made
  },

  // BEAST MASTER · Sic 'Em — the beast POUNCES: a curved leap-trail arcs from the
  // beast to the prey, then 3 claw gashes rake across it on landing + fur/dust.
  pounceFx(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { color: 0xff9944, accent: 0xffd0a0, depth: 15, durationMs: 440, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const ang = Math.atan2(y2 - y1, x2 - x1)
    const arc = scene.add.graphics().setDepth(o.depth - 0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9); made.push(arc)
    const N = 10, pts = []
    for (let i = 0; i <= N; i++) { const t = i / N; pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * 30]) }
    arc.lineStyle(3, o.color, 0.65); arc.beginPath(); arc.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) arc.lineTo(pts[i][0], pts[i][1]); arc.strokePath()
    arc.lineStyle(1.2, o.accent, 0.9); arc.beginPath(); arc.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) arc.lineTo(pts[i][0], pts[i][1]); arc.strokePath(); _glow(arc, o.color, 3, 8)
    scene.tweens.add({ targets: arc, alpha: 0, duration: life * 0.6, ease: 'Quad.easeIn', onComplete: () => arc.destroy() })
    scene.time.delayedCall(life * 0.42, () => {
      if (!_validXY(x2, y2)) return
      const g = scene.add.graphics().setPosition(x2, y2 - 4).setDepth(o.depth + 0.3).setRotation(ang + Math.PI / 2)
      _drawClawGashes(g, 16)
      scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.6, delay: life * 0.2, onComplete: () => g.destroy() })
      if (mult > 0) { const p = scene.add.particles(x2, y2, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.5 }, speed: { min: 40, max: 110 }, scale: { start: 0.16, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [0xff9944, 0xcc6622, 0xcfc0a0], emitting: false }); p.setDepth(o.depth); p.explode(Math.round(8 * mult)); scene.time.delayedCall(life, () => { try { p.destroy() } catch (e) {} }) }
    })
    return made
  },

  // BEAST MASTER · Pack Tactics — a brief flank GLINT: two crossed fang-shards snap
  // on the target when the BM + beast flank it (throttled at the call site).
  packFlankFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffcc66, accent: 0xfff0c0, depth: 15, durationMs: 300, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const g = scene.add.graphics().setPosition(x, y - 8).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(g)
    g.fillStyle(o.accent, 0.95)
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 6, -5); g.lineTo(s * 3, 0); g.lineTo(s * 7, 5); g.lineTo(s * 8, -3); g.closePath(); g.fillPath() }
    _glow(g, o.color, 2, 7)
    scene.tweens.add({ targets: g, scale: 1, alpha: 1, duration: life * 0.3, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scale: 1.3, duration: life * 0.5, onComplete: () => g.destroy() }) })
    return made
  },

  // KNIGHT · Bulwark — a directional SHIELD-WALL: a translucent layered shield
  // barrier with a heraldic cross emblem snaps up on the threat side + steel motes.
  // opts.dir faces the threat. (The raise tell; the buff itself lasts longer.)
  bulwarkWallFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9fc8ff, accent: 0xeaf4ff, depth: 13, durationMs: 1100, dir: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const dir = o.dir >= 0 ? 1 : -1, px = x + 16 * dir
    const wall = scene.add.graphics().setPosition(px, y - 8).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.7).setAlpha(0); made.push(wall)
    const drawShield = (g, w, h, col, al) => { g.fillStyle(col, al); g.beginPath(); g.moveTo(0, -h); g.lineTo(w, -h * 0.6); g.lineTo(w * 0.8, h * 0.4); g.lineTo(0, h); g.lineTo(-w * 0.8, h * 0.4); g.lineTo(-w, -h * 0.6); g.closePath(); g.fillPath() }
    drawShield(wall, 11, 22, o.color, 0.32); drawShield(wall, 7, 16, o.accent, 0.4)
    wall.fillStyle(o.accent, 0.7); wall.fillRect(-1.4, -12, 2.8, 22); wall.fillRect(-6, -4, 12, 2.6); _glow(wall, o.color, 3, 10)
    scene.tweens.add({ targets: wall, scaleX: 1, scaleY: 1, alpha: 1, duration: life * 0.18, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: wall, alpha: 0.55, duration: life * 0.5, yoyo: true, ease: 'Sine.easeInOut',
        onComplete: () => scene.tweens.add({ targets: wall, alpha: 0, duration: life * 0.3, onComplete: () => wall.destroy() }) }) })
    if (mult > 0) {
      const sp = scene.add.particles(px, y - 8, _softDotTexture(scene), { lifespan: { min: life * 0.2, max: life * 0.4 }, speedX: { min: -20, max: 20 }, speedY: { min: -30, max: 10 }, scale: { start: 0.16, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [o.accent, o.color], blendMode: 'ADD', emitting: false })
      sp.setDepth(o.depth + 0.3); sp.explode(Math.round(8 * mult)); made.push(sp); scene.time.delayedCall(life, () => { try { sp.destroy() } catch (e) {} })
    }
    return made
  },

  // KNIGHT · Taunt — a defiant SHOUT: broken shout-arc bands radiate (a roar, not a
  // clean ring) + aggro-pull chevrons yank inward toward the knight.
  tauntFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff6644, accent: 0xffcc88, depth: 14, durationMs: 620, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    for (let i = 0; i < 3; i++) {
      const g = scene.add.graphics().setPosition(x, y - 8).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9).setScale(0.4); made.push(g)
      const r = 14 + i * 6
      g.lineStyle(3 - i * 0.6, i ? o.accent : o.color, 0.85)
      g.beginPath(); g.arc(0, 0, r, -2.3, -0.85, false); g.strokePath()
      g.beginPath(); g.arc(0, 0, r, 0.85, 2.3, false); g.strokePath(); _glow(g, o.color, 2, 7)
      scene.tweens.add({ targets: g, scale: 1 + i * 0.25, alpha: 0, duration: life * 0.5 + i * 60, ease: 'Quad.easeOut', onComplete: () => g.destroy() })
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, r0 = 40
      const g = scene.add.graphics().setPosition(x + Math.cos(a) * r0, y - 8 + Math.sin(a) * r0).setDepth(o.depth - 0.2).setBlendMode(Phaser.BlendModes.ADD).setRotation(a + Math.PI).setAlpha(0.9); made.push(g)
      g.fillStyle(o.accent, 0.85); g.beginPath(); g.moveTo(4, 0); g.lineTo(-3, -3); g.lineTo(-1, 0); g.lineTo(-3, 3); g.closePath(); g.fillPath()
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * 12, y: y - 8 + Math.sin(a) * 12, alpha: 0, duration: life * 0.5, delay: i * 15, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    return made
  },

  // PEASANT · Strength in Numbers — an angry MOB brandishes raised PITCHFORKS and
  // lit TORCHES thrust up around the peasant + torchlight glow + a dust surge + an
  // angry "!" shout. opts.count scales how many tools go up.
  mobFervorFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xe8b06a, accent: 0xffd98a, depth: 14, durationMs: 720, count: 3, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const n = Math.min(5, Math.max(2, o.count))
    for (let i = 0; i < n; i++) {
      const ox = (i - (n - 1) / 2) * 10 + (Math.random() - 0.5) * 3, torch = i % 2 === 1
      const g = scene.add.graphics().setPosition(x + ox, y + 6).setDepth(o.depth + (torch ? 0.2 : 0)).setScale(1, 0.2).setAlpha(0); made.push(g)
      g.fillStyle(0x6b4f2a, 1); g.fillRect(-1.3, -18, 2.6, 18)                                  // wooden pole
      if (torch) {
        g.fillStyle(0x3a2a18, 1); g.fillRect(-2.4, -22, 4.8, 5)                                 // wrapped head
        g.fillStyle(0xff8a33, 0.95); g.beginPath(); g.moveTo(0, -31); g.lineTo(3, -22); g.lineTo(0, -20); g.lineTo(-3, -22); g.closePath(); g.fillPath()
        g.fillStyle(0xffe066, 0.95); g.beginPath(); g.moveTo(0, -28); g.lineTo(1.5, -22); g.lineTo(-1.5, -22); g.closePath(); g.fillPath()  // hot core
      } else {
        g.fillStyle(0xb8b0a0, 1); for (const txx of [-3, 0, 3]) g.fillRect(txx - 0.7, -27, 1.4, 9)  // 3 tines
        g.fillStyle(0x8a8270, 1); g.fillRect(-4, -19, 8, 2)                                     // crossbar
      }
      scene.tweens.add({ targets: g, scaleY: 1, alpha: 1, y: y - 2, duration: life * 0.25, delay: i * 35, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, y: g.y - 5, duration: life * 0.45, onComplete: () => g.destroy() }) })
    }
    const glow = scene.add.circle(x, y - 8, 6, 0xffaa44, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: warm torchlight glow, the raised tools are the read
    _glow(glow, 0xffd98a, 2, 9); made.push(glow)
    scene.tweens.add({ targets: glow, alpha: 0.4, scale: 1.7, duration: life * 0.4, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => glow.destroy() })
    if (mult > 0) {
      const d = scene.add.particles(x, y + 8, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedX: { min: -60, max: 60 }, speedY: { min: -22, max: 2 }, scale: { start: 0.26, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0xb8a888, 0x9a7a48, 0x6b5a3a], emitting: false })
      d.setDepth(o.depth - 0.6); d.explode(Math.round((6 + n) * mult)); made.push(d); scene.time.delayedCall(life, () => { try { d.destroy() } catch (e) {} })
    }
    const sh = scene.add.graphics().setPosition(x + (Math.random() - 0.5) * 16, y - 26).setDepth(o.depth + 0.5).setScale(0.4).setAlpha(0); made.push(sh)
    sh.fillStyle(0xffd98a, 0.95); sh.fillRect(-1.4, -7, 2.8, 9); sh.fillCircle(0, 4, 1.6)         // angry "!"
    scene.tweens.add({ targets: sh, scale: 1, alpha: 1, y: sh.y - 6, duration: life * 0.3, delay: life * 0.1, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: sh, alpha: 0, duration: life * 0.4, onComplete: () => sh.destroy() }) })
    return made
  },

  // MINER · Tunnel dig — chunky dirt clods + rocks fling up off a pickaxe SPARK +
  // a kicked-up dust column. Replaces the generic particleBurst+shockwave.
  digBurstFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6b4f2a, accent: 0xffcf6b, depth: 13, durationMs: 520, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const sp = scene.add.graphics().setPosition(x + (Math.random() - 0.5) * 6, y - 2).setDepth(o.depth + 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.95); made.push(sp)
    sp.fillStyle(o.accent, 0.95); for (let k = 0; k < 3; k++) { const a = Math.random() * Math.PI * 2; sp.fillTriangle(0, 0, Math.cos(a) * 6, Math.sin(a) * 6, Math.cos(a + 0.4) * 3, Math.sin(a + 0.4) * 3) }
    _glow(sp, o.accent, 2, 7)
    scene.tweens.add({ targets: sp, alpha: 0, scale: 1.6, duration: life * 0.35, onComplete: () => sp.destroy() })
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8, d = 14 + Math.random() * 20
      const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth); made.push(g)
      _drawRockShard(g, 2 + Math.random() * 1.8, [0x6b5a3a, 0x4a3820, 0x7a6a4a][i % 3])
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d + 12, angle: (Math.random() - 0.5) * 300, alpha: 0, duration: life * 1.3, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    if (mult > 0) {
      const dp = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.9 }, speedY: { min: -70, max: -24 }, speedX: { min: -34, max: 34 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.55, end: 0 }, tint: [0xb8a888, 0x7a6a4a, 0x4a3820], emitting: false })
      dp.setDepth(o.depth - 0.5); dp.explode(Math.round(12 * mult)); made.push(dp); scene.time.delayedCall(life, () => { try { dp.destroy() } catch (e) {} })
    }
    return made
  },

  // VALKYRIE · Winged Flight — feathered WINGS flare open + a celestial float glow
  // + drifting feathers (the SOAR over a trap). Custom layered feather fans.
  wingedFlightFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xfff4d8, accent: 0xffffff, depth: 15, durationMs: 600, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    for (const side of [-1, 1]) {
      const g = scene.add.graphics().setPosition(x, y - 10).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(g)
      g.fillStyle(o.color, 0.85)
      for (let f = 0; f < 4; f++) { const fa = -0.5 - f * 0.32, len = 18 - f * 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(side * Math.cos(fa) * len, Math.sin(fa) * len - 2); g.lineTo(side * Math.cos(fa + 0.18) * len * 0.8, Math.sin(fa + 0.18) * len * 0.8); g.closePath(); g.fillPath() }
      _glow(g, o.color, 3, 9)
      scene.tweens.add({ targets: g, scale: 1, alpha: 1, duration: life * 0.28, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scaleX: 1.2, duration: life * 0.5, onComplete: () => g.destroy() }) })
    }
    const glow = scene.add.circle(x, y - 6, 8, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: additive celestial float glow, the wings are the read
    _glow(glow, o.accent, 3, 11); made.push(glow)
    scene.tweens.add({ targets: glow, alpha: 0.4, scale: 1.6, duration: life * 0.4, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => glow.destroy() })
    for (let i = 0; i < 4; i++) {
      const fx2 = x + (Math.random() - 0.5) * 22
      const g = scene.add.graphics().setPosition(fx2, y - 6).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9); made.push(g)
      g.fillStyle(0xfff8e0, 0.9); g.beginPath(); g.moveTo(0, 0); g.lineTo(1.6, -6); g.lineTo(0, -10); g.lineTo(-1.6, -6); g.closePath(); g.fillPath()
      scene.tweens.add({ targets: g, y: y + 14 + Math.random() * 10, x: fx2 + (Math.random() - 0.5) * 16, angle: (Math.random() - 0.5) * 140, alpha: 0, duration: life, ease: 'Sine.easeInOut', onComplete: () => g.destroy() })
    }
    return made
  },

  // VALKYRIE · Rally the Fallen — great celestial WINGS sweep down over the fallen,
  // enfold, then lift in a gold holy column + ascending motes. (Used via REVIVE_COSMETIC.)
  valkyrieRaiseFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe9a8, accent: 0xffffff, depth: 16, durationMs: 1000, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    for (const side of [-1, 1]) {
      const g = scene.add.graphics().setPosition(x, y - 4).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(g)
      g.fillStyle(o.color, 0.7)
      for (let f = 0; f < 5; f++) { const fa = -0.3 - f * 0.28, len = 26 - f * 2.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(side * Math.cos(fa) * len, Math.sin(fa) * len + 4); g.lineTo(side * Math.cos(fa + 0.16) * len * 0.82, Math.sin(fa + 0.16) * len * 0.82 + 4); g.closePath(); g.fillPath() }
      _glow(g, o.color, 4, 12)
      scene.tweens.add({ targets: g, scale: 1, alpha: 1, duration: life * 0.3, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scaleY: 0.6, y: y - 24, duration: life * 0.5, onComplete: () => g.destroy() }) })
    }
    const halo = scene.add.circle(x, y + 4, 12, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: additive holy-lift gather, the wings are the read
    _glow(halo, o.accent, 4, 12); made.push(halo)
    scene.tweens.add({ targets: halo, alpha: 0.5, scaleX: 1.5, scaleY: 0.7, duration: life * 0.5, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => halo.destroy() })
    if (mult > 0) {
      const m = scene.add.particles(x, y + 2, _softDotTexture(scene), { lifespan: { min: life * 0.5, max: life }, speedY: { min: -80, max: -34 }, speedX: { min: -16, max: 16 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [o.accent, o.color, 0xffe9b0], blendMode: 'ADD', emitting: false })
      m.setDepth(o.depth + 0.3); m.explode(Math.round(16 * mult)); made.push(m); scene.time.delayedCall(life, () => { try { m.destroy() } catch (e) {} })
    }
    return made
  },

  // ROGUE · Invisibility — the rogue dissolves into SHADOW: lobed smoke-wisps curl
  // outward (vanish) or coalesce inward (opts.reveal) + a dark dissipation puff.
  vanishSmokeFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x6a5a8a, accent: 0x2a2438, depth: 14, durationMs: 520, reveal: false, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const puffs = 5
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + Math.random() * 0.4, r = o.reveal ? 22 : 4
      const g = scene.add.graphics().setPosition(x + Math.cos(a) * r, y - 6 + Math.sin(a) * r * 0.7).setDepth(o.depth).setScale(o.reveal ? 0.9 : 0.3).setAlpha(o.reveal ? 0.7 : 0); made.push(g)
      g.fillStyle(o.color, 0.55); for (let l = 0; l < 3; l++) { const la = l / 3 * Math.PI * 2; g.fillCircle(Math.cos(la) * 3, Math.sin(la) * 3, 4) }
      g.fillStyle(o.accent, 0.5); g.fillCircle(0, 0, 3)
      const tx = o.reveal ? x : x + Math.cos(a) * (18 + Math.random() * 12)
      const ty = o.reveal ? y - 6 : y - 14 + Math.sin(a) * 8
      scene.tweens.add({ targets: g, x: tx, y: ty, scale: o.reveal ? 0.3 : 1.1, alpha: o.reveal ? 0 : 0.55, angle: (Math.random() - 0.5) * 120, duration: life, ease: 'Quad.easeOut', onComplete: () => g.destroy() })
    }
    if (mult > 0) {
      const p = scene.add.particles(x, y - 6, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speed: { min: 20, max: 70 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0x6a5a8a, 0x2a2438, 0x4a3a6a], emitting: false })
      p.setDepth(o.depth - 0.3); p.explode(Math.round(8 * mult)); made.push(p); scene.time.delayedCall(life, () => { try { p.destroy() } catch (e) {} })
    }
    return made
  },

  // GLADIATOR · Block — a round bronze HOPLON is raised in front (shaded disc + rim
  // + boss + sheen) and a deflection sheen sweeps across it. The fiction IS a round
  // shield, so the disc is deliberate. Held for the brace window.
  gladiatorBlockFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd66b, accent: 0xfff4d8, depth: 14, durationMs: 700, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const sh = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth).setScale(0.4).setAlpha(0); made.push(sh)
    sh.fillStyle(0x8a6a2a, 0.95); sh.fillCircle(0, 0, 15)
    sh.fillStyle(0xb8882a, 0.9); sh.fillCircle(0, 0, 11)
    sh.lineStyle(2.4, 0xffd66b, 0.95); sh.strokeCircle(0, 0, 15)
    sh.fillStyle(0xffe9a8, 0.9); sh.fillCircle(0, 0, 4)
    sh.fillStyle(0xfff4d8, 0.4); sh.fillEllipse(-5, -5, 8, 5); _glow(sh, o.color, 3, 10)
    scene.tweens.add({ targets: sh, scale: 1, alpha: 0.95, duration: life * 0.18, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: sh, alpha: 0.7, duration: life * 0.5, yoyo: true, ease: 'Sine.easeInOut',
        onComplete: () => scene.tweens.add({ targets: sh, alpha: 0, scale: 1.1, duration: life * 0.25, onComplete: () => sh.destroy() }) }) })
    const sheen = scene.add.graphics().setPosition(x - 8, y - 6).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(sheen)
    sheen.fillStyle(0xffffff, 0.7); sheen.fillEllipse(0, 0, 5, 26)
    scene.tweens.add({ targets: sheen, x: x + 8, alpha: 0.8, duration: life * 0.3, delay: life * 0.15, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: sheen, alpha: 0, duration: life * 0.2, onComplete: () => sheen.destroy() }) })
    return made
  },

  // GLADIATOR · Crowd Roar — a fierce colosseum ROAR: broken roar-bands radiate (not
  // clean rings) + a hot up-flare + rising cheer-dust. Intensity scales opts.stacks.
  crowdRoarFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffb347, accent: 0xffd27a, depth: 14, durationMs: 560, stacks: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const n = Math.min(6, Math.max(1, o.stacks))
    for (let i = 0; i < 2 + Math.floor(n / 2); i++) {
      const g = scene.add.graphics().setPosition(x, y - 8).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9).setScale(0.4); made.push(g)
      const r = 16 + i * 8
      g.lineStyle(3.2 - i * 0.5, i ? o.accent : o.color, 0.85)
      g.beginPath(); g.arc(0, 0, r, -2.2, -0.95, false); g.strokePath()
      g.beginPath(); g.arc(0, 0, r, 0.95, 2.2, false); g.strokePath()
      g.beginPath(); g.arc(0, 0, r, -0.55, 0.55, false); g.strokePath(); _glow(g, o.color, 2, 7)
      scene.tweens.add({ targets: g, scale: 1 + i * 0.3 + n * 0.05, alpha: 0, duration: life * 0.55 + i * 70, ease: 'Quad.easeOut', onComplete: () => g.destroy() })
    }
    const fl = scene.add.circle(x, y - 8, 5 + n, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 0.5)  // circle-ok: additive roar up-flare core, the broken bands are the read
    _glow(fl, o.accent, 3, 9 + n); made.push(fl)
    scene.tweens.add({ targets: fl, alpha: 0.7, scale: 1.8, duration: life * 0.4, yoyo: true, ease: 'Sine.easeOut', onComplete: () => fl.destroy() })
    if (mult > 0) {
      const p = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: -70, max: -24 }, speedX: { min: -50, max: 50 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [o.accent, o.color, 0xff8833], blendMode: 'ADD', emitting: false })
      p.setDepth(o.depth - 0.3); p.explode(Math.round((8 + n * 2) * mult)); made.push(p); scene.time.delayedCall(life, () => { try { p.destroy() } catch (e) {} })
    }
    return made
  },

  // CHAMPION · Forlorn Hope "Last Vow" — a martyr's final stand: a crimson resolve
  // PILLAR erupts + a blood-oath sigil burns at the feet + a defiant up-flare +
  // rising embers. Dramatic, not a ring stack.
  lastVowFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff3344, accent: 0xffd23f, depth: 16, durationMs: 900, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const col = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.3).setAlpha(0); made.push(col)
    col.fillStyle(o.color, 0.5); col.beginPath(); col.moveTo(-12, 4); col.lineTo(-6, -56); col.lineTo(6, -56); col.lineTo(12, 4); col.closePath(); col.fillPath()
    col.fillStyle(o.accent, 0.6); col.beginPath(); col.moveTo(-5, 4); col.lineTo(-2.5, -56); col.lineTo(2.5, -56); col.lineTo(5, 4); col.closePath(); col.fillPath(); _glow(col, o.color, 5, 15)
    scene.tweens.add({ targets: col, scaleX: 1, scaleY: 1, alpha: 1, duration: life * 0.3, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: col, alpha: 0, scaleX: 1.5, duration: life * 0.5, onComplete: () => col.destroy() }) })
    // blood-oath sigil at the feet — a jagged angular rune, not a clean circle
    const sig = scene.add.graphics().setPosition(x, y + 4).setDepth(o.depth - 0.4).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(sig)
    sig.lineStyle(2.4, o.accent, 0.9); sig.beginPath()
    for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI * 2, r = i % 2 ? 16 : 9; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.5; if (i === 0) sig.moveTo(px, py); else sig.lineTo(px, py) }
    sig.closePath(); sig.strokePath(); _glow(sig, o.color, 3, 10)
    scene.tweens.add({ targets: sig, scale: 1, alpha: 0.9, angle: 30, duration: life * 0.4, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: sig, alpha: 0, duration: life * 0.5, onComplete: () => sig.destroy() }) })
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.9 }, speedY: { min: -110, max: -50 }, speedX: { min: -30, max: 30 }, x: { min: -10, max: 10 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [o.accent, o.color, 0xff6622], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth + 0.3); em.explode(Math.round(18 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // CHAMPION · All-Star "Holy Aegis" — a guardian ward: golden light descends + a
  // protective wing-shield shimmer enfolds the ally + heal motes. (templar heal)
  holyAegisFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe066, accent: 0xfff8d0, depth: 15, durationMs: 720, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // protective wing-shield: two feathered arcs sweep up around the ally
    for (const side of [-1, 1]) {
      const g = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(g)
      g.lineStyle(2.6, o.color, 0.85); g.beginPath(); g.arc(0, 0, 18, side < 0 ? 1.3 : -1.3, side < 0 ? 2.7 : -2.7, side < 0); g.strokePath()
      g.fillStyle(o.accent, 0.5); for (let f = 0; f < 3; f++) { const fa = (side < 0 ? 1.6 : -1.6) + side * f * 0.3; g.fillTriangle(Math.cos(fa) * 18, Math.sin(fa) * 18, Math.cos(fa) * 24, Math.sin(fa) * 24, Math.cos(fa + 0.12) * 18, Math.sin(fa + 0.12) * 18) }
      _glow(g, o.color, 3, 10)
      scene.tweens.add({ targets: g, scale: 1, alpha: 0.9, duration: life * 0.3, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scale: 1.2, duration: life * 0.4, onComplete: () => g.destroy() }) })
    }
    const halo = scene.add.circle(x, y - 6, 8, o.color, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: additive ward glow, the wing-shield arcs are the read
    _glow(halo, o.accent, 3, 11); made.push(halo)
    scene.tweens.add({ targets: halo, alpha: 0.5, scale: 1.7, duration: life * 0.4, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => halo.destroy() })
    if (mult > 0) {
      const m = scene.add.particles(x, y - 26, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.8 }, speedY: { min: 16, max: 50 }, speedX: { min: -16, max: 16 }, x: { min: -10, max: 10 }, scale: { start: 0.16, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [o.accent, o.color], blendMode: 'ADD', emitting: false })
      m.setDepth(o.depth - 0.3); m.explode(Math.round(10 * mult)); made.push(m); scene.time.delayedCall(life, () => { try { m.destroy() } catch (e) {} })
    }
    return made
  },

  // EVENT · Solo Leveling "ARISE" — a violet SHADOW-SOLDIER silhouette rises from a
  // dark pool + spectral wisps + an eye-glint. The Shadow Monarch's iconic raise.
  shadowAriseFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9b2fe0, accent: 0xc9a9ff, depth: 15, durationMs: 820, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // dark shadow pool wells up (lobed, additive-dark)
    const pv = 10, pn = Array.from({ length: pv }, () => 0.7 + Math.random() * 0.5)
    const pool = scene.add.graphics().setPosition(x, y + 6).setDepth(o.depth - 0.6).setScale(0.4).setAlpha(0); made.push(pool)
    pool.fillStyle(0x1a0a2e, 0.7); pool.beginPath()
    for (let i = 0; i <= pv; i++) { const a = i / pv * Math.PI * 2, r = 16 * pn[i % pv]; const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.5; if (i === 0) pool.moveTo(px, py); else pool.lineTo(px, py) }
    pool.closePath(); pool.fillPath()
    scene.tweens.add({ targets: pool, alpha: 0.7, scaleX: 1.4, scaleY: 1, duration: life * 0.3, yoyo: true, ease: 'Sine.easeOut', onComplete: () => pool.destroy() })
    // a shadow-soldier silhouette rises (a hooded figure shape) + violet rim glow
    const fig = scene.add.graphics().setPosition(x, y + 10).setDepth(o.depth).setScale(0.9).setAlpha(0); made.push(fig)
    fig.fillStyle(0x2a1148, 0.92); fig.beginPath(); fig.moveTo(0, -26); fig.lineTo(7, -14); fig.lineTo(5, 4); fig.lineTo(-5, 4); fig.lineTo(-7, -14); fig.closePath(); fig.fillPath()  // cloaked body
    fig.fillCircle(0, -24, 5)  // hood/head
    fig.fillStyle(o.accent, 0.9); fig.fillCircle(-2, -24, 1.3); fig.fillCircle(2, -24, 1.3)  // glowing eyes
    _glow(fig, o.color, 3, 10)
    scene.tweens.add({ targets: fig, y: y - 4, alpha: 1, duration: life * 0.4, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: fig, alpha: 0, y: fig.y - 8, duration: life * 0.4, delay: life * 0.1, onComplete: () => fig.destroy() }) })
    if (mult > 0) {
      const w = scene.add.particles(x, y + 4, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.9 }, speedY: { min: -60, max: -18 }, speedX: { min: -26, max: 26 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [0x9b2fe0, 0x6a1fb0, 0xc9a9ff], blendMode: 'ADD', emitting: false })
      w.setDepth(o.depth + 0.3); w.explode(Math.round(12 * mult)); made.push(w); scene.time.delayedCall(life, () => { try { w.destroy() } catch (e) {} })
    }
    return made
  },

  // EVENT · Light Party "Hallowed Ground" — a consecrated golden sigil blooms on the
  // ground + a protective dome shimmer + rising holy motes. Paladin invuln tell.
  consecrateFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd66b, accent: 0xfff8d0, depth: 14, durationMs: 800, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // consecrated ground sigil — a radiant cross-in-diamond, drawn (not a ring)
    const sig = scene.add.graphics().setPosition(x, y + 6).setDepth(o.depth - 0.5).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(sig)
    sig.lineStyle(2.4, o.accent, 0.9)
    sig.beginPath(); sig.moveTo(0, -16); sig.lineTo(20, 0); sig.lineTo(0, 16); sig.lineTo(-20, 0); sig.closePath(); sig.strokePath()   // diamond (ground perspective)
    sig.lineStyle(2, o.color, 0.85); sig.beginPath(); sig.moveTo(0, -10); sig.lineTo(0, 10); sig.moveTo(-14, 0); sig.lineTo(14, 0); sig.strokePath()  // cross
    _glow(sig, o.color, 3, 11)
    scene.tweens.add({ targets: sig, scale: 1, alpha: 0.95, angle: 8, duration: life * 0.35, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: sig, alpha: 0, duration: life * 0.5, delay: life * 0.1, onComplete: () => sig.destroy() }) })
    // protective dome shimmer (a tall translucent half-dome of light over the unit)
    const dome = scene.add.graphics().setPosition(x, y - 4).setDepth(o.depth + 0.2).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(0); made.push(dome)
    dome.lineStyle(2, o.accent, 0.6); dome.beginPath(); dome.arc(0, 4, 22, Math.PI, 0, false); dome.strokePath()
    dome.fillStyle(o.color, 0.12); dome.beginPath(); dome.arc(0, 4, 22, Math.PI, 0, false); dome.closePath(); dome.fillPath(); _glow(dome, o.color, 2, 9)
    scene.tweens.add({ targets: dome, scale: 1, alpha: 0.7, duration: life * 0.3, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: dome, alpha: 0, duration: life * 0.45, delay: life * 0.15, onComplete: () => dome.destroy() }) })
    if (mult > 0) {
      const m = scene.add.particles(x, y + 4, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.85 }, speedY: { min: -50, max: -16 }, speedX: { min: -18, max: 18 }, x: { min: -16, max: 16 }, scale: { start: 0.18, end: 0 }, alpha: { start: 0.75, end: 0 }, tint: [o.accent, o.color], blendMode: 'ADD', emitting: false })
      m.setDepth(o.depth); m.explode(Math.round(12 * mult)); made.push(m); scene.time.delayedCall(life, () => { try { m.destroy() } catch (e) {} })
    }
    return made
  },

  // ══ BOSS ABILITY VFX — ORC VETERAN · TROPHY HUNTER ══════════════════════════
  // Elevated above adventurer/minion VFX: bigger silhouettes, forged-iron
  // shading, tier-escalating composition. opts.tier (1..4) drives the escalation;
  // opts.color carries the "stolen class" accent for that trophy.

  // CLAIM — the fallen hero's emblem flashes bronze, a pennant token in the
  // trophy colour lifts off the corpse and streaks to the throne rack.
  trophyClaimFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffffff, depth: 16, durationMs: 760, isNew: false, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const tx = Number.isFinite(o.toX) ? o.toX : x, ty = Number.isFinite(o.toY) ? o.toY : y - 60
    const flash = scene.add.circle(x, y - 6, 7, 0xffd9a0, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)  // circle-ok: additive claim spark, the rising token is the read
    _glow(flash, o.color, 4, 12); made.push(flash)
    scene.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: life * 0.35, ease: 'Quad.easeOut', onComplete: () => flash.destroy() })
    const g = scene.add.graphics().setPosition(x, y - 8).setDepth(o.depth + 1).setAlpha(0).setScale(0.5); made.push(g)
    g.fillStyle(0x3a2a18, 1); g.fillRect(-1.2, -10, 2.4, 20)                                    // pole
    g.fillStyle(o.color, 0.95); g.beginPath(); g.moveTo(1.2, -10); g.lineTo(13, -6); g.lineTo(1.2, -2); g.closePath(); g.fillPath()  // pennant flag
    g.fillStyle(_lerpColor(o.color, 0xffffff, 0.5), 0.9); g.fillCircle(5, -6, 1.6)              // emblem
    _glow(g, o.color, 3, 9)
    scene.tweens.add({ targets: g, y: y - 30, alpha: 1, scale: 1, duration: life * 0.3, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: g, x: tx, y: ty, scale: 0.4, alpha: 0, angle: 220, duration: life * 0.55, ease: 'Cubic.easeIn', onComplete: () => g.destroy() }) })
    if (mult > 0) {
      const em = scene.add.particles(x, y - 8, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speed: { min: 10, max: 40 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [o.color, 0xffd9a0], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth); em.explode(Math.round((o.isNew ? 12 : 6) * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // BLADE → Cleave — a wide iron crescent sweeps in the strike direction with a
  // class-color edge glint + dust kick. T1 one crescent · T2/T3 double-crescent
  // "X" + (T3) a lingering ground gash · T4 full circular whirlwind.
  orcCleaveFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd0a0, iron: 0xd2d7e0, depth: 13, durationMs: 440, tier: 1, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const ang = Math.atan2(o.dirY ?? 0, o.dirX ?? 1)
    const full = tier >= 4, R = 32 + tier * 5, half = full ? Math.PI : Math.PI * 0.45
    const swings = full ? 1 : (tier >= 2 ? 2 : 1)
    for (let s = 0; s < swings; s++) {
      const g = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(g)
      _drawCrescentBand(g, R, R * 0.62, half, o.iron, o.color)
      const tilt = swings > 1 ? (s === 0 ? -0.4 : 0.4) : 0
      g.setRotation(ang + tilt - half * 0.5); _glow(g, o.color, 3, 10)
      const spin = full ? Math.PI * 2.2 : half * 0.5
      scene.tweens.add({ targets: g, rotation: ang + tilt + spin, alpha: 1, scaleX: 1.12, scaleY: 1.12, duration: life * (full ? 0.55 : 0.3), delay: s * 70, ease: full ? 'Cubic.easeIn' : 'Quart.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.4, onComplete: () => g.destroy() }) })
    }
    if (tier >= 3) {
      const gg = scene.add.graphics().setPosition(x, y + 4).setDepth(o.depth - 1).setAlpha(0); made.push(gg)
      gg.lineStyle(3, 0x2a1d10, 0.9); let px = Math.cos(ang) * 8, py = Math.sin(ang) * 8 * 0.6, a = ang
      gg.beginPath(); gg.moveTo(px, py)
      for (let i = 0; i < 4; i++) { a += (Math.random() - 0.5) * 0.5; const sl = (R * 1.4) / 4; px += Math.cos(a) * sl; py += Math.sin(a) * sl * 0.55; gg.lineTo(px, py) }
      gg.strokePath(); gg.lineStyle(1.4, 0xff8a3a, 0.6); gg.strokePath()
      scene.tweens.add({ targets: gg, alpha: 1, duration: life * 0.25, onComplete: () => scene.tweens.add({ targets: gg, alpha: 0, duration: life * 2, onComplete: () => gg.destroy() }) })
    }
    if (mult > 0) {
      const em = scene.add.particles(x + Math.cos(ang) * R * 0.5, y - 4 + Math.sin(ang) * R * 0.5, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.9 }, speed: { min: 40, max: 130 }, angle: { min: (ang * 180 / Math.PI) - 40, max: (ang * 180 / Math.PI) + 40 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0xc4bca8, 0x8a8270], emitting: false })
      em.setDepth(o.depth - 0.7); em.explode(Math.round((8 + tier * 2) * mult)); made.push(em); scene.time.delayedCall(life * 1.5, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // HEAVY → Shield Bash — an iron kite shield thrusts forward, clangs with an
  // iron-spark burst, sets a golden brace halo (DR), then recoils.
  shieldBashFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xc9a23f, depth: 14, durationMs: 420, tier: 1, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const ang = Math.atan2(o.dirY ?? 0, o.dirX ?? 1), reach = 22 + tier * 4
    const g = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth); made.push(g)
    _drawKiteShield(g, 26 + tier * 2, o.color); g.setRotation(ang)
    const fx = x + Math.cos(ang) * reach, fy = y - 6 + Math.sin(ang) * reach
    scene.tweens.add({ targets: g, x: fx, y: fy, duration: life * 0.28, ease: 'Quint.easeIn',
      onComplete: () => {
        const flash = scene.add.circle(fx, fy, 6, 0xfff0c0, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: additive clang spark core
        _glow(flash, o.color, 5, 12)
        scene.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: life * 0.4, ease: 'Expo.easeOut', onComplete: () => flash.destroy() })
        for (let i = 0; i < 7; i++) {
          const a = ang + (Math.random() - 0.5) * 1.4, d = 14 + Math.random() * 20
          const sp = scene.add.graphics().setPosition(fx, fy).setDepth(o.depth + 0.5).setBlendMode(Phaser.BlendModes.ADD)
          sp.fillStyle(0xffe9a8, 0.95); sp.fillRect(-1, -0.6, 5, 1.2)
          scene.tweens.add({ targets: sp, x: fx + Math.cos(a) * d, y: fy + Math.sin(a) * d, rotation: a, alpha: 0, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => sp.destroy() })
        }
        scene.tweens.add({ targets: g, x, y: y - 6, duration: life * 0.5, delay: life * 0.05, ease: 'Back.easeOut', onComplete: () => g.destroy() })
      } })
    const brace = scene.add.circle(x, y - 6, 16, o.color, 0).setStrokeStyle(2.5, o.color, 0.7).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth - 0.5)  // circle-ok: brace/guard accent ring; the shield thrust is the hero read
    _glow(brace, o.color, 3, 10); made.push(brace)
    scene.tweens.add({ targets: brace, scale: 1.5, alpha: 0, duration: life * 0.8, ease: 'Sine.easeOut', onComplete: () => brace.destroy() })
    return made
  },

  // ARCANE → Hexbolt — a crude orb of stolen magic bound in rattling iron chains
  // spins across the arena and bursts into purple shrapnel.
  hexboltFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9a6cff, depth: 14, durationMs: 520, tier: 1, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const tx = Number.isFinite(o.toX) ? o.toX : x + 80, ty = Number.isFinite(o.toY) ? o.toY : y
    const s = 6 + tier
    const orb = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); made.push(orb)
    _drawChainedOrb(orb, s, o.color); _glow(orb, o.color, 5, 14)
    const travel = life * 0.55
    scene.tweens.add({ targets: orb, rotation: Math.PI * 2, duration: travel, ease: 'Linear' })
    scene.tweens.add({ targets: orb, x: tx, y: ty, duration: travel, ease: 'Quad.easeIn',
      onComplete: () => {
        orb.destroy()
        const flash = scene.add.circle(tx, ty, 8, o.color, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: additive arcane impact core
        _glow(flash, 0xffffff, 5, 14); made.push(flash)
        scene.tweens.add({ targets: flash, scale: 3.2, alpha: 0, duration: life * 0.4, ease: 'Expo.easeOut', onComplete: () => flash.destroy() })
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 18
          const lk = scene.add.graphics().setPosition(tx, ty).setDepth(o.depth + 0.5)
          lk.fillStyle(0x4a3a6a, 1); lk.fillRoundedRect(-3, -2, 6, 4, 1.6)
          scene.tweens.add({ targets: lk, x: tx + Math.cos(a) * d, y: ty + Math.sin(a) * d, rotation: a * 2, alpha: 0, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => lk.destroy() })
        }
        if (mult > 0) {
          const em = scene.add.particles(tx, ty, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.7 }, speed: { min: 40, max: 120 }, scale: { start: 0.4, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [o.color, 0xd8c4ff], blendMode: 'ADD', emitting: false })
          em.setDepth(o.depth); em.explode(Math.round((10 + tier * 2) * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
        }
      } })
    if (mult > 0) {
      const trail = scene.add.particles(x, y, _softDotTexture(scene), { follow: orb, lifespan: 260 * slow, frequency: 18, quantity: 1, scale: { start: 0.36, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [o.color, 0x6a4aaa], blendMode: 'ADD' })
      trail.setDepth(o.depth - 0.5); made.push(trail)
      scene.time.delayedCall(travel, () => { try { trail.stop() } catch (e) {} ; scene.time.delayedCall(400, () => { try { trail.destroy() } catch (e) {} }) })
    }
    return made
  },

  // HUNTER → Volley — a fan of spinning war-axes streaks from the boss to each
  // target, each leaving a green fletch trail and a hit-spark on arrival.
  volleyFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x88dd66, iron: 0xc7ccd6, depth: 14, durationMs: 460, tier: 1, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    let targets = (Array.isArray(o.targets) && o.targets.length) ? o.targets : null
    if (!targets) {
      targets = []; const n = 3 + tier
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.4; targets.push({ x: x + Math.cos(a) * 90, y: y + Math.sin(a) * 90 }) }
    }
    targets.forEach((t, i) => {
      if (!_validXY(t.x, t.y)) return
      const g = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth); made.push(g)
      _drawWarAxe(g, 5 + tier * 0.6, o.iron)
      const ang = Math.atan2(t.y - (y - 6), t.x - x); g.setRotation(ang)
      scene.tweens.add({ targets: g, x: t.x, y: t.y, rotation: ang + Math.PI * 6, duration: life * 0.6, delay: i * 35, ease: 'Quad.easeIn',
        onComplete: () => {
          const flash = scene.add.circle(t.x, t.y, 5, 0xffe9a8, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: additive axe-hit spark
          _glow(flash, o.color, 3, 8); made.push(flash)
          scene.tweens.add({ targets: flash, scale: 2.4, alpha: 0, duration: life * 0.3, onComplete: () => flash.destroy() })
          g.destroy()
        } })
      const trail = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth - 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5); made.push(trail)
      trail.lineStyle(2, o.color, 0.6); trail.beginPath(); trail.moveTo(0, 0); trail.lineTo((t.x - x) * 0.3, (t.y - (y - 6)) * 0.3); trail.strokePath()
      scene.tweens.add({ targets: trail, alpha: 0, duration: life * 0.5, onComplete: () => trail.destroy() })
    })
    return made
  },

  // FAITH → Reaver's Smite — an iron greatsword slams down overhead; on impact a
  // light-thread siphons up to the boss (the lifesteal). x,y = victim.
  reaverSmiteFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe9a8, depth: 15, durationMs: 560, tier: 1, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const bladeLen = 40 + tier * 6
    const g = scene.add.graphics().setPosition(x, y - bladeLen - 30).setDepth(o.depth).setAlpha(0); made.push(g)
    g.fillStyle(0x3a2a18, 1); g.fillRect(-2, -10, 4, 14)                                          // grip
    g.fillStyle(0x5a4326, 1); g.fillRect(-7, -2, 14, 4)                                           // crossguard
    g.fillStyle(0x9aa0ac, 1); g.beginPath(); g.moveTo(-4, 2); g.lineTo(4, 2); g.lineTo(2.2, bladeLen); g.lineTo(0, bladeLen + 6); g.lineTo(-2.2, bladeLen); g.closePath(); g.fillPath()  // blade
    g.fillStyle(0xd6dae2, 1); g.beginPath(); g.moveTo(-4, 2); g.lineTo(0, 2); g.lineTo(0, bladeLen + 6); g.lineTo(-2.2, bladeLen); g.closePath(); g.fillPath()  // lit edge
    _glow(g, o.color, 3, 9)
    scene.tweens.add({ targets: g, y: y - bladeLen, alpha: 1, duration: life * 0.32, ease: 'Quint.easeIn',
      onComplete: () => {
        const flash = scene.add.circle(x, y, 8, 0xfff4cc, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: additive smite impact core
        _glow(flash, o.color, 6, 16); made.push(flash)
        scene.tweens.add({ targets: flash, scale: 3.6, alpha: 0, duration: life * 0.4, ease: 'Expo.easeOut', onComplete: () => flash.destroy() })
        scene.tweens.add({ targets: g, alpha: 0, y: y - bladeLen + 6, duration: life * 0.4, onComplete: () => g.destroy() })
        const sfx = Number.isFinite(o.fromX) ? o.fromX : x, sfy = Number.isFinite(o.fromY) ? o.fromY : y - 60
        const dx = sfx - x, dy = sfy - y, dl = Math.hypot(dx, dy) || 1
        if (mult > 0) {
          const sip = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: 420 * slow, frequency: 22, quantity: 2, speedX: { min: dx / dl * 100, max: dx / dl * 180 }, speedY: { min: dy / dl * 100, max: dy / dl * 180 }, scale: { start: 0.4, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [o.color, 0xfff4cc], blendMode: 'ADD' })
          sip.setDepth(o.depth); made.push(sip)
          scene.time.delayedCall(life * 0.5, () => { try { sip.stop() } catch (e) {} ; scene.time.delayedCall(500, () => { try { sip.destroy() } catch (e) {} }) })
        }
        const thread = scene.add.line(0, 0, x, y, sfx, sfy, o.color, 0.8).setOrigin(0, 0).setLineWidth(2).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth); made.push(thread)
        _glow(thread, o.color, 4, 10)
        scene.tweens.add({ targets: thread, alpha: 0, duration: life * 0.5, ease: 'Quad.easeIn', onComplete: () => thread.destroy() })
      } })
    return made
  },

  // T4 ULT → Veteran's Armory — every claimed weapon materialises orbiting the
  // boss, then fires outward in sequence over expanding shock rings. The finale.
  veteransArmoryFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 16, durationMs: 1400, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const types = (Array.isArray(o.trophies) && o.trophies.length) ? o.trophies : ['blade', 'heavy', 'arcane', 'hunter', 'faith']
    const COLORS = { blade: 0xd0d4dc, heavy: 0xc9a23f, arcane: 0x9a6cff, hunter: 0x66cc66, faith: 0xffe9a8 }
    const core = scene.add.circle(x, y - 6, 10, 0xffcaa0, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth)  // circle-ok: additive armory charge core
    _glow(core, 0xffcaa0, 8, 22); made.push(core)
    scene.tweens.add({ targets: core, scale: 2.4, alpha: 0.4, duration: life * 0.4, yoyo: true, ease: 'Sine.easeInOut', onComplete: () => core.destroy() })
    const R = 46
    types.forEach((tp, i) => {
      const col = COLORS[tp] ?? 0xffffff
      const a0 = (Math.PI * 2 * i) / types.length - Math.PI / 2
      const g = scene.add.graphics().setPosition(x + Math.cos(a0) * 12, y - 6 + Math.sin(a0) * 12).setDepth(o.depth + 1).setAlpha(0).setScale(0.4); made.push(g)
      if (tp === 'heavy') _drawKiteShield(g, 16, col)
      else if (tp === 'arcane') _drawChainedOrb(g, 7, col)
      else _drawWarAxe(g, 7, tp === 'blade' ? 0xd0d4dc : col)
      _glow(g, col, 3, 9)
      const ox = x + Math.cos(a0) * R, oy = y - 6 + Math.sin(a0) * R
      scene.tweens.add({ targets: g, x: ox, y: oy, alpha: 1, scale: 1, rotation: a0 + Math.PI, duration: life * 0.35, delay: i * 50, ease: 'Back.easeOut',
        onComplete: () => {
          const fx2 = x + Math.cos(a0) * 200, fy2 = y - 6 + Math.sin(a0) * 200
          scene.tweens.add({ targets: g, x: fx2, y: fy2, rotation: a0 + Math.PI * 5, alpha: 0, duration: life * 0.3, delay: i * 40, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
        } })
    })
    for (let r = 0; r < 3; r++) {
      const ring = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth - 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8); made.push(ring)
      ring.lineStyle(3, 0xffcaa0, 0.8); ring.strokeCircle(0, 0, 20)
      scene.tweens.add({ targets: ring, scale: 4 + r, alpha: 0, duration: life * 0.6, delay: life * 0.35 + r * 120, ease: 'Quint.easeOut', onComplete: () => ring.destroy() })
    }
    if (mult > 0) {
      const em = scene.add.particles(x, y - 6, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.9 }, speed: { min: 60, max: 220 }, angle: { min: 0, max: 360 }, scale: { start: 0.5, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xffcaa0, 0xffe9a8, 0xd0d4dc], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth); em.explode(Math.round(28 * mult)); made.push(em); scene.time.delayedCall(life * 1.5, () => { try { em.destroy() } catch (e) {} })
    }
    scene.cameras?.main?.shake?.(360, 0.006)
    return made
  },

  // ══ BOSS ABILITY VFX — ELDER LICH · THE WITHERING ═══════════════════════════
  // Souls are the RECOLORED, animated T1 ghost sprite (_makeSoulSprite) so they
  // move like ghostly creatures, over ectoplasm + drain-thread graphics. Distinct
  // from the Orc's forged iron. opts.tier (1..4) escalates.

  // Public wrapper so other systems (the boss's soul-orbit tell) can spawn the
  // same recolored ghost-soul sprite.
  makeSoulSprite(scene, x, y, opts = {}) { return _makeSoulSprite(scene, x, y, opts) },

  // Shared soul-aura pieces (BossRenderer's LIVE aura calls these so the in-game
  // look and the lab preview can never drift).
  soulAuraColor(sat, overK = 0) { return _soulAuraColor(Math.max(0, Math.min(1, sat)), Math.max(0, Math.min(1, overK))) },
  soulGlowParams(sat, overK = 0, now = 0) { return _soulGlowParams(Math.max(0, Math.min(1, sat)), Math.max(0, Math.min(1, overK)), now) },
  auraGlowParams(sat, now = 0, lo = 0x2e7d3a, hi = 0x9aff7a) { return _auraGlowParams(sat, now, lo, hi) },
  // Generic boss-aura PREVIEW (lab): applies the pulsing Glow-outline to opts.sprite
  // at a chosen saturation for durationMs, then removes it. lo/hi = colour ramp.
  bossAuraFx(scene, x, y, opts = {}) {
    const o = { sat: 0.6, lo: 0x2e7d3a, hi: 0x9aff7a, durationMs: 3200, ...opts }
    if (!o.sprite || !o.sprite.postFX || scene.renderer?.type !== Phaser.WEBGL) return null
    const life = (o.durationMs) * (o.slow ?? 1)
    let glow = null
    try { const p = _auraGlowParams(o.sat, 0, o.lo, o.hi); glow = o.sprite.postFX.addGlow(p.color, p.strength, 0, false, 0.06, 12) } catch (e) {}
    if (!glow) return null
    scene.tweens.addCounter({ from: 0, to: 1, duration: life, ease: 'Linear',
      onUpdate: () => { const p = _auraGlowParams(o.sat, scene.time?.now ?? 0, o.lo, o.hi); try { glow.color = p.color; glow.outerStrength = p.strength } catch (e) {} },
      onComplete: () => { try { o.sprite.postFX.remove(glow) } catch (e) {} } })
    return [glow]
  },
  spawnSoulWisp(scene, x, y, dsz, col, depth) { return _spawnSoulWispGfx(scene, x, y, dsz, col, depth) },
  // Depth/perspective cue for an orbiting element — behind at the top, in front
  // at the bottom, smaller+dimmer at the back. THE standard for orbiting auras.
  orbitCue(ang, baseDepth, baseScale = 1, baseAlpha = 1, spread = 0.7) { return _orbitCue(ang, baseDepth, baseScale, baseAlpha, spread) },

  // PREVIEW of the Lich's soul aura at a chosen saturation/overflow — for the
  // VFX Lab so the levels can be SEEN and tested. The REAL aura is a pulsing Glow
  // OUTLINE on the boss sprite (pass opts.sprite to apply it, same as the live
  // BossRenderer aura); plus rising-wisp/orbit/leak ambiance. opts.sat 0..1,
  // opts.overK 0..1 (overflow band), opts.orbit = ghost-souls to orbit.
  soulAuraFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { sat: 0.6, overK: 0, dsz: 100, durationMs: 3200, depth: 13, orbit: 0, sprite: null, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const sat = Math.max(0, Math.min(1, o.sat)), overK = Math.max(0, Math.min(1, o.overK))
    const col = o.color ?? _soulAuraColor(sat, overK)
    // (1) the AURA itself — a pulsing Glow OUTLINE on the sprite (WebGL only).
    if (o.sprite && o.sprite.postFX && scene.renderer?.type === Phaser.WEBGL) {
      let glow = null
      try { const p = _soulGlowParams(sat, overK, 0); glow = o.sprite.postFX.addGlow(p.color, p.strength, 0, false, 0.06, 12) } catch (e) {}
      if (glow) {
        scene.tweens.addCounter({ from: 0, to: 1, duration: life, ease: 'Linear',
          onUpdate: () => { const p = _soulGlowParams(sat, overK, scene.time?.now ?? 0); try { glow.color = p.color; glow.outerStrength = p.strength } catch (e) {} },
          onComplete: () => { try { o.sprite.postFX.remove(glow) } catch (e) {} } })
      }
    }
    // (2) ambiance — rising wisps across the preview
    const nW = Math.round(2 + sat * 5 + overK * 3)
    for (let i = 0; i < nW; i++) scene.time.delayedCall((life * 0.7) * (i / Math.max(1, nW)), () => { if (_validXY(x, y)) _spawnSoulWispGfx(scene, x, y, o.dsz, col, o.depth + 0.5) })
    // overflow soul-leaks
    if (overK > 0) {
      const nL = 1 + Math.round(overK * 2)
      for (let i = 0; i < nL; i++) scene.time.delayedCall((life * 0.6) * (i / Math.max(1, nL)), () => {
        const sp = _makeSoulSprite(scene, x + (Math.random() - 0.5) * 20, y - o.dsz * 0.2, { color: col, scale: 0.3, depth: o.depth + 0.6, alpha: 0.85 })
        if (sp) scene.tweens.add({ targets: sp, x: sp.x + (Math.random() - 0.5) * 40, y: sp.y - 44, alpha: 0, scale: 0.18, duration: 900 * slow, ease: 'Sine.easeOut', onComplete: () => sp.destroy() })
      })
    }
    // optional orbiting souls (so the preview shows the full soul-level look) —
    // they pass BEHIND the sprite at the top of the ring and IN FRONT at the
    // bottom (depth/size/brightness cue), matching the live boss orbit.
    if (o.orbit > 0) {
      const souls = []
      for (let i = 0; i < o.orbit; i++) { const sp = _makeSoulSprite(scene, x, y, { color: i % 2 ? 0xc0a0ff : 0x9affc0, scale: 0.3, depth: o.depth, alpha: 0.85 }); if (sp) { souls.push(sp); made.push(sp) } }
      const R2 = 42, baseDepth = (o.sprite && Number.isFinite(o.sprite.depth)) ? o.sprite.depth : o.depth
      scene.tweens.addCounter({ from: 0, to: Math.PI * 2, duration: life, ease: 'Linear',
        onUpdate: (tw) => { const v = tw.getValue(); souls.forEach((sp, i) => { if (sp.active === false) return; const a = v + (Math.PI * 2 * i) / souls.length; const c = _orbitCue(a, baseDepth, 0.3, 0.9); sp.setPosition(x + Math.cos(a) * R2, y - 14 + Math.sin(a) * R2 * 0.45); sp.setDepth(c.depth); sp.setScale(c.scale); sp.setAlpha(c.alpha) }) },
        onComplete: () => souls.forEach(sp => scene.tweens.add({ targets: sp, alpha: 0, duration: 300, onComplete: () => sp.destroy() })) })
    }
    return made
  },

  // HARVEST — a soul tears loose from the corpse on an ectoplasm puff, rises, and
  // streaks to the Lich.
  soulHarvestWispFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x88e0a0, depth: 16, durationMs: 840, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const tx = Number.isFinite(o.toX) ? o.toX : x, ty = Number.isFinite(o.toY) ? o.toY : y - 80
    const puff = scene.add.graphics().setPosition(x, y).setDepth(o.depth - 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.75); made.push(puff)
    puff.fillStyle(o.color, 0.5); puff.fillEllipse(0, 2, 24, 11); puff.fillStyle(_lerpColor(o.color, 0xffffff, 0.5), 0.4); puff.fillEllipse(0, 1, 12, 6)
    scene.tweens.add({ targets: puff, alpha: 0, scaleX: 1.7, scaleY: 0.6, duration: life * 0.4, onComplete: () => puff.destroy() })
    const g = _makeSoulSprite(scene, x, y - 4, { color: 0x9affc0, depth: o.depth, scale: 0.34, dir: 'down', alpha: 0 }); made.push(g)
    scene.tweens.add({ targets: g, y: y - 26, alpha: 0.95, scale: 0.62, duration: life * 0.3, ease: 'Sine.easeOut',
      onComplete: () => scene.tweens.add({ targets: g, x: tx, y: ty, scale: 0.3, alpha: 0, duration: life * 0.6, ease: 'Cubic.easeIn', onComplete: () => g.destroy() }) })
    if (mult > 0) {
      const em = scene.add.particles(x, y - 4, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speed: { min: 8, max: 32 }, scale: { start: 0.32, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [o.color, 0xd8ffe0], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth); em.explode(Math.round(8 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // CHANNEL SOULS (day ability) — a swirling ectoplasm pool wells up, tormented
  // SOULS rise wailing, and drain threads pull life home. Tier adds wither haze
  // (T3) and a soul-cage (T4).
  soulChannelFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { depth: 14, durationMs: 950, tier: 1, victims: [], ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const GREEN = 0x66dd88, VIOLET = 0x9a6cff
    // layered ectoplasm pool (violet base, green mid, pale hot centre)
    const pool = scene.add.graphics().setPosition(x, y).setDepth(o.depth - 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0); made.push(pool)
    pool.fillStyle(VIOLET, 0.20); pool.fillEllipse(0, 6, 124, 48)
    pool.fillStyle(GREEN, 0.16); pool.fillEllipse(0, 6, 86, 34)
    pool.fillStyle(_lerpColor(GREEN, 0xffffff, 0.5), 0.12); pool.fillEllipse(0, 5, 46, 18)
    scene.tweens.add({ targets: pool, alpha: 1, scaleX: 1.06, duration: life * 0.2, yoyo: true, hold: life * 0.45, ease: 'Sine.easeOut', onComplete: () => pool.destroy() })
    // rising souls (full spirits, not faces)
    for (let i = 0; i < 3 + tier; i++) {
      const fx0 = x + (Math.random() - 0.5) * 92, fy0 = y + (Math.random() - 0.5) * 26
      const g = _makeSoulSprite(scene, fx0, fy0 + 14, { color: i % 2 ? 0xc0a0ff : 0x9affc0, depth: o.depth, scale: 0.28, dir: 'down', alpha: 0 }); made.push(g)
      scene.tweens.add({ targets: g, y: fy0 - 30, alpha: 0.92, scale: 0.5, angle: (Math.random() - 0.5) * 16, duration: life * 0.46, delay: i * 50, ease: 'Sine.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, y: g.y - 18, alpha: 0, duration: life * 0.4, onComplete: () => g.destroy() }) })
    }
    if (tier >= 3) {
      const haze = scene.add.graphics().setPosition(x, y).setDepth(o.depth - 0.5).setAlpha(0); made.push(haze)
      haze.fillStyle(0x6a6a60, 0.20); haze.fillEllipse(0, 4, 134, 54); haze.fillStyle(0x4a4a44, 0.16); haze.fillEllipse(0, 6, 96, 38)
      scene.tweens.add({ targets: haze, alpha: 1, duration: life * 0.3, yoyo: true, hold: life * 0.3, onComplete: () => haze.destroy() })
    }
    if (tier >= 4) {
      const cage = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(1, 0.3); made.push(cage)
      cage.lineStyle(2.5, 0xb48aff, 0.9); for (let b = -3; b <= 3; b++) { cage.beginPath(); cage.moveTo(b * 9, -26); cage.lineTo(b * 9, 26); cage.strokePath() }
      cage.lineStyle(2, 0xd6c4ff, 0.7); cage.beginPath(); cage.moveTo(-28, -26); cage.lineTo(28, -26); cage.moveTo(-28, 26); cage.lineTo(28, 26); cage.strokePath()
      _glow(cage, 0xb48aff, 3, 10)
      scene.tweens.add({ targets: cage, scaleY: 1, alpha: 1, duration: life * 0.25, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: cage, alpha: 0, duration: life * 0.5, delay: life * 0.3, onComplete: () => cage.destroy() }) })
    }
    const fromX = Number.isFinite(o.fromX) ? o.fromX : x, fromY = Number.isFinite(o.fromY) ? o.fromY : y
    for (const v of (o.victims || [])) {
      if (!_validXY(v.x, v.y)) continue
      const thread = scene.add.line(0, 0, v.x, v.y, fromX, fromY, GREEN, 0.7).setOrigin(0, 0).setLineWidth(2).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth); made.push(thread)
      _glow(thread, GREEN, 3, 8)
      scene.tweens.add({ targets: thread, alpha: 0, duration: life * 0.6, ease: 'Quad.easeIn', onComplete: () => thread.destroy() })
      if (mult > 0) {
        const dx = fromX - v.x, dy = fromY - v.y, dl = Math.hypot(dx, dy) || 1
        const em = scene.add.particles(v.x, v.y, _softDotTexture(scene), { lifespan: 420 * slow, frequency: 30, quantity: 1, speedX: { min: dx / dl * 120, max: dx / dl * 200 }, speedY: { min: dy / dl * 120, max: dy / dl * 200 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [GREEN, VIOLET], blendMode: 'ADD' })
        em.setDepth(o.depth); made.push(em); scene.time.delayedCall(life * 0.4, () => { try { em.stop() } catch (e) {} ; scene.time.delayedCall(500, () => { try { em.destroy() } catch (e) {} }) })
      }
    }
    scene.cameras?.main?.shake?.(180, 0.003)
    return made
  },

  // T1 · Death Coil — a hurled SOUL (upright, faintly wobbling) with a comet
  // ecto-tail; on impact it bursts into ecto shards and drains life back.
  deathCoilFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9a6cff, depth: 14, durationMs: 520, tier: 1, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const tx = Number.isFinite(o.toX) ? o.toX : x + 80, ty = Number.isFinite(o.toY) ? o.toY : y
    const orb = _makeSoulSprite(scene, x, y, { color: 0xc0a0ff, depth: o.depth, scale: 0.46 + tier * 0.05, dir: 'down' }); made.push(orb)
    const travel = life * 0.55
    scene.tweens.add({ targets: orb, angle: { from: -10, to: 10 }, duration: travel * 0.5, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' })   // gentle wobble, faces the viewer
    scene.tweens.add({ targets: orb, x: tx, y: ty, duration: travel, ease: 'Quad.easeIn',
      onComplete: () => {
        orb.destroy()
        const flash = scene.add.circle(tx, ty, 7, o.color, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: additive soul impact core
        _glow(flash, 0xffffff, 4, 12); made.push(flash)
        scene.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: life * 0.4, ease: 'Expo.easeOut', onComplete: () => flash.destroy() })
        // ecto shards (small soul-wisps) burst out
        for (let i = 0; i < 4 + tier; i++) {
          const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 18
          const sh = scene.add.graphics().setPosition(tx, ty).setDepth(o.depth + 0.5).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5); made.push(sh)
          _drawSoulWisp(sh, 3.5, i % 2 ? 0x88dd88 : o.color)
          scene.tweens.add({ targets: sh, x: tx + Math.cos(a) * d, y: ty + Math.sin(a) * d, alpha: 0, angle: (Math.random() - 0.5) * 120, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => sh.destroy() })
        }
        const thread = scene.add.line(0, 0, tx, ty, x, y, 0x88dd88, 0.8).setOrigin(0, 0).setLineWidth(2).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth); made.push(thread)
        _glow(thread, 0x88dd88, 3, 8)
        scene.tweens.add({ targets: thread, alpha: 0, duration: life * 0.4, onComplete: () => thread.destroy() })
        if (mult > 0) {
          const em = scene.add.particles(tx, ty, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speed: { min: 30, max: 90 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [o.color, 0xd8c4ff], blendMode: 'ADD', emitting: false })
          em.setDepth(o.depth); em.explode(Math.round(8 * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
        }
      } })
    if (mult > 0) {
      const trail = scene.add.particles(x, y, _softDotTexture(scene), { follow: orb, lifespan: 260 * slow, frequency: 16, quantity: 1, scale: { start: 0.36, end: 0 }, alpha: { start: 0.75, end: 0 }, tint: [o.color, 0x66cc88], blendMode: 'ADD' })
      trail.setDepth(o.depth - 0.5); made.push(trail)
      scene.time.delayedCall(travel, () => { try { trail.stop() } catch (e) {} ; scene.time.delayedCall(320, () => { try { trail.destroy() } catch (e) {} }) })
    }
    return made
  },

  // T2 · Soul Siphon — pulsing tethers to several heroes; a small SOUL slides
  // along each tether back to the Lich (the stolen life), trailing motes.
  soulSiphonFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x88dd88, depth: 14, durationMs: 920, tier: 1, targets: [], ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    ;(o.targets || []).forEach((t, ti) => {
      if (!_validXY(t.x, t.y)) return
      const thread = scene.add.line(0, 0, x, y, t.x, t.y, o.color, 0.7).setOrigin(0, 0).setLineWidth(2.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth); made.push(thread)
      _glow(thread, o.color, 4, 10)
      scene.tweens.add({ targets: thread, alpha: 0.25, yoyo: true, repeat: 2, duration: life * 0.16, ease: 'Sine.easeInOut',
        onComplete: () => scene.tweens.add({ targets: thread, alpha: 0, duration: life * 0.2, onComplete: () => thread.destroy() }) })
      // a wrenched soul slides target → Lich
      const s = _makeSoulSprite(scene, t.x, t.y, { color: ti % 2 ? 0xc0a0ff : 0x9affc0, depth: o.depth + 0.5, scale: 0.4, dir: 'down', alpha: 0 }); made.push(s)
      scene.tweens.add({ targets: s, alpha: 0.9, duration: life * 0.15, delay: ti * 40,
        onComplete: () => scene.tweens.add({ targets: s, x, y, scale: 0.22, alpha: 0, duration: life * 0.55, ease: 'Quad.easeIn', onComplete: () => s.destroy() }) })
      if (mult > 0) {
        const dx = x - t.x, dy = y - t.y, dl = Math.hypot(dx, dy) || 1
        const em = scene.add.particles(t.x, t.y, _softDotTexture(scene), { lifespan: 500 * slow, frequency: 26, quantity: 1, speedX: { min: dx / dl * 100, max: dx / dl * 170 }, speedY: { min: dy / dl * 100, max: dy / dl * 170 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [o.color, 0x9a6cff], blendMode: 'ADD' })
        em.setDepth(o.depth); made.push(em); scene.time.delayedCall(life * 0.7, () => { try { em.stop() } catch (e) {} ; scene.time.delayedCall(500, () => { try { em.destroy() } catch (e) {} }) })
      }
    })
    return made
  },

  // T3 · Soul Nova — expanding ghost rings + a host of wailing SOULS flung outward
  // through an ecto mist.
  soulNovaFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9a6cff, depth: 14, durationMs: 760, tier: 1, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // ecto mist bloom under the rings
    const mist = scene.add.graphics().setPosition(x, y - 4).setDepth(o.depth - 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5).setScale(0.4); made.push(mist)
    mist.fillStyle(0x88dd88, 0.3); mist.fillCircle(0, 0, 26); mist.fillStyle(o.color, 0.22); mist.fillCircle(0, 0, 18)
    scene.tweens.add({ targets: mist, scale: 2.6, alpha: 0, duration: life * 0.6, ease: 'Quad.easeOut', onComplete: () => mist.destroy() })
    for (let r = 0; r < 2 + (tier >= 3 ? 1 : 0); r++) {
      const ring = scene.add.graphics().setPosition(x, y - 4).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9); made.push(ring)
      ring.lineStyle(3, r % 2 ? 0x88dd88 : o.color, 0.85); ring.strokeCircle(0, 0, 16)
      scene.tweens.add({ targets: ring, scale: 3.6 + r, alpha: 0, duration: life * 0.7, delay: r * 90, ease: 'Quint.easeOut', onComplete: () => ring.destroy() })
    }
    const n = 4 + tier
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n, d = 40 + tier * 8
      const g = _makeSoulSprite(scene, x, y - 4, { color: i % 2 ? 0xc0a0ff : 0x9affc0, depth: o.depth + 0.5, scale: 0.22, dir: 'down', alpha: 0 }); made.push(g)
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * d, y: y - 4 + Math.sin(a) * d, alpha: 0.92, scale: 0.5, angle: (Math.random() - 0.5) * 24, duration: life * 0.42, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scale: 0.3, duration: life * 0.35, onComplete: () => g.destroy() }) })
    }
    const core = scene.add.circle(x, y - 4, 10, o.color, 0.85).setBlendMode(Phaser.BlendModes.ADD).setDepth(o.depth + 1)  // circle-ok: additive nova core flash
    _glow(core, 0x88dd88, 6, 16); made.push(core)
    scene.tweens.add({ targets: core, scale: 3, alpha: 0, duration: life * 0.5, ease: 'Expo.easeOut', onComplete: () => core.destroy() })
    if (mult > 0) {
      const em = scene.add.particles(x, y - 4, _softDotTexture(scene), { lifespan: { min: life * 0.4, max: life * 0.9 }, speed: { min: 50, max: 180 }, angle: { min: 0, max: 360 }, scale: { start: 0.45, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [o.color, 0x88dd88, 0xd8c4ff], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth); em.explode(Math.round((14 + tier * 2) * mult)); made.push(em); scene.time.delayedCall(life * 1.4, () => { try { em.destroy() } catch (e) {} })
    }
    scene.cameras?.main?.shake?.(220, 0.004)
    return made
  },

  // T4 · Soul Cage — soul-bars + domes snap shut around a victim with a trapped
  // SOUL writhing inside, ecto motes spiralling inward.
  soulCageFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xb48aff, depth: 15, durationMs: 880, tier: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const H = 20, R = 14
    // trapped soul inside, writhing
    const soul = _makeSoulSprite(scene, x, y - 6, { color: 0xc7b0ff, depth: o.depth - 0.5, scale: 0.4, dir: 'down', alpha: 0 }); made.push(soul)
    scene.tweens.add({ targets: soul, alpha: 0.92, scale: 0.55, duration: life * 0.25,
      onComplete: () => scene.tweens.add({ targets: soul, x: x + 3, angle: 10, yoyo: true, repeat: 2, duration: life * 0.16, ease: 'Sine.easeInOut',
        onComplete: () => scene.tweens.add({ targets: soul, alpha: 0, scale: 0.45, duration: life * 0.3, onComplete: () => soul.destroy() }) }) })
    // the cage
    const cage = scene.add.graphics().setPosition(x, y - 6).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(1, 0.2); made.push(cage)
    cage.lineStyle(2.4, o.color, 0.95)
    for (let b = -2; b <= 2; b++) { const bx = b * (R * 2 / 4); cage.beginPath(); cage.moveTo(bx, -H); cage.lineTo(bx, H); cage.strokePath() }
    cage.lineStyle(2, 0xd6c4ff, 0.8)
    cage.beginPath(); cage.arc(0, -H, R, Math.PI, 0, false); cage.strokePath()   // top dome
    cage.beginPath(); cage.arc(0, H, R, 0, Math.PI, false); cage.strokePath()    // bottom bowl
    _glow(cage, o.color, 4, 12)
    scene.tweens.add({ targets: cage, scaleY: 1, alpha: 1, duration: life * 0.25, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: cage, alpha: 0, duration: life * 0.5, delay: life * 0.25, onComplete: () => cage.destroy() }) })
    if (mult > 0) {
      const em = scene.add.particles(x, y - 6, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.6 }, speed: { min: 20, max: 60 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [o.color, 0x88dd88], blendMode: 'ADD',
        emitZone: { type: 'edge', source: new Phaser.Geom.Circle(0, 0, R + 8), quantity: 10 } })
      em.setDepth(o.depth - 0.5); made.push(em); scene.time.delayedCall(life * 0.5, () => { try { em.stop() } catch (e) {} ; scene.time.delayedCall(500, () => { try { em.destroy() } catch (e) {} }) })
    }
    return made
  },

  // ══ BOSS ABILITY VFX — SLIME KING · MITOSIS / THE HORDE ═════════════════════
  // Gooey green ooze (reuses _drawSlimeBlob). opts.tier escalates.

  // SPLIT — a blob stretches, pinches, and divides into two, flinging goo droplets.
  // opts.children = world points of the two new blobs; opts.small for a budling pop.
  slimeSplitFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x55cc77, depth: 60, durationMs: 560, tier: 1, small: false, children: null, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    const R = o.small ? 6 : 11 + o.tier
    // the dividing blob — squashes wide then snaps apart
    const blob = scene.add.graphics().setPosition(x, y).setDepth(o.depth); made.push(blob)
    _drawSlimeBlob(blob, R, o.color)
    scene.tweens.add({ targets: blob, scaleX: 1.7, scaleY: 0.6, alpha: 0, duration: life * 0.45, ease: 'Quad.easeOut', onComplete: () => blob.destroy() })
    // the two children plop out (or just a pop for buds)
    const pts = o.children && o.children.length ? o.children : (o.small ? [] : [{ x: x - 22, y }, { x: x + 22, y }])
    for (const c of pts) {
      if (!_validXY(c.x, c.y)) continue
      const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setScale(0.4); made.push(g)
      _drawSlimeBlob(g, R * 0.7, _lerpColor(o.color, 0xffffff, 0.15))
      scene.tweens.add({ targets: g, x: c.x, y: c.y, scaleX: 1, scaleY: 1, duration: life * 0.4, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.3, onComplete: () => g.destroy() }) })
    }
    // goo droplets fling out
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.7 }, speed: { min: 40, max: 130 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [o.color, 0x88ee99, 0x2e8b57], emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round((o.small ? 5 : 12) * mult)); made.push(em); scene.time.delayedCall(life, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // MERGE / COALESCE — two blobs flow together into one with a wet plop.
  slimeMergeFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x55cc77, depth: 60, durationMs: 520, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    for (const sign of [-1, 1]) {
      const g = scene.add.graphics().setPosition(x + sign * 20, y).setDepth(o.depth).setAlpha(0.9); made.push(g)
      _drawSlimeBlob(g, 8, o.color)
      scene.tweens.add({ targets: g, x, scaleX: 0.5, alpha: 0, duration: life * 0.5, ease: 'Quad.easeIn', onComplete: () => g.destroy() })
    }
    const pool = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.5).setScale(0.5).setAlpha(0); made.push(pool)
    _drawSlimeBlob(pool, 13, _lerpColor(o.color, 0xffffff, 0.18))
    scene.tweens.add({ targets: pool, scaleX: 1.15, scaleY: 0.9, alpha: 0.95, duration: life * 0.5, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: pool, alpha: 0, scaleY: 0.7, duration: life * 0.4, onComplete: () => pool.destroy() }) })
    return made
  },

  // ACID PUDDLE — a bubbling corrosive pool that lingers (~3s); opts.hit = a quick
  // splash on a struck adventurer.
  acidPuddleFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x88ee44, depth: 1.6, durationMs: 3000, tier: 1, hit: false, ...opts }
    const slow = o.slow ?? 1, life = (o.hit ? 360 : o.durationMs) * slow, mult = _particlesMult(), made = []
    const R = o.hit ? 8 : 20 + o.tier * 2
    const pool = scene.add.graphics().setPosition(x, y + 4).setDepth(o.depth).setAlpha(0); made.push(pool)
    pool.fillStyle(0x2e8b1e, 0.5); pool.fillEllipse(0, 0, R * 2, R * 0.9)
    pool.fillStyle(o.color, 0.4); pool.fillEllipse(0, 0, R * 1.4, R * 0.6)
    pool.fillStyle(_lerpColor(o.color, 0xffffff, 0.4), 0.4); pool.fillEllipse(-R * 0.2, -1, R * 0.5, R * 0.26)
    if (o.hit) {
      scene.tweens.add({ targets: pool, alpha: 0.9, scale: 1.3, duration: life * 0.4, yoyo: true, onComplete: () => pool.destroy() })
    } else {
      scene.tweens.add({ targets: pool, alpha: 0.85, duration: life * 0.12, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: pool, alpha: 0, duration: life * 0.3, delay: life * 0.55, onComplete: () => pool.destroy() }) })
      // rising corrosive bubbles over the puddle's life
      if (mult > 0) {
        const em = scene.add.particles(x, y + 2, _softDotTexture(scene), { frequency: 140, quantity: 1, lifespan: 700 * slow, speedY: { min: -34, max: -12 }, speedX: { min: -10, max: 10 }, x: { min: -R, max: R }, scale: { start: 0.26, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [o.color, 0xccff88], blendMode: 'ADD' })
        em.setDepth(o.depth + 0.5); made.push(em)
        scene.time.delayedCall(life * 0.7, () => { try { em.stop() } catch (e) {} ; scene.time.delayedCall(700, () => { try { em.destroy() } catch (e) {} }) })
      }
    }
    return made
  },

  // MITOSIS SURGE — gooplings erupt across a room: a goo geyser + a scatter of
  // little blobs bursting outward. opts.count scales the eruption.
  slimeSurgeFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x55cc77, depth: 60, durationMs: 760, count: 4, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, mult = _particlesMult(), made = []
    // central geyser of goo
    const geyser = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setScale(1, 0.3).setAlpha(0.9); made.push(geyser)
    _drawSlimeBlob(geyser, 14, o.color)
    scene.tweens.add({ targets: geyser, scaleX: 1.5, scaleY: 1.6, alpha: 0, y: y - 10, duration: life * 0.5, ease: 'Quad.easeOut', onComplete: () => geyser.destroy() })
    // little blobs burst outward + plop
    const n = Math.max(3, Math.min(12, o.count))
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.4, d = 24 + Math.random() * 40
      const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setScale(0.3); made.push(g)
      _drawSlimeBlob(g, 6, _lerpColor(o.color, 0x88ee99, Math.random()))
      scene.tweens.add({ targets: g, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, scale: 0.9, duration: life * 0.5, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scaleY: 0.5, duration: life * 0.3, onComplete: () => g.destroy() }) })
    }
    if (mult > 0) {
      const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: life * 0.3, max: life * 0.8 }, speed: { min: 50, max: 160 }, angle: { min: 0, max: 360 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [o.color, 0x88ee99], emitting: false })
      em.setDepth(o.depth + 1); em.explode(Math.round(16 * mult)); made.push(em); scene.time.delayedCall(life * 1.2, () => { try { em.destroy() } catch (e) {} })
    }
    scene.cameras?.main?.shake?.(180, 0.003)
    return made
  },

  // ENGULF — goo wraps a hero: a translucent blob swells over them + drips.
  slimeEngulfFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x55cc77, depth: 14, durationMs: 620, tier: 1, ...opts }
    const slow = o.slow ?? 1, life = o.durationMs * slow, made = []
    const g = scene.add.graphics().setPosition(x, y - 8).setDepth(o.depth).setAlpha(0).setScale(0.4); made.push(g)
    g.fillStyle(o.color, 0.5); g.fillEllipse(0, 0, 30, 38)
    g.fillStyle(_lerpColor(o.color, 0x000000, 0.3), 0.4); g.fillEllipse(2, 6, 22, 24)
    g.fillStyle(_lerpColor(o.color, 0xffffff, 0.5), 0.5); g.fillCircle(-7, -10, 5)
    _glow(g, o.color, 2, 8)
    scene.tweens.add({ targets: g, alpha: 0.85, scale: 1, duration: life * 0.3, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scaleY: 1.3, y: g.y + 6, duration: life * 0.5, ease: 'Quad.easeIn', onComplete: () => g.destroy() }) })
    return made
  },

  // ── BEHOLDER · Eye Tyrant — curse-rays ───────────────────────────────────
  // One bespoke ray per kind, each with its OWN silhouette + motion + impact
  // (built by _BEHOLDER_BEAM_BUILDERS): petrify=crystallizing stone bolt +
  // crackle, drain=siphon thread + globule particles flowing into the eye,
  // hex=unfurling curse-ribbon + spinning sigil, disintegrate=flickering white
  // death-ray + blast, silence=zipping null-tube + rune, slow=lurching tar glob
  // + drips + web. Particle-driven; tier scales width/brightness/count.
  beholderRayFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { kind: 'petrify', tier: 1, depth: 15, holdMs: 0, ...opts }
    const tx = Number.isFinite(o.toX) ? o.toX : x + 80
    const ty = Number.isFinite(o.toY) ? o.toY : y
    if (!_validXY(tx, ty)) return null
    const tier = Math.max(1, Math.min(4, o.tier)), made = []
    const p = _BEHOLDER_RAY_PAL[o.kind] ?? _BEHOLDER_RAY_PAL.petrify
    const ang = Math.atan2(ty - y, tx - x), len = Math.max(1, Math.hypot(tx - x, ty - y))

    // Pupil flash at the eye — a vertical lens blinks open as the ray fires.
    const eye = scene.add.graphics().setPosition(x, y).setRotation(ang).setDepth(o.depth + 0.5).setBlendMode(Phaser.BlendModes.ADD); made.push(eye)
    eye.fillStyle(p.core, 0.95); eye.fillEllipse(0, 0, 8 + tier, 14 + tier * 1.5)
    eye.fillStyle(p.edge, 1);    eye.fillCircle(0, 0, 2.6)
    eye.setScale(0.3, 1); _glow(eye, p.core, 4, 10)
    scene.tweens.add({ targets: eye, scaleX: 1.4, alpha: 0, duration: 280, ease: 'Quad.easeOut', onComplete: () => eye.destroy() })

    // The ray BODY + impact — distinct silhouette/motion/impact per kind.
    const build = _BEHOLDER_BEAM_BUILDERS[o.kind] ?? _beamPetrify
    made.push(...(build(scene, x, y, ang, len, p, tier, o.depth, o.holdMs) ?? []))
    return made
  },

  // The central eye charging before a fire — converging arcs tighten into a
  // white-hot pupil. A pre-fire tell. Graphics-only (fight-safe).
  beholderEyeChargeFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 15, durationMs: 520, color: 0x9a6cff, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), made = []
    const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); made.push(g)
    const prog = { r: 24 + tier * 4 }
    const draw = () => {
      g.clear(); const r = prog.r
      g.lineStyle(2, o.color, 0.8)
      for (let i = 0; i < 5; i++) { const a0 = (i / 5) * Math.PI * 2; g.beginPath(); g.arc(0, 0, r, a0, a0 + 0.7, false); g.strokePath() }
      g.fillStyle(0xffffff, Math.max(0, Math.min(1, (28 - r) / 20))); g.fillCircle(0, 0, Math.max(1, 8 - r * 0.2))
    }
    draw()
    scene.tweens.add({ targets: prog, r: 4, duration: o.durationMs, ease: 'Quad.easeIn', onUpdate: draw,
      onComplete: () => scene.tweens.add({ targets: g, alpha: 0, scale: 1.6, duration: 160, onComplete: () => g.destroy() }) })
    scene.tweens.add({ targets: g, rotation: Math.PI, duration: o.durationMs, ease: 'Linear' })
    _glow(g, o.color, 3 + tier, 12)
    return made
  },

  // TYRANT'S GAZE day room-sweep — a great violet eye blinks open over the
  // room and sweeps a ray-fan across it, with drifting motes. Day-phase only
  // (uses particles); not for mid-fight.
  tyrantGazeSweepFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 16, rectW: 240, rectH: 180, durationMs: 1100, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const col = 0x9a6cff, pale = 0xc9a6ff
    const eye = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); made.push(eye)
    eye.fillStyle(pale, 0.85);  eye.fillEllipse(0, 0, 46 + tier * 6, 26 + tier * 3)
    eye.fillStyle(0x2a0a4a, 0.95); eye.fillCircle(0, 0, 11 + tier)
    eye.fillStyle(col, 1);      eye.fillCircle(0, 0, 6 + tier * 0.6)
    eye.fillStyle(0xffffff, 0.9); eye.fillCircle(-2, -2, 2.4)
    _glow(eye, col, 5 + tier, 16)
    eye.setScale(1, 0.05)
    scene.tweens.add({ targets: eye, scaleY: 1, duration: 220, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: eye, alpha: 0, scaleY: 0.05, duration: 300, delay: Math.max(0, o.durationMs - 300), ease: 'Quad.easeIn', onComplete: () => eye.destroy() })

    const fan = scene.add.graphics().setPosition(x, y).setDepth(o.depth - 0.5).setBlendMode(Phaser.BlendModes.ADD); made.push(fan)
    const reach = Math.max(o.rectW, o.rectH) * 0.7
    const prog = { a: -0.8 }
    scene.tweens.add({ targets: prog, a: 0.8, duration: o.durationMs * 0.7, ease: 'Sine.easeInOut',
      onUpdate: () => {
        fan.clear(); const ang = prog.a
        fan.fillStyle(col, 0.18); fan.beginPath(); fan.moveTo(0, 0)
        fan.lineTo(Math.cos(ang - 0.12) * reach, Math.sin(ang - 0.12) * reach + 30)
        fan.lineTo(Math.cos(ang + 0.12) * reach, Math.sin(ang + 0.12) * reach + 30)
        fan.closePath(); fan.fillPath()
        fan.lineStyle(2, pale, 0.7); fan.beginPath(); fan.moveTo(0, 0); fan.lineTo(Math.cos(ang) * reach, Math.sin(ang) * reach + 30); fan.strokePath()
      },
      onComplete: () => scene.tweens.add({ targets: fan, alpha: 0, duration: 200, onComplete: () => fan.destroy() }) })

    if (mult > 0) {
      const em = scene.add.particles(x, y + 10, _softDotTexture(scene), { lifespan: { min: 500, max: 1000 }, speedX: { min: -60, max: 60 }, speedY: { min: -30, max: 30 }, scale: { start: 0.4, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [col, pale], blendMode: 'ADD', emitting: false })
      em.setDepth(o.depth); made.push(em); em.explode(Math.round((16 + tier * 4) * mult))
      scene.time.delayedCall(o.durationMs, () => { try { em.destroy() } catch (e) {} })
    }
    return made
  },

  // ── ORC · Trophy Hunter — TROPHY THROW ───────────────────────────────────
  // The claimed weapons spin out of the throne in an arc and slam into the
  // target room, each landing with a type-coloured burst. opts.weapons = the
  // claimed trophy list [{id,color}]; more weapons = bigger barrage.
  trophyThrowFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 16, weapons: [], victims: [], ...opts }
    const tx = Number.isFinite(o.toX) ? o.toX : x + 120, ty = Number.isFinite(o.toY) ? o.toY : y
    if (!_validXY(tx, ty)) return null
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const weapons = (o.weapons && o.weapons.length) ? o.weapons : [{ id: 'blade', color: 0xd0d4dc }]
    const drawWeapon = (g, id, color, s) => {
      if (id === 'heavy') _drawKiteShield(g, s * 1.4, color)
      else if (id === 'arcane') _drawChainedOrb(g, s * 0.9, color)
      else if (id === 'faith') {
        g.fillStyle(0x3a2a18, 1); g.fillRect(-s * 1.4, -s * 0.12, s * 2.2, s * 0.24)                 // haft
        g.fillStyle(_lerpColor(color, 0x000000, 0.3), 1); g.fillRoundedRect(s * 0.5, -s * 0.72, s * 0.92, s * 1.44, s * 0.18) // maul head
        g.fillStyle(color, 0.95); g.fillRoundedRect(s * 0.62, -s * 0.56, s * 0.68, s * 1.12, s * 0.14)
        g.fillStyle(0xffffff, 0.9); g.fillRect(s * 0.9, -s * 0.42, s * 0.13, s * 0.84); g.fillRect(s * 0.68, -s * 0.1, s * 0.54, s * 0.2) // cross
      } else _drawWarAxe(g, s, color)   // blade + hunter
    }
    const n = weapons.length
    weapons.forEach((wpn, i) => {
      const col = wpn.color ?? 0xd0d4dc, spread = 30 + tier * 6
      const dx = tx + (n > 1 ? (i - (n - 1) / 2) : 0) * spread, dy = ty + (Math.random() - 0.5) * spread
      if (!_validXY(dx, dy)) return
      const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth); made.push(g)
      drawWeapon(g, wpn.id, col, 7 + tier * 0.6); _glow(g, col, 2, 8)
      const ang0 = Math.atan2(dy - y, dx - x); g.setRotation(ang0)
      const midX = (x + dx) / 2, midY = Math.min(y, dy) - 60 - tier * 8
      scene.tweens.add({ targets: g, x: midX, y: midY, rotation: ang0 + Math.PI * 4, duration: 180, delay: i * 60, ease: 'Sine.easeOut',
        onComplete: () => scene.tweens.add({ targets: g, x: dx, y: dy, rotation: g.rotation + Math.PI * 4, duration: 170, ease: 'Sine.easeIn',
          onComplete: () => {
            g.destroy()
            const flash = scene.add.graphics().setPosition(dx, dy).setDepth(o.depth + 1).setBlendMode(Phaser.BlendModes.ADD); made.push(flash)
            flash.fillStyle(_lerpColor(col, 0xffffff, 0.5), 0.9); flash.fillCircle(0, 0, 6); _glow(flash, col, 5, 12)
            scene.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: 300, ease: 'Expo.easeOut', onComplete: () => flash.destroy() })
            const ring = scene.add.graphics().setPosition(dx, dy).setDepth(o.depth + 1).setBlendMode(Phaser.BlendModes.ADD); made.push(ring)
            ring.lineStyle(2, col, 0.9); ring.strokeCircle(0, 0, 8); ring.setScale(0.4)
            scene.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => ring.destroy() })
            for (let k = 0; k < 4; k++) { const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 16, sh = scene.add.graphics().setPosition(dx, dy).setDepth(o.depth + 1); made.push(sh); sh.fillStyle(_lerpColor(col, 0x000000, 0.2), 0.9); sh.fillRect(-2, -2, 4, 4); scene.tweens.add({ targets: sh, x: dx + Math.cos(a) * d, y: dy + Math.sin(a) * d, alpha: 0, angle: 90 + Math.random() * 120, duration: 300 + Math.random() * 160, ease: 'Quad.easeOut', onComplete: () => sh.destroy() }) }
            if (mult > 0) { const em = scene.add.particles(dx, dy, _softDotTexture(scene), { lifespan: { min: 200, max: 480 }, speed: { min: 50, max: 160 }, scale: { start: 0.45, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [col, 0xffffff], blendMode: 'ADD', emitting: false }); em.setDepth(o.depth + 1); em.explode(Math.round((7 + tier * 2) * mult)); made.push(em); scene.time.delayedCall(560, () => { try { em.destroy() } catch (e) {} }) }
            scene.cameras?.main?.shake?.(90, 0.003)
          } }) })
    })
    return made
  },

  // ── MYCONID · The Bloom — fungal terrain VFX ─────────────────────────────
  // A room COLONIZING: mycelium tendrils creep outward from the centre, a spore
  // puff swells, and spores rise. Persistent bloom overlay is separate (in
  // BossArchetypeSystem); this is the one-shot "it just bloomed" animation.
  bloomFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 2.6, rectW: 200, rectH: 150, durationMs: 1100, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const GREEN = 0x6abf3d, PALE = 0x9ee870
    const reach = Math.min(o.rectW, o.rectH) * 0.5
    const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD); made.push(g)
    const tendrils = 7 + tier, seeds = []
    for (let i = 0; i < tendrils; i++) seeds.push({ a: (i / tendrils) * Math.PI * 2 + (i % 2 ? 0.3 : -0.2), len: reach * (0.6 + (i % 3) * 0.13) })
    const draw = (p) => {
      g.clear(); g.lineStyle(2, GREEN, 0.7)
      for (const s of seeds) {
        const L = s.len * p; g.beginPath(); g.moveTo(0, 0)
        for (let k = 1; k <= 6; k++) { const t = k / 6, wob = Math.sin(t * 8 + s.a * 3) * 4 * t; g.lineTo(Math.cos(s.a) * L * t + Math.cos(s.a + Math.PI / 2) * wob, Math.sin(s.a) * L * t * 0.7 + Math.sin(s.a + Math.PI / 2) * wob) }
        g.strokePath()
        g.fillStyle(PALE, 0.8); g.fillCircle(Math.cos(s.a) * L, Math.sin(s.a) * L * 0.7, 2.2)
      }
    }
    scene.tweens.addCounter({ from: 0, to: 1, duration: o.durationMs * 0.6, ease: 'Cubic.easeOut', onUpdate: (tw) => draw(tw.getValue()),
      onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: o.durationMs * 0.4, onComplete: () => g.destroy() }) })
    const puff = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.4).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(puff)
    _drawMiasmaPuff(puff, 16 + tier * 2, GREEN, PALE)
    scene.tweens.add({ targets: puff, scale: 1.2, alpha: 0.6, duration: o.durationMs * 0.4, yoyo: true, onComplete: () => puff.destroy() })
    if (mult > 0) { const em = scene.add.particles(x, y + 10, _softDotTexture(scene), { lifespan: { min: 700, max: 1400 }, speedY: { min: -40, max: -14 }, speedX: { min: -30, max: 30 }, x: { min: -o.rectW * 0.4, max: o.rectW * 0.4 }, scale: { start: 0.4, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [GREEN, PALE], blendMode: 'ADD', emitting: false }); em.setDepth(o.depth + 0.5); em.explode(Math.round((14 + tier * 4) * mult)); made.push(em); scene.time.delayedCall(o.durationMs, () => { try { em.destroy() } catch (e) {} }) }
    return made
  },

  // A spore-POD erupting: the cap splits, a spore cloud billows out, specks fly.
  sporeBurstFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 14, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const GREEN = 0x6abf3d, PALE = 0x9ee870
    const pod = scene.add.graphics().setPosition(x, y).setDepth(o.depth); made.push(pod)
    pod.fillStyle(_lerpColor(GREEN, 0x000000, 0.2), 1); pod.fillEllipse(0, 0, 16 + tier * 2, 18 + tier * 2)
    pod.fillStyle(PALE, 0.6); pod.fillEllipse(-3, -4, 7, 8)
    scene.tweens.add({ targets: pod, scaleY: 0.2, scaleX: 1.5, alpha: 0, duration: 200, ease: 'Back.easeIn', onComplete: () => pod.destroy() })
    const cloud = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.3).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(cloud)
    _drawMiasmaPuff(cloud, 18 + tier * 3, GREEN, PALE)
    scene.tweens.add({ targets: cloud, scale: 1.6, alpha: 0.7, duration: 260, ease: 'Quad.easeOut', delay: 120,
      onComplete: () => scene.tweens.add({ targets: cloud, alpha: 0, scale: 2, duration: 400, onComplete: () => cloud.destroy() }) })
    if (mult > 0) { const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 400, max: 900 }, speed: { min: 40, max: 140 }, scale: { start: 0.5, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: [GREEN, PALE, 0xffffaa], blendMode: 'ADD', emitting: false }); em.setDepth(o.depth + 0.5); em.explode(Math.round((12 + tier * 3) * mult)); made.push(em); scene.time.delayedCall(900, () => { try { em.destroy() } catch (e) {} }) }
    return made
  },

  // A spore VENT on a hero (DoT tell): a cloud puffs up off them and drifts.
  sporeVentFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 14, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const GREEN = 0x6abf3d, PALE = 0x9ee870
    const cloud = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(0); made.push(cloud)
    _drawMiasmaPuff(cloud, 12 + tier * 1.5, GREEN, PALE)
    scene.tweens.add({ targets: cloud, scale: 1.1, alpha: 0.65, y: y - 8, duration: 300, ease: 'Sine.easeOut',
      onComplete: () => scene.tweens.add({ targets: cloud, alpha: 0, y: cloud.y - 10, scale: 1.4, duration: 380, onComplete: () => cloud.destroy() }) })
    if (mult > 0) { const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 300, max: 700 }, speedY: { min: -30, max: -8 }, speedX: { min: -18, max: 18 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: [GREEN, PALE], blendMode: 'ADD', emitting: false }); em.setDepth(o.depth + 0.3); em.explode(Math.round(7 * mult)); made.push(em); scene.time.delayedCall(700, () => { try { em.destroy() } catch (e) {} }) }
    return made
  },

  // ROT creeping across the floor (fight floor-zone hazard): an irregular
  // discoloured blotch swells in, bubbles, then fades.
  creepingRotFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 1.6, radius: 26, durationMs: 1400, ...opts }
    const mult = _particlesMult(), made = []
    const ROT = 0x4a6b2a, DARK = 0x243a16, PALE = 0x8fcf5a
    const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth).setAlpha(0); made.push(g)
    let seed = (Math.floor(x * 7 + y * 13) >>> 0) || 1
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    g.fillStyle(DARK, 0.55); g.beginPath()
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2, r = o.radius * (0.7 + rnd() * 0.5); const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.6; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py) }
    g.closePath(); g.fillPath()
    g.fillStyle(ROT, 0.5); g.fillEllipse(0, 0, o.radius * 1.1, o.radius * 0.6)
    g.fillStyle(PALE, 0.3); g.fillEllipse(-o.radius * 0.2, -2, o.radius * 0.4, o.radius * 0.22)
    g.setScale(0.3)
    scene.tweens.add({ targets: g, scale: 1, alpha: 0.85, duration: o.durationMs * 0.25, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: o.durationMs * 0.4, delay: o.durationMs * 0.35, onComplete: () => g.destroy() }) })
    if (mult > 0) { const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 500, max: 1000 }, speedY: { min: -22, max: -6 }, x: { min: -o.radius, max: o.radius }, scale: { start: 0.28, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [ROT, PALE] }); em.setDepth(o.depth + 0.3); made.push(em); scene.time.delayedCall(o.durationMs * 0.7, () => { try { em.stop() } catch (e) {} ; scene.time.delayedCall(600, () => { try { em.destroy() } catch (e) {} }) }) }
    return made
  },

  // The T4 throne FINALE: the arena erupts — a ring of pod-bursts, a swelling
  // green haze, a wide spore explosion + shake.
  bloomFinaleFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 4, depth: 16, rectW: 300, rectH: 220, durationMs: 1400, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const GREEN = 0x6abf3d, PALE = 0x9ee870
    const n = 6 + tier
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, d = o.rectW * 0.3 * (0.4 + Math.random() * 0.6), bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d * 0.7; scene.time.delayedCall(i * 60, () => { const r = AbilityVfx.sporeBurstFx(scene, bx, by, { tier }); if (Array.isArray(r)) made.push(...r) }) }
    const haze = scene.add.graphics().setPosition(x, y).setDepth(o.depth - 0.5).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0); made.push(haze)
    haze.fillStyle(GREEN, 0.22); haze.fillEllipse(0, 0, o.rectW, o.rectH * 0.7); haze.fillStyle(PALE, 0.12); haze.fillEllipse(0, 0, o.rectW * 0.6, o.rectH * 0.4)
    scene.tweens.add({ targets: haze, scale: 1.1, alpha: 1, duration: o.durationMs * 0.3, yoyo: true, hold: o.durationMs * 0.4, onComplete: () => haze.destroy() })
    if (mult > 0) { const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 800, max: 1600 }, speed: { min: 30, max: 120 }, angle: { min: 0, max: 360 }, scale: { start: 0.5, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: [GREEN, PALE, 0xffffaa], blendMode: 'ADD', emitting: false }); em.setDepth(o.depth); em.explode(Math.round(40 * mult)); made.push(em); scene.time.delayedCall(o.durationMs, () => { try { em.destroy() } catch (e) {} }) }
    scene.cameras?.main?.shake?.(400, 0.005)
    return made
  },

  // ── DEMON · The Brimstone Pact — infernal VFX ────────────────────────────
  // INFERNAL PACT: the sacrificed imp erupts, a stream of fire arcs to the
  // Demon, then hellfire rains on the room (reuses the inferno room-eruption).
  infernalPactFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 13, rectW: 220, rectH: 150, durationMs: 1300, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    // 1) the fuel-imp combusts at (fromX,fromY).
    if (_validXY(o.fromX, o.fromY)) { const m = this.combustFx(scene, o.fromX, o.fromY, { depth: o.depth }); if (m) made.push(...m) }
    // 2) a fire-stream arcs from the imp to the Demon (the soul feeds the pact).
    if (_validXY(o.fromX, o.fromY) && _validXY(o.demonX, o.demonY) && mult > 0) {
      const stream = scene.add.particles(o.fromX, o.fromY, _softDotTexture(scene), { lifespan: 360, frequency: 18, quantity: 2, tint: [0xffcc44, 0xff5511], scale: { start: 0.5, end: 0.1 }, alpha: { start: 0.95, end: 0 }, blendMode: 'ADD', moveToX: o.demonX, moveToY: o.demonY - 8 })
      stream.setDepth(o.depth + 1); made.push(stream)
      scene.time.delayedCall(420, () => { try { stream.stop() } catch (e) {} ; scene.time.delayedCall(400, () => { try { stream.destroy() } catch (e) {} }) })
    }
    // 3) after a beat, the room ERUPTS in hellfire (reuse the inferno ULT).
    scene.time.delayedCall(260, () => {
      const m = this.infernoFx(scene, x, y, { depth: o.depth, rectW: o.rectW, rectH: o.rectH, durationMs: o.durationMs, count: 8 + tier * 2 })
      if (Array.isArray(m)) made.push(...m)
    })
    return made
  },

  // BRIMSTONE METEOR: a fiery rock plummets from above with a trail, then
  // detonates on impact.
  brimstoneMeteorFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 14, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const sx = x - 40, sy = y - 150 - tier * 10
    const rock = scene.add.graphics().setPosition(sx, sy).setDepth(o.depth + 1).setBlendMode(Phaser.BlendModes.ADD); made.push(rock)
    const r = 5 + tier
    rock.fillStyle(0x3a1604, 1); rock.fillCircle(0, 0, r)
    rock.fillStyle(0xff6a1e, 0.9); rock.fillCircle(-r * 0.3, -r * 0.3, r * 0.6)
    rock.fillStyle(0xffe89a, 0.9); rock.fillCircle(-r * 0.4, -r * 0.4, r * 0.3)
    _glow(rock, 0xff7722, 5, 12)
    let trail = null
    if (mult > 0) { trail = scene.add.particles(0, 0, _softDotTexture(scene), { follow: rock, lifespan: 280, frequency: 16, quantity: 1, tint: [0xffcc44, 0xff4411], scale: { start: 0.5, end: 0 }, alpha: { start: 0.85, end: 0 }, blendMode: 'ADD' }); trail.setDepth(o.depth); made.push(trail) }
    scene.tweens.add({ targets: rock, x, y, duration: 280, ease: 'Quad.easeIn',
      onComplete: () => {
        rock.destroy(); if (trail) { try { trail.stop() } catch (e) {} ; scene.time.delayedCall(320, () => { try { trail.destroy() } catch (e) {} }) }
        const m = this.combustFx(scene, x, y, { depth: o.depth + 1 }); if (m) made.push(...m)
      } })
    return made
  },

  // THE PACT FULFILLED (T4 finale): the arena becomes an inferno — a giant
  // hellfire eruption + a ring of meteor impacts + a hot screen flash + shake.
  pactFinaleFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 4, depth: 14, rectW: 300, rectH: 220, durationMs: 1600, ...opts }
    const made = []
    const m0 = this.infernoFx(scene, x, y, { depth: o.depth, rectW: o.rectW * 1.1, rectH: o.rectH * 1.1, durationMs: o.durationMs, count: 16 })
    if (Array.isArray(m0)) made.push(...m0)
    const n = 8
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, d = o.rectW * 0.3 * (0.4 + Math.random() * 0.6)
      const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d * 0.7
      scene.time.delayedCall(i * 80 + Math.random() * 60, () => { const m = this.brimstoneMeteorFx(scene, bx, by, { tier: 4 }); if (Array.isArray(m)) made.push(...m) })
    }
    // hot screen flash
    const cam = scene.cameras?.main
    if (cam) {
      const flash = scene.add.rectangle(cam.midPoint.x, cam.midPoint.y, cam.width / cam.zoom, cam.height / cam.zoom, 0xff5511, 0.32).setScrollFactor(0).setDepth(o.depth + 5).setBlendMode(Phaser.BlendModes.ADD); made.push(flash)
      scene.tweens.add({ targets: flash, alpha: 0, duration: 520, ease: 'Quad.easeOut', onComplete: () => flash.destroy() })
    }
    scene.cameras?.main?.shake?.(600, 0.008)
    return made
  },

  // ── GOLEM · The Living Fortress — seismic VFX ────────────────────────────
  // A flung chunk of rubble (shaded irregular polygon) used across the set.
  _spawnRubble(scene, x, y, depth, size, vx, vy, life) {
    const g = scene.add.graphics().setPosition(x, y).setDepth(depth)
    _drawRockShard(g, size, [0x6a5a44, 0x554835, 0x7a6a4a][Math.floor(Math.random() * 3)])
    scene.tweens.add({ targets: g, x: x + vx, y: y + vy, rotation: (Math.random() - 0.5) * 6, duration: life, ease: 'Quad.easeOut' })
    scene.tweens.add({ targets: g, alpha: 0, duration: life * 0.4, delay: life * 0.6, onComplete: () => g.destroy() })
    return g
  },

  // SEISMIC SLAM — radiating ground cracks + dust ring + flung rubble + shake.
  seismicSlamFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 2.6, rectW: 200, rectH: 150, small: false, durationMs: 800, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const scl = o.small ? 0.55 : 1
    const reach = Math.min(o.rectW, o.rectH) * 0.5 * scl
    // radiating cracks
    const g = scene.add.graphics().setPosition(x, y).setDepth(o.depth); made.push(g)
    const arms = 5 + tier
    const drawCracks = (p) => {
      g.clear(); g.lineStyle(2.4 * scl, 0x2a221a, 0.9)
      for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2 + (i % 2 ? 0.25 : -0.2), L = reach * p
        g.beginPath(); g.moveTo(0, 0)
        for (let k = 1; k <= 5; k++) { const t = k / 5, wob = Math.sin(t * 9 + i) * 5 * scl; g.lineTo(Math.cos(a) * L * t + Math.cos(a + Math.PI / 2) * wob, (Math.sin(a) * L * t + Math.sin(a + Math.PI / 2) * wob) * 0.6) }
        g.strokePath()
      }
      g.lineStyle(1, 0xd8a24a, 0.5)   // faint amber seam glint
      for (let i = 0; i < arms; i++) { const a = (i / arms) * Math.PI * 2 + (i % 2 ? 0.25 : -0.2); g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * reach * p * 0.7, Math.sin(a) * reach * p * 0.7 * 0.6); g.strokePath() }
    }
    scene.tweens.addCounter({ from: 0, to: 1, duration: 160, ease: 'Quad.easeOut', onUpdate: (tw) => drawCracks(tw.getValue()),
      onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: o.durationMs * 0.6, delay: o.durationMs * 0.3, onComplete: () => g.destroy() }) })
    // expanding dust ring
    const dust = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.3).setAlpha(0.5); made.push(dust)
    dust.fillStyle(0x8a7a60, 0.4); dust.fillEllipse(0, 0, reach * 1.2, reach * 0.7)
    dust.setScale(0.3)
    scene.tweens.add({ targets: dust, scale: 1, alpha: 0, duration: o.durationMs * 0.7, ease: 'Quad.easeOut', onComplete: () => dust.destroy() })
    // flung rubble
    for (let i = 0; i < (o.small ? 4 : 7 + tier); i++) {
      const a = Math.random() * Math.PI * 2, d = (24 + Math.random() * 30) * scl
      made.push(this._spawnRubble(scene, x, y, o.depth + 1, (3 + Math.random() * 3) * scl, Math.cos(a) * d, -Math.abs(Math.sin(a)) * d - 18, 360 + Math.random() * 200))
    }
    // dust motes
    if (mult > 0) { const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 400, max: 900 }, speed: { min: 20, max: 90 * scl }, angle: { min: 200, max: 340 }, scale: { start: 0.5 * scl, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0x9a8460, 0x6a5a44], emitting: false }); em.setDepth(o.depth + 0.5); em.explode(Math.round((10 + tier * 3) * mult * scl)); made.push(em); scene.time.delayedCall(o.durationMs, () => { try { em.destroy() } catch (e) {} }) }
    scene.cameras?.main?.shake?.(o.small ? 140 : 280 + tier * 30, (o.small ? 0.003 : 0.006))
    return made
  },

  // FISSURE — a jagged crack tears open with a glowing amber seam; lingers.
  fissureFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 2.5, rectW: 200, durationMs: 4000, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const len = Math.min(o.rectW * 0.8, 80 + tier * 24), w = 4 + tier
    const ang = (Math.random() - 0.5) * 0.6
    const g = scene.add.graphics().setPosition(x, y).setRotation(ang).setDepth(o.depth); made.push(g)
    // dark crack body (jagged filled band) + glowing seam
    const pts = []
    for (let i = 0; i <= 10; i++) { const t = i / 10, px = (t - 0.5) * len, jit = Math.sin(t * 14) * w * 0.5; pts.push([px, jit]) }
    g.fillStyle(0x140f0a, 0.9); g.beginPath(); g.moveTo(pts[0][0], pts[0][1] - w)
    for (const [px, py] of pts) g.lineTo(px, py - w * (0.5 + Math.random() * 0.3))
    for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1] + w * (0.5 + Math.random() * 0.3))
    g.closePath(); g.fillPath()
    g.lineStyle(2, 0xff7a1e, 0.75).beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const [px, py] of pts) g.lineTo(px, py); g.strokePath()  // magma seam
    g.lineStyle(1, 0xffd27a, 0.6).beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const [px, py] of pts) g.lineTo(px, py); g.strokePath()
    _glow(g, 0xff7a1e, 2, 8)
    g.setScale(0, 1)
    scene.tweens.add({ targets: g, scaleX: 1, duration: 180, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: g, alpha: 0, duration: o.durationMs * 0.4, delay: o.durationMs * 0.6, onComplete: () => g.destroy() })
    // heat/dust rising from the seam over its life
    if (mult > 0) { const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: 800, frequency: 120, quantity: 1, x: { min: -len / 2, max: len / 2 }, speedY: { min: -26, max: -8 }, scale: { start: 0.34, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0xff8a3a, 0x8a7a60], blendMode: 'ADD' }); em.setDepth(o.depth + 0.5); made.push(em); scene.time.delayedCall(o.durationMs * 0.7, () => { try { em.stop() } catch (e) {} ; scene.time.delayedCall(900, () => { try { em.destroy() } catch (e) {} }) }) }
    return made
  },

  // RISE PILLAR — a stone column heaves up from the floor with debris + dust.
  risePillarFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 6, durationMs: 700, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), made = []
    const w = 14 + tier * 2, h = 34 + tier * 6
    // base crack telegraph + dust
    const base = scene.add.graphics().setPosition(x, y).setDepth(o.depth - 0.5).setAlpha(0.6); made.push(base)
    base.fillStyle(0x8a7a60, 0.4); base.fillEllipse(0, 0, w * 2.2, w * 0.9)
    scene.tweens.add({ targets: base, scale: 1.4, alpha: 0, duration: o.durationMs * 0.6, onComplete: () => base.destroy() })
    // the pillar — a detailed bevelled stone block rooted at the floor, with a
    // jagged broken cap, heaving up from below.
    const p = scene.add.graphics().setPosition(x, y).setDepth(o.depth); made.push(p)
    _drawStoneSlab(p, w, h, 0x6a5a44, -h / 2)   // base at local 0 → grows from floor
    // broken/cracked top edge — a couple of jagged chips off the cap
    p.fillStyle(_lerpColor(0x6a5a44, 0xffffff, 0.3), 0.9)
    p.beginPath(); p.moveTo(-w * 0.5, -h); p.lineTo(-w * 0.2, -h - 5); p.lineTo(w * 0.1, -h); p.lineTo(w * 0.5, -h - 3); p.lineTo(w * 0.5, -h + 3); p.lineTo(-w * 0.5, -h + 3); p.closePath(); p.fillPath()
    p.setScale(1, 0)
    scene.tweens.add({ targets: p, scaleY: 1, duration: 150, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({ targets: p, scaleY: 0.9, alpha: 0, y: y + 4, duration: o.durationMs * 0.4, delay: o.durationMs * 0.3, ease: 'Quad.easeIn', onComplete: () => p.destroy() }) })
    // debris kicked out at the base
    for (let i = 0; i < 4 + tier; i++) { const a = Math.random() * Math.PI * 2, d = 16 + Math.random() * 18; made.push(this._spawnRubble(scene, x, y, o.depth + 1, 2.5 + Math.random() * 2, Math.cos(a) * d, -Math.abs(Math.sin(a)) * d - 14, 320 + Math.random() * 160)) }
    scene.cameras?.main?.shake?.(160, 0.003)
    return made
  },

  // BULWARK (boss) — detailed bevelled stone slabs slam in from all sides and
  // interlock into a fortress shell around the Golem: each locks with a chip-spall,
  // the boss flashes stone-grey (hardened), then the shell crumbles at window-end.
  // Named golemBulwarkFx so it doesn't clobber the minion `bulwarkFx`.
  golemBulwarkFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 1, depth: 9, durationMs: 2600, ...opts }
    const tier = Math.max(1, Math.min(4, o.tier)), mult = _particlesMult(), made = []
    const STONE = 0x6a5a44
    const n = 7 + tier, R = 28 + tier * 3
    const plates = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      // depth-sort: plates at the top of the ring sit BEHIND the boss, bottom in front.
      const plate = scene.add.graphics().setDepth(o.depth + (Math.sin(a) > 0 ? 0.5 : -0.5)).setRotation(a + Math.PI / 2)
      _drawStoneSlab(plate, 13 + tier * 1.5, 24 + tier * 2.5, STONE)
      const sx = x + Math.cos(a) * R * 2.4, sy = y + Math.sin(a) * R * 1.5
      plate.setPosition(sx, sy).setAlpha(0).setScale(0.7)
      made.push(plate); plates.push({ plate, a })
      scene.tweens.add({ targets: plate, x: x + Math.cos(a) * R, y: y + Math.sin(a) * R * 0.62, alpha: 0.98, scale: 1, duration: 150 + i * 8, ease: 'Quad.easeIn',
        onComplete: () => {
          scene.tweens.add({ targets: plate, scaleX: 1.08, duration: 70, yoyo: true })   // lock-in overshoot
          for (let k = 0; k < 2; k++) {   // chips spall at the seam
            const g2 = scene.add.graphics().setPosition(plate.x, plate.y).setDepth(o.depth + 1); _drawRockShard(g2, 2 + Math.random() * 1.5, STONE); made.push(g2)
            const ca = a + (Math.random() - 0.5)
            scene.tweens.add({ targets: g2, x: plate.x + Math.cos(ca) * 14, y: plate.y + Math.sin(ca) * 14 + 8, angle: (Math.random() - 0.5) * 200, alpha: 0, duration: 340, ease: 'Quad.easeIn', onComplete: () => g2.destroy() })
          }
        } })
    }
    // hardening flash on the boss + a dust ring as the shell locks
    scene.time.delayedCall(190, () => {
      const flash = scene.add.graphics().setPosition(x, y).setDepth(o.depth + 0.6).setBlendMode(Phaser.BlendModes.ADD); made.push(flash)
      flash.fillStyle(0xb8b0a0, 0.45); flash.fillCircle(0, 0, R * 0.9); flash.setScale(0.5)
      scene.tweens.add({ targets: flash, scale: 1.3, alpha: 0, duration: 320, onComplete: () => flash.destroy() })
      if (mult > 0) { const em = scene.add.particles(x, y + R * 0.5, _softDotTexture(scene), { lifespan: { min: 400, max: 800 }, speedX: { min: -60, max: 60 }, speedY: { min: -10, max: 24 }, x: { min: -R, max: R }, scale: { start: 0.5, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0x9a8460, 0x6a5a44], emitting: false }); em.setDepth(o.depth - 0.5); em.explode(Math.round((10 + tier * 2) * mult)); made.push(em); scene.time.delayedCall(900, () => { try { em.destroy() } catch (e) {} }) }
    })
    // crumble: the shell falls apart as the DR window ends
    scene.time.delayedCall(Math.max(420, o.durationMs - 380), () => {
      for (const { plate, a } of plates) { if (!plate.active) continue; scene.tweens.add({ targets: plate, y: plate.y + 26, x: plate.x + Math.cos(a) * 6, angle: (Math.random() - 0.5) * 60, alpha: 0, duration: 360, ease: 'Quad.easeIn', onComplete: () => plate.destroy() }) }
    })
    scene.cameras?.main?.shake?.(200, 0.004)
    return made
  },

  // COLLAPSE — the ceiling caves: rubble rains across the room + a dust pall.
  collapseFx(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { tier: 4, depth: 16, rectW: 260, rectH: 190, durationMs: 1500, ...opts }
    const mult = _particlesMult(), made = []
    const halfW = o.rectW / 2, halfH = o.rectH / 2
    // dust pall fills the room
    const pall = scene.add.graphics().setPosition(x, y).setDepth(o.depth - 1).setAlpha(0); made.push(pall)
    pall.fillStyle(0x6a5a44, 0.3); pall.fillEllipse(0, 0, o.rectW, o.rectH * 0.8)
    pall.fillStyle(0x4a4036, 0.25); pall.fillEllipse(0, 6, o.rectW * 0.7, o.rectH * 0.5)
    scene.tweens.add({ targets: pall, alpha: 1, duration: o.durationMs * 0.25, yoyo: true, hold: o.durationMs * 0.4, onComplete: () => pall.destroy() })
    // rubble rains from the top of the room to random floor points
    const n = 12 + (o.tier ?? 4) * 2
    for (let i = 0; i < n; i++) {
      const tx = x + (Math.random() * 2 - 1) * halfW * 0.9, ty = y + (Math.random() * 2 - 1) * halfH * 0.7
      scene.time.delayedCall(Math.random() * o.durationMs * 0.55, () => {
        if (!_validXY(tx, ty)) return
        const rock = scene.add.graphics().setPosition(tx, ty - 120).setDepth(o.depth); made.push(rock)
        const s = 3 + Math.random() * 4
        _drawRockShard(rock, s, [0x6a5a44, 0x554835, 0x7a6a4a][Math.floor(Math.random() * 3)])
        scene.tweens.add({ targets: rock, y: ty, rotation: (Math.random() - 0.5) * 4, duration: 240, ease: 'Quad.easeIn',
          onComplete: () => {
            const d = scene.add.graphics().setPosition(tx, ty).setDepth(o.depth + 0.2).setAlpha(0.6); made.push(d)
            d.fillStyle(0x8a7a60, 0.5); d.fillEllipse(0, 0, s * 4, s * 1.6); d.setScale(0.4)
            scene.tweens.add({ targets: d, scale: 1.2, alpha: 0, duration: 320, onComplete: () => d.destroy() })
            scene.tweens.add({ targets: rock, alpha: 0, duration: 400, delay: 200, onComplete: () => rock.destroy() })
          } })
      })
    }
    if (mult > 0) { const em = scene.add.particles(x, y, _softDotTexture(scene), { lifespan: { min: 700, max: 1500 }, speedX: { min: -60, max: 60 }, speedY: { min: -20, max: 40 }, scale: { start: 0.6, end: 0 }, alpha: { start: 0.5, end: 0 }, tint: [0x9a8460, 0x6a5a44], emitting: false }); em.setDepth(o.depth); em.explode(Math.round(36 * mult)); made.push(em); scene.time.delayedCall(o.durationMs, () => { try { em.destroy() } catch (e) {} }) }
    scene.cameras?.main?.shake?.(620, 0.009)
    return made
  },
}
