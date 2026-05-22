// SettingsOverlay — DOM port of the design's options screen (moments.jsx ~1886).
//
// Four-tab settings panel: AUDIO (master/music/sfx/ambient sliders),
// VIDEO (display toggles + particles + palette radio), CONTROLS (read-only
// keybinding list), GAMEPLAY (3 toggles). Footer with RESET DEFAULTS /
// CANCEL / APPLY.
//
// Behaviour wired in this first cut:
//   * PALETTE radio toggles the existing `.palette-necro` / `.palette-hellfire`
//     classes on #hud-root (already defined in styles.css), live-previewing
//     the theme. APPLY persists; CANCEL reverts.
//   * AUDIO sliders write to localStorage keys `qf.audio.{master,music,sfx,ambient}`
//     on APPLY. The existing Phaser AudioControls / SfxVolume system reads
//     from there. Live preview on slider drag.
//   * Everything else (video toggles, gameplay toggles, controls) is
//     stored in the same localStorage namespace but not yet consumed by
//     the gameplay layer — wiring those is a follow-up once each
//     subsystem is identified.

import { h, mount } from './dom.js'
import { Overlay } from './Overlay.js'
import { SfxVolume } from '../systems/SfxVolume.js'
import { TitleMusic } from '../systems/TitleMusic.js'
import { EventBus } from '../systems/EventBus.js'

const STORE_KEYS = {
  master:    'qf.audio.master',
  music:     'qf.audio.music',
  sfx:       'qf.audio.sfx',
  ambient:   'qf.audio.ambient',
  speechSfx: 'qf.audio.speechSfx',
  scanlines: 'qf.video.scanlines',
  vignette:  'qf.video.vignette',
  shake:     'qf.video.shake',
  particles: 'qf.video.particles',
  palette:   'qf.video.palette',
  fullscreen: 'qf.video.fullscreen',
  dungeonVignette: 'qf.video.dungeonVignette',
  confirmRun: 'qf.gameplay.confirmRun',
  autosave:   'qf.gameplay.autosave',
  hotkeys:    'qf.gameplay.hotkeys',
  tutorials:  'qf.gameplay.tutorials',
  companion:  'qf.gameplay.companion',
}

const DEFAULTS = {
  master: 70, music: 20, sfx: 80, ambient: 45, speechSfx: true,
  scanlines: true, vignette: true, dungeonVignette: true,
  shake: true, particles: 'high',
  palette: 'crypt', fullscreen: false,
  confirmRun: true, autosave: true, hotkeys: true, tutorials: true,
  companion: 'normal',
}

const TABS = [
  { id: 'audio',    label: 'AUDIO',    icon: '♪', color: 'var(--rumor)' },
  { id: 'video',    label: 'VIDEO',    icon: '◈', color: 'var(--gold)' },
  { id: 'controls', label: 'CONTROLS', icon: '◇', color: 'var(--poison)' },
  { id: 'gameplay', label: 'GAMEPLAY', icon: '★', color: 'var(--blood)' },
]

const KEYBINDS = [
  { a: 'PLACE / BUILD',    k: 'B' },
  { a: 'MOVE',             k: 'M' },
  { a: 'SELL',             k: 'X' },
  { a: 'BEGIN DAY',        k: 'SPACE' },
  { a: 'SPEED 1× / 2× / 4× / 8×', k: '1 · 2 · 3 · 4' },
  { a: 'KNOWLEDGE MAP',    k: 'K' },
  { a: 'ADV INTEL',        k: 'I' },
  { a: 'MINION ROSTER',    k: 'R' },
  { a: 'PAUSE',            k: 'ESC' },
]

export class SettingsOverlay {
  constructor(opts = {}) {
    this._onClose = opts.onClose ?? null
    this._tab = 'audio'
    this._savedState = this._readAll()
    this._draft = { ...this._savedState }
    // Apply the saved palette + video flags immediately so the live
    // preview starts at whatever the user last applied — the radio /
    // toggle would mis-report active state otherwise.
    this._applyPalette(this._draft.palette)
    this._applyVideoFlags(this._draft)
    this._overlay = new Overlay({
      title:   'OPTIONS',
      width:   920,
      height:  680,
      accent:  'var(--blood)',
      onClose: () => this._onCancel(),
      body:    this._renderBody(),
    })
  }

  open()  { this._overlay.open() }
  close() { this._overlay.close() }

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
    for (const k of Object.keys(STORE_KEYS)) {
      try { localStorage.setItem(STORE_KEYS[k], String(state[k])) } catch {}
    }
  }

  _applyPalette(name) {
    const root = document.getElementById('hud-root')
    if (!root) return
    root.classList.remove('palette-necro', 'palette-hellfire')
    if (name === 'necro')    root.classList.add('palette-necro')
    if (name === 'hellfire') root.classList.add('palette-hellfire')
  }

  // Apply video-side flags (scanlines / vignette / fullscreen) live so
  // CANCEL can revert them just as easily as palette. Screen-shake and
  // particles read their flags lazily — no DOM mutation needed.
  _applyVideoFlags(s) {
    const root = document.getElementById('hud-root')
    if (root) {
      root.classList.toggle('scanlines',     !!s.scanlines)
      root.classList.toggle('crt-vignette',  !!s.vignette)
      // Dungeon viewport vignette — applied to hud-stage so the
      // darkening only covers the in-game play area (the FX layer
      // sits inside hud-stage), not menus mounted under hud-root.
      root.classList.toggle('dungeon-vignette', !!s.dungeonVignette)
    }
    // Fullscreen — fire-and-forget; the browser may reject if not
    // user-initiated, in which case we revert the flag silently.
    const wantFs = !!s.fullscreen
    const inFs = !!document.fullscreenElement
    if (wantFs && !inFs) {
      document.documentElement.requestFullscreen?.().catch(() => {
        // Browser rejected — most commonly because the slider click
        // wasn't a direct user gesture (we're inside a CANCEL/APPLY
        // button click chain, which IS a gesture — so this usually
        // succeeds — but tabs without focus etc. can block).
        s.fullscreen = false
      })
    } else if (!wantFs && inFs) {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  // Apply audio sliders. Master is a multiplier on both music + SFX —
  // since TitleMusic / SfxVolume only expose a single 0..1 volume, fold
  // the master in client-side.
  _applyAudio(s) {
    const master = (s.master ?? 70) / 100
    const music  = (s.music  ?? 22) / 100
    const sfx    = (s.sfx    ?? 80) / 100
    SfxVolume.setVolume(master * sfx)
    TitleMusic.setVolume(master * music)
    // Ambient — no canonical channel yet; persisted but inert until an
    // ambient mixer ships.
  }

  _set(k, v) {
    this._draft[k] = v
    // Live previews — palette / scanlines / vignette / fullscreen swap
    // immediately so the player sees the effect before committing.
    if (k === 'palette') this._applyPalette(v)
    if (k === 'scanlines' || k === 'vignette' || k === 'fullscreen' || k === 'dungeonVignette') {
      this._applyVideoFlags(this._draft)
    }
    // Audio live-preview too — drag the slider, hear the change.
    if (k === 'master' || k === 'music' || k === 'sfx' || k === 'ambient') {
      this._applyAudio(this._draft)
    }
    this._rerender()
  }

  _rerender() {
    this._overlay.setBody(this._renderBody())
  }

  _selectTab(id) {
    this._tab = id
    this._rerender()
  }

  _onApply() {
    this._persistAll(this._draft)
    this._savedState = { ...this._draft }
    // Apply effects (live previews already match; this is the "make it
    // stick" step + the audio bridge that hasn't fired during slider
    // drag).
    this._applyAudio(this._draft)
    this._applyVideoFlags(this._draft)
    this._applyPalette(this._draft.palette)
    // Let live HUD listeners (e.g. the companion NPC) react to changed
    // settings without polling localStorage.
    EventBus.emit('SETTINGS_CHANGED')
    this._overlay.close()
  }

  _onCancel() {
    // Revert all live previews (palette / video flags / audio) to the
    // saved state, then close.
    this._applyPalette(this._savedState.palette)
    this._applyVideoFlags(this._savedState)
    this._applyAudio(this._savedState)
    this._draft = { ...this._savedState }
    this._onClose?.()
  }

  _onReset() {
    this._draft = { ...DEFAULTS }
    this._applyPalette(this._draft.palette)
    this._rerender()
  }

  _renderBody() {
    return h('div', { className: 'qf-settings-body' }, [
      h('div', { className: 'qf-settings-main' }, [
        // Tab rail
        h('div', { className: 'qf-settings-tabs' },
          TABS.map(t => {
            const active = this._tab === t.id
            return h('button', {
              className: 'btn qf-settings-tab',
              dataset: { active: active ? 'true' : 'false' },
              style: { '--tab-color': t.color },
              on: { click: () => this._selectTab(t.id) },
            }, [
              h('span', { className: 'pix qf-settings-tab-icon' }, t.icon),
              h('span', { className: 'qf-settings-tab-label' }, t.label),
            ])
          })
        ),
        // Content panel
        h('div', { className: 'qf-settings-content' }, this._renderTabContent()),
      ]),
      // Footer
      h('div', { className: 'qf-settings-footer' }, [
        h('button', {
          className: 'btn qf-settings-reset',
          on: { click: () => this._onReset() },
        }, 'RESET DEFAULTS'),
        h('div', { className: 'qf-settings-footer-r' }, [
          h('button', {
            className: 'btn',
            on: { click: () => this._onCancel() || this.close() },
          }, 'CANCEL'),
          h('button', {
            className: 'btn primary lg qf-settings-apply',
            on: { click: () => this._onApply() },
          }, 'APPLY'),
        ]),
      ]),
    ])
  }

  _renderTabContent() {
    if (this._tab === 'audio') return this._renderAudio()
    if (this._tab === 'video') return this._renderVideo()
    if (this._tab === 'controls') return this._renderControls()
    if (this._tab === 'gameplay') return this._renderGameplay()
    return null
  }

  _renderAudio() {
    return h('div', null, [
      this._section('AUDIO LEVELS', 'var(--rumor)', [
        this._slider('MASTER',  'master'),
        this._slider('MUSIC',   'music'),
        this._slider('SFX',     'sfx'),
        this._slider('AMBIENT', 'ambient'),
      ]),
      this._section('VOICE', 'var(--rumor)', [
        this._toggle('COMPANION SPEECH', 'speechSfx'),
      ]),
    ])
  }

  _renderVideo() {
    return h('div', null, [
      this._section('DISPLAY', 'var(--gold)', [
        this._toggle('FULLSCREEN',          'fullscreen'),
        this._toggle('CRT SCANLINES',       'scanlines'),
        this._toggle('EDGE VIGNETTE',       'vignette'),
        this._toggle('DUNGEON VIGNETTE',    'dungeonVignette'),
        this._toggle('SCREEN SHAKE',        'shake'),
        this._radio('PARTICLES', 'particles', [
          { v: 'off', l: 'OFF' }, { v: 'low', l: 'LOW' },
          { v: 'med', l: 'MED' }, { v: 'high', l: 'HIGH' },
        ]),
      ]),
      this._section('PALETTE', 'var(--gold)', [
        this._radio('THEME', 'palette', [
          { v: 'crypt',    l: 'CRYPT',    c: '#c8334a' },
          { v: 'necro',    l: 'NECROTIC', c: '#5cd862' },
          { v: 'hellfire', l: 'HELLFIRE', c: '#e85820' },
        ]),
      ]),
    ])
  }

  _renderControls() {
    return this._section('KEYBINDINGS', 'var(--poison)',
      KEYBINDS.map(b => h('div', { className: 'qf-keybind' }, [
        h('span', { className: 'qf-keybind-action' }, b.a),
        h('span', { className: 'pix qf-keybind-key' }, b.k),
      ]))
    )
  }

  _renderGameplay() {
    // HOTKEY HINTS toggle removed at user request — the strip itself
    // is no longer mounted in HudRoot, so this control has nothing
    // to toggle. The `hotkeys` key + isHotkeysEnabled() helper remain
    // in userSettings.js so legacy reads stay safe.
    return this._section('GAMEPLAY', 'var(--blood)', [
      this._toggle('CONFIRM ABANDON RUN', 'confirmRun'),
      this._toggle('AUTOSAVE',            'autosave'),
      this._toggle('GAMEPLAY HINTS',      'tutorials'),
      this._radio('COMPANION', 'companion', [
        { v: 'off',    l: 'OFF' },
        { v: 'quiet',  l: 'QUIET' },
        { v: 'normal', l: 'NORMAL' },
      ]),
    ])
  }

  _section(title, color, children) {
    return h('div', { className: 'qf-settings-section' }, [
      h('div', {
        className: 'pix qf-settings-section-title',
        style: { color, borderBottom: `1px dashed ${color}55` },
      }, title),
      h('div', { className: 'qf-settings-section-body' }, children),
    ])
  }

  _slider(label, key) {
    const value = this._draft[key]
    return h('div', { className: 'qf-settings-row qf-settings-slider' }, [
      h('span', { className: 'pix qf-settings-label' }, label),
      h('div', {
        className: 'qf-slider-track',
        on: { click: (e) => {
          const r = e.currentTarget.getBoundingClientRect()
          // Account for stage scaling: clientX is in viewport pixels, but
          // the track's bounding rect is also in viewport pixels (post-
          // CSS-transform), so the ratio works correctly without manual
          // scale correction.
          const pct = Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)))
          this._set(key, pct)
        } },
      }, [
        h('div', { className: 'qf-slider-fill', style: { width: `${value}%` } }),
      ]),
      h('span', { className: 'pix qf-slider-value' }, String(value)),
    ])
  }

  _toggle(label, key) {
    const value = this._draft[key]
    return h('div', { className: 'qf-settings-row' }, [
      h('span', { className: 'pix qf-settings-label' }, label),
      h('button', {
        className: 'qf-toggle',
        dataset: { on: value ? 'true' : 'false' },
        on: { click: () => this._set(key, !value) },
      }, [
        h('div', { className: 'qf-toggle-thumb' }),
      ]),
    ])
  }

  _radio(label, key, options) {
    const value = this._draft[key]
    return h('div', { className: 'qf-settings-row' }, [
      h('span', { className: 'pix qf-settings-label' }, label),
      h('div', { className: 'qf-radio' },
        options.map(o => {
          const active = value === o.v
          const c = o.c || 'var(--gold)'
          return h('button', {
            className: 'qf-radio-opt',
            dataset: { active: active ? 'true' : 'false' },
            style: {
              '--opt-color': c,
              background: active ? c : 'var(--bg-0)',
              borderColor: active ? c : 'var(--line-2)',
              color: active ? '#1a0a04' : 'var(--text-mute)',
              boxShadow: active ? `0 0 8px ${c}55` : 'none',
            },
            on: { click: () => this._set(key, o.v) },
          }, o.l)
        })
      ),
    ])
  }
}
