// VictoryScreen (DOM) — KR P7. The full payoff of "The Kingdom's Reckoning":
// when the player clears all four acts (RUN_VICTORY, fired by ActSystem when
// Aldric falls in the Act IV duel), this declares the win, tallies the campaign
// you fought, reveals the Reckoning NG+ unlock, and hands off — CONTINUE
// (eternal reign / Endless) or RETURN TO MENU.
//
// Rebuilt for UI_POLISH_PLAN P2-3 (the trailer moment): a triumphant music cue
// (VictoryMusic — dormant until its file lands), a one-shot gold spark burst +
// god-rays + a slam shake (all FINITE — no infinite CSS animation, so it holds
// a stable frame and doesn't hang preview_screenshot, VISUAL_STANDARDS §4),
// staggered count-up stats (runCountUp), a FULL LOG button (parity with the
// GameOver screen), fully tokenized colours (retints under boss palettes +
// the colorMode accessibility palettes), and a reduced-motion fallback (the
// global html.reduce-motion reset freezes the entrances on their END state
// since every reveal uses forwards/both fill; count-up + shake self-gate).
//
// The meta-unlock (Reckoning NG+ tier) is persisted here on the first victory.
// Gated in HudRoot behind the `acts` flag.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { runCountUp } from './countUp.js'
import { FullLogOverlay } from './FullLogOverlay.js'
import { VictoryMusic } from '../systems/VictoryMusic.js'
import { domShake } from './screenShake.js'

function _json(key) {
  const arr = window.__game?.cache?.json?.get?.(key)
  return Array.isArray(arr) ? arr : []
}
function _responseName(id) {
  return _json('kingdomResponses').find(r => r.id === id)?.name ?? null
}
function _archName(id) {
  return _json('bossArchetypes').find(a => a.id === id)?.name ?? (id || 'your dungeon')
}

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-victory-css')) return
  const style = document.createElement('style')
  style.id = 'qf-victory-css'
  style.textContent = `
.qf-victory { position:absolute; inset:0; z-index:60; pointer-events:auto; overflow:hidden;
  display:flex; align-items:center; justify-content:center; opacity:0;
  transition:opacity .6s ease; font-family:'Press Start 2P','Courier New',monospace; }
.qf-victory.show { opacity:1; }
.qf-victory::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 42%,
    color-mix(in srgb, var(--gold) 22%, transparent) 0%,
    rgba(8,5,2,.93) 64%, rgba(3,2,6,.98) 100%); }
/* god-rays — finite fade-in, tinted by the gold token (retints w/ palette) */
.qf-victory-rays { position:absolute; left:50%; top:42%; width:2px; height:2px;
  transform:translate(-50%,-50%); opacity:0; animation:qf-vic-fade 1.4s ease .2s forwards; }
.qf-victory-ray { position:absolute; left:0; top:0; width:3px; height:64vh; transform-origin:top center;
  background:linear-gradient(180deg, color-mix(in srgb, var(--gold-bright) 42%, transparent), transparent 70%); }
/* one-shot spark burst from the title (FINITE — radiates out and fades) */
.qf-victory-sparks { position:absolute; inset:0; pointer-events:none; z-index:1; }
.qf-victory-spark { position:absolute; left:50%; top:40%; width:5px; height:5px; border-radius:50%;
  background:var(--gold-bright); box-shadow:0 0 8px var(--gold-bright);
  opacity:0; transform:translate(-50%,-50%) scale(.4);
  animation:qf-vic-spark 1150ms var(--ease-out, cubic-bezier(.16,.84,.3,1)) both; }
@keyframes qf-vic-spark {
  0%   { opacity:0; transform:translate(-50%,-50%) scale(.4); }
  16%  { opacity:1; }
  100% { opacity:0; transform:translate(calc(-50% + var(--dx,0px)), calc(-50% + var(--dy,0px))) scale(.7); } }

.qf-victory-card { position:relative; z-index:2; text-align:center; padding:24px 40px; max-width:800px;
  max-height:92vh; overflow-y:auto; }
.qf-victory-eyebrow { font-size:clamp(9px,1.1vw,13px); letter-spacing:7px; color:var(--gold-bright);
  text-shadow:0 0 14px color-mix(in srgb, var(--gold-bright) 70%, transparent); margin-bottom:14px;
  opacity:0; animation:qf-vic-fade .7s ease .2s forwards; }
.qf-victory-title { font-size:clamp(30px,5.4vw,70px); letter-spacing:5px; color:#fff3cf;
  text-shadow:0 0 34px color-mix(in srgb, var(--gold-bright) 85%, transparent), 0 4px 0 #2a1705;
  animation:qf-vic-pop .8s cubic-bezier(.18,.9,.25,1) both; }
.qf-victory-sub { font-size:clamp(10px,1.4vw,16px); letter-spacing:3px; color:#ece2d2;
  margin-top:14px; opacity:0; animation:qf-vic-fade .7s ease .5s forwards; }
.qf-victory-flavor { font-family:'VT323',monospace; font-size:clamp(14px,1.7vw,20px);
  color:color-mix(in srgb, var(--gold) 55%, var(--text)); margin:14px auto 0; line-height:1.4; max-width:560px;
  opacity:0; animation:qf-vic-fade .7s ease .7s forwards; }

/* ── Run-summary stat grid (count-up tickers, parity w/ GameOver) ── */
.qf-victory-statgrid { display:grid; grid-template-columns:repeat(5, 1fr); gap:10px; margin:24px auto 0;
  max-width:620px; }
.qf-victory-stat { padding:10px 6px 9px; border-radius:var(--radius-md,7px);
  background:rgba(20,14,6,.5); opacity:0; animation:qf-vic-pop2 .55s var(--ease-out, ease) both; }
.qf-victory-stat-icon { font-size:14px; line-height:1; margin-bottom:7px; }
.qf-victory-stat-value { font-size:clamp(14px,1.7vw,20px); text-shadow:0 0 10px currentColor; }
.qf-victory-stat-label { font-size:7px; letter-spacing:1.5px; color:var(--text-mute); margin-top:7px; }

/* secondary detail rows (Aldric / strategies broken / final form) */
.qf-victory-detail { margin:16px auto 0; max-width:600px; display:flex; flex-direction:column; gap:6px;
  opacity:0; animation:qf-vic-fade .7s ease 1.05s forwards; }
.qf-victory-drow { display:flex; justify-content:space-between; align-items:baseline; gap:12px;
  padding:6px 4px; border-bottom:1px solid color-mix(in srgb, var(--gold) 16%, transparent); text-align:left; }
.qf-victory-drow-label { font-size:8px; letter-spacing:1.5px; color:var(--text-mute); flex:0 0 auto; }
.qf-victory-drow-value { font-family:'VT323',monospace; font-size:17px; color:#f4e8c8; text-align:right; }
.qf-victory-drow-value.slain { color:var(--blood-glow); }
.qf-victory-drow-value.gold  { color:var(--gold-bright); }

.qf-victory-unlock { margin:22px auto 0; max-width:560px; padding:13px 18px; border-radius:var(--radius-lg,12px);
  background:linear-gradient(180deg,
    color-mix(in srgb, var(--info) 26%, transparent),
    color-mix(in srgb, var(--info) 12%, transparent));
  border:1px solid color-mix(in srgb, var(--info) 55%, transparent);
  box-shadow:0 0 22px color-mix(in srgb, var(--info) 34%, transparent);
  opacity:0; animation:qf-vic-pop2 .7s cubic-bezier(.18,.9,.25,1) 1.25s both; }
.qf-victory-unlock-head { display:flex; align-items:center; justify-content:center; gap:9px;
  font-size:clamp(11px,1.4vw,15px); letter-spacing:3px; color:color-mix(in srgb, var(--info) 70%, #fff);
  text-shadow:0 0 12px color-mix(in srgb, var(--info) 60%, transparent); }
.qf-victory-unlock-sub { font-family:'VT323',monospace; font-size:16px;
  color:color-mix(in srgb, var(--info) 45%, var(--text)); margin-top:7px; }

.qf-victory-actions { margin-top:26px; display:flex; gap:14px; justify-content:center; flex-wrap:wrap;
  opacity:0; animation:qf-vic-fade .7s ease 1.55s forwards; }
.qf-victory-actions .btn { font-size:12px; }

@keyframes qf-vic-pop { 0%{opacity:0; transform:scale(.6); filter:blur(8px)}
  60%{opacity:1; transform:scale(1.05); filter:blur(0)} 100%{opacity:1; transform:scale(1)} }
@keyframes qf-vic-pop2 { 0%{opacity:0; transform:scale(.8); filter:blur(4px)}
  100%{opacity:1; transform:scale(1); filter:blur(0)} }
@keyframes qf-vic-fade { from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:translateY(0)} }`
  document.head.appendChild(style)
}

export class VictoryScreen {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._fullLog = null
    this._countUpCancel = null
    this._timers = []
    EventBus.on('RUN_VICTORY', this._onVictory, this)
  }

  destroy() {
    EventBus.off('RUN_VICTORY', this._onVictory, this)
    this._cleanup()
    this._root?.remove(); this._root = null
  }

  _onVictory() {
    if (this._root) return   // already showing
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    _ensureCss()

    // Persist the meta-unlock: winning at the run's NG+ tier earns the NEXT one.
    const runTier  = this._gs.meta?.reckoningTier ?? 0
    const nextTier = runTier + 1
    let freshUnlock = false
    try { freshUnlock = PlayerProfile.unlockReckoningTier(nextTier) } catch {}

    const rays = h('div', { className: 'qf-victory-rays' },
      Array.from({ length: 12 }, (_, i) =>
        h('div', { className: 'qf-victory-ray', style: { transform: `rotate(${i * 30}deg)` } })))

    this._root = h('div', { className: 'qf-victory' }, [
      rays,
      this._buildSparks(),
      h('div', { className: 'qf-victory-card' }, [
        h('div', { className: 'qf-victory-eyebrow' }, 'THE KINGDOM IS BROKEN'),
        h('div', { className: 'qf-victory-title' }, 'VICTORY'),
        h('div', { className: 'qf-victory-sub' }, 'THE RECKONING IS ENDED'),
        h('div', { className: 'qf-victory-flavor' },
          'They sent students, then guilds, then their crowned champion. ' +
          'All of them broke against your dungeon. You reign — eternal.'),
        this._statGrid(),
        this._detail(),
        this._unlock(nextTier, freshUnlock),
        h('div', { className: 'qf-victory-actions' }, [
          h('button', { className: 'btn primary', on: { click: () => this._continueEndless() } },
            'CONTINUE · ETERNAL REIGN'),
          h('button', { className: 'btn', on: { click: () => this._openFullLog() } }, 'FULL LOG'),
          h('button', { className: 'btn', on: { click: () => this._returnToMenu() } },
            'RETURN TO MENU'),
        ]),
      ]),
    ])
    stage.appendChild(this._root)
    requestAnimationFrame(() => this._root?.classList.add('show'))
    // Triumphant music loop (dormant until the file is added — VictoryMusic
    // guards on the audio cache, like GameOverMusic).
    try { VictoryMusic.start(window.__game) } catch {}
    // Cascade the tagged stat numbers up from 0 (reduced-motion-aware).
    this._countUpCancel = runCountUp(this._root)
    // A celebratory jolt on the VICTORY slam (gated on shake + reduced-motion).
    this._timers.push(setTimeout(() => domShake(this._root, { intensity: 10, durationMs: 420 }), 450))
  }

  // Finite radiating spark burst from the title (no infinite animation).
  _buildSparks() {
    const N = 22
    const sparks = []
    for (let i = 0; i < N; i++) {
      const ang  = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
      const dist = 120 + Math.random() * 220
      const dx = Math.cos(ang) * dist
      const dy = Math.sin(ang) * dist * 0.7   // flatten slightly (wider than tall)
      const sz = 3 + Math.random() * 4
      sparks.push(h('span', {
        className: 'qf-victory-spark',
        style: {
          '--dx': `${dx.toFixed(0)}px`, '--dy': `${dy.toFixed(0)}px`,
          width: `${sz.toFixed(1)}px`, height: `${sz.toFixed(1)}px`,
          animationDelay: `${(0.25 + Math.random() * 0.5).toFixed(2)}s`,
        },
      }))
    }
    return h('div', { className: 'qf-victory-sparks' }, sparks)
  }

  // ── Stat grid (count-up tickers) ──────────────────────────────────────────
  _statTile(label, value, color, icon, delay) {
    return h('div', {
      className: 'qf-victory-stat',
      style: { borderTop: `2px solid ${color}`, animationDelay: `${delay}s` },
    }, [
      h('div', { className: 'qf-victory-stat-icon', style: { color } }, icon),
      h('div', { className: 'qf-victory-stat-value cu', style: { color } }, String(value)),
      h('div', { className: 'qf-victory-stat-label' }, label),
    ])
  }

  _statGrid() {
    const gs = this._gs
    const t = gs.run?.totals ?? {}
    const act = gs.meta?.act ?? {}
    const days = gs.meta?.dayNumber ?? 40
    const slain = t.advsKilled ?? t.kills ?? 0
    const gold = t.gold ?? 0
    const champs = Object.keys(act.championsDefeated ?? {}).length
    const bossLv = gs.boss?.level ?? 1
    return h('div', { className: 'qf-victory-statgrid' }, [
      this._statTile('DAYS REIGNED',  days,   'var(--text)',         '◇', 0.95),
      this._statTile('SLAIN',         slain,  'var(--blood-glow)',   '☠', 1.02),
      this._statTile('CHAMPIONS',     champs, 'var(--gold-bright)',  '♛', 1.09),
      this._statTile('BOSS LV',       bossLv, 'var(--info)',         '★', 1.16),
      this._statTile('GOLD',          gold,   'var(--gold)',         '◈', 1.23),
    ])
  }

  // ── Secondary detail rows (text — Aldric / strategies / final form) ─────────
  _drow(label, value, cls = '') {
    return h('div', { className: 'qf-victory-drow' }, [
      h('span', { className: 'qf-victory-drow-label' }, label),
      h('span', { className: `qf-victory-drow-value ${cls}` }, String(value)),
    ])
  }

  _detail() {
    const gs = this._gs
    const act = gs.meta?.act ?? {}
    const aldric = gs.meta?.nemesis?.slainByBoss
    const plunder = act._plunderStolen ?? 0
    const responses = Object.keys(act.responses ?? {})
      .sort()
      .map(k => _responseName(act.responses[k]))
      .filter(Boolean)
    const finalForm = `${_archName(gs.player?.bossArchetypeId)} · Ascended`
    const rows = [
      this._drow('ALDRIC, THE HERO KING', aldric ? 'SLAIN' : 'Held off', 'slain'),
    ]
    if (plunder > 0) rows.push(this._drow('LOST TO THIEVES', `-${plunder}`, 'gold'))
    if (responses.length) rows.push(this._drow('STRATEGIES BROKEN', responses.join(' · ')))
    rows.push(this._drow('YOUR FINAL FORM', finalForm, 'gold'))
    return h('div', { className: 'qf-victory-detail' }, rows)
  }

  _unlock(nextTier, fresh) {
    return h('div', { className: 'qf-victory-unlock' }, [
      h('div', { className: 'qf-victory-unlock-head' }, [
        h('span', {}, '✦'),
        h('span', {}, `RECKONING NG+${nextTier}${fresh ? ' UNLOCKED' : ''}`),
        h('span', {}, '✦'),
      ]),
      h('div', { className: 'qf-victory-unlock-sub' },
        fresh ? 'The realm will return — stronger. Face it again from the menu.'
              : 'You have already earned this tier — push deeper for more.'),
    ])
  }

  _openFullLog() {
    if (this._fullLog) return
    this._countUpCancel?.(); this._countUpCancel = null
    this._fullLog = new FullLogOverlay(this._gs, {
      onClose: () => { this._fullLog = null },
    })
    this._fullLog.open()
  }

  // CONTINUE — the run keeps going past day 40 (acts clamp to the final act;
  // meta.act.won guards a re-fire). Endless reign for the leaderboard.
  _continueEndless() {
    if (this._gs?.meta) this._gs.meta.endlessReign = true
    EventBus.emit('RUN_CONTINUE_ENDLESS')
    EventBus.emit('RUN_VICTORY_DISMISSED')
    this._fadeOut()
  }

  // RETURN TO MENU — end the run, mirroring GameOverOverlay's scene teardown.
  _returnToMenu() {
    EventBus.emit('RUN_VICTORY_DISMISSED')
    EventBus.emit('RETURN_TO_MENU')
    this._fadeOut(() => {
      const game = window.__game
      if (!game?.scene) return
      for (const k of ['Game', 'NightPhase', 'DayPhase', 'EndOfDay', 'HudScene', 'Graveyard', 'KnowledgeScreen']) {
        if (game.scene.isActive(k) || game.scene.isPaused?.(k)) game.scene.stop(k)
      }
      game.scene.start('MainMenu')
    })
  }

  _cleanup() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
    this._countUpCancel?.(); this._countUpCancel = null
    this._fullLog?.close(); this._fullLog = null
    try { VictoryMusic.stop() } catch {}
  }

  _fadeOut(after) {
    this._cleanup()
    this._root?.classList.remove('show')
    const el = this._root; this._root = null
    setTimeout(() => { el?.remove(); after?.() }, 600)
  }
}
