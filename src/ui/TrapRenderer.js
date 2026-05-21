// TrapRenderer — 2026-05-20 redesign.
//
// One animated sprite per placed trap, from the re-baked sheets in
// assets/sprites/traps/ (see tools/bake-traps.mjs + manifest.json).
//
// Idle vs active:
//   * rotating blades         → loop their spin animation continuously
//   * saw blade               → static sprite spanning its whole track;
//                               the frame is driven by state.sawPos so the
//                               on-track blade reads where the damage lands
//   * arrows / cannon / dragon→ static frame 0, fire animation on TRAP_FIRED
//   * cannon                  → fire anim shows the shot leaving; the
//                               explosion (frames 8-11) plays at the target
//   * spike pillar            → fire animation on TRAP_FIRED
//   * spike pit               → hidden frame 0 until state.revealed
//   * bomb                    → idle loop; TRAP_EXPLODED spawns a one-shot
//                               blast sprite (the bomb itself is removed)
//
// Directional traps (cannon / dragon / saw) pick a sheet from trap.facing.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { sawPosAt } from '../entities/Trap.js'

const TS = Balance.TILE_SIZE

const DEPTH_TRAP   = 6     // floor traps — below units, above floor art
const DEPTH_PIT    = 5     // spike pit reads as part of the floor
const DEPTH_HAZARD = 7     // arrows / saw — moving hazards sit a touch higher
const DEPTH_BLAST  = 96    // bomb / cannon explosion — above everything

// Anim specs: [textureKey, startFrame, endFrame, fps, repeat(-1 loop|0 once)]
const ANIMS = {
  'trap-arrow-fire':            ['trap-arrow',            0, 11, 26, 0],
  'trap-bomb-idle':             ['trap-bomb',             0,  4,  8, -1],
  'trap-bomb-explode':          ['trap-bomb',             5, 11, 16, 0],
  // Cannon: fire = shot leaving (0-7); impact = explosion (8-11) at the target.
  'trap-cannon-up-fire':        ['trap-cannon-up',        0,  7, 20, 0],
  'trap-cannon-down-fire':      ['trap-cannon-down',      0,  7, 20, 0],
  'trap-cannon-left-fire':      ['trap-cannon-left',      0,  7, 20, 0],
  'trap-cannon-right-fire':     ['trap-cannon-right',     0,  7, 20, 0],
  'trap-cannon-up-impact':      ['trap-cannon-up',        8, 11, 18, 0],
  'trap-cannon-down-impact':    ['trap-cannon-down',      8, 11, 18, 0],
  'trap-cannon-left-impact':    ['trap-cannon-left',      8, 11, 18, 0],
  'trap-cannon-right-impact':   ['trap-cannon-right',     8, 11, 18, 0],
  'trap-dragon-ud-fire':        ['trap-dragon-ud',        0,  9, 16, 0],
  'trap-dragon-rl-fire':        ['trap-dragon-rl',        0,  9, 16, 0],
  'trap-spike-pillar-fire':     ['trap-spike-pillar',     0,  5, 16, 0],
  'trap-spike-pit-reveal':      ['trap-spike-pit',        1,  5,  6, 0],
  'trap-rotating-blades-spin':  ['trap-rotating-blades',  0,  3, 16, -1],
}

// Cannon: facing → directional sheet + the origin that pins the cannon body
// to the footprint while the baked cannonball travels outward.
const CANNON_DIR = {
  N: { dir: 'up',    tex: 'trap-cannon-up',    originX: 0.5,  originY: 0.83 },
  S: { dir: 'down',  tex: 'trap-cannon-down',  originX: 0.5,  originY: 0.11 },
  E: { dir: 'right', tex: 'trap-cannon-right', originX: 0.12, originY: 0.5  },
  W: { dir: 'left',  tex: 'trap-cannon-left',  originX: 0.88, originY: 0.5  },
}
// Where the explosion blob sits inside an impact frame (far end of travel).
const CANNON_IMPACT_ORIGIN = {
  up:    { ox: 0.5,  oy: 0.16 },
  down:  { ox: 0.5,  oy: 0.84 },
  left:  { ox: 0.16, oy: 0.5  },
  right: { ox: 0.84, oy: 0.5  },
}

export class TrapRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}   // trap.instanceId → { body, vis }
    this._registerAnims()
    this._setNearestFilter()

    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('TRAP_FIRED',          this._onFired)
    on('TRAP_FUSE_LIT',       this._onFuseLit)
    on('TRAP_EXPLODED',       this._onExploded)
    on('TRAP_REMOVED',        this._onRemoved)
    on('NIGHT_PHASE_STARTED', this._onNightReset)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  _registerAnims() {
    const anims = this._scene.anims
    for (const [key, [tex, start, end, fps, repeat]] of Object.entries(ANIMS)) {
      if (anims.exists(key)) continue
      if (!this._scene.textures.exists(tex)) continue
      anims.create({
        key,
        frames: anims.generateFrameNumbers(tex, { start, end }),
        frameRate: fps,
        repeat,
      })
    }
  }

  // The game renders with antialias on, so scaled-up trap sprites blur.
  // Force NEAREST filtering on every trap texture to keep the pixel art crisp.
  _setNearestFilter() {
    const NEAREST = Phaser.Textures.FilterMode.NEAREST
    const keys = [
      'trap-arrow', 'trap-bomb',
      'trap-cannon-up', 'trap-cannon-down', 'trap-cannon-left', 'trap-cannon-right',
      'trap-dragon-ud', 'trap-dragon-rl',
      'trap-spike-pillar', 'trap-spike-pit', 'trap-rotating-blades',
      'trap-saw-h', 'trap-saw-v',
    ]
    for (const k of keys) {
      if (this._scene.textures.exists(k)) this._scene.textures.get(k).setFilter(NEAREST)
    }
  }

  // ── Per-frame sync ──────────────────────────────────────────────────────────

  update() {
    const traps = this._gameState.dungeon.traps ?? []
    const seen = new Set()
    for (const trap of traps) {
      seen.add(trap.instanceId)
      let s = this._sprites[trap.instanceId]
      if (!s) s = this._createSprite(trap)
      if (!s) continue
      this._syncSprite(trap, s)
    }
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  _syncSprite(trap, s) {
    if (trap.definitionId === 'saw_blade') {
      // Static sprite — the frame shows the blade's position along the
      // track. Driven by a time-based wave so it animates during the night
      // phase too (when TrapSystem isn't ticking).
      const { length, speed } = this._sawParams(trap)
      const pos = sawPosAt(this._scene.time.now, length, speed)
      const f = Math.max(0, Math.min(5, Math.round(pos / Math.max(1, length - 1) * 5)))
      s.body.setFrame(f)
    } else {
      // Re-anchor every frame so MOVE-tool relocations (and rooms carrying
      // traps) keep the sprite on its tile.
      const p = this._bodyWorld(trap, s.vis)
      s.body.setPosition(p.x, p.y)
      if (trap.definitionId === 'spike_pit') {
        // Re-assert scale every frame — keeps the pit pinned to its 2×2
        // through reveal animations and night re-arms.
        s.body.setScale(s.vis.scaleX, s.vis.scaleY)
        this._syncSpikePit(trap, s)
      }
    }
  }

  _syncSpikePit(trap, s) {
    if (trap.state?.revealed && !s._revealed) {
      s._revealed = true
      if (this._scene.anims.exists('trap-spike-pit-reveal')) {
        s.body.play('trap-spike-pit-reveal')
        s.body.once('animationcomplete', () => { if (s.body.active) s.body.setFrame(5) })
      }
    } else if (!trap.state?.revealed && s._revealed) {
      s._revealed = false
      s.body.stop()
      s.body.setFrame(0)
    }
  }

  // ── Sprite creation ─────────────────────────────────────────────────────────

  _createSprite(trap) {
    const vis = this._visualFor(trap)
    if (!vis || !this._scene.textures.exists(vis.tex)) return null

    const body = this._scene.add.sprite(0, 0, vis.tex, 0)
      .setDepth(vis.depth)
      .setOrigin(vis.originX, vis.originY)

    if (trap.definitionId === 'saw_blade') {
      this._layoutSaw(trap, body)
    } else {
      if (vis.scaleX != null) body.setScale(vis.scaleX, vis.scaleY)
      else                    body.setScale(vis.scale)
      body.setFlip(!!vis.flipX, !!vis.flipY)
      if (vis.angle) body.setAngle(vis.angle)
      const p = this._bodyWorld(trap, vis)
      body.setPosition(p.x, p.y)
    }

    if (vis.loopAnim && this._scene.anims.exists(vis.loopAnim)) body.play(vis.loopAnim)

    const s = { body, vis }
    this._sprites[trap.instanceId] = s
    return s
  }

  // The saw is one static sprite stretched across its whole track (the
  // sheet already includes the rail). Re-baked frames are uniform, so
  // setDisplaySize survives setFrame.
  _layoutSaw(trap, body) {
    const len   = this._sawParams(trap).length
    const horiz = trap.facing === 'E' || trap.facing === 'W'
    // Uniform scale — grow the saw to span the track without stretching it.
    // 62 ≈ the saw sheet's content width; scaling it to len tiles also
    // brings the blade to roughly one tile thick.
    body.setScale((len * TS) / 62)
    if (!horiz) body.setAngle(90)
    const x = horiz ? (trap.tileX + len / 2) * TS : (trap.tileX + 0.5) * TS
    const y = horiz ? (trap.tileY + 0.5) * TS     : (trap.tileY + len / 2) * TS
    body.setPosition(x, y)
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s.body?.destroy()
    delete this._sprites[id]
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  _onFired({ trap, targetId }) {
    const s = this._sprites[trap?.instanceId]
    if (s && s.vis?.fireAnim && this._scene.anims.exists(s.vis.fireAnim)) {
      s.body.play(s.vis.fireAnim)
      s.body.once('animationcomplete', () => { if (s.body.active) s.body.setFrame(0) })
    }
    // Cannon — the explosion plays at the point of impact.
    if (trap?.definitionId === 'cannon' && targetId) this._spawnCannonImpact(trap, targetId)
  }

  _spawnCannonImpact(trap, targetId) {
    const target = this._findEntity(targetId)
    if (!target || typeof target.worldX !== 'number') return
    const c = CANNON_DIR[trap.facing] ?? CANNON_DIR.S
    const animKey = `trap-cannon-${c.dir}-impact`
    if (!this._scene.anims.exists(animKey)) return
    const o = CANNON_IMPACT_ORIGIN[c.dir]
    const spr = this._scene.add.sprite(target.worldX, target.worldY, c.tex)
      .setDepth(DEPTH_BLAST).setOrigin(o.ox, o.oy).setScale(1.4)
    spr.play(animKey)
    spr.once('animationcomplete', () => { if (spr.active) spr.destroy() })
  }

  _onFuseLit({ trap }) {
    const s = this._sprites[trap?.instanceId]
    if (!s) return
    s.body.setTint(0xff5544)
    this._scene.tweens.add({
      targets: s.body, scale: { from: s.vis.scale, to: s.vis.scale * 1.18 },
      duration: 260, yoyo: true, repeat: -1,
    })
  }

  _onExploded({ worldX, worldY, radius }) {
    if (!this._scene.anims.exists('trap-bomb-explode')) return
    const diameter = (radius ?? 5) * 2 * TS
    const blast = this._scene.add.sprite(worldX, worldY, 'trap-bomb')
      .setDepth(DEPTH_BLAST)
      .setScale(diameter / 48)
    blast.play('trap-bomb-explode')
    blast.once('animationcomplete', () => { if (blast.active) blast.destroy() })
  }

  _onRemoved({ trap }) {
    if (trap?.instanceId) this._destroySprite(trap.instanceId)
  }

  _onNightReset() {
    for (const s of Object.values(this._sprites)) {
      s._revealed = false
      s.body.clearTint()
      this._scene.tweens.killTweensOf(s.body)
      if (s.vis?.scale != null) s.body.setScale(s.vis.scale)
      if (s.vis?.loopAnim && this._scene.anims.exists(s.vis.loopAnim)) s.body.play(s.vis.loopAnim)
      else { s.body.stop(); s.body.setFrame(0) }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Footprint-centre anchor for a trap body, plus any wall-mount nudge.
  _bodyWorld(trap, vis) {
    const fp = trap.footprint ?? { w: 1, h: 1 }
    return {
      x: (trap.tileX + fp.w / 2) * TS + (vis?.offX ?? 0),
      y: (trap.tileY + fp.h / 2) * TS + (vis?.offY ?? 0),
    }
  }

  _sawParams(trap) {
    const def = (this._scene.cache.json.get('trapTypes') ?? [])
      .find(d => d.id === trap.definitionId)
    return { length: def?.trackLength ?? 4, speed: def?.sawSpeed ?? 3 }
  }

  _findEntity(id) {
    return (this._gameState.adventurers?.active ?? []).find(a => a.instanceId === id)
        ?? (this._gameState.minions ?? []).find(m => m.instanceId === id)
        ?? null
  }

  // ── Per-trap visual config ──────────────────────────────────────────────────

  _visualFor(trap) {
    switch (trap.definitionId) {
      case 'bomb':
        // Idle bomb art is small inside a padded frame — scale up, and lift
        // it a touch so it sits on the tile rather than low on it.
        return { tex: 'trap-bomb', scale: TS / 48 * 3.0, originX: 0.5, originY: 0.5,
                 offY: -10, depth: DEPTH_TRAP, loopAnim: 'trap-bomb-idle' }

      case 'rotating_blades':
        return { tex: 'trap-rotating-blades', scale: (2 * TS) / 48 * 1.12,
                 originX: 0.5, originY: 0.5, depth: DEPTH_TRAP,
                 loopAnim: 'trap-rotating-blades-spin' }

      case 'spike_pillar':
        return { tex: 'trap-spike-pillar', scale: (2 * TS) / 48,
                 originX: 0.5, originY: 0.5, depth: DEPTH_TRAP,
                 fireAnim: 'trap-spike-pillar-fire' }

      case 'spike_pit':
        // plate_trap content fills only the left 31px of its 48-wide frame —
        // offset originX onto the content centre so the pit covers the 2×2.
        return { tex: 'trap-spike-pit',
                 scaleX: (2 * TS) / 31, scaleY: (2 * TS) / 32,
                 originX: 15.5 / 48, originY: 0.5, depth: DEPTH_PIT }

      case 'cannon':       return this._cannonVisual(trap)
      case 'dragon_trap':  return this._dragonVisual(trap)
      case 'shooting_arrows': return this._arrowVisual(trap)
      case 'saw_blade':    return this._sawVisual(trap)
      default:             return null
    }
  }

  // Cannon — 1×1 trap; one sheet per facing. Uniform scale so all four
  // facings read at a similar size.
  _cannonVisual(trap) {
    const c = CANNON_DIR[trap.facing] ?? CANNON_DIR.S
    return {
      tex: c.tex, scale: 1.2, originX: c.originX, originY: c.originY,
      depth: DEPTH_TRAP, fireAnim: `trap-cannon-${c.dir}-fire`,
    }
  }

  // Dragon — wall-mounted. updown sheet faces down (north wall); rightleft
  // faces right (west wall). Flip for the opposite wall and nudge the maw
  // onto the wall face.
  _dragonVisual(trap) {
    const ud  = trap.facing === 'N' || trap.facing === 'S'
    const tex = ud ? 'trap-dragon-ud' : 'trap-dragon-rl'
    const originX = ud ? 0.5 : (trap.facing === 'E' ? 0.05 : 0.95)
    const originY = ud ? (trap.facing === 'S' ? 0.05 : 0.95) : 0.5
    const WALL = TS * 0.55
    return {
      tex, scale: TS / 32 * 1.3,
      originX, originY, depth: DEPTH_TRAP,
      flipX: trap.facing === 'W',
      flipY: trap.facing === 'N',
      offX: trap.facing === 'E' ? -WALL : trap.facing === 'W' ? WALL : 0,
      offY: trap.facing === 'S' ? -WALL : trap.facing === 'N' ? WALL : 0,
      fireAnim: ud ? 'trap-dragon-ud-fire' : 'trap-dragon-rl-fire',
    }
  }

  // Arrows — single vertical sheet (points down). Rotate for E/W walls,
  // flip for a south wall, nudged onto the wall face.
  _arrowVisual(trap) {
    const f = trap.facing
    const WALL = TS * 0.5
    return {
      tex: 'trap-arrow', scale: TS / 16 * 0.9,
      originX: 0.5, originY: 0.04,
      flipY: f === 'N',
      angle: f === 'E' ? -90 : f === 'W' ? 90 : 0,
      offX: f === 'E' ? -WALL : f === 'W' ? WALL : 0,
      offY: f === 'S' ? -WALL : f === 'N' ? WALL : 0,
      depth: DEPTH_HAZARD, fireAnim: 'trap-arrow-fire',
    }
  }

  // Saw blade — the round saw sheet (which already includes its rail).
  // Layout (stretch across the track + rotation) is done in _layoutSaw.
  _sawVisual() {
    // originY at the saw sheet's content centre so the blade stays centred
    // on the track row (and rotates cleanly for a vertical track).
    return { tex: 'trap-saw-h', originX: 0.5, originY: 10 / 32, depth: DEPTH_HAZARD }
  }
}
