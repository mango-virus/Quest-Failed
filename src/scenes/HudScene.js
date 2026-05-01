// Phase 31C — HUD scene composes the persistent HUD chrome on top of
// gameplay scenes (NightPhase / DayPhase). Owns:
//
//   - BossTopBar     — top strip (boss avatar + day + survival bar +
//                      gold + dark power)
//   - MiniMapPanel   — left column, just below top bar (Crypt-styled
//                      replacement for the old MiniMap)
//   - BuildMenu      — left column, below mini-map (visible only in
//                      night phase)
//   - AudioControls  — bottom-left, just above the action bar
//   - KnowledgePin   — right column, top
//   - DungeonLog     — right column, below knowledge pin
//   - ActionBar      — bottom strip (rotate / move / sell / roster /
//                      phase-toggle / knowledge / adv-intel / menu)
//
// Stays active across phase transitions so chrome never flashes.

import { applyUiCamera } from '../ui/UIKit.js'
import { BossTopBar, BOSS_TOP_BAR_HEIGHT } from '../ui/BossTopBar.js'
import { ActionBar,  ACTION_BAR_HEIGHT  } from '../ui/ActionBar.js'
import { KnowledgePin } from '../ui/KnowledgePin.js'
import { DungeonLog }   from '../ui/DungeonLog.js'
import { BuildMenu }    from '../ui/BuildMenu.js'
import { MiniMapPanel, MINIMAP_PANEL_HEIGHT } from '../ui/MiniMapPanel.js'
import { AudioControls } from '../ui/AudioControls.js'
import { GameplayMusic } from '../systems/GameplayMusic.js'
import { EventBus }      from '../systems/EventBus.js'

const COL_PAD     = 12
const LEFT_COL_W  = 200
const RIGHT_COL_W = 220

export class HudScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HudScene', active: false })
    this._miniMap      = null
    this._topBar       = null
    this._actionBar    = null
    this._knowPin      = null
    this._dungeonLog   = null
    this._buildMenu    = null
    this._audioControls = null
    this._listeners    = []
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
    const TOP_Y = BOSS_TOP_BAR_HEIGHT + 6

    // ── Top bar ──
    this._topBar = new BossTopBar(this, this._gameState, { depth: 60 })

    // ── Mini-map (left column, top) ──
    this._miniMap = new MiniMapPanel(this, this._gameState, {
      depth: 60,
      x: COL_PAD, y: TOP_Y,
      w: LEFT_COL_W, h: MINIMAP_PANEL_HEIGHT,
    })

    // ── Build menu (left column, fills down to the action bar) ──
    // The audio strip moved INTO the action bar's left margin, so the
    // build menu reclaims that vertical space.
    const buildMenuY = TOP_Y + MINIMAP_PANEL_HEIGHT + 8
    this._buildMenu = new BuildMenu(this, this._gameState, {
      depth: 60,
      x:     COL_PAD,
      y:     buildMenuY,
      w:     LEFT_COL_W,
      h:     H - buildMenuY - ACTION_BAR_HEIGHT - 6,
    })
    this._buildMenu.setVisible(this._gameState.meta?.phase === 'night')

    // ── Audio controls — sit in the action bar's left empty margin
    //    (the bar is now a centered ~1020 px panel, so the left ~130 px
    //    of canvas next to it is free space). Vertically centered on the
    //    action bar so the volume slider lines up with the buttons.
    const actionBarTop = H - ACTION_BAR_HEIGHT
    this._audioControls = new AudioControls(this,
      COL_PAD,
      actionBarTop + 12,
      { depth: 80, playlist: GameplayMusic },
    )

    // ── Knowledge Pin (right column, top) ──
    const knowX = W - RIGHT_COL_W - COL_PAD
    const knowY = TOP_Y
    this._knowPin = new KnowledgePin(this, this._gameState, {
      depth: 60, x: knowX, y: knowY, w: RIGHT_COL_W,
    })
    const knowPinH = 192   // KnowledgePin's measured height

    // ── Dungeon Log (right column, fills below pin) ──
    const logY = knowY + knowPinH + 8
    this._dungeonLog = new DungeonLog(this, this._gameState, {
      depth: 60,
      x:     knowX,
      y:     logY,
      w:     RIGHT_COL_W,
      h:     H - logY - ACTION_BAR_HEIGHT - COL_PAD,
    })

    // ── Action bar (bottom strip) ──
    this._actionBar = new ActionBar(this, this._gameState, { depth: 60 })

    // Listen for phase change: toggle build menu visibility, AND clear any
    // lingering BuildMenu selection so day-2+ placement works cleanly. The
    // BuildMenu lives in HudScene (persistent), but NightPhase re-init
    // starts with no selected def — keep them in sync.
    const onPhaseChange = () => {
      const isNight = this._gameState.meta?.phase === 'night'
      this._buildMenu?.setVisible(isNight)
      EventBus.emit('BUILD_DESELECT')
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
    this._miniMap?.destroy();      this._miniMap       = null
    this._topBar?.destroy();       this._topBar        = null
    this._actionBar?.destroy();    this._actionBar     = null
    this._knowPin?.destroy();      this._knowPin       = null
    this._dungeonLog?.destroy();   this._dungeonLog    = null
    this._buildMenu?.destroy();    this._buildMenu     = null
    this._audioControls?.destroy(); this._audioControls = null
  }
}
