// MinionInspectorOverlay (DOM) — Phase 34E port of
// `src/ui/MinionInspector.js`. Top-right panel that opens on
// `MINION_CLICKED` and lists the minion's name + level + stats +
// evolution history. Rebuilds itself on minion-leveled / minion-evolved
// / minion-named events so it stays current.
//
// The Phaser version used a `window.prompt` for the rename action.
// This version uses the DOM `NameEntryOverlay` so the rename modal
// keeps the new HUD's pixel-art style instead of falling out to a
// native browser dialog.
//
// Mounts into #hud-stage. Auto-closes on NIGHT/DAY phase change to
// match the Phaser version's behavior.

import { h, mount } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { NameEntryOverlay } from './NameEntryOverlay.js'

export class MinionInspectorOverlay {
  constructor(gameState) {
    this._gs        = gameState
    this._listeners = []
    this._minionId  = null
    this._nameEntry = null

    this._stage = document.getElementById('hud-stage')
    if (!this._stage) return
    this._build()
    this._wireEvents()
  }

  _build() {
    this.el = h('div', { className: 'qf-mininsp' })
    this._stage.appendChild(this.el)
  }

  _wireEvents() {
    const sub = (event, fn) => { EventBus.on(event, fn); this._listeners.push([event, fn]) }
    sub('MINION_CLICKED',      ({ minion } = {}) => this._open(minion))
    sub('MINION_LEVELED_UP',   () => this._refresh())
    sub('MINION_EVOLVED',      () => this._refresh())
    sub('MINION_NAMED',        () => this._refresh())
    sub('NIGHT_PHASE_STARTED', () => this.close())
    sub('DAY_PHASE_STARTED',   () => this.close())
  }

  _open(minion) {
    if (!minion || !this.el) return
    this._minionId = minion.instanceId
    this._render(minion)
    this.el.classList.add('open')
  }

  close() {
    if (!this.el) return
    this._minionId = null
    this.el.classList.remove('open')
    mount(this.el, null)
    this._nameEntry?.close()
    this._nameEntry = null
  }

  _refresh() {
    if (!this._minionId) return
    const m = (this._gs.minions ?? []).find(x => x.instanceId === this._minionId)
    if (!m) { this.close(); return }
    this._render(m)
  }

  _render(m) {
    const def = this._minionDef(m)
    const displayName = m.name || def?.name || m.definitionId
    const typeName    = def?.name || m.definitionId

    mount(this.el, [
      h('div', { className: 'qf-mininsp-head' }, [
        h('div', { className: 'qf-mininsp-titlerow' }, [
          h('div', { className: 'pix qf-mininsp-title' }, displayName),
          h('button', {
            className: 'qf-mininsp-rename',
            title: 'Rename minion',
            on: { click: () => this._openRename(m, displayName) },
          }, '✎'),
        ]),
        h('button', {
          className: 'qf-mininsp-close',
          title: 'Close',
          on: { click: () => this.close() },
        }, '×'),
      ]),
      h('div', { className: 'qf-mininsp-sub' }, [
        `${typeName}  ·  Level ${m.bossLevel ?? 1}`,
        m.hasBounty ? h('span', { className: 'qf-mininsp-sub-bounty' }, '  ★ BOUNTY') : null,
      ]),

      h('div', { className: 'qf-mininsp-stats' }, [
        this._statRow('HP',      `${Math.round(m.resources?.hp ?? 0)} / ${Math.round(m.resources?.maxHp ?? 0)}`),
        this._statRow('Attack',  m.stats?.attack ?? 0),
        this._statRow('Defense', m.stats?.defense ?? 0),
        this._statRow('Speed',   (m.stats?.speed ?? 1.0).toFixed(1)),
        h('div', { className: 'qf-mininsp-stats-gap' }),
        this._statRow('Kills',   m.bountyKillCount ?? 0),
        this._statRow('Faction', m.faction ?? 'dungeon'),
      ]),

      m.evolutionHistory?.length
        ? h('div', { className: 'qf-mininsp-evo' }, [
            h('div', { className: 'pix qf-mininsp-evo-title' }, 'EVOLUTIONS'),
            ...m.evolutionHistory.map(evo => h(
              'div', { className: 'qf-mininsp-evo-row' },
              `→ ${evo.name} (Day ${evo.day})`,
            )),
          ])
        : null,
    ])
  }

  _statRow(label, value) {
    return h('div', { className: 'qf-mininsp-stat' }, [
      h('span', { className: 'qf-mininsp-stat-label' }, label),
      h('span', { className: 'qf-mininsp-stat-value' }, String(value)),
    ])
  }

  _openRename(minion, current) {
    if (this._nameEntry) return
    this._nameEntry = new NameEntryOverlay({
      title:    'RENAME MINION',
      instruction: 'A true name to remember the slaughter by.',
      initial:  current,
      confirmLabel: 'CONFIRM',
      onConfirm: (name) => {
        this._nameEntry = null
        if (!name) return
        minion.name = name
        EventBus.emit('MINION_NAMED', { minion, name })
      },
      onCancel: () => { this._nameEntry = null },
    })
    this._nameEntry.open()
  }

  _minionDef(m) {
    const scenes = window.__game?.scene?.scenes ?? []
    for (const s of scenes) {
      const types = s.cache?.json?.get?.('minionTypes')
      if (Array.isArray(types)) {
        const def = types.find(d => d.id === m.definitionId)
        if (def) return def
      }
    }
    return null
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this._nameEntry?.close()
    this._nameEntry = null
    this.el?.remove()
  }
}
