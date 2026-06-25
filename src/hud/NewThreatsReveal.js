// NewThreatsReveal (DOM) — the "new adventurer cohort" announcement.
//
// Adventurer classes unlock in 10-day TIERS (see util/classSpawn.js +
// adventurerClasses.json `unlockDay`). The NIGHT BEFORE a new tier's first day
// (i.e. when the upcoming day is 11 / 21 / 31) this card slams up a thematic
// reveal of the new classes — sprite + name + a one-line "what they do" — so the
// player gets the whole build phase to prep for the new threats.
//
// • Day-number triggered → works in BOTH the campaign (acts on) and the endless
//   game (`?acts=0`); the tier days are read from the class data, not hard-coded.
// • Fires ONCE per tier per run (tracked on meta.revealedClassTiers).
// • Reckoning NG+ has the full roster from day 1, so there are no new tiers to
//   reveal — the card never fires there.
// • Sequences AFTER any act / kingdom-response intro card so two set-pieces
//   never stack at the act boundary (days 11/21/31 also start a new act).
//
// Self-mounts into #hud-stage + injects its own CSS once (mirrors ActIntro).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { liveAdventurer } from './inGameSnapshot.js'
import { ensureAdventurerBaseSheet } from '../scenes/AdventurerBaseLoader.js'

// One-line, mechanics-first blurbs for each unlockable class (curated UI copy;
// kept short so the grid stays readable). Falls back to the name alone if a
// class isn't listed.
const CLASS_BLURB = {
  peasant:      'Weak alone — deadlier the more of them swarm.',
  bard:         "Buffs nearby allies' attack and speed with a song.",
  pirate:       'Sprints for your gold; flees with extra plunder.',
  gladiator:    'Grows stronger with every minion he cuts down.',
  monk:         'Lightning-fast — dodges hits and traps, ignores armor.',
  templar:      'Tanky holy knight; heals a mortal wound shut.',
  gambler:      'Every strike rolls the dice — crit, double-hit, payout.',
  barbarian:    'Hits harder the closer to death; never flees.',
  beast_master: 'Tames one of your minions to fight for him.',
  miner:        'Tunnels underground and resurfaces anywhere.',
  cheater:      'RARE — no-clips walls, teleports, lands one-shots.',
  necromancer:  'Raises your fallen minions to fight against you.',
  valkyrie:     'Flies over traps; rallies and revives her allies.',
}

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-newthreats-css')) return
  const style = document.createElement('style')
  style.id = 'qf-newthreats-css'
  style.textContent = `
.qf-ntr { position:absolute; inset:0; z-index:48; pointer-events:auto;
  display:flex; align-items:center; justify-content:center;
  opacity:0; transition:opacity .35s ease; }
.qf-ntr.show { opacity:1; }
.qf-ntr::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 44%, rgba(6,3,10,.82) 24%, rgba(2,1,5,.97) 100%); }
.qf-ntr-card { position:relative; text-align:center;
  font-family:'Press Start 2P','Courier New',monospace; padding:24px 36px;
  max-width:min(92vw,860px); }
.qf-ntr-kicker { font-size:clamp(9px,1.15vw,13px); letter-spacing:7px;
  color:#b03a48; text-shadow:0 0 12px rgba(176,58,72,.7); margin-bottom:14px; }
.qf-ntr-title { font-size:clamp(20px,3vw,40px); letter-spacing:3px;
  color:#ece2d2; text-shadow:0 0 26px rgba(176,58,72,.5), 0 3px 0 #0a0610;
  animation:qf-ntr-pop .6s cubic-bezier(.18,.9,.25,1) both; }
.qf-ntr-rule { width:0; height:2px; margin:16px auto 14px;
  background:linear-gradient(90deg, transparent, #b03a48, transparent);
  animation:qf-ntr-rule .8s ease-out .25s forwards; }
.qf-ntr-tag { font-family:'VT323',monospace; font-size:clamp(13px,1.5vw,19px);
  letter-spacing:1px; color:#9aa7b4; max-width:600px; margin:0 auto 22px; line-height:1.5;
  opacity:0; animation:qf-ntr-fade .6s ease .45s forwards; }
.qf-ntr-grid { display:flex; flex-wrap:wrap; gap:14px; justify-content:center;
  margin:0 auto; }
.qf-ntr-entry { display:flex; align-items:center; gap:12px; text-align:left;
  width:min(380px,86vw); padding:10px 14px; border-radius:8px;
  background:rgba(18,12,22,.72); border:1px solid rgba(176,58,72,.32);
  box-shadow:inset 0 0 18px rgba(0,0,0,.45);
  opacity:0; transform:translateY(8px); animation:qf-ntr-rise .5s ease both; }
.qf-ntr-portrait { flex:0 0 auto; width:56px; height:56px; border-radius:6px;
  display:flex; align-items:center; justify-content:center;
  background:radial-gradient(circle at 50% 35%, #2a2030, #120c18);
  border:1px solid rgba(180,150,90,.35); overflow:hidden; }
.qf-ntr-portrait canvas, .qf-ntr-portrait img { width:52px; height:52px; image-rendering:pixelated; }
.qf-ntr-portrait .qf-ntr-fallback { font-size:20px; color:#ece2d2;
  font-family:'Press Start 2P',monospace; text-shadow:0 1px 0 #000; }
.qf-ntr-info { flex:1 1 auto; min-width:0; }
.qf-ntr-name { font-family:'Press Start 2P',monospace; font-size:11px; letter-spacing:1px;
  color:#f0e6d4; margin-bottom:5px; }
.qf-ntr-blurb { font-family:'VT323',monospace; font-size:15px; line-height:1.32;
  color:#a7b2bd; }
.qf-ntr-entry.rare { border-color:rgba(120,70,200,.55); }
.qf-ntr-entry.rare .qf-ntr-name { color:#c9a7ff; }
.qf-ntr-actions { margin-top:24px; opacity:0;
  animation:qf-ntr-fade .6s ease .7s forwards; }
.qf-ntr-actions .btn { font-size:13px; }
.qf-ntr-hint { margin-top:11px; font-size:9px; letter-spacing:3px; color:#6f6757; }
@keyframes qf-ntr-pop { 0%{opacity:0; transform:scale(.72); filter:blur(6px)}
  60%{opacity:1; transform:scale(1.04); filter:blur(0)} 100%{opacity:1; transform:scale(1)} }
@keyframes qf-ntr-rule { from{width:0} to{width:min(58vw,400px)} }
@keyframes qf-ntr-fade { from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:translateY(0)} }
@keyframes qf-ntr-rise { from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:translateY(0)} }`
  document.head.appendChild(style)
}

// Selectors for the set-piece intro cards that may already be up at an act
// boundary — we hold our reveal until they clear so two cards never stack.
const BLOCKING_INTROS = '.qf-actintro, .qf-kri, .qf-ascension'

export class NewThreatsReveal {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._timers = []
    this._keyFn = null
    _ensureCss()
    EventBus.on('NIGHT_PHASE_STARTED', this._onNight, this)
  }

  destroy() {
    EventBus.off('NIGHT_PHASE_STARTED', this._onNight, this)
    this._clearTimers()
    this._cleanupKey()
    this._root?.remove(); this._root = null
  }

  _clearTimers() { for (const t of this._timers) clearTimeout(t); this._timers = [] }
  _cleanupKey() {
    if (this._keyFn) { window.removeEventListener('keydown', this._keyFn, { capture: true }); this._keyFn = null }
  }

  // Distinct tier-start days (>1) present in the class data — e.g. [11,21,31].
  _tierDays(allClasses) {
    const days = new Set()
    for (const c of allClasses) {
      if (!c || (c.unlockLevel ?? 1) >= 99) continue   // event-only excluded
      const d = c.unlockDay ?? 1
      if (d > 1) days.add(d)
    }
    return days
  }

  _onNight() {
    const gs = this._gs
    const meta = gs?.meta
    if (!meta) return
    // NG+ unlocks the full roster from day 1 → nothing new ever "arrives".
    if ((meta.reckoningTier ?? 0) > 0) return
    const day = meta.dayNumber ?? 1
    const game = window.__game?.scene?.getScene?.('Game')
    const allClasses = game?.cache?.json?.get?.('adventurerClasses')
                    ?? window.__game?.scene?.scenes?.map(s => s.cache?.json?.get?.('adventurerClasses')).find(Array.isArray)
    if (!Array.isArray(allClasses) || !allClasses.length) return
    if (!this._tierDays(allClasses).has(day)) return     // not a tier boundary

    const revealed = Array.isArray(meta.revealedClassTiers) ? meta.revealedClassTiers : []
    if (revealed.includes(day)) return                   // already shown this run
    const newClasses = allClasses.filter(c =>
      c && (c.unlockLevel ?? 1) < 99 && (c.unlockDay ?? 1) === day)
    if (!newClasses.length) return

    // Mark shown (persisted on meta) before any async wait so a fast save can't
    // double-fire it.
    meta.revealedClassTiers = [...revealed, day]

    // Warm the new cohort's sprite sheets so the portraits are real, not boxes.
    if (game) for (const c of newClasses) {
      try { ensureAdventurerBaseSheet(game, c.id, 'v01') } catch (e) {}
    }

    // Hold the reveal until any act / kingdom-response / ascension set-piece has
    // been READ AND DISMISSED — and never slam it up in the race window BEFORE
    // that card has even mounted. The old code only checked "is a card up right
    // now?", so if the reveal's first poll landed a beat before the act card
    // mounted, it would show underneath/over it. Now we track whether we've SEEN
    // a blocking intro: while one is up we wait; once we've seen one and it's
    // gone, the player pressed continue, so we show. If no card ever appears
    // (endless mode / a non-boundary night), a short grace window shows promptly.
    const t0 = Date.now()
    let sawIntro = false
    const ready = () => {
      if (document.querySelector(BLOCKING_INTROS)) {       // a set-piece card is up → wait it out
        sawIntro = true
        this._timers.push(setTimeout(ready, 200))
        return
      }
      const waited = Date.now() - t0
      const introCleared = sawIntro || waited > 2000        // dismissed, or no card was coming
      const spritesIn = newClasses.every(c => window.__game?.textures?.exists?.(`adv-${c.id}-v01`))
      if ((introCleared && spritesIn) || waited > 12000) { this._show(newClasses, day); return }
      this._timers.push(setTimeout(ready, 200))
    }
    this._timers.push(setTimeout(ready, 350))
  }

  _entry(cls) {
    const portrait = h('div', { className: 'qf-ntr-portrait' })
    const snap = (() => { try { return liveAdventurer(cls.id, 52, 'v01') } catch (e) { return null } })()
    if (snap) {
      portrait.appendChild(snap)
    } else {
      // Fallback — the class's first initial on its theme color.
      const color = (typeof cls.color === 'string') ? cls.color.replace('0x', '#') : '#b03a48'
      const fb = h('div', { className: 'qf-ntr-fallback' }, (cls.name || cls.id || '?').charAt(0).toUpperCase())
      fb.style.color = color
      portrait.appendChild(fb)
    }
    const isRare = (cls.spawnWeight ?? 1) < 0.25
    return h('div', { className: 'qf-ntr-entry' + (isRare ? ' rare' : '') }, [
      portrait,
      h('div', { className: 'qf-ntr-info' }, [
        h('div', { className: 'qf-ntr-name' }, (cls.name || cls.id || '').toUpperCase()),
        h('div', { className: 'qf-ntr-blurb' }, CLASS_BLURB[cls.id] || cls.flavorText || ''),
      ]),
    ])
  }

  _show(newClasses, day) {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._clearTimers()
    this._root?.remove()

    const entries = newClasses.map((c, i) => {
      const el = this._entry(c)
      el.style.animationDelay = (0.55 + i * 0.09).toFixed(2) + 's'
      return el
    })

    this._root = h('div', { className: 'qf-ntr' }, [
      h('div', { className: 'qf-ntr-card' }, [
        h('div', { className: 'qf-ntr-kicker' }, 'WORD OF YOUR REIGN SPREADS'),
        h('div', { className: 'qf-ntr-title' }, 'NEW THREATS EMERGE'),
        h('div', { className: 'qf-ntr-rule' }),
        h('div', { className: 'qf-ntr-tag' },
          `Emboldened by tales of your dungeon, a new breed of adventurer joins the hunt. Come dawn on Day ${day}, these foes march on your halls — know them.`),
        h('div', { className: 'qf-ntr-grid' }, entries),
        h('div', { className: 'qf-ntr-actions' }, [
          h('button', { className: 'btn primary', on: { click: () => this._dismiss() } }, 'STEEL THE DUNGEON'),
          h('div', { className: 'qf-ntr-hint' }, 'PRESS ANY KEY'),
        ]),
      ]),
    ])
    this._root.addEventListener('click', (e) => {
      if (e.target === this._root || e.target.classList?.contains('qf-ntr-card') ||
          e.target.classList?.contains('qf-ntr-grid')) this._dismiss()
    })
    stage.appendChild(this._root)

    this._timers.push(setTimeout(() => this._root?.classList.add('show'), 30))
    this._keyFn = (e) => { e.preventDefault(); e.stopPropagation(); this._dismiss() }
    window.addEventListener('keydown', this._keyFn, { capture: true, once: true })
  }

  _dismiss() {
    if (!this._root) return
    this._clearTimers()
    this._cleanupKey()
    EventBus.emit('NEW_THREATS_DISMISSED')
    this._root.classList.remove('show')
    const el = this._root; this._root = null
    setTimeout(() => el?.remove(), 350)
  }
}
