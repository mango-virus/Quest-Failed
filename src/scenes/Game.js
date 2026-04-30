import { SaveSystem }         from '../systems/SaveSystem.js'
import { EventBus }           from '../systems/EventBus.js'
import { DungeonGrid }        from '../systems/DungeonGrid.js'
import { AISystem }           from '../systems/AISystem.js'
import { PersonalitySystem }  from '../systems/PersonalitySystem.js'
import { CombatSystem }       from '../systems/CombatSystem.js'
import { MinionAISystem }     from '../systems/MinionAISystem.js'
import { TrapSystem }         from '../systems/TrapSystem.js'
import { LootSystem }         from '../systems/LootSystem.js'
import { EvolutionSystem }    from '../systems/EvolutionSystem.js'
import { AbilitySystem }      from '../systems/AbilitySystem.js'
import { ClassAbilitySystem } from '../systems/ClassAbilitySystem.js'
import { KnowledgeSystem }    from '../systems/KnowledgeSystem.js'
import { DungeonMechanicSystem } from '../systems/DungeonMechanicSystem.js'
import { NewspaperSystem }    from '../systems/NewspaperSystem.js'
import { InquisitorSystem }   from '../systems/InquisitorSystem.js'
import { LootGreedSystem }    from '../systems/LootGreedSystem.js'
import { BossSystem }         from '../systems/BossSystem.js'
import { ReputationSystem }   from '../systems/ReputationSystem.js'
import { RoomBehaviorSystem } from '../systems/RoomBehaviorSystem.js'
import { Balance }            from '../config/balance.js'
import { DungeonRenderer }    from '../ui/DungeonRenderer.js'
import { AdventurerRenderer } from '../ui/AdventurerRenderer.js'
import { MinionRenderer }     from '../ui/MinionRenderer.js'
import { TrapRenderer }       from '../ui/TrapRenderer.js'
import { LootRenderer }       from '../ui/LootRenderer.js'
import { MinionInspector }    from '../ui/MinionInspector.js'
import { ChatBubbles }        from '../ui/ChatBubbles.js'
import { KnowledgeOverlay }   from '../ui/KnowledgeOverlay.js'
import { WantedPoster }       from '../ui/WantedPoster.js'
import { ReplayGhostRenderer } from '../ui/ReplayGhostRenderer.js'
import { EternalNightOverlay } from '../ui/EternalNightOverlay.js'
import { ParanoiaIndicator }   from '../ui/ParanoiaIndicator.js'
import { BossFightOverlay }    from '../ui/BossFightOverlay.js'
import { BossRenderer }       from '../ui/BossRenderer.js'

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
    this.lootSystem          = null
    this.evolutionSystem     = null
    this.knowledgeSystem     = null
    this.adventurerRenderer  = null
    this.minionRenderer      = null
    this.trapRenderer        = null
    this.lootRenderer        = null
    this.minionInspector     = null
    this.knowledgeOverlay      = null
    this._dungeonRenderer    = null
    this._hudScene           = null
    this._cam                = null
    this._dragOrigin         = null
    this._keys               = null
    this._followId           = null
    this.bossRenderer        = null
  }

  init(data) {
    this.gameState = data?.gameState || SaveSystem.load()
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create() {
    this.dungeonGrid         = new DungeonGrid(this.gameState.dungeon)

    // Re-apply current room definitions to every placed room so tile grids are
    // always derived from the definition, not stale data baked by a previous
    // session or an old Room Builder edit. This fixes:
    //   • Rooms that were saved with all-void tiles (appear as thin strips or blank)
    //   • Boss chamber missing tile art after a Room Builder pass over it
    // Do this BEFORE creating DungeonRenderer so the first draw sees clean data.
    this._reapplyAllRoomDefs()

    this._dungeonRenderer    = new DungeonRenderer(this, this.gameState)
    this.personalitySystem   = new PersonalitySystem(this)
    this.personalitySystem.loadDefinitions()

    // Phase 6e: cache archetype modifiers on gameState for easy cross-system lookup
    this._cacheArchetypeModifiers()
    this.combatSystem        = new CombatSystem(this, this.gameState)
    this.knowledgeSystem     = new KnowledgeSystem(this, this.gameState, this.dungeonGrid)
    this.aiSystem            = new AISystem(this, this.gameState, this.dungeonGrid, this.personalitySystem, this.combatSystem, this.knowledgeSystem)
    this.minionAiSystem      = new MinionAISystem(this, this.gameState, this.dungeonGrid, this.combatSystem)
    this.trapSystem          = new TrapSystem(this, this.gameState, this.dungeonGrid)
    this.trapSystem.loadDefinitions()
    this.lootSystem          = new LootSystem(this, this.gameState, this.dungeonGrid)
    this.lootSystem.loadDefinitions()
    this.evolutionSystem     = new EvolutionSystem(this, this.gameState)
    this.evolutionSystem.loadDefinitions()
    this.dungeonMechanicSystem = new DungeonMechanicSystem(this, this.gameState)
    this.dungeonMechanicSystem.loadDefinitions()
    this.newspaperSystem     = new NewspaperSystem(this, this.gameState)
    this.inquisitorSystem    = new InquisitorSystem(this, this.gameState, this.dungeonMechanicSystem, this.personalitySystem)
    this.lootGreedSystem     = new LootGreedSystem(this, this.gameState, this.dungeonGrid, this.personalitySystem)
    this.reputationSystem    = new ReputationSystem(this, this.gameState)
    this.bossSystem          = new BossSystem(this, this.gameState)
    this.roomBehaviorSystem  = new RoomBehaviorSystem(this, this.gameState)
    this.classAbilitySystem  = new ClassAbilitySystem(this, this.gameState)
    this._evolutionSystem    = this.evolutionSystem  // alias for MinionInspector lookup
    this.adventurerRenderer  = new AdventurerRenderer(this, this.gameState)
    this.minionRenderer      = new MinionRenderer(this, this.gameState)
    this.trapRenderer        = new TrapRenderer(this, this.gameState)
    this.lootRenderer        = new LootRenderer(this, this.gameState)
    this.minionInspector     = new MinionInspector(this, this.gameState, this.lootSystem)
    this.chatBubbles         = new ChatBubbles(this, this.gameState)
    this.knowledgeOverlay      = new KnowledgeOverlay(this, this.gameState, this.knowledgeSystem)
    this.wantedPoster        = new WantedPoster(this, this.gameState)
    this.replayGhostRenderer = new ReplayGhostRenderer(this, this.gameState)
    this.eternalNightOverlay = new EternalNightOverlay(this, this.gameState, this.knowledgeSystem)
    // Re-evaluate eternal night enabled state now that the overlay exists.
    if (this.dungeonMechanicSystem.isActive('eternal_night')) {
      this.eternalNightOverlay.setEnabled(true)
    }
    this.paranoiaIndicator   = new ParanoiaIndicator(this, this.gameState)
    if (this.dungeonMechanicSystem.isActive('paranoia_protocol')) {
      this.paranoiaIndicator.setEnabled(true)
    }
    this.bossFightOverlay    = new BossFightOverlay(this, this.gameState)
    this.bossRenderer        = new BossRenderer(this, this.gameState)

    // Respawn dead minions when night starts (Phase 6 kernel)
    EventBus.on('NIGHT_PHASE_STARTED',  this._onNightStart,   this)
    // Phase 10: third boss defeat → game over
    EventBus.on('BOSS_DEFEATED_FINAL',  this._onBossFinal,    this)
    // Re-clamp zoom whenever the dungeon grid expands so min zoom tracks map size
    EventBus.on('GRID_EXPANDED',        this._onGridExpanded,  this)
    // Room Builder saved a room def — rewrite tile grids for all placed
    // instances so structural changes appear immediately without remove + re-place.
    EventBus.on('ROOM_DEF_SAVED',       this._onRoomDefSaved,   this)
    // Room Builder reset ALL rooms — reapply every placed room in one pass.
    EventBus.on('ROOMS_ALL_RESET',      this._onRoomsAllReset,  this)
    // Camera follow
    EventBus.on('ADVENTURER_CLICKED',   this._onAdvClicked,   this)
    EventBus.on('ADVENTURER_DIED',      this._onAdvRemoved,   this)
    EventBus.on('ADVENTURER_FLED',      this._onAdvRemoved,   this)
    EventBus.on('ADVENTURERS_SPAWNED',  this._onAdvsSpawned,  this)
    EventBus.on('DAY_PHASE_ENDED',      this._onDayEnded,     this)

    this._setupCamera()
    this._setupInput()

    // MiniMap lives on a dedicated HUD scene that doesn't share our world
    // camera's zoom/scroll. Launch it now and hand it the references it
    // needs to read camera state for the viewport indicator.
    this.scene.launch('HudScene', { gameScene: this, gameState: this.gameState })
    this._hudScene = this.scene.get('HudScene')

    this.scene.launch('NightPhase', { gameState: this.gameState })

    EventBus.emit('GAME_STATE_LOADED', this.gameState)
  }

  shutdown() {
    EventBus.off('NIGHT_PHASE_STARTED',  this._onNightStart,   this)
    EventBus.off('BOSS_DEFEATED_FINAL',  this._onBossFinal,    this)
    EventBus.off('GRID_EXPANDED',        this._onGridExpanded,  this)
    EventBus.off('ROOM_DEF_SAVED',       this._onRoomDefSaved,  this)
    EventBus.off('ROOMS_ALL_RESET',      this._onRoomsAllReset, this)
    EventBus.off('ADVENTURER_CLICKED',   this._onAdvClicked,   this)
    EventBus.off('ADVENTURER_DIED',      this._onAdvRemoved,   this)
    EventBus.off('ADVENTURER_FLED',      this._onAdvRemoved,   this)
    EventBus.off('ADVENTURERS_SPAWNED',  this._onAdvsSpawned,  this)
    EventBus.off('DAY_PHASE_ENDED',      this._onDayEnded,     this)
    this.scene.stop('HudScene')
    this._dungeonRenderer?.destroy()
    this.adventurerRenderer?.destroy()
    this.minionRenderer?.destroy()
    this.trapRenderer?.destroy()
    this.lootRenderer?.destroy()
    this.minionInspector?.destroy()
    this.chatBubbles?.destroy()
    this.aiSystem?.destroy()
    this.trapSystem?.destroy()
    this.lootSystem?.destroy()
    this.evolutionSystem?.destroy()
    this.classAbilitySystem?.destroy()
    this.knowledgeSystem?.destroy()
    this.knowledgeOverlay?.destroy()
    this.wantedPoster?.destroy()
    this.replayGhostRenderer?.destroy()
    this.eternalNightOverlay?.destroy()
    this.dungeonMechanicSystem?.destroy()
    this.newspaperSystem?.destroy()
    this.inquisitorSystem?.destroy()
    this.paranoiaIndicator?.destroy()
    this.lootGreedSystem?.destroy()
    this.bossSystem?.destroy()
    this.reputationSystem?.destroy()
    this.bossFightOverlay?.destroy()
    this.roomBehaviorSystem?.destroy()
    this.bossRenderer?.destroy()
  }

  _onBossFinal() {
    // Stop everything, transition to GameOver
    this.scene.stop('NightPhase')
    this.scene.stop('DayPhase')
    this.scene.stop('EndOfDay')
    this.scene.start('GameOver', { gameState: this.gameState })
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
      // Sync the room instance's connectionPoints with the updated def so
      // doorway positions stay accurate for neighbour lookups.
      room.connectionPoints = (def.connectionPoints ?? []).map(cp => ({ ...cp }))
      this.dungeonGrid.reapplyRoomDef(room, def)
    }
    this._dungeonRenderer?.redraw()
  }

  // Room Builder reset ALL rooms — reapply every placed room's tile grid
  // from the current (freshly-cleared) cache defs in a single pass, then
  // redraw once.
  _onRoomsAllReset() {
    this._reapplyAllRoomDefs()
    this._dungeonRenderer?.redraw()
  }

  // Reapply current room definitions to every placed room instance.
  // Shared by the on-load fix and the live ROOMS_ALL_RESET event handler.
  _reapplyAllRoomDefs() {
    const roomDefs = this.cache.json.get('rooms') ?? []
    const defMap   = Object.fromEntries(roomDefs.map(d => [d.id, d]))
    for (const room of this.gameState.dungeon.rooms) {
      const def = defMap[room.definitionId]
      if (!def) continue
      room.connectionPoints = (def.connectionPoints ?? []).map(cp => ({ ...cp }))
      this.dungeonGrid.reapplyRoomDef(room, def)
    }
  }

  _onNightStart() {
    this.minionAiSystem?.respawnAll()
    this.trapSystem?.resetAll()
  }

  // ── Camera follow ─────────────────────────────────────────────────────────

  _onAdvClicked({ adventurer }) {
    this._setFollow(adventurer.instanceId)
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

  _onDayEnded() {
    // Clear follow state silently — DayPhase UI is already tearing down.
    this._followId = null
  }

  _setFollow(id) {
    this._followId = id
    const name = id
      ? (this.gameState.adventurers.active.find(a => a.instanceId === id)?.name ?? null)
      : null
    EventBus.emit('CAMERA_FOLLOW_CHANGED', { id, name })
  }

  // Phase 6e: cache the chosen archetype's modifiers on gameState so other
  // systems (EvolutionSystem, NightPhase trap palette, AISystem essence award)
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
  _computeMinZoom() {
    const { gridWidth, gridHeight } = this.gameState.dungeon
    const mapPxW = gridWidth  * TS
    const mapPxH = gridHeight * TS
    return Math.min(this.scale.width / mapPxW, this.scale.height / mapPxH)
  }

  _onGridExpanded() {
    // After a grid expansion the minimum zoom decreases (bigger map → can zoom
    // out further). If the camera happens to be below the new minimum, clamp up.
    const minZoom = this._computeMinZoom()
    if (this._cam.zoom < minZoom) this._cam.setZoom(minZoom)
  }

  _setupCamera() {
    this._cam = this.cameras.main
    this._cam.setBackgroundColor(0x050a12)

    // Place the camera so the boss chamber is at the centre of the viewport.
    // Phaser cameras zoom around the camera centre, so the scroll formula is:
    //   scrollX = bossX - centerX  (for any zoom; canonical "centred" scroll)
    // After the camera is set up, getWorldPoint(centerX, centerY) returns boss.
    const boss = this.gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
    const bossX = boss ? (boss.gridX + boss.width  / 2) * TS : 0
    const bossY = boss ? (boss.gridY + boss.height / 2) * TS : 0

    const startZoom = Math.max(Balance.CAMERA_ZOOM_DEFAULT, this._computeMinZoom())
    this._cam.setZoom(startZoom)
    this._cam.scrollX = bossX - this._cam.centerX
    this._cam.scrollY = bossY - this._cam.centerY
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _isCorridorMode() {
    const np = this.scene.get('NightPhase')
    return np && this.scene.isActive('NightPhase') && np._paletteTab === 'corridors'
  }

  _setupInput() {
    // (Browser context menu suppressed game-wide in main.js.)
    this.input.on('pointerdown', (p) => {
      if (p.middleButtonDown() || (p.rightButtonDown() && !this._isCorridorMode())) {
        this._dragOrigin = { x: p.x + this._cam.scrollX, y: p.y + this._cam.scrollY }
        if (this._followId) this._setFollow(null)
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
      // Let NightPhase's palette eat wheels that happen over its left panel.
      if (this.scene.isActive('NightPhase') && pointer.x <= 230) return

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
    })

    this._keys = this.input.keyboard.addKeys('W,A,S,D')

    // Phase 5b — Ctrl+Shift+C toggles ability insta-cooldown for testing.
    // When on, every ability's cooldown is clamped to 1 second so the user
    // can see the full set of class abilities trigger in a single dungeon
    // run without waiting out the real timers.
    this.input.keyboard.on('keydown-C', (e) => {
      if (!e.ctrlKey || !e.shiftKey) return
      const next = !AbilitySystem.isDebugInstaCooldown()
      AbilitySystem.debugInstaCooldown(next)
      // Surface the toggle so the user sees confirmation in-game.
      const cam = this.cameras.main
      const txt = this.add.text(cam.midPoint.x, cam.midPoint.y - 80,
        `Ability insta-cooldown: ${next ? 'ON' : 'OFF'}`,
        { fontSize: '18px', color: next ? '#66ff99' : '#ff6677', fontFamily: 'monospace', fontStyle: 'bold',
          stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5).setScrollFactor(0).setDepth(9999)
      this.tweens.add({ targets: txt, alpha: 0, y: txt.y - 30, duration: 1500, onComplete: () => txt.destroy() })
    })
  }

  update(_time, delta) {
    const speed = Balance.CAMERA_SCROLL_SPEED / this._cam.zoom

    // WASD breaks follow mode then moves camera manually
    const anyWASD = this._keys.W.isDown || this._keys.S.isDown ||
                    this._keys.A.isDown || this._keys.D.isDown
    if (anyWASD && this._followId) this._setFollow(null)
    if (this._keys.W.isDown) this._cam.scrollY -= speed
    if (this._keys.S.isDown) this._cam.scrollY += speed
    if (this._keys.A.isDown) this._cam.scrollX -= speed
    if (this._keys.D.isDown) this._cam.scrollX += speed

    // Smooth camera follow (day phase only)
    if (this._followId && this.gameState.meta.phase === 'day') {
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

    // Boss wander always runs at real time (cosmetic, independent of sim speed)
    this.bossSystem?.update(delta)

    if (this.gameState.meta.phase === 'day') {
      const ts = this._getDayTimeScale()
      if (ts > 0) {
        const scaled = delta * ts
        this.aiSystem?.update(scaled)
        this.minionAiSystem?.update(scaled)
        this.trapSystem?.update(scaled)
        this.dungeonMechanicSystem?.tickDay(scaled)
        this.lootGreedSystem?.update(scaled)
        this.classAbilitySystem?.update(scaled)
      }
      this.adventurerRenderer?.update()
      this.minionRenderer?.update()
      this.bossRenderer?.update()
      this.trapRenderer?.update()
      this.lootRenderer?.update()
      this.chatBubbles?.update()
      this.replayGhostRenderer?.update()
      this.eternalNightOverlay?.update()
      this.paranoiaIndicator?.update()
    } else {
      this.minionRenderer?.update()
      this.bossRenderer?.update()
      this.trapRenderer?.update()
      this.lootRenderer?.update()
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
