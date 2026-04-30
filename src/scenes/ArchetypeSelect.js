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
import { TitleMusic }      from '../systems/TitleMusic.js'
import { applyUiCamera }   from '../ui/UIKit.js'
import { UIEditor }        from '../ui/UIEditor.js'

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

    const { width: W, height: H } = applyUiCamera(this)
    this._W = W
    this._H = H
    this._archetypes = (this.cache.json.get('bossArchetypes') ?? []).slice()
      .sort((a, b) => a.name.localeCompare(b.name))

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

    // Back button — visible immediately, lets the user bail out of the intro
    this._drawBackButton()

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

    // Hit area follows the portrait. Hover previews the boss; click LOCKS it
    // so leaving another hovered slot snaps back to the locked one.
    const hit = this.add.rectangle(portrait.x, portrait.y, slotPx + 4, slotPx + 4, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => this._select(arch.id))
    hit.on('pointerout', () => {
      if (this._lockedId && this._lockedId !== arch.id) this._select(this._lockedId)
    })
    hit.on('pointerdown', () => {
      this._lockedId = arch.id
      this._select(arch.id)
    })
    this._cContent.add(hit)

    this._slots.push({ archId: arch.id, portrait, hit })
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
    const cx = this._dossierX + this._dossierW / 2
    const cy = this._pageBottom - 30

    const label = this.add.text(cx, cy, 'BEGIN RUN', {
      fontSize: '14px', color: '#f4d28a', fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#3a1808', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(5).setInteractive({ useHandCursor: true })
    this._cContent.add(label)
    this.editor.register(label, 'begin-run-label')

    label.on('pointerover',  () => label.setStyle({ color: '#fff5cc' }))
    label.on('pointerout',   () => label.setStyle({ color: '#f4d28a' }))
    label.on('pointerdown',  () => this._beginRun())

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
  }

  _renderDossier(arch) {
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

    // Headline mechanic — bold name + 1-line summary, starting just below the
    // full body image (image bottom = dossierTop + 100).
    let yCursor = this._dossierTop + 110
    if (arch.headline) {
      const headlineRow = this._renderHeadlineMechanic(this._dossierX + 8, yCursor, this._dossierW - 16, arch.headline, accent, prefix)
      yCursor = headlineRow.bottomY + 8
    }

    // Supporting mechanics
    if (Array.isArray(arch.mechanics)) {
      arch.mechanics.forEach((m, idx) => {
        const row = this._renderMechanicBullet(this._dossierX + 8, yCursor, this._dossierW - 16, m, accent, idx, prefix)
        yCursor = row.bottomY + 4
      })
    }

    // Flavor — anchored to the bottom-band above the wax seal
    if (arch.flavorText) {
      const flav = this.add.text(cx, this._pageBottom - 60, `"${arch.flavorText}"`, {
        fontSize: '10px', color: '#7a6a4a', fontFamily: 'serif', fontStyle: 'italic',
        wordWrap: { width: this._dossierW - 30 }, align: 'center',
      }).setOrigin(0.5, 1).setDepth(2)
      this.editor.register(flav, `${prefix}flavor-quote`, { fallbackName: 'flavor-quote' })
      this._cContent.add(flav)
      this._dossierObjs.push(flav)
    }
  }

  _renderHeadlineMechanic(x, y, w, headline, accent, prefix = '') {
    const title = this.add.text(x + 14, y, headline.name.toUpperCase(), {
      fontSize: '11px', color: hexToCss(accent), fontFamily: 'serif', fontStyle: 'bold',
    }).setOrigin(0, 0).setDepth(2)
    this._cContent.add(title)
    this._dossierObjs.push(title)
    this.editor.register(title, `${prefix}headline-title`, { fallbackName: 'headline-title' })

    const summary = this.add.text(x + 14, y + 14, headline.summary ?? '', {
      fontSize: '9px', color: '#d4b890', fontFamily: 'serif',
      wordWrap: { width: w - 14 }, lineSpacing: 1,
    }).setOrigin(0, 0).setDepth(2)
    this._cContent.add(summary)
    this._dossierObjs.push(summary)
    this.editor.register(summary, `${prefix}headline-summary`, { fallbackName: 'headline-summary' })

    return { bottomY: y + 14 + summary.height }
  }

  _renderMechanicBullet(x, y, w, mech, accent, idx = 0, prefix = '') {
    const bullet = this.add.text(x, y, '•', {
      fontSize: '10px', color: hexToCss(accent), fontFamily: 'serif', fontStyle: 'bold',
    }).setOrigin(0, 0).setDepth(2)
    this._cContent.add(bullet)
    this._dossierObjs.push(bullet)
    this.editor.register(bullet, `${prefix}mechanic-${idx}-bullet`, { fallbackName: `mechanic-${idx}-bullet` })

    const txt = this.add.text(x + 10, y, mech.text ?? '', {
      fontSize: '9px', color: '#c8b090', fontFamily: 'serif',
      wordWrap: { width: w - 22 }, lineSpacing: 1,
    }).setOrigin(0, 0).setDepth(2)
    this._cContent.add(txt)
    this._dossierObjs.push(txt)
    this.editor.register(txt, `${prefix}mechanic-${idx}-text`, { fallbackName: `mechanic-${idx}-text` })

    return { bottomY: y + txt.height }
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

  // ─── Footer / chrome ────────────────────────────────────────────────────────

  _drawBackButton() {
    const back = this.add.text(20, 20, '◀ BACK', {
      fontSize: '14px', color: '#a08868', fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0, 0).setDepth(10).setInteractive({ useHandCursor: true })
    back.on('pointerover', () => back.setStyle({ color: '#f4d28a' }))
    back.on('pointerout',  () => back.setStyle({ color: '#a08868' }))
    back.on('pointerdown', () => this.scene.start('MainMenu'))
    this.editor.register(back, 'back-button')
  }

  // ─── Begin run ──────────────────────────────────────────────────────────────

  _beginRun() {
    if (!this._selectedId) return
    // Pass the rooms cache so createGameState picks up `theme` + `tileLayout`
    // edits the user authored in the Room Editor onto the boss chamber.
    const rooms = this.cache.json.get('rooms')
    const state = createGameState(this._selectedId, rooms)
    SaveSystem.save(state)
    // Title music carries through into the dungeon; Game.create() ducks
    // it to a quieter background level via TitleMusic.duckForGameplay.
    this.scene.start('Game', { gameState: state })
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

