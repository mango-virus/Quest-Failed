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

import { ensureAdventurerBaseSheet } from '../scenes/AdventurerBaseLoader.js'

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
  // T3 minion final-forms (beholder_tyrant, demon_lord, …) ship no
  // `minion-<id>` sheet of their own — in-game MinionRenderer draws them
  // with a boss-archetype skin via the def's `bossSkinId`. Mirror that so
  // menus (roster, MVP, bestiary) show the real form, not a placeholder.
  if (!f) {
    const def = _minionDef(defId)
    if (def?.bossSkinId) f = _getFrameSource(`${def.bossSkinId}-idle`, 0)
  }
  if (!f) return null
  const c = _drawFit(f, size, { padPct: 0.02, autoCrop: true })
  c.className = 'qf-snap qf-snap-minion'
  return c
}

// Snapshot a REVIVED-ADVENTURER minion (The Undying Court) using its carried
// LPC adventurer sprite (`adv-<class>-<variant>`) instead of the skeleton base
// it's built on — so the roster / menus show the risen hero, not a skeleton.
// Uses the south-facing idle frame (ADV_IDLE_SOUTH_FRAME) so the risen hero
// faces the camera — NOT frame 0, which is the up-facing (back) row and made
// the roster show their back. Returns null if the sheet isn't loaded.
export function snapshotRaisedAdv(spriteVariant, size = 64) {
  if (!spriteVariant) return null
  const key = `adv-${String(spriteVariant).replace('/', '-')}`
  const f = _getFrameSource(key, ADV_IDLE_SOUTH_FRAME)
  if (!f) return null
  const c = _drawFit(f, size, { padPct: 0.02, autoCrop: true })
  c.className = 'qf-snap qf-snap-minion'
  return c
}

// Look up a minion def in the loaded minionTypes.json — used to resolve
// `bossSkinId` for the T3 final-forms that have no minion sheet.
function _minionDef(defId) {
  const arr = window.__game?.cache?.json?.get?.('minionTypes')
  if (!Array.isArray(arr)) return null
  return arr.find(d => d.id === defId) ?? null
}

// ── Item snapshot ──────────────────────────────────────────────────
// Items declare a `spriteKey` in items.json (e.g. 'heart-full',
// 'item-padlock') — that key resolves to a Phaser image/spritesheet
// loaded by Preload.
export function snapshotItem(spriteKey, size = 64, frameIdx = 0) {
  if (!spriteKey) return null
  const f = _getFrameSource(spriteKey, frameIdx)
  if (!f) return null
  const c = _drawFit(f, size, { padPct: 0.05, autoCrop: true, minScale: 2 })
  c.className = 'qf-snap qf-snap-item'
  return c
}

export function snapshotTrap(spriteKey, size = 64, frameIdx = 0) {
  return snapshotItem(spriteKey, size, frameIdx)
}

// ── Animated boss idle sprite ──────────────────────────────────────
// A <canvas> that loops the down-facing idle frames of the boss's
// `${archId}-idle` sheet, driven by the registered Phaser animation
// (`${archId}-idle-down`, created in Preload._registerBossAnimations).
// Unlike the snapshot* helpers this ANIMATES, so it returns
// `{ el, stop }` — the caller MUST call stop() when removing the
// element, otherwise the frame timer leaks. Returns null when the
// boss sheet/anim isn't loaded (caller falls back to a static image).
// Shared frame-cycling animator. `frames` = [{src,sx,sy,sw,sh}, …]. Uses the
// UNION alpha-crop across every frame (so the sprite never scale-jitters or
// clips its idle bob), aspect-fits once, then loops via setInterval. The loop
// is self-cleaning: once the canvas has been mounted and later removed (panels
// re-render), or if it's created but never mounted, it stops itself — so
// callers can treat the returned `.el` like a plain element.
function _animateFrames(frames, size, { className, cacheKey, fps = 6 } = {}) {
  if (!frames || frames.length === 0) return null
  const { canvas, ctx } = _makeCanvas(size, size)
  canvas.className = className || 'qf-snap'
  const crop = _idleUnionCrop(cacheKey || 'anim', frames)
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
    ctx.drawImage(f.src, f.sx + crop.x, f.sy + crop.y, crop.w, crop.h, dx, dy, drawW, drawH)
  }
  draw()
  if (frames.length < 2) return { el: canvas, stop: () => {} }   // single frame → static
  let started = false, idle = 0
  const timer = setInterval(() => {
    if (canvas.isConnected) { started = true; idle = 0 }
    else if (started || ++idle > 40) { clearInterval(timer); return }
    i = (i + 1) % frames.length
    draw()
  }, Math.max(40, 1000 / fps))
  return { el: canvas, stop: () => clearInterval(timer) }
}

// Frames from a registered Phaser ANIM (bosses, adventurers — `…-idle-down`).
function _animatedFromAnim(animKey, size, opts = {}) {
  const anim = window.__game?.anims?.get?.(animKey)
  if (!anim || !Array.isArray(anim.frames) || anim.frames.length === 0) return null
  const frames = []
  for (const af of anim.frames) {
    const fr = af?.frame
    if (!fr || !fr.source?.image) continue
    frames.push({ src: fr.source.image, sx: fr.cutX || 0, sy: fr.cutY || 0, sw: fr.cutWidth || fr.width, sh: fr.cutHeight || fr.height })
  }
  return _animateFrames(frames, size, { cacheKey: animKey, fps: anim.frameRate || 6, ...opts })
}

// Looping idle boss sprite (`<archId>-idle-down`). { el, stop } or null.
export function animatedBossSprite(archId, size = 200) {
  if (!archId) return null
  return _animatedFromAnim(`${archId}-idle-down`, size, { className: 'qf-snap qf-snap-boss', cacheKey: 'boss:' + archId })
}

// Looping idle sprite for a placed-minion def. Preload registers per-direction
// minion anims (`minion-<id>-idle-down/up/left/right`) for every minion, so use
// the DOWN (camera-facing) row only — never cycle the whole sheet, or the sprite
// reads as turning through every direction. { el, stop } or null.
export function animatedMinion(defId, size = 64) {
  if (!defId) return null
  let a = _animatedFromAnim(`minion-${defId}-idle-down`, size, { className: 'qf-snap qf-snap-minion', cacheKey: 'min:' + defId })
  // T3 final-forms ship no `minion-<id>` sheet — they're drawn with a boss skin
  // (`<bossSkinId>-idle-down`, registered for every skin). Mirror snapshotMinion.
  if (!a) {
    const def = _minionDef(defId)
    if (def?.bossSkinId) {
      a = _animatedFromAnim(`${def.bossSkinId}-idle-down`, size, { className: 'qf-snap qf-snap-minion', cacheKey: 'boss:' + def.bossSkinId })
    }
  }
  return a
}

// Looping idle sprite for an adventurer class (`adv-<cls>-<vId>-idle-down`).
// Requires the on-demand base sheet to be loaded first (AdventurerBaseLoader).
export function animatedAdventurer(cls, size = 64, vId = 'v01') {
  if (!cls) return null
  return _animatedFromAnim(`adv-${cls}-${vId}-idle-down`, size, { className: 'qf-snap qf-snap-adv', cacheKey: 'adv:' + cls + ':' + vId })
}

// Animated sprite for a specific adventurer ACTION + direction
// (`adv-<cls>-<vId>-<anim>-<dir>`) — e.g. walk-right, slash-right, spellcast-right,
// shoot-right, run-left, hurt-down. For cinematics that need movement/combat, not
// just the idle loop. Requires the base sheet loaded (AdventurerBaseLoader). null
// if that anim isn't registered (caller falls back to idle / a glyph).
export function animatedAdventurerAnim(cls, anim = 'walk', dir = 'down', size = 64, vId = 'v01') {
  if (!cls) return null
  return _animatedFromAnim(`adv-${cls}-${vId}-${anim}-${dir}`, size,
    { className: 'qf-snap qf-snap-adv', cacheKey: `adv:${cls}:${vId}:${anim}:${dir}` })
}

// The WEAPON-bearing attack anim from the 192×192 `_atk` sheet
// (`adv-<cls>-<vId>-atk-<slash|thrust>-<dir>`) — this is where melee weapons live
// (the 64px base slash row is weaponless for oversize weapons). The body sits in
// a 192 frame (foot ≈ 0.617 down), so render at box = bodySize×3 and bottom-align
// in the caller. null if the atk sheet/anim isn't loaded → caller falls back to
// the base attack via animatedAdventurerAnim. Load the sheet first with
// requestAdvAtkSheet(scene, `adv-<cls>-<vId>`).
export function animatedAdventurerAtk(cls, anim = 'slash', dir = 'right', box = 432, vId = 'v01') {
  if (!cls) return null
  return _animatedFromAnim(`adv-${cls}-${vId}-atk-${anim}-${dir}`, box,
    { className: 'qf-snap qf-snap-adv-atk', cacheKey: `atk:${cls}:${vId}:${anim}:${dir}` })
}

// Tight crop rect for a boss's idle loop — the union of the alpha
// bounds of every idle frame, cached per boss. Coordinates are local
// to a frame's cut rect (all idle frames share one frame size). Falls
// back to the full frame if the alpha can't be read (tainted canvas).
const _idleCropCache = new Map()
function _idleUnionCrop(cacheKey, frames) {
  if (_idleCropCache.has(cacheKey)) return _idleCropCache.get(cacheKey)
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
    _idleCropCache.set(cacheKey, full)
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
  _idleCropCache.set(cacheKey, crop)
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
  // Event-replacement classes (monster_invader,
  // rival_boss_invader) ship no LPC bake of their own — they declare a
  // `spriteSourceClassId` pointing at a baked class to borrow art from.
  // Mirror AdventurerRenderer's resolution so the class still resolves a
  // sprite even when no concrete spriteVariant has been assigned yet.
  if (!f) {
    const src = _classSpriteSource(cls)
    if (src && src !== cls) {
      f = _getFrameSource(tryKey(src, v), ADV_IDLE_SOUTH_FRAME)
      if (!f) f = _getFrameSource(tryKey(src, 'v01'), ADV_IDLE_SOUTH_FRAME)
    }
  }
  if (!f) return null
  const c = _drawFit(f, size, { padPct: 0.02, autoCrop: true })
  c.className = 'qf-snap qf-snap-adv'
  return c
}

// Resolve a class id → its `spriteSourceClassId` (the baked class it
// borrows LPC art from) via the loaded adventurerClasses.json. Returns
// null when the class is baked itself / has no source / the cache is cold.
function _classSpriteSource(classId) {
  const arr = window.__game?.cache?.json?.get?.('adventurerClasses')
  if (!Array.isArray(arr)) return null
  return arr.find(d => d.id === classId)?.spriteSourceClassId ?? null
}

// Entity-aware adventurer snapshot. Takes the full adventurer OBJECT and
// returns the sprite the in-game renderer actually draws for it — needed
// for the dungeon-event invaders that don't render as LPC humans:
//   • Rival-dungeon boss            → its boss-archetype skin (_rivalBossSpriteKey)
//   • Rival monsters / Zombie Horde → a minion sheet          (_minionSheet)
//   • everything else               → the normal LPC adventurer snapshot
// Falls through to snapshotAdventurer (loot_goblin + spriteSourceClassId
// handled there) so a plain adventurer works unchanged. Menus should call
// THIS, not snapshotAdventurer, whenever they hold the adventurer object —
// otherwise event invaders render as the procedural fallback marker.
export function snapshotAdventurerEntity(adv, size = 64) {
  if (!adv) return null
  // Rival-dungeon boss — render its boss-archetype idle skin (lich-idle,
  // demon-idle, …), the same sheet the in-game renderer uses for it.
  if (adv._rivalBossSpriteKey) {
    const f = _getFrameSource(`${adv._rivalBossSpriteKey}-idle`, 0)
    if (f) {
      const c = _drawFit(f, size, { padPct: 0.04, autoCrop: true })
      c.className = 'qf-snap qf-snap-boss'
      return c
    }
  }
  // Rival monsters / Zombie Horde — `_minionSheet` is a `minion-<id>` base
  // key; snapshot its idle frame so the menu shows the monster race, not a
  // humanoid adventurer.
  if (adv._minionSheet) {
    const f = _getFrameSource(`${adv._minionSheet}-idle`, 0)
    if (f) {
      const c = _drawFit(f, size, { padPct: 0.02, autoCrop: true })
      c.className = 'qf-snap qf-snap-minion'
      return c
    }
  }
  return snapshotAdventurer(adv.spriteVariant || adv.classId || adv.kind, size)
}

// ── Live (idle-animated) variants ──────────────────────────────────
// Same look as the static snapshots, but a looping idle canvas when the anim is
// registered (sheets loaded); otherwise the static frame. The loop self-stops
// when the canvas leaves the DOM, so panels can use these like a plain element.

// {el, stop} or null — animated mirror of snapshotAdventurerEntity's resolution.
export function animatedAdventurerEntity(adv, size = 64) {
  if (!adv || adv._rivalBossSpriteKey || adv._minionSheet) return null
  const raw = adv.spriteVariant || adv.classId || adv.kind
  if (!raw || typeof raw !== 'string') return null
  if (raw === 'loot_goblin') return animatedMinion('goblin1', size)
  let cls = raw, v = 'v01'
  if (raw.includes('/')) { const p = raw.split('/'); cls = p[0]; v = p[1] || 'v01' }
  let a = animatedAdventurer(cls, size, v) || animatedAdventurer(cls, size, 'v01')
  if (!a) {
    const src = _classSpriteSource(cls)
    if (src && src !== cls) a = animatedAdventurer(src, size, v) || animatedAdventurer(src, size, 'v01')
  }
  return a
}

// Bare-element helpers: looping idle if available, else the static snapshot.
export function liveMinion(defId, size = 64) {
  return (animatedMinion(defId, size)?.el) || snapshotMinion(defId, size)
}
export function liveAdventurerEntity(adv, size = 64) {
  return (animatedAdventurerEntity(adv, size)?.el) || snapshotAdventurerEntity(adv, size)
}
export function liveAdventurer(classId, size = 64, variant = 'v01') {
  let cls = classId, v = variant
  if (typeof classId === 'string' && classId.includes('/')) { const p = classId.split('/'); cls = p[0]; v = p[1] || variant }
  return (animatedAdventurer(cls, size, v)?.el) || snapshotAdventurer(classId, size, variant)
}

// ── On-demand sheet warming for DOM previews ───────────────────────
// The 64×64 base adventurer sheets stream in ON DEMAND the first time a
// variant renders in the dungeon (AdventurerBaseLoader). During the Night
// phase the incoming wave hasn't spawned yet, so its sheets aren't loaded and
// snapshotAdventurer*() returns null — leaving DOM preview panels (Incoming
// Wave, Adventurer Intel) on the procedural-circle fallback / empty box.
//
// These helpers let a preview panel proactively warm the sheets it needs and
// re-render once they land, so it shows the real LPC sprites — mirroring the
// in-game renderer's "circle now, upgrade when loaded" behaviour.

function _gameScene() {
  const sm = window.__game?.scene
  return sm?.getScene?.('Game') ?? sm?.scenes?.find?.(s => s?.scene?.key === 'Game') ?? null
}

// The texture keys an adv object's snapshot can draw from, in priority order
// (mirrors snapshotAdventurerEntity → snapshotAdventurer resolution). If ANY
// of these exists the snapshot will render.
function _advSnapshotKeys(adv) {
  if (!adv) return []
  if (adv._rivalBossSpriteKey) return [`${adv._rivalBossSpriteKey}-idle`]
  if (adv._minionSheet)        return [`${adv._minionSheet}-idle`]
  const raw = adv.spriteVariant || adv.classId || adv.kind
  if (!raw) return []
  let cls = String(raw), v = 'v01'
  if (cls.includes('/')) { const [c, vv] = cls.split('/'); cls = c; v = vv || 'v01' }
  if (cls === 'loot_goblin') return ['minion-goblin1-idle']
  const keys = [`adv-${cls}-${v}`, `adv-${cls}-v01`]
  const src = _classSpriteSource(cls)
  if (src && src !== cls) keys.push(`adv-${src}-v01`)
  return [...new Set(keys)]
}

// True if a snapshot for this adv can render right now (its sheet is loaded).
export function advSnapshotReady(adv) {
  const game = window.__game
  return _advSnapshotKeys(adv).some(k => game?.textures?.exists?.(k))
}

// Kick the on-demand stream for any base sheet this adv needs. No-op for
// already-loaded / minion / boss-skin advs. Returns true if already renderable.
function _warmAdv(scene, adv) {
  const keys = _advSnapshotKeys(adv)
  if (!keys.length) return true
  if (keys.some(k => scene.textures.exists(k))) return true
  for (const k of keys) {
    const m = /^adv-(.+)-(v\d+)$/.exec(k)
    if (m) ensureAdventurerBaseSheet(scene, m[1], m[2])
  }
  return false
}

const _warmPollers = new Map()  // surface key → pending timeout id

// Warm the base sheets a list of adv objects needs, then call `refresh` (a
// DOM-only re-render that must NOT itself call this again) as sheets land,
// until all are renderable or a 10s cap. `key` namespaces the poll loop per
// surface so a re-open cancels the previous loop instead of stacking timers.
export function warmAdvSnapshotsThen(advs, refresh, key = 'default') {
  const prev = _warmPollers.get(key)
  if (prev) { clearTimeout(prev); _warmPollers.delete(key) }
  const scene = _gameScene()
  if (!scene || !Array.isArray(advs) || !advs.length) return
  const list = advs.map(_advSnapshotKeys).filter(k => k.length)
  if (!list.length) return
  const readyCount = () => list.filter(keys => keys.some(k => scene.textures.exists(k))).length
  let anyMissing = false
  for (const a of advs) { if (!_warmAdv(scene, a)) anyMissing = true }
  if (!anyMissing) return
  let lastReady = readyCount()
  const t0 = Date.now()
  const tick = () => {
    const ready = readyCount()
    if (ready > lastReady) { lastReady = ready; try { refresh() } catch (_) {} }
    if (ready >= list.length || Date.now() - t0 > 10000) { _warmPollers.delete(key); return }
    _warmPollers.set(key, setTimeout(tick, 220))
  }
  _warmPollers.set(key, setTimeout(tick, 220))
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
