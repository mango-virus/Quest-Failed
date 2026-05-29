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
    this._inbox  = { loading: false, rows: [], error: null, filter: 'all' }
    this._mymail = { loading: false, rows: [], error: null }
    // Confirmation state for delete in the admin inbox — { id } means
    // the card is showing a confirm-cancel bar instead of the delete
    // button.
    this._confirmDelete = null
    // Per-row dirty-edit cache so the SEND REPLY button has something
    // to commit. Keyed by row.id → { status?, notes? } holding values
    // that differ from what's on the server. Cleared after a successful
    // PATCH or when the inbox is refreshed (server wins on refresh).
    this._unsavedEdits = new Map()
    this._overlay = new Overlay({
      title:    'GAME REQUESTS',
      width:    560,
      height:   640,
      accent:   'var(--rumor, #5cc0ff)',
      frame:    'plain',   // subtle main-menu edge instead of the accent frame
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
    if (this._mode === 'mymail') {
      return [header, this._renderMyMail()]
    }
    return [header, this._renderSubmit()]
  }

  _renderHeader() {
    // Three-mode tab strip:
    //   [+ NEW REQUEST]   submit form (everyone)
    //   [✉ MY MAIL]       this player's submissions + replies (everyone)
    //   [⌕ INBOX]         all submissions, admin controls (mango only)
    //
    // Mail-count chip on MY MAIL / INBOX reads from GameRequests cached
    // counts so the badge fires the moment the tab loads (no flicker).
    const playerMail = GameRequests.getCachedPlayerMail?.() ?? 0
    const adminMail  = GameRequests.getCachedAdminMail?.()  ?? 0
    const tabs = [
      { id: 'submit', label: '+ NEW REQUEST', count: 0 },
      { id: 'mymail', label: '✉ MY MAIL',    count: playerMail },
    ]
    if (this._isMango) tabs.push({ id: 'inbox', label: '⌕ INBOX', count: adminMail })
    return h('div', { className: 'qf-greq-toggle' }, tabs.map(t => h('button', {
      className: 'qf-greq-toggle-btn' + (this._mode === t.id ? ' active' : ''),
      on: { click: () => this._setMode(t.id) },
    }, [
      t.label,
      t.count > 0 && h('span', { className: 'qf-greq-toggle-count' }, String(t.count)),
    ].filter(Boolean))))
  }

  _setMode(mode) {
    if (mode === this._mode) return
    this._mode = mode
    HudSfx?.playUi?.('tab')
    this._rerenderBody()
    if (mode === 'inbox')  this._loadInbox()
    if (mode === 'mymail') this._loadMyMail()
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
    const isConfirming = this._confirmDelete === row.id
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

      // ── ADMIN CONTROLS ─────────────────────────────────────────────
      // Status dropdown + editable notes + delete + explicit SEND REPLY.
      // Status / notes edits are staged locally in `_unsavedEdits` and
      // only land in Supabase when mango clicks SEND REPLY — that way
      // they can change a few things across cards and commit each one
      // deliberately, without surprise "save on blur" behavior.
      this._renderAdminControls(row, { isConfirming }),
    ].filter(Boolean))
  }

  // ── Admin controls + SEND REPLY ──────────────────────────────────
  // Builds the lower half of an inbox card: status dropdown + delete
  // (top row), notes textarea (middle row), SEND REPLY button (bottom).
  // Dropdown / textarea handlers stage values into _unsavedEdits; only
  // SEND REPLY actually PATCHes the row.
  _renderAdminControls(row, { isConfirming } = {}) {
    const edits     = this._unsavedEdits.get(row.id) || {}
    const curStatus = edits.status !== undefined ? edits.status : (row.status ?? 'new')
    const curNotes  = edits.notes  !== undefined ? edits.notes  : (row.notes  ?? '')
    return h('div', { className: 'qf-greq-card-admin' }, [
      h('div', { className: 'qf-greq-card-adminrow' }, [
        h('span', { className: 'pix qf-greq-card-adminlabel' }, 'STATUS'),
        h('select', {
          className: 'qf-greq-input qf-greq-select qf-greq-card-statussel',
          disabled: isConfirming || undefined,
          on: { change: (e) => this._stageEdit(row, { status: e.target.value }) },
        }, Object.keys(STATUS_LABELS).map(s => h('option', {
          value: s, selected: s === curStatus ? '' : undefined,
        }, STATUS_LABELS[s]))),
        isConfirming
          ? h('div', { className: 'qf-greq-confirmrow' }, [
              h('span', { className: 'pix qf-greq-confirmtxt' }, 'Delete?'),
              h('button', {
                className: 'qf-greq-card-delconfirm',
                on: { click: () => this._confirmAndDelete(row) },
              }, 'YES, DELETE'),
              h('button', {
                className: 'qf-greq-card-delcancel',
                on: { click: () => { this._confirmDelete = null; this._renderInboxRows() } },
              }, 'CANCEL'),
            ])
          : h('button', {
              className: 'qf-greq-card-del',
              title: 'Delete this request',
              on: { click: () => { this._confirmDelete = row.id; this._renderInboxRows() } },
            }, '🗑 DELETE'),
      ]),
      h('div', { className: 'qf-greq-card-adminrow qf-greq-card-adminnotesrow' }, [
        h('span', { className: 'pix qf-greq-card-adminlabel' }, 'NOTES'),
        h('textarea', {
          className: 'qf-greq-input qf-greq-textarea qf-greq-card-notesedit',
          rows: 2,
          placeholder: 'Reply to the player (visible in their MY MAIL)',
          on: {
            // Stage on every keystroke so the SEND REPLY button can
            // light up the instant there's something to send. No
            // re-render here — the typing element stays focused; only
            // the SEND button's disabled state updates.
            input: (e) => this._stageEdit(row, { notes: e.target.value }, { skipRerender: true }),
          },
        }, curNotes),
      ]),
      // Bottom row — explicit save action. Disabled until there's a
      // diff against the server-side state. Button label flashes to
      // "✓ SENT" briefly after a successful PATCH so mango sees the
      // commit actually landed (the dropdown / notes don't move, so
      // without this the UI is silent on success).
      h('div', { className: 'qf-greq-card-adminrow qf-greq-card-sendrow' }, [
        h('span', {
          className: 'qf-greq-card-dirtyhint pix',
          ref: el => { this._dirtyHintRefs = this._dirtyHintRefs ?? {}; this._dirtyHintRefs[row.id] = el },
        }, this._isRowDirty(row) ? 'UNSAVED CHANGES' : ''),
        h('button', {
          className: 'qf-greq-card-send',
          disabled: !this._isRowDirty(row) || undefined,
          ref: el => { this._sendBtnRefs = this._sendBtnRefs ?? {}; this._sendBtnRefs[row.id] = el },
          on: { click: () => this._sendReply(row) },
        }, '✉ SEND REPLY'),
      ]),
    ])
  }

  // Whether the row has any pending edits relative to the server state.
  // Compares the dirty cache against row.status / row.notes; empty
  // string and null are treated equivalent for notes (Supabase stores
  // empty notes as null after a save).
  _isRowDirty(row) {
    const edits = this._unsavedEdits.get(row.id)
    if (!edits) return false
    if (edits.status !== undefined && edits.status !== (row.status ?? 'new')) return true
    if (edits.notes  !== undefined) {
      const serverNotes = row.notes ?? ''
      const newNotes    = edits.notes ?? ''
      if (newNotes !== serverNotes) return true
    }
    return false
  }

  // Stage an edit in the dirty cache and (by default) re-render the
  // inbox rows so the dropdown selection + send button state update.
  // Pass `{ skipRerender: true }` when the change came from a keystroke
  // inside the notes textarea — we don't want to recreate the textarea
  // every keystroke (that kills the cursor position).
  _stageEdit(row, patch, { skipRerender = false } = {}) {
    const prev = this._unsavedEdits.get(row.id) || {}
    const next = { ...prev, ...patch }
    // Drop keys that match the server state so _isRowDirty stays accurate.
    if (next.status !== undefined && next.status === (row.status ?? 'new'))   delete next.status
    if (next.notes  !== undefined && (next.notes ?? '') === (row.notes ?? '')) delete next.notes
    if (Object.keys(next).length === 0) this._unsavedEdits.delete(row.id)
    else                                this._unsavedEdits.set(row.id, next)
    if (skipRerender) {
      // Just toggle the SEND REPLY button's enabled state + UNSAVED hint.
      const btn  = this._sendBtnRefs?.[row.id]
      const hint = this._dirtyHintRefs?.[row.id]
      const dirty = this._isRowDirty(row)
      if (btn)  btn.disabled = !dirty
      if (hint) hint.textContent = dirty ? 'UNSAVED CHANGES' : ''
    } else {
      this._renderInboxRows()
    }
  }

  async _sendReply(row) {
    const edits = this._unsavedEdits.get(row.id)
    if (!edits || !this._isRowDirty(row)) return
    HudSfx?.playUi?.('click')
    const btn = this._sendBtnRefs?.[row.id]
    if (btn) btn.disabled = true
    const patch = {}
    if (edits.status !== undefined) patch.status = edits.status
    if (edits.notes  !== undefined) {
      const trimmed = (edits.notes ?? '').trim()
      patch.notes = trimmed.length === 0 ? null : trimmed
    }
    const res = await GameRequests.update(row.id, patch)
    if (res.ok) {
      // Commit dirty values to the local row + clear from the cache so
      // the next render shows the saved state.
      if (patch.status !== undefined) row.status = patch.status
      if (patch.notes  !== undefined) row.notes  = patch.notes
      this._unsavedEdits.delete(row.id)
      HudSfx?.playUi?.('unlock_reward')
      // Transient "✓ SENT" feedback — restore label after a moment.
      if (btn) {
        btn.textContent = '✓ SENT'
        btn.classList.add('qf-greq-card-send-sent')
        setTimeout(() => {
          // Could be unmounted by now (mango refreshed or switched
          // tabs); guard before touching.
          if (!btn.isConnected) return
          btn.classList.remove('qf-greq-card-send-sent')
          this._renderInboxRows()
        }, 1400)
      } else {
        this._renderInboxRows()
      }
    } else {
      HudSfx?.playUi?.('denied')
      if (btn) {
        btn.disabled = false
        btn.textContent = '✉ SEND REPLY'
      }
      // Could surface res.error in a status line; leaving the dirty
      // state intact so mango can retry by clicking again.
    }
  }

  async _confirmAndDelete(row) {
    const res = await GameRequests.remove(row.id)
    if (res.ok) {
      HudSfx?.playUi?.('close_panel')
      this._inbox.rows = this._inbox.rows.filter(r => r.id !== row.id)
      // Drop any unsaved-edit state for the now-deleted row.
      this._unsavedEdits.delete(row.id)
      this._confirmDelete = null
      this._renderInboxRows()
    } else {
      HudSfx?.playUi?.('denied')
      this._confirmDelete = null
      this._renderInboxRows()
    }
  }

  async _loadInbox() {
    if (!this._isMango) return
    this._inbox.loading = true
    this._inbox.error = null
    // Refresh = server wins. Any in-flight unsaved edits are dropped —
    // mango would expect the freshly-pulled values to show, not a
    // mash-up of stale dirty fields and fresh server data.
    this._unsavedEdits.clear()
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
    // Mark admin mail as seen — the chip clears next time the main
    // menu refreshes its items. (The cached count is also zeroed
    // immediately so the active tab's chip clears on the spot.)
    GameRequests.markAdminMailSeen?.()
    // Re-render header so the count chip drops.
    this._refreshHeaderOnly()
  }

  // ── MY MAIL (every player — their own submissions + replies) ───────
  _renderMyMail() {
    return h('div', { className: 'qf-greq-inbox' }, [
      h('div', { className: 'qf-greq-inbox-filters' }, [
        h('span', { className: 'pix qf-greq-label' }, 'YOUR SUBMISSIONS'),
        h('button', {
          className: 'qf-greq-toggle-btn',
          on: { click: () => this._loadMyMail() },
        }, '↻ REFRESH'),
      ]),
      h('div', {
        className: 'qf-greq-inbox-list',
        ref: el => { this._mymailListEl = el },
      }, this._renderMyMailContent()),
    ])
  }

  _renderMyMailContent() {
    const mm = this._mymail
    if (mm.loading) return [h('div', { className: 'qf-greq-inbox-empty pix' }, 'Loading…')]
    if (mm.error)   return [h('div', { className: 'qf-greq-inbox-empty pix qf-greq-status-err' }, mm.error)]
    if (mm.rows.length === 0) {
      return [h('div', { className: 'qf-greq-inbox-empty pix' }, 'You haven’t submitted anything yet. Send your first request from the + NEW REQUEST tab.')]
    }
    return mm.rows.map(r => this._renderMyMailCard(r))
  }

  _renderMyMailRows() {
    if (!this._mymailListEl) return
    this._mymailListEl.replaceChildren(...this._renderMyMailContent())
  }

  _renderMyMailCard(row) {
    const cat = CATEGORY_LABELS[row.category] ?? row.category
    const created = this._fmtDate(row.created_at)
    const updated = this._fmtDate(row.updated_at ?? row.created_at)
    const status  = STATUS_LABELS[row.status] ?? (row.status ?? 'NEW').toUpperCase()
    const hasReply = row.status && row.status !== 'new'
    return h('div', { className: 'qf-greq-card' + (hasReply ? ' qf-greq-card-hasreply' : '') }, [
      h('div', { className: 'qf-greq-card-head' }, [
        h('span', { className: 'pix qf-greq-card-cat' }, cat.toUpperCase()),
        h('span', { className: 'pix qf-greq-card-status', dataset: { status: row.status ?? 'new' } }, status),
      ]),
      h('div', { className: 'pix qf-greq-card-title' }, row.title),
      h('div', { className: 'qf-greq-card-body' }, row.body),
      h('div', { className: 'qf-greq-card-foot pix' }, [
        h('span', { className: 'qf-greq-card-time' }, `sent ${created}`),
        hasReply && h('span', { className: 'qf-greq-card-sep' }, '·'),
        hasReply && h('span', { className: 'qf-greq-card-ctx' }, `updated ${updated}`),
      ].filter(Boolean)),
      // Dev reply panel — only shown when status moved past 'new'.
      // Either explicit notes from mango or a fallback "marked as X"
      // line based on status alone (so a quick status flip still
      // gives the player a visible reply).
      hasReply && h('div', { className: 'qf-greq-card-notes pix' }, [
        h('span', { className: 'qf-greq-card-notes-label' }, 'DEV REPLY'),
        ' ',
        row.notes ? row.notes : this._statusFallbackReply(row.status),
      ]),
    ])
  }

  _statusFallbackReply(status) {
    switch (status) {
      case 'triaged': return 'Marked as seen — thanks for sending this in!'
      case 'planned': return 'Planned for a future update.'
      case 'shipped': return 'Shipped in a recent update — thanks for the idea!'
      case 'wontfix': return 'Not planned right now (could change later).'
      default:        return 'Status updated.'
    }
  }

  async _loadMyMail() {
    const playerName = (PlayerProfile.getName?.() ?? '').trim() || 'ANON'
    this._mymail.loading = true
    this._mymail.error = null
    this._renderMyMailRows()
    const res = await GameRequests.list({ limit: 200, playerName })
    this._mymail.loading = false
    if (res.ok) {
      this._mymail.rows = res.rows
      this._mymail.error = null
    } else {
      this._mymail.rows = []
      this._mymail.error = res.error || 'Could not load.'
    }
    this._renderMyMailRows()
    // Player mail badge cleared on view — stamps "now" so future
    // status flips are the only thing that re-fires the chip.
    GameRequests.markPlayerMailSeen?.(playerName)
    this._refreshHeaderOnly()
  }

  // Surgically re-render only the header (tab strip) so count chips
  // update without disrupting the active tab body. Used after mark-
  // seen so the count drops immediately.
  _refreshHeaderOnly() {
    if (!this._rootEl) return
    const firstChild = this._rootEl.firstChild
    if (!firstChild) return
    const newHeader = this._renderHeader()
    this._rootEl.replaceChild(newHeader, firstChild)
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
