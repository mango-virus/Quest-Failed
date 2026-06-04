// DevToolsOverlay — mango-only dev panel that consolidates every
// developer shortcut into one modal so the main menu stays compact.
//
// The main menu used to list each dev tool as its own row (JUMP TO
// DAY 50, ROOM EDITOR, TILESET EDITOR, TEST UNLOCKS, TEST TOP-3 ×3…),
// which ran off the bottom of the panel and would only get worse as
// more tools were added. Now the cheat-name menu shows a single
// "DEV TOOLS" row that opens this overlay.
//
// Each tool's `id` matches a case in MainMenuOverlay._activate — this
// overlay doesn't perform actions itself, it routes the chosen id back
// through `onAction(id)` so there's a single source of truth for what
// each shortcut does. Adding a new tool is a one-line edit to
// DEV_TOOL_GROUPS below PLUS its case in MainMenuOverlay._activate.

import { h }       from './dom.js'
import { Overlay } from './Overlay.js'

// Dev tools, grouped for readability. `id` must match a MainMenuOverlay
// _activate case. `color` themes the icon + hover border (a CSS var or
// resolved color). Order within a group is display order.
const DEV_TOOL_GROUPS = [
  {
    label: 'RUN SHORTCUTS',
    tools: [
      { id: 'jump50',    label: 'JUMP TO DAY 50',  sub: 'Late-game wave test (day 50, boss L12)', icon: '▶', color: 'var(--blood)' },
      { id: 'teststage', label: 'JUMP TO TEST STAGE', sub: 'Clean VFX stage: arena built, NO wave (day 8, boss L10)', icon: '🧪', color: 'var(--poison)' },
    ],
  },
  {
    label: 'EDITORS',
    tools: [
      { id: 'rooms', label: 'ROOM EDITOR',    sub: 'Edit room layouts',  icon: '▤', color: 'var(--poison)' },
      { id: 'tiles', label: 'TILESET EDITOR', sub: 'Author tile themes', icon: '▦', color: 'var(--info)' },
    ],
  },
  {
    label: 'NOTIFICATION TESTS',
    tools: [
      { id: 'testunlock', label: 'TEST UNLOCKS', sub: 'Fire sample of each card type',     icon: '✦', color: 'var(--gold-bright, #ffd964)' },
      { id: 'testtop1',   label: 'TEST TOP-3 #1', sub: 'Champion (gold) podium card',      icon: '★', color: '#ffd964' },
      { id: 'testtop2',   label: 'TEST TOP-3 #2', sub: 'Runner-up (silver) podium card',   icon: '★', color: '#d9e2ec' },
      { id: 'testtop3',   label: 'TEST TOP-3 #3', sub: 'Podium-finish (bronze) card',      icon: '★', color: '#e09858' },
      { id: 'testdemoteoff',  label: 'TEST DEMOTION ✦ OFF',  sub: 'Dethroned — fell off the podium',  icon: '▼', color: '#d0566a' },
      { id: 'testdemoteslip', label: 'TEST DEMOTION ✦ SLIP', sub: 'Knocked down — #1 → #2 on podium',  icon: '▼', color: '#d0566a' },
    ],
  },
]

export class DevToolsOverlay {
  constructor(opts = {}) {
    // onAction(id) — route the chosen tool's id back to the caller
    // (MainMenuOverlay._activate). onClose — caller cleanup hook.
    this._onAction = opts.onAction ?? (() => {})
    this._onClose  = opts.onClose  ?? null
    this._overlay  = null
  }

  open() {
    if (this._overlay) return
    const body = h('div', { className: 'qf-devtools' },
      DEV_TOOL_GROUPS.map(group => this._renderGroup(group)))
    this._overlay = new Overlay({
      title:     '⚙  DEV TOOLS',
      // Poison-green accent matches the editor tools' color family and
      // signals "developer surface" distinct from the blood-red game
      // chrome. Sized to fit the current tool count with room to grow;
      // the body scrolls (overflow auto) if the list outgrows it.
      width:     520,
      height:    560,
      accent:    'var(--poison)',
      frame:     'plain',   // subtle main-menu edge instead of the accent frame
      animation: 'panel',
      onClose: () => {
        this._overlay = null
        this._onClose?.()
      },
      body,
    })
    this._overlay.open()
  }

  close() { this._overlay?.close() }

  _renderGroup(group) {
    return h('div', { className: 'qf-devtools-group' }, [
      h('div', { className: 'pix qf-devtools-grouphead' }, group.label),
      h('div', { className: 'qf-devtools-tools' },
        group.tools.map(t => this._renderTool(t))),
    ])
  }

  _renderTool(t) {
    return h('button', {
      className: 'btn qf-devtools-tool',
      style: { '--item-color': t.color },
      // Close the panel FIRST, then route the action — so editor/jump
      // shortcuts (which tear down the menu and start a scene) and the
      // notification tests (which open the unlock overlay) both land
      // with the dev panel already dismissed instead of lingering
      // behind the next surface.
      on: { click: () => { this.close(); this._onAction(t.id) } },
    }, [
      h('span', {
        className: 'pix qf-devtools-tool-icon',
        style: { color: t.color },
      }, t.icon),
      h('div', { className: 'qf-devtools-tool-textcol' }, [
        h('div', { className: 'pix qf-devtools-tool-label' }, t.label),
        h('div', { className: 'qf-devtools-tool-sub' }, t.sub),
      ]),
    ])
  }

  destroy() { this.close() }
}
