// SellFxRenderer — "crack → break apart → dissolve" VFX when the player
// sells a room, trap, or item with the SELL tool, plus the floating "+Xg"
// refund readout.
//
// Listens for ENTITY_SOLD { kind, worldX, worldY, width, height } and runs
// the shatter. Minion sells get a death-anim → fade from MinionRenderer
// instead, so kind === 'minion' is ignored. (The "+Xg" refund readout is a
// HUD toast emitted by NightPhase — world-space text didn't render here.)
//
// All FX render at depth 90+ — above DungeonRenderer's void-occluder
// (depth 12), which previously buried the effect when a sold room's
// footprint turned to void.
//
// Tween-driven (mirrors CoinBurstRenderer): every object owns its tween
// and self-destroys on complete — no per-frame update hook needed.

import { EventBus }     from '../systems/EventBus.js'
import { Balance }      from '../config/balance.js'
import { userSettings } from '../hud/userSettings.js'
import { ensureDissolvePipeline, DISSOLVE_PIPELINE_KEY } from './DissolvePipeline.js'

// Mid-tone masonry palette — readable against both the dungeon floor and
// the dark void a sold room leaves behind.
const CHUNK_COLORS = [0x9a93a8, 0x837c92, 0xb0a8c0, 0x6f6878]
const CRACK_COLOR  = 0xf2ecff   // bright spreading fracture lines

const DEPTH_DUST  = 93
const DEPTH_CHUNK = 94
const DEPTH_FLASH = 95
const DEPTH_CRACK = 96
const DEPTH_EMBER = 97

// Particle-quality scale (matches CoinBurstRenderer's reading of the
// `qf.video.particles` user setting).
function _particlesMult() {
  try {
    const lvl = localStorage.getItem('qf.video.particles') ?? 'high'
    if (lvl === 'off') return 0
    if (lvl === 'low') return 0.5
    if (lvl === 'med') return 0.75
    return 1.0
  } catch { return 1.0 }
}

export class SellFxRenderer {
  constructor(scene) {
    this._scene = scene
    this._items = []        // live FX objects pending tween-complete cleanup
    this._destroyed = false
    this._onSold = this._onSold.bind(this)
    EventBus.on('ENTITY_SOLD', this._onSold)
  }

  destroy() {
    this._destroyed = true
    EventBus.off('ENTITY_SOLD', this._onSold)
    for (const o of this._items) o?.destroy?.()
    this._items = []
  }

  _track(obj)   { this._items.push(obj); return obj }
  _untrack(obj) { const i = this._items.indexOf(obj); if (i >= 0) this._items.splice(i, 1) }

  _onSold(p) {
    if (!p || p.kind === 'minion') return   // minion → MinionRenderer death-anim → fade
    if (p.kind === 'room') { this._shatterRoom(p); return }
    if (p.kind === 'trap' || p.kind === 'item') {
      this._shatterFromSprite(p); return
    }
    this._shatter(p)   // unknown kinds — procedural fallback
  }

  // Lookup the live Phaser sprite for a sold trap or item by instanceId,
  // checking each renderer that keeps a {id → sprite} map. Returns the
  // sprite Game Object or null. The phylactery uses a multi-part container
  // (no single sprite), so it falls through to procedural fallback.
  _findSpriteForId(id) {
    if (!id) return null
    const s = this._scene
    const tr = s.trapRenderer?._sprites?.[id]
    if (tr?.body) return tr.body
    return s.treasureChestRenderer?._sprites?.[id]
        ?? s.beaconRenderer?._sprites?.[id]
        ?? s.keyChestRenderer?._sprites?.[id]
        ?? null
  }

  // ── Room shatter: clone the actual tile sprites, then crack + scatter ──
  //
  // DungeonRenderer renders each room as a grid of tile `add.image` sprites
  // parked in its `_cTileSprites` container at depth ~1.1. ENTITY_SOLD for
  // a room fires SYNCHRONOUSLY from `_finalizeRoomSell` BEFORE the room is
  // removed from the dungeon grid — so at this moment those tile sprites
  // are still live. We clone each tile inside the footprint into a free-
  // standing Image (at depth DEPTH_CHUNK, above the void occluder) and
  // animate the clones; DungeonRenderer's subsequent redraw destroys the
  // originals but our clones are independent. Result: the *actual* tile
  // art cracks, breaks apart, and dissolves — not a procedural chunk grid.
  _shatterRoom({ worldX, worldY, width = 1, height = 1 }) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return
    const TS   = Balance.TILE_SIZE
    const fw   = Math.max(1, width)  * TS
    const fh   = Math.max(1, height) * TS
    const area = Math.max(1, width) * Math.max(1, height)
    const mult = _particlesMult()

    const pieces = this._collectRoomSurface(worldX, worldY, fw, fh)

    // Preferred path: PIXEL DISSOLVE — the actual room skin disintegrates,
    // block by block, with an ember burn-edge (WebGL only). Needs live tile
    // clones + the post-FX pipeline; otherwise we drop to the chunk shatter.
    const webgl = this._scene.renderer?.type === Phaser.WEBGL
    if (pieces.length > 0 && webgl && ensureDissolvePipeline(this._scene)) {
      this._dissolveRoom(pieces, worldX, worldY, fw, fh, area, mult)
      return
    }

    // ── Fallback: crack → break into chunks → dissolve (Canvas / no pipeline) ──
    this._cameraShake(area)
    this._spawnCracks(worldX, worldY, fw, fh)
    if (pieces.length === 0) {
      // No tile sprites found (e.g. a procedurally-rendered cell, or
      // DungeonRenderer not yet ready) — fall back to procedural chunks
      // so the player still gets a shatter.
      const cols = Math.max(2, Math.min(5, Math.round(Math.max(1, width)  * 1.3)))
      const rows = Math.max(2, Math.min(5, Math.round(Math.max(1, height) * 1.3)))
      const x0 = worldX - fw / 2
      const y0 = worldY - fh / 2
      const cw = fw / cols
      const ch = fh / rows
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          this._spawnChunk(x0 + (c + 0.5) * cw, y0 + (r + 0.5) * ch,
                           cw, ch, worldX, worldY)
        }
      }
    } else {
      for (const img of pieces) this._animateTilePiece(img, worldX, worldY)
    }

    // A little dust kicked up as the pieces dissolve.
    if (mult > 0) {
      const dust = Math.min(12, Math.max(3, Math.round((2 + area) * mult)))
      for (let i = 0; i < dust; i++) this._spawnDust(worldX, worldY, fw, fh)
    }
  }

  // ── Pixel dissolve: drive the Dissolve post-FX across the room's real tile
  //    clones in lockstep so the skin disintegrates as one continuous noise
  //    field, with an ember burn-edge + warm ash motes peeling off the front.
  _dissolveRoom(pieces, worldX, worldY, fw, fh, area, mult) {
    const TS = Balance.TILE_SIZE
    const x0 = worldX - fw / 2
    const y0 = worldY - fh / 2

    this._cameraShake(area)
    this._spawnBurnFlash(worldX, worldY, fw, fh)

    // Attach the pipeline to every surface clone. Size the noise cells to a
    // fixed ~3px world block so the dissolve reads as consistent pixel-blocks
    // on a 512px skin and a 32px tile alike, and offset each clone's field by
    // its position so the whole footprint scatters as one continuous surface.
    const BLOCK_PX = 3.5
    const pipes = []
    for (const img of pieces) {
      let pipe = null
      try {
        img.setPostPipeline(DISSOLVE_PIPELINE_KEY)
        const got = img.getPostPipeline(DISSOLVE_PIPELINE_KEY)
        pipe = Array.isArray(got) ? got[0] : got
      } catch (e) { pipe = null }
      if (pipe) {
        const dw = img.displayWidth  || TS
        const dh = img.displayHeight || TS
        pipe.blocks = [
          Math.max(4, Math.min(220, Math.round(dw / BLOCK_PX))),
          Math.max(4, Math.min(220, Math.round(dh / BLOCK_PX))),
        ]
        pipe.uOffset  = [(img.x - dw / 2 - x0) / BLOCK_PX, (img.y - dh / 2 - y0) / BLOCK_PX]
        pipe.progress = 0
        pipes.push(pipe)
      }
    }

    // Pipeline attach failed unexpectedly — fall back so the player still
    // gets feedback rather than the room vanishing with no effect.
    if (pipes.length === 0) {
      for (const img of pieces) this._animateTilePiece(img, worldX, worldY)
      return
    }

    // Lockstep dissolve. progress overshoots 1 so the last cells (threshold
    // ≈1) are guaranteed to clear. Slight ease-in = the snap accelerates.
    const proxy = { t: 0 }
    this._scene.tweens.add({
      targets:  proxy,
      t:        1.06,
      duration: 780,
      ease:     'Sine.easeIn',
      onUpdate: () => { for (const p of pipes) { try { p.progress = proxy.t } catch (e) {} } },
      onComplete: () => {
        for (const img of pieces) { this._untrack(img); try { img.destroy() } catch (e) {} }
      },
    })

    // Warm ash motes peel off the dissolving surface and rise.
    if (mult > 0) {
      const motes = Math.min(48, Math.max(8, Math.round((6 + area * 10) * mult)))
      for (let i = 0; i < motes; i++) this._spawnEmberMote(worldX, worldY, fw, fh)
    }
  }

  // A brief warm wash over the footprint at the moment of ignition.
  _spawnBurnFlash(cx, cy, fw, fh) {
    const r = this._scene.add.rectangle(cx, cy, fw, fh, 0xff7a2e, 1)
      .setDepth(DEPTH_FLASH)
      .setBlendMode(Phaser.BlendModes.ADD)
    this._track(r)
    this._scene.tweens.add({
      targets:  r,
      alpha:    { from: 0.4, to: 0 },
      scaleX:   1.04, scaleY: 1.04,
      duration: 320,
      ease:     'Quad.easeOut',
      onComplete: () => { this._untrack(r); r.destroy() },
    })
  }

  // One warm ash mote: pops in as its block chars, then rises, shrinks, and
  // fades. A small additive square reads as a pixel-ember, not a soft puff.
  _spawnEmberMote(cx, cy, fw, fh) {
    const ox = cx + (Math.random() - 0.5) * fw * 0.92
    const oy = cy + (Math.random() - 0.5) * fh * 0.92
    const sz = 2 + Math.random() * 2.5
    const warm = [0xffe39a, 0xff9d3c, 0xff6a1e, 0xfff1c2][(Math.random() * 4) | 0]
    const r = this._scene.add.rectangle(ox, oy, sz, sz, warm, 1)
      .setDepth(DEPTH_EMBER)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAngle(Math.random() * 90)
      .setAlpha(0)   // invisible until its block dissolves (after the delay)
    this._track(r)
    const rise  = 16 + Math.random() * 28
    const drift = (Math.random() - 0.5) * 18
    this._scene.tweens.add({
      targets:  r,
      x:        ox + drift,
      y:        oy - rise,
      scaleX:   0.2, scaleY: 0.2,
      angle:    r.angle + (Math.random() - 0.5) * 140,
      alpha:    { from: 1, to: 0 },
      delay:    Math.random() * 560,
      duration: 420 + Math.random() * 360,
      ease:     'Sine.easeOut',
      onComplete: () => { this._untrack(r); r.destroy() },
    })
  }

  // Collect clones of the room's actual rendered SURFACE inside the footprint:
  // a full-room SKIN image (DungeonRenderer draws one stretched image per
  // skinned room in `_cRoomSkins` and suppresses the per-cell tiles), PLUS any
  // per-cell tile sprites (themed / partially-themed rooms keep these in
  // `_cTileSprites`). A skinned room has NO entries in `_cTileSprites`, which is
  // why cloning only that container produced nothing and the sell fell back to
  // the procedural chunk shatter. Returns free-standing clones to dissolve.
  _collectRoomSurface(worldX, worldY, fw, fh) {
    const dr = this._scene._dungeonRenderer
    const out = []
    const TS = Balance.TILE_SIZE

    // 1. Full-room skin image(s): centred on the footprint (same centre the
    //    sell event reports). Match by centre proximity (< half a tile) so an
    //    adjacent room's skin — at least one tile away — is never grabbed.
    const skins = dr?._cRoomSkins?.list
    if (skins) {
      for (const src of skins.slice()) {
        if (!src || typeof src.x !== 'number' || typeof src.y !== 'number') continue
        if (Math.abs(src.x - worldX) > TS * 0.5 || Math.abs(src.y - worldY) > TS * 0.5) continue
        const clone = this._cloneTileImage(src)
        if (clone) out.push(clone)
      }
    }

    // 2. Per-cell tile sprites whose centre sits inside the footprint.
    const tiles = dr?._cTileSprites?.list
    if (tiles) {
      const x0 = worldX - fw / 2
      const y0 = worldY - fh / 2
      const x1 = x0 + fw
      const y1 = y0 + fh
      for (const src of tiles.slice()) {
        if (!src || typeof src.x !== 'number' || typeof src.y !== 'number') continue
        if (src.x < x0 || src.x >= x1 || src.y < y0 || src.y >= y1) continue
        const clone = this._cloneTileImage(src)
        if (clone) out.push(clone)
      }
    }
    return out
  }

  // Walk DungeonRenderer's tile-sprite container and clone every image
  // whose center sits inside the room footprint. Each clone is added to
  // the scene as a free Image at depth DEPTH_CHUNK with the source's
  // texture, frame, rotation, flip, and display size copied over.
  _cloneRoomTiles(worldX, worldY, fw, fh) {
    const dr = this._scene._dungeonRenderer
    const container = dr?._cTileSprites
    if (!container?.list) return []
    const x0 = worldX - fw / 2
    const y0 = worldY - fh / 2
    const x1 = x0 + fw
    const y1 = y0 + fh
    const out = []
    // Snapshot the list — DungeonRenderer's redraw will mutate the
    // container later, but we want a stable iteration NOW.
    for (const src of container.list.slice()) {
      if (!src || typeof src.x !== 'number' || typeof src.y !== 'number') continue
      if (src.x < x0 || src.x >= x1 || src.y < y0 || src.y >= y1) continue
      const clone = this._cloneTileImage(src)
      if (clone) out.push(clone)
    }
    return out
  }

  _cloneTileImage(src) {
    const texKey = src.texture?.key
    if (!texKey || !this._scene.textures?.exists?.(texKey)) return null
    const frame = src.frame?.name
    try {
      const img = this._scene.add.image(src.x, src.y, texKey, frame)
      img.setOrigin(src.originX ?? 0.5, src.originY ?? 0.5)
      // Match the source's visible size — DungeonRenderer calls
      // setDisplaySize on its tiles, which adjusts scale internally.
      if (src.displayWidth > 0 && src.displayHeight > 0) {
        img.setDisplaySize(src.displayWidth, src.displayHeight)
      } else {
        img.setScale(src.scaleX || 1, src.scaleY || 1)
      }
      img.setAngle(src.angle || 0)
      img.flipX = !!src.flipX
      img.flipY = !!src.flipY
      img.setAlpha(src.alpha ?? 1)
      img.setDepth(DEPTH_CHUNK)
      this._track(img)
      return img
    } catch { return null }
  }

  // Each tile holds in place for the "cracking" beat, then drifts outward
  // from the footprint center, rotates, falls under gravity, and fades.
  _animateTilePiece(img, originX, originY) {
    const dx = img.x - originX
    const dy = img.y - originY
    const dist = Math.hypot(dx, dy) || 1
    const dirX = dx / dist
    const dirY = dy / dist
    const fly  = 22 + Math.random() * 28
    this._scene.tweens.add({
      targets:  img,
      x:        img.x + dirX * fly,
      y:        img.y + dirY * fly + 20,        // gravity drop
      angle:    img.angle + (Math.random() - 0.5) * 70,
      alpha:    { from: img.alpha, to: 0 },
      scaleX:   img.scaleX * 0.6,
      scaleY:   img.scaleY * 0.6,
      delay:    180 + Math.random() * 140,       // hold while cracks read
      duration: 480 + Math.random() * 220,
      ease:     'Quad.easeIn',
      onComplete: () => { this._untrack(img); img.destroy() },
    })
  }

  // ── Trap / item shatter: quarter the actual sprite into 4 cropped
  //    pieces that drift apart — same "real art" treatment as the room
  //    tile-clone shatter, adapted for single-sprite entities. The
  //    sprite is looked up by instanceId in the relevant renderer (still
  //    live at this point — *_REMOVED fires AFTER ENTITY_SOLD inside the
  //    `_doSell*` methods, so its renderer hasn't destroyed it yet).
  //    Falls back to the procedural shatter when no sprite is found
  //    (phylactery, or anything not in a recognised renderer).
  _shatterFromSprite(p) {
    const src = this._findSpriteForId(p?.instanceId)
    if (!src) { this._shatter(p); return }
    const { worldX, worldY, width = 1, height = 1 } = p
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return
    const TS   = Balance.TILE_SIZE
    const fw   = Math.max(1, width)  * TS
    const fh   = Math.max(1, height) * TS
    const area = Math.max(1, width) * Math.max(1, height)
    const mult = _particlesMult()

    this._cameraShake(area)
    this._spawnCracks(worldX, worldY, fw, fh)
    const ok = this._spawnQuarteredPieces(src, worldX, worldY)
    if (!ok) { this._shatter(p); return }
    if (mult > 0) {
      const dust = Math.min(8, Math.max(2, Math.round((1 + area) * mult)))
      for (let i = 0; i < dust; i++) this._spawnDust(worldX, worldY, fw, fh)
    }
  }

  // Quarter the source sprite into 4 cropped clones (top-left / top-right /
  // bottom-left / bottom-right of its frame) and animate each drifting
  // outward in its diagonal direction. Returns true on success, false if
  // the source frame can't be measured (caller falls back to procedural).
  _spawnQuarteredPieces(src, originX, originY) {
    const texKey = src.texture?.key
    if (!texKey || !this._scene.textures?.exists?.(texKey)) return false
    const frame = src.frame
    if (!frame) return false
    const cutW = frame.cutWidth  ?? frame.width  ?? 0
    const cutH = frame.cutHeight ?? frame.height ?? 0
    if (cutW <= 0 || cutH <= 0) return false
    const halfW = cutW / 2
    const halfH = cutH / 2
    // setCrop takes coords in frame-local pixels. Each quadrant's crop +
    // its outward drift direction.
    const quads = [
      { crop: [0,     0,     halfW, halfH], dirX: -1, dirY: -1 },
      { crop: [halfW, 0,     halfW, halfH], dirX:  1, dirY: -1 },
      { crop: [0,     halfH, halfW, halfH], dirX: -1, dirY:  1 },
      { crop: [halfW, halfH, halfW, halfH], dirX:  1, dirY:  1 },
    ]
    const frameName = frame.name
    for (const q of quads) {
      const img = this._scene.add.image(src.x, src.y, texKey, frameName)
      img.setOrigin(src.originX ?? 0.5, src.originY ?? 0.5)
      if (src.displayWidth > 0 && src.displayHeight > 0) {
        img.setDisplaySize(src.displayWidth, src.displayHeight)
      } else {
        img.setScale(src.scaleX || 1, src.scaleY || 1)
      }
      img.setAngle(src.angle || 0)
      img.flipX = !!src.flipX
      img.flipY = !!src.flipY
      img.setAlpha(src.alpha ?? 1)
      img.setDepth(DEPTH_CHUNK)
      img.setCrop(q.crop[0], q.crop[1], q.crop[2], q.crop[3])
      this._track(img)
      // Drift this quadrant outward in its diagonal direction, plus a
      // little gravity drop. Brief hold first so the crack lines read.
      const drift = 22 + Math.random() * 22
      this._scene.tweens.add({
        targets:  img,
        x:        img.x + q.dirX * drift,
        y:        img.y + q.dirY * drift + 20,
        angle:    img.angle + (Math.random() - 0.5) * 70,
        alpha:    { from: img.alpha, to: 0 },
        scaleX:   img.scaleX * 0.6,
        scaleY:   img.scaleY * 0.6,
        delay:    170 + Math.random() * 130,
        duration: 460 + Math.random() * 200,
        ease:     'Quad.easeIn',
        onComplete: () => { this._untrack(img); img.destroy() },
      })
    }
    return true
  }

  // ── Shatter: crack → break into chunks → dissolve ───────────────────────

  _shatter({ worldX, worldY, width = 1, height = 1 }) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return
    const TS   = Balance.TILE_SIZE
    const fw   = Math.max(1, width)  * TS
    const fh   = Math.max(1, height) * TS
    const area = Math.max(1, width) * Math.max(1, height)
    const mult = _particlesMult()

    // Camera kick on impact.
    this._cameraShake(area)
    // 1. Fracture lines race across the footprint.
    this._spawnCracks(worldX, worldY, fw, fh)
    if (mult <= 0) return

    // 2. The footprint splits into a grid of masonry chunks — they hold a
    //    beat (still cracking), then break apart and dissolve.
    const cols = Math.max(2, Math.min(5, Math.round(Math.max(1, width)  * 1.3)))
    const rows = Math.max(2, Math.min(5, Math.round(Math.max(1, height) * 1.3)))
    const x0 = worldX - fw / 2
    const y0 = worldY - fh / 2
    const cw = fw / cols
    const ch = fh / rows
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        this._spawnChunk(x0 + (c + 0.5) * cw, y0 + (r + 0.5) * ch,
                         cw, ch, worldX, worldY)
      }
    }
    // 3. A little dust kicked up as the chunks dissolve.
    const dust = Math.min(12, Math.max(3, Math.round((2 + area) * mult)))
    for (let i = 0; i < dust; i++) this._spawnDust(worldX, worldY, fw, fh)
  }

  // Bright jagged fracture lines that race outward from the footprint
  // center — the "crack" beat before the structure breaks.
  _spawnCracks(cx, cy, fw, fh) {
    const g = this._scene.add.graphics().setDepth(DEPTH_CRACK)
    g.lineStyle(2, CRACK_COLOR, 1)
    const reach = Math.max(fw, fh) * 0.52
    const arms  = 6 + ((Math.random() * 4) | 0)
    for (let a = 0; a < arms; a++) {
      let ang = (a / arms) * Math.PI * 2 + Math.random() * 0.5
      let px = 0, py = 0
      g.beginPath()
      g.moveTo(0, 0)
      const segs = 2 + ((Math.random() * 3) | 0)
      for (let s = 0; s < segs; s++) {
        const step = (reach / segs) * (0.7 + Math.random() * 0.6)
        ang += (Math.random() - 0.5) * 0.9
        px  += Math.cos(ang) * step
        py  += Math.sin(ang) * step
        g.lineTo(px, py)
      }
      g.strokePath()
    }
    g.setPosition(cx, cy).setScale(0.35)
    this._track(g)
    // Race outward fast...
    this._scene.tweens.add({
      targets: g, scaleX: 1, scaleY: 1, duration: 150, ease: 'Cubic.easeOut',
    })
    // ...hold a beat, then fade as the chunks take over.
    this._scene.tweens.add({
      targets: g, alpha: { from: 1, to: 0 }, delay: 230, duration: 240,
      onComplete: () => { this._untrack(g); g.destroy() },
    })
  }

  // One masonry chunk covering a cell of the footprint grid. Holds in place
  // briefly (the "cracked but intact" beat), then breaks away from the
  // center, rotates, shrinks and fades — the dissolve.
  _spawnChunk(cx, cy, cw, ch, originX, originY) {
    const g   = this._scene.add.graphics().setDepth(DEPTH_CHUNK)
    const col = CHUNK_COLORS[(Math.random() * CHUNK_COLORS.length) | 0]
    // Quad inset from its cell so crack-gaps sit between chunks; corners
    // jittered so the break lines read as jagged, not a clean grid.
    const hw = cw * 0.42
    const hh = ch * 0.42
    const j  = () => (Math.random() - 0.5) * Math.min(cw, ch) * 0.28
    const pts = [
      { x: -hw + j(), y: -hh + j() },
      { x:  hw + j(), y: -hh + j() },
      { x:  hw + j(), y:  hh + j() },
      { x: -hw + j(), y:  hh + j() },
    ]
    g.fillStyle(col, 1)
    g.lineStyle(1.5, 0x140820, 0.95)
    g.beginPath()
    g.moveTo(pts[0].x, pts[0].y)
    for (let k = 1; k < pts.length; k++) g.lineTo(pts[k].x, pts[k].y)
    g.closePath()
    g.fillPath()
    g.strokePath()
    g.setPosition(cx, cy)
    this._track(g)
    // Break apart: after a short hold, drift away from the footprint
    // center, rotate, shrink and fade.
    const ang  = Math.atan2(cy - originY, cx - originX) + (Math.random() - 0.5) * 0.8
    const dist = 10 + Math.random() * 26
    this._scene.tweens.add({
      targets:  g,
      x:        cx + Math.cos(ang) * dist,
      y:        cy + Math.sin(ang) * dist + 16,
      angle:    (Math.random() - 0.5) * 90,
      alpha:    { from: 1, to: 0 },
      scaleX:   0.55, scaleY: 0.55,
      delay:    180 + Math.random() * 130,
      duration: 460 + Math.random() * 200,
      ease:     'Quad.easeIn',
      onComplete: () => { this._untrack(g); g.destroy() },
    })
  }

  // A soft dust puff that swells, drifts up and fades — timed to the
  // chunk dissolve.
  _spawnDust(cx, cy, fw, fh) {
    const ox = cx + (Math.random() - 0.5) * fw * 0.8
    const oy = cy + (Math.random() - 0.5) * fh * 0.8
    const c  = this._scene.add.circle(ox, oy, 6 + Math.random() * 10, 0xada6bd, 0.45)
      .setDepth(DEPTH_DUST)
    this._track(c)
    this._scene.tweens.add({
      targets:  c,
      scaleX:   2.2, scaleY: 2.2,
      y:        oy - 12 - Math.random() * 16,
      alpha:    { from: 0.45, to: 0 },
      delay:    220 + Math.random() * 160,
      duration: 520 + Math.random() * 220,
      ease:     'Quad.easeOut',
      onComplete: () => { this._untrack(c); c.destroy() },
    })
  }

  // Footprint-scaled camera kick — honours the screen-shake setting.
  _cameraShake(area) {
    if (!userSettings.isShakeEnabled?.()) return
    const cam = this._scene.cameras?.main
    if (!cam?.shake) return
    cam.shake(170 + Math.min(150, area * 10), Math.min(0.009, 0.003 + area * 0.0007))
  }
}
