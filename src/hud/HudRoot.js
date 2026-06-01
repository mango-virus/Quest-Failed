// HudRoot — owns the DOM HUD layer that sits over the Phaser canvas.
//
// One instance per game lifetime. Booted from HudScene.create() when the
// new-hud feature flag is on. The Phaser HUD stays the source of truth
// for unported panels; this layer renders the panels we've ported and
// stays out of the way (pointer-events: none) where it has no content.
//
// Coordinate system: a fixed 1920×1080 logical stage is transform-scaled
// to fit the viewport (matches the design source's fit()). The stage
// doesn't need to align with Phaser world coords — the Phaser canvas
// shows through wherever this layer leaves empty.

import { h, mount } from './dom.js'
import { ensureStageScaled, DESIGN_W, DESIGN_H } from './stageScale.js'
import { TopBar }      from './TopBar.js'
import { BottomBar }   from './BottomBar.js'
import { LeftPanels }  from './LeftPanels.js'
import { RightPanels } from './RightPanels.js'
import { ToastQueue }          from './ToastQueue.js'
import { PauseOverlay }        from './PauseOverlay.js'
import { ConfirmPopup }        from './ConfirmPopup.js'
import { ReviveChoicePopup }   from './ReviveChoicePopup.js'
import { RosterOverlay }       from './RosterOverlay.js'
import { BossOverviewOverlay } from './BossOverviewOverlay.js'
import { PactDetailPopup }     from './PactDetailPopup.js'
import { AdvIntelOverlay }      from './AdvIntelOverlay.js'
import { KnowledgeMapOverlay }  from './KnowledgeMapOverlay.js'
import { WelcomeIntroOverlay }  from './WelcomeIntroOverlay.js'
import { TutorialOverlay }      from './TutorialOverlay.js'
import { LongGameOverlay }      from './LongGameOverlay.js'
import { BossLevelUpOverlay }   from './BossLevelUpOverlay.js'
import { HotkeyHints }          from './HotkeyHints.js'
import { InspectPopup }         from './InspectPopup.js'
import { PhaseTransition }      from './PhaseTransition.js'
import { PostWaveOverlay }      from './PostWaveOverlay.js'
import { GameOverOverlay }      from './GameOverOverlay.js'
import { PactPicker }           from './PactPicker.js'
import { TinkererPicker }       from './TinkererPicker.js'
import { DevEventsButton }      from './DevEventsButton.js'
import { DevKingdomButton }     from './DevKingdomButton.js'
import { AltarRewardSlot }      from './AltarRewardSlot.js'
import { DungeonFx }            from './DungeonFx.js'
import { EventFx }              from './EventFx.js'
import { BossFightOverlay }     from './BossFightOverlay.js'
import { EventBanner }          from './EventBanner.js'
import { ActIntro }             from './ActIntro.js'
import { NemesisPortrait }      from './NemesisPortrait.js'
import { VictoryScreen }        from './VictoryScreen.js'
import { KingdomResponseIntro } from './KingdomResponseIntro.js'
import { isActsEnabled }        from '../config/acts.js'
import { CoinFlipCinematic }    from './CoinFlipCinematic.js'
import { SoloLevelingCinematic } from './SoloLevelingCinematic.js'
import { LightPartyCinematic }   from './LightPartyCinematic.js'
import { BossArchetypeStrip }   from './BossArchetypeStrip.js'
import { NpcCompanion }         from './NpcCompanion.js'
import { JamPortalCorner }      from './JamPortalCorner.js'
import { installHudSfxDelegates } from './HudSfx.js'
import { EventBus }             from '../systems/EventBus.js'

export class HudRoot {
  constructor(gameState) {
    this._gameState = gameState
    this._panels    = []
    this._root      = document.getElementById('hud-root')
    this._stage     = document.getElementById('hud-stage')
    if (!this._root || !this._stage) {
      // Stage scaffolding missing — index.html wasn't updated. Bail gracefully.
      // eslint-disable-next-line no-console
      console.warn('[HudRoot] #hud-root or #hud-stage missing from index.html')
      return
    }
    this._mountPanels()
    // Shared stage scaler — installs its own resize listener once.
    ensureStageScaled()
    // Apply saved video-flag classes (scanlines / vignettes / etc.) on
    // initial mount so the player gets their persisted toggles without
    // having to open Settings first. SettingsOverlay's own constructor
    // re-applies these on open, so the two paths agree.
    this._applyInitialVideoClasses()
    this._root.hidden = false
  }

  _applyInitialVideoClasses() {
    try {
      const r = this._root
      const get = (key, def) => {
        const raw = localStorage.getItem(key)
        if (raw == null) return def
        return raw === 'true'
      }
      r.classList.toggle('scanlines',         get('qf.video.scanlines',       true))
      r.classList.toggle('crt-vignette',      get('qf.video.vignette',        true))
      r.classList.toggle('dungeon-vignette',  get('qf.video.dungeonVignette', true))
    } catch {}
  }

  _mountPanels() {
    this._topBar      = new TopBar(this._gameState)
    this._bottomBar   = new BottomBar(this._gameState)
    this._leftPanels  = new LeftPanels(this._gameState)
    this._rightPanels = new RightPanels(this._gameState)
    this._toastQueue  = new ToastQueue()
    // Companion NPC (Lilith or Malakor — per gameState.meta.companionId)
    // peeks into the lower-left of the dungeon view. Pure renderer;
    // NpcDirector (a Game-scene system) drives it.
    this._npc         = new NpcCompanion(this._gameState)
    // Small spinning jam portal pinned to the bottom-right corner of the
    // play area — same asset + click route as the main-menu jam portal.
    this._jamPortal   = new JamPortalCorner()
    // HotkeyHints strip removed at user request — the bottom-bar
    // buttons (PLACE/MOVE/SELL, speed, etc.) make the hint redundant.
    // The HotkeyHints class file stays in the repo per the project's
    // removal-not-deletion policy; just isn't mounted.
    this._panels.push(
      this._topBar, this._bottomBar,
      this._leftPanels, this._rightPanels, this._toastQueue,
      this._npc,
      this._jamPortal,
    )
    // Event-driven overlays — no DOM until they open. Register separately
    // so they don't take up slots in the panels list.
    this._pauseOverlay   = new PauseOverlay(this._gameState)
    this._confirmPopup   = new ConfirmPopup()
    this._reviveChoicePop = new ReviveChoicePopup()
    this._rosterOverlay  = new RosterOverlay(this._gameState)
    this._bossOverlay    = new BossOverviewOverlay(this._gameState)
    this._pactDetailPop  = new PactDetailPopup()
    this._advIntelOverlay = new AdvIntelOverlay(this._gameState)
    this._knowMapOverlay  = new KnowledgeMapOverlay(this._gameState)
    this._tutorialOverlay = new TutorialOverlay()
    this._longGameOverlay = new LongGameOverlay()
    this._levelUpOverlay  = new BossLevelUpOverlay(this._gameState)
    this._welcomeIntro    = new WelcomeIntroOverlay(this._gameState)
    // Unified hover inspector for rooms, minions, adventurers, and
    // dropped loot. Supersedes the old RoomTooltip (two-tab, room-only)
    // and MinionInspectorOverlay (full-screen modal) — both files
    // remain in the repo, just no longer mounted.
    this._inspectPopup    = new InspectPopup(this._gameState)
    this._phaseTrans      = new PhaseTransition(this._gameState)
    this._postWaveOverlay = new PostWaveOverlay(this._gameState)
    this._gameOverOverlay = new GameOverOverlay(this._gameState)
    this._pactPicker      = new PactPicker(this._gameState)
    // Tinkerer's Workshop event — self-mounts on SHOW_TINKERER_OFFER
    // (lazy — its constructor doesn't append anything, so it's safe to
    // build BEFORE the mount() below).
    this._tinkererPicker  = new TinkererPicker()
    // Sacrificial Altar slot-reveal cinematic — self-mounts on
    // SACRIFICIAL_ALTAR_SPIN (also lazy, safe to build pre-mount).
    this._altarRewardSlot = new AltarRewardSlot()
    mount(this._stage, this._panels.map(p => p.el))
    // DungeonFx, BossFightOverlay, and EventBanner self-mount into
    // #hud-stage. Must be constructed AFTER the mount() above — that call
    // replaces all of #hud-stage's children, so anything that appends to
    // it during construction would otherwise be wiped out the moment
    // HudRoot finishes building.
    this._dungeonFx       = new DungeonFx(this._gameState)
    // Ambient event atmosphere (storm / fog / blood moon …). Self-mounts
    // into #hud-stage, so it must build after the mount() above.
    this._eventFx         = new EventFx(this._gameState)
    this._bossFightOverlay = new BossFightOverlay(this._gameState)
    this._eventBanner      = new EventBanner(this._gameState)
    // "The Kingdom's Reckoning" act-intro chapter card (KR P1). Gated behind the
    // `acts` flag (default off); listens for ACT_STARTED. Self-mounts into
    // #hud-stage, so it must build after the mount() above (like DungeonFx/EventFx).
    this._actIntro         = isActsEnabled() ? new ActIntro(this._gameState) : null
    // Aldric's right-side rival portrait (KR P2) — foil to the companion on the
    // left. Self-mounts into #hud-stage; gated behind the `acts` flag.
    this._nemesisPortrait  = isActsEnabled() ? new NemesisPortrait(this._gameState) : null
    // Victory screen (KR P2/P7 seed) — the visible payoff on RUN_VICTORY.
    this._victoryScreen    = isActsEnabled() ? new VictoryScreen(this._gameState) : null
    // "THE KINGDOM RESPONDS" reveal (KR P4) — the signature set-piece that opens
    // each drafted act (II & III) on KINGDOM_RESPONSE_DRAWN. Self-mounts into
    // #hud-stage; gated behind the `acts` flag.
    this._kingdomResponseIntro = isActsEnabled() ? new KingdomResponseIntro(this._gameState) : null
    // (The persistent act/modifier indicator now lives in the TopBar — an
    //  eyebrow above the day stamp — so it never overlaps the play area.)
    // Mango-only dev affordance — small floating button that force-fires
    // any dungeon event for testing. Self-gates on PlayerProfile.isCheatName()
    // so the button doesn't appear for real players. MUST construct
    // AFTER the mount() above — its constructor appends to #hud-stage
    // immediately, and mount() would otherwise wipe it (same reason
    // DungeonFx / EventFx are constructed down here).
    this._devEventsButton  = new DevEventsButton()
    // Mango-dev: force any Kingdom Response live for QA (self-gates on mango +
    // the `acts` flag). Sibling of the TEST EVENT button.
    this._devKingdomButton = new DevKingdomButton()
    // Full-screen coin-flip sequence for The Gambler's Coin event.
    this._coinFlip         = new CoinFlipCinematic()
    // Solo Leveling — Shadow Monarch entrance title card + shadow vignette.
    // Same post-mount() construction rule as the others (appends to
    // #hud-stage immediately).
    this._soloLeveling     = new SoloLevelingCinematic()
    // Light Party — FFXIV-flavored entrance card + persistent party panel
    // + LB gauge + boss-fight cinematic. Same self-mounting pattern as the
    // Solo Leveling cinematic; cheap no-op on every other day.
    this._lightParty       = new LightPartyCinematic()
    // Pass the BottomBar's archetype-slot ref so the strip mounts INSIDE
    // the bar rather than floating above it (which used to cover the
    // dungeon view during day phase).
    this._archetypeStrip   = new BossArchetypeStrip(this._gameState, {
      slot: this._bottomBar?.archetypeSlot ?? null,
    })
    // Delegated UI click/hover SFX. Idempotent — flips a data attr on the
    // stage so multiple HudRoot rebuilds (e.g. new-run after game-over)
    // don't stack listeners.
    installHudSfxDelegates()
    // Auto-fire welcome intro for new runs.
    this._welcomeIntro.maybeOpen()
    // Bridge Phaser canvas hover → DOM InspectPopup tooltip. Throttled
    // to ~30Hz and short-circuited when no Game scene is active.
    this._onPointerMove  = (e) => this._tryEntityHover(e)
    this._onPointerLeave = () => EventBus.emit('HIDE_INSPECT')
    const canvas = window.__game?.canvas
    canvas?.addEventListener('pointermove',  this._onPointerMove)
    canvas?.addEventListener('pointerleave', this._onPointerLeave)
    // Mirror the Phaser HudScene contract: incoming-wave preview only
    // shows during night phase. LeftPanels (mini-map + construction
    // grid) stays visible during day too — the player wanted to keep
    // the knowledge minimap + construction view live so they can
    // inspect / review even when placement is gated to night.
    const syncPhaseVisibility = () => {
      const isNight = this._gameState.meta?.phase !== 'day'
      this._rightPanels?.setWaveVisible?.(isNight)
    }
    syncPhaseVisibility()
    EventBus.on('NIGHT_PHASE_BEGAN', syncPhaseVisibility)
    EventBus.on('DAY_PHASE_BEGAN',   syncPhaseVisibility)
    this._phaseListeners = [
      ['NIGHT_PHASE_BEGAN', syncPhaseVisibility],
      ['DAY_PHASE_BEGAN',   syncPhaseVisibility],
    ]
  }

  // Phaser pointer-move → DOM InspectPopup hover. Hit-tests against
  // every inspectable dungeon entity. ~30Hz throttle to keep cheap.
  _tryEntityHover(e) {
    const now = performance.now()
    if (this._lastHoverAt && now - this._lastHoverAt < 33) return
    this._lastHoverAt = now
    const hit = this._pickAt(e)
    if (!hit) {
      if (this._lastHoverKey) {
        this._lastHoverKey = null
        EventBus.emit('HIDE_INSPECT')
      }
      return
    }
    this._lastHoverKey = hit.key
    EventBus.emit('SHOW_INSPECT', {
      kind: hit.kind, entity: hit.entity, defId: hit.defId,
      x: e.clientX, y: e.clientY,
    })
  }

  // Convert a canvas pointer event to world coords via the Game scene
  // camera, then hit-test. Returns { kind, entity, key } or null.
  _pickAt(e) {
    const game = window.__game
    if (!game) return null
    const gameScene = game.scene.getScene('Game')
    if (!gameScene || !gameScene.scene.isActive() || !gameScene.cameras?.main) return null
    const cam = gameScene.cameras.main
    const wx = cam.worldView.x + (e.offsetX / game.canvas.clientWidth)  * cam.worldView.width
    const wy = cam.worldView.y + (e.offsetY / game.canvas.clientHeight) * cam.worldView.height
    return this._pickEntity(wx, wy)
  }

  // Topmost-first hit-test: adventurers and minions sit above loot and
  // placed features (chests / traps / etc.), which sit above room
  // tiles. TS = 32 (Balance.TILE_SIZE) hardcoded to keep this module
  // dependency-free. Hit radius ~16px ≈ half a tile. Entries that carry
  // a `defId` resolve to a JSON definition for their description.
  _pickEntity(wx, wy) {
    const gs = this._gameState
    if (!gs) return null
    const TS = 32, R = 16
    const near = (ex, ey) => Math.hypot(wx - ex, wy - ey) <= R
    const d = gs.dungeon ?? {}
    const tx = Math.floor(wx / TS), ty = Math.floor(wy / TS)

    for (const a of (gs.adventurers?.active ?? [])) {
      if (a.aiState === 'dead' || a.worldX == null) continue
      if (near(a.worldX, a.worldY)) return { kind: 'adventurer', entity: a, key: `adventurer:${a.instanceId}` }
    }
    for (const m of (gs.minions ?? [])) {
      if (m.aiState === 'dead') continue
      const mx = m.worldX ?? (m.tileX * TS + TS / 2)
      const my = m.worldY ?? (m.tileY * TS + TS / 2)
      if (near(mx, my)) return { kind: 'minion', entity: m, key: `minion:${m.instanceId}` }
    }
    for (const p of (d.lootPiles ?? [])) {
      if (near(p.tileX * TS + TS / 2, p.tileY * TS + TS / 2)) {
        return { kind: 'item', entity: p, key: `item:${p.tileX},${p.tileY}` }
      }
    }
    // Placed traps (trapTypes.json is currently empty, so this is a
    // no-op until trap content ships — kept so hover Just Works then).
    for (const t of (d.traps ?? [])) {
      const ttx = t.worldX ?? ((t.tileX ?? 0) * TS + TS / 2)
      const tty = t.worldY ?? ((t.tileY ?? 0) * TS + TS / 2)
      if (near(ttx, tty)) {
        return { kind: 'trap', entity: t, defId: t.definitionId,
                 key: `trap:${t.instanceId ?? `${t.tileX},${t.tileY}`}` }
      }
    }
    // Placed construction items — each resolves to its items.json id so
    // InspectPopup can show the item's description.
    const placedItems = [
      ...(d.treasureChests ?? []).map(e => [e, `treasure_chest_${e.tier ?? 1}`]),
      ...(d.beacons   ?? []).map(e => [e, 'soul_bound_beacon']),
      ...(d.fountains  ?? []).map(e => [e, 'healing_fountain']),
      ...(d.keyChests  ?? []).map(e => [e, 'key_chest']),
    ]
    if (gs.phylactery && gs.phylactery.tileX != null) {
      placedItems.push([gs.phylactery, 'phylactery_heart'])
    }
    for (const [e, defId] of placedItems) {
      if (e.tileX == null) continue
      if (near(e.tileX * TS + TS / 2, e.tileY * TS + TS / 2)) {
        return { kind: 'placed', entity: e, defId,
                 key: `placed:${defId}:${e.tileX},${e.tileY}` }
      }
    }
    // Door locks own a set of door tiles rather than a single position.
    for (const lock of (d.locks ?? [])) {
      if ((lock.doorTiles ?? []).some(dt => dt.x === tx && dt.y === ty)) {
        return { kind: 'placed', entity: lock, defId: 'door_lock',
                 key: `placed:lock:${lock.id}` }
      }
    }

    for (const r of (gs.dungeon?.rooms ?? [])) {
      if (r.definitionId === 'boss_chamber') continue   // too large — skip
      if (tx >= r.gridX && tx < r.gridX + r.width &&
          ty >= r.gridY && ty < r.gridY + r.height) {
        return { kind: 'room', entity: r, key: `room:${r.instanceId}` }
      }
    }
    return null
  }

  destroy() {
    // stageScale module owns the resize listener now — it stays installed
    // across HudRoot teardowns since other overlays (MainMenu) may still
    // be using it.
    for (const [event, fn] of (this._phaseListeners || [])) EventBus.off(event, fn)
    this._phaseListeners = []
    this._pauseOverlay?.destroy();   this._pauseOverlay = null
    this._confirmPopup?.destroy();   this._confirmPopup = null
    this._reviveChoicePop?.destroy(); this._reviveChoicePop = null
    this._rosterOverlay?.destroy();  this._rosterOverlay = null
    this._bossOverlay?.destroy();    this._bossOverlay = null
    this._pactDetailPop?.destroy();  this._pactDetailPop = null
    this._advIntelOverlay?.destroy();this._advIntelOverlay = null
    this._knowMapOverlay?.destroy(); this._knowMapOverlay = null
    this._tutorialOverlay?.destroy();this._tutorialOverlay = null
    this._longGameOverlay?.destroy();this._longGameOverlay = null
    this._levelUpOverlay?.destroy(); this._levelUpOverlay = null
    this._welcomeIntro?.destroy();   this._welcomeIntro = null
    this._inspectPopup?.destroy();   this._inspectPopup = null
    this._phaseTrans?.destroy();     this._phaseTrans = null
    this._postWaveOverlay?.destroy();this._postWaveOverlay = null
    this._gameOverOverlay?.destroy();this._gameOverOverlay = null
    this._pactPicker?.destroy();     this._pactPicker = null
    this._tinkererPicker?.destroy(); this._tinkererPicker = null
    this._altarRewardSlot?.destroy(); this._altarRewardSlot = null
    this._devEventsButton?.destroy(); this._devEventsButton = null
    this._devKingdomButton?.destroy(); this._devKingdomButton = null
    this._dungeonFx?.destroy();      this._dungeonFx = null
    this._eventFx?.destroy();        this._eventFx = null
    this._bossFightOverlay?.destroy(); this._bossFightOverlay = null
    this._eventBanner?.destroy();    this._eventBanner = null
    this._actIntro?.destroy();       this._actIntro = null
    this._nemesisPortrait?.destroy(); this._nemesisPortrait = null
    this._victoryScreen?.destroy();   this._victoryScreen = null
    this._kingdomResponseIntro?.destroy(); this._kingdomResponseIntro = null
    this._coinFlip?.destroy();       this._coinFlip = null
    this._soloLeveling?.destroy();   this._soloLeveling = null
    this._archetypeStrip?.destroy();  this._archetypeStrip  = null
    const canvas = window.__game?.canvas
    if (this._onPointerMove)  canvas?.removeEventListener('pointermove',  this._onPointerMove)
    if (this._onPointerLeave) canvas?.removeEventListener('pointerleave', this._onPointerLeave)
    for (const p of this._panels) p.destroy?.()
    this._panels = []
    if (this._stage) mount(this._stage, null)
    if (this._root) this._root.hidden = true
  }
}

// Feature-flag check: the new DOM HUD is the default. The original Phaser
// chrome (BossTopBar / ActionBar / MiniMapPanel / BuildMenu / KnowledgePin
// / DungeonLog) still ships and can be re-enabled with `?newhud=0` (URL)
// or `localStorage.newhud = '0'`. Useful as a fallback while overlays
// (Phase 34C) are still being ported.
export function isNewHudEnabled() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('newhud') === '0') return false
    if (params.get('newhud') === '1') return true
    if (localStorage.getItem('newhud') === '0') return false
    return true
  } catch {
    return true
  }
}
