// TitlePickerOverlay — standalone title-equip screen.
//
// Lets the player pick which unlocked title they wear (shown on the main
// menu, the leaderboard, and the achievements screen). The same picker
// logic also lives inline inside AchievementsOverlay as a dropdown; this
// is the full-modal surface opened from the main-menu title pill so the
// player can change their flex without diving into the achievements hall.
//
// Each row renders with the title's own signature look — animated
// gradient text/border for the "super special" legendary fx titles,
// solid signature color for the normal coloured titles, and a plain
// fallback otherwise — resolved via titleFx.js from the granting
// achievement id. Picking AUTO clears the explicit selection so the
// active title tracks "most recently unlocked" again.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import {
  titleFxClassById, titleFxBorderClassById, titleColorById,
} from './titleFx.js'

export class TitlePickerOverlay {
  // opts.onChange(): fired after a successful pick (so the opener can
  //   surgically refresh whatever shows the equipped title).
  // opts.onClose():  fired when the modal closes (Esc / backdrop / X).
  constructor(opts = {}) {
    this._onChange = opts.onChange ?? null
    this._onClose  = opts.onClose ?? null
    this._overlay = new Overlay({
      title:  'EQUIP TITLE',
      width:  560,
      height: 640,
      accent: 'var(--gold)',
      onClose: () => { this._overlay = null; this._onClose?.() },
      body:   this._renderBody(),
    })
  }

  open()  { this._overlay?.open() }
  close() { this._overlay?.close() }

  _renderBody() {
    const titles = PlayerProfile.getUnlockedTitles()
    // Empty state — no titles earned yet. Point the player at where
    // titles come from instead of showing a blank list.
    if (!titles.length) {
      return h('div', { className: 'qf-titlepick' }, [
        h('div', { className: 'qf-titlepick-empty' }, [
          h('div', { className: 'qf-titlepick-empty-glyph' }, '✦'),
          h('div', { className: 'pix qf-titlepick-empty-head' }, 'NO TITLES YET'),
          h('div', { className: 'qf-titlepick-empty-sub' },
            'Earn titles by completing achievements in the HALL OF TROPHIES.'),
        ]),
      ])
    }

    const activeId = PlayerProfile.getActiveTitleId()
    const sorted = titles.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    return h('div', { className: 'qf-titlepick' }, [
      h('div', { className: 'pix qf-titlepick-intro' },
        'Choose the title worn beside your name — on the menu, the leaderboard, and the trophy hall.'),
      h('div', {
        className: 'qf-titlepick-list',
        ref: el => { this._listEl = el },
      }, this._rows(sorted, activeId)),
    ])
  }

  _rows(sorted, activeId) {
    return [
      // AUTO — clears the explicit pick; active title then tracks the
      // most-recently-unlocked one going forward.
      h('button', {
        className: 'qf-titlepick-row' + (activeId == null ? ' is-active' : ''),
        on: { click: () => this._select(null) },
      }, [
        h('div', { className: 'qf-titlepick-row-main' }, [
          h('span', { className: 'pix qf-titlepick-name' }, '◇ AUTO'),
          h('span', { className: 'qf-titlepick-sub' },
            '(most recent: ' + (sorted[0]?.name || '—') + ')'),
        ]),
        activeId == null && h('span', { className: 'pix qf-titlepick-check' }, 'EQUIPPED'),
      ]),
      // One row per unlocked title (most-recent first).
      ...sorted.map(t => {
        const fxBorder = titleFxBorderClassById(t.id)
        const tColor   = fxBorder ? null : titleColorById(t.id)
        const isActive = activeId === t.id
        return h('button', {
          className: ('qf-titlepick-row ' + fxBorder).trimEnd() +
                     (isActive ? ' is-active' : ''),
          style: tColor
            ? { borderColor: tColor, boxShadow: `0 0 14px ${tColor}44` }
            : undefined,
          on: { click: () => this._select(t.id) },
        }, [
          h('div', { className: 'qf-titlepick-row-main' }, [
            h('span', {
              className: ('pix qf-titlepick-name ' + titleFxClassById(t.id)).trimEnd(),
              style: tColor ? { color: tColor } : undefined,
            }, '✦ ' + t.name),
          ]),
          isActive && h('span', { className: 'pix qf-titlepick-check' }, 'EQUIPPED'),
        ])
      }),
    ]
  }

  _select(id) {
    PlayerProfile.setActiveTitleId(id)
    // (The delegated #hud-stage click listener already plays the button
    // press chip — no explicit SFX call needed here.)
    // Re-render the list in place so the new "EQUIPPED" marker + active
    // outline land without rebuilding the whole modal.
    if (this._listEl) {
      const titles = PlayerProfile.getUnlockedTitles()
      const sorted = titles.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
      this._listEl.replaceChildren(...this._rows(sorted, id).filter(Boolean))
    }
    this._onChange?.()
  }
}
