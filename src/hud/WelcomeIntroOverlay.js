// WelcomeIntroOverlay — the first-run onboarding (UI_POLISH_PLAN P3-2).
//
// Fires once per run on Game-scene boot when `gameState.meta.introSeen` is
// false, after the "NIGHT FALLS" cinematic / Act-I card clears. A paced
// 3-step intro — THE LOOP (you are the dungeon) → CONTROLS → DARK PACTS —
// with real in-game imagery (the chosen boss + a hero/minion sprite). It is
// the single canonical first-run teach for ALL players (it replaces the old
// companion-delivered spoken intro; the companion just does her normal day-1
// barks). Skippable (SKIP / Esc); first-run-gated so it never repeats.
//
// The "show how-to-play hints" choice persists to meta.tutorialEnabled +
// localStorage (TutorialSystem ANDs both). On completion it emits
// INTRO_DISMISSED so the rest of the boot flow proceeds.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { isActsEnabled } from '../config/acts.js'
import { animatedBossSprite, animatedMinion, animatedAdventurer } from './inGameSnapshot.js'
import { ensureAdventurerBaseSheet } from '../scenes/AdventurerBaseLoader.js'
import { getBind, keyLabel } from './HudKeybinds.js'

export class WelcomeIntroOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._tutorialChecked = true
    this._step = 0
    this._stopFns = []
  }

  // Open automatically if intro hasn't been seen. Waits for the first NIGHT
  // PHASE cinematic (or Act-I card) to finish so it doesn't overlap it.
  maybeOpen() {
    // Dev TEST STAGE — skip entirely so testing isn't gated behind a modal.
    if (globalThis.__qfDevTestStage) return
    if (this._gameState?.meta?.introSeen) return
    let _opened = false
    const onFinish = ({ phase } = {}) => { if (phase === 'night') tryOpen() }
    const onActDismissed = () => tryOpen()
    const tryOpen = () => {
      if (_opened) return
      _opened = true
      EventBus.off('PHASE_TRANSITION_FINISHED', onFinish)
      EventBus.off('ACT_INTRO_DISMISSED', onActDismissed)
      setTimeout(() => this.open(), 120)
    }
    if (isActsEnabled()) {
      EventBus.on('ACT_INTRO_DISMISSED', onActDismissed)
      setTimeout(tryOpen, 30000)
      return
    }
    EventBus.on('PHASE_TRANSITION_FINISHED', onFinish)
    setTimeout(tryOpen, 3200)
  }

  open() {
    if (this._overlay) return
    if (this._gameState?.meta?.introSeen) return
    // P3-2: the paced onboarding is now the canonical first-run teach for
    // EVERYONE (it no longer defers to the companion's spoken intro).
    this._step = 0
    this._overlay = new Overlay({
      eyebrow:  'A REVERSE ROGUELIKE',
      title:    'QUEST FAILED',
      sub:      'How to reign',
      width:    860,
      height:   660,
      accent:   'var(--blood)',
      atmosphere: true,
      closeOnBackdrop: false,
      onClose: () => { this._teardown() },
      body:    this._renderStep(),
    })
    // Esc = skip the intro (it's skippable); re-route the shell's Esc handler.
    if (this._overlay) {
      window.removeEventListener('keydown', this._overlay._escHandler)
      this._overlay._escHandler = (e) => { if (e.key === 'Escape') this._finish(true) }
      window.addEventListener('keydown', this._overlay._escHandler)
    }
    this._overlay.open()
  }

  // ── Steps ────────────────────────────────────────────────────────────────
  _steps() {
    return [
      { key: 'loop',    render: () => this._stepLoop() },
      { key: 'controls',render: () => this._stepControls() },
      { key: 'pacts',   render: () => this._stepPacts() },
    ]
  }

  _renderStep() {
    this._clearSprites()
    const steps = this._steps()
    const i = Math.max(0, Math.min(this._step, steps.length - 1))
    const last = i === steps.length - 1
    return h('div', { className: 'qf-intro' }, [
      // SKIP — always available; the intro is skippable.
      h('button', { className: 'qf-intro-skip', on: { click: () => this._finish(true) } }, 'SKIP  ✕'),
      // Step body
      h('div', { className: 'qf-intro-step' }, steps[i].render()),
      // Footer: progress dots + nav (+ the tutorial-hints opt-in on the last step)
      h('div', { className: 'qf-intro-foot' }, [
        last ? this._checkRow() : h('div', { className: 'qf-intro-foot-spacer' }),
        h('div', { className: 'qf-intro-dots' },
          steps.map((_, d) => h('span', { className: 'qf-intro-dot' + (d === i ? ' on' : '') }))),
        h('div', { className: 'qf-intro-nav' }, [
          i > 0 ? h('button', { className: 'btn', on: { click: () => this._go(-1) } }, '‹ BACK') : null,
          last
            ? h('button', { className: 'btn primary lg', on: { click: () => this._finish(false) } }, 'ENTER THE DUNGEON')
            : h('button', { className: 'btn primary', on: { click: () => this._go(1) } }, 'NEXT ›'),
        ]),
      ]),
    ])
  }

  // Step 1 — THE LOOP. The chosen boss as the hero, the 3-phase loop with
  // REAL in-game sprites (a minion, an invading hero, the boss reigning) — no
  // procedural fallbacks. Minion sheets load with the run; the adventurer base
  // sheet is on-demand (AdventurerBaseLoader), so the DAY slot starts as a glyph
  // and swaps in the real knight sprite the instant its sheet finishes loading.
  _stepLoop() {
    this._advFilled = false   // re-fill the DAY slot on each step-0 render
    const archId = String(this._gameState?.player?.bossArchetypeId ?? 'orc').replace(/^the_/, '')
    const boss = animatedBossSprite(archId, 116)
    if (boss?.stop) this._stopFns.push(boss.stop)
    const minionAnim = animatedMinion('goblin1', 56)   // looping idle (sheets load with the run)
    if (minionAnim?.stop) this._stopFns.push(minionAnim.stop)
    const minion = minionAnim?.el || null
    const bossMini = animatedBossSprite(archId, 56)
    if (bossMini?.stop) this._stopFns.push(bossMini.stop)
    // DAY adventurer — real sprite, loaded on demand + swapped in (see _fillAdventurer).
    const dayArt = h('div', { className: 'qf-intro-phase-art', ref: el => { this._advSlot = el } },
      [h('span', { className: 'qf-intro-phase-glyph' }, '⚔')])
    this._fillAdventurer(56)

    const phase = (cls, glyph, art, head, body) => h('div', { className: `qf-intro-phase ${cls}` }, [
      h('div', { className: 'qf-intro-phase-art' }, art || h('span', { className: 'qf-intro-phase-glyph' }, glyph)),
      h('div', { className: 'pix qf-intro-phase-head' }, head),
      h('div', { className: 'qf-intro-phase-body' }, body),
    ])

    return [
      h('div', { className: 'qf-intro-hero' }, [
        boss?.el ? h('div', { className: 'qf-intro-hero-art' }, [boss.el]) : null,
        h('div', { className: 'qf-intro-hero-copy' }, [
          h('div', { className: 'pix qf-intro-tagline' }, 'YOU ARE THE DUNGEON'),
          h('div', { className: 'qf-intro-lede' },
            'Most games make you the hero storming the dungeon. Here you ARE the dungeon — and the heroes are the invaders you must stop.'),
        ]),
      ]),
      h('div', { className: 'qf-intro-loop' }, [
        phase('night', '🌙', minion,
          'NIGHT · BUILD', 'Spend gold to place rooms, minions & traps along the path to your boss.'),
        h('div', { className: 'qf-intro-arrow' }, '➜'),
        // DAY — pre-built art slot (real adventurer swapped in by _fillAdventurer).
        h('div', { className: 'qf-intro-phase day' }, [
          dayArt,
          h('div', { className: 'pix qf-intro-phase-head' }, 'DAY · DEFEND'),
          h('div', { className: 'qf-intro-phase-body' }, 'Adventurers invade through the entry hall. Kill them before they reach the throne.'),
        ]),
        h('div', { className: 'qf-intro-arrow' }, '➜'),
        phase('grow', '♛', bossMini?.el ? [bossMini.el] : null,
          'GROW · REIGN', 'Kills earn gold & boss XP. Level up to unlock more — then repeat, stronger.'),
      ]),
    ]
  }

  // Load the adventurer base sheet on demand and swap the REAL looping-idle
  // sprite into the DAY slot the moment it's ready (its idle anim registers on
  // load — registerBaseAnimsForKey). Placeholder stays the ⚔ glyph (never a
  // procedural sprite). No-ops cleanly if the overlay closes mid-load.
  _fillAdventurer(size, cls = 'knight', vId = 'v01') {
    const put = () => {
      if (this._advFilled) return true
      const a = animatedAdventurer(cls, size, vId)
      if (a?.el && this._advSlot && this._overlay) {
        this._advFilled = true
        if (a.stop) this._stopFns.push(a.stop)
        this._advSlot.replaceChildren(a.el)
        return true
      }
      return false
    }
    if (put()) return
    const scene = window.__game?.scene?.getScene?.('Game')
    if (!scene) return
    if (ensureAdventurerBaseSheet(scene, cls, vId)) { put(); return }
    scene.load.once(`filecomplete-spritesheet-adv-${cls}-${vId}`, () => setTimeout(put, 50))
    // Safety poll in case the file-complete event is missed (shared loader batch).
    let tries = 0
    const poll = () => { if (!this._overlay || put() || tries++ > 20) return; setTimeout(poll, 200) }
    setTimeout(poll, 300)
  }

  // Step 2 — CONTROLS. Live keybinds (rebindable store) + camera + gamepad.
  _stepControls() {
    const keyRow = (label, ...keys) => h('div', { className: 'qf-intro-ctl' }, [
      h('span', { className: 'qf-intro-ctl-label' }, label),
      h('span', { className: 'qf-intro-ctl-keys' }, keys.map(k => h('kbd', { className: 'qf-intro-kbd' }, k))),
    ])
    const k = (id) => keyLabel(getBind(id))
    return [
      h('div', { className: 'pix qf-intro-step-head', style: { color: 'var(--gold)' } }, 'CONTROLS'),
      h('div', { className: 'qf-intro-ctl-cols' }, [
        h('div', { className: 'qf-intro-ctl-col' }, [
          h('div', { className: 'sil qf-intro-ctl-group' }, 'BUILD (NIGHT)'),
          keyRow('Place / build drawer', k('place')),
          keyRow('Move a placed piece', k('move')),
          keyRow('Upgrade', k('upgrade')),
          keyRow('Sell', k('sell')),
          keyRow('Begin the day', k('begin')),
        ]),
        h('div', { className: 'qf-intro-ctl-col' }, [
          h('div', { className: 'sil qf-intro-ctl-group' }, 'PANELS & DAY'),
          keyRow('Minion roster', k('roster')),
          keyRow('Knowledge map', k('map')),
          keyRow('Adventurer intel', k('intel')),
          keyRow('Game speed', k('speed1'), k('speed2'), k('speed3'), k('speed4')),
          keyRow('Pause / menu', 'ESC'),
        ]),
      ]),
      h('div', { className: 'qf-intro-ctl-foot' }, [
        h('div', {}, ['Camera: ', h('kbd', { className: 'qf-intro-kbd' }, 'W'), h('kbd', { className: 'qf-intro-kbd' }, 'A'), h('kbd', { className: 'qf-intro-kbd' }, 'S'), h('kbd', { className: 'qf-intro-kbd' }, 'D'), ' or drag to pan · scroll to zoom']),
        h('div', {}, '🎮 Gamepad supported — D-pad/stick to move, A select, B back. Rebind anything in Options → Controls.'),
      ]),
    ]
  }

  // Step 3 — DARK PACTS.
  _stepPacts() {
    const rarity = (c, l) => h('span', { className: 'qf-intro-rar', style: { '--rc': c } }, l)
    return [
      h('div', { className: 'pix qf-intro-step-head', style: { color: 'var(--info)' } }, 'DARK PACTS'),
      h('div', { className: 'qf-intro-pact' }, [
        h('div', { className: 'qf-intro-pact-sigil' }, '◆'),
        h('div', { className: 'qf-intro-pact-copy' }, [
          h('div', { className: 'qf-intro-lede' },
            'Between days you may seal a Dark Pact — a powerful boon with a dark catch. A bigger reward usually means a crueler price.'),
          h('div', { className: 'qf-intro-pact-eg' },
            '"Your minions hit twice as hard… but die in one blow." Choose the bargains that fit your dungeon.'),
          h('div', { className: 'qf-intro-pact-rars' }, [
            'Rarities: ',
            rarity('var(--text-mute)', 'Common'), rarity('var(--poison)', 'Uncommon'),
            rarity('var(--rumor)', 'Rare'), rarity('var(--info)', 'Epic'),
            rarity('var(--gold-bright)', 'Legendary'), rarity('#111', 'Damned'),
          ]),
        ]),
      ]),
    ]
  }

  _checkRow() {
    return h('button', {
      className: 'qf-intro-checkrow',
      on: { click: () => this._toggleCheck() },
    }, [
      h('div', {
        className: 'qf-welcome-checkbox',
        ref: el => { this._checkBoxEl = el },
        dataset: { on: this._tutorialChecked ? 'true' : 'false' },
      }, [h('span', { className: 'qf-welcome-check' }, '✓')]),
      h('span', { className: 'qf-welcome-checklabel' }, 'Show how-to-play hints as I play'),
    ])
  }

  _toggleCheck() {
    this._tutorialChecked = !this._tutorialChecked
    if (this._checkBoxEl) this._checkBoxEl.dataset.on = this._tutorialChecked ? 'true' : 'false'
  }

  _go(delta) {
    this._step = Math.max(0, Math.min(this._step + delta, this._steps().length - 1))
    this._overlay?.setBody(this._renderStep())
  }

  _finish(skipped) {
    if (this._gameState?.meta) {
      this._gameState.meta.introSeen = true
      this._gameState.meta.tutorialEnabled = this._tutorialChecked
    }
    // Welcome screen is the canonical first-touch opt-in/out — propagate the
    // hint choice to the persistent setting (TutorialSystem ANDs both).
    try { localStorage.setItem('qf.gameplay.tutorials', this._tutorialChecked ? 'true' : 'false') } catch {}
    EventBus.emit('INTRO_DISMISSED', { tutorialEnabled: this._tutorialChecked, skipped: !!skipped })
    const ov = this._overlay
    this._overlay = null
    this._clearSprites()
    if (ov) { ov._opts && (ov._opts.onClose = null); ov.close() }
  }

  _clearSprites() {
    for (const stop of this._stopFns) { try { stop() } catch {} }
    this._stopFns = []
  }

  _teardown() {
    this._clearSprites()
    this._overlay = null
  }

  destroy() {
    this._clearSprites()
    this._overlay?.close()
    this._overlay = null
  }
}
