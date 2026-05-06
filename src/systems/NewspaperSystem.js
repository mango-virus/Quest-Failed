// Phase 9 — NewspaperSystem.
//
// Collects daily events on a rolling buffer and renders a dryly comedic
// "Boss Daily" summary at end-of-day. The newspaper is a flat object:
//   {
//     day:        Number,
//     headline:   String,
//     body:       [String, …],   // paragraphs / bulletted lines
//     casualties: Number,
//     fled:       Number,
//     mechanics:  [String, …],   // active mechanic names
//   }
//
// EndOfDay scene reads `newspaperSystem.compose()` after DAY_PHASE_ENDED.
//
// Tone: deadpan workplace memo. The dungeon is a small business; the boss
// is middle management; adventurers are clients who lodge complaints.

import { EventBus } from './EventBus.js'

export class NewspaperSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._events = []   // raw events for the current day
    this._listeners = []

    this._wire()
    EventBus.on('DAY_PHASE_STARTED', this._onDayStart, this)
  }

  destroy() {
    EventBus.off('DAY_PHASE_STARTED', this._onDayStart, this)
    this._unwire()
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  _onDayStart() { this._events = [] }

  _wire() {
    const log = (kind, payload) => this._events.push({ kind, payload, t: this._scene.time.now })
    const handlers = [
      ['ADVENTURER_DIED',     p => log('died',       p)],
      ['ADVENTURER_FLED',     p => log('fled',       p)],
      ['MINION_DIED',         p => log('minion_died', p)],
      ['TRAP_TRIGGERED',      p => log('trap',       p)],
      ['TRAP_DISARMED',       p => log('disarmed',   p)],
      ['MINION_LEVELED_UP',   p => log('mlevel',     p)],
      ['MINION_EVOLVED',      p => log('mevolve',    p)],
      ['MINION_BOUNTY_POSTED',p => log('bounty',     p)],
      ['BOSS_LEVELED_UP',     p => log('boss_leveled_up', p)],
      ['VENDETTA_HUNTER_ARRIVED', p => log('vendetta', p)],
      ['ADVENTURER_RETURNED', p => log('returned',   p)],
      ['MECHANIC_ACTIVATED',  p => log('mech_on',    p)],
      ['BLOODBOUND_LOSSES',   p => log('bloodbound', p)],
      ['DUNGEON_EVENT_BEGAN', p => log('event_began', p)],
      ['DUNGEON_EVENT_ENDED', p => log('event_ended', p)],
    ]
    for (const [evt, fn] of handlers) {
      EventBus.on(evt, fn)
      this._listeners.push([evt, fn])
    }
  }

  _unwire() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  // ── Composition ──────────────────────────────────────────────────────────

  // Generate the day's paper. Called by EndOfDay scene.
  compose() {
    const day = this._gameState.meta.dayNumber
    const deaths   = this._events.filter(e => e.kind === 'died')
    const flees    = this._events.filter(e => e.kind === 'fled')
    const minionDeaths = this._events.filter(e => e.kind === 'minion_died')
    const traps    = this._events.filter(e => e.kind === 'trap')
    const disarms  = this._events.filter(e => e.kind === 'disarmed')
    const evolves  = this._events.filter(e => e.kind === 'mevolve')
    const bounties = this._events.filter(e => e.kind === 'bounty')
    const dlevels  = this._events.filter(e => e.kind === 'dlevel')
    const returned = this._events.filter(e => e.kind === 'returned')
    const vendet   = this._events.filter(e => e.kind === 'vendetta')
    const eventBegan = this._events.find(e => e.kind === 'event_began')

    const headline = this._headline(deaths.length, flees.length, evolves.length, day)
    const body = []

    // Casualties paragraph
    if (deaths.length > 0) {
      const lines = deaths.slice(0, 4).map(e => {
        const adv = e.payload?.adventurer
        const klr = e.payload?.killerName ?? 'something'
        return `  · ${adv?.name ?? 'Anonymous'} the ${adv?.classId ?? 'hopeful'} (${klr})`
      })
      body.push(`Today the dungeon processed ${deaths.length} adventurer${_s(deaths.length)} into a fresh haul of gold. Notable departures:`)
      body.push(...lines)
      if (deaths.length > 4) body.push(`  · …and ${deaths.length - 4} other${_s(deaths.length - 4)} the bookkeeper has not yet labelled.`)
    } else {
      body.push(`Zero casualties. HR has filed paperwork praising the survival rate; Operations is concerned.`)
    }

    if (flees.length > 0) {
      body.push('')
      body.push(`Of those who lived, ${flees.length} fled — taking with them several embarrassing internal documents (read: knowledge of where the traps are).`)
    }

    if (returned.length > 0) {
      const r = returned[0].payload
      body.push('')
      body.push(`${r?.adventurer?.name ?? 'A familiar face'} returned with ${(r?.priorPathHistory?.length ?? 0)} samples of useful intel. Their party walked the maze like they'd already done it. Probably because they had.`)
    }

    if (vendet.length > 0) {
      body.push('')
      body.push(`A sibling of a previous victim has filed a workplace incident report and brought a sword.`)
    }

    if (eventBegan) {
      const name = eventBegan.payload?.def?.name ?? 'A strange omen'
      body.push('')
      body.push(`Special bulletin: today was ${name}. Filed under "things the Boss didn't ask for."`)
    }

    if (minionDeaths.length > 0) {
      body.push('')
      body.push(`${minionDeaths.length} minion${_s(minionDeaths.length)} ${minionDeaths.length === 1 ? 'was' : 'were'} dispersed into reusable bone fragments. Routine.`)
    }

    if (traps.length > 0 || disarms.length > 0) {
      body.push('')
      const fired = traps.length
      const dis   = disarms.length
      const parts = []
      if (fired > 0) parts.push(`${fired} trap${_s(fired)} fired`)
      if (dis   > 0) parts.push(`${dis} ${_s(dis) === '' ? 'was' : 'were'} disarmed by a meddling adventurer`)
      body.push(`Trap report: ${parts.join('; ')}.`)
    }

    if (evolves.length > 0) {
      body.push('')
      const e0 = evolves[0]
      body.push(`Promotions: ${e0.payload?.minion?.name ?? 'a minion'} evolved into something bigger and meaner. Performance review attached.`)
    }

    if (bounties.length > 0) {
      body.push('')
      body.push(`${bounties.length} of your minion${_s(bounties.length)} ${bounties.length === 1 ? 'has' : 'have'} acquired bounties on their head${_s(bounties.length)}. Adventurer guilds are, in fact, paying attention.`)
    }

    if (dlevels.length > 0) {
      const newLv = dlevels[dlevels.length - 1].payload?.newLevel
      body.push('')
      body.push(`Dungeon notoriety has risen to Level ${newLv}. Stronger adventurers are en route. Try not to die.`)
    }

    const mechanics = (this._gameState.activeMechanics ?? []).map(id => {
      const def = this._scene.cache.json.get('dungeonMechanics')?.find(d => d.id === id)
      return def?.name ?? id
    })

    return {
      day,
      headline,
      body,
      casualties: deaths.length,
      fled:       flees.length,
      mechanics,
    }
  }

  // ── Headlines ────────────────────────────────────────────────────────────

  _headline(deaths, fled, evolves, day) {
    if (deaths === 0 && fled === 0) {
      return _pick([
        `BOSS DAILY · DAY ${day} · NOTHING HAPPENED, EVERYONE LIVED`,
        `BOSS DAILY · DAY ${day} · A SUSPICIOUSLY QUIET DAY`,
      ])
    }
    if (deaths >= 5) {
      return _pick([
        `BOSS DAILY · DAY ${day} · GUILD HOTLINE OVERWHELMED`,
        `BOSS DAILY · DAY ${day} · ${deaths} BURIED, ZERO REGRETS`,
      ])
    }
    if (deaths > 0 && fled === 0) {
      return _pick([
        `BOSS DAILY · DAY ${day} · NO ESCAPEES, NO COMPLAINTS`,
        `BOSS DAILY · DAY ${day} · A PRODUCTIVE DAY`,
      ])
    }
    if (fled > deaths) {
      return _pick([
        `BOSS DAILY · DAY ${day} · MORE LEAKS THAN A WET CRYPT`,
        `BOSS DAILY · DAY ${day} · ${fled} ADVENTURERS NOW HAVE OUR FLOOR PLAN`,
      ])
    }
    if (evolves > 0) {
      return `BOSS DAILY · DAY ${day} · MINIONS PROMOTED, BUDGET CONSULTED`
    }
    return `BOSS DAILY · DAY ${day} · BUSINESS AS USUAL`
  }
}

function _s(n) { return n === 1 ? '' : 's' }
function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
