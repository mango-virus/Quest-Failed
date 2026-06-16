// ArchetypeSelect — the "choose your archetype" boss-picker scene.
//
// Sits after CompanionSelect in the NEW EVIL flow. Like MainMenu and
// CompanionSelect under the DOM HUD, this is now a THIN Phaser shell — the
// visuals + interaction live in the DOM overlay `src/hud/ArchetypeSelectOverlay.js`
// (crypt "enthronement altar" redesign, 2026-06-15, replacing the old Phaser
// bestiary-book render). The scene keeps the title music going, owns the
// overlay's lifecycle, and retains the run-launch plumbing the overlay calls:
// `_beginRun()` (createGameState → SaveSystem.save → start('Game')) and the
// mango dev-start overrides.
//
// Boss data lives in src/data/bossArchetypes.json (id, name, color, tagline,
// portraitAvailable, headline { name, summary }, mechanics[], flavorText,
// baseFightStats). The overlay reads it from the Phaser JSON cache via `this`.

import { createGameState } from '../state/GameState.js'
import { SaveSystem }      from '../systems/SaveSystem.js'
import { Balance }         from '../config/balance.js'
import { COMPANIONS, DEFAULT_COMPANION } from '../systems/companions.js'
import { TitleMusic }      from '../systems/TitleMusic.js'
import { PlayerProfile }   from '../systems/PlayerProfile.js'
import { UNLOCK_GATES }    from '../data/bossUnlocks.js'

export class ArchetypeSelect extends Phaser.Scene {
  constructor() {
    super('ArchetypeSelect')
    // Set by the overlay's CONFIRM before it calls _beginRun(); read there.
    this._selectedId = null
    this._ngTier     = 0
  }

  create() {
    // Title music carries continuously across MainMenu → CompanionSelect →
    // ArchetypeSelect; ensurePlaying is idempotent.
    TitleMusic.ensurePlaying(this)

    // Per-visit reset — Phaser reuses the scene instance across scene.start(),
    // so a stale selection from a prior visit must not leak into _beginRun().
    this._selectedId = null
    this._ngTier     = 0

    // Stop the menu scene(s) we replaced in the nav flow (started-over, not
    // stopped, by game.scene.start) + any in-flight gameplay scenes from a
    // previous run. scene.start only swaps the CALLING scene; parallel scenes
    // (Game / HudScene / NightPhase / DayPhase) stay alive otherwise. The
    // leak surfaces as the old DungeonRenderer's ROOM_PLACED handler firing
    // inside createGameState (its camera is null mid-teardown → boss-room
    // placement throws), plus the old NpcDirector making companions speak
    // each other's idle lines.
    const sm = this.scene
    for (const key of ['MainMenu', 'CompanionSelect', 'Game', 'NightPhase',
                       'DayPhase', 'EndOfDay', 'Graveyard', 'KnowledgeScreen', 'HudScene']) {
      if (sm.isActive(key) || sm.isPaused(key)) sm.stop(key)
    }

    import('../hud/ArchetypeSelectOverlay.js').then(({ ArchetypeSelectOverlay }) => {
      if (!this.scene.isActive()) return
      const game = window.__game
      if (game._archetypeSelectOverlay) game._archetypeSelectOverlay.close()
      game._archetypeSelectOverlay = new ArchetypeSelectOverlay(this)
      game._archetypeSelectOverlay.open()
    })

    this.events.once('shutdown', () => {
      const game = window.__game
      game?._archetypeSelectOverlay?.close()
      if (game) game._archetypeSelectOverlay = null
    })
  }

  // ─── Begin run ───────────────────────────────────────────────────────────
  // Called by the overlay's CONFIRM after it stamps `_selectedId` + `_ngTier`.
  _beginRun() {
    if (!this._selectedId) return
    // Defensive: refuse to start a run on a locked archetype even if something
    // other than the coin click ever set _selectedId.
    const gate = UNLOCK_GATES[this._selectedId]
    if (gate && !PlayerProfile.isAchievementUnlocked(gate.achId)) return

    // Pass the rooms cache so createGameState picks up `theme` + `tileLayout`
    // edits the user authored in the Room Editor onto the boss chamber.
    const rooms = this.cache.json.get('rooms')
    // Companion picked on the CompanionSelect screen (persisted to localStorage).
    // Validated against the registry so a stale / hand-edited value can't slip
    // through; an absent value defaults to the first companion.
    let companionId = DEFAULT_COMPANION
    try {
      const stored = localStorage.getItem('qf.companion')
      if (stored && COMPANIONS[stored]) companionId = stored
    } catch {}
    const state = createGameState(this._selectedId, rooms, companionId)
    // Reckoning NG+ (KR P7) — stamp the chosen tier (clamped to what's earned)
    // so the whole run scales harder. 0 = base campaign. Save-safe (plain int).
    state.meta.reckoningTier = Math.max(0, Math.min(this._ngTier ?? 0, PlayerProfile.getReckoningTier()))
    // Mango dev shortcut — MainMenu's "JUMP TO DAY 50" entry stamps one-shot
    // flags; read + clear them here so a normal run started afterward doesn't
    // pick up stale values. Plumbing the boss state before save means
    // BossSystem._init's migration path takes over (fills missing fields)
    // instead of fresh-initialising at level 1.
    this._applyDevStartOverrides(state)
    SaveSystem.save(state)
    // Stamp the chosen archetype into the per-name profile so the title-screen
    // throne-room backdrop can still render "your boss" after the save is
    // wiped on game-over.
    try { PlayerProfile.setLastArchetypeId?.(this._selectedId) } catch {}
    // Title music carries through into the dungeon; Game.create() ducks it to
    // a quieter background level via TitleMusic.duckForGameplay.
    this.scene.start('Game', { gameState: state })
  }

  // Consume the mango dev-start localStorage flags (set by MainMenu's "JUMP TO
  // DAY 50" entry) and stamp the resulting overrides onto the freshly-built
  // gameState. One-shot: flags are deleted immediately so the next NEW EVIL
  // starts a normal day-1 run.
  _applyDevStartOverrides(state) {
    let devDay = 0, devLv = 0
    try {
      devDay = parseInt(localStorage.getItem('qf.dev.startDayNumber') ?? '0', 10) || 0
      devLv  = parseInt(localStorage.getItem('qf.dev.startBossLevel') ?? '0', 10) || 0
    } catch {}
    try {
      localStorage.removeItem('qf.dev.startDayNumber')
      localStorage.removeItem('qf.dev.startBossLevel')
    } catch {}
    if (devDay > 1) {
      state.meta.dayNumber = devDay
      if (state.player) state.player.totalDaysElapsed = Math.max(0, devDay - 1)
    }
    if (devLv > 1) {
      const archs = this.cache.json.get('bossArchetypes') ?? []
      const arch  = archs.find(a => a.id === this._selectedId)
      const base  = arch?.baseFightStats ?? { hp: 200, attack: 12, defense: 10 }
      const lvOver = devLv - 1
      const maxHp = base.hp + lvOver * (Balance.BOSS_HP_PER_LEVEL ?? 15)
      state.boss = {
        instanceId:       'boss',
        hp:               maxHp,
        maxHp,
        attack:           base.attack  + lvOver * (Balance.BOSS_ATK_PER_LEVEL ?? 1),
        defense:          base.defense + lvOver * (Balance.BOSS_DEF_PER_LEVEL ?? 1),
        level:            devLv,
        xp:               0,
        xpToNext:         Math.round((Balance.BOSS_XP_BASE ?? 50) * Math.pow(Balance.BOSS_XP_SCALE ?? 1.5, lvOver)),
        deathsRemaining:  Balance.BOSS_DEFEATS_TO_GAME_OVER ?? 3,
        totalLivesEverHad: Balance.BOSS_DEFEATS_TO_GAME_OVER ?? 3,
      }
      console.info(`[Mango dev] Starting at day ${devDay} with boss level ${devLv} (HP ${maxHp} / ATK ${state.boss.attack} / DEF ${state.boss.defense}).`)
    }
  }
}
