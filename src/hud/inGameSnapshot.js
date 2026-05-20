// inGameSnapshot — grab static-frame canvas snapshots of in-game
// Phaser textures so DOM panels (construction menu, roster, etc.) can
// show the exact same sprites the player sees in the dungeon view.
//
// Four helpers:
//   * snapshotMinion(defId, size)  → minion-<defId>-idle frame 0
//   * snapshotItem(spriteKey, size) → static-image item textures
//   * snapshotTrap(spriteKey, size) → trap textures (alias of item)
//   * snapshotRoomMini(roomDef, size) → real tile-sprite room preview
//
// Each returns an HTMLCanvasElement or null when the texture isn't
// loaded yet (caller should fall back to the existing glyph/sprite
// pipeline). Pixel-art rendering is preserved (`imageSmoothingEnabled
// = false`) and the resulting canvas tags itself `image-rendering:
// pixelated` so CSS upscale stays crisp.

// ── Frame source resolution ────────────────────────────────────────
function _getFrameSource(textureKey, frameIdx = 0) {
  const game = window.__game
  if (!game?.textures?.exists?.(textureKey)) return null
  const tex = game.textures.get(textureKey)
  if (!tex || !tex.frameTotal) return null
  const frame = tex.get(frameIdx)
  if (!frame || !frame.source?.image) return null
  return {
    key: textureKey + ':' + frameIdx,
    src: frame.source.image,
    sx: frame.cutX || 0,
    sy: frame.cutY || 0,
    sw: frame.cutWidth  || frame.width,
    sh: frame.cutHeight || frame.height,
  }
}

// ── Auto-crop by alpha bounds ──────────────────────────────────────
// Many sprite sheets — especially Craftpix minions with animation
// buffer space — frame the character in just the center 30-60% of
// the cut rect. Naïve aspect-fit makes those creatures (rats, slimes,
// risen bones, brimstone, plant sentinels, etc.) read as tiny dots.
// We scan the alpha channel once per texture, cache the tight bounds,
// and let _drawFit work against those.
const _boundsCache = new Map()

function _autoCropBounds(f) {
  if (_boundsCache.has(f.key)) return _boundsCache.get(f.key)
  let bounds = null
  try {
    const tmp = document.createElement('canvas')
    tmp.width  = f.sw
    tmp.height = f.sh
    const tctx = tmp.getContext('2d')
    tctx.imageSmoothingEnabled = false
    tctx.drawImage(f.src, f.sx, f.sy, f.sw, f.sh, 0, 0, f.sw, f.sh)
    const data = tctx.getImageData(0, 0, f.sw, f.sh).data
    let minX = f.sw, minY = f.sh, maxX = -1, maxY = -1
    for (let y = 0; y < f.sh; y++) {
      for (let x = 0; x < f.sw; x++) {
        const a = data[(y * f.sw + x) * 4 + 3]
        if (a > 16) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX >= minX && maxY >= minY) {
      bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    }
  } catch (_) { /* tainted canvas / etc — fall back */ }
  _boundsCache.set(f.key, bounds)
  return bounds
}

// ── Canvas helpers ─────────────────────────────────────────────────
function _makeCanvas(w, h) {
  const canvas = document.createElement('canvas')
  canvas.width  = w
  canvas.height = h
  canvas.style.imageRendering = 'pixelated'
  canvas.style.display = 'block'
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  return { canvas, ctx }
}

// Aspect-preserving fit + center draw onto a fresh square canvas.
// opts:
//   padPct    — % border around the sprite
//   autoCrop  — use alpha bounds (per-texture cached) instead of raw frame
//   minScale  — integer-snap minimum scale when source is tiny (≤16px)
function _drawFit(f, size, opts = {}) {
  const { padPct = 0.04, autoCrop = false, minScale = 1 } = opts
  const { canvas, ctx } = _makeCanvas(size, size)
  // Pick source rect — either tight alpha bounds (when autoCrop) or the
  // full cut rect, with 1px margin so anti-aliased edges aren't shaved.
  let sx, sy, sw, sh
  if (autoCrop) {
    const b = _autoCropBounds(f)
    if (b) {
      const margin = 1
      sx = f.sx + Math.max(0, b.x - margin)
      sy = f.sy + Math.max(0, b.y - margin)
      sw = Math.min(f.sw - (sx - f.sx), b.w + margin * 2)
      sh = Math.min(f.sh - (sy - f.sy), b.h + margin * 2)
    } else {
      sx = f.sx; sy = f.sy; sw = f.sw; sh = f.sh
    }
  } else {
    sx = f.sx; sy = f.sy; sw = f.sw; sh = f.sh
  }
  const usable = size * (1 - padPct * 2)
  let scale = Math.min(usable / sw, usable / sh)
  const longer = Math.max(sw, sh)
  if (longer <= 16 && scale >= 1) scale = Math.max(minScale, Math.floor(scale))
  const drawW = sw * scale
  const drawH = sh * scale
  ctx.drawImage(
    f.src, sx, sy, sw, sh,
    Math.round((size - drawW) / 2),
    Math.round((size - drawH) / 2),
    drawW, drawH,
  )
  return canvas
}

// ── Minion snapshot ────────────────────────────────────────────────
// Tries `minion-<defId>-idle` first. The mimic doesn't ship a real
// spritesheet (it's a unique entity that disguises as a chest) — when
// the live game spawns one it stays in chest form until provoked, so
// fall back to `item-treasure-chest-1` frame 0 (closed chest) for the
// roster + construction-menu thumbnail.
export function snapshotMinion(defId, size = 64) {
  if (!defId) return null
  let f = _getFrameSource(`minion-${defId}-idle`, 0)
  if (!f && defId === 'mimic') {
    f = _getFrameSource('item-treasure-chest-1', 0)
  }
  if (!f) return null
  const c = _drawFit(f, size, { padPct: 0.02, autoCrop: true })
  c.className = 'qf-snap qf-snap-minion'
  return c
}

// ── Item snapshot ──────────────────────────────────────────────────
// Items declare a `spriteKey` in items.json (e.g. 'heart-full',
// 'item-padlock') — that key resolves to a Phaser image/spritesheet
// loaded by Preload.
export function snapshotItem(spriteKey, size = 64) {
  if (!spriteKey) return null
  const f = _getFrameSource(spriteKey, 0)
  if (!f) return null
  const c = _drawFit(f, size, { padPct: 0.05, autoCrop: true, minScale: 2 })
  c.className = 'qf-snap qf-snap-item'
  return c
}

export function snapshotTrap(spriteKey, size = 64) {
  return snapshotItem(spriteKey, size)
}

// ── Animated boss idle sprite ──────────────────────────────────────
// A <canvas> that loops the down-facing idle frames of the boss's
// `${archId}-idle` sheet, driven by the registered Phaser animation
// (`${archId}-idle-down`, created in Preload._registerBossAnimations).
// Unlike the snapshot* helpers this ANIMATES, so it returns
// `{ el, stop }` — the caller MUST call stop() when removing the
// element, otherwise the frame timer leaks. Returns null when the
// boss sheet/anim isn't loaded (caller falls back to a static image).
export function animatedBossSprite(archId, size = 200) {
  if (!archId) return null
  const anim = window.__game?.anims?.get?.(`${archId}-idle-down`)
  if (!anim || !Array.isArray(anim.frames) || anim.frames.length === 0) return null

  const frames = []
  for (const af of anim.frames) {
    const fr = af?.frame
    if (!fr || !fr.source?.image) continue
    frames.push({
      src: fr.source.image,
      sx: fr.cutX || 0, sy: fr.cutY || 0,
      sw: fr.cutWidth || fr.width, sh: fr.cutHeight || fr.height,
    })
  }
  if (frames.length === 0) return null

  const { canvas, ctx } = _makeCanvas(size, size)
  canvas.className = 'qf-snap qf-snap-boss'

  // Boss sheets carry generous transparent padding, and each boss fills
  // a different fraction of its frame — so a plain frame-fit makes them
  // look small and inconsistent. Crop to the boss's actual pixels: the
  // UNION of the alpha-tight bounds across every idle frame.
  //   * union (not per-frame) → the crop holds the boss in every frame,
  //     so the idle bob never clips and the sprite never scale-jitters
  //   * per-boss → each boss is cropped to ITS own pixels, so they all
  //     end up a consistent, box-filling size whatever the sheet padding
  const crop = _bossIdleCrop(archId, frames)

  // Aspect-fit the cropped sprite into the box — computed once (every
  // idle frame shares one frame size).
  const pad    = 0.06
  const usable = size * (1 - pad * 2)
  const scale  = Math.min(usable / crop.w, usable / crop.h)
  const drawW  = crop.w * scale
  const drawH  = crop.h * scale
  const dx     = Math.round((size - drawW) / 2)
  const dy     = Math.round((size - drawH) / 2)

  let i = 0
  const draw = () => {
    const f = frames[i]
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(
      f.src,
      f.sx + crop.x, f.sy + crop.y, crop.w, crop.h,
      dx, dy, drawW, drawH,
    )
  }
  draw()

  const fps   = anim.frameRate || 6
  const timer = setInterval(() => {
    i = (i + 1) % frames.length
    draw()
  }, Math.max(40, 1000 / fps))

  return { el: canvas, stop: () => clearInterval(timer) }
}

// Tight crop rect for a boss's idle loop — the union of the alpha
// bounds of every idle frame, cached per boss. Coordinates are local
// to a frame's cut rect (all idle frames share one frame size). Falls
// back to the full frame if the alpha can't be read (tainted canvas).
const _bossIdleCropCache = new Map()
function _bossIdleCrop(archId, frames) {
  if (_bossIdleCropCache.has(archId)) return _bossIdleCropCache.get(archId)
  const fw = frames[0].sw
  const fh = frames[0].sh
  const full = { x: 0, y: 0, w: fw, h: fh }
  let uMinX = Infinity, uMinY = Infinity, uMaxX = -1, uMaxY = -1
  try {
    for (const f of frames) {
      const tmp = document.createElement('canvas')
      tmp.width  = f.sw
      tmp.height = f.sh
      const tctx = tmp.getContext('2d')
      tctx.imageSmoothingEnabled = false
      tctx.drawImage(f.src, f.sx, f.sy, f.sw, f.sh, 0, 0, f.sw, f.sh)
      const data = tctx.getImageData(0, 0, f.sw, f.sh).data
      for (let y = 0; y < f.sh; y++) {
        for (let x = 0; x < f.sw; x++) {
          if (data[(y * f.sw + x) * 4 + 3] > 16) {
            if (x < uMinX) uMinX = x
            if (x > uMaxX) uMaxX = x
            if (y < uMinY) uMinY = y
            if (y > uMaxY) uMaxY = y
          }
        }
      }
    }
  } catch (_) {
    _bossIdleCropCache.set(archId, full)
    return full
  }
  let crop = full
  if (uMaxX >= uMinX && uMaxY >= uMinY) {
    const m = 2  // small margin so anti-aliased edges aren't shaved
    const x = Math.max(0, uMinX - m)
    const y = Math.max(0, uMinY - m)
    crop = {
      x, y,
      w: Math.min(fw - x, uMaxX - uMinX + 1 + m * 2),
      h: Math.min(fh - y, uMaxY - uMinY + 1 + m * 2),
    }
  }
  _bossIdleCropCache.set(archId, crop)
  return crop
}

// Frame index for the south-facing (forward / camera-facing) idle pose
// in our LPC bake. The sheet layout (assets/sprites/adventurers/layout.json):
//   y    rows    anim         dirs (N, W, S, E)
//   0    0-3     spellcast
//   256  4-7     thrust
//   512  8-11    walk
//   768  12-15   slash
//   1024 16-19   shoot
//   1280 20      hurt (single dir)
//   1344 21-24   idle  ← south row = 23
//   1600 25-28   run
// 13 cols × 23 rows + 0 = frame 299. Using the idle pose (not walk)
// means thumbnails show a still standing character — what the player
// expects from a "who's incoming" panel.
const ADV_IDLE_SOUTH_FRAME = 299

// Adventurer LPC snapshot. Pulls the south-facing idle frame from
// `adv-<classId>-v01` (every baked class has a v01 variant) so the
// preview shows the character facing the camera, not their back.
// Includes class→source-class fallback so event classes like
// `cosplay_adventurer` / `cartographer_scholar` borrow art from the
// right baked class — mirrors AdventurerRenderer._buildLpcSprite's
// spriteSourceClassId path so the wave preview matches the in-game
// render.
// `variant` defaults to 'v01' but the caller can pass a specific
// pre-rolled spriteVariant ("knight/v07") to match an exact adv.
export function snapshotAdventurer(classId, size = 64, variant = 'v01') {
  if (!classId) return null
  // Strip a "knight/v07" combined spriteVariant into class + variant.
  let cls = classId, v = variant
  if (typeof classId === 'string' && classId.includes('/')) {
    const [c, vv] = classId.split('/')
    cls = c
    v   = vv || variant
  }
  // Special-cased event classes that don't ship an LPC bake. Mirrors
  // AdventurerRenderer._buildLpcSprite — goblins borrow the goblin
  // minion sheet (frame 0 of `minion-goblin1-idle`). Returns the
  // matching minion-style snapshot so preview UIs (wave panel, intel
  // overlay, post-wave summary) show the actual character that will
  // raid the dungeon, not an empty box.
  if (cls === 'loot_goblin') {
    return snapshotMinion('goblin1', size)
  }
  // Try the requested texture first; if missing, try v01; if STILL
  // missing, return null and let the caller fall back.
  const tryKey = (cId, vId) => `adv-${cId}-${vId}`
  let f = _getFrameSource(tryKey(cls, v), ADV_IDLE_SOUTH_FRAME)
  if (!f) f = _getFrameSource(tryKey(cls, 'v01'), ADV_IDLE_SOUTH_FRAME)
  if (!f) return null
  const c = _drawFit(f, size, { padPct: 0.02, autoCrop: true })
  c.className = 'qf-snap qf-snap-adv'
  return c
}

// ── Room thumbnail ─────────────────────────────────────────────────
// Stylized "icon" view of a room — NOT a literal scale model of
// every cell in tileLayout. Mirrors the old in-game build menu's
// look:
//   * Stone-textured perimeter wall band (themesprite-wall_c tiled)
//   * Stone corner blocks at the 4 outer corners (themesprite-corner)
//   * Solid category-color floor fill in the interior
//   * Amber door notches where the room has connectionPoints
//
// Reads as a recognisable room icon even at tiny build-card sizes
// and avoids the sparse/holes-everywhere look that comes from
// painting only the cells the tileLayout author bothered to
// specify. The category color makes each room family
// instantly-distinguishable (starter = blue, combat = red,
// treasure = gold, utility = green, special = violet).

// Category → floor color. Mirrors the BuildMenu CAT_COLOR palette.
const CAT_COLOR = {
  special:  '#8a3aff',
  starter:  '#a89048',
  trap:     '#cc4422',
  treasure: '#ddaa22',
  combat:   '#cc2244',
  utility:  '#557a4a',
  default:  '#6688aa',
}
// Per-room overrides for variety inside a category (matches the
// reference: Entry Hall = yellow, Corridor = green, Barracks =
// purple, Guard Post = brown).
const ROOM_FLOOR_OVERRIDE = {
  entry_hall:          '#a88030',
  corridor:            '#557a4a',
  starter_barracks:    '#5a3a8a',
  guard_post:          '#6a4a2a',
  treasury:            '#ddaa22',
  armory:              '#8a6230',
  crypt:               '#4a3a5a',
  catacombs:           '#3a3a4a',
  library_of_whispers: '#3a5a7a',
  boss_chamber:        '#7a2a3a',
  throne_room:         '#7a2a3a',
}

function _floorColorFor(roomDef) {
  const idColor = ROOM_FLOOR_OVERRIDE[roomDef.id]
  if (idColor) return idColor
  const cat = (roomDef.category ?? roomDef.tags?.[0] ?? 'default').toLowerCase()
  return CAT_COLOR[cat] ?? CAT_COLOR.default
}

// Paint a themesprite into a rect on the canvas, honoring optional
// rotation + flip. Returns true on success, false if the texture
// isn't loaded yet so callers can paint a colored fallback.
function _drawThemeRect(ctx, textureKey, dx, dy, dw, dh, rot = 0, flipH = false, flipV = false) {
  const f = _getFrameSource(textureKey, 0)
  if (!f) return false
  ctx.save()
  ctx.translate(dx + dw / 2, dy + dh / 2)
  if (rot) ctx.rotate((rot * Math.PI) / 180)
  if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.drawImage(f.src, f.sx, f.sy, f.sw, f.sh, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()
  return true
}

export function snapshotRoomMini(roomDef, size = 160) {
  if (!roomDef) return null
  const { canvas, ctx } = _makeCanvas(size, size)

  // Layout: outer dark frame (1px) → wall band (~18% on each side)
  // → interior floor. Corner stones occupy the 4 corner cells of
  // the wall band.
  const frame = 1
  const wallT = Math.max(4, Math.floor(size * 0.18))
  const inner = size - wallT * 2
  const innerX = wallT
  const innerY = wallT

  // 1. Outer dark frame (covers entire canvas — anything we draw
  //    on top occludes it).
  ctx.fillStyle = '#0a0a10'
  ctx.fillRect(0, 0, size, size)

  // 2. Interior floor — category/room color, slightly inset so the
  //    outer 1px frame stays visible.
  const floorColor = _floorColorFor(roomDef)
  ctx.fillStyle = floorColor
  ctx.fillRect(innerX, innerY, inner, inner)

  // Subtle inner shadow gradient on the floor for depth — soft
  // dark vignette from edges inward. Cheap and reads as "stone
  // floor in low light".
  const grad = ctx.createRadialGradient(
    size / 2, size / 2, inner * 0.25,
    size / 2, size / 2, inner * 0.7
  )
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = grad
  ctx.fillRect(innerX, innerY, inner, inner)

  // 3. Wall band — tile themesprite-wall_c along all four edges.
  //    Falls back to a flat stone color if the texture isn't loaded.
  const wallTexLoaded = !!_getFrameSource('themesprite-wall_c', 0)
  if (wallTexLoaded) {
    // Top + bottom edges between the corner blocks.
    for (let x = wallT; x < size - wallT; x += wallT) {
      const w = Math.min(wallT, size - wallT - x)
      _drawThemeRect(ctx, 'themesprite-wall_c', x, 0, w, wallT)
      _drawThemeRect(ctx, 'themesprite-wall_c', x, size - wallT, w, wallT, 180)
    }
    // Left + right edges.
    for (let y = wallT; y < size - wallT; y += wallT) {
      const h = Math.min(wallT, size - wallT - y)
      _drawThemeRect(ctx, 'themesprite-wall_c', 0, y, wallT, h, 270)
      _drawThemeRect(ctx, 'themesprite-wall_c', size - wallT, y, wallT, h, 90)
    }
  } else {
    // Flat-stone fallback.
    ctx.fillStyle = '#352f3a'
    ctx.fillRect(frame, frame, size - frame * 2, wallT - frame)                          // top
    ctx.fillRect(frame, size - wallT, size - frame * 2, wallT - frame)                   // bottom
    ctx.fillRect(frame, frame, wallT - frame, size - frame * 2)                          // left
    ctx.fillRect(size - wallT, frame, wallT - frame, size - frame * 2)                   // right
  }

  // 4. Corner stones — themesprite-corner at all 4 outer corners.
  //    Sprite is authored top-left, so we rotate/flip for the other
  //    three corners.
  const cornerLoaded = !!_getFrameSource('themesprite-corner', 0)
  if (cornerLoaded) {
    _drawThemeRect(ctx, 'themesprite-corner', 0, 0, wallT, wallT)                          // TL
    _drawThemeRect(ctx, 'themesprite-corner', size - wallT, 0, wallT, wallT, 0, true)      // TR
    _drawThemeRect(ctx, 'themesprite-corner', 0, size - wallT, wallT, wallT, 0, false, true)// BL
    _drawThemeRect(ctx, 'themesprite-corner', size - wallT, size - wallT, wallT, wallT, 0, true, true) // BR
  } else {
    ctx.fillStyle = '#1c1820'
    ctx.fillRect(frame, frame, wallT - frame, wallT - frame)
    ctx.fillRect(size - wallT, frame, wallT - frame, wallT - frame)
    ctx.fillRect(frame, size - wallT, wallT - frame, wallT - frame)
    ctx.fillRect(size - wallT, size - wallT, wallT - frame, wallT - frame)
  }

  // 5. Door notches — paint a small amber rect on each edge where
  //    the room has a connection point. Position interpolated from
  //    the connection's grid x/y onto the wall band.
  const doors = Array.isArray(roomDef.connectionPoints) ? roomDef.connectionPoints : []
  const Wt = roomDef.width  || 1
  const Ht = roomDef.height || 1
  const doorW = Math.max(4, Math.floor(wallT * 0.7))
  ctx.fillStyle = '#c8893a'
  for (const cp of doors) {
    const dir = cp.direction || cp.dir || 'N'
    const cx  = cp.x ?? 0
    const cy  = cp.y ?? 0
    if (dir === 'N') {
      const px = innerX + (cx / Wt) * inner - doorW / 2
      ctx.fillRect(px, 0, doorW, wallT)
    } else if (dir === 'S') {
      const px = innerX + (cx / Wt) * inner - doorW / 2
      ctx.fillRect(px, size - wallT, doorW, wallT)
    } else if (dir === 'W') {
      const py = innerY + (cy / Ht) * inner - doorW / 2
      ctx.fillRect(0, py, wallT, doorW)
    } else if (dir === 'E') {
      const py = innerY + (cy / Ht) * inner - doorW / 2
      ctx.fillRect(size - wallT, py, wallT, doorW)
    }
  }

  canvas.className = 'qf-snap qf-snap-room'
  return canvas
}
