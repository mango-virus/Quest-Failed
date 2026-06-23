// SoundConfig — runtime, dev-editable overrides for every sound TRIGGER.
//
// The Sound Studio (dev tool) edits sounds per-trigger: which sound plays, its
// volume, whether it pitch-varies, mute, and an optional custom uploaded file.
// This singleton is the single source of truth at PLAY TIME: SfxSystem / HudSfx /
// inline playSfx resolve a trigger here before playing. Defaults come from the
// registry (src/data/soundTriggers.js), which is seeded from the original code
// tables — so the game sounds IDENTICAL until something is edited.
//
// Persistence: the small config JSON → localStorage; uploaded audio blobs →
// IndexedDB (added in the upload phase). Changes emit onChange so the live game
// and the Studio update instantly, no reload.
//
// See SOUND_STUDIO.md for the full spec.

import { SOUND_TRIGGERS } from '../data/soundTriggers.js'
import { BAKED_SOUND_CONFIG } from '../data/soundConfigBaked.js'

const LS_KEY = 'qf.soundConfig.v1'

// Registry indexed by id for O(1) resolve.
const REG = Object.create(null)
for (const t of SOUND_TRIGGERS) REG[t.id] = t

// key → PRIMARY trigger id (first registered trigger that uses the key). Lets play
// sites that pass a bare sound key auto-route to the right trigger WITHOUT a code
// change; shared-sample sites pass an explicit trigger id to override this.
const KEY_PRIMARY = Object.create(null)
for (const t of SOUND_TRIGGERS) {
  const ks = t.keys || (t.key ? [t.key] : [])
  for (const k of ks) if (!(k in KEY_PRIMARY)) KEY_PRIMARY[k] = t.id
}

let _over = _load()                 // { [id]: { key?, keys?, vol?, pitch?, mute?, fileKey? } }
const _listeners = new Set()
const _customUrls = Object.create(null)   // fileKey -> objectURL (populated by the upload layer)

function _load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
}
function _save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_over)) } catch {}
  _emit()
}
function _emit() { for (const fn of _listeners) { try { fn() } catch {} } }

export const SoundConfig = {
  // ── Registry access (for the Studio) ──────────────────────────────────────
  triggers() { return SOUND_TRIGGERS },
  get(id)    { return REG[id] || null },
  triggerForKey(key) { return KEY_PRIMARY[key] || null },   // bare-key → primary trigger id
  isOverridden(id) { return !!_over[id] && Object.keys(_over[id]).length > 0 },

  // Resolve a trigger's OVERRIDES only. Fields are null when not overridden, so the
  // play site falls back to its existing code default → ZERO behavior change until
  // the dev edits something in the Studio. Play sites use it like:
  //   const c = SoundConfig.resolve(id); if (c.mute) return
  //   const key = c.key ?? <code default>; const vol = c.vol ?? <code default> ...
  resolve(id) {
    const o = _over[id] || {}
    const b = (BAKED_SOUND_CONFIG && BAKED_SOUND_CONFIG[id]) || {}
    // user localStorage override  >  baked (shipped) default  >  null (→ code default)
    const pick = (f) => (f in o) ? o[f] : ((f in b) ? b[f] : undefined)
    const keys = pick('keys')
    return {
      id,
      key:   pick('key') ?? null,
      keys:  Array.isArray(keys) && keys.length ? keys : null,
      vol:   (typeof pick('vol') === 'number') ? pick('vol') : null,
      pitch: (typeof pick('pitch') === 'boolean') ? pick('pitch') : null,
      mute:  !!pick('mute'),
      fileKey: pick('fileKey') || null,
    }
  },

  // ── Editing (Studio writes here) ──────────────────────────────────────────
  set(id, patch) { _over[id] = { ...(_over[id] || {}), ...patch }; _save() },
  reset(id)      { delete _over[id]; _save() },
  resetAll()     { _over = {}; _save() },

  // ── Custom uploaded audio (the upload layer registers object URLs here) ────
  customUrl(fileKey) { return fileKey ? _customUrls[fileKey] || null : null },
  registerCustomUrl(fileKey, url) { if (fileKey) _customUrls[fileKey] = url; _emit() },

  // ── Export / import (for the bake tool + backups) ─────────────────────────
  exportJson() { return JSON.stringify({ version: 1, overrides: _over }, null, 2) },
  importJson(json) {
    try {
      const p = typeof json === 'string' ? JSON.parse(json) : json
      if (!p || typeof p !== 'object') return false
      _over = p.overrides || {}
      _save()
      return true
    } catch { return false }
  },

  onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn) },
}
