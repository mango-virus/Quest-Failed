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
    // Under the new DOM HUD, the EARTHQUAKE / SACRIFICE buttons are
    // rendered by src/hud/BossArchetypeStrip.js to match the chrome's
    // theme. The Phaser VFX wiring above stays — only the player-facing
    // buttons skip. Detection mirrors isNewHudEnabled() without pulling
    // in the import (this file lives in src/ui/ which shouldn't depend
    // on src/hud/).
    let _useNewHud = true
    try { _useNewHud = localStorage.getItem('newhud') !== '0' } catch {}
    if (!_useNewHud) {
      this._buildEarthquakeButton()
      this._buildSacrificeButton()
    }
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
    // Elder Lich THE WITHERING — Channel Souls room-targeting. The DOM strip
    // arms it; this installs the Game-scene room-pick that fires the spell.
    this._on('LICH_CHANNEL_ARMED', () => {
      this._installSoulRoomPick()
      showToast(this._scene, 'CHANNEL SOULS armed — click a room to unleash', { type: 'info', duration: 3000 })
    })
    this._on('LICH_CHANNEL_DISARMED', () => this._removeSoulRoomPick())
    this._on('LICH_CHANNEL_FIRED', () => this._removeSoulRoomPick())
    // Slime King MITOSIS SURGE room-targeting.
    this._on('SLIME_SURGE_ARMED', () => {
      this._installSurgeRoomPick()
      showToast(this._scene, 'MITOSIS SURGE armed — click a room to flood', { type: 'info', duration: 3000 })
    })
    this._on('SLIME_SURGE_DISARMED', () => this._removeSurgeRoomPick())
    this._on('SLIME_SURGE_FIRED', () => this._removeSurgeRoomPick())
    // Beholder TYRANT'S GAZE room-targeting.
    this._on('BEHOLDER_GAZE_ARMED', () => {
      this._installGazeRoomPick()
      showToast(this._scene, "TYRANT'S GAZE armed — click a room to lock it down", { type: 'info', duration: 3000 })
    })
    this._on('BEHOLDER_GAZE_DISARMED', () => this._removeGazeRoomPick())
    this._on('BEHOLDER_GAZE_FIRED', () => this._removeGazeRoomPick())
    // Orc TROPHY THROW room-targeting.
    this._on('ORC_TROPHY_THROW_ARMED', () => {
      this._installThrowRoomPick()
      showToast(this._scene, 'TROPHY THROW armed — click a room to hurl the arsenal', { type: 'info', duration: 3000 })
    })
    this._on('ORC_TROPHY_THROW_DISARMED', () => this._removeThrowRoomPick())
    this._on('ORC_TROPHY_THROW_FIRED', () => this._removeThrowRoomPick())
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
      this._spawnSacrificeFlames(game, x, y)
    })
    // Phase 1b.10 — Vampire Charm + Blood Tax VFX + toasts.
    this._on('VAMPIRE_CHARM_MARKED', (payload) => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.graphics) return
      const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.advId)
      if (!adv) return
      // Persistent dark-red ring that follows the charmed adv each frame.
      // Draw circles at local (0,0) so setPosition() moves the whole graphic.
      const g = game.add.graphics().setDepth(11)
      g.lineStyle(2, 0xcc1a44, 0.9); g.strokeCircle(0, 0, 16)
      g.lineStyle(1, 0xff66aa, 0.7); g.strokeCircle(0, 0, 22)
      g.setPosition(adv.worldX, adv.worldY)
      game.tweens.add({
        targets: g, alpha: 0.25, yoyo: true, repeat: -1,
        duration: 600, ease: 'Sine.easeInOut',
      })
      adv._charmRingGfx = g
      this._charmRings ??= []
      this._charmRings.push({ advId: payload.advId, gfx: g })
    })
    this._on('VAMPIRE_THRALL_CONVERTED', (payload) => {
      const game = this._scene.scene.get('Game')
      // Adv is still in active at emit time — find and destroy ring before splice.
      const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.advId)
      if (adv?._charmRingGfx) { adv._charmRingGfx.destroy(); adv._charmRingGfx = null }
      // Also clean up from the tracking list so update() stops repositioning it.
      if (this._charmRings) {
        const idx = this._charmRings.findIndex(r => r.advId === payload?.advId)
        if (idx >= 0) { this._charmRings[idx].gfx?.destroy(); this._charmRings.splice(idx, 1) }
      }
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

    // ── Polish VFX (audit followup) ──────────────────────────────────────

    // Lizardman: small dust poof + tint flash when a camouflaged minion
    // reveals on first hit.
    this._on('LIZARDMAN_CAMO_REVEAL', ({ minionId }) => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.graphics) return
      const m = (this._gameState?.minions ?? []).find(x => x.instanceId === minionId)
      if (!m) return
      const ring = game.add.graphics().setDepth(12)
      ring.lineStyle(2, 0x66ff88, 0.95).strokeCircle(m.worldX, m.worldY, 14)
      ring.lineStyle(1, 0xccffd9, 0.7).strokeCircle(m.worldX, m.worldY, 20)
      game.tweens.add({
        targets: ring, alpha: 0, scale: 1.4,
        duration: 380, ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      })
    })

    // Wraith: purple wisp at every haunt-ghost spawn.
    this._on('WRAITH_HAUNT_SPAWNED', ({ minionId }) => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.graphics) return
      const m = (this._gameState?.minions ?? []).find(x => x.instanceId === minionId)
      if (!m) return
      const wisp = game.add.graphics().setDepth(12)
      wisp.fillStyle(0x9966ff, 0.55).fillCircle(m.worldX, m.worldY, 10)
      wisp.lineStyle(2, 0xcc99ff, 0.9).strokeCircle(m.worldX, m.worldY, 14)
      game.tweens.add({
        targets: wisp, alpha: 0, y: m.worldY - 18,
        duration: 700, ease: 'Cubic.easeOut',
        onComplete: () => wisp.destroy(),
      })
    })

    // Lich Necromancy: dark-purple summoning burst + center-screen toast
    // listing how many rose.
    this._on('NECROMANCY_RAISED', ({ count, minionIds }) => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.graphics) return
      const minions = this._gameState?.minions ?? []
      for (const id of (minionIds ?? [])) {
        const m = minions.find(x => x.instanceId === id)
        if (!m) continue
        const ring = game.add.graphics().setDepth(12)
        ring.lineStyle(2, 0x6633bb, 0.95).strokeCircle(m.worldX, m.worldY, 16)
        ring.lineStyle(1, 0x9966dd, 0.6).strokeCircle(m.worldX, m.worldY, 22)
        game.tweens.add({
          targets: ring, alpha: 0, scale: 1.4,
          duration: 500, ease: 'Cubic.easeOut',
          onComplete: () => ring.destroy(),
        })
      }
      // Center-screen toast — same pattern as the Game-scene loot-goblin
      // toast so the chrome stays consistent.
      const cam = game.cameras?.main
      if (!cam || !count) return
      const banner = game.add.text(cam.midPoint.x, cam.midPoint.y - 80,
        `${count} risen at dawn`, {
          fontSize: '18px', color: '#cc99ff',
          fontFamily: 'monospace', fontStyle: 'bold',
          stroke: '#1c0a2a', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(125).setScrollFactor(0)
      game.tweens.add({
        targets: banner, alpha: { from: 1, to: 0 }, y: cam.midPoint.y - 110,
        duration: 1400, ease: 'Quad.easeOut',
        onComplete: () => banner.destroy(),
      })
    })

    // Myconid THE BLOOM — toast each time a room is colonized (seeded or spread).
    this._on('MYCONID_BLOOM_DAY', ({ bloomed }) => {
      if (!bloomed) return
      const game = this._scene.scene.get('Game')
      const cam = game?.cameras?.main
      if (!cam) return
      const banner = game.add.text(cam.midPoint.x, cam.midPoint.y - 80,
        `THE BLOOM SPREADS · ${bloomed} room${bloomed === 1 ? '' : 's'} colonized`, {
          fontSize: '20px', color: '#9ee870',
          fontFamily: 'monospace', fontStyle: 'bold',
          stroke: '#0a2010', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(125).setScrollFactor(0)
      game.tweens.add({
        targets: banner, alpha: { from: 1, to: 0 }, y: cam.midPoint.y - 110,
        duration: 1600, ease: 'Quad.easeOut',
        onComplete: () => banner.destroy(),
      })
    })
    // Myconid SEED THE BLOOM room-targeting.
    this._on('MYCONID_SEED_ARMED', () => {
      this._installSeedRoomPick()
      showToast(this._scene, 'SEED THE BLOOM armed — click a room to colonize', { type: 'info', duration: 3000 })
    })
    this._on('MYCONID_SEED_DISARMED', () => this._removeSeedRoomPick())
    this._on('MYCONID_SEED_FIRED', () => this._removeSeedRoomPick())

    // Beholder: "SILENCED" floater above an adv whose class ability was
    // suppressed by an Anti-Magic room. Throttled by ClassAbilitySystem.
    this._on('BEHOLDER_ANTI_MAGIC_SILENCED', ({ advId }) => {
      const game = this._scene.scene.get('Game')
      if (!game?.add?.text) return
      const adv = (this._gameState?.adventurers?.active ?? [])
        .find(a => a.instanceId === advId)
      if (!adv || typeof adv.worldX !== 'number') return
      const txt = game.add.text(adv.worldX, adv.worldY - 22, 'SILENCED', {
        fontFamily: 'monospace', fontSize: '9px', fontStyle: 'bold',
        color: '#cc99ff', stroke: '#1c0a2a', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(95)
      game.tweens.add({
        targets: txt, y: adv.worldY - 40, alpha: 0,
        duration: 800, ease: 'Quad.easeOut',
        onComplete: () => txt.destroy(),
      })
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
    this._earthquakeBtn.bg?.setVisible?.(v)
    this._earthquakeBtn.label?.setVisible?.(v)
    // Hit zone may not have an `input` component yet (set lazily by Phaser
    // on first setInteractive). Use the safe enable/disable API instead of
    // poking .input.enabled directly so this never throws on first call.
    const hit = this._earthquakeBtn.hit
    if (hit) {
      if (v) hit.setInteractive?.({ useHandCursor: true })
      else   hit.disableInteractive?.()
    }
  }

  _setSacrificeBtnVisible(v) {
    if (!this._sacrificeBtn) return
    this._sacrificeBtn.bg?.setVisible?.(v)
    this._sacrificeBtn.label?.setVisible?.(v)
    const hit = this._sacrificeBtn.hit
    if (hit) {
      if (v) hit.setInteractive?.({ useHandCursor: true })
      else   hit.disableInteractive?.()
    }
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

  // Minion-pick listener for Sacrifice Pact. We listen on TWO channels:
  //   1. EventBus 'MINION_CLICKED' — fired by MinionRenderer's per-sprite
  //      pointerdown. We have to use this because that handler calls
  //      event.stopPropagation(), which (per Phaser's InputPlugin) suppresses
  //      the scene-level pointerdown event. So a direct minion click would
  //      otherwise never reach us.
  //   2. Scene-level pointerdown on Game — only fires for empty-space clicks
  //      (everything over a minion gets stop-propagated). Used for the
  //      "click a minion" toast, right-click cancel, and ignoring clicks
  //      that fall on the SACRIFICE button itself.
  _installMinionPickListener() {
    const game = this._scene.scene.get('Game')
    if (!game) return
    if (this._minionPickHandler) return

    this._minionClickedHandler = ({ minion, pointer }) => {
      if (!minion || minion.faction !== 'dungeon') return
      if (minion.aiState === 'dead' || (minion.resources?.hp ?? 0) <= 0) return
      if (pointer?.rightButtonDown && pointer.rightButtonDown()) {
        EventBus.emit('DEMON_SACRIFICE_DISARM')
        return
      }
      EventBus.emit('DEMON_SACRIFICE_TARGET', { minionId: minion.instanceId })
    }
    EventBus.on('MINION_CLICKED', this._minionClickedHandler, this)

    this._minionPickHandler = (pointer) => {
      if (pointer.rightButtonDown && pointer.rightButtonDown()) {
        EventBus.emit('DEMON_SACRIFICE_DISARM')
        return
      }
      if (this._isPointerOverSacrificeBtn(pointer)) return
      // Empty-space click — minion sprite handlers stop propagation, so if
      // we're here the player clicked off any minion. Nudge them.
      showToast(this._scene, 'Click on one of your minions', { type: 'error', duration: 1500 })
    }
    game.input.on('pointerdown', this._minionPickHandler)
    this._minionPickGame = game
  }

  _removeMinionPickListener() {
    if (this._minionClickedHandler) {
      EventBus.off('MINION_CLICKED', this._minionClickedHandler, this)
      this._minionClickedHandler = null
    }
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

  // "Going up in flames" — a column of flickering flame tongues that rise
  // from the minion's last tile and dissipate. Spawns ~14 tongues with
  // staggered delays, each tweening upward + shrinking + fading. Dark base
  // pool grounds it; a single bright pop punctuates the burn-out.
  _spawnSacrificeFlames(game, x, y) {
    const FLAME_COLORS = [0xff2a0a, 0xff5522, 0xff9933, 0xffcc44]
    // Dark scorched pool at the feet — stays a beat then fades.
    const pool = game.add.graphics().setDepth(199)
    pool.fillStyle(0x1a0500, 0.85); pool.fillEllipse(x, y + 6, 22, 8)
    pool.fillStyle(0x441010, 0.6);  pool.fillEllipse(x, y + 6, 14, 5)
    game.tweens.add({
      targets: pool, alpha: 0, duration: 1400, ease: 'Cubic.easeOut',
      onComplete: () => pool.destroy(),
    })

    // Bright ignition pop on frame 1 so the eye locks onto the burn.
    const pop = game.add.graphics().setDepth(201)
    pop.fillStyle(0xffcc44, 0.9); pop.fillCircle(x, y, 12)
    pop.fillStyle(0xff5522, 0.85); pop.fillCircle(x, y, 7)
    game.tweens.add({
      targets: pop, alpha: 0, scaleX: 2.4, scaleY: 2.4,
      duration: 320, ease: 'Cubic.easeOut',
      onComplete: () => pop.destroy(),
    })

    // Rising flame tongues — each a small teardrop drawn as two stacked
    // circles, tweened upward with shrink + fade. Random horizontal jitter
    // and stagger keeps it organic.
    const N = 14
    for (let i = 0; i < N; i++) {
      const delay = Math.random() * 280
      const jx = (Math.random() - 0.5) * 16
      const startY = y + 4 + (Math.random() - 0.5) * 4
      const rise = 22 + Math.random() * 18
      const inner = FLAME_COLORS[Math.floor(Math.random() * 2) + 2]   // bright
      const outer = FLAME_COLORS[Math.floor(Math.random() * 2)]       // deep red/orange
      const r = 3 + Math.random() * 2
      const tongue = game.add.graphics().setDepth(200)
      tongue.fillStyle(outer, 0.95); tongue.fillCircle(0, 0, r + 1.5)
      tongue.fillStyle(inner, 0.9);  tongue.fillCircle(0, -1, r * 0.7)
      tongue.x = x + jx
      tongue.y = startY
      tongue.alpha = 0
      game.tweens.add({
        targets: tongue,
        y: startY - rise,
        x: tongue.x + (Math.random() - 0.5) * 6,
        alpha: { from: 0, to: 1 },
        scaleX: { from: 1.1, to: 0.4 },
        scaleY: { from: 1.4, to: 0.5 },
        duration: 520 + Math.random() * 220,
        delay,
        ease: 'Sine.easeOut',
        onComplete: () => {
          // Fade-out tail so each tongue dies, doesn't snap.
          game.tweens.add({
            targets: tongue, alpha: 0, duration: 180,
            onComplete: () => tongue.destroy(),
          })
        },
      })
    }

    // Wisp of smoke at the top once the bulk of the flames are gone.
    game.time.delayedCall(420, () => {
      const smoke = game.add.graphics().setDepth(198)
      smoke.fillStyle(0x222222, 0.55); smoke.fillCircle(0, 0, 6)
      smoke.fillStyle(0x444444, 0.4);  smoke.fillCircle(2, -2, 4)
      smoke.x = x; smoke.y = y - 12
      game.tweens.add({
        targets: smoke,
        y: y - 36, alpha: 0, scaleX: 1.8, scaleY: 1.8,
        duration: 900, ease: 'Cubic.easeOut',
        onComplete: () => smoke.destroy(),
      })
    })
  }

  _removeRoomPickListener() {
    if (!this._roomPickHandler || !this._roomPickGame) return
    this._roomPickGame.input.off('pointerdown', this._roomPickHandler)
    this._roomPickHandler = null
    this._roomPickGame    = null
  }

  // Lich CHANNEL SOULS room-pick (mirrors the earthquake picker). One click
  // resolves the targeted room; right-click cancels.
  _installSoulRoomPick() {
    const game = this._scene.scene.get('Game')
    if (!game || this._soulPickHandler) return
    this._soulPickHandler = (pointer) => {
      if (pointer.rightButtonDown && pointer.rightButtonDown()) {
        EventBus.emit('LICH_CHANNEL_DISARM')
        return
      }
      const wp = pointer.positionToCamera(game.cameras.main)
      const room = game.dungeonGrid?.getRoomAtTile?.(Math.floor(wp.x / 32), Math.floor(wp.y / 32))
      if (!room) { showToast(this._scene, 'Click on a room', { type: 'error', duration: 1500 }); return }
      EventBus.emit('LICH_CHANNEL_TARGET', { roomId: room.instanceId })
    }
    game.input.on('pointerdown', this._soulPickHandler)
    this._soulPickGame = game
  }

  _removeSoulRoomPick() {
    if (!this._soulPickHandler || !this._soulPickGame) return
    this._soulPickGame.input.off('pointerdown', this._soulPickHandler)
    this._soulPickHandler = null
    this._soulPickGame    = null
  }

  // Slime MITOSIS SURGE room-pick (mirrors the soul / earthquake pickers).
  _installSurgeRoomPick() {
    const game = this._scene.scene.get('Game')
    if (!game || this._surgePickHandler) return
    this._surgePickHandler = (pointer) => {
      if (pointer.rightButtonDown && pointer.rightButtonDown()) { EventBus.emit('SLIME_SURGE_DISARM'); return }
      const wp = pointer.positionToCamera(game.cameras.main)
      const room = game.dungeonGrid?.getRoomAtTile?.(Math.floor(wp.x / 32), Math.floor(wp.y / 32))
      if (!room) { showToast(this._scene, 'Click on a room', { type: 'error', duration: 1500 }); return }
      EventBus.emit('SLIME_SURGE_TARGET', { roomId: room.instanceId })
    }
    game.input.on('pointerdown', this._surgePickHandler)
    this._surgePickGame = game
  }

  _removeSurgeRoomPick() {
    if (!this._surgePickHandler || !this._surgePickGame) return
    this._surgePickGame.input.off('pointerdown', this._surgePickHandler)
    this._surgePickHandler = null
    this._surgePickGame    = null
  }

  // Beholder TYRANT'S GAZE room-pick (mirrors the surge / soul pickers).
  _installGazeRoomPick() {
    const game = this._scene.scene.get('Game')
    if (!game || this._gazePickHandler) return
    this._gazePickHandler = (pointer) => {
      if (pointer.rightButtonDown && pointer.rightButtonDown()) { EventBus.emit('BEHOLDER_GAZE_DISARM'); return }
      const wp = pointer.positionToCamera(game.cameras.main)
      const room = game.dungeonGrid?.getRoomAtTile?.(Math.floor(wp.x / 32), Math.floor(wp.y / 32))
      if (!room) { showToast(this._scene, 'Click on a room', { type: 'error', duration: 1500 }); return }
      EventBus.emit('BEHOLDER_GAZE_TARGET', { roomId: room.instanceId })
    }
    game.input.on('pointerdown', this._gazePickHandler)
    this._gazePickGame = game
  }

  _removeGazeRoomPick() {
    if (!this._gazePickHandler || !this._gazePickGame) return
    this._gazePickGame.input.off('pointerdown', this._gazePickHandler)
    this._gazePickHandler = null
    this._gazePickGame    = null
  }

  // Orc TROPHY THROW room-pick (mirrors the gaze / surge / soul pickers).
  _installThrowRoomPick() {
    const game = this._scene.scene.get('Game')
    if (!game || this._throwPickHandler) return
    this._throwPickHandler = (pointer) => {
      if (pointer.rightButtonDown && pointer.rightButtonDown()) { EventBus.emit('ORC_TROPHY_THROW_DISARM'); return }
      const wp = pointer.positionToCamera(game.cameras.main)
      const room = game.dungeonGrid?.getRoomAtTile?.(Math.floor(wp.x / 32), Math.floor(wp.y / 32))
      if (!room) { showToast(this._scene, 'Click on a room', { type: 'error', duration: 1500 }); return }
      EventBus.emit('ORC_TROPHY_THROW_TARGET', { roomId: room.instanceId })
    }
    game.input.on('pointerdown', this._throwPickHandler)
    this._throwPickGame = game
  }

  _removeThrowRoomPick() {
    if (!this._throwPickHandler || !this._throwPickGame) return
    this._throwPickGame.input.off('pointerdown', this._throwPickHandler)
    this._throwPickHandler = null
    this._throwPickGame    = null
  }

  // Myconid SEED THE BLOOM room-pick.
  _installSeedRoomPick() {
    const game = this._scene.scene.get('Game')
    if (!game || this._seedPickHandler) return
    this._seedPickHandler = (pointer) => {
      if (pointer.rightButtonDown && pointer.rightButtonDown()) { EventBus.emit('MYCONID_SEED_DISARM'); return }
      const wp = pointer.positionToCamera(game.cameras.main)
      const room = game.dungeonGrid?.getRoomAtTile?.(Math.floor(wp.x / 32), Math.floor(wp.y / 32))
      if (!room) { showToast(this._scene, 'Click on a room', { type: 'error', duration: 1500 }); return }
      EventBus.emit('MYCONID_SEED_TARGET', { roomId: room.instanceId })
    }
    game.input.on('pointerdown', this._seedPickHandler)
    this._seedPickGame = game
  }

  _removeSeedRoomPick() {
    if (!this._seedPickHandler || !this._seedPickGame) return
    this._seedPickGame.input.off('pointerdown', this._seedPickHandler)
    this._seedPickHandler = null
    this._seedPickGame    = null
  }

  // Camera shake on the Game scene + a small "EARTHQUAKE" floater above the
  // targeted room's center so the player can read what just happened.
  _playEarthquakeVfx(payload) {
    const game = this._scene.scene.get('Game')
    // Gate on the SettingsOverlay's SCREEN SHAKE toggle. Inline read
    // (rather than importing userSettings) to avoid a dep cycle —
    // BossArchetypeUI imports many UI primitives that loop back here.
    let shakeOk = true
    try { shakeOk = localStorage.getItem('qf.video.shake') !== 'false' } catch {}
    if (game?.cameras?.main?.shake && shakeOk) {
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

  // Called each frame by HudScene.update(). Repositions charm-ring graphics
  // to track the charmed adventurer's current world position.
  update() {
    if (!this._charmRings?.length) return
    const active = this._gameState?.adventurers?.active ?? []
    this._charmRings = this._charmRings.filter(({ advId, gfx }) => {
      if (!gfx?.active) return false
      const adv = active.find(a => a.instanceId === advId)
      if (!adv) { gfx.destroy(); return false }
      gfx.setPosition(adv.worldX, adv.worldY)
      return true
    })
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._removeRoomPickListener()
    this._removeSoulRoomPick()
    this._removeSurgeRoomPick()
    this._removeGazeRoomPick()
    this._removeThrowRoomPick()
    this._removeSeedRoomPick()
    this._earthquakeBtn?.destroy?.()
    this._hint?.destroy?.()
    for (const { gfx } of this._charmRings ?? []) gfx?.destroy?.()
    this._charmRings = []
  }
}
