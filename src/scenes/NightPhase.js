import { EventBus }      from '../systems/EventBus.js'
import { SaveSystem }    from '../systems/SaveSystem.js'
import { TILE, DungeonGrid as DungeonGridClass } from '../systems/DungeonGrid.js'
import { PathfinderSystem } from '../systems/PathfinderSystem.js'
import { createMinion }  from '../entities/Minion.js'
import { createTrap, trackTiles } from '../entities/Trap.js'
import { Balance }       from '../config/balance.js'
import { PALETTE, glowPanel, glowRect, makeBar, drawRoomIcon, spawnEmbers, applyUiCamera, showToast } from '../ui/UIKit.js'
import { ThemeManager, spriteCoverage } from '../systems/ThemeManager.js'
import { PauseManager }   from '../systems/PauseManager.js'
import { minionLabel }    from '../util/displayNames.js'
import { rollRivalDungeonSprites } from '../util/rivalDungeon.js'
import { getRotatedDef } from '../util/roomRotation.js'
import { pickWeightedClass } from '../util/classSpawn.js'
import { applyMerchantPrice, buildScaleMul } from '../util/merchantPricing.js'
import { trapCap, rosterCap } from '../util/slotCaps.js'
import { upgradeCost, nextTierInfo } from '../util/minionRevive.js'
import { h } from '../hud/dom.js'

const TS         = Balance.TILE_SIZE
const PANEL_W    = 230
const BOTTOM_H   = 64

// SettingsOverlay's GAMEPLAY > AUTOSAVE toggle. Default-on; gates the
// automatic phase-transition / end-of-day saves but NOT the explicit
// player-initiated save (ABANDON RUN, initial run save in ArchetypeSelect).
function _autosaveOn() {
  try { return localStorage.getItem('qf.gameplay.autosave') !== 'false' }
  catch { return true }
}

// Room category accent colours (match DungeonRenderer ROOM_STYLE)
const CAT_COLOR = {
  special:  0xaa22ff,
  starter:  0x0088cc,
  trap:     0xcc4422,
  treasure: 0xddaa22,
  combat:   0xcc2244,
  utility:  0x22cc88,
  default:  0x0088cc,
}

// Cardinal direction → unit tile vector (trap facing / wall-trap LOS).
const DIR = {
  N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },  W: { dx: -1, dy: 0 },
}

export class NightPhase extends Phaser.Scene {
  constructor() {
    super('NightPhase')
    this._gameState    = null
    this._dungeonGrid  = null
    this._roomDefs     = []
    this._minionDefs   = []
    this._trapDefs     = []
    this._selected     = null
    this._selectedKind = null   // 'room' | 'minion' | 'trap'
    this._preview      = null
    this._previewValid = false
    this._previewTileX = -1
    this._previewTileY = -1
    this._paletteCards = []      // currently-displayed cards (per active tab)
    this._paletteObjects = []    // every game object created for the active palette (for cleanup)
    this._paletteTab   = 'rooms' // 'rooms' | 'minions' | 'traps'
    this._paletteScrollY = 0     // vertical scroll offset within palette (Bug fix — palette overflowed when 17+ rooms unlocked)
    this._paletteContentHeight = 0  // total height of all cards on this tab
    this._statsTexts   = {}
    this._destroyEmbers = null
    this._lastPlaced   = null    // { kind: 'room' | 'minion', entity, goldCost } — for Ctrl+Z undo
    this._tabButtons      = []     // { container, label, key }
    this._rotation         = 0    // 0 | 90 | 180 | 270 — room placement rotation
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(data) {
    this._gameState = data?.gameState
    // Reset transient placement state — Phaser scene constructors only run
    // once (when the Game boots), so per-instance state from the previous
    // night phase carries over and breaks placement on day 2+.
    this._selected     = null
    this._selectedKind = null
    this._preview      = null
    this._previewValid = false
    this._previewTileX = -1
    this._previewTileY = -1
    this._paletteCards = []
    this._paletteObjects = []
    this._paletteTab   = 'rooms'
    this._paletteScrollY = 0
    this._lastPlaced   = null
    this._rotation     = 0
    this._trapFacing   = 'S'   // cannon / saw track orientation while placing a trap
    // Phase 31D — action-bar tool mode: 'sell' | 'move' | 'rotate' | null.
    // When armed, the next click on a placed room executes the action.
    this._toolMode     = null
    this._reassignMinionId = null   // minion being relocated via the Roster's REASSIGN
    // Phase: items — Door Lock forced trade-off. When the player clicks a
    // doorway with a Door Lock armed, we stage the lock (don't commit
    // yet), auto-select the Key Chest, and require they place it before
    // anything else. ESC during this state rolls back the staged lock.
    //   { stage: 'awaiting_chest', doorTiles: [{x,y}], goldCost: number }
    this._pendingTradeOff = null
    // MOVE tool — the placed trap currently being relocated (or null).
    this._heldMoveTrap = null
    // Disconnected-room highlighter — graphics + tracking set populated
    // when a Begin Day attempt fails because one or more rooms can't
    // reach the entry hall. Pulses red until the player fixes the
    // connectivity (re-checked on every ROOM_PLACED / ROOM_REMOVED).
    this._disconnectedHighlight = null
    this._disconnectedRoomIds   = new Set()
    this._disconnectErrorShown  = false
  }

  create() {
    // Phaser doesn't auto-invoke shutdown() on the user scene class —
    // it only fires a SHUTDOWN event. Bind it once so our cleanup
    // runs on scene.stop(). See Game.create() for the longer
    // explanation; this scene leaked the same way until it was fixed.
    this.events.once('shutdown', this.shutdown, this)
    const gameScene = this.scene.get('Game')
    this._dungeonGrid = gameScene.dungeonGrid

    const allRooms = this.cache.json.get('rooms') ?? []
    // Room redesign 2026-04-30 — palette filter is now allowlist + non-fixed.
    // Locked rooms (unlockLevel > current dungeonLevel) DO appear in the
    // palette but render with a 'L{N}' badge and reject selection — see
    // _renderRoomCards. Sorted by unlockLevel so unlocked rooms float up.
    this._roomDefs = allRooms.filter(r =>
      this._gameState.unlocks.rooms.includes(r.id) &&
      !r.placementRules?.fixed
    ).sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
    const allMinions = this.cache.json.get('minionTypes') ?? []
    // Only the starter (chain[0]) of each evolution chain is placeable —
    // higher tiers are reached by killing 2 adventurers without dying.
    const evolutions = this.cache.json.get('minionEvolutions') ?? {}
    const starterIds = new Set(
      Object.values(evolutions)
        .filter(v => Array.isArray(v?.chain))
        .map(v => v.chain[0])
    )
    this._minionDefs = allMinions.filter(m =>
      this._gameState.unlocks.minionTypes?.includes(m.id) && starterIds.has(m.id)
    ).sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
    const allTraps = this.cache.json.get('trapTypes') ?? []
    const blockedTraps = this._gameState.player?.archetypeModifiers?.blockedTrapTypes ?? []
    const blocksAll = blockedTraps.includes('*')
    this._trapDefs = blocksAll ? [] : allTraps.filter(t =>
      this._gameState.unlocks.trapTypes?.includes(t.id) && !blockedTraps.includes(t.id)
    )

    applyUiCamera(this)
    this._buildUI()
    this._buildPreview()
    this._setupInput()
    this._wireHudEvents()

    // Pre-roll tomorrow's adventurer wave BEFORE emitting NIGHT_PHASE_BEGAN
    // so RightPanels' listener picks up the freshly-stored preview on its
    // first render — emitting first then rolling caused the panel to show
    // empty until something else triggered a re-render.
    this._rollNextWavePreview()
    // Re-roll whenever the player does anything during the night that
    // could change the wave: sealing pacts (flag changes affect count
    // and class pool), placing/removing rooms (treasury count affects
    // baseCount). The preview stays current automatically.
    this._wirePreviewRerolls()
    EventBus.emit('NIGHT_PHASE_STARTED')
    EventBus.emit('NIGHT_PHASE_BEGAN')   // Phase 31C — HudScene listens to toggle build menu
    if (_autosaveOn()) SaveSystem.save(this._gameState)
  }

  // Roll the class-id list for the next day's wave so the IncomingWave
  // panel matches what actually spawns. Uses the same eligibility gate +
  // count formula as DayPhase._spawnDailyAdventurers; the actual day
  // spawn reads from this list instead of rolling fresh.
  //
  // Handles ALL spawn paths:
  //   * Event replacements (loot goblin heist / speedrunner / cartographers
  //     / tournament rivals / rival dungeon) — fixed compositions.
  //   * Twitch Con / Cosplay Contest — single-class wave overrides.
  //   * Vendetta hunter (35% chance) — pre-rolled and stored so the
  //     preview matches whether one will actually arrive.
  //   * Normal class-pool roll.
  //
  // Re-runs on PACT_SEALED, ROOM_PLACED, ROOM_REMOVED, and EVENT_FLAG_*
  // events so the preview stays accurate as the player changes the
  // dungeon mid-night. Emits WAVE_PREVIEW_UPDATED so RightPanels can
  // re-render.
  // Returns a same-day preview of the SAME event, if one exists — used so
  // an event's pre-rolled sprite arrays stay STABLE across the per-room-
  // placement re-rolls instead of reshuffling every time. null = roll fresh.
  _priorEventPreview(day, eventType) {
    const p = this._gameState.run?.nextWavePreview
    return (p && p.day === day && p.eventType === eventType) ? p : null
  }

  _rollNextWavePreview() {
    const gs = this._gameState
    if (!gs?.meta) return
    gs.run = gs.run ?? {}
    const day = (gs.meta.dayNumber ?? 1) + (gs.meta.phase === 'day' ? 1 : 0)
    const bossLv = gs.boss?.level ?? 1
    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const eventFlags = gs._eventFlags ?? {}

    // ── Event replacement waves ──────────────────────────────────
    // These bypass the normal class pool entirely. Compositions match
    // the corresponding _spawn*() methods in DayPhase exactly.
    if (eventFlags.lootGoblinHeistActive) {
      // Post-day-9 extras matching DayPhase._spawnLootGoblinHeist.
      const postTen = Math.max(0, day - 9) * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
      const PACK = 5 + postTen
      gs.run.nextWavePreview = {
        day, count: PACK,
        classIds: Array.from({ length: PACK }, () => 'loot_goblin'),
        eventType: 'lootGoblin',
        vendettaHunter: null,
      }
      return this._emitPreviewUpdated()
    }
    if (eventFlags.legendarySpeedrunnerActive) {
      gs.run.nextWavePreview = {
        day, count: 1,
        classIds: ['knight'],   // chassis preference: knight → barbarian → classes[0]
        eventType: 'speedrunner',
        vendettaHunter: null,
      }
      return this._emitPreviewUpdated()
    }
    if (eventFlags.cartographersConventionActive) {
      // Post-day-9 extras matching DayPhase._spawnCartographers.
      const postTen = Math.max(0, day - 9) * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
      const PARTY = 3 + postTen
      gs.run.nextWavePreview = {
        day, count: PARTY,
        classIds: Array.from({ length: PARTY }, () => 'cartographer_scholar'),
        eventType: 'cartographers',
        vendettaHunter: null,
      }
      return this._emitPreviewUpdated()
    }
    // Speedrun Channel — entire wave is locked to one random class
    // (pre-rolled by EventSystem at announce). NOT an early-return —
    // we fall through to the normal wave-size roll below, then force
    // every previewed adv's classId to the locked class right before
    // the preview object is built (see the speedrun lock block below).
    const _srLockedClass = (gs.events?.scheduledId === 'speedrun_channel'
      || eventFlags.speedrunChannelActive)
      ? eventFlags.speedrunChannelClassId
      : null
    // The Tournament is now ADDITIVE (the 3 rivals join the normal
    // daily wave, they don't replace it). So we DON'T early-return here
    // — we fall through to the normal wave roll below, then append the
    // 3 rivals to the resulting classIds (see the tournament append
    // block just before nextWavePreview is assembled).
    // ── Event waves that spawn non-LPC creatures ────────────────────
    // Each pre-rolls the EXACT sprites the spawn will use and stores them
    // on the preview so the IncomingWave / intel panels match the dungeon
    // view. Sprite arrays are parallel to `classIds`:
    //   minionSheets[i] — a `minion-<id>` sheet key (rival monsters,
    //                     zombies); null for slots that use the class LPC.
    //   bossSkin        — the rival boss's archetype skin id.
    //   spriteVariants  — `<class>/vNN` LPC variants (bounty hunters).
    // All kept STABLE across re-rolls via _priorEventPreview.
    if (eventFlags.rivalDungeonActive) {
      const prior = this._priorEventPreview(day, 'rivalDungeon')
      let minionSheets, bossSkin
      if (prior && Array.isArray(prior.minionSheets) && prior.bossSkin) {
        minionSheets = prior.minionSheets
        bossSkin     = prior.bossSkin
      } else {
        const rolled = rollRivalDungeonSprites(
          this.cache.json.get('minionEvolutions') ?? {}, gs.player?.bossArchetypeId)
        // 4 monster sheets + a null boss slot — parallel to classIds.
        minionSheets = [...rolled.minionSheets, null]
        bossSkin     = rolled.bossSkin
      }
      gs.run.nextWavePreview = {
        day, count: 5,
        classIds: ['monster_invader', 'monster_invader', 'monster_invader', 'monster_invader', 'rival_boss_invader'],
        eventType: 'rivalDungeon',
        minionSheets, bossSkin,
        vendettaHunter: null,
      }
      return this._emitPreviewUpdated()
    }
    // Boss Royale — one of every OTHER boss archetype (excluding the
    // player's own) storms the dungeon. Preview shows the full roster as
    // rival_boss_invader stubs, each wearing its archetype boss skin via
    // the parallel `bossSkins` array (AdvIntelOverlay reads bossSkins[i]).
    // Check scheduledId too (not just the active flag) so the preview
    // shows during the PLANNING night — the flag isn't set until
    // DAY_PHASE_BEGAN, same as the speedrun_channel lock above.
    if (eventFlags.bossRoyaleActive || gs.events?.scheduledId === 'boss_royale') {
      const archetypes = this.cache.json.get('bossArchetypes') ?? []
      const playerArch = gs.player?.bossArchetypeId
      const roster = archetypes.filter(a => a?.id && a.id !== playerArch).map(a => a.id)
      gs.run.nextWavePreview = {
        day, count: roster.length,
        classIds: roster.map(() => 'rival_boss_invader'),
        eventType: 'bossRoyale',
        bossSkins: roster.slice(),
        vendettaHunter: null,
      }
      return this._emitPreviewUpdated()
    }
    if (eventFlags.zombieHordeActive) {
      // Horde size scales with boss level + post-day-9 escalation — matches
      // DayPhase._spawnZombieHorde.
      const postTen = Math.max(0, day - 9) * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
      const HORDE = Balance.ZOMBIE_HORDE_BASE
        + Balance.ZOMBIE_HORDE_PER_BOSS_LV * Math.max(0, bossLv - 1)
        + postTen
      const Z = ['minion-zombie1', 'minion-zombie2', 'minion-zombie3']
      const prior = this._priorEventPreview(day, 'zombieHorde')
      const minionSheets = (prior && Array.isArray(prior.minionSheets)
        && prior.minionSheets.length === HORDE)
        ? prior.minionSheets
        : Array.from({ length: HORDE }, () => Z[Math.floor(Math.random() * Z.length)])
      gs.run.nextWavePreview = {
        day, count: HORDE,
        classIds: Array.from({ length: HORDE }, () => 'monster_invader'),
        eventType: 'zombieHorde',
        minionSheets,
        vendettaHunter: null,
      }
      return this._emitPreviewUpdated()
    }
    if (eventFlags.bountyHuntersActive) {
      // Post-day-9 extras matching DayPhase._spawnBountyHunterWave.
      const postTen = Math.max(0, day - 9) * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
      const PACK = 5 + postTen
      const prior = this._priorEventPreview(day, 'bountyHunters')
      const bhVars = this.cache.json.get('adventurerManifest')?.variants?.bounty_hunter
      const spriteVariants = (prior && Array.isArray(prior.spriteVariants)
        && prior.spriteVariants.length === PACK)
        ? prior.spriteVariants
        : Array.from({ length: PACK }, () => (Array.isArray(bhVars) && bhVars.length)
            ? `bounty_hunter/${bhVars[Math.floor(Math.random() * bhVars.length)].id}`
            : null)
      gs.run.nextWavePreview = {
        day, count: PACK,
        classIds: Array.from({ length: PACK }, () => 'ranger'),
        spriteVariants,
        eventType: 'bountyHunters',
        vendettaHunter: null,
      }
      return this._emitPreviewUpdated()
    }
    // The Saboteur is ADDITIVE — a masked rogue joins the normal wave.
    // Like the Tournament, it does NOT early-return: it falls through to
    // the normal roll and appends a rogue slot (see the saboteur append
    // block just before nextWavePreview is assembled).

    // ── Normal wave (eligible class pool + count formula) ────────
    let classes = allClasses.filter(c =>
      (c.unlockLevel ?? 1) <= bossLv &&
      (c.unlockDay   ?? 1) <= day,
    )
    // Twitch Con — entire wave is twitch_streamer. Bypasses unlock gates.
    if (eventFlags.twitchConActive) {
      const ts = allClasses.find(c => c.id === 'twitch_streamer')
      if (ts) classes = [ts]
    }
    // Cosplay Contest — entire wave is cosplay_adventurer. Same bypass.
    if (eventFlags.cosplayContestActive) {
      const cos = allClasses.find(c => c.id === 'cosplay_adventurer')
      if (cos) classes = [cos]
    }
    // PATCH 0.0.0 — entire wave is cheater. Same bypass.
    if (eventFlags.patchZeroActive) {
      const ch = allClasses.find(c => c.id === 'cheater')
      if (ch) classes = [ch]
    }
    // Treasure Hunters raid — the loot-raid wave never includes Twitch
    // Streamers or Cheaters (their kits don't fit a gold raid). Gate on the
    // SCHEDULED id since this preview is for the upcoming day and the active
    // flag isn't set until day-begin. Kept AFTER the single-class event
    // replacements so it only ever trims the normal pool.
    if (gs.events?.scheduledId === 'treasure_hunters') {
      classes = classes.filter(c => c.id !== 'twitch_streamer' && c.id !== 'cheater')
    }
    if (classes.length === 0) {
      gs.run.nextWavePreview = { day, count: 0, classIds: [], vendettaHunter: null, eventType: null }
      return this._emitPreviewUpdated()
    }
    // Reach for any prior preview for THIS same day. Used below to
    // stabilise both the regular class picks and the vendetta hunter
    // 35% coin — without this, every re-roll picks fresh randoms and
    // the panel flips classes on every room placement.
    const prev = gs.run.nextWavePreview && gs.run.nextWavePreview.day === day
      ? gs.run.nextWavePreview
      : null
    // Mirror DayPhase's baseCount calculation. Keep ordering identical
    // so the preview tracks the actual spawn exactly when no last-second
    // flags fire between night and day.
    let baseCount = (Balance.ADVENTURERS_PER_DAY_BASE ?? 2) + Math.floor((day - 1) / 2)
    // Post-day-9 wave-size escalation — matches DayPhase spawn.
    const postTenAdvs = Math.max(0, day - 9)
    if (postTenAdvs > 0) baseCount += postTenAdvs * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
    const treasuryCount = (gs.dungeon?.rooms ?? [])
      .filter(r => r.definitionId === 'treasury' && r.isActive !== false).length
    if (treasuryCount > 0) baseCount += treasuryCount
    if ((gs._mechanicFlags ?? {}).goldRush) baseCount += 1
    const gildedExtras = (gs._mechanicFlags ?? {}).gildedDemiseExtraAdvs ?? 0
    if (gildedExtras > 0) baseCount += gildedExtras
    if ((gs._mechanicFlags ?? {}).doomsdayRaidToday) {
      const mult = Balance.MECHANIC_DOOMSDAY_WAVE_MULT ?? 2
      baseCount = Math.round(baseCount * mult)
    }
    const extraAdvs = (gs._mechanicFlags ?? {}).extraAdvsPerDay ?? 0
    if (extraAdvs > 0) baseCount += extraAdvs
    if (eventFlags.guildRaidActive) baseCount *= 2
    if (eventFlags.negotiationOutcome === 'pay')    baseCount = 0
    if (eventFlags.negotiationOutcome === 'refuse') baseCount = Math.round(baseCount * 1.5)
    const subBonus = gs.player?.subscriberRevengeBonus ?? 0
    if (subBonus > 0) baseCount += subBonus
    // Mirror DayPhase: no class-diversity cap. See the long comment at
    // the matching call site in DayPhase._spawnDailyAdventurers.
    const count = Math.max(0, Math.floor(baseCount))

    // Vendetta hunter pre-roll. DayPhase rolls 0.35 fresh; here we roll
    // it now and persist the outcome so the preview matches reality.
    // The hunter is added to the front of classIds when present.
    //
    // Stability: if the prior preview already decided on a hunter
    // outcome for this same day + same vendetta target, carry that
    // forward. Without this, every re-roll flips the 35% coin again
    // and the player sees the hunter blink in/out as they place rooms.
    const vendetta = this._pickActiveVendettaForPreview()
    const prevHunter = (prev && prev.day === day) ? prev.vendettaHunter : null
    const prevTargetsSameMinion = prevHunter &&
      prevHunter.minionInstanceId === (vendetta?.minionInstanceId ?? null)
    let vendettaHunterPresent
    if (!vendetta) {
      vendettaHunterPresent = false
    } else if (prevTargetsSameMinion || prevHunter === null && prev?.day === day) {
      // Prior preview made a decision (yes-hunter or no-hunter) about
      // this same vendetta target — keep it.
      vendettaHunterPresent = !!prevHunter
    } else {
      vendettaHunterPresent = Math.random() < 0.35
    }

    if (count <= 0 && !vendettaHunterPresent) {
      gs.run.nextWavePreview = {
        day, count: 0, classIds: [],
        vendettaHunter: null, eventType: null,
      }
      return this._emitPreviewUpdated()
    }

    // classIds is JUST the regular wave (consumed 1:1 by DayPhase's
    // main spawn loop). The vendetta hunter is tracked separately so
    // DayPhase's vendetta path can match the pre-rolled outcome
    // without confusing the cursor.
    //
    // Stability: reuse the prior preview's class picks for slots that
    // still exist (same day, slot index unchanged). Only NEW slots
    // (count grew) get a fresh random roll; SHRUNK counts truncate
    // from the end. Without this, every ROOM_PLACED re-roll would
    // pick new random classes — the player sees one class in the
    // panel, places a corridor, gets a different class on BEGIN DAY.
    const reusable = (prev && Array.isArray(prev.classIds)) ? prev.classIds : []
    const reusableVariants = (prev && Array.isArray(prev.spriteVariants)) ? prev.spriteVariants : []
    const classIds = []
    // Parallel array of pre-rolled spriteVariant strings ("knight/v07",
    // "cosplay_adventurer/v23", etc.) — DayPhase stamps each onto the
    // matching adv when it spawns, so the IncomingWave panel can show
    // the EXACT character that will arrive (not a generic class
    // placeholder). Format mirrors AdventurerRenderer's adv.spriteVariant.
    const spriteVariants = []
    for (let i = 0; i < count; i++) {
      const carryClass = reusable[i]
      const carryVar   = reusableVariants[i]
      const stillEligible = carryClass && classes.some(c => c.id === carryClass)
      let chosenClass, chosenVar
      if (_srLockedClass) {
        // Speedrun Channel — every previewed adv is the locked class.
        // Variant freshly picked from the locked class's pool so
        // sprites stay varied within the same class.
        chosenClass = _srLockedClass
        chosenVar = this._pickWaveVariant(chosenClass)
      } else if (stillEligible) {
        chosenClass = carryClass
        // Reuse the prior variant only if it's a string. Falls through
        // to a fresh pick when this is a save from before variant
        // pre-rolling shipped.
        chosenVar = (typeof carryVar === 'string' && carryVar.includes('/'))
          ? carryVar
          : this._pickWaveVariant(chosenClass)
      } else {
        // Weighted pick — respects per-class spawnWeight (default 1.0).
        // Cheater is 0.25 so ~4× rarer than a default class once
        // unlocked at boss level 2.
        chosenClass = (pickWeightedClass(classes) ?? classes[0]).id
        chosenVar = this._pickWaveVariant(chosenClass)
      }
      classIds.push(chosenClass)
      spriteVariants.push(chosenVar)
    }
    // The Tournament ("Bloodsport") — the 3 rivals join the normal wave.
    // They're APPENDED to classIds/spriteVariants (after the player-wave
    // slots) so the IncomingWave panel shows them, while `count` and the
    // leading `count` slots stay = the normal wave: DayPhase's spawn loop
    // only consumes the first `count` ids (bounded by its own loop), and
    // the rivals themselves are spawned independently by
    // _spawnTournamentRivals. `tournamentRivalCount` lets the panel add
    // them to its displayed total.
    let tournamentRivalCount = 0
    if (eventFlags.tournamentActive) {
      const rivalIds = ['tournament_rival_warrior', 'tournament_rival_rogue', 'tournament_rival_mage']
      for (const rid of rivalIds) {
        classIds.push(rid)
        spriteVariants.push(this._pickWaveVariant(rid))
      }
      tournamentRivalCount = rivalIds.length
    }
    // The Saboteur joins the normal wave too (additive event) — append a
    // rogue slot so the IncomingWave panel shows the extra body.
    let saboteurCount = 0
    if (eventFlags.saboteurActive) {
      classIds.push('rogue')
      spriteVariants.push(this._pickWaveVariant('rogue'))
      saboteurCount = 1
    }

    // Phase QW (Library tiers) — pre-roll personalities for each normal
    // wave slot so the AdvIntel panel can reveal them at Library count >= 2
    // and DayPhase consumes the same set when the wave actually spawns
    // (so the panel's truth = the dungeon's truth). Mirrors DayPhase's
    // per-adv roll exactly: pCount = 1 + floor((bossLv-1)/5), same
    // PersonalitySystem.rollPersonalities call. Reuses prior preview's
    // picks for slots that still exist (same stability rule as classIds /
    // spriteVariants) so re-rolls on ROOM_PLACED don't flip personalities
    // the player just read.
    const _pSys = this.scene.get('Game')?.personalitySystem
    const pCount = 1 + Math.floor((bossLv - 1) / 5)
    const reusablePersonalities = (prev && Array.isArray(prev.personalityIds))
      ? prev.personalityIds : []
    const personalityIds = []
    for (let i = 0; i < count; i++) {
      const carry = reusablePersonalities[i]
      if (Array.isArray(carry) && carry.length > 0) {
        personalityIds.push([...carry])
      } else if (_pSys?.rollPersonalities) {
        personalityIds.push(_pSys.rollPersonalities(pCount, bossLv) ?? [])
      } else {
        personalityIds.push([])
      }
    }
    // Tournament rivals + Saboteur append extra slots to classIds — give
    // them empty personality slots to keep parallel array shapes aligned.
    for (let i = 0; i < tournamentRivalCount + saboteurCount; i++) personalityIds.push([])

    gs.run.nextWavePreview = {
      day,
      count,
      tournamentRivalCount,
      saboteurCount,
      classIds,
      spriteVariants,
      personalityIds,
      eventType: tournamentRivalCount > 0 ? 'tournament'
        : (saboteurCount > 0 ? 'saboteur' : null),
      vendettaHunter: vendettaHunterPresent
        ? { claimantClass: vendetta?.claimantClass ?? null,
            spriteVariant: this._pickWaveVariant(vendetta?.claimantClass),
            minionInstanceId: vendetta?.minionInstanceId ?? null,
            itemInstanceId:   vendetta?.itemInstanceId   ?? null,
            avengeeName:      vendetta?.avengeeName      ?? null }
        : null,
    }
    this._emitPreviewUpdated()
  }

  // Mirror DayPhase._pickActiveVendetta so the preview reads from the
  // same data source. Returns the most-recent vendetta whose target
  // minion is still alive in the dungeon faction.
  _pickActiveVendettaForPreview() {
    const list = this._gameState?.vendettas ?? []
    if (list.length === 0) return null
    const stillAlive = list.filter(v => {
      const m = this._gameState.minions?.find(min => min.instanceId === v.minionInstanceId)
      return !!m && m.aiState !== 'dead' && m.faction === 'dungeon'
    })
    if (stillAlive.length === 0) return null
    return stillAlive[stillAlive.length - 1]
  }

  // Pick a deterministic-but-random LPC variant for a class. Mirrors
  // AdventurerRenderer._buildLpcSprite's lookup (use the class's own
  // bake when present, else fall through to its spriteSourceClassId
  // defined in adventurerClasses.json — e.g. event-only classes that
  // borrow art from a baked sibling). Returns "<sourceClass>/vNN".
  // Preload bakes 50 variants per baked class (ADVENTURER_VARIANTS_PER_CLASS).
  _pickWaveVariant(classId) {
    if (!classId) return null
    const allClasses = this.cache?.json?.get?.('adventurerClasses') ?? []
    const def = allClasses.find(c => c.id === classId)
    // Use the class's own bake when it has one; otherwise borrow art
    // from spriteSourceClassId (declared on event-only classes that
    // don't ship their own LPC sheet, like tournament_rival_*,
    // monster_invader, etc.).
    const sourceClass = def?.spriteSourceClassId || classId
    // 50 baked variants per class — pad to v01..v50.
    const n = 1 + Math.floor(Math.random() * 50)
    const v = `v${String(n).padStart(2, '0')}`
    return `${sourceClass}/${v}`
  }

  _emitPreviewUpdated() {
    EventBus.emit('WAVE_PREVIEW_UPDATED', {
      preview: this._gameState?.run?.nextWavePreview ?? null,
    })
  }

  // Phase 31C — HUD chrome moved to HudScene. We listen for the build/tool
  // events that the new ActionBar + BuildMenu emit, fold them into the
  // existing _selectItem / _beginDay flows. Tool-mode events (rotate / move /
  // sell) currently no-op here; full wiring lands in 31D.
  _wireHudEvents() {
    // Defensive: if create() ran without an intervening shutdown (Phaser
    // scene.restart() during a window resize is one path that triggers
    // this), _hudListeners may still hold prior arrow-fn references that
    // are also still in EventBus. Resetting the array would orphan them
    // and we'd end up double-firing every BUILD_SELECT / TOOL_MOVE etc.,
    // which toggle internal state and cancel themselves out.
    if (this._hudListeners?.length) {
      for (const [evt, fn] of this._hudListeners) EventBus.off(evt, fn)
    }
    this._hudListeners = []
    const on = (event, fn) => {
      EventBus.on(event, fn, this)
      this._hudListeners.push([event, fn])
    }
    // Minion Roster — SACRIFICE button (2026-06-02). Permanently destroy a
    // minion with NO gold refund (vs the Sell tool's 50%). Was previously inert
    // (RosterOverlay emitted MINION_SACRIFICE_REQUEST with no listener).
    on('MINION_SACRIFICE_REQUEST', ({ instanceId } = {}) => this._doSacrificeMinion(instanceId))
    // Minion Roster — REASSIGN button (2026-06-02). Enter a "click a room"
    // mode; the next dungeon click relocates the chosen minion to that room
    // (free move). Handled in the tool-mode click dispatch → _executeReassignAt.
    on('MINION_REASSIGN_BEGIN', ({ instanceId } = {}) => {
      this._reassignMinionId = instanceId ?? null
      if (!this._reassignMinionId) return
      this._setToolMode('reassign', 'roster_reassign')
      EventBus.emit('SHOW_TOAST', { message: 'Click a room to reassign the minion (ESC to cancel)', type: 'info' })
    })
    on('BUILD_SELECT', ({ def, kind }) => {
      // Phase 1b.4 — Lich Phylactery: item placement flows through the same
      // single-tile path as traps. _confirmItemPlacement handles validation.
      // Forced-placement guard: while a trade-off is pending the player
      // can't switch to a different item — they must commit the trade-off
      // (or ESC / right-click out). Allowed item id depends on what's
      // pending (key_chest for Door Lock, healing_fountain for Beacon).
      if (this._pendingTradeOff) {
        const required = this._pendingTradeOff.kind === 'beacon'
          ? 'healing_fountain' : 'key_chest'
        if (def?.id !== required) {
          this._showPlacementError(
            this._pendingTradeOff.kind === 'beacon'
              ? 'Place the Healing Fountain first (ESC to cancel)'
              : 'Place the Key Chest first (ESC to cancel)'
          )
          return
        }
      }
      this._setToolMode(null, 'build_select')
      this._selectItem(def, kind)
    })
    on('PHASE_TOGGLE_REQUEST', () => {
      if (this._gameState.meta?.phase === 'night') this._beginDay()
    })
    on('TOOL_MOVE',    () => this._setToolMode('move', 'tool_move_btn'))
    on('TOOL_SELL',    () => this._setToolMode('sell', 'tool_sell_btn'))
    on('TOOL_UPGRADE', () => this._setToolMode('upgrade', 'tool_upgrade_btn'))
    // Phase 31D — any other action-bar button click also disarms a sticky
    // tool. The button's own effect still fires (whichever scene listens
    // for the OPEN_* / TIME_SCALE_SET event); we just make sure MOVE / SELL
    // don't linger after the player moves on.
    on('OPEN_MINION_ROSTER', () => this._setToolMode(null, 'open_roster'))
    on('OPEN_KNOWLEDGE_MAP', () => this._setToolMode(null, 'open_knowledge'))
    on('OPEN_ADV_INTEL',     () => this._setToolMode(null, 'open_adv_intel'))
    on('OPEN_BOSS_OVERVIEW', () => this._setToolMode(null, 'open_boss_overview'))
    on('OPEN_PAUSE_MENU',    () => this._setToolMode(null, 'open_pause_menu'))
    on('TIME_SCALE_SET',     () => this._setToolMode(null, 'time_scale_set'))
    // Connectivity highlight auto-refresh — when a room is added or
    // removed, re-check what (if anything) is still disconnected and
    // update the pulse. Clears entirely when the player fixes the issue.
    const refreshDisc = () => this._refreshDisconnectedHighlight()
    on('ROOM_PLACED',  refreshDisc)
    on('ROOM_REMOVED', refreshDisc)
  }

  // Phase 31D — arm/cancel a build-mode tool. Clicking the action-bar tool
  // button toggles the mode; the next pointer click on a placed room
  // executes the action. Right-click / Esc / picking another build slot
  // all cancel the tool. Re-clicking the same tool also cancels.
  //
  // `source` is a short string ('user', 'build_select', 'open_panel',
  // 'begin_day', etc.) recorded on the change for diagnostics — playtest
  // is reporting move-mode exiting on void clicks and the static trace
  // doesn't show a path that could do it, so we log every transition
  // with its source until the culprit is identified.
  _setToolMode(mode, source = 'unknown') {
    const next = (this._toolMode === mode) ? null : mode
    if (next === this._toolMode) return
    const prev = this._toolMode
    this._toolMode = next
    // Leaving REASSIGN (clicked away, ESC, picked another tool) drops the
    // pending minion so a stale id can never relocate the wrong unit later.
    if (prev === 'reassign') this._reassignMinionId = null
    if (prev === 'move' && next === null) {
      // Silent diagnostic — kept as a console-only paper trail in case
      // another phantom MOVE-clear regression turns up. The user-facing
      // toast was removed once we identified the PLACE-button auto-
      // disarm as the original culprit. Trim the stack to ~5 frames
      // so it's still readable from a console screenshot.
      const trace = (new Error('stack').stack ?? '').split('\n').slice(2, 7).join('\n')
      console.warn(`[NightPhase] MOVE mode cleared (source=${source})\n${trace}`)
    }
    // Selecting a tool cancels any pending placement. Disarming the MOVE tool
    // mid-carry must also cancel (which rolls the carried trap/item back to its
    // pickup tile) so a held entity is never left stranded on the cursor tile.
    if (next || this._heldMoveTrap || this._heldMoveItem) this._cancelSelection()
    EventBus.emit('TOOL_MODE_CHANGED', { mode: next, source })
  }

  shutdown() {
    this._destroyEmbers?.()
    this._preview?.destroy()
    this._preview = null
    this._rotLabel?.destroy()
    this._rotLabel = null
    this._disconnectedHighlight?.destroy()
    this._disconnectedHighlight = null
    this._disconnectedRoomIds   = new Set()
    this._disconnectErrorShown  = false
    if (this._hudListeners) {
      for (const [evt, fn] of this._hudListeners) EventBus.off(evt, fn, this)
      this._hudListeners = []
    }
    // Detach the wave-preview re-roll subscriptions installed by
    // _wirePreviewRerolls so they don't leak across scene restarts.
    if (this._previewRerollListeners) {
      for (const [evt, fn] of this._previewRerollListeners) EventBus.off(evt, fn)
      this._previewRerollListeners = []
    }
  }

  // Re-roll the wave preview whenever something changes during the night
  // that would alter the next day's spawn (pact flags, room placements,
  // etc.). Keeps the IncomingWave panel accurate without forcing the
  // player to do anything special.
  _wirePreviewRerolls() {
    if (this._previewRerollListeners?.length) {
      // Defensive — if create() ran twice without a shutdown, old listeners
      // would still be live. Reset before re-attaching.
      for (const [evt, fn] of this._previewRerollListeners) EventBus.off(evt, fn)
    }
    this._previewRerollListeners = []
    const reroll = () => this._rollNextWavePreview()
    const sub = (evt) => {
      EventBus.on(evt, reroll)
      this._previewRerollListeners.push([evt, reroll])
    }
    // Pacts can flip _mechanicFlags (gold_rush, doomsday, etc.) or
    // _eventFlags (guildRaid, etc.) — re-roll captures the new state.
    sub('PACT_SEALED')
    // Treasury rooms add +1 to baseCount each; placement/removal during
    // night changes the next-day count.
    sub('ROOM_PLACED')
    sub('ROOM_REMOVED')
    // Any dungeon event that fires during night sets _eventFlags.* —
    // catch the announcement so we re-roll into the event-replacement
    // wave (or back out of one if it gets cancelled somewhere).
    sub('DUNGEON_EVENT_ANNOUNCED')
    sub('DUNGEON_EVENT_CLEARED')
  }

  // ── UI construction ───────────────────────────────────────────────────────

  _buildUI() {
    // Phase 31C — HUD chrome relocated to HudScene (BossTopBar / BuildMenu /
    // ActionBar / KnowledgePin / DungeonLog). NightPhase no longer renders
    // its own left palette, bottom bar, or hint strip. The legacy
    // _buildLeftPanel / _buildBottomBar / _buildHints / _buildPalette /
    // _refreshStats methods stay on the class as dead code (callers like
    // _confirmPlacement still hit _refreshStats and _renderActivePalette;
    // those now no-op via early returns at their tops).
    //
    // The ember atmosphere stays — it's set-dressing, not chrome.
    this._destroyEmbers = spawnEmbers(this, 8, { depth: 5, colors: [0x9b32d4, 0x0088cc] })
  }

  // ── Left palette panel ────────────────────────────────────────────────────

  _buildLeftPanel(W, H) {
    const g = this.add.graphics().setDepth(10)
    glowPanel(g, 0, 0, PANEL_W, H - BOTTOM_H, { fill: PALETTE.panelBg, border: PALETTE.panelBorder, glow: PALETTE.accent })

    // Divider line on right edge
    g.lineStyle(1, PALETTE.accent, 0.4)
    g.beginPath()
    g.moveTo(PANEL_W, 0)
    g.lineTo(PANEL_W, H - BOTTOM_H)
    g.strokePath()

    // Header
    this.add.text(PANEL_W / 2, 14, 'NIGHT PHASE', {
      fontSize: '11px', color: PALETTE.textAccent, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(11)

    this.add.text(PANEL_W / 2, 28, '— BUILD YOUR DUNGEON —', {
      fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
    }).setOrigin(0.5, 0).setDepth(11)

    // Separator
    const gs = this.add.graphics().setDepth(10)
    gs.lineStyle(1, PALETTE.panelBorder, 0.6)
    gs.beginPath(); gs.moveTo(12, 46); gs.lineTo(PANEL_W - 12, 46); gs.strokePath()

    // Stats
    this._buildStats(gs)

    // Palette cards
    this._buildPalette()
  }

  _buildStats(g) {
    const x = 14
    let y = 54

    const row = (label, key, color = PALETTE.textDim) => {
      this.add.text(x, y, label, {
        fontSize: '9px', color, fontFamily: 'monospace',
      }).setDepth(11)
      const val = this.add.text(PANEL_W - 12, y, '—', {
        fontSize: '9px', color: PALETTE.textNormal, fontFamily: 'monospace',
      }).setOrigin(1, 0).setDepth(11)
      this._statsTexts[key] = val
      y += 14
    }

    row('Day',            'day',     PALETTE.textDim)
    row('Dungeon Level',  'dlevel',  PALETTE.textAccent)
    row('Gold',           'gold',    PALETTE.textCyan)
    row('XP',             'xp',      PALETTE.textAccent)
    row('Rooms placed',   'rooms',   PALETTE.textDim)
    row('Roster',         'roster',  PALETTE.textDim)
    row('Traps',          'traps',   PALETTE.textDim)

    // Separator
    g.lineStyle(1, PALETTE.panelBorder, 0.5)
    g.beginPath(); g.moveTo(12, y + 2); g.lineTo(PANEL_W - 12, y + 2); g.strokePath()

    // Library of Whispers forecast — title + multi-line body. Hidden when
    // no forecast (no Library room or fresh game). Updated in _refreshStats.
    this._whispersTitle = this.add.text(x, y + 8, '', {
      fontSize: '9px', color: PALETTE.textAccent, fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(11).setVisible(false)
    this._whispersBody = this.add.text(x, y + 22, '', {
      fontSize: '9px', color: PALETTE.textNormal, fontFamily: 'monospace', lineSpacing: 2,
      wordWrap: { width: PANEL_W - 24 },
    }).setDepth(11).setVisible(false)

    this._statsY = y + 8
    this._refreshStats()
  }

  _refreshStats() {
    // Phase 31C — chrome moved to HudScene; bail when the legacy stats
    // panel hasn't been built (which is now the case on every load).
    if (!this._statsTexts || !this._statsTexts.day) return
    const s = this._gameState

    this._statsTexts.day?.setText(`Day ${s.meta.dayNumber}`)
    this._statsTexts.dlevel?.setText(`LV ${s.boss?.level ?? 1}`)
    this._statsTexts.gold?.setText(`${s.player.gold}`)
    this._statsTexts.xp?.setText(`${s.meta?.xp ?? 0} / ${s.meta?.xpToNext ?? 100}`)
    this._statsTexts.rooms?.setText(`${s.dungeon.rooms.length}`)
    const rosterCap  = this._rosterCap()
    const rosterUsed = this._rosterUsed()
    const rosterFull = rosterCap > 0 && rosterUsed >= rosterCap
    const rosterEmpty = rosterCap === 0
    this._statsTexts.roster?.setText(`${rosterUsed}/${rosterCap}`)
      .setStyle({ color: rosterFull || rosterEmpty ? PALETTE.textRed : PALETTE.textDim })
    const trapCap  = this._trapCap()
    const trapUsed = this._trapUsed()
    const trapFull = trapCap > 0 && trapUsed >= trapCap
    const trapEmpty = trapCap === 0
    this._statsTexts.traps?.setText(`${trapUsed}/${trapCap}`)
      .setStyle({ color: trapFull || trapEmpty ? PALETTE.textRed : PALETTE.textDim })

    // Library forecast (Room redesign 2026-04-30)
    const forecast = s.meta.nextPartyPreview
    if (forecast && forecast.size > 0 && this._whispersTitle) {
      this._whispersTitle.setText('WHISPERS').setVisible(true)
      const breakdown = Object.entries(forecast.classCounts ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${n} ${id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`)
        .join(', ')
      this._whispersBody.setText(
        `Day ${forecast.day}: ${forecast.size} adventurer${forecast.size === 1 ? '' : 's'}\n${breakdown}`
      ).setVisible(true)
    } else if (this._whispersTitle) {
      this._whispersTitle.setVisible(false)
      this._whispersBody.setVisible(false)
    }
  }

  _buildPalette() {
    this._buildPaletteTabs()
    this._renderActivePalette()
    this._installPaletteMask()
  }

  // Bug fix — clip the palette content area so scrolled cards never bleed
  // into the bottom bar. Without this, the last card's description
  // overlaps the bar and looks half-rendered.
  _installPaletteMask() {
    const H = this.uiH
    const top = this._paletteContentY
    const bottom = H - BOTTOM_H - 1
    const maskShape = this.make.graphics({ x: 0, y: 0, add: false })
    maskShape.fillStyle(0xffffff)
    maskShape.fillRect(0, top, PANEL_W, Math.max(0, bottom - top))
    this._paletteMask = maskShape.createGeometryMask()
    // Apply mask to all currently-rendered palette objects
    for (const o of this._paletteObjects) {
      if (o?.setMask) o.setMask(this._paletteMask)
    }
  }

  _buildPaletteTabs() {
    const tabY = this._statsY + 6
    const tabH = 22
    const tabs = [
      { key: 'rooms',     label: `ROOMS ${this._roomDefs.length}` },
      { key: 'minions',   label: `MINIONS ${this._minionDefs.length}` },
      { key: 'traps',     label: `TRAPS ${this._trapDefs.length}` },
    ]
    const totalGap = 4
    const tabW = (PANEL_W - 20 - totalGap * (tabs.length - 1)) / tabs.length

    this._tabButtons.forEach(t => { t.container.destroy(); t.label.destroy() })
    this._tabButtons = []

    tabs.forEach(({ key, label }, i) => {
      const px = 10 + i * (tabW + totalGap)
      const py = tabY
      const cg = this.add.graphics().setDepth(11)
      const txt = this.add.text(px + tabW / 2, py + tabH / 2, label, {
        fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(12)

      const draw = (active) => {
        cg.clear()
        glowPanel(cg, px, py, tabW, tabH, {
          fill:   active ? 0x1a0a30 : 0x06060e,
          border: active ? PALETTE.accentBright : PALETTE.panelBorder,
          glow:   active ? PALETTE.accent : 0x1a0a30,
        })
      }
      draw(this._paletteTab === key)

      const hit = this.add.rectangle(px + tabW / 2, py + tabH / 2, tabW, tabH, 0, 0)
        .setDepth(13).setInteractive({ useHandCursor: true })
      hit.on('pointerdown', () => this._switchTab(key))

      this._tabButtons.push({ container: cg, label: txt, hit, draw, key })
    })
    this._paletteContentY = tabY + tabH + 8
  }

  _switchTab(key) {
    if (this._paletteTab === key) return
    this._cancelSelection()
    this._paletteTab = key
    // Reset scroll on tab switch — different tabs have different content lengths
    this._paletteScrollY = 0
    this._tabButtons.forEach(t => t.draw(t.key === key))
    this._renderActivePalette()
  }

  _renderActivePalette() {
    // Phase 31C — palette chrome moved to HudScene's BuildMenu. Bail unless
    // the legacy palette container exists (which it doesn't post-overhaul).
    if (this._paletteContentY == null) return
    // Tear down existing palette objects
    this._paletteObjects.forEach(o => o.destroy?.())
    this._paletteObjects = []
    this._paletteCards   = []

    this._renderActivePaletteInner()

    // Apply the mask to every freshly-rendered object so scroll-clipped
    // content stays within the panel viewport.
    if (this._paletteMask) {
      for (const o of this._paletteObjects) {
        if (o?.setMask) o.setMask(this._paletteMask)
      }
    }
  }

  _renderActivePaletteInner() {
    if (this._paletteTab === 'rooms') {
      this._renderRoomCards()
    } else if (this._paletteTab === 'minions') {
      this._renderMinionCards()
    } else if (this._paletteTab === 'traps') {
      this._renderTrapCards()
    }
  }

  _renderRoomCards() {
    const CARD_H = 60
    const CARD_W = PANEL_W - 20
    const startY = this._paletteContentY - this._paletteScrollY
    const gap    = 4

    // Hide cap-hit rooms; locked rooms stay visible with a 'L{N}' badge.
    // Cap honors per-boss-level scaling (Room redesign 2026-04-30).
    const dungeonLevel = this._gameState.boss?.level ?? 1
    const availableDefs = this._roomDefs.filter(def => {
      if (!DungeonGridClass.isUnlocked(def, dungeonLevel)) return true   // locked rooms shown for visibility
      const max = DungeonGridClass.effectiveMaxPerDungeon(def, dungeonLevel)
      if (max == null) return true
      return this._gameState.dungeon.rooms.filter(r => r.definitionId === def.id).length < max
    })
    this._paletteContentHeight = availableDefs.length * (CARD_H + gap)

    availableDefs.forEach((def, i) => {
      const cx = PANEL_W / 2
      const cy = startY + i * (CARD_H + gap) + CARD_H / 2
      const px = 10
      const py = startY + i * (CARD_H + gap)
      const catColor = CAT_COLOR[def.category] ?? CAT_COLOR.default
      const isLocked = !DungeonGridClass.isUnlocked(def, dungeonLevel)
      const titleAlpha = isLocked ? 0.45 : 1

      const cg = this.add.graphics().setDepth(10)
      glowPanel(cg, px, py, CARD_W, CARD_H, {
        fill: isLocked ? 0x040810 : 0x060c18,
        border: isLocked ? 0x1a1a24 : 0x0d1e30,
        glow:   isLocked ? 0x444466 : catColor,
      })
      cg.fillStyle(catColor, isLocked ? 0.18 : 0.5)
      cg.fillRect(px, py, CARD_W, 3)

      const iconG = this.add.graphics().setDepth(11)
      drawRoomIcon(iconG, px + 20, py + CARD_H / 2, def.id, isLocked ? 0x6a6a7a : catColor)
      iconG.setAlpha(titleAlpha)

      const nameTxt = this.add.text(px + 38, py + 8, def.name.toUpperCase(), {
        fontSize: '10px',
        color: isLocked ? PALETTE.textDim : PALETTE.textNormal,
        fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(11).setAlpha(titleAlpha)

      const dynCost   = applyMerchantPrice(this._gameState, def.id,
        Math.round(DungeonGridClass.effectiveRoomCost(def, this._gameState.dungeon?.rooms ?? [])
          * buildScaleMul(this._gameState)))
      const costStr   = dynCost > 0 ? `${dynCost} gold` : 'FREE'
      const costColor = isLocked ? PALETTE.textDim
                      : dynCost > 0 ? PALETTE.textCyan
                      : PALETTE.textGreen
      const sizeTxt = this.add.text(px + 38, py + 22, `${def.width}×${def.height}  ·  ${costStr}`, {
        fontSize: '8px', color: costColor, fontFamily: 'monospace',
      }).setDepth(11).setAlpha(titleAlpha)

      const desc = (def.description ?? '').slice(0, 48) + ((def.description?.length ?? 0) > 48 ? '…' : '')
      const descTxt = this.add.text(px + 6, py + 38, desc, {
        fontSize: '7px', color: PALETTE.textDim, fontFamily: 'monospace',
        wordWrap: { width: CARD_W - 12 },
      }).setDepth(11).setAlpha(titleAlpha)

      // Locked badge — small "🔒 L{N}" tag in the top-right of the card.
      let lockBadge = null
      if (isLocked) {
        lockBadge = this.add.text(px + CARD_W - 6, py + 6,
          `🔒 L${def.unlockLevel ?? '?'}`, {
            fontSize: '9px', color: '#ff8866', fontFamily: 'monospace', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 2,
          }).setOrigin(1, 0).setDepth(12)
      }

      const hit = this.add.rectangle(cx, cy, CARD_W, CARD_H, 0x000000, 0)
        .setDepth(12).setInteractive({ useHandCursor: true })

      hit.on('pointerover', () => {
        if (this._selected !== def) {
          cg.clear()
          glowPanel(cg, px, py, CARD_W, CARD_H, {
            fill: isLocked ? 0x080812 : 0x0a1525,
            border: isLocked ? 0x442233 : catColor,
            glow:   isLocked ? 0x664455 : catColor,
          })
          cg.fillStyle(catColor, isLocked ? 0.18 : 0.5); cg.fillRect(px, py, CARD_W, 3)
        }
      })
      hit.on('pointerout', () => {
        if (this._selected !== def) this._resetCard(cg, px, py, CARD_W, CARD_H, catColor, false)
      })
      hit.on('pointerdown', (p) => {
        if (p.rightButtonDown()) return
        if (isLocked) {
          this._showPlacementError(`${def.name} unlocks at dungeon level ${def.unlockLevel}`)
          return
        }
        this._selectItem(def, 'room')
      })

      this._paletteCards.push({ def, kind: 'room', cg, px, py, CARD_W, CARD_H, catColor, isLocked })
      this._paletteObjects.push(cg, iconG, nameTxt, sizeTxt, descTxt, hit)
      if (lockBadge) this._paletteObjects.push(lockBadge)
    })
  }

  _renderMinionCards() {
    const CARD_H = 56
    const CARD_W = PANEL_W - 20
    const startY = this._paletteContentY - this._paletteScrollY
    const gap    = 4
    const dungeonLevel = this._gameState.boss?.level ?? 1
    this._paletteContentHeight = this._minionDefs.length * (CARD_H + gap)

    if (this._minionDefs.length === 0) {
      const empty = this.add.text(PANEL_W / 2, startY + 20,
        'No minion types unlocked yet.', {
          fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
        }).setOrigin(0.5).setDepth(11)
      this._paletteObjects.push(empty)
      return
    }

    this._minionDefs.forEach((def, i) => {
      const cx = PANEL_W / 2
      const cy = startY + i * (CARD_H + gap) + CARD_H / 2
      const px = 10
      const py = startY + i * (CARD_H + gap)
      const catColor  = CAT_COLOR[def.category] ?? 0xddccaa
      const isLocked  = (def.unlockLevel ?? 1) > dungeonLevel
      const titleAlpha = isLocked ? 0.45 : 1

      const cg = this.add.graphics().setDepth(10)
      glowPanel(cg, px, py, CARD_W, CARD_H, {
        fill:   isLocked ? 0x040810 : 0x060c18,
        border: isLocked ? 0x1a1a24 : 0x0d1e30,
        glow:   isLocked ? 0x444466 : catColor,
      })
      cg.fillStyle(catColor, isLocked ? 0.18 : 0.5); cg.fillRect(px, py, CARD_W, 3)

      // Minion sigil square
      const sigilG = this.add.graphics().setDepth(11)
      sigilG.fillStyle(0x0a0e16, 1)
      sigilG.fillRect(px + 8, py + 14, 22, 22)
      sigilG.lineStyle(1, catColor, isLocked ? 0.3 : 1)
      sigilG.strokeRect(px + 8, py + 14, 22, 22)
      const sigilTxt = this.add.text(px + 19, py + 25, def.id[0].toUpperCase(), {
        fontSize: '12px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(12).setAlpha(titleAlpha)

      const nameTxt = this.add.text(px + 38, py + 6, def.name.toUpperCase(), {
        fontSize: '10px',
        color: isLocked ? PALETTE.textDim : PALETTE.textNormal,
        fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(11).setAlpha(titleAlpha)

      const stats = def.baseStats ?? {}
      const statTxt = this.add.text(px + 38, py + 20,
        `HP ${stats.hp}  ATK ${stats.attack}  DEF ${stats.defense}`,
        { fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace' }
      ).setDepth(11).setAlpha(titleAlpha)

      const costStr   = def.goldCost > 0 ? `${def.goldCost} gold` : 'FREE'
      const costColor = isLocked ? PALETTE.textDim
                      : def.goldCost > 0 ? PALETTE.textCyan : PALETTE.textGreen
      const costTxt = this.add.text(px + 38, py + 34, costStr, {
        fontSize: '8px', color: costColor, fontFamily: 'monospace',
      }).setDepth(11).setAlpha(titleAlpha)

      let lockBadge = null
      if (isLocked) {
        lockBadge = this.add.text(px + CARD_W - 6, py + 6,
          `🔒 L${def.unlockLevel ?? '?'}`, {
            fontSize: '9px', color: '#ff8866', fontFamily: 'monospace', fontStyle: 'bold',
          }).setOrigin(1, 0).setDepth(12)
      }

      const hit = this.add.rectangle(cx, cy, CARD_W, CARD_H, 0x000000, 0)
        .setDepth(12).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => {
        if (this._selected !== def) {
          cg.clear()
          glowPanel(cg, px, py, CARD_W, CARD_H, {
            fill:   isLocked ? 0x080812 : 0x0a1525,
            border: isLocked ? 0x442233 : catColor,
            glow:   isLocked ? 0x664455 : catColor,
          })
          cg.fillStyle(catColor, isLocked ? 0.18 : 0.5); cg.fillRect(px, py, CARD_W, 3)
        }
      })
      hit.on('pointerout', () => {
        if (this._selected !== def) this._resetCard(cg, px, py, CARD_W, CARD_H, catColor, false)
      })
      hit.on('pointerdown', (p) => {
        if (p.rightButtonDown()) return
        if (isLocked) {
          this._showPlacementError(`${def.name} unlocks at boss level ${def.unlockLevel}`)
          return
        }
        this._selectItem(def, 'minion')
      })

      this._paletteCards.push({ def, kind: 'minion', cg, px, py, CARD_W, CARD_H, catColor, isLocked })
      this._paletteObjects.push(cg, sigilG, sigilTxt, nameTxt, statTxt, costTxt, hit)
      if (lockBadge) this._paletteObjects.push(lockBadge)
    })
  }

  _renderTrapCards() {
    const CARD_H = 52
    const CARD_W = PANEL_W - 20
    const startY = this._paletteContentY - this._paletteScrollY
    const gap    = 4
    this._paletteContentHeight = this._trapDefs.length * (CARD_H + gap)

    if (this._trapDefs.length === 0) {
      const empty = this.add.text(PANEL_W / 2, startY + 20,
        'No traps unlocked yet.', {
          fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
        }).setOrigin(0.5).setDepth(11)
      this._paletteObjects.push(empty)
      return
    }

    // Per-trap-id palette card colour. Add an entry per new trap or it
    // falls back to `default`. Kept tiny on purpose — we'll grow it as
    // new traps land.
    const TRAP_COLOR = { default: 0x888888 }

    this._trapDefs.forEach((def, i) => {
      const cx = PANEL_W / 2
      const cy = startY + i * (CARD_H + gap) + CARD_H / 2
      const px = 10
      const py = startY + i * (CARD_H + gap)
      const catColor = TRAP_COLOR[def.id] ?? TRAP_COLOR.default

      const cg = this.add.graphics().setDepth(10)
      glowPanel(cg, px, py, CARD_W, CARD_H, {
        fill: 0x060c18, border: 0x0d1e30, glow: catColor,
      })
      cg.fillStyle(catColor, 0.5); cg.fillRect(px, py, CARD_W, 3)

      const nameTxt = this.add.text(px + 10, py + 6, def.name.toUpperCase(), {
        fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(11)

      const trigTxt = this.add.text(px + 10, py + 20, _formatTrigger(def.triggerCondition), {
        fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(11)

      const costStr = `${this._effectiveTrapCost(def)} gold  ·  ${def.baseDamage} dmg`
      const costTxt = this.add.text(px + 10, py + 34, costStr, {
        fontSize: '8px', color: PALETTE.textCyan, fontFamily: 'monospace',
      }).setDepth(11)

      const hit = this.add.rectangle(cx, cy, CARD_W, CARD_H, 0x000000, 0)
        .setDepth(12).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => {
        if (this._selected !== def) {
          cg.clear()
          glowPanel(cg, px, py, CARD_W, CARD_H, { fill: 0x0a1525, border: catColor, glow: catColor })
          cg.fillStyle(catColor, 0.5); cg.fillRect(px, py, CARD_W, 3)
        }
      })
      hit.on('pointerout', () => {
        if (this._selected !== def) this._resetCard(cg, px, py, CARD_W, CARD_H, catColor, false)
      })
      hit.on('pointerdown', (p) => { if (!p.rightButtonDown()) this._selectItem(def, 'trap') })

      this._paletteCards.push({ def, kind: 'trap', cg, px, py, CARD_W, CARD_H, catColor })
      this._paletteObjects.push(cg, nameTxt, trigTxt, costTxt, hit)
    })
  }

  _resetCard(cg, px, py, cw, ch, catColor, selected) {
    cg.clear()
    glowPanel(cg, px, py, cw, ch, {
      fill:   selected ? 0x0d1e30 : 0x060c18,
      border: selected ? catColor : 0x0d1e30,
      glow:   catColor,
    })
    cg.fillStyle(catColor, selected ? 0.8 : 0.5)
    cg.fillRect(px, py, cw, 3)
  }

  // ── Bottom bar ────────────────────────────────────────────────────────────

  _buildBottomBar(W, H) {
    const by = H - BOTTOM_H
    const g  = this.add.graphics().setDepth(10)

    glowPanel(g, 0, by, W, BOTTOM_H, {
      fill: PALETTE.panelBg, border: PALETTE.panelBorder, glow: PALETTE.accent,
    })

    // Top border highlight
    g.lineStyle(1, PALETTE.accent, 0.5)
    g.beginPath(); g.moveTo(0, by); g.lineTo(W, by); g.strokePath()

    // Knowledge overlay toggle (left of BEGIN DAY)
    this._buildKnowledgeButton(W, H, by)

    // Begin Day button
    this._buildBeginDayButton(W, H, by)
  }

  _buildKnowledgeButton(W, H, by) {
    const bw = 110, bh = 32
    // BEGIN DAY button has center bx = W - 140 with bw = 220, so its left
    // edge sits at W - 250.  Place this 14 px to its left.
    const bx  = W - 250 - 14 - bw
    const bcy = by + BOTTOM_H / 2

    const bg = this.add.graphics().setDepth(11)
    glowPanel(bg, bx, bcy - bh / 2, bw, bh, {
      fill: 0x06060e, border: 0x440000, glow: 0x1a0000,
    })

    this.add.text(bx + bw / 2, bcy, 'INTEL', {
      fontSize: '10px', color: '#aa3333', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12)

    const hit = this.add.rectangle(bx + bw / 2, bcy, bw, bh, 0, 0)
      .setDepth(13).setInteractive({ useHandCursor: true })
    hit.on('pointerdown', () => {
      const game = this.scene.get('Game')
      this.scene.launch('KnowledgeScreen', {
        gameState:       this._gameState,
        knowledgeSystem: game?.knowledgeSystem,
      })
    })
  }

  _buildBeginDayButton(W, H, by) {
    const bx = W - 140
    const bcy = by + BOTTOM_H / 2
    const bw  = 220
    const bh  = 40

    const bg = this.add.graphics().setDepth(11)
    const draw = (hover) => {
      bg.clear()
      glowPanel(bg, bx - bw / 2, bcy - bh / 2, bw, bh, {
        fill:   hover ? 0x1a0a30 : 0x0d0620,
        border: hover ? PALETTE.accentBright : PALETTE.accent,
        glow:   PALETTE.accent,
      })
    }
    draw(false)

    const label = this.add.text(bx, bcy, 'BEGIN DAY  ▶', {
      fontSize: '13px', color: PALETTE.textAccent, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12)

    const hit = this.add.rectangle(bx, bcy, bw, bh, 0x000000, 0)
      .setDepth(13).setInteractive({ useHandCursor: true })

    hit.on('pointerover',  () => { draw(true);  label.setStyle({ color: PALETTE.textBright }) })
    hit.on('pointerout',   () => { draw(false); label.setStyle({ color: PALETTE.textAccent }) })
    hit.on('pointerdown',  () => this._beginDay())
  }

  _buildHints(W, H) {
    this.add.text(W - 8, H - BOTTOM_H - 6,
      'WASD / drag to scroll  ·  scroll to zoom  ·  R = rotate room / right-click to cancel pick  ·  left-click room to pick up  ·  use SELL tool to remove rooms/minions  ·  Ctrl+Z to undo  ·  ESC = pause  ·  HALLS tab: left=draw  right=erase',
      { fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace' }
    ).setOrigin(1, 1).setDepth(11)
  }

  // ── Placement preview ──────────────────────────────────────────────────────

  _buildPreview() {
    const gameScene = this.scene.get('Game')
    this._preview  = gameScene.add.graphics().setDepth(20)
    this._rotLabel = gameScene.add.text(0, 0, '', {
      fontSize: '10px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
      backgroundColor: '#00000099', padding: { x: 4, y: 2 },
    }).setDepth(21).setVisible(false)
    // Disconnected-room highlight lives in world space too. Depth 19 sits
    // just under the placement preview so the preview never gets hidden
    // by the pulse outline when the player is mid-placement.
    this._disconnectedHighlight = gameScene.add.graphics().setDepth(19)
  }

  _selectItem(def, kind) {
    const was = this._selected
    this._paletteCards.forEach(c => this._resetCard(c.cg, c.px, c.py, c.CARD_W, c.CARD_H, c.catColor, false))

    if (was === def) {
      this._selected = null
      this._selectedKind = null
      this._clearPreview()
      this._updateGridVisibility()
      return
    }

    this._selected = def
    this._selectedKind = kind
    if (kind === 'trap') this._trapFacing = def.id === 'saw_blade' ? 'E' : 'S'
    const card = this._paletteCards.find(c => c.def === def)
    if (card) this._resetCard(card.cg, card.px, card.py, card.CARD_W, card.CARD_H, card.catColor, true)
    this._updateGridVisibility()
  }

  // Show the dungeon grid lines while a placement is active so the player
  // can gauge alignment; hide them otherwise so the bedrock reads cleanly.
  _updateGridVisibility() {
    const gameScene = this.scene.get('Game')
    gameScene?._dungeonRenderer?.setGridVisible?.(this._selected != null)
    // Placement mode owns the cursor — tell the HUD so the companion's
    // portrait / bubble stop eating placement clicks that land on them.
    EventBus.emit('PLACEMENT_MODE_CHANGED', { active: this._selected != null })
  }

  _clearPreview() {
    this._preview?.clear()
    this._rotLabel?.setVisible(false)
    this._previewTileX = -1
    this._previewTileY = -1
  }

  // ── Disconnected-room highlighter ─────────────────────────────────────────
  // Surfaces the rooms blocking Begin Day as a pulsing red outline + pans
  // the camera to the first one so the player can see it even if it's
  // off-screen. Refreshed on every room placement/removal until the
  // dungeon is fully reconnected; cleared on a successful Begin Day or
  // scene shutdown.

  _flagDisconnectedRooms(rooms) {
    if (!Array.isArray(rooms) || rooms.length === 0) {
      this._clearDisconnectedHighlight()
      return
    }
    this._disconnectedRoomIds  = new Set(rooms.map(r => r.instanceId))
    this._disconnectErrorShown = true
    // Pan camera to the first offender so the player has a visual anchor
    // even if the broken room is off-screen. Keeps current zoom.
    const first = rooms[0]
    const game  = this.scene.get('Game')
    const cam   = game?.cameras?.main
    if (first && game?._tweenCameraTo && cam) {
      const cx = (first.gridX + first.width  / 2) * TS
      const cy = (first.gridY + first.height / 2) * TS
      game._tweenCameraTo(cx, cy, cam.zoom, 500, 'Sine.easeInOut')
    }
  }

  _refreshDisconnectedHighlight() {
    if (!this._disconnectErrorShown) return
    const disc = this._dungeonGrid?.getDisconnectedRooms?.() ?? []
    this._disconnectedRoomIds = new Set(disc.map(r => r.instanceId))
    if (this._disconnectedRoomIds.size === 0) this._clearDisconnectedHighlight()
  }

  _clearDisconnectedHighlight() {
    this._disconnectedRoomIds  = new Set()
    this._disconnectErrorShown = false
    this._disconnectedHighlight?.clear()
  }

  // Per-frame pulse render. Phaser calls update() on every active scene
  // automatically; we no-op when nothing is flagged so the common case
  // is free.
  update(time) {
    const g = this._disconnectedHighlight
    if (!g || this._disconnectedRoomIds.size === 0) return
    g.clear()
    // Sin-wave alpha pulse, ~1.7s period. Floor at 0.45 so the outline
    // is always visible even at the trough.
    const pulse  = 0.5 + 0.5 * Math.sin(time / 270)
    const alphaO = 0.55 + 0.40 * pulse
    const alphaI = alphaO * 0.55
    const rooms  = this._gameState.dungeon.rooms ?? []
    for (const id of this._disconnectedRoomIds) {
      const room = rooms.find(r => r.instanceId === id)
      if (!room) continue
      const x = room.gridX * TS
      const y = room.gridY * TS
      const w = room.width  * TS
      const h = room.height * TS
      g.lineStyle(4, 0xff2a2a, alphaO)
      g.strokeRect(x + 1, y + 1, w - 2, h - 2)
      g.lineStyle(2, 0xff8080, alphaI)
      g.strokeRect(x + 5, y + 5, w - 10, h - 10)
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _setupInput() {
    const gameScene = this.scene.get('Game')
    const cam = gameScene.cameras.main

    // (Browser context menu suppressed game-wide in main.js.)
    this.input.on('pointermove', (p) => {
      if (!this._selected) {
        this._showRoomHover(p, cam)
        return
      }
      const wp = cam.getWorldPoint(p.x, p.y)
      let tx, ty
      if (this._selectedKind === 'room') {
        // Use fractional tile position so the room center tracks the cursor
        // precisely rather than snapping to the nearest tile edge.
        const rotDef = this._getRotatedDef(this._selected)
        tx = Math.round(wp.x / TS - rotDef.width  / 2)
        ty = Math.round(wp.y / TS - rotDef.height / 2)
        // Free placement — no snap. Doors auto-create at adjacency time.
      } else if (this._selectedKind === 'trap') {
        const fp = this._selected.footprint ?? { w: 1, h: 1 }
        if (fp.w > 1 || fp.h > 1) {
          // 2×2 traps centre on the cursor like rooms
          tx = Math.round(wp.x / TS - fp.w / 2)
          ty = Math.round(wp.y / TS - fp.h / 2)
        } else {
          tx = Math.floor(wp.x / TS)
          ty = Math.floor(wp.y / TS)
        }
      } else {
        tx = Math.floor(wp.x / TS)
        ty = Math.floor(wp.y / TS)
      }
      if (tx !== this._previewTileX || ty !== this._previewTileY) {
        this._previewTileX = tx
        this._previewTileY = ty
        this._updateHeldMoveFollow(tx, ty)
        this._drawPreview(tx, ty, cam)
      }
    })

    this.input.on('pointerdown', (p, gameObjects) => {
      if (p.middleButtonDown()) return

      // Skip room-pickup when the click is over a minion. The minion sprite
      // lives in Game scene, but NightPhase's input plugin actually runs
      // before Game's (it was launched on top), so cross-scene flags arrive
      // too late. Easier to check `gameState.minions` directly: if any
      // alive minion is within ~half a tile of the cursor's world point,
      // assume the click is for the minion and let MinionRenderer handle it.
      // Exception: when an action mode is armed that itself targets minions
      // (SELL tool, Crucible sacrifice), we WANT the click to fall through
      // to those handlers instead of being delegated to MinionRenderer.
      const wp = cam.getWorldPoint(p.x, p.y)
      const minionHitR = TS * 0.55
      const overMinion = (this._gameState.minions ?? []).some(m => {
        if (m.aiState === 'dead' || m.resources?.hp <= 0) return false
        return Math.hypot(wp.x - m.worldX, wp.y - m.worldY) <= minionHitR
      })
      const minionTargetingMode = this._crucibleMode || this._toolMode === 'sell' || this._toolMode === 'upgrade'
      if (overMinion && !minionTargetingMode) return

      if (p.rightButtonDown()) {
        // Phase 9 — Pact of the Brand: right-click on a placed trap selects
        // it as the blessed trap (only valid when no tool/placement armed).
        if (!this._toolMode && !this._selected &&
            (this._gameState._mechanicFlags ?? {}).pactOfTheBrand) {
          const tx = Math.floor(wp.x / TS)
          const ty = Math.floor(wp.y / TS)
          const trap = (this._gameState.dungeon.traps ?? []).find(
            t => t.tileX === tx && t.tileY === ty && !t.isTriggered
          )
          if (trap) {
            EventBus.emit('BRAND_TRAP_SELECTED', { trapId: trap.instanceId })
            return
          }
        }
        // Right-click cancels: pending trade-off → roll back the staged
        // lock; armed tool → release; placement candidate → drop.
        // Removal is sell-only — right-click never deletes placed content.
        if (this._pendingTradeOff) {
          this._pendingTradeOff = null
          this._cancelSelection()
          this._showPlacementError('Placement cancelled')
          return
        }
        if (this._toolMode) { this._setToolMode(null, 'right_click'); return }
        if (this._selected) { this._cancelSelection(); return }
        return
      }

      // Left-clicks inside the HUD panel should not trigger dungeon actions.
      // Guard here (not in pointermove) so the preview always tracks the
      // cursor — a pointermove guard was causing the preview tile to never
      // be set on day 2+ if uiSf differed between scene launches.
      if (p.x < PANEL_W * (this.uiSf ?? 1)) return

      // Phase 9 — Crucible sacrifice mode: two clicks on minions in same room.
      if (this._crucibleMode) {
        const tx = Math.floor(wp.x / TS)
        const ty = Math.floor(wp.y / TS)
        const minion = (this._gameState.minions ?? []).find(m =>
          m.faction === 'dungeon' && m.aiState !== 'dead' &&
          m.tileX === tx && m.tileY === ty
        )
        if (!minion) {
          this._showPlacementError('Click on a minion (or ESC to cancel)')
          return
        }
        if (!this._crucibleVictimId) {
          this._crucibleVictimId = minion.instanceId
          this._showPlacementError(`Victim: ${minionLabel(minion.definitionId)} — click target in same room`)
          return
        }
        const game = this.scene.get('Game')
        const result = game?.dungeonMechanicSystem?.crucibleSacrifice?.(this._crucibleVictimId, minion.instanceId)
        if (result?.ok) {
          this._showPlacementError('Crucible: sacrifice complete')
        } else {
          this._showPlacementError(`Crucible failed: ${result?.error ?? 'unknown'}`)
        }
        this._crucibleMode = false
        this._crucibleVictimId = null
        return
      }
      // Phase 31D — action-bar tool intercepts left-click on placed rooms.
      if (this._toolMode) {
        const tx = Math.floor(wp.x / TS)
        const ty = Math.floor(wp.y / TS)
        if (this._toolMode === 'sell') {
          this._executeSellAt(tx, ty)
          return
        }
        if (this._toolMode === 'upgrade') {
          // Upgrade is sticky like SELL — stays armed so the player can
          // upgrade several minions in a row. Each click opens a confirm.
          this._executeUpgradeAt(tx, ty)
          return
        }
        if (this._toolMode === 'reassign') {
          // Targets the roster-chosen minion; relocates it to the clicked
          // room then disarms (one minion per REASSIGN press).
          this._executeReassignAt(tx, ty)
          return
        }
        if (this._toolMode === 'move') {
          // Move is sticky — stays armed until the player clicks the MOVE
          // button again or BEGIN DAY fires. While holding a room, the
          // next click drops it; otherwise the click picks up the room
          // under the cursor (if any).
          //
          // MinionRenderer (in Game scene) owns held-minion drop on the same
          // pointerdown. NightPhase fires first, so without this guard the
          // drop click would also pick up the room under the cursor.
          const game = this.scene.get('Game')
          if (game?.minionRenderer?._heldMinion) return
          if (this._selected) {
            if (this._previewTileX >= 0) {
              this._confirmPlacement(this._previewTileX, this._previewTileY)
            }
          } else {
            this._executeMoveAt(tx, ty)
          }
          return
        }
        return
      }

      // Without a tool armed and no build slot selected, left-click in the
      // dungeon is a no-op. Pickup of placed rooms requires the MOVE tool.
      if (!this._selected) return
      if (this._previewTileX < 0) return
      this._confirmPlacement(this._previewTileX, this._previewTileY)
    })

    this.input.keyboard.on('keydown-R', () => {
      if (this._selectedKind === 'room') {
        this._rotation = (this._rotation + 90) % 360
        if (this._previewTileX >= 0) this._drawPreview(this._previewTileX, this._previewTileY)
      } else if (this._selectedKind === 'trap' && this._selected?.rotatable) {
        this._trapFacing = this._nextTrapFacing(this._selected, this._trapFacing)
        if (this._previewTileX >= 0) this._drawPreview(this._previewTileX, this._previewTileY)
      }
    })
    this.input.keyboard.on('keydown-ESC', () => {
      // Esc cancels whatever's armed first, then opens pause as a fallback.
      if (this._pendingTradeOff) {
        this._pendingTradeOff = null
        this._cancelSelection()
        this._showPlacementError('Lock placement cancelled')
        return
      }
      if (this._crucibleMode) {
        this._crucibleMode = false
        this._crucibleVictimId = null
        this._showPlacementError('Crucible cancelled')
        return
      }
      if (this._toolMode) { this._setToolMode(null, 'esc_key'); return }
      if (this._selected)  { this._cancelSelection(); return }
      PauseManager.toggle(this)
    })
    this.input.keyboard.on('keydown-Z',   (e) => {
      if (e.ctrlKey || e.metaKey) this._undoLastPlacement()
    })
    // Phase 9 — Pact of the Crucible: 'C' enters sacrifice mode (pact must
    // be active + unused this run). Two clicks on minions in the same
    // room confirm; ESC cancels.
    this.input.keyboard.on('keydown-C', () => {
      const f = this._gameState._mechanicFlags ?? {}
      if (!f.pactOfTheCrucible || f.crucibleUsed) return
      this._crucibleMode = true
      this._crucibleVictimId = null
      this._showPlacementError('CRUCIBLE — click victim minion')
    })

    // Bug fix — scroll the palette when wheel happens over the left panel.
    // Without this, the unlocked-rooms list (now 17+) overflows the panel
    // and the bottom cards get cut off below the screen edge.
    this.input.on('wheel', (p, _o, _dx, dy) => {
      if (this.cameras.main.getWorldPoint(p.x, p.y).x > PANEL_W) return
      const visibleH = this.uiH - this._paletteContentY - BOTTOM_H - 12
      const maxScroll = Math.max(0, this._paletteContentHeight - visibleH)
      this._paletteScrollY = Phaser.Math.Clamp(
        this._paletteScrollY + dy * 0.5, 0, maxScroll
      )
      this._renderActivePalette()
    })
  }

  // While a trap or movable item is carried via the MOVE tool, glue it to
  // the cursor tile so it visibly follows the pointer — every renderer
  // (TrapRenderer / TreasureChestRenderer / PhylacteryRenderer) re-anchors
  // from these gameState fields each frame. Position is committed on drop and
  // rolled back to the pickup tile on cancel (see _cancelSelection).
  _updateHeldMoveFollow(tx, ty) {
    if (this._heldMoveTrap) {
      this._heldMoveTrap.tileX = tx
      this._heldMoveTrap.tileY = ty
      return
    }
    const held = this._heldMoveItem
    if (!held) return
    held.data.tileX = tx
    held.data.tileY = ty
    if (held.kind === 'phylactery') {
      held.data.worldX = tx * TS + TS / 2
      held.data.worldY = ty * TS + TS / 2
    }
  }

  _drawPreview(tx, ty, _cam) {
    if (!this._selected) return
    const def    = this._selected
    const rotDef = this._selectedKind === 'room' ? this._getRotatedDef(def) : def

    // For rooms tx/ty is already the top-left corner (computed in pointermove).
    // For minions/traps tx/ty is the cursor tile used directly.
    const placeTx = tx
    const placeTy = ty

    let check
    if (this._selectedKind === 'minion') {
      check = this._validateMinionPlacement(def, tx, ty)
    } else if (this._selectedKind === 'trap') {
      check = this._validateTrapPlacement(def, tx, ty)
    } else if (this._selectedKind === 'item' && def.id === 'door_lock') {
      const isDoor = this._dungeonGrid.getTileType?.(tx, ty) === TILE.DOOR
      check = { valid: !!isDoor, violations: isDoor ? [] : ['Click on a doorway'] }
    } else if (this._selectedKind === 'item' && def.id === 'key_chest') {
      check = this._pendingTradeOff
        ? this._validateKeyChestPlacement(tx, ty, this._pendingTradeOff.doorTiles)
        : { valid: false, violations: ['No pending lock'] }
      if (!check.valid && check.reason) check.violations = [check.reason]
    } else if (this._selectedKind === 'item' && def.id === 'soul_bound_beacon') {
      check = this._validateRoomFloorPlacement(tx, ty)
      const here = (this._gameState.dungeon.beacons ?? []).filter(
        b => check.room && b.roomId === check.room.instanceId,
      )
      if (check.valid && here.length > 0) check = { valid: false, reason: 'Max 1 Beacon per room' }
      if (!check.valid && check.reason) check.violations = [check.reason]
    } else if (this._selectedKind === 'item' && def.id === 'healing_fountain') {
      check = this._pendingTradeOff?.kind === 'beacon'
        ? this._validateRoomFloorPlacement(tx, ty, { differentRoomThan: this._pendingTradeOff.roomId })
        : { valid: false, reason: 'Place via a Beacon' }
      if (!check.valid && check.reason) check.violations = [check.reason]
    } else if (this._selectedKind === 'item' && def.id?.startsWith('treasure_chest_')) {
      check = this._validateRoomFloorPlacement(tx, ty)
      const tier = def.tier ?? 1
      // Exclude the chest currently being moved — it's still in the array
      // (following the cursor), so counting it would falsely read "already
      // placed" and paint the carry preview red the whole move.
      const heldChestId = this._heldMoveItem?.kind === 'treasure_chest' ? this._heldMoveItem.data?.instanceId : null
      // Auto-spawned chests (treasury / mimic / cursed relic) don't fill the
      // player's per-tier slot — exclude them so the preview doesn't read red.
      const here = (this._gameState.dungeon.treasureChests ?? [])
        .filter(c => c.tier === tier && c.instanceId !== heldChestId
          && !c._treasurySpawn && !c._mimicCursed && !c._cursed)
      if (check.valid && here.length >= 1) check = { valid: false, reason: `Tier ${tier} already placed` }
      if (!check.valid && check.reason) check.violations = [check.reason]
    } else {
      check = this._dungeonGrid.validatePlacement(rotDef, placeTx, placeTy, { dungeonLevel: this._gameState.boss?.level ?? 1 })
    }
    // DAMNED · The Insomniac — a locked night seals the dungeon: force the
    // preview invalid so the cursor reads red, EXCEPT for the allowed
    // anti-softlock placements (a required Entry Hall / a move-to-fix drop),
    // which keep their normal validity so the player can actually place them.
    if ((this._gameState._mechanicFlags ?? {}).insomniacLockTonight &&
        !this._insomniacPlacementAllowed()) {
      check = { valid: false, violations: ['The Insomniac — the dungeon is sealed tonight'] }
    }
    this._previewValid = check.valid

    const color = check.valid ? 0x00cc66 : 0xcc2222
    const fillA = 0.18

    this._preview.clear()

    if (this._selectedKind === 'trap') {
      const fp = def.footprint ?? { w: 1, h: 1 }
      const wx = tx * TS, wy = ty * TS
      const ww = fp.w * TS, wh = fp.h * TS
      // Saw track — faint tiles the blade will patrol.
      if (def.id === 'saw_blade') {
        const horiz = this._trapFacing === 'E' || this._trapFacing === 'W'
        const len = def.trackLength ?? 4
        for (let i = 0; i < len; i++) {
          const cx = (horiz ? tx + i : tx) * TS
          const cy = (horiz ? ty : ty + i) * TS
          this._preview.fillStyle(color, 0.10)
          this._preview.fillRect(cx, cy, TS, TS)
          this._preview.lineStyle(1, color, 0.4)
          this._preview.strokeRect(cx, cy, TS, TS)
        }
      }
      this._preview.fillStyle(color, fillA)
      this._preview.fillRect(wx, wy, ww, wh)
      this._preview.lineStyle(2, color, 0.75)
      this._preview.strokeRect(wx, wy, ww, wh)
      if (this._rotLabel && def.rotatable) {
        const horiz = this._trapFacing === 'E' || this._trapFacing === 'W'
        this._rotLabel.setText(def.id === 'saw_blade'
          ? `↻ ${horiz ? 'HORIZONTAL' : 'VERTICAL'}   ·   [R] ROTATE`
          : `↻ ${this._trapFacing}   ·   [R] ROTATE`)
        this._rotLabel.setPosition(wx + 2, wy + 2)
        this._rotLabel.setVisible(true)
      } else {
        this._rotLabel?.setVisible(false)
      }
    } else if (this._selectedKind === 'minion' || this._selectedKind === 'item') {
      // Single-tile preview for minions and items
      const wx = tx * TS
      const wy = ty * TS
      this._preview.fillStyle(color, fillA)
      this._preview.fillRect(wx, wy, TS, TS)
      this._preview.lineStyle(2, color, 0.7)
      this._preview.strokeRect(wx, wy, TS, TS)
      this._rotLabel?.setVisible(false)
    } else {
      // Room rectangle preview — top-left derived from centered cursor position
      const wx = placeTx * TS
      const wy = placeTy * TS
      const ww = rotDef.width  * TS
      const wh = rotDef.height * TS
      this._preview.fillStyle(color, fillA)
      this._preview.fillRect(wx, wy, ww, wh)
      this._preview.lineStyle(4, color, 0.25)
      this._preview.strokeRect(wx - 2, wy - 2, ww + 4, wh + 4)
      this._preview.lineStyle(2, color, 0.55)
      this._preview.strokeRect(wx - 1, wy - 1, ww + 2, wh + 2)
      this._preview.lineStyle(1, color, 0.9)
      this._preview.strokeRect(wx, wy, ww, wh)

      // Door markers — every doorway is 2 tiles wide along the wall axis
      // (DungeonGrid widens toward whichever side has more wall) AND under
      // Option-B separation extends 1 tile outward into the inter-room
      // gap stub. Show the full L of tiles each connection point occupies
      // so the player sees the actual doorway footprint pre-placement.
      const rw = rotDef.width, rh = rotDef.height
      this._preview.fillStyle(color, 0.9)
      for (const cp of rotDef.connectionPoints ?? []) {
        this._stampDoorFootprint(this._preview, cp, placeTx, placeTy, rw, rh)
      }

      // Predicted auto-connect doors — runs the dry-run pairing against
      // existing rooms and highlights every cp that would be auto-created
      // (one on the new room, one on the existing neighbour). Drawn in a
      // distinct gold so the player can tell at a glance "yes, placing
      // here will give me a door" vs "no door, just a doorless adjacency."
      // Skipped on invalid placements (already-red preview).
      if (check.valid) {
        const candidate = {
          gridX: placeTx, gridY: placeTy,
          width: rw, height: rh,
          definitionId: def.id,
          connectionPoints: rotDef.connectionPoints ?? [],
        }
        const pairs = this._dungeonGrid.computeAutoConnectPairs?.(candidate) ?? []
        if (pairs.length > 0) {
          this._preview.fillStyle(0xffd870, 0.95)
          this._preview.lineStyle(2, 0xffd870, 0.95)
          for (const { newCp, otherRoom, otherCp } of pairs) {
            // New-room door footprint (in candidate-local coords).
            this._stampDoorFootprint(this._preview, newCp, placeTx, placeTy, rw, rh)
            // Existing neighbour's door footprint (in dungeon coords).
            this._stampDoorFootprint(this._preview, otherCp,
              otherRoom.gridX, otherRoom.gridY, otherRoom.width, otherRoom.height)
          }
        }
      }

      // Rotation angle label — top-left corner of the preview rect, world
      // space. Carries the [R] keybind hint so the player discovers room
      // rotation without having to find it in the help strip.
      if (this._rotLabel) {
        this._rotLabel.setText(`↻ ${this._rotation}°   ·   [R] ROTATE`)
        this._rotLabel.setPosition(wx + 2, wy + 2)
        this._rotLabel.setVisible(true)
      }
    }
  }

  // Highlight the tiles a single cp's door occupies — 2 cells along the
  // wall axis × WT cells through the wall. Respects an explicit
  // alongDx/Dy if present (auto-connect cps) and falls back to the
  // widen-toward-larger-half heuristic for hand-authored cps. With no
  // inter-room gap, the cp's footprint stops at the room's wall ring;
  // the matching cp on the neighbour paints its own cells on the far
  // side of the seam.
  _stampDoorFootprint(g, cp, gridX, gridY, width, height) {
    const WT = Balance.WALL_THICKNESS
    const onTop = cp.y === 0
    const onBot = cp.y === height - 1
    const onLft = cp.x === 0
    const onRgt = cp.x === width  - 1
    const onTopOrBot = onTop || onBot
    const onLftOrRgt = onLft || onRgt
    if ((onTopOrBot && onLftOrRgt) || (!onTopOrBot && !onLftOrRgt)) return

    let alongDx = 0, alongDy = 0
    if (onTopOrBot) {
      alongDx = (cp.alongDx === 1 || cp.alongDx === -1)
        ? cp.alongDx
        : (((width - 1) - cp.x) >= cp.x ? 1 : -1)
    } else {
      alongDy = (cp.alongDy === 1 || cp.alongDy === -1)
        ? cp.alongDy
        : (((height - 1) - cp.y) >= cp.y ? 1 : -1)
    }

    const cells = []
    if (onTopOrBot) {
      const yStart = onTop ? 0 : height - WT
      const yEnd   = onTop ? WT - 1 : height - 1
      for (let iy = yStart; iy <= yEnd; iy++) {
        cells.push([cp.x,           iy])
        cells.push([cp.x + alongDx, iy])
      }
    } else {
      const xStart = onLft ? 0 : width - WT
      const xEnd   = onLft ? WT - 1 : width - 1
      for (let ix = xStart; ix <= xEnd; ix++) {
        cells.push([ix, cp.y])
        cells.push([ix, cp.y + alongDy])
      }
    }
    for (const [lx, ly] of cells) {
      const px = (gridX + lx) * TS
      const py = (gridY + ly) * TS
      g.fillRect(px + 4, py + 4, TS - 8, TS - 8)
    }
  }

  _validateMinionPlacement(def, tx, ty) {
    const violations = []
    // DAMNED · The Insomniac — no building on a locked night.
    if ((this._gameState._mechanicFlags ?? {}).insomniacLockTonight) {
      violations.push('The Insomniac — no building tonight')
    }
    const tile = this._dungeonGrid.getTileType(tx, ty)
    if (tile !== TILE.FLOOR && tile !== TILE.BOSS_FLOOR) {
      violations.push('Must place on a room floor')
    }
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) {
      if (violations.length === 0) violations.push('Not inside any room')
    } else if (room.definitionId === 'boss_chamber' || room.definitionId === 'entry_hall') {
      violations.push("Can't place minions here")
    } else if (room.definitionId === 'throne_room') {
      // Room redesign 2026-04-30 — Throne Room hosts only its mini-boss.
      violations.push("Throne Room only houses its mini-boss")
    } else {
      // Per-room cap on player-placed (roster) minions. System-spawned
      // garrison units (Crypt bones, Hellgate imps, etc.) aren't counted
      // so a Crypt's 4 Risen Bones don't eat into the player's budget.
      const roomCap = Balance.MINIONS_PER_ROOM_CAP ?? 5
      const inRoom  = this._roomMinionCount(room.instanceId)
      if (inRoom >= roomCap) {
        violations.push(`Room full (${inRoom}/${roomCap} minions) — pick another room`)
        EventBus.emit('PLACEMENT_BLOCKED', { reason: 'room_minion_cap' })
      }
    }
    // Each Barracks adds +10 roster slots. Garrison minions (Crypt et al.)
    // do not count toward this cap.
    const cap = this._rosterCap()
    const used = this._rosterUsed()
    if (used >= cap) {
      violations.push(`Roster full (${used}/${cap}) — build another Barracks for +10 slots`)
      EventBus.emit('PLACEMENT_BLOCKED', { reason: 'roster_full' })
    }
    if (this._effectiveMinionCost(def) > this._gameState.player.gold) {
      violations.push('Insufficient gold')
      EventBus.emit('PLACEMENT_BLOCKED', { reason: 'insufficient_gold' })
    }
    return { valid: violations.length === 0, violations }
  }

  _effectiveMinionCost(def) {
    // DAMNED · Pact of Glass bribe — minions are free to place for the
    // sealing build phase only.
    if ((this._gameState._mechanicFlags ?? {}).glassFreeNight) return 0
    const base = def?.goldCost ?? 0
    const m = (this._gameState._mechanicFlags ?? {}).minionGoldCostMult ?? 1
    // Unified boss-level + day build-cost scaling (util/merchantPricing.js).
    const scaled = Math.max(0, Math.round(base * m * buildScaleMul(this._gameState)))
    // Goblin Market repricing (one night). Applied last so this charge
    // matches LeftPanels._costFor's display exactly.
    return applyMerchantPrice(this._gameState, def?.id, scaled)
  }

  // Roster + trap caps are the single-source-of-truth in src/util/slotCaps.js
  // so the build-menu display (LeftPanels) and placement enforcement can't drift.
  _rosterCap() { return rosterCap(this._gameState) }

  _rosterUsed() {
    return (this._gameState.minions ?? [])
      .filter(m => (m.class ?? 'roster') === 'roster' && m.aiState !== 'dead')
      .length
  }

  // Live roster minions assigned to a specific room. Used by the per-room
  // cap on placement + MOVE drops. Excludes dead and garrison-class units
  // (system-spawned bones, imps, etc.) so room-bound auto-spawns don't
  // eat into the player's per-room budget. Optional `exceptId` skips one
  // minion — MinionRenderer passes the held minion's id so moving within
  // the same room doesn't double-count it.
  _roomMinionCount(roomId, exceptId = null) {
    return (this._gameState.minions ?? []).filter(m =>
      m.assignedRoomId === roomId &&
      m.aiState !== 'dead' &&
      (m.class ?? 'roster') === 'roster' &&
      m.instanceId !== exceptId
    ).length
  }

  _validateTrapPlacement(def, tx, ty) {
    const violations = []
    const grid = this._dungeonGrid
    const fp = def.footprint ?? { w: 1, h: 1 }

    // Footprint tiles (anchor tx,ty = top-left).
    const fpTiles = []
    for (let dy = 0; dy < fp.h; dy++)
      for (let dx = 0; dx < fp.w; dx++)
        fpTiles.push({ x: tx + dx, y: ty + dy })

    if (def.placement === 'wall') {
      // Wall-mounted: a single TILE.WALL cell that faces a room interior.
      if (grid.getTileType(tx, ty) !== TILE.WALL) {
        violations.push('Place on a room wall')
      } else {
        const facing = this._wallTrapFacing(tx, ty)
        if (!facing) {
          violations.push('Wall must face into a room')
        } else {
          const room = grid.getRoomAtTile(tx + DIR[facing].dx, ty + DIR[facing].dy)
          if (room && (room.definitionId === 'boss_chamber' || room.definitionId === 'entry_hall'))
            violations.push('Not on the boss room or entry hall')
        }
      }
    } else {
      // Floor traps: every footprint tile must be plain room floor.
      const allFloor = fpTiles.every(c => grid.getTileType(c.x, c.y) === TILE.FLOOR)
      if (!allFloor) {
        violations.push(fp.w > 1 ? 'Whole 2×2 area must be open floor' : 'Place on room floor')
      } else {
        const room = grid.getRoomAtTile(tx, ty)
        if (room && (room.definitionId === 'boss_chamber' || room.definitionId === 'entry_hall'))
          violations.push('Not in the boss room or entry hall')
        // Restrictions retired 2026-05-27 per user direction:
        //   • 2×2-trap small-room block (was: outer-area <= 64 rejects
        //     Spike Pit / Spike Pillar / Rotating Blades from rooms
        //     like Armoury / Guard Post / Sanctum). 2×2 traps now
        //     drop anywhere they physically fit.
        //   • Spike Pit `floor_interior` ring requirement (was:
        //     footprint + surrounding ring must all be floor — no
        //     walls / doors / void touching). Spike Pits now drop
        //     adjacent to walls.
        // The trap def's `placement === 'floor_interior'` field is
        // kept on the data side for forward-compat but no longer gates
        // anything in this validator.
      }
    }

    // Saw blade — the whole track must run over open floor.
    if (def.id === 'saw_blade') {
      const horiz = this._trapFacing === 'E' || this._trapFacing === 'W'
      const len = def.trackLength ?? 4
      let trackOK = true
      for (let i = 0; i < len && trackOK; i++) {
        const cx = horiz ? tx + i : tx
        const cy = horiz ? ty : ty + i
        if (grid.getTileType(cx, cy) !== TILE.FLOOR) trackOK = false
      }
      if (!trackOK) violations.push('Saw track must run over open floor')
    }

    // Overlap with another trap's footprint.
    const occupied = new Set()
    for (const tr of this._gameState.dungeon.traps ?? []) {
      if (tr === this._heldMoveTrap) continue
      const tfp = tr.footprint ?? { w: 1, h: 1 }
      for (let dy = 0; dy < tfp.h; dy++)
        for (let dx = 0; dx < tfp.w; dx++)
          occupied.add(`${tr.tileX + dx},${tr.tileY + dy}`)
    }
    if (fpTiles.some(c => occupied.has(`${c.x},${c.y}`)))
      violations.push('Overlaps another trap')

    // Per-room trap cap (max 1 per room, lowered from 3 on 2026-05-27
    // per user direction). Counts every trap whose primary room matches
    // the target room — floor traps use their own tile, wall traps use
    // the room they face INTO. Wall and floor traps share the same
    // count, so a single wall-mounted Arrow Wall blocks any floor trap
    // in that room and vice versa. The trap being relocated (MOVE
    // tool) is excluded from the count so a pickup-and-drop in the
    // same room doesn't trip the cap.
    const targetRoom = (def.placement === 'wall')
      ? (() => {
          const facing = this._wallTrapFacing(tx, ty)
          return facing ? grid.getRoomAtTile(tx + DIR[facing].dx, ty + DIR[facing].dy) : null
        })()
      : grid.getRoomAtTile(tx, ty)
    if (targetRoom) {
      let trapsInRoom = 0
      for (const tr of (this._gameState.dungeon.traps ?? [])) {
        if (tr === this._heldMoveTrap) continue
        let trRoom
        if (tr.placement === 'wall') {
          // Wall-trap room = the room across the wall. Recompute from
          // its facing if stored, otherwise fall back to the standing
          // tile (most wall traps record `facing` at placement).
          const f = tr.facing && DIR[tr.facing] ? tr.facing : null
          trRoom = f
            ? grid.getRoomAtTile(tr.tileX + DIR[f].dx, tr.tileY + DIR[f].dy)
            : grid.getRoomAtTile(tr.tileX, tr.tileY)
        } else {
          trRoom = grid.getRoomAtTile(tr.tileX, tr.tileY)
        }
        if (trRoom && trRoom.instanceId === targetRoom.instanceId) trapsInRoom++
      }
      if (trapsInRoom >= 1) {
        violations.push('Only 1 trap per room')
      }
    }

    // Overlap with a minion.
    const minionTiles = new Set((this._gameState.minions ?? [])
      .filter(m => m.aiState !== 'dead')
      .map(m => `${m.tileX},${m.tileY}`))
    if (fpTiles.some(c => minionTiles.has(`${c.x},${c.y}`)))
      violations.push('Tile occupied by a minion')

    // Trap Factory gateway — the first Factory grants 5 trap slots, each
    // additional one adds +3 (2026-05-29; the room is the only source of trap
    // slots, so without one no traps can be placed). Skipped when relocating
    // an already-placed trap (the MOVE tool is gold/slot-neutral).
    if (!this._heldMoveTrap) {
      // DAMNED · Trapless Halls — no NEW traps may be placed (relocating an
      // already-placed trap via the MOVE tool is still allowed).
      if ((this._gameState._mechanicFlags ?? {}).traplessHalls) {
        violations.push('Trapless Halls — you can place no new traps')
        EventBus.emit('PLACEMENT_BLOCKED', { reason: 'trapless_halls' })
      }
      // DAMNED · The Insomniac — no building at all on a locked night.
      if ((this._gameState._mechanicFlags ?? {}).insomniacLockTonight) {
        violations.push('The Insomniac — no building tonight')
      }
      const cap = this._trapCap()
      const used = this._trapUsed()
      if (cap === 0) {
        violations.push('Build a Trap Factory to unlock traps')
      } else if (used >= cap) {
        violations.push(`Trap pool full (${used}/${cap}) — build another Trap Factory for +3 slots`)
        EventBus.emit('PLACEMENT_BLOCKED', { reason: 'trap_pool_full' })
      }
      if (this._effectiveTrapCost(def) > this._gameState.player.gold) {
        violations.push('Insufficient gold')
        EventBus.emit('PLACEMENT_BLOCKED', { reason: 'insufficient_gold' })
      }
    }
    return { valid: violations.length === 0, violations }
  }

  // Direction from a wall tile toward an adjacent room-interior floor tile,
  // or null if the wall faces no room (outer wall / corner).
  _wallTrapFacing(tx, ty) {
    for (const dir of ['N', 'S', 'E', 'W']) {
      if (this._dungeonGrid.getTileType(tx + DIR[dir].dx, ty + DIR[dir].dy) === TILE.FLOOR)
        return dir
    }
    return null
  }

  // Cycle a rotatable trap's facing: cannon turns clockwise N→E→S→W; the
  // saw blade toggles its track between horizontal (E) and vertical (S).
  _nextTrapFacing(def, cur) {
    if (def.id === 'saw_blade') return cur === 'E' ? 'S' : 'E'
    const order = ['N', 'E', 'S', 'W']
    return order[(order.indexOf(cur) + 1) % 4]
  }

  _effectiveTrapCost(def) {
    const base = def?.goldCost ?? 0
    const f = this._gameState._mechanicFlags ?? {}
    let cost = base
    if (f.hastyArchitect) cost *= Balance.MECHANIC_HASTY_ARCHITECT_TRAP_DISCOUNT
    if (f.pactOfTheJester) cost *= Balance.MECHANIC_JESTER_TRAP_DISCOUNT
    if (f.trapGoldCostMult) cost *= f.trapGoldCostMult
    // Unified boss-level + day build-cost scaling (util/merchantPricing.js)
    // so traps hold their price gap over minions as the run progresses.
    cost *= buildScaleMul(this._gameState)
    // Goblin Market repricing (one night) — applied last to match display.
    return applyMerchantPrice(this._gameState, def?.id, Math.max(0, Math.round(cost)))
  }
  _trapCap() { return trapCap(this._gameState) }

  _trapUsed() {
    return (this._gameState.dungeon.traps ?? []).length
  }

  // True when the dungeon still needs an Entry Hall (count below the boss-level
  // requirement) — i.e. the day literally can't begin without one. Mirrors the
  // requirement gate in _beginDay.
  _entryHallRequired() {
    const rooms = this._gameState.dungeon?.rooms ?? []
    const have  = rooms.filter(r => r.definitionId === 'entry_hall').length
    const entryDef = (this.cache.json.get('rooms') ?? []).find(d => d.id === 'entry_hall')
    const required = DungeonGridClass.effectiveMaxPerDungeon(entryDef, this._gameState.boss?.level ?? 1) ?? 1
    return have < required
  }

  // Anti-softlock exceptions to the Insomniac lock. A placement is permitted
  // despite a locked night when it's: (1) a REQUIRED Entry Hall (and only the
  // entry hall), or (2) dropping a room being moved via the connectivity-fix
  // path (_heldMoveRoom is set only for a flagged disconnected room — see
  // _executeMoveAt). Shared by _confirmPlacement + _drawPreview so the preview
  // colour and the commit gate stay in lockstep.
  _insomniacPlacementAllowed() {
    if (this._heldMoveRoom) return true
    if (this._selectedKind === 'room' && this._selected?.id === 'entry_hall' && this._entryHallRequired()) return true
    return false
  }

  _confirmPlacement(tx, ty) {
    if (!this._selected) return

    // DAMNED · The Insomniac — a locked night seals the dungeon. Two narrow
    // anti-softlock exceptions: (1) placing a REQUIRED Entry Hall (a locked
    // night can't strand the player when an entry is mandated), and (2)
    // dropping a room being moved via the connectivity-fix path
    // (_heldMoveRoom is only ever set for a flagged disconnected room — see
    // _executeMoveAt). Everything else stays sealed.
    if ((this._gameState._mechanicFlags ?? {}).insomniacLockTonight &&
        !this._insomniacPlacementAllowed()) {
      this._showPlacementError('The Insomniac — the dungeon is sealed tonight')
      return
    }

    if (this._selectedKind === 'minion') {
      this._confirmMinionPlacement(tx, ty)
      return
    }
    if (this._selectedKind === 'trap') {
      this._confirmTrapPlacement(tx, ty)
      return
    }
    if (this._selectedKind === 'item') {
      this._confirmItemPlacement(tx, ty)
      return
    }

    const def     = this._selected
    const rotDef  = this._getRotatedDef(def)
    // tx/ty already the top-left corner (set in pointermove via Math.round centering)
    const placeTx = tx
    const placeTy = ty
    const result  = this._dungeonGrid.validatePlacement(rotDef, placeTx, placeTy, { dungeonLevel: this._gameState.boss?.level ?? 1 })
    if (!result.valid) {
      this._showPlacementError(result.violations[0] ?? 'Invalid placement')
      return
    }

    // Phase 6e: archetype roomCostMultiplier (Tyrant 2×, Architect 0.75×)
    // Move-drops are gold-neutral: pickup didn't refund, drop doesn't
    // charge. Anything else is a fresh placement and pays effectiveRoomCost.
    const arch = this._gameState.player?.archetypeModifiers
    const roomMul = arch?.roomCostMultiplier ?? 1
    // Goblin Market repricing applied to the base room cost (before the
    // archetype roomMul) so it matches LeftPanels._costFor's display.
    const baseCost = this._heldMoveRoom
      ? 0
      : applyMerchantPrice(this._gameState, def.id,
          Math.round(DungeonGridClass.effectiveRoomCost(def, this._gameState.dungeon?.rooms ?? [])
            * buildScaleMul(this._gameState)))
    const cost = Math.round(baseCost * roomMul)
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) {
      if (this._gameState.player.gold < cost) {
        this._showPlacementError(`Need ${cost} gold (you have ${this._gameState.player.gold})`)
        EventBus.emit('PLACEMENT_BLOCKED', { reason: 'insufficient_gold' })
        return
      }
      this._gameState.player.gold -= cost
    }

    // Pass dungeonLevel so placeRoom's internal validatePlacement check
    // doesn't default to 1 and reject any room with unlockLevel > 1 — that
    // was silently making "newly unlocked" rooms unplaceable.
    // `isMove` is keyed on `_heldMoveRoomInstanceId` (set by EITHER the
    // MOVE tool's _executeMoveAt OR the legacy left-click pickup
    // _tryPickupRoom) so both paths preserve adventurer knowledge.
    // `preserveInstanceId` reuses the picked-up room's old id so adv
    // knowledge entries keyed on the old id naturally carry across the
    // move — without this, the new room gets a fresh _uid() and all
    // "what's in this room" intel orphans.
    const wasPickup = !!this._heldMoveRoomInstanceId
    const room = this._dungeonGrid.placeRoom(rotDef, placeTx, placeTy, {
      dungeonLevel:       this._gameState.boss?.level ?? 1,
      isMove:             wasPickup,
      preserveInstanceId: this._heldMoveRoomInstanceId || null,
    })
    if (room) {
      // Stamp the rotation the room was placed at so a future MOVE
      // pickup knows what frame its contents' offsets live in. Older
      // saves without this field are treated as rotation 0 at pickup.
      room.rotation = this._rotation
      this._playBuildSfx()
      // Re-anchor any minions that were inside this room before pickup so
      // they ride along to the new position. Offsets are pre-rotation; if
      // the player rotated the room the layout may not match — orphaned
      // minions on void tiles will be cleaned up by AI on next tick.
      // Offsets were captured in the room's pre-pickup footprint frame
      // (room.rotation = _heldMoveRoomRotation, with dimensions
      // _heldMoveCaptureW/H). Apply NET rotation = (drop - capture)
      // mod 4 steps so contents rotate WITH the room across both the
      // capture rotation AND any further user rotation. Same CW formula
      // as _rotateCP (nx = h - 1 - y, ny = x). Starts with capture-frame
      // dimensions so we don't mis-bound when the captured room wasn't
      // at the def's default orientation.
      const captureRot = this._heldMoveRoomRotation ?? 0
      const captureW   = this._heldMoveCaptureW    ?? def.width
      const captureH   = this._heldMoveCaptureH    ?? def.height
      const dropRot    = this._rotation ?? 0
      const netSteps   = (((dropRot - captureRot) / 90) % 4 + 4) % 4
      const rotateOff = (offX, offY) => {
        let x = offX, y = offY, w = captureW, h = captureH
        for (let i = 0; i < netSteps; i++) {
          const nx = h - 1 - y
          const ny = x
          x = nx; y = ny
          const tmp = w; w = h; h = tmp
        }
        return { offX: x, offY: y }
      }

      if (this._heldRoomMinions?.length) {
        for (const { minion, offX, offY } of this._heldRoomMinions) {
          const r = rotateOff(offX, offY)
          const nx = room.gridX + r.offX
          const ny = room.gridY + r.offY
          minion.tileX  = nx
          minion.tileY  = ny
          minion.worldX = nx * TS + TS / 2
          minion.worldY = ny * TS + TS / 2
          minion.homeTileX = nx
          minion.homeTileY = ny
          minion.assignedRoomId = room.instanceId
          minion._heldByPlayer = false
          minion._patrolTarget = null
          minion._patrolAccum  = 0
          minion._chasePath    = null
        }
        this._heldRoomMinions = null
      }

      // Re-anchor items that travelled with the room. Beacons/fountains
      // also re-bind their roomId to the new room instance so beacon-aura
      // and fountain heal-on-stand lookups continue to resolve.
      if (this._heldRoomItems) {
        const d = this._gameState.dungeon
        const place = (carried, target, opts = {}) => {
          for (const { data, offX, offY } of carried) {
            const r = rotateOff(offX, offY)
            data.tileX = room.gridX + r.offX
            data.tileY = room.gridY + r.offY
            if (opts.rebindRoom) data.roomId = room.instanceId
            if (opts.withWorld) {
              data.worldX = data.tileX * TS + TS / 2
              data.worldY = data.tileY * TS + TS / 2
            }
            target.push(data)
          }
        }
        d.treasureChests ??= []; place(this._heldRoomItems.treasureChests, d.treasureChests)
        d.beacons        ??= []; place(this._heldRoomItems.beacons,        d.beacons,   { rebindRoom: true })
        d.fountains      ??= []; place(this._heldRoomItems.fountains,      d.fountains, { rebindRoom: true })
        d.keyChests      ??= []; place(this._heldRoomItems.keyChests,      d.keyChests)
        d.traps          ??= []; place(this._heldRoomItems.traps,          d.traps)
        const ph = this._heldRoomItems.phylactery
        if (ph) {
          const r = rotateOff(ph.offX, ph.offY)
          ph.data.tileX = room.gridX + r.offX
          ph.data.tileY = room.gridY + r.offY
          ph.data.worldX = ph.data.tileX * TS + TS / 2
          ph.data.worldY = ph.data.tileY * TS + TS / 2
          ph.data.roomId = room.instanceId
          this._gameState.phylactery = ph.data
        }
        this._heldRoomItems = null
      }
      // Move-drop complete — clear the gold-neutral flag so the NEXT
      // placement (a fresh room from the build menu) charges correctly.
      const wasMoveDrop = !!this._heldMoveRoom
      this._heldMoveRoom = false
      this._heldMoveRoomRotation = null
      this._heldMoveCaptureW     = null
      this._heldMoveCaptureH     = null
      this._heldMoveRoomInstanceId = null
      this._lastPlaced = { kind: 'room', entity: room, goldCost: cost }
      // A relocated room fires ROOM_MOVED (not ROOM_PLACED) so the
      // companion comments on the move rather than a fresh build.
      if (wasMoveDrop) EventBus.emit('ROOM_MOVED', { room })
      const max = DungeonGridClass.effectiveMaxPerDungeon(def, this._gameState.boss?.level ?? 1)
      const atCap = max != null && this._gameState.dungeon.rooms.filter(r => r.definitionId === def.id).length >= max
      this._cancelSelection()
      if (atCap) this._renderActivePalette()
    }
    this._refreshStats()
  }

  _confirmMinionPlacement(tx, ty) {
    const def = this._selected
    const result = this._validateMinionPlacement(def, tx, ty)
    if (!result.valid) {
      this._showPlacementError(result.violations[0] ?? 'Cannot place minion here')
      return
    }

    const cost = this._effectiveMinionCost(def)
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) this._gameState.player.gold -= cost

    const room      = this._dungeonGrid.getRoomAtTile(tx, ty)
    const bossLevel = this._gameState.boss?.level ?? 1
    const dayNumber = this._gameState.meta?.dayNumber ?? 1
    const minion = createMinion(def, { x: tx, y: ty }, room?.instanceId ?? null, { bossLevel, dayNumber })
    // DAMNED · Pact of Glass — minions placed free during the bribe night
    // can never be sold back for gold (anti free-recycle abuse).
    if ((this._gameState._mechanicFlags ?? {}).glassFreeNight) minion._noSellValue = true

    // Phase 6e: apply archetype-gated stat multiplier (e.g. Tyrant 2×, Architect 0.85×)
    const arch = this._gameState.player?.archetypeModifiers
    const mul  = arch?.minionStatMultiplier ?? 1
    if (mul !== 1) {
      minion.stats.attack    = Math.round(minion.stats.attack * mul)
      minion.stats.defense   = Math.round(minion.stats.defense * mul)
      minion.resources.maxHp = Math.round(minion.resources.maxHp * mul)
      minion.resources.hp    = minion.resources.maxHp
    }

    // [Removed 2026-04-30] treasure_room mini-boss auto-promotion. The
    // Throne Room handler in RoomBehaviorSystem now owns mini-boss spawns.

    this._gameState.minions.push(minion)
    this._lastPlaced = { kind: 'minion', entity: minion, goldCost: cost }

    this._playMinionPlaceSfx()
    EventBus.emit('MINION_PLACED', { minion })
    this._refreshStats()
  }

  _playMinionPlaceSfx() {
    if (!this.cache?.audio?.exists?.('sfx-minion-place')) return
    try { this.sound.play('sfx-minion-place', { volume: 0.7 }) } catch {}
  }

  _confirmTrapPlacement(tx, ty) {
    const def = this._selected
    const result = this._validateTrapPlacement(def, tx, ty)
    if (!result.valid) {
      this._showPlacementError(result.violations[0] ?? 'Cannot place trap here')
      return
    }

    // Wall traps face the room they're mounted toward; floor traps use the
    // R-key facing (cannon direction / saw track orientation).
    const facing = def.placement === 'wall'
      ? this._wallTrapFacing(tx, ty)
      : this._trapFacing

    // MOVE tool — relocate the held trap in place. Same instance (knowledge
    // / brand state carries over), gold-neutral, cancel-safe.
    if (this._heldMoveTrap) {
      const trap = this._heldMoveTrap
      // The trap followed the cursor, so its current tile is the drop spot —
      // the ORIGINAL mount cell to recheck lives on _heldMoveTrapOrigin.
      const origin = this._heldMoveTrapOrigin ?? { tileX: trap.tileX, tileY: trap.tileY }
      const wasWall = trap.placement === 'wall'
      const fp = trap.footprint ?? { w: 1, h: 1 }
      trap.tileX = tx
      trap.tileY = ty
      trap.facing = facing
      trap.worldX = (tx + fp.w / 2) * TS
      trap.worldY = (ty + fp.h / 2) * TS
      trap.state = {}
      trap.cooldownUntil = 0
      if (wasWall) this._dungeonGrid.recheckAutoConnect(origin.tileX, origin.tileY)
      this._heldMoveTrap = null
      this._heldMoveTrapOrigin = null
      this._playBuildSfx()
      this._cancelSelection()
      this._refreshStats()
      return
    }

    const cost = this._effectiveTrapCost(def)
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) this._gameState.player.gold -= cost

    const trap = createTrap(def, { tileX: tx, tileY: ty, facing })
    this._gameState.dungeon.traps.push(trap)
    this._lastPlaced = { kind: 'trap', entity: trap, goldCost: cost }

    this._playBuildSfx()
    EventBus.emit('TRAP_PLACED', { trap })
    this._refreshStats()
  }

  // ── Door Lock helpers ──────────────────────────────────────────────────
  // Flood-fill TILE.DOOR cells connected to (sx, sy) so we can lock every
  // door tile of a doorway in one shot regardless of which cell the
  // player clicked.
  _findDoorwayTiles(sx, sy) {
    const tiles = this._dungeonGrid.getTiles()
    if (tiles[sy]?.[sx] !== TILE.DOOR) return []
    const result = []
    const visited = new Set()
    const queue = [{ x: sx, y: sy }]
    while (queue.length > 0) {
      const { x, y } = queue.shift()
      const k = `${x},${y}`
      if (visited.has(k)) continue
      visited.add(k)
      if (tiles[y]?.[x] !== TILE.DOOR) continue
      result.push({ x, y })
      queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 })
    }
    return result
  }

  // Reachability for the key chest: from the entry-hall north tile, can
  // we reach (tx, ty) without crossing any tile in `blockedTiles` (the
  // staged lock's door tiles)? Treats other already-placed locked doors
  // as walls too so multi-lock dungeons stay solvable.
  _validateKeyChestPlacement(tx, ty, blockedTiles) {
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) return { valid: false, reason: 'Place inside a room' }
    if (room.definitionId === 'boss_chamber') return { valid: false, reason: 'Not in boss chamber' }
    if (room.definitionId === 'entry_hall')   return { valid: false, reason: 'Not in entry hall' }
    const tt = this._dungeonGrid.getTileType?.(tx, ty)
    if (tt !== TILE.FLOOR && tt !== TILE.BOSS_FLOOR) {
      return { valid: false, reason: 'Place on a floor tile' }
    }
    const entries = this._gameState.dungeon.rooms.filter(r => r.definitionId === 'entry_hall')
    if (entries.length === 0) return { valid: false, reason: 'Place an Entry Hall first' }
    const blockedSet = new Set()
    for (const t of blockedTiles) blockedSet.add(`${t.x},${t.y}`)
    for (const lock of this._gameState.dungeon.locks ?? []) {
      for (const t of lock.doorTiles) blockedSet.add(`${t.x},${t.y}`)
    }
    // The key chest must be grabbable BEFORE the lock seals the way — so
    // it's valid as long as it's reachable from AT LEAST ONE entry hall
    // without crossing the staged (or any existing) lock's door tiles.
    let reachable = false
    for (const entry of entries) {
      const startX = entry.gridX + Math.floor(entry.width / 2)
      const startY = entry.gridY + 1
      const path = PathfinderSystem.findPath(
        { x: startX, y: startY }, { x: tx, y: ty }, this._dungeonGrid,
        null, 0, blockedSet,
      )
      if (path) { reachable = true; break }
    }
    if (!reachable) return { valid: false, reason: 'Chest unreachable past the lock' }
    return { valid: true }
  }

  // True when (tx, ty) IS or is orthogonally adjacent to a TILE.DOOR.
  // Used by item placement to keep collision-blocking items away from
  // doorways (otherwise advs/minions can't enter the room).
  _isAdjacentToDoor(tx, ty) {
    const tiles = this._dungeonGrid.getTiles?.() ?? []
    for (const [dx, dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
      if (tiles[ty + dy]?.[tx + dx] === TILE.DOOR) return true
    }
    return false
  }

  // True when (tx, ty) is already taken by another placed item with
  // collision (chest, beacon, fountain, phylactery, trap). The item currently
  // being moved (it follows the cursor and is still in gameState) is excluded
  // so its own drop tile isn't reported as occupied by itself.
  _isTileOccupiedByItem(tx, ty) {
    const d = this._gameState.dungeon ?? {}
    const heldChestId = this._heldMoveItem?.kind === 'treasure_chest' ? this._heldMoveItem.data?.instanceId : null
    const heldPhyl    = this._heldMoveItem?.kind === 'phylactery'
    if ((d.beacons        ?? []).some(b => b.tileX === tx && b.tileY === ty)) return true
    if ((d.fountains      ?? []).some(f => f.tileX === tx && f.tileY === ty)) return true
    if ((d.keyChests      ?? []).some(c => c.tileX === tx && c.tileY === ty)) return true
    if ((d.treasureChests ?? []).some(c => c.instanceId !== heldChestId && c.tileX === tx && c.tileY === ty)) return true
    if ((d.traps          ?? []).some(t => t.tileX === tx && t.tileY === ty)) return true
    if (!heldPhyl && this._gameState.phylactery && this._gameState.phylactery.tileX === tx && this._gameState.phylactery.tileY === ty) return true
    return false
  }

  // Common floor-tile guard for placeable items inside non-boss/non-entry
  // rooms with collision (Beacon + Fountain). Returns { valid, reason, room }.
  _validateRoomFloorPlacement(tx, ty, opts = {}) {
    // DAMNED · The Insomniac — no building on a locked night.
    if ((this._gameState._mechanicFlags ?? {}).insomniacLockTonight) {
      return { valid: false, reason: 'The Insomniac — no building tonight' }
    }
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) return { valid: false, reason: 'Place inside a room' }
    if (room.definitionId === 'boss_chamber') return { valid: false, reason: 'Not in boss chamber' }
    if (room.definitionId === 'entry_hall')   return { valid: false, reason: 'Not in entry hall' }
    const tt = this._dungeonGrid.getTileType?.(tx, ty)
    if (tt !== TILE.FLOOR && tt !== TILE.BOSS_FLOOR) {
      return { valid: false, reason: 'Place on a floor tile' }
    }
    if (this._isAdjacentToDoor(tx, ty)) {
      return { valid: false, reason: 'Cannot block a doorway' }
    }
    if (this._isTileOccupiedByItem(tx, ty)) {
      return { valid: false, reason: 'Tile is occupied' }
    }
    if (opts.differentRoomThan && room.instanceId === opts.differentRoomThan) {
      return { valid: false, reason: 'Must be in a different room' }
    }
    return { valid: true, room }
  }

  // Phase 1b.4 — Lich Phylactery placement. Single-tile, free, must be inside
  // a non-boss room. Stores on `gameState.phylactery`.
  _confirmItemPlacement(tx, ty) {
    const def = this._selected
    if (!def) return
    if (def.id === 'door_lock') {
      this._confirmDoorLock(tx, ty)
      return
    }
    if (def.id === 'key_chest') {
      this._confirmKeyChest(tx, ty)
      return
    }
    if (def.id === 'soul_bound_beacon') {
      this._confirmSoulBeacon(tx, ty)
      return
    }
    if (def.id === 'healing_fountain') {
      this._confirmHealingFountain(tx, ty)
      return
    }
    if (def.id?.startsWith('treasure_chest_')) {
      this._confirmTreasureChest(tx, ty)
      return
    }
    if (def.id === 'phylactery_heart') {
      const isMove = this._heldMoveItem?.kind === 'phylactery'
      // One heart per run — destruction is permanent. BuildMenu already
      // hides the chip, but keep this defensive guard in case anything
      // (hotkey, cheat path, future shortcut) bypasses that filter.
      if (!isMove && this._gameState.player?._phylacteryDestroyedThisRun) {
        this._showPlacementError('Phylactery destroyed — only one per run')
        return
      }
      if (!isMove && this._gameState.phylactery) {
        this._showPlacementError('Phylactery already placed')
        return
      }
      const room = this._dungeonGrid.getRoomAtTile(tx, ty)
      if (!room) {
        this._showPlacementError('Place the heart inside a room')
        return
      }
      if (room.definitionId === 'boss_chamber' || room.definitionId === 'entry_hall') {
        this._showPlacementError(room.definitionId === 'entry_hall'
          ? 'Heart cannot live in the entry hall'
          : 'Heart cannot live in the boss chamber')
        return
      }
      // Tile must be an interior floor cell. Walls/void block placement.
      const tt = this._dungeonGrid?.getTileType?.(tx, ty)
      if (tt === TILE.WALL || tt === TILE.VOID || tt === TILE.BOSS_WALL) {
        this._showPlacementError('Place the heart on a floor tile')
        return
      }

      const TS_LOCAL = TS
      // Move-drop reuses the existing phylactery (preserving instanceId
      // and current HP) at the new tile. Fresh placement creates a new one.
      const phyl = isMove
        ? {
            ...this._heldMoveItem.data,
            roomId: room.instanceId,
            tileX:  tx,
            tileY:  ty,
            worldX: tx * TS_LOCAL + TS_LOCAL / 2,
            worldY: ty * TS_LOCAL + TS_LOCAL / 2,
          }
        : {
            instanceId: `phyl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            definitionId: def.id,
            roomId: room.instanceId,
            tileX:  tx,
            tileY:  ty,
            worldX: tx * TS_LOCAL + TS_LOCAL / 2,
            worldY: ty * TS_LOCAL + TS_LOCAL / 2,
            resources: {
              hp:    def.baseStats?.hp ?? 200,
              maxHp: def.baseStats?.hp ?? 200,
            },
            defense: def.baseStats?.defense ?? 0,
            spriteKey: def.spriteKey ?? 'heart-full',
            placedDay: this._gameState.meta?.dayNumber ?? 1,
          }
      this._gameState.phylactery = phyl
      if (isMove) {
        this._heldMoveItem = null
      } else {
        this._lastPlaced = { kind: 'item', entity: phyl, goldCost: 0 }
      }

      EventBus.emit('PHYLACTERY_PLACED', { phylactery: phyl })
      this._cancelSelection()
      this._refreshStats()
      return
    }
    this._showPlacementError(`Unknown item: ${def.id}`)
  }

  // Door Lock placement step 1 — click a doorway, stage the lock, force
  // the player into key-chest placement. The lock isn't committed (and
  // gold isn't deducted) until the chest commit fires.
  _confirmDoorLock(tx, ty) {
    const def = this._selected
    if (this._dungeonGrid.getTileType?.(tx, ty) !== TILE.DOOR) {
      this._showPlacementError('Click on a doorway')
      return
    }
    const doorTiles = this._findDoorwayTiles(tx, ty)
    if (doorTiles.length === 0) {
      this._showPlacementError('No doorway here')
      return
    }
    // Reject if any of these tiles already belong to an existing lock.
    const tileKey = (t) => `${t.x},${t.y}`
    const newKeys = new Set(doorTiles.map(tileKey))
    const dupe = (this._gameState.dungeon.locks ?? []).some(l =>
      l.doorTiles.some(t => newKeys.has(tileKey(t)))
    )
    if (dupe) {
      this._showPlacementError('Doorway already locked')
      return
    }
    // The boss chamber doorway is unlockable — locking it could softlock
    // the run if no adventurer carries a key / lockpick / break ability.
    for (const t of doorTiles) {
      const r = this._dungeonGrid.getRoomAtTile(t.x, t.y)
      if (r?.definitionId === 'boss_chamber') {
        this._showPlacementError('Cannot lock the boss chamber doorway')
        return
      }
    }
    const cost = applyMerchantPrice(this._gameState, def.id,
      Math.round((def.goldCost ?? 0) * buildScaleMul(this._gameState)))
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD && this._gameState.player.gold < cost) {
      this._showPlacementError(`Need ${cost} gold (you have ${this._gameState.player.gold})`)
      return
    }
    // Force-select the Key Chest. The user must commit a chest before
    // the lock + gold cost finalize.
    const items = this.cache.json.get('items') ?? []
    const keyChestDef = items.find(it => it.id === 'key_chest')
    if (!keyChestDef) {
      this._showPlacementError('Key Chest item missing — see items.json')
      return
    }
    this._pendingTradeOff = { stage: 'awaiting_chest', doorTiles, goldCost: cost }
    this._selected     = keyChestDef
    this._selectedKind = 'item'
    this._previewTileX = -1
    this._previewTileY = -1
    this._showPlacementError('Place a Key Chest where adventurers can reach it (ESC to cancel)')
  }

  // Door Lock placement step 2 — commit the chest, the lock, and the
  // gold debit together, then clear the pending state.
  _confirmKeyChest(tx, ty) {
    if (!this._pendingTradeOff) {
      this._showPlacementError('Key chests are placed via Door Lock')
      return
    }
    const blocked = this._pendingTradeOff.doorTiles
    const v = this._validateKeyChestPlacement(tx, ty, blocked)
    if (!v.valid) {
      this._showPlacementError(v.reason)
      return
    }
    const cost = this._pendingTradeOff.goldCost ?? 0
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) this._gameState.player.gold -= cost
    const lockId  = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const chestId = `chest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    this._gameState.dungeon.locks ??= []
    this._gameState.dungeon.locks.push({
      id: lockId, doorTiles: blocked, keyChestId: chestId,
      unlocked: false, broken: false,
    })
    this._gameState.dungeon.keyChests ??= []
    this._gameState.dungeon.keyChests.push({
      instanceId: chestId, tileX: tx, tileY: ty, lockId, opened: false,
    })
    this._lastPlaced = { kind: 'item', entity: 'door_lock_pair', goldCost: cost,
      lockId, chestId }
    EventBus.emit('LOCK_PLACED', { lockId, chestId, doorTiles: blocked, tileX: tx, tileY: ty })
    EventBus.emit('LOCKS_CHANGED')
    // Lock + chest land together — play the door-close clack for the
    // lock and the chest-open creak for the chest. Both clips already
    // ship in Preload.
    try {
      if (this.cache.audio.exists('sfx-close-door')) this.sound.play('sfx-close-door', { volume: 0.7 })
      if (this.cache.audio.exists('sfx-chest-open')) this.sound.play('sfx-chest-open', { volume: 0.6 })
    } catch {}
    this._pendingTradeOff = null
    this._cancelSelection()
    this._refreshStats()
  }

  // Soul-Bound Beacon placement — step 1. Stage the beacon, force the
  // player into Healing Fountain placement (must be in a different room).
  _confirmSoulBeacon(tx, ty) {
    const def = this._selected
    const v = this._validateRoomFloorPlacement(tx, ty)
    if (!v.valid) { this._showPlacementError(v.reason); return }
    // Max 1 beacon per room.
    const here = (this._gameState.dungeon.beacons ?? []).filter(b => b.roomId === v.room.instanceId)
    if (here.length > 0) { this._showPlacementError('Max 1 Beacon per room'); return }

    const cost = applyMerchantPrice(this._gameState, def.id,
      Math.round((def.goldCost ?? 0) * buildScaleMul(this._gameState)))
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD && this._gameState.player.gold < cost) {
      this._showPlacementError(`Need ${cost} gold (you have ${this._gameState.player.gold})`)
      return
    }
    const items = this.cache.json.get('items') ?? []
    const fountainDef = items.find(it => it.id === 'healing_fountain')
    if (!fountainDef) {
      this._showPlacementError('Healing Fountain item missing — see items.json')
      return
    }
    this._pendingTradeOff = {
      stage: 'awaiting_fountain',
      kind:  'beacon',
      tileX: tx, tileY: ty, roomId: v.room.instanceId,
      goldCost: cost,
    }
    this._selected     = fountainDef
    this._selectedKind = 'item'
    this._previewTileX = -1
    this._previewTileY = -1
    this._showPlacementError('Place a Healing Fountain in a different room (ESC to cancel)')
  }

  // Treasure Chest placement — single-tile, no trade-off. Tier comes
  // from def.tier; only one chest per tier allowed in the dungeon.
  _confirmTreasureChest(tx, ty) {
    const def = this._selected
    const v = this._validateRoomFloorPlacement(tx, ty)
    if (!v.valid) { this._showPlacementError(v.reason); return }
    const tier = def.tier ?? 1
    // Move-drop path: chest was picked up via the MOVE tool. Reuse the
    // existing instance (preserves instanceId + opened flag) and skip
    // the cap check (it was just removed) + gold cost (move is neutral).
    const isMove = this._heldMoveItem?.kind === 'treasure_chest' &&
                   this._heldMoveItem.data?.tier === tier
    if (!isMove) {
      // Only player-placed chests count toward the per-tier cap. Treasury
      // auto-spawns (_treasurySpawn), Mimic Vault chests (_mimicCursed), and
      // Cursed Relic event drops (_cursed) live in the same array but were
      // never placed from the Items menu, so they don't fill the slot.
      const here = (this._gameState.dungeon.treasureChests ?? [])
        .filter(c => c.tier === tier && !c._treasurySpawn && !c._mimicCursed && !c._cursed)
      if (here.length >= 1) {
        this._showPlacementError(`Tier ${tier} chest already placed`)
        return
      }
    }
    const cost = isMove ? 0 : applyMerchantPrice(this._gameState, def.id,
      Math.round((def.goldCost ?? 0) * buildScaleMul(this._gameState)))
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) {
      if (this._gameState.player.gold < cost) {
        this._showPlacementError(`Need ${cost} gold (you have ${this._gameState.player.gold})`)
        EventBus.emit('PLACEMENT_BLOCKED', { reason: 'insufficient_gold' })
        return
      }
      this._gameState.player.gold -= cost
    }
    const id = isMove
      ? this._heldMoveItem.data.instanceId
      : `treasure_${tier}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    this._gameState.dungeon.treasureChests ??= []
    if (isMove) {
      // The chest stayed in the array and followed the cursor — just pin it to
      // the drop tile (no duplicate push) and release the carry. All flags
      // (instanceId, tier, opened, _cursed, …) are intact since it's the same
      // object.
      const chest = this._gameState.dungeon.treasureChests.find(c => c.instanceId === id)
      if (chest) { chest.tileX = tx; chest.tileY = ty }
      this._heldMoveItem = null
    } else {
      this._gameState.dungeon.treasureChests.push({ instanceId: id, tileX: tx, tileY: ty, tier, opened: false })
      this._lastPlaced = { kind: 'item', entity: 'treasure_chest', goldCost: cost, chestId: id }
    }
    EventBus.emit('TREASURE_CHEST_PLACED', { chestId: id, tier, tileX: tx, tileY: ty })
    try {
      if (this.cache.audio.exists('sfx-build-1')) this.sound.play('sfx-build-1', { volume: 0.6 })
    } catch {}
    this._cancelSelection()
    this._refreshStats()
  }

  // Soul-Bound Beacon placement — step 2. Commit beacon + fountain + gold
  // together and clear the pending trade-off.
  _confirmHealingFountain(tx, ty) {
    if (!this._pendingTradeOff || this._pendingTradeOff.kind !== 'beacon') {
      this._showPlacementError('Healing Fountain is placed via Soul-Bound Beacon')
      return
    }
    const v = this._validateRoomFloorPlacement(tx, ty, {
      differentRoomThan: this._pendingTradeOff.roomId,
    })
    if (!v.valid) { this._showPlacementError(v.reason); return }

    const cost = this._pendingTradeOff.goldCost ?? 0
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) this._gameState.player.gold -= cost

    const beaconId   = `beacon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const fountainId = `fount_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    this._gameState.dungeon.beacons ??= []
    this._gameState.dungeon.beacons.push({
      instanceId: beaconId,
      tileX:  this._pendingTradeOff.tileX,
      tileY:  this._pendingTradeOff.tileY,
      roomId: this._pendingTradeOff.roomId,
      fountainId,
    })
    this._gameState.dungeon.fountains ??= []
    this._gameState.dungeon.fountains.push({
      instanceId: fountainId,
      tileX: tx, tileY: ty,
      roomId: v.room.instanceId,
      beaconId,
    })
    this._lastPlaced = {
      kind: 'item', entity: 'beacon_pair', goldCost: cost, beaconId, fountainId,
    }
    EventBus.emit('BEACON_PLACED', { beaconId, fountainId })
    try {
      if (this.cache.audio.exists('sfx-build-3')) this.sound.play('sfx-build-3', { volume: 0.7 })
    } catch {}
    this._pendingTradeOff = null
    this._cancelSelection()
    this._refreshStats()
  }

  // Phase 31D — Sell tool. Click a placed entity (room / minion / trap /
  // item) to sell it for a 50% gold refund. Every sale is gated behind a
  // yes / cancel confirm popup so a stray click can't wipe out progress.
  // The tool is STICKY — it stays armed after each sale (like MOVE); the
  // player exits via the SELL button, ESC, another tool, or a build slot.
  // Boss chamber + fixed rooms are immune.
  // UPGRADE tool — click a minion to pay gold and advance it one tier. Shows a
  // confirm popup with a before→after stat preview. Gold is charged here (the
  // single charge site for upgrades) before MinionEvolutionSystem.upgrade()
  // performs the persistent tier advance.
  _executeUpgradeAt(tx, ty) {
    if (this._gameState.meta?.phase !== 'night') return
    // A locked night seals the dungeon — no upgrading, same as build/sell.
    if ((this._gameState._mechanicFlags ?? {}).insomniacLockTonight) {
      this._showPlacementError('The Insomniac — the dungeon is sealed tonight')
      return
    }

    const minion = (this._gameState.minions ?? []).find(m =>
      m.aiState !== 'dead' && m.tileX === tx && m.tileY === ty
    )
    if (!minion) { this._showPlacementError('Click a minion to upgrade'); return }

    const game = this.scene.get('Game')
    const evo  = game?.minionEvolutionSystem
    if (!evo) return

    const label = minionLabel(minion.definitionId) ?? 'minion'
    if (!evo.canUpgrade(minion)) {
      if ((this._gameState._mechanicFlags ?? {}).theUnteachable) {
        this._showPlacementError('The Unteachable — your minions cannot be upgraded')
      } else if (evo.tierOf(minion) >= evo.maxTierOf(minion)) {
        this._showPlacementError(`${label} is already at its highest tier`)
      } else {
        this._showPlacementError(`${label} can't be upgraded`)
      }
      return
    }

    const minionDefs = this.cache.json.get('minionTypes') ?? []
    const chains     = this.cache.json.get('minionEvolutions') ?? {}
    const info = nextTierInfo(minion, minionDefs, chains)
    const cost = upgradeCost(this._gameState, minion, minionDefs, chains)
    if (!info || cost <= 0) { this._showPlacementError(`${label} can't be upgraded`); return }

    const have = this._gameState.player?.gold ?? 0
    if (!Balance.DEV_INFINITE_GOLD && have < cost) {
      this._showPlacementError(`Need ${cost}g to upgrade ${label} (you have ${have}g)`)
      return
    }

    // Predicted scaled stats: apply the minion's CURRENT effective multiplier
    // (its live stat ÷ its scaling base) to the next tier's base — the same
    // maths applyMinionScaling will run after the upgrade re-bases.
    const nextDef = info.nextDef
    const hpMul   = minion._baseMaxHp ? (minion.resources.maxHp / minion._baseMaxHp) : 1
    const atkMul  = minion._baseAtk   ? (minion.stats.attack    / minion._baseAtk)   : 1
    let nHp  = Math.round((nextDef?.baseStats?.hp     ?? minion.resources.maxHp) * hpMul)
    let nAtk = Math.round((nextDef?.baseStats?.attack ?? minion.stats.attack)    * atkMul)
    if (info.isFinalNext) {
      nHp  = Math.round(nHp  * (Balance.MINIBOSS_HP_MULT     ?? 1))
      nAtk = Math.round(nAtk * (Balance.MINIBOSS_ATTACK_MULT ?? 1))
    }
    const nextName = (nextDef?.name ?? info.nextId ?? 'next tier').toUpperCase()
    const curHp = minion.resources.maxHp, curAtk = minion.stats.attack
    const rewardValue = info.isFinalNext
      ? `${nextName} · TIER ${info.nextTier} · ★ MINI-BOSS`
      : `${nextName} · TIER ${info.nextTier}`
    // Mirror the dungeon-event PAY/REWARD typography (Mercenary Contract /
    // Black Market / Cursed Relic …). The shared .qf-event-prompt-row CSS
    // variants drive the per-row colour: cost = red, reward = gold, win =
    // green — so the upgrade confirm reads with the same headline layout.
    const _row = (kind, lbl, val) =>
      h('div', { className: `qf-event-prompt-row ${kind}` }, [
        h('div', { className: 'qf-event-prompt-label pix' }, lbl),
        h('div', { className: 'qf-event-prompt-value pix' }, val),
      ])
    // No explicit PAY row — the cost lives on the UPGRADE button itself
    // (`UPGRADE (${cost}g)` below) so showing it again here would be a
    // duplicate readout.
    const messageNode = h('div', { className: 'qf-event-prompt' }, [
      _row('reward', 'UPGRADE', rewardValue),
      _row('win',    'HP',      `${curHp} → ${nHp}`),
      _row('win',    'ATK',     `${curAtk} → ${nAtk}`),
    ])

    EventBus.emit('SHOW_CONFIRM', {
      title:        `UPGRADE ${label.toUpperCase()}`,
      messageNode,
      confirmLabel: `UPGRADE (${cost}g)`,
      cancelLabel:  'CANCEL',
      theme:        'gold',
      onConfirm: () => {
        const gs = this._gameState
        const liveHave = gs.player?.gold ?? 0
        if (!Balance.DEV_INFINITE_GOLD && liveHave < cost) {
          EventBus.emit('SHOW_TOAST', { message: 'Not enough gold', type: 'error' })
          return
        }
        if (!Balance.DEV_INFINITE_GOLD) gs.player.gold = liveHave - cost
        // upgrade() advances the tier + re-bases scaling; it also emits
        // MINION_EVOLVED (→ evolve SFX) and MINIBOSS_PROMOTED on the final tier.
        const ok = evo.upgrade(minion)
        if (!ok) {
          if (!Balance.DEV_INFINITE_GOLD) gs.player.gold = liveHave   // refund
          return
        }
        // No ENTITY_SOLD here — that animates a shatter/removal. The upgrade's
        // feedback is the evolve SFX (auto-fired by MINION_EVOLVED inside
        // upgrade()), the success toast, and the gold counter dropping.
        EventBus.emit('SHOW_TOAST', { message: `Upgraded to ${nextName}!`, type: 'success' })
        this._refreshStats()
      },
      onCancel: () => {},
    })
  }

  _executeSellAt(tx, ty) {
    // Selling is a build-phase action only — never during the day.
    if (this._gameState.meta?.phase !== 'night') return
    // DAMNED · The Insomniac — a locked night seals the dungeon: no selling.
    if ((this._gameState._mechanicFlags ?? {}).insomniacLockTonight) {
      this._showPlacementError('The Insomniac — the dungeon is sealed tonight')
      return
    }
    // DAMNED · The Sealed Vault — selling is forbidden for the rest of the run.
    if ((this._gameState._mechanicFlags ?? {}).theSealedVault) {
      this._showPlacementError('The Sealed Vault is shut — you can sell nothing.')
      return
    }

    // Treasure Chest.
    const treasureHit = (this._gameState.dungeon.treasureChests ?? []).find(c =>
      c.tileX === tx && c.tileY === ty
    )
    if (treasureHit) {
      // Treasure Hunters event — chests are locked from selling the night
      // it's announced so the player can't dodge the raid by cashing out.
      // The `treasureHuntersActive` flag isn't set until day-begin, so on
      // the ANNOUNCE night we gate on the scheduled event id instead.
      const _ef = this._gameState._eventFlags ?? {}
      if (_ef.treasureHuntersActive || this._gameState.events?.scheduledId === 'treasure_hunters') {
        this._showPlacementError("Treasure Hunters are coming — you can't sell chests tonight!")
        return
      }
      const def    = (this.cache.json.get('items') ?? []).find(it => it.id === `treasure_chest_${treasureHit.tier}`)
      const refund = this._sellRefund('treasureChest', treasureHit)
      this._promptSell(
        `Sell ${(def?.name ?? 'Treasure Chest').toUpperCase()} for ${refund} gold?`,
        () => this._doSellTreasureChest(treasureHit),
        this._sellFxAt(refund, treasureHit.tileX, treasureHit.tileY),
      )
      return
    }

    // Soul-Bound Beacon / Healing Fountain — paired; selling either half
    // removes both. Refund is 50% of the Beacon's gold cost.
    const beaconHit   = (this._gameState.dungeon.beacons ?? []).find(b => b.tileX === tx && b.tileY === ty)
    const fountainHit = (this._gameState.dungeon.fountains ?? []).find(f => f.tileX === tx && f.tileY === ty)
    if (beaconHit || fountainHit) {
      const beacon   = beaconHit   ?? (this._gameState.dungeon.beacons ?? []).find(b => b.instanceId === fountainHit.beaconId)
      const fountain = fountainHit ?? (this._gameState.dungeon.fountains ?? []).find(f => f.instanceId === beaconHit.fountainId)
      const refund   = this._sellRefund('beacon', beacon)
      this._promptSell(
        `Sell the SOUL-BOUND BEACON for ${refund} gold?\nIts paired Healing Fountain is also removed.`,
        () => this._doSellBeaconPair(beacon, fountain),
        this._sellFxAt(refund, beacon.tileX, beacon.tileY),
      )
      return
    }

    // Key Chest — paired with a Door Lock; selling removes both. Refund is
    // 50% of the lock's gold cost (the chest itself was free).
    const chestHit = (this._gameState.dungeon.keyChests ?? []).find(c => c.tileX === tx && c.tileY === ty)
    if (chestHit) {
      const refund = this._sellRefund('keyChest', chestHit)
      this._promptSell(
        `Sell the DOOR LOCK for ${refund} gold?\nIts paired Key Chest is also removed.`,
        () => this._doSellKeyChest(chestHit),
        this._sellFxAt(refund, chestHit.tileX, chestHit.tileY),
      )
      return
    }

    // Single minion — leaves the room standing. Takes priority over room
    // sell when the clicked tile has an alive minion on it.
    const minionHit = (this._gameState.minions ?? []).find(m =>
      m.aiState !== 'dead' && m.tileX === tx && m.tileY === ty
    )
    if (minionHit) {
      const mDef   = (this.cache.json.get('minionTypes') ?? []).find(d => d.id === minionHit.definitionId)
      const refund = this._sellRefund('minion', minionHit)
      this._promptSell(
        `Sell ${(mDef?.name ?? minionHit.definitionId ?? 'minion').toUpperCase()} for ${refund} gold?`,
        () => this._doSellMinion(minionHit),
        { refund, worldX: minionHit.worldX, worldY: minionHit.worldY },
      )
      return
    }

    // Trap — click anywhere on the trap as the player sees it.
    const trapHit = (this._gameState.dungeon.traps ?? [])
      .find(t => this._trapCoversTile(t, tx, ty))
    if (trapHit) {
      const tDef   = (this.cache.json.get('trapTypes') ?? []).find(d => d.id === trapHit.definitionId)
      const refund = this._sellRefund('trap', trapHit)
      this._promptSell(
        `Sell ${(tDef?.name ?? trapHit.definitionId ?? 'trap').toUpperCase()} for ${refund} gold?`,
        () => this._doSellTrap(trapHit),
        this._sellFxAt(refund, trapHit.tileX, trapHit.tileY),
      )
      return
    }

    // Room — selling a room also sells everything placed inside it.
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) return
    if (room.definitionId === 'boss_chamber') {
      this._showPlacementError('Cannot sell the boss chamber')
      return
    }
    const def = (this.cache.json.get('rooms') ?? []).find(d => d.id === room.definitionId)
    if (def?.placementRules?.fixed) {
      this._showPlacementError('Cannot sell a fixed room')
      return
    }
    this._promptRoomSell(room, def)
  }

  // Gather everything inside a room's footprint, total the refund, and
  // pop the confirm — the message spells out what else gets sold so the
  // player isn't surprised that the room's contents go with it.
  _promptRoomSell(room, def) {
    const inside = (e) => !!e &&
      e.tileX >= room.gridX && e.tileX < room.gridX + room.width &&
      e.tileY >= room.gridY && e.tileY < room.gridY + room.height

    const minions   = (this._gameState.minions ?? []).filter(m => m.aiState !== 'dead' && inside(m))
    const traps     = (this._gameState.dungeon.traps ?? []).filter(t => inside(t))
    const chests    = (this._gameState.dungeon.treasureChests ?? []).filter(c => inside(c))
    // Treasure Hunters lock chests from being cashed out the night they're
    // announced — selling a ROOM that contains chests would dodge that, so
    // refuse it too. (Gate on scheduledId: the active flag isn't set until
    // day-begin.) Rooms with no chests sell normally.
    const _ef = this._gameState._eventFlags ?? {}
    if (chests.length > 0 &&
        (_ef.treasureHuntersActive || this._gameState.events?.scheduledId === 'treasure_hunters')) {
      this._showPlacementError("Treasure Hunters are coming — you can't sell rooms holding chests tonight!")
      return
    }
    const keyChests = (this._gameState.dungeon.keyChests ?? []).filter(c => inside(c))
    // A beacon/fountain pair is pulled in if EITHER half sits in the room.
    const fountains = this._gameState.dungeon.fountains ?? []
    const beaconPairs = []
    for (const b of (this._gameState.dungeon.beacons ?? [])) {
      const f = fountains.find(x => x.instanceId === b.fountainId)
      if (inside(b) || inside(f)) beaconPairs.push({ beacon: b, fountain: f })
    }
    const phyl = inside(this._gameState.phylactery) ? this._gameState.phylactery : null

    // Refund: 50% of what THIS room copy cost + 50% of every sellable
    // thing inside it. effectiveRoomCost on the room list MINUS the sold
    // copy reports the price that copy was placed at.
    const roomsMinusSold = (this._gameState.dungeon?.rooms ?? [])
      .filter(r => r.instanceId !== room.instanceId)
    const roomRefund = Math.floor(DungeonGridClass.effectiveRoomCost(def, roomsMinusSold) * 0.5)
    let refund = roomRefund
    for (const m of minions)     refund += this._sellRefund('minion', m)
    for (const t of traps)       refund += this._sellRefund('trap', t)
    for (const c of chests)      refund += this._sellRefund('treasureChest', c)
    for (const c of keyChests)   refund += this._sellRefund('keyChest', c)
    for (const p of beaconPairs) refund += this._sellRefund('beacon', p.beacon)

    // "Also removes …" warning so the cascading sale isn't a surprise.
    const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`
    const parts = []
    if (minions.length)     parts.push(plural(minions.length, 'minion'))
    if (traps.length)       parts.push(plural(traps.length, 'trap'))
    if (chests.length)      parts.push(plural(chests.length, 'treasure chest'))
    if (keyChests.length)   parts.push(`${plural(keyChests.length, 'key chest')} (+ door lock)`)
    if (beaconPairs.length) parts.push(`${plural(beaconPairs.length, 'beacon')} (+ fountain)`)
    if (phyl)               parts.push('your PHYLACTERY')
    const roomLabel = (def?.name ?? room.definitionId ?? 'this room').toUpperCase()
    const warnLine  = parts.length ? `\nThis also removes: ${parts.join(', ')}.` : ''

    this._promptSell(
      `Sell ${roomLabel} for ${refund} gold?${warnLine}`,
      () => this._finalizeRoomSell(room, roomRefund, { minions, traps, chests, keyChests, beaconPairs, phyl }),
      // `refund` here is the grand total (room + everything inside it).
      { refund, worldX: (room.gridX + room.width / 2) * TS, worldY: (room.gridY + room.height / 2) * TS },
    )
  }

  // Emit the shared yes / cancel confirm popup for a sell. onConfirm runs
  // the actual removal; the SELL tool stays armed either way.
  _promptSell(message, doSell, sellFx = null) {
    EventBus.emit('SHOW_CONFIRM', {
      message,
      confirmLabel: 'SELL',
      cancelLabel:  'CANCEL',
      theme:        'gold',
      onConfirm: () => {
        // Run the sale first — `_doSell*` / `_finalizeRoomSell` return
        // `false` when called against an already-removed entity, which is
        // how we dedupe leak-amplified re-fires. Only the call that
        // actually completes the sale shows the toast, so the player sees
        // exactly one readout. Free / zero-refund sales still toast.
        const happened = doSell()
        if (happened !== false && sellFx) {
          const refund = sellFx.refund ?? 0
          EventBus.emit('SHOW_TOAST', {
            message: refund > 0 ? `Sold · +${refund} gold` : 'Sold',
            type:    'success',
          })
        }
        this._refreshStats()
      },
      onCancel:  () => {},
    })
  }

  // 50% gold refund for a sellable entity. Single source of truth so the
  // confirm popup's total and the gold actually credited can't drift.
  // True when tile (tx,ty) lies on trap `t` as the player SEES it — its
  // footprint for normal traps, or the saw blade's full track (the saw
  // sprite spans the whole track, so a click anywhere along it must select
  // the trap). Used by the sell + move hit-tests so the player isn't
  // restricted to the trap's single anchor tile.
  _trapCoversTile(t, tx, ty) {
    if (!t) return false
    if (t.definitionId === 'saw_blade') {
      const def = (this.cache.json.get('trapTypes') ?? []).find(d => d.id === 'saw_blade')
      return trackTiles(t, def?.trackLength ?? 4).some(c => c.x === tx && c.y === ty)
    }
    const fp = t.footprint ?? { w: 1, h: 1 }
    return tx >= t.tileX && tx < t.tileX + fp.w &&
           ty >= t.tileY && ty < t.tileY + fp.h
  }

  _sellRefund(kind, entity) {
    const items = () => this.cache.json.get('items') ?? []
    if (kind === 'treasureChest') {
      // Auto-spawned chests were placed for free by their host room —
      // selling the room (or the chest individually, if that path is
      // ever opened up) MUST NOT credit gold for them. Otherwise the
      // player could place a Treasury (40g), get 4 free chests, sell
      // the room and pocket more than the room cost.
      //   _treasurySpawn  — Treasury auto-spawn batch
      //   _mimicCursed    — Mimic Vault cursed chest (also can't be
      //                      sold individually; this is the room-sell
      //                      cascade path).
      if (entity?._treasurySpawn || entity?._mimicCursed) return 0
      const d = items().find(it => it.id === `treasure_chest_${entity.tier}`)
      return Math.floor((d?.goldCost ?? 0) * 0.5)
    }
    if (kind === 'beacon') {
      const d = items().find(it => it.id === 'soul_bound_beacon')
      return Math.floor((d?.goldCost ?? 0) * 0.5)
    }
    if (kind === 'keyChest') {
      const d = items().find(it => it.id === 'door_lock')
      return Math.floor((d?.goldCost ?? 0) * 0.5)
    }
    if (kind === 'minion') {
      // DAMNED · Pact of Glass — minions placed free on the bribe night
      // carry no resale value.
      if (entity?._noSellValue) return 0
      // Garrison minions (Crypt Risen Bones, Mimic Vault mimics, Hall
      // of Trials elite, Throne Room mini-boss, Catacombs revenants)
      // are auto-spawned for free by their host room. Selling the
      // host room must NOT refund gold for them. They were never
      // paid for in the first place.
      if (entity?.class === 'garrison') return 0
      const d = (this.cache.json.get('minionTypes') ?? []).find(x => x.id === entity.definitionId)
      return Math.floor((d?.goldCost ?? 0) * 0.5)
    }
    if (kind === 'trap') {
      const d = (this.cache.json.get('trapTypes') ?? []).find(x => x.id === entity.definitionId)
      return Math.floor((d?.goldCost ?? 0) * 0.5)
    }
    return 0
  }

  // ── Pure sell-removers — credit the refund, drop the entity, emit its
  // REMOVED event. No confirm / no tool-mode change, so the room sell can
  // batch them. ──────────────────────────────────────────────────────────
  // Broadcast a sell so SellFxRenderer / MinionRenderer can play the
  // shatter / shadow-swallow animation. A dedicated event — NOT the
  // *_REMOVED events, which also fire for the MOVE tool and would wrongly
  // animate a relocation. `kind`: 'minion' | 'trap' | 'room' | 'item'.
  _emitSellFx(kind, worldX, worldY, extra = {}) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return
    EventBus.emit('ENTITY_SOLD', { kind, worldX, worldY, ...extra })
  }

  // World-space center of a tile — traps / items store tile coords only.
  _tileCenterWorld(tileX, tileY) {
    return { wx: tileX * TS + TS / 2, wy: tileY * TS + TS / 2 }
  }

  // { refund, worldX, worldY } for a tile-anchored sellable — the optional
  // third arg to _promptSell, which floats the "+Xg" readout on confirm.
  _sellFxAt(refund, tileX, tileY) {
    return { refund, worldX: tileX * TS + TS / 2, worldY: tileY * TS + TS / 2 }
  }

  _doSellTreasureChest(chest) {
    // Idempotency guard — see _doSellMinion for context (EventBus leak
    // can re-fire the confirm callback; re-runs no-op cleanly).
    const list = this._gameState.dungeon.treasureChests ?? []
    if (!list.some(c => c.instanceId === chest.instanceId)) return false
    const refund = this._sellRefund('treasureChest', chest)
    if (refund > 0) this._gameState.player.gold += refund
    this._gameState.dungeon.treasureChests = list.filter(c => c.instanceId !== chest.instanceId)
    const { wx, wy } = this._tileCenterWorld(chest.tileX, chest.tileY)
    this._emitSellFx('item', wx, wy, { refund, instanceId: chest.instanceId })
    EventBus.emit('TREASURE_CHEST_REMOVED', { chest, refund })
    return true
  }

  _doSellBeaconPair(beacon, fountain) {
    const beaconId   = beacon?.instanceId   ?? fountain?.beaconId
    const fountainId = fountain?.instanceId ?? beacon?.fountainId
    // Idempotency guard.
    const list = this._gameState.dungeon.beacons ?? []
    if (!list.some(b => b.instanceId === beaconId)) return false
    const refund = this._sellRefund('beacon', beacon)
    if (refund > 0) this._gameState.player.gold += refund
    this._gameState.dungeon.beacons = list.filter(b => b.instanceId !== beaconId)
    this._gameState.dungeon.fountains = (this._gameState.dungeon.fountains ?? [])
      .filter(f => f.instanceId !== fountainId)
    const { wx, wy } = this._tileCenterWorld(
      beacon?.tileX ?? fountain?.tileX, beacon?.tileY ?? fountain?.tileY)
    this._emitSellFx('item', wx, wy, { refund, instanceId: beaconId })
    EventBus.emit('BEACON_REMOVED', { beaconId, fountainId, refund })
    return true
  }

  _doSellKeyChest(chest) {
    // Idempotency guard.
    const list = this._gameState.dungeon.keyChests ?? []
    if (!list.some(c => c.instanceId === chest.instanceId)) return false
    const refund = this._sellRefund('keyChest', chest)
    if (refund > 0) this._gameState.player.gold += refund
    const lockIdx = (this._gameState.dungeon.locks ?? []).findIndex(l => l.id === chest.lockId)
    if (lockIdx >= 0) {
      const lock = this._gameState.dungeon.locks[lockIdx]
      this._gameState.dungeon.locks.splice(lockIdx, 1)
      EventBus.emit('LOCK_REMOVED', { lock })
    }
    this._gameState.dungeon.keyChests = list.filter(c => c.instanceId !== chest.instanceId)
    const { wx, wy } = this._tileCenterWorld(chest.tileX, chest.tileY)
    this._emitSellFx('item', wx, wy, { refund, instanceId: chest.instanceId })
    EventBus.emit('KEY_CHEST_REMOVED', { chest, refund })
    EventBus.emit('LOCKS_CHANGED')
    return true
  }

  _doSellMinion(minion) {
    // Idempotency guard. There's a known EventBus listener leak (the
    // `scene.restart()` gotcha) that lets the SHOW_CONFIRM onConfirm
    // callback re-fire multiple times for a single confirm-click. Without
    // this guard a single sell credits gold N times, multi-emits the
    // shatter FX, and so on. Re-fires no-op cleanly.
    const idx = this._gameState.minions.findIndex(x => x.instanceId === minion.instanceId)
    if (idx < 0) return false
    const refund = this._sellRefund('minion', minion)
    if (refund > 0) this._gameState.player.gold += refund
    // Emit the sell-FX BEFORE the splice so MinionRenderer can grab the
    // still-live sprite for the shadow-swallow + death animation.
    this._emitSellFx('minion', minion.worldX, minion.worldY, { minion, refund })
    this._gameState.minions.splice(idx, 1)
    EventBus.emit('MINION_REMOVED', { minion })
    return true
  }

  // SACRIFICE a minion — permanent destroy, NO refund (the Roster's
  // SACRIFICE button). Mirrors _doSellMinion's removal + shatter FX, minus the
  // gold credit. refund:0 makes _emitSellFx play the shatter only (no coin
  // float / coin sound). Same idempotency guard as _doSellMinion.
  _doSacrificeMinion(instanceId) {
    const idx = this._gameState.minions.findIndex(x => x.instanceId === instanceId)
    if (idx < 0) return false
    const minion = this._gameState.minions[idx]
    this._emitSellFx('minion', minion.worldX, minion.worldY, { minion, refund: 0 })
    this._gameState.minions.splice(idx, 1)
    EventBus.emit('MINION_REMOVED', { minion })
    return true
  }

  _doSellTrap(trap) {
    // Idempotency guard (see _doSellMinion).
    const idx = this._gameState.dungeon.traps.findIndex(x => x.instanceId === trap.instanceId)
    if (idx < 0) return false
    const refund = this._sellRefund('trap', trap)
    if (refund > 0) this._gameState.player.gold += refund
    this._gameState.dungeon.traps.splice(idx, 1)
    // A removed wall trap may free a doorway it was suppressing.
    if (trap.placement === 'wall') {
      this._dungeonGrid.recheckAutoConnect(trap.tileX, trap.tileY)
    }
    const { wx, wy } = this._tileCenterWorld(trap.tileX, trap.tileY)
    this._emitSellFx('trap', wx, wy, { refund, instanceId: trap.instanceId })
    EventBus.emit('TRAP_REMOVED', { trap, refund })
    return true
  }

  // Perform the room sale once confirmed — drop every contained entity
  // first (so their REMOVED events precede ROOM_REMOVED), then the room.
  _finalizeRoomSell(room, roomRefund, contents) {
    // Idempotency guard (see _doSellMinion). Without this a single room
    // sale would re-credit roomRefund and re-emit FX every time the
    // leak-amplified onConfirm fires.
    const rooms = this._gameState.dungeon?.rooms ?? []
    if (!rooms.some(r => r.instanceId === room.instanceId)) return false
    for (const m of contents.minions)     this._doSellMinion(m)
    for (const t of contents.traps)       this._doSellTrap(t)
    for (const c of contents.chests)      this._doSellTreasureChest(c)
    for (const c of contents.keyChests)   this._doSellKeyChest(c)
    for (const p of contents.beaconPairs) this._doSellBeaconPair(p.beacon, p.fountain)
    if (contents.phyl) {
      const phylactery = contents.phyl
      const pc = this._tileCenterWorld(phylactery.tileX, phylactery.tileY)
      this._emitSellFx('item', pc.wx, pc.wy)
      this._gameState.phylactery = null
      EventBus.emit('PHYLACTERY_REMOVED', { phylactery })
    }

    if (roomRefund > 0) this._gameState.player.gold += roomRefund
    // Shatter the whole room footprint. The room carries only its own
    // refund — contained traps / items / minions emit theirs separately;
    // SellFxRenderer sums the batch into one "+Xg" floater.
    this._emitSellFx('room',
      (room.gridX + room.width  / 2) * TS,
      (room.gridY + room.height / 2) * TS,
      { width: room.width, height: room.height, refund: roomRefund })
    if (this._lastPlaced?.entity?.instanceId === room.instanceId) {
      this._lastPlaced = null
    }
    this._dungeonGrid.removeRoom(room.instanceId)
    this._renderActivePalette()
    return true
  }

  // Relocate a minion to the clicked room — the Roster's REASSIGN flow (free
  // move, 2026-06-02). Lighter validation than _validateMinionPlacement: a
  // reassign neither charges gold nor consumes a NEW roster slot (the minion
  // already holds one), so we only gate on tile/room legality + the TARGET
  // room's per-minion cap (excluding the mover via _roomMinionCount's exceptId).
  // The minion renderer follows worldX/worldY each frame, so updating coords
  // repositions the sprite without a placement event (which would mis-count
  // "minions summoned"). Disarms after one successful reassign.
  _executeReassignAt(tx, ty) {
    const minion = this._gameState.minions.find(m => m.instanceId === this._reassignMinionId)
    if (!minion) { this._reassignMinionId = null; this._setToolMode(null, 'reassign_gone'); return }
    const tile = this._dungeonGrid.getTileType(tx, ty)
    if (tile !== TILE.FLOOR && tile !== TILE.BOSS_FLOOR) { this._showPlacementError('Click a room floor'); return }
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) { this._showPlacementError('Not inside any room'); return }
    if (room.definitionId === 'boss_chamber' || room.definitionId === 'entry_hall') {
      this._showPlacementError("Can't place minions here"); return
    }
    if (room.definitionId === 'throne_room') {
      this._showPlacementError('Throne Room only houses its mini-boss'); return
    }
    const roomCap = Balance.MINIONS_PER_ROOM_CAP ?? 5
    if (this._roomMinionCount(room.instanceId, minion.instanceId) >= roomCap) {
      this._showPlacementError(`Room full (${roomCap}) — pick another room`); return
    }
    // Relocate: drop at the clicked tile, re-home there, re-bind the room, and
    // clear in-flight AI so MinionAISystem replans from the new home.
    minion.tileX = tx; minion.tileY = ty
    minion.worldX = tx * TS + TS / 2; minion.worldY = ty * TS + TS / 2
    minion.homeTileX = tx; minion.homeTileY = ty
    minion.assignedRoomId = room.instanceId
    minion._patrolTarget = null
    minion._chasePath = null
    minion._heldByPlayer = false
    minion.aiState = 'idle'
    this._playMinionPlaceSfx()
    EventBus.emit('MINION_REASSIGNED', { minion, roomId: room.instanceId })
    EventBus.emit('SHOW_TOAST', { message: 'Minion reassigned', type: 'success' })
    this._refreshStats()
    this._reassignMinionId = null
    this._setToolMode(null, 'reassign_done')
  }

  // Phase 31D — Move tool. Reuses the existing pickup logic so minions
  // inside come along with the room. Player drops the room with a
  // second click (handled by the regular placement flow).
  _executeMoveAt(tx, ty) {
    // DAMNED · The Insomniac — a locked night seals the dungeon. The lone
    // exception is the connectivity-fix: once a disconnected-room error has
    // been flagged (player hit BEGIN DAY with an island), they may move a
    // flagged DISCONNECTED room — and only that — to reconnect the dungeon.
    // forceRoomMove then skips the trap/item pickup precedence so the click
    // grabs the ROOM itself (the thing that fixes connectivity).
    let forceRoomMove = false
    if ((this._gameState._mechanicFlags ?? {}).insomniacLockTonight) {
      const hereRoom = this._dungeonGrid.getRoomAtTile?.(tx, ty)
      // Normally only a flagged DISCONNECTED room may be moved (drag the island
      // back onto the graph). Exception: when the disconnected offender is
      // itself UNMOVABLE — an isolated boss chamber or a fixed room — there's no
      // way to drag the island, so allow moving ANY room and let the player
      // bridge a CONNECTED room over to it instead. The boss/fixed room itself
      // still can't be picked up (the room-move body below rejects it with the
      // proper message).
      const allRooms       = this.cache.json.get('rooms') ?? []
      const dungeonRooms   = this._gameState.dungeon?.rooms ?? []
      const isUnmovable = (r) => !r || r.definitionId === 'boss_chamber' ||
        !!(allRooms.find(d => d.id === r.definitionId)?.placementRules?.fixed)
      const offenderUnmovable = [...this._disconnectedRoomIds]
        .some(id => isUnmovable(dungeonRooms.find(r => r.instanceId === id)))
      const canFix = this._disconnectErrorShown && hereRoom &&
        (this._disconnectedRoomIds.has(hereRoom.instanceId) || offenderUnmovable)
      if (!canFix) {
        this._showPlacementError(this._disconnectErrorShown
          ? 'The Insomniac — move a room to reconnect the dungeon (disconnected rooms glow red)'
          : 'The Insomniac — the dungeon is sealed tonight')
        return
      }
      forceRoomMove = true
    }
    // Items take precedence over rooms — clicking a treasure chest or
    // phylactery heart on the MOVE tool should pick up THAT item, not
    // the room containing it. Paired items (beacon/fountain, key
    // chest/door lock) are rebuild-only because their pair would be
    // broken by a partial move. (Skipped entirely on a forced room-move.)
    const items = this.cache.json.get('items') ?? []

    // Trap move — the trap stays in the array (rendered at its old spot)
    // and is relocated in place on drop, so cancelling the move leaves it
    // untouched. Hit-test covers the trap as the player sees it.
    const trapHit = forceRoomMove ? null : (this._gameState.dungeon.traps ?? [])
      .find(t => this._trapCoversTile(t, tx, ty))
    if (trapHit) {
      const tDef = (this.cache.json.get('trapTypes') ?? []).find(d => d.id === trapHit.definitionId)
      if (!tDef) { this._showPlacementError('Trap def missing'); return }
      this._heldMoveTrap = trapHit
      // Origin tile so the carried trap can be rolled back on cancel and the
      // wall auto-connect recheck targets the ORIGINAL cell (the trap now
      // follows the cursor, so trap.tileX is no longer the pickup tile).
      this._heldMoveTrapOrigin = { tileX: trapHit.tileX, tileY: trapHit.tileY, facing: trapHit.facing }
      this._selected     = tDef
      this._selectedKind = 'trap'
      this._trapFacing   = trapHit.facing
      this._updateGridVisibility()
      this._showPlacementError('Moving trap — click a new spot')
      return
    }

    const treasureHit = forceRoomMove ? null : (this._gameState.dungeon.treasureChests ?? []).find(c =>
      c.tileX === tx && c.tileY === ty
    )
    if (treasureHit) {
      const chestDef = items.find(it => it.id === `treasure_chest_${treasureHit.tier}`)
      if (!chestDef) { this._showPlacementError('Chest def missing'); return }
      // Keep the chest in the array so its sprite stays drawn and follows the
      // cursor while carried (TreasureChestRenderer re-anchors from tileX/tileY
      // each frame). Finalized in place on drop; rolled back on cancel.
      this._heldMoveItem = {
        kind: 'treasure_chest', data: treasureHit,
        origin: { tileX: treasureHit.tileX, tileY: treasureHit.tileY },
      }
      this._rotation = 0
      this._selectItem(chestDef, 'item')
      this._refreshStats()
      return
    }

    if (!forceRoomMove && this._gameState.phylactery &&
        this._gameState.phylactery.tileX === tx &&
        this._gameState.phylactery.tileY === ty) {
      const heartDef = items.find(it => it.id === 'phylactery_heart')
      if (!heartDef) { this._showPlacementError('Phylactery def missing'); return }
      const phyl = this._gameState.phylactery
      // Leave it on gameState so PhylacteryRenderer keeps drawing it as it
      // follows the cursor. Finalized in place on drop; rolled back on cancel.
      this._heldMoveItem = {
        kind: 'phylactery', data: phyl,
        origin: { tileX: phyl.tileX, tileY: phyl.tileY, worldX: phyl.worldX, worldY: phyl.worldY },
      }
      this._rotation = 0
      this._selectItem(heartDef, 'item')
      this._refreshStats()
      return
    }

    if (!forceRoomMove &&
        ((this._gameState.dungeon.beacons ?? []).some(b => b.tileX === tx && b.tileY === ty) ||
         (this._gameState.dungeon.fountains ?? []).some(f => f.tileX === tx && f.tileY === ty))) {
      this._showPlacementError('Beacon/Fountain pair — use SELL and rebuild')
      return
    }
    if (!forceRoomMove && (this._gameState.dungeon.keyChests ?? []).some(c => c.tileX === tx && c.tileY === ty)) {
      this._showPlacementError('Key Chest is paired with a Door Lock — use SELL and rebuild')
      return
    }

    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) return
    if (room.definitionId === 'boss_chamber') {
      this._showPlacementError('Cannot move the boss chamber')
      return
    }
    const allRooms = this.cache.json.get('rooms') ?? []
    const def = allRooms.find(d => d.id === room.definitionId)
    if (def?.placementRules?.fixed) {
      this._showPlacementError('Cannot move a fixed room')
      return
    }
    // Move tool stays armed (sticky mode) — the pointerdown handler
    // detects the held-room state and routes the next click to drop +
    // re-pickup transparently. Tool clears on MOVE re-click or
    // BEGIN DAY.
    // Inline pickup body (rather than calling _tryPickupRoom which expects
    // a pointer): we already have the room + def + tile coords.
    //
    // Move is gold-neutral: no refund here, and the placement-on-drop path
    // checks `_heldMoveRoom` and skips the goldCost debit. (Selling is the
    // only way to convert a placed room back into gold.)
    this._heldMoveRoom = true
    // Capture the original room's instanceId so the drop in
    // _confirmPlacement can re-use it for the new room. Without this,
    // placeRoom generates a fresh _uid() for the moved room — orphaning
    // all adventurer knowledge entries keyed on the OLD id (rooms,
    // enemiesPerRoom, etc.), which read as "the dungeon forgot what's
    // in this room" the next day. Same effect as the player intentionally
    // wiping intel via repeated pickup-drop. Preserving the id is
    // semantically right (the moved room IS the same room, just
    // relocated) and removes the abuse vector.
    this._heldMoveRoomInstanceId = room.instanceId
    // Capture the room's rotation + footprint at pickup time. Offsets
    // collected below are in this captured frame, NOT the def's default
    // frame. _confirmPlacement uses these to compute net rotation
    // between capture and drop so items + minions stay on the same
    // logical tile across moves of previously-rotated rooms.
    this._heldMoveRoomRotation = room.rotation ?? 0
    this._heldMoveCaptureW     = room.width
    this._heldMoveCaptureH     = room.height

    const heldMinions = []
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      if (m.tileX < room.gridX || m.tileX >= room.gridX + room.width)  continue
      if (m.tileY < room.gridY || m.tileY >= room.gridY + room.height) continue
      heldMinions.push({ minion: m, offX: m.tileX - room.gridX, offY: m.tileY - room.gridY })
      m._heldByPlayer = true
    }
    this._heldRoomMinions = heldMinions

    // Items inside the room travel with it. Pulled out of gameState here
    // and re-anchored at the new (room.gridX + offX, room.gridY + offY)
    // tile after placeRoom succeeds. Same pre-rotation-offset caveat as
    // minions — rotating a moved room may land items on void tiles.
    const inBounds = (tx, ty) =>
      tx >= room.gridX && tx < room.gridX + room.width &&
      ty >= room.gridY && ty < room.gridY + room.height
    const carryOffsets = (arr) => {
      const carried = []
      const remaining = []
      for (const it of arr ?? []) {
        if (inBounds(it.tileX, it.tileY)) {
          carried.push({ data: it, offX: it.tileX - room.gridX, offY: it.tileY - room.gridY })
        } else {
          remaining.push(it)
        }
      }
      return { carried, remaining }
    }
    const d = this._gameState.dungeon
    const carriedItems = { treasureChests: [], beacons: [], fountains: [], keyChests: [], traps: [], phylactery: null }
    {
      const r = carryOffsets(d.treasureChests); d.treasureChests = r.remaining; carriedItems.treasureChests = r.carried
    }
    {
      const r = carryOffsets(d.beacons);        d.beacons        = r.remaining; carriedItems.beacons = r.carried
    }
    {
      const r = carryOffsets(d.fountains);      d.fountains      = r.remaining; carriedItems.fountains = r.carried
    }
    {
      const r = carryOffsets(d.keyChests);      d.keyChests      = r.remaining; carriedItems.keyChests = r.carried
    }
    {
      const r = carryOffsets(d.traps);          d.traps          = r.remaining; carriedItems.traps = r.carried
    }
    if (this._gameState.phylactery && inBounds(this._gameState.phylactery.tileX, this._gameState.phylactery.tileY)) {
      const p = this._gameState.phylactery
      carriedItems.phylactery = { data: p, offX: p.tileX - room.gridX, offY: p.tileY - room.gridY }
      this._gameState.phylactery = null
    }
    this._heldRoomItems = carriedItems

    // isMove flag stops KnowledgeSystem's stale-mark — preserveInstanceId
    // on the drop will reuse this id so adv knowledge transfers cleanly.
    this._dungeonGrid.removeRoom(room.instanceId, { isMove: true })
    this._rotation = 0
    this._selectItem(def, 'room')
    this._refreshStats()
  }

  _undoLastPlacement() {
    if (!this._lastPlaced) return
    const { kind, entity, goldCost } = this._lastPlaced
    if (kind === 'minion') {
      const idx = this._gameState.minions.findIndex(m => m.instanceId === entity.instanceId)
      if (idx >= 0) this._gameState.minions.splice(idx, 1)
      EventBus.emit('MINION_REMOVED', { minion: entity })
    } else if (kind === 'trap') {
      const idx = this._gameState.dungeon.traps.findIndex(t => t.instanceId === entity.instanceId)
      if (idx >= 0) this._gameState.dungeon.traps.splice(idx, 1)
      EventBus.emit('TRAP_REMOVED', { trap: entity })
    } else {
      this._dungeonGrid.removeRoom(entity.instanceId)
      // Re-render so any max-1 rooms filtered out while at-cap reappear.
      this._renderActivePalette()
    }
    this._gameState.player.gold += goldCost
    this._lastPlaced = null
    this._refreshStats()
  }

  // Rotation math lives in src/util/roomRotation.js so Game.js's load-time
  // reapply path can apply the exact same transform to a saved room.
  _getRotatedDef(def) {
    return getRotatedDef(def, this._rotation)
  }

  _tryPickupRoom(p, cam) {
    if (p.x <= PANEL_W) return
    const wp = cam.getWorldPoint(p.x, p.y)
    const tx = Math.floor(wp.x / TS)
    const ty = Math.floor(wp.y / TS)
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room || room.definitionId === 'boss_chamber') return

    const allRooms = this.cache.json.get('rooms') ?? []
    const def = allRooms.find(d => d.id === room.definitionId)
    if (!def || def.placementRules?.fixed) return

    // Full cost refund on pick-up (player is repositioning, not removing permanently)
    const arch = this._gameState.player?.archetypeModifiers
    const roomMul = arch?.roomCostMultiplier ?? 1
    const cost = Math.round((def.goldCost ?? 0) * roomMul)
    if (cost > 0) this._gameState.player.gold += cost

    if (this._lastPlaced?.entity?.instanceId === room.instanceId) this._lastPlaced = null

    // Capture minions inside the room so they travel with it on placement.
    // Offsets are room-relative tile coords; we re-anchor them after placeRoom
    // succeeds. AI is paused via `_heldByPlayer` until then.
    const heldMinions = []
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      if (m.tileX < room.gridX || m.tileX >= room.gridX + room.width)  continue
      if (m.tileY < room.gridY || m.tileY >= room.gridY + room.height) continue
      heldMinions.push({ minion: m, offX: m.tileX - room.gridX, offY: m.tileY - room.gridY })
      m._heldByPlayer = true
    }
    this._heldRoomMinions = heldMinions

    // Door locks tied to this room's doorways become orphaned the moment
    // removeRoom() unpairs the CPs and repaints the wall — the lock entry
    // would linger in state with stale doorTiles, so the pathfinder
    // blockedForAdv set built from those tiles wouldn't match the new
    // doorway after re-placement, and adventurers would walk through it
    // unlocked. Refund (full, matching the room refund above) and remove
    // any lock whose doorTiles sit on this room.
    const inRoomBounds = (t) =>
      t.x >= room.gridX && t.x < room.gridX + room.width &&
      t.y >= room.gridY && t.y < room.gridY + room.height
    const locks     = this._gameState.dungeon.locks     ?? []
    const keyChests = this._gameState.dungeon.keyChests ?? []
    const lockDef   = (this.cache.json.get('items') ?? []).find(it => it.id === 'door_lock')
    const lockCost  = lockDef?.goldCost ?? 0
    let locksChanged = false
    for (let i = locks.length - 1; i >= 0; i--) {
      const lock = locks[i]
      if (!lock.doorTiles?.some(inRoomBounds)) continue
      if (lockCost > 0) this._gameState.player.gold += lockCost
      const chestIdx = keyChests.findIndex(c => c.instanceId === lock.keyChestId)
      if (chestIdx >= 0) {
        const chest = keyChests[chestIdx]
        keyChests.splice(chestIdx, 1)
        EventBus.emit('KEY_CHEST_REMOVED', { chest, refund: 0 })
      }
      locks.splice(i, 1)
      EventBus.emit('LOCK_REMOVED', { lock })
      locksChanged = true
    }
    if (locksChanged) EventBus.emit('LOCKS_CHANGED')

    // Capture the picked-up room's id and remove with isMove flag so:
    //   * KnowledgeSystem skips the stale-mark on this pickup
    //   * The drop in _confirmPlacement passes preserveInstanceId so
    //     the rebuilt room reuses the old id — adventurer intel keyed
    //     on it transfers naturally instead of orphaning.
    // Unlike _executeMoveAt (gold-neutral MOVE tool), this pickup
    // refunds the room cost; the player still pays full price on
    // re-place, just with their intel intact.
    this._heldMoveRoomInstanceId = room.instanceId
    this._dungeonGrid.removeRoom(room.instanceId, { isMove: true })
    this._rotation = 0

    // Switch to rooms tab so the card and placement preview are visible
    if (this._paletteTab !== 'rooms') {
      this._paletteTab = 'rooms'
      this._paletteScrollY = 0
      this._tabButtons.forEach(t => t.draw(t.key === 'rooms'))
    }
    this._renderActivePalette()   // ensure card is visible (may have been filtered as maxed)
    this._selectItem(def, 'room')
    this._refreshStats()
  }

  _showRoomHover(p, cam) {
    if (p.x <= PANEL_W) { this._preview?.clear(); return }
    const wp = cam.getWorldPoint(p.x, p.y)
    const tx = Math.floor(wp.x / TS)
    const ty = Math.floor(wp.y / TS)
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room || room.definitionId === 'boss_chamber') {
      this._preview?.clear()
      return
    }
    const wx = room.gridX * TS
    const wy = room.gridY * TS
    const ww = room.width  * TS
    const wh = room.height * TS
    this._preview.clear()
    this._preview.fillStyle(0x4499ff, 0.07)
    this._preview.fillRect(wx, wy, ww, wh)
    this._preview.lineStyle(1, 0x4499ff, 0.55)
    this._preview.strokeRect(wx, wy, ww, wh)
  }

  _cancelSelection() {
    // If we'd grabbed minions during a room pickup, release the AI lock so
    // they're not frozen forever. Their tiles are now VOID (the room is
    // gone) — AISystem.stuck-in-wall guard will snap them to a walkable
    // neighbour on next tick.
    if (this._heldRoomMinions?.length) {
      for (const { minion } of this._heldRoomMinions) minion._heldByPlayer = false
      this._heldRoomMinions = null
    }
    this._heldMoveRoomRotation = null
    this._heldMoveCaptureW     = null
    this._heldMoveCaptureH     = null
    // Picked-up room id — cleared on cancel so a stale id from an
    // abandoned pickup doesn't leak into the next placement (which
    // would wrongly try to reuse the dead room's instanceId).
    this._heldMoveRoomInstanceId = null
    // Held items have no AI cleanup, so if the player cancels mid-move
    // we restore them to gameState at their original pre-pickup tiles
    // rather than silently destroy them. The room they belonged to is
    // gone (will be void), but the items remain sellable/movable.
    if (this._heldRoomItems) {
      const d = this._gameState.dungeon
      const restore = (arr, carried) => {
        if (!carried?.length) return
        arr ??= []
        for (const { data } of carried) arr.push(data)
        return arr
      }
      d.treasureChests = restore(d.treasureChests, this._heldRoomItems.treasureChests) ?? d.treasureChests
      d.beacons        = restore(d.beacons,        this._heldRoomItems.beacons)        ?? d.beacons
      d.fountains      = restore(d.fountains,      this._heldRoomItems.fountains)      ?? d.fountains
      d.keyChests      = restore(d.keyChests,      this._heldRoomItems.keyChests)      ?? d.keyChests
      d.traps          = restore(d.traps,          this._heldRoomItems.traps)          ?? d.traps
      if (this._heldRoomItems.phylactery) {
        this._gameState.phylactery = this._heldRoomItems.phylactery.data
      }
      this._heldRoomItems = null
    }
    this._selected = null
    this._selectedKind = null
    this._rotation = 0
    // A carried trap / item followed the cursor — cancelling the move rolls it
    // back to the pickup tile (drops null these refs first, so a *finalized*
    // move never triggers the rollback). This also guarantees a cancelled item
    // move never loses the chest/heart.
    if (this._heldMoveTrap && this._heldMoveTrapOrigin) {
      this._heldMoveTrap.tileX  = this._heldMoveTrapOrigin.tileX
      this._heldMoveTrap.tileY  = this._heldMoveTrapOrigin.tileY
      this._heldMoveTrap.facing = this._heldMoveTrapOrigin.facing
    }
    this._heldMoveTrap = null
    this._heldMoveTrapOrigin = null
    if (this._heldMoveItem?.origin) {
      const { data, origin, kind } = this._heldMoveItem
      data.tileX = origin.tileX
      data.tileY = origin.tileY
      if (kind === 'phylactery') {
        data.worldX = origin.worldX
        data.worldY = origin.worldY
        this._gameState.phylactery = data   // (never removed, but be explicit)
      }
    }
    this._heldMoveItem = null
    this._paletteCards.forEach(c => this._resetCard(c.cg, c.px, c.py, c.CARD_W, c.CARD_H, c.catColor, false))
    this._clearPreview()
    this._updateGridVisibility()
    EventBus.emit('BUILD_DESELECT')
  }

  // ── Begin Day ─────────────────────────────────────────────────────────────

  _beginDay() {
    // Clear any sticky tool mode so the action bar's armed ring + the
    // next-night reset stay clean.
    this._setToolMode(null, 'begin_day')
    this._cancelSelection()

    const dungeon = this._gameState.dungeon
    const entries = dungeon.rooms.filter(r => r.definitionId === 'entry_hall')
    if (entries.length === 0) {
      this._showPlacementError('You must place an Entry Hall before starting the day')
      return
    }
    // Forced multi-entry — the kingdom discovers a 2nd way into the dungeon
    // at boss level 5 and a 3rd at level 10. The required count matches the
    // build cap for the current boss level (entry_hall's
    // maxPerDungeonByBossLevel table), so the day can't begin until every
    // mandated Entry Hall is placed.
    const entryDef = (this.cache.json.get('rooms') ?? []).find(d => d.id === 'entry_hall')
    const requiredEntries = DungeonGridClass.effectiveMaxPerDungeon(
      entryDef, this._gameState.boss?.level ?? 1) ?? 1
    if (entries.length < requiredEntries) {
      const ord = requiredEntries === 3 ? '3rd' : '2nd'
      this._showPlacementError(
        `The kingdom has found another way in — place a ${ord} Entry Hall before the day begins`)
      return
    }

    // Free placement allows islands, so verify connectivity at day-start.
    // Every placed room — including the boss — must be reachable from the
    // entry_hall via the doorway graph.
    const disconnected = this._dungeonGrid.getDisconnectedRooms()
    if (disconnected.length > 0) {
      // Use the room's display name from the def cache when available so
      // 'mimic_vault' surfaces as 'Mimic Vault' (and reads as a ROOM, not
      // the placeable Mimic minion that shares the prefix).
      const allRooms = this.cache.json.get('rooms') ?? []
      const labelFor = r => allRooms.find(d => d.id === r.definitionId)?.name
        ?? r.definitionId.replace(/_/g, ' ')
      const names = disconnected.slice(0, 2).map(labelFor).join(', ')
      const extra = disconnected.length > 2 ? ` +${disconnected.length - 2} more` : ''
      const noun = disconnected.length === 1 ? 'room' : 'rooms'
      this._showPlacementError(`Disconnected ${noun}: ${names}${extra} — place adjacent to existing rooms`)
      // Surface the offenders visually — pulsing red outline + pan to the
      // first one. Stays until the player fixes connectivity or the next
      // successful Begin Day.
      this._flagDisconnectedRooms(disconnected)
      return
    }

    // Day starts cleanly — make sure no stale highlight survives.
    this._clearDisconnectedHighlight()
    this._gameState.meta.phase = 'day'
    if (_autosaveOn()) SaveSystem.save(this._gameState)
    EventBus.emit('NIGHT_PHASE_ENDED')
    this.scene.start('DayPhase', { gameState: this._gameState })
  }

  // Show a transient banner when a placement attempt fails, with the
  // specific reason ("Out of bounds", "Need 25 gold", "Must be 3 rooms
  // from boss", etc.) so the player knows why their click did nothing.
  _playBuildSfx() {
    const keys = ['sfx-build-1', 'sfx-build-2', 'sfx-build-3']
    const key = keys[Math.floor(Math.random() * keys.length)]
    if (!this.cache?.audio?.exists?.(key)) return
    try { this.sound.play(key, { volume: 0.7 }) } catch {}
  }

  _showPlacementError(message) {
    // HudScene sits above NightPhase in the scene stack (see main.js registration
    // order), so a toast added to NightPhase's display list is painted over by
    // HudScene's chrome.  Use HudScene as the host so the toast renders on top.
    const hud = this.scene.get('HudScene')
    const target = (hud && this.scene.isActive('HudScene')) ? hud : this
    showToast(target, message, { type: 'error' })
    this.scene.get('Game')?.sfxSystem?.playError()
  }
}

// (Rotation helpers _rotateTileLayoutCW / _rotateCellEntryCW / _rotateCP
// moved to src/util/roomRotation.js — see getRotatedDef. Game.js's
// load-time room reapplication path needs the same math.)

function _formatTrigger(trig) {
  switch (trig) {
    case 'los_lane':         return 'Fires down its line of sight'
    case 'los_facing':       return 'Fires when it sees a target'
    case 'proximity':        return 'Detonates when approached'
    case 'radius':           return 'Strikes anything near it'
    case 'adjacent_contact': return 'Cuts anything beside it'
    case 'stepped_on':       return 'Springs when stepped on'
    case 'saw_overlap':      return 'Carves anything it rolls over'
    default: return trig
  }
}
