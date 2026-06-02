// NemesisSystem — KR P2. Owns Aldric (the recurring Nemesis) lifecycle + state.
//
// Aldric is born in Act I (the surviving star apprentice), returns escalated in
// Acts II & III, and ascends to the crowned "Hero King" final boss in Act IV.
// He's plot-armored across Acts I–III (can only die in the Act IV duel — the
// spawn integration mirrors the Shadow Monarch / Light Party HP-floor pattern).
//
// This system is the spine: it tracks his escalation state, hands a spawn config
// to DayPhase (KR P2 spawn step), and fires NEMESIS_* events that the right-side
// rival portrait (KR P2 portrait step) and the dungeon log listen to. Gated
// behind the `acts` flag; Game.js only constructs it when acts are on.
//
// See DESIGN.md → "Aldric — the Nemesis".

import { EventBus } from './EventBus.js'

// A new signature ability unlocks each act he returns. (Behaviours land in the
// spawn/ability step; here we just track which are unlocked so the spawn config
// + portrait can reflect them.)
const ABILITY_BY_ACT = { 2: 'heroic_resolve', 3: 'dawnblade', 4: 'hero_king' }

// Throttle on Aldric's hurt reactions — he's hit many times per fight, but a
// grunt every few seconds reads as "shrugging it off / getting mad", not a buzz.
const HURT_THROTTLE_MS = 7000

// Cadence of his prowl taunts while he scouts toward the throne (paused with the
// game via the scene timer; stops the moment he recoils / withdraws).
const PROWL_DELAY_MS = 13000

export class NemesisSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs = gameState
    this._lines = scene?.cache?.json?.get('aldricLines') ?? null
    this._ensureState()
    EventBus.on('ACT_CLEARED',     this._onActCleared, this)
    EventBus.on('ADVENTURER_FLED', this._onFled,       this)
    EventBus.on('ADVENTURER_DIED', this._onDied,       this)
    EventBus.on('NEMESIS_RECOIL',  this._onRecoil,     this)
    EventBus.on('NEMESIS_HURT',    this._onHurt,       this)
    EventBus.on('NEMESIS_ARRIVED', this._onArrived,    this)
  }

  destroy() {
    EventBus.off('ACT_CLEARED',     this._onActCleared, this)
    EventBus.off('ADVENTURER_FLED', this._onFled,       this)
    EventBus.off('ADVENTURER_DIED', this._onDied,       this)
    EventBus.off('NEMESIS_RECOIL',  this._onRecoil,     this)
    EventBus.off('NEMESIS_HURT',    this._onHurt,       this)
    EventBus.off('NEMESIS_ARRIVED', this._onArrived,    this)
    this._stopProwl()
  }

  // Re-entry: reset the hurt throttle, fire his entrance LINE (the arrival face +
  // bubble, a beat after the slide-in), and start the prowl loop for this visit.
  _onArrived({ act } = {}) {
    this._hurtAt = 0
    const a = Math.min(4, act ?? this._gs.meta?.nemesis?.act ?? 1)
    const line = this._pick('arrive', String(a))
    if (line) this._scene?.time?.delayedCall?.(900, () => {
      EventBus.emit('NEMESIS_TAUNT', { line, act: a, source: 'arrive', log: true })
    })
    this._startProwl(a)
  }

  // A periodic scouting taunt while he prowls toward the throne — the portrait
  // shows his per-act prowl face (confident / combat-relish / manic).
  _startProwl(act) {
    this._stopProwl()
    if (!this._scene?.time?.addEvent) return
    this._prowlTimer = this._scene.time.addEvent({
      delay: PROWL_DELAY_MS, loop: true,
      callback: () => {
        const line = this._pick('tauntBoss')
        if (line) EventBus.emit('NEMESIS_TAUNT', { line, act, source: 'taunt', log: true })
      },
    })
  }
  _stopProwl() { try { this._prowlTimer?.remove?.() } catch {} this._prowlTimer = null }

  // Aldric chipped in combat (acts I–III). Throttled grunt + an escalating face by
  // HP band (light → his floor), index-matched to the per-act hurt.N lines AND the
  // portrait's hurtTiers, so line + face always agree. No log line (frequent).
  _onHurt({ adventurer, hpFrac } = {}) {
    if (!adventurer?._nemesis) return
    const now = this._scene?.time?.now ?? 0
    if (now - (this._hurtAt ?? 0) < HURT_THROTTLE_MS) return
    this._hurtAt = now
    const act = Math.min(3, this._gs.meta?.nemesis?.act ?? 1)
    const f = hpFrac ?? 1
    const tier = f <= 0.20 ? 3 : f <= 0.45 ? 2 : f <= 0.70 ? 1 : 0
    const bank = this._lines?.hurt?.[String(act)]
    const line = Array.isArray(bank) ? (bank[tier] ?? bank[bank.length - 1]) : null
    if (line) EventBus.emit('NEMESIS_TAUNT', { line, act, source: 'hurt', tier, log: false })
  }

  // The Act IV duel resolved in the boss's favour — Aldric, the crowned Hero
  // King, has fallen in the throne room. Record it, speak his last words, and
  // announce NEMESIS_SLAIN so ActSystem fires the run victory. (Acts I–III Aldric
  // is `_nemesis` and plot-armored, so this only ever fires for the duel form.)
  _onDied({ adventurer } = {}) {
    if (!adventurer?._nemesisDuel) return
    this.recordDuelResult(true)
    const act = this._gs.meta?.nemesis?.act ?? 4
    const line = this._pick('duel', 'defeat')   // his final, broken words
    if (line) EventBus.emit('NEMESIS_TAUNT', { line, act, source: 'duel_defeat', log: true })
    EventBus.emit('NEMESIS_SLAIN', { act, adventurer })
  }

  // Aldric reaches the throne (acts I–III), recoils at the boss, and vows revenge
  // BEFORE he turns to flee (the recoil hold lives in AISystem). Fire the vow here
  // — at the moment of recoil — so it lands while he's still facing the boss; the
  // subsequent flee then skips its own line so they don't double up.
  _onRecoil({ adventurer, act } = {}) {
    if (!adventurer?._nemesis) return
    this._stopProwl()   // he's reached the throne — done prowling, now he recoils
    const a = act ?? this._gs.meta?.nemesis?.act ?? 1
    const line = this._pick('withdraw', String(Math.min(a, 3)))
    if (line) EventBus.emit('NEMESIS_TAUNT', { line, act: a, source: 'recoil', log: true })
  }

  // Aldric leaves the dungeon (scout-and-withdraw). He's plot-armored, so a flee
  // is always a deliberate retreat. Emit NEMESIS_DEPARTED so his rival card hides
  // the instant he's gone (it used to linger until day-end). A flee that did NOT
  // come from the throne recoil (e.g. chipped to his HP floor mid-scout) still
  // gets its own withdrawal vow; a recoil-flee already vowed at the throne.
  _onFled({ adventurer } = {}) {
    if (!adventurer?._nemesis) return
    this._stopProwl()
    const n = this._gs.meta?.nemesis
    const act = n?.act ?? 1
    if (!adventurer._nemReeled) {
      const line = this._pick('withdraw', String(Math.min(act, 3)))
      if (line) EventBus.emit('NEMESIS_TAUNT', { line, act, source: 'withdraw', log: true })
    }
    EventBus.emit('NEMESIS_DEPARTED', { adventurer, act })
  }

  _ensureState() {
    const meta = this._gs.meta ?? (this._gs.meta = {})
    meta.nemesis ??= {
      name: 'Aldric',
      born: false,        // marked true once he first spawns in Act I
      alive: true,        // false only once the boss slays him in the Act IV duel
      act: 1,             // which act's version he's at (1–4)
      returns: 0,         // escalation count (increments each time he comes back)
      abilities: [],      // unlocked signature ability ids
      crowned: false,     // Act IV — anointed Hero King
      slainByBoss: false, // final outcome — boss won the duel
    }
  }

  // Aldric survived an act (he's plot-armored) and returns for the next, tougher.
  _onActCleared({ act } = {}) {
    const n = this._gs.meta?.nemesis
    if (!n || n.slainByBoss || act == null) return
    if (act >= 4) return   // the final act is resolved by the duel, not here

    n.act = act + 1
    n.returns += 1
    const ability = ABILITY_BY_ACT[n.act]
    if (ability && !n.abilities.includes(ability)) n.abilities.push(ability)
    if (n.act >= 4) n.crowned = true

    EventBus.emit('NEMESIS_ESCALATED', {
      act: n.act, returns: n.returns, abilities: [...n.abilities], crowned: n.crowned,
    })

    // Between-act taunt → dungeon log + (later) the rival portrait.
    const line = this._pick('actClearedTaunt', String(act))
    if (line) EventBus.emit('NEMESIS_TAUNT', { line, act: n.act, source: 'act_cleared', log: true })
  }

  // ── API for the spawn + portrait steps ──────────────────────────────────────

  // Mark Aldric as having entered the dungeon for the first time (Act I spawn).
  markBorn() {
    const n = this._gs.meta?.nemesis
    if (n) n.born = true
  }

  // Record the Act IV duel outcome (true = boss slew Aldric → run won).
  recordDuelResult(bossWon) {
    const n = this._gs.meta?.nemesis
    if (!n) return
    if (bossWon) { n.slainByBoss = true; n.alive = false }
  }

  // What DayPhase needs to spawn the current-act Aldric.
  spawnConfig() {
    const n = this._gs.meta?.nemesis ?? {}
    const act = n.act ?? 1
    // Adaptive ascension (KR P5/P2) — at the Act IV crowning Aldric's FORM is
    // decided by HOW the run was played and locked onto meta.nemesis.form: a
    // brutal, slaughter-heavy run forges a vengeful "Desperate Crown"; a more
    // merciful run (you let many flee) rallies a noble "Radiant Hope". Decided
    // lazily at the duel so it reflects the whole run.
    let form = n.form ?? null
    if (act >= 4 && !form) {
      form = this._decideForm()
      if (this._gs.meta?.nemesis) this._gs.meta.nemesis.form = form
    }
    return {
      name: n.name ?? 'Aldric',
      act,
      returns: n.returns ?? 0,
      abilities: [...(n.abilities ?? [])],
      crowned: !!n.crowned,
      form,
      title: this._title(act, form),
    }
  }

  // Brutal (slaughtered the kingdom) → 'desperate'; merciful (let many escape)
  // → 'radiant'. Whole-run kill ratio; defaults to the middle when no data.
  _decideForm() {
    const t = this._gs.run?.totals ?? {}
    const kills = t.advsKilled ?? t.kills ?? 0
    const escaped = t.advsEscaped ?? 0
    const ratio = (kills + escaped) > 0 ? kills / (kills + escaped) : 0.6
    return ratio >= 0.62 ? 'desperate' : 'radiant'
  }

  // A line for a category (and optional sub-key), or null if the bank is absent.
  pick(category, sub) { return this._pick(category, sub) }

  // A form-specific duel line ('opener' / 'low'), or null.
  formLine(form, key) {
    const line = this._lines?.forms?.[form]?.[key]
    return typeof line === 'string' ? line : null
  }

  _title(act, form) {
    // Act IV: the adaptive form's epithet overrides the generic Hero-King title.
    if (act >= 4 && form) {
      const ep = this._lines?.forms?.[form]?.epithet
      if (ep) return ep
    }
    const t = this._lines?.titles
    return Array.isArray(t) && t.length ? (t[Math.min(act, t.length) - 1] ?? t[0]) : 'Aldric'
  }

  _pick(category, sub) {
    const bank = this._lines?.[category]
    const arr = sub != null ? bank?.[sub] : bank
    if (!Array.isArray(arr) || arr.length === 0) return null
    return arr[Math.floor(Math.random() * arr.length)]
  }
}
