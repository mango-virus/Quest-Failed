// BossArchetypeStrip — DOM port of the Phaser BossArchetypeUI's action
// buttons (EARTHQUAKE / SACRIFICE). The Phaser file owns ~500 lines of
// archetype VFX (charm rings, blood-tax beams, sacrifice flames, etc)
// that fire on world-space events — that part keeps working through
// the Phaser canvas regardless of the HUD layer. This module only
// replaces the player-facing buttons so the chrome stops mismatching.
//
// Buttons live INSIDE the BottomBar (in `BottomBar._refs.archetypeSlot`
// next to the speed buttons) so they don't float above the bar and
// cover the dungeon view. Only render during DAY phase and only for
// archetypes that have an action (golem / demon today).
//
// Emits the same EventBus events the Phaser version did:
//   GOLEM_EARTHQUAKE_ARM    (button press)
//   GOLEM_EARTHQUAKE_DISARM (button press while armed)
//   DEMON_SACRIFICE_ARM
//   DEMON_SACRIFICE_DISARM
//
// Subscribes to the *_ARMED / *_DISARMED / *_FIRED echoes so the label
// flips to "PICK A ROOM" / "PICK A MINION" without round-tripping
// through the Phaser button code.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class BossArchetypeStrip {
  constructor(gameState, opts = {}) {
    this._gs        = gameState
    this._listeners = []
    this._golemArmed = false
    this._demonArmed = false
    // Mount point — provided by HudRoot (BottomBar's slot ref). Falls
    // back to a floating strip on #hud-stage if no slot exists (e.g.
    // BottomBar hasn't built yet).
    this._slot = opts.slot || null

    this._build()
    if (!this._slot) {
      const stage = document.getElementById('hud-stage')
      stage?.appendChild(this.el)
    } else {
      this._slot.appendChild(this.el)
    }
    this._wireEvents()
    this._refresh()
  }

  _build() {
    // Buttons live inside an inline wrapper. CSS handles position/sizing
    // — the wrapper just keeps them grouped so we can show/hide the
    // whole strip in one classList toggle.
    this.el = h('div', { className: 'qf-archstrip' }, [
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-earthquake',
        ref: el => { this._golemBtn = el },
        on: { click: () => this._onGolemClick() },
      }, 'EARTHQUAKE'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-sacrifice',
        ref: el => { this._demonBtn = el },
        on: { click: () => this._onDemonClick() },
      }, 'SACRIFICE'),
    ])
  }

  _wireEvents() {
    const sub = (event, fn) => { EventBus.on(event, fn); this._listeners.push([event, fn]) }
    // Phase changes — toggle visibility + enabled state.
    sub('NIGHT_PHASE_BEGAN', () => this._refresh())
    sub('DAY_PHASE_BEGAN',   () => this._refresh())
    sub('NIGHT_PHASE_STARTED', () => this._refresh())
    // Echo events from BossArchetypeSystem update our armed labels.
    sub('GOLEM_EARTHQUAKE_ARMED',    () => { this._golemArmed = true;  this._refresh() })
    sub('GOLEM_EARTHQUAKE_DISARMED', () => { this._golemArmed = false; this._refresh() })
    sub('GOLEM_EARTHQUAKE_FIRED',    () => { this._golemArmed = false; this._refresh() })
    sub('DEMON_SACRIFICE_ARMED',     () => { this._demonArmed = true;  this._refresh() })
    sub('DEMON_SACRIFICE_DISARMED',  () => { this._demonArmed = false; this._refresh() })
    sub('DEMON_SACRIFICE_FIRED',     () => { this._demonArmed = false; this._refresh() })
    // Minion roster changes can flip the sacrifice button's enabled state.
    sub('MINION_PLACED',  () => this._refresh())
    sub('MINION_REMOVED', () => this._refresh())
    sub('MINION_DIED',    () => this._refresh())
  }

  _onGolemClick() {
    if (this._golemBtn?.disabled) return
    EventBus.emit(this._golemArmed ? 'GOLEM_EARTHQUAKE_DISARM' : 'GOLEM_EARTHQUAKE_ARM')
  }

  _onDemonClick() {
    if (this._demonBtn?.disabled) return
    EventBus.emit(this._demonArmed ? 'DEMON_SACRIFICE_DISARM' : 'DEMON_SACRIFICE_ARM')
  }

  _refresh() {
    if (!this.el) return
    const phase    = this._gs?.meta?.phase
    const isDay    = phase === 'day'
    const archId   = this._gs?.player?.bossArchetypeId
    const isGolem  = archId === 'golem'
    const isDemon  = archId === 'demon'
    const golemActive = isGolem && isDay
    const demonActive = isDemon && isDay

    const anyActive = golemActive || demonActive
    this.el.classList.toggle('open', !!anyActive)
    // Let the slot's parent (BottomBar) know whether to leave a gap.
    if (this._slot) this._slot.classList.toggle('has-buttons', !!anyActive)

    if (this._golemBtn) {
      this._golemBtn.style.display = golemActive ? '' : 'none'
      this._golemBtn.classList.toggle('armed', !!this._golemArmed)
      this._golemBtn.textContent = this._golemArmed ? 'PICK A ROOM' : 'EARTHQUAKE'
      const usesLeft = this._gs?.boss?._golem?.earthquakeUsesLeft ?? 0
      this._golemBtn.disabled = !(usesLeft > 0)
    }
    if (this._demonBtn) {
      this._demonBtn.style.display = demonActive ? '' : 'none'
      this._demonBtn.classList.toggle('armed', !!this._demonArmed)
      this._demonBtn.textContent = this._demonArmed ? 'PICK A MINION' : 'SACRIFICE'
      const usesLeft = this._gs?.boss?._demon?.sacrificeUsesLeft
                    ?? this._gs?._demon?.sacrificeUsesLeft ?? 0
      const haveMinion = (this._gs?.minions ?? []).some(m =>
        m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && m.faction === 'dungeon')
      this._demonBtn.disabled = !(usesLeft > 0 && haveMinion)
    }
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this.el?.remove()
    this._slot?.classList.remove('has-buttons')
  }
}
