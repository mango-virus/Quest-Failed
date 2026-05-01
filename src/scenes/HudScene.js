// Phase 31C — HUD scene composes the persistent HUD chrome on top of
// gameplay scenes (NightPhase / DayPhase). Owns:
//
//   - BossTopBar    — top strip (boss avatar + day + resources)
//   - MiniMap       — left column, just below top bar
//   - BuildMenu     — left column, below mini-map (visible only in night phase)
//   - KnowledgePin  — right column, top
//   - DungeonLog    — right column, below knowledge pin
//   - ActionBar     — bottom strip (rotate / move / sell / roster /
//                     phase-toggle / knowledge / adv-intel / menu)
//
// Stays active across phase transitions so chrome never flashes. NightPhase
// and DayPhase listen for ActionBar / BuildMenu events instead of rendering
// their own UI. AudioControls and the old BossHpPanel were removed — pause
// menu (31G) will re-surface audio.

import { MiniMap }       from '../ui/MiniMap.js'
import { applyUiCamera } from '../ui/UIKit.js'
import { BossTopBar, BOSS_TOP_BAR_HEIGHT } from '../ui/BossTopBar.js'
import { ActionBar, ACTION_BAR_HEIGHT }    from '../ui/ActionBar.js'
import { KnowledgePin, KNOWLEDGE_PIN_WIDTH } from '../ui/KnowledgePin.js'
import { DungeonLog }    from '../ui/DungeonLog.js'
import { BuildMenu, BUILD_MENU_WIDTH } from '../ui/BuildMenu.js'
import { EventBus }      from '../systems/EventBus.js'

const COL_PAD = 12

export class HudScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HudScene', active: false })
    this._miniMap     = null
    this._topBar      = null
    this._actionBar   = null
    this._knowPin     = null
    this._dungeonLog  = null
    this._buildMenu   = null
    this._listeners   = []
  }

  init(data) {
    this._gameScene = data?.gameScene ?? null
    this._gameState = data?.gameState ?? null
  }

  create() {
    if (!this._gameScene || !this._gameState) return
    applyUiCamera(this)

    const W = this.uiW
    const H = this.uiH
    const COL_W      = 240             // both side columns same width
    const RIGHT_COL_W = 280            // right column slightly wider for log readability
    const TOP_Y      = BOSS_TOP_BAR_HEIGHT + 8

    // ── Top bar ──
    this._topBar = new BossTopBar(this, this._gameState, { depth: 60 })

    // ── Mini-map (left column, top) ──
    // MiniMap is 180×180; left-anchored inside the left column.
    this._miniMap = new MiniMap(this, this._gameState, this._gameScene, {
      x: COL_PAD, y: TOP_Y,
    })
    const miniMapH = 180   // matches MAP_H constant inside MiniMap.js

    // ── Build menu (left column, below mini-map) ──
    const buildMenuY = TOP_Y + miniMapH + 12
    this._buildMenu = new BuildMenu(this, this._gameState, {
      depth: 60,
      x:     COL_PAD,
      y:     buildMenuY,
      h:     H - buildMenuY - ACTION_BAR_HEIGHT - COL_PAD,
    })
    this._buildMenu.setVisible(this._gameState.meta?.phase === 'night')

    // ── Knowledge Pin (right column, top) ──
    const knowX = W - RIGHT_COL_W - COL_PAD
    const knowY = TOP_Y
    this._knowPin = new KnowledgePin(this, this._gameState, {
      depth: 60, x: knowX, y: knowY, w: RIGHT_COL_W,
    })
    const knowPinH = 192   // KnowledgePin's measured height (header + 4 rows + exposure)

    // ── Dungeon Log (right column, fills below pin) ──
    const logY = knowY + knowPinH + 12
    this._dungeonLog = new DungeonLog(this, this._gameState, {
      depth: 60,
      x:     knowX,
      y:     logY,
      w:     RIGHT_COL_W,
      h:     H - logY - ACTION_BAR_HEIGHT - COL_PAD,
    })

    // ── Action bar (bottom strip) ──
    this._actionBar = new ActionBar(this, this._gameState, { depth: 60 })

    // Listen for phase change to toggle build menu visibility
    const onPhaseChange = () => {
      const isNight = this._gameState.meta?.phase === 'night'
      this._buildMenu?.setVisible(isNight)
    }
    EventBus.on('NIGHT_PHASE_BEGAN', onPhaseChange)
    EventBus.on('DAY_PHASE_BEGAN',   onPhaseChange)
    this._listeners.push(['NIGHT_PHASE_BEGAN', onPhaseChange])
    this._listeners.push(['DAY_PHASE_BEGAN',   onPhaseChange])
  }

  update() {
    this._miniMap?.update()
    this._topBar?.update()
    this._actionBar?.update()
    this._knowPin?.update()
    this._dungeonLog?.update()
    this._buildMenu?.update()
  }

  shutdown() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._miniMap?.destroy();    this._miniMap     = null
    this._topBar?.destroy();     this._topBar      = null
    this._actionBar?.destroy();  this._actionBar   = null
    this._knowPin?.destroy();    this._knowPin     = null
    this._dungeonLog?.destroy(); this._dungeonLog  = null
    this._buildMenu?.destroy();  this._buildMenu   = null
  }
}
