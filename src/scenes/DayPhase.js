import { EventBus }       from '../systems/EventBus.js'
import { SaveSystem }     from '../systems/SaveSystem.js'
import { Balance, adventurerDisplayLevel } from '../config/balance.js'
import { createAdventurer } from '../entities/Adventurer.js'
import { entryDoorTile }   from '../systems/DungeonGrid.js'
import { PALETTE, glowPanel, applyUiCamera } from '../ui/UIKit.js'
// CombatLog removed in Phase 31C — DungeonLog (HudScene right column) replaces it.
import { DossierPanel }   from '../ui/DossierPanel.js'
import { PauseManager }   from '../systems/PauseManager.js'

const TOP_H    = 48
const BOTTOM_H = 56

export class DayPhase extends Phaser.Scene {
  constructor() {
    super('DayPhase')
    this._gameState   = null
    this._timeScale   = Balance.TIME_SCALE_NORMAL
    this._timeBtns    = []  // { bg, txt, scale, x, y, w, h }
    this._statsTexts  = {}
    this._inspector   = null
    this._inspectedId = null
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
    const { width: W, height: H } = applyUiCamera(this)
    // Reset per-day idempotency guards. Phaser reuses the same scene
    // instance across day-start invocations, so without this reset
    // `_didSpawnToday` from yesterday persists and short-circuits today's
    // spawnNow() — leaving the day stuck with no adventurers.
    this._didSpawnToday = false
    // Phase 31C — top bar / stats row / follow indicator / bottom bar +
    // CombatLog all moved to HudScene (BossTopBar / DungeonLog / ActionBar).
    // The legacy methods stay on the class as dead code; their internal
    // stores (e.g., this._statsTexts) are never populated, so _refreshStats
    // and _refreshEndDayButton early-return.
    this._buildInspectorTemplate(W, H)
    this._setTimeScale(Balance.TIME_SCALE_NORMAL)

    this.input.keyboard?.on('keydown-ESC', () => PauseManager.toggle(this))
    // Time-scale keyboard shortcuts (replaces the bottom-bar buttons that
    // were removed with the chrome strip). Numeric digits work without modifiers.
    this.input.keyboard?.on('keydown-SPACE', () => this._setTimeScale(Balance.TIME_SCALE_PAUSED))
    this.input.keyboard?.on('keydown-ONE',   () => this._setTimeScale(Balance.TIME_SCALE_NORMAL))
    this.input.keyboard?.on('keydown-TWO',   () => this._setTimeScale(Balance.TIME_SCALE_FAST))
    this.input.keyboard?.on('keydown-FOUR',  () => this._setTimeScale(Balance.TIME_SCALE_FASTEST))
    this.input.keyboard?.on('keydown-EIGHT', () => this._setTimeScale(Balance.TIME_SCALE_ULTRA))

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
      const spawned = this._spawnDailyAdventurers() ?? []
      this._refreshStats()
      if (spawned.length > 0) this._focusCameraOnEntry()
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

  // Brief camera pan + zoom to the entry_hall so the player can watch the
  // first adventurer(s) physically enter the dungeon.
  _focusCameraOnEntry() {
    const entry = this._gameState.dungeon.rooms.find(r => r.definitionId === 'entry_hall')
    if (!entry) return
    const gameScene = this.scene.get('Game')
    const cam = gameScene?.cameras?.main
    if (!cam) return

    const TS = Balance.TILE_SIZE
    const wx = (entry.gridX + entry.width / 2) * TS
    const wy = (entry.gridY + entry.height / 2) * TS
    const targetZoom = Math.min(1.4, Balance.CAMERA_ZOOM_MAX)
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
      `${a.name} (${this._capitalize(a.classId ?? '?')})`
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

  // ── Inspector panel (right side) ───────────────────────────────────────────

  _buildInspectorTemplate(W, H) {
    const pw = 260
    const ph = 280
    const px = W - pw - 16
    const py = TOP_H + 16

    const g = this.add.graphics().setDepth(25).setVisible(false)
    glowPanel(g, px, py, pw, ph, {
      fill: 0x06060e, border: 0xddaa22, glow: 0x886600,
    })

    const heading = this.add.text(px + 12, py + 10, '', {
      fontSize: '12px', color: PALETTE.textGold, fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(26).setVisible(false)

    const subtitle = this.add.text(px + 12, py + 26, '', {
      fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
    }).setDepth(26).setVisible(false)

    const body = this.add.text(px + 12, py + 50, '', {
      fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace',
      lineSpacing: 4, wordWrap: { width: pw - 24 },
    }).setDepth(26).setVisible(false)

    const closeBtn = this.add.text(px + pw - 12, py + 8, '×', {
      fontSize: '16px', color: PALETTE.textDim, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(27).setInteractive({ useHandCursor: true }).setVisible(false)
    closeBtn.on('pointerdown', () => this._closeInspector())

    this._inspector = { g, heading, subtitle, body, closeBtn, px, py, pw, ph }
  }

  _showInspector(adv) {
    this._inspectedId = adv.instanceId
    const ps = this.scene.get('Game').personalitySystem
    const i  = this._inspector
    i.heading.setText(adv.name)
    i.subtitle.setText(`${this._capitalize(adv.classId)}  ·  ${adv.aiState}`)

    const personalityNames = (adv.personalityIds ?? [])
      .map(pid => ps?.getDefinition(pid)?.name ?? pid)
      .join(' / ') || '—'

    const goalText = adv.goal.type === 'EXPLORE_ROOM'
      ? `EXPLORE_ROOM (${(adv.goal.roomId ?? '').slice(0, 12)})`
      : adv.goal.type

    const lines = [
      `HP         ${adv.resources.hp}/${adv.resources.maxHp}`,
      `Attack     ${adv.stats.attack}`,
      `Defense    ${adv.stats.defense}`,
      `Speed      ${adv.stats.speed.toFixed(1)} t/s`,
      ``,
      `Personality`,
      `  ${personalityNames}`,
      ``,
      `Goal       ${goalText}`,
      `Visited    ${adv.visitedRooms?.length ?? 0} rooms`,
      `Party      ${adv.partyId ? adv.partyId.slice(0, 14) : 'solo'}`,
    ]
    // Phase 5c — combos retired; row removed.
    i.body.setText(lines.join('\n'))
    ;[i.g, i.heading, i.subtitle, i.body, i.closeBtn].forEach(o => o.setVisible(true))
  }

  _closeInspector() {
    this._inspectedId = null
    const i = this._inspector
    ;[i.g, i.heading, i.subtitle, i.body, i.closeBtn].forEach(o => o.setVisible(false))
  }

  _capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : '' }

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
    if (lvOver === 0 && dayOver === 0 && bloodMoneyBonus === 0) return
    const hpMul  = 1 + Balance.ADVENTURER_HP_PER_BOSS_LV  * lvOver
                     + Balance.ADVENTURER_HP_PER_DAY        * dayOver
                     + bloodMoneyBonus
    const atkMul = 1 + Balance.ADVENTURER_ATK_PER_BOSS_LV * lvOver
                     + Balance.ADVENTURER_ATK_PER_DAY       * dayOver
    adv.resources.maxHp = Math.round(adv.resources.maxHp * hpMul)
    adv.resources.hp    = adv.resources.maxHp
    adv.stats.attack    = Math.round(adv.stats.attack * atkMul)
  }

  // Returning leader briefs party members: copies leader's known rooms/traps/minions
  // with 'told' source so the adventurer treats them as known but second-hand.
  _copyLeaderKnowledgeToFollower(leader, follower) {
    follower.knowledge ??= { rooms: {}, traps: {}, minions: {} }
    for (const [roomId, entry] of Object.entries(leader.knowledge?.rooms ?? {})) {
      if (!follower.knowledge.rooms[roomId]) {
        follower.knowledge.rooms[roomId] = { ...entry, source: 'told', visited: false, visitCount: 0 }
      }
    }
    for (const [trapId, entry] of Object.entries(leader.knowledge?.traps ?? {})) {
      if (!follower.knowledge.traps[trapId]) {
        follower.knowledge.traps[trapId] = { ...entry, source: 'told' }
      }
    }
    for (const [minionId, entry] of Object.entries(leader.knowledge?.minions ?? {})) {
      if (!follower.knowledge.minions[minionId]) {
        follower.knowledge.minions[minionId] = { ...entry, source: 'told' }
      }
    }
  }

  // ── Spawn ──────────────────────────────────────────────────────────────────

  _spawnDailyAdventurers() {
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

    let spawn = aiSystem.pickSpawnTile()
    if (!spawn) {
      // pickSpawnTile rejects when there's no verified path from entry to
      // boss.  Fall back to the entry hall centre so at least one
      // adventurer always shows up — they may flee on the first tick if
      // the dungeon is genuinely disconnected, but the player sees
      // activity instead of an empty day.  The banner still warns them
      // about the broken connectivity.
      const entry = this._gameState.dungeon.rooms.find(r => r.definitionId === 'entry_hall')
      if (entry) {
        // Match AISystem.pickSpawnTile — drop the adventurer at the entry
        // hall doorway so the entry contract stays consistent on fallback.
        spawn = entryDoorTile(entry)
        this._statsTexts.activeCount.setText('Adventurers can\'t reach your boss — fix the path.')
        this._showNoSpawnBanner()
      } else {
        this._statsTexts.activeCount.setText('No entry hall — build one for adventurers.')
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
    if (classes.length === 0) return

    const day   = this._gameState.meta.dayNumber
    let baseCount = Balance.ADVENTURERS_PER_DAY_BASE + Math.floor((day - 1) / 2)
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
    // Phase 9: Doomsday Clock — force the doomsday raid to exactly the
    // promised size. Other modifiers (Gilded Demise extras, etc.) are
    // overridden so the card's "4 adventurers" claim holds even when they
    // stack onto the same day.
    if ((this._gameState._mechanicFlags ?? {}).doomsdayRaidToday) {
      baseCount = Balance.MECHANIC_DOOMSDAY_RAID_SIZE
    }
    // Phase 9: Architect's Vision + Summon Adds III — flat extra adv count per day.
    const extraAdvs = (this._gameState._mechanicFlags ?? {}).extraAdvsPerDay ?? 0
    if (extraAdvs > 0) baseCount += extraAdvs
    // Dungeon event: Guild Raid — double the day's wave size as steady
    // pressure (longer wave, not a single surge — handled here at the
    // baseCount stage so the existing trickle/cadence logic stretches it
    // automatically).
    if ((this._gameState._eventFlags ?? {}).guildRaidActive) baseCount *= 2
    // Dungeon event: Negotiation Day — outcome was decided during the
    // prior night via the SHOW_CONFIRM modal. PAY = no adventurers today
    // (free day). REFUSE = today's wave is +50%. Both apply to the same
    // day the modal called "tomorrow", so the player's framing matches.
    const eventFlags = this._gameState._eventFlags ?? {}
    if (eventFlags.negotiationOutcome === 'pay')    return []
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
    let count = Math.min(baseCount, classes.length * 2)

    // Phase 7b: vendetta hunter spawn — if active vendettas, 35% chance
    // one shows up. NightPhase pre-rolls this and stores the outcome on
    // `nextWavePreview.vendettaHunter` so the IncomingWave panel matches
    // what actually spawns. Consume the pre-roll if it targets today;
    // otherwise fall back to the original Math.random gate.
    const vendetta = this._pickActiveVendetta()
    let vendettaHunter = null
    const _preVend = (this._gameState.run?.nextWavePreview?.day === day)
      ? this._gameState.run.nextWavePreview?.vendettaHunter
      : undefined
    const _vendettaActive = _preVend !== undefined
      ? !!_preVend                       // preview present → use its decision
      : (vendetta && Math.random() < 0.35)   // no preview → original behavior
    if (vendetta && _vendettaActive) {
      const hunterClass = allClasses.find(c => c.id === vendetta.claimantClass) ?? classes[0]
      const hunter = createAdventurer(hunterClass, { x: spawn.x, y: spawn.y })
      hunter.name      = `${vendetta.avengeeName.split(' ').slice(-1)[0]}'s Sibling`
      hunter.partyId   = partyId
      hunter.spawnTileX = spawn.x
      hunter.spawnTileY = spawn.y
      hunter.flags     = { vendettaMinionId: vendetta.minionInstanceId, vendettaItemId: vendetta.itemInstanceId }
      hunter.goal      = { type: 'SEEK_VENDETTA', minionId: vendetta.minionInstanceId, itemId: vendetta.itemInstanceId }
      this._gameState.adventurers.active.push(hunter)
      spawned.push(hunter)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: hunter })
      EventBus.emit('VENDETTA_HUNTER_ARRIVED', { adventurer: hunter, vendetta })
      vendettaHunter = hunter
    }

    if (returningRecord) {
      const partySize = Math.min(
        Math.max(Balance.KNOWLEDGE_RETURN_PARTY_SIZE_MIN, baseCount),
        Balance.KNOWLEDGE_RETURN_PARTY_SIZE_MAX
      )
      count = partySize
      // The returning veteran leads the wave, carrying their accumulated map.
      const leaderClass = allClasses.find(c => c.id === returningRecord.classId) ?? classes[0]
      const leader = createAdventurer(leaderClass, { x: spawn.x, y: spawn.y })
      // Reuse the survivor's instanceId so identity carries across runs:
      // _updateSurvivorRecord finds the same record on a re-flee (runCount
      // keeps accumulating), and KnowledgeSystem._onAdventurerDied can purge
      // them from the survivor registry if they're killed this time.
      leader.instanceId     = returningRecord.instanceId
      leader.name           = returningRecord.name
      leader.personalityIds = [...(returningRecord.personalityIds ?? [])]
      leader.partyId        = partyId
      leader.spawnTileX     = spawn.x
      leader.spawnTileY     = spawn.y
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
    let _previewCursor = 0
    for (let i = (returnLeaderInjected ? 1 : 0); i < count; i++) {
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
      if (!cls) cls = classes[Math.floor(Math.random() * classes.length)]
      const offset = i === 0 ? { x: 0, y: 0 } : { x: (i % 2 === 0 ? 1 : -1), y: Math.floor(i / 2) }
      const tile   = { x: spawn.x + offset.x, y: spawn.y + offset.y }
      const adv    = createAdventurer(cls, tile)
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
      adv.personalityIds = personalitySystem
        ? personalitySystem.rollPersonalities(pCount, dungeonLv)
        : []

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

      // If there's a returning leader, the rest of the party also gets the leader's
      // knowledge as "told" (full intel, slightly degraded accuracy) — design intent:
      // "with all of their party knowing what he knows from his last visit"
      if (returnLeaderInjected && spawned[0]?.knowledge) {
        this._copyLeaderKnowledgeToFollower(spawned[0], adv)
      }

      this._gameState.adventurers.active.push(adv)
      spawned.push(adv)
      aiSystem.pickInitialGoal(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
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

    const PACK_SIZE = 5
    const partyId   = `loot_goblin_pack_${Date.now()}`
    const spawned   = []
    for (let i = 0; i < PACK_SIZE; i++) {
      const offset = i === 0 ? { x: 0, y: 0 } : { x: ((i % 2 === 0) ? 1 : -1), y: Math.floor(i / 2) }
      const tile   = { x: cx + offset.x, y: cy + offset.y }
      const adv    = createAdventurer(goblinDef, tile)
      adv.partyId  = partyId
      // Skip stat scaling and personalities — goblins are pure mooks. Lock
      // the goal to FLEE up-front so AISystem's normal goal picker never
      // chooses combat for them.
      adv.goal     = { type: 'FLEE', reason: 'loot_heist' }
      adv.aiState  = 'fleeing'
      // Tell AdventurerRenderer NOT to snap this adv to the entry-hall
      // doorway — they spawn inside the boss room and bolt for the exit
      // from there.
      adv._spawnedInPlace = true
      this._gameState.adventurers.active.push(adv)
      spawned.push(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
    }

    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    return spawned
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

    const PARTY_SIZE = 3
    const partyId    = `cartographers_${Date.now()}`
    const spawned    = []
    for (let i = 0; i < PARTY_SIZE; i++) {
      const offset = i === 0 ? { x: 0, y: 0 } : { x: ((i % 2 === 0) ? 1 : -1), y: 0 }
      const tile   = { x: spawn.x + offset.x, y: spawn.y + offset.y }
      const adv    = createAdventurer(scholarDef, tile)
      adv._cartographer = true
      adv.partyId       = partyId
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
      const tile   = { x: spawn.x + offset.x, y: spawn.y + offset.y }
      const adv    = createAdventurer(rivalDefs[i], tile)
      adv._tournamentRival = true
      // Per-rival kill counter — drives the kill-buff stacking + sprite
      // growth. Starts at 0; EventSystem increments it on a rival-kill.
      adv._tournamentKills = 0
      // Bloodsport contestants never flee — fight to the death. Reuses
      // the same flag glory_hounds / schism set (AISystem._setFleeGoal).
      adv.flags = adv.flags ?? {}
      adv.flags.noFlee = true
      // Solo party id per rival — the rivalry is the entire point, no
      // shared-party perks.
      adv.partyId = `tournament_rival_${i}`
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

    const PACK_SIZE = 4
    const partyId   = `rival_dungeon_${Date.now()}`
    const spawned   = []
    for (let i = 0; i < PACK_SIZE; i++) {
      const offset = i === 0 ? { x: 0, y: 0 } : { x: ((i % 2 === 0) ? 1 : -1), y: Math.floor(i / 2) }
      const tile   = { x: spawn.x + offset.x, y: spawn.y + offset.y }
      const adv    = createAdventurer(monsterDef, tile)
      adv._monsterInvader = true
      adv.partyId         = partyId
      this._gameState.adventurers.active.push(adv)
      aiSystem.pickInitialGoal(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
      spawned.push(adv)
    }

    // Rival boss spawns last, slightly behind the pack. Marked as both
    // a monster invader (for any flag-based hooks) AND _rivalBoss for
    // the kill-bonus + simple AI override (always SEEK_BOSS).
    const bossTile = { x: spawn.x, y: spawn.y - 1 }
    const rival    = createAdventurer(bossDef, bossTile)
    rival._monsterInvader = true
    rival._rivalBoss      = true
    rival.isLegendary     = true   // pulses the LEGENDARY_HERO_ARRIVED chrome
    rival.partyId         = partyId
    // Pick a random boss-archetype sprite for the rival (exclude the
    // player's own archetype so the visual contrast reads). Save-stable.
    const playerArchetype = this._gameState.player?.bossArchetypeId
    const ARCHETYPES = ['beholder','demon','gnoll','golem','lich','lizardman','myconid','orc','vampire','wraith']
    const candidates = ARCHETYPES.filter(a => a !== playerArchetype)
    rival._rivalBossSpriteKey = candidates[Math.floor(Math.random() * candidates.length)]
    rival.name = `${rival._rivalBossSpriteKey.charAt(0).toUpperCase() + rival._rivalBossSpriteKey.slice(1)} Pretender`
    this._gameState.adventurers.active.push(rival)
    aiSystem.pickInitialGoal(rival)
    EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: rival })
    EventBus.emit('LEGENDARY_HERO_ARRIVED',     { adventurer: rival })
    spawned.push(rival)

    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    return spawned
  }

  // Reused by the speedrunner spawner — picks the entry hall doorway tile
  // when AISystem.pickSpawnTile rejects (e.g. a temporarily blocked path).
  // Same logic as the regular spawn fallback.
  _fallbackEntrySpawn() {
    const entry = this._gameState.dungeon.rooms.find(r => r.definitionId === 'entry_hall')
    if (!entry) return null
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
    const onClick = ({ adventurer }) => this._showInspector(adventurer)
    const onChange = () => {
      this._refreshStats()
      if (this._inspectedId &&
          !this._gameState.adventurers.active.some(a => a.instanceId === this._inspectedId)) {
        this._closeInspector()
      }
      if (this._inspectedId) {
        const adv = this._gameState.adventurers.active.find(a => a.instanceId === this._inspectedId)
        if (adv) this._showInspector(adv)
      }
    }
    const onCombo = ({ combo }) => this._showComboBanner(combo)
    const onDeath = (data) => {
      onChange()
      this._showLastWords(data?.adventurer, data?.killerId)
    }

    const onFollow = ({ id, name }) => {
      if (!this._followText) return
      this._followText.setText(id && name ? `▶ ${name}` : '')
    }

    EventBus.on('ADVENTURER_CLICKED',           onClick)
    EventBus.on('ADVENTURER_DIED',              onDeath)
    EventBus.on('ADVENTURER_FLED',              onChange)
    EventBus.on('ADVENTURER_ENTERED_DUNGEON',   onChange)
    EventBus.on('CAMERA_FOLLOW_CHANGED',        onFollow)
    EventBus.on('PERSONALITY_COMBO_ACTIVATED',  onCombo)
    this._listeners = [
      ['ADVENTURER_CLICKED',          onClick],
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
      const lines = classBucket[killerKey] ?? classBucket.default ?? lookup.default?.default ?? ['...']
      line = lines[Math.floor(Math.random() * lines.length)]
    }

    // Add to the Game scene at world-space coords so the camera handles
    // zoom/scroll projection automatically (avoids manual world→screen math).
    const gameScene = this.scene.get('Game')
    const wx = adv.worldX
    const wy = adv.worldY - 16

    const txt = gameScene.add.text(wx, wy, `"${line}"`, {
      fontSize: '9px', color: PALETTE.textBright, fontFamily: 'monospace',
      fontStyle: 'italic', backgroundColor: '#10141c', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1).setDepth(28).setAlpha(0)

    gameScene.tweens.add({
      targets: txt, alpha: 1, y: wy - 8, duration: 220,
      onComplete: () => {
        gameScene.time.delayedCall(2500, () => {
          gameScene.tweens.add({
            targets: txt, alpha: 0, y: wy - 20, duration: 600,
            onComplete: () => txt.destroy(),
          })
        })
      },
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
