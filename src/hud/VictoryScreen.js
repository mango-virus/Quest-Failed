// VictoryScreen (DOM) — KR P7. The full payoff of "The Kingdom's Reckoning":
// when the player clears all four acts (RUN_VICTORY, fired by ActSystem when
// Aldric falls in the Act IV duel), this declares the win, tallies the campaign
// you fought, reveals the Reckoning NG+ unlock, and hands off — the player picks
// CONTINUE (eternal reign / Endless, past day 40) or RETURN TO MENU.
//
// The meta-unlock (Reckoning NG+ tier) is persisted here on the first victory
// (PlayerProfile, per-name). The NG+ run config + harder scaling + the victory
// achievement land alongside the NG+ play mechanics. Gated in HudRoot behind the
// `acts` flag. No INFINITE CSS animations (those hang preview_screenshot — see
// VISUAL_STANDARDS §4); the rays fade in once and hold.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'

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
.qf-victory { position:absolute; inset:0; z-index:60; pointer-events:auto;
  display:flex; align-items:center; justify-content:center; opacity:0;
  transition:opacity .6s ease; font-family:'Press Start 2P','Courier New',monospace; }
.qf-victory.show { opacity:1; }
.qf-victory::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 42%, rgba(40,30,8,.55) 0%, rgba(4,3,8,.95) 70%); }
.qf-victory-rays { position:absolute; left:50%; top:42%; width:2px; height:2px;
  transform:translate(-50%,-50%); opacity:0; animation:qf-vic-fade 1.4s ease .2s forwards; }
.qf-victory-ray { position:absolute; left:0; top:0; width:3px; height:64vh;
  transform-origin:top center; background:linear-gradient(180deg, rgba(255,214,107,.42), transparent 70%); }
.qf-victory-card { position:relative; text-align:center; padding:24px 40px; max-width:780px;
  max-height:92vh; overflow-y:auto; }
.qf-victory-eyebrow { font-size:clamp(9px,1.1vw,13px); letter-spacing:7px; color:#ffd66b;
  text-shadow:0 0 14px rgba(255,214,107,.8); margin-bottom:14px;
  opacity:0; animation:qf-vic-fade .7s ease .2s forwards; }
.qf-victory-title { font-size:clamp(30px,5.4vw,70px); letter-spacing:5px; color:#fff3cf;
  text-shadow:0 0 34px rgba(255,205,80,.9), 0 4px 0 #2a1705;
  animation:qf-vic-pop .8s cubic-bezier(.18,.9,.25,1) both; }
.qf-victory-sub { font-size:clamp(10px,1.4vw,16px); letter-spacing:3px; color:#ece2d2;
  margin-top:14px; opacity:0; animation:qf-vic-fade .7s ease .5s forwards; }
.qf-victory-flavor { font-family:'VT323',monospace; font-size:clamp(14px,1.7vw,20px);
  color:#bda77a; margin:14px auto 0; line-height:1.4; max-width:560px;
  opacity:0; animation:qf-vic-fade .7s ease .7s forwards; }
.qf-victory-tally { display:grid; grid-template-columns:1fr 1fr; gap:8px 22px; margin:22px auto 0;
  max-width:560px; text-align:left; opacity:0; animation:qf-vic-fade .7s ease .95s forwards; }
.qf-victory-stat { display:flex; justify-content:space-between; align-items:baseline; gap:10px;
  padding:6px 2px; border-bottom:1px solid rgba(255,214,107,.14); }
.qf-victory-stat.wide { grid-column:1 / -1; }
.qf-victory-stat-label { font-size:8px; letter-spacing:1.5px; color:#9a8c6a; }
.qf-victory-stat-value { font-family:'VT323',monospace; font-size:18px; color:#f4e8c8; }
.qf-victory-stat-value.gold { color:#ffd76a; }
.qf-victory-stat-value.slain { color:#ff8a98; }
.qf-victory-unlock { margin:24px auto 0; max-width:560px; padding:13px 18px; border-radius:8px;
  background:linear-gradient(180deg, rgba(120,70,190,.24), rgba(50,26,90,.18));
  border:1px solid rgba(201,139,255,.46); box-shadow:0 0 22px rgba(140,70,230,.32);
  opacity:0; animation:qf-vic-pop2 .7s cubic-bezier(.18,.9,.25,1) 1.25s both; }
.qf-victory-unlock-head { display:flex; align-items:center; justify-content:center; gap:9px;
  font-size:clamp(11px,1.4vw,15px); letter-spacing:3px; color:#d9b8ff;
  text-shadow:0 0 12px rgba(201,139,255,.6); }
.qf-victory-unlock-sub { font-family:'VT323',monospace; font-size:16px; color:#b9a7d4; margin-top:7px; }
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
      h('div', { className: 'qf-victory-card' }, [
        h('div', { className: 'qf-victory-eyebrow' }, 'THE KINGDOM IS BROKEN'),
        h('div', { className: 'qf-victory-title' }, 'VICTORY'),
        h('div', { className: 'qf-victory-sub' }, 'THE RECKONING IS ENDED'),
        h('div', { className: 'qf-victory-flavor' },
          'They sent students, then guilds, then their crowned champion. ' +
          'All of them broke against your dungeon. You reign — eternal.'),
        this._tally(),
        this._unlock(nextTier, freshUnlock),
        h('div', { className: 'qf-victory-actions' }, [
          h('button', { className: 'btn primary', on: { click: () => this._continueEndless() } },
            'CONTINUE · ETERNAL REIGN'),
          h('button', { className: 'btn', on: { click: () => this._returnToMenu() } },
            'RETURN TO MENU'),
        ]),
      ]),
    ])
    stage.appendChild(this._root)
    requestAnimationFrame(() => this._root?.classList.add('show'))
  }

  _stat(label, value, cls = '', wide = false) {
    return h('div', { className: `qf-victory-stat${wide ? ' wide' : ''}` }, [
      h('span', { className: 'qf-victory-stat-label' }, label),
      h('span', { className: `qf-victory-stat-value ${cls}` }, String(value)),
    ])
  }

  _tally() {
    const gs = this._gs
    const t = gs.run?.totals ?? {}
    const act = gs.meta?.act ?? {}
    const days = gs.meta?.dayNumber ?? 40
    const slain = t.advsKilled ?? t.kills ?? 0
    const gold = t.gold ?? 0
    const champs = Object.keys(act.championsDefeated ?? {}).length
    const aldric = gs.meta?.nemesis?.slainByBoss
    const plunder = act._plunderStolen ?? 0
    const responses = Object.keys(act.responses ?? {})
      .sort()
      .map(k => _responseName(act.responses[k]))
      .filter(Boolean)
    const finalForm = `${_archName(gs.player?.bossArchetypeId)} · Ascended`

    const rows = [
      this._stat('DAYS REIGNED', days),
      this._stat('ADVENTURERS SLAIN', slain, 'slain'),
      this._stat('CHAMPIONS FELLED', champs),
      this._stat('GOLD HOARDED', gold, 'gold'),
    ]
    if (plunder > 0) rows.push(this._stat('LOST TO THIEVES', `-${plunder}`, 'gold'))
    rows.push(this._stat('ALDRIC, THE HERO KING', aldric ? 'SLAIN' : 'Held off', 'slain'))
    if (responses.length) rows.push(this._stat('STRATEGIES BROKEN', responses.join(' · '), '', true))
    rows.push(this._stat('YOUR FINAL FORM', finalForm, 'gold', true))
    return h('div', { className: 'qf-victory-tally' }, rows)
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

  // CONTINUE — the run simply keeps going past day 40 (nothing gates it; acts
  // clamp to the final act). meta.act.won already guards a re-fire, so victory
  // won't repeat. Endless reign for the leaderboard.
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

  _fadeOut(after) {
    this._root?.classList.remove('show')
    const el = this._root; this._root = null
    setTimeout(() => { el?.remove(); after?.() }, 600)
  }
}
