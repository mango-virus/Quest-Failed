// ─────────────────────────────────────────────────────────────────────────────
// VFX Gallery  ·  __qfDev.vfxGallery()
//
// Renders EVERY AbilityVfx primitive in a labelled grid, all looping together, on
// a clean dark stage. The point is comparison: with the whole library firing side
// by side you can instantly see if a new effect RHYMES with an existing one (the
// same ring/burst/glow), which a single-effect preview hides. Part of the
// anti-generic toolkit ([[feedback_vfx_variety_mandate]]).
//
// Toggle with __qfDev.vfxGallery(). Reuses the real AbilityVfx — what you see here
// is exactly what ships.
// ─────────────────────────────────────────────────────────────────────────────

import { AbilityVfx } from '../ui/AbilityVfx.js'

// Each entry fires one primitive at a cell centre (cx,cy). `c` is the family
// colour. 2-point effects aim at a short offset; area effects get a cell-sized
// region so they don't swamp the grid.
const GALLERY = [
  { n: 'impactFx',        c: 0xffd060, f: (s, x, y, c) => AbilityVfx.impactFx(s, x, y, { color: c }) },
  { n: 'shockwaveFx',     c: 0x9fd8ff, f: (s, x, y, c) => AbilityVfx.shockwaveFx(s, x, y, { color: c, toR: 34 }) },
  { n: 'glowPulseFx',     c: 0xffe08a, f: (s, x, y, c) => AbilityVfx.glowPulseFx(s, x, y, { color: c }) },
  { n: 'sparkleFx',       c: 0xfff2b0, f: (s, x, y, c) => AbilityVfx.sparkleFx(s, x, y, { color: c }) },
  { n: 'burnFx',          c: 0xff7733, f: (s, x, y, c) => AbilityVfx.burnFx(s, x, y, { color: c }) },
  { n: 'particleBurstFx', c: 0xffcf66, f: (s, x, y, c) => AbilityVfx.particleBurstFx(s, x, y, { color: c }) },
  { n: 'pulseRing',       c: 0x66ccee, f: (s, x, y, c) => AbilityVfx.pulseRing(s, x, y, { color: c, fromR: 6, toR: 34 }) },
  { n: 'beamFx',          c: 0x9b59ff, f: (s, x, y, c) => AbilityVfx.beamFx(s, x - 36, y, x + 36, y, { color: c }) },
  { n: 'projectileFx',    c: 0x66ddff, f: (s, x, y, c) => AbilityVfx.projectileFx(s, x - 36, y, x + 36, y, { color: c }) },
  { n: 'juice',           c: 0xffd060, f: (s, x, y, c) => AbilityVfx.juice(s, x, y, { color: c }) },
  { n: 'furyAura',        c: 0xc41525, f: (s, x, y, c) => AbilityVfx.furyAura(s, x, y + 6, { color: c, intensity: 1 }) },
  { n: 'soundWave',       c: 0xffe27a, f: (s, x, y, c) => AbilityVfx.soundWave(s, x, y - 6, { color: c }) },
  { n: 'groundCrack',     c: 0xff8844, f: (s, x, y, c) => AbilityVfx.groundCrack(s, x, y + 8, { color: c }) },
  { n: 'streakDash',      c: 0xfff0a0, f: (s, x, y, c) => AbilityVfx.streakDash(s, x - 32, y, x + 32, y, { color: c }) },
  { n: 'boneShatter',     c: 0xe8e0c8, f: (s, x, y, c) => AbilityVfx.boneShatter(s, x, y, { color: c }) },
  { n: 'boneKnit',        c: 0xbfe9c0, f: (s, x, y, c) => AbilityVfx.boneKnit(s, x, y, { color: c }) },
  { n: 'necroticErupt',   c: 0x6fe39a, f: (s, x, y, c) => AbilityVfx.necroticErupt(s, x, y, { color: c }) },
  { n: 'goldStamp',       c: 0xffd23f, f: (s, x, y, c) => AbilityVfx.goldStamp(s, x, y, { color: c }) },
  { n: 'coinRain',        c: 0xffd23f, f: (s, x, y, c) => AbilityVfx.coinRain(s, x, y, { color: c, count: 6 }) },
  { n: 'slimeSplit',      c: 0x66cc44, f: (s, x, y, c) => AbilityVfx.slimeSplit(s, x, y, { color: c }) },
  { n: 'plagueBurst',     c: 0x88cc33, f: (s, x, y) => AbilityVfx.plagueBurst(s, x, y, {}) },
  { n: 'contagionTendril', c: 0x9fe04a, f: (s, x, y) => AbilityVfx.contagionTendril(s, x - 30, y, x + 30, y, {}) },
  { n: 'plagueCloud',     c: 0x6fae2a, f: (s, x, y) => AbilityVfx.plagueCloud(s, x, y, { radius: 46 }) },
  { n: 'acidSplash',      c: 0xaadd33, f: (s, x, y, c) => AbilityVfx.acidSplash(s, x, y, { color: c, radiusTiles: 1.4 }) },
  { n: 'acidGeyser',      c: 0xaadd33, f: (s, x, y, c) => AbilityVfx.acidGeyser(s, x, y + 14, { color: c }) },
  { n: 'acidFloodFx',     c: 0xaadd33, f: (s, x, y, c) => AbilityVfx.acidFloodFx(s, x, y, { color: c, rectW: 96, rectH: 64, geysers: 4 }) },
  { n: 'bloodThread',     c: 0xc01530, f: (s, x, y) => AbilityVfx.bloodThread(s, x - 38, y, x + 8, y - 10, {}) },
  { n: 'bloodShieldFx',   c: 0x8a0d1e, f: (s, x, y, c) => AbilityVfx.bloodShieldFx(s, x, y, { color: c, strength: 2 }) },
  { n: 'bloodFeastFx',    c: 0xc01530, f: (s, x, y) => AbilityVfx.bloodFeastFx(s, x, y, [{ x: x - 40, y }, { x: x + 40, y: y - 8 }], {}) },
  { n: 'swarmBiteFx',     c: 0x6b5238, f: (s, x, y) => AbilityVfx.swarmBiteFx(s, x, y, { count: 6 }) },
  { n: 'verminTideFx',    c: 0x6b5238, f: (s, x, y) => AbilityVfx.verminTideFx(s, x, y, { rectW: 110, rectH: 80, count: 18 }) },
  { n: 'gnashFx',         c: 0x7a5c3a, f: (s, x, y) => AbilityVfx.gnashFx(s, x, y + 12, {}) },
  { n: 'reanimateFx',     c: 0x5e7a3a, f: (s, x, y) => AbilityVfx.reanimateFx(s, x, y, {}) },
  { n: 'massGraveFx',     c: 0x5e7a3a, f: (s, x, y) => AbilityVfx.massGraveFx(s, x, y, { rectW: 110, rectH: 80, count: 5 }) },
  { n: 'graveRotFx',      c: 0x5a6b2c, f: (s, x, y) => AbilityVfx.graveRotFx(s, x, y, {}) },
  { n: 'rotAuraFx',       c: 0x4a5526, f: (s, x, y) => AbilityVfx.rotAuraFx(s, x, y, {}) },
  { n: 'flameLickFx',     c: 0xff6a12, f: (s, x, y) => AbilityVfx.flameLickFx(s, x, y, { h: 26, w: 8 }) },
  { n: 'hellfireAuraFx',  c: 0xff5511, f: (s, x, y) => AbilityVfx.hellfireAuraFx(s, x, y, { radius: 40 }) },
  { n: 'combustFx',       c: 0xff7722, f: (s, x, y) => AbilityVfx.combustFx(s, x, y, {}) },
  { n: 'infernoFx',       c: 0xff4411, f: (s, x, y) => AbilityVfx.infernoFx(s, x, y, { rectW: 110, rectH: 80, count: 8 }) },
  { n: 'emberRiseFx',     c: 0xffb04a, f: (s, x, y) => AbilityVfx.emberRiseFx(s, x, y, { count: 4 }) },
  { n: 'heatShimmerFx',   c: 0xff8a3a, f: (s, x, y) => AbilityVfx.heatShimmerFx(s, x, y, { k: 0.9 }) },
  { n: 'bulwarkFx',       c: 0x8b8678, f: (s, x, y) => AbilityVfx.bulwarkFx(s, x, y, {}) },
  { n: 'bastionFx',       c: 0x8b8678, f: (s, x, y) => AbilityVfx.bastionFx(s, x, y, { allies: [{ x: x - 38, y: y + 6 }, { x: x + 40, y: y - 4 }] }) },
  { n: 'aegisShimmerFx',  c: 0xbcd6ee, f: (s, x, y) => AbilityVfx.aegisShimmerFx(s, x, y, {}) },
  { n: 'fearStrikeFx',    c: 0x9fb6e8, f: (s, x, y) => AbilityVfx.fearStrikeFx(s, x - 34, y, x + 30, y - 6, {}) },
  { n: 'dreadAuraFx',     c: 0xb2c6ee, f: (s, x, y) => AbilityVfx.dreadAuraFx(s, x, y, { radiusTiles: 4, targets: [{ x: x + 40, y: y - 20 }, { x: x - 36, y: y + 10 }] }) },
  { n: 'hauntCloakFx',    c: 0x86a0d8, f: (s, x, y) => AbilityVfx.hauntCloakFx(s, x, y, { durationMs: 1400 }) },
  { n: 'pallOfDreadFx',   c: 0x44557a, f: (s, x, y) => AbilityVfx.pallOfDreadFx(s, x, y, { rectW: 120, rectH: 86, victims: [{ x: x - 36, y: y + 8 }, { x: x + 38, y: y - 2 }] }) },
  { n: 'panicStateFx',    c: 0xbcd0f4, f: (s, x, y) => AbilityVfx.panicStateFx(s, x, y, {}) },
  { n: 'mesmerizeFx',     c: 0xc060ff, f: (s, x, y) => AbilityVfx.mesmerizeFx(s, x - 36, y, x + 32, y - 6, {}) },
  { n: 'manyEyesFx',      c: 0xcc77ff, f: (s, x, y) => AbilityVfx.manyEyesFx(s, x, y, [{ x: x + 40, y: y - 18 }, { x: x - 38, y: y + 8 }, { x: x + 30, y: y + 24 }], {}) },
  { n: 'tyrantGlareFx',   c: 0xff66dd, f: (s, x, y) => AbilityVfx.tyrantGlareFx(s, x, y, { rectW: 120, rectH: 86, victims: [{ x: x - 36, y: y + 8 }, { x: x + 38, y: y - 2 }] }) },
  { n: 'bleedSlashFx',    c: 0xcc2a1a, f: (s, x, y) => AbilityVfx.bleedSlashFx(s, x, y, { stacks: 3 }) },
  { n: 'bleedingAuraFx',  c: 0xc01818, f: (s, x, y) => AbilityVfx.bleedingAuraFx(s, x, y, { stacks: 4 }) },
  { n: 'bloodTrailFx',    c: 0x7a0e0e, f: (s, x, y) => AbilityVfx.bloodTrailFx(s, x, y, { stacks: 3 }) },
  { n: 'ruptureFx',       c: 0xd01818, f: (s, x, y) => AbilityVfx.ruptureFx(s, x, y, { stacks: 5 }) },
  { n: 'bloodFrenzyFx',   c: 0xe0301a, f: (s, x, y) => AbilityVfx.bloodFrenzyFx(s, x, y, { victims: [{ x: x - 34, y: y + 6, burst: 28 }, { x: x + 36, y: y - 4, burst: 35 }] }) },
  { n: 'thornGuardFx',    c: 0x6b4a2a, f: (s, x, y) => AbilityVfx.thornGuardFx(s, x, y, {}) },
  { n: 'thornLashFx',     c: 0x6f8a3a, f: (s, x, y) => AbilityVfx.thornLashFx(s, x - 34, y, x + 24, y - 6, {}) },
  { n: 'regrowFx',        c: 0x6fbf3a, f: (s, x, y) => AbilityVfx.regrowFx(s, x, y, {}) },
  { n: 'thornburstFx',    c: 0x6f8a3a, f: (s, x, y) => AbilityVfx.thornburstFx(s, x, y, { victims: [{ x: x - 34, y: y + 6 }, { x: x + 36, y: y - 4 }] }) },
  { n: 'soulHarvestFx',     c: 0x4cff9e, f: (s, x, y) => AbilityVfx.soulHarvestFx(s, x - 30, y + 14, { toX: x, toY: y - 18 }) },
  { n: 'soulConduitFx',     c: 0x4cff9e, f: (s, x, y) => AbilityVfx.soulConduitFx(s, x, y, { targets: [{ x: x - 38, y: y + 8 }, { x: x + 40, y: y - 4 }] }) },
  { n: 'soulStormFx',       c: 0x4cff9e, f: (s, x, y) => AbilityVfx.soulStormFx(s, x, y, { souls: 12, rectW: 130, rectH: 92, victims: [{ x: x - 36, y: y + 8 }, { x: x + 38, y: y - 2 }] }) },
  { n: 'phylacteryShatterFx', c: 0x7CFFB2, f: (s, x, y) => AbilityVfx.phylacteryShatterFx(s, x, y, {}) },
  { n: 'phylacteryReviveFx',  c: 0x7CFFB2, f: (s, x, y) => AbilityVfx.phylacteryReviveFx(s, x, y, {}) },
  { n: 'camouflageFx',       c: 0x5a9c52, f: (s, x, y) => AbilityVfx.camouflageFx(s, x, y, {}) },
  { n: 'camoShimmerFx',      c: 0x6fdf7a, f: (s, x, y) => AbilityVfx.camoShimmerFx(s, x, y, {}) },
  { n: 'ambushStrikeFx',     c: 0x6fae5e, f: (s, x, y) => AbilityVfx.ambushStrikeFx(s, x, y, {}) },
  { n: 'vanishingWarbandFx', c: 0x5a9c52, f: (s, x, y) => AbilityVfx.vanishingWarbandFx(s, x, y, { rectW: 130, rectH: 92, count: 5 }) },
  { n: 'blinkFx',            c: 0xff6633, f: (s, x, y) => AbilityVfx.blinkFx(s, x - 40, y + 8, x + 30, y - 6, {}) },
  { n: 'hellriftFx',         c: 0xff6633, f: (s, x, y) => AbilityVfx.hellriftFx(s, x, y, { rectW: 130, rectH: 92, victims: [{ x: x - 34, y: y + 6 }, { x: x + 36, y: y - 4 }] }) },
  { n: 'entangleFx',         c: 0x6fae3a, f: (s, x, y) => AbilityVfx.entangleFx(s, x, y, {}) },
  { n: 'stranglethornFx',    c: 0x6fae3a, f: (s, x, y) => AbilityVfx.stranglethornFx(s, x, y, { rectW: 130, rectH: 92, victims: [{ x: x - 34, y: y + 6 }, { x: x + 36, y: y - 4 }] }) },
  { n: 'dazeFx',             c: 0xb98fd0, f: (s, x, y) => AbilityVfx.dazeFx(s, x, y + 24, {}) },
  { n: 'sporePuffFx',        c: 0x9966cc, f: (s, x, y) => AbilityVfx.sporePuffFx(s, x, y, { radius: 60 }) },
  { n: 'sporeStormFx',       c: 0x9966cc, f: (s, x, y) => AbilityVfx.sporeStormFx(s, x, y, { rectW: 130, rectH: 92, victims: [{ x: x - 34, y: y + 6 }, { x: x + 36, y: y - 4 }] }) },
  { n: 'plagueAuraFx',       c: 0x88cc33, f: (s, x, y) => AbilityVfx.plagueAuraFx(s, x, y + 16, {}) },
]

let _instance = null

export class VfxGallery {
  constructor(scene) { this._scene = scene; this._open = false; this._objs = []; this._timer = null; this._backdrop = null }

  static toggle(scene) {
    if (!_instance) _instance = new VfxGallery(scene)
    if (_instance._open) _instance.close(); else _instance.open()
    return _instance._open
  }

  open() {
    if (this._open) return
    this._open = true
    const cam = this._scene.cameras.main
    this._saved = { x: cam.scrollX, y: cam.scrollY, zoom: cam.zoom }
    this._savedBounds = cam.useBounds ? { x: cam._bounds.x, y: cam._bounds.y, w: cam._bounds.width, h: cam._bounds.height } : null
    cam.stopFollow(); cam.removeBounds()
    // Park on an off-grid void so dungeon decor doesn't bleed into the grid.
    const cx = (this._scene.gameState?.boss?.worldX ?? 1600)
    const cy = (this._scene.gameState?.boss?.worldY ?? 1600) + 3000
    this._cx = cx; this._cy = cy
    // Backdrop sits BELOW the effects (which render at depths ~6–14) — like the
    // VFX Lab. A high depth here would occlude the whole grid.
    this._backdrop = this._scene.add.rectangle(0, 0, this._scene.scale.width, this._scene.scale.height, 0x14111a, 1)
      .setOrigin(0).setScrollFactor(0).setDepth(4)
    // Grid layout — 6 columns, spacing in world units; centred on (cx,cy).
    const COLS = 6, SP = 150, rows = Math.ceil(GALLERY.length / COLS)
    this._cells = GALLERY.map((g, i) => {
      const col = i % COLS, row = Math.floor(i / COLS)
      const x = cx + (col - (COLS - 1) / 2) * SP
      const y = cy + (row - (rows - 1) / 2) * SP
      // persistent cell frame + label so the grid is legible even when an effect
      // is mid-cooldown (depth 5 sits above the backdrop, below the effects).
      const frame = this._scene.add.rectangle(x, y, SP - 14, SP - 30, 0x000000, 0)
        .setStrokeStyle(1, 0x3a4a60, 0.8).setDepth(5)
      const label = this._scene.add.text(x, y + 56, g.n, { fontFamily: 'monospace', fontSize: '12px', color: '#dbeaff' })
        .setOrigin(0.5).setDepth(950)
      this._objs.push(frame, label)
      return { ...g, x, y }
    })
    // Fit the grid: zoom so all columns/rows are visible.
    const zoom = Math.min(this._scene.scale.width / (COLS * SP + 80), this._scene.scale.height / (rows * SP + 120), 1.2)
    cam.centerOn(cx, cy); cam.setZoom(Math.max(0.35, zoom))
    this._fireAll()
    // Fast loop so effects re-fire as they finish → the grid is near-continuously
    // active for at-a-glance comparison (short effects overlap harmlessly).
    this._timer = setInterval(() => { try { this._fireAll() } catch (e) {} }, 950)
  }

  _fireAll() {
    if (!this._open) return
    for (const c of this._cells) { try { c.f(this._scene, c.x, c.y, c.c) } catch (e) {} }
  }

  close() {
    if (!this._open) return
    this._open = false
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    for (const o of this._objs) { try { o.destroy() } catch (e) {} }
    this._objs = []; this._cells = null
    this._backdrop?.destroy(); this._backdrop = null
    const cam = this._scene.cameras.main
    if (this._savedBounds) cam.setBounds(this._savedBounds.x, this._savedBounds.y, this._savedBounds.w, this._savedBounds.h)
    if (this._saved) { cam.setZoom(this._saved.zoom); cam.setScroll(this._saved.x, this._saved.y) }
  }
}
