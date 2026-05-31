import { SaveSystem }         from '../systems/SaveSystem.js'
import { EventBus }           from '../systems/EventBus.js'
import { DungeonGrid, TILE }  from '../systems/DungeonGrid.js'
import { AISystem }           from '../systems/AISystem.js'
import { PersonalitySystem }  from '../systems/PersonalitySystem.js'
import { CombatSystem }       from '../systems/CombatSystem.js'
import { MinionAISystem }     from '../systems/MinionAISystem.js'
import { TrapSystem }         from '../systems/TrapSystem.js'
import { EvolutionSystem }    from '../systems/EvolutionSystem.js'
import { MinionEvolutionSystem } from '../systems/MinionEvolutionSystem.js'
import { ClassAbilitySystem } from '../systems/ClassAbilitySystem.js'
import { KnowledgeSystem }    from '../systems/KnowledgeSystem.js'
import { DungeonMechanicSystem } from '../systems/DungeonMechanicSystem.js'
import { NewspaperSystem }    from '../systems/NewspaperSystem.js'
import { InquisitorSystem }   from '../systems/InquisitorSystem.js'
import { BossSystem }         from '../systems/BossSystem.js'
import { RoomBehaviorSystem } from '../systems/RoomBehaviorSystem.js'
import { RunHistorySystem }   from '../systems/RunHistorySystem.js'
import { LiveRunPublisher }  from '../systems/LiveRunPublisher.js'
import { BossArchetypeSystem } from '../systems/BossArchetypeSystem.js'
import { EmoteSystem }        from '../systems/EmoteSystem.js'
import { Balance }            from '../config/balance.js'
import { fallenRevivable, totalReviveCost, reviveCandidates, planRevive } from '../util/minionRevive.js'
import { brokenTraps, totalTrapRebuildCost } from '../util/trapRebuild.js'
import { createTrap }          from '../entities/Trap.js'
import { DungeonRenderer }    from '../ui/DungeonRenderer.js'
import { AdventurerRenderer } from '../ui/AdventurerRenderer.js'
import { AiDiagOverlay }      from '../ui/AiDiagOverlay.js'
import { MinionRenderer }     from '../ui/MinionRenderer.js'
import { TrapRenderer }       from '../ui/TrapRenderer.js'
import { LootPileRenderer }   from '../ui/LootPileRenderer.js'
import { KeyChestRenderer }   from '../ui/KeyChestRenderer.js'
import { LockRenderer }       from '../ui/LockRenderer.js'
import { BeaconRenderer }     from '../ui/BeaconRenderer.js'
import { FountainRenderer }   from '../ui/FountainRenderer.js'
import { TreasureChestRenderer } from '../ui/TreasureChestRenderer.js'
import { DarkDealDemonRenderer } from '../ui/DarkDealDemonRenderer.js'
import { GamblerImpRenderer }    from '../ui/GamblerImpRenderer.js'
import { DemonWagerRenderer }    from '../ui/DemonWagerRenderer.js'
import { PhylacteryRenderer } from '../ui/PhylacteryRenderer.js'
import { FungalCorpseRenderer } from '../ui/FungalCorpseRenderer.js'
import { MinionInspector }    from '../ui/MinionInspector.js'
import { ChatBubbles }        from '../ui/ChatBubbles.js'
import { KnowledgeOverlay }   from '../ui/KnowledgeOverlay.js'
import { WantedPoster }       from '../ui/WantedPoster.js'
// ReplayGhostRenderer removed 2026-05-21 (prior-run path trail cut at
// user request) — file kept in repo, just no longer imported/constructed.
import { BossFightOverlay }    from '../ui/BossFightOverlay.js'
import { SunderedFloorRenderer } from '../ui/SunderedFloorRenderer.js'
import { CartographerOverlay }   from '../ui/CartographerOverlay.js'
import { BossRenderer }       from '../ui/BossRenderer.js'
import { SuccubusBatRenderer } from '../ui/SuccubusBatRenderer.js'
import { CoinBurstRenderer }  from '../ui/CoinBurstRenderer.js'
import { SellFxRenderer }     from '../ui/SellFxRenderer.js'
import { TorchRenderer }      from '../ui/TorchRenderer.js'
import { CobwebRenderer }     from '../ui/CobwebRenderer.js'
import { DecorRenderer }      from '../ui/DecorRenderer.js'
import { BloodSplatRenderer } from '../ui/BloodSplatRenderer.js'
import { TitleMusic }         from '../systems/TitleMusic.js'
import { GameplayMusic }      from '../systems/GameplayMusic.js'
import { PauseManager }       from '../systems/PauseManager.js'
import { SfxSystem }          from '../systems/SfxSystem.js'
import { EventSystem }        from '../systems/EventSystem.js'
import { LightPartyAi }       from '../systems/LightPartyAi.js'
import { LightPartyRenderer } from '../ui/LightPartyRenderer.js'
import { PlayerProfile }      from '../systems/PlayerProfile.js'
import { CombatFeedback }     from '../systems/CombatFeedback.js'
import { CompanionWorldFx }   from '../systems/CompanionWorldFx.js'
import { HitSparkSystem }     from '../systems/HitSparkSystem.js'
import { CheaterAttackVfxSystem } from '../systems/CheaterAttackVfxSystem.js'
import { BossAttackVfxSystem }    from '../systems/BossAttackVfxSystem.js'
import { ScreenShakeSystem }  from '../systems/ScreenShakeSystem.js'
import { RivalBossShowdown }  from '../systems/RivalBossShowdown.js'
import { AbilityVfx }         from '../ui/AbilityVfx.js'
import { BossPactVfx }        from '../ui/BossPactVfx.js'
import { TutorialSystem }     from '../systems/TutorialSystem.js'
import { NpcDirector }        from '../systems/NpcDirector.js'
import { getRotatedDef }      from '../util/roomRotation.js'

const TS = Balance.TILE_SIZE

export class Game extends Phaser.Scene {
  constructor() {
    super('Game')
    this.gameState           = null
    this.dungeonGrid         = null
    this.aiSystem            = null
    this.minionAiSystem      = null
    this.trapSystem          = null
    this.combatSystem        = null
    this.personalitySystem   = null
    this.evolutionSystem     = null
    this.knowledgeSystem     = null
    this.adventurerRenderer  = null
    this.minionRenderer      = null
    this.trapRenderer        = null
    this.minionInspector     = null
    this.knowledgeOverlay      = null
    this._dungeonRenderer    = null
    this._hudScene           = null
    this._cam                = null
    this._dragOrigin         = null
    this._keys               = null
    this._followId           = null
    this._duelCamLock        = false   // Solo Leveling — lock camera during the duel
    this.bossRenderer        = null
  }

  init(data) {
    this.gameState = data?.gameState || SaveSystem.load()
    // Reset per-start runtime camera flags. Phaser runs the constructor only
    // ONCE (at scene registration), NOT on scene.start — so a flag left set
    // when the player exits mid-cinematic (e.g. _duelCamLock during the Shadow
    // Monarch duel) would persist into the reloaded run and leave the camera
    // stuck locked. Clear them here so every (re)start begins unlocked.
    this._duelCamLock    = false
    this._fightCamActive = false
    this._preFightCam    = null
    this._followId       = null
    this._dragOrigin     = null
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create() {
    // Phaser does NOT auto-invoke a `shutdown()` method on the user
    // scene class when scene.stop() runs — it only fires a SHUTDOWN
    // event on the scene's event emitter. Without this binding,
    // Game.shutdown() is unreachable from the normal stop path, so
    // EVERY system (DungeonRenderer, NpcDirector, AISystem,
    // BossSystem, ...) leaks its EventBus subscriptions when the
    // player ends a run and starts a new one. Symptoms observed:
    // companion voice leak (Malakor speaking Safira's lines),
    // ROOM_PLACED crash during createGameState (stale
    // DungeonRenderer's listener firing on a half-torn-down scene),
    // doubled chest-payout toasts (two AISystem instances both
    // emitting TREASURE_PAYOUT). HudScene knew about this Phaser
    // quirk and bound the same `events.once('shutdown', ...)`
    // workaround at line 83 of its create(); Game was missing the
    // same line, which is why all the workarounds piled up around
    // its missing teardown.
    //
    // Use `once` so a single stop fires shutdown once and detaches;
    // create() runs again on the next start with a fresh binding.
    this.events.once('shutdown', this.shutdown, this)

    // Auto-rewind notification — SaveSystem.load() detects a save that
    // was somehow in mid-day phase, clears the active-adv array, and
    // flips it back to night, marking `meta._rewoundOnLoad = true`.
    // We defer the toast by ~800ms so the HUD's ToastQueue has time to
    // subscribe (HUD mounts in HudScene, started in parallel with Game).
    // Without the delay the SHOW_TOAST emit happens before any subscriber
    // exists and the toast is silently lost.
    if (this.gameState?.meta?._rewoundOnLoad) {
      delete this.gameState.meta._rewoundOnLoad
      this.time.delayedCall(800, () => {
        EventBus.emit('SHOW_TOAST', {
          message: 'Save rewound — the in-progress day was cleared.',
          type:    'info',
        })
      })
    }

    // Title music belongs to MainMenu / ArchetypeSelect only — kill
    // it on the way into the dungeon and hand off to the gameplay
    // playlist (shuffled in-run soundtrack).
    TitleMusic.stop()
    GameplayMusic.start(this)

    // Mango cheat — when the player's name is the dev-test handle,
    // unlock every room / minion / trap / item by stamping
    // `unlockLevel = 1` on every JSON def in Phaser's cache and
    // back-filling the gameState.unlocks allowlists. All downstream
    // gate checks (BuildMenu, NightPhase placement, DungeonGrid
    // validation, EventSystem minion pool, etc.) naturally pass.
    // Mutation reverts on page reload — switching off the cheat
    // mid-session requires a refresh. The same flag also drives the
    // 9999-gold floor refilled every update tick (see update()).
    this._isMangoCheat = PlayerProfile.isCheatName()
    if (this._isMangoCheat) {
      this._applyMangoCheatUnlocks()
    } else {
      // Per-name saves (2026-05-29) made mid-session name switches a real
      // workflow. A prior mango-session in this page would have mutated the
      // JSON cache (unlockLevel = 1 on every gated def) and that mutation
      // doesn't revert on a name change — so a player who tested as mango
      // and switched to a real name kept seeing everything unlocked. Revert
      // here, on every non-mango Game-scene boot, using the snapshot
      // _applyMangoCheatUnlocks stamped on the game instance. No-op if the
      // cheat never ran in this page session.
      this._revertMangoCheatUnlocks()
    }

    // Lifecycle registry. Every system + renderer constructed below is
    // wrapped in `track(...)`, which pushes it onto this._lifecycle and
    // returns it for assignment. Game.shutdown() iterates the list (in
    // LIFO order) and calls .destroy() on each — no parallel destroy
    // chain to maintain, so a newly-added system can never leak its
    // EventBus subscriptions across runs by being forgotten in shutdown.
    //
    // This pattern replaced the prior hand-maintained destroy chain
    // after BossArchetypeSystem leaked (vampire-charm-on-every-archetype
    // bug, 2026-05-27): the constructor was added in create() but the
    // matching destroy call was never added in shutdown(), so the
    // previous run's instance kept reacting to ADVENTURERS_SPAWNED on
    // the new run with stale archetype state.
    //
    // Skipping `destroy` gracefully — track() ignores any instance that
    // doesn't expose a destroy() method, so wrapping a plain helper
    // (e.g. DungeonGrid, which is pure data) is harmless.
    this._lifecycle = []
    const track = (instance) => {
      if (instance && typeof instance.destroy === 'function') {
        this._lifecycle.push(instance)
      }
      return instance
    }

    this.dungeonGrid         = track(new DungeonGrid(this.gameState.dungeon))

    // Re-apply current room definitions to every placed room so tile grids are
    // always derived from the definition, not stale data baked by a previous
    // session or an old Room Builder edit. This fixes:
    //   • Rooms that were saved with all-void tiles (appear as thin strips or blank)
    //   • Boss chamber missing tile art after a Room Builder pass over it
    // Do this BEFORE creating DungeonRenderer so the first draw sees clean data.
    this._reapplyAllRoomDefs()

    this._dungeonRenderer    = track(new DungeonRenderer(this, this.gameState))
    // Phase: items — push every saved lock onto cp.locked so the
    // DungeonRenderer's first draw picks the locked door variant. The
    // LOCKS_CHANGED listener handles every subsequent mutation.
    this._syncLockedCPs()
    this.personalitySystem   = track(new PersonalitySystem(this))
    this.personalitySystem.loadDefinitions()

    // Phase 6e: cache archetype modifiers on gameState for easy cross-system lookup
    this._cacheArchetypeModifiers()
    this.combatSystem        = track(new CombatSystem(this, this.gameState))
    this.knowledgeSystem     = track(new KnowledgeSystem(this, this.gameState, this.dungeonGrid))
    this.aiSystem            = track(new AISystem(this, this.gameState, this.dungeonGrid, this.personalitySystem, this.combatSystem, this.knowledgeSystem))
    this.minionAiSystem      = track(new MinionAISystem(this, this.gameState, this.dungeonGrid, this.combatSystem))
    this.trapSystem          = track(new TrapSystem(this, this.gameState, this.dungeonGrid))
    this.trapSystem.loadDefinitions()
    this.evolutionSystem     = track(new EvolutionSystem(this, this.gameState))
    this.evolutionSystem.loadDefinitions()
    this.minionEvolutionSystem = track(new MinionEvolutionSystem(this, this.gameState))
    this.dungeonMechanicSystem = track(new DungeonMechanicSystem(this, this.gameState))
    this.dungeonMechanicSystem.loadDefinitions()
    this.newspaperSystem     = track(new NewspaperSystem(this, this.gameState))
    this.inquisitorSystem    = track(new InquisitorSystem(this, this.gameState, this.dungeonMechanicSystem, this.personalitySystem))
    this.bossSystem          = track(new BossSystem(this, this.gameState))
    this.sfxSystem           = track(new SfxSystem(this, this.gameState))
    this.eventSystem         = track(new EventSystem(this, this.gameState))
    // Per-role driver for the Light Party event (FFXIV trinity). No-ops on
    // any day where the event isn't active (cheap early-return).
    this.lightPartyAi        = track(new LightPartyAi(this, this.gameState))
    // World-space VFX for the Light Party event (job icons, heal beam,
    // raise cast bar). Renderer side of the same feature. Cheap no-op when
    // the event isn't live.
    this.lightPartyRenderer  = track(new LightPartyRenderer(this, this.gameState))
    this.combatFeedback      = track(new CombatFeedback(this, this.gameState))
    // Per-companion world-space VFX layered onto combat/death — pink
    // hearts on adv death for Lilith, purple sparks on every hit for
    // Malakor. Reads gameState.meta.companionId; no-ops for the others.
    this.companionWorldFx    = track(new CompanionWorldFx(this, this.gameState))
    this.hitSparkSystem      = track(new HitSparkSystem(this, this.gameState))
    // Wild glitch-burst overlay on every cheater swing — fires after
    // HitSparkSystem in the listener chain so the cheater layer paints
    // over the hit spark.
    this.cheaterAttackVfxSystem = track(new CheaterAttackVfxSystem(this, this.gameState))
    // Pact + archetype-basic boss attack VFX. Layers on top of the
    // existing pact telegraph/feedback (channel beams, rings, etc.)
    // — adds punch without replacing the mechanical telegraph.
    this.bossAttackVfxSystem    = track(new BossAttackVfxSystem(this, this.gameState))
    this.screenShakeSystem   = track(new ScreenShakeSystem(this))
    this.rivalBossShowdown   = track(new RivalBossShowdown(this, this.gameState))
    this.bossPactVfx         = track(new BossPactVfx(this, this.gameState))
    this.roomBehaviorSystem  = track(new RoomBehaviorSystem(this, this.gameState))
    this.classAbilitySystem  = track(new ClassAbilitySystem(this, this.gameState))
    // Phase 31I — passive run-history aggregator. Subscribes to event bus
    // and folds counts into gameState.run.totals + history.pacts. No gameplay.
    this.runHistorySystem    = track(new RunHistorySystem(this, this.gameState))
    // Live-run leaderboard heartbeat (2026-05-25). Upserts a 'live'
    // row to Supabase on NIGHT_PHASE_STARTED + run start so other
    // players can see the run in progress on the leaderboard. Fire-
    // and-forget; network failures swallowed. Remove the construct line
    // to disable the feature entirely.
    this.liveRunPublisher    = track(new LiveRunPublisher(this, this.gameState))
    // Phase 1b — per-archetype headline mechanics (Orc Loot the Fallen, etc).
    this.bossArchetypeSystem = track(new BossArchetypeSystem(this, this.gameState))
    this._evolutionSystem    = this.evolutionSystem  // alias for MinionInspector lookup
    this.adventurerRenderer  = track(new AdventurerRenderer(this, this.gameState))
    // F4-toggled on-screen AI diagnostics: per-adv floating labels showing
    // goal, distance-to-target, time-since-progress, and panic-walk state.
    // Color-coded for stuck-detection. No-op when DebugOverlay.aiDiagnostics
    // is off (its default). Used to debug pathing ping-pongs in the wild.
    this.aiDiagOverlay       = track(new AiDiagOverlay(this, this.gameState))
    this.emoteSystem         = track(new EmoteSystem(this, this.gameState, this.adventurerRenderer))
    this.minionRenderer      = track(new MinionRenderer(this, this.gameState))
    this.trapRenderer        = track(new TrapRenderer(this, this.gameState))
    this.lootPileRenderer    = track(new LootPileRenderer(this, this.gameState))
    this.keyChestRenderer    = track(new KeyChestRenderer(this, this.gameState))
    this.lockRenderer        = track(new LockRenderer(this, this.gameState))
    this.beaconRenderer      = track(new BeaconRenderer(this, this.gameState))
    this.fountainRenderer    = track(new FountainRenderer(this, this.gameState))
    this.treasureChestRenderer = track(new TreasureChestRenderer(this, this.gameState))
    this.darkDealDemonRenderer = track(new DarkDealDemonRenderer(this, this.gameState))
    this.gamblerImpRenderer    = track(new GamblerImpRenderer(this, this.gameState))
    // Demon's Wager NPC — clones the gambler imp pattern with crimson
    // tinting + DEMON_WAGER_NPC_CLICKED event instead of GAMBLER_*.
    this.demonWagerRenderer    = track(new DemonWagerRenderer(this, this.gameState))
    this.phylacteryRenderer  = track(new PhylacteryRenderer(this, this.gameState))
    this.fungalCorpseRenderer = track(new FungalCorpseRenderer(this, this.gameState))
    // MinionInspector and WantedPoster have DOM ports under the new HUD
    // (src/hud/MinionInspectorOverlay.js + the ToastQueue 'bounty' kind).
    // Gate the Phaser constructions so they don't double-fire under the
    // DOM HUD — both would otherwise sit obscured behind the chrome.
    let _useNewHud = true
    try { _useNewHud = localStorage.getItem('newhud') !== '0' } catch {}
    if (!_useNewHud) {
      this.minionInspector   = track(new MinionInspector(this, this.gameState))
    }
    this.chatBubbles         = track(new ChatBubbles(this, this.gameState))
    this.knowledgeOverlay      = track(new KnowledgeOverlay(this, this.gameState, this.knowledgeSystem))
    if (!_useNewHud) {
      this.wantedPoster      = track(new WantedPoster(this, this.gameState))
    }
    // Replay Ghost trail removed at user request (2026-05-21) — a
    // returning Hero no longer draws their prior-run path on the dungeon
    // floor. ReplayGhostRenderer.js stays in the repo (removal-not-
    // deletion); it just isn't constructed. The ?.update() / ?.destroy()
    // calls elsewhere no-op safely on the null field.
    this.replayGhostRenderer = null
    // BossFightOverlay moved to HudScene — it uses scene.uiW/uiH which
    // only HudScene sets via applyUiCamera. Game scene retains the
    // camera-zoom hooks below that pair with the overlay's intro slate.
    this.bossRenderer        = track(new BossRenderer(this, this.gameState))
    this.succubusBatRenderer = track(new SuccubusBatRenderer(this, this.gameState))
    this.coinBurstRenderer   = track(new CoinBurstRenderer(this, this.gameState))
    this.sellFxRenderer      = track(new SellFxRenderer(this))
    this.torchRenderer       = track(new TorchRenderer(this, this.gameState))
    this.cobwebRenderer      = track(new CobwebRenderer(this, this.gameState))
    this.decorRenderer       = track(new DecorRenderer(this, this.gameState))
    this.bloodSplatRenderer  = track(new BloodSplatRenderer(this, this.gameState))
    // Companion NPC brain — constructed before TutorialSystem so its
    // INTRO_DISMISSED handler registers first and her welcome line is
    // queued ahead of the first tutorial.
    this.npcDirector         = track(new NpcDirector(this, this.gameState))
    this.tutorialSystem      = track(new TutorialSystem(this, this.gameState))
    this.sunderedFloorRenderer = track(new SunderedFloorRenderer(this))
    this.cartographerOverlay   = track(new CartographerOverlay(this, this.gameState))

    // Respawn dead minions when night starts (Phase 6 kernel)
    EventBus.on('NIGHT_PHASE_STARTED',  this._onNightStart,   this)
    // Phase 9 — Pact of the Marionette: MinionRenderer's per-sprite
    // pointerdown calls event.stopPropagation, which blocks the scene-
    // level pointerdown handler where _tryMarionettePossess used to
    // exclusively run. Subscribing to the MINION_CLICKED event the
    // sprite handler emits bypasses propagation entirely — same minion
    // ref, no tile-find needed. The scene-level path still works as a
    // fallback (click on a tile a sprite doesn't cover).
    EventBus.on('MINION_CLICKED',       this._onMinionClickedForMarionette, this)
    // Pay-to-revive (2026-05-28): the night-phase REVIVE button (LeftPanels)
    // asks to bring fallen roster minions back for gold.
    EventBus.on('REVIVE_FALLEN_REQUEST', this._onReviveFallenRequest, this)
    // Pay-to-rebuild (2026-05-29): the night-phase REBUILD button (BottomBar)
    // asks to bring traps that broke during the day back for gold.
    EventBus.on('REBUILD_TRAPS_REQUEST', this._onRebuildTrapsRequest, this)
    // Lost-at-day-start: any fallen minion the player didn't pay to revive
    // during the build phase is purged when the day begins.
    EventBus.on('DAY_PHASE_STARTED',     this._purgeUnrevivedFallen,  this)
    // Phase 10: third boss defeat → game over
    EventBus.on('BOSS_DEFEATED_FINAL',  this._onBossFinal,    this)
    // Anti-save-scum (2026-05-31): commit the instant the boss loses a
    // (non-final) life so quitting can't rewind the death. See _onBossLifeCommit.
    EventBus.on('BOSS_FIGHT_RESOLVED',  this._onBossLifeCommit, this)
    // Re-clamp zoom whenever the dungeon grid expands so min zoom tracks map size
    EventBus.on('GRID_EXPANDED',        this._onGridExpanded,  this)
    // Boss levels up → expand grid + scale all live minions.
    EventBus.on('BOSS_LEVELED_UP',   this._onBossLeveledUp, this)
    // Boss level DROPS (Demon's Wager loss) → rescale every live
    // minion downward via applyBossLevelToMinion. Only fires on
    // negative deltas — positive deltas are owned by _onBossLeveledUp
    // above (which also grows the grid + bumps boss stats).
    EventBus.on('BOSS_LEVEL_CHANGED', this._onBossLevelChanged, this)
    // Room Builder saved a room def — rewrite tile grids for all placed
    // instances so structural changes appear immediately without remove + re-place.
    EventBus.on('ROOM_DEF_SAVED',       this._onRoomDefSaved,   this)
    // Room Builder reset ALL rooms — reapply every placed room in one pass.
    EventBus.on('ROOMS_ALL_RESET',      this._onRoomsAllReset,  this)
    // Phase: items — keep cp.locked flags + door sprites in sync with
    // gameState.dungeon.locks. Anything that mutates the locks list emits
    // LOCKS_CHANGED so this single listener owns all redraw timing.
    EventBus.on('LOCKS_CHANGED',        this._syncLockedCPs,    this)
    // Camera follow
    EventBus.on('ADVENTURER_CLICKED',   this._onAdvClicked,   this)
    EventBus.on('ADVENTURER_DIED',      this._onAdvRemoved,   this)
    EventBus.on('ADVENTURER_FLED',      this._onAdvRemoved,   this)
    // Solo Leveling — clicking Jinwoo's exploration HP bar re-locks the camera
    // onto him (same follow used when he enters).
    EventBus.on('SHADOW_MONARCH_FOLLOW', this._onShadowMonarchFollow, this)
    // Loot Goblin Heist — red floater at the goblin's last position + toast
    // banner so the player notices the gold drain.
    EventBus.on('LOOT_GOBLIN_ESCAPED',  this._onLootGoblinEscaped, this)
    // Blood Moon Eclipse — red wash overlay during the event day.
    EventBus.on('DUNGEON_EVENT_BEGAN',  this._onDungeonEventBegan, this)
    EventBus.on('DUNGEON_EVENT_ENDED',  this._onDungeonEventEnded, this)
    EventBus.on('ADVENTURERS_SPAWNED',  this._onAdvsSpawned,  this)
    EventBus.on('DAY_PHASE_ENDED',      this._onDayEnded,     this)
    // Day-cycle hooks for the entrance door — animate-open at day start,
    // hard-close at day end so it re-animates next day.
    EventBus.on('DAY_PHASE_STARTED',    this._onDayStartedDoors, this)
    EventBus.on('DAY_PHASE_ENDED',      this._onDayEndedDoors,   this)

    // Phase-transition camera fade — short fade-out on the OUTGOING
    // phase, fade-in on the INCOMING phase, so day/night swaps feel
    // like a transition instead of a hard cut. World camera only
    // (HUD scene's camera is independent and stays visible).
    EventBus.on('DAY_PHASE_BEGAN',      this._onPhaseFadeIn,  this)
    EventBus.on('NIGHT_PHASE_BEGAN',    this._onPhaseFadeIn,  this)
    EventBus.on('DAY_PHASE_ENDED',      this._onPhaseFadeOut, this)

    // Camera stays put during boss fights per user feedback — the intro
    // slate and bottom HP bar (BossFightOverlay) carry the cinematic on
    // their own without moving the world view.

    // Boss-fight music — starts when adventurer enters boss room, fades out on resolve.
    EventBus.on('BOSS_FIGHT_INCOMING',  this._onBossFightMusicStart, this)
    EventBus.on('BOSS_FIGHT_RESOLVED',  this._onBossFightMusicEnd,   this)
    // Solo Leveling — cinematic camera push-in onto the throne for the Shadow
    // Monarch duel ONLY (regular fights keep their normal framing). Reuses the
    // midpoint-aware, follow-suspending fight-cam tween. Zoom-out on resolve is
    // a no-op unless a duel push-in actually snapshotted the pre-fight view.
    EventBus.on('SHADOW_MONARCH_DUEL',  this._onBossFightZoomIn,  this)
    EventBus.on('BOSS_FIGHT_RESOLVED',  this._onBossFightZoomOut, this)
    // Light Party — same cinematic push-in + camera lock as the Shadow Monarch
    // duel. Zoom-OUT is driven by LIGHT_PARTY_DUEL_END (the true end, after the
    // win/loss outro) instead of BOSS_FIGHT_RESOLVED — the win path fires that
    // the instant the boss falls, mid-outro (_onBossFightZoomOut guards it).
    EventBus.on('LIGHT_PARTY_DUEL_BEGAN', this._onBossFightZoomIn,  this)
    EventBus.on('LIGHT_PARTY_DUEL_END',   this._onBossFightZoomOut, this)
    // Persist the save the moment the intro is dismissed so `meta.introSeen`
    // hits disk immediately. The run-start save (ArchetypeSelect) is written
    // BEFORE the intro plays, so without this a player who quits during
    // night 1 — before any phase autosave — would see the intro replay on
    // Continue. Saving here closes that window.
    EventBus.on('INTRO_DISMISSED',      this._onIntroDismissed, this)

    this._setupCamera()
    this._setupInput()
    this.scale.on('resize', this._onSceneResize, this)
    // Tab-refocus camera recovery — see _onTabVisible. The browser relayout
    // on refocus can scroll the world camera into the void; this re-anchors
    // it once the viewport settles.
    this._onTabVisibleBound = () => this._onTabVisible()
    window.addEventListener('focus', this._onTabVisibleBound)
    document.addEventListener('visibilitychange', this._onTabVisibleBound)

    // Beforeunload autosave (fix 2026-05-25): the player closing the tab
    // / refreshing / navigating away SHOULD preserve their current run.
    // Previously the only autosaves fired at scene transitions (start of
    // night phase, end of day, etc.) — close the tab mid-day-29 active
    // fight and the last save was the start of night-before-day-29, so
    // Continue dropped them at the prior night's build phase (the
    // "actual day 27 point" bug). This snapshot catches every close
    // path the player has, including hard tab closes and refreshes.
    // Gated by the autosave setting so a player who explicitly disabled
    // autosaves doesn't have one forced on them at quit.
    this._onBeforeUnloadBound = () => {
      try {
        if (localStorage.getItem('qf.gameplay.autosave') === 'false') return
        // Don't overwrite the save with a dead-boss state — game-over
        // already deleted the save in _onBossFinal; re-saving here
        // would resurrect the dead run.
        if ((this.gameState?.boss?.deathsRemaining ?? 1) <= 0) return
        if (this.gameState) SaveSystem.save(this.gameState)
      } catch {}
    }
    window.addEventListener('beforeunload', this._onBeforeUnloadBound)
    // visibilitychange → hidden also fires on mobile-style tab-hide that
    // doesn't fire beforeunload (some browsers), and on focus loss when
    // the OS suspends the tab. Defensive double-coverage; saves are
    // idempotent.
    this._onVisibilitySaveBound = () => {
      if (document.visibilityState === 'hidden') this._onBeforeUnloadBound()
    }
    document.addEventListener('visibilitychange', this._onVisibilitySaveBound)

    // MiniMap lives on a dedicated HUD scene that doesn't share our world
    // camera's zoom/scroll. Launch it now and hand it the references it
    // needs to read camera state for the viewport indicator.
    this.scene.launch('HudScene', { gameScene: this, gameState: this.gameState })
    this._hudScene = this.scene.get('HudScene')

    // Resume the correct phase scene based on the saved state. Mid-day
    // saves (PauseManager "Save & Exit" mid-wave) stamp meta.phase = 'day'
    // — unconditionally launching NightPhase here strands the game in a
    // broken state: Game.update()'s day branch runs because phase is 'day',
    // but _getDayTimeScale() returns 0 (DayPhase not active), so AI ticks
    // are skipped while renderers keep updating animations. Visually:
    // adventurers + minions "walk in place" with no progress. Launch
    // DayPhase directly in that case; DayPhase.create() detects the
    // mid-wave resume (active.length > 0) and skips the daily wave spawn.
    if (this.gameState?.meta?.phase === 'day') {
      this.scene.launch('DayPhase', { gameState: this.gameState })
    } else {
      this.scene.launch('NightPhase', { gameState: this.gameState })
    }

    EventBus.emit('GAME_STATE_LOADED', this.gameState)
  }

  shutdown() {
    EventBus.off('NIGHT_PHASE_STARTED',  this._onNightStart,   this)
    EventBus.off('MINION_CLICKED',       this._onMinionClickedForMarionette, this)
    EventBus.off('REVIVE_FALLEN_REQUEST', this._onReviveFallenRequest, this)
    EventBus.off('REBUILD_TRAPS_REQUEST', this._onRebuildTrapsRequest, this)
    EventBus.off('DAY_PHASE_STARTED',     this._purgeUnrevivedFallen,  this)
    EventBus.off('BOSS_DEFEATED_FINAL',  this._onBossFinal,    this)
    EventBus.off('BOSS_FIGHT_RESOLVED',  this._onBossLifeCommit, this)
    EventBus.off('GRID_EXPANDED',        this._onGridExpanded,  this)
    EventBus.off('BOSS_LEVELED_UP',   this._onBossLeveledUp, this)
    EventBus.off('BOSS_LEVEL_CHANGED', this._onBossLevelChanged, this)
    EventBus.off('ROOM_DEF_SAVED',       this._onRoomDefSaved,  this)
    EventBus.off('ROOMS_ALL_RESET',      this._onRoomsAllReset, this)
    EventBus.off('LOCKS_CHANGED',        this._syncLockedCPs,   this)
    EventBus.off('ADVENTURER_CLICKED',   this._onAdvClicked,   this)
    EventBus.off('ADVENTURER_DIED',      this._onAdvRemoved,   this)
    EventBus.off('ADVENTURER_FLED',      this._onAdvRemoved,   this)
    EventBus.off('SHADOW_MONARCH_FOLLOW', this._onShadowMonarchFollow, this)
    EventBus.off('ADVENTURERS_SPAWNED',  this._onAdvsSpawned,  this)
    EventBus.off('LOOT_GOBLIN_ESCAPED',  this._onLootGoblinEscaped, this)
    EventBus.off('DUNGEON_EVENT_BEGAN',  this._onDungeonEventBegan, this)
    EventBus.off('DUNGEON_EVENT_ENDED',  this._onDungeonEventEnded, this)
    EventBus.off('DAY_PHASE_ENDED',      this._onDayEnded,     this)
    EventBus.off('DAY_PHASE_STARTED',    this._onDayStartedDoors, this)
    EventBus.off('DAY_PHASE_ENDED',      this._onDayEndedDoors,   this)
    EventBus.off('DAY_PHASE_BEGAN',      this._onPhaseFadeIn,  this)
    EventBus.off('NIGHT_PHASE_BEGAN',    this._onPhaseFadeIn,  this)
    EventBus.off('DAY_PHASE_ENDED',      this._onPhaseFadeOut, this)
    EventBus.off('BOSS_FIGHT_INCOMING',  this._onBossFightMusicStart, this)
    EventBus.off('BOSS_FIGHT_RESOLVED',  this._onBossFightMusicEnd,   this)
    EventBus.off('SHADOW_MONARCH_DUEL',  this._onBossFightZoomIn,  this)
    EventBus.off('BOSS_FIGHT_RESOLVED',  this._onBossFightZoomOut, this)
    EventBus.off('LIGHT_PARTY_DUEL_BEGAN', this._onBossFightZoomIn,  this)
    EventBus.off('LIGHT_PARTY_DUEL_END',   this._onBossFightZoomOut, this)
    EventBus.off('INTRO_DISMISSED',      this._onIntroDismissed, this)
    GameplayMusic.bossFightEnd(true)   // immediate stop if scene tears down mid-fight
    this.scale.off('resize', this._onSceneResize, this)
    if (this._onTabVisibleBound) {
      window.removeEventListener('focus', this._onTabVisibleBound)
      document.removeEventListener('visibilitychange', this._onTabVisibleBound)
      this._onTabVisibleBound = null
    }
    if (this._onBeforeUnloadBound) {
      window.removeEventListener('beforeunload', this._onBeforeUnloadBound)
      this._onBeforeUnloadBound = null
    }
    if (this._onVisibilitySaveBound) {
      document.removeEventListener('visibilitychange', this._onVisibilitySaveBound)
      this._onVisibilitySaveBound = null
    }
    this.scene.stop('HudScene')

    // Tear down every system / renderer registered via track() in create().
    // Iterating a registry replaced the prior 50-line hand-maintained
    // destroy chain — that pattern silently leaked any system whose
    // destroy call was forgotten (e.g. BossArchetypeSystem, which caused
    // the vampire-charm-on-every-archetype bug because the leaked
    // previous-run instance kept reacting to ADVENTURERS_SPAWNED with
    // stale archetype state). Reverse order so teardown mirrors
    // construction — safer if any destroy() reads sibling system state.
    for (let i = this._lifecycle.length - 1; i >= 0; i--) {
      const obj = this._lifecycle[i]
      try { obj.destroy() }
      catch (e) { console.error('[Game] destroy failed for', obj?.constructor?.name, e) }
    }
    this._lifecycle = []
  }

  // Anti-save-scum commit (2026-05-31). When the boss loses a life, the
  // decrement only lived in memory until the NEXT NIGHT_PHASE_STARTED autosave
  // — so a player could quit during the day (hard close / crash / mobile
  // app-switch, or with autosave turned off where the beforeunload save bails)
  // and reload to the pre-death night save, undoing the loss. We close that
  // window by committing the moment the life is lost.
  //
  // UNCONDITIONAL by design: this ignores the qf.gameplay.autosave setting.
  // That toggle governs *convenience* autosaves (build progress), not
  // permadeath consequences — letting it off hand out free life-undos was the
  // loophole. Same philosophy as the run-start + INTRO_DISMISSED saves, which
  // are also unconditional. Final death needs no save here: _onBossFinal
  // DELETES the save (no resumable dead run), so we skip deathsRemaining <= 0.
  _onBossLifeCommit({ winner } = {}) {
    if (winner !== 'party') return                                   // boss won → no life lost
    if ((this.gameState?.boss?.deathsRemaining ?? 0) <= 0) return    // final death handled by _onBossFinal
    try { SaveSystem.save(this.gameState) } catch {}
  }

  _onBossFinal() {
    // Stop everything, transition to GameOver. Under the new DOM HUD,
    // keep HudScene alive so the DOM GameOverOverlay can mount over the
    // dimmed dungeon view — the overlay handles RISE AGAIN by starting
    // MainMenu itself. Otherwise (legacy), stop HudScene + start the
    // Phaser GameOver scene as before.
    //
    // Save deletion (fix 2026-05-25): wipe the save file the moment the
    // run is ABSOLUTELY over (boss out of lives — Phylactery already
    // would have intercepted earlier if applicable). The legacy Phaser
    // GameOver scene called deleteSave on its own; the new DOM
    // GameOverOverlay didn't, leaving the save in localStorage. Players
    // could then click CONTINUE on the main menu and resume the dead
    // run as if nothing happened. Deleting here covers BOTH HUD paths
    // and survives the player closing the tab during the Game Over
    // screen — there is no scenario in which a dead boss should leave
    // a resumable save behind.
    try { SaveSystem.deleteSave?.() } catch {}
    let useNewHud = true
    try { useNewHud = localStorage.getItem('newhud') !== '0' } catch {}
    this.scene.stop('NightPhase')
    this.scene.stop('DayPhase')
    this.scene.stop('EndOfDay')
    if (useNewHud) {
      EventBus.emit('SHOW_GAME_OVER')
    } else {
      this.scene.stop('HudScene')
      this.scene.start('GameOver', { gameState: this.gameState })
    }
  }

  // Merge a room def's static connection points with the live room's
  // saved CPs. Def CPs win on identity (template-defined doors / external
  // exits), but inherit any saved open/opening/openProgress state. Saved
  // CPs that don't match a def CP are auto-pair connections generated by
  // DungeonGrid._autoConnect() when the room was placed adjacent to a
  // neighbour — we keep those verbatim, otherwise the door tile is left
  // orphaned and the room becomes unreachable from that side.
  _mergeRoomConnectionPoints(room, def) {
    const sameSpot = (a, b) => a.x === b.x && a.y === b.y && a.direction === b.direction
    const savedCPs = Array.isArray(room.connectionPoints) ? room.connectionPoints : []
    const defCPs   = (def.connectionPoints ?? []).map(cp => ({ ...cp }))
    const merged   = defCPs.map(dcp => {
      const saved = savedCPs.find(s => sameSpot(s, dcp))
      return saved
        ? { ...dcp, open: saved.open, opening: saved.opening, openProgress: saved.openProgress }
        : dcp
    })
    const autoPairs = savedCPs.filter(s => !defCPs.some(dcp => sameSpot(dcp, s)))
    room.connectionPoints = [...merged, ...autoPairs]
  }

  // Room Builder emits this whenever it saves a room def to localStorage.
  // We rewrite the tile grid for every already-placed instance so structural
  // edits (floor/wall layout, doorway positions) appear immediately in the
  // dungeon without the player having to remove + re-place the room.
  // The renderer redraw is called last, after all tile data is current.
  _onRoomDefSaved({ roomId }) {
    const roomDefs = this.cache.json.get('rooms') ?? []
    const def = roomDefs.find(d => d.id === roomId)
    if (!def) return
    for (const room of this.gameState.dungeon.rooms) {
      if (room.definitionId !== roomId) continue
      // Rotated rooms need the def rotated to the same orientation
      // before merging — otherwise the unrotated tileLayout / CP
      // positions get stamped onto a rotated footprint (mismatched
      // overlay sprites, doors in the wrong walls).
      const rotDef = getRotatedDef(def, room.rotation ?? 0)
      // Sync the room instance's connectionPoints with the updated def so
      // doorway positions stay accurate for neighbour lookups. Auto-pair
      // CPs are preserved so door↔neighbour links survive a def edit.
      this._mergeRoomConnectionPoints(room, rotDef)
      this._refreshRoomFromDef(room, rotDef)
      this.dungeonGrid.reapplyRoomDef(room, rotDef)
    }
    this._dungeonRenderer?.redraw()
  }

  // Pull the editor-authored sprite/painting fields from the def onto the
  // live room instance. Without this, edits made in RoomTileEditor save to
  // rooms.json + the cache but never reach the runtime room object, so
  // DungeonRenderer keeps drawing the OLD doorTiles/theme/tileLayout.
  _refreshRoomFromDef(room, def) {
    if ('theme'       in def) room.theme       = typeof def.theme      === 'string' ? def.theme      : null
    if ('doorTheme'   in def) room.doorTheme   = typeof def.doorTheme  === 'string' ? def.doorTheme  : null
    if ('tileLayout'  in def) room.tileLayout  = Array.isArray(def.tileLayout) ? def.tileLayout : []
    if ('doorTiles'   in def) room.doorTiles   = (def.doorTiles && typeof def.doorTiles === 'object') ? def.doorTiles : null
    if ('decorations' in def) room.decorations = Array.isArray(def.decorations) ? def.decorations : []
    if ('colorAdjust' in def) room.colorAdjust = (def.colorAdjust && typeof def.colorAdjust === 'object') ? def.colorAdjust : null
  }

  // Room Builder reset ALL rooms — reapply every placed room's tile grid
  // from the current (freshly-cleared) cache defs in a single pass, then
  // redraw once.
  _onRoomsAllReset() {
    this._reapplyAllRoomDefs()
    this._dungeonRenderer?.redraw()
  }

  // Phase: items — propagate `gameState.dungeon.locks[]` onto each
  // affected connection point's `cp.locked` flag. DungeonRenderer reads
  // `cp.locked` in `_doorStateFor()` to pick the locked door variant
  // sprite, so this needs to run any time the locks list mutates: on
  // place, sell, unlock, break, and night reset (also at scene create
  // so a saved game restores the locked sprites).
  _syncLockedCPs() {
    for (const room of this.gameState.dungeon?.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) cp.locked = false
    }
    for (const lock of this.gameState.dungeon?.locks ?? []) {
      if (lock.unlocked || lock.broken) continue
      for (const t of lock.doorTiles) {
        const info = this.dungeonGrid?.getCpForDoorTile?.(t.x, t.y)
        if (info?.cp) info.cp.locked = true
      }
    }
    this._dungeonRenderer?.redrawDoors?.()
  }

  // Gold floor maintained for the mango cheat — anything below is
  // topped back up every update tick.
  static get MANGO_GOLD_FLOOR() { return 9999 }

  // Mango cheat — flatten every JSON def's unlockLevel to 1, back-fill
  // the gameState.unlocks allowlists so every room / minion / trap /
  // item is available from boss level 1, AND seed the gold to the
  // 9999 floor so a fresh-into-cheat run has buying power immediately
  // (the per-tick refill in update() keeps it topped up after spends).
  // Called once from create() when PlayerProfile.isCheatName() is
  // true. Mutates Phaser's cached defs in place; the change persists
  // until the page reloads (next run by a non-cheat name will need a
  // refresh to restore gates).
  _applyMangoCheatUnlocks() {
    // 1) Stamp unlockLevel = 1 on every gated def — and SNAPSHOT the original
    //    value first, so _revertMangoCheatUnlocks can restore it cleanly
    //    when the player switches off the cheat name. The snapshot lives on
    //    the Phaser game instance (survives scene restarts in the same page
    //    session, but gone after a real page reload — which gets a fresh
    //    JSON cache and doesn't need the revert). Idempotent: a snapshot
    //    that already exists is preserved (re-snapshotting after the cache
    //    is already mutated would store 1s and break the revert path).
    const game = this.game
    game._mangoUnlockSnap = game._mangoUnlockSnap ?? {}
    const snap = game._mangoUnlockSnap
    const keys = ['rooms', 'minionTypes', 'trapTypes', 'items']
    let touched = 0
    for (const key of keys) {
      const defs = this.cache.json.get(key)
      if (!Array.isArray(defs)) continue
      snap[key] = snap[key] ?? {}
      for (const def of defs) {
        if (def && (def.unlockLevel ?? 1) > 1) {
          if (!(def.id in snap[key])) snap[key][def.id] = def.unlockLevel
          def.unlockLevel = 1
          touched++
        }
      }
    }
    // 2) Back-fill the allowlists in gameState.unlocks so any IDs added
    //    to JSON since this save was first initialised still appear in
    //    the build menus (NightPhase / EventSystem / DungeonGrid all
    //    intersect against these lists).
    const u = this.gameState.unlocks ?? (this.gameState.unlocks = {})
    const ensureAll = (slot, defs) => {
      if (!Array.isArray(defs)) return
      const have = new Set(u[slot] ?? [])
      for (const d of defs) if (d?.id) have.add(d.id)
      u[slot] = [...have]
    }
    ensureAll('rooms',       this.cache.json.get('rooms'))
    ensureAll('minionTypes', this.cache.json.get('minionTypes'))
    ensureAll('trapTypes',   this.cache.json.get('trapTypes'))
    // Items don't have an allowlist — they're gated purely by
    // unlockLevel, which step 1 already neutralised.

    // 3) Seed gold to the floor so the player has buying power
    //    immediately. The update() tick keeps it topped up after spends.
    const p = this.gameState.player ?? (this.gameState.player = {})
    if ((p.gold ?? 0) < Game.MANGO_GOLD_FLOOR) p.gold = Game.MANGO_GOLD_FLOOR

    console.info(`[Mango cheat] Unlocked every room/minion/trap/item (${touched} defs flattened); gold pinned at ${Game.MANGO_GOLD_FLOOR}.`)
  }

  // Revert the mango-cheat cache mutation: walk the snapshot stored on the
  // game instance by _applyMangoCheatUnlocks and restore each def's original
  // unlockLevel, then drop the snapshot. No-op when there's no snapshot (the
  // cheat never ran in this page session). Called on every non-mango Game-
  // scene boot so a player who tests as mango and switches to a real name
  // gets correct unlock-gating without a page reload.
  //
  // NOTE: the gameState.unlocks allowlists back-filled in step (2) above are
  // per-save and per-name (SaveSystem is name-scoped as of 2026-05-29), so
  // they need no separate revert — a non-mango Game boot loads that name's
  // own gameState whose unlocks reflect their actual progress.
  _revertMangoCheatUnlocks() {
    const snap = this.game?._mangoUnlockSnap
    if (!snap) return
    const keys = ['rooms', 'minionTypes', 'trapTypes', 'items']
    let restored = 0
    for (const key of keys) {
      const bucket = snap[key]
      if (!bucket) continue
      const defs = this.cache.json.get(key)
      if (!Array.isArray(defs)) continue
      const byId = {}
      for (const d of defs) if (d?.id) byId[d.id] = d
      for (const id of Object.keys(bucket)) {
        const def = byId[id]
        if (def) { def.unlockLevel = bucket[id]; restored++ }
      }
    }
    this.game._mangoUnlockSnap = null
    if (restored > 0) console.info(`[Mango cheat] Reverted cache mutation — restored ${restored} unlockLevel values.`)
  }

  // Reapply current room definitions to every placed room instance.
  // Shared by the on-load fix and the live ROOMS_ALL_RESET event handler.
  // Door↔neighbour links are preserved via _mergeRoomConnectionPoints()
  // so a continued save doesn't end up with orphaned door tiles between
  // rooms that DungeonGrid._autoConnect() linked at placement time.
  _reapplyAllRoomDefs() {
    const roomDefs = this.cache.json.get('rooms') ?? []
    const defMap   = Object.fromEntries(roomDefs.map(d => [d.id, d]))
    for (const room of this.gameState.dungeon.rooms) {
      const def = defMap[room.definitionId]
      if (!def) continue
      // Rotated rooms (room.rotation > 0) need the def rotated to match
      // the saved orientation before any of the apply steps run. Without
      // this, _refreshRoomFromDef stamps the unrotated tileLayout onto a
      // rotated footprint, producing the patchy / mismatched overlay
      // sprites the user saw on continued saves of rotated rooms.
      const rotDef = getRotatedDef(def, room.rotation ?? 0)
      this._mergeRoomConnectionPoints(room, rotDef)
      this._refreshRoomFromDef(room, rotDef)
      this.dungeonGrid.reapplyRoomDef(room, rotDef)
    }
    // Rebuild the solid-decor tile set after all rooms have been reapplied.
    this.dungeonGrid.rebuildSolidDecors()
  }

  // The intro was just delivered + dismissed — `meta.introSeen` is now
  // true on the live gameState. Persist it straight away so a Continue
  // started before the first phase autosave doesn't replay the intro.
  // Unconditional (not gated by the AUTOSAVE setting) for the same reason
  // ArchetypeSelect's run-start save is: the save file already exists, and
  // the intro closes before the player builds anything, so this only
  // corrects the flag — it doesn't capture build progress.
  _onIntroDismissed() {
    if (this.gameState) SaveSystem.save(this.gameState)
  }

  _onNightStart() {
    // Apply any pending grid growth FIRST — it shifts boss + minion tile
    // coords and re-anchors the dungeon. Doing it before respawnAll
    // ensures revived dead minions land at the right (post-shift) tiles,
    // and before trapSystem.resetAll so traps are at their final coords
    // when state is wiped fresh. (2026-05-27 — symmetric grid expansion.)
    this._applyPendingGridGrowth()
    // Minion tier upgrades now PERSIST through death (2026-05-29) — there's no
    // evolution reset; respawnAll rescales each minion from its upgraded base,
    // so a revived minion returns at the tier the player paid for.
    this.minionAiSystem?.respawnAll()
    this.trapSystem?.resetAll()
    // Safety: if the boss fight ended without resolving (all fled etc.),
    // BOSS_FIGHT_RESOLVED already handled this — this is a belt-and-suspenders
    // guard to ensure boss music never leaks into the night phase.
    GameplayMusic.bossFightEnd(true)
  }

  // Pay-to-revive (2026-05-28) — the night-phase REVIVE button. Charges gold
  // here (the single charge site), then MinionAISystem.reviveFallen performs
  // the revive transform. Cost + eligibility come from the shared
  // util/minionRevive helpers, so this charge always matches the price the
  // build menu displays. No-ops outside the night/build phase or when there's
  // nothing fallen.
  _onReviveFallenRequest() {
    const gs = this.gameState
    if (!gs || gs.meta?.phase !== 'night') return
    const fallen = fallenRevivable(gs)
    if (fallen.length === 0) return
    const minionDefs = this.cache.json.get('minionTypes') ?? []
    const chains     = this.cache.json.get('minionEvolutions')
    const total      = totalReviveCost(gs, minionDefs, chains)
    const have       = gs.player?.gold ?? 0

    // Can afford everyone (or dev infinite gold) — revive all, as before.
    if (Balance.DEV_INFINITE_GOLD || have >= total) {
      if (!Balance.DEV_INFINITE_GOLD && total > 0) gs.player.gold -= total
      this._finishRevive(null)
      return
    }

    // Can't afford all → plan both priorities so the player can choose.
    const candidates = reviveCandidates(gs, minionDefs, chains)
    const strongest  = planRevive(candidates, have, 'strongest')
    const quantity   = planRevive(candidates, have, 'quantity')

    // Can't even afford the cheapest one — no choice to make, just say so.
    if (strongest.count === 0 && quantity.count === 0) {
      const costs = candidates.map(c => c.cost).filter(c => c > 0)
      const cheapest = costs.length ? Math.min(...costs) : 0
      EventBus.emit('SHOW_TOAST', {
        message: `Not enough gold to revive any (cheapest is ${cheapest}g).`,
        type: 'error',
      })
      return
    }

    // Otherwise hand the strength-vs-quantity tradeoff to the player.
    EventBus.emit('SHOW_REVIVE_CHOICE', {
      fallenCount: fallen.length,
      totalCost:   total,
      have,
      strongest,
      quantity,
      onPick: (mode) => {
        const plan = mode === 'quantity' ? quantity : strongest
        if (plan.cost > 0) gs.player.gold -= plan.cost
        this._finishRevive(plan.ids)
      },
    })
  }

  // Shared revive completion: revives the chosen set (null = all), plays the
  // press SFX, and toasts how many are still fallen after a partial revive.
  _finishRevive(ids) {
    const revived = this.minionAiSystem?.reviveFallen(ids) ?? 0
    if (revived <= 0) return
    try {
      const key = this.cache.audio.exists('sfx-revive-minions') ? 'sfx-revive-minions'
                : this.cache.audio.exists('sfx-revive')          ? 'sfx-revive' : null
      if (key) this.sound.play(key, { volume: 0.7 })
    } catch { /* audio not ready — non-fatal */ }
    const remaining = fallenRevivable(this.gameState).length
    if (remaining > 0) {
      EventBus.emit('SHOW_TOAST', {
        message: `Revived ${revived} — ${remaining} still fallen.`,
        type: 'success',
      })
    }
  }

  // Pay-to-rebuild (2026-05-29) — the night-phase REBUILD button. Traps have a
  // 5% chance to break after firing on an adventurer (TrapSystem removes them
  // and snapshots them onto dungeon._brokenTraps). This charges gold here (the
  // single charge site) at half each trap's current build cost, then restores
  // every broken trap to dungeon.traps at its original tile/facing with fresh
  // state so the renderer + TrapSystem pick them straight back up. No-ops
  // outside the night/build phase, when nothing is broken, on a locked
  // (Insomniac) night, or when the player can't afford the full batch.
  _onRebuildTrapsRequest() {
    const gs = this.gameState
    if (!gs || gs.meta?.phase !== 'night') return
    // The Insomniac — a sealed night blocks all building, rebuilds included.
    if (gs._mechanicFlags?.insomniacLockTonight) {
      EventBus.emit('SHOW_TOAST', {
        message: 'The Insomniac — the dungeon is sealed tonight.',
        type: 'error',
      })
      return
    }
    const broken = brokenTraps(gs)
    if (broken.length === 0) return
    const trapDefs = this.cache.json.get('trapTypes') ?? []
    const total    = totalTrapRebuildCost(gs, trapDefs)
    const have     = gs.player?.gold ?? 0

    if (!Balance.DEV_INFINITE_GOLD && have < total) {
      EventBus.emit('SHOW_TOAST', {
        message: `Not enough gold to rebuild traps (need ${total}g).`,
        type: 'error',
      })
      return
    }
    if (!Balance.DEV_INFINITE_GOLD && total > 0) gs.player.gold -= total

    const byId = {}
    for (const d of trapDefs) byId[d.id] = d
    const dungeon = gs.dungeon
    dungeon.traps ??= []
    let rebuilt = 0
    for (const snap of broken) {
      const def = byId[snap.definitionId]
      if (!def) continue
      const trap = createTrap(def, { tileX: snap.tileX, tileY: snap.tileY, facing: snap.facing })
      trap.instanceId = snap.instanceId   // keep the original id so knowledge/refs reconnect
      dungeon.traps.push(trap)
      rebuilt++
    }
    dungeon._brokenTraps = []

    if (rebuilt > 0) {
      try {
        const keys = ['sfx-build-1', 'sfx-build-2', 'sfx-build-3'].filter(k => this.cache.audio.exists(k))
        const key  = keys.length ? keys[Math.floor(Math.random() * keys.length)] : null
        if (key) this.sound.play(key, { volume: 0.7 })
      } catch { /* audio not ready — non-fatal */ }
      EventBus.emit('TRAPS_REBUILT', { count: rebuilt })
      EventBus.emit('SHOW_TOAST', {
        message: `Rebuilt ${rebuilt} trap${rebuilt === 1 ? '' : 's'}.`,
        type: 'success',
      })
    }
  }

  // Lost-at-day-start: when the day begins, any fallen minion the player
  // didn't pay to revive during the build phase is gone for good. Uses the
  // shared predicate so only revivable fallen are purged — permanent-death
  // specials were already stripped by respawnAll at night start.
  _purgeUnrevivedFallen() {
    const gs = this.gameState
    if (!gs?.minions?.length) return
    const lost = fallenRevivable(gs)
    if (lost.length === 0) return
    const lostIds = new Set(lost.map(m => m.instanceId))
    gs.minions = gs.minions.filter(m => !lostIds.has(m.instanceId))
    EventBus.emit('MINIONS_LOST_FALLEN', { count: lost.length })
  }

  // ── Camera follow ─────────────────────────────────────────────────────────

  _onAdvClicked({ adventurer }) {
    this._setFollow(adventurer.instanceId)
  }

  // Solo Leveling — clicking Jinwoo's exploration HP bar re-locks the camera
  // onto him (same follow path as clicking his sprite / the auto-lock on entry).
  _onShadowMonarchFollow({ id } = {}) {
    if (id) this._setFollow(id)
  }

  _onAdvRemoved({ adventurer }) {
    if (this._followId !== adventurer?.instanceId) return
    const next = this.gameState.adventurers.active.find(
      a => a.instanceId !== adventurer.instanceId
    )
    this._setFollow(next?.instanceId ?? null)
  }

  _onAdvsSpawned({ adventurers }) {
    if (!adventurers?.length) return
    // Wait for DayPhase's entry-hall camera tween (~600ms) to finish before
    // handing the camera over to follow mode.
    this.time.delayedCall(750, () => {
      if (!this._followId) this._setFollow(adventurers[0].instanceId)
    })
  }

  // Loot Goblin escape feedback. Red "-Ng" floater at the goblin's last
  // world position + a center-screen toast banner so the gold drain is
  // unmissable. Without this the gold counter just silently drops.
  _onLootGoblinEscaped({ adventurer, stolen }) {
    if (!stolen || stolen <= 0) return
    const wx = adventurer?.worldX
    const wy = adventurer?.worldY
    if (typeof wx === 'number' && typeof wy === 'number') {
      AbilityVfx.floatingText(this, wx, wy - 18, `-${stolen}g`, {
        color: '#ff5555', fontSize: '14px', durationMs: 900, driftY: -36, depth: 95,
      })
    }
    const cam = this.cameras?.main
    if (!cam) return
    const cx = cam.midPoint.x
    const cy = cam.midPoint.y - 80
    const banner = this.add.text(cx, cy, `GOBLIN ESCAPED · -${stolen}g`, {
      fontSize: '20px', color: '#ff7777', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(120).setScrollFactor(0)
    this.tweens.add({
      targets:  banner,
      alpha:    { from: 1, to: 0 },
      y:        cy - 40,
      duration: 1400,
      ease:     'Quad.easeOut',
      onComplete: () => banner.destroy(),
    })
  }

  // Per-event ambient overlays.
  //
  // [Removed 2026-05-25] Phaser-side `_buildBloodMoonOverlay` +
  // `_buildEventTint` graphics overlays. Both drew a `cam.width × cam.height`
  // fill at world (0,0) with `setScrollFactor(0)` — but in Phaser that
  // does NOT make the graphics camera-relative. The rect rendered in
  // WORLD coordinates as a fixed 1280×720 chunk of the play area,
  // showing as a dark-red square that obscured rooms during Blood Moon
  // Eclipse (and a wrong-colour square for fog / miasma / arcane
  // storm). The DOM-side `EventFx` layer (`src/hud/EventFx.js` +
  // `fx-bloodmoon` / `fx-fog` / `fx-miasma` / `fx-arcane` classes in
  // styles.css) already paints the correct full-screen radial wash +
  // vignette over the actual viewport via CSS — that's the gentle
  // atmospheric red tint visible in the working screenshot. Removing
  // the Phaser duplicate.
  _onDungeonEventBegan(_payload) {
    // No-op — DOM EventFx handles every event's scene-wide chrome.
  }

  _onDungeonEventEnded(_payload) {
    // No-op — DOM EventFx tears down its own chrome on
    // DUNGEON_EVENT_ENDED.
  }

  // Phase-transition camera fade. Short, world-camera only — HUD stays
  // visible the whole time. Re-entrant by design: a phase change while
  // a previous fade is mid-tween just kicks off a new fadeIn (Phaser's
  // FadeIn effect cancels any in-flight fade automatically).
  _onPhaseFadeIn() {
    this._cam?.fadeIn?.(280, 0, 0, 0)
  }
  _onPhaseFadeOut() {
    this._cam?.fadeOut?.(220, 0, 0, 0)
  }

  _onDayEnded() {
    // Clear follow state silently — DayPhase UI is already tearing down.
    this._followId = null
    this._duelCamLock = false   // safety: never leave the duel lock set across phases
    // The intel/knowledge heat map button lives on DayPhase, which is
    // shutting down. The overlay graphics live on this (Game) scene and
    // would otherwise stay visible into the night. Force-off here so the
    // map clears and the next day starts with the toggle off.
    this.knowledgeOverlay?.setEnabled(false)
  }

  // Day-start: animate-open every external cp (currently just entry_hall's
  // north entrance) so the dungeon's doorway swings open as adventurers
  // arrive. cps that aren't external are left in whatever state they're in
  // (closed for the first run, retained-open after first traversal).
  _onDayStartedDoors() {
    const r = this._dungeonRenderer
    if (!r) return
    for (const room of this.gameState.dungeon.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) {
        if (cp.external) r.openDoor(cp)
      }
    }
  }

  // Day-end: hard-close every cp (no animation) so the next day starts
  // with a fresh dungeon.  External doors re-animate open at day-start
  // (see _onDayStartedDoors), and internal doors swing open again the
  // first time an adventurer steps onto them — same as the very first
  // day.  Without this reset, internal doors stayed open forever after
  // first traversal.
  _onDayEndedDoors() {
    const r = this._dungeonRenderer
    if (!r) return
    for (const room of this.gameState.dungeon.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) {
        r.closeDoor(cp)
      }
    }
  }

  _setFollow(id) {
    this._followId = id
    const name = id
      ? (this.gameState.adventurers.active.find(a => a.instanceId === id)?.name ?? null)
      : null
    EventBus.emit('CAMERA_FOLLOW_CHANGED', { id, name })
  }

  // Phase 6e: cache the chosen archetype's modifiers on gameState so other
  // systems (EvolutionSystem, NightPhase trap palette, AISystem gold award)
  // can apply them without re-fetching the JSON each tick.
  _cacheArchetypeModifiers() {
    const id = this.gameState.player?.bossArchetypeId
    if (!id) return
    const archs = this.cache.json.get('bossArchetypes') ?? []
    const arch = archs.find(a => a.id === id)
    if (arch?.modifiers) {
      this.gameState.player.archetypeModifiers = { ...arch.modifiers }
    }
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  // Minimum zoom that still fits the full dungeon map in the viewport.
  // Shrinks as the map expands so the player can always zoom out to see everything.
  // Side / top / bottom HUD chrome dimensions in UI design units (kept in
  // sync with HudScene.LEFT_COL_W + COL_PAD*2, RIGHT_COL_W + COL_PAD*2,
  // BOSS_TOP_BAR_HEIGHT, ACTION_BAR_HEIGHT). Used to derive the central
  // play area in canvas pixels for the camera-clamp logic.
  static get _PLAY_AREA_INSETS() {
    return { left: 200 + 12 * 2, right: 220 + 12 * 2, top: 56, bottom: 76 + 6 }
  }

  // The play area is the sub-rectangle of the canvas not covered by HUD
  // chrome. Returned in canvas pixels.
  _computePlayArea() {
    const sw  = this.scale.width
    const sh  = this.scale.height
    const sf  = Math.min(sw / 1280, sh / 720)
    const ins = Game._PLAY_AREA_INSETS
    return {
      left:   ins.left   * sf,
      right:  ins.right  * sf,
      top:    ins.top    * sf,
      bottom: ins.bottom * sf,
      sw, sh,
    }
  }

  _computeMinZoom() {
    const { gridWidth, gridHeight } = this.gameState.dungeon
    const mapPxW = gridWidth  * TS
    const mapPxH = gridHeight * TS
    const pa = this._computePlayArea()
    const playW = pa.sw - pa.left - pa.right
    const playH = pa.sh - pa.top  - pa.bottom
    // Min zoom such that the dungeon FILLS the play area on both axes
    // (the larger of the two ratios). Prevents the player from zooming
    // out to a point where excess play-area space appears around the
    // dungeon — the trade-off is they can't see the whole dungeon at
    // once if its aspect ratio differs from the play area's; they have
    // to pan to see the off-screen portion.
    return Math.max(playW / mapPxW, playH / mapPxH)
  }

  // Camera scroll clamp + auto-centering, expressed against the *play area*
  // (the rectangle between the HUD panels) instead of the full canvas. The
  // camera viewport is still the whole canvas — that keeps geometry masks
  // working correctly — but the scroll is constrained so the dungeon never
  // hides behind a panel and centres in the play area when the player has
  // zoomed out far enough that the dungeon doesn't fill the viewport.
  _clampCameraToPlayArea() {
    const cam = this._cam
    if (!cam) return
    const { gridWidth, gridHeight } = this.gameState.dungeon
    const mapW = gridWidth  * TS
    const mapH = gridHeight * TS
    const pa = this._computePlayArea()
    const playW = pa.sw - pa.left - pa.right
    const playH = pa.sh - pa.top  - pa.bottom
    const playCx = pa.left + playW / 2
    const playCy = pa.top  + playH / 2
    const z  = cam.zoom
    const cx = cam.centerX
    const cy = cam.centerY

    // Phaser zooms cameras around their viewport midpoint, not the
    // top-left. The inverse of "world W shows up at canvas-px X" is
    //   scrollX = W - cx - (X - cx) / z
    // (matching the wheel-zoom-to-cursor formula). The earlier clamp
    // used the top-left form (W - X/z) which silently mis-clamped any
    // time z != 1, leaving black void on whichever side the math
    // under-shot. With sf-driven UI scaling the camera's effective zoom
    // is rarely 1, so this bug appeared as soon as the canvas was any
    // size other than exactly 1280×720.
    const sxFor = (worldX, screenX) => worldX - cx - (screenX - cx) / z
    const syFor = (worldY, screenY) => worldY - cy - (screenY - cy) / z

    // [clamp] debug log removed — was leftover from camera-zoom diagnosis.

    // X axis — clamp so dungeon edges align with play-area edges.
    if (playW / z >= mapW) {
      // Dungeon fits horizontally inside the play area → centre it.
      cam.scrollX = sxFor(mapW / 2, playCx)
    } else {
      const minScrollX = sxFor(0,    pa.left)
      const maxScrollX = sxFor(mapW, pa.sw - pa.right)
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX, minScrollX, maxScrollX)
    }

    // Y axis (mirrors X)
    if (playH / z >= mapH) {
      cam.scrollY = syFor(mapH / 2, playCy)
    } else {
      const minScrollY = syFor(0,    pa.top)
      const maxScrollY = syFor(mapH, pa.sh - pa.bottom)
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY, minScrollY, maxScrollY)
    }
  }

  // Cinematic zoom into the boss chamber when a fight starts. Pairs with
  // BossFightOverlay's intro slate. We snapshot the player's pre-fight
  // zoom + scroll so the resolved handler can ease back to whatever they
  // were watching before. Tween skipped if the boss room can't be found
  // (e.g. malformed save) so the camera never jumps to (0,0) silently.
  _onBossFightZoomIn() {
    if (!this._cam) return
    const boss = this.gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return
    // Solo Leveling — lock the camera on the throne for the whole duel: the
    // zoom-in plays, then the player can't pan/zoom until the fight resolves
    // (released in _onBossFightZoomOut). Wired ONLY to SHADOW_MONARCH_DUEL.
    this._duelCamLock = true
    this._dragOrigin = null
    const bx = (boss.gridX + boss.width  / 2) * TS
    const by = (boss.gridY + boss.height / 2) * TS
    // Snapshot only once — successive incoming events during a single
    // fight (chained adventurers) shouldn't overwrite the original view.
    if (!this._preFightCam) {
      this._preFightCam = {
        zoom:    this._cam.zoom,
        worldCX: this._cam.midPoint.x,
        worldCY: this._cam.midPoint.y,
        followId: this._followId,
      }
    }
    // Drop adv-follow while the cinematic plays — otherwise update()'s
    // follow lerp fights this tween every frame, dragging the camera
    // toward the lead adv and creating a visible wobble.
    if (this._followId) this._setFollow(null)
    const targetZoom = Math.max(this._cam.zoom, 1.5)
    this._tweenCameraTo(bx, by, targetZoom, 600, 'Sine.easeOut')
  }

  _onBossFightZoomOut() {
    // The Light Party WIN emits BOSS_FIGHT_RESOLVED the instant the boss falls,
    // but its outro (victory lines → Recall → teleport) keeps playing on the
    // throne afterward. Hold the lock; the real release is driven by
    // LIGHT_PARTY_DUEL_END once _finishLightPartyOutro runs (_lpOutro cleared).
    if (this.bossSystem?._lpOutro) return
    // Release the duel camera lock the moment the fight resolves (before the
    // early-return, so it always clears even if the snapshot is missing).
    this._duelCamLock = false
    if (!this._cam || !this._preFightCam) return
    const snap = this._preFightCam
    this._tweenCameraTo(snap.worldCX, snap.worldCY, snap.zoom, 700, 'Sine.easeInOut',
      () => { this._preFightCam = null })
  }

  _onBossFightMusicStart() { GameplayMusic.bossFightStart(this) }
  _onBossFightMusicEnd()   { GameplayMusic.bossFightEnd() }

  // Tween the camera so its world midpoint eases linearly from the
  // current view to (worldX, worldY) while zoom eases to targetZoom.
  // Driving zoom + scroll independently caused the world midpoint to
  // drift mid-tween (the zoom <-> scroll relationship is non-linear) —
  // visibly the camera would swing past the boss room before snapping
  // back. Using a virtual `p` and recomputing both each frame keeps the
  // midpoint on a straight line throughout the ease.
  _tweenCameraTo(worldX, worldY, targetZoom, duration, ease, onComplete) {
    const cam = this._cam
    if (!cam) return
    const startZoom = cam.zoom
    const startMidX = cam.midPoint.x
    const startMidY = cam.midPoint.y
    if (this._fightCamTween) this._fightCamTween.stop()
    // Suspend the per-frame clamp + follow lerp while this tween owns
    // the camera — otherwise update() runs every frame and either
    // re-centres the dungeon (clamp) or pulls scroll back toward an
    // adventurer (follow), fighting the tween.
    this._fightCamActive = true
    const obj = { p: 0 }
    this._fightCamTween = this.tweens.add({
      targets:  obj,
      p:        1,
      duration,
      ease,
      onUpdate: () => {
        const t  = obj.p
        const z  = startZoom + (targetZoom - startZoom) * t
        const mx = startMidX + (worldX     - startMidX) * t
        const my = startMidY + (worldY     - startMidY) * t
        cam.setZoom(z)
        const pa = this._computePlayArea()
        const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
        const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
        // Mid-point-aware: place world (mx,my) at canvas px (playCx,playCy)
        cam.scrollX = mx - cam.centerX - (playCx - cam.centerX) / z
        cam.scrollY = my - cam.centerY - (playCy - cam.centerY) / z
      },
      onComplete: () => {
        this._fightCamActive = false
        // Final snap to the exact target — guarantees the resting
        // position matches the math regardless of where the last
        // onUpdate fired.
        cam.setZoom(targetZoom)
        const pa = this._computePlayArea()
        const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
        const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
        cam.scrollX = worldX - cam.centerX - (playCx - cam.centerX) / targetZoom
        cam.scrollY = worldY - cam.centerY - (playCy - cam.centerY) / targetZoom
        if (onComplete) onComplete()
      },
    })
  }

  _onGridExpanded() {
    // After a grid expansion the minimum zoom decreases (bigger map → can zoom
    // out further). If the camera happens to be below the new minimum, clamp up.
    const minZoom = this._computeMinZoom()
    if (this._cam.zoom < minZoom) this._cam.setZoom(minZoom)
    this._clampCameraToPlayArea()
  }

  // Fires when Phaser's scale manager resizes the canvas. The camera's own
  // viewport update (cam.width/height) is also bound to this same event, and
  // listener order isn't guaranteed — so we defer one rAF to make sure cam
  // state has settled before we sample / restore the centred world point.
  _onSceneResize() {
    if (!this._cam) return
    // Snapshot the world point the player was looking at BEFORE the resize
    // settles, taken from the most recent update() tick. midPoint computed
    // mid-resize would mix the new viewport size with old scrollX, returning
    // a wrong world point.
    const wX = this._camWorldCX
    const wY = this._camWorldCY
    if (this._pendingResizeRaf) cancelAnimationFrame(this._pendingResizeRaf)
    this._pendingResizeRaf = requestAnimationFrame(() => {
      this._pendingResizeRaf = null
      this._reanchorCamera(wX, wY)
    })
  }

  // Re-anchor the world camera on `(wX, wY)` — the player's last look-point —
  // against the CURRENT viewport. Shared by the resize handler and the
  // tab-refocus recovery. Bails (returns false) while the viewport is
  // degenerate (a mid-relayout 0×0 collapse) so a transient never writes a
  // garbage scroll/zoom. Returns true once it has anchored successfully.
  _reanchorCamera(wX, wY) {
    if (!this._cam || !this.scene.isActive()) return false
    if (this.scale.width < 2 || this.scale.height < 2) return false
    if (wX === undefined || wY === undefined) {
      const boss = this.gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
      wX = boss ? (boss.gridX + boss.width  / 2) * TS : 0
      wY = boss ? (boss.gridY + boss.height / 2) * TS : 0
    }
    const minZ = this._computeMinZoom()
    if (this._cam.zoom < minZ) this._cam.setZoom(minZ)
    // Re-centre on the look-point against the play-area centre (between the
    // HUD panels), not the canvas centre.
    const pa = this._computePlayArea()
    const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
    const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
    const z = this._cam.zoom
    this._cam.scrollX = wX - this._cam.centerX - (playCx - this._cam.centerX) / z
    this._cam.scrollY = wY - this._cam.centerY - (playCy - this._cam.centerY) / z
    this._clampCameraToPlayArea()
    return true
  }

  // Tab-refocus recovery. When the player clicks away from the game and
  // back, the browser re-lays-out the page and the game container can
  // briefly collapse to 0×0; that transient can scroll the WORLD camera
  // into the void (canvas + DOM HUD stay fine, so the dungeon just reads
  // as an all-dark play area).
  //
  // Recovery is CLAMP-ONLY: _clampCameraToPlayArea pulls the camera back
  // into valid bounds if it drifted off, but is a no-op when the camera is
  // already valid — so a normal tab-back never nudges the view. (An
  // earlier version re-anchored the camera here, which re-framed it to the
  // play-area centre on every refocus and visibly shifted the dungeon.)
  // Fired at a few delays so it still lands once the relayout settles.
  _onTabVisible() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    for (const delay of [0, 150, 400, 800]) {
      setTimeout(() => {
        if (!this._cam || !this.scene.isActive()) return
        if (this.scale.width < 2 || this.scale.height < 2) return
        const minZ = this._computeMinZoom()
        if (this._cam.zoom < minZ) this._cam.setZoom(minZ)
        this._clampCameraToPlayArea()
      }, delay)
    }
  }

  _onBossLeveledUp({ newLevel }) {
    // Persist the highest boss level the player has ever reached
    // (across all runs / archetypes) so the archetype-picker unlock
    // gates can read it on the next title-screen visit. e.g. Succubus
    // unlocks once any boss has hit level 4.
    PlayerProfile.recordBossLevel(newLevel)

    // Grid expansion is DEFERRED to the next NIGHT_PHASE_STARTED — see
    // _applyPendingGridGrowth. BOSS_LEVELED_UP can fire mid-day off an
    // adventurer kill, and the new symmetric (+5-each-side) growth has
    // to shift every existing entity's tile coords. Doing that with
    // live advs walking + path arrays in flight would scatter them.
    // Queueing the growth and applying at night means by the time we
    // re-anchor everything, advs are gone and only stationary minions
    // remain.
    this.gameState.meta._pendingGridGrowth =
      (this.gameState.meta._pendingGridGrowth ?? 0) + 1

    // Scale the boss's own fight stats. Additive per level so it layers
    // cleanly on top of ability bonuses (+4 ATK / +5 DEF) and event
    // modifiers — BOSS_LEVELED_UP fires exactly once per level gained.
    // Current HP keeps its fraction so a mid-fight level-up doesn't
    // full-heal the boss (matches the minion rescale below).
    const boss = this.gameState.boss
    if (boss) {
      const hpFrac = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1
      boss.maxHp   = (boss.maxHp ?? 0) + Balance.BOSS_HP_PER_LEVEL
      boss.hp      = Math.round(boss.maxHp * hpFrac)
      boss.attack  = (boss.attack ?? 0)  + Balance.BOSS_ATK_PER_LEVEL
      boss.defense = (boss.defense ?? 0) + Balance.BOSS_DEF_PER_LEVEL
    }

    // Scale all live minions up by the ratio from their last boss level to the new one.
    for (const m of this.gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      const oldLv   = m.bossLevel ?? 1
      if (oldLv >= newLevel) continue
      const oldHpM  = 1 + Balance.MINION_HP_PER_BOSS_LV  * (oldLv  - 1)
      const newHpM  = 1 + Balance.MINION_HP_PER_BOSS_LV  * (newLevel - 1)
      const oldAtkM = 1 + Balance.MINION_ATK_PER_BOSS_LV * (oldLv  - 1)
      const newAtkM = 1 + Balance.MINION_ATK_PER_BOSS_LV * (newLevel - 1)
      const hpFrac  = m.resources.maxHp > 0 ? m.resources.hp / m.resources.maxHp : 1
      m.resources.maxHp = Math.round(m.resources.maxHp * (newHpM / oldHpM))
      m.resources.hp    = Math.round(m.resources.maxHp * hpFrac)
      m.stats.attack    = Math.round(m.stats.attack    * (newAtkM / oldAtkM))
      m.bossLevel       = newLevel
    }
  }

  // Apply any boss-level-up grid expansion that was queued during the day.
  // Each pending level adds +5 tiles on EACH side (+10 per axis), capped
  // at 100×100. With non-zero leftOffset/topOffset the existing dungeon
  // is re-anchored inside the larger grid, so every entity's tile coord
  // shifts by (+leftOffset, +topOffset). DungeonGrid.expandGrid handles
  // dungeon-side entities (rooms, traps, fountains, etc.); this helper
  // handles everything outside the dungeon object's ownership (boss,
  // minions, defensive adv shift, knowledge buckets). Called from
  // _onNightStart. (2026-05-27 — symmetric grid expansion.)
  _applyPendingGridGrowth() {
    const pending = this.gameState.meta?._pendingGridGrowth ?? 0
    if (pending <= 0) return
    const cap = 100
    const PER_SIDE = 5
    const oldW = this.gameState.dungeon.gridWidth
    const oldH = this.gameState.dungeon.gridHeight
    // Each pending level → +PER_SIDE on each side → +2*PER_SIDE per axis.
    const totalGrowAxis = 2 * PER_SIDE * pending
    const newW = Math.min(cap, oldW + totalGrowAxis)
    const newH = Math.min(cap, oldH + totalGrowAxis)
    this.gameState.meta._pendingGridGrowth = 0
    const growW = newW - oldW
    const growH = newH - oldH
    if (growW <= 0 && growH <= 0) return
    // Split growth evenly between sides — if growth is odd, the extra
    // tile goes to the right/bottom (matching the original behavior).
    const leftOff = Math.floor(growW / 2)
    const topOff  = Math.floor(growH / 2)
    this.dungeonGrid.expandGrid(newW, newH, leftOff, topOff)
    this._shiftExternalEntitiesAfterGrowth(leftOff, topOff)
    // Camera bounds depend on grid size — re-clamp so the player can pan
    // into the new tiles.
    this._clampCameraToPlayArea?.()
  }

  // Shift everything in gameState that has tile coords but lives OUTSIDE
  // gameState.dungeon (DungeonGrid handles its own). Boss, minions,
  // defensive adv shift (should be empty at night), and knowledge
  // mirrors (sharedPool + survivors[].knowledge) that store trap
  // tileX/tileY/dangerTiles as copies. (2026-05-27 — symmetric grid.)
  _shiftExternalEntitiesAfterGrowth(dx, dy) {
    if (dx === 0 && dy === 0) return
    const TS = Balance.TILE_SIZE
    // Boss — may have its own tile / world coords on some archetypes.
    const boss = this.gameState.boss
    if (boss) {
      if (typeof boss.tileX  === 'number') { boss.tileX  += dx; boss.tileY  += dy }
      if (typeof boss.worldX === 'number') { boss.worldX += dx * TS; boss.worldY += dy * TS }
    }
    // Minions — stationary at night. Shift tile + world; clear any
    // in-flight pathing so MinionAISystem replans from new coords.
    for (const m of this.gameState.minions ?? []) {
      if (typeof m.tileX  === 'number') { m.tileX  += dx; m.tileY  += dy }
      if (typeof m.worldX === 'number') { m.worldX += dx * TS; m.worldY += dy * TS }
      if (m._patrolTarget) { m._patrolTarget.x += dx; m._patrolTarget.y += dy }
      m._chasePath = null
    }
    // Active adventurers — should be empty at night, but defensive in
    // case a charmed thrall or undead-return adv survived into night.
    for (const a of this.gameState.adventurers?.active ?? []) {
      if (typeof a.tileX  === 'number') { a.tileX  += dx; a.tileY  += dy }
      if (typeof a.worldX === 'number') { a.worldX += dx * TS; a.worldY += dy * TS }
      a.path = null
      a.pathTarget = null
      this._shiftTrapKnowledge(a.knowledge?.traps, dx, dy)
    }
    // Knowledge buckets that store trap coords as copies. Without the
    // shift, returning-veteran briefings would point at the OLD coords
    // and the pathfinder's room-trap avoidance would mis-identify which
    // room the trap is in.
    this._shiftTrapKnowledge(this.gameState.knowledge?.sharedPool?.traps, dx, dy)
    for (const s of this.gameState.knowledge?.survivors ?? []) {
      this._shiftTrapKnowledge(s?.knowledge?.traps, dx, dy)
    }
  }

  // Shift the tileX/tileY (and any dangerTiles[].x/y) on every entry in a
  // trap-knowledge bucket. Bucket shape is { [trapId]: { tileX, tileY,
  // dangerTiles?: [{x,y}], ... } } — same on sharedPool, on each
  // survivor's snapshot, and on each live adv's in-progress knowledge.
  _shiftTrapKnowledge(traps, dx, dy) {
    if (!traps) return
    for (const t of Object.values(traps)) {
      if (!t) continue
      if (typeof t.tileX === 'number') { t.tileX += dx; t.tileY += dy }
      if (Array.isArray(t.dangerTiles)) {
        for (const d of t.dangerTiles) {
          if (typeof d?.x === 'number') { d.x += dx; d.y += dy }
        }
      }
    }
  }

  // BOSS_LEVEL_CHANGED — only handles the DOWN case (Demon's Wager loss).
  // Boss stat decrement is already applied by EventSystem._resolveDemonsWager
  // when the wager resolves. This handler rescales every live minion to
  // the new (lower) level so their HP/ATK shrink in lockstep. The grid
  // is deliberately NOT shrunk (would orphan placed rooms). The up-path
  // is owned by _onBossLeveledUp above — skipping positive deltas here
  // avoids double-rescaling.
  _onBossLevelChanged({ delta, newLevel } = {}) {
    if (!(delta < 0)) return
    for (const m of this.gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      const oldLv  = m.bossLevel ?? 1
      if (oldLv <= newLevel) continue
      const oldHpM  = 1 + Balance.MINION_HP_PER_BOSS_LV  * (oldLv    - 1)
      const newHpM  = 1 + Balance.MINION_HP_PER_BOSS_LV  * (newLevel - 1)
      const oldAtkM = 1 + Balance.MINION_ATK_PER_BOSS_LV * (oldLv    - 1)
      const newAtkM = 1 + Balance.MINION_ATK_PER_BOSS_LV * (newLevel - 1)
      const hpFrac  = m.resources.maxHp > 0 ? m.resources.hp / m.resources.maxHp : 1
      m.resources.maxHp = Math.max(1, Math.round(m.resources.maxHp * (newHpM / oldHpM)))
      m.resources.hp    = Math.max(1, Math.round(m.resources.maxHp * hpFrac))
      m.stats.attack    = Math.max(1, Math.round(m.stats.attack    * (newAtkM / oldAtkM)))
      m.bossLevel       = newLevel
    }
  }

  _setupCamera() {
    this._cam = this.cameras.main
    this._cam.setBackgroundColor(0x050a12)

    // Place the camera so the boss chamber sits at the play-area centre
    // (between the HUD panels), then let _clampCameraToPlayArea finalise
    // bounds in update(). Centring on play area instead of canvas means
    // the boss room isn't shifted off behind the build panel at startup.
    const boss = this.gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
    const bossX = boss ? (boss.gridX + boss.width  / 2) * TS : 0
    const bossY = boss ? (boss.gridY + boss.height / 2) * TS : 0

    const startZoom = Math.max(Balance.CAMERA_ZOOM_DEFAULT, this._computeMinZoom())
    this._cam.setZoom(startZoom)

    const pa = this._computePlayArea()
    const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
    const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
    this._cam.scrollX = bossX - this._cam.centerX - (playCx - this._cam.centerX) / startZoom
    this._cam.scrollY = bossY - this._cam.centerY - (playCy - this._cam.centerY) / startZoom
    this._clampCameraToPlayArea()
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _isCorridorMode() {
    const np = this.scene.get('NightPhase')
    return np && this.scene.isActive('NightPhase') && np._paletteTab === 'corridors'
  }

  _setupInput() {
    // (Browser context menu suppressed game-wide in main.js.)
    this.input.on('pointerdown', (p) => {
      if (this._duelCamLock) return   // Solo Leveling duel — world input frozen
      if (p.middleButtonDown() || (p.rightButtonDown() && !this._isCorridorMode())) {
        this._dragOrigin = { x: p.x + this._cam.scrollX, y: p.y + this._cam.scrollY }
        if (this._followId) this._setFollow(null)
        return
      }
      // Phase 9 — Pact of the Marionette: left-click a minion during day
      // phase to possess it (once per day).
      if (p.leftButtonDown() && this.gameState?.meta?.phase === 'day') {
        this._tryMarionettePossess(p)
      }
    })

    this.input.on('pointermove', (p) => {
      if (!this._dragOrigin) return
      if (!p.middleButtonDown() && !p.rightButtonDown()) {
        this._dragOrigin = null
        return
      }
      // If the player switched to corridor mode while right-dragging, release the pan.
      if (p.rightButtonDown() && !p.middleButtonDown() && this._isCorridorMode()) {
        this._dragOrigin = null
        return
      }
      this._cam.setScroll(
        this._dragOrigin.x - p.x,
        this._dragOrigin.y - p.y,
      )
    })

    this.input.on('pointerup', () => { this._dragOrigin = null })

    this.input.on('wheel', (pointer, _o, _dx, dy) => {
      if (this._duelCamLock) return   // Solo Leveling duel — zoom locked
      // Let HudScene's BuildMenu eat wheels that happen over the slot
      // grid — without this guard, the wheel both scrolls the menu AND
      // zooms the dungeon view at the same time. Bounds-check is
      // delegated to BuildMenu.containsPointer so the comparison runs in
      // the menu's design-space (HudScene camera transform applied),
      // independent of canvas size or camera zoom.
      const buildMenu = this.scene.get('HudScene')?._buildMenu
      if (buildMenu?.containsPointer?.(pointer)) return

      const oldZoom = this._cam.zoom
      const newZoom = Phaser.Math.Clamp(
        oldZoom - dy * 0.001,
        this._computeMinZoom(),
        Balance.CAMERA_ZOOM_MAX,
      )
      if (newZoom === oldZoom) return

      // Zoom-to-cursor: the world point currently under the cursor stays
      // pinned to the cursor after the zoom change.
      //  1. Capture the world point at the cursor before zooming.
      //  2. Apply the new zoom to the camera.
      //  3. Re-position scroll so that same world point is under the cursor
      //     again. Phaser cameras zoom around their midpoint (cam.centerX,
      //     cam.centerY) — not the top-left — so the inverse formula is:
      //         scrollX = worldX - centerX - (pointerX - centerX) / zoom
      //     This is the Phaser-correct equivalent of the simple
      //     "scrollX = worldX - pointerX / zoom" formula that works only
      //     for top-left-anchored zoom.
      const worldPoint = this._cam.getWorldPoint(pointer.x, pointer.y)
      const cx = this._cam.centerX
      const cy = this._cam.centerY

      this._cam.setZoom(newZoom)

      this._cam.scrollX = worldPoint.x - cx - (pointer.x - cx) / newZoom
      this._cam.scrollY = worldPoint.y - cy - (pointer.y - cy) / newZoom
      this._clampCameraToPlayArea()
    })

    // WASD camera scroll. Pass `enableCapture=false` so Phaser doesn't
    // preventDefault the keystrokes globally — without this, any DOM
    // input on top of the Game scene (rename-minion box in Roster /
    // MinionInspector, name-change overlay, settings inputs) silently
    // loses 'a' / 's' / 'd' / 'w' the player types into it. Phaser
    // still updates the Key objects' .isDown state from the same
    // keystroke; the per-frame camera-scroll read just doesn't lock
    // out the browser's default text-input behaviour.
    this._keys = this.input.keyboard.addKeys('W,A,S,D', false)

    // ESC opens the pause menu. Wired here as a fallback for when neither
    // NightPhase nor DayPhase has keyboard focus (e.g. during the
    // BossFightOverlay cinematic, which lives inside this scene).
    this.input.keyboard.on('keydown-ESC', () => {
      // Defer to NightPhase first if it has anything armed — selected
      // item, tool mode, crucible, or a pending trade-off all want ESC
      // to cancel them, not open pause.
      const np = this.scene.get('NightPhase')
      if (np && np.scene?.isActive?.() &&
          (np._pendingTradeOff || np._selected || np._toolMode || np._crucibleMode)) {
        return
      }
      PauseManager.toggle(this)
    })
  }

  // Phase 9 — Marionette possession. Two entry points feed into
  // _possessMinion: the scene-level pointerdown (tile-find, catches
  // clicks on tiles a sprite doesn't cover) and the MINION_CLICKED
  // EventBus subscription (direct ref, bypasses the sprite's
  // stopPropagation that blocks the scene handler).
  _tryMarionettePossess(pointer) {
    const flags = this.gameState?._mechanicFlags ?? {}
    if (!flags.pactOfTheMarionette) return
    if (flags.marionetteUsedToday) return
    if (flags.possessedMinionId) return    // already possessing
    const wp = this._cam.getWorldPoint(pointer.x, pointer.y)
    const tx = Math.floor(wp.x / Balance.TILE_SIZE)
    const ty = Math.floor(wp.y / Balance.TILE_SIZE)
    const minion = (this.gameState.minions ?? []).find(m =>
      m.faction === 'dungeon' && m.aiState !== 'dead' &&
      m.tileX === tx && m.tileY === ty
    )
    this._possessMinion(minion)
  }

  // Sprite-level pointerdown in MinionRenderer calls stopPropagation,
  // so the scene-level _tryMarionettePossess never fires for clicks
  // that land on a minion's sprite (the dominant case). This subscriber
  // covers that gap — same gating, same possession step.
  _onMinionClickedForMarionette({ minion, pointer } = {}) {
    if (!minion) return
    if (this.gameState?.meta?.phase !== 'day') return
    if (pointer?.rightButtonDown?.()) return   // right-click reserved for other UI flows
    const flags = this.gameState?._mechanicFlags ?? {}
    if (!flags.pactOfTheMarionette) return
    if (flags.marionetteUsedToday) return
    if (flags.possessedMinionId) return
    if (minion.faction !== 'dungeon' || minion.aiState === 'dead') return
    this._possessMinion(minion)
  }

  // Shared possession step. Called from both _tryMarionettePossess
  // (scene pointerdown) and _onMinionClickedForMarionette (sprite click).
  _possessMinion(minion) {
    if (!minion) return
    const flags = this.gameState._mechanicFlags ?? (this.gameState._mechanicFlags = {})
    if (flags.possessedMinionId) return
    flags.possessedMinionId  = minion.instanceId
    flags.marionetteUsedToday = true
    minion._marionetteLastStepAt = 0
    EventBus.emit('MARIONETTE_POSSESSED', { minionId: minion.instanceId })
  }

  // Per-frame: move the possessed minion via WASD (debounced) + auto-attack
  // any adv in melee range. Camera follows the puppet.
  _tickMarionette(time, _delta) {
    const flags = this.gameState._mechanicFlags ?? {}
    const minion = (this.gameState.minions ?? []).find(m => m.instanceId === flags.possessedMinionId)
    if (!minion || minion.aiState === 'dead') {
      flags.possessedMinionId = null
      return
    }
    const now = time
    const interval = Balance.MECHANIC_MARIONETTE_MOVE_INTERVAL_MS
    const ready = (now - (minion._marionetteLastStepAt ?? 0)) >= interval
    let dx = 0, dy = 0
    if (this._keys.W.isDown) dy -= 1
    if (this._keys.S.isDown) dy += 1
    if (this._keys.A.isDown) dx -= 1
    if (this._keys.D.isDown) dx += 1
    if (ready && (dx !== 0 || dy !== 0)) {
      const nx = minion.tileX + dx
      const ny = minion.tileY + dy
      const grid = this.dungeonGrid
      const tile = grid?.getTileType?.(nx, ny)
      if (tile === TILE.FLOOR || tile === TILE.BOSS_FLOOR || tile === TILE.DOOR) {
        minion.tileX  = nx
        minion.tileY  = ny
        minion.worldX = nx * Balance.TILE_SIZE + Balance.TILE_SIZE / 2
        minion.worldY = ny * Balance.TILE_SIZE + Balance.TILE_SIZE / 2
        minion._marionetteLastStepAt = now
      }
    }
    // Auto-attack any adv in melee range.
    const advs = this.gameState.adventurers?.active ?? []
    for (const adv of advs) {
      if (adv.aiState === 'dead' || adv.resources.hp <= 0) continue
      const d = Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY)
      const reach = Math.max(minion.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
      if (d <= reach + 0.01) {
        this.combatSystem?.tryAttack?.(minion, adv, {
          roomId: this.dungeonGrid?.getRoomAtTile?.(minion.tileX, minion.tileY)?.instanceId,
          method: 'marionette',
        })
        break
      }
    }
    // Camera follows the puppet.
    const cx = minion.worldX - this._cam.centerX
    const cy = minion.worldY - this._cam.centerY
    this._cam.scrollX += (cx - this._cam.scrollX) * 0.1
    this._cam.scrollY += (cy - this._cam.scrollY) * 0.1
  }

  update(_time, delta) {
    // Mango cheat — refill gold floor every tick so spends instantly
    // restore. Cheap (one int compare + maybe one assignment per
    // frame), gated by the cheat flag so non-mango runs pay nothing.
    if (this._isMangoCheat) {
      const p = this.gameState?.player
      if (p && (p.gold ?? 0) < Game.MANGO_GOLD_FLOOR) p.gold = Game.MANGO_GOLD_FLOOR
    }

    // Capture the world point currently at the PLAY-AREA centre (the gap
    // between the HUD panels) so _onSceneResize can re-anchor on it after a
    // viewport change. The camera FRAMES on the play-area centre, not the
    // canvas centre — so this capture is the exact inverse of the scroll
    // formula in _reanchorCamera. Capturing the canvas-centre midPoint
    // instead made every re-anchor shift the view by the canvas-vs-play-
    // area offset, which surfaced as the dungeon nudging on each tab
    // refocus. Skipped on a degenerate 0×0 frame so a mid-relayout
    // transient can't overwrite the last good value with garbage.
    if (this.scale.width >= 2 && this.scale.height >= 2) {
      const pa = this._computePlayArea()
      const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
      const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
      const cx = this._cam.centerX, cy = this._cam.centerY, z = this._cam.zoom
      this._camWorldCX = this._cam.scrollX + cx + (playCx - cx) / z
      this._camWorldCY = this._cam.scrollY + cy + (playCy - cy) / z
    }

    const speed = Balance.CAMERA_SCROLL_SPEED / this._cam.zoom

    // WASD breaks follow mode then moves camera manually
    const anyWASD = this._keys.W.isDown || this._keys.S.isDown ||
                    this._keys.A.isDown || this._keys.D.isDown
    if (anyWASD && this._followId) this._setFollow(null)

    // Phase 9 — Marionette: WASD drives the possessed minion instead of camera.
    const possessedId = this.gameState?._mechanicFlags?.possessedMinionId
    if (possessedId) {
      this._tickMarionette(_time, delta)
    } else if (!this._duelCamLock) {
      if (this._keys.W.isDown) this._cam.scrollY -= speed
      if (this._keys.S.isDown) this._cam.scrollY += speed
      if (this._keys.A.isDown) this._cam.scrollX -= speed
      if (this._keys.D.isDown) this._cam.scrollX += speed
    }

    // Smooth camera follow (day phase only). Suspended while the boss-
    // fight cinematic tween owns the camera so the follow lerp doesn't
    // drag scroll back toward the lead adventurer mid-zoom.
    if (this._followId && this.gameState.meta.phase === 'day' && !this._fightCamActive && !this._duelCamLock) {
      const adv = this.gameState.adventurers.active.find(a => a.instanceId === this._followId)
      if (adv) {
        const tx = adv.worldX - this._cam.centerX
        const ty = adv.worldY - this._cam.centerY
        this._cam.scrollX += (tx - this._cam.scrollX) * 0.08
        this._cam.scrollY += (ty - this._cam.scrollY) * 0.08
      } else {
        this._setFollow(null)
      }
    }

    // After all camera-mutating logic above, clamp the scroll against the
    // play area (between HUD panels) — keeps the dungeon edges aligned
    // with the play area edges, and centres the dungeon when it fits
    // entirely inside the play area on a given axis. Suspended while
    // the boss-fight cinematic tween is running so it can place the
    // camera on the boss room without the clamp pulling it back to a
    // fitted-centre position each frame.
    if (!this._fightCamActive && !this._duelCamLock) this._clampCameraToPlayArea()

    // Door open/close animations always tick at real time — the visual
    // shouldn't depend on time scale (and the entry-hall door auto-opens at
    // night→day transition where time scale isn't yet applied).
    this._dungeonRenderer?.update(delta)

    // Phase 1b.4 — Lich Phylactery damage tick. Always runs (real time so
    // hunters keep biting through pause-fast-slow). Gated internally by
    // archetype + phylactery presence.
    this.bossArchetypeSystem?.tick?.(delta)

    if (this.gameState.meta.phase === 'day') {
      const ts = this._getDayTimeScale()
      if (ts > 0) {
        // Cap real delta before scaling so a browser frame hitch
        // (tab refocus, GC pause, alt-tab return — anything that
        // makes Phaser report a huge `delta`) doesn't multiply into
        // a massive scaled tick.
        const realCapped = Math.min(delta, 50)
        const totalScaled = realCapped * ts

        // ── Fixed sub-stepping ──────────────────────────────────────
        // The simulation systems (movement, boss-fight combat, AI
        // pathing) are written for ~16ms ticks. Handing them one
        // coarse tick at high speed broke them: at 8× a single frame
        // is realCapped(50) × 8 = 400ms. A 400ms tick makes
        // adventurers teleport whole tiles past path waypoints, the
        // boss-fight round timer (0.6s/round) and movement overshoot
        // the room clamp, and the fight state machine wedge so the
        // encounter never resolves — the "freezes during fights at
        // 8×" report. Splitting the scaled time into sub-steps of at
        // most MAX_STEP ms makes every system run exactly as it does
        // at 1×, just more times per frame. steps is bounded (≤10 at
        // 8×) because realCapped caps the input, so this can never
        // itself run away.
        const MAX_STEP = 40
        const steps  = Math.max(1, Math.ceil(totalScaled / MAX_STEP))
        const stepDt = totalScaled / steps

        // ── Wall-clock budget breaker ───────────────────────────────
        // Sub-stepping multiplies per-frame simulation cost by `steps`
        // (≤10 at 8×). On a heavy wave — a guild-raid event spawns
        // DOUBLE the adventurers, so a boss fight can hold 12-16
        // combatants plus minions — 10× that cost can blow past the
        // frame budget and the tab appears frozen. This guard caps the
        // REAL time spent simulating per frame: once over budget we
        // stop sub-stepping and let the frame render. The game then
        // visibly runs slower than the chosen multiplier instead of
        // hard-freezing — graceful degradation. The check is AFTER each
        // sub-step so at least one always runs (the sim never stalls
        // completely), and `performance.now()` is monotonic so this
        // can never itself hang.
        const STEP_BUDGET_MS = 50
        const budgetStart = (typeof performance !== 'undefined' ? performance.now() : Date.now())
        // Per-system crash guard. An UNCAUGHT exception thrown inside a
        // system's update() propagates out of Game.update, out of the
        // Phaser scene step, and kills the requestAnimationFrame loop
        // dead — the entire game hard-freezes on the spot ("freezes
        // instantly"). EventBus already isolates event listeners this
        // way; the per-frame system ticks were the one unprotected
        // path. Each system is wrapped independently so a throw in one
        // (e.g. a boss-fight edge case on the second fight) can't
        // starve the others — adventurers keep moving, the game stays
        // responsive, and the real error + stack trace lands in the
        // console instead of a silent freeze. A boss fight that throws
        // every tick still self-terminates via BossSystem's 30s
        // _fightT hard cap (that timer advances before the throw).
        // Per-system perf instrumentation. PerfHud (Ctrl+Shift+P) reads
        // window.__perfStats to show per-system ms/sec budgets so we
        // can see exactly which system is eating the frame at high
        // entity counts. Zero-cost when the HUD isn't watching — just
        // two perf.now() calls per wrapped tick. Buckets are
        // accumulated, then drained by PerfHud on a 1Hz timer.
        if (!window.__perfStats) window.__perfStats = {}
        const _stats = window.__perfStats
        const tick = (sys, fn) => {
          const t0 = performance.now()
          try { fn() }
          catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[Game.update] ${sys}.update() threw — caught to keep the game loop alive:`, err)
          }
          _stats[sys] = (_stats[sys] ?? 0) + (performance.now() - t0)
        }
        // AI half-rate throttle — fires at EVERY speed, not just 1×.
        //
        // Originally gated to 1× to protect sub-step precision at high
        // speeds. PerfHud data at day-50 mango run (speed:8x, advs:55,
        // minions:110) proved that gating was the wrong call: at 8×
        // the sub-step loop runs AI 10×/frame across 165 entities,
        // burning the entire CPU budget and dropping to 12fps. The
        // user can't perceive 40ms vs 80ms tick precision at 12fps
        // anyway — the simulation is already updating in 80ms+ visible
        // hops.
        //
        // Per-sub-step parity (not per-frame) so the throttle does
        // useful work at high speeds where one frame contains many
        // sub-steps. At 1×: 1 sub-step/frame → AI ticks every other
        // frame (30Hz, same as before). At 8×: 10 sub-steps/frame →
        // AI ticks 5×/frame (every other sub-step). Each AI tick uses
        // 2× delta so total game-time covered is identical.
        if (!window.__perfCounts) window.__perfCounts = {}
        window.__perfCounts.gameUpdates = (window.__perfCounts.gameUpdates ?? 0) + 1
        window.__perfCounts.timeScale = ts
        window.__perfCounts.advCount = (this.gameState?.adventurers?.active?.length ?? 0)
        window.__perfCounts.minionCount = (this.gameState?.minions ?? []).filter(m => m?.aiState !== 'dead').length

        for (let i = 0; i < steps; i++) {
          this._aiSubstepCounter = ((this._aiSubstepCounter ?? 0) + 1) % 3
          const _skipAi = this._aiSubstepCounter !== 0
          // Boss fight runs at the same scaled rate as all other
          // day-phase systems so x2/x4/x8 speed applies during the
          // boss encounter.
          tick('bossSystem',            () => this.bossSystem?.update(stepDt))
          if (!_skipAi) {
            // 1-in-3 throttle (20Hz at 1×, ~3 ticks/frame at 8×).
            // Bumped from 1-in-2 after PerfHud showed aiSystem still
            // dominant at 359ms/s post-half-rate. 3× delta keeps total
            // game-time per real second identical.
            tick('aiSystem',            () => this.aiSystem?.update(stepDt * 3))
            tick('minionAiSystem',      () => this.minionAiSystem?.update(stepDt * 3))
            tick('lightPartyAi',        () => this.lightPartyAi?.update(stepDt * 3))
            window.__perfCounts.aiTicks = (window.__perfCounts.aiTicks ?? 0) + 1
          }
          tick('trapSystem',            () => this.trapSystem?.update(stepDt))
          tick('dungeonMechanicSystem', () => this.dungeonMechanicSystem?.tickDay(stepDt))
          tick('classAbilitySystem',    () => this.classAbilitySystem?.update(stepDt))
          const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now())
          if (nowMs - budgetStart > STEP_BUDGET_MS) break
        }
      }
      // Renderer-tick instrumentation. Same shape as the simulation
      // wrappers above — accumulates into window.__perfStats for
      // PerfHud to read. Renderers run once per frame (no sub-stepping).
      if (!window.__perfStats) window.__perfStats = {}
      const _rstats = window.__perfStats
      const rtick = (sys, fn) => {
        const t0 = performance.now()
        try { fn() } catch (err) { console.error(`[Game.update] ${sys} threw:`, err) }
        _rstats[sys] = (_rstats[sys] ?? 0) + (performance.now() - t0)
      }
      rtick('adventurerRenderer',  () => this.adventurerRenderer?.update())
      rtick('lightPartyRenderer',  () => this.lightPartyRenderer?.update())
      rtick('emoteSystem',         () => this.emoteSystem?.update())
      rtick('minionRenderer',      () => this.minionRenderer?.update())
      rtick('bossRenderer',        () => this.bossRenderer?.update())
      rtick('succubusBatRenderer', () => this.succubusBatRenderer?.update())
      rtick('trapRenderer',        () => this.trapRenderer?.update())
      rtick('lootPileRenderer',    () => this.lootPileRenderer?.update())
      rtick('keyChestRenderer',    () => this.keyChestRenderer?.update())
      rtick('lockRenderer',        () => this.lockRenderer?.update())
      rtick('beaconRenderer',      () => this.beaconRenderer?.update())
      rtick('fountainRenderer',    () => this.fountainRenderer?.update())
      rtick('treasureChestRenderer', () => this.treasureChestRenderer?.update())
      rtick('phylacteryRenderer',  () => this.phylacteryRenderer?.update())
      rtick('fungalCorpseRenderer', () => this.fungalCorpseRenderer?.update())
      rtick('torchRenderer',       () => this.torchRenderer?.update())
      rtick('cobwebRenderer',      () => this.cobwebRenderer?.update())
      rtick('decorRenderer',       () => this.decorRenderer?.update())
      rtick('bloodSplatRenderer',  () => this.bloodSplatRenderer?.update())
      rtick('chatBubbles',         () => this.chatBubbles?.update())
      rtick('replayGhostRenderer', () => this.replayGhostRenderer?.update())
      rtick('cartographerOverlay', () => this.cartographerOverlay?.tick())
    } else {
      // Boss wanders its room during night at real time (cosmetic only).
      this.bossSystem?.update(delta)
      this.minionRenderer?.update()
      this.bossRenderer?.update()
      this.trapRenderer?.update()
      this.lootPileRenderer?.update()
      this.keyChestRenderer?.update()
      this.lockRenderer?.update()
      this.beaconRenderer?.update()
      this.fountainRenderer?.update()
      this.treasureChestRenderer?.update()
      this.phylacteryRenderer?.update()
      this.fungalCorpseRenderer?.update()
      this.torchRenderer?.update()
      this.cobwebRenderer?.update()
      this.decorRenderer?.update()
      this.bloodSplatRenderer?.update()
      this.replayGhostRenderer?.update()
    }
    // Knowledge overlay updates in both phases — the rumour pool persists
    // across days, so the player can review what the next adventurers will
    // already know while building at night.
    this.knowledgeOverlay?.update()

    // MiniMap update runs on its own scene now (HudScene).
  }

  _getDayTimeScale() {
    const day = this.scene.get('DayPhase')
    if (!day || !this.scene.isActive('DayPhase')) return 0
    return day._timeScale ?? 1
  }
}
