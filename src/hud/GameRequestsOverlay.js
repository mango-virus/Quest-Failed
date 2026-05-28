// GameRequestsOverlay — feedback / bug-report / wishlist modal.
//
// Two modes, switched via the header toggle:
//   • SUBMIT (all players) — form: category dropdown, optional feeling
//     radio (only when category=difficulty), title, body, send. Posts
//     to Supabase via GameRequests.submit, which auto-attaches a context
//     blob (current day, boss, build, run stats, etc.).
//   • INBOX  (mango-only)  — read-only list of recent submissions
//     pulled via GameRequests.list, sortable by date, with per-row
//     context summary + status pill + notes preview. Status / notes
//     are managed via the Supabase dashboard.
//
// Visual style mirrors the rest of the new HUD: Overlay shell + pixel
// chrome, Press Start 2P labels, gold/blood accents, tight spacing.
//
// The "NEW" badge beside the menu item is cleared when this overlay
// opens — see MainMenuOverlay._openGameRequests for the wiring.

import { h }           from './dom.js'
import { Overlay }     from './Overlay.js'
import { HudSfx }      from './HudSfx.js'
import { GameRequests } from '../systems/GameRequests.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'

const CATEGORY_LABELS = {
  bug:         'Bug Report',
  difficulty:  'Difficulty Feedback',
  boss:        'Boss Request',
  item:        'Item Request',
  companion:   'Companion Request',
  room:        'Dungeon Room Request',
  achievement: 'Achievement Request',
  mechanic:    'Mechanic / Feature Request',
  other:       'Other',
}

const FEELING_LABELS = {
  too_easy:   'Too Easy',
  just_right: 'Just Right',
  too_hard:   'Too Hard',
}

const STATUS_LABELS = {
  new:     'NEW',
  triaged: 'TRIAGED',
  planned: 'PLANNED',
  shipped: 'SHIPPED',
  wontfix: "WON'T FIX",
}

// Category-specific body placeholder — tailored prompts make it easier
// for players to give actionable info. Falls back to generic prompt.
const BODY_PLACEHOLDERS = {
  bug:         'What happened? Steps to reproduce, if possible. What did you expect to happen instead?',
  difficulty:  'What part felt off? Was it a specific boss / day / enemy / room? What were you doing when it felt that way?',
  boss:        'Describe the boss you’d like to see — theme, abilities, what makes them a threat to adventurers.',
  item:        'What does the item do? When would a player want to buy / find it?',
  companion:   'Who is the companion, and what do they say / do during play?',
  room:        'What does the room do? What kind of adventurer is it meant to stop?',
  achievement: 'What does the player do to earn it? What does it reward?',
  mechanic:    'What mechanic or feature would you like added? How does it work?',
  other:       'Tell us what’s on your mind.',
}

// Header eyebrow under the title — sets expectations for what's
// included with the submission.
const SUBMIT_NOTE = 'Your current day, boss, and run stats are included automatically so the dev can see what you were doing.'

export class GameRequestsOverlay {
  constructor(opts = {}) {
    this._onClose = opts.onClose ?? null
    this._isMango = !!PlayerProfile.isCheatName?.()
    // Mode starts in submit for normal players; mango lands on submit
    // too (most common admin action — testing the form) but can flip to
    // the inbox via the header toggle.
    this._mode = 'submit'
    // Form state lives on the instance so re-renders (mode toggles)
    // preserve what the user already typed.
    this._form = {
      category: 'difficulty',   // sensible default — the form looks lively from first paint
      feeling:  'just_right',
      title:    '',
      body:     '',
    }
    this._inbox = { loading: false, rows: [], error: null, filter: 'all' }
    this._overlay = new Overlay({
      title:    'GAME REQUESTS',
      width:    560,
      height:   640,
      accent:   'var(--rumor, #5cc0ff)',
      onClose:  () => this._onClose?.(),
      scrollLock: false,
      animation: 'panel',
      body:     this._buildBody(),
    })
  }

  open()  { this._overlay.open() }
  close() { this._overlay.close() }

  // ── Build / re-render ──────────────────────────────────────────────
  // The overlay shell stays the same; only the body swaps when the
  // mode toggles (submit ↔ inbox) or after a successful submission
  // (form reset).
  _buildBody() {
    const root = h('div', {
      className: 'qf-greq-root',
      ref: el => { this._rootEl = el },
    }, this._renderActiveMode())
    return root
  }

  _rerenderBody() {
    if (!this._rootEl) return
    this._rootEl.replaceChildren(...this._renderActiveMode())
  }

  _renderActiveMode() {
    const header = this._renderHeader()
    if (this._mode === 'inbox' && this._isMango) {
      return [header, this._renderInbox()]
    }
    return [header, this._renderSubmit()]
  }

  _renderHeader() {
    // Mode toggle (mango only). Sits above the form/inbox; uses the
    // existing pill-button styles for consistency.
    if (!this._isMango) {
      return h('div', { className: 'qf-greq-headernote pix' }, SUBMIT_NOTE)
    }
    return h('div', { className: 'qf-greq-toggle' }, [
      h('button', {
        className: 'qf-greq-toggle-btn' + (this._mode === 'submit' ? ' active' : ''),
        on: { click: () => this._setMode('submit') },
      }, '+ NEW REQUEST'),
      h('button', {
        className: 'qf-greq-toggle-btn' + (this._mode === 'inbox' ? ' active' : ''),
        on: { click: () => this._setMode('inbox') },
      }, '⌕ INBOX'),
    ])
  }

  _setMode(mode) {
    if (mode === this._mode) return
    this._mode = mode
    HudSfx?.playUi?.('tab')
    this._rerenderBody()
    if (mode === 'inbox') this._loadInbox()
  }

  // ── Submit form ────────────────────────────────────────────────────
  _renderSubmit() {
    const f = this._form
    const isDifficulty = f.category === 'difficulty'
    return h('div', { className: 'qf-greq-form' }, [
      this._isMango ? null : null, // headernote already in header for non-mango
      // CATEGORY
      h('label', { className: 'qf-greq-field' }, [
        h('span', { className: 'pix qf-greq-label' }, 'WHAT IS THIS?'),
        h('select', {
          className: 'qf-greq-input qf-greq-select',
          on: { change: (e) => {
            f.category = e.target.value
            // Reset feeling when leaving difficulty so a stale value
            // never gets POSTed. Re-render to toggle the radio block.
            if (f.category !== 'difficulty') f.feeling = null
            else if (!f.feeling) f.feeling = 'just_right'
            this._rerenderBody()
          } },
        }, GameRequests.CATEGORIES.map(c =>
          h('option', { value: c, selected: c === f.category ? '' : undefined }, CATEGORY_LABELS[c])
        )),
      ]),

      // FEELING — only visible for difficulty
      isDifficulty && h('div', { className: 'qf-greq-field' }, [
        h('span', { className: 'pix qf-greq-label' }, 'HOW DOES IT FEEL?'),
        h('div', { className: 'qf-greq-radios' },
          GameRequests.FEELINGS.map(fId => h('label', {
            className: 'qf-greq-radio' + (f.feeling === fId ? ' active' : ''),
          }, [
            h('input', {
              type: 'radio', name: 'qf-greq-feel', value: fId,
              // h() routes `checked` through `el.checked = v` (direct
              // property), so we MUST pass a boolean — not '' (falsy).
              checked: f.feeling === fId ? true : undefined,
              on: { change: () => { f.feeling = fId; this._rerenderBody() } },
            }),
            h('span', { className: 'pix' }, FEELING_LABELS[fId]),
          ])),
        ),
      ]),

      // TITLE
      h('label', { className: 'qf-greq-field' }, [
        h('div', { className: 'qf-greq-labelrow' }, [
          h('span', { className: 'pix qf-greq-label' }, 'TITLE'),
          h('span', {
            className: 'pix qf-greq-counter',
            ref: el => { this._titleCounterEl = el },
          }, `${f.title.length} / 80`),
        ]),
        h('input', {
          type: 'text',
          className: 'qf-greq-input',
          value:     f.title,
          maxLength: 80,
          placeholder: 'Short summary',
          on: { input: (e) => {
            f.title = e.target.value
            if (this._titleCounterEl) this._titleCounterEl.textContent = `${f.title.length} / 80`
          } },
        }),
      ]),

      // BODY
      h('label', { className: 'qf-greq-field' }, [
        h('div', { className: 'qf-greq-labelrow' }, [
          h('span', { className: 'pix qf-greq-label' }, 'DETAILS'),
          h('span', {
            className: 'pix qf-greq-counter',
            ref: el => { this._bodyCounterEl = el },
          }, `${f.body.length} / 1500`),
        ]),
        h('textarea', {
          className: 'qf-greq-input qf-greq-textarea',
          rows: 7,
          maxLength: 1500,
          placeholder: BODY_PLACEHOLDERS[f.category] ?? BODY_PLACEHOLDERS.other,
          on: { input: (e) => {
            f.body = e.target.value
            if (this._bodyCounterEl) this._bodyCounterEl.textContent = `${f.body.length} / 1500`
          } },
        }, f.body),
      ]),

      // Context-disclosure note (mango sees it too — useful reminder)
      h('div', { className: 'qf-greq-note pix' }, [
        h('span', { className: 'qf-greq-note-icon' }, '▶'),
        ' Your current day, boss, and run stats are included with the request.',
      ]),

      // Error / status line — populated by _submit
      h('div', {
        className: 'qf-greq-status',
        ref: el => { this._statusEl = el },
      }, ''),

      // SUBMIT
      h('div', { className: 'qf-greq-actions' }, [
        h('button', {
          className: 'btn primary qf-greq-submit',
          ref: el => { this._submitBtnEl = el },
          on: { click: () => this._submit() },
        }, 'SUBMIT REQUEST'),
      ]),
    ].filter(Boolean))
  }

  async _submit() {
    if (this._submitting) return
    const f = this._form
    this._setStatus('Sending…', 'pending')
    if (this._submitBtnEl) this._submitBtnEl.disabled = true
    this._submitting = true
    try {
      const res = await GameRequests.submit({
        category: f.category,
        feeling:  f.feeling,
        title:    f.title,
        body:     f.body,
        gameState: window.__game?.scene?.getScene?.('Game')?.gameState ?? null,
      })
      if (res.ok) {
        HudSfx?.playUi?.('unlock_reward')
        this._setStatus('Thanks — your request is in! 🗡️', 'ok')
        // Clear form so the player can submit another without
        // re-typing. Mode stays on submit; mango can flip to inbox to
        // see their own entry land.
        this._form = {
          category: f.category,        // keep selected bucket
          feeling:  f.category === 'difficulty' ? 'just_right' : null,
          title:    '',
          body:     '',
        }
        // Re-render the form (with new empty fields) but preserve our
        // success-status line by re-stamping it after the rerender.
        const msg = this._statusEl?.textContent
        this._rerenderBody()
        if (this._statusEl && msg) {
          this._statusEl.textContent = msg
          this._statusEl.className = 'qf-greq-status qf-greq-status-ok'
        }
      } else {
        HudSfx?.playUi?.('denied')
        this._setStatus(res.error || 'Could not send. Try again in a bit.', 'err')
      }
    } finally {
      this._submitting = false
      if (this._submitBtnEl) this._submitBtnEl.disabled = false
    }
  }

  _setStatus(text, kind) {
    if (!this._statusEl) return
    this._statusEl.textContent = text
    this._statusEl.className = 'qf-greq-status' +
      (kind === 'ok'      ? ' qf-greq-status-ok' :
       kind === 'err'     ? ' qf-greq-status-err' :
       kind === 'pending' ? ' qf-greq-status-pending' : '')
  }

  // ── Inbox (mango only) ─────────────────────────────────────────────
  _renderInbox() {
    const filters = ['all', ...GameRequests.CATEGORIES]
    return h('div', { className: 'qf-greq-inbox' }, [
      h('div', { className: 'qf-greq-inbox-filters' }, [
        h('span', { className: 'pix qf-greq-label' }, 'FILTER'),
        h('select', {
          className: 'qf-greq-input qf-greq-select qf-greq-filterselect',
          on: { change: (e) => { this._inbox.filter = e.target.value; this._renderInboxRows() } },
        }, filters.map(c => h('option', {
          value: c, selected: c === this._inbox.filter ? '' : undefined,
        }, c === 'all' ? 'All categories' : CATEGORY_LABELS[c]))),
        h('button', {
          className: 'qf-greq-toggle-btn',
          on: { click: () => this._loadInbox() },
        }, '↻ REFRESH'),
      ]),
      h('div', {
        className: 'qf-greq-inbox-list',
        ref: el => { this._inboxListEl = el },
      }, this._renderInboxBodyContent()),
    ])
  }

  _renderInboxBodyContent() {
    const ib = this._inbox
    if (ib.loading) return [h('div', { className: 'qf-greq-inbox-empty pix' }, 'Loading…')]
    if (ib.error)   return [h('div', { className: 'qf-greq-inbox-empty pix qf-greq-status-err' }, ib.error)]
    const rows = ib.filter === 'all' ? ib.rows : ib.rows.filter(r => r.category === ib.filter)
    if (rows.length === 0) {
      return [h('div', { className: 'qf-greq-inbox-empty pix' }, 'No requests yet.')]
    }
    return rows.map(r => this._renderInboxCard(r))
  }

  _renderInboxRows() {
    if (!this._inboxListEl) return
    this._inboxListEl.replaceChildren(...this._renderInboxBodyContent())
  }

  _renderInboxCard(row) {
    const cat   = CATEGORY_LABELS[row.category] ?? row.category
    const feel  = row.feeling ? FEELING_LABELS[row.feeling] : null
    const ctx   = row.context ?? {}
    const ctxParts = []
    if (ctx.day != null)           ctxParts.push(`Day ${ctx.day}`)
    if (ctx.bossArchetype)         ctxParts.push(this._fmtBossName(ctx.bossArchetype) + (ctx.bossLevel ? ` L${ctx.bossLevel}` : ''))
    if (ctx.totalKills != null)    ctxParts.push(`${ctx.totalKills} kills`)
    const created = this._fmtDate(row.created_at)
    const status  = STATUS_LABELS[row.status] ?? (row.status ?? 'NEW').toUpperCase()
    return h('div', { className: 'qf-greq-card' }, [
      h('div', { className: 'qf-greq-card-head' }, [
        h('span', { className: 'pix qf-greq-card-cat' }, cat.toUpperCase()),
        feel && h('span', { className: 'pix qf-greq-card-feel' }, feel.toUpperCase()),
        h('span', { className: 'pix qf-greq-card-status', dataset: { status: row.status ?? 'new' } }, status),
      ].filter(Boolean)),
      h('div', { className: 'pix qf-greq-card-title' }, row.title),
      h('div', { className: 'qf-greq-card-body' }, row.body),
      h('div', { className: 'qf-greq-card-foot pix' }, [
        h('span', { className: 'qf-greq-card-author' }, row.player_name || 'anon'),
        h('span', { className: 'qf-greq-card-sep' }, '·'),
        h('span', { className: 'qf-greq-card-time' }, created),
        ctxParts.length > 0 && h('span', { className: 'qf-greq-card-sep' }, '·'),
        ctxParts.length > 0 && h('span', { className: 'qf-greq-card-ctx' }, ctxParts.join(' · ')),
      ].filter(Boolean)),
      row.notes && h('div', { className: 'qf-greq-card-notes pix' }, [
        h('span', { className: 'qf-greq-card-notes-label' }, 'NOTES'),
        ' ',
        row.notes,
      ]),
    ].filter(Boolean))
  }

  async _loadInbox() {
    if (!this._isMango) return
    this._inbox.loading = true
    this._inbox.error = null
    this._renderInboxRows()
    const res = await GameRequests.list({ limit: 200 })
    this._inbox.loading = false
    if (res.ok) {
      this._inbox.rows = res.rows
      this._inbox.error = null
    } else {
      this._inbox.rows = []
      this._inbox.error = res.error || 'Could not load.'
    }
    this._renderInboxRows()
  }

  _fmtBossName(id) {
    if (!id) return ''
    return String(id).replace(/^the_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
  _fmtDate(iso) {
    try {
      const d = new Date(iso)
      const now = new Date()
      const diffSec = Math.max(0, (now.getTime() - d.getTime()) / 1000)
      if (diffSec < 60)        return 'just now'
      if (diffSec < 3600)      return `${Math.floor(diffSec / 60)}m ago`
      if (diffSec < 86400)     return `${Math.floor(diffSec / 3600)}h ago`
      if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`
      return d.toLocaleDateString()
    } catch {
      return iso ?? ''
    }
  }
}
