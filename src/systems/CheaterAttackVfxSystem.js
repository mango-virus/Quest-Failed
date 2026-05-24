// CheaterAttackVfxSystem — layers wild glitch-burst sprites on top of
// every melee hit landed by a Cheater-class adventurer.
//
// Why a dedicated system rather than extending HitSparkSystem:
//   • Cheater hits are visually loud by design — the modded-client /
//     RGB / glitch aesthetic should read instantly. HitSparkSystem
//     picks ONE colour by damageType (consistent feedback for the
//     player). The cheater attack wants the opposite — random colour
//     row per swing — so the look intentionally breaks the rest of
//     the game's visual grammar.
//   • Two source sheets are layered randomly (burst + glitch), with a
//     50%+ chance of stacking both for an even chaos.
//
// Source assets (registered in Preload as `vfx-cheater-<key>-<row>`).
// Each is a 9-row colour-variant spritesheet at 64×64 frames; column
// count varies. The system randomly picks a sheet + a colour row per
// swing so the same hit never looks the same twice — the "glitch"
// aesthetic depends on the mismatch:
//   • cheater-burst    — chaotic scribble two-stage burst
//   • cheater-glitch   — data-corruption shower of blobs
//   • cheater-portal   — swirling ring that ends in chaotic sparks
//   • cheater-pinwheel — 5-point spiral
//   • cheater-sunburst — magic sunburst pinwheel
//   • cheater-ring     — circular runic ring
//   • cheater-streak   — S-curve streak
//   • cheater-sigil    — sharp star sigil
// All follow the canonical VFX-pack 9-row colour layout (0 orange,
// 1 pink, 2 cyan, 3 green, 4 yellow, 5 white, 6 tan, 7 crimson,
// 8 dark blue).
//
// Triggering: subscribes to COMBAT_HIT. Skips if:
//   • master toggle Balance.VFX_CHEATER_ATTACK_ENABLED off
//   • damage <= 0 (miss / dodge)
//   • attacker isn't a cheater, OR cheater has been banned (modded
//     client locked out — the aesthetic should match the gameplay
//     change, plain swings only)
//   • particles=off in the video settings
//   • target/attacker can't be resolved by instanceId
//   • the registered animation key doesn't exist (Preload didn't load
//     the asset — defensive, shouldn't happen in production)
//
// Spawned sprites destroy themselves on `animationcomplete`. No state
// is held on the system across hits.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

const SHEETS = [
  'vfx-cheater-burst',
  'vfx-cheater-glitch',
  'vfx-cheater-portal',
  'vfx-cheater-pinwheel',
  'vfx-cheater-sunburst',
  'vfx-cheater-ring',
  'vfx-cheater-streak',
  'vfx-cheater-sigil',
]
const ROWS = 9   // canonical colour-variant row count for this pack

export class CheaterAttackVfxSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('COMBAT_HIT', this._onCombatHit)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
  }

  _onCombatHit({ sourceId, targetId, damage }) {
    if (!Balance.VFX_CHEATER_ATTACK_ENABLED) return
    // CombatSystem emits COMBAT_HIT with `sourceId` (the attacker) and
    // `targetId` (the defender) — NOT `attackerId`. Match the payload
    // shape used by HitSparkSystem & friends.
    if (!sourceId || !targetId) return
    if (typeof damage !== 'number' || damage <= 0) return
    // Honor the video setting just like HitSparkSystem does.
    try {
      if (localStorage.getItem('qf.video.particles') === 'off') return
    } catch {}

    const attacker = this._findEntity(sourceId)
    if (!attacker) return
    if (attacker.classId !== 'cheater') return
    // Banned cheaters lost the modded client — plain attacks only.
    if (attacker._banned) return

    const target = this._findEntity(targetId)
    if (!target) return
    const wx = target.worldX
    const wy = target.worldY
    if (typeof wx !== 'number' || typeof wy !== 'number') return

    // Primary sheet (always plays) — random sheet, random row.
    const usedSheets = new Set()
    const primarySheet = this._pickSheet()
    this._spawnBurst(wx, wy, primarySheet, this._pickRow())
    usedSheets.add(primarySheet)

    // Secondary sheet (probabilistic stack) — must be a DIFFERENT sheet
    // and row from the primary so the layers read as "the renderer is
    // misbehaving", not as a doubled-up identical burst. With 8 sheets
    // in the pool the layer-count escalation becomes the dominant chaos
    // signal: 1 layer = normal swing, 2 = juicy, 3 = full-glitch.
    const doubleChance = Balance.VFX_CHEATER_ATTACK_DOUBLE_CHANCE ?? 0.55
    if (Math.random() < doubleChance) {
      const sheet = this._pickSheetExcluding(usedSheets)
      if (sheet) {
        this._spawnBurst(wx, wy, sheet, this._pickRow(), /*offsetForLayer*/ true)
        usedSheets.add(sheet)
      }
    }

    // Tertiary sheet (rare super-glitch moment) — only fires when the
    // double already triggered, so we never bypass the natural single→
    // double→triple escalation.  Reads as "the modded client desynced
    // hard this swing", which is exactly the read we want.
    const tripleChance = Balance.VFX_CHEATER_ATTACK_TRIPLE_CHANCE ?? 0.18
    if (usedSheets.size >= 2 && Math.random() < tripleChance) {
      const sheet = this._pickSheetExcluding(usedSheets)
      if (sheet) {
        this._spawnBurst(wx, wy, sheet, this._pickRow(), /*offsetForLayer*/ true)
        usedSheets.add(sheet)
      }
    }
  }

  _spawnBurst(wx, wy, sheet, row, offsetForLayer = false) {
    if (!this._scene.textures?.exists?.(sheet)) return
    const animKey = `${sheet}-${row}`
    if (!this._scene.anims?.exists?.(animKey)) return

    const baseScale = Balance.VFX_CHEATER_ATTACK_SCALE ?? 1.1
    // Tiny per-burst scale jitter so even a single-sheet hit doesn't
    // look identical between successive swings (sells the "glitch").
    const scale = baseScale * (0.92 + Math.random() * 0.18)
    // Random rotation in 90° steps — keeps the per-frame pixel grid
    // crisp (no smudging from arbitrary angles) but flips the effect
    // around for variety.
    const rot = (Math.floor(Math.random() * 4)) * (Math.PI / 2)
    // Mild offset so a stacked secondary burst doesn't perfectly
    // overlap the primary (reads as one effect otherwise).
    const ox = offsetForLayer ? (Math.random() * 12 - 6) : 0
    const oy = offsetForLayer ? (Math.random() * 12 - 6) : -16

    const sprite = this._scene.add.sprite(wx + ox, wy + oy, sheet)
      .setScale(scale)
      .setRotation(rot)
      .setDepth(96)         // one above hit-spark so cheater chaos wins layering
    sprite.play(animKey)
    sprite.once('animationcomplete', () => {
      if (sprite.active) sprite.destroy()
    })
  }

  _pickSheet() {
    return SHEETS[Math.floor(Math.random() * SHEETS.length)]
  }

  // Pick a random sheet that isn't already in `used`. Returns null if
  // the pool is exhausted (defensive — with 8 sheets and at most 3
  // layers per swing this never trips in practice).
  _pickSheetExcluding(used) {
    const remaining = SHEETS.filter(s => !used.has(s))
    if (remaining.length === 0) return null
    return remaining[Math.floor(Math.random() * remaining.length)]
  }

  _pickRow() {
    return Math.floor(Math.random() * ROWS)
  }

  _findEntity(id) {
    const advs = this._gameState.adventurers?.active ?? []
    const a = advs.find(x => x.instanceId === id)
    if (a) return a
    const mins = this._gameState.minions ?? []
    const m = mins.find(x => x.instanceId === id)
    if (m) return m
    const boss = this._gameState.boss
    if (boss && boss.instanceId === id) return boss
    return null
  }
}
