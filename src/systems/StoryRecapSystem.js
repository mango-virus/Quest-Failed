// StoryRecapSystem — emergent-narrative recap (research briefing #8, 2026-06-23).
//
// Surfaces the story the AI already plays out — who fled, who died greedy, who broke
// and turned on their own — as readable prose. Replaces the orphaned NewspaperSystem
// (a comedic "Boss Daily" that was composed nowhere).
//
// Tone (locked): HYBRID — grim dark-fantasy with an occasional wry, cruel edge.
//   "Aldric the Knight met a giant rat in the dark. The rat won."
//   "The cleric died reviving a man who'd already fled. Heroic. Pointless."
//
// How it works: buffers the day's story-worthy events; on DAY_PHASE_ENDED it GROUPS
// them per-adventurer into the richest single "character arc" beat (an affliction that
// ended in death reads as one beat, not two), ranks by drama, keeps the top few, and
// writes the day's tale to gameState.history (days[] + latestTale). The end-of-day
// summary (PostWaveOverlay) renders latestTale; the end-of-run screen calls the pure
// composeSaga(gameState) to tell the whole reign. FullLog stays the exhaustive list —
// this is the CURATED highlight reel.

import { EventBus } from './EventBus.js'
import { classLabel } from '../util/displayNames.js'

const MAX_BEATS_PER_DAY = 4    // curated highlight reel, not a dump (FullLog has the rest)
const DAYS_KEPT         = 80   // bound the saved history.days array

export class StoryRecapSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._events = []
    this._listeners = []
    this._wire()
    EventBus.on('DAY_PHASE_STARTED', this._onDayStart, this)
    EventBus.on('DAY_PHASE_ENDED',   this._onDayEnd,   this)
  }

  destroy() {
    EventBus.off('DAY_PHASE_STARTED', this._onDayStart, this)
    EventBus.off('DAY_PHASE_ENDED',   this._onDayEnd,   this)
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  _onDayStart() { this._events = [] }

  _wire() {
    const log = (kind, payload) => this._events.push({ kind, payload, t: this._scene?.time?.now ?? 0 })
    const handlers = [
      ['ADVENTURER_DIED',      p => log('died',      p)],
      ['ADVENTURER_FLED',      p => log('fled',      p)],
      ['ADVENTURER_AFFLICTED', p => log('afflicted', p)],   // the #5 emergent beats
      ['DUNGEON_EVENT_BEGAN',  p => log('event',     p)],
    ]
    for (const [evt, fn] of handlers) { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }
  }

  // ── End-of-day: compose the tale + persist it ──────────────────────────────
  _onDayEnd() {
    const tale = this._composeTale()
    const hist = (this._gameState.history ??= { days: [], events: [], pacts: [] })
    hist.days ??= []
    hist.days.push(tale)
    if (hist.days.length > DAYS_KEPT) hist.days.splice(0, hist.days.length - DAYS_KEPT)
    hist.latestTale = tale
  }

  _composeTale() {
    const day = this._gameState.meta?.dayNumber ?? 1
    // Group died/fled/afflicted by adventurer (instanceId) into one arc per hero.
    const heroes = new Map()
    const rec = (id) => { if (!id) id = `anon${heroes.size}`; if (!heroes.has(id)) heroes.set(id, { id }); return heroes.get(id) }
    let slain = 0, fled = 0, gold = 0
    let eventName = null
    for (const e of this._events) {
      const p = e.payload || {}
      if (e.kind === 'died') {
        const a = p.adventurer || {}
        const r = rec(a.instanceId); r.name = a.name; r.classId = a.classId; r.level = a.level
        r.died = true; r.killer = p.killerName || 'the dark'; r.damageType = p.damageType
        slain++; gold += a.goldDropped || 0
      } else if (e.kind === 'fled') {
        const a = p.adventurer || {}
        const r = rec(a.instanceId); r.name = a.name; r.classId = a.classId; r.level = a.level
        r.fled = true; r.gold = a.goldDropped || 0
        fled++; gold += a.goldDropped || 0
      } else if (e.kind === 'afflicted') {
        rec(p.advId).affliction = p.type
      } else if (e.kind === 'event' && !eventName) {
        eventName = p.def?.name || null
      }
    }
    const named = [...heroes.values()].filter(h => h.name && (h.died || h.fled))
    named.sort((a, b) => _score(b) - _score(a))
    const beats = named.slice(0, MAX_BEATS_PER_DAY).map((h, i) => _heroBeat(h, i))
    return { day, title: _dayTitle(day, slain, fled, eventName), beats, toll: { slain, fled, gold } }
  }
}

// ── Pure end-of-run saga (callable from GameOver / Victory without the system) ──
// opts.won = true → victory framing (no "who ended your reign" line; triumphant close).
export function composeSaga(gameState, opts = {}) {
  const won   = !!opts.won
  const days  = gameState?.history?.days ?? []
  const tot   = gameState?.run?.totals ?? {}
  const known = gameState?.adventurers?.known ?? []
  const fb    = gameState?.run?.finalBlow ?? null
  const survived = gameState?.meta?.dayNumber ?? days.length ?? 1
  const slain  = tot.advsKilled ?? tot.kills ?? 0
  const escaped = tot.advsEscaped ?? 0
  const gold   = tot.gold ?? 0

  const lines = []
  // Deadliest day.
  const deadliest = days.reduce((best, d) => (d.toll?.slain ?? 0) > (best?.toll?.slain ?? -1) ? d : best, null)
  if (deadliest && (deadliest.toll?.slain ?? 0) > 0) {
    lines.push(_pick([
      `Day ${deadliest.day} ran red — ${deadliest.toll.slain} fell in a single dusk.`,
      `The deep was hungriest on Day ${deadliest.day}: ${deadliest.toll.slain} never left.`,
    ], deadliest.day))
  }
  // The nemesis — the one who kept coming back.
  const nem = known.filter(k => (k.escapeCount ?? 0) >= 2).sort((a, b) => (b.escapeCount ?? 0) - (a.escapeCount ?? 0))[0]
  if (nem) {
    lines.push(_pick([
      `${_who(nem)} slipped your grasp ${nem.escapeCount} times — and learned your halls by heart.`,
      `${_who(nem)} fled and returned, again and again (${nem.escapeCount} escapes). A nemesis, now.`,
    ], nem.escapeCount))
  }
  // The final blow — only on a LOSS (it's the hero who ended your reign).
  if (!won && fb?.name) {
    lines.push(_pick([
      `In the end it was ${_who(fb)} who reached the throne — and that was that.`,
      `${_who(fb)} struck the blow that ended your reign. Remember the name.`,
    ], (fb.level ?? 0)))
  }
  // The toll + a closing line (triumphant on a win, grim on a loss).
  lines.push(`Over ${survived} day${survived === 1 ? '' : 's'}: ${slain} slain, ${escaped} fled, ${gold.toLocaleString?.() ?? gold} gold hoarded.`)
  lines.push(won
    ? _pick([
      `The kingdom has nothing left to send. The dark has won — for now.`,
      `They will sing of the dungeon that could not be cleared. You reign, eternal.`,
      `Every hero broke against your halls. Let them remember why they fear the deep.`,
    ], slain + escaped)
    : _pick([
      `The dungeon goes quiet. It will not stay that way.`,
      `Another reign ends. The dark is patient; it will try again.`,
      `Heroes will tell this story. They always come back for more.`,
    ], slain + escaped))

  return { title: 'THE SAGA OF YOUR REIGN', lines, toll: { survived, slain, escaped, gold } }
}

// ── Beat composition (hybrid grim + wry) ───────────────────────────────────────
function _who(r) { return `${r.name} the ${classLabel(r.classId, 'Hopeful')}` }

// Drama score → ranking. Afflicted-and-died is the richest character arc.
function _score(h) {
  let s = 0
  if (h.died && h.affliction) s = 100
  else if (h.died && _notableKiller(h)) s = 80
  else if (h.affliction && h.fled) s = 70
  else if (h.died) s = 50
  else if (h.fled && (h.gold ?? 0) > 0) s = 40
  else if (h.fled) s = 20
  return s + (h.level ?? 0) * 0.5
}

function _notableKiller(h) {
  const k = (h.killer || '').toLowerCase()
  return /boss|throne|trap|spike|acid|poison|blade|cannon|dragon/.test(k) || ['acid', 'poison', 'fire', 'soul', 'unholy'].includes(h.damageType)
}

function _heroBeat(h, seed = 0) {
  const who = _who(h)
  // Afflicted → died (one combined arc, the highest-drama beat).
  if (h.died && h.affliction) {
    const t = h.affliction
    if (t === 'hysteria') return _pick([`${who}'s nerve snapped — they turned their blade on their own, then the dark took them too.`, `Fear unmade ${who}: they cut at their own companions until the dungeon finished the job.`], seed)
    if (t === 'paranoia') return _pick([`${who} bolted from the party in a panic and died alone, far from any help.`, `Trusting no one, ${who} fled into the deep alone — and was never heard from again.`], seed)
    if (t === 'hubris')   return _pick([`${who} charged the throne alone, certain of glory. The dungeon disagreed.`, `Glory-drunk, ${who} pushed too deep too fast. Pride, then a corpse.`], seed)
    if (t === 'despair')  return _pick([`${who} simply gave up — knelt in the dark and let it happen.`, `Something in ${who} broke; they stopped fighting, and the dark obliged.`], seed)
    if (t === 'terror')   return _pick([`${who} froze in terror and never moved again.`, `${who} was too afraid to run. ${h.killer} did not share the hesitation.`], seed)
    if (t === 'rout')     return _pick([`${who} broke and ran — the dungeon caught them before the door.`, `Panic took ${who}; they didn't make it halfway to the exit.`], seed)
  }
  // Afflicted → fled.
  if (h.fled && h.affliction) {
    const t = h.affliction
    if (t === 'rout')     return _pick([`${who} broke and ran — and the panic spread; the party shattered behind them.`, `${who} bolted screaming, and dragged the rest of the party's nerve out the door with them.`], seed)
    if (t === 'paranoia') return _pick([`${who} turned on the party and fled alone into the dark.`, `${who} decided the real monsters were their own companions, and ran.`], seed)
    return `${who} lost their nerve and fled with ${h.gold || 0} gold.`
  }
  // Plain death.
  if (h.died) {
    const k = h.killer
    if (/boss|throne/i.test(k)) return _pick([`${who} reached the throne. ${who} did not leave it.`, `${who} came all this way to meet you. A poor decision.`], seed)
    if (/trap|spike|cannon|blade|acid|poison|dragon/i.test(k) || ['acid', 'poison', 'fire'].includes(h.damageType))
      return _pick([`${who} died screaming, courtesy of ${k}.`, `${k} made short, ugly work of ${who}.`], seed)
    return _pick([`${who} met ${k} in the dark. ${k} won.`, `${who} fell to ${k}. Another haul for the coffers.`, `The ${classLabel(h.classId, 'fool')} came for treasure and found ${k} instead.`], seed)
  }
  // Plain flee.
  if (h.gold > 0) return _pick([`${who} fled with ${h.gold} gold and a map of your traps. They'll be back.`, `${who} ran for the door, ${h.gold} gold richer and full of stories.`], seed)
  return _pick([`${who} thought better of it and ran.`, `${who} decided today was not the day to die, and left.`], seed)
}

function _dayTitle(day, slain, fled, eventName) {
  if (eventName) return `DAY ${day} — ${eventName.toUpperCase()}`
  if (slain >= 5)        return _pick([`DAY ${day} — A RED DAY IN THE DEEP`, `DAY ${day} — THE DUNGEON GORGED`], day)
  if (slain > 0 && fled === 0) return _pick([`DAY ${day} — NONE LEFT ALIVE`, `DAY ${day} — THE DUNGEON FED`], day)
  if (fled > slain)      return _pick([`DAY ${day} — THEY RAN, AND TOLD TALES`, `DAY ${day} — MORE FLED THAN FELL`], day)
  if (slain > 0)         return _pick([`DAY ${day} — THE DUNGEON FED`, `DAY ${day} — BLOOD ON THE STONES`], day)
  return _pick([`DAY ${day} — AN UNQUIET CALM`, `DAY ${day} — THE DARK WAITS`], day)
}

// Deterministic-ish pick (seeded by a per-item value so it varies between heroes/days
// but is stable for a given record — avoids same-y repeats without needing Math.random).
function _pick(arr, seed = 0) { return arr[Math.abs(Math.floor(seed)) % arr.length] }
