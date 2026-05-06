// Phase 31C — HUD scene composes the persistent HUD chrome on top of
// gameplay scenes (NightPhase / DayPhase). Owns:
//
//   - BossTopBar     — top strip (boss avatar + day + survival bar +
//                      gold + dark power)
//   - MiniMapPanel   — left column, just below top bar (Crypt-styled
//                      replacement for the old MiniMap)
//   - BuildMenu      — left column, below mini-map (visible only in
//                      night phase)
//   - KnowledgePin   — right column, top
//   - DungeonLog     — right column, below knowledge pin
//   - ActionBar      — bottom strip (rotate / move / sell / roster /
//                      phase-toggle / knowledge / adv-intel / menu)
//
// Stays active across phase transitions so chrome never flashes.

import { applyUiCamera, CRYPT } from '../ui/UIKit.js'
import { BossTopBar, BOSS_TOP_BAR_HEIGHT } from '../ui/BossTopBar.js'
import { ActionBar,  ACTION_BAR_HEIGHT  } from '../ui/ActionBar.js'
import { BossArchetypeUI } from '../ui/BossArchetypeUI.js'
import { KnowledgePin, KNOWLEDGE_PIN_HEIGHT } from '../ui/KnowledgePin.js'
import { DungeonLog }   from '../ui/DungeonLog.js'
import { BuildMenu }    from '../ui/BuildMenu.js'
import { MiniMapPanel, MINIMAP_PANEL_HEIGHT } from '../ui/MiniMapPanel.js'
import { EventBus }      from '../systems/EventBus.js'
import { PauseManager }  from '../systems/PauseManager.js'
import { BossOverviewPopup }    from '../ui/popups/BossOverviewPopup.js'
import { MinionRosterPopup }    from '../ui/popups/MinionRosterPopup.js'
import { KnowledgeMapPopup }    from '../ui/popups/KnowledgeMapPopup.js'
import { AdventurerIntelPopup } from '../ui/popups/AdventurerIntelPopup.js'
import { PostWaveSummaryPopup } from '../ui/popups/PostWaveSummaryPopup.js'
import { DarkPactPopup }        from '../ui/popups/DarkPactPopup.js'
import { LongGamePopup }        from '../ui/popups/LongGamePopup.js'
import { ConfirmPopup }         from '../ui/popups/ConfirmPopup.js'
import { PactDetailPopup }      from '../ui/popups/PactDetailPopup.js'
import { BossLevelUpPopup }     from '../ui/popups/BossLevelUpPopup.js'
import { BossFightOverlay }     from '../ui/BossFightOverlay.js'
import { EventBanner }          from '../ui/EventBanner.js'

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
    this._popups       = {}      // { boss, roster, knowledge, intel } — set in create()
    this._listeners    = []
  }

  init(data) {
    this._gameScene = data?.gameScene ?? null
    this._gameState = data?.gameState ?? null
  }

  create() {
    if (!this._gameScene || !this._gameState) return
    // Defensive: if create() ran without an intervening shutdown (e.g.,
    // Phaser scene.restart() racing with a window resize during a scene
    // transition), prior components and EventBus listeners survive. Tear
    // them down first so we don't end up with duplicates that toggle each
    // other off on click.
    if (this._listeners?.length || this._buildMenu) {
      this.shutdown()
    }
    applyUiCamera(this)

    const W = this.uiW
    const H = this.uiH
    const TOP_Y = BOSS_TOP_BAR_HEIGHT + 6

    // ── Side chrome (dark backing) ──
    // The dungeon view is rendered by the Game scene one layer below us.
    // Without these solid fills the dungeon shows through the gaps
    // between the side panels and along the action bar's left/right
    // margins. They sit at depth 50 — below the panels (60) but above
    // the world camera. The top bar is its own panel, so we only need
    // left/right side strips and a full-width bottom strip here.
    this._chrome = []
    const chromeColor = CRYPT.bgDeep
    const leftChromeW = LEFT_COL_W + COL_PAD * 2
    const rightChromeW = RIGHT_COL_W + COL_PAD * 2
    const sideTop = BOSS_TOP_BAR_HEIGHT
    const sideBottom = H - ACTION_BAR_HEIGHT

    const leftBg = this.add.rectangle(0, sideTop, leftChromeW, sideBottom - sideTop, chromeColor)
      .setOrigin(0).setDepth(50)
    const rightBg = this.add.rectangle(W - rightChromeW, sideTop, rightChromeW, sideBottom - sideTop, chromeColor)
      .setOrigin(0).setDepth(50)
    const bottomBg = this.add.rectangle(0, sideBottom, W, ACTION_BAR_HEIGHT, chromeColor)
      .setOrigin(0).setDepth(50)
    this._chrome.push(leftBg, rightBg, bottomBg)

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

    // ── Knowledge Pin (right column, top) ──
    const knowX = W - RIGHT_COL_W - COL_PAD
    const knowY = TOP_Y
    this._knowPin = new KnowledgePin(this, this._gameState, {
      depth: 60, x: knowX, y: knowY, w: RIGHT_COL_W,
    })
    // Use the panel's actual rendered height so the Dungeon Log seats
    // flush against it without leaving a gap.
    const knowPinH = KNOWLEDGE_PIN_HEIGHT

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

    // ── Boss-archetype action strip (Phase 1b) ──
    // Sits above the action bar; only renders archetype-specific buttons.
    this._archetypeUI = new BossArchetypeUI(this, this._gameState, { depth: 65 })

    // Boss-fight cinematic overlay (intro slate + bottom HP bar +
    // result slate). Lives here so it can use this scene's uiW/uiH
    // and render at screen-space depth above the world.
    this._bossFightOverlay = new BossFightOverlay(this, this._gameState)

    // Top-of-screen banner for Dungeon Event announcements (fires during
    // night phase when EventSystem schedules an event for the next day).
    this._eventBanner = new EventBanner(this)

    // Listen for phase change: toggle build menu visibility, AND clear any
    // lingering BuildMenu selection so day-2+ placement works cleanly. The
    // BuildMenu lives in HudScene (persistent), but NightPhase re-init
    // starts with no selected def — keep them in sync.
    const onPhaseChange = () => {
      const isNight = this._gameState.meta?.phase === 'night'
      // Close popups FIRST so any orphaned wash is swept before the new
      // phase's UI tries to take input. Without this order, a leftover
      // depth-200 interactive overlay would still be on top when the
      // build menu becomes visible, eating every click.
      this._closeAllPopups()
      this._buildMenu?.setVisible(isNight)
      EventBus.emit('BUILD_DESELECT')
    }
    EventBus.on('NIGHT_PHASE_BEGAN', onPhaseChange)
    EventBus.on('DAY_PHASE_BEGAN',   onPhaseChange)
    this._listeners.push(['NIGHT_PHASE_BEGAN', onPhaseChange])
    this._listeners.push(['DAY_PHASE_BEGAN',   onPhaseChange])

    // ── Phase 31E + 31F popups ──
    this._popups = {
      boss:      new BossOverviewPopup(this, this._gameState),
      roster:    new MinionRosterPopup(this, this._gameState),
      knowledge: new KnowledgeMapPopup(this, this._gameState),
      intel:     new AdventurerIntelPopup(this, this._gameState),
      postwave:  new PostWaveSummaryPopup(this, this._gameState),
      darkpact:  new DarkPactPopup(this, this._gameState),
      longgame:   new LongGamePopup(this),
      confirm:    new ConfirmPopup(this),
      pactdetail: new PactDetailPopup(this),
      bosslevelup: new BossLevelUpPopup(this, this._gameState),
    }
    // Phase 9 — open the Long Game popup whenever the pact triggers.
    {
      const fn = (payload) => this._popups.longgame.showFor(payload)
      EventBus.on('LONG_GAME_TRIGGERED', fn)
      this._listeners.push(['LONG_GAME_TRIGGERED', fn])
    }
    // Generic confirm-dialog channel — any scene can emit SHOW_CONFIRM with
    // { message, onConfirm, onCancel } to gate destructive actions.
    {
      const fn = (payload) => this._popups.confirm.showFor(payload)
      EventBus.on('SHOW_CONFIRM', fn)
      this._listeners.push(['SHOW_CONFIRM', fn])
    }
    // Pact detail popup — opens from clicking a pact card in BossOverviewPopup.
    {
      const fn = (payload) => this._popups.pactdetail.showFor(payload)
      EventBus.on('SHOW_PACT_DETAIL', fn)
      this._listeners.push(['SHOW_PACT_DETAIL', fn])
    }
    const togglePopup = (key) => {
      // Re-clicking the action-bar button closes the popup. Opening a
      // different popup auto-closes any currently-open one so only one is
      // ever on screen at a time.
      if (this._popups[key].isOpen?.() ?? this._isPopupOpen(key)) {
        this._popups[key].close()
        return
      }
      this._closeAllPopups()
      this._popups[key].open()
    }
    const wirePopup = (event, key) => {
      const fn = () => togglePopup(key)
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    wirePopup('OPEN_BOSS_OVERVIEW', 'boss')
    wirePopup('OPEN_MINION_ROSTER', 'roster')
    wirePopup('OPEN_KNOWLEDGE_MAP', 'knowledge')
    wirePopup('OPEN_ADV_INTEL',     'intel')

    // 31F end-of-day chain — EndOfDay scene drives these events; we just
    // open / close the corresponding popup.
    const onShowPostWave = ({ snapshot }) => {
      this._closeAllPopups()
      this._popups.postwave.setSnapshot(snapshot)
      this._popups.postwave.open()
    }
    const onShowDarkPact = () => {
      this._closeAllPopups()
      this._popups.darkpact.refreshOffers()
      this._popups.darkpact.open()
    }
    EventBus.on('SHOW_POST_WAVE_SUMMARY', onShowPostWave)
    EventBus.on('SHOW_DARK_PACT',         onShowDarkPact)
    this._listeners.push(['SHOW_POST_WAVE_SUMMARY', onShowPostWave])
    this._listeners.push(['SHOW_DARK_PACT',         onShowDarkPact])

    // Boss Level-Up popup — drained by EndOfDay between PostWaveSummary
    // close and the night-phase handoff. Fires once per level-up; the
    // EndOfDay scene chains them when multiple level-ups occurred in a
    // single day. Each show emits BOSS_LEVEL_UP_DISMISSED on close so
    // EndOfDay can advance the queue.
    const onShowBossLevelUp = ({ fromLevel, toLevel }) => {
      this._closeAllPopups()
      this._popups.bosslevelup.setLevels(fromLevel, toLevel)
      this._popups.bosslevelup.open()
    }
    EventBus.on('SHOW_BOSS_LEVEL_UP', onShowBossLevelUp)
    this._listeners.push(['SHOW_BOSS_LEVEL_UP', onShowBossLevelUp])

    // Phase 31G — action-bar MENU button opens the pause menu. Esc still
    // works via PauseManager's keyboard hook in NightPhase / DayPhase.
    const onOpenPause = () => {
      this._closeAllPopups()
      PauseManager.toggle(this)
    }
    EventBus.on('OPEN_PAUSE_MENU', onOpenPause)
    this._listeners.push(['OPEN_PAUSE_MENU', onOpenPause])
  }

  _isPopupOpen(key) {
    const p = this._popups[key]
    return p?._frame?.isOpen?.() ?? false
  }

  _closeAllPopups() {
    if (!this._popups) return
    for (const k of Object.keys(this._popups)) {
      this._popups[k]?.close?.()
    }
    // Defensive: destroy any orphaned high-depth interactive objects
    // (e.g., a popup wash whose close path missed it). A surviving wash
    // covers the canvas at depth 200 with setInteractive() and silently
    // eats every click — would manifest as ALL HudScene UI (BuildMenu,
    // ActionBar) and NightPhase placement going dead from day 2 onward.
    const orphans = this.children.list.filter(o =>
      o && (o.depth ?? 0) >= 200 && o.input?.enabled
    )
    for (const o of orphans) o.destroy()
  }

  update() {
    this._miniMap?.update()
    this._topBar?.update()
    this._actionBar?.update()
    this._knowPin?.update()
    this._dungeonLog?.update()
    this._buildMenu?.update()
    this._archetypeUI?.update()
    this._bossFightOverlay?.update()
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
    this._bossFightOverlay?.destroy(); this._bossFightOverlay = null
    this._eventBanner?.destroy();      this._eventBanner       = null
    if (this._popups) {
      for (const k of Object.keys(this._popups)) this._popups[k]?.destroy?.()
      this._popups = {}
    }
    if (this._chrome) {
      this._chrome.forEach(o => o?.destroy?.())
      this._chrome = []
    }
  }
}
