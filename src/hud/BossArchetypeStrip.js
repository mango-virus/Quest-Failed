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
import { Balance } from '../config/balance.js'

// One-line "what does this do" blurbs, shown as a hover tooltip on each day-
// active button (the .qf-bottombar [data-tip] CSS tooltip applies since the
// strip lives inside the bottom bar). Keyed by archetype id.
const ABILITY_TIPS = {
  golem:     'Erupt a chosen room with a quake, hammering the heroes inside.',
  demon:     'Sacrifice a minion to blast a room with hellfire — grows each use.',
  lich:      'Spend soul essence to wither a room: damage and no healing.',
  slime:     'Split your slimes in a room into a fresh surging swarm.',
  beholder:  "Sear a chosen room with the eye tyrant's burning rays.",
  orc:       'Hurl a claimed trophy into a room for heavy impact damage.',
  myconid:   'Colonize a room with fungal bloom — damage and no healing.',
  lizardman: 'Infect a room with plague that spreads to nearby heroes.',
  vampire:   'Spend banked Blood to drain a room and heal the boss.',
  wraith:    'Flood a room with dread — panics and weakens its heroes.',
  gnoll:     'Send your pack into a frenzy to maul a chosen room.',
  succubus:  'Mesmerize a room — charm and freeze its heroes.',
}

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
        dataset: { tip: ABILITY_TIPS.golem },
        ref: el => { this._golemBtn = el },
        on: { click: () => this._onGolemClick() },
      }, 'SEISMIC SLAM'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-sacrifice',
        dataset: { tip: ABILITY_TIPS.demon },
        ref: el => { this._demonBtn = el },
        on: { click: () => this._onDemonClick() },
      }, 'INFERNAL PACT'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-channel',
        dataset: { tip: ABILITY_TIPS.lich },
        ref: el => { this._lichBtn = el },
        on: { click: () => this._onLichClick() },
      }, 'CHANNEL SOULS'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-surge',
        dataset: { tip: ABILITY_TIPS.slime },
        ref: el => { this._slimeBtn = el },
        on: { click: () => this._onSlimeClick() },
      }, 'MITOSIS SURGE'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-gaze',
        dataset: { tip: ABILITY_TIPS.beholder },
        ref: el => { this._beholderBtn = el },
        on: { click: () => this._onBeholderClick() },
      }, "TYRANT'S GAZE"),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-throw',
        dataset: { tip: ABILITY_TIPS.orc },
        ref: el => { this._orcBtn = el },
        on: { click: () => this._onOrcClick() },
      }, 'TROPHY THROW'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-seed',
        dataset: { tip: ABILITY_TIPS.myconid },
        ref: el => { this._myconidBtn = el },
        on: { click: () => this._onMyconidClick() },
      }, 'SEED THE BLOOM'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-spit',
        dataset: { tip: ABILITY_TIPS.lizardman },
        ref: el => { this._lizardBtn = el },
        on: { click: () => this._onLizardClick() },
      }, 'PLAGUE SPIT'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-rite',
        dataset: { tip: ABILITY_TIPS.vampire },
        ref: el => { this._vampBtn = el },
        on: { click: () => this._onVampClick() },
      }, 'BLOOD RITE'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-terror',
        dataset: { tip: ABILITY_TIPS.wraith },
        ref: el => { this._wraithBtn = el },
        on: { click: () => this._onWraithClick() },
      }, 'NIGHT TERROR'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-hunt',
        dataset: { tip: ABILITY_TIPS.gnoll },
        ref: el => { this._gnollBtn = el },
        on: { click: () => this._onGnollClick() },
      }, 'SOUND THE HUNT'),
      h('button', {
        className: 'qf-archstrip-btn qf-archstrip-kiss',
        dataset: { tip: ABILITY_TIPS.succubus },
        ref: el => { this._succubusBtn = el },
        on: { click: () => this._onSuccubusClick() },
      }, 'KISS OF RAPTURE'),
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
    // Lich Channel Souls.
    sub('LICH_CHANNEL_ARMED',    () => { this._lichArmed = true;  this._refresh() })
    sub('LICH_CHANNEL_DISARMED', () => { this._lichArmed = false; this._refresh() })
    sub('LICH_CHANNEL_FIRED',    () => { this._lichArmed = false; this._refresh() })
    sub('LICH_SOUL_HARVEST',     () => this._refresh())   // essence changed → enabled state may flip
    // Slime Mitosis Surge.
    sub('SLIME_SURGE_ARMED',    () => { this._slimeArmed = true;  this._refresh() })
    sub('SLIME_SURGE_DISARMED', () => { this._slimeArmed = false; this._refresh() })
    sub('SLIME_SURGE_FIRED',    () => { this._slimeArmed = false; this._refresh() })
    // Beholder Tyrant's Gaze.
    sub('BEHOLDER_GAZE_ARMED',    () => { this._beholderArmed = true;  this._refresh() })
    sub('BEHOLDER_GAZE_DISARMED', () => { this._beholderArmed = false; this._refresh() })
    sub('BEHOLDER_GAZE_FIRED',    () => { this._beholderArmed = false; this._refresh() })
    // Orc Trophy Throw.
    sub('ORC_TROPHY_THROW_ARMED',    () => { this._orcArmed = true;  this._refresh() })
    sub('ORC_TROPHY_THROW_DISARMED', () => { this._orcArmed = false; this._refresh() })
    sub('ORC_TROPHY_THROW_FIRED',    () => { this._orcArmed = false; this._refresh() })
    // Myconid Seed the Bloom.
    sub('MYCONID_SEED_ARMED',    () => { this._myconidArmed = true;  this._refresh() })
    sub('MYCONID_SEED_DISARMED', () => { this._myconidArmed = false; this._refresh() })
    sub('MYCONID_SEED_FIRED',    () => { this._myconidArmed = false; this._refresh() })
    // Lizardman Plague Spit.
    sub('LIZARD_SPIT_ARMED',    () => { this._lizardArmed = true;  this._refresh() })
    sub('LIZARD_SPIT_DISARMED', () => { this._lizardArmed = false; this._refresh() })
    sub('LIZARD_SPIT_FIRED',    () => { this._lizardArmed = false; this._refresh() })
    // Vampire Blood Rite.
    sub('VAMPIRE_RITE_ARMED',    () => { this._vampArmed = true;  this._refresh() })
    sub('VAMPIRE_RITE_DISARMED', () => { this._vampArmed = false; this._refresh() })
    sub('VAMPIRE_RITE_FIRED',    () => { this._vampArmed = false; this._refresh() })
    // Wraith Night Terror.
    sub('WRAITH_TERROR_ARMED',    () => { this._wraithArmed = true;  this._refresh() })
    sub('WRAITH_TERROR_DISARMED', () => { this._wraithArmed = false; this._refresh() })
    sub('WRAITH_TERROR_FIRED',    () => { this._wraithArmed = false; this._refresh() })
    // Gnoll Sound the Hunt.
    sub('GNOLL_HUNT_ARMED',    () => { this._gnollArmed = true;  this._refresh() })
    sub('GNOLL_HUNT_DISARMED', () => { this._gnollArmed = false; this._refresh() })
    sub('GNOLL_HUNT_FIRED',    () => { this._gnollArmed = false; this._refresh() })
    // Succubus Kiss of Rapture.
    sub('SUCCUBUS_KISS_ARMED',    () => { this._succubusArmed = true;  this._refresh() })
    sub('SUCCUBUS_KISS_DISARMED', () => { this._succubusArmed = false; this._refresh() })
    sub('SUCCUBUS_KISS_FIRED',    () => { this._succubusArmed = false; this._refresh() })
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

  _onLichClick() {
    if (this._lichBtn?.disabled) return
    EventBus.emit(this._lichArmed ? 'LICH_CHANNEL_DISARM' : 'LICH_CHANNEL_ARM')
  }

  _onSlimeClick() {
    if (this._slimeBtn?.disabled) return
    EventBus.emit(this._slimeArmed ? 'SLIME_SURGE_DISARM' : 'SLIME_SURGE_ARM')
  }

  _onBeholderClick() {
    if (this._beholderBtn?.disabled) return
    EventBus.emit(this._beholderArmed ? 'BEHOLDER_GAZE_DISARM' : 'BEHOLDER_GAZE_ARM')
  }

  _onOrcClick() {
    if (this._orcBtn?.disabled) return
    EventBus.emit(this._orcArmed ? 'ORC_TROPHY_THROW_DISARM' : 'ORC_TROPHY_THROW_ARM')
  }

  _onMyconidClick() {
    if (this._myconidBtn?.disabled) return
    EventBus.emit(this._myconidArmed ? 'MYCONID_SEED_DISARM' : 'MYCONID_SEED_ARM')
  }

  _onLizardClick() {
    if (this._lizardBtn?.disabled) return
    EventBus.emit(this._lizardArmed ? 'LIZARD_SPIT_DISARM' : 'LIZARD_SPIT_ARM')
  }

  _onVampClick() {
    if (this._vampBtn?.disabled) return
    EventBus.emit(this._vampArmed ? 'VAMPIRE_RITE_DISARM' : 'VAMPIRE_RITE_ARM')
  }

  _onWraithClick() {
    if (this._wraithBtn?.disabled) return
    EventBus.emit(this._wraithArmed ? 'WRAITH_TERROR_DISARM' : 'WRAITH_TERROR_ARM')
  }

  _onGnollClick() {
    if (this._gnollBtn?.disabled) return
    EventBus.emit(this._gnollArmed ? 'GNOLL_HUNT_DISARM' : 'GNOLL_HUNT_ARM')
  }

  _onSuccubusClick() {
    if (this._succubusBtn?.disabled) return
    EventBus.emit(this._succubusArmed ? 'SUCCUBUS_KISS_DISARM' : 'SUCCUBUS_KISS_ARM')
  }

  _refresh() {
    if (!this.el) return
    const phase    = this._gs?.meta?.phase
    const isDay    = phase === 'day'
    const archId   = this._gs?.player?.bossArchetypeId
    const isGolem  = archId === 'golem'
    const isDemon  = archId === 'demon'
    const isLich   = archId === 'lich'
    const isSlime  = archId === 'slime'
    const isBeholder = archId === 'beholder'
    const isOrc    = archId === 'orc'
    const isMyconid = archId === 'myconid'
    const isLizardman = archId === 'lizardman'
    const isVampire = archId === 'vampire'
    const isWraith = archId === 'wraith'
    const isGnoll = archId === 'gnoll'
    const isSuccubus = archId === 'succubus'
    const golemActive = isGolem && isDay
    const demonActive = isDemon && isDay
    const lichActive  = isLich && isDay
    const slimeActive = isSlime && isDay
    const beholderActive = isBeholder && isDay
    const orcActive = isOrc && isDay
    const myconidActive = isMyconid && isDay
    const lizardActive = isLizardman && isDay
    const vampActive = isVampire && isDay
    const wraithActive = isWraith && isDay
    const gnollActive = isGnoll && isDay
    const succubusActive = isSuccubus && isDay

    const anyActive = golemActive || demonActive || lichActive || slimeActive || beholderActive || orcActive || myconidActive || lizardActive || vampActive || wraithActive || gnollActive || succubusActive
    this.el.classList.toggle('open', !!anyActive)
    // Let the slot's parent (BottomBar) know whether to leave a gap.
    if (this._slot) this._slot.classList.toggle('has-buttons', !!anyActive)

    if (this._golemBtn) {
      this._golemBtn.style.display = golemActive ? '' : 'none'
      this._golemBtn.classList.toggle('armed', !!this._golemArmed)
      const usesLeft = this._gs?.boss?._golem?.earthquakeUsesLeft ?? 0
      this._golemBtn.textContent = this._golemArmed ? 'PICK A ROOM' : `SEISMIC SLAM · ${usesLeft}`
      this._golemBtn.disabled = !(usesLeft > 0)
    }
    if (this._demonBtn) {
      this._demonBtn.style.display = demonActive ? '' : 'none'
      this._demonBtn.classList.toggle('armed', !!this._demonArmed)
      const usesLeft = this._gs?.boss?._demon?.sacrificeUsesLeft
                    ?? this._gs?._demon?.sacrificeUsesLeft ?? 0
      this._demonBtn.textContent = this._demonArmed ? 'PICK A ROOM' : `INFERNAL PACT · ${usesLeft}`
      this._demonBtn.disabled = !(usesLeft > 0)
    }
    if (this._lichBtn) {
      this._lichBtn.style.display = lichActive ? '' : 'none'
      this._lichBtn.classList.toggle('armed', !!this._lichArmed)
      const ess = this._gs?.boss?.soulEssence ?? 0
      this._lichBtn.textContent = this._lichArmed ? 'PICK A ROOM' : `CHANNEL SOULS · ${Math.floor(ess)}`
      this._lichBtn.disabled = !(ess >= (Balance.LICH_CHANNEL_COST ?? 12))
    }
    if (this._slimeBtn) {
      this._slimeBtn.style.display = slimeActive ? '' : 'none'
      this._slimeBtn.classList.toggle('armed', !!this._slimeArmed)
      const uses = this._gs?.boss?._slimeSurge?.usesLeft ?? 0
      this._slimeBtn.textContent = this._slimeArmed ? 'PICK A ROOM' : 'MITOSIS SURGE'
      this._slimeBtn.disabled = !(uses > 0)
    }
    if (this._beholderBtn) {
      this._beholderBtn.style.display = beholderActive ? '' : 'none'
      this._beholderBtn.classList.toggle('armed', !!this._beholderArmed)
      const uses = this._gs?.boss?._beholderGaze?.usesLeft ?? 0
      this._beholderBtn.textContent = this._beholderArmed ? 'PICK A ROOM' : `TYRANT'S GAZE · ${uses}`
      this._beholderBtn.disabled = !(uses > 0)
    }
    if (this._orcBtn) {
      this._orcBtn.style.display = orcActive ? '' : 'none'
      this._orcBtn.classList.toggle('armed', !!this._orcArmed)
      const uses = this._gs?.boss?._orcThrow?.usesLeft ?? 0
      const claimed = Object.keys(this._gs?.boss?.trophies ?? {}).length
      // disabled until at least one trophy is claimed (nothing to throw yet)
      this._orcBtn.textContent = this._orcArmed ? 'PICK A ROOM' : `TROPHY THROW · ${uses}`
      this._orcBtn.disabled = !(uses > 0 && claimed > 0)
    }
    if (this._myconidBtn) {
      this._myconidBtn.style.display = myconidActive ? '' : 'none'
      this._myconidBtn.classList.toggle('armed', !!this._myconidArmed)
      const uses = this._gs?.boss?._myconidSeed?.usesLeft ?? 0
      this._myconidBtn.textContent = this._myconidArmed ? 'PICK A ROOM' : `SEED THE BLOOM · ${uses}`
      this._myconidBtn.disabled = !(uses > 0)
    }
    if (this._lizardBtn) {
      this._lizardBtn.style.display = lizardActive ? '' : 'none'
      this._lizardBtn.classList.toggle('armed', !!this._lizardArmed)
      const uses = this._gs?.boss?._lizSpit?.usesLeft ?? 0
      this._lizardBtn.textContent = this._lizardArmed ? 'PICK A ROOM' : `PLAGUE SPIT · ${uses}`
      this._lizardBtn.disabled = !(uses > 0)
    }
    if (this._vampBtn) {
      this._vampBtn.style.display = vampActive ? '' : 'none'
      this._vampBtn.classList.toggle('armed', !!this._vampArmed)
      const uses = this._gs?.boss?._vampRite?.usesLeft ?? 0
      this._vampBtn.textContent = this._vampArmed ? 'PICK A ROOM' : `BLOOD RITE · ${uses}`
      this._vampBtn.disabled = !(uses > 0)
    }
    if (this._wraithBtn) {
      this._wraithBtn.style.display = wraithActive ? '' : 'none'
      this._wraithBtn.classList.toggle('armed', !!this._wraithArmed)
      const uses = this._gs?.boss?._wraithTerror?.usesLeft ?? 0
      this._wraithBtn.textContent = this._wraithArmed ? 'PICK A ROOM' : `NIGHT TERROR · ${uses}`
      this._wraithBtn.disabled = !(uses > 0)
    }
    if (this._gnollBtn) {
      this._gnollBtn.style.display = gnollActive ? '' : 'none'
      this._gnollBtn.classList.toggle('armed', !!this._gnollArmed)
      const uses = this._gs?.boss?._gnollHunt?.usesLeft ?? 0
      this._gnollBtn.textContent = this._gnollArmed ? 'PICK A ROOM' : `SOUND THE HUNT · ${uses}`
      this._gnollBtn.disabled = !(uses > 0)
    }
    if (this._succubusBtn) {
      this._succubusBtn.style.display = succubusActive ? '' : 'none'
      this._succubusBtn.classList.toggle('armed', !!this._succubusArmed)
      const uses = this._gs?.boss?._succubusKiss?.usesLeft ?? 0
      this._succubusBtn.textContent = this._succubusArmed ? 'PICK A ROOM' : `KISS OF RAPTURE · ${uses}`
      this._succubusBtn.disabled = !(uses > 0)
    }
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this.el?.remove()
    this._slot?.classList.remove('has-buttons')
  }
}
