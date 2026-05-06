// Click-on-minion inspector for NightPhase.
// Shows: name + level, kills, evolution history.
//
// Subscribes to MINION_CLICKED (emitted by MinionRenderer) to open;
// rebuilds itself on minion-leveled events so it stays current.

import { EventBus } from '../systems/EventBus.js'
import { PALETTE, glowPanel } from './UIKit.js'

const PANEL_W = 280
const PANEL_H = 360

export class MinionInspector {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._minionId = null
    this._objects  = []          // game objects we've created — clear on close
    this._listeners = []

    this._wire()
  }

  destroy() {
    this._unwire()
    this._closePanel()
  }

  // ── Wire / unwire ─────────────────────────────────────────────────────────

  _wire() {
    const onClick = ({ minion }) => this.open(minion)
    const onChange = () => {
      if (!this._minionId) return
      // Re-render on equipment / progression events
      const m = this._gameState.minions.find(x => x.instanceId === this._minionId)
      if (!m) { this._closePanel(); return }
      this._renderPanel(m)
    }
    // Bug fix: previously the NIGHT/DAY phase listeners used inline arrow
    // functions and were never tracked in `_listeners`, leaking across scene
    // restarts. Capture refs so destroy() unwires them correctly.
    const onPhaseChange = () => this._closePanel()

    EventBus.on('MINION_CLICKED',          onClick)
    EventBus.on('MINION_LEVELED_UP',       onChange)
    EventBus.on('MINION_EVOLVED',          onChange)
    EventBus.on('MINION_NAMED',            onChange)
    EventBus.on('NIGHT_PHASE_STARTED',     onPhaseChange)
    EventBus.on('DAY_PHASE_STARTED',       onPhaseChange)
    this._listeners = [
      ['MINION_CLICKED',          onClick],
      ['MINION_LEVELED_UP',       onChange],
      ['MINION_EVOLVED',          onChange],
      ['MINION_NAMED',            onChange],
      ['NIGHT_PHASE_STARTED',     onPhaseChange],
      ['DAY_PHASE_STARTED',       onPhaseChange],
    ]
  }

  _unwire() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  // ── Panel API ─────────────────────────────────────────────────────────────

  open(minion) {
    this._minionId = minion.instanceId
    this._renderPanel(minion)
  }

  _closePanel() {
    this._minionId = null
    this._objects.forEach(o => o.destroy?.())
    this._objects = []
    this._equipBtns = []
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _renderPanel(minion) {
    // Tear down + rebuild — easier than diff'ing
    this._objects.forEach(o => o.destroy?.())
    this._objects = []
    this._equipBtns = []

    const W = this._scene.uiW
    const px = W - PANEL_W - 16
    const py = 16

    const bg = this._scene.add.graphics().setDepth(40)
    glowPanel(bg, px, py, PANEL_W, PANEL_H, {
      fill: 0x06060e, border: PALETTE.accentBright, glow: PALETTE.accent,
    })
    this._objects.push(bg)

    // Header: name + level
    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    const def = minionTypes.find(d => d.id === minion.definitionId)
    const displayName = minion.name ?? def?.name ?? minion.definitionId
    const heading = this._scene.add.text(px + 14, py + 12,
      `${displayName}`, {
        fontSize: '12px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(41)
    this._objects.push(heading)

    // Phase QW — pencil icon to rename. Uses native window.prompt since Phaser
    // doesn't ship a text-input widget; trivial to swap for a custom field later.
    const editBtn = this._scene.add.text(px + 14 + heading.width + 6, py + 14, '✎', {
      fontSize: '11px', color: PALETTE.textDim, fontFamily: 'monospace',
    }).setDepth(42).setInteractive({ useHandCursor: true })
    editBtn.on('pointerover', () => editBtn.setColor(PALETTE.textAccent))
    editBtn.on('pointerout',  () => editBtn.setColor(PALETTE.textDim))
    editBtn.on('pointerdown', () => {
      const next = window.prompt?.('Rename minion:', displayName)
      if (next && next.trim()) {
        minion.name = next.trim()
        EventBus.emit('MINION_NAMED', { minion, name: minion.name })
      }
    })
    this._objects.push(editBtn)

    const subtitle = this._scene.add.text(px + 14, py + 28,
      `${def?.name ?? minion.definitionId}  ·  Level ${minion.level ?? 1}` +
      (minion.hasBounty ? '   ★ BOUNTY' : ''), {
        fontSize: '9px', color: minion.hasBounty ? PALETTE.textGold : PALETTE.textDim,
        fontFamily: 'monospace',
      }).setDepth(41)
    this._objects.push(subtitle)

    // Close button
    const closeBtn = this._scene.add.text(px + PANEL_W - 14, py + 8, '×', {
      fontSize: '16px', color: PALETTE.textDim, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(42).setInteractive({ useHandCursor: true })
    closeBtn.on('pointerdown', () => this._closePanel())
    this._objects.push(closeBtn)

    // Stats block
    const statsLines = [
      `HP        ${minion.resources.hp}/${minion.resources.maxHp}`,
      `Attack    ${minion.stats.attack}`,
      `Defense   ${minion.stats.defense}`,
      `Speed     ${minion.stats.speed?.toFixed(1) ?? '1.0'}`,
      ``,
      `XP        ${minion.xp ?? 0} / ${this._xpForNextLevel(minion)}`,
      `Kills     ${minion.bountyKillCount ?? 0}`,
      `Faction   ${minion.faction ?? 'dungeon'}`,
    ]
    const stats = this._scene.add.text(px + 14, py + 50, statsLines.join('\n'), {
      fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace', lineSpacing: 3,
    }).setDepth(41)
    this._objects.push(stats)

    // Evolution history
    let yCursor = py + 50 + statsLines.length * 13 + 10
    if (minion.evolutionHistory?.length) {
      const evoTitle = this._scene.add.text(px + 14, yCursor, 'EVOLUTIONS', {
        fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(41)
      this._objects.push(evoTitle)
      yCursor += 12

      for (const evo of minion.evolutionHistory) {
        const t = this._scene.add.text(px + 18, yCursor,
          `→ ${evo.name} (Day ${evo.day})`, {
            fontSize: '9px', color: PALETTE.textAccent, fontFamily: 'monospace',
          }).setDepth(41)
        this._objects.push(t)
        yCursor += 12
      }
      yCursor += 4
    }

  }

  _xpForNextLevel(minion) {
    const lv = minion.level ?? 1
    return Math.floor(
      (this._scene._evolutionSystem?.xpForLevel?.(lv + 1)) ?? 25
    )
  }
}
