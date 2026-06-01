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

export class NemesisSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs = gameState
    this._lines = scene?.cache?.json?.get('aldricLines') ?? null
    this._ensureState()
    EventBus.on('ACT_CLEARED',     this._onActCleared, this)
    EventBus.on('ADVENTURER_FLED', this._onFled,       this)
  }

  destroy() {
    EventBus.off('ACT_CLEARED',     this._onActCleared, this)
    EventBus.off('ADVENTURER_FLED', this._onFled,       this)
  }

  // Aldric withdraws (scout-and-withdraw) — fire an act-specific vow taunt as he
  // leaves. He's plot-armored, so a flee is always a deliberate retreat, never a
  // death. (The actual removal from `active` is handled by the flee machinery.)
  _onFled({ adventurer } = {}) {
    if (!adventurer?._nemesis) return
    const n = this._gs.meta?.nemesis
    const act = n?.act ?? 1
    const line = this._pick('withdraw', String(Math.min(act, 3)))
    if (line) EventBus.emit('NEMESIS_TAUNT', { line, act, source: 'withdraw', log: true })
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
    return {
      name: n.name ?? 'Aldric',
      act: n.act ?? 1,
      returns: n.returns ?? 0,
      abilities: [...(n.abilities ?? [])],
      crowned: !!n.crowned,
      title: this._title(n.act ?? 1),
    }
  }

  // A line for a category (and optional sub-key), or null if the bank is absent.
  pick(category, sub) { return this._pick(category, sub) }

  _title(act) {
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
