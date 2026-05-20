// roomThumbnailCache — renders construction-menu room thumbnails
// synchronously at DISPLAY size (no downscale step, no cache key
// to go stale). Each call produces a fresh canvas sized to the
// final display dimensions so what gets drawn is exactly what
// displays — no canvas-to-canvas drawImage scaling, no CSS scaling
// quirks, no "drawing buffer ≠ display size" desync.
//
// Approach mirrors DungeonRenderer + BuildMenu._renderRoomPreview:
//   1. Procedural floor per cell (color via _adjustHex on FLOOR_BASE
//      with roomDef.colorAdjust.floor applied)
//   2. Themesprite overlays from tileLayout (rotation, flip, cov)
//      with colorAdjust applied via pixel-level HSL math
//   3. Procedural dark-stone wall fill on any perimeter cell NOT
//      covered by a themesprite — the BuildMenu safety net that
//      guarantees every room reads as enclosed on all 4 sides

import { EventBus } from '../systems/EventBus.js'

const FLOOR_BASE  = 0x0d1e30
const FLOOR_LIGHT = 0x122439
const FLOOR_DARK  = 0x0a1825
const WALL_COLOR  = 0x1c1820

// Public API — kept compatible with the old async/cache shape so
// LeftPanels doesn't need wholesale changes.
export function getRoomThumbnail(roomId) {
  return _cache.get(roomId) ?? null
}

export function precacheRoomThumbnails(roomDefs) {
  if (!Array.isArray(roomDefs)) return
  for (const def of roomDefs) {
    if (!def?.id) continue
    const canvas = _renderRoom(def)
    if (canvas) {
      _cache.set(def.id, canvas)
      EventBus.emit('ROOM_THUMBNAIL_READY', { roomId: def.id })
    } else {
      _cache.delete(def.id)
    }
  }
}

export function clearRoomThumbnailCache() {
  _cache.clear()
}

const _cache = new Map()

// ── Algorithms ─────────────────────────────────────────────────
function _tileHash(x, y) {
  let h = (x | 0) * 73856093 ^ (y | 0) * 19349663
  h = (h ^ (h >>> 13)) >>> 0
  return h
}

function _adjustHex(hex, adj) {
  if (!adj) return hex
  const { hue = 0, sat = 0, bright = 0, contrast = 0 } = adj
  if (!hue && !sat && !bright && !contrast) return hex
  let r = ((hex >> 16) & 0xff) / 255
  let g = ((hex >>  8) & 0xff) / 255
  let b = ( hex        & 0xff) / 255
  if (bright)   { const f = 1 + bright; r *= f; g *= f; b *= f }
  if (contrast) { const f = 1 + contrast; r = (r - 0.5) * f + 0.5; g = (g - 0.5) * f + 0.5; b = (b - 0.5) * f + 0.5 }
  if (hue || sat) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    let h = 0, s = 0, l = (mx + mn) / 2
    if (mx !== mn) {
      const d = mx - mn
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
      if      (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      else if (mx === g) h = ((b - r) / d + 2) / 6
      else               h = ((r - g) / d + 4) / 6
    }
    if (hue) h = (h + hue / 360 + 1) % 1
    if (sat) s = Math.max(0, Math.min(1, s + sat))
    if (s === 0) { r = g = b = l } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
      const h2r = (p2, q2, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p2 + (q2 - p2) * 6 * t; if (t < 0.5) return q2; if (t < 2/3) return p2 + (q2 - p2) * (2/3 - t) * 6; return p2 }
      r = h2r(p, q, h + 1/3); g = h2r(p, q, h); b = h2r(p, q, h - 1/3)
    }
  }
  const ri = Math.max(0, Math.min(255, Math.round(r * 255)))
  const gi = Math.max(0, Math.min(255, Math.round(g * 255)))
  const bi = Math.max(0, Math.min(255, Math.round(b * 255)))
  return (ri << 16) | (gi << 8) | bi
}

function _hex6(n) { return '#' + (n & 0xffffff).toString(16).padStart(6, '0') }

function _readCellEntry(entry) {
  if (!entry) return null
  if (typeof entry === 'string') return { id: entry, rot: 0, flipH: false, flipV: false }
  if (typeof entry === 'object' && typeof entry.id === 'string') {
    return {
      id:    entry.id,
      rot:   Number(entry.rot) || 0,
      flipH: !!entry.flipH,
      flipV: !!entry.flipV,
    }
  }
  return null
}

function _getFrameSource(textureKey) {
  const game = window.__game
  if (!game?.textures?.exists?.(textureKey)) return null
  const tex = game.textures.get(textureKey)
  const frame = tex?.get?.(0)
  if (!frame || !frame.source?.image) return null
  return {
    image: frame.source.image,
    sx: frame.cutX || 0,
    sy: frame.cutY || 0,
    sw: frame.cutWidth  || frame.width,
    sh: frame.cutHeight || frame.height,
  }
}

// Render one room thumbnail at DISPLAY dimensions. The longest side
// of the room maps to TARGET_LONG (matches the icon-slot
// constraints), short side scales proportionally.
function _renderRoom(roomDef) {
  if (!roomDef?.width || !roomDef?.height) return null
  // NB: we used to bail when themesprite-corner wasn't loaded, but
  // that meant every render call returned null while the themesprite
  // load was still pending (Preload phase 2) — LeftPanels would
  // perpetually fall back to the stylized snapshotRoomMini icon and
  // none of the work in this module ever reached the screen. Render
  // unconditionally now: procedural floor + procedural wall fill
  // gives a valid room thumbnail even with zero themesprites loaded,
  // and themesprite overlays land progressively as textures arrive
  // (we re-render on phase changes).

  const Wt = roomDef.width
  const Ht = roomDef.height
  // Render at FULL native game resolution (32px per cell — the
  // same TILE_SIZE the live DungeonRenderer uses). This makes the
  // cached canvas a pixel-identical render of the placed room at
  // 1:1 scale. LeftPanels then downscales the source canvas to the
  // icon slot via a bilinear blit, preserving wall stone texture
  // and themesprite detail far better than rendering at the tiny
  // display resolution directly (which collapses 64×64 wall art
  // into ~18×18 blobs).
  const cellPx = 32
  const W = Wt * cellPx
  const H = Ht * cellPx

  const canvas = document.createElement('canvas')
  canvas.width  = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false

  const floorAdj = roomDef.colorAdjust?.floor
  const wallsAdj = roomDef.colorAdjust?.walls

  // Pass 1 — procedural floor, base color per cell + variant patch
  // in ~50% of cells (mirrors DungeonRenderer._drawFloorCell). At
  // small cellPx the variant patches collapse to 1-2px specks but
  // still give the floor some life vs flat fill.
  for (let ry = 0; ry < Ht; ry++) {
    for (let rx = 0; rx < Wt; rx++) {
      const px = rx * cellPx, py = ry * cellPx
      ctx.fillStyle = _hex6(_adjustHex(FLOOR_BASE, floorAdj))
      ctx.fillRect(px, py, cellPx, cellPx)
      const h = _tileHash(rx, ry)
      const bucket = h & 0xff
      if (bucket >= 128 && cellPx >= 6) {
        const variant = bucket >= 192
          ? _adjustHex(FLOOR_DARK,  floorAdj)
          : _adjustHex(FLOOR_LIGHT, floorAdj)
        const sw = Math.max(1, Math.floor(cellPx * 0.35))
        const sh = Math.max(1, Math.floor(cellPx * 0.35))
        const ox = ((h >>> 8)  & 0x7) % Math.max(1, cellPx - sw)
        const oy = ((h >>> 13) & 0x7) % Math.max(1, cellPx - sh)
        ctx.fillStyle = _hex6(variant)
        ctx.globalAlpha = 0.55
        ctx.fillRect(px + ox, py + oy, sw, sh)
        ctx.globalAlpha = 1
      }
    }
  }

  // Pass 2 — themesprite overlays. Each entry's source image is
  // drawn into a (cov*cellPx) × (cov*cellPx) box at its anchor cell.
  // Rotation + flip via canvas transform. colorAdjust is applied
  // to the source by drawing it onto a temp canvas, doing pixel-
  // level HSL math, then drawing that temp canvas into the main.
  const layout = Array.isArray(roomDef.tileLayout) ? roomDef.tileLayout : []
  const placedSpan = new Set()
  for (let ry = 0; ry < Ht; ry++) {
    const row = layout[ry] ?? []
    for (let rx = 0; rx < Wt; rx++) {
      if (placedSpan.has(`${rx},${ry}`)) continue
      const entry = _readCellEntry(row[rx])
      if (!entry) continue
      const f = _getFrameSource(`themesprite-${entry.id}`)
      if (!f) continue
      const cov = f.sw >= 128 ? 4 : f.sw >= 64 ? 2 : 1
      const isPerim = rx === 0 || ry === 0 || rx === Wt - 1 || ry === Ht - 1
      const isDoor  = entry.id.startsWith('door') || entry.id.startsWith('opening')
      const adj = (isPerim || isDoor) ? wallsAdj : floorAdj
      const adjusted = _getAdjustedThemesprite(f, adj)
      const size = cellPx * cov
      const cx = rx * cellPx + size / 2
      const cy = ry * cellPx + size / 2
      ctx.save()
      ctx.translate(cx, cy)
      if (entry.rot) ctx.rotate((entry.rot * Math.PI) / 180)
      if (entry.flipH || entry.flipV) ctx.scale(entry.flipH ? -1 : 1, entry.flipV ? -1 : 1)
      ctx.drawImage(adjusted, -size / 2, -size / 2, size, size)
      ctx.restore()
      if (cov > 1) {
        for (let dy = 0; dy < cov; dy++) {
          for (let dx = 0; dx < cov; dx++) {
            placedSpan.add(`${rx + dx},${ry + dy}`)
          }
        }
      }
    }
  }

  // Pass 3 — procedural wall fill ONLY for perimeter cells that
  // weren't covered by a themesprite anchor. Mirrors
  // DungeonRenderer's behavior: walls come from themesprites, and
  // procedural fill is only a fallback for cells the room author
  // didn't paint. For Entry Hall and friends (which fully cover
  // their perimeter with cov=2 themesprite anchors), this pass is
  // a no-op — keeping the result pixel-identical to the live
  // placed room.
  const wallHex = _hex6(_adjustHex(WALL_COLOR, wallsAdj))
  ctx.fillStyle = wallHex
  for (let rx = 0; rx < Wt; rx++) {
    if (!placedSpan.has(`${rx},0`))         ctx.fillRect(rx * cellPx, 0,                  cellPx + 0.5, cellPx + 0.5)
    if (!placedSpan.has(`${rx},${Ht - 1}`)) ctx.fillRect(rx * cellPx, (Ht - 1) * cellPx,  cellPx + 0.5, cellPx + 0.5)
  }
  for (let ry = 1; ry < Ht - 1; ry++) {
    if (!placedSpan.has(`0,${ry}`))         ctx.fillRect(0,                  ry * cellPx, cellPx + 0.5, cellPx + 0.5)
    if (!placedSpan.has(`${Wt - 1},${ry}`)) ctx.fillRect((Wt - 1) * cellPx, ry * cellPx, cellPx + 0.5, cellPx + 0.5)
  }

  return canvas
}

// Themesprite + colorAdjust → cached pre-tinted canvas at source res.
const _adjustedCache = new Map()
function _adjKey(adj) {
  if (!adj) return '_'
  return `${adj.hue || 0}_${adj.sat || 0}_${adj.bright || 0}_${adj.contrast || 0}`
}
function _getAdjustedThemesprite(f, adj) {
  // Re-use the source image directly when no adj — the most common
  // case — to avoid per-sprite getImageData round-trips.
  if (!adj || (!adj.hue && !adj.sat && !adj.bright && !adj.contrast)) {
    return f.image
  }
  // Need a key that includes the source frame too. The HTMLImageElement
  // doesn't have a stable id but its `src` attribute is unique per asset.
  const key = `${f.image.src || ''}::${f.sx},${f.sy},${f.sw},${f.sh}::${_adjKey(adj)}`
  const hit = _adjustedCache.get(key)
  if (hit) return hit
  const tmp = document.createElement('canvas')
  tmp.width = f.sw
  tmp.height = f.sh
  const tctx = tmp.getContext('2d', { willReadFrequently: true })
  tctx.imageSmoothingEnabled = false
  tctx.drawImage(f.image, f.sx, f.sy, f.sw, f.sh, 0, 0, f.sw, f.sh)
  try {
    const id = tctx.getImageData(0, 0, f.sw, f.sh)
    _adjustImageDataInPlace(id.data, adj)
    tctx.putImageData(id, 0, 0)
  } catch (_) { /* tainted canvas — leave un-adjusted */ }
  _adjustedCache.set(key, tmp)
  return tmp
}

function _adjustImageDataInPlace(data, adj) {
  const { hue = 0, sat = 0, bright = 0, contrast = 0 } = adj
  if (!hue && !sat && !bright && !contrast) return
  const brightF   = 1 + bright
  const contrastF = 1 + contrast
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    let r = data[i]     / 255
    let g = data[i + 1] / 255
    let b = data[i + 2] / 255
    if (bright)   { r *= brightF; g *= brightF; b *= brightF }
    if (contrast) {
      r = (r - 0.5) * contrastF + 0.5
      g = (g - 0.5) * contrastF + 0.5
      b = (b - 0.5) * contrastF + 0.5
    }
    if (hue || sat) {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      let h = 0, s = 0
      const l = (mx + mn) / 2
      if (mx !== mn) {
        const d = mx - mn
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        if      (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        else if (mx === g) h = ((b - r) / d + 2) / 6
        else               h = ((r - g) / d + 4) / 6
      }
      if (hue) h = (h + hue / 360 + 1) % 1
      if (sat) s = Math.max(0, Math.min(1, s + sat))
      if (s === 0) {
        r = g = b = l
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        let tr = h + 1/3, tg = h, tb = h - 1/3
        if (tr < 0) tr += 1; if (tr > 1) tr -= 1
        if (tg < 0) tg += 1; if (tg > 1) tg -= 1
        if (tb < 0) tb += 1; if (tb > 1) tb -= 1
        r = tr < 1/6 ? p + (q - p) * 6 * tr : tr < 0.5 ? q : tr < 2/3 ? p + (q - p) * (2/3 - tr) * 6 : p
        g = tg < 1/6 ? p + (q - p) * 6 * tg : tg < 0.5 ? q : tg < 2/3 ? p + (q - p) * (2/3 - tg) * 6 : p
        b = tb < 1/6 ? p + (q - p) * 6 * tb : tb < 0.5 ? q : tb < 2/3 ? p + (q - p) * (2/3 - tb) * 6 : p
      }
    }
    data[i]     = Math.max(0, Math.min(255, Math.round(r * 255)))
    data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)))
    data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)))
  }
}
