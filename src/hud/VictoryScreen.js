// VictoryScreen (DOM) — KR P2/P7 seed. The visible payoff of "The Kingdom's
// Reckoning": when the player clears all four acts (RUN_VICTORY fires from
// ActSystem, and later from defeating Aldric in the Act IV duel), this
// triumphant card declares the win — the realm breaks, the dungeon stands.
//
// This is the minimal visible victory for now. The full KR P7 treatment
// (run tally, meta-unlock reveal, "continue into Endless" handoff) layers on
// later — it'll listen to the same RUN_VICTORY event. Gated in HudRoot behind
// the `acts` flag.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-victory-css')) return
  const style = document.createElement('style')
  style.id = 'qf-victory-css'
  style.textContent = `
.qf-victory { position:absolute; inset:0; z-index:60; pointer-events:auto;
  display:flex; align-items:center; justify-content:center; opacity:0;
  transition:opacity .6s ease; font-family:'Press Start 2P','Courier New',monospace; }
.qf-victory.show { opacity:1; }
.qf-victory::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 42%, rgba(40,30,8,.55) 0%, rgba(4,3,8,.93) 70%); }
.qf-victory-rays { position:absolute; left:50%; top:42%; width:2px; height:2px;
  transform:translate(-50%,-50%); }
.qf-victory-ray { position:absolute; left:0; top:0; width:3px; height:64vh;
  transform-origin:top center; background:linear-gradient(180deg, rgba(255,214,107,.5), transparent 70%);
  animation:qf-vic-spin 26s linear infinite; }
@keyframes qf-vic-spin { to { transform:rotate(360deg); } }
.qf-victory-card { position:relative; text-align:center; padding:30px 44px; max-width:760px; }
.qf-victory-eyebrow { font-size:clamp(9px,1.1vw,13px); letter-spacing:7px; color:#ffd66b;
  text-shadow:0 0 14px rgba(255,214,107,.8); margin-bottom:18px;
  opacity:0; animation:qf-vic-fade .7s ease .2s forwards; }
.qf-victory-title { font-size:clamp(34px,6vw,78px); letter-spacing:5px; color:#fff3cf;
  text-shadow:0 0 34px rgba(255,205,80,.9), 0 4px 0 #2a1705;
  animation:qf-vic-pop .8s cubic-bezier(.18,.9,.25,1) both; }
.qf-victory-sub { font-size:clamp(11px,1.5vw,17px); letter-spacing:3px; color:#ece2d2;
  margin-top:18px; opacity:0; animation:qf-vic-fade .7s ease .5s forwards; }
.qf-victory-flavor { font-family:'VT323',monospace; font-size:clamp(15px,1.9vw,22px);
  color:#bda77a; margin-top:18px; line-height:1.45; max-width:560px; margin-left:auto;
  margin-right:auto; opacity:0; animation:qf-vic-fade .7s ease .8s forwards; }
.qf-victory-btn { margin-top:32px; opacity:0; animation:qf-vic-fade .7s ease 1.2s forwards; }
.qf-victory-btn .btn { font-size:13px; }
@keyframes qf-vic-pop { 0%{opacity:0; transform:scale(.6); filter:blur(8px)}
  60%{opacity:1; transform:scale(1.05); filter:blur(0)} 100%{opacity:1; transform:scale(1)} }
@keyframes qf-vic-fade { from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:translateY(0)} }`
  document.head.appendChild(style)
}

export class VictoryScreen {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    EventBus.on('RUN_VICTORY', this._onVictory, this)
  }

  destroy() {
    EventBus.off('RUN_VICTORY', this._onVictory, this)
    this._root?.remove(); this._root = null
  }

  _onVictory() {
    if (this._root) return   // already showing
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    _ensureCss()

    const rays = h('div', { className: 'qf-victory-rays' },
      Array.from({ length: 12 }, (_, i) =>
        h('div', { className: 'qf-victory-ray', style: { transform: `rotate(${i * 30}deg)` } })))

    this._root = h('div', { className: 'qf-victory' }, [
      rays,
      h('div', { className: 'qf-victory-card' }, [
        h('div', { className: 'qf-victory-eyebrow' }, 'THE KINGDOM IS BROKEN'),
        h('div', { className: 'qf-victory-title' }, 'VICTORY'),
        h('div', { className: 'qf-victory-sub' }, 'THE RECKONING IS ENDED'),
        h('div', { className: 'qf-victory-flavor' },
          'They sent students, then guilds, then their crowned champion. ' +
          'All of them broke against your dungeon. The realm will not come again. ' +
          'You reign — eternal.'),
        h('div', { className: 'qf-victory-btn' }, [
          h('button', { className: 'btn primary', on: { click: () => this._dismiss() } }, 'CONTINUE'),
        ]),
      ]),
    ])
    stage.appendChild(this._root)
    requestAnimationFrame(() => this._root?.classList.add('show'))
  }

  // For now CONTINUE just dismisses the card. KR P7 wires the real handoff
  // (run tally + meta-unlock reveal + "continue into Endless" / return to menu).
  _dismiss() {
    EventBus.emit('RUN_VICTORY_DISMISSED')
    this._root?.classList.remove('show')
    const el = this._root; this._root = null
    setTimeout(() => el?.remove(), 600)
  }
}
