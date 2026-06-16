// SettingsOverlay — OPTIONS, redesigned to the "Crypt" front-end (2026-06-15).
//
// Layout (options-overlay.jsx): an IDENTITY bar at top (rename the dark lord +
// swap equipped title), a left rail of CATEGORY buttons (AUDIO / VIDEO /
// GAMEPLAY / THEME / CONTROLS) revealing one panel at a time, and a GAME
// REQUESTS button in the rail (moved off the main menu). Footer = RESET /
// CANCEL / APPLY. Hosted in the shared crypt Overlay shell.
//
// Plumbing preserved from the prior version:
//   * PALETTE toggles `.palette-necro` / `.palette-hellfire` on #hud-root (live
//     preview; APPLY persists, CANCEL reverts).
//   * AUDIO faders write `qf.audio.{master,music,sfx,voice}`; master is a
//     multiplier folded into music + SFX (SfxVolume / TitleMusic) and read by
//     VOICE directly (userSettings.masterVolume). (No AMBIENT fader — the game
//     has no ambient audio to control; removed 2026-06-15.)
//   * VIDEO flags (scanlines / vignette / dungeon-vignette / fullscreen) apply
//     live; shake / particles read lazily.
// New this redesign (wired): VOICE fader → companion speech-blip volume
//   (userSettings.voiceVolume), MUTE WHEN UNFOCUSED → focusMute installer.
//   COMBAT SUBTITLES / DYNAMIC RANGE were intentionally NOT added (no backing
//   system yet — would be dead controls).

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { SfxVolume } from '../systems/SfxVolume.js'
import { TitleMusic } from '../systems/TitleMusic.js'
import { EventBus } from '../systems/EventBus.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { GameRequests } from '../systems/GameRequests.js'

const STORE_KEYS = {
  master:    'qf.audio.master',
  music:     'qf.audio.music',
  sfx:       'qf.audio.sfx',
  voice:     'qf.audio.voice',
  speechSfx: 'qf.audio.speechSfx',          // derived (voice > 0) — kept for back-compat reads
  muteUnfocused: 'qf.audio.muteUnfocused',
  scanlines: 'qf.video.scanlines',
  vignette:  'qf.video.vignette',
  shake:     'qf.video.shake',
  particles: 'qf.video.particles',
  palette:   'qf.video.palette',
  fullscreen: 'qf.video.fullscreen',
  dungeonVignette: 'qf.video.dungeonVignette',
  confirmRun: 'qf.gameplay.confirmRun',
  autosave:   'qf.gameplay.autosave',
  tutorials:  'qf.gameplay.tutorials',
  companion:  'qf.gameplay.companion',
}

const DEFAULTS = {
  master: 70, music: 20, sfx: 80, voice: 65,
  speechSfx: true, muteUnfocused: true,
  scanlines: true, vignette: true, dungeonVignette: true,
  shake: true, particles: 'high',
  palette: 'crypt', fullscreen: false,
  confirmRun: true, autosave: true, tutorials: true,
  companion: 'normal',
}

const CATS = [
  { id: 'audio',    label: 'AUDIO',    glyph: '♪', color: 'var(--rumor)', sub: 'Volume & mix' },
  { id: 'video',    label: 'VIDEO',    glyph: '◈', color: 'var(--gold)',  sub: 'Display & FX' },
  { id: 'gameplay', label: 'GAMEPLAY', glyph: '★', color: 'var(--blood)', sub: 'Rules & helpers' },
  { id: 'theme',    label: 'THEME',    glyph: '◐', color: '#ff5fb0',      sub: 'Dungeon palette' },
  { id: 'controls', label: 'CONTROLS', glyph: '◇', color: 'var(--poison)', sub: 'Keybindings' },
]

const THEMES = [
  { v: 'crypt',    l: 'CRYPT',    sw: ['#c8334a', '#d4a648', '#e8dcc8', '#14101a'] },
  { v: 'necro',    l: 'NECROTIC', sw: ['#5cd862', '#c8e848', '#d8e8c8', '#0e1812'] },
  { v: 'hellfire', l: 'HELLFIRE', sw: ['#e85820', '#ffcc40', '#f0e0c0', '#160e08'] },
]

const KEYBINDS = [
  { a: 'PLACE / BUILD', keys: ['B'] }, { a: 'MOVE', keys: ['M'] }, { a: 'SELL', keys: ['X'] },
  { a: 'BEGIN DAY', keys: ['SPACE'] }, { a: 'GAME SPEED', keys: ['1', '2', '3', '4'] },
  { a: 'KNOWLEDGE MAP', keys: ['K'] }, { a: 'ADVENTURER INTEL', keys: ['I'] },
  { a: 'MINION ROSTER', keys: ['R'] }, { a: 'PAUSE', keys: ['ESC'] },
]

export class SettingsOverlay {
  constructor(opts = {}) {
    this._onClose = opts.onClose ?? null
    this._tab = 'audio'
    this._titleOpen = false
    this._requests = null
    this._savedState = this._readAll()
    this._draft = { ...this._savedState }
    // Start live previews at the saved state so toggles report correctly.
    this._applyPalette(this._draft.palette)
    this._applyVideoFlags(this._draft)
    this._overlay = new Overlay({
      eyebrow:    "THE DARK LORD'S WILL",
      title:      'OPTIONS',
      width:      1104,
      height:     812,
      accent:     'var(--blood)',
      atmosphere: true,
      onClose:    () => this._onCancel(),
      footer:     this._renderFooter(),
      body:       this._renderBody(),
    })
  }

  open()  { this._overlay.open() }
  close() { this._overlay.close() }

  // ─── persistence ───────────────────────────────────────────────────────
  _readAll() {
    const out = { ...DEFAULTS }
    for (const k of Object.keys(STORE_KEYS)) {
      try {
        const raw = localStorage.getItem(STORE_KEYS[k])
        if (raw == null) continue
        if (typeof DEFAULTS[k] === 'number')  out[k] = Number(raw)
        else if (typeof DEFAULTS[k] === 'boolean') out[k] = raw === 'true'
        else out[k] = raw
      } catch {}
    }
    return out
  }

  _persistAll(state) {
    // speechSfx is derived from the VOICE fader (0 → speech off).
    const derived = { ...state, speechSfx: (state.voice ?? 0) > 0 }
    for (const k of Object.keys(STORE_KEYS)) {
      try { localStorage.setItem(STORE_KEYS[k], String(derived[k])) } catch {}
    }
  }

  // ─── live-apply helpers (unchanged behaviour) ──────────────────────────
  _applyPalette(name) {
    const root = document.getElementById('hud-root')
    if (!root) return
    root.classList.remove('palette-necro', 'palette-hellfire')
    if (name === 'necro')    root.classList.add('palette-necro')
    if (name === 'hellfire') root.classList.add('palette-hellfire')
  }

  _applyVideoFlags(s) {
    const root = document.getElementById('hud-root')
    if (root) {
      root.classList.toggle('scanlines',     !!s.scanlines)
      root.classList.toggle('crt-vignette',  !!s.vignette)
      root.classList.toggle('dungeon-vignette', !!s.dungeonVignette)
    }
    const wantFs = !!s.fullscreen
    const inFs = !!document.fullscreenElement
    if (wantFs && !inFs) {
      document.documentElement.requestFullscreen?.().catch(() => { s.fullscreen = false })
    } else if (!wantFs && inFs) {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  _applyAudio(s) {
    const master = (s.master ?? 70) / 100
    const music  = (s.music  ?? 20) / 100
    const sfx    = (s.sfx    ?? 80) / 100
    SfxVolume.setVolume(master * sfx)
    TitleMusic.setVolume(master * music)
    // VOICE (companion speech-blip volume) reads master + voice live from
    // localStorage at play time (userSettings.masterVolume × voiceVolume), so it
    // takes effect on APPLY (persist) — independent of the SFX fader.
  }

  // ─── state mutation ────────────────────────────────────────────────────
  _set(k, v) {
    this._draft[k] = v
    if (k === 'companion' && v === 'off')         this._draft.tutorials = false
    if (k === 'tutorials' && v === true && this._draft.companion === 'off') {
      this._draft.companion = 'normal'
    }
    if (k === 'palette') this._applyPalette(v)
    if (k === 'scanlines' || k === 'vignette' || k === 'fullscreen' || k === 'dungeonVignette') {
      this._applyVideoFlags(this._draft)
    }
    if (k === 'master' || k === 'music' || k === 'sfx') {
      this._applyAudio(this._draft)
    }
    this._rerender()
  }

  _rerender() { this._overlay.setBody(this._renderBody()) }

  _selectTab(id) { this._tab = id; this._titleOpen = false; this._rerender() }

  _consumeTabSwap() {
    const changed = this._tab !== this._lastRenderedTab
    this._lastRenderedTab = this._tab
    return changed
  }

  // ─── footer actions ────────────────────────────────────────────────────
  _onApply() {
    this._persistAll(this._draft)
    this._savedState = { ...this._draft }
    this._applyAudio(this._draft)
    this._applyVideoFlags(this._draft)
    this._applyPalette(this._draft.palette)
    EventBus.emit('SETTINGS_CHANGED')
    this._overlay.close()
  }

  _onCancel() {
    this._applyPalette(this._savedState.palette)
    this._applyVideoFlags(this._savedState)
    this._applyAudio(this._savedState)
    this._draft = { ...this._savedState }
    this._requests?.close?.(); this._requests = null
    this._onClose?.()
  }

  _onReset() {
    // Keep audio + video keys reset; identity (name/title) is NOT a setting.
    this._draft = { ...DEFAULTS }
    this._applyPalette(this._draft.palette)
    this._applyVideoFlags(this._draft)
    this._applyAudio(this._draft)
    this._rerender()
  }

  // ─── render ────────────────────────────────────────────────────────────
  _renderFooter() {
    return [
      h('button', { className: 'qf-pbtn ghost', on: { click: () => this._onReset() } }, 'RESET DEFAULTS'),
      h('div', { style: { display: 'flex', gap: '12px' } }, [
        h('button', { className: 'qf-pbtn', on: { click: () => this._onCancel() } }, 'CANCEL'),
        h('button', { className: 'qf-pbtn primary', on: { click: () => this._onApply() } }, 'APPLY'),
      ]),
    ]
  }

  _renderBody() {
    return h('div', { className: 'qf-op' }, [
      this._identityBar(),
      h('div', { className: 'qf-op-body2' }, [
        h('div', { className: 'qf-op-nav' }, [
          ...CATS.map(c => this._catBtn(c)),
          this._gameRequestsBtn(),
        ]),
        this._panel(),
      ]),
    ])
  }

  // identity — rename + equipped-title swap
  _identityBar() {
    const name = PlayerProfile.getName()
    const active = PlayerProfile.getActiveTitle()
    const titles = PlayerProfile.getUnlockedTitles()
    return h('div', { className: 'qf-op-id' }, [
      h('div', { className: 'qf-op-idf' }, [
        h('span', { className: 'l' }, '⚔ DARK LORD’S NAME'),
        h('input', {
          className: 'qf-op-name', value: name, maxLength: 18,
          on: {
            change: (e) => this._commitName(e.currentTarget.value),
            blur:   (e) => this._commitName(e.currentTarget.value),
            keydown: (e) => { if (e.key === 'Enter') e.currentTarget.blur() },
          },
        }),
      ]),
      h('div', { className: 'qf-op-idf' }, titles.length
        ? [
            h('span', { className: 'l' }, '✦ EQUIPPED TITLE'),
            h('button', {
              className: 'qf-op-titlesel',
              on: { click: () => { this._titleOpen = !this._titleOpen; this._rerender() } },
            }, [
              h('span', null, active ? active.name : 'Choose a title…'),
              h('span', { className: 'cv' }, `${titles.length} ▾`),
            ]),
            this._titleOpen && h('div', { className: 'qf-op-tdrop' },
              titles.map(t => h('button', {
                className: 'qf-op-trow' + (active && t.id === active.id ? ' on' : ''),
                on: { click: () => this._pickTitle(t.id) },
              }, '✦ ' + t.name))),
          ]
        : [
            h('span', { className: 'l' }, '✦ EQUIPPED TITLE'),
            h('div', { className: 'qf-op-titlesel empty' }, [
              h('span', null, 'No titles unlocked yet'),
              h('span', { className: 'cv' }, '—'),
            ]),
          ]),
    ])
  }

  _commitName(v) {
    const n = (v || '').trim()
    if (!n || n === PlayerProfile.getName().trim()) return
    PlayerProfile.setName(n)
    EventBus.emit('NAME_CHANGED')
    this._rerender()   // titles are per-name → re-resolve the dropdown
  }

  _pickTitle(id) {
    PlayerProfile.setActiveTitleId(id)
    this._titleOpen = false
    EventBus.emit('NAME_CHANGED')   // any live title-pill surfaces re-sync
    this._rerender()
  }

  _catBtn(c) {
    const on = this._tab === c.id
    return h('button', {
      className: 'qf-op-catbtn' + (on ? ' on' : ''),
      style: { '--cc': c.color },
      on: { click: () => this._selectTab(c.id) },
    }, [
      h('span', { className: 'g' }, c.glyph),
      h('span', { className: 'tx' }, [
        h('span', { className: 'cl' }, c.label),
        h('span', { className: 'cs' }, c.sub),
      ]),
    ])
  }

  _gameRequestsBtn() {
    const mail = (GameRequests.getCachedPlayerMail?.() ?? 0) + (GameRequests.getCachedAdminMail?.() ?? 0)
    return h('button', {
      className: 'qf-op-extra',
      on: { click: () => this._openGameRequests() },
    }, [
      h('span', { className: 'g' }, '✉'), 'GAME REQUESTS',
      mail > 0 ? h('span', { className: 'qf-op-mailchip' }, String(mail))
               : h('span', { className: 'ar' }, '→'),
    ])
  }

  _openGameRequests() {
    if (this._requests) return
    PlayerProfile.markGameRequestsSeen?.()
    import('./GameRequestsOverlay.js').then(({ GameRequestsOverlay }) => {
      this._requests = new GameRequestsOverlay({ onClose: () => { this._requests = null; this._rerender() } })
      this._requests.open()
    }).catch(() => {})
  }

  _panel() {
    const cat = CATS.find(c => c.id === this._tab)
    return h('div', { className: 'qf-op-panel', style: { '--cc': cat.color } }, [
      h('div', { className: 'qf-op-phd' }, [
        h('span', { className: 'g' }, cat.glyph),
        h('span', { className: 't' }, cat.label),
        h('span', { className: 's' }, cat.sub),
      ]),
      h('div', { className: 'qf-op-panel-in' + (this._consumeTabSwap() ? ' qf-op-swap' : '') },
        this._panelContent()),
    ])
  }

  _panelContent() {
    if (this._tab === 'audio') return [
      h('div', { className: 'qf-op-mixer' }, [
        this._fader('MASTER', 'master'), this._fader('MUSIC', 'music'), this._fader('SFX', 'sfx'),
        this._fader('VOICE', 'voice'),
      ]),
      h('div', { className: 'qf-op-asub' }, [this._lever('MUTE WHEN UNFOCUSED', 'muteUnfocused')]),
    ]
    if (this._tab === 'video') return [
      this._lever('FULLSCREEN', 'fullscreen'),
      this._lever('CRT SCANLINES', 'scanlines'),
      this._lever('EDGE VIGNETTE', 'vignette'),
      this._lever('DUNGEON VIGNETTE', 'dungeonVignette'),
      this._lever('SCREEN SHAKE', 'shake'),
      this._seg('PARTICLES', 'particles', [
        { v: 'off', l: 'OFF' }, { v: 'low', l: 'LOW' }, { v: 'med', l: 'MED' }, { v: 'high', l: 'HIGH' },
      ]),
    ]
    if (this._tab === 'gameplay') return [
      this._lever('CONFIRM ABANDON RUN', 'confirmRun'),
      this._lever('AUTOSAVE', 'autosave'),
      this._lever('GAMEPLAY HINTS', 'tutorials'),
      this._seg('COMPANION', 'companion', [
        { v: 'normal', l: 'NORMAL' }, { v: 'quiet', l: 'LESS' }, { v: 'mute', l: 'MUTE' }, { v: 'off', l: 'HIDE' },
      ]),
    ]
    if (this._tab === 'theme') return [this._themeTiles()]
    return [this._keys()]
  }

  // ─── control widgets ───────────────────────────────────────────────────
  _fader(label, key) {
    const value = this._draft[key]
    let fillEl, knobEl, valEl
    // Live update WITHOUT rebuilding the whole panel — the old path called
    // _set() (→ full _rerender) on every click, which made dragging stutter and
    // can't track a held pointer at all. Now we mutate just this fader's
    // fill/knob/value + push audio live, and drag via pointer capture. The draft
    // stays the source of truth for APPLY/CANCEL.
    const apply = (pct) => {
      pct = Math.max(0, Math.min(100, Math.round(pct)))
      if (pct === this._draft[key]) return
      this._draft[key] = pct
      if (fillEl) fillEl.style.height = pct + '%'
      if (knobEl) knobEl.style.bottom = `calc(${pct}% - 9px)`
      if (valEl)  valEl.textContent = String(pct)
      if (key === 'master' || key === 'music' || key === 'sfx') this._applyAudio(this._draft)
    }
    const pctAt = (track, clientY) => {
      const r = track.getBoundingClientRect()
      return r.height ? (1 - (clientY - r.top) / r.height) * 100 : 0
    }
    return h('div', { className: 'qf-op-fader' }, [
      h('div', {
        className: 'track',
        on: {
          pointerdown: (e) => {
            e.preventDefault()
            const track = e.currentTarget
            track.setPointerCapture?.(e.pointerId)
            this._dragFader = key
            apply(pctAt(track, e.clientY))
          },
          pointermove: (e) => {
            if (this._dragFader !== key) return
            apply(pctAt(e.currentTarget, e.clientY))
          },
          pointerup: (e) => {
            if (this._dragFader !== key) return
            this._dragFader = null
            e.currentTarget.releasePointerCapture?.(e.pointerId)
          },
          pointercancel: () => { if (this._dragFader === key) this._dragFader = null },
        },
      }, [
        h('div', { className: 'fill', style: { height: value + '%' }, ref: el => { fillEl = el } }),
        h('div', { className: 'knob', style: { bottom: `calc(${value}% - 9px)` }, ref: el => { knobEl = el } }),
      ]),
      h('div', { className: 'val', ref: el => { valEl = el } }, String(value)),
      h('div', { className: 'lbl' }, label),
    ])
  }

  _lever(label, key) {
    const v = this._draft[key]
    return h('div', { className: 'qf-op-row' }, [
      h('span', { className: 'qf-op-lbl' }, label),
      h('button', {
        className: 'qf-op-lever', dataset: { on: v ? 'true' : 'false' },
        on: { click: () => this._set(key, !v) },
      }, [
        h('span', { className: 'slot' }, [h('span', { className: 'handle' })]),
        h('span', { className: 'st' }, v ? 'ON' : 'OFF'),
      ]),
    ])
  }

  _seg(label, key, options) {
    const v = this._draft[key]
    return h('div', { className: 'qf-op-row' }, [
      h('span', { className: 'qf-op-lbl' }, label),
      h('div', { className: 'qf-op-seg' },
        options.map(o => h('button', {
          className: 'opt' + (v === o.v ? ' on' : ''),
          on: { click: () => this._set(key, o.v) },
        }, o.l))),
    ])
  }

  _themeTiles() {
    const v = this._draft.palette
    return h('div', { className: 'qf-op-themes' },
      THEMES.map(t => h('button', {
        className: 'qf-op-theme' + (v === t.v ? ' on' : ''),
        style: { '--tc': t.sw[0] },
        on: { click: () => this._set('palette', t.v) },
      }, [
        h('div', { className: 'sw' }, t.sw.map(c => h('span', { style: { background: c } }))),
        h('div', { className: 'nm' }, t.l),
      ])))
  }

  _keys() {
    return h('div', { className: 'qf-op-keys' },
      KEYBINDS.map(b => h('div', { className: 'qf-op-key' }, [
        h('span', { className: 'a' }, b.a),
        h('span', { className: 'caps' }, b.keys.map(k => h('span', { className: 'qf-op-cap' }, k))),
      ])))
  }
}
