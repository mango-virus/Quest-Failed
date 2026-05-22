// MainMenu — Crypt theme, split-screen Variant A.
//
// Phase 31B of the UI/HUD overhaul (DESIGN.md → "UI / HUD overhaul (2026-05-01)").
// 1.4:1 split: cinematic dungeon scene on the left with the QUEST/FAILED title
// stack; dark menu panel on the right with run readout + 5-button menu +
// blinking "PRESS Z TO CONTINUE" + flavor quote + version footer.
//
// Five primary actions: CONTINUE / NEW EVIL / LEADERBOARD / OPTIONS / QUIT.
// A small bottom-left dev cluster preserves access to editors + Graveyard
// (the design has no slot for these; they stay reachable until 31G/options
// or a future dev panel takes over).

import { SaveSystem }    from '../systems/SaveSystem.js'
import { TitleMusic }    from '../systems/TitleMusic.js'
import { GameplayMusic } from '../systems/GameplayMusic.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { NameEntryPanel } from '../ui/NameEntryPanel.js'
import { kickOffAdventurerAtkLoad } from './AdventurerAtkLoader.js'
import {
  CRYPT, FONT_HEAD, FONT_BODY,
  pixelPanel, pixelButton,
} from '../ui/UIKit.js'

// Logical design size — letterboxed inside the actual canvas.
const W = 1280
const H = 720

// Split point: design is 1.4 : 1 (left : right).
const LEFT_W  = Math.round(W * 1.4 / 2.4)   // 747
const RIGHT_X = LEFT_W
const RIGHT_W = W - LEFT_W

const VERSION = 'v0.1.0'

// Title-screen videos that should be horizontally mirrored (boss facing
// the wrong way relative to the QUEST/FAILED title on the bottom-left).
// All other clips render as-is, centered cover-fit.
const TITLE_VIDEO_FLIP_X = new Set([
  'title-vid-05',
  'title-vid-11',
])

export class MainMenu extends Phaser.Scene {
  constructor() {
    super('MainMenu')
    this._objects = []
    this._buttons = []
    this._tweens  = []
  }

  create() {
    // Title-screen music — keep the loop running continuously across
    // MainMenu / ArchetypeSelect transitions.
    GameplayMusic.stop()
    TitleMusic.ensurePlaying(this)

    // Under the new DOM HUD, the title screen is `MainMenuOverlay`. Mount
    // it and skip the Phaser scene's procedural rendering entirely. Stays
    // in the Phaser scene system so things like input plumbing / scene
    // start / stop calls from elsewhere still work — the scene just has
    // an empty visual layer.
    let useNewHud = true
    try { useNewHud = localStorage.getItem('newhud') !== '0' } catch {}
    if (useNewHud) {
      import('../hud/MainMenuOverlay.js').then(({ MainMenuOverlay }) => {
        if (!this.scene.isActive()) return
        // Singleton on window.__game so re-entering MainMenu (e.g. from
        // a returned-to-menu after a game-over) doesn't double-mount.
        const game = window.__game
        if (game._mainMenuOverlay) game._mainMenuOverlay.close()
        game._mainMenuOverlay = new MainMenuOverlay()
        game._mainMenuOverlay.open()
      })
      // Set up camera so right-click suppression etc still works.
      this._setupCamera()
      this.events.once('shutdown', () => {
        const game = window.__game
        game?._mainMenuOverlay?.close()
        game._mainMenuOverlay = null
      })
      return
    }

    this._setupCamera()
    this.time.delayedCall(0, () => this._setupCamera())
    this.scale.on('resize', this._setupCamera, this)
    this.events.once('shutdown', () => this.scale.off('resize', this._setupCamera, this))

    this._save = SaveSystem.hasSave() ? SaveSystem.load() : null

    this._drawBackground()
    this._drawDungeonArt()
    this._drawScanlines()
    this._drawTitleStack()
    this._drawRightPanel()
    this._drawJamPortal()

    // Background-load adventurer attack sheets while the player is on
    // the title screen. These are the heaviest single chunk of cold-
    // start load (~650 file requests at 192×192) and aren't needed
    // until combat actually starts. Idempotent — re-entering MainMenu
    // (e.g. from Options) won't double-queue.
    //
    // Delayed 3s + throttled to 4 parallel downloads (default 32) so
    // the load doesn't compete with title-screen video decoding —
    // running the full unthrottled batch immediately on title-screen
    // entry caused visible stutter on first-time startups.
    this.time.delayedCall(3000, () => {
      if (!this.scene.isActive()) return  // user navigated away
      this.load.maxParallelDownloads = 4
      kickOffAdventurerAtkLoad(this)
    })
    if (this._save) {
      this._zKey = this.input.keyboard.addKey('Z')
      this._zKey.on('down', () => this._actContinue())
    }
  }

  shutdown() {
    this._tweens.forEach(t => t?.stop?.())
    this._buttons.forEach(b => b.destroy?.())
    this._objects.forEach(o => o.destroy?.())
    this._tweens = []
    this._buttons = []
    this._objects = []
    this._zKey?.removeAllListeners()
    this._zKey = null
  }

  // ─── Camera (letterboxed design rect) ──────────────────────────────────
  _setupCamera() {
    const sw = this.scale.width
    const sh = this.scale.height
    if (sw < 32 || sh < 32) return
    const sf = Math.min(sw / W, sh / H)
    const cam = this.cameras.main
    cam.setZoom(sf)
    const vw = W * sf
    const vh = H * sf
    cam.setViewport(Math.round((sw - vw) / 2), Math.round((sh - vh) / 2), vw, vh)
    cam.setScroll(0, 0)
    cam.setOrigin(0, 0)
    this.uiW = sw / sf
    this.uiH = sh / sf
  }

  // ─── Background ────────────────────────────────────────────────────────
  _drawBackground() {
    // Solid void fill across whole design rect (and overscan for letterbox)
    const overscan = 2000
    const g = this.add.graphics().setDepth(0)
    g.fillStyle(CRYPT.bgDeep, 1)
    g.fillRect(-overscan, -overscan, W + overscan * 2, H + overscan * 2)
    this._objects.push(g)
  }

  // ─── Left side: animated video backdrop with chrome overlays ──────────
  // Picks one of the title-screen MP4s at random and fills the LEFT_W × H
  // region behind the QUEST/FAILED title stack. Shared chrome (gradient
  // backdrop, right-edge fade, darken wash) is always drawn so the title
  // stays legible and the seam into the right panel stays clean. If no
  // videos loaded (e.g. file missing), falls back to the procedural tile
  // grid + sigils.
  _drawDungeonArt() {
    // Stone-gradient backdrop (drawn first so it underlies the video; if
    // the video texture has any transparency or scaling gap, this fills it).
    const grad = this.add.graphics().setDepth(1)
    for (let i = 0; i < 8; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(CRYPT.bgStone1),
        Phaser.Display.Color.IntegerToColor(CRYPT.bgDeep),
        7, i,
      )
      grad.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      grad.fillRect(0, Math.round((H * i) / 8), LEFT_W, Math.ceil(H / 8) + 1)
    }
    this._objects.push(grad)

    // Spawn a randomly-picked video, then chain to a different one each
    // time it ends — gives the title screen a varied loop instead of the
    // same clip on repeat. The chain is cancelled on scene shutdown so a
    // late callback never tries to use a destroyed scene.
    //
    // Phaser reuses the same scene INSTANCE across scene.start('MainMenu')
    // calls, so the previous run's `_titleVidShutdown = true` flag would
    // survive into the new create() and silently disable video spawning
    // (this happened any time the player went MainMenu → Options →
    // MainMenu, leaving the title screen video-less). Reset it here so
    // every fresh create() starts the video chain cleanly.
    this._titleVidShutdown = false
    const allKeys  = this.registry.get('titleVideoKeys') ?? []
    const liveKeys = allKeys.filter(k => this.cache.video.exists(k))
    if (liveKeys.length > 0) {
      this._titleVidLast = null
      this._titleVidQueue = null
      this._spawnNextTitleVideo(liveKeys)
      this.events.once('shutdown', () => {
        this._titleVidShutdown = true
        this._titleVid?.destroy?.()
        this._titleVid = null
      })
    } else {
      this._drawDungeonArtFallback()
    }

    // Right-edge fade into the menu panel (transparent → bgDeep)
    const fade = this.add.graphics().setDepth(8)
    const fadeW = 90
    for (let i = 0; i < fadeW; i++) {
      const a = i / fadeW
      fade.fillStyle(CRYPT.bgDeep, a)
      fade.fillRect(LEFT_W - fadeW + i, 0, 1, H)
    }
    this._objects.push(fade)

    // Darken overlay — improves legibility of the title stack over any video.
    const dark = this.add.rectangle(0, 0, LEFT_W, H, CRYPT.bgDeep, 0.42).setOrigin(0).setDepth(7)
    this._objects.push(dark)
  }

  // Fisher-Yates shuffle of every loaded clip key. If the previous clip
  // would land at index 0, swap it deeper into the queue so we don't get
  // the same clip back-to-back across the queue boundary.
  _refillTitleVidQueue(liveKeys) {
    const q = liveKeys.slice()
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[q[i], q[j]] = [q[j], q[i]]
    }
    if (q.length > 1 && q[0] === this._titleVidLast) {
      const swapIdx = 1 + Math.floor(Math.random() * (q.length - 1))
      ;[q[0], q[swapIdx]] = [q[swapIdx], q[0]]
    }
    this._titleVidQueue = q
  }

  // Spawn the next clip from a shuffled queue: every video plays once
  // before any video repeats. When the queue empties, reshuffle — and
  // bias the new shuffle so the first pick isn't the clip that just
  // finished (avoids a same-clip seam at the boundary).
  _spawnNextTitleVideo(liveKeys) {
    if (this._titleVidShutdown) return

    if (!this._titleVidQueue?.length) this._refillTitleVidQueue(liveKeys)
    const key = this._titleVidQueue.shift()
    this._titleVidLast = key

    // Tear down any previous video before adding a new one.
    if (this._titleVid) {
      const old = this._titleVid
      this._titleVid = null
      // Drop from _objects so shutdown() doesn't double-destroy.
      const i = this._objects.indexOf(old)
      if (i >= 0) this._objects.splice(i, 1)
      old.destroy()
    }

    const vid = this.add.video(0, 0, key).setOrigin(0, 0).setDepth(2)
    vid.setMute(true)
    vid.setLoop(false)            // play through once, then chain
    vid.play(false)
    if (TITLE_VIDEO_FLIP_X.has(key)) vid.setFlipX(true)

    const fit = () => {
      const vw = vid.video?.videoWidth  || 1
      const vh = vid.video?.videoHeight || 1
      const scale = Math.max(LEFT_W / vw, H / vh)
      vid.setDisplaySize(Math.ceil(vw * scale), Math.ceil(vh * scale))
      vid.setPosition(Math.round((LEFT_W - vw * scale) / 2), 0)
    }
    if (vid.video?.videoWidth) fit()
    else vid.video?.addEventListener('loadedmetadata', fit, { once: true })

    // Hand off to the next clip when this one finishes. Phaser emits
    // 'complete' on the Video object when playback ends.
    vid.once('complete', () => this._spawnNextTitleVideo(liveKeys))

    this._titleVid = vid
    this._objects.push(vid)
  }

  // Procedural tile grid + sigils — used only if no video assets loaded.
  _drawDungeonArtFallback() {
    const cols = 32, rows = 22
    const cellW = LEFT_W / cols
    const cellH = H / rows

    const tiles = this.add.graphics().setDepth(2).setAlpha(0.85)
    tiles.fillStyle(CRYPT.bgStone2, 1)
    tiles.fillRect(0, 0, LEFT_W, H)
    tiles.lineStyle(1, 0x000000, 0.45)
    for (let i = 0; i <= cols; i++) tiles.lineBetween(Math.round(i * cellW), 0, Math.round(i * cellW), H)
    for (let j = 0; j <= rows; j++) tiles.lineBetween(0, Math.round(j * cellH), LEFT_W, Math.round(j * cellH))

    const rooms = [
      { x:  1, y:  1, w: 7, h: 5, c: CRYPT.bgFloor },
      { x: 11, y:  1, w: 6, h: 4, c: CRYPT.bgFloor2 },
      { x:  1, y:  8, w: 5, h: 6, c: CRYPT.bgFloor },
      { x: 11, y:  8, w: 7, h: 6, c: CRYPT.bgFloor2 },
      { x: 22, y: 11, w: 8, h: 6, c: CRYPT.bgFloor },
      { x:  7, y: 16, w: 7, h: 4, c: CRYPT.bgFloor2 },
    ]
    for (const r of rooms) {
      const px = Math.round(r.x * cellW)
      const py = Math.round(r.y * cellH)
      const pw = Math.round(r.w * cellW)
      const ph = Math.round(r.h * cellH)
      tiles.fillStyle(r.c, 1)
      tiles.fillRect(px, py, pw, ph)
      tiles.lineStyle(2, CRYPT.wallEdge, 1)
      tiles.strokeRect(px + 1, py + 1, pw - 2, ph - 2)
    }
    this._objects.push(tiles)

    const entities = [
      { tx:  3, ty:  3, glyph: '@', col: CRYPT.soulCss,  size: 26 },
      { tx:  4, ty:  3, glyph: '@', col: CRYPT.soulCss,  size: 26 },
      { tx:  6, ty:  6, glyph: '☠', col: '#ffffff',      size: 28 },
      { tx:  7, ty:  6, glyph: '☠', col: '#ffffff',      size: 28 },
      { tx: 13, ty: 10, glyph: 'O', col: CRYPT.warnCss,  size: 36 },
      { tx: 16, ty: 10, glyph: 'i', col: CRYPT.accent2Css, size: 24 },
      { tx:  9, ty: 18, glyph: 'G', col: '#a08068',      size: 24 },
      { tx: 25, ty: 13, glyph: '♛', col: CRYPT.accentCss, size: 38 },
    ]
    for (const e of entities) {
      const t = this.add.text(
        Math.round(e.tx * cellW + cellW / 2),
        Math.round(e.ty * cellH + cellH / 2),
        e.glyph, {
          fontFamily: FONT_HEAD,
          fontSize:   `${e.size}px`,
          color:      e.col,
        }
      ).setOrigin(0.5).setDepth(3)
      this._objects.push(t)
    }
  }

  _drawScanlines() {
    // Subtle horizontal scanlines for retro-CRT vibe over left side
    const lines = this.add.graphics().setDepth(9).setAlpha(0.32)
    for (let y = 0; y < H; y += 4) {
      lines.fillStyle(0x000000, 1)
      lines.fillRect(0, y + 3, LEFT_W, 1)
    }
    this._objects.push(lines)
  }

  // ─── Title stack (bottom-left of the left panel) ───────────────────────
  _drawTitleStack() {
    const baseX = 48
    const tagY  = 460

    const tag = this.add.text(baseX, tagY, '◇ A DUNGEON-BUILDER ROGUELIKE ◇', {
      fontFamily: FONT_HEAD,
      fontSize:   '11px',
      color:      CRYPT.accent2Css,
      letterSpacing: 4,
    }).setDepth(15)
    this._objects.push(tag)

    const titleQ = this.add.text(baseX, tagY + 28, 'QUEST', {
      fontFamily: FONT_HEAD,
      fontSize:   '78px',
      color:      CRYPT.ink,
    }).setDepth(15)
    titleQ.setShadow(5, 5, '#000000', 0, false, true)
    this._objects.push(titleQ)

    const titleF = this.add.text(baseX, tagY + 116, 'FAILED', {
      fontFamily: FONT_HEAD,
      fontSize:   '78px',
      color:      CRYPT.accentCss,
    }).setDepth(15)
    titleF.setShadow(5, 5, '#000000', 0, false, true)
    this._objects.push(titleF)
  }

  _drawCornerStamp() {
    // EARLY BUILD · vX.Y.Z — bordered stamp top-left of the dungeon art
    const stampG = this.add.graphics().setDepth(15)
    pixelPanel(stampG, 28, 28, 220, 32, {
      fill: 0x000000, edgeH: CRYPT.accent2, edgeS: CRYPT.accent,
    })
    this._objects.push(stampG)
    const stampT = this.add.text(28 + 110, 28 + 16, `EARLY BUILD · ${VERSION}`, {
      fontFamily: FONT_HEAD,
      fontSize:   '8px',
      color:      CRYPT.accent2Css,
      letterSpacing: 2,
    }).setOrigin(0.5).setDepth(16)
    this._objects.push(stampT)
  }

  // ─── Right panel: menu, run readout, quote, footer ─────────────────────
  _drawRightPanel() {
    // Solid panel fill
    const bgR = this.add.rectangle(RIGHT_X, 0, RIGHT_W, H, CRYPT.panel)
      .setOrigin(0).setDepth(20)
    this._objects.push(bgR)

    // Left-edge inset shadow + highlight (like inset:8 + 10 box-shadow in design)
    const edge = this.add.graphics().setDepth(21)
    edge.fillStyle(0x000000, 1)
    edge.fillRect(RIGHT_X, 0, 8, H)
    edge.fillStyle(CRYPT.panelEdgeH, 1)
    edge.fillRect(RIGHT_X + 8, 0, 2, H)
    this._objects.push(edge)

    const PAD = 38
    const innerX = RIGHT_X + PAD
    const innerW = RIGHT_W - PAD * 2

    // Caption + boss readout
    let y = 56
    this._objects.push(this.add.text(innerX, y, 'YOUR REIGN, MY LORD', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setDepth(22))
    y += 24

    const className = this._resolveBossDisplay()
    this._objects.push(this.add.text(innerX, y, className.toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '16px',
      color: this._save ? CRYPT.accent2Css : CRYPT.inkMute,
    }).setDepth(22))
    y += 28

    const subline = this._save
      ? `Day ${this._save.meta?.dayNumber ?? 1} - ${this._save.player?.totalKills ?? 0} kills`
      : 'No save data - begin a new run.'
    this._objects.push(this.add.text(innerX, y, subline, {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setDepth(22))
    y += 40

    // Menu buttons
    const btnDefs = [
      {
        label: 'CONTINUE',
        sub:   this._save ? `Resume Day ${this._save.meta?.dayNumber ?? 1}` : 'No save available',
        glyph: '▶',
        primary: true,
        enabled: !!this._save,
        action:  () => this._actContinue(),
      },
      {
        label: 'NEW EVIL',
        sub:   'Begin a new run',
        glyph: '✚',
        // Promote to the red primary style when there's no save to
        // continue, so the menu has a single obvious entry point.
        primary: !this._save,
        action: () => this._actNewEvil(),
      },
      {
        label: 'LEADERBOARD',
        sub:   'Global hall of evil',
        glyph: '❖',
        action: () => this.scene.start('Leaderboard'),
      },
      // Dev-only entries — visible only when the player has set their
      // name to "Mango" via the NameEntryPanel (case-insensitive).
      ...(PlayerProfile.getName().trim().toUpperCase() === 'MANGO' ? [
        {
          label: 'ROOM EDITOR',
          sub:   'Edit room layouts',
          glyph: '▤',
          action: () => { TitleMusic.stop(); this.scene.start('RoomTileEditor') },
        },
        {
          label: 'TILESET EDITOR',
          sub:   'Author tile themes',
          glyph: '▦',
          action: () => { TitleMusic.stop(); this.scene.start('TilesetEditor') },
        },
      ] : []),
      {
        label: 'OPTIONS',
        sub:   'Audio - controls',
        glyph: '⚙',
        action: () => this._actOptions(),
      },
      {
        label: 'QUIT',
        sub:   'Return to the mortal realm',
        glyph: '✕',
        action: () => this._actQuit(),
      },
    ]
    const BTN_H = 46
    const BTN_GAP = 8
    for (const b of btnDefs) {
      const btn = this._wideMenuButton(innerX, y, innerW, BTN_H, b)
      this._buttons.push(btn)
      y += BTN_H + BTN_GAP
    }

    // Press-Z blinker (only when CONTINUE is available)
    if (this._save) {
      const blinkY = H - 130
      const blink = this.add.text(innerX, blinkY, '▸ PRESS Z TO CONTINUE', {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.accent2Css, letterSpacing: 3,
      }).setDepth(22)
      this._objects.push(blink)
      this._tweens.push(this.tweens.add({
        targets: blink, alpha: { from: 1, to: 0.35 },
        duration: 480, yoyo: true, repeat: -1,
      }))
    }

    // Flavor quote
    const quote = this.add.text(innerX, H - 100,
      '"The fools come bearing torches and prayers.\nThey will leave bearing nothing."', {
      fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.inkMute,
      lineSpacing: 6,
    }).setDepth(22)
    this._objects.push(quote)

    // Footer rule + tags
    const footG = this.add.graphics().setDepth(22)
    footG.fillStyle(CRYPT.panelEdgeS, 1)
    footG.fillRect(innerX, H - 50, innerW, 2)
    footG.fillStyle(CRYPT.panelEdgeH, 1)
    footG.fillRect(innerX, H - 48, innerW, 1)
    this._objects.push(footG)

    this._objects.push(
      this.add.text(innerX, H - 36, VERSION, {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute,
      }).setDepth(22))
    this._objects.push(
      this.add.text(RIGHT_X + RIGHT_W / 2, H - 36, this._save ? 'SAVE OK' : 'NO SAVE', {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute,
      }).setOrigin(0.5, 0).setDepth(22))
    this._objects.push(
      this.add.text(innerX + innerW, H - 36, '© MANGO-VIRUS', {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute,
      }).setOrigin(1, 0).setDepth(22))
  }

  // Wide button with glyph + label + subtitle (left-aligned, justified content).
  _wideMenuButton(x, y, w, h, def) {
    const enabled = def.enabled !== false
    const btn = pixelButton(this, x, y, w, h, '', {
      primary: !!def.primary,
      depth:   22,
      onClick: enabled ? def.action : null,
    })
    btn.label.setText('')   // we draw our own custom label content

    const labelColor = def.primary ? '#ffffff' : CRYPT.ink
    const subColor   = def.primary ? '#e8c8cf' : CRYPT.inkMute
    const glyphColor = def.primary ? '#ffffff' : CRYPT.accent2Css

    const glyphT = this.add.text(x + 16, y + h / 2, def.glyph, {
      fontFamily: FONT_HEAD, fontSize: '13px', color: glyphColor,
    }).setOrigin(0, 0.5).setDepth(23)
    const labelT = this.add.text(x + 44, y + h / 2 - 4, def.label, {
      fontFamily: FONT_HEAD, fontSize: '10px', color: labelColor, letterSpacing: 1,
    }).setOrigin(0, 1).setDepth(23)
    const subT = this.add.text(x + 44, y + h / 2 + 4, def.sub, {
      fontFamily: FONT_BODY, fontSize: '8px', color: subColor, letterSpacing: 1,
    }).setOrigin(0, 0).setDepth(23)

    if (!enabled) {
      btn.setEnabled(false)
      glyphT.setAlpha(0.45); labelT.setAlpha(0.45); subT.setAlpha(0.45)
    }

    btn._customLabels = [glyphT, labelT, subT]
    const baseDestroy = btn.destroy.bind(btn)
    btn.destroy = () => {
      glyphT.destroy(); labelT.destroy(); subT.destroy()
      baseDestroy()
    }
    return btn
  }

  // ─── Game-jam portal (upper-right of the menu panel) ───────────────────
  // Click sends the player to the jam-1 lobby via Portal.sendPlayerThroughPortal,
  // forwarding their current ref so the lobby can show the back-link.
  _drawJamPortal() {
    const cx = RIGHT_X + RIGHT_W / 2
    const cy = 500
    const JAM_LOBBY_URL = 'https://callumhyoung.github.io/gamejam1-lobby/'

    const sprite = this.add.sprite(cx, cy, 'jam-portal', 0)
      .setScale(4)
      .setDepth(25)
      .setInteractive({ useHandCursor: true })
    if (this.anims.exists('jam-portal-spin')) sprite.play('jam-portal-spin')
    this._objects.push(sprite)

    const label = this.add.text(cx, cy + 76, 'JAM PORTAL', {
      fontFamily: FONT_HEAD, fontSize: '8px',
      color: CRYPT.accent2Css, letterSpacing: 2,
    }).setOrigin(0.5, 0).setDepth(25)
    this._objects.push(label)

    sprite.on('pointerover', () => { sprite.setScale(4.3); label.setColor('#ffffff') })
    sprite.on('pointerout',  () => { sprite.setScale(4);   label.setColor(CRYPT.accent2Css) })
    sprite.on('pointerdown', () => {
      try {
        if (window.Portal?.sendPlayerThroughPortal) {
          window.Portal.sendPlayerThroughPortal(JAM_LOBBY_URL)
        } else {
          window.location.href = JAM_LOBBY_URL
        }
      } catch {
        window.location.href = JAM_LOBBY_URL
      }
    })
  }

  // ─── Helpers ───────────────────────────────────────────────────────────
  _resolveBossDisplay() {
    if (!this._save) return 'No active reign'
    const id = this._save.player?.bossArchetypeId
    if (!id) return 'Unnamed reign'
    const archs = this.cache.json.get('bossArchetypes') ?? []
    const arch  = archs.find(a => a.id === id)
    return arch?.name ?? id
  }

  // ─── Menu actions ──────────────────────────────────────────────────────
  _actContinue() {
    if (!this._save) return
    this.scene.start('Game', { gameState: this._save })
  }

  _actNewEvil() {
    if (this._save) this._confirmOverwrite()
    else            this._startNewRun()
  }

  _startNewRun() {
    if (!PlayerProfile.hasName()) {
      new NameEntryPanel(this, {
        onConfirm: (name) => {
          PlayerProfile.setName(name)
          this.scene.start('CompanionSelect')
        },
      })
    } else {
      this.scene.start('ArchetypeSelect')
    }
  }

  _actOptions() {
    this.scene.start('Options')
  }

  _actQuit() {
    // Browser context: window.close only succeeds when the window was opened
    // by script. Best-effort close, then fall back to a hint.
    if (typeof window === 'undefined') return
    try { window.close() } catch {}
    this.time.delayedCall(80, () => {
      if (!window.closed) this._toast('Use the OS close button to exit')
    })
  }

  _toast(msg) {
    const t = this.add.text(W / 2, H - 30, msg, {
      fontFamily:      FONT_HEAD,
      fontSize:        '10px',
      color:           CRYPT.accent2Css,
      backgroundColor: '#000000',
      padding:         { x: 12, y: 8 },
    }).setOrigin(0.5, 1).setDepth(80)
    this._tweens.push(this.tweens.add({
      targets: t, alpha: 0, duration: 1200, delay: 1200,
      onComplete: () => t.destroy(),
    }))
  }

  _confirmOverwrite() {
    const PW = 480, PH = 220
    const px = (W - PW) / 2
    const py = (H - PH) / 2

    const wash = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.78)
      .setOrigin(0.5).setDepth(70).setInteractive()
    const panelG = this.add.graphics().setDepth(71)
    pixelPanel(panelG, px, py, PW, PH)

    const t1 = this.add.text(W / 2, py + 50, 'ABANDON CURRENT RUN?', {
      fontFamily: FONT_HEAD, fontSize: '12px', color: CRYPT.accentCss, letterSpacing: 2,
    }).setOrigin(0.5).setDepth(72)
    const t2 = this.add.text(W / 2, py + 86, 'YOUR DUNGEON WILL BE LOST FOREVER.', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(72)

    let btnAbandon, btnCancel
    const teardown = () => {
      wash.destroy(); panelG.destroy(); t1.destroy(); t2.destroy()
      btnAbandon.destroy(); btnCancel.destroy()
    }

    btnAbandon = pixelButton(this, W / 2 - 130, py + PH - 70, 120, 38, 'ABANDON', {
      danger: true, depth: 72, fontSize: 10,
      onClick: () => {
        SaveSystem.deleteSave()
        teardown()
        this._startNewRun()
      },
    })
    btnCancel = pixelButton(this, W / 2 + 10, py + PH - 70, 120, 38, 'CANCEL', {
      depth: 72, fontSize: 10,
      onClick: teardown,
    })
  }
}
