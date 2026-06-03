// ChampionBar (DOM) — KR P4. The persistent "act boss" banner. While a drafted
// act's Kingdom-Response champion lives, a slim top-centre bar names it, tracks
// its HP, and states the objective (defeat it to clear the act). Pairs with the
// in-world threat aura + crown (AdventurerRenderer) so the player always knows
// WHO the act threat is and HOW close it is to falling.
//
// Self-mounts into #hud-stage, injects CSS once. Gated in HudRoot behind `acts`.
// Tinted to the response accent. HP is read by polling the champion adventurer
// ref (passed on CHAMPION_RAID_INCOMING) — robust to every damage source (combat,
// traps, DoT) without a dedicated HP event stream. No infinite CSS animation
// (transitions only), so it holds on a stable frame for screenshots.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const POLL_MS = 120

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-champbar-css')) return
  const style = document.createElement('style')
  style.id = 'qf-champbar-css'
  style.textContent = `
.qf-champbar { position:absolute; left:50%; top:calc(var(--hud-top,96px) + 8px);
  transform:translateX(-50%) translateY(-14px); z-index:30; pointer-events:none;
  width:min(46vw,420px); --cb:#ffd24a;
  font-family:'Press Start 2P','Courier New',monospace;
  opacity:0; transition:opacity .3s ease, transform .3s cubic-bezier(.16,.84,.3,1); }
.qf-champbar.on { opacity:1; transform:translateX(-50%) translateY(0); }
.qf-champbar-card { position:relative; padding:9px 14px 10px;
  background:linear-gradient(180deg, rgba(14,9,18,.92), rgba(8,5,12,.96));
  border:2px solid color-mix(in srgb, var(--cb) 70%, #3a2a10); border-radius:7px;
  box-shadow:0 0 22px color-mix(in srgb,var(--cb) 30%, transparent), 0 5px 0 rgba(0,0,0,.5); }
.qf-champbar-eyebrow { font-size:9px; letter-spacing:3px; color:var(--cb);
  text-shadow:0 0 8px color-mix(in srgb,var(--cb) 70%, transparent); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; text-align:center; }
.qf-champbar-name { font-size:clamp(12px,1.5vw,17px); letter-spacing:1px; color:#fff3df;
  text-shadow:0 0 12px color-mix(in srgb,var(--cb) 60%, transparent), 0 2px 0 #1a1004;
  text-align:center; margin:5px 0 7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.qf-champbar-track { position:relative; height:16px; background:rgba(6,4,10,.9);
  border:2px solid color-mix(in srgb,var(--cb) 45%, #000); border-radius:3px; overflow:hidden;
  box-shadow:inset 0 0 10px rgba(0,0,0,.6); }
.qf-champbar-fill, .qf-champbar-ghost { position:absolute; left:0; top:0; bottom:0; width:100%; }
.qf-champbar-fill  { background:linear-gradient(90deg, color-mix(in srgb,var(--cb) 50%, #000), var(--cb));
  transition:width .16s linear; box-shadow:0 0 10px color-mix(in srgb,var(--cb) 60%, transparent); }
.qf-champbar-ghost { background:#ffb0a4; opacity:.45; transition:width .5s ease .12s; }
.qf-champbar-foot { display:flex; align-items:center; justify-content:space-between; margin-top:6px; }
.qf-champbar-obj { font-family:'VT323',monospace; font-size:14px; letter-spacing:1px; color:#ffd2c2;
  text-shadow:0 0 8px rgba(255,90,60,.5); }
.qf-champbar-hp { font-family:'VT323',monospace; font-size:15px; color:#fff3df; }
/* defeated flourish */
.qf-champbar.down .qf-champbar-card { border-color:#6fce8a; box-shadow:0 0 24px rgba(110,206,138,.45), 0 5px 0 rgba(0,0,0,.5); }
.qf-champbar.down .qf-champbar-obj { color:#9af0b4; text-shadow:0 0 10px rgba(110,206,138,.7); }`
  document.head.appendChild(style)
}

export class ChampionBar {
  constructor(gameState) {
    this._gs = gameState
    this._champ = null
    this._poll = null
    this._hideTimer = null
    this._defeated = false
    this._listeners = []
    _ensureCss()
    this._build()
    this._on('CHAMPION_RAID_INCOMING', p => this._onIncoming(p ?? {}))
    this._on('CHAMPION_DEFEATED',      () => this._onDefeated())
    this._on('DAY_PHASE_ENDED',        () => this._hide())
    this._on('NIGHT_PHASE_STARTED',    () => this._hide())
  }

  _on(evt, fn) { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._stopPoll()
    clearTimeout(this._hideTimer)
    this._root?.remove(); this._root = null
  }

  _build() {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._fill  = h('div', { className: 'qf-champbar-fill' })
    this._ghost = h('div', { className: 'qf-champbar-ghost' })
    this._eyebrow = h('div', { className: 'qf-champbar-eyebrow' }, '')
    this._nameEl  = h('div', { className: 'qf-champbar-name' }, '')
    this._objEl   = h('div', { className: 'qf-champbar-obj' }, '⚔ DEFEAT TO CLEAR THE ACT')
    this._hpEl    = h('div', { className: 'qf-champbar-hp' }, '100%')
    this._root = h('div', { className: 'qf-champbar' }, [
      h('div', { className: 'qf-champbar-card' }, [
        this._eyebrow,
        this._nameEl,
        h('div', { className: 'qf-champbar-track' }, [this._ghost, this._fill]),
        h('div', { className: 'qf-champbar-foot' }, [this._objEl, this._hpEl]),
      ]),
    ])
    stage.appendChild(this._root)
  }

  _onIncoming({ response, champion, adventurer } = {}) {
    if (!this._root) return
    // The boss adv whose HP we track (fall back to finding it in active).
    this._champ = adventurer
      ?? (this._gs?.adventurers?.active ?? []).find(a => a?._championResponseId)
      ?? null
    if (!this._champ) return
    this._defeated = false
    clearTimeout(this._hideTimer)
    this._root.classList.remove('down')
    const accent = response?.accent || this._champ._championAccent || '#ffd24a'
    this._root.style.setProperty('--cb', accent)
    const emblem = response?.emblem ? response.emblem + ' ' : ''
    this._eyebrow.textContent = `${emblem}THE KINGDOM RESPONDS · ${(response?.name || 'THE KINGDOM').toUpperCase()}`
    this._nameEl.textContent  = String(champion || this._champ.name || 'THE CHAMPION').toUpperCase()
    this._objEl.textContent   = '⚔ DEFEAT TO CLEAR THE ACT'
    this._setHp(1)
    this._root.classList.add('on')
    this._startPoll()
  }

  _onDefeated() {
    this._stopPoll()
    this._defeated = true
    this._setHp(0)
    if (this._root) {
      this._root.classList.add('down')
      this._objEl.textContent = '✓ THREAT ENDED'
    }
    clearTimeout(this._hideTimer)
    this._hideTimer = setTimeout(() => this._hide(), 2600)
  }

  _startPoll() {
    this._stopPoll()
    this._poll = setInterval(() => this._tick(), POLL_MS)
    this._tick()
  }
  _stopPoll() { if (this._poll) { clearInterval(this._poll); this._poll = null } }

  _tick() {
    const c = this._champ
    if (!c) { this._hide(); return }
    const hp  = Math.max(0, c.resources?.hp ?? 0)
    const max = Math.max(1, c.resources?.maxHp ?? 1)
    this._setHp(hp / max)
    // Champion gone without a CHAMPION_DEFEATED (e.g. spliced silently) — bow out.
    const active = this._gs?.adventurers?.active ?? []
    if (!this._defeated && (hp <= 0 || c.aiState === 'dead' || !active.includes(c))) {
      this._stopPoll()
      clearTimeout(this._hideTimer)
      this._hideTimer = setTimeout(() => { if (!this._defeated) this._hide() }, 600)
    }
  }

  _setHp(frac) {
    const f = Math.max(0, Math.min(1, frac))
    const pct = `${(f * 100).toFixed(1)}%`
    if (this._fill)  this._fill.style.width  = pct
    if (this._ghost) this._ghost.style.width = pct
    if (this._hpEl)  this._hpEl.textContent  = `${Math.round(f * 100)}%`
  }

  _hide() {
    this._stopPoll()
    clearTimeout(this._hideTimer)
    this._champ = null
    this._root?.classList.remove('on')
  }
}
