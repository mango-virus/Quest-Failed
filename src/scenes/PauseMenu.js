// PauseMenu — full-screen overlay launched by PauseManager. Phaser pauses
// every gameplay scene when this opens, so we don't need to gate timers /
// animations / AI ourselves; the entire game freezes behind the panel.
//
// Internal screens: 'root' | 'settings' | 'howto'. Switching wipes the
// content container and rebuilds — simple state machine, no panel reuse.
// ESC toggles back through the screens (sub-screen → root → close).

import { PALETTE, glowPanel, applyUiCamera } from '../ui/UIKit.js'
import { AudioControls }                     from '../ui/AudioControls.js'
import { PauseManager }                      from '../systems/PauseManager.js'

const PANEL_W = 480
const PANEL_H = 520
const BTN_W   = 320
const BTN_H   = 56
const BTN_GAP = 14

const COL = {
  dimOverlay:  0x000000,
  panelFill:   0x070d1a,
  panelBorder: 0x0088cc,
  panelGlow:   0x004488,
  btnFill:     0x0e1729,
  btnFillHvr:  0x142340,
  btnBorder:   0x4a78b0,
  btnBorderHvr:0x88c0ff,
  textBright:  '#f0f4ff',
  textNormal:  '#aabbcc',
  textDim:     '#4a5a6a',
  title:       '#c64bff',
}

export class PauseMenu extends Phaser.Scene {
  constructor() {
    super('PauseMenu')
    this._gameState = null
    this._screen    = 'root'
    this._content   = null
    this._audio     = null
  }

  init(data) {
    this._gameState = data?.gameState ?? null
    this._screen    = 'root'
  }

  create() {
    const { width: W, height: H } = applyUiCamera(this)

    // Dimmed full-screen backdrop. Not interactive — Phaser's hit-test
    // would otherwise route pointerdown to this full-screen rect instead
    // of the AudioControls slider sitting on top of it. The scenes below
    // are paused anyway, so clicks can't fall through.
    this._dim = this.add.rectangle(0, 0, W, H, COL.dimOverlay, 0.72)
      .setOrigin(0).setDepth(0)

    // Centered panel container holds title + (root buttons | sub-screen content)
    this._panel = this.add.container(W / 2, H / 2).setDepth(10)
    const bg = this.add.graphics()
    glowPanel(bg, -PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, {
      fill: COL.panelFill, border: COL.panelBorder, glow: COL.panelGlow,
    })
    this._panel.add(bg)

    // Title — repositions per screen in _renderScreen
    this._title = this.add.text(0, -PANEL_H / 2 + 36, '', {
      fontSize: '28px', color: COL.title, fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setResolution(2)
    this._panel.add(this._title)

    // Content container — wiped + rebuilt on every screen change
    this._content = this.add.container(0, 0)
    this._panel.add(this._content)

    this._renderScreen()

    // ESC toggles: from a sub-screen go back to root; from root close pause.
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._screen !== 'root') this._setScreen('root')
      else                          PauseManager.close()
    })

    // Resize → re-center
    this.scale.on('resize', this._onResize, this)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this._onResize, this)
      this._audio?.destroy()
      this._audio = null
    })
  }

  _onResize() {
    if (!this._panel) return
    const { width: W, height: H } = applyUiCamera(this)
    this._dim.setSize(W, H)
    this._panel.setPosition(W / 2, H / 2)
    // Sub-screens that mount scene-space widgets (AudioControls is positioned
    // absolute, not parented to _panel) need a re-layout pass.
    if (this._screen === 'settings') this._renderScreen()
  }

  _setScreen(name) {
    this._screen = name
    this._renderScreen()
  }

  _renderScreen() {
    this._content.removeAll(true)
    if (this._audio) { this._audio.destroy(); this._audio = null }

    if      (this._screen === 'root')     this._renderRoot()
    else if (this._screen === 'settings') this._renderSettings()
    else if (this._screen === 'howto')    this._renderHowTo()
  }

  // ── Root menu ─────────────────────────────────────────────────────────────

  _renderRoot() {
    this._title.setText('PAUSED')

    const items = [
      { label: 'Resume',              onClick: () => PauseManager.close() },
      { label: 'Save & Exit to Menu', onClick: () => PauseManager.saveAndExitToMenu(this._gameState) },
      { label: 'Settings',            onClick: () => this._setScreen('settings') },
      { label: 'How to Play',         onClick: () => this._setScreen('howto') },
    ]

    const totalH = items.length * BTN_H + (items.length - 1) * BTN_GAP
    let y = -totalH / 2 + BTN_H / 2 + 30  // nudge below title

    for (const item of items) {
      this._content.add(this._makeButton(0, y, BTN_W, BTN_H, item.label, item.onClick))
      y += BTN_H + BTN_GAP
    }
  }

  // ── Settings sub-screen ───────────────────────────────────────────────────

  _renderSettings() {
    this._title.setText('SETTINGS')

    // "Volume" label + AudioControls slider
    const volY = -PANEL_H / 2 + 110
    this._content.add(this.add.text(-PANEL_W / 2 + 40, volY, 'Volume', {
      fontSize: '16px', color: COL.textBright, fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setResolution(2))

    // AudioControls is a constructed widget that lives at scene-space coords.
    // We mount it offset from the panel center; it positions itself absolute
    // to the scene, so we compute design-space x/y from the panel position.
    const W = this.uiW, H = this.uiH
    const audioX = W / 2 - PANEL_W / 2 + 130
    const audioY = H / 2 + volY - 12
    this._audio = new AudioControls(this, audioX, audioY, { depth: 20 })

    // Fullscreen toggle
    const fsY = volY + 60
    this._content.add(this.add.text(-PANEL_W / 2 + 40, fsY, 'Fullscreen', {
      fontSize: '16px', color: COL.textBright, fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setResolution(2))

    const isFs = this.scale.isFullscreen
    const fsBtn = this._makeButton(
      PANEL_W / 2 - 100, fsY, 140, 36,
      isFs ? 'ON' : 'OFF',
      () => {
        if (this.scale.isFullscreen) this.scale.stopFullscreen()
        else                          this.scale.startFullscreen()
        // Re-render so the button label updates. The browser fullscreen
        // change is async; setTimeout 0 lands us after the transition.
        setTimeout(() => this._setScreen('settings'), 0)
      },
    )
    this._content.add(fsBtn)

    // Back button
    this._content.add(this._makeButton(
      0, PANEL_H / 2 - 50, 200, 44, 'Back', () => this._setScreen('root'),
    ))
  }

  // ── How to Play sub-screen ────────────────────────────────────────────────

  _renderHowTo() {
    this._title.setText('HOW TO PLAY')

    const body =
      'OBJECTIVE\n' +
      '  You are the dungeon Boss. Adventurers come to kill you. Build a\n' +
      '  deadly lair and survive long enough to defeat them all.\n' +
      '\n' +
      'CURRENCIES\n' +
      '  Soul Essence — spent during NIGHT to place rooms, traps, and\n' +
      '    minions. Earned from kills during the day.\n' +
      '  Dark Power — long-term resource for unlocks and upgrades.\n' +
      '\n' +
      'DAY / NIGHT CYCLE\n' +
      '  NIGHT: free-build phase. Place rooms, set traps, summon minions.\n' +
      '  DAY:   adventurers raid. Watch the simulation and learn from it.\n' +
      '         Click an adventurer to follow them.\n' +
      '\n' +
      'BOSS FIGHT\n' +
      '  Survivors who reach your chamber trigger a one-on-one boss fight.\n' +
      '  Lose all 3 lives and the run ends.\n' +
      '\n' +
      'EVOLUTION\n' +
      '  Minions earn XP from kills. They level up between days, gaining\n' +
      '  stats and eventually evolving into stronger forms.\n' +
      '\n' +
      'KNOWLEDGE\n' +
      '  Adventurers gather intel as they explore. Open the Threat\n' +
      '  Assessment screen to see what they have learned about your\n' +
      '  dungeon — and plan your next night accordingly.'

    const txt = this.add.text(-PANEL_W / 2 + 30, -PANEL_H / 2 + 80, body, {
      fontSize: '12px', color: COL.textNormal, fontFamily: 'monospace',
      lineSpacing: 4, wordWrap: { width: PANEL_W - 60 },
    }).setOrigin(0, 0).setResolution(2)
    this._content.add(txt)

    this._content.add(this._makeButton(
      0, PANEL_H / 2 - 50, 200, 44, 'Back', () => this._setScreen('root'),
    ))
  }

  // ── Button factory ────────────────────────────────────────────────────────

  _makeButton(x, y, w, h, label, onClick) {
    const c = this.add.container(x, y)
    const g = this.add.graphics()
    const draw = (hover) => {
      g.clear()
      g.fillStyle(hover ? COL.btnFillHvr : COL.btnFill, 1)
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 6)
      g.lineStyle(2, hover ? COL.btnBorderHvr : COL.btnBorder, 1)
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6)
    }
    draw(false)
    const txt = this.add.text(0, 0, label, {
      fontSize: '18px', color: COL.textBright, fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setResolution(2)

    const hit = this.add.rectangle(0, 0, w, h, 0xffffff, 0.001)
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => { draw(true);  txt.setColor('#ffffff') })
    hit.on('pointerout',  () => { draw(false); txt.setColor(COL.textBright) })
    hit.on('pointerdown', () => {
      // Click flash — a quick visual confirm before the click handler runs
      draw(true)
      txt.setScale(0.97)
      this.time.delayedCall(70, () => { txt.setScale(1); onClick() })
    })

    c.add([g, txt, hit])
    return c
  }
}
