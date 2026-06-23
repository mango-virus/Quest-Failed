// DevToolsOverlay — mango-only dev panel (redesigned 2026-06-15).
//
// Hosted in the crypt Overlay shell (eyebrow "Mango · Cheat Access" + DEV TOOLS
// title, gold accent). A live-state chip strip (name / boss / save / build /
// env) sits above colour-coded tool groups (run shortcuts, editors, unlock-card
// tests, leaderboard-card tests) + a mango-only warning line.
//
// Each tool's `id` matches a case in MainMenuOverlay._activate — this overlay
// doesn't perform actions itself, it routes the chosen id back through
// `onAction(id)`. Adding a tool = one entry in DEV_TOOL_GROUPS + its _activate
// case.

import { h }       from './dom.js'
import { Overlay } from './Overlay.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { SaveSystem }    from '../systems/SaveSystem.js'

// Grouped for readability. `color` themes the group marker + each tool's icon
// and hover border. `id` must match a MainMenuOverlay._activate case.
const DEV_TOOL_GROUPS = [
  {
    label: 'RUN SHORTCUTS', color: '#5cc8d8',
    tools: [
      { id: 'jump50',    icon: '⏩', label: 'JUMP TO DAY 50',  sub: 'Boss lv 12 · late-game state' },
      { id: 'teststage', icon: '✦', label: 'VFX TEST STAGE',  sub: 'Clean arena · quiet day' },
    ],
  },
  {
    label: 'EDITORS', color: '#7fb53a',
    tools: [
      { id: 'rooms', icon: '▦', label: 'ROOM EDITOR', sub: 'Rooms · tiles · themes · doors' },
      { id: 'soundstudio', icon: '🔊', label: 'SOUND STUDIO', sub: 'Per-trigger sound · volume · pitch · swap' },
    ],
  },
  {
    label: 'UNLOCK NOTIFICATIONS', color: '#ffd964',
    tools: [
      { id: 'testunlock', icon: '✧', label: 'TEST UNLOCK CARDS', sub: 'Achievement · boss · 2 companions' },
    ],
  },
  {
    label: 'LEADERBOARD CARDS', color: '#ff5fb0',
    tools: [
      { id: 'testtop1', icon: '♛', label: 'PROMOTE → #1', sub: 'Top-3 reveal · rank 1' },
      { id: 'testtop2', icon: '♛', label: 'PROMOTE → #2', sub: 'Top-3 reveal · rank 2' },
      { id: 'testtop3', icon: '♛', label: 'PROMOTE → #3', sub: 'Top-3 reveal · rank 3' },
      { id: 'testdemoteoff',  icon: '▼', label: 'DEMOTE OFF PODIUM', sub: 'Dethroned card' },
      { id: 'testdemoteslip', icon: '▽', label: 'DEMOTE WITHIN',     sub: 'Slipped #1 → #3' },
    ],
  },
]

export class DevToolsOverlay {
  constructor(opts = {}) {
    this._onAction = opts.onAction ?? (() => {})
    this._onClose  = opts.onClose  ?? null
    this._overlay  = null
  }

  open() {
    if (this._overlay) return
    this._overlay = new Overlay({
      eyebrow:    'MANGO · CHEAT ACCESS',
      title:      'DEV TOOLS',
      width:      1056,
      height:     780,
      accent:     '#ffd964',
      atmosphere: true,
      onClose: () => { this._overlay = null; this._onClose?.() },
      body: this._renderBody(),
    })
    this._overlay.open()
  }

  close() { this._overlay?.close() }

  _renderBody() {
    return h('div', { className: 'qf-dv' }, [
      h('div', { className: 'qf-dv-state' }, this._state().map(s =>
        h('span', { className: 'sil qf-dv-chip' + (s.hot ? ' hot' : '') }, [
          s.k, ' ', h('b', null, s.v),
        ]))),
      ...DEV_TOOL_GROUPS.map(g => this._renderGroup(g)),
      h('div', { className: 'sil qf-dv-warn' },
        '⚠ Mango-only · these shortcuts skip the normal run flow. Not visible to ordinary keepers.'),
    ])
  }

  // Live read-only state chips. NAME + ENV are "hot" (green) as cheat markers.
  _state() {
    const name = (PlayerProfile.getName?.() || 'mango').toUpperCase()
    const save = SaveSystem.hasSave?.() ? SaveSystem.load?.() : null
    const saveStr = save
      ? `DAY ${save.meta?.dayNumber ?? 1} · LV ${save.boss?.level ?? 1}`
      : 'NO SAVE'
    return [
      { k: 'NAME', v: name + ' · CHEAT', hot: true },
      { k: 'BOSS', v: this._bossName(save) },
      { k: 'SAVE', v: saveStr },
      { k: 'BUILD', v: 'v0.1.4' },
      { k: 'ENV', v: 'DEV', hot: true },
    ]
  }

  _bossName(save) {
    const archId = String(save?.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (!archId) return '—'
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const archs = s.cache?.json?.get?.('bossArchetypes')
      if (Array.isArray(archs)) {
        const a = archs.find(x => x.id === archId)
        if (a?.name) return a.name.toUpperCase()
      }
    }
    return archId.replace(/_/g, ' ').toUpperCase()
  }

  _renderGroup(group) {
    return h('div', { className: 'qf-dv-group' }, [
      h('div', { className: 'qf-dv-ghead', style: { '--gc': group.color } }, [
        h('span', { className: 'dot' }),
        h('span', { className: 'pix t' }, group.label),
        h('span', { className: 'ln' }),
      ]),
      h('div', { className: 'qf-dv-tools' },
        group.tools.map(t => this._renderTool(t, group.color))),
    ])
  }

  _renderTool(t, color) {
    return h('button', {
      className: 'qf-dv-tool',
      style: { '--ic': color },
      // Close FIRST, then route — editor/jump shortcuts tear down the menu and
      // start a scene; notification tests open the unlock overlay. Either way
      // the dev panel should be gone before the next surface appears.
      on: { click: () => { this.close(); this._onAction(t.id) } },
    }, [
      h('span', { className: 'qf-dv-ico' }, t.icon),
      h('span', { className: 'qf-dv-tx' }, [
        h('span', { className: 'pix qf-dv-tl' }, t.label),
        h('span', { className: 'qf-dv-ts' }, t.sub),
      ]),
    ])
  }

  destroy() { this.close() }
}
