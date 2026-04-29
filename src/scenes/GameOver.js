// Phase 10 — GameOver / Eulogy scene.
//
// Triggered by BOSS_DEFEATED_FINAL. Shows a cinematic "your dungeon's
// memorial" screen with run highlights:
//   - Days survived
//   - Total kills
//   - Top minion (by killCount), their final name + bounty
//   - Notable adventurers in the graveyard
//   - Active mechanics at end of run
//
// Two buttons: "NEW RUN" (back to ArchetypeSelect) and "GRAVEYARD" (open
// persistent Graveyard scene to inspect detailed history).

import { PALETTE, glowPanel } from '../ui/UIKit.js'
import { SaveSystem }          from '../systems/SaveSystem.js'

export class GameOver extends Phaser.Scene {
  constructor() {
    super('GameOver')
    this._gameState = null
  }

  init(data) {
    this._gameState = data?.gameState ?? null
  }

  create() {
    const { width: W, height: H } = this.scale

    // Backdrop
    this.add.rectangle(0, 0, W, H, 0x020407, 1).setOrigin(0).setDepth(0)

    // Title
    const titleG = this.add.graphics().setDepth(1)
    glowPanel(titleG, W / 2 - 240, 60, 480, 50, {
      fill: 0x140618, border: 0xcc3322, glow: 0x661111,
    })
    this.add.text(W / 2, 85, 'YOUR DUNGEON HAS FALLEN', {
      fontSize: '18px', color: '#ffaaaa', fontFamily: 'monospace', fontStyle: 'bold',
      shadow: { color: '#660000', blur: 12, fill: true },
    }).setOrigin(0.5).setDepth(2)

    // Body panel
    const bx = 80, by = 140
    const bw = W - 160
    const bh = H - by - 100
    const bg = this.add.graphics().setDepth(1)
    glowPanel(bg, bx, by, bw, bh, {
      fill: 0x080d18, border: PALETTE.accent, glow: PALETTE.accentDim,
    })

    this._renderEulogy(bx + 24, by + 24, bw - 48)

    // Buttons
    this._renderButton(W / 2 - 220, H - 76, 200, 44, 'NEW RUN', () => this._newRun())
    this._renderButton(W / 2 + 20,  H - 76, 200, 44, 'GRAVEYARD', () => this._graveyard())
  }

  _renderEulogy(x, y, w) {
    const s = this._gameState
    if (!s) {
      this.add.text(x, y, '(no run data)', {
        fontSize: '12px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(2)
      return
    }

    const days = s.player?.totalDaysElapsed ?? '?'
    const kills = s.player?.totalKills ?? 0
    const grave = s.adventurers?.graveyard ?? []
    const minions = s.minions ?? []
    const topMinion = minions
      .slice()
      .sort((a, b) => (b.bountyKillCount ?? 0) - (a.bountyKillCount ?? 0))[0]

    const heading = this.add.text(x, y, 'A EULOGY', {
      fontSize: '13px', color: PALETTE.textGold, fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(2)

    const lines = [
      ``,
      `You survived ${days} day${days === 1 ? '' : 's'}.`,
      `${kills} adventurer${kills === 1 ? '' : 's'} were buried in your halls.`,
      grave.length > 0
        ? `${grave.length} corpse${grave.length === 1 ? '' : 's'} are now permanent fixtures of the décor.`
        : `No corpses on file. Are you sure you played?`,
      ``,
    ]

    if (topMinion) {
      lines.push(
        `MINION OF THE RUN`,
        `  ${topMinion.name ?? topMinion.definitionId}`,
        `  Kills: ${topMinion.bountyKillCount ?? 0}` +
        (topMinion.hasBounty ? '   ★ BOUNTY HOLDER' : ''),
        `  Level: ${topMinion.level ?? 1}` +
        ((topMinion.evolutionHistory?.length ?? 0) > 0
          ? `   (evolved ${topMinion.evolutionHistory.length}× — last: ${topMinion.evolutionHistory.at(-1).name})`
          : ''),
        ``,
      )
    }

    if (grave.length > 0) {
      lines.push('NOTABLE GUESTS')
      const top = grave.slice(-5).reverse()
      for (const g of top) {
        lines.push(`  · ${g.name ?? 'Unknown'} (${g.classId ?? '?'}) — day ${g.diedOnDay ?? '?'}, killed by ${g.killerName ?? '?'}`)
      }
      lines.push(``)
    }

    const mechs = s.activeMechanics ?? []
    if (mechs.length > 0) {
      const mechDefs = this.cache.json.get('dungeonMechanics') ?? []
      const names = mechs.map(id => mechDefs.find(d => d.id === id)?.name ?? id)
      lines.push(`Mechanics in effect at the end: ${names.join(', ')}.`)
    }

    lines.push(
      ``,
      `The adventurers will tell stories about this place for years.`,
      `Most of them flattering. None of them accurate.`,
    )

    this.add.text(x, y + 24, lines.join('\n'), {
      fontSize: '11px', color: PALETTE.textNormal, fontFamily: 'monospace',
      wordWrap: { width: w }, lineSpacing: 4,
    }).setDepth(2)
  }

  _renderButton(x, y, w, h, label, onClick) {
    const g = this.add.graphics().setDepth(2)
    glowPanel(g, x, y, w, h, {
      fill: 0x110a1f, border: PALETTE.accentBright, glow: PALETTE.accent,
    })
    this.add.text(x + w / 2, y + h / 2, label, {
      fontSize: '12px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(3)

    const hit = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0xffffff, 0)
      .setDepth(4).setInteractive({ useHandCursor: true })
    hit.on('pointerdown', onClick)
  }

  _newRun() {
    SaveSystem.clear?.()
    this.scene.start('ArchetypeSelect')
  }

  _graveyard() {
    this.scene.start('Graveyard', { gameState: this._gameState, returnTo: 'GameOver' })
  }
}
