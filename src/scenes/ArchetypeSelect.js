// Bestiary boss-select scene.
//
// Layout: an open pixel-art book (Craftpix bestiary asset pack) in the
// centre of the screen. Left page is a COMPENDIUM grid — 3×4 slots, one
// per boss with a portrait cropped from Monsters.png; the two empty slots
// are decorative. Right page is the REGISTER dossier — large portrait,
// name banner, headline mechanic + supporting bullets (each with a WIP
// triangle until that mechanic ships), flavor quote, wax-seal BEGIN RUN.
//
// Hover a portrait → right page previews that boss (ephemeral). Click →
// locks selection. The book opens with an animated intro on enter, then
// a one-shot page-turn flash settles to the spread, then claws slide in
// from the edges. Selection swaps the dossier with a quick pages-appear
// flash.
//
// Boss data lives in src/data/bossArchetypes.json. Each entry carries:
//   id, name, color, tagline, spriteFrame { col, row } (or null),
//   portraitAvailable, headline { name, summary, implemented }, mechanics[],
//   flavorText.
// Flip a mechanic's `implemented: false` → `true` to remove its WIP icon.

import { createGameState } from '../state/GameState.js'
import { SaveSystem }      from '../systems/SaveSystem.js'
import { Balance }         from '../config/balance.js'
import { COMPANIONS, DEFAULT_COMPANION } from '../systems/companions.js'
import { TitleMusic }      from '../systems/TitleMusic.js'
import { SfxVolume }       from '../systems/SfxVolume.js'
import { applyUiCamera, pixelLock, FONT_HEAD, uiSfxHover, uiSfxClick } from '../ui/UIKit.js'
import { UIEditor }        from '../ui/UIEditor.js'
import { PlayerProfile }   from '../systems/PlayerProfile.js'
import { UNLOCK_GATES, ALL_BOSS_IDS, getUnlockedBossIds } from '../data/bossUnlocks.js'

// Per-archetype unlock requirements. Empty entry = always unlocked.
// Each entry's `check()` returns true when the gate is satisfied.
//
// True Approach-A gating (2026-05-25): bosses are unlocked by their
// boss-level ACHIEVEMENT id, not by raw `maxBossLevel`. The achievement
// system retroactively grants those achievements on first boot for any
// save profile whose maxBossLevel already qualifies, so existing players
// see no behaviour change — the gate just moved one level up the
// abstraction stack. The `requiredLevel` field stays on each entry for
// display purposes (the lock-state label still reads "REACH BOSS LV N").
//
// Staggered progression — one boss unlocks at each new level reached,
// so each milestone (lv 2 → 10) hands the player something new to try.
// Unlocked from start: beholder, demon, gnoll. Then one boss per level
// from lv 2 (golem / `rising_power`) through lv 10 (slime / `dread_sovereign`).
//
// UNLOCK_GATES + ALL_BOSS_IDS now live in `src/data/bossUnlocks.js` so the
// main-menu NEW-tag cross-wiring (NEW EVIL button) can compute the
// unlocked-boss set without re-implementing the gate logic. Imported above.

// ─── Layout constants (design space 1280 × 720) ──────────────────────────────

// Book scale + center are computed per-viewport in create() and stored as
// instance fields (this._bookCX, _bookCY, _bookH, _halfH). Page bounds are
// derived from those at the same moment. Fractions below are measured against
// half the book sprite size — empirical, captured from the final open-book
// frame.
const BOOK_FRAME        = 272
const PAGE_TOP_FRAC     = -0.353
const PAGE_BOTTOM_FRAC  =  0.794
const LEFT_PAGE_L_FRAC  = -0.824
const LEFT_PAGE_R_FRAC  = -0.044
const RIGHT_PAGE_L_FRAC =  0.044
const RIGHT_PAGE_R_FRAC =  0.838

// COMPENDIUM grid is 3 cols × 4 rows. The portrait_border.png asset is the
// entire grid frame already painted — including the decorative scrollwork
// above and below — so we place it as a single sprite on the left page and
// derive slot centers from its layout. portrait_highlight.png (28×28) is one
// slot's hover/select halo, moved to whichever slot is active.
const GRID_COLS = 3
const GRID_ROWS = 4
const BORDER_W  = 105
const BORDER_H  = 131
// Slot centers in border-local pixels (top-left origin of the unscaled
// 105×131 sprite). Three columns evenly spaced; four rows sit between the
// top and bottom decorative bands. Measured by scanning the painted slot
// openings in the asset (parchment-light pixel runs) — each slot is 24×24
// native px, gap of 7 px between rows, gap of 7 px between columns.
const BORDER_SLOT_X = [23, 54, 85]
const BORDER_SLOT_Y = [16.5, 47.5, 78.5, 109.5]

// Sprite atlas: Monsters.png is 528 × 176, packed 7 × 2 grid of ~75 × 88 cells.
const SPR_COLS    = 7
const SPR_ROWS    = 2
const SPR_W       = 528 / SPR_COLS          // 75.43
const SPR_H       = 176 / SPR_ROWS          // 88

// Open-book + page-turn frame counts (4 cols × 3 / 4 rows = 12 / 16)
const OPEN_FRAMES      = 12
const PAGETURN_FRAMES  = 16

// ─── Scene ───────────────────────────────────────────────────────────────────

export class ArchetypeSelect extends Phaser.Scene {
  constructor() {
    super('ArchetypeSelect')
    this._archetypes = []
    this._selectedId = null
    this._hoverId    = null
    this._slots      = []          // [{ archId, draw }]
    this._dossierObjs = []
  }

  create() {
    // Title-screen music continues playing through the boss picker.
    // ensurePlaying is a no-op when already running (e.g. arrived from
    // MainMenu), and starts the loop fresh if the player jumped here
    // directly via a save state somehow.
    TitleMusic.ensurePlaying(this)

    // Stop any in-flight gameplay scenes from a previous run. The
    // player can reach here via main-menu → CompanionSelect →
    // ArchetypeSelect WITHOUT the previous run's Game / HudScene /
    // NightPhase / DayPhase ever being told to stop (scene.start only
    // swaps the calling scene, not parallel scenes). The leak surfaces
    // as the old DungeonRenderer's ROOM_PLACED listener firing inside
    // createGameState below — its scene.cameras.main is null because
    // Phaser already partially tore the scene down, and the boss-room
    // placement throws. Also leaks the old NpcDirector, which is why
    // companions speak each other's idle lines after a fresh pick.
    const sm = this.scene
    for (const key of ['Game', 'NightPhase', 'DayPhase', 'EndOfDay',
                       'Graveyard', 'KnowledgeScreen', 'HudScene']) {
      if (sm.isActive(key) || sm.isPaused(key)) sm.stop(key)
    }

    // Design space is 1280×720 — a true 16:9 frame matching the locked
    // canvas. The layout was originally authored against a 1450-wide
    // space, which forced the camera to letterbox + downscale ~12% on a
    // 16:9 screen — shrinking the book and softening every Text. The
    // saved layout in `assets/layouts/ArchetypeSelect.json` has been
    // re-centered for 1280×720 (x −85, y −10), so the book renders at
    // full 1:1 size, edge-to-edge with no letterbox bars. The book art
    // sits low within its 272×272 sprite frame, so the book sprite is
    // intentionally placed above the geometric centre (y≈255) to land
    // the *visible* book in the middle of the screen.
    const { width: W, height: H } = applyUiCamera(this, 1280, 720)
    this._W = W
    this._H = H

    // Per-visit state reset — Phaser reuses the scene instance across
    // scene.start(), so fields from a previous visit leak into the next
    // create(). In particular `_destroyed` (set true by the last shutdown)
    // would otherwise make _mountDecorOverlay bail and the companion never
    // appears when you BACK out and re-enter with a different companion.
    // The slot / dossier arrays are constructor-only, so without this they
    // would accumulate stale (destroyed) object refs across re-entries.
    this._destroyed   = false
    this._introDone   = false
    this._decor       = null
    this._slots       = []
    this._dossierObjs = []
    this._selectedId  = null
    this._hoverId     = null
    this._lockedId    = null
    // The lock-tooltip Text is created lazily on first hover of a locked
    // boss (see _showLockTooltip). The scene instance is reused across
    // visits, so without this reset the field still holds a reference
    // to the PREVIOUS visit's now-destroyed Text — _showLockTooltip's
    // existence check passes, setText/setPosition silently no-op on the
    // dead object, and the "REACH BOSS LV N" hover label never appears
    // on a second-or-later visit.
    this._lockTooltip = null

    // Text render-resolution multiplier. The boss-picker camera scales
    // the whole 1280×720 design space to fit the canvas; on most
    // displays that is an UPSCALE, and default 1×-resolution Phaser
    // Text upscaled by the GPU renders blurry. Rendering every Text's
    // internal canvas at this multiple keeps the lettering crisp at any
    // window size. Applied via _crispText() after content builds and
    // inline on the always-on chrome (back button, lock tooltip).
    this._textRes = Math.min(4, Math.max(2,
      Math.ceil((this.uiSf || 1) * (window.devicePixelRatio || 1))))
    this._archetypes = (this.cache.json.get('bossArchetypes') ?? []).slice()
      .sort((a, b) => a.name.localeCompare(b.name))

    // ── NEW-tag bookkeeping (per-player) ────────────────────────────────
    // Auto-detect: anything UNLOCKED that isn't in the persisted seen-set
    // paints a NEW pill. Hover dismisses (per-id, via the hit-rect's
    // pointerover handler below). No bulk-seed on first open — that was
    // the bug that suppressed every NEW tag on existing rosters. With
    // the seed gone, fresh players DO see NEW on every starter boss
    // (and starter companion on the recruit screen) the first time
    // they open the picker; one quick hover-pass dismisses each.
    // That's the trade-off the auto-detect approach signed up for.
    this._newBossesAtRender = PlayerProfile.getKnownBossIds()

    // ── Pick a book scale that fills the viewport without clipping. The book
    // sprite is square; we want it to take ~92% of the available height while
    // staying inside ~75% of the width (leaves breathing room around the book
    // for claws + the BACK chrome). Capped so giant displays don't blow it up.
    const scaleByH = (H * 0.98) / BOOK_FRAME
    const scaleByW = (W * 0.82) / BOOK_FRAME
    this._bookScale = Math.min(scaleByH, scaleByW, 3.8)
    this._bookH     = BOOK_FRAME * this._bookScale
    this._bookW     = this._bookH
    this._bookCX    = W / 2
    this._bookCY    = H / 2
    const halfH     = this._bookH / 2
    this._pageTop    = this._bookCY + PAGE_TOP_FRAC     * halfH
    this._pageBottom = this._bookCY + PAGE_BOTTOM_FRAC  * halfH
    this._leftPageL  = this._bookCX + LEFT_PAGE_L_FRAC  * halfH
    this._leftPageR  = this._bookCX + LEFT_PAGE_R_FRAC  * halfH
    this._rightPageL = this._bookCX + RIGHT_PAGE_L_FRAC * halfH
    this._rightPageR = this._bookCX + RIGHT_PAGE_R_FRAC * halfH

    // Solid backdrop — dim parchment-friendly tone behind the book.
    this.add.rectangle(W / 2, H / 2, W, H, 0x0c0810).setDepth(0)

    // Layout tuner — F2 toggles edit mode, Ctrl+S saves overrides.
    this.editor = new UIEditor(this)
    this.editor.configureBosses(
      this._archetypes.map(a => ({ id: a.id, label: a.name })),
      (id) => this._select(id)
    )
    this._setupBossSwitcherKeys()

    // Decorative surround for the empty space around the book. The
    // atmosphere (vignette / candle-glow / embers) and the pixel corner
    // frame are drawn in-scene; the header, footer and the chosen companion
    // are a DOM overlay (`ArchetypeDecorOverlay`) so they share the exact
    // fonts + chat-bubble styling of the CompanionSelect screen. Purely
    // additive — none of it touches the book sprite or picker logic.
    this.events.once('shutdown', () => {
      this._destroyed = true
      this._decor?.close()
      this._decor = null
    })
    this._buildAtmosphere()
    this._buildChrome()
    this._mountDecorOverlay()

    // The book occupies the centre. We start with the closed-book frame
    // (frame 0 of `bestiary-open`) and play the opening animation on a tween.
    // Sprite (not Image) so we can call play() on it for the open / page-turn
    // animations.
    this._book = this.add.sprite(this._bookCX, this._bookCY, 'bestiary-open', 0)
      .setScale(this._bookScale).setDepth(1)
    this.editor.register(this._book, 'book')
    if (this._book.texture && this._book.texture.setFilter) {
      // Crisp pixel art — no bilinear smoothing.
      this._book.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    }

    // Container populated AFTER the open animation completes (book < content).
    this._cContent = this.add.container(0, 0).setDepth(2).setAlpha(0)

    this._registerAnimations()
    this._playIntro()
  }

  // ─── Asset / animation registration ─────────────────────────────────────────

  _registerAnimations() {
    if (!this.anims.exists('bestiary-open-anim')) {
      this.anims.create({
        key:    'bestiary-open-anim',
        frames: this.anims.generateFrameNumbers('bestiary-open', { start: 0, end: OPEN_FRAMES - 1 }),
        frameRate: 12,
        repeat: 0,
      })
    }
    if (!this.anims.exists('bestiary-pageturn-l-anim')) {
      this.anims.create({
        key:    'bestiary-pageturn-l-anim',
        frames: this.anims.generateFrameNumbers('bestiary-pageturn-l', { start: 0, end: PAGETURN_FRAMES - 1 }),
        frameRate: 18,
        repeat: 0,
      })
    }
  }

  // ─── Intro choreography ─────────────────────────────────────────────────────

  _playIntro() {
    // Crisp pixel art — no bilinear smoothing during the open animation.
    const tex = this.textures.get('bestiary-open')
    if (tex && tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)

    // Open the book, then settle on the final frame and fade content in.
    // (The page-turn spritesheet was originally chained here as flair, but
    // its first frame shows a near-closed book, which read as a black flash
    // immediately after the open animation finished.)
    this._book.play('bestiary-open-anim')
    // One-shot book-open SFX timed to the opening animation.
    if (!SfxVolume.isMuted() && this.cache?.audio?.exists?.('sfx-book-open')) {
      try { this.sound.play('sfx-book-open', { volume: Math.min(1, 0.85 * SfxVolume.getVolume()) }) } catch {}
    }
    this._book.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this._book.setTexture('bestiary-open', OPEN_FRAMES - 1)
      this._buildPageContent()
      this.tweens.add({
        targets:  this._cContent,
        alpha:    1,
        duration: 350,
        ease:     'Sine.easeOut',
      })
      // No auto-select — highlight + dossier stay hidden until the user
      // hovers or clicks a portrait.
      // Book is open — bring the companion in at the side. The flag covers
      // the race where the overlay's async import resolves after this fires.
      this._introDone = true
      this._decor?.reveal()
    })
  }

  // ─── Page content (built once after the intro completes) ────────────────────

  _buildPageContent() {
    this._buildHeaders()
    this._buildGrid()
    this._buildDossier()
    this._buildBeginRun()
    // Spawn user-created text boxes / uploaded sprites from the saved layout.
    // Fire-and-forget — async only matters if the user added images.
    this.editor.loadDynamicItems()
    this._crispText(this._cContent)
  }

  // Walk a container tree and bump every Text object's render
  // resolution so the lettering stays sharp under the scene's camera
  // zoom. Idempotent — safe to re-run after _renderDossier swaps in a
  // fresh batch of dossier text.
  _crispText(root) {
    if (!root) return
    const kids = root.list ?? []
    for (const o of kids) {
      if (o && o.type === 'Text' && typeof o.setResolution === 'function') {
        o.setResolution(this._textRes)
      }
      if (o && o.list) this._crispText(o)
    }
  }

  _buildHeaders() {
    // COMPENDIUM ribbon centred on the left page
    const lcx = (this._leftPageL + this._leftPageR) / 2
    const compendium = this.add.text(lcx, this._pageTop + 20, 'COMPENDIUM', {
      fontSize: '15px', color: '#f4d28a', fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#3a1808', strokeThickness: 3,
    }).setOrigin(0.5)
    this._cContent.add(compendium)
    this.editor.register(compendium, 'compendium-header')
  }

  _buildGrid() {
    // ── Place the bestiary-portrait-border sprite once on the left page,
    // sized to fit the available area below the COMPENDIUM header. The
    // border art already paints all 12 slot openings + the decorative
    // scrollwork, so we don't draw any frames procedurally.
    // Cap so portraits stay at their tuned size when the book grows on bigger
    // viewports. The portrait_border + slot tuning was done at scale 2.73.
    const MAX_BORDER_SCALE = 2.75
    const availW = this._leftPageR - this._leftPageL
    const availH = this._pageBottom - this._pageTop
    const borderScale = Math.min(availW / BORDER_W, availH / BORDER_H, MAX_BORDER_SCALE)
    this._borderScale = borderScale
    const borderCX = (this._leftPageL + this._leftPageR) / 2
    // Vertically center the grid frame on the left page.
    const borderH = BORDER_H * borderScale
    const borderTop = this._pageTop + (availH - borderH) / 2
    this._borderTopLeftX = borderCX - (BORDER_W * borderScale) / 2
    this._borderTopLeftY = borderTop

    const border = this.add.image(this._borderTopLeftX, this._borderTopLeftY, 'bestiary-portrait-border')
      .setOrigin(0, 0).setScale(borderScale)
    if (border.texture && border.texture.setFilter) {
      border.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    this._cContent.add(border)
    this.editor.register(border, 'portrait-border')

    // ── Single highlight sprite, hidden until hover/select moves it.
    this._highlight = this.add.image(0, 0, 'bestiary-portrait-highlight')
      .setOrigin(0.5).setScale(borderScale).setVisible(false)
    if (this._highlight.texture && this._highlight.texture.setFilter) {
      this._highlight.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    this._cContent.add(this._highlight)
    this.editor.register(this._highlight, 'portrait-highlight')

    // Pulse alpha to give the ring a soft "glow" feel. Tween yoyos forever.
    if (this._highlightTween) this._highlightTween.stop()
    this._highlightTween = this.tweens.add({
      targets:  this._highlight,
      alpha:    { from: 0.55, to: 1 },
      duration: 700,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    })

    // ── Place portraits + invisible hit boxes at each slot center.
    let i = 0
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cx = this._borderTopLeftX + BORDER_SLOT_X[col] * borderScale
        const cy = this._borderTopLeftY + BORDER_SLOT_Y[row] * borderScale
        const arch = this._archetypes[i]
        if (arch) this._buildSlot(cx, cy, arch)
        // empty slots: the border art already shows the empty opening; no overlay needed.
        i++
      }
    }
    // Highlight always renders above portraits so its ring isn't hidden.
    this._cContent.bringToTop(this._highlight)
  }

  // Slot center is in scene coords; one slot opening is ~24×24 native px.
  _buildSlot(cx, cy, arch) {
    const slotPx = 24 * this._borderScale          // visible opening size
    const accent = parseColor(arch.color, 0xddaa22)

    // Unlock gate — per-archetype, persisted in PlayerProfile across runs.
    const gate     = UNLOCK_GATES[arch.id] ?? null
    const isLocked = !!gate && !PlayerProfile.isAchievementUnlocked(gate.achId)

    // Portrait — bestiary-pack 22×22 portrait if we have one for this boss,
    // else procedural silhouette.
    const portraitKey = `bestiary-portrait-${arch.id}`
    let portrait
    if (this.textures.exists(portraitKey)) {
      const img = this.add.image(cx, cy, portraitKey).setOrigin(0.5)
      if (img.texture && img.texture.setFilter) {
        img.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
      img.setScale(slotPx / 22)
      portrait = img
    } else {
      portrait = this._makeSilhouetteIcon(cx, cy, slotPx - 4, accent)
    }
    this._cContent.add(portrait)
    this.editor.register(portrait, `slot-${arch.id}`)

    // Locked: dim the portrait + tint it grey + overlay a small lock
    // icon. Positioning has to defer one tick because the UIEditor
    // applies layout-JSON overrides (e.g. succubus' custom x=575/y=492
    // and scale 1.671) to the portrait AFTER _buildSlot runs — drawing
    // the lock at the original (cx, cy) would strand it well below the
    // moved portrait.
    let lockGfx = null
    if (isLocked) {
      // Slight dim only — the lock icon is the primary "locked" tell;
      // we just want the portrait to read as a hair muted, not greyed
      // out. Alpha 0.75 + a soft warm tint keeps the boss recognisable.
      portrait.setAlpha(0.75)
      if (portrait.setTint) portrait.setTint(0xb0a090)
      // Lock lives at the SCENE ROOT (NOT inside _cContent). Putting
      // it in the container made it subject to whatever container-
      // level alpha animation, mask, or sibling z-order the bestiary
      // book is doing — even with bringToTop the previous attempt
      // wasn't visibly landing on top of the portrait.
      lockGfx = this.add.graphics().setDepth(9000)
      this.time.delayedCall(0, () => {
        if (!lockGfx || lockGfx.scene !== this) return
        const px = portrait.x ?? cx
        const py = portrait.y ?? cy
        const ph = portrait.displayHeight ?? slotPx
        const lockScale = Math.max(1, Math.round((ph * 0.45) / 9))
        pixelLock(lockGfx, px, py, lockScale, 0xeeeeee)
      })
    }

    // "NEW" pill — painted just above the portrait on unlocked bosses
    // the player hasn't been introduced to yet. Matches the visual style
    // of the main-menu / achievements / companion NEW badge (red/pink
    // pulsing pixel pill). Click-through (no input enabled); pointerover
    // on the hit rect below dismisses it. Locked bosses skip the pill
    // entirely — they get NEW only after they unlock (matches
    // CompanionSelectOverlay's "only after unlock" rule).
    //
    // IMPORTANT: pill lives at the SCENE ROOT (not inside `_cContent`).
    // The same comment on `lockGfx` above explains why — adding to the
    // bestiary-book container makes the overlay subject to whatever
    // alpha animation / mask / sibling z-order the book is doing, even
    // bringToTop didn't reliably land it on top. Scene root + a high
    // depth (9100) keeps it visibly above the book at all times.
    const isBossNew = !isLocked && !this._newBossesAtRender.has(arch.id)
    if (isBossNew) {
      // Position pill above the portrait. Defer one tick so any editor
      // layout-JSON override on the portrait has applied first (same
      // reason the lock glyph defers — succubus' custom x/y/scale).
      this.time.delayedCall(0, () => {
        if (!portrait || portrait.scene !== this) return
        const px = portrait.x ?? cx
        const py = portrait.y ?? cy
        const ph = portrait.displayHeight ?? slotPx
        const top = py - ph / 2 - 6
        // Scene-root container, high depth so it paints above the book.
        const pill = this.add.container(px, top).setDepth(9100)
        const w = 26, hgt = 11
        const bg = this.add.graphics()
        bg.fillStyle(0xff4d6a, 1)
        bg.fillRect(-w/2, -hgt/2, w, hgt)
        bg.lineStyle(1, 0x2a0a0c, 1)
        bg.strokeRect(-w/2 + 0.5, -hgt/2 + 0.5, w - 1, hgt - 1)
        const label = this.add.text(0, 0, 'NEW', {
          fontFamily: FONT_HEAD, fontSize: '7px', color: '#fff8e8',
        }).setOrigin(0.5, 0.5).setResolution(this._textRes)
        pill.add([bg, label])
        // Soft red glow + pulse — gentle scale 1.0 ↔ 1.08, looped.
        const tween = this.tweens.add({
          targets: pill, scale: 1.08, duration: 900, yoyo: true,
          repeat: -1, ease: 'Sine.easeInOut',
        })
        // Re-bind into the slot record so pointerover can find + remove
        // them on dismiss (the closure below picks them up via this._slots).
        const rec = this._slots.find(s => s.archId === arch.id)
        if (rec) { rec.newPill = pill; rec.newPillTween = tween }
      })
    }

    // Hit area follows the portrait's CURRENT displayed bounds. Editor
    // overrides can resize a slot to a non-default scale (e.g. succubus
    // ships at scaleX=1.671 vs the other bosses' 2.859), so a fixed
    // slotPx-sized hit rect would no longer match the visible portrait.
    // Use the portrait's display dimensions with a small pad, falling
    // back to the slotPx default for any non-image silhouette path.
    const hitW = Math.max(slotPx + 4, (portrait.displayWidth  ?? slotPx) + 6)
    const hitH = Math.max(slotPx + 4, (portrait.displayHeight ?? slotPx) + 6)
    const hit = this.add.rectangle(portrait.x, portrait.y, hitW, hitH, 0x000000, 0)
      .setDepth(portrait.depth ?? 0)
      .setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => {
      // Tactile hover chime — same as every other UI button. The helper
      // throttles to one chime per 80 ms so dragging across slots
      // doesn't machine-gun.
      uiSfxHover(this)
      // NEW-tag dismiss on hover (unlocked + still tagged only).
      // Persists the dismissal, drops the id from the in-memory snapshot
      // so a sibling re-render won't re-paint, then fades + destroys
      // the pill container. Locked bosses never had a pill in the first
      // place so this is a safe no-op for them.
      if (!isLocked && this._newBossesAtRender && !this._newBossesAtRender.has(arch.id)) {
        PlayerProfile.markBossKnown(arch.id)
        this._newBossesAtRender.add(arch.id)
        const rec = this._slots.find(s => s.archId === arch.id)
        const pill = rec?.newPill
        if (pill && pill.scene === this) {
          rec.newPillTween?.stop?.()
          this.tweens.add({
            targets: pill, alpha: 0, scale: 1.18, duration: 220,
            ease: 'Sine.easeOut',
            onComplete: () => pill.destroy(),
          })
          rec.newPill = null
          rec.newPillTween = null
        }
      }
      if (isLocked) {
        // Locked: show the floating REACH-LV tooltip above the slot
        // AND render a preview dossier on the right page with the
        // body darkened + abilities masked as `???`. We deliberately
        // do NOT call _select — that would change the persistent
        // selection (highlight, _selectedId) to a boss the player
        // can't actually run. Track `_dossierIsLocked` so pointerout
        // knows to revert the dossier back to the real selection.
        //
        // ALSO swap the editor's activeBossId to the previewed boss.
        // Without this, items pinned to that specific boss
        // (succubus' custom name banner via upload-6's bossId pin
        // being the canonical case) stay hidden — succubus' built-in
        // boss-name image is visibility-false in the layout JSON
        // because the upload-6 replaces it, so the dossier ends up
        // with no name at all. Pointerout's _select revert call
        // restores activeBossId to whatever was persistently
        // selected, so pinned items snap back when the hover ends.
        const px = portrait.x ?? cx
        const py = portrait.y ?? cy
        const ph = portrait.displayHeight ?? hitH
        this._showLockTooltip(px, py - ph / 2 - 6, gate.label)
        this.editor?.setActiveBoss(arch.id)
        this._renderDossier(arch, { locked: true, gate })
        this._dossierIsLocked = true
      } else {
        this._hideLockTooltip()
        this._select(arch.id)
        this._dossierIsLocked = false
      }
    })
    hit.on('pointerout', () => {
      this._hideLockTooltip()
      // Revert from a locked-preview dossier to whatever the player
      // last persistently selected. Falls through to the click-locked
      // boss first (via _select), then the last hovered unlocked boss
      // (_selectedId, also via _select for highlight/accent sync). If
      // neither exists, the locked preview simply lingers — the user
      // hasn't picked anything yet, so there's nothing meaningful to
      // revert to.
      if (this._dossierIsLocked) {
        this._dossierIsLocked = false
        const revertId = this._lockedId || this._selectedId
        if (revertId) this._select(revertId)
      } else if (this._lockedId && this._lockedId !== arch.id) {
        this._select(this._lockedId)
      }
    })
    hit.on('pointerdown', () => {
      // Locked archetypes can't become the run's selected boss. Tooltip
      // already explains the gate; ignoring the click is enough feedback.
      if (isLocked) return
      uiSfxClick(this)
      this._lockedId = arch.id
      this._select(arch.id)
    })
    this._cContent.add(hit)

    this._slots.push({
      archId: arch.id, portrait, hit, lockGfx, isLocked,
      // NEW-tag references — populated asynchronously by the delayedCall
      // above (newPill = Phaser container, newPillTween = the pulse tween).
      // Pointerover removes both when the player dismisses the tag.
      newPill: null, newPillTween: null,
    })
  }

  // Floating "REACH BOSS LV N TO UNLOCK" label that appears above a
  // locked slot on hover. Single shared label — moved + reused across
  // hovers rather than created per slot.
  _showLockTooltip(x, y, label) {
    if (!this._lockTooltip) {
      // Tooltip also lives at scene root (not inside _cContent) so
      // nothing in the bestiary book can stack on top of it. Bright
      // pure-black background + bold yellow text for max contrast
      // against the wood-grain bestiary page.
      this._lockTooltip = this.add.text(0, 0, '', {
        fontFamily: FONT_HEAD, fontSize: '9px',
        color: '#ffe488', letterSpacing: 2,
        stroke: '#000000', strokeThickness: 3,
        backgroundColor: '#000000',
        padding: { x: 8, y: 5 },
      }).setOrigin(0.5, 1).setDepth(9100).setResolution(this._textRes)
    }
    this._lockTooltip.setText(label).setPosition(x, y).setVisible(true)
  }

  _hideLockTooltip() {
    if (this._lockTooltip) this._lockTooltip.setVisible(false)
  }

  _showHighlight(cx, cy) {
    if (!this._highlight) return
    this._highlight.setPosition(cx, cy).setVisible(true)
  }

  // Crops a portrait rect from Monsters.png and returns a scaled image at (cx,cy).
  // Adds a named frame to the bestiary-monsters texture (idempotent — Phaser
  // textures cache frames by name) and creates an image using that frame.
  _makePortraitImage(cx, cy, spriteFrame, fitSize) {
    const sx = Math.round(spriteFrame.col * SPR_W)
    const sy = Math.round(spriteFrame.row * SPR_H)
    const sw = Math.round(SPR_W)
    const sh = Math.round(SPR_H)

    const tex = this.textures.get('bestiary-monsters')
    const frameName = `m-${spriteFrame.col}-${spriteFrame.row}`
    if (!tex.has(frameName)) tex.add(frameName, 0, sx, sy, sw, sh)

    const img = this.add.image(cx, cy, 'bestiary-monsters', frameName)
      .setOrigin(0.5)
    const scale = fitSize / sh
    img.setScale(scale)
    return img
  }

  _makeSilhouetteIcon(cx, cy, size, accent) {
    // Generic hooded humanoid silhouette, drawn in the boss accent colour at
    // 35% alpha so it reads as "?". Used for bosses we don't have art for yet.
    const g = this.add.graphics()
    g.fillStyle(accent, 0.35)
    // Head
    g.fillCircle(cx, cy - size * 0.18, size * 0.18)
    // Hood / shoulders triangle
    g.fillTriangle(
      cx - size * 0.32, cy + size * 0.32,
      cx + size * 0.32, cy + size * 0.32,
      cx,               cy - size * 0.10,
    )
    // Question mark over the silhouette
    const q = this.add.text(cx, cy, '?', {
      fontSize: `${Math.round(size * 0.5)}px`,
      color: '#000000',
      fontFamily: 'serif',
      fontStyle: 'bold',
      stroke: hexToCss(accent),
      strokeThickness: 2,
    }).setOrigin(0.5)
    const container = this.add.container(0, 0, [g, q])
    return container
  }

  // ─── Dossier (right page) ───────────────────────────────────────────────────

  _buildDossier() {
    // The right-page dossier lives between rightPageL and rightPageR. Cache
    // its inner box (with a small inset) on the scene so render passes can
    // recompute text wrapping without redoing layout math.
    this._dossierX = this._rightPageL + 8
    this._dossierW = (this._rightPageR - this._rightPageL) - 16

    // Decorative nameplate banner at the very top of the right page. The
    // boss name image is rendered on top of this in _renderDossier. Y is
    // its CENTER — keep it cached so per-boss renders can drop the name
    // image at the same coordinate.
    const cx = this._dossierX + this._dossierW / 2
    const plateScale = 2
    const plateNativeH = 35
    this._nameplateCY = this._pageTop + (plateNativeH * plateScale) / 2 + 6
    const plate = this.add.image(cx, this._nameplateCY, 'bestiary-nameplate')
      .setOrigin(0.5).setScale(plateScale).setDepth(2)
    if (plate.texture && plate.texture.setFilter) {
      plate.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    this._cContent.add(plate)
    this.editor.register(plate, 'nameplate')

    // The full-boss image sits just below the nameplate. _renderDossier
    // anchors its other text against this baseline.
    this._dossierTop = this._nameplateCY + (plateNativeH * plateScale) / 2 + 8
  }

  _buildBeginRun() {
    // The text label itself is the button — no separate sigil graphic.
    // Centred horizontally on screen, parked on the book's bottom edge
    // just below the page content — a standalone call-to-action.
    const cx = this._bookCX
    const cy = this._pageBottom - 2

    const label = this.add.text(cx, cy, 'BEGIN RUN', {
      fontSize: '26px', color: '#f4d28a', fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#3a1808', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(5).setInteractive({ useHandCursor: true })
    label.setResolution(this._textRes)
    this._cContent.add(label)

    label.on('pointerover',  () => label.setStyle({ color: '#fff5cc' }))
    label.on('pointerout',   () => label.setStyle({ color: '#f4d28a' }))
    label.on('pointerdown',  () => this._beginRun())

    // Reckoning NG+ tier selector (KR P7) — only once the campaign has been won.
    // A violet chip above BEGIN RUN that cycles BASE → NG+1 → … → NG+(earned).
    const earned = PlayerProfile.getReckoningTier()
    if (earned > 0) {
      if (this._ngTier == null || this._ngTier > earned) this._ngTier = earned
      const chip = this.add.text(cx, cy - 38, '', {
        fontSize: '15px', color: '#c98bff', fontFamily: 'serif', fontStyle: 'bold',
        stroke: '#1a0e2a', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(5).setInteractive({ useHandCursor: true })
      chip.setResolution(this._textRes)
      this._cContent.add(chip)
      const paint = () => chip.setText(this._ngTier > 0 ? `RECKONING  NG+${this._ngTier}  ▸` : 'BASE CAMPAIGN  ▸')
      paint()
      chip.on('pointerdown', () => { this._ngTier = (this._ngTier + 1) % (earned + 1); paint() })
      chip.on('pointerover', () => chip.setStyle({ color: '#e8c8ff' }))
      chip.on('pointerout',  () => chip.setStyle({ color: '#c98bff' }))
    }

    // The wax-seal accent updater is a no-op now that the seal is gone, but
    // keep it defined so _select() can still call it without a guard.
    this._sealDraw = () => {}
  }

  // ─── Selection / preview ────────────────────────────────────────────────────

  _previewDossier(archId) {
    if (!archId) return
    const arch = this._archetypes.find(a => a.id === archId)
    if (!arch) return
    this._renderDossier(arch)
  }

  _select(archId) {
    this._selectedId = archId
    const arch = this._archetypes.find(a => a.id === archId)
    if (!arch) return
    // Notify the editor so it can highlight the matching boss button + show
    // only items pinned to this boss (or unpinned ones).
    this.editor?.setActiveBoss(archId)
    const accent = parseColor(arch.color, 0xddaa22)

    // Highlight selected slot
    const sel = this._slots.find(s => s.archId === archId)
    if (sel) this._showHighlight(sel.portrait.x, sel.portrait.y)

    // Wax seal accent updates
    this._sealDraw?.(false, accent)

    // Render dossier
    this._renderDossier(arch)

    // Decorative surround follows the focused boss — accent tint + the
    // companion's reaction to whichever boss the player is inspecting.
    this._applyAccent(accent)
    this._decor?.reactToBoss(archId)
  }

  _renderDossier(arch, opts = {}) {
    // `locked: true` renders a teaser version of the right page for a
    // locked boss — name + body sprite still show (so the player can
    // see who they're unlocking), but the body is darkened, the
    // ability cards are masked as ???, and a "REACH LV N TO UNLOCK"
    // line replaces the flavor quote. The editor.register calls still
    // run normally so the layout JSON applies the same per-boss
    // positions for the previewed (locked) boss as for the unlocked
    // one — only the contents change.
    const locked = !!opts.locked
    const gate   = opts.gate ?? null

    // Tear down previous dossier content (the static nameplate stays put).
    // Also unregister those entries from the editor so the new boss's items
    // can claim per-boss-prefixed names without leaving destroyed-object
    // entries behind.
    for (const o of this._dossierObjs) {
      const entry = this.editor.items.find(i => i.obj === o)
      if (entry) this.editor.unregister(entry.name)
      o.destroy()
    }
    this._dossierObjs = []

    const accent = parseColor(arch.color, 0xddaa22)
    const cx = this._dossierX + this._dossierW / 2
    const prefix = `${arch.id}/`

    // Boss name image, rendered ON TOP of the static nameplate banner.
    // Lich (no name image) falls back to stylized text inside the nameplate.
    const nameKey = `bestiary-name-${arch.id}`
    let nameObj
    if (this.textures.exists(nameKey)) {
      const nameImg = this.add.image(cx, this._nameplateCY, nameKey).setOrigin(0.5)
      if (nameImg.texture && nameImg.texture.setFilter) {
        nameImg.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
      nameImg.setScale(2).setDepth(3)
      this._cContent.add(nameImg)
      this._dossierObjs.push(nameImg)
      nameObj = nameImg
    } else {
      const name = this.add.text(cx, this._nameplateCY, arch.name.toUpperCase(), {
        fontSize: '18px', color: '#f4d28a', fontFamily: 'serif', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(3)
      this._cContent.add(name)
      this._dossierObjs.push(name)
      nameObj = name
    }
    this.editor.register(nameObj, `${prefix}boss-name`, { fallbackName: 'boss-name' })

    // Boss full body image — sits below the nameplate, fit to ~100 px tall.
    let sprite
    const fullKey = `bestiary-full-${arch.id}`
    if (this.textures.exists(fullKey)) {
      const img = this.add.image(cx, this._dossierTop + 50, fullKey).setOrigin(0.5)
      if (img.texture && img.texture.setFilter) {
        img.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
      const tex = this.textures.get(fullKey).getSourceImage()
      const fitH = 100
      const maxW = this._dossierW * 0.8
      img.setScale(Math.min(fitH / tex.height, maxW / tex.width))
      sprite = img
    } else {
      sprite = this._makeSilhouetteIcon(cx, this._dossierTop + 50, 90, accent)
    }
    sprite.setDepth(2)
    this._cContent.add(sprite)
    this._dossierObjs.push(sprite)
    this.editor.register(sprite, `${prefix}boss-full-body`, { fallbackName: 'boss-full-body' })
    // Locked: dim the body sprite + cool grey tint so the boss reads
    // as silhouetted / out-of-reach without becoming unrecognisable.
    // Tint applied AFTER editor.register so a layout-saved tint (none
    // ships today) wouldn't get clobbered.
    if (locked) {
      sprite.setAlpha(0.45)
      if (sprite.setTint) sprite.setTint(0x556677)
    }

    // Ability plaques — the signature headline first, then supporting
    // mechanics. Each is a self-contained card centred on the page, so
    // the layout is uniform across every boss. When locked, names are
    // masked to "???" and bodies to a generic unlock hint so the cards
    // still occupy the same shapes/positions (no layout reflow).
    const LOCKED_NAME = '???'
    const LOCKED_BODY = '— Defeat heroes to unlock this boss’s secrets —'
    let yCursor = this._dossierTop + 60
    const cardW = this._dossierW - 8
    if (arch.headline) {
      const r = this._renderAbilityCard(
        cx, yCursor, cardW,
        locked ? LOCKED_NAME : arch.headline.name,
        locked ? LOCKED_BODY : arch.headline.summary,
        accent, true)
      yCursor = r.bottomY + 8
    }
    if (Array.isArray(arch.mechanics)) {
      for (const m of arch.mechanics) {
        const parsed = _parseMechanic(m?.text ?? '')
        const r = this._renderAbilityCard(
          cx, yCursor, cardW,
          locked ? LOCKED_NAME : parsed.name,
          locked ? LOCKED_BODY : parsed.body,
          accent, false)
        yCursor = r.bottomY + 8
      }
    }

    // Flavor — anchored to the bottom-band above the wax seal. Wrap
    // pulled well inside the page so the italic quote can't run past
    // the right edge of the book. Suppressed entirely on the locked
    // preview — the floating REACH-LV tooltip above the slot already
    // communicates the gate, and showing it again on the dossier
    // ended up reading as redundant chrome.
    if (!locked && arch.flavorText) {
      const flav = this.add.text(cx, this._pageBottom - 60, `"${arch.flavorText}"`, {
        fontSize: '10px', color: '#7a6a4a', fontFamily: 'serif', fontStyle: 'italic',
        wordWrap: { width: this._dossierW - 50 }, align: 'center',
      }).setOrigin(0.5, 1).setDepth(2)
      this.editor.register(flav, `${prefix}flavor-quote`, { fallbackName: 'flavor-quote' })
      this._cContent.add(flav)
      this._dossierObjs.push(flav)
    }

    // Sharpen every Text just created for this dossier.
    this._crispText(this._cContent)
  }

  // Renders one boss ability as a centred plaque — a boss-colour card
  // with a pixel-font name (sigil diamonds flanking it) and a wrapped,
  // centred description. `isHeadline` gets the bolder "signature" look.
  // Uniform across every boss; no per-boss layout tuning involved.
  _renderAbilityCard(cx, y, panelW, nameStr, bodyStr, accent, isHeadline) {
    const padTop = 6
    const gap    = 4
    const padBot = 8
    const innerW = panelW - 26   // description wrap width (room for padding)

    let name = null
    if (nameStr) {
      name = this.add.text(cx, y + padTop, String(nameStr).toUpperCase(), {
        fontFamily: FONT_HEAD, fontSize: isHeadline ? '10px' : '9px',
        color: hexToCss(accent), fontStyle: 'bold', align: 'center',
      }).setOrigin(0.5, 0).setDepth(2)
      // Dark stroke so the accent-coloured name punches off the parchment.
      name.setStroke('#1c0e04', 3)
      this._cContent.add(name)
      this._dossierObjs.push(name)
    }

    // Description — VT323 is the game's body pixel font (force-loaded by
    // Boot.js), matching the menu typography. Capitalised so each
    // mechanic reads as a proper sentence.
    const bodyY = name ? (name.y + name.height + gap) : (y + padTop)
    const body = this.add.text(cx, bodyY, _capFirst(String(bodyStr ?? '')), {
      fontFamily: '"VT323", monospace', fontSize: '13px', color: '#3a1808',
      align: 'center', wordWrap: { width: innerW }, lineSpacing: 1,
    }).setOrigin(0.5, 0).setDepth(2)
    this._cContent.add(body)
    this._dossierObjs.push(body)

    const cardX = cx - panelW / 2
    const cardH = (body.y + body.height + padBot) - y

    // Plaque — boss-colour wash + border + edge-bars, drawn behind the
    // text (depth 1 vs 2). The headline gets the stronger signature look.
    const g = this.add.graphics().setDepth(1)
    g.fillStyle(accent, isHeadline ? 0.17 : 0.10)
    g.fillRoundedRect(cardX, y, panelW, cardH, 4)
    g.lineStyle(isHeadline ? 2 : 1, accent, isHeadline ? 0.9 : 0.55)
    g.strokeRoundedRect(cardX, y, panelW, cardH, 4)
    g.fillStyle(accent, isHeadline ? 1 : 0.7)
    g.fillRect(cardX + 2,          y + 4, 3, cardH - 8)
    g.fillRect(cardX + panelW - 5, y + 4, 3, cardH - 8)
    // Sigil diamonds flanking the name.
    if (name) {
      const sy   = name.y + name.height / 2
      const half = name.width / 2
      const r    = isHeadline ? 4 : 3
      this._drawSigil(g, cx - half - 11, sy, r, accent)
      this._drawSigil(g, cx + half + 11, sy, r, accent)
    }
    this._cContent.add(g)
    this._dossierObjs.push(g)

    return { bottomY: y + cardH }
  }

  // Small filled accent diamond — an ability sigil.
  _drawSigil(g, x, y, r, color) {
    g.fillStyle(color, 1)
    g.fillPoints([
      { x,        y: y - r },
      { x: x + r, y },
      { x,        y: y + r },
      { x: x - r, y },
    ], true)
  }

  // ─── Boss switcher (edit-mode helper) ──────────────────────────────────────
  //
  // In edit mode the UIEditor's drag handles intercept clicks on slot
  // portraits, which means the dossier no longer switches when you hover a
  // boss. Number keys 1–9 + 0 cycle through the bosses (alphabetical order)
  // so layouts can be tuned per-boss without leaving the editor.

  _setupBossSwitcherKeys() {
    const codes = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'ZERO']
    codes.forEach((code, i) => {
      this.input.keyboard.on(`keydown-${code}`, (e) => {
        if (e.ctrlKey || e.metaKey) return
        const arch = this._archetypes[i]
        if (arch) this._select(arch.id)
      })
    })
  }

  // ─── Decorative surround (atmosphere · chrome · companion) ──────────────────
  //
  // Everything below is additive dressing for the empty space around the
  // bestiary book — it never touches the book sprite or the picker grid.
  // Three groups: atmosphere (vignette + candle-glow + drifting embers),
  // chrome (header title, footer instruction, accent corner-frame) and the
  // chosen companion, who stands at the right and reacts to whichever boss
  // the player is inspecting using their own `specifics.boss` dialogue bank.

  _buildAtmosphere() {
    const W = this._W, H = this._H
    this._makeAtmosTextures()

    // Warm candle-glow radiating from the book — additive, so it brightens
    // the book art and spills a little light into the dark margins.
    if (this.textures.exists('arch-glow')) {
      this._bookGlow = this.add.image(this._bookCX, this._bookCY, 'arch-glow')
        .setDepth(1.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(this._blendColors(0xffd6a2, 0xddaa22, 0.4))
      this._bookGlow.setDisplaySize(W * 0.92, H * 1.34)
      // Soft candle-flicker.
      this.tweens.add({
        targets: this._bookGlow, alpha: { from: 0.82, to: 1 },
        duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      })
    }

    // Drifting embers — additive, so they glow in the dark surround and all
    // but vanish over the bright parchment (keeps the page text readable).
    if (this.textures.exists('arch-ember')) {
      this._embers = this.add.particles(0, 0, 'arch-ember', {
        x: { min: 0, max: W },
        y: H + 30,
        lifespan: { min: 6500, max: 12000 },
        speedY: { min: -38, max: -16 },
        speedX: { min: -13, max: 13 },
        scale: { start: 0.55, end: 0.1 },
        alpha: { start: 0.55, end: 0 },
        tint: [0xffb24d, 0xff8a36, 0xffd98a, 0xff7a2a],
        frequency: 340,
        quantity: 1,
        blendMode: 'ADD',
      }).setDepth(4.5)
    }

    // Edge vignette — frames the book in shadow. Sits above the page content
    // but below the companion + chrome so neither of those gets dimmed.
    if (this.textures.exists('arch-vignette')) {
      this._vignette = this.add.image(W / 2, H / 2, 'arch-vignette').setDepth(4)
      this._vignette.setDisplaySize(W, H)
    }
  }

  _makeAtmosTextures() {
    // Small soft ember dot.
    if (!this.textures.exists('arch-ember')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 0.35); g.fillCircle(4, 4, 4)
      g.fillStyle(0xffffff, 1);    g.fillCircle(4, 4, 2.4)
      g.generateTexture('arch-ember', 8, 8)
      g.destroy()
    }
    // Radial candle-glow — a white alpha gradient, tinted warm at use.
    if (!this.textures.exists('arch-glow')) {
      const S = 256
      const cv = this.textures.createCanvas('arch-glow', S, S)
      if (cv) {
        const ctx = cv.getContext()
        const grd = ctx.createRadialGradient(S / 2, S / 2, 6, S / 2, S / 2, S / 2)
        grd.addColorStop(0,    'rgba(255,255,255,0.6)')
        grd.addColorStop(0.45, 'rgba(255,255,255,0.2)')
        grd.addColorStop(1,    'rgba(255,255,255,0)')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, S, S)
        cv.refresh()
      }
    }
    // Edge vignette.
    if (!this.textures.exists('arch-vignette')) {
      const VW = 320, VH = 180
      const cv = this.textures.createCanvas('arch-vignette', VW, VH)
      if (cv) {
        const ctx = cv.getContext()
        const maxR = Math.hypot(VW / 2, VH / 2)
        const grd = ctx.createRadialGradient(VW / 2, VH / 2, maxR * 0.40, VW / 2, VH / 2, maxR)
        grd.addColorStop(0,    'rgba(0,0,0,0)')
        grd.addColorStop(0.55, 'rgba(0,0,0,0)')
        grd.addColorStop(0.80, 'rgba(6,3,10,0.42)')
        grd.addColorStop(1,    'rgba(3,1,6,0.9)')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, VW, VH)
        cv.refresh()
      }
    }
  }

  _buildChrome() {
    // Accent colour — default gold, recoloured per focused boss by
    // _applyAccent (drives the book-glow tint + the DOM overlay's header
    // accent). The header / footer / companion all live in the DOM overlay
    // (ArchetypeDecorOverlay); nothing chrome-like is drawn in-scene.
    this._accent = 0xddaa22
  }

  // Recolours the book-glow and the DOM overlay's accent to the focused
  // boss's signature colour. No-op when unchanged.
  _applyAccent(accent) {
    if (accent == null || accent === this._accent) return
    this._accent = accent
    if (this._bookGlow) this._bookGlow.setTint(this._blendColors(0xffd6a2, accent, 0.44))
    this._decor?.setAccent(hexToCss(accent))
  }

  // Linear blend between two 0xRRGGBB colours (t = 0 → a, t = 1 → b).
  _blendColors(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
    const r  = Math.round(ar + (br - ar) * t)
    const gg = Math.round(ag + (bg - ag) * t)
    const bl = Math.round(ab + (bb - ab) * t)
    return (r << 16) | (gg << 8) | bl
  }

  // ─── Companion + chrome overlay ─────────────────────────────────

  // Mounts the DOM decorative overlay — header, footer and the chosen
  // companion. DOM (not Phaser) so it reuses the CompanionSelect screen's
  // exact fonts and the in-game chat-bubble styling. The overlay root is
  // pointer-events:none, so the Phaser book + picker keep every click;
  // only its BACK button re-enables pointer events.
  _mountDecorOverlay() {
    import("../hud/ArchetypeDecorOverlay.js").then(({ ArchetypeDecorOverlay }) => {
      if (this._destroyed || !this.scene.isActive()) return
      this._decor = new ArchetypeDecorOverlay(this)
      this._decor.open()
      this._decor.setAccent(hexToCss(this._accent ?? 0xddaa22))
      // The intro may already have finished while the import was in flight.
      if (this._introDone) this._decor.reveal()
    })
  }

  // ─── Begin run ──────────────────────────────────────────────────────────────

  _beginRun() {
    if (!this._selectedId) return
    // Defensive: refuse to start a run on a locked archetype even if
    // something other than the slot click ever set _selectedId.
    const gate = UNLOCK_GATES[this._selectedId]
    if (gate && !PlayerProfile.isAchievementUnlocked(gate.achId)) return

    // Pass the rooms cache so createGameState picks up `theme` + `tileLayout`
    // edits the user authored in the Room Editor onto the boss chamber.
    const rooms = this.cache.json.get('rooms')
    // Companion picked on the CompanionSelect screen (which runs before
    // this scene and persists the choice to localStorage). Validated
    // against the registry so a stale / hand-edited value can't slip
    // through; an absent value defaults to the first companion.
    let companionId = DEFAULT_COMPANION
    try {
      const stored = localStorage.getItem('qf.companion')
      if (stored && COMPANIONS[stored]) companionId = stored
    } catch {}
    const state = createGameState(this._selectedId, rooms, companionId)
    // Reckoning NG+ (KR P7) — stamp the chosen tier (clamped to what's earned)
    // so the whole run scales harder. 0 = base campaign. Save-safe (plain int).
    state.meta.reckoningTier = Math.max(0, Math.min(this._ngTier ?? 0, PlayerProfile.getReckoningTier()))
    // Mango dev shortcut — MainMenu's "JUMP TO DAY 50" entry stamps these
    // one-shot flags. Read + clear them here so a normal run started
    // afterward doesn't pick up stale values. Plumbing the boss state
    // before save means BossSystem._init's migration path takes over (it
    // detects existing boss data and only fills missing fields) instead
    // of fresh-initialising at level 1.
    this._applyDevStartOverrides(state)
    SaveSystem.save(state)
    // Title music carries through into the dungeon; Game.create() ducks
    // it to a quieter background level via TitleMusic.duckForGameplay.
    this.scene.start('Game', { gameState: state })
  }

  // Consume the mango dev-start localStorage flags (set by MainMenu's
  // "JUMP TO DAY 50" entry) and stamp the resulting overrides onto the
  // freshly-built gameState. One-shot: flags are deleted immediately so
  // the next NEW EVIL starts a normal day-1 run.
  //
  // - dayNumber: bumps meta.dayNumber (+ totalDaysElapsed) so DayPhase's
  //   baseCount formula and any day-gated unlock/event roll behaves as
  //   if N days had already elapsed.
  // - bossLevel: pre-populates state.boss with archetype-base stats
  //   scaled by the per-level deltas (HP/ATK/DEF), level, xpToNext.
  //   BossSystem._init detects existing boss data and migrates fields
  //   instead of fresh-initialising at level 1.
  _applyDevStartOverrides(state) {
    let devDay = 0, devLv = 0
    try {
      devDay = parseInt(localStorage.getItem('qf.dev.startDayNumber') ?? '0', 10) || 0
      devLv  = parseInt(localStorage.getItem('qf.dev.startBossLevel') ?? '0', 10) || 0
    } catch {}
    try {
      localStorage.removeItem('qf.dev.startDayNumber')
      localStorage.removeItem('qf.dev.startBossLevel')
    } catch {}
    if (devDay > 1) {
      state.meta.dayNumber = devDay
      if (state.player) state.player.totalDaysElapsed = Math.max(0, devDay - 1)
    }
    if (devLv > 1) {
      const archs = this.cache.json.get('bossArchetypes') ?? []
      const arch  = archs.find(a => a.id === this._selectedId)
      const base  = arch?.baseFightStats ?? { hp: 200, attack: 12, defense: 10 }
      const lvOver = devLv - 1
      const maxHp = base.hp + lvOver * (Balance.BOSS_HP_PER_LEVEL ?? 15)
      state.boss = {
        instanceId:       'boss',
        hp:               maxHp,
        maxHp,
        attack:           base.attack  + lvOver * (Balance.BOSS_ATK_PER_LEVEL ?? 1),
        defense:          base.defense + lvOver * (Balance.BOSS_DEF_PER_LEVEL ?? 1),
        level:            devLv,
        xp:               0,
        xpToNext:         Math.round((Balance.BOSS_XP_BASE ?? 50) * Math.pow(Balance.BOSS_XP_SCALE ?? 1.5, lvOver)),
        deathsRemaining:  Balance.BOSS_DEFEATS_TO_GAME_OVER ?? 3,
        totalLivesEverHad: Balance.BOSS_DEFEATS_TO_GAME_OVER ?? 3,
        unlockedAbilities: [],
      }
      console.info(`[Mango dev] Starting at day ${devDay} with boss level ${devLv} (HP ${maxHp} / ATK ${state.boss.attack} / DEF ${state.boss.defense}).`)
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseColor(c, fallback) {
  if (typeof c === 'number') return c
  if (typeof c === 'string') {
    const n = parseInt(c, 16)
    if (!Number.isNaN(n)) return n
  }
  return fallback
}

function hexToCss(n) {
  return '#' + n.toString(16).padStart(6, '0')
}

// Capitalise the first letter so a mechanic body — authored as the tail
// of a "Name — body" string — reads as a proper standalone sentence.
function _capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

// Splits a mechanic's "Name — body" string into its two halves. With no
// separator the whole string is treated as the body (no name line).
function _parseMechanic(text) {
  const raw = String(text ?? '')
  const sep = ' — '
  const i = raw.indexOf(sep)
  if (i < 0) return { name: null, body: raw }
  return { name: raw.slice(0, i).trim(), body: raw.slice(i + sep.length).trim() }
}

