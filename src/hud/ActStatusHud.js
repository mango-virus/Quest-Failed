// ActStatusHud (DOM) — KR P4. A persistent status pill pinned top-center (just
// under the top bar) so the player ALWAYS sees which act they're on and what
// Kingdom Response modifier is governing it — no need to remember it from the
// one-time announce. Accent-themed + emblem per response; on the fixed bookend
// acts (I, IV) it shows the act name instead.
//
// Purely event-driven: ACT_STARTED sets the act (+ the fixed-act name);
// KINGDOM_RESPONSE_DRAWN fills in the drafted response. Both re-fire at run
// start / on continue, so the pill is always current. Gated in HudRoot behind
// the `acts` flag. Built to VISUAL_STANDARDS.md (tokens, no overlap, eased).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']
const NEUTRAL = '#d4a648'   // gold — fixed acts (no response)

export class ActStatusHud {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._listeners = []
    this._ensureCss()
    this._build()
    this._on('ACT_STARTED',            p => this._onActStarted(p))
    this._on('KINGDOM_RESPONSE_DRAWN', p => this._onResponse(p))
  }

  _on(evt, fn) { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._root?.remove(); this._root = null
  }

  _ensureCss() {
    if (typeof document === 'undefined' || document.getElementById('qf-actstatus-css')) return
    const style = document.createElement('style')
    style.id = 'qf-actstatus-css'
    style.textContent = `
.qf-actstatus { position:absolute; top:calc(var(--hud-top, 96px) + 8px); left:50%;
  transform:translate(-50%, -6px); z-index:30; pointer-events:auto;
  display:flex; align-items:center; gap:var(--space-3, 12px); max-width:540px;
  padding:6px 14px 7px; border-radius:var(--radius-md, 7px);
  background:linear-gradient(180deg, rgba(12,9,18,.93), rgba(6,4,12,.93));
  border:1px solid var(--as-accent, ${NEUTRAL}); border-left:3px solid var(--as-accent, ${NEUTRAL});
  box-shadow:0 2px 12px rgba(0,0,0,.5), 0 0 14px color-mix(in srgb, var(--as-accent, ${NEUTRAL}) 22%, transparent);
  font-family:'Press Start 2P','Courier New',monospace;
  opacity:0; transition:opacity var(--dur-base,240ms) var(--ease-out,ease),
                        transform var(--dur-base,240ms) var(--ease-out,ease); }
.qf-actstatus.show { opacity:1; transform:translate(-50%, 0); }
.qf-actstatus-emblem { font-size:22px; line-height:1; color:var(--as-accent, ${NEUTRAL});
  filter:drop-shadow(0 0 6px var(--as-accent, ${NEUTRAL})); flex:0 0 auto; }
.qf-actstatus-text { display:flex; flex-direction:column; gap:3px; min-width:0; }
.qf-actstatus-title { font-size:9px; letter-spacing:1px; color:#efe7d6; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.qf-actstatus-act { color:var(--as-accent, ${NEUTRAL}); }
.qf-actstatus-mod { font-family:'VT323',monospace; font-size:13px; letter-spacing:.3px;
  color:#9aa7b4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:480px; }`
    document.head.appendChild(style)
  }

  _build() {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._root = h('div', { className: 'qf-actstatus' }, [
      h('div', { className: 'qf-actstatus-emblem', ref: el => (this._emblemEl = el) }, '◆'),
      h('div', { className: 'qf-actstatus-text' }, [
        h('div', { className: 'qf-actstatus-title', ref: el => (this._titleEl = el) }),
        h('div', { className: 'qf-actstatus-mod', ref: el => (this._modEl = el) }),
      ]),
    ])
    stage.appendChild(this._root)
  }

  _onActStarted({ act, def } = {}) {
    // Drafted acts (II/III) are filled by the KINGDOM_RESPONSE_DRAWN that fires
    // immediately after — only paint the fixed bookend acts (I, IV) from here.
    if (def?.kind === 'drafted') return
    this._paint({
      act, accent: NEUTRAL, emblem: '◆',
      name: def?.name ?? `Act ${act}`, modifier: def?.tagline ?? '',
    })
  }

  _onResponse({ act, response } = {}) {
    if (!response) return
    this._paint({
      act, accent: response.accent || NEUTRAL, emblem: response.emblem || '◆',
      name: response.name || 'The Kingdom Responds', modifier: response.gimmick || response.threat || '',
    })
  }

  _paint({ act, accent, emblem, name, modifier }) {
    if (!this._root) return
    this._root.style.setProperty('--as-accent', accent)
    if (this._emblemEl) this._emblemEl.textContent = emblem
    if (this._titleEl) {
      this._titleEl.replaceChildren(
        h('span', { className: 'qf-actstatus-act' }, `ACT ${ROMAN[act] || act}`),
        document.createTextNode(`  ·  ${name}`),
      )
    }
    if (this._modEl) this._modEl.textContent = modifier
    this._root.title = modifier ? `Act ${ROMAN[act] || act} — ${name}\n${modifier}` : `${name}`
    this._root.classList.add('show')
  }
}
