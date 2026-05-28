import { EventBus }       from '../systems/EventBus.js'
import { SaveSystem }     from '../systems/SaveSystem.js'
import { Balance, adventurerDisplayLevel } from '../config/balance.js'
import { createAdventurer } from '../entities/Adventurer.js'
import { entryDoorTile }   from '../systems/DungeonGrid.js'
import { PALETTE, glowPanel, applyUiCamera } from '../ui/UIKit.js'
import { createBubble } from '../ui/Bubble.js'
// CombatLog removed in Phase 31C — DungeonLog (HudScene right column) replaces it.
import { DossierPanel }   from '../ui/DossierPanel.js'
import { PauseManager }   from '../systems/PauseManager.js'
import { classLabel }     from '../util/displayNames.js'
import { rollRivalDungeonSprites } from '../util/rivalDungeon.js'
import { pickWeightedClass } from '../util/classSpawn.js'

const TOP_H    = 48
const BOTTOM_H = 56

export class DayPhase extends Phaser.Scene {
  constructor() {
    super('DayPhase')
    this._gameState   = null
    this._timeScale   = Balance.TIME_SCALE_NORMAL
    this._timeBtns    = []  // { bg, txt, scale, x, y, w, h }
    this._statsTexts  = {}
    this._allOutTimer = null
    this._listeners   = []
    this._followText  = null
  }

  init(data) {
    this._gameState = data?.gameState ?? this.scene.get('Game')?.gameState
    // Phase 31F — snapshot day-start state so PostWaveSummary can compute
    // per-day deltas (resources earned, minions lost, etc.) and the
    // Dark-Pact gate can detect a boss level-up that happened during the
    // day. All values are primitives or shallow clones — JSON-safe.
    const gs = this._gameState
    if (gs) {
      // Day-start exposure baseline — lets PostWaveSummary show the REAL
      // intel-leak delta (escapees feed the shared pool; the dead leak
      // nothing) instead of a fabricated per-escapee figure.
      const ks = this.scene.get('Game')?.knowledgeSystem
      this._daySnapshot = {
        gold:         gs.player?.gold         ?? 0,
        totalKills:   gs.player?.totalKills   ?? 0,
        bossLevel:    gs.boss?.level           ?? 1,
        totals:       { ...(gs.run?.totals ?? {}) },
        graveyardLen: gs.adventurers?.graveyard?.length ?? 0,
        exposurePct:  ks?.getIntelReport?.()?.exposurePct ?? 0,
      }
    } else {
      this._daySnapshot = null
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  create() {
    // Phaser doesn't auto-invoke shutdown() on the user scene class —
    // it only fires a SHUTDOWN event. Bind it once so our cleanup
    // runs on scene.stop(). See Game.create() for the longer
    // explanation; this scene leaked the same way until it was fixed.
    this.events.once('shutdown', this.shutdown, this)
    const { width: W, height: H } = applyUiCamera(this)
    // Reset per-day idempotency guards. Phaser reuses the same scene
    // instance across day-start invocations, so without this reset
    // `_didSpawnToday` from yesterday persists and short-circuits today's
    // spawnNow() — leaving the day stuck with no adventurers.
    //
    // Mid-day resume case: when Game.create() launches DayPhase directly
    // because a save was made mid-wave (meta.phase === 'day' with
    // adventurers still in active), we must NOT respawn a fresh daily
    // wave on top of the survivors — pre-seed the guard so spawnNow()
    // and its 2.9s defensive fallback both early-return. Skipping the
    // respawn also leaves the player's surviving adventurers in place
    // and lets the AI tick (now running because DayPhase is active)
    // resume their movement straight away.
    const _activeOnLoad = this._gameState?.adventurers?.active?.length ?? 0
    this._didSpawnToday = _activeOnLoad > 0
    // Phase 31C — top bar / stats row / follow indicator / bottom bar +
    // CombatLog all moved to HudScene (BossTopBar / DungeonLog / ActionBar).
    // The legacy methods stay on the class as dead code; their internal
    // stores (e.g., this._statsTexts) are never populated, so _refreshStats
    // and _refreshEndDayButton early-return.
    this._setTimeScale(Balance.TIME_SCALE_NORMAL)

    this.input.keyboard?.on('keydown-ESC', () => PauseManager.toggle(this))
    // Time-scale keyboard shortcuts (replaces the bottom-bar buttons that
    // were removed with the chrome strip). Numeric digits work without modifiers.
    // SIX maps to 16× (hyper) — only accepted from day HYPER_UNLOCK_DAY (30)
    // onwards; before then, TWO maps to 2× as usual. _setTimeScale clamps
    // mismatched scales to the right tier for the current day so the keybind
    // is safe to leave wired in either state.
    this.input.keyboard?.on('keydown-SPACE', () => this._setTimeScale(Balance.TIME_SCALE_PAUSED))
    this.input.keyboard?.on('keydown-ONE',   () => this._setTimeScale(Balance.TIME_SCALE_NORMAL))
    this.input.keyboard?.on('keydown-TWO',   () => this._setTimeScale(Balance.TIME_SCALE_FAST))
    this.input.keyboard?.on('keydown-FOUR',  () => this._setTimeScale(Balance.TIME_SCALE_FASTEST))
    this.input.keyboard?.on('keydown-EIGHT', () => this._setTimeScale(Balance.TIME_SCALE_ULTRA))
    this.input.keyboard?.on('keydown-SIX',   () => this._setTimeScale(Balance.TIME_SCALE_HYPER))

    this._dossierPanel = new DossierPanel(this, this._gameState)

    this._wireEvents()
    this._wireHudEvents()
    EventBus.emit('DAY_PHASE_STARTED')
    EventBus.emit('DAY_PHASE_BEGAN')   // Phase 31C — HudScene listens to toggle build menu off

    // Defer adventurer spawn until the DAY phase-change cinematic
    // finishes (2.8s). Otherwise adventurers march in behind/under the
    // cinematic and the "DAWN BREAKS · THE INVASION" framing is lost.
    // Detection: when the new DOM HUD is on, PhaseTransition will emit
    // PHASE_TRANSITION_FINISHED at the cinematic's end. Under legacy
    // (`?newhud=0`) there's no cinematic so we spawn immediately. A
    // fallback timer guards against the event never firing (defensive).
    let _useNewHud = true
    try { _useNewHud = localStorage.getItem('newhud') !== '0' } catch {}
    const spawnNow = () => {
      if (this._didSpawnToday) return
      this._didSpawnToday = true
      // Failsafe: the entire spawn pipeline runs under a try/catch so a
      // throw inside one path can never strand the day with no wave AND
      // no end-day trigger. On throw we treat it as an unintended empty
      // wave — _handleSpawnFailure surfaces it and the all-out timer in
      // _refreshStats auto-rolls to night.
      let spawned = []
      try {
        spawned = this._spawnDailyAdventurers() ?? []
      } catch (err) {
        console.error('[DayPhase] _spawnDailyAdventurers threw — falling through to rest-day failsafe:', err)
        spawned = []
      }
      // Event-replacement waves (speedrunner, cartographers, saboteur,
      // zombie horde, loot goblins, bounty-hunter pack, rival dungeon)
      // are event-specific — flag every member so they can never return
      // later as a Hero (KnowledgeSystem.rollReturnLeader skips flagged
      // survivors). The additive Tournament rivals are flagged inside
      // _spawnTournamentRivals instead.
      const _ef = this._gameState._eventFlags ?? {}
      if (_ef.lootGoblinHeistActive || _ef.legendarySpeedrunnerActive ||
          _ef.cartographersConventionActive || _ef.bountyHuntersActive ||
          _ef.zombieHordeActive || _ef.saboteurActive || _ef.rivalDungeonActive) {
        for (const a of spawned) {
          if (a) { a.flags ??= {}; a.flags.eventAdventurer = true }
        }
      }
      this._refreshStats()
      if (spawned.length > 0) {
        this._focusCameraOnEntry()
      } else if (!this._noSpawnReason) {
        // Unintended zero-spawn (Negotiation Pay is the only INTENDED
        // empty wave — _spawnDailyAdventurers tags `_noSpawnReason` for
        // it). Anything else reaching here is a bug somewhere upstream
        // (missing class JSON, replacement-event spawner returned [],
        // etc.) — surface it so the player isn't left staring at an
        // empty dungeon, then let _refreshStats's all-out timer end the
        // day in 1.5s (same path as a normal cleared wave).
        this._handleSpawnFailure()
      }
    }
    if (_useNewHud) {
      const onFinish = ({ phase } = {}) => {
        if (phase !== 'day') return
        EventBus.off('PHASE_TRANSITION_FINISHED', onFinish)
        spawnNow()
      }
      EventBus.on('PHASE_TRANSITION_FINISHED', onFinish)
      // Defensive fallback — if the cinematic gets cancelled or its
      // emit never lands, still spawn at 2.9s so the day isn't soft-
      // locked.
      this.time.delayedCall(2900, () => {
        EventBus.off('PHASE_TRANSITION_FINISHED', onFinish)
        spawnNow()
      })
    } else {
      spawnNow()
    }
  }

  // Brief camera pan + zoom to the entry hall(s) so the player can watch the
  // first adventurer(s) physically enter the dungeon.
  _focusCameraOnEntry() {
    const entries = this._gameState.dungeon.rooms.filter(r => r.definitionId === 'entry_hall')
    if (entries.length === 0) return
    const gameScene = this.scene.get('Game')
    const cam = gameScene?.cameras?.main
    if (!cam) return

    const TS = Balance.TILE_SIZE
    // Frame every entry hall — a wave can pour out of 1-3 doorways at once.
    // Centre on the bounding box of all of them; with more than one entry,
    // zoom out just enough to fit the spread (clamped so it never goes
    // uselessly far). A single entry keeps the original tight framing.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const e of entries) {
      minX = Math.min(minX, e.gridX)
      minY = Math.min(minY, e.gridY)
      maxX = Math.max(maxX, e.gridX + e.width)
      maxY = Math.max(maxY, e.gridY + e.height)
    }
    const wx = ((minX + maxX) / 2) * TS
    const wy = ((minY + maxY) / 2) * TS
    let targetZoom = Math.min(1.4, Balance.CAMERA_ZOOM_MAX)
    if (entries.length > 1) {
      const boxW = Math.max(1, (maxX - minX) * TS)
      const boxH = Math.max(1, (maxY - minY) * TS)
      const fit = Math.min((cam.width * 0.85) / boxW, (cam.height * 0.85) / boxH)
      targetZoom = Math.max(0.5, Math.min(targetZoom, fit))
    }
    const targetScrollX = wx - cam.centerX
    const targetScrollY = wy - cam.centerY

    gameScene.tweens.add({
      targets: cam,
      scrollX: targetScrollX,
      scrollY: targetScrollY,
      zoom: targetZoom,
      duration: 600,
      ease: 'Sine.easeInOut',
    })
  }

  // Centered "X is approaching!" banner. Much more attention-grabbing than
  // the side dossier panel — the user immediately sees that the day has
  // started and that adventurers ARE on their way in.
  _showArrivalBanner(spawned) {
    const W = this.uiW
    const bw = Math.min(W - 80, 540)
    const bh = 60
    const bx = (W - bw) / 2
    const by = TOP_H + 12

    const bg = this.add.graphics().setDepth(33)
    glowPanel(bg, bx, by, bw, bh, {
      fill: 0x080d18, border: 0xddaa22, glow: 0x886600,
    })

    const heading = this.add.text(W / 2, by + 14,
      `⚠  ${spawned.length} ADVENTURER${spawned.length === 1 ? '' : 'S'} ENTERING THE DUNGEON`, {
        fontSize: '12px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setDepth(34)

    const names = spawned.map(a =>
      `${a.name} (${classLabel(a.classId)})`
    ).join('  ·  ')
    const sub = this.add.text(W / 2, by + 36, names, {
      fontSize: '10px', color: PALETTE.textGold, fontFamily: 'monospace',
      wordWrap: { width: bw - 24 }, align: 'center',
    }).setOrigin(0.5, 0).setDepth(34)

    this.time.delayedCall(3500, () => {
      this.tweens.add({
        targets: [bg, heading, sub], alpha: 0, duration: 600,
        onComplete: () => { bg.destroy(); heading.destroy(); sub.destroy() },
      })
    })
  }

  shutdown() {
    this.time.timeScale = 1
    this._allOutTimer?.remove(false)
    this._unwireEvents()
    if (this._hudListeners) {
      for (const [evt, fn] of this._hudListeners) EventBus.off(evt, fn, this)
      this._hudListeners = []
    }
    this._dossierPanel?.destroy()
    EventBus.emit('DAY_PHASE_ENDED')
  }

  // ── Top bar ────────────────────────────────────────────────────────────────

  _buildTopBar(W) {
    const g = this.add.graphics().setDepth(20)
    glowPanel(g, 0, 0, W, TOP_H, {
      fill: PALETTE.panelBg, border: 0x886600, glow: 0x443300,
    })
    g.lineStyle(1, 0xddaa22, 0.5)
    g.beginPath(); g.moveTo(0, TOP_H); g.lineTo(W, TOP_H); g.strokePath()

    this.add.text(18, TOP_H / 2, '☠  DAY PHASE', {
      fontSize: '10px', color: PALETTE.textGold, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(21)

    this.add.text(W / 2, TOP_H / 2, `DAY  ${this._gameState.meta.dayNumber}`, {
      fontSize: '15px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
      shadow: { color: '#886600', blur: 10, fill: true },
    }).setOrigin(0.5).setDepth(21)

    this._statsTexts.topRight = this.add.text(W - 18, TOP_H / 2, '', {
      fontSize: '10px', color: PALETTE.textDim, fontFamily: 'monospace',
    }).setOrigin(1, 0.5).setDepth(21)
  }

  _buildStatsRow(W) {
    // Active adventurers indicator just under the top bar (left)
    this._statsTexts.activeCount = this.add.text(18, TOP_H + 8,
      '', { fontSize: '10px', color: PALETTE.textGold, fontFamily: 'monospace' }
    ).setOrigin(0, 0).setDepth(21)
  }

  _buildFollowIndicator(W) {
    this._followText = this.add.text(W - 18, TOP_H + 8, '', {
      fontSize: '10px', color: PALETTE.textGold, fontFamily: 'monospace',
    }).setOrigin(1, 0).setDepth(21)
  }

  // ── Bottom bar — time controls + End Day ──────────────────────────────────

  _buildBottomBar(W, H) {
    const by = H - BOTTOM_H
    const g  = this.add.graphics().setDepth(20)
    glowPanel(g, 0, by, W, BOTTOM_H, {
      fill: PALETTE.panelBg, border: PALETTE.panelBorder, glow: 0x443300,
    })
    g.lineStyle(1, 0xddaa22, 0.3)
    g.beginPath(); g.moveTo(0, by); g.lineTo(W, by); g.strokePath()

    this.add.text(W / 2, H - 6, 'WASD / drag to scroll  ·  scroll to zoom  ·  click adventurer to inspect', {
      fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
    }).setOrigin(0.5, 1).setDepth(21)

    this._buildTimeButtons(W, H, by)
    this._buildKnowledgeButton(W, H, by)
    this._buildEndDayButton(W, H, by)
  }

  _buildKnowledgeButton(W, H, by) {
    const bw = 110, bh = 32
    const bx = W - 24 - 200 - 14 - bw   // left of END DAY button (200w + 14 gap)
    const bcy = by + BOTTOM_H / 2
    const game = this.scene.get('Game')
    let active = !!game?.knowledgeOverlay?.isEnabled()

    const bg = this.add.graphics().setDepth(21)
    const draw = (on) => {
      bg.clear()
      glowPanel(bg, bx, bcy - bh / 2, bw, bh, {
        fill:   on ? 0x14282a : 0x06060e,
        border: on ? 0x44aaff : PALETTE.panelBorder,
        glow:   on ? 0x4488cc : 0x1a0a30,
      })
    }
    draw(active)

    const label = this.add.text(bx + bw / 2, bcy, 'KNOWLEDGE', {
      fontSize: '10px',
      color: active ? PALETTE.textBright : PALETTE.textDim,
      fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(22)

    const hit = this.add.rectangle(bx + bw / 2, bcy, bw, bh, 0, 0)
      .setDepth(23).setInteractive({ useHandCursor: true })
    hit.on('pointerdown', () => {
      active = !active
      this.scene.get('Game').knowledgeOverlay?.setEnabled(active)
      draw(active)
      label.setStyle({ color: active ? PALETTE.textBright : PALETTE.textDim })
    })
  }

  _buildTimeButtons(W, H, by) {
    const CONTROLS = [
      { label: '⏸', scale: Balance.TIME_SCALE_PAUSED },
      { label: '1×', scale: Balance.TIME_SCALE_NORMAL },
      { label: '2×', scale: Balance.TIME_SCALE_FAST   },
      { label: '4×', scale: Balance.TIME_SCALE_FASTEST },
      { label: '8×', scale: Balance.TIME_SCALE_ULTRA   },
    ]
    const bw = 48, bh = 32, gap = 6
    const totalW = CONTROLS.length * (bw + gap) - gap
    const startX = W / 2 - totalW / 2
    const btnY   = by + (BOTTOM_H - bh) / 2

    this._timeBtns = []

    CONTROLS.forEach(({ label, scale }, i) => {
      const bx  = startX + i * (bw + gap)
      const bg  = this.add.graphics().setDepth(21)
      const txt = this.add.text(bx + bw / 2, btnY + bh / 2, label, {
        fontSize: '13px', color: PALETTE.textDim, fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(22)

      this._timeBtns.push({ bg, txt, scale, x: bx, y: btnY, w: bw, h: bh })

      const hit = this.add.rectangle(bx + bw / 2, btnY + bh / 2, bw, bh, 0, 0)
        .setDepth(23).setInteractive({ useHandCursor: true })
      hit.on('pointerdown', () => this._setTimeScale(scale))
    })
  }

  _setTimeScale(scale) {
    // Day-30 unlock — the speed bar swaps 2× for 16× at HYPER_UNLOCK_DAY.
    // Clamp at the source so every entry point (BottomBar button, keybind,
    // TIME_SCALE_SET event, legacy chrome) ends up on a tier that's
    // currently in the visible button set. Without this, a stale keypress
    // or external emit could land on a value that has no matching button
    // and the active-highlight would silently desync.
    const day = this._gameState?.meta?.dayNumber ?? 1
    const hyperUnlocked = day >= (Balance.HYPER_UNLOCK_DAY ?? 30)
    const requested = scale
    if (hyperUnlocked && scale === Balance.TIME_SCALE_FAST) {
      // 2× is hidden post-unlock — kick a stale TWO keypress up to 4×.
      scale = Balance.TIME_SCALE_FASTEST
    } else if (!hyperUnlocked && scale === Balance.TIME_SCALE_HYPER) {
      // 16× isn't available yet — kick a SIX keypress down to 8×.
      scale = Balance.TIME_SCALE_ULTRA
    }
    // When we clamped, re-broadcast so HUD surfaces (BottomBar highlight,
    // legacy ActionBar speed-idx) snap to the actually-applied tier instead
    // of the requested one. Safe to re-emit — DayPhase's own TIME_SCALE_SET
    // listener will call _setTimeScale(scale) again, hit the no-clamp path,
    // and not re-emit.
    if (scale !== requested) {
      EventBus.emit('TIME_SCALE_SET', { scale })
    }

    this._timeScale = scale
    this.time.timeScale = scale === 0 ? 0.001 : scale

    this._timeBtns.forEach(b => {
      const active = b.scale === scale
      b.bg.clear()
      glowPanel(b.bg, b.x, b.y, b.w, b.h, {
        fill:   active ? 0x1a0a30 : 0x06060e,
        border: active ? 0xddaa22 : PALETTE.panelBorder,
        glow:   active ? 0x886600 : 0x1a0a30,
      })
      b.txt.setStyle({ color: active ? PALETTE.textBright : PALETTE.textDim })
    })
  }

  _buildEndDayButton(W, H, by) {
    const bw  = 200
    const bh  = 36
    const bx  = W - 24 - bw / 2
    const bcy = by + BOTTOM_H / 2

    const bg = this.add.graphics().setDepth(21)

    // The button is disabled (and ignored) whenever adventurers are still in
    // the dungeon. Players were ending the day mid-run, force-despawning live
    // adventurers and skipping rewards/knowledge from their run. The day now
    // only ends naturally — when the active list is empty, the auto-timer
    // fires _endDay() — or via this button once everyone is out / dead / fled.
    const draw = (state) => {
      // state: 'idle' | 'hover' | 'disabled'
      bg.clear()
      const fill   = state === 'disabled' ? 0x06060e
                   : state === 'hover'    ? 0x1a0a20 : 0x0d0618
      const border = state === 'disabled' ? PALETTE.panelBorder
                   : state === 'hover'    ? PALETTE.accentBright : PALETTE.accent
      const glow   = state === 'disabled' ? 0x1a0a30 : PALETTE.accent
      glowPanel(bg, bx - bw / 2, bcy - bh / 2, bw, bh, { fill, border, glow })
    }
    draw('disabled')

    const label = this.add.text(bx, bcy, 'END DAY  ▶', {
      fontSize: '13px', color: PALETTE.textDim, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(22)

    // Hover hint shown while disabled — explains why click is ignored.
    const hint = this.add.text(bx, bcy - bh / 2 - 8,
      'Adventurers still in dungeon', {
        fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setOrigin(0.5, 1).setDepth(22).setVisible(false)

    this._endDayBtn = { bg, label, hint, draw, bw, bh, bx, bcy }

    const hit = this.add.rectangle(bx, bcy, bw, bh, 0, 0)
      .setDepth(23).setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => {
      if (this._isEndDayEnabled()) {
        draw('hover')
        label.setStyle({ color: PALETTE.textBright })
      } else {
        hint.setVisible(true)
      }
    })
    hit.on('pointerout', () => {
      hint.setVisible(false)
      draw(this._isEndDayEnabled() ? 'idle' : 'disabled')
      label.setStyle({
        color: this._isEndDayEnabled() ? PALETTE.textAccent : PALETTE.textDim,
      })
    })
    hit.on('pointerdown', () => {
      if (!this._isEndDayEnabled()) {
        // Subtle shake to acknowledge the click without ending the day.
        this.tweens.add({
          targets: [bg, label], x: '+=4', yoyo: true, repeat: 2, duration: 50,
        })
        return
      }
      this._endDay()
    })

    // Initial state sync so the button reflects whether adventurers spawned.
    this._refreshEndDayButton()
  }

  // True when the player is allowed to end the day. The day ends naturally
  // (auto-timer) when active.length hits 0, but the player can also click the
  // button at that moment. Otherwise it's locked.
  _isEndDayEnabled() {
    return (this._gameState?.adventurers?.active?.length ?? 0) === 0
  }

  // Re-skin the END DAY button based on whether adventurers are still active.
  _refreshEndDayButton() {
    const b = this._endDayBtn
    if (!b) return
    const enabled = this._isEndDayEnabled()
    b.draw(enabled ? 'idle' : 'disabled')
    b.label.setStyle({ color: enabled ? PALETTE.textAccent : PALETTE.textDim })
  }

  // Phase 7b: filter vendettas to just those whose target minion is still alive
  _pickActiveVendetta() {
    const list = this._gameState.vendettas ?? []
    if (list.length === 0) return null
    const stillAlive = list.filter(v => {
      const m = this._gameState.minions.find(min => min.instanceId === v.minionInstanceId)
      return !!m && m.aiState !== 'dead' && m.faction === 'dungeon'
    })
    if (stillAlive.length === 0) return null
    return stillAlive[stillAlive.length - 1]   // most recent
  }

  _scaleAdventurerByBossLevel(adv, bossLv) {
    const bloodMoneyBonus = this._gameState?._mechanicFlags?.bloodMoneyHpBonus ?? 0
    const day     = this._gameState?.meta?.dayNumber ?? 1
    const lvOver  = Math.max(0, bossLv - 1)
    const dayOver = Math.max(0, day - 1)
    // Post-day-9 compounding multiplier — every day past day 9 multiplies
    // HP / ATK by a per-day base, on top of the linear scaling below.
    // Smooth curve (no decade cliffs); at day 30 advs hit ~5× HP / ~3×
    // ATK on top of normal level scaling. See Balance comment for table.
    const postTen   = Math.max(0, day - 9)
    const post10Hp  = Math.pow(Balance.ADVENTURER_POST10_HP_PER_DAY  ?? 1, postTen)
    const post10Atk = Math.pow(Balance.ADVENTURER_POST10_ATK_PER_DAY ?? 1, postTen)
    if (lvOver === 0 && dayOver === 0 && postTen === 0 && bloodMoneyBonus === 0) return
    const hpMul  = (1 + Balance.ADVENTURER_HP_PER_BOSS_LV  * lvOver
                       + Balance.ADVENTURER_HP_PER_DAY        * dayOver
                       + bloodMoneyBonus) * post10Hp
    const atkMul = (1 + Balance.ADVENTURER_ATK_PER_BOSS_LV * lvOver
                       + Balance.ADVENTURER_ATK_PER_DAY       * dayOver) * post10Atk
    adv.resources.maxHp = Math.round(adv.resources.maxHp * hpMul)
    adv.resources.hp    = adv.resources.maxHp
    adv.stats.attack    = Math.round(adv.stats.attack * atkMul)
  }

  // ── Spawn ──────────────────────────────────────────────────────────────────

  _spawnDailyAdventurers() {
    // Failsafe state — set to a string when a zero-spawn is intentional
    // (Negotiation Pay, etc.) so spawnNow's post-spawn audit knows to
    // skip the "wave failed to arrive" banner. Reset every call.
    this._noSpawnReason = null

    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    const personalitySystem = game.personalitySystem
    const knowledgeSystem = game.knowledgeSystem
    if (!aiSystem) return

    // Dungeon event: Loot Goblin Heist — replaces the normal wave with a
    // pack of goblins spawning IN the boss room and bolting for the exit.
    // No combat AI; gold-steal on escape handled by EventSystem.
    if ((this._gameState._eventFlags ?? {}).lootGoblinHeistActive) {
      return this._spawnLootGoblinHeist()
    }
    // Dungeon event: Legendary Speed Runner — replaces the normal wave
    // with one buffed solo adv that ignores everything except the boss.
    if ((this._gameState._eventFlags ?? {}).legendarySpeedrunnerActive) {
      return this._spawnLegendarySpeedrunner()
    }
    // Dungeon event: Cartographer's Convention — replaces the normal
    // wave with 3 scholars that tour every non-boss room then leave.
    if ((this._gameState._eventFlags ?? {}).cartographersConventionActive) {
      return this._spawnCartographers()
    }
    // Dungeon event: The Tournament ("Bloodsport") — 3 named rivals
    // scatter into the dungeon and hunt each other to the death. Unlike
    // the other replacement events this is ADDITIVE: the normal daily
    // wave still spawns below; the rivals join it. _spawnTournamentRivals
    // pushes its trio into adventurers.active and tags them; we then fall
    // through to the regular spawn flow so the player's wave shows up too.
    if ((this._gameState._eventFlags ?? {}).tournamentActive) {
      this._spawnTournamentRivals()
      // No `return` — keep going so the normal wave spawns alongside.
    }
    // Dungeon event: Rival Dungeon — monsters invade instead of advs.
    // Final entrant is a buffed rival boss that goes for the throne room.
    if ((this._gameState._eventFlags ?? {}).rivalDungeonActive) {
      return this._spawnRivalDungeon()
    }
    // Dungeon event: Bounty Hunters — a pack out to slay the player's
    // strongest minion replaces the normal wave.
    if ((this._gameState._eventFlags ?? {}).bountyHuntersActive) {
      return this._spawnBountyHunterWave()
    }
    // Dungeon event: Zombie Horde — a massive shamble of weak undead
    // replaces the normal wave.
    if ((this._gameState._eventFlags ?? {}).zombieHordeActive) {
      return this._spawnZombieHorde()
    }
    // Dungeon event: The Saboteur — a masked rogue joins the normal
    // daily wave (additive, like the Tournament). They tour the dungeon
    // disabling every trap for the day, then flee. _spawnSaboteur pushes
    // the saboteur into adventurers.active; we fall through so the
    // regular wave spawns alongside them.
    if ((this._gameState._eventFlags ?? {}).saboteurActive) {
      this._spawnSaboteur()
      // No `return` — keep going so the normal wave spawns alongside.
    }

    let spawn = aiSystem.pickSpawnTile()
    if (!spawn) {
      // pickSpawnTile rejects when there's no verified path from entry to
      // boss.  Fall back to the entry hall centre so at least one
      // adventurer always shows up — they may flee on the first tick if
      // the dungeon is genuinely disconnected, but the player sees
      // activity instead of an empty day.  The banner still warns them
      // about the broken connectivity.
      const fallbackSpawn = this._fallbackEntrySpawn()
      if (fallbackSpawn) {
        // Match AISystem.pickSpawnTile — drop the adventurer at a random
        // entry hall doorway so the entry contract stays consistent.
        spawn = fallbackSpawn
        // Optional-chain the legacy-chrome text update — `_statsTexts.activeCount`
        // is never populated in the current HUD (the old top-bar chrome was
        // moved to HudScene), so a bare `.setText` here used to throw
        // TypeError → abort the whole wave → no adventurers spawned at all.
        this._statsTexts?.activeCount?.setText('Adventurers can\'t reach your boss — fix the path.')
        this._showNoSpawnBanner()
      } else {
        this._statsTexts?.activeCount?.setText('No entry hall — build one for adventurers.')
        this._showNoSpawnBanner()
        return
      }
    }

    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const dungeonLv  = this._gameState.boss?.level ?? 1
    const dayNum     = this._gameState.meta?.dayNumber ?? 1
    // Class spawn gates: unlockLevel = boss level required (default 1),
    // unlockDay = calendar day required (default 1). Both must be met.
    // Rare/late classes (necromancer, twitch_streamer, beast_master, bard)
    // use unlockLevel 3 so they appear once the boss has levelled up twice.
    let classes = allClasses.filter(c =>
      (c.unlockLevel ?? 1) <= dungeonLv &&
      (c.unlockDay   ?? 1) <= dayNum,
    )
    // Dungeon event: Twitch Con — every adventurer is a Twitch Streamer.
    // Bypasses unlock gates so the event still fires on day 1 even though
    // twitch_streamer normally requires bossLevel ≥ 3.
    if ((this._gameState._eventFlags ?? {}).twitchConActive) {
      const ts = allClasses.find(c => c.id === 'twitch_streamer')
      if (ts) classes = [ts]
    }
    // Dungeon event: Cosplay Contest — entire wave uses the dedicated
    // cosplay_adventurer class. Costumes come from the existing
    // cosplay_adventurer LPC variant pool (50 baked variants) — no
    // separate accessory overlay. Same unlock-gate bypass as Twitch Con.
    if ((this._gameState._eventFlags ?? {}).cosplayContestActive) {
      const cos = allClasses.find(c => c.id === 'cosplay_adventurer')
      if (cos) classes = [cos]
    }
    // Dungeon event: PATCH 0.0.0 — entire wave is the Cheater class.
    // Same unlock-gate bypass: the cheater normally unlocks at boss
    // level 2, but the event-replaced wave runs even on day 1.
    if ((this._gameState._eventFlags ?? {}).patchZeroActive) {
      const ch = allClasses.find(c => c.id === 'cheater')
      if (ch) classes = [ch]
    }
    // Dungeon event: Speedrun Channel — entire wave is locked to the
    // class EventSystem rolled at announce (stored on _eventFlags so
    // the IncomingWave panel + the actual spawn agree). All other wave
    // logic (size, returning veteran, etc.) is preserved.
    const _srClassId = (this._gameState._eventFlags ?? {}).speedrunChannelClassId
    if (_srClassId) {
      const sr = allClasses.find(c => c.id === _srClassId)
      if (sr) classes = [sr]
    }
    if (classes.length === 0) return

    const day   = this._gameState.meta.dayNumber
    let baseCount = Balance.ADVENTURERS_PER_DAY_BASE + Math.floor((day - 1) / 2)
    // Post-day-9 wave-size escalation (2026-05-22). Every day past day 9
    // adds an extra adventurer on top of the standard `+1 per 2 days`
    // curve. Day 10 → +1, day 20 → +11, day 30 → +21, etc.
    const postTenAdvs = Math.max(0, day - 9)
    if (postTenAdvs > 0) baseCount += postTenAdvs * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
    // Room redesign 2026-04-30 — Treasury attracts greedy adventurers:
    // each active Treasury room adds +1 to the daily party size.
    const treasuryCount = (this._gameState.dungeon.rooms ?? [])
      .filter(r => r.definitionId === 'treasury' && r.isActive !== false).length
    if (treasuryCount > 0) baseCount += treasuryCount
    // Phase 9: Gold Rush — one extra adventurer per day
    if ((this._gameState._mechanicFlags ?? {}).goldRush) baseCount += 1
    // Phase 9: Gilded Demise — extras based on yesterday's kill gold
    const gildedExtras = (this._gameState._mechanicFlags ?? {}).gildedDemiseExtraAdvs ?? 0
    if (gildedExtras > 0) {
      baseCount += gildedExtras
      this._gameState._mechanicFlags.gildedDemiseExtraAdvs = 0
    }
    // Phase 9: Doomsday Clock — the pact promised a "guaranteed raid"
    // 7 days after it was sealed. Doubles the day's natural wave (the
    // doubling IS the entire tradeoff — the per-adv stat buff was
    // removed so the price of the +500g bargain is sheer numbers, not
    // also tougher individuals).
    if ((this._gameState._mechanicFlags ?? {}).doomsdayRaidToday) {
      const mult = Balance.MECHANIC_DOOMSDAY_WAVE_MULT ?? 2
      baseCount = Math.round(baseCount * mult)
    }
    // Phase 9: Architect's Vision + Summon Adds III — flat extra adv count per day.
    const extraAdvs = (this._gameState._mechanicFlags ?? {}).extraAdvsPerDay ?? 0
    if (extraAdvs > 0) baseCount += extraAdvs
    // Dungeon event: Guild Raid — double the day's wave size as steady
    // pressure (longer wave, not a single surge — handled here at the
    // baseCount stage so the existing trickle/cadence logic stretches it
    // automatically).
    if ((this._gameState._eventFlags ?? {}).guildRaidActive) baseCount *= 2
    // Dungeon event: Infamy Spike — a swollen wave (+50%) of hero-grade
    // adventurers. The per-adv hero buff is applied in the spawn loop.
    if ((this._gameState._eventFlags ?? {}).infamySpikeActive) {
      baseCount = Math.round(baseCount * 1.5)
    }
    // Dungeon event hangover: a claimed Cursed Relic DOUBLES every
    // adventurer wave for as long as the cursed chest sits in the
    // dungeon — the player can SELL it to lift the curse. A daily toast
    // makes the ongoing curse visible.
    const hasCursedRelic = (this._gameState.dungeon?.treasureChests ?? [])
      .some(c => c._cursed)
    if (hasCursedRelic) {
      baseCount = baseCount * 2
      EventBus.emit('SHOW_TOAST', {
        message: 'The cursed relic doubles the adventurer wave',
        type: 'leak',
      })
    }
    // Dungeon event: Negotiation Day — outcome was decided during the
    // prior night via the SHOW_CONFIRM modal. PAY = no adventurers today
    // (free day). REFUSE = today's wave is +50%. Both apply to the same
    // day the modal called "tomorrow", so the player's framing matches.
    const eventFlags = this._gameState._eventFlags ?? {}
    if (eventFlags.negotiationOutcome === 'pay')    { this._noSpawnReason = 'negotiation_pay'; return [] }
    if (eventFlags.negotiationOutcome === 'refuse') baseCount = Math.round(baseCount * 1.5)
    // Phase 5c — Twitch Subscriber Revenge: consume any pending bonus spawn
    // count from yesterday's death-clip-going-viral roll.
    const subBonus = this._gameState.player?.subscriberRevengeBonus ?? 0
    if (subBonus > 0) {
      baseCount += subBonus
      this._gameState.player.subscriberRevengeBonus = 0
      // Visible banner so the player notices the extra spawn
      const cam = this.scene.get('Game')?.cameras?.main
      if (cam) {
        const txt = this.scene.get('Game').add.text(cam.midPoint.x, cam.midPoint.y - 100,
          `Streamer's death clip went viral!\n+${subBonus} adventurers today`,
          { fontSize: '18px', color: '#9146ff', fontFamily: 'monospace', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 3, align: 'center' })
          .setOrigin(0.5).setScrollFactor(0).setDepth(9999)
        this.scene.get('Game').tweens.add({ targets: txt, alpha: 0, y: txt.y - 30, duration: 3500, onComplete: () => txt.destroy() })
      }
      EventBus.emit('SUBSCRIBER_REVENGE_SPAWN', { bonus: subBonus, day })
    }
    const partyId   = `party_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const spawned   = []

    // Phase 8: roll for a returning leader (a fled adventurer brings a party back)
    const returningRecord = knowledgeSystem?.rollReturnLeader?.() ?? null
    let returnLeaderInjected = false
    // Wave size = baseCount, no class-diversity ceiling. The old
    // `Math.min(baseCount, classes.length * 2)` cap was a stale early-dev
    // safety that silently discarded the post-day-9 escalation and every
    // event multiplier (Guild Raid, Cursed Relic, Infamy Spike, etc.)
    // once baseCount exceeded ~2× the eligible class roster (kicked in
    // around day 25). LPC variants + the personality stack handle
    // duplicate classes fine, so the cap no longer serves a purpose.
    let count = Math.max(0, Math.floor(baseCount))

    // Phase 7b: vendetta hunter spawn — if active vendettas, 35% chance
    // one shows up. NightPhase pre-rolls this and stores the outcome on
    // `nextWavePreview.vendettaHunter` so the IncomingWave panel matches
    // what actually spawns. Consume the pre-roll if it targets today;
    // otherwise fall back to the original Math.random gate.
    //
    // SUPPRESSED during PATCH 0.0.0 — the event explicitly replaces the
    // wave with cheaters only, so a non-cheater Ranger / Rogue / etc.
    // vendetta hunter showing up mid-wave breaks the theme.
    const patchZeroActive = !!(this._gameState._eventFlags?.patchZeroActive)
    const vendetta = patchZeroActive ? null : this._pickActiveVendetta()
    let vendettaHunter = null
    const _preVend = (this._gameState.run?.nextWavePreview?.day === day)
      ? this._gameState.run.nextWavePreview?.vendettaHunter
      : undefined
    const _vendettaActive = _preVend !== undefined
      ? !!_preVend                       // preview present → use its decision
      : (vendetta && Math.random() < 0.35)   // no preview → original behavior
    if (vendetta && _vendettaActive) {
      const hunterClass = allClasses.find(c => c.id === vendetta.claimantClass) ?? classes[0]
      const vhSpawn = aiSystem.pickSpawnTile() ?? spawn
      const hunter = createAdventurer(hunterClass, { x: vhSpawn.x, y: vhSpawn.y })
      hunter.name      = `${vendetta.avengeeName.split(' ').slice(-1)[0]}'s Sibling`
      hunter.partyId   = partyId
      hunter.spawnTileX = vhSpawn.x
      hunter.spawnTileY = vhSpawn.y
      hunter.flags     = { vendettaMinionId: vendetta.minionInstanceId, vendettaItemId: vendetta.itemInstanceId }
      hunter.goal      = { type: 'SEEK_VENDETTA', minionId: vendetta.minionInstanceId, itemId: vendetta.itemInstanceId }
      this._gameState.adventurers.active.push(hunter)
      spawned.push(hunter)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: hunter })
      EventBus.emit('VENDETTA_HUNTER_ARRIVED', { adventurer: hunter, vendetta })
      vendettaHunter = hunter
    }

    // Bounty hunter (TRACKER) — when a dungeon minion has a bounty on its
    // head (earned at 3+ kills) AND has evolved into a stronger form, a
    // specialist hunter has a chance each day to enter specifically to
    // slay it. Spawned outside the wave count, like the vendetta hunter;
    // buffed above the event-pack mults so the rarer appearance still
    // bites, and pays out extra gold on death (shared GOLD_MULT).
    //
    // Suppressed during ANY active dungeon event — themed/buff/additive
    // events shouldn't have a non-themed bounty hunter shoehorned into
    // the same wave (Tournament's "3 named rivals" reads weird if a
    // generic hunter shows up too, PATCH 0.0.0's cheaters-only theme
    // breaks if a ranger sneaks in, etc.). Replacement events return
    // earlier in this function so this gate only needs the additive/
    // theme/buff flags.
    const _ef = this._gameState._eventFlags ?? {}
    const _eventActive = !!(
      patchZeroActive ||
      _ef.tournamentActive ||
      _ef.saboteurActive ||
      _ef.twitchConActive ||
      _ef.cosplayContestActive ||
      _ef.guildRaidActive ||
      _ef.infamySpikeActive ||
      _ef.negotiationOutcome === 'refuse'
    )
    const bountyTarget = _eventActive ? null : (this._gameState.minions ?? []).find(m =>
      m && m.hasBounty && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 &&
      Array.isArray(m.evolutionHistory) && m.evolutionHistory.length > 0)
    if (bountyTarget && Math.random() < Balance.BOUNTY_TRACKER_SPAWN_CHANCE) {
      const hClass = allClasses.find(c => c.id === 'ranger')
                  ?? classes[Math.floor(Math.random() * classes.length)]
      const bhSpawn = aiSystem.pickSpawnTile() ?? spawn
      const hunter = createAdventurer(hClass, { x: bhSpawn.x, y: bhSpawn.y })
      hunter.name       = 'Bounty Hunter'
      hunter.partyId    = partyId
      hunter.spawnTileX = bhSpawn.x
      hunter.spawnTileY = bhSpawn.y
      hunter.flags      = { bountyHunter: true, bountyTargetId: bountyTarget.instanceId }
      // Reuses SEEK_VENDETTA — the generic "hunt this specific minion" goal.
      hunter.goal       = { type: 'SEEK_VENDETTA', minionId: bountyTarget.instanceId }
      // Dedicated bounty-hunter LPC sprite. Gameplay class stays `ranger`
      // (its abilities still work); the renderer keys the spritesheet off
      // the class embedded in spriteVariant, so this paints the baked
      // bounty_hunter art. Falls back to the ranger sheet if unbaked.
      const _bhVariants = this.cache.json.get('adventurerManifest')?.variants?.bounty_hunter
      if (Array.isArray(_bhVariants) && _bhVariants.length) {
        const _bhv = _bhVariants[Math.floor(Math.random() * _bhVariants.length)]
        hunter.spriteVariant = `bounty_hunter/${_bhv.id}`
      }
      // Scaled like any adventurer, then buffed by the TRACKER mults
      // (stronger than the event pack — the rare appearance earns it).
      this._scaleAdventurerByBossLevel(hunter, dungeonLv)
      hunter.resources.maxHp = Math.round(hunter.resources.maxHp * Balance.BOUNTY_TRACKER_HP_MULT)
      hunter.resources.hp    = hunter.resources.maxHp
      hunter.stats.attack    = Math.round((hunter.stats.attack ?? 0) * Balance.BOUNTY_TRACKER_ATK_MULT)
      this._gameState.adventurers.active.push(hunter)
      spawned.push(hunter)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: hunter })
      EventBus.emit('BOUNTY_HUNTER_ARRIVED', { adventurer: hunter, minion: bountyTarget })
    }

    if (returningRecord) {
      // The veteran leads today's wave. Phase-8 logic ALSO clamped the
      // whole wave to a `KNOWLEDGE_RETURN_PARTY_SIZE_MAX` ceiling (4)
      // which was fine when natural waves were 3-5 advs, but by late
      // game (e.g. day 52 = ~70 base) that ceiling silently shrank the
      // wave to 4 — the user-reported "only 4 entered on day 52,
      // sometimes" bug, where 'sometimes' matched the
      // KNOWLEDGE_RETURN_CHANCE (35%) roll. The MAX constant was retired
      // 2026-05-27 (see balance.js); only the MIN floor remains so
      // veteran-led waves on very early days (when baseCount might be 1)
      // still spawn at least a 2-adv party.
      count = Math.max(baseCount, Balance.KNOWLEDGE_RETURN_PARTY_SIZE_MIN)
      // The returning veteran leads the wave, carrying their accumulated map.
      const leaderClass = allClasses.find(c => c.id === returningRecord.classId) ?? classes[0]
      const ldSpawn = aiSystem.pickSpawnTile() ?? spawn
      const leader = createAdventurer(leaderClass, { x: ldSpawn.x, y: ldSpawn.y })
      // Reuse the survivor's instanceId so identity carries across runs:
      // _updateSurvivorRecord finds the same record on a re-flee (runCount
      // keeps accumulating), and KnowledgeSystem._onAdventurerDied can purge
      // them from the survivor registry if they're killed this time.
      leader.instanceId     = returningRecord.instanceId
      leader.name           = returningRecord.name
      leader.personalityIds = [...(returningRecord.personalityIds ?? [])]
      leader.partyId        = partyId
      leader.spawnTileX     = ldSpawn.x
      leader.spawnTileY     = ldSpawn.y
      // Restore accumulated knowledge + set the returningVeteran /
      // runsCompleted flags the renderer + dossier read.
      knowledgeSystem.initKnowledgeForSurvivor(leader, returningRecord)
      // escapeCount drives the "VETERAN APPROACHING" toast fired off
      // ADVENTURER_ENTERED_DUNGEON below — must be set before that emit.
      leader.escapeCount = returningRecord.runCount ?? 1

      // Veterans scale with boss level like any adventurer, then take a
      // veteran bonus on top — tougher and harder-hitting than a fresh
      // recruit, since they already survived the dungeon once.
      this._scaleAdventurerByBossLevel(leader, dungeonLv)
      leader.resources.maxHp = Math.round(leader.resources.maxHp * Balance.KNOWLEDGE_VETERAN_HP_MULT)
      leader.resources.hp    = leader.resources.maxHp
      leader.stats.attack    = Math.round((leader.stats.attack ?? 0) * Balance.KNOWLEDGE_VETERAN_ATK_MULT)
      leader.flags.shoppedBetweenRuns = true

      // Phase 8b: hand the prior path samples over so ReplayGhostRenderer can draw them
      leader.priorPathHistory = [...(returningRecord.pathHistory ?? [])]

      this._gameState.adventurers.active.push(leader)
      spawned.push(leader)
      aiSystem.pickInitialGoal(leader)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: leader })
      EventBus.emit('VETERAN_APPROACHING', { adventurer: leader })
      EventBus.emit('ADVENTURER_RETURNED', {
        adventurer: leader,
        source: returningRecord,
        priorPathHistory: leader.priorPathHistory,
      })
      returnLeaderInjected = true
    }

    const cosplayActive = !!(this._gameState._eventFlags ?? {}).cosplayContestActive
    // Consume the night-time pre-rolled class list (NightPhase._rollNextWavePreview)
    // so the IncomingWave panel's preview matches the actual spawn. If the
    // preview is missing or stale, fall back to fresh Math.random picks.
    const _wavePreview = this._gameState.run?.nextWavePreview
    const _previewIds = (_wavePreview && _wavePreview.day === day && Array.isArray(_wavePreview.classIds))
      ? _wavePreview.classIds
      : null
    // Parallel spriteVariants array — NightPhase pre-rolled the exact
    // "<class>/vNN" for each adv so the IncomingWave panel can show
    // the actual character that arrives. Apply each variant after
    // createAdventurer so AdventurerRenderer._buildLpcSprite sees an
    // already-set spriteVariant and skips its own random pick.
    const _previewVariants = (_wavePreview && _wavePreview.day === day && Array.isArray(_wavePreview.spriteVariants))
      ? _wavePreview.spriteVariants
      : null
    // Phase QW (Library tiers) — also consume the night-pre-rolled
    // personalities so the AdvIntel forecast at night = the wave that
    // actually shows up at dawn. Falls back to fresh per-adv rolls when
    // no preview exists (legacy saves, replacement-event waves).
    const _previewPersonalities = (_wavePreview && _wavePreview.day === day && Array.isArray(_wavePreview.personalityIds))
      ? _wavePreview.personalityIds
      : null
    let _previewCursor = 0
    for (let i = (returnLeaderInjected ? 1 : 0); i < count; i++) {
     try {
      let cls
      let preRolledVariant = null
      if (_previewIds && _previewCursor < _previewIds.length) {
        cls = classes.find(c => c.id === _previewIds[_previewCursor]) || null
        // Only adopt the pre-rolled sprite variant when the previewed
        // class actually matched one in the live pool. When `cls` is
        // null the loop falls back to a class from `classes` below —
        // and a variant rolled for a *different* class would render the
        // wrong sprite (e.g. a cosplay-event adventurer wearing a stale
        // knight costume because the preview was rolled before the
        // event flag was set).
        if (cls && _previewVariants && _previewVariants[_previewCursor]) {
          preRolledVariant = _previewVariants[_previewCursor]
        }
        _previewCursor++
      }
      // Weighted fallback — respects per-class spawnWeight from the JSON
      // (default 1.0). Only used when the NightPhase preview didn't have
      // a slot for this index (e.g. baseCount grew mid-day).
      if (!cls) cls = pickWeightedClass(classes) ?? classes[0]
      // Each adventurer rolls its own entry hall (pickSpawnTile picks a
      // random connected entrance verified to reach the boss), so a wave
      // naturally splits across all of them and every adv starts on a
      // valid, path-connected tile. NO manual offset: the old code added
      // a per-index offset (floor(i/2) on Y) to de-stack advs sharing an
      // entry, but on a large wave that pushed late-index adventurers
      // many tiles off the entry hall — into walls — where they couldn't
      // path to their goal and instantly fled "can't find a way through".
      // The renderer snaps each adv to the doorway and staggers the
      // fade-in, so stacking on one tile is purely cosmetic.
      const advSpawn = aiSystem.pickSpawnTile() ?? spawn
      const tile     = { x: advSpawn.x, y: advSpawn.y }
      const adv      = createAdventurer(cls, tile)
      // Stamp the pre-rolled variant so the in-game LPC renderer uses
      // the same sprite the wave preview showed. Skipped when no
      // pre-roll exists (legacy saves, event-replacement spawns).
      if (preRolledVariant) adv.spriteVariant = preRolledVariant

      // Dungeon event: Cosplay Contest. Each adv has a 75% chance to be
      // "passive" (will not initiate combat with minions), the other 25%
      // engage normally. Passive cosplayers still retaliate when attacked
      // (CombatSystem flips _provoked when a minion lands a hit).
      if (cosplayActive) {
        adv._cosplay        = true
        adv._cosplayPassive = Math.random() < 0.75
      }

      // Phase 7b: scale adventurer stats with dungeon level
      this._scaleAdventurerByBossLevel(adv, dungeonLv)

      // Dungeon event: Infamy Spike — every adventurer in the wave is a
      // hardened hero (tougher, harder-hitting) and carries the `hero`
      // flag the renderer reads for the gold hero treatment + badge.
      if ((this._gameState._eventFlags ?? {}).infamySpikeActive) {
        adv.flags ??= {}
        adv.flags.hero = true
        adv.resources.maxHp = Math.round(adv.resources.maxHp * 1.6)
        adv.resources.hp    = adv.resources.maxHp
        adv.stats.attack    = Math.round((adv.stats.attack  ?? 0) * 1.5)
        adv.stats.defense   = Math.round((adv.stats.defense ?? 0) * 1.3)
      }

      // Flat 5% chance to promote the lead spawn to a legendary hero.
      if (i === 0 && !returnLeaderInjected && Math.random() < 0.05) {
        adv.isLegendary = true
        adv.name = `${adv.name} the Legendary`
        adv.resources.maxHp = Math.floor(adv.resources.maxHp * 1.5)
        adv.resources.hp    = adv.resources.maxHp
        adv.stats.attack    = Math.floor(adv.stats.attack * 1.4)
        adv.stats.defense   = Math.floor(adv.stats.defense * 1.3)
        EventBus.emit('LEGENDARY_HERO_ARRIVED', { adventurer: adv })
      }

      adv.partyId        = (count > 1 || returnLeaderInjected) ? partyId : null
      const pCount       = 1 + Math.floor((dungeonLv - 1) / 5)
      // Library-tiers pre-roll: prefer the night-stamped personalities
      // when the preview targets this slot. Cursor is offset by
      // returnLeaderInjected since the loop start (i = 1 when veteran
      // leads) is one ahead of the preview index. Falls back to a fresh
      // roll if no pre-roll exists for this slot (legacy saves, etc.).
      const _personalityIdx = i - (returnLeaderInjected ? 1 : 0)
      const _preRolledPersonalities = _previewPersonalities && _previewPersonalities[_personalityIdx]
      adv.personalityIds = (Array.isArray(_preRolledPersonalities) && _preRolledPersonalities.length > 0)
        ? [..._preRolledPersonalities]
        : (personalitySystem ? personalitySystem.rollPersonalities(pCount, dungeonLv) : [])

      // Fresh adventurers inherit the shared knowledge pool — the union
      // of every survivor's intel from prior days. With a returning
      // veteran in the party they get the full pool (the vet briefs
      // them); without one each entry is rolled at
      // KNOWLEDGE_FRESH_INHERIT_CHANCE so the wave's mental map is
      // patchy and varied.
      const inheritFraction = returnLeaderInjected
        ? 1.0
        : Balance.KNOWLEDGE_FRESH_INHERIT_CHANCE
      knowledgeSystem?.initKnowledgeForSpawn?.(adv, inheritFraction)
      // When a veteran leads the wave, inheritFraction is 1.0 (set above), so
      // every follower already inherits the full shared pool — which includes
      // the returning leader's accumulated intel. That satisfies the design
      // intent ("all of their party knowing what he knows from his last
      // visit") with no separate leader-briefing step.

      this._gameState.adventurers.active.push(adv)
      spawned.push(adv)
      aiSystem.pickInitialGoal(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
     } catch (err) {
      // Failsafe: a broken slot (corrupt class JSON, scaling math
      // hiccup, personality roll failure, etc.) skips just that
      // adventurer instead of aborting the whole wave. The rest of
      // the party still enters; if every slot throws, spawnNow's
      // post-spawn audit catches the empty result and rolls to night.
      console.error('[DayPhase] Skipped broken adventurer slot:', err, { index: i })
     }
    }

    // Detect + announce combos (only meaningful for parties of 2+)
    if (personalitySystem && spawned.length >= 2) {
      const combos = personalitySystem.emitCombosForParty(spawned, partyId)
      // Tag each combo on the participating adventurers (Phase 6+ effects read this)
      for (const combo of combos) {
        for (const adv of spawned) {
          adv.activeCombos ??= []
          if (!adv.activeCombos.includes(combo.id)) adv.activeCombos.push(combo.id)
        }
        // (combo banner already shown via emitCombosForParty)
      }
    }

    // Stamp a cosmetic display level on every spawned adventurer,
    // derived from the same boss-level / day scaling that buffs their
    // stats — so the UI's "LV" readouts climb as waves get genuinely
    // stronger. Level 1 = a day-1 baseline wave. Changes NO stats; this
    // is separate from `adv.level` (the XP / ability progression counter
    // the combat systems read), so combat behaviour is untouched.
    const _waveLevel = adventurerDisplayLevel(
      dungeonLv, dayNum,
      this._gameState?._mechanicFlags?.bloodMoneyHpBonus ?? 0,
    )
    for (const a of spawned) a.displayLevel = _waveLevel

    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    // Clear the consumed wave preview so a returning night-phase reroll
    // (or save-load) won't reuse stale class ids from yesterday.
    if (this._gameState.run?.nextWavePreview) {
      this._gameState.run.nextWavePreview = null
    }
    return spawned
  }

  // Dungeon event: Loot Goblin Heist. Spawns a pack of goblins INSIDE the
  // boss room with their goal pre-set to FLEE so they bolt for the entry
  // hall without ever engaging combat. Bypasses the normal class-pool gate
  // (loot_goblin has unlockLevel 99 so it never appears in regular waves).
  _spawnLootGoblinHeist() {
    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    if (!aiSystem) return []

    const bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return []
    const cx = bossRoom.gridX + Math.floor(bossRoom.width  / 2)
    const cy = bossRoom.gridY + Math.floor(bossRoom.height / 2)

    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const goblinDef  = allClasses.find(c => c.id === 'loot_goblin')
    if (!goblinDef) return []

    // Pack size grows post-day-9 in lockstep with the normal wave scaling
    // (mirrors _normalWaveSize / _spawnDailyAdventurers).
    const PACK_SIZE = 5 + Math.max(0, (this._gameState.meta?.dayNumber ?? 1) - 9)
      * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
    const partyId   = `loot_goblin_pack_${Date.now()}`
    const spawned   = []
    for (let i = 0; i < PACK_SIZE; i++) {
      const offset = i === 0 ? { x: 0, y: 0 } : { x: ((i % 2 === 0) ? 1 : -1), y: Math.floor(i / 2) }
      const tile   = { x: cx + offset.x, y: cy + offset.y }
      const adv    = createAdventurer(goblinDef, tile)
      adv.partyId  = partyId
      // Lock the goal to FLEE up-front so AISystem's normal goal picker
      // never chooses combat for them.
      adv.goal     = { type: 'FLEE', reason: 'loot_heist' }
      adv.aiState  = 'fleeing'
      // Tell AdventurerRenderer NOT to snap this adv to the entry-hall
      // doorway — they spawn inside the boss room and bolt for the exit
      // from there.
      adv._spawnedInPlace = true
      // Scale stats with boss level + day so late-game goblins are still
      // worth chasing (they're loaded with gold — they need to be hard to
      // catch). Applied after the spawn-in-place flag so the renderer's
      // entry-snapping logic isn't disturbed.
      this._scaleAdventurerByBossLevel(adv, this._gameState.boss?.level ?? 1)
      this._gameState.adventurers.active.push(adv)
      spawned.push(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
    }

    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    return spawned
  }

  // Dungeon event: Bounty Hunters. A full pack enters specifically to
  // slay the player's strongest minion — every hunter locks onto the
  // highest-level living minion via the generic SEEK_VENDETTA goal. If
  // the player has no minions, the hunters just seek the boss instead.
  _spawnBountyHunterWave() {
    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    if (!aiSystem) return []
    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const hClass = allClasses.find(c => c.id === 'ranger') ?? allClasses[0]
    if (!hClass) return []
    const dungeonLv = this._gameState.boss?.level ?? 1
    // Target = the player's highest-level living minion.
    const target = (this._gameState.minions ?? [])
      .filter(m => m && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0)
      .sort((a, b) => (b.level ?? 1) - (a.level ?? 1))[0] ?? null
    const bhVariants = this.cache.json.get('adventurerManifest')?.variants?.bounty_hunter
    // Pack size grows post-day-9 in lockstep with the normal wave scaling.
    const PACK_SIZE = 5 + Math.max(0, (this._gameState.meta?.dayNumber ?? 1) - 9)
      * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
    const partyId   = `bounty_pack_${Date.now()}`
    const spawned   = []
    // Consume the LPC variants NightPhase pre-rolled onto the preview so
    // the pack matches the IncomingWave panel; roll fresh otherwise.
    const _bhDay  = this._gameState.meta?.dayNumber ?? 1
    const _bhPrev = this._gameState.run?.nextWavePreview
    const _bhVarsPre = (_bhPrev && _bhPrev.day === _bhDay
      && _bhPrev.eventType === 'bountyHunters' && Array.isArray(_bhPrev.spriteVariants))
      ? _bhPrev.spriteVariants : null
    for (let i = 0; i < PACK_SIZE; i++) {
      const spawn = aiSystem.pickSpawnTile() ?? this._fallbackEntrySpawn()
      if (!spawn) break
      const offset = i === 0 ? { x: 0, y: 0 } : { x: ((i % 2 === 0) ? 1 : -1), y: Math.floor(i / 2) }
      const hunter = createAdventurer(hClass, { x: spawn.x + offset.x, y: spawn.y + offset.y })
      hunter.name       = 'Bounty Hunter'
      hunter.partyId    = partyId
      hunter.spawnTileX = spawn.x + offset.x
      hunter.spawnTileY = spawn.y + offset.y
      hunter.flags      = { bountyHunter: true }
      if (target) {
        hunter.flags.bountyTargetId = target.instanceId
        // SEEK_VENDETTA is the generic "hunt this specific minion" goal.
        hunter.goal = { type: 'SEEK_VENDETTA', minionId: target.instanceId }
      }
      if (_bhVarsPre?.[i]) {
        hunter.spriteVariant = _bhVarsPre[i]
      } else if (Array.isArray(bhVariants) && bhVariants.length) {
        const v = bhVariants[Math.floor(Math.random() * bhVariants.length)]
        hunter.spriteVariant = `bounty_hunter/${v.id}`
      }
      this._scaleAdventurerByBossLevel(hunter, dungeonLv)
      hunter.resources.maxHp = Math.round(hunter.resources.maxHp * Balance.BOUNTY_HUNTER_HP_MULT)
      hunter.resources.hp    = hunter.resources.maxHp
      hunter.stats.attack    = Math.round((hunter.stats.attack ?? 0) * Balance.BOUNTY_HUNTER_ATK_MULT)
      this._gameState.adventurers.active.push(hunter)
      if (!target) aiSystem.pickInitialGoal(hunter)
      spawned.push(hunter)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: hunter })
    }
    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    return spawned
  }

  // Dungeon event: Zombie Horde. A massive shamble of slow, weak undead
  // floods the dungeon. They use normal invader AI — maul anything in
  // their path, then push for the boss — and never flee. Rendered with
  // the zombie MINION sheets, varied across tiers 1-3 for visual variety.
  _spawnZombieHorde() {
    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    if (!aiSystem) return []
    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const chassis = allClasses.find(c => c.id === 'monster_invader') ?? allClasses[0]
    if (!chassis) return []
    const SHEETS = ['minion-zombie1', 'minion-zombie2', 'minion-zombie3']
    const partyId = `zombie_horde_${Date.now()}`
    const dungeonLv = this._gameState.boss?.level ?? 1
    // Horde size scales with boss level so the swarm grows over the run,
    // plus a post-day-9 escalation matching the normal wave formula.
    const HORDE_SIZE = Balance.ZOMBIE_HORDE_BASE
      + Balance.ZOMBIE_HORDE_PER_BOSS_LV * Math.max(0, dungeonLv - 1)
      + Math.max(0, (this._gameState.meta?.dayNumber ?? 1) - 9)
        * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
    const spawned = []
    // Consume the sheet set NightPhase pre-rolled onto the IncomingWave
    // preview so the horde matches what the intel panels showed; roll
    // fresh per-zombie if the preview is missing/stale.
    const _zDay  = this._gameState.meta?.dayNumber ?? 1
    const _zPrev = this._gameState.run?.nextWavePreview
    const _zSheets = (_zPrev && _zPrev.day === _zDay
      && _zPrev.eventType === 'zombieHorde' && Array.isArray(_zPrev.minionSheets))
      ? _zPrev.minionSheets : null
    for (let i = 0; i < HORDE_SIZE; i++) {
      // One fresh entry-hall door tile per zombie. pickSpawnTile only ever
      // returns a doorway verified to reach the boss, so every shambler
      // starts on a valid, path-connected tile. NO manual offset: the old
      // code added a per-index offset (floor(i/2) on Y) that pushed late
      // zombies in a large horde dozens of tiles off the entry — into
      // walls / out of bounds — where they couldn't path and instantly
      // fled "can't find a way through". The renderer snaps everyone to
      // the doorway and staggers the fade-in, so stacking on one tile is
      // purely cosmetic and resolves as they walk off. (Mirrors the
      // offset-free spawn in _spawnRivalDungeon.)
      const spawn = aiSystem.pickSpawnTile() ?? this._fallbackEntrySpawn()
      if (!spawn) break
      const z = createAdventurer(chassis, { x: spawn.x, y: spawn.y })
      z.name       = 'Shambler'
      z.partyId    = partyId
      z.spawnTileX = spawn.x
      z.spawnTileY = spawn.y
      // Slow, weak, relentless — and they never flee.
      z.resources.maxHp = Math.max(1, Math.round((z.resources.maxHp ?? 30) * 0.5))
      z.resources.hp    = z.resources.maxHp
      z.stats.attack    = Math.max(1, Math.round((z.stats.attack ?? 6) * 0.6))
      z.stats.speed     = (z.stats.speed ?? 1.4) * 0.55
      // `zombieShambler` is read by AISystem._kill to flat-2-gold the
      // kill payout — the horde is too large for default kill gold.
      z.flags = { noFlee: true, zombieShambler: true }
      // Scale with boss level + day like a normal adventurer (applied on
      // top of the slow/weak multipliers above) so a late-game horde is
      // still a real threat instead of trivial chip damage.
      this._scaleAdventurerByBossLevel(z, dungeonLv)
      // Monsters, not adventurers — suppresses chat bubbles + emotes and
      // plays the minion death animation (AdventurerRenderer / ChatBubbles
      // / EmoteSystem all key off `_monster`).
      z._monster = true
      // AdventurerRenderer keys off `_minionSheet`. Prefer the pre-rolled
      // sheet from the preview; otherwise vary across the three zombie
      // tiers so the horde doesn't read as identical clones.
      z._minionSheet = _zSheets?.[i]
        ?? SHEETS[Math.floor(Math.random() * SHEETS.length)]
      this._gameState.adventurers.active.push(z)
      aiSystem.pickInitialGoal(z)
      spawned.push(z)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: z })
    }
    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    return spawned
  }

  // Dungeon event: The Saboteur. A masked rogue joins the normal daily
  // wave (additive event). Tagged `_saboteur` + `_invulnerable`: AISystem
  // routes them trap-to-trap disabling each one for the day, minions
  // ignore them, and they take no damage. Once every trap is disabled
  // they flee. Fast-moving and dark-tinted (AdventurerRenderer) so the
  // sabotage run reads as a quick all-black-ninja montage.
  _spawnSaboteur() {
    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    if (!aiSystem) return []
    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const rogueDef = allClasses.find(c => c.id === 'rogue') ?? allClasses[0]
    if (!rogueDef) return []
    const spawn = aiSystem.pickSpawnTile() ?? this._fallbackEntrySpawn()
    if (!spawn) return []
    const adv = createAdventurer(rogueDef, { x: spawn.x, y: spawn.y })
    adv.name          = 'The Saboteur'
    adv._saboteur     = true
    adv._invulnerable = true
    adv.partyId       = null
    // Fast — the sabotage run should read as a quick montage.
    adv.stats.speed   = (adv.stats.speed ?? 1.4) * 2.0
    this._gameState.adventurers.active.push(adv)
    aiSystem.pickInitialGoal(adv)
    EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: [adv] })
    return [adv]
  }

  // Dungeon event: Legendary Speed Runner. One buffed adv replaces the
  // entire wave. Knight chassis (highest base HP) doubled in every stat,
  // tagged with `_speedrunner` so AISystem skips engagement and goal
  // detours and just beelines to the boss room. On kill, AISystem awards
  // a massive boss-XP bonus.
  _spawnLegendarySpeedrunner() {
    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    if (!aiSystem) return []

    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const chassis    = allClasses.find(c => c.id === 'knight')
                    ?? allClasses.find(c => c.id === 'barbarian')
                    ?? allClasses[0]
    if (!chassis) return []

    const spawn = aiSystem.pickSpawnTile()
                ?? this._fallbackEntrySpawn()
    if (!spawn) return []

    const adv = createAdventurer(chassis, { x: spawn.x, y: spawn.y })
    adv._speedrunner = true
    adv.isLegendary  = true
    adv.name = 'Speedy McRunner the Legendary'
    adv.resources.maxHp = adv.resources.maxHp * 2
    adv.resources.hp    = adv.resources.maxHp
    adv.stats.attack    = adv.stats.attack    * 2
    adv.stats.defense   = adv.stats.defense   * 2
    adv.stats.speed     = (adv.stats.speed ?? 1.4) * 2
    adv.partyId         = null

    // Compound the boss-level + post-day-9 scaling ON TOP of the manual
    // ×2 buffs above — a day-30 speedrunner needs to be vastly tougher
    // than a day-5 one to remain a legendary threat.
    this._scaleAdventurerByBossLevel(adv, this._gameState.boss?.level ?? 1)

    this._gameState.adventurers.active.push(adv)
    aiSystem.pickInitialGoal(adv)
    EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
    EventBus.emit('LEGENDARY_HERO_ARRIVED',     { adventurer: adv })
    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: [adv] })
    return [adv]
  }

  // Dungeon event: Cartographer's Convention. 3 scholars enter via the
  // normal entry, tagged `_cartographer = true` so AISystem skips
  // engagement and routes them through every non-boss room. When they
  // flee at the end of the tour they go through the standard
  // ADVENTURER_FLED → KnowledgeSystem._updateSurvivorRecord pipeline,
  // which automatically seeds tomorrow's wave with their map data.
  _spawnCartographers() {
    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    if (!aiSystem) return []

    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const scholarDef = allClasses.find(c => c.id === 'cartographer_scholar')
    if (!scholarDef) return []

    const spawn = aiSystem.pickSpawnTile() ?? this._fallbackEntrySpawn()
    if (!spawn) return []

    // Party size grows post-day-9 in lockstep with the normal wave scaling.
    const PARTY_SIZE = 3 + Math.max(0, (this._gameState.meta?.dayNumber ?? 1) - 9)
      * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
    const partyId    = `cartographers_${Date.now()}`
    const spawned    = []
    for (let i = 0; i < PARTY_SIZE; i++) {
      const offset = i === 0 ? { x: 0, y: 0 } : { x: ((i % 2 === 0) ? 1 : -1), y: 0 }
      // Each scholar rolls its own entry hall so the convention splits
      // across every connected entrance, same as a normal wave.
      const advSpawn = aiSystem.pickSpawnTile() ?? spawn
      const tile     = { x: advSpawn.x + offset.x, y: advSpawn.y + offset.y }
      const adv      = createAdventurer(scholarDef, tile)
      adv._cartographer = true
      adv.partyId       = partyId
      // Scale stats with boss level + day so late-game scholars survive
      // the dungeon long enough to finish the tour.
      this._scaleAdventurerByBossLevel(adv, this._gameState.boss?.level ?? 1)
      this._gameState.adventurers.active.push(adv)
      aiSystem.pickInitialGoal(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
      spawned.push(adv)
    }
    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    return spawned
  }

  // Dungeon event: The Tournament ("Bloodsport"). 3 named rivals enter
  // at the entry hall alongside the normal daily wave, each tagged
  // `_tournamentRival = true`. On spawn they SCATTER — every rival picks
  // a distinct random non-boss room and heads there. Once a rival reaches
  // its scatter room (or after a fallback timeout) AISystem flips it into
  // HUNT mode: it actively paths toward and kills the nearest living
  // OTHER rival. Last one standing then seeks the boss. Rivals never flee
  // (noFlee) — they're bloodsport contestants, fight to the death.
  _spawnTournamentRivals() {
    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    if (!aiSystem) return []

    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const rivalIds   = ['tournament_rival_warrior', 'tournament_rival_rogue', 'tournament_rival_mage']
    const rivalDefs  = rivalIds.map(id => allClasses.find(c => c.id === id)).filter(Boolean)
    if (rivalDefs.length < 3) return []

    const spawn = aiSystem.pickSpawnTile() ?? this._fallbackEntrySpawn()
    if (!spawn) return []

    // Scatter targets — distinct non-boss rooms, one per rival. Shuffled
    // so the trio fans out across the dungeon instead of converging on a
    // spawn-camp brawl at the entry. If there are fewer non-boss rooms
    // than rivals, rooms repeat (still better than all-stacked).
    const scatterRooms = (this._gameState.dungeon?.rooms ?? [])
      .filter(r => r.definitionId !== 'boss_chamber')
    for (let i = scatterRooms.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[scatterRooms[i], scatterRooms[j]] = [scatterRooms[j], scatterRooms[i]]
    }

    const spawned = []
    for (let i = 0; i < rivalDefs.length; i++) {
      const offset = i === 0 ? { x: 0, y: 0 } : { x: ((i % 2 === 0) ? 1 : -1), y: 0 }
      // Each rival rolls its own entry hall so the trio enters from across
      // the dungeon before scattering to their hunt rooms.
      const advSpawn = aiSystem.pickSpawnTile() ?? spawn
      const tile     = { x: advSpawn.x + offset.x, y: advSpawn.y + offset.y }
      const adv      = createAdventurer(rivalDefs[i], tile)
      adv._tournamentRival = true
      // Per-rival kill counter — drives the kill-buff stacking + sprite
      // growth. Starts at 0; EventSystem increments it on a rival-kill.
      adv._tournamentKills = 0
      // Bloodsport contestants never flee — fight to the death. Reuses
      // the same flag glory_hounds / schism set (AISystem._setFleeGoal).
      adv.flags = adv.flags ?? {}
      adv.flags.noFlee = true
      // Event-specific — Tournament rivals must never return as a Hero.
      adv.flags.eventAdventurer = true
      // Solo party id per rival — the rivalry is the entire point, no
      // shared-party perks.
      adv.partyId = `tournament_rival_${i}`
      // Scale stats with boss level + day so tournament rivals remain a
      // credible threat (and a real bloodsport) deep into the run.
      this._scaleAdventurerByBossLevel(adv, this._gameState.boss?.level ?? 1)
      this._gameState.adventurers.active.push(adv)
      // Scatter goal — head to a distinct non-boss room. AISystem flips
      // this to HUNT_RIVAL once the room is reached (or on timeout).
      const room = scatterRooms.length > 0
        ? scatterRooms[i % scatterRooms.length]
        : null
      if (room) {
        adv.goal = { type: 'SCATTER_ROOM', roomId: room.instanceId }
      } else {
        // Degenerate dungeon (no non-boss rooms) — go straight to HUNT.
        adv.goal = { type: 'HUNT_RIVAL' }
      }
      // Fallback timestamp — if the rival is still scattering past this
      // game-time it flips to HUNT regardless (set when day clock starts;
      // AISystem compares against scene.time.now).
      adv._scatterUntil = (game.time?.now ?? 0) + Balance.TOURNAMENT_SCATTER_FALLBACK_MS
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
      spawned.push(adv)
    }
    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    return spawned
  }

  // Dungeon event: Rival Dungeon. 4 rival monsters + 1 buffed rival
  // boss enter via the entry hall. Reuses adventurer infrastructure
  // wholesale — they're "adventurer-faction" so the player's minions
  // attack them naturally, and the rival boss reaching the boss room
  // triggers the existing boss-fight system (BossSystem handles the
  // arrival/death like any other adv reaching the throne).
  _spawnRivalDungeon() {
    const game = this.scene.get('Game')
    const aiSystem = game.aiSystem
    if (!aiSystem) return []

    const allClasses = this.cache.json.get('adventurerClasses') ?? []
    const monsterDef = allClasses.find(c => c.id === 'monster_invader')
    const bossDef    = allClasses.find(c => c.id === 'rival_boss_invader')
    if (!monsterDef || !bossDef) return []

    const spawn = aiSystem.pickSpawnTile() ?? this._fallbackEntrySpawn()
    if (!spawn) return []

    // The rival dungeon sends one monster per adventurer that would have
    // come in a normal wave today — so the invasion scales with the run —
    // but never fewer than the original pack of 4.
    const PACK_SIZE = Math.max(4, this._normalWaveSize())
    const partyId   = `rival_dungeon_${Date.now()}`
    const spawned   = []
    // The invading pack wears actual minion art (so the rival dungeon
    // reads as a monster horde, not humanoid adventurers). Consume the
    // sprite set NightPhase pre-rolled onto the IncomingWave preview so
    // the spawn matches exactly what the intel panels showed. The preview
    // only forecasts the first 4 monsters, so a fresh full-size roll
    // backs any extras beyond those previewed.
    const day = this._gameState.meta?.dayNumber ?? 1
    const _rdPreview = this._gameState.run?.nextWavePreview
    const _rdUsePreview = !!_rdPreview && _rdPreview.day === day
      && _rdPreview.eventType === 'rivalDungeon'
    const _rdRolled = rollRivalDungeonSprites(
      this.cache.json.get('minionEvolutions') ?? {},
      this._gameState.player?.bossArchetypeId, PACK_SIZE)
    const _rdMinionSheets = _rdRolled.minionSheets.slice()
    if (_rdUsePreview && Array.isArray(_rdPreview.minionSheets)) {
      _rdPreview.minionSheets.forEach((s, i) => { if (s) _rdMinionSheets[i] = s })
    }
    const _rdBossSkin = (_rdUsePreview && _rdPreview.bossSkin)
      ? _rdPreview.bossSkin
      : _rdRolled.bossSkin
    for (let i = 0; i < PACK_SIZE; i++) {
      // Per-monster spawn tile (the renderer snaps everyone to a doorway +
      // staggers the fade-in, so a manual offset is dead weight and just
      // risks landing a body on an unwalkable tile).
      const tile = aiSystem.pickSpawnTile() ?? this._fallbackEntrySpawn() ?? spawn
      const adv  = createAdventurer(monsterDef, tile)
      adv._monsterInvader = true
      adv.partyId         = partyId
      // A rival dungeon's troops are here to win — they commit, never flee.
      adv.flags = { ...(adv.flags ?? {}), noFlee: true }
      // Monsters, not adventurers — no chat bubbles / emotes, minion
      // death animation.
      adv._monster = true
      if (_rdMinionSheets[i]) adv._minionSheet = _rdMinionSheets[i]
      // Scale stats with boss level + day so the rival pack remains a
      // real fight in the late-game escalation window.
      this._scaleAdventurerByBossLevel(adv, this._gameState.boss?.level ?? 1)
      this._gameState.adventurers.active.push(adv)
      aiSystem.pickInitialGoal(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
      spawned.push(adv)
    }

    // Rival boss spawns last, slightly behind the pack. Marked as both
    // a monster invader (for any flag-based hooks) AND _rivalBoss for
    // the kill-bonus + simple AI override (always SEEK_BOSS).
    const bossTile = aiSystem.pickSpawnTile() ?? this._fallbackEntrySpawn() ?? spawn
    const rival    = createAdventurer(bossDef, bossTile)
    rival._monsterInvader = true
    rival._rivalBoss      = true
    rival.isLegendary     = true   // pulses the LEGENDARY_HERO_ARRIVED chrome
    rival.partyId         = partyId
    // The boss commits to the throne-room showdown — never flees.
    rival.flags = { ...(rival.flags ?? {}), noFlee: true }
    // A monster, not an adventurer — no chat bubbles / emotes.
    rival._monster = true
    // The rival boss is a T3 minion final-form — it renders with a
    // boss-archetype skin (pre-rolled above so it matches the preview).
    rival._rivalBossSpriteKey = _rdBossSkin
    rival.name = `${_rdBossSkin.charAt(0).toUpperCase() + _rdBossSkin.slice(1)} Champion`
    // Scale the rival boss like its pack — late-game throne showdowns
    // need to keep pace with the player's escalating power curve.
    this._scaleAdventurerByBossLevel(rival, this._gameState.boss?.level ?? 1)
    this._gameState.adventurers.active.push(rival)
    aiSystem.pickInitialGoal(rival)
    EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: rival })
    EventBus.emit('LEGENDARY_HERO_ARRIVED',     { adventurer: rival })
    spawned.push(rival)

    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    return spawned
  }

  // Best-estimate of how many adventurers a normal (event-free) wave
  // would field today — base growth + Treasury draw + flat boss-mechanic
  // extras. Mirrors the `baseCount` build-up in the regular spawn flow
  // (minus event modifiers). Used by replacement events (Rival Dungeon)
  // that want to match the wave the player would otherwise have faced.
  _normalWaveSize() {
    const day = this._gameState.meta?.dayNumber ?? 1
    let n = Balance.ADVENTURERS_PER_DAY_BASE + Math.floor((day - 1) / 2)
    // Post-day-9 wave-size escalation — matches _spawnDailyAdventurers.
    const postTenAdvs = Math.max(0, day - 9)
    if (postTenAdvs > 0) n += postTenAdvs * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
    const treasuryCount = (this._gameState.dungeon?.rooms ?? [])
      .filter(r => r.definitionId === 'treasury' && r.isActive !== false).length
    n += treasuryCount
    const mech = this._gameState._mechanicFlags ?? {}
    if (mech.goldRush) n += 1
    n += mech.extraAdvsPerDay ?? 0
    return Math.max(1, n)
  }

  // Reused by the speedrunner spawner — picks the entry hall doorway tile
  // when AISystem.pickSpawnTile rejects (e.g. a temporarily blocked path).
  // Same logic as the regular spawn fallback.
  _fallbackEntrySpawn() {
    const entries = this._gameState.dungeon.rooms.filter(r => r.definitionId === 'entry_hall')
    if (entries.length === 0) return null
    const entry = entries[Math.floor(Math.random() * entries.length)]
    return entryDoorTile(entry)
  }

  // Bug fix — visible "no entrance" banner when pickSpawnTile fails. Without
  // this, the day silently rolls over to night and the player has no idea why
  // adventurers never showed up.
  _showNoSpawnBanner() {
    const W = this.uiW
    const H = this.uiH
    const pw = 560, ph = 100
    const px = (W - pw) / 2
    const py = H / 2 - ph / 2

    const bg = this.add.graphics().setDepth(31)
    glowPanel(bg, px, py, pw, ph, {
      fill: 0x2a1004, border: 0xffaa44, glow: 0xcc6600,
    })
    const title = this.add.text(W / 2, py + 30, 'NO ENTRANCE TO YOUR DUNGEON', {
      fontSize: '14px', color: '#ffd99a', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(32)
    const sub = this.add.text(W / 2, py + 60,
      'Place a corridor or hallway connecting one of your rooms\n' +
      'to the boss chamber. Adventurers cannot find their way in.', {
        fontSize: '10px', color: '#ffeeaa', fontFamily: 'monospace',
        align: 'center',
      }).setOrigin(0.5).setDepth(32)

    // Auto-fade after 5s; player can manually dismiss
    this.time.delayedCall(5000, () => {
      this.tweens.add({
        targets: [bg, title, sub], alpha: 0, duration: 800,
        onComplete: () => { bg.destroy(); title.destroy(); sub.destroy() },
      })
    })
  }

  // Failsafe — fires when the day rolled in but zero adventurers ended
  // up in the active list AND no intentional-no-spawn reason was tagged
  // (the only intended case is Negotiation Pay, which sets
  // `_noSpawnReason='negotiation_pay'`). Logs full diagnostic context and
  // emits SPAWN_FAILSAFE_TRIGGERED — EventBanner.js picks that up and
  // renders the same themed DOM slate every Dungeon Event uses, so the
  // rest-day notification matches the rest of the event UI instead of
  // being a one-off Phaser panel. The actual day rollover is handled by
  // _refreshStats's all-out timer (1.5s) — same path a normally-cleared
  // wave takes.
  //
  // Diagnostic payload (day, boss level, entry count, every truthy event
  // flag) is included so a playtester encountering a multi-day streak can
  // read/screenshot the cause off-screen without opening devtools.
  _handleSpawnFailure() {
    const gs = this._gameState
    const day        = gs?.meta?.dayNumber
    const bossLevel  = gs?.boss?.level
    const entryHalls = (gs?.dungeon?.rooms ?? []).filter(r => r.definitionId === 'entry_hall').length
    const evFlags    = gs?._eventFlags ?? {}
    const activeFlags = Object.entries(evFlags)
      .filter(([_, v]) => v === true || (typeof v === 'string' && v))
      .map(([k, v]) => v === true ? k : `${k}=${v}`)
    console.error('[DayPhase] Wave failed to spawn — falling through to rest-day failsafe', {
      day, bossLevel,
      rooms:      gs?.dungeon?.rooms?.length,
      entryHalls,
      activeEventFlags: activeFlags,
      eventFlags:  evFlags,
      mechFlags:   gs?._mechanicFlags,
      scheduledId: gs?.events?.scheduledId,
    })
    EventBus.emit('SPAWN_FAILSAFE_TRIGGERED', {
      day, bossLevel, entryHalls, activeEventFlags: activeFlags,
    })
    // Paper trail in the in-game log so a player who misses the banner
    // can still see what happened later.
    EventBus.emit('SHOW_TOAST', {
      message: `Day ${day}: wave failed to arrive (events: ${activeFlags.join(', ') || 'none'})`,
      type:    'error',
    })
  }

  // ── Stats refresh ──────────────────────────────────────────────────────────

  _refreshStats() {
    // Phase 31C — UI moved to HudScene. We keep this method because it
    // also drives the all-adventurers-out → end-day auto-timer, but every
    // text update is null-guarded so we no-op on the missing legacy chrome.
    const s = this._gameState
    this._statsTexts?.topRight?.setText(
      `Gold: ${s.player.gold}  ·  XP: ${s.meta?.xp ?? 0}/${s.meta?.xpToNext ?? 100}  ·  Kills: ${s.player.totalKills}`
    )
    const n = s.adventurers.active.length
    if (n === 0 && this._allOutTimer == null) {
      this._statsTexts?.activeCount?.setText('All adventurers out — day ends shortly')
      this._allOutTimer = this.time.delayedCall(1500, () => this._endDay(), [], this)
    } else if (n > 0) {
      this._statsTexts?.activeCount?.setText(`Adventurers in dungeon: ${n}`)
    }
    // Sync END DAY button state — locked while live adventurers remain,
    // unlocked the instant the dungeon clears.
    this._refreshEndDayButton()
  }

  // Phase 31C — HUD chrome moved to HudScene. The day phase has no manual
  // "end wave" trigger — it auto-ends via the all-out timer in
  // _refreshStats once no adventurers remain. The primary action-bar
  // button instead cycles time scale (1× / 2× / 4×) during day phase
  // and emits TIME_SCALE_SET, which we apply via _setTimeScale.
  _wireHudEvents() {
    this._hudListeners = []
    const on = (event, fn) => {
      EventBus.on(event, fn, this)
      this._hudListeners.push([event, fn])
    }
    on('TIME_SCALE_SET', ({ scale }) => {
      if (typeof scale === 'number') this._setTimeScale(scale)
    })
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  _wireEvents() {
    const onChange = () => this._refreshStats()
    const onCombo = ({ combo }) => this._showComboBanner(combo)
    const onDeath = (data) => {
      onChange()
      this._showLastWords(data?.adventurer, data?.killerId)
    }

    const onFollow = ({ id, name }) => {
      if (!this._followText) return
      this._followText.setText(id && name ? `▶ ${name}` : '')
    }

    EventBus.on('ADVENTURER_DIED',              onDeath)
    EventBus.on('ADVENTURER_FLED',              onChange)
    EventBus.on('ADVENTURER_ENTERED_DUNGEON',   onChange)
    EventBus.on('CAMERA_FOLLOW_CHANGED',        onFollow)
    EventBus.on('PERSONALITY_COMBO_ACTIVATED',  onCombo)
    this._listeners = [
      ['ADVENTURER_DIED',             onDeath],
      ['ADVENTURER_FLED',             onChange],
      ['ADVENTURER_ENTERED_DUNGEON',  onChange],
      ['PERSONALITY_COMBO_ACTIVATED', onCombo],
      ['CAMERA_FOLLOW_CHANGED',       onFollow],
    ]
  }

  _showLastWords(adv, killerId) {
    if (!adv) return
    const data     = this.cache.json.get('lastWords') ?? {}
    const lookup   = data.byClassAndKiller ?? {}
    const byPers   = data.byPersonality    ?? {}

    // 30% chance: pick from the first matching personality that has lines
    let line = null
    if (Math.random() < 0.30) {
      const persPool = (adv.personalityIds ?? [])
        .flatMap(p => byPers[p] ?? [])
      if (persPool.length) line = persPool[Math.floor(Math.random() * persPool.length)]
    }

    if (!line) {
      const classBucket = lookup[adv.classId] ?? lookup.default ?? {}
      const killerKey   = this._resolveKillerKey(killerId)
      // Lookup chain (most specific → most generic):
      //   1. classBucket[killerKey]    — per-class per-killer-id (e.g.
      //                                   knight × "spike_pit")
      //   2. classBucket.trap          — per-class generic trap pool,
      //                                   only if killerId really is
      //                                   a trap (avoids matching
      //                                   "boss" or "minion" deaths)
      //   3. lookup.default[killerKey] — global per-killer-id fallback
      //                                   (e.g. shared "spike_pit"
      //                                   pool in the default class
      //                                   bucket — added 2026-05-27)
      //   4. classBucket.default       — per-class catch-all
      //   5. lookup.default.default    — global catch-all
      //   6. "..."                     — defensive
      //
      // The killer-key trap step exists because _resolveKillerKey
      // returns trap.definitionId for trap deaths and the legacy data
      // has hand-keyed generic "trap" pools per class — without step 2
      // those pools would never fire.
      const isTrapKiller = !!this._gameState.dungeon?.traps?.some(t => t.instanceId === killerId)
      const lines = classBucket[killerKey]
        ?? (isTrapKiller ? classBucket.trap : null)
        ?? lookup.default?.[killerKey]
        ?? classBucket.default
        ?? lookup.default?.default
        ?? ['...']
      line = lines[Math.floor(Math.random() * lines.length)]
    }

    // Render via the shared BubbleFactory — pixel-art square bubble
    // with blood-red border, wrapped Press Start 2P text (capped at
    // 3 lines). Lifecycle is the bubble's own fade-up + delayed fade-
    // out; lifeMs covers the visible hold, the factory handles the
    // exit tween.
    const gameScene = this.scene.get('Game')
    createBubble(gameScene, {
      x:      adv.worldX,
      y:      adv.worldY - 16,
      text:   `"${line}"`,
      kind:   'death',
      depth:  28,
      lifeMs: 2800,
    })
  }

  _resolveKillerKey(killerId) {
    if (!killerId) return 'default'
    if (killerId === 'boss') return 'boss'
    const trap = this._gameState.dungeon.traps?.find(t => t.instanceId === killerId)
    if (trap) return trap.definitionId
    const m = this._gameState.minions?.find(min => min.instanceId === killerId)
    if (m) return 'minion'
    return 'default'
  }

  _showComboBanner(combo) {
    const W = this.uiW
    const bw = Math.min(W - 80, 520)
    const bh = 44
    const bx = (W - bw) / 2
    const by = TOP_H + 12 + (this._comboBannerStack ?? 0) * (bh + 6)
    this._comboBannerStack = (this._comboBannerStack ?? 0) + 1

    const bg = this.add.graphics().setDepth(30)
    glowPanel(bg, bx, by, bw, bh, {
      fill: 0x180c2a, border: 0xc64bff, glow: 0x9b32d4,
    })

    const heading = this.add.text(bx + 14, by + 8, `☠…  ${combo.name.toUpperCase()}`, {
      fontSize: '11px', color: PALETTE.textAccent, fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(31)

    const sub = this.add.text(bx + 14, by + 24, combo.description, {
      fontSize: '9px', color: PALETTE.textNormal, fontFamily: 'monospace',
      wordWrap: { width: bw - 28 },
    }).setDepth(31)

    this.time.delayedCall(4500, () => {
      this.tweens.add({
        targets: [bg, heading, sub], alpha: 0, duration: 600,
        onComplete: () => {
          bg.destroy(); heading.destroy(); sub.destroy()
          this._comboBannerStack = Math.max(0, (this._comboBannerStack ?? 1) - 1)
        },
      })
    })
  }

  _unwireEvents() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  // ── End Day ────────────────────────────────────────────────────────────────

  _endDay() {
    if (this._allOutTimer) this._allOutTimer.remove(false)
    this._allOutTimer = null

    // Force-despawn anyone still in the dungeon
    const active = this._gameState.adventurers.active
    while (active.length > 0) active.shift()

    // Refill boss + minion HP for the next day.  Dead minions stay dead —
    // the player has to re-place them at night — but anyone still standing
    // tops up to full so the dungeon resets to a clean state each cycle.
    if (this._gameState.boss) {
      this._gameState.boss.hp = this._gameState.boss.maxHp
    }
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      if (m.resources?.maxHp > 0) m.resources.hp = m.resources.maxHp
    }

    this._gameState.meta.dayNumber++
    this._gameState.meta.phase = 'night'
    this._gameState.player.totalDaysElapsed++
    // Auto-save gated by SettingsOverlay GAMEPLAY > AUTOSAVE toggle.
    let _autosaveOn = true
    try { _autosaveOn = localStorage.getItem('qf.gameplay.autosave') !== 'false' } catch {}
    if (_autosaveOn) SaveSystem.save(this._gameState)
    EventBus.emit('DAY_PHASE_ENDED')
    // Phase 31F — pass the day-start snapshot through to EndOfDay so the
    // PostWaveSummary popup can compute per-day deltas + so EndOfDay
    // can detect a boss level-up that happened during the day and
    // gate the Dark Pact popup on it.
    this.scene.start('EndOfDay', {
      gameState:    this._gameState,
      daySnapshot:  this._daySnapshot,
    })
  }
}
