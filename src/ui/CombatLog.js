// Slay-the-Spire-style condensed combat log.
// Lives as part of the DayPhase scene UI. Subscribes to combat / trap / flee events
// and renders a stack of fading lines at the bottom-left of the screen.

import { EventBus } from '../systems/EventBus.js'
import { PALETTE }  from './UIKit.js'

const MAX_LINES   = 7
const LINE_TTL_MS = 7000
const FADE_MS     = 600

export class CombatLog {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._lines     = []  // { text, addedAt, container }
    this._x         = opts.x ?? 16
    this._yBottom   = opts.yBottom ?? 650
    this._listeners = []

    this._wire()
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    for (const l of this._lines) l.container?.destroy()
    this._lines = []
  }

  _wire() {
    const on = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }

    on('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
      this._addLine(`${adventurer.name} (${adventurer.classId}) enters the dungeon.`, 0xaaccdd)
    })
    on('TRAP_TRIGGERED', ({ trap, def, adventurer, damage }) => {
      const hpFrac = adventurer.resources.maxHp > 0
        ? Math.max(0, adventurer.resources.hp / adventurer.resources.maxHp) : 0
      const tail = damage > 0 ? `→ ${damage} dmg (${this._hpStr(adventurer)})` : ''
      this._addLine(`${this._shortName(adventurer)} sprung ${def.name}. ${tail}`, 0xddaa44)
    })
    on('COMBAT_HIT', ({ sourceId, targetId, damage, isCritical }) => {
      // Only log adventurer-to-minion hits (minion-to-adv is shown via TRAP/COMBAT_KILL/FLEE flows already)
      const target = this._gameState.minions.find(m => m.instanceId === targetId)
      const source = this._gameState.adventurers.active.find(a => a.instanceId === sourceId)
      if (target && source) {
        const tag = isCritical ? ' (CRIT)' : ''
        this._addLine(
          `${this._shortName(source)} hit ${this._minionName(target)} for ${damage}${tag}.`,
          0x88ccdd
        )
      }
    })
    on('ADVENTURER_DIED', ({ adventurer, killerName }) => {
      this._addLine(`✕  ${adventurer.name} (${adventurer.classId}) killed by ${killerName}.`, 0xcc4422)
    })
    on('ADVENTURER_BREAKING_FROM_BOSS', ({ adventurer, witnessed }) => {
      // Single event; the optional `witnessed` field distinguishes a panic
      // flee (saw a teammate die) from a regular HP-threshold break.
      if (witnessed) {
        this._addLine(
          `⚑  ${this._shortName(adventurer)} panics after seeing ${this._shortName(witnessed)} fall!`,
          0xff7755,
        )
      } else {
        this._addLine(
          `⚑  ${this._shortName(adventurer)} breaks from the boss and runs for the entrance!`,
          0xff8866,
        )
      }
    })
    on('ADVENTURER_FLED', ({ adventurer, reason }) => {
      // Boss-related flee outcomes use richer copy than the generic
      // "fled (reason)" line so the player can read the story of the run.
      let text, color
      if (reason === 'fled_from_boss' || reason === 'panic_witnessed_death') {
        text  = `→  ${adventurer.name} escaped the dungeon alive.`
        color = 0xaaccaa
      } else if (reason === 'boss_defeated') {
        text  = `→  ${adventurer.name} left victorious — the boss is wounded.`
        color = 0xddee99
      } else {
        text  = `→  ${adventurer.name} fled (${reason}).`
        color = 0x88aa66
      }
      this._addLine(text, color)
    })
    on('MINION_DIED', ({ minion }) => {
      this._addLine(`☠  ${this._minionName(minion)} cut down.`, 0xaa5566)
    })
    // Phase 5c — class ability activations
    on('ABILITY_TRIGGERED', ({ message }) => {
      if (message) this._addLine(`✦  ${message}`, 0xffd966)
    })
    on('DAY_PHASE_ENDED', () => {
      this._fadeAll()
    })
  }

  _shortName(adv) {
    return adv.name?.split(' ')[0] ?? adv.classId ?? 'someone'
  }

  _minionName(m) {
    if (m.name) return m.name
    const def = this._scene.cache.json.get('minionTypes')?.find(d => d.id === m.definitionId)
    return def?.name ?? m.definitionId ?? 'minion'
  }

  _hpStr(e) {
    return `${e.resources.hp}/${e.resources.maxHp}`
  }

  // ── Line management ───────────────────────────────────────────────────────

  _addLine(text, color = 0xaabbcc) {
    const now = this._scene.time.now
    // Trim to MAX_LINES (oldest first)
    while (this._lines.length >= MAX_LINES) {
      const removed = this._lines.shift()
      removed?.container?.destroy()
    }
    const line = this._buildLine(text, color)
    line.addedAt = now
    this._lines.push(line)
    this._reflow()
    // Auto-fade after TTL
    this._scene.time.delayedCall(LINE_TTL_MS, () => this._fadeLine(line), [], this)
  }

  _buildLine(text, color) {
    const c = this._scene.add.container(0, 0).setDepth(28)
    const padX = 6, padY = 2
    const txt = this._scene.add.text(padX, padY, text, {
      fontSize: '10px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      fontFamily: 'monospace',
    })
    const w = Math.min(txt.width + padX * 2, 420)
    const h = txt.height + padY * 2
    const bg = this._scene.add.rectangle(0, 0, w, h, 0x000000, 0.55).setOrigin(0)
    c.add([bg, txt])
    return { container: c, addedAt: 0, height: h }
  }

  _reflow() {
    let y = this._yBottom
    for (let i = this._lines.length - 1; i >= 0; i--) {
      const l = this._lines[i]
      y -= l.height + 2
      l.container.setPosition(this._x, y)
    }
  }

  _fadeLine(line) {
    if (!this._lines.includes(line)) return
    this._scene.tweens.add({
      targets: line.container, alpha: 0, duration: FADE_MS,
      onComplete: () => {
        const idx = this._lines.indexOf(line)
        if (idx >= 0) this._lines.splice(idx, 1)
        line.container.destroy()
        this._reflow()
      },
    })
  }

  _fadeAll() {
    for (const l of [...this._lines]) this._fadeLine(l)
  }
}
