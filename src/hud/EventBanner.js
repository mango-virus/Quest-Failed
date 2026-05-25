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

const FADE_IN_MS  = 350
const HOLD_MS     = 7600   // banner stays fully visible for this long before fading
const FADE_OUT_MS = 600

export class EventBanner {
  constructor(gameState) {
    this._gameState   = gameState ?? null
    this._listeners   = []
    this._fadeTimer   = null
    this._removeTimer = null

    this._stage = document.getElementById('hud-stage')
    if (!this._stage) return
    this._build()
    this._wireEvents()
    // A save loaded mid-event won't replay DUNGEON_EVENT_ANNOUNCED — restore
    // the persistent pill from gameState if an event is already running.
    this._restoreActiveEvent()
  }

  _build() {
    this.el = h('div', { className: 'qf-eventbanner' })
    // Persistent status pill. Unlike the banner above — which fades after
    // a few seconds — this stays up for the whole event (announce → end)
    // so the player always knows an event is in effect. Hovering it
    // reveals the tooltip below, explaining what the event does.
    this._pill = h('div', {
      className: 'qf-eventpill',
      on: {
        mouseenter: () => { if (this._activeNotif) this._pillTip?.classList.add('open') },
        mouseleave: () => this._pillTip?.classList.remove('open'),
      },
    }, [
      h('span', { className: 'qf-eventpill-dot' }),
      h('span', { className: 'qf-eventpill-icon' }, ''),
      h('span', { className: 'qf-eventpill-label' }, ''),
    ])
    // Hover tooltip — the active event's "what it does" description.
    this._pillTip = h('div', { className: 'qf-eventpill-tip' })
    this._stage.appendChild(this.el)
    this._stage.appendChild(this._pill)
    this._stage.appendChild(this._pillTip)
  }

  _wireEvents() {
    const sub = (event, fn) => { EventBus.on(event, fn); this._listeners.push([event, fn]) }
    sub('DUNGEON_EVENT_ANNOUNCED', (p) => { this._onAnnounced(p); this._showPill(p?.def) })
    sub('DUNGEON_EVENT_ENDED',     ()  => this._hidePill())
    // A bounty hunter entering gets the transient top banner only — it's a
    // one-off arrival, not a multi-day event, so no persistent pill.
    sub('BOUNTY_HUNTER_ARRIVED',   (p) => this._onBountyHunter(p))
    // Spawn failsafe — the wave failed to arrive (some upstream bug, or a
    // stuck event flag). DayPhase has already shown the all-out timer +
    // rolled the day, but we still want the player to SEE that nothing
    // happened and have the diagnostic context to share when reporting.
    // Uses the same themed slate as a real Dungeon Event.
    sub('SPAWN_FAILSAFE_TRIGGERED', (p) => this._onSpawnFailsafe(p))
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

  // ── Persistent event pill ──────────────────────────────────────────────
  _showPill(def) {
    if (!def || !this._pill) return
    const theme = String(def.colorTheme ?? 'warn')
    this._pill.className = `qf-eventpill qf-eventpill-${theme} open`
    const icon  = this._pill.querySelector('.qf-eventpill-icon')
    const label = this._pill.querySelector('.qf-eventpill-label')
    if (icon)  icon.textContent  = def.icon ?? ''
    if (label) label.textContent = def.title ?? 'DUNGEON EVENT'
    // Stock the hover tooltip with the event's "what it does" blurb.
    this._activeNotif = def.notif ?? ''
    if (this._pillTip) {
      this._pillTip.className = `qf-eventpill-tip qf-eventpill-tip-${theme}`
      this._pillTip.textContent = this._activeNotif
    }
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
    // Reset class list to only carry the theme.
    this.el.className = `qf-eventbanner qf-eventbanner-${theme}`
    // Rebuild the whole slate so every CSS entry animation restarts fresh.
    this.el.replaceChildren(
      h('div', { className: 'qf-eventbanner-card' }, [
        h('span', { className: 'qf-eventbanner-corner tl' }),
        h('span', { className: 'qf-eventbanner-corner tr' }),
        h('span', { className: 'qf-eventbanner-corner bl' }),
        h('span', { className: 'qf-eventbanner-corner br' }),
        h('div',  { className: 'qf-eventbanner-flash' }),
        h('div',  { className: 'qf-eventbanner-inner' }, [
          h('div', { className: 'qf-eventbanner-kicker' }, '◆  DUNGEON EVENT  ◆'),
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

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this._clearTimers()
    this.el?.remove()
    this._pill?.remove()
    this._pillTip?.remove()
  }
}
