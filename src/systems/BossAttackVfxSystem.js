// BossAttackVfxSystem — sprite-sheet VFX for the boss's pact attacks
// AND archetype-specific basic attacks.
//
// Two distinct trigger paths:
//
//   1. Dark-pact attacks fire dedicated events (PACT_BOSS_*_FIRED).
//      Each pact has a canonical sheet PAIR (primary + alt) and a
//      damage-type colour row. On fire, we pick primary or alt by
//      `VFX_BOSS_ATTACK_ALT_CHANCE`, look up the colour row from the
//      pact's natural damage type, and spawn at the event's world
//      coords (typically the target adv or the boss position).
//
//   2. Boss basic melee fires `BOSS_MELEE_HIT (targetId, damage)`.
//      We look up the boss archetype on gameState.player and use the
//      archetype-keyed sheet pair + signature colour row, spawning at
//      the target adv's worldX/Y.
//
// Layering: spawns on top of the existing pact telegraph/feedback
// visuals (channel line, ring, etc.) rather than replacing them — the
// existing visuals still convey the mechanical telegraph; these add
// punch. Depth 96 (above HP bars, below floating numbers).
//
// Banned cheaters etc. don't apply here — the boss is always the
// attacker. Single layer per fire; alt-chance gives variety without
// the cheater-style triple-stack chaos.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

// Canonical 9-row colour palette of the pack:
//   0 orange/red, 1 pink/magenta, 2 cyan, 3 green, 4 brown/yellow,
//   5 white/silver, 6 tan, 7 crimson, 8 dark blue/purple
const ROW = {
  fire: 0, blood: 7, physical: 7, slash: 7,
  magic: 1, arcane: 2, ice: 2, frost: 2, water: 2,
  lightning: 5, holy: 5, divine: 5, light: 5,
  poison: 3, nature: 3, acid: 3,
  earth: 4, sand: 4, rock: 4,
  shadow: 8, dark: 8, necrotic: 8, void: 8, fear: 8, soul: 8,
}

// Pact → { sheets: [primary, alt], dmgType, row override (optional) }
// The row override skips the damage-type lookup — used when the pact
// has a strong palette identity independent of its damage type.
const PACT_MAP = {
  // hellfire alt swapped boss-puff → cheater-burst (chaotic flame
  // roar) — puff was a sparse smoke.
  hellfire_breath:  { sheets: ['vfx-boss-flame',       'vfx-cheater-burst'],    dmgType: 'fire'      },
  lightning_strike: { sheets: ['vfx-boss-bolt',        'vfx-boss-comet'],       dmgType: 'lightning' },
  shockwave_slam:   { sheets: ['vfx-boss-cross-slam',  'vfx-boss-strike'],      dmgType: 'physical'  },
  dark_vortex:      { sheets: ['vfx-cheater-pinwheel', 'vfx-cheater-portal'],   dmgType: 'shadow'    },
  soul_drain:       { sheets: ['vfx-boss-soul-wisp',   'vfx-boss-soul'],        dmgType: 'shadow'    },
  doppelgangers:    { sheets: ['vfx-cheater-glitch',   'vfx-cheater-sunburst'], dmgType: 'magic'     },
  petrifying_stare: { sheets: ['vfx-boss-petrify',     'vfx-cheater-ring'],     dmgType: 'ice'       },
  // sundered_floor swapped boss-rubble + boss-quake → quake-crack +
  // billow. The originals were the same too-subtle sheets we rejected
  // for Golem; reusing the new heavy ones lands the "floor breaking"
  // metaphor correctly. Damage-row 8 (shadow) tints them dark.
  sundered_floor:   { sheets: ['vfx-boss-quake-crack', 'vfx-boss-billow'],      dmgType: 'shadow'    },
}

// Boss archetype → { sheets: [primary, alt], row (signature),
//                    scale? (multiplier on VFX_BOSS_ATTACK_SCALE) }
// `row` is an explicit choice tied to archetype identity rather than
// damage type — Golem reads as earthy (row 4) even though its hits
// could be classed as "physical" (row 7), etc.
// `scale` is optional per-archetype size bump for bosses whose
// signature attacks should land with extra weight (Golem in particular
// — its ground-impact effects need to feel hefty, not subtle).
const ARCH_MAP = {
  beholder:  { sheets: ['vfx-cheater-sigil',     'vfx-boss-magic-burst'], row: 2 },  // cyan eye
  // demon alt swapped boss-puff → boss-billow (heavy demonic smoke)
  demon:     { sheets: ['vfx-boss-flame',        'vfx-boss-billow'],      row: 0 },  // fire
  myconid:   { sheets: ['vfx-boss-spores',       'vfx-boss-reeds'],       row: 3 },  // green spore (reeds reads as fungal stalks)
  wraith:    { sheets: ['vfx-boss-soul',         'vfx-boss-soul-wisp'],   row: 5 },  // white ghost (per user spec)
  gnoll:     { sheets: ['vfx-boss-slash',        'vfx-cheater-streak'],   row: 7 },  // crimson blood
  // Golem swapped from rubble/quake (too subtle) to tri-spoke ground
  // crack + billowing dust plume; scaled 1.5× so the impact reads as
  // heavy. Earthy yellow row reinforces the rock/stone identity.
  golem:     { sheets: ['vfx-boss-quake-crack', 'vfx-boss-billow'],       row: 4, scale: 1.5 },
  lich:      { sheets: ['vfx-boss-skull',        'vfx-boss-soul'],        row: 8 },  // purple necromancy
  // lizardman alt swapped boss-puff → boss-droplet (venom splash)
  lizardman: { sheets: ['vfx-boss-reeds',        'vfx-boss-droplet'],     row: 3 },  // green venom
  orc:       { sheets: ['vfx-boss-cross-slam',   'vfx-boss-strike'],      row: 7 },  // crimson rage
  vampire:   { sheets: ['vfx-cheater-streak',    'vfx-boss-droplet'],     row: 7 },  // crimson blood
  // succubus primary swapped boss-charm (thin whips) → boss-magic-burst
  // (firework petals in pink) so the charm hit has visual presence.
  succubus:  { sheets: ['vfx-boss-magic-burst',  'vfx-cheater-glitch'],   row: 1 },  // pink charm
  slime:     { sheets: ['vfx-boss-droplet',      'vfx-boss-magic-burst'], row: 2 },  // cyan goo
}

export class BossAttackVfxSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }

    // Pact-attack hooks. Each handler resolves the target world position
    // from the event payload (either explicit x/y, or a targetId we look
    // up against gameState) and spawns the mapped pact VFX.
    on('PACT_BOSS_HELLFIRE_FIRED',          this._onHellfire)
    on('PACT_BOSS_LIGHTNING_FIRED',         this._onLightning)
    on('PACT_BOSS_SHOCKWAVE_FIRED',         this._onShockwave)
    on('PACT_BOSS_VORTEX_FIRED',            this._onVortex)
    on('PACT_BOSS_SOULDRAIN_BEGUN',         this._onSoulDrain)
    on('PACT_BOSS_DOPPELGANGERS_SPAWNED',   this._onDoppel)
    on('PACT_BOSS_PETRIFY_FIRED',           this._onPetrify)
    on('SUNDERED_FLOOR_FIRED',              this._onSundered)

    // Archetype basic-attack hook. Boss-vs-adv melee swings emit this
    // with targetId + damage; we spawn the archetype-keyed VFX at the
    // hit adv's world position.
    on('BOSS_MELEE_HIT',                    this._onBossMelee)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
  }

  // ── Pact handlers ─────────────────────────────────────────────

  _onHellfire(p = {})  { this._firePact('hellfire_breath',  p.x, p.y) }
  _onLightning(p = {}) { this._firePact('lightning_strike', p.x, p.y) }
  _onShockwave(p = {}) { this._firePact('shockwave_slam',   p.x, p.y) }
  _onVortex(p = {})    { this._firePact('dark_vortex',      p.x, p.y) }
  _onDoppel(p = {})    { this._firePact('doppelgangers',    p.x, p.y) }

  // Petrify + Soul-drain only carry a targetId — look the adv up to
  // get worldX/Y. If the target's already gone (dead/fled in the
  // same tick) skip silently.
  _onPetrify(p = {}) {
    const t = this._findAdv(p.targetId)
    if (!t) return
    this._firePact('petrifying_stare', t.worldX, t.worldY)
  }
  _onSoulDrain(p = {}) {
    const t = this._findAdv(p.targetId)
    if (!t) return
    this._firePact('soul_drain', t.worldX, t.worldY)
  }

  // Sundered carries tile coords — convert to world centre.
  _onSundered(p = {}) {
    if (!Number.isFinite(p.tileX) || !Number.isFinite(p.tileY)) return
    const TS = Balance.TILE_SIZE
    const wx = p.tileX * TS + TS / 2
    const wy = p.tileY * TS + TS / 2
    this._firePact('sundered_floor', wx, wy)
  }

  _firePact(pactId, wx, wy) {
    if (!Balance.VFX_BOSS_ATTACK_ENABLED) return
    if (!this._particlesEnabled()) return
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return
    const map = PACT_MAP[pactId]
    if (!map) return
    const sheet = this._pickSheet(map.sheets)
    if (!sheet) return
    const row = ROW[map.dmgType] ?? 7
    this._spawn(wx, wy, sheet, row)
  }

  // ── Archetype basic-attack handler ────────────────────────────

  _onBossMelee({ targetId, damage } = {}) {
    if (!Balance.VFX_BOSS_ATTACK_ENABLED) return
    if (typeof damage === 'number' && damage <= 0) return
    if (!this._particlesEnabled()) return
    const archId = this._gameState?.player?.bossArchetypeId
    const map = ARCH_MAP[archId]
    if (!map) return
    const t = this._findAdv(targetId)
    if (!t) return
    const sheet = this._pickSheet(map.sheets)
    if (!sheet) return
    this._spawn(t.worldX, t.worldY, sheet, map.row, map.scale)
  }

  // ── Spawn helpers ─────────────────────────────────────────────

  // Roll between the [primary, alt] pair using VFX_BOSS_ATTACK_ALT_CHANCE.
  // Defaults primary-heavy so each ability has a recognizable identity.
  _pickSheet([primary, alt]) {
    const altChance = Balance.VFX_BOSS_ATTACK_ALT_CHANCE ?? 0.4
    return Math.random() < altChance ? (alt ?? primary) : primary
  }

  _spawn(wx, wy, sheet, row, scaleMul = 1) {
    if (!this._scene.textures?.exists?.(sheet)) return
    const animKey = `${sheet}-${row}`
    if (!this._scene.anims?.exists?.(animKey)) return
    const baseScale = (Balance.VFX_BOSS_ATTACK_SCALE ?? 1.2) * scaleMul
    const scale = baseScale * (0.95 + Math.random() * 0.1)
    // Random 90° rotation jitter so successive casts of the same
    // ability don't visually overlap pixel-perfect on identical
    // frames. 90° steps keep the pixel grid crisp.
    const rot = Math.floor(Math.random() * 4) * (Math.PI / 2)
    const sprite = this._scene.add.sprite(wx, wy - 16, sheet)
      .setScale(scale)
      .setRotation(rot)
      .setDepth(96)
    sprite.play(animKey)
    sprite.once('animationcomplete', () => {
      if (sprite.active) sprite.destroy()
    })
  }

  // ── Lookups ───────────────────────────────────────────────────

  _findAdv(id) {
    if (!id) return null
    const advs = this._gameState.adventurers?.active ?? []
    return advs.find(a => a.instanceId === id) ?? null
  }

  _particlesEnabled() {
    try {
      return localStorage.getItem('qf.video.particles') !== 'off'
    } catch { return true }
  }
}
