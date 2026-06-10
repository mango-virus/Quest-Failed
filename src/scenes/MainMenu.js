// MainMenu — DOM-hosted title screen + Phaser throne-room backdrop.
//
// The title-screen UI is the DOM `MainMenuOverlay` (src/hud/MainMenuOverlay.js).
// This Phaser scene now owns the in-engine THRONE-ROOM BACKDROP that sits
// behind the DOM overlay (2026-06-09 menu rebuild — replaces the prior boss-
// video shuffle pool with a live render of the player's last-played archetype):
//   - dark stone gradient backdrop (ambient mood)
//   - 2 torch sprites flanking the QUEST / FAILED logo at the top
//   - the player's last-played boss archetype idle sprite, centered, breathing
//   - a slow horizontal camera pan (cinematic drift)
//
// Plus the cross-cutting concerns this scene already owned:
//   - title-screen music (TitleMusic loop; stop GameplayMusic)
//   - background-streaming the oversize adventurer attack spritesheets
//     (kickOffAdventurerAtkLoad) + run audio (kickOffDeferredAudioLoad)
//   - a letterboxed camera so canvas-level right-click suppression etc. work
//
// The legacy `?newhud=0` Phaser menu path was removed 2026-05-31.

import { TitleMusic }    from '../systems/TitleMusic.js'
import { GameplayMusic } from '../systems/GameplayMusic.js'
import { kickOffAdventurerAtkLoad } from './AdventurerAtkLoader.js'
import { kickOffDeferredAudioLoad } from './DeferredAudioLoader.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { SaveSystem }    from '../systems/SaveSystem.js'

// Logical design size — letterboxed inside the actual canvas. Matches the
// 16:9 aspect of the DOM stage (1920×1080), so DOM and canvas line up.
const W = 1280
const H = 720

// Boss-render display config. The native sprites are 64×64 (some 128×128 —
// demon/golem/slime); scale lifts them to a presence-size that reads from
// across the title screen without overwhelming the bottom-center menu slab.
const BOSS_DISPLAY_SCALE = 5.0
const BOSS_DISPLAY_Y     = 430   // centered horizontally, lower-middle vertically

// Logo header zone (matches the DOM logo position so the torches flank it).
// DOM logo sits centered at ~y=120 in 1920×1080 → ~y=80 in 1280×720.
const LOGO_CENTER_X = W / 2
const LOGO_CENTER_Y = 90
const TORCH_OFFSET_X = 320   // distance from logo centre to each torch
const TORCH_SCALE    = 2.6

// Slow horizontal camera pan ("ambient drift"). Tweens cam.scrollX between
// these bounds, easing in/out. Camera is sit-still by default; this just
// adds a faint living-room feel.
const PAN_AMPLITUDE_PX = 22
const PAN_DURATION_MS  = 13000

const FALLBACK_ARCHETYPE = 'orc'

export class MainMenu extends Phaser.Scene {
  constructor() {
    super('MainMenu')
  }

  create() {
    // Title-screen music — keep the loop running continuously across
    // MainMenu / ArchetypeSelect transitions.
    GameplayMusic.stop()
    TitleMusic.ensurePlaying(this)

    // Mount the DOM title screen. Singleton on window.__game so re-entering
    // MainMenu (e.g. after a game-over) doesn't double-mount.
    import('../hud/MainMenuOverlay.js').then(({ MainMenuOverlay }) => {
      if (!this.scene.isActive()) return
      const game = window.__game
      if (game._mainMenuOverlay) game._mainMenuOverlay.close()
      game._mainMenuOverlay = new MainMenuOverlay()
      game._mainMenuOverlay.open()
    })

    // Camera so canvas-level right-click suppression etc. still work, and so
    // the throne-room backdrop draws inside the 1280×720 logical letterbox.
    this._setupCamera()

    // Throne-room backdrop (replaces the deleted video pool).
    this._buildThroneScene()

    this.events.once('shutdown', () => {
      const game = window.__game
      game?._mainMenuOverlay?.close()
      if (game) game._mainMenuOverlay = null
      // Stop tweens that target this scene's sprites — defensive, but
      // scene.stop already kills tweens. Cleared explicitly so re-entering
      // MainMenu after a run starts from a clean slate.
      this._panTween?.stop()
      this._breatheTween?.stop()
      this._panTween = null
      this._breatheTween = null
      this._boss = null
      this._torches = null
    })

    // Background-load the oversize attack sheets here. THIS Phaser scene still
    // owns the loader even though the visible title screen is the DOM overlay —
    // without it the `_atk` sheets never stream in and every adventurer's
    // slash/thrust silently falls back to the shrunk 64px row (most glaring on
    // Jinwoo, whose Scimitar swing is oversize-only). 3s delay + 4-parallel
    // throttle so the load doesn't compete with title-screen audio decoding.
    this.time.delayedCall(3000, () => {
      if (!this.scene.isActive()) return
      this.load.maxParallelDownloads = 4
      // Stream the run audio (boss/stage music + gameplay SFX, ~38MB) and the
      // adventurer attack sheets while the player sits on the title screen, so
      // the cold boot didn't have to block on them. Game.create() re-kicks the
      // audio in case the player dove into a run before this pass finished.
      kickOffDeferredAudioLoad(this)
      kickOffAdventurerAtkLoad(this)
    })
  }

  // ─── Throne-room backdrop ──────────────────────────────────────────────
  // Layered draw (back → front):
  //   1. Dark stone gradient (Graphics rect — far back depth)
  //   2. Subtle floor wash (lighter band at boss-feet altitude)
  //   3. Boss sprite (idle anim, breathing tween)
  //   4. Two torches flanking the logo at top (idle flicker loop)
  // No throne object yet — kept minimal to ship; an actual throne sprite
  // can land later once art exists. The two torches + breathing boss is
  // enough to read as "throne room" against the dim backdrop.
  _buildThroneScene() {
    this._drawBackdrop()
    this._drawBoss()
    this._drawTorches()
    this._startCameraPan()
  }

  _drawBackdrop() {
    // Vertical gradient: near-black at top → warmer dark at bottom (suggests
    // floor lit from the torches). Drawn once on a Graphics — Phaser has no
    // built-in gradient rect, so we stripe it.
    const g = this.add.graphics().setDepth(-100)
    const top    = 0x06030a   // near-black with a violet bias
    const bottom = 0x1a0e08   // warm dark (torchlight floor)
    const STRIPES = 32
    for (let i = 0; i < STRIPES; i++) {
      const t = i / (STRIPES - 1)
      const r = Math.round(((top >> 16) & 0xff) + (((bottom >> 16) & 0xff) - ((top >> 16) & 0xff)) * t)
      const gC = Math.round(((top >>  8) & 0xff) + (((bottom >>  8) & 0xff) - ((top >>  8) & 0xff)) * t)
      const b = Math.round(((top      ) & 0xff) + (((bottom      ) & 0xff) - ((top      ) & 0xff)) * t)
      g.fillStyle((r << 16) | (gC << 8) | b, 1)
      g.fillRect(0, Math.floor(H * t), W, Math.ceil(H / STRIPES) + 1)
    }
    // Floor wash — a soft warm ellipse under the boss to ground them.
    const wash = this.add.graphics().setDepth(-90)
    wash.fillStyle(0x4a2a18, 0.35)
    wash.fillEllipse(W / 2, BOSS_DISPLAY_Y + 90, 520, 90)
    wash.fillStyle(0x6b3a22, 0.18)
    wash.fillEllipse(W / 2, BOSS_DISPLAY_Y + 90, 360, 60)
  }

  // The currently-equipped boss archetype, centered, idle anim looping with a
  // gentle breathing-scale tween. Resolves the archetype from the live save
  // first (mid-run player returning to menu sees their actual boss), then
  // PlayerProfile's last-archetype stamp (a post-game-over player still sees
  // the boss they were playing), then a fresh-profile fallback.
  _drawBoss() {
    const id = this._resolveArchetypeId()
    const idleKey  = `${id}-idle`
    const animKey  = `${idleKey}-down`
    if (!this.textures.exists(idleKey)) return
    const sprite = this.add.sprite(W / 2, BOSS_DISPLAY_Y, idleKey, 0).setDepth(-50)
    sprite.setScale(BOSS_DISPLAY_SCALE)
    if (this.anims.exists(animKey)) sprite.play(animKey)
    this._boss = sprite
    // Subtle breathing — ±2% scaleY at the natural breath rhythm (~2.4s up,
    // 2.4s down). Anchors at sprite origin (centered by default), so the
    // boss swells from the centre rather than bouncing on the floor.
    this._breatheTween = this.tweens.add({
      targets: sprite,
      scaleY: BOSS_DISPLAY_SCALE * 1.02,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  _resolveArchetypeId() {
    // 1. Live save (player has an active run) — render the boss they actually
    //    have right now.
    try {
      const save = SaveSystem.hasSave?.() ? SaveSystem.load?.() : null
      const id = save?.player?.bossArchetypeId
      if (id && this.textures.exists(`${id}-idle`)) return id
    } catch {}
    // 2. Profile's last-played archetype (survives game-over save-wipe).
    try {
      const id = PlayerProfile.getLastArchetypeId?.()
      if (id && this.textures.exists(`${id}-idle`)) return id
    } catch {}
    // 3. Fresh profile fallback — first unlock for every player.
    return this.textures.exists(`${FALLBACK_ARCHETYPE}-idle`) ? FALLBACK_ARCHETYPE : null
  }

  // Two torch sprites flanking the logo at top. Idle 6-frame flicker loop
  // (register the anim on demand — TorchRenderer also registers it, but only
  // when a run starts, so re-doing it here keeps the title screen self-
  // sufficient on a cold boot). Each torch gets a random frame offset so
  // they don't burn in lockstep.
  _drawTorches() {
    if (!this.textures.exists('torch')) return
    if (!this.anims.exists('torch-burn')) {
      this.anims.create({
        key: 'torch-burn',
        frames: this.anims.generateFrameNumbers('torch', { start: 0, end: 5 }),
        frameRate: 8,
        repeat: -1,
      })
    }
    const left  = this.add.sprite(LOGO_CENTER_X - TORCH_OFFSET_X, LOGO_CENTER_Y, 'torch', 0)
    const right = this.add.sprite(LOGO_CENTER_X + TORCH_OFFSET_X, LOGO_CENTER_Y, 'torch', 0)
    for (const t of [left, right]) {
      t.setDepth(-40)
      t.setScale(TORCH_SCALE)
      t.play('torch-burn')
      t.anims.setProgress(Math.random())   // desync the flicker
    }
    this._torches = [left, right]
  }

  // Slow horizontal camera drift — ±PAN_AMPLITUDE_PX over PAN_DURATION_MS,
  // ease in/out, yoyo forever. Reads as a living-room ambient drift; subtle
  // enough not to compete with the breathing boss.
  _startCameraPan() {
    const cam = this.cameras.main
    cam.setScroll(-PAN_AMPLITUDE_PX, 0)
    this._panTween = this.tweens.add({
      targets: cam,
      scrollX: PAN_AMPLITUDE_PX,
      duration: PAN_DURATION_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
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
}
