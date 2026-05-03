// BossArchetypeUI — floating UI strip for archetype-specific boss actions.
//
// Phase 1b.2: EARTHQUAKE button (Golem). Click → arm room target → next click
// on a tile → camera shake + room damage.
// Phase 1b.9: SACRIFICE button (Demon). Click → arm minion target → next
// click on one of the player's minions → that minion is permanently burned
// (no respawn) and a random adv in the dungeon dies.
//
// Sits anchored above the action bar; only renders archetype-specific
// buttons matching the current archetype + phase.

import { CRYPT, FONT_HEAD, pixelButton, showToast } from './UIKit.js'
import { EventBus } from '../systems/EventBus.js'

const BTN_W   = 132
const BTN_H   = 32
const PANEL_PAD = 6

export class BossArchetypeUI {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._depth     = opts.depth ?? 65

    this._W = scene.uiW ?? 1280
    this._H = scene.uiH ?? 720

    // Anchor: bottom-center, just above the action bar (which is BAR_H=76 + 6 margin).
    // Two button slots, side by side (only one ever visible at a time today).
    this._btnAX = Math.round(this._W / 2 - BTN_W / 2)
    this._btnAY = this._H - 76 - 6 - BTN_H - PANEL_PAD
    this._btnBX = this._btnAX
    this._btnBY = this._btnAY
    // Convenience aliases for the existing earthquake handler.
    this._btnX = this._btnAX
    this._btnY = this._btnAY

    this._earthquakeBtn = null
    this._sacrificeBtn  = null
    this._hint = null
    this._armed = false
    this._sacArmed = false

    this._listeners = []
    this._wireEvents()
    this._buildEarthquakeButton()
    this._buildSacrificeButton()
    this._refreshVisibility()
    this._maybeShowFirstUseToast()
  }

  // Poll `gameState.boss._golem.firstUseToastShown` on construction so the
  // toast pops the very first time the player enters Game with the golem
  // archetype, regardless of whether HudScene came up before or after the
  // BossArchetypeSystem initialized.
  _maybeShowFirstUseToast() {
    if (!this._isArchetypeGolem()) return
    const golem = this._gameState?.boss?._golem
    if (!golem) return
    if (golem.firstUseToastShown) return
    golem.firstUseToastShown = true
    showToast(this._scene,
      'EARTHQUAKE unlocked — during DAY, click the button then a room to deal massive damage',
      { type: 'success', duration: 5000 },
    )
  }

  _on(event, fn) {
    EventBus.on(event, fn, this)
    this._listeners.push([event, fn])
  }

  _wireEvents() {
    this._on('NIGHT_PHASE_BEGAN', () => this._refreshVisibility())
    this._on('DAY_PHASE_BEGAN',   () => this._refreshVisibility())
    this._on('NIGHT_PHASE_STARTED', () => this._refreshVisibility())
    // Phase 1b.4 — Lich Phylactery unlock toast.
    this._on('PHYLACTERY_UNLOCKED', () => {
      showToast(this._scene,
        'PHYLACTERY unlocked — open the ITEMS tab in build menu to place your Heart',
        { type: 'success', duration: 6000 },
      )
    })
    this._on('PHYLACTERY_REVIVED_BOSS', () => {
      showToast(this._scene,
        'PHYLACTERY consumed — boss revived. Defend the heart or it ends here.',
        { type: 'info', duration: 4500 },
      )
    })
    this._on('PHYLACTERY_DESTROYED', () => {
      showToast(this._scene,
        'Heart destroyed — your safety net is gone',
        { type: 'error', duration: 4500 },
      )
    })
    this._on('GOLEM_EARTHQUAKE_ARMED', () => {
      this._armed = true
      this._setEarthquakeArmedVisual(true)
      this._installRoomPickListener()
      showToast(this._scene, 'EARTHQUAKE armed — click a room to target', { type: 'info', duration: 3000 })
    })
    this._on('GOLEM_EARTHQUAKE_DISARMED', () => {
      this._armed = false
      this._setEarthquakeArmedVisual(false)
      this._removeRoomPickListener()
    })
    this._on('GOLEM_EARTHQUAKE_FIRED', (payload) => {
      this._armed = false
      this._setEarthquakeArmedVisual(false)
      this._removeRoomPickListener()
      this._playEarthquakeVfx(payload)
      this._refreshVisibility()
    })
    // Tick the button each phase change so its enabled state matches uses-left.
    this._on('GOLEM_EARTHQUAKE_FIRED', () => this._refreshVisibility())
    // Phase 1b.9 — Demon Sacrifice Pact wiring.
    this._on('DEMON_SACRIFICE_ARMED', () => {
      this._sacArmed = true
      this._setSacrificeArmedVisual(true)
      this._installMinionPickListener()
      showToast(this._scene, 'SACRIFICE armed — click one of your minions to burn', { type: 'info', duration: 3000 })
    })
    this._on('DEMON_SACRIFICE_DISARMED', () => {
      this._sacArmed = false
      this._setSacrificeArmedVisual(false)
      this._removeMinionPickListener()
    })
    this._on('DEMON_SACRIFICE_FIRED', (payload) => {
      this._sacArmed = false
      this._setSacrificeArmedVisual(false)
      this._removeMinionPickListener()
      this._playSacrificeVfx(payload)
      this._refreshVisibility()
    })
    this._on('DEMON_SACRIFICE_NO_TARGETS', () => {
      showToast(this._scene, 'No adventurers in the dungeon to sacrifice for', { type: 'error', duration: 2500 })
      this._sacArmed = false
      this._setSacrificeArmedVisual(false)
      this._removeMinionPickListener()
    })
    this._on('DEMON_HELLGATE_SPAWNED', (payload) => {
      const n = payload?.count ?? 0
      if (n > 0) showToast(this._scene, `Hellgate vomited ${n} imp${n === 1 ? '' : 's'}`, { type: 'success', duration: 2500 })
    })
    this._on('DEMON_SACRIFICE_BURN_VFX', (payload) => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.graphics) return
      const x = payload?.x, y = payload?.y
      if (typeof x !== 'number' || typeof y !== 'number') return
      const g = game.add.graphics().setDepth(200)
      // Outer orange ring + inner yellow flame pulse + dark core.
      g.fillStyle(0x441010, 0.7); g.fillCircle(x, y, 26)
      g.lineStyle(3, 0xff5522, 1); g.strokeCircle(x, y, 22)
      g.lineStyle(2, 0xffcc44, 0.95); g.strokeCircle(x, y, 14)
      g.fillStyle(0x110000, 0.85); g.fillCircle(x, y, 6)
      game.tweens.add({
        targets: g, alpha: 0, scaleX: 2.2, scaleY: 2.2,
        duration: 900, ease: 'Cubic.easeOut',
        onComplete: () => g.destroy(),
      })
    })
    // Phase 1b.10 — Vampire Charm + Blood Tax VFX + toasts.
    this._on('VAMPIRE_CHARM_MARKED', (payload) => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.graphics) return
      const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.advId)
      if (!adv) return
      // Persistent dark-red ring around the charmed adv until conversion.
      const g = game.add.graphics().setDepth(11)
      g.lineStyle(2, 0xcc1a44, 0.9); g.strokeCircle(adv.worldX, adv.worldY, 16)
      g.lineStyle(1, 0xff66aa, 0.7); g.strokeCircle(adv.worldX, adv.worldY, 22)
      game.tweens.add({
        targets: g, alpha: 0.25, yoyo: true, repeat: -1,
        duration: 600, ease: 'Sine.easeInOut',
      })
      // Stash on adv so we can clean up at conversion / death.
      adv._charmRingGfx = g
    })
    this._on('VAMPIRE_THRALL_CONVERTED', (payload) => {
      const game = this._scene.scene.get('Game')
      const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.advId)
      // The adv has already been spliced; look up by instanceId on a saved
      // reference. As a safe fallback, just kill any orphaned ring graphics
      // we might have hidden on the now-converted adv.
      if (adv?._charmRingGfx) { adv._charmRingGfx.destroy(); adv._charmRingGfx = null }
      if (game) {
        showToast(this._scene, 'A thrall joins your dungeon', { type: 'info', duration: 2200 })
      }
    })
    this._on('VAMPIRE_BLOOD_TAX_TICK', (payload) => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.graphics) return
      const fx = payload?.fromX, fy = payload?.fromY
      const tx = payload?.toX,   ty = payload?.toY
      if (typeof fx !== 'number' || typeof fy !== 'number') return
      if (typeof tx !== 'number' || typeof ty !== 'number') return
      const g = game.add.graphics().setDepth(190)
      g.lineStyle(2, 0xff2244, 0.95)
      g.lineBetween(fx, fy, tx, ty)
      g.lineStyle(1, 0xffaaaa, 0.7)
      g.lineBetween(fx, fy, tx, ty)
      game.tweens.add({
        targets: g, alpha: 0,
        duration: 450, ease: 'Cubic.easeOut',
        onComplete: () => g.destroy(),
      })
    })
    // Phase 1b.11 — Gnoll Bloodlust VFX: red flash + "+3% ATK" floater on
    // every alive gnoll-tagged minion, every time a stack lands.
    this._on('GNOLL_BLOODLUST_STACK', () => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.text) return
      const minions = this._gameState?.minions ?? []
      for (const m of minions) {
        if (!Array.isArray(m.tags) || !m.tags.includes('gnoll')) continue
        if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        // Red ring flash.
        const ring = game.add.graphics().setDepth(12)
        ring.lineStyle(2, 0xff3344, 0.95)
        ring.strokeCircle(m.worldX, m.worldY, 14)
        ring.lineStyle(1, 0xffaaaa, 0.6)
        ring.strokeCircle(m.worldX, m.worldY, 18)
        game.tweens.add({
          targets: ring, alpha: 0, duration: 360, ease: 'Cubic.easeOut',
          onComplete: () => ring.destroy(),
        })
        // "+3% ATK" floater that drifts up.
        const txt = game.add.text(m.worldX, m.worldY - 18, '+3% ATK', {
          fontFamily: 'monospace', fontSize: '8px',
          color: '#ff8866', stroke: '#1a0a0a', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(13)
        game.tweens.add({
          targets: txt,
          y: m.worldY - 36, alpha: 0,
          duration: 700, ease: 'Cubic.easeOut',
          onComplete: () => txt.destroy(),
        })
      }
    })
  }

  _buildEarthquakeButton() {
    this._earthquakeBtn = pixelButton(
      this._scene, this._btnX, this._btnY, BTN_W, BTN_H,
      'EARTHQUAKE', {
        depth:    this._depth,
        fontSize: 10,
        primary:  true,
        onClick:  () => this._onEarthquakeClick(),
      },
    )
  }

  _onEarthquakeClick() {
    if (!this._isArchetypeGolem()) return
    if (this._armed) {
      // Toggle off — disarm.
      EventBus.emit('GOLEM_EARTHQUAKE_DISARM')
      return
    }
    EventBus.emit('GOLEM_EARTHQUAKE_ARM')
  }

  _setEarthquakeArmedVisual(armed) {
    if (!this._earthquakeBtn) return
    this._earthquakeBtn.setLabel(armed ? 'PICK A ROOM' : 'EARTHQUAKE')
  }

  _buildSacrificeButton() {
    this._sacrificeBtn = pixelButton(
      this._scene, this._btnX, this._btnY, BTN_W, BTN_H,
      'SACRIFICE', {
        depth:    this._depth,
        fontSize: 10,
        danger:   true,
        onClick:  () => this._onSacrificeClick(),
      },
    )
  }

  _onSacrificeClick() {
    if (!this._isArchetypeDemon()) return
    if (this._sacArmed) {
      EventBus.emit('DEMON_SACRIFICE_DISARM')
      return
    }
    EventBus.emit('DEMON_SACRIFICE_ARM')
  }

  _setSacrificeArmedVisual(armed) {
    if (!this._sacrificeBtn) return
    this._sacrificeBtn.setLabel(armed ? 'PICK A MINION' : 'SACRIFICE')
  }

  _refreshVisibility() {
    const phase = this._gameState?.meta?.phase
    const golemActive = this._isArchetypeGolem() && phase === 'day'
    const demonActive = this._isArchetypeDemon() && phase === 'day'
    this._setEarthquakeBtnVisible(golemActive)
    this._setSacrificeBtnVisible(demonActive)

    if (golemActive) {
      const usesLeft = this._gameState?.boss?._golem?.earthquakeUsesLeft ?? 0
      this._earthquakeBtn?.setEnabled(usesLeft > 0)
    }
    if (demonActive) {
      const usesLeft = this._gameState?.boss?._demon?.sacrificeUsesLeft
        ?? this._gameState?._demon?.sacrificeUsesLeft ?? 0
      const haveMinion = (this._gameState?.minions ?? []).some(m =>
        m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && m.faction === 'dungeon',
      )
      this._sacrificeBtn?.setEnabled(usesLeft > 0 && haveMinion)
    }
  }

  _setEarthquakeBtnVisible(v) {
    if (!this._earthquakeBtn) return
    this._earthquakeBtn.bg.setVisible(v)
    this._earthquakeBtn.label.setVisible(v)
    this._earthquakeBtn.hit.input.enabled = v
  }

  _setSacrificeBtnVisible(v) {
    if (!this._sacrificeBtn) return
    this._sacrificeBtn.bg.setVisible(v)
    this._sacrificeBtn.label.setVisible(v)
    this._sacrificeBtn.hit.input.enabled = v
  }

  _isArchetypeGolem() {
    return this._gameState?.player?.bossArchetypeId === 'golem'
  }

  _isArchetypeDemon() {
    return this._gameState?.player?.bossArchetypeId === 'demon'
  }

  // Room-pick listener lives on the Game scene (where the dungeon renders).
  // Single-use: as soon as the player clicks once we resolve and disarm.
  _installRoomPickListener() {
    const game = this._scene.scene.get('Game')
    if (!game) return
    if (this._roomPickHandler) return
    this._roomPickHandler = (pointer) => {
      // Right-click cancels the targeting.
      if (pointer.rightButtonDown && pointer.rightButtonDown()) {
        EventBus.emit('GOLEM_EARTHQUAKE_DISARM')
        return
      }
      // Ignore clicks that fall inside the EARTHQUAKE button's screen rect —
      // the button's own onClick (pointerup) will handle the disarm. Without
      // this gate the pointerdown would resolve a phantom room from the
      // tile coords under the action-bar UI.
      if (this._isPointerOverEarthquakeBtn(pointer)) return
      const wp = pointer.positionToCamera(game.cameras.main)
      const tx = Math.floor(wp.x / 32)
      const ty = Math.floor(wp.y / 32)
      const room = game.dungeonGrid?.getRoomAtTile?.(tx, ty)
      if (!room) {
        showToast(this._scene, 'Click on a room', { type: 'error', duration: 1500 })
        return
      }
      EventBus.emit('GOLEM_EARTHQUAKE_TARGET', { roomId: room.instanceId })
    }
    game.input.on('pointerdown', this._roomPickHandler)
    this._roomPickGame = game
  }

  // Pointer screen coords are in HudScene's UI space. The button rect is in
  // the same space, so a direct AABB test works.
  _isPointerOverEarthquakeBtn(pointer) {
    const sf = this._scene?.cameras?.main?.zoom ?? 1
    const px = (pointer.x ?? 0) / sf
    const py = (pointer.y ?? 0) / sf
    return px >= this._btnX && px <= this._btnX + BTN_W
        && py >= this._btnY && py <= this._btnY + BTN_H
  }

  // Minion-pick listener for Sacrifice Pact. Resolves the closest live
  // dungeon-faction minion to the click position and emits the target
  // event. Cancels the targeting on right-click or click on the button.
  _installMinionPickListener() {
    const game = this._scene.scene.get('Game')
    if (!game) return
    if (this._minionPickHandler) return
    this._minionPickHandler = (pointer) => {
      if (pointer.rightButtonDown && pointer.rightButtonDown()) {
        EventBus.emit('DEMON_SACRIFICE_DISARM')
        return
      }
      if (this._isPointerOverSacrificeBtn(pointer)) return
      const wp = pointer.positionToCamera(game.cameras.main)
      const TS = 32
      const minions = this._gameState?.minions ?? []
      const HIT_R = TS * 0.7
      let best = null
      let bestD = Infinity
      for (const m of minions) {
        if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        if (m.faction !== 'dungeon') continue
        const d = Math.hypot(wp.x - m.worldX, wp.y - m.worldY)
        if (d > HIT_R) continue
        if (d < bestD) { bestD = d; best = m }
      }
      if (!best) {
        showToast(this._scene, 'Click on one of your minions', { type: 'error', duration: 1500 })
        return
      }
      EventBus.emit('DEMON_SACRIFICE_TARGET', { minionId: best.instanceId })
    }
    game.input.on('pointerdown', this._minionPickHandler)
    this._minionPickGame = game
  }

  _removeMinionPickListener() {
    if (!this._minionPickHandler || !this._minionPickGame) return
    this._minionPickGame.input.off('pointerdown', this._minionPickHandler)
    this._minionPickHandler = null
    this._minionPickGame    = null
  }

  _isPointerOverSacrificeBtn(pointer) {
    const sf = this._scene?.cameras?.main?.zoom ?? 1
    const px = (pointer.x ?? 0) / sf
    const py = (pointer.y ?? 0) / sf
    return px >= this._btnX && px <= this._btnX + BTN_W
        && py >= this._btnY && py <= this._btnY + BTN_H
  }

  // Sacrifice burn VFX — orange-red expanding ring at the burned minion's
  // last position, plus a fast pulse on the doomed adv. We get just the
  // ids in the payload, but since we already know death tiles via gameState
  // we look them up; if missing we just skip the visual (the gameplay
  // still resolved correctly).
  _playSacrificeVfx(payload) {
    const game = this._scene.scene.get('Game')
    if (!game?.add?.graphics) return
    // The burned minion is gone from gameState now, so we don't have its
    // tile — but the BossArchetypeSystem fired the burn graphic via the
    // DEMON_SACRIFICE_BURN_VFX event with x/y. The DEMON_SACRIFICE_FIRED
    // event itself only carries ids, so we just make a brief flash on the
    // victim adv (whose tile we still have).
    const victim = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.victimAdvId)
    if (!victim) return
    const g = game.add.graphics().setDepth(200)
    g.lineStyle(3, 0xff5522, 1)
    g.strokeCircle(victim.worldX, victim.worldY, 8)
    g.fillStyle(0xffaa44, 0.55)
    g.fillCircle(victim.worldX, victim.worldY, 14)
    game.tweens.add({
      targets: g,
      alpha: 0,
      duration: 700,
      onComplete: () => g.destroy(),
    })
  }

  _removeRoomPickListener() {
    if (!this._roomPickHandler || !this._roomPickGame) return
    this._roomPickGame.input.off('pointerdown', this._roomPickHandler)
    this._roomPickHandler = null
    this._roomPickGame    = null
  }

  // Camera shake on the Game scene + a small "EARTHQUAKE" floater above the
  // targeted room's center so the player can read what just happened.
  _playEarthquakeVfx(payload) {
    const game = this._scene.scene.get('Game')
    if (game?.cameras?.main?.shake) {
      game.cameras.main.shake(450, 0.012)
    }
    const room = payload?.room
    const dmg  = payload?.damage ?? 0
    if (room && game) {
      const TS = 32
      const cx = (room.gridX + room.width  / 2) * TS
      const cy = (room.gridY + room.height / 2) * TS
      const txt = game.add.text(cx, cy, `EARTHQUAKE\n-${dmg}`, {
        fontFamily: FONT_HEAD, fontSize: '14px',
        color: '#ffcc66', stroke: '#3a1a00', strokeThickness: 4,
        align: 'center',
      }).setOrigin(0.5).setDepth(200)
      game.tweens.add({
        targets: txt,
        y: cy - 36, alpha: 0,
        duration: 1100,
        onComplete: () => txt.destroy(),
      })
    }
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._removeRoomPickListener()
    this._earthquakeBtn?.destroy?.()
    this._hint?.destroy?.()
  }
}
