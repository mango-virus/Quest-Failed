// Dark Pact popup — the climactic nightly choice.
//
// Shown after Post-Wave Summary on days the boss leveled up. Three
// mechanic offerings (DungeonMechanicSystem.getOfferings) presented as
// rarity-tiered cards brokered by an animated demon. Reroll once per
// night, then disabled. Seal the Pact triggers a slam/splatter climax
// VFX before activating the chosen mechanic and emitting
// DARK_PACT_SEALED for the EndOfDay orchestrator.
//
// Visual layers (back to front):
//   - Atmospheric fog bands + central pulsing pentagram + drifting embers
//   - Broker strip (demon sprite + name/title/quote + "sealed bargains" count)
//   - Three card containers (rarity-tinted frames, drawn sigil, flavor,
//     benefit/tradeoff with up/down icons)
//   - Footer buttons
//   - Climax VFX overlay (splatter dots + PACT SEALED stamp)

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelButton } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { EventBus } from '../../systems/EventBus.js'
import { RARITIES, renderPactCard } from './PactCard.js'

// Pact-broker flavor — demon's persona rotates by boss level so each pact
// menu has a different voice. clamp(level - 2) into the array.
const BROKERS = [
  { name: "VEX'KAR",      title: "the Whispering Auditor",  quote: "What's one more whisper between friends?" },
  { name: "MOR'NUL",      title: "the Hungry Patron",       quote: "I taste copper in your decisions." },
  { name: "SYLTH",        title: "the Velvet Tongue",       quote: "Every door opens — for a price." },
  { name: "AG'AZOTH",     title: "the Ledger-Keeper",       quote: "Your soul has excellent collateral." },
  { name: "DRAX'ZIN",     title: "the Soul-Broker",         quote: "Sign here. And here. And in your blood." },
  { name: "THE CONCLAVE", title: "many voices, one bargain", quote: "WE OFFER. YOU CHOOSE. YOU PAY." },
]

export class DarkPactPopup {
  constructor(scene, gameState) {
    this._scene       = scene
    this._gameState   = gameState
    this._offers      = []
    this._selectedIdx = -1   // no auto-selection — player must click to mark
    this._hoverIdx    = -1
    this._rerollUsed  = false
    this._sealed      = false
    this._sealing     = false
    this._cardConts   = []   // Phaser.Container per card — animated as a unit
    this._cardBaseY   = []   // baseline y per card (so lift/return is tween-safe)
    this._tweens      = []
    this._embers      = []
    this._emberTimer  = null
    this._brokerSprite = null
    this._isRerolling = false   // suppresses the dismiss emit during reroll's close+open

    this._frame = makePopupFrame({
      scene,
      w:    1040,
      h:    560,
      title:'DARK · PACT',
      depth: 200,
      // Mandatory popup — no X button, no Esc, no click-outside dismiss.
      // The player must seal a pact (or close it programmatically via
      // _seal / _reroll close+open) to advance to night.
      dismissable: false,
      onClose: () => {
        this._cardConts  = []
        this._cardBaseY  = []
        this._hoverIdx   = -1
        this._brokerSprite = null
        for (const t of this._tweens) t?.stop?.()
        this._tweens = []
        this._stopEmbers()
        // EndOfDay's day → night handoff hangs on DARK_PACT_SEALED.
        // If the popup was dismissed without picking, fire it with no
        // pact so the chain still resolves. Reroll suppresses this via
        // _isRerolling because it close+opens the frame in place.
        if (!this._sealed && !this._isRerolling) {
          this._sealed = true
          EventBus.emit('DARK_PACT_SEALED', { mechanicId: null })
        }
      },
      render: (px, py, cx, cy, cw, ch, addChild) =>
        this._render(cx, cy, cw, ch, addChild),
    })
  }

  refreshOffers() {
    const game = this._scene.scene.get('Game')
    const sys  = game?.dungeonMechanicSystem
    if (!sys) { this._offers = []; return }
    const archId = this._gameState.player?.bossArchetypeId
    const dLv    = this._gameState.boss?.level ?? 1
    this._offers = sys.getOfferings(3, archId, dLv) ?? []
    this._selectedIdx = -1
  }

  open() {
    if (!this._offers.length) this.refreshOffers()
    this._rerollUsed = false
    this._sealed     = false
    this._sealing    = false
    this._frame.open()
    // (Open chime is played by SfxSystem on SHOW_DARK_PACT — playing
    // it here too would double-stack the audio.)
  }
  close()   { this._frame.close() }
  destroy() { this.close() }

  // ── Render ──────────────────────────────────────────────────────────────

  _render(cx, cy, cw, ch, addChild) {
    const D = 205
    const brokerH = 92

    // Atmosphere first so it sits behind everything
    this._renderAtmosphere(cx, cy + brokerH + 6, cw, ch - brokerH - 6 - 64, D, addChild)

    // Broker strip (top)
    this._renderBroker(cx, cy, cw, brokerH, D + 1, addChild)

    // Card area
    const cardsY = cy + brokerH + 8
    const cardsH = ch - brokerH - 8 - 64
    const gap    = 16
    const cardW  = Math.floor((cw - gap * 2) / 3)
    this._cardConts = []
    this._cardBaseY = []

    if (this._offers.length === 0) {
      addChild(this._scene.add.text(cx + cw / 2, cardsY + cardsH / 2,
        '— NO MECHANICS AVAILABLE AT THIS LEVEL —', {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
    } else {
      this._offers.slice(0, 3).forEach((def, i) => {
        const x = cx + i * (cardW + gap)
        this._renderCard(def, i, x, cardsY, cardW, cardsH, D + 2, addChild)
      })
    }

    // Footer buttons
    const footerY = cy + ch - 44
    const rerollEnabled = !this._rerollUsed && this._offers.length > 0
    const rerollLabel   = this._rerollUsed ? 'REROLL USED' : 'REROLL ALL (1×)'
    const rerollBtn = pixelButton(this._scene,
      cx, footerY, 220, 38, rerollLabel,
      { depth: D + 4, fontSize: 9,
        onClick: rerollEnabled ? () => this._reroll() : null,
      })
    if (!rerollEnabled) rerollBtn.setEnabled(false)
    addChild(rerollBtn.bg, rerollBtn.label, rerollBtn.hit)

    const sealBtn = pixelButton(this._scene,
      cx + cw - 240, footerY, 240, 38, 'SEAL THE PACT',
      { primary: true, depth: D + 4, fontSize: 11,
        onClick: () => this._seal(),
      })
    // Disabled until the player marks a card. Enabled state is updated
    // dynamically from _refreshSelectionVisuals when selection changes.
    if (this._offers.length === 0 || this._selectedIdx < 0) sealBtn.setEnabled(false)
    addChild(sealBtn.bg, sealBtn.label, sealBtn.hit)
    this._sealBtn = sealBtn

    // Ember particles loop
    this._startEmbers(cx, cardsY, cw, cardsH, D + 1)

    // Reset hover/selection visuals once cards exist
    this._refreshSelectionVisuals(true)
  }

  // ── Atmosphere ──────────────────────────────────────────────────────────

  _renderAtmosphere(cx, cy, cw, ch, D, addChild) {
    // Soft inner vignette tint
    const tint = this._scene.add.graphics().setDepth(D)
    tint.fillStyle(0x14171c, 0.28)
    tint.fillRect(cx - 4, cy - 4, cw + 8, ch + 8)
    addChild(tint)

    // Drifting fog bands — pixel-tinted purple, slow horizontal lerp
    for (let i = 0; i < 3; i++) {
      const fog = this._scene.add.graphics().setDepth(D + 0.5).setAlpha(0.07)
      const bandH = 32 + i * 22
      const bandY = cy + 20 + i * (ch / 3.6)
      fog.fillStyle(0xa64ad9, 1)
      fog.fillRect(0, 0, cw + 80, bandH)
      fog.x = cx - 40
      fog.y = bandY
      addChild(fog)
      const fogTw = this._scene.tweens.add({
        targets: fog,
        x: cx + 40,
        duration: 7200 + i * 1400,
        repeat: -1,
        yoyo: true,
        ease: 'Sine.easeInOut',
        delay: i * 700,
      })
      this._tweens.push(fogTw)
    }

    // Central pulsing pentagram (subtle, behind cards)
    const sigilCx = cx + cw / 2
    const sigilCy = cy + ch / 2
    const sigilG = this._scene.add.graphics().setDepth(D + 1).setAlpha(0.08)
    addChild(sigilG)
    sigilG.lineStyle(2, CRYPT.accent, 1)
    const r = Math.min(cw, ch) * 0.32
    const pts = []
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (2 * Math.PI / 5)
      pts.push({ x: sigilCx + Math.cos(a) * r, y: sigilCy + Math.sin(a) * r })
    }
    sigilG.beginPath()
    sigilG.moveTo(pts[0].x, pts[0].y)
    sigilG.lineTo(pts[2].x, pts[2].y)
    sigilG.lineTo(pts[4].x, pts[4].y)
    sigilG.lineTo(pts[1].x, pts[1].y)
    sigilG.lineTo(pts[3].x, pts[3].y)
    sigilG.lineTo(pts[0].x, pts[0].y)
    sigilG.strokePath()
    sigilG.strokeCircle(sigilCx, sigilCy, r + 10)

    const sigilTw = this._scene.tweens.add({
      targets: sigilG,
      alpha: { from: 0.05, to: 0.16 },
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this._tweens.push(sigilTw)

    // Slow rotation by re-drawing? Skipping — graphics rotation needs a
    // pivot setup. Pulse alone reads "alive" already.
  }

  // ── Broker strip ────────────────────────────────────────────────────────

  _renderBroker(cx, cy, cw, h, D, addChild) {
    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, cx, cy, cw, h, {
      fill: CRYPT.bgStone1, edgeH: CRYPT.panelEdgeH, edgeS: CRYPT.panelEdgeS,
    })
    addChild(bg)

    const lvl = this._gameState.boss?.level ?? 2
    const broker = BROKERS[Math.min(BROKERS.length - 1, Math.max(0, lvl - 2))]

    // Demon sprite — left side. Pulled from the existing dark-deal asset
    // (80×80 sheet with appear/idle/leave anims).
    const dx = cx + 56
    const dy = cy + h / 2
    try {
      if (this._scene.textures.exists('event-dark-deal-demon')) {
        const demon = this._scene.add.sprite(dx, dy, 'event-dark-deal-demon').setDepth(D + 2)
        demon.setScale(0.95)
        if (this._scene.anims.exists('event-dark-deal-demon-appear')) {
          demon.play('event-dark-deal-demon-appear')
          demon.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + 'event-dark-deal-demon-appear', () => {
            if (demon.scene && this._scene.anims.exists('event-dark-deal-demon-idle')) {
              demon.play('event-dark-deal-demon-idle')
            }
          })
        }
        addChild(demon)
        this._brokerSprite = demon
      }
    } catch {}

    // Name + title + quote — to the right of the demon sprite
    const tx = cx + 110
    addChild(this._scene.add.text(tx, cy + 14, 'BROKERED BY', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setDepth(D + 3))
    const nameT = this._scene.add.text(tx, cy + 26, broker.name, {
      fontFamily: FONT_HEAD, fontSize: '14px', color: CRYPT.accent2Css, letterSpacing: 2,
      stroke: '#000000', strokeThickness: 2,
    }).setDepth(D + 3)
    addChild(nameT)
    addChild(this._scene.add.text(tx, cy + 46, broker.title.toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setDepth(D + 3))
    addChild(this._scene.add.text(tx, cy + 64, '" ' + broker.quote + ' "', {
      fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.soulCss, letterSpacing: 1,
      wordWrap: { width: cw / 2 - 60 }, fontStyle: 'italic',
    }).setDepth(D + 3))

    // Centered tagline (preserved from the original popup, gives the
    // moment a beat of theatre between the broker and the cards).
    addChild(this._scene.add.text(cx + cw / 2, cy + 14, 'NIGHTFALL · CHOOSE ONE', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 4,
    }).setOrigin(0.5, 0).setDepth(D + 3))
    addChild(this._scene.add.text(cx + cw / 2, cy + 30,
      'The boss draws power from the night.', {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setOrigin(0.5, 0).setDepth(D + 3))

    // Sealed-bargains tally — top right, with recent rarity dots beneath.
    const pacts  = this._gameState.history?.pacts ?? []
    const tallyX = cx + cw - 18
    addChild(this._scene.add.text(tallyX, cy + 12, 'SEALED BARGAINS', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(1, 0).setDepth(D + 3))
    addChild(this._scene.add.text(tallyX, cy + 24, String(pacts.length), {
      fontFamily: FONT_HEAD, fontSize: '22px', color: CRYPT.accentCss, letterSpacing: 1,
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0).setDepth(D + 3))
    // Recent rarity dots — newest on the right, fading older ones
    const recent = pacts.slice(-8)
    const dotsG = this._scene.add.graphics().setDepth(D + 3)
    for (let i = 0; i < recent.length; i++) {
      const p   = recent[recent.length - 1 - i]
      const rar = RARITIES[p.rarity] ?? RARITIES.common
      const px  = tallyX - 8 - i * 12
      const py  = cy + 64
      dotsG.fillStyle(rar.hex, 1 - i * 0.08)
      dotsG.fillRect(px, py, 8, 8)
      dotsG.lineStyle(1, 0x000000, 1)
      dotsG.strokeRect(px, py, 8, 8)
    }
    addChild(dotsG)
  }

  // ── Card ────────────────────────────────────────────────────────────────

  _renderCard(def, idx, x, y, w, h, D, addChild) {
    const rarKey = def.rarity ?? 'common'
    const rar    = RARITIES[rarKey] ?? RARITIES.common

    // Build the static card chrome via the shared renderer so this view
    // matches PactDetailPopup pixel-for-pixel.
    const { container: cont, tweens } = renderPactCard(
      this._scene, def, x, y, w, h, { depth: D },
    )
    addChild(cont)
    this._tweens.push(...tweens)
    this._cardConts.push(cont)
    this._cardBaseY.push(y)

    // Selection overlay — hidden by default, toggled by _refreshSelectionVisuals.
    // Thick rarity border + corner brackets + MARKED stamp at top center. The
    // stamp pops in with Back.easeOut whenever the overlay flips visible so a
    // click reads as "committed".
    const selOverlay = this._scene.add.container(0, 0)
    selOverlay.setVisible(false)
    const selBorder = this._scene.add.graphics()
    selBorder.lineStyle(3, rar.hex, 1)
    selBorder.strokeRect(-2, -2, w + 4, h + 4)
    selOverlay.add(selBorder)
    // L-shaped corner brackets
    const cL = 16, cT = 3
    const cg = this._scene.add.graphics()
    cg.fillStyle(rar.hex, 1)
    const corners = [[0, 0], [w, 0], [0, h], [w, h]]
    for (const [ccx, ccy] of corners) {
      const xLeft = (ccx === 0)
      const yTop  = (ccy === 0)
      const ax = xLeft ? -2 : ccx - cL + 2
      const ay = yTop  ? -2 : ccy - cT + 1
      cg.fillRect(ax, ay, cL, cT)
      const bx = xLeft ? -2 : ccx - cT + 1
      const by = yTop  ? -2 : ccy - cL + 2
      cg.fillRect(bx, by, cT, cL)
    }
    selOverlay.add(cg)
    // MARKED stamp ribbon
    const sxR = w / 2 - 38
    const syR = -10
    const stampBg = this._scene.add.graphics()
    stampBg.fillStyle(rar.hex, 1)
    stampBg.fillRect(sxR, syR, 76, 16)
    stampBg.lineStyle(1, 0x000000, 1)
    stampBg.strokeRect(sxR, syR, 76, 16)
    selOverlay.add(stampBg)
    const stampT = this._scene.add.text(w / 2, syR + 8, '✦ MARKED ✦', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: '#0a0d12', letterSpacing: 2,
    }).setOrigin(0.5)
    selOverlay.add(stampT)
    cont.add(selOverlay)
    cont._selOverlay = selOverlay
    cont._selStampBg = stampBg
    cont._selStampT  = stampT
    // Pulse the border whenever it's visible
    const pulseTw = this._scene.tweens.add({
      targets:  selBorder,
      alpha:    { from: 0.55, to: 1 },
      duration: 700,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })
    this._tweens.push(pulseTw)

    // Static hit zone — anchored at the card's BASELINE position in scene
    // space. Lives outside the container so scaling/lifting the visual
    // doesn't reflow the hit area. Without this, the active region
    // shifts every frame during the lift tween and the cursor "drifts"
    // between cards even when you're not moving the mouse.
    const hit = this._scene.add.zone(x, y, w, h)
      .setOrigin(0)
      .setDepth(D + 20)
      .setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => {
      if (this._sealing) return
      if (this._hoverIdx !== idx) {
        this._hoverIdx = idx
        this._refreshSelectionVisuals()
        try { this._scene.sound.play('sfx-btn-hover', { volume: 0.25 }) } catch {}
      }
    })
    hit.on('pointerout', () => {
      if (this._hoverIdx === idx) {
        this._hoverIdx = -1
        this._refreshSelectionVisuals()
      }
    })
    hit.on('pointerup', () => {
      if (this._sealing) return
      // Toggle: clicking the already-marked card unmarks it. Anything else
      // becomes the new selection.
      this._selectedIdx = (this._selectedIdx === idx) ? -1 : idx
      this._refreshSelectionVisuals()
      try { this._scene.sound.play('sfx-btn-click', { volume: 0.4 }) } catch {}
    })
    addChild(hit)

    // Entrance — slide up from below + fade in, staggered. Stored as
    // `_visTween` so a click during the entrance kills it (otherwise the
    // delayed entrance would override the click's lift tween once it ran).
    cont.setAlpha(0)
    cont.y = y + 22
    const tw = this._scene.tweens.add({
      targets:  cont,
      alpha:    1,
      y:        y,
      duration: 360,
      delay:    100 + idx * 130,
      ease:     'Back.easeOut',
    })
    this._tweens.push(tw)
    cont._visTween = tw
    cont._baseDepth = D
  }

  // Lift + scale the selected card the most, hover a bit, neutral cards flat.
  // Toggles each card's selection overlay (border + corners + MARKED stamp)
  // and pops the stamp on transition into selected. Called on hover/click
  // and once with `force=true` after render to set the initial selection.
  //
  // We track per-container `_visTween` and stop it before adding a new one
  // so rapid hover/unhover doesn't accumulate a stack of fighting tweens
  // (which previously caused cards to "freeze" mid-lift).
  _refreshSelectionVisuals(force = false) {
    if (!this._cardConts.length) return
    const hover = this._hoverIdx
    const sel   = this._selectedIdx
    for (let i = 0; i < this._cardConts.length; i++) {
      const cont = this._cardConts[i]
      if (!cont || !cont.scene) continue

      const isSel = (i === sel)
      const isHov = (i === hover && !isSel)

      // More dramatic lift + scale than before
      const lift  = isSel ? -18 : isHov ? -12 : 0
      const scale = isSel ? 1.05 : isHov ? 1.035 : 1.0
      const targetY = this._cardBaseY[i] + lift

      // Bump the marked card above its siblings so the lifted edge / corner
      // brackets / MARKED stamp paint OVER the adjacent cards instead of
      // sliding under them.
      if (cont._baseDepth != null) {
        cont.setDepth(isSel ? cont._baseDepth + 10 : cont._baseDepth)
      }

      // Toggle selection overlay; pop the MARKED stamp when it first appears
      const wasVisible = cont._selOverlay?.visible ?? false
      if (cont._selOverlay) cont._selOverlay.setVisible(isSel)
      if (isSel && !wasVisible && !force && cont._selStampBg && cont._selStampT) {
        cont._selStampBg.setScale(0.4)
        cont._selStampT.setScale(0.4)
        this._scene.tweens.add({
          targets:  [cont._selStampBg, cont._selStampT],
          scale:    1,
          duration: 240,
          ease:     'Back.easeOut',
        })
      }

      if (force) {
        cont.y = targetY
        cont.setScale(scale)
        continue
      }

      // Cancel any in-flight tween (entrance OR previous lift) on this card
      // before starting a new one. Without this, a click during the entrance
      // delay would have its lift overridden by the entrance tween once it
      // fired, and rapid hover/unhover would stack tweens and stall.
      // Lift tween also drives `alpha: 1` so an interrupted entrance still
      // ends up fully opaque.
      if (cont._visTween && cont._visTween.isPlaying?.()) cont._visTween.stop()
      cont._visTween = this._scene.tweens.add({
        targets:  cont,
        y:        targetY,
        scaleX:   scale,
        scaleY:   scale,
        alpha:    1,
        duration: 170,
        ease:     isSel ? 'Back.easeOut' : 'Sine.easeOut',
      })
    }

    // Keep the seal button in sync — disabled until the player marks a card
    if (this._sealBtn?.setEnabled) {
      this._sealBtn.setEnabled(this._selectedIdx >= 0 && this._offers.length > 0)
    }
  }

  // ── Embers ──────────────────────────────────────────────────────────────

  _startEmbers(cx, cy, cw, ch, D) {
    const spawn = () => {
      if (!this._cardConts.length) return
      const ex = cx + Math.random() * cw
      const ey = cy + ch - 6
      const ember = this._scene.add.graphics().setDepth(D)
      const useGold = Math.random() < 0.35
      ember.fillStyle(useGold ? CRYPT.gold : 0xff5566, 0.9)
      const sz = Math.random() < 0.5 ? 2 : 3
      ember.fillRect(ex, ey, sz, sz)
      this._embers.push(ember)
      const tw = this._scene.tweens.add({
        targets:  ember,
        y:        -ch * 0.9 - Math.random() * 60,
        x:        ex + (Math.random() - 0.5) * 80,
        alpha:    { from: 0.9, to: 0 },
        duration: 2400 + Math.random() * 1600,
        ease:     'Sine.easeOut',
        onComplete: () => {
          ember.destroy()
          const i = this._embers.indexOf(ember)
          if (i >= 0) this._embers.splice(i, 1)
        },
      })
      this._tweens.push(tw)
    }
    const loop = () => {
      if (!this._cardConts.length) return
      spawn()
      this._emberTimer = this._scene.time.delayedCall(220 + Math.random() * 260, loop)
    }
    loop()
  }

  _stopEmbers() {
    this._emberTimer?.remove?.(false)
    this._emberTimer = null
    for (const e of this._embers) e?.destroy?.()
    this._embers = []
  }

  // ── Reroll / Seal ───────────────────────────────────────────────────────

  _reroll() {
    if (this._rerollUsed || this._sealing) return
    this._rerollUsed = true
    try { this._scene.sound.play('sfx-necro-summon', { volume: 0.45 }) } catch {}

    // Burn-out: each card fades + drifts up, staggered. After the last
    // one finishes we close-and-reopen the popup with fresh offerings.
    // The _isRerolling flag stops the close from emitting DARK_PACT_SEALED
    // (which would advance EndOfDay straight to night).
    let lastDelay = 0
    for (let i = 0; i < this._cardConts.length; i++) {
      const cont  = this._cardConts[i]
      if (!cont || !cont.scene) continue
      const delay = i * 90
      lastDelay   = Math.max(lastDelay, delay)
      this._scene.tweens.add({
        targets:  cont,
        alpha:    0,
        y:        cont.y - 28,
        scaleX:   0.94,
        scaleY:   0.94,
        duration: 280,
        delay,
        ease:     'Quad.easeIn',
      })
    }
    this._scene.time.delayedCall(lastDelay + 360, () => {
      this._isRerolling = true
      this._frame.close()
      this.refreshOffers()
      this._frame.open()
      this._isRerolling = false
    })
  }

  _seal() {
    if (this._sealing) return
    const def = this._offers[this._selectedIdx]
    if (!def) {
      this._sealed = true
      EventBus.emit('DARK_PACT_SEALED', { mechanicId: null })
      this.close()
      return
    }
    this._sealing = true

    // Other cards fade out
    for (let i = 0; i < this._cardConts.length; i++) {
      if (i === this._selectedIdx) continue
      const cont = this._cardConts[i]
      if (!cont || !cont.scene) continue
      this._scene.tweens.add({
        targets: cont, alpha: 0.15, duration: 240, ease: 'Quad.easeIn',
      })
    }

    // Chosen card slam zoom: scale up and lift
    const chosen = this._cardConts[this._selectedIdx]
    if (chosen && chosen.scene) {
      this._scene.tweens.add({
        targets: chosen,
        scaleX: 1.06, scaleY: 1.06,
        y: this._cardBaseY[this._selectedIdx] - 18,
        duration: 220,
        ease: 'Back.easeOut',
        yoyo: false,
      })
    }

    // Camera punch + boom SFX
    try { this._scene.cameras.main.shake(220, 0.006) } catch {}
    try { this._scene.sound.play('sfx-boss-attack', { volume: 0.55 }) } catch {}

    // Splatter VFX — red dots radiating outward from card center
    const b = this._cardBaseY[this._selectedIdx]
    const cont = chosen
    if (cont && cont.scene) {
      const cxc = cont.x + cont.width / 2
      const cyc = b + cont.height / 2
      const W = this._scene.uiW ?? 1280
      const H = this._scene.uiH ?? 720
      for (let i = 0; i < 14; i++) {
        const dot = this._scene.add.graphics().setDepth(260)
        dot.fillStyle(CRYPT.accent, 1)
        const sz = 3 + Math.floor(Math.random() * 4)
        dot.fillRect(-sz / 2, -sz / 2, sz, sz)
        dot.x = cxc
        dot.y = cyc
        const a  = (i / 14) * Math.PI * 2 + Math.random() * 0.4
        const r  = 100 + Math.random() * 120
        this._scene.tweens.add({
          targets:  dot,
          x:        cxc + Math.cos(a) * r,
          y:        cyc + Math.sin(a) * r,
          alpha:    { from: 1, to: 0 },
          duration: 600 + Math.random() * 200,
          ease:     'Quad.easeOut',
          onComplete: () => dot.destroy(),
        })
      }

      // Big "PACT SEALED" stamp banner — overlays entire scene briefly
      const stamp = this._scene.add.text(W / 2, H / 2 + 80, 'PACT SEALED', {
        fontFamily: FONT_HEAD, fontSize: '34px', color: CRYPT.accent2Css, letterSpacing: 6,
        stroke: '#000000', strokeThickness: 6,
      }).setOrigin(0.5).setDepth(270).setScale(0.4).setAlpha(0)
      this._scene.tweens.add({
        targets:  stamp,
        scale:    1, alpha: 1,
        duration: 280, ease: 'Back.easeOut',
      })
      this._scene.time.delayedCall(740, () => stamp.destroy())
    }

    // After the climax, fire the actual seal
    this._scene.time.delayedCall(900, () => {
      const game = this._scene.scene.get('Game')
      const sys  = game?.dungeonMechanicSystem
      sys?.activate?.(def.id)
      // Build SFX on seal — same random-of-three pick NightPhase uses
      // for room placement, so sealing a pact has the same satisfying
      // "thunk" as constructing the dungeon. Inline rather than via
      // SfxSystem because the seal is a one-shot popup moment with no
      // existing event hook in that system.
      const buildKeys = ['sfx-build-1', 'sfx-build-2', 'sfx-build-3']
      const buildKey  = buildKeys[Math.floor(Math.random() * buildKeys.length)]
      if (this._scene.cache?.audio?.exists?.(buildKey)) {
        try { this._scene.sound.play(buildKey, { volume: 0.8 }) } catch {}
      }
      EventBus.emit('PACT_SEALED', {
        mechanicId: def.id,
        rarity:     def.rarity ?? 'common',
      })
      this._sealed = true
      EventBus.emit('DARK_PACT_SEALED', { mechanicId: def.id })
      this.close()
    })
  }
}
