// EventBanner (DOM) — cinematic Dungeon Event announcement slate.
//
// Top-of-screen themed slate announcing a Dungeon Event during night
// phase. Listens for `DUNGEON_EVENT_ANNOUNCED { def }` and renders
// `def.icon` + `def.title` + `def.notif` in a per-theme colour palette.
//
// The slate slams in with a flash, a rotating conic glow ring, animated
// corner brackets, a wiping divider and a fade-up effect line — all
// CSS-driven (see styles.css `qf-eb-*` keyframes). Theme keys match the
// events.json `colorTheme` field (warn / accent / soul / gold / green /
// blue / violet / bone / ember / toxic / rose / shadow / arcane /
// crimson).
//
// Sits just below the new HUD's TopBar. A second announcement while one
// is showing bumps the current banner immediately. A persistent pill
// stays up for the whole event with a hover tooltip.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

// Solo Leveling — the 'shadowmonarch' banner theme: a black↔blue SWEEPING
// gradient instead of the static violet palette. Injected once at runtime so
// it lives alongside the other themes without editing styles.css.
function _ensureShadowMonarchBannerCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-sl-eventbanner-css')) return
  const style = document.createElement('style')
  style.id = 'qf-sl-eventbanner-css'
  style.textContent = `
.qf-eventbanner.qf-eventbanner-shadowmonarch,
.qf-eventpill.qf-eventpill-shadowmonarch,
.qf-eventpill-tip.qf-eventpill-tip-shadowmonarch {
  --ev-accent:#3a8bff; --ev-bg:#08121f; --ev-deep:#02060e;
  --ev-text:#bfe0ff; --ev-sub:#dcecff;
}
.qf-eventbanner-shadowmonarch .qf-eventbanner-inner {
  background: linear-gradient(110deg,
    #02060e 0%, #061226 15%, #1f5fd0 37%, #5aa8ff 50%, #1f5fd0 63%, #061226 85%, #02060e 100%);
  background-size: 300% 100%;
  animation: qf-sl-banner-sweep 3.2s linear infinite;
}
.qf-eventpill.qf-eventpill-shadowmonarch {
  background: linear-gradient(110deg, #02060e, #0a1b38 45%, #1f5fd0 50%, #0a1b38 55%, #02060e);
  background-size: 280% 100%;
  animation: qf-sl-banner-sweep 3.2s linear infinite;
}
@keyframes qf-sl-banner-sweep {
  0%   { background-position: 0% 50%; }
  100% { background-position: 300% 50%; }
}`
  document.head.appendChild(style)
}

// Light Party — the 'lightparty' banner theme: a sweeping DARK-gold gradient
// with a bright gold highlight band (FFXIV's heroic "Warriors of Light" accent).
// Mirrors shadowmonarch's dark-blue sweep so both boss events share the same
// animated treatment — and, crucially, the same DARK background register as
// every other event slate (the old bright white/cream fill made this one stand
// out as the only light-coloured notification). Injected once at runtime so it
// lives alongside the other themes without editing styles.css.
function _ensureLightPartyBannerCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-lp-eventbanner-css')) return
  const style = document.createElement('style')
  style.id = 'qf-lp-eventbanner-css'
  style.textContent = `
.qf-eventbanner.qf-eventbanner-lightparty,
.qf-eventpill.qf-eventpill-lightparty,
.qf-eventpill-tip.qf-eventpill-tip-lightparty {
  --ev-accent:#ffd66b; --ev-bg:#221903; --ev-deep:#0f0b01;
  --ev-text:#ffe27a; --ev-sub:#f2e2b0;
}
.qf-eventbanner-lightparty .qf-eventbanner-inner {
  background: linear-gradient(110deg,
    #0e0a01 0%, #1d1503 15%, #7a5e16 37%, #e8c14a 50%, #7a5e16 63%, #1d1503 85%, #0e0a01 100%);
  background-size: 300% 100%;
  animation: qf-lp-banner-sweep 3.2s linear infinite;
}
.qf-eventpill.qf-eventpill-lightparty {
  background: linear-gradient(110deg, #0e0a01, #2a2006 45%, #e8c14a 50%, #2a2006 55%, #0e0a01);
  background-size: 280% 100%;
  animation: qf-lp-banner-sweep 3.2s linear infinite;
}
@keyframes qf-lp-banner-sweep {
  0%   { background-position: 0% 50%; }
  100% { background-position: 300% 50%; }
}`
  document.head.appendChild(style)
}

// Damned-grimoire curse banner theme: pure black slate with blood-red accents,
// distinct from the dark-red 'crimson' event theme. Used by the damned-pact
// curse notifications (e.g. The Insomniac's no-build night). Injected once at
// runtime so it lives alongside the other themes without editing styles.css.
function _ensureDamnedBannerCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-damned-eventbanner-css')) return
  const style = document.createElement('style')
  style.id = 'qf-damned-eventbanner-css'
  style.textContent = `
.qf-eventbanner.qf-eventbanner-damned,
.qf-eventpill.qf-eventpill-damned,
.qf-eventpill-tip.qf-eventpill-tip-damned {
  --ev-accent:#e01225; --ev-bg:#0a0406; --ev-deep:#030101;
  --ev-text:#ff5560; --ev-sub:#f0bdc0;
}
/* Persistent pills live in a centered flex row so the active-event pill and
   the no-build curse pill sit side-by-side, the PAIR centered — instead of
   both stacking at dead-centre. A single visible pill stays centered alone. */
.qf-eventpill-row {
  position: absolute; left: 50%; top: 132px; transform: translateX(-50%);
  display: flex; gap: 8px; align-items: center; z-index: 7; pointer-events: none;
}
.qf-eventpill-row .qf-eventpill { position: static; left: auto; top: auto; transform: none; }`
  document.head.appendChild(style)
}

// Boss-tier overlay (2026-05-29): events with `eventTier: 'boss'` get an
// additional gold layer on top of whatever colorTheme they use — heavier
// corner brackets + a kicker bump (`◆ BOSS EVENT ◆`), a soft inner-panel
// shake on slam-in, and a "BOSS" chip + ambient pulse on the persistent pill.
// Pure CSS overlay so it stacks cleanly on shadowmonarch (or any future theme).
function _ensureBossTierBannerCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-boss-eventbanner-css')) return
  const style = document.createElement('style')
  style.id = 'qf-boss-eventbanner-css'
  style.textContent = `
/* Banner — bigger gold L-brackets at the four corners (override the
   per-theme accent + size from .qf-eventbanner-corner). */
.qf-eventbanner.qf-eventbanner-boss .qf-eventbanner-corner {
  width: 22px; height: 22px;
  border-width: 3px;
  border-color: #ffcb5c;
  filter: drop-shadow(0 0 7px #ffcb5cbb);
}
/* Kicker — recolour to gold + extra tracking so "◆ BOSS EVENT ◆" reads
   as a tier label, not flavour text. */
.qf-eventbanner.qf-eventbanner-boss .qf-eventbanner-kicker {
  color: #ffcb5c;
  text-shadow: 0 0 6px #ffcb5c99, 0 0 14px #ffcb5c44;
  letter-spacing: 0.22em;
}
/* Soft slam-in shake on the INNER panel — the outer card keeps its own
   slam + glow animations (see .qf-eventbanner.open .qf-eventbanner-card). */
@keyframes qf-evb-boss-shake {
  0%   { transform: translate(0, 0); }
  14%  { transform: translate(-4px, 1px); }
  28%  { transform: translate(4px, -1px); }
  42%  { transform: translate(-3px, 1px); }
  56%  { transform: translate(3px, -1px); }
  70%  { transform: translate(-2px, 0); }
  84%  { transform: translate(2px, 0); }
  100% { transform: translate(0, 0); }
}
.qf-eventbanner.qf-eventbanner-boss.open .qf-eventbanner-inner {
  animation: qf-evb-boss-shake 360ms ease-out 1 both;
}

/* Pill — ambient gold pulse + a "BOSS" chip stitched to the top centre.
   Selector is scoped under .qf-eventpill-row so it outweighs the damned
   injector's "qf-eventpill-row qf-eventpill { position: static }" rule
   (equal-class injectors load order otherwise wins the cascade). The
   position:relative makes the pill the containing block for the chip
   so left:50% + translateX(-50%) centres against THE PILL, not the row. */
.qf-eventpill-row .qf-eventpill.qf-eventpill-boss {
  position: relative;
  animation: qf-evp-boss-pulse 2400ms ease-in-out infinite;
}
@keyframes qf-evp-boss-pulse {
  0%, 100% { box-shadow: 0 0 8px #ffcb5c44, inset 0 0 0 1px #ffcb5c66; }
  50%      { box-shadow: 0 0 18px #ffcb5cbb, inset 0 0 0 1px #ffcb5caa; }
}
.qf-eventpill.qf-eventpill-boss::after {
  content: 'BOSS';
  position: absolute;
  /* Anchor the chip's BOTTOM to the pill's TOP — so the whole chip sits ABOVE
     the pill regardless of its height (no overlap). 4px gap is the breathing
     room between chip and pill. */
  top: auto;
  bottom: 100%;
  margin-bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 6px 0;
  background: #ffcb5c;
  color: #1a0f04;
  font: 700 9px/12px 'JetBrains Mono', monospace;
  letter-spacing: 0.14em;
  border-radius: 2px;
  box-shadow: 0 0 6px #ffcb5caa;
  pointer-events: none;
}`
  document.head.appendChild(style)
}

const FADE_IN_MS  = 350
const HOLD_MS     = 7600   // banner stays fully visible for this long before fading
const FADE_OUT_MS = 600

// Hover blurb for the no-build curse pill — mirrors how an event pill explains
// itself on hover.
const LOCK_PILL_NOTIF =
  'The Insomniac — a curse from the damned grimoire. The dungeon is sealed tonight: nothing may be placed, sold, or moved.'

export class EventBanner {
  constructor(gameState) {
    this._gameState   = gameState ?? null
    this._listeners   = []
    this._fadeTimer   = null
    this._removeTimer = null

    this._stage = document.getElementById('hud-stage')
    if (!this._stage) return
    _ensureShadowMonarchBannerCss()
    _ensureLightPartyBannerCss()
    _ensureBossTierBannerCss()
    _ensureDamnedBannerCss()
    this._build()
    this._wireEvents()
    // A save loaded mid-event won't replay DUNGEON_EVENT_ANNOUNCED — restore
    // the persistent pill from gameState if an event is already running.
    this._restoreActiveEvent()
  }

  _build() {
    this.el = h('div', { className: 'qf-eventbanner' })
    // Centered flex row holding the persistent pills. Both the active-event
    // pill and the no-build curse pill live here, so when both are up they sit
    // side-by-side with the pair centered (a single one stays centered alone).
    this._pillRow = h('div', { className: 'qf-eventpill-row' })
    // Persistent status pill. Unlike the banner above — which fades after
    // a few seconds — this stays up for the whole event (announce → end)
    // so the player always knows an event is in effect. Hovering it
    // reveals the tooltip below, explaining what the event does.
    this._pill = h('div', {
      className: 'qf-eventpill',
      on: {
        mouseenter: () => this._openTip(this._activeTheme ?? 'warn', this._activeNotif),
        mouseleave: () => this._closeTip(),
      },
    }, [
      h('span', { className: 'qf-eventpill-dot' }),
      h('span', { className: 'qf-eventpill-icon' }, ''),
      h('span', { className: 'qf-eventpill-label' }, ''),
    ])
    // No-build curse pill (damned black+red). Toggled open for the whole
    // locked night (INSOMNIAC_LOCKED → DAY_PHASE_BEGAN) alongside any event.
    // Hovering it shows its own info in the shared tooltip, just like events.
    this._lockPill = h('div', {
      className: 'qf-eventpill qf-eventpill-damned',
      on: {
        mouseenter: () => this._openTip('damned', LOCK_PILL_NOTIF),
        mouseleave: () => this._closeTip(),
      },
    }, [
      h('span', { className: 'qf-eventpill-dot' }),
      h('span', { className: 'qf-eventpill-icon' }, '☽'),
      h('span', { className: 'qf-eventpill-label' }, 'NO BUILDING'),
    ])
    this._pillRow.appendChild(this._pill)
    this._pillRow.appendChild(this._lockPill)
    // Hover tooltip — the active event's "what it does" description.
    this._pillTip = h('div', { className: 'qf-eventpill-tip' })
    this._stage.appendChild(this.el)
    this._stage.appendChild(this._pillRow)
    this._stage.appendChild(this._pillTip)
  }

  _wireEvents() {
    const sub = (event, fn) => { EventBus.on(event, fn); this._listeners.push([event, fn]) }
    sub('DUNGEON_EVENT_ANNOUNCED', (p) => { this._onAnnounced(p); this._showPill(p?.def) })
    sub('DUNGEON_EVENT_ENDED',     ()  => this._hidePill())
    // Hide the whole persistent-pill row for the duration of the Light Party
    // boss duel (+ its outro) so the event chip doesn't sit over the cinematic,
    // then restore it when the duel resolves.
    sub('LIGHT_PARTY_DUEL_BEGAN',  ()  => { if (this._pillRow) this._pillRow.style.display = 'none' })
    sub('LIGHT_PARTY_DUEL_END',    ()  => { if (this._pillRow) this._pillRow.style.display = '' })
    // DAMNED · The Insomniac — persistent no-build pill, up for the whole
    // locked night so it can sit beside an active-event pill. Shown on the
    // lock (night start), cleared when the build phase ends (day begins).
    sub('INSOMNIAC_LOCKED',        ()  => this._lockPill?.classList.add('open'))
    sub('DAY_PHASE_BEGAN',         ()  => this._lockPill?.classList.remove('open'))
    // A bounty hunter entering gets the transient top banner only — it's a
    // one-off arrival, not a multi-day event, so no persistent pill.
    sub('BOUNTY_HUNTER_ARRIVED',   (p) => this._onBountyHunter(p))
    // Spawn failsafe — the wave failed to arrive (some upstream bug, or a
    // stuck event flag). DayPhase has already shown the all-out timer +
    // rolled the day, but we still want the player to SEE that nothing
    // happened and have the diagnostic context to share when reporting.
    // Uses the same themed slate as a real Dungeon Event.
    sub('SPAWN_FAILSAFE_TRIGGERED', (p) => this._onSpawnFailsafe(p))
    // Generic HUD banner — any system can fire this with
    // { title, notif, icon, colorTheme, kicker? } and get the same
    // event-banner slam-in slate. Used by BossFightOverlay for fight
    // intro / result and by the phylactery hooks below.
    sub('HUD_BANNER',              (p) => this._onAnnounced({ def: p ?? {} }))
    // A cinematic boss-vs-boss duel takes over the top-centre zone with its own
    // HUD — force-close any lingering slam-in banner (e.g. the champion-arrival
    // slate) so it doesn't sit under the duel's dominance bar.
    sub('RIVAL_DUEL_BEGAN',        ()  => this._forceClose())
    sub('ALDRIC_DUEL_BEGAN',       ()  => this._forceClose())
    // Phylactery flavor banners — Lich-specific run beats that deserve
    // the same cinematic weight as a Dungeon Event.
    sub('PHYLACTERY_DESTROYED',    ()  => this._onPhylacteryDestroyed())
    sub('PHYLACTERY_REVIVED_BOSS', ()  => this._onPhylacteryRevive())
  }

  _onBountyHunter({ minion } = {}) {
    const name = minion?.name || 'your most-wanted minion'
    this._onAnnounced({ def: {
      title: 'BOUNTY HUNTER',
      notif: `A bounty hunter has entered the dungeon to slay ${name}.`,
      icon: '🎯',
      colorTheme: 'ember',
    } })
  }

  _onSpawnFailsafe({ day, bossLevel, entryHalls, activeEventFlags } = {}) {
    const flags = Array.isArray(activeEventFlags) && activeEventFlags.length
      ? activeEventFlags.join(', ')
      : 'none'
    this._onAnnounced({ def: {
      title: 'AN UNQUIET REST DAY',
      notif: `No wave arrived. Day ${day ?? '?'} · Boss Lv ${bossLevel ?? '?'} · Entry Halls: ${entryHalls ?? '?'} · Active events: ${flags}`,
      icon: '☾',
      colorTheme: 'violet',
    } })
  }

  _onPhylacteryDestroyed() {
    this._onAnnounced({ def: {
      title:  'PHYLACTERY DESTROYED',
      notif:  "The lich's heart is shattered. One more death and the run is over.",
      icon:   '💔',
      colorTheme: 'soul',
      kicker: '◆  DARK OMEN  ◆',
    } })
  }

  _onPhylacteryRevive() {
    this._onAnnounced({ def: {
      title:  'LICH REVIVES',
      notif:  'The phylactery burns a charge — the lich rises again.',
      icon:   '💀',
      colorTheme: 'violet',
      kicker: '◆  UNDEATH RENEWED  ◆',
    } })
  }

  // Shared hover tooltip — populated per-pill on mouseenter so whichever pill
  // is hovered shows its own blurb + theme. `text` falsy → no-op (an event pill
  // with no notif, or before an event is active).
  _openTip(theme, text) {
    if (!this._pillTip || !text) return
    this._pillTip.className   = `qf-eventpill-tip qf-eventpill-tip-${theme} open`
    this._pillTip.textContent = text
  }
  _closeTip() { this._pillTip?.classList.remove('open') }

  // ── Persistent event pill ──────────────────────────────────────────────
  _showPill(def) {
    if (!def || !this._pill) return
    const theme = String(def.colorTheme ?? 'warn')
    const isBoss = def.eventTier === 'boss'
    this._pill.className = `qf-eventpill qf-eventpill-${theme}${isBoss ? ' qf-eventpill-boss' : ''} open`
    const icon  = this._pill.querySelector('.qf-eventpill-icon')
    const label = this._pill.querySelector('.qf-eventpill-label')
    if (icon)  icon.textContent  = def.icon ?? ''
    if (label) label.textContent = def.title ?? 'DUNGEON EVENT'
    // Stock the hover-tooltip state — the actual tip is filled in on hover via
    // _openTip (so it shows whichever pill the player is pointing at).
    this._activeNotif = def.notif ?? ''
    this._activeTheme = theme
  }

  _hidePill() {
    this._pill?.classList.remove('open')
    this._pillTip?.classList.remove('open')
    this._activeNotif = null
  }

  // Re-show the pill for an already-running event after a HUD rebuild
  // (new run / save load). gameState.events.scheduledId holds the active
  // event id; the def is looked up from the events JSON cache.
  _restoreActiveEvent() {
    // A save loaded mid-locked-night won't replay INSOMNIAC_LOCKED — restore
    // the no-build pill straight from the flag (cleared at dawn, so a truthy
    // value means we're sitting in the locked build phase).
    if (this._gameState?._mechanicFlags?.insomniacLockTonight) {
      this._lockPill?.classList.add('open')
    }
    const id = this._gameState?.events?.scheduledId
    if (!id) return
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const defs = s.cache?.json?.get?.('events')
      if (!Array.isArray(defs)) continue
      const def = defs.find(d => d?.id === id)
      if (def) { this._showPill(def); return }
    }
  }

  _onAnnounced({ def } = {}) {
    if (!def || !this.el) return
    // Bump any in-flight banner immediately so the new one isn't queued
    // behind a stale fade-out.
    this._clearTimers()
    this.el.classList.remove('open', 'fading')

    const theme = String(def.colorTheme ?? 'warn')
    const isBoss = def.eventTier === 'boss'
    // Reset class list to only carry the theme (+ boss-tier overlay when set).
    this.el.className = `qf-eventbanner qf-eventbanner-${theme}${isBoss ? ' qf-eventbanner-boss' : ''}`
    // Rebuild the whole slate so every CSS entry animation restarts fresh.
    this.el.replaceChildren(
      h('div', { className: 'qf-eventbanner-card' }, [
        h('span', { className: 'qf-eventbanner-corner tl' }),
        h('span', { className: 'qf-eventbanner-corner tr' }),
        h('span', { className: 'qf-eventbanner-corner bl' }),
        h('span', { className: 'qf-eventbanner-corner br' }),
        h('div',  { className: 'qf-eventbanner-flash' }),
        h('div',  { className: 'qf-eventbanner-inner' }, [
          h('div', { className: 'qf-eventbanner-kicker' },
            def.kicker ?? (isBoss ? '◆  BOSS EVENT  ◆' : '◆  DUNGEON EVENT  ◆')),
          h('div', { className: 'qf-eventbanner-row' }, [
            def.icon ? h('span', { className: 'qf-eventbanner-icon' }, def.icon) : null,
            h('div', { className: 'qf-eventbanner-title' }, def.title ?? ''),
          ].filter(Boolean)),
          h('div', { className: 'qf-eventbanner-rule' }),
          h('div', { className: 'qf-eventbanner-sub' }, def.notif ?? ''),
        ]),
      ]),
    )
    // Force a reflow so the open animation runs after the class swap.
    // eslint-disable-next-line no-unused-expressions
    this.el.offsetHeight
    this.el.classList.add('open')

    this._fadeTimer = setTimeout(() => {
      this.el.classList.add('fading')
      this._removeTimer = setTimeout(() => {
        this.el.classList.remove('open', 'fading')
        this._fadeTimer = null
        this._removeTimer = null
      }, FADE_OUT_MS)
    }, FADE_IN_MS + HOLD_MS)
  }

  _clearTimers() {
    if (this._fadeTimer)   { clearTimeout(this._fadeTimer);   this._fadeTimer   = null }
    if (this._removeTimer) { clearTimeout(this._removeTimer); this._removeTimer = null }
  }

  // Immediately fade out any showing banner (used when a duel cinematic claims the
  // top zone). No-op if nothing is open.
  _forceClose() {
    if (!this.el || !this.el.classList.contains('open')) return
    this._clearTimers()
    this.el.classList.add('fading')
    this._removeTimer = setTimeout(() => {
      this.el.classList.remove('open', 'fading')
      this._removeTimer = null
    }, FADE_OUT_MS)
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this._clearTimers()
    this.el?.remove()
    this._pillRow?.remove()   // removes both the event pill + the no-build pill
    this._pillTip?.remove()
  }
}
