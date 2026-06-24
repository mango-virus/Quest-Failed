// SoundStudioOverlay — in-game, mango-only SOUND editor (dev tool).
//
// Edits every sound TRIGGER live: swap its sound, set its volume, toggle pitch
// jitter, mute, A/B vs default, and preview. Backed by SoundConfig (overrides
// persist to localStorage; custom uploads land in Phase 3). Built on the shared
// crypt Overlay shell + the OPTIONS visual language so it matches the in-game UI.
// See SOUND_STUDIO.md.

import { h, mount } from './dom.js'
import { Overlay } from './Overlay.js'
import { SoundConfig } from '../systems/SoundConfig.js'
import { SOUND_TRIGGERS, SOUND_CATEGORIES } from '../data/soundTriggers.js'
import { putBlob, removeBlob, loadIntoCache, customKeyFor } from '../systems/SoundCustom.js'

// Every sound key any trigger can use → the swap dropdown options.
const ALL_KEYS = (() => {
  const s = new Set()
  for (const t of SOUND_TRIGGERS) { const ks = t.keys || (t.key ? [t.key] : []); ks.forEach(k => s.add(k)) }
  return [...s].sort()
})()

const VOL_MAX = 300   // slider %, covers UI cues (2.5×) and boosted stings

let _styleInjected = false
function injectStyle() {
  if (_styleInjected || typeof document === 'undefined') return
  _styleInjected = true
  const el = document.createElement('style')
  el.id = 'qf-ss-style'
  el.textContent = CSS
  document.head.appendChild(el)
}

export class SoundStudioOverlay {
  constructor(opts = {}) {
    injectStyle()
    this._onClose = opts.onClose ?? null
    this._cat = SOUND_CATEGORIES[0]
    this._query = ''
    this._previewVol = 0.9
    this._expanded = new Set()   // trigger ids whose pool editor is open
    this._overlay = new Overlay({
      eyebrow: "THE DARK LORD'S EAR",
      title: 'SOUND STUDIO',
      sub: 'tune every cue — changes apply live',
      width: 1180, height: 820,
      accent: 'var(--gold)',
      atmosphere: true,
      onClose: () => this._onClose?.(),
      footer: this._footer(),
      body: this._body(),
    })
  }

  open()  { this._overlay.open() }
  close() { this._overlay.close() }

  // ── audio preview ──────────────────────────────────────────────────────────
  _sound() { return (typeof window !== 'undefined' && window.__game?.sound) || null }
  _scenes() { return (typeof window !== 'undefined' && window.__game?.scene?.scenes) || [] }
  _keyLoaded(key) { return this._scenes().some(s => s.cache?.audio?.exists?.(key)) }

  _playKey(key, vol, detune) {
    const sound = this._sound()
    if (!sound || !key) return
    const cfg = { volume: Math.min(4, Math.max(0, vol)) }
    if (detune) cfg.detune = detune
    if (this._keyLoaded(key)) { try { sound.play(key, cfg) } catch {} ; return }
    // Lazy-load deferred audio, then play (use a RUNNING scene's loader).
    import('../scenes/DeferredAudioLoader.js').then(({ ensureAudioLoaded }) => {
      const s = this._loadScene(); if (!s) return
      ensureAudioLoaded(s, key, () => { try { sound.play(key, cfg) } catch {} })
    }).catch(() => {})
  }

  // Preview a trigger AS CURRENTLY CONFIGURED (override-aware) — including the same
  // pitch jitter it gets in-game, so it sounds representative.
  _previewTrigger(t) {
    const c = SoundConfig.resolve(t.id)
    if (c.mute) return
    const key = c.key || (c.keys && c.keys[0]) || t.key || (t.keys && t.keys[0])
    const base = (c.vol != null) ? c.vol : (t.vol ?? 0.8)
    const pitchOn = (c.pitch != null) ? c.pitch : !!t.pitch
    this._playKey(key, base * (t.boost || 1) * this._previewVol, pitchOn ? (Math.random() * 2 - 1) * 200 : 0)
  }

  // Preview the trigger's DEFAULT (ignore overrides) — the A/B "DEF" button.
  _previewDefault(t) {
    const key = t.key || (t.keys && t.keys[0])
    this._playKey(key, (t.vol ?? 0.8) * (t.boost || 1) * this._previewVol)
  }

  // A RUNNING scene whose loader actually ticks (Boot/Preload are asleep after
  // boot, so their loaders never process a queued file). MainMenu / Game / HudScene.
  _loadScene() {
    const game = (typeof window !== 'undefined') ? window.__game : null
    const active = game?.scene?.getScenes?.(true) || []
    return active.find(s => s.load && !['Boot', 'Preload'].includes(s.scene?.key))
        || active.find(s => s.load)
        || (game?.scene?.scenes || []).find(s => s.load) || null
  }

  // Upload a custom audio file for this trigger → IndexedDB (persists) + the
  // Phaser cache (plays now). The trigger override points at the custom key.
  _uploadFor(t) {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'audio/*,.wav,.mp3,.ogg'
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return
      const scene = this._loadScene(); if (!scene) return
      putBlob(t.id, f).then(() => {
        loadIntoCache(scene, t.id, f, (ok) => {
          if (ok) { SoundConfig.set(t.id, { key: customKeyFor(t.id), fileKey: t.id }); this._refreshList() }
        })
      }).catch(() => {})
    }
    inp.click()
  }

  // ── rendering ────────────────────────────────────────────────────────────
  _rerender() { this._overlay.setBody(this._body()); this._overlay.setFooter(this._footer()) }

  _body() {
    return h('div', { className: 'qf-ss' }, [
      h('div', { className: 'qf-ss-nav' }, SOUND_CATEGORIES.map(cat => {
        const n = SOUND_TRIGGERS.filter(t => t.category === cat).length
        return h('button', {
          className: 'qf-ss-catbtn' + (cat === this._cat ? ' on' : ''),
          on: { click: () => { this._cat = cat; this._rerender() } },
        }, [h('span', { className: 'cl' }, cat), h('span', { className: 'cn' }, String(n))])
      })),
      h('div', { className: 'qf-ss-main' }, [
        h('div', { className: 'qf-ss-search-wrap' }, [
          h('input', {
            className: 'qf-ss-search', type: 'text', placeholder: 'search triggers or sounds…',
            value: this._query,
            on: { input: (e) => { this._query = e.target.value; this._refreshList() } },
          }),
        ]),
        h('div', { className: 'qf-ss-list', ref: el => { this._listEl = el } }, this._rows()),
      ]),
    ])
  }

  _refreshList() { if (this._listEl) mount(this._listEl, this._rows()) }

  _rows() {
    const q = this._query.trim().toLowerCase()
    const list = SOUND_TRIGGERS.filter(t => t.category === this._cat)
      .filter(t => !q || t.id.includes(q) || t.label.toLowerCase().includes(q) ||
                   (t.key || '').includes(q) || (t.keys || []).some(k => k.includes(q)))
    if (!list.length) return [h('div', { className: 'qf-ss-empty' }, 'No triggers match.')]
    return list.map(t => this._row(t))
  }

  // Effective sound list for a trigger (override pool/key, else registry default).
  _poolKeys(t, c) {
    if (c.keys && c.keys.length) return [...c.keys]
    if (c.key) return [c.key]
    if (t.keys && t.keys.length) return [...t.keys]
    if (t.key) return [t.key]
    return []
  }

  _row(t) {
    const c = SoundConfig.resolve(t.id)
    const overridden = SoundConfig.isOverridden(t.id)
    const keys = this._poolKeys(t, c)
    const isPool = keys.length > 1
    const curKey = keys[0]
    const missing = !isPool && curKey && !this._keyLoaded(curKey)
    const baseVol = (c.vol != null) ? c.vol : (t.vol ?? 0.8)
    const pitchOn = (c.pitch != null) ? c.pitch : !!t.pitch
    const expanded = this._expanded.has(t.id)

    let valEl
    const line = h('div', { className: 'qf-ss-row' + (overridden ? ' mod' : '') }, [
      h('button', { className: 'qf-ss-ic play', title: 'Preview', on: { click: () => this._previewTrigger(t) } }, '▶'),
      h('div', { className: 'qf-ss-name' }, [
        h('div', { className: 'nm' }, [overridden ? h('span', { className: 'dot', title: 'edited' }) : null, t.label].filter(Boolean)),
        h('div', { className: 'sub' }, isPool ? `${keys.length} variants` : (curKey || '—')),
      ]),
      // sound summary — click to open the pool editor (add/remove/swap sounds)
      h('button', {
        className: 'qf-ss-sound' + (missing ? ' missing' : '') + (expanded ? ' open' : ''),
        title: 'Edit sound(s)', on: { click: () => this._toggleExpand(t.id) },
      }, [
        h('span', { className: 'sct' }, isPool ? `POOL · ${keys.length}` : (curKey ? curKey.replace(/^sfx-/, '') : '—')),
        h('span', { className: 'cv' }, expanded ? '▾' : '▸'),
      ]),
      // volume
      h('input', {
        className: 'qf-ss-vol', type: 'range', min: '0', max: String(VOL_MAX), step: '5',
        value: String(Math.round(baseVol * 100)),
        on: { input: (e) => { const pct = Number(e.target.value); if (valEl) valEl.textContent = pct + '%'; this._patch(t, { vol: pct / 100 }, true) } },
      }),
      h('div', { className: 'qf-ss-val', ref: el => { valEl = el } }, Math.round(baseVol * 100) + '%'),
      h('button', { className: 'qf-ss-ic tog' + (pitchOn ? ' on' : ''), title: 'Pitch variation', on: { click: () => this._patch(t, { pitch: !pitchOn }) } }, '♪'),
      h('button', { className: 'qf-ss-ic tog' + (c.mute ? ' on danger' : ''), title: 'Mute', on: { click: () => this._patch(t, { mute: !c.mute }) } }, c.mute ? '🔇' : '🔊'),
      h('button', { className: 'qf-ss-ic ab', title: 'Play default (A/B)', on: { click: () => this._previewDefault(t) } }, 'DEF'),
      h('button', { className: 'qf-ss-ic up', title: 'Upload a custom sound file', on: { click: () => this._uploadFor(t) } }, '⤒'),
      h('button', {
        className: 'qf-ss-ic reset', title: 'Reset to default', disabled: !overridden,
        on: { click: () => { const hadFile = SoundConfig.resolve(t.id).fileKey; SoundConfig.reset(t.id); if (hadFile) removeBlob(t.id); this._refreshList() } },
      }, '↺'),
      c.fileKey ? h('span', { className: 'qf-ss-tag custom', title: 'Custom uploaded sound' }, 'CUSTOM') : null,
      missing ? h('span', { className: 'qf-ss-tag miss', title: 'Sound not loaded' }, 'MISSING') : null,
    ].filter(Boolean))

    if (!expanded) return line
    return h('div', { className: 'qf-ss-rowwrap' }, [line, this._poolEditor(t, keys, baseVol)])
  }

  // The expandable sound/pool editor: one row per sound (preview · pick · remove)
  // + "add sound". 2+ sounds = a pool (a random one plays each time).
  _poolEditor(t, keys, baseVol) {
    return h('div', { className: 'qf-ss-pooledit' }, [
      h('div', { className: 'qf-ss-pe-lbl' },
        keys.length > 1 ? 'POOL — a random variant plays each time:' : 'SOUND — add a 2nd to make a random pool:'),
      ...keys.map((k, i) => h('div', { className: 'qf-ss-pe-slot' }, [
        h('button', { className: 'qf-ss-ic play sm', title: 'Preview this sound', on: { click: () => this._playKey(k, baseVol * this._previewVol) } }, '▶'),
        h('select', {
          className: 'qf-ss-select grow' + (this._keyLoaded(k) ? '' : ' missing'),
          on: { change: (e) => this._setSlot(t, keys, i, e.target.value) },
        }, ALL_KEYS.map(o => h('option', { value: o, selected: o === k }, o.replace(/^sfx-/, '')))),
        keys.length > 1
          ? h('button', { className: 'qf-ss-ic rm sm', title: 'Remove from pool', on: { click: () => this._setSlot(t, keys, i, null) } }, '✕')
          : null,
      ].filter(Boolean))),
      h('button', { className: 'qf-ss-pe-add', on: { click: () => this._addSlot(t, keys) } }, '＋ add sound'),
    ])
  }

  _toggleExpand(id) {
    this._expanded.has(id) ? this._expanded.delete(id) : this._expanded.add(id)
    this._refreshList()
  }

  // Set slot i to `val` (null = remove). Rebuilds the pool/key override.
  _setSlot(t, keys, i, val) {
    const next = keys.slice()
    if (val == null) next.splice(i, 1)
    else next[i] = val
    this._setPool(t, next)
  }

  _addSlot(t, keys) {
    const add = ALL_KEYS.find(k => !keys.includes(k)) || ALL_KEYS[0]
    this._setPool(t, [...keys, add])
  }

  // Persist a sound list as the trigger override: 1 sound → {key}, 2+ → {keys}.
  _setPool(t, keys) {
    const uniq = [...new Set(keys.filter(Boolean))]
    if (uniq.length <= 1) SoundConfig.set(t.id, { key: uniq[0], keys: undefined })
    else SoundConfig.set(t.id, { keys: uniq, key: undefined })
    this._refreshList()
  }

  // Apply an override patch. `light` (slider drag) skips the full list rebuild so
  // dragging stays smooth — the value readout updates inline.
  _patch(t, patch, light) {
    // Normalize: a patch back to the default value clears that field.
    const norm = { ...patch }
    if ('vol' in norm && Math.abs(norm.vol - (t.vol ?? 0.8)) < 0.001) norm.vol = undefined
    if ('pitch' in norm && norm.pitch === !!t.pitch) norm.pitch = undefined
    if ('mute' in norm && norm.mute === false) norm.mute = undefined
    const cur = { ...(SoundConfig.resolve(t.id)) }
    // Build the new override object from current + patch, dropping empties.
    const over = {}
    const merged = {
      key: 'key' in norm ? norm.key : (cur.key || undefined),
      vol: 'vol' in norm ? norm.vol : (cur.vol != null ? cur.vol : undefined),
      pitch: 'pitch' in norm ? norm.pitch : (cur.pitch != null ? cur.pitch : undefined),
      mute: 'mute' in norm ? norm.mute : (cur.mute || undefined),
    }
    for (const k of ['key', 'vol', 'pitch', 'mute']) if (merged[k] !== undefined) over[k] = merged[k]
    if (Object.keys(over).length) SoundConfig.set(t.id, over)
    else SoundConfig.reset(t.id)
    if (!light) this._refreshList()
  }

  // ── footer (master controls) ───────────────────────────────────────────────
  _footer() {
    const total = SOUND_TRIGGERS.length
    const edited = SOUND_TRIGGERS.filter(t => SoundConfig.isOverridden(t.id)).length
    const missing = SOUND_TRIGGERS.filter(t => {
      const c = SoundConfig.resolve(t.id)
      const k = c.key || (c.keys && c.keys[0]) || t.key || (t.keys && t.keys[0])
      return k && !this._keyLoaded(k)
    }).length
    let pvEl
    return [
      h('div', { className: 'qf-ss-foot' }, [
        h('div', { className: 'qf-ss-foot-l' }, [
          h('span', { className: 'qf-ss-pvlbl' }, 'PREVIEW VOL'),
          h('input', {
            className: 'qf-ss-vol wide', type: 'range', min: '10', max: '150', step: '5',
            value: String(Math.round(this._previewVol * 100)),
            on: { input: (e) => { this._previewVol = Number(e.target.value) / 100; if (pvEl) pvEl.textContent = e.target.value + '%' } },
          }),
          h('span', { className: 'qf-ss-val', ref: el => { pvEl = el } }, Math.round(this._previewVol * 100) + '%'),
          h('span', { className: 'qf-ss-count' }, `${edited} edited / ${total}`),
          missing ? h('span', { className: 'qf-ss-tag miss', title: 'Triggers whose sound is not loaded' }, `⚠ ${missing} MISSING`) : null,
        ]),
        h('div', { className: 'qf-ss-foot-r' }, [
          h('button', { className: 'qf-pbtn ghost', on: { click: () => this._exportConfig() } }, 'EXPORT'),
          h('button', { className: 'qf-pbtn ghost', on: { click: () => this._importConfig() } }, 'IMPORT'),
          h('button', { className: 'qf-pbtn ghost', disabled: !edited, on: { click: () => this._resetAll() } }, 'RESET ALL'),
          h('button', { className: 'qf-pbtn primary', on: { click: () => this.close() } }, 'DONE'),
        ]),
      ]),
    ]
  }

  _resetAll() {
    if (typeof window !== 'undefined' && !window.confirm('Reset ALL sound overrides to defaults?')) return
    SoundConfig.resetAll()
    this._rerender()
  }

  _exportConfig() {
    try {
      const blob = new Blob([SoundConfig.exportJson()], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'sound-config.json'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {}
  }

  _importConfig() {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'application/json,.json'
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return
      const r = new FileReader()
      r.onload = () => { if (SoundConfig.importJson(String(r.result))) this._rerender() }
      r.readAsText(f)
    }
    inp.click()
  }
}

const CSS = `
.qf-ss { display:flex; gap:14px; height:100%; min-height:0; }
.qf-ss-nav { flex:0 0 156px; display:flex; flex-direction:column; gap:5px; overflow-y:auto; padding-right:4px; }
.qf-ss-catbtn { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 11px;
  background:rgba(0,0,0,.28); border:1px solid var(--line-2); border-radius:7px; color:var(--text);
  font:inherit; cursor:pointer; text-align:left; }
.qf-ss-catbtn:hover { border-color:var(--gold); }
.qf-ss-catbtn.on { background:rgba(232,195,116,.14); border-color:var(--gold); }
.qf-ss-catbtn .cl { font-size:12px; letter-spacing:.5px; text-transform:uppercase; }
.qf-ss-catbtn .cn { font-size:11px; color:var(--dim); }
.qf-ss-main { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:8px; }
.qf-ss-search { width:100%; box-sizing:border-box; background:var(--bg-0); border:1px solid var(--line-2);
  color:var(--text); padding:8px 11px; border-radius:7px; font:inherit; }
.qf-ss-search:focus { outline:none; border-color:var(--gold); }
.qf-ss-list { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:4px; padding-right:4px; }
.qf-ss-empty { color:var(--dim); padding:18px; text-align:center; }
.qf-ss-row { display:flex; align-items:center; gap:8px; padding:5px 8px; border:1px solid transparent; border-radius:7px;
  background:rgba(0,0,0,.2); }
.qf-ss-row:hover { background:rgba(0,0,0,.34); border-color:var(--line-2); }
.qf-ss-row.mod { border-color:var(--gold-bright); background:rgba(232,195,116,.07); }
.qf-ss-name { flex:1 1 auto; min-width:120px; overflow:hidden; }
.qf-ss-name .nm { font-size:13px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:6px; }
.qf-ss-name .sub { font-size:10px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.qf-ss-name .dot { flex:0 0 auto; width:7px; height:7px; border-radius:50%; background:var(--gold); }
.qf-ss-select { flex:0 0 150px; max-width:150px; background:var(--bg-0); border:1px solid var(--line-2);
  color:var(--text); padding:5px 6px; border-radius:6px; font:inherit; font-size:11px; }
.qf-ss-select.missing { border-color:var(--warn); color:var(--warn); }
.qf-ss-sound { flex:0 0 150px; max-width:150px; display:flex; align-items:center; justify-content:space-between; gap:6px;
  background:var(--bg-0); border:1px solid var(--line-2); color:var(--text); padding:5px 8px; border-radius:6px;
  font:inherit; font-size:11px; cursor:pointer; }
.qf-ss-sound:hover, .qf-ss-sound.open { border-color:var(--gold); }
.qf-ss-sound.missing { border-color:var(--warn); color:var(--warn); }
.qf-ss-sound .sct { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.qf-ss-sound .cv { flex:0 0 auto; color:var(--dim); }
.qf-ss-rowwrap { display:flex; flex-direction:column; }
.qf-ss-pooledit { margin:3px 0 5px 30px; padding:9px 11px; background:rgba(0,0,0,.3); border:1px solid var(--line-2);
  border-radius:7px; display:flex; flex-direction:column; gap:6px; }
.qf-ss-pe-lbl { font-size:10px; letter-spacing:.5px; text-transform:uppercase; color:var(--dim); }
.qf-ss-pe-slot { display:flex; align-items:center; gap:8px; }
.qf-ss-select.grow { flex:1 1 auto; max-width:none; }
.qf-ss-ic.sm { width:26px; height:26px; font-size:11px; }
.qf-ss-ic.rm { color:var(--warn); }
.qf-ss-pe-add { align-self:flex-start; background:transparent; border:1px dashed var(--line-2); color:var(--gold-bright);
  padding:5px 12px; border-radius:6px; font:inherit; font-size:11px; letter-spacing:.5px; cursor:pointer; }
.qf-ss-pe-add:hover { border-style:solid; border-color:var(--gold); }
.qf-ss-vol { flex:0 0 120px; accent-color:var(--gold-bright); }
.qf-ss-vol.wide { flex:0 0 160px; }
.qf-ss-val { flex:0 0 42px; text-align:right; font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; }
.qf-ss-ic { flex:0 0 auto; width:30px; height:30px; border-radius:6px; border:1px solid var(--line-2);
  background:var(--bg-0); color:var(--text); cursor:pointer; font-size:12px; display:grid; place-items:center; padding:0; }
.qf-ss-ic:hover { border-color:var(--gold); }
.qf-ss-ic.play { color:var(--poison); }
.qf-ss-ic.tog.on { background:rgba(232,195,116,.16); border-color:var(--gold); color:var(--gold); }
.qf-ss-ic.tog.on.danger { background:rgba(200,51,74,.18); border-color:var(--blood); color:var(--blood-glow); }
.qf-ss-ic.ab { width:auto; padding:0 8px; font-size:10px; letter-spacing:.5px; color:var(--dim); }
.qf-ss-ic.reset:disabled { opacity:.3; cursor:default; }
.qf-ss-ic.reset:not(:disabled) { color:var(--gold-bright); }
.qf-ss-ic.up { color:var(--rumor); }
.qf-ss-tag.miss { flex:0 0 auto; font-size:9px; letter-spacing:.5px; color:var(--warn); border:1px solid var(--warn); border-radius:4px; padding:2px 5px; }
.qf-ss-tag.custom { flex:0 0 auto; font-size:9px; letter-spacing:.5px; color:var(--poison); border:1px solid var(--poison); border-radius:4px; padding:2px 5px; }
.qf-ss-foot { display:flex; align-items:center; justify-content:space-between; gap:16px; width:100%; flex-wrap:wrap; }
.qf-ss-foot-l { display:flex; align-items:center; gap:10px; }
.qf-ss-foot-r { display:flex; align-items:center; gap:10px; }
.qf-ss-pvlbl, .qf-ss-count { font-size:11px; letter-spacing:.5px; color:var(--dim); }
`
