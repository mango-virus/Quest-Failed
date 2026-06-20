// Renders all minions as animated sprite stacks. Each minion runs its own
// state machine (death → hurt → attack → run → walk → idle) keyed off
// position deltas, HP changes, and combat timestamps — same priority order
// as BossRenderer so behaviour reads consistently across boss and minions.
//
// Texture / anim keys come from Preload's MINION_IDS table:
//   texture:  `minion-<defId>-<state>`
//   anim:     `minion-<defId>-<state>-<dir>`
//
// Display size scales sprites down to ~32 px (64-frame sheets) or ~64 px
// (128-frame sheets like demons/golems/ents/elder slimes/rats) so minions
// sit between the 18-px adventurers and the 96–192-px boss visually.
//
// Falls back to a placeholder rect + sigil when a minion definition has no
// loaded sprite (covers any minion id added by data without an asset yet).

import { EventBus }         from '../systems/EventBus.js'
import { AbilityVfx }       from './AbilityVfx.js'
import { PathfinderSystem } from '../systems/PathfinderSystem.js'
import { Balance }          from '../config/balance.js'
import { upgradeCost }      from '../util/minionRevive.js'
import { ensureAdventurerBaseSheet } from '../scenes/AdventurerBaseLoader.js'

// Lerp between two 0xRRGGBB colors (k in 0..1) → packed 0xRRGGBB. Used to
// give the shadow minions the same RGB-style blue↔black flame cycle Jinwoo
// wears (matched to his "previous" palette — his own flame is now bluer).
function _lerpHex(a, b, k) {
  const r  = Math.round((a >> 16 & 255) + ((b >> 16 & 255) - (a >> 16 & 255)) * k)
  const g  = Math.round((a >> 8  & 255) + ((b >> 8  & 255) - (a >> 8  & 255)) * k)
  const bl = Math.round((a       & 255) + ((b       & 255) - (a       & 255)) * k)
  return (r << 16) | (g << 8) | bl
}

const MINION_SCALE     = 1.0    // native — 64 → 64 px, 128 → 128 px (NEAREST keeps it crisp)
// Lich-raised undead are re-skinned to LPC adventurer sheets (frameSize 64),
// which AdventurerRenderer renders at 0.75. Match that here so a raised dead
// reads the same size as the adventurer it used to be — otherwise they
// render at 1.0 and look 33% too big.
const RAISED_DEAD_SCALE = 0.75
// Per-minion display-scale multiplier — set by spawn handlers when a
// minion should render at a non-default footprint. Currently used for
// Throne Room mini-bosses (2.0× via _mbDisplayScale) so they read as
// "almost as big as the boss" without needing a separate sprite sheet.
// Reads from `m._mbDisplayScale` (number) → defaults to 1.0 when unset.
function _displayScaleFor(m, def) {
  if (typeof m?._mbDisplayScale === 'number') return m._mbDisplayScale
  // Split slimelings render SMALLER than their parent — and smaller still when
  // they're a deeper cascade generation — so the swarm reads as little slimes.
  if (m?._isMiniSlime) return (m._splitDepth >= 2) ? 0.45 : 0.62
  // Per-minion size knob (minionTypes.json `displayScale`) — bumps the LPC
  // humanoids that under-fill their frame up to a proper creature size. Set on
  // the T1 + inherited by the chain; the evolution tier-scale stacks on top.
  return def?.displayScale ?? 1.0
}
const PLACEHOLDER_SIZE = 18
const HURT_FLASH_MS    = 300
const ATTACK_FLASH_MS  = 400
const WALK_MIN_DELTA   = 0.15
const WALK_SAMPLE_MS   = 120
const TS               = 32     // tile size — minion sprites are world-space, this matches Balance.TILE_SIZE
// Ambush/hidden minions (Vampire Sleep on Ceiling, generic ambush) are
// invisible to the adventurer AI, but the PLAYER should still see a faint
// ghost of them so placement reads at a glance. Rendered at this alpha
// instead of 0 — fainter than camouflage (0.5) to keep the "hidden" state
// distinct. NOTE: Golem Camouflaged Pillar is exempt — golems render fully
// opaque to the player even while _hidden (see the per-tick visibility block).
const HIDDEN_ALPHA     = 0.28
// Per-evolution-tier scale multipliers — each tier renders bigger.
// Indexed by chain position (tier 1 → tier 4).
const EVOLUTION_TIER_SCALE = [1.0, 1.3, 1.6, 1.9]

// Duration of the sell animation (ms) — the death anim plays, then the
// minion fades away.
const SELL_FADE_MS = 650

export class MinionRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}   // instanceId → sprite record (see _createSprite)

    const defs = scene.cache.json.get('minionTypes') ?? []
    this._minionDefs = defs                                  // raw array, for upgradeCost
    this._defMap = Object.fromEntries(defs.map(d => [d.id, d]))
    // Evolution chain data — used to scale sprites by tier and to look up
    // animation prefixes when a final form uses a boss texture set.
    this._chains = scene.cache.json.get('minionEvolutions') ?? {}

    // UPGRADE-tool affordance: a single shared graphics layer that draws a
    // colour-coded glow ring under every upgradeable minion while the UPGRADE
    // tool is armed (green = affordable, dim red = can't afford right now).
    // Redrawn each tick; sits below the minion sprites (depth 7) and above the
    // dungeon floor. `_toolMode` mirrors the armed action-bar tool.
    this._toolMode   = null
    this._upgradeGlow = scene.add.graphics().setDepth(2)

    // Reusable hover tooltip — lives on the world camera so it pans/zooms
    // with the dungeon. Shown when the cursor is over a minion sprite.
    this._hoverLabel = scene.add.text(0, 0, '', {
      fontSize: '11px', color: '#ffffff', fontFamily: 'monospace',
      stroke: '#000000', strokeThickness: 3,
      backgroundColor: '#000000bb', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1).setDepth(30).setVisible(false)
    this._hoverMinion = null

    // Pickup-and-move state. While `_heldMinion` is non-null its sprite
    // tracks the cursor; AI is suspended via `minion._heldByPlayer`.
    // `_pickupOrigin` records where the minion was before pickup so we can
    // snap it back if the player exits MOVE mode or day starts mid-carry.
    this._heldMinion = null
    this._pickupOrigin = null
    this._onScenePointerDown = this._onScenePointerDown.bind(this)
    scene.input.on('pointerdown', this._onScenePointerDown)

    EventBus.on('MINION_DIED',         this._onMinionDied,  this)
    EventBus.on('NIGHT_PHASE_STARTED', this._refreshAll,    this)
    EventBus.on('DAY_PHASE_STARTED',   this._returnHeldToOrigin, this)
    EventBus.on('TOOL_MODE_CHANGED',   this._onToolModeChanged,  this)
    EventBus.on('ENTITY_SOLD',         this._onEntitySold,       this)
  }

  update() {
    // While a minion is held, its world position tracks the cursor each
    // frame. Tile coords are kept in sync so the AI/render reads correctly
    // when the player drops them. AI itself is paused via _heldByPlayer.
    //
    // Re-project the pointer through THIS scene's camera every frame instead
    // of reading the cached `ptr.worldX` / `ptr.worldY` — Phaser updates that
    // cache via `pointer.updateWorldPoint(camera)` from whichever active
    // scene's input plugin ran most recently, and with NightPhase launched on
    // top of Game both scenes share the same pointer. On fast cursor moves the
    // cached worldX could momentarily reflect NightPhase's camera state, which
    // placed the held minion well off-camera for a frame and triggered Phaser's
    // per-object culling — the sprite would briefly "disappear" mid-drag. The
    // explicit transform always uses Game's dungeon camera. The Finite check is
    // belt-and-suspenders against any frame where the pointer hasn't initialised.
    if (this._heldMinion) {
      const ptr = this._scene.input.activePointer
      const cam = this._scene.cameras?.main
      const wp  = cam ? cam.getWorldPoint(ptr.x ?? 0, ptr.y ?? 0)
                      : { x: ptr.worldX, y: ptr.worldY }
      if (Number.isFinite(wp.x) && Number.isFinite(wp.y)) {
        this._heldMinion.worldX = wp.x
        this._heldMinion.worldY = wp.y
        this._heldMinion.tileX  = Math.floor(wp.x / TS)
        this._heldMinion.tileY  = Math.floor(wp.y / TS)
      }
    }

    // Keep the hover label glued above the hovered minion.
    if (this._hoverMinion) {
      const def = this._defMap[this._hoverMinion.definitionId]
      const yOffset = ((def?.frameSize ?? PLACEHOLDER_SIZE) * MINION_SCALE * _displayScaleFor(this._hoverMinion, def)) / 2 + 8
      this._hoverLabel.setPosition(this._hoverMinion.worldX, this._hoverMinion.worldY - yOffset)
    }

    const minions = this._gameState.minions ?? []
    const seen    = new Set()

    // Shared per-frame delta (ms), derived from scene.time.now (Phaser's smoothed
    // loop.delta reads 0 from some call paths). Cached once per update so every minion
    // shares one value; clamped vs tab-stalls. Drives frame-rate-independent eases
    // (e.g. the ghost dread-seethe lerp). Mirrors the rat-skitter delta cache.
    const _nowFrame = this._scene.time.now
    this._frameDt = this._frameNow ? Math.min(100, _nowFrame - this._frameNow) : 16.667
    this._frameNow = _nowFrame

    // Camera world-view bounds (with margin) for off-screen culling.
    // Same pattern as AdventurerRenderer (see commit 00b37f3): minions
    // are mostly stationary (locked to assigned rooms), so at high
    // counts in late-game waves 80%+ are usually off-camera at any
    // moment — skipping their per-tick body (animation, HP bar, depth
    // re-sort, mimic chest state, fear/venom badges) eliminates a lot
    // of per-frame work. Held minions bypass the cull (they track the
    // cursor, which is on-screen by definition).
    const cam = this._scene.cameras?.main
    const CULL_MARGIN = 200
    const camLeft   = cam ? (cam.worldView.x - CULL_MARGIN) : -Infinity
    const camRight  = cam ? (cam.worldView.x + cam.worldView.width + CULL_MARGIN) : Infinity
    const camTop    = cam ? (cam.worldView.y - CULL_MARGIN) : -Infinity
    const camBottom = cam ? (cam.worldView.y + cam.worldView.height + CULL_MARGIN) : Infinity

    // LOD — same threshold as AdventurerRenderer. At low zoom HP bars +
    // badges + the lvLabel are sub-pixel; skip the per-tick redraw and
    // hide them. Sprite container stays positioned so the overview view
    // still shows where minions are. State re-renders next non-LOD tick
    // (post-LOD invalidation pass below).
    const camZoom = cam?.zoom ?? 1
    const lod = camZoom < 0.5
    if (this._lastLod && !lod) {
      // Exiting LOD — clear change-detection markers so stable minions
      // (no level change, no HP change since LOD began) re-render their
      // overlays on the next non-LOD tick instead of staying hidden.
      for (const id in this._sprites) {
        const s = this._sprites[id]
        if (!s) continue
        s._lastTier = null
        s._lastBounty = null
        s._lastLootBonus = null
        s.lastHp = null
      }
    }
    this._lastLod = lod

    for (const m of minions) {
      seen.add(m.instanceId)
      let s = this._sprites[m.instanceId]
      // Don't re-spawn corpses on the next day's first tick. If a dead minion
      // survived in gameState past NIGHT_PHASE_STARTED (which destroyed its
      // sprite), skip creating a new one. Live minions still construct here.
      if (!s) {
        const curHp = m.resources?.hp ?? 0
        if (m.aiState === 'dead' || curHp <= 0) continue
        s = this._createSprite(m)
      }
      if (!s) continue

      // Off-screen cull. Held minion always passes (it's glued to the
      // cursor). State recomputes the frame it re-enters view, so one
      // frame of stale rendering is acceptable for entities the player
      // isn't currently looking at.
      const offScreen = !m._heldByPlayer && (
        m.worldX < camLeft || m.worldX > camRight ||
        m.worldY < camTop  || m.worldY > camBottom
      )
      if (offScreen) {
        if (s.container && s.container.visible) s.container.setVisible(false)
        continue
      }
      if (s.container && !s.container.visible) s.container.setVisible(true)

      // Evolution morph: if the minion's def changed since last render
      // (evolved or reset), swap textures + rescale in place. Cheaper than
      // destroying and recreating the sprite record.
      if (s._lastDefId !== m.definitionId) {
        this._morphToDef(s, m)
        s._lastDefId = m.definitionId
      }

      const now  = this._scene.time.now
      const curHp = m.resources?.hp ?? 0
      const isDead = m.aiState === 'dead' || curHp <= 0
      if (isDead) s.isDead = true  // tag for NIGHT_PHASE_STARTED cleanup

      // Position + Y-sort against the boss + adventurers (larger
      // worldY draws on top).  Skipped while held — the held minion
      // keeps its fixed depth-100 lift so it stays above everything
      // until dropped. Corpses are pinned to a sub-7 depth band so
      // adventurers always render OVER them — without this, an adv
      // walking onto the same tile as a corpse can be visually
      // occluded by it, which reads as "the body is blocking me".
      // Stationary-entity gate. 100+ minions at night sit perfectly
      // still; calling setPosition + setDepth on each every frame still
      // pings Phaser's display list and is a measurable chunk of the
      // ~30ms/frame "untracked" overhead PerfHud doesn't show. Only
      // touch the container when world coords actually changed.
      if (s._lastSetX !== m.worldX || s._lastSetY !== m.worldY) {
        s.container.setPosition(m.worldX, m.worldY)
        if (!m._heldByPlayer) {
          const baseDepth = isDead ? 1.6 : 7   // corpses below all live entities
          s.container.setDepth(baseDepth + m.worldY * 0.0005)
        }
        s._lastSetX = m.worldX
        s._lastSetY = m.worldY
      } else if (m._heldByPlayer) {
        // Held-minion sprite has its own depth-100 lift; if the held
        // state flipped between frames without a world-coord change
        // (rare but possible) re-apply position so the lift kicks in.
        s.container.setPosition(m.worldX, m.worldY)
      }
      // LOD fast-path: at low zoom, hide the cosmetic overlays and
      // skip the rest of the per-tick body. The minion sprite + corpse
      // depth is already set above so the overview render is correct.
      if (lod) {
        if (s.hp?.visible)         s.hp.setVisible(false)
        if (s.hpBg?.visible)       s.hpBg.setVisible(false)
        if (s.lvLabel?.visible)    s.lvLabel.setVisible(false)
        if (s.lootBadge?.visible)  s.lootBadge.setVisible(false)
        continue
      }

      // Mimic disguise — render as a red-tinted Treasure Chest sprite at
      // the mimic's pre-rolled `chestTier` (1..10). Player sees the red
      // tint as a "danger" hint; adventurers perceive it as a normal
      // chest (the tint is purely visual). Sprite frame tracks state:
      //   'chest'  → frame 0 (closed lid)
      //   'sprung' → frame 3 (lid open)  — set after a kill, stays till
      //              the next NIGHT_PHASE_STARTED reset.
      if (m.isMimic && (m.mimicState === 'chest' || m.mimicState === 'sprung')) {
        if (s.sprite) s.sprite.setVisible(false)
        s.body?.setVisible?.(false)
        s.hp?.setVisible?.(false)
        s.hpBg?.setVisible?.(false)
        s.lvLabel?.setVisible?.(false)
        const tier   = m.chestTier ?? 1
        const texKey = `item-treasure-chest-${tier}`
        // Build/refresh the chest sprite. Lazy-create when the texture
        // is ready; degrade to invisible-no-op otherwise so we don't
        // crash on cold-start before Preload finishes.
        if (!s.chestSprite && this._scene.textures.exists(texKey)) {
          // Anchor bottom-center like TreasureChestRenderer (chest art
          // is taller than the 32px tile). 1.6× scale matches the
          // real-chest renderer so a mimic visually IS one of them.
          s.chestSprite = this._scene.add
            .sprite(0, 0, texKey, 0)
            .setOrigin(0.5, 1)
            .setScale(1.6)
          // Red tint — player-side cue. Adventurers' AI ignores tint
          // (they just see "a chest"). 0xff5050 = punchy warning red
          // that still reads on top of all 10 chest art tiers.
          s.chestSprite.setTint(0xff5050)
          s.container.add(s.chestSprite)
        }
        if (s.chestSprite) {
          // Lift slightly so the bottom-anchor lands on the tile floor
          // instead of below it (container origin is mid-tile).
          s.chestSprite.setPosition(0, 14)
          s.chestSprite.setVisible(true)
          // State-driven frame: 0 = closed, 3 = open (per the chest
          // 4-frame anim convention). 'sprung' stays on the open frame
          // till the night-phase reset flips state back to 'chest'.
          const targetFrame = m.mimicState === 'sprung' ? 3 : 0
          if (s.chestSprite.frame?.name !== targetFrame) {
            s.chestSprite.setFrame(targetFrame)
          }
        }
        // Clean up the old custom-drawn graphics overlay if it lingers
        // from a save before this renderer rewrite shipped.
        if (s.chestOverlay) { s.chestOverlay.destroy(); s.chestOverlay = null }
        s.lastX = m.worldX; s.lastY = m.worldY; s.lastHp = curHp
        continue   // skip the rest of the per-frame update for chest mimics
      } else if (s.chestSprite) {
        // Dead mimic (knowledge-aware adv killed it via combat) — drop
        // the chest sprite and let the standard dead-minion render show.
        s.chestSprite.destroy()
        s.chestSprite = null
        if (s.sprite) s.sprite.setVisible(true)
        s.body?.setVisible?.(true)
      } else if (s.chestOverlay) {
        s.chestOverlay.destroy(); s.chestOverlay = null
        if (s.sprite) s.sprite.setVisible(true)
        s.body?.setVisible?.(true)
      }

      // Facing — snap to cardinal based on per-frame movement delta.
      if (s.lastX !== null) {
        const dx = m.worldX - s.lastX
        const dy = m.worldY - s.lastY
        const adx = Math.abs(dx), ady = Math.abs(dy)
        if (adx > 0.05 || ady > 0.05) {
          s.facing = (adx > ady)
            ? (dx > 0 ? 'right' : 'left')
            : (dy > 0 ? 'down'  : 'up')
        }
      }
      // Facing pin — night build-phase "face the camera" (sell/move/upgrade) and
      // the VFX Lab both override the movement-derived facing.
      if (m._faceOverride)  s.facing = m._faceOverride
      if (m._vfxLabFacing)  s.facing = m._vfxLabFacing
      s.lastX = m.worldX; s.lastY = m.worldY

      // Walk detection — compare against an older sample so a single static
      // frame between AI ticks doesn't drop the anim back to idle.
      if (s.sampleAt === 0 || now - s.sampleAt >= WALK_SAMPLE_MS) {
        if (s.sampleAt > 0) {
          const sdx = m.worldX - s.sampleX
          const sdy = m.worldY - s.sampleY
          s.isMoving = Math.abs(sdx) >= WALK_MIN_DELTA || Math.abs(sdy) >= WALK_MIN_DELTA
        }
        s.sampleX = m.worldX; s.sampleY = m.worldY; s.sampleAt = now
      }

      // Night idle flavor — a gentle per-family micro-motion while standing in
      // the build phase (paused between roam hops, or frozen facing the camera)
      // so the dungeon breathes. Position-only + recomputed from this frame's
      // worldX/worldY (re-set above), so it never accumulates or leaks into day.
      this._applyNightIdle(s, m)

      // Hurt — fire on any HP drop.
      if (s.lastHp !== null && curHp < s.lastHp) {
        s.hurtUntil = now + HURT_FLASH_MS
      }
      s.lastHp = curHp

      // Anim prefix — final-form minions that reuse a boss texture set use the
      // boss anim prefix (bossSkinId-state-dir); everyone else uses the
      // standard minion-defId-state-dir prefix. Hoisted above the attack latch
      // so it can resolve the attack key.
      const def = this._defMap[m.definitionId]
      const raisedPrefix = this._raisedDeadPrefix(m)
      const prefix = raisedPrefix
        ?? (def?.bossSkinId ? def.bossSkinId : `minion-${m.definitionId}`)

      // Attack — latch the attack-state window to the attack anim's ACTUAL
      // duration so it plays to completion (2026-06-02). The old fixed
      // ATTACK_FLASH_MS (400ms) cut off any attack sheet longer than that
      // (e.g. 6 frames @ 10fps = 600ms): wantState flipped back to walk/idle
      // mid-swing and the next play() interrupted the anim. Now a fresh attack
      // (lastAttackAt advanced) holds the attack state for the registered
      // anim's real duration and restarts the swing from frame 0.
      const atkAt = m.lastAttackAt ?? 0
      if (atkAt > (s.lastSeenAttackAt ?? 0)) {
        s.lastSeenAttackAt = atkAt
        const atkKey = this._resolveAnimKey(prefix, 'attack', s.facing)
        const atkDur = (atkKey && this._scene.anims.get(atkKey)?.duration) || ATTACK_FLASH_MS
        s.attackUntil = now + atkDur
        if (atkKey && s.sprite) { s.currentAnim = atkKey; s.sprite.play(atkKey, false) }
      }
      const recentAttack = now < (s.attackUntil ?? 0)

      // Pick state — same priority order as BossRenderer. The VFX Lab can pin
      // a specific state for animation review (m._vfxLabAnim) ahead of all else.
      const wantState =
        m._vfxLabAnim      ? m._vfxLabAnim :
        isDead             ? 'death' :
        now < s.hurtUntil  ? 'hurt'  :
        recentAttack       ? 'attack':
        (m.aiState === 'engaging' && s.isMoving) ? 'run' :
        s.isMoving         ? 'walk'  :
                             'idle'

      // Play anim if changed and registered. _resolveAnimKey tries direction
      // fallbacks then state fallbacks so a missing sheet never leaves the
      // sprite frozen on a stale frame.
      //
      // RISE FROM DEATH — generic: if this sprite was a corpse last frame and
      // the entity is alive again now, it just got revived (Skeleton Reassemble,
      // pay-to-revive, any future raise). Play the DEATH clip in REVERSE so the
      // body knits back together and stands up, then fall through to normal
      // states. Detected from the dead→alive transition, so revival code never
      // has to know about the renderer.
      if (s.sprite) {
        const stillRising = !isDead && s._riseUntil && now < s._riseUntil
        if (!isDead && s._wasDead && !m._vfxLabAnim) {
          const deathKey = this._resolveAnimKey(prefix, 'death', s.facing)
          if (deathKey) {
            s._riseUntil = now + ((this._scene.anims.get(deathKey)?.duration) || 500)
            s.currentAnim = '__rising__'
            s.sprite.playReverse(deathKey)
          }
        } else if (!stillRising) {
          const resolved = this._resolveAnimKey(prefix, wantState, s.facing)
          if (resolved && s.currentAnim !== resolved) {
            s.currentAnim = resolved
            s.sprite.play(resolved, true)
          }
        }
        // else: hold the reverse-death rise clip until s._riseUntil elapses
        s._wasDead = isDead   // track for next frame's revival detection
      }

      // Visibility — spectral minions translucent; hidden mimics fully invisible.
      // Dead minions stay visible at their last frame as corpses until
      // NIGHT_PHASE_STARTED clears them. Doorway shadow dim: standing on a
      // doorway INNER (threshold) cell multiplies alpha by 0.55 to sell
      // stepping into the underpass shadow.
      let alpha = 1
      if (m.isSpectral) alpha = 0.55
      // Phase 1b.6 — Lizardman Camouflage: player can see camouflaged minions but they're
      // translucent. WAVERING (not flat) so the held state reads as an actively-blending
      // stalker — the green sheen + scale-glints are added below.
      if (m._camouflaged) alpha *= 0.4 + 0.12 * Math.sin(now / 300 + (m.worldX ?? 0) * 0.05)
      // Pass-3: Vampire Sleep on Ceiling / generic ambush — hidden until
      // the trigger condition flips _hidden off (adv enters room).
      // Adventurers skip _hidden minions in target acquisition (see
      // MinionAISystem) so the ambush still works — but the PLAYER sees a
      // faint ghost (HIDDEN_ALPHA) so they know the minion is lying in wait.
      // Golem Camouflaged Pillar is exempt: golems stay fully opaque to the
      // player even while _hidden (their _hidden flag still drives the AI
      // ambush, but per design they must not look faded).
      if (m._hidden && !String(m.definitionId ?? '').startsWith('golem')) {
        alpha *= HIDDEN_ALPHA
      }
      // Zombie reanimation crossfade — a Risen spawned DEAD slowly fades IN over the
      // adventurer corpse (which dissolves) so the body reads as decaying into a
      // zombie before it reverse-rises. Ramps 0→1 over _reanimFadeMs, then clears.
      if (m._reanimFadeFrom) {
        const p = Math.min(1, (now - m._reanimFadeFrom) / Math.max(1, m._reanimFadeMs ?? 1))
        alpha *= p
        if (p >= 1) { m._reanimFadeFrom = null }
      }
      s.container.setAlpha(alpha)

      // Lizardman CAMOUFLAGE sheen — while cloaked, the sprite wears a faint green
      // chameleon Glow (pulsing) + sheds occasional scale-glints, so the held camo state
      // reads as a shimmering, terrain-blending stalker rather than a flat ghost.
      if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
        if (!isDead && m._camouflaged) {
          if (!s._camoGlow) { try { s._camoGlow = s.sprite.postFX.addGlow(0x6fdf7a, 1.5, 0, false, 0.06, 6) } catch (e) { s._camoGlow = null } }
          else if (s._camoGlow !== true) s._camoGlow.outerStrength = 1.1 + 0.7 * Math.sin(now / 280)
          if (Number.isFinite(m.worldX) && now - (s._camoGlintAt ?? 0) > 360 + Math.random() * 260) { s._camoGlintAt = now; AbilityVfx.camoShimmerFx?.(this._scene, m.worldX, m.worldY - 8) }
        } else if (s._camoGlow) { try { if (s._camoGlow !== true) s.sprite.postFX.remove(s._camoGlow) } catch (e) {} s._camoGlow = null }
      }

      // Gnoll BLOOD HUNT — after-image trail while sprinting after bleeding prey (sells
      // the speed). Emit a faded, red-tinted copy of the current sprite frame on a short
      // cadence; each copy fades out + self-destroys. Fire-and-forget like a VFX.
      if (m._huntSprinting && s.isMoving && s.sprite && now - (s._afterImgAt ?? 0) >= 70) {
        s._afterImgAt = now
        try {
          const tex = s.sprite.texture?.key
          if (tex) {
            const ai = this._scene.add.sprite(m.worldX, m.worldY, tex, s.sprite.frame?.name)
              .setOrigin(s.sprite.originX, s.sprite.originY)
              .setScale(s.sprite.scaleX, s.sprite.scaleY)
              .setFlipX(s.sprite.flipX)
              .setDepth((s.container.depth ?? 7) - 0.01)
              .setAlpha(0.4).setTint(0xcc4433)
            this._scene.tweens.add({ targets: ai, alpha: 0, duration: 260, onComplete: () => { try { ai.destroy() } catch (e) {} } })
          }
        } catch (e) {}
      }

      // Gnoll BLOOD FRENZY — while the pack is feral (`_forceScentUntil` window, set on
      // the Alpha + every bleed-pack gnoll by the ult), the gnoll WEARS its frenzy as a
      // throbbing feral red Glow on the sprite, so the SOURCE of the carnage reads (not
      // just the gore on the heroes).
      if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
        const frenzied = !isDead && (m._frenzied || (m._forceScentUntil && now < m._forceScentUntil))
        if (frenzied) {
          const str = 3 + 1.7 * Math.sin(now / 85)                                   // throbbing feral pulse
          if (!s._frenzyGlow) { try { s._frenzyGlow = s.sprite.postFX.addGlow(0xe0201a, str, 0, false, 0.06, 8) } catch (e) { s._frenzyGlow = null } }
          else if (s._frenzyGlow !== true) s._frenzyGlow.outerStrength = str
        } else if (s._frenzyGlow) { try { if (s._frenzyGlow !== true) s.sprite.postFX.remove(s._frenzyGlow) } catch (e) {} s._frenzyGlow = null }
      }

      // HP bars hidden for minions per user request — bar+bg are still
      // created (so any other code that pokes `s.hp` still works) but the
      // per-tick width update is skipped and they're set invisible at
      // creation time. To restore: remove the setVisible(false) calls in
      // _createSprite + _createPlaceholderSprite and uncomment the line:
      // s.hp.width = Math.max(0, Math.round(((m.resources?.maxHp ?? 0) > 0 ? curHp / m.resources.maxHp : 0) * s.hpBarW))

      // Faction-flip stroke colour (defected minions get a green outline).
      // Only meaningful on the placeholder rect; sprite-rendered minions
      // wear faction via tint instead. Necromancer-raised undead and
      // beast-master tames are intentionally rendered without the green
      // flag so they read as normal sprites — their owner adventurer
      // standing nearby is the visual tell that they're on the party's
      // side.
      const isOwnedAlly    = !!(m.raisedByAdvId || m.tamedByAdvId)
      const factionFlagged = m.faction === 'adventurer' && !isOwnedAlly
      const expectedStroke = factionFlagged ? 0x33cc77 : m.color
      if (s.body && s._lastStroke !== expectedStroke) {
        s.body.setStrokeStyle(2, expectedStroke, 1)
        s._lastStroke = expectedStroke
      }
      if (s.sprite) {
        // Lich-raised undead keep their dark undead tint, captured at sprite
        // creation as `_raisedDeadTint`. Faction-flag green still wins for
        // anything aligned with the adventurers (shouldn't happen for raised
        // dead, but covers the edge case cleanly).
        // Solo Leveling — Jinwoo's extracted shadows wear a blue→black vertical
        // gradient (Shadow Monarch palette) via a 4-corner tint: blue top
        // corners, near-black bottom corners.
        if (m._shadowExtracted) {
          if (s._lastTint !== 'shadowGrad') {
            s.sprite.setTint(0x4a8bff, 0x4a8bff, 0x0a0a16, 0x0a0a16)
            s._lastTint = 'shadowGrad'
          }
        } else {
          const baseTint     = s._raisedDeadTint ?? 0xffffff
          const expectedTint = factionFlagged ? 0x88ff99 : baseTint
          if (s._lastTint !== expectedTint) {
            s.sprite.setTint(expectedTint)
            s._lastTint = expectedTint
          }
        }
      }

      // Lich SOUL HARVEST — the Lich WEARS its banked souls: a ring of soul-wisps
      // (one per soul, capped) slowly orbiting the caster + a green glow that
      // intensifies with the count. A readable "how charged am I" tell — you watch
      // souls accumulate as the dungeon kills, and Soul Storm visibly spends them
      // (the wisps wink out as `_souls` drops). Wisps are cheap cached-texture
      // Images parented to the container; orbited each frame, depth-faked by scale/
      // alpha. Glow is WebGL-only (postFX no-op on Canvas).
      {
        const souls = (!isDead && m._souls > 0) ? Math.min(m._soulCap ?? 8, m._souls) : 0
        if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
          if (souls > 0) {
            const strength = 1.5 + (souls / (m._soulCap ?? 8)) * 4
            if (!s._soulGlow) { try { s._soulGlow = s.sprite.postFX.addGlow(0x4cff9e, strength, 0, false, 0.06, 8) } catch (e) { s._soulGlow = null } }
            else if (s._soulGlow !== true) { s._soulGlow.outerStrength = strength }
          } else if (s._soulGlow) {
            try { if (s._soulGlow !== true) s.sprite.postFX.remove(s._soulGlow) } catch (e) {}
            s._soulGlow = null
          }
        }
        s._soulWisps = s._soulWisps ?? []
        if (s._soulWisps.length !== souls) {
          while (s._soulWisps.length < souls) {
            const w = this._scene.add.image(0, 0, AbilityVfx.soulWispTexture(this._scene)).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5)
            s.container.add(w); s._soulWisps.push(w)
          }
          while (s._soulWisps.length > souls) { const w = s._soulWisps.pop(); try { w.destroy() } catch (e) {} }
        }
        const n = s._soulWisps.length
        if (n) {
          const R = 17
          for (let i = 0; i < n; i++) {
            const a = now / 1100 + i * (Math.PI * 2 / n)
            const front = (Math.sin(a) + 1) / 2          // 0 back … 1 front
            const w = s._soulWisps[i]
            w.setPosition(Math.cos(a) * R, -13 + Math.sin(a) * R * 0.4 + Math.sin(now / 360 + i) * 1.5)
            w.setScale(0.4 + front * 0.32).setAlpha(0.45 + front * 0.5)
            w.rotation = Math.cos(a) * 0.25
          }
        }
      }

      // Orc BLOODLUST — the orc WEARS its rage: a reddening glow that intensifies
      // with Bloodlust stacks + blood-rune pips (one per stack, capped) HOVERING in
      // an arc above its shoulders and THROBBING on a shared rage pulse (deliberately
      // NOT a smooth orbit, so it reads distinct from the Lich's souls). You see a
      // maxed-out orc about to wreck the room before it swings.
      {
        const cap = m._bloodlustMax ?? 6
        const stacks = (!isDead && m._bloodlustStacks > 0) ? Math.min(cap, m._bloodlustStacks) : 0
        if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
          if (stacks > 0) {
            const strength = 1 + (stacks / cap) * 5
            if (!s._rageGlow) { try { s._rageGlow = s.sprite.postFX.addGlow(0xc41525, strength, 0, false, 0.05, 8) } catch (e) { s._rageGlow = null } }
            else if (s._rageGlow !== true) { s._rageGlow.outerStrength = strength }
          } else if (s._rageGlow) {
            try { if (s._rageGlow !== true) s.sprite.postFX.remove(s._rageGlow) } catch (e) {}
            s._rageGlow = null
          }
        }
        s._ragePips = s._ragePips ?? []
        if (s._ragePips.length !== stacks) {
          while (s._ragePips.length < stacks) {
            const p = this._scene.add.image(0, 0, AbilityVfx.rageRuneTexture(this._scene)).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5)
            s.container.add(p); s._ragePips.push(p)
          }
          while (s._ragePips.length > stacks) { const p = s._ragePips.pop(); try { p.destroy() } catch (e) {} }
        }
        const rn = s._ragePips.length
        if (rn) {
          const throb = 0.85 + 0.28 * Math.sin(now / 130)   // shared fast rage pulse
          const rageK = stacks / cap
          for (let i = 0; i < rn; i++) {
            const t = rn === 1 ? 0.5 : i / (rn - 1)
            const px = (t - 0.5) * 32                                  // spread across the shoulders
            const py = -19 - Math.abs(t - 0.5) * 7 + Math.sin(now / 210 + i * 1.7) * 1.6   // arched up + slight bob
            const p = s._ragePips[i]
            p.setPosition(px, py).setScale((0.4 + rageK * 0.28) * throb).setAlpha(0.65 + rageK * 0.35)
            p.rotation = Math.sin(now / 280 + i) * 0.14
          }
        }
      }

      // Vampire BLOODGORGE — the vampire WEARS its blood-shield: a slow ring of
      // congealed blood-clots HUGGING the body as a dark carapace, denser the more
      // shield it carries, thinning/dimming as it decays or absorbs. Opaque dark
      // clots (NOT additive) + a dark-red glow — distinct from the Lich's glowing
      // souls and the Orc's overhead pips. You read its tankiness at a glance.
      {
        const maxHp = m.resources?.maxHp ?? m.stats?.hp ?? 1
        const shieldK = (!isDead && m._bloodShield > 0) ? Math.min(1, m._bloodShield / Math.max(1, maxHp * 0.6)) : 0
        const clots = shieldK > 0 ? Math.max(2, Math.round(2 + shieldK * 6)) : 0   // 2 … 8
        if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
          if (clots > 0) {
            const strength = 1 + shieldK * 3
            if (!s._shieldGlow) { try { s._shieldGlow = s.sprite.postFX.addGlow(0x8a0d1e, strength, 0, false, 0.05, 8) } catch (e) { s._shieldGlow = null } }
            else if (s._shieldGlow !== true) { s._shieldGlow.outerStrength = strength }
          } else if (s._shieldGlow) {
            try { if (s._shieldGlow !== true) s.sprite.postFX.remove(s._shieldGlow) } catch (e) {}
            s._shieldGlow = null
          }
        }
        s._shieldClots = s._shieldClots ?? []
        if (s._shieldClots.length !== clots) {
          while (s._shieldClots.length < clots) {
            const c = this._scene.add.image(0, 0, AbilityVfx.bloodClotTexture(this._scene)).setScale(0.5)
            s.container.add(c); s._shieldClots.push(c)
          }
          while (s._shieldClots.length > clots) { const c = s._shieldClots.pop(); try { c.destroy() } catch (e) {} }
        }
        const cn = s._shieldClots.length
        if (cn) {
          const R = 15
          for (let i = 0; i < cn; i++) {
            const a = now / 1600 + i * (Math.PI * 2 / cn)
            const front = (Math.sin(a) + 1) / 2          // 0 back … 1 front (fake depth)
            const c = s._shieldClots[i]
            c.setPosition(Math.cos(a) * R, -8 + Math.sin(a) * R * 0.45)
            c.setScale((0.4 + shieldK * 0.18) * (0.8 + front * 0.4))
            c.setAlpha((0.55 + shieldK * 0.35) * (0.65 + front * 0.35))
            c.rotation = a * 0.4
          }
        }
      }

      // Zombie OUTBREAK — every zombie (and risen husk) WEARS a swarm of carrion flies
      // buzzing around it, thickening as the room's zombie count grows so a packed
      // outbreak visibly crawls with flies. Motion is erratic/jittery with a buzzing
      // alpha flicker — deliberately NOT a smooth orbit (Lich souls), slow ring
      // (Vampire clots) or overhead throb (Orc pips). Reads as "this thing is rotting."
      if (!isDead && Array.isArray(m.tags) && (m.tags.includes('zombie') || m.tags.includes('raised'))) {
        const zc = this._zombieRoomCount(m.assignedRoomId, now)
        const flies = Math.min(3, Math.max(1, Math.round(zc * 0.5)))
        s._zFlies = s._zFlies ?? []
        const _hasFlySheet = this._scene.textures.exists('fly-sheet')
        if (s._zFlies.length !== flies) {
          while (s._zFlies.length < flies) {
            const f = _hasFlySheet ? this._scene.add.sprite(0, 0, 'fly-sheet')
                                   : this._scene.add.image(0, 0, AbilityVfx.flyTexture(this._scene))
            if (_hasFlySheet && this._scene.anims.exists('fly-buzz')) f.play({ key: 'fly-buzz', startFrame: Math.floor(Math.random() * 8) })
            s.container.add(f); s._zFlies.push(f)
          }
          while (s._zFlies.length > flies) { const f = s._zFlies.pop(); try { f.destroy() } catch (e) {} }
        }
        const fn = s._zFlies.length, t = now / 1000
        const _flyBase = _hasFlySheet ? 0.24 : 0.46            // 32px animated sheet vs the 16px baked tex
        for (let i = 0; i < fn; i++) {
          const ph = i * 2.39                                   // golden-ish spacing so they don't sync
          const ang = t * (1.6 + i * 0.3) + ph
          const rad = 9 + Math.sin(t * 5 + ph) * 4              // pulsing wander radius
          const fx = Math.cos(ang) * rad + Math.sin(t * 7 + ph) * 3
          const fy = -11 + Math.sin(ang * 1.3) * rad * 0.5 + Math.cos(t * 6 + ph) * 2.5
          const f = s._zFlies[i]
          const _sc = _flyBase + 0.06 * ((Math.sin(ang) + 1) / 2)
          // face the orbital travel direction — sprite art faces RIGHT, so flip
          // scaleX negative while moving left (x-velocity ∝ -sin(ang)).
          const _dir = Math.sin(ang) < 0 ? 1 : -1
          f.setPosition(fx, fy).setScale(_dir * _sc, _sc)
          f.setAlpha(0.78 + 0.2 * Math.sin(t * 11 + ph * 1.7))   // buzzing flicker, never fully vanishes
        }
      } else if (s._zFlies && s._zFlies.length) {
        for (const f of s._zFlies) { try { f.destroy() } catch (e) {} }
        s._zFlies = []
      }

      // Demon HELLFIRE WREATH — a DEMON is a walking bonfire: flame-tongues lick UP
      // around its body (flickering height/alpha on their own phases) + a constant
      // red-hot Glow + a steady shed of rising embers. Always on (the burning aura
      // never stops). Literal fire — distinct from every other "wear-your-resource" tell.
      // Gated to demon* defs (NOT the `fiend` tag) — imps share `fiend` but must not wear
      // the demon's bonfire; they read as nimble fiends via their own blink VFX instead.
      if (!isDead && String(m.definitionId ?? '').startsWith('demon')) {
        if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
          if (!s._fireGlow) { try { s._fireGlow = s.sprite.postFX.addGlow(0xff5a18, 1.8, 0, false, 0.05, 8) } catch (e) { s._fireGlow = null } }
          else if (s._fireGlow !== true) { s._fireGlow.outerStrength = 1.6 + 0.45 * Math.sin(now / 160) }
        }
        s._fireFlames = s._fireFlames ?? []
        // T1 Brimstone Fiend wears only the glow + embers (smoldering); the visible
        // flame-tongue wreath is a tier-progression tell that starts at T2.
        const FN = m.definitionId === 'demon1' ? 0 : 5
        if (s._fireFlames.length !== FN) {
          while (s._fireFlames.length < FN) {
            const fl = this._scene.add.image(0, 0, AbilityVfx.flameTongueTexture(this._scene)).setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5)
            s.container.add(fl); s._fireFlames.push(fl)
          }
          while (s._fireFlames.length > FN) { const fl = s._fireFlames.pop(); try { fl.destroy() } catch (e) {} }
        }
        const fnF = s._fireFlames.length
        // Bigger tiers sit lower in their frame → drop the wreath to keep it at the feet
        // (T1 perfect at the base value; T2 a touch lower; T3 miniboss lower still).
        const _fireDrop = m.definitionId === 'demon_lord' ? 7 : m.definitionId === 'demon2' ? 2 : 0
        for (let i = 0; i < fnF; i++) {
          const tt = fnF === 1 ? 0.5 : i / (fnF - 1)
          const px = (tt - 0.5) * 24                                  // spread across the body width
          const baseY = 17 + _fireDrop - Math.abs(tt - 0.5) * 5       // base hugs the feet, slight arch
          const ph = i * 1.9
          const flick = 0.72 + 0.36 * Math.sin(now / 90 + ph) + 0.12 * Math.sin(now / 47 + ph * 2)   // licking height
          const fl = s._fireFlames[i]
          fl.setPosition(px + Math.sin(now / 130 + ph) * 1.6, baseY)
          fl.setScale((0.42 + 0.05 * Math.sin(now / 200 + ph)) * (i === Math.floor(fnF / 2) ? 1.25 : 1), Math.max(0.18, 0.52 * flick))
          fl.setAlpha(0.7 + 0.25 * Math.sin(now / 70 + ph * 1.3))
        }
        // Rising embers are the T3 Demon Lord's tell only (smolder→flames→embers tier
        // progression). Spawn spread across the body width, not a single column.
        if (m.definitionId === 'demon_lord' && now - (s._fireEmberAt ?? 0) > 150 && Number.isFinite(m.worldX)) {
          s._fireEmberAt = now
          AbilityVfx.emberRiseFx?.(this._scene, m.worldX, m.worldY - 6, { count: 2, originW: 15, depth: 11 + (m.worldY ?? 0) * 0.0005 + 0.5 })
        }
      } else if (s._fireFlames && s._fireFlames.length) {
        for (const fl of s._fireFlames) { try { fl.destroy() } catch (e) {} }
        s._fireFlames = []
        if (s._fireGlow && s.sprite) { try { if (s._fireGlow !== true) s.sprite.postFX.remove(s._fireGlow) } catch (e) {} s._fireGlow = null }
      }

      // Ghost SPECTRAL DREAD — a spectral minion is a floating wraith that radiates fear:
      // it HOVERS (float-bob), wears a cold pallid glow, pools a faint dread-field on the
      // floor, and is watched by ambient eyes. All of it SEETHES harder the more adventurers
      // it's currently frightening — the engine stamps `m._dreadFearK` each dread tick; a
      // lone/idle ghost is just a quiet cold drift.
      if (!isDead && Array.isArray(m.tags) && m.tags.includes('spectral')) {
        // (C) reactive intensity — lerp toward the engine's current projected-fear, which
        // decays to 0 when the dread tick goes stale (no prey near / night). Frame-indep.
        const fresh = (now - (m._dreadAt ?? 0)) < 900
        const targetK = fresh ? (m._dreadFearK ?? 0) : 0
        s._dreadK = (s._dreadK ?? 0)
        s._dreadK += (targetK - s._dreadK) * (1 - Math.pow(0.9, (this._frameDt ?? 16) / 16.667))
        const dk = s._dreadK
        const isSorrow = m.definitionId === 'ghost2'
        const tint = isSorrow ? 0x7fa8e0 : 0x9fb6e8
        if (m._spectralPhase == null) m._spectralPhase = ((Math.round((m.worldX ?? 0) + (m.worldY ?? 0)) % 100) / 100) * Math.PI * 2
        const ph = m._spectralPhase

        // (A) float-bob — ethereal hover. Own the sprite's local x/y (nothing else writes it).
        if (s.sprite) {
          s.sprite.y = Math.sin(now / (isSorrow ? 720 : 560) + ph) * (2.0 + dk * 1.6)
          s.sprite.x = Math.sin(now / 1100 + ph) * (0.7 + dk * 0.8)
        }
        // (A) cold pallid glow — strength ramps with the dread it's projecting.
        if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
          const strength = 1.3 + dk * 4.6
          if (!s._dreadGlow) { try { s._dreadGlow = s.sprite.postFX.addGlow(tint, strength, 0, false, 0.06, 8) } catch (e) { s._dreadGlow = null } }
          else if (s._dreadGlow !== true) { s._dreadGlow.outerStrength = strength }
        }
        // (B) dread-field — a faint cold gloom pooled on the floor in its aura radius;
        // density tracks dk so it's barely there when idle, denser when terrorising. A
        // soft feathered blob (NOT a ring/dome — kept subtle to avoid clutter). Separate
        // scene Image at floor depth (positioned each frame); torn down in _destroySprite.
        if (Number.isFinite(m.worldX)) {
          if (!s._dreadField) { s._dreadField = this._scene.add.image(0, 0, AbilityVfx.dreadFieldTexture(this._scene)).setDepth(2) }
          const rTiles = isSorrow ? 3.4 : 3.0, fr = (rTiles * 32) / 78
          const breath = 0.96 + 0.06 * Math.sin(now / 900 + ph)
          s._dreadField.setPosition(m.worldX, m.worldY + 6).setScale(fr * breath, fr * 0.5 * breath).setAlpha(0.05 + dk * 0.13)
        }
        // (B) ambient watching-eyes — the idle "you're being watched" read. Sparse blinks
        // on a slow cadence ONLY when fairly idle (dk low); during active terror the engine
        // already fires dread eyes toward the prey, so we don't double up.
        if (dk < 0.3 && Number.isFinite(m.worldX) && now - (s._dreadEyeAt ?? 0) > 1500 + Math.random() * 900) {
          s._dreadEyeAt = now
          AbilityVfx.dreadAuraFx?.(this._scene, m.worldX, m.worldY, { radiusTiles: 2.2, count: 1, color: tint })
        }
      } else if (s._dreadField || s._dreadGlow) {
        // Leaving spectral state (death / morph) — tear down the dread tells + restore sprite.
        if (s._dreadField) { try { s._dreadField.destroy() } catch (e) {} s._dreadField = null }
        if (s._dreadGlow && s.sprite) { try { if (s._dreadGlow !== true) s.sprite.postFX.remove(s._dreadGlow) } catch (e) {} s._dreadGlow = null }
        if (s.sprite) { s.sprite.y = 0; s.sprite.x = 0 }
        s._dreadK = 0
      }

      // Beholder GAZE — when a gaze ability fires, the creature's OWN eye blazes: a violet
      // Glow flash on the sprite (engine stamps `_gazeFlashUntil`), decaying over the
      // window. Welds the ability to the art (the in-world eye-ignite bloom sits on top).
      if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
        const gUntil = m._gazeFlashUntil || 0
        if (!isDead && now < gUntil) {
          const p = Math.max(0, Math.min(1, (gUntil - now) / (m._gazeFlashMs || 560)))
          const str = 1.5 + (m._gazeFlashStr || 4) * p
          if (!s._gazeGlow) { try { s._gazeGlow = s.sprite.postFX.addGlow(0xc060ff, str, 0, false, 0.06, 8) } catch (e) { s._gazeGlow = null } }
          else if (s._gazeGlow !== true) s._gazeGlow.outerStrength = str
        } else if (s._gazeGlow) { try { if (s._gazeGlow !== true) s.sprite.postFX.remove(s._gazeGlow) } catch (e) {} s._gazeGlow = null }
      }

      // Blood Briar (plant3) WELL-FED — it WEARS its lifesteal as a deep-red life-glow:
      // a faint breathing red at rest that FLARES bright as it drains the room (the engine
      // stamps `_briarFedUntil` when Stranglethorn heals it), then settles. Its sustain,
      // made visible on the briar itself.
      if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL && m.definitionId === 'plant3') {
        if (!isDead) {
          const fed = m._briarFedUntil && now < m._briarFedUntil
          const str = fed ? 4.5 + 1.5 * Math.sin(now / 90) : 1.0 + 0.4 * Math.sin(now / 620)
          if (!s._briarGlow) { try { s._briarGlow = s.sprite.postFX.addGlow(0x9a1530, str, 0, false, 0.05, 8) } catch (e) { s._briarGlow = null } }
          else if (s._briarGlow !== true) s._briarGlow.outerStrength = str
        } else if (s._briarGlow) { try { if (s._briarGlow !== true) s.sprite.postFX.remove(s._briarGlow) } catch (e) {} s._briarGlow = null }
      }

      // Golem AEGIS — an ally INSIDE a guardian's aura WEARS a faint multi-rock shield:
      // a few small stone plates overlaid on its sprite (a protective carapace) so the
      // player reads it as shielded. Persistent while covered; cleared when it leaves.
      if (!isDead && this._aegisProtectedSet(now).has(m.instanceId)) {
        s._aegisPlates = s._aegisPlates ?? []
        const PN = 5
        if (s._aegisPlates.length !== PN) {
          while (s._aegisPlates.length < PN) {
            const pl = this._scene.add.image(0, 0, AbilityVfx.rockPlateTexture(this._scene)).setAlpha(0.5)
            s.container.add(pl); s._aegisPlates.push(pl)
          }
          while (s._aegisPlates.length > PN) { const pl = s._aegisPlates.pop(); try { pl.destroy() } catch (e) {} }
        }
        // anatomical plate slots over the body: [dx, dy, scale, fixed-rotation].
        // The slot values are tuned to look right on the T1 golem (display height ~128);
        // scale by the sprite's actual display height vs that baseline so a SMALLER sprite
        // (skeleton, rat) wears a smaller shield and a bigger one (warden, ent) a bigger one.
        const szf = Math.max(0.45, Math.min(1.8, (s.sprite?.displayHeight || 128) / 128))
        const slots = [[0, -8, 0.62, 0.2], [-7, -3, 0.5, 1.1], [7, -3, 0.5, -1.0], [0, -16, 0.46, 0.0], [0, 3, 0.56, 2.4]]
        for (let i = 0; i < s._aegisPlates.length; i++) {
          const [dx, dy, sc, rot] = slots[i], pl = s._aegisPlates[i]
          pl.setPosition(dx * szf, dy * szf + Math.sin(now / 420 + i) * 0.5).setScale(sc * szf).setRotation(rot)
          pl.setAlpha(0.4 + 0.16 * Math.sin(now / 520 + i * 1.3))   // faint, subtly shimmering
        }
      } else if (s._aegisPlates && s._aegisPlates.length) {
        for (const pl of s._aegisPlates) { try { pl.destroy() } catch (e) {} }
        s._aegisPlates = []
      }

      // Golem BASTION window — while the Warden's bastion holds (`_bastionUntil`), every
      // hardened unit wears a stone-blue Glow so you SEE the garrison turtled up, then it
      // wears off. (The bastionFx burst is the one-shot; this is the persistent window.)
      {
        const bastioned = !isDead && m._bastionUntil && now < m._bastionUntil
        if (s.sprite && this._scene.renderer?.type === Phaser.WEBGL) {
          if (bastioned) { if (!s._bastionFx) { try { s._bastionFx = s.sprite.postFX.addGlow(0xaebccd, 3, 0, false, 0.05, 8) } catch (e) { s._bastionFx = null } } }
          else if (s._bastionFx) { try { if (s._bastionFx !== true) s.sprite.postFX.remove(s._bastionFx) } catch (e) {} s._bastionFx = null }
        }
      }

      // Rat SWARM — the SEETHE: a clustered pack OVERFLOWS with extra skittering rats
      // (the real rat1 sheet) milling around each rat, density scaling with pack size,
      // so the pile reads as a writhing swarm far bigger than its sprite count. Plus a
      // skitter-dust trail kicked up when a rat scurries.
      if (!isDead && Array.isArray(m.tags) && m.tags.includes('rat') && this._scene.textures.exists('minion-rat1-idle')) {
        const pack = this._ratPackCount(m.assignedRoomId, now)
        const seethe = pack > 0 ? Math.min(4, Math.max(1, Math.round(pack * 0.6))) : 0
        s._seetheRats = s._seetheRats ?? []
        if (s._seetheRats.length !== seethe) {
          while (s._seetheRats.length < seethe) {
            const img = this._scene.add.image(0, 0, 'minion-rat1-idle', 12).setScale(0.34).setAlpha(0.9)
            s.container.add(img); s.container.sendToBack(img)
            s._seetheRats.push({ img, tx: Math.random() * 48 - 24, ty: Math.random() * 26 - 6, repickAt: 0 })
          }
          while (s._seetheRats.length > seethe) { const r = s._seetheRats.pop(); try { r.img.destroy() } catch (e) {} }
        }
        const SEETHE_SC = 0.34
        // Frame-rate-independent ease toward the target: the 0.1/frame approach is
        // normalized by the real frame delta (derived from scene.time.now, which is
        // reliable — Phaser's smoothed loop.delta reads 0 here) so the rats skitter at a
        // CONSTANT real-time speed instead of accelerating as FPS climbs out of the boot
        // dip. Cached per-frame (recomputed only when `now` advances) so every minion in
        // a frame shares one delta and we never divide a frozen 0; clamped vs tab-stalls.
        if (this._ratFrameNow !== now) { this._ratFrameDt = this._ratFrameNow ? Math.min(100, now - this._ratFrameNow) : 16.667; this._ratFrameNow = now }
        const _ratK = 1 - Math.pow(0.9, this._ratFrameDt / 16.667)
        for (const sr of s._seetheRats) {
          const dx = sr.tx - sr.img.x, dy = sr.ty - sr.img.y
          if (Math.hypot(dx, dy) < 3 || now > sr.repickAt) { sr.tx = Math.random() * 46 - 23; sr.ty = Math.random() * 24 - 4; sr.repickAt = now + 300 + Math.random() * 600 }
          else { sr.img.x += dx * _ratK; sr.img.y += dy * _ratK }
          // pick the directional frame from the scurry vector: rows are up(6)/down(0)/
          // side(12, faces LEFT). Vertical movement → up/down row; else side + flip.
          if (Math.abs(dy) > Math.abs(dx)) { sr.img.setFrame(dy < 0 ? 6 : 0); sr.img.setScale(SEETHE_SC, SEETHE_SC) }
          else { sr.img.setFrame(12); sr.img.setScale(dx >= 0 ? -SEETHE_SC : SEETHE_SC, SEETHE_SC) }
        }
        // skitter-dust kicked up when the rat moves
        const moved = Math.abs((m.worldX ?? 0) - (s._ratLastX ?? m.worldX ?? 0)) + Math.abs((m.worldY ?? 0) - (s._ratLastY ?? m.worldY ?? 0))
        s._ratLastX = m.worldX; s._ratLastY = m.worldY
        if (moved > 0.5 && now - (s._ratDustAt ?? 0) > 150 && Number.isFinite(m.worldX)) {
          s._ratDustAt = now
          const dust = this._scene.add.graphics().setPosition(m.worldX + (Math.random() * 8 - 4), m.worldY + 4).setDepth(7.5)
          dust.fillStyle(0x5a4632, 0.35); dust.fillCircle(0, 0, 2 + Math.random())
          this._scene.tweens.add({ targets: dust, alpha: 0, scaleX: 2, scaleY: 1.4, duration: 320, ease: 'Quad.easeOut', onComplete: () => dust.destroy() })
        }
      } else if (s._seetheRats && s._seetheRats.length) {
        for (const r of s._seetheRats) { try { r.img.destroy() } catch (e) {} }
        s._seetheRats = []
      }

      // Solo Leveling — the same looping black-flame aura Jinwoo wears, behind
      // each shadow minion. Created once as a container child (inherits the
      // minion's position / visibility / teardown). Scaled to the sprite's
      // rendered height so it engulfs the minion like an aura regardless of
      // minion size; sent to back so the minion always renders in front.
      // A dead shadow minion loses its flame — the aura is extinguished the
      // moment it falls, leaving just the corpse. Destroyed (not hidden) so it
      // can't re-spawn while the corpse lingers; the creation guard below also
      // skips dead minions.
      if (isDead && s.shadowFlame) {
        s.shadowFlame.destroy()
        s.shadowFlame = null
      }
      if (m._shadowExtracted && !isDead && !s.shadowFlame && this._scene.textures.exists('vfx-shadow-flame')) {
        if (!this._scene.anims.exists('vfx-shadow-flame-loop')) {
          const tex = this._scene.textures.get('vfx-shadow-flame')
          if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
          this._scene.anims.create({
            key: 'vfx-shadow-flame-loop',
            frames: this._scene.anims.generateFrameNumbers('vfx-shadow-flame', { start: 0, end: 5 }),
            frameRate: 10,
            repeat: -1,
          })
        }
        const dsz = s.sprite?.displayHeight || 48
        const Sf  = dsz / 49   // ~1.3 for a 64px sprite — engulf + slight rise
        const flame = this._scene.add.sprite(2 * Sf, -4 * Sf, 'vfx-shadow-flame', 0)
          .setOrigin(0.5, 0.5)
          .setScale(Sf)
        flame.anims.play('vfx-shadow-flame-loop', true)
        s.container.add(flame)
        s.container.sendToBack(flame)
        s.shadowFlame = flame
      }

      // Cycle the shadow minion's flame tint each frame — the same RGB-style
      // blue↔black gradient sweep Jinwoo has (matched palette). Jinwoo's own
      // flame runs a bluer variant so he reads as uniquely "more blue".
      if (m._shadowExtracted && !isDead && s.shadowFlame) {
        const k   = (Math.sin(now / 650) + 1) / 2   // 0..1 cycle
        const top = _lerpHex(0x0a2a6b, 0x4aa0ff, k)  // deep-blue → bright-blue
        const bot = _lerpHex(0x02040a, 0x123a8c, k)  // near-black → deep-blue
        s.shadowFlame.setTint(top, top, bot, bot)
      }

      // Status badge — bounty star (★) + evolution TIER (T2/T3…). Tier 1 (base)
      // shows no tier mark so the badge stays clean; upgraded minions get a
      // "T{n}" so the player reads their roster investment at a glance. (Minion
      // LEVEL tracks the BOSS level now and is shown in the roster / inspector.)
      const tier = this._tierOf(m.definitionId)
      const hasBounty = !!m.hasBounty
      if (s._lastTier !== tier || s._lastBounty !== hasBounty) {
        s._lastTier = tier
        s._lastBounty = hasBounty
        const parts = []
        if (hasBounty) parts.push('★')
        if (tier >= 2) parts.push(`T${tier}`)
        const txt = parts.join(' ')
        s.lvLabel.setText(txt).setVisible(txt.length > 0)
      }

      // Phase 1b.1 — Orc Loot the Fallen badge. Show "+N" on orc-tagged
      // minions only while the active boss is the orc archetype and the
      // minion has at least one kill banked.
      if (s.lootBadge) {
        const archId = this._gameState?.player?.bossArchetypeId
        const isOrc  = archId === 'orc' && Array.isArray(m.tags) && m.tags.includes('orc')
        const bonus  = isOrc ? (m.lootAtkBonus ?? 0) : 0
        if (bonus !== s._lastLootBonus) {
          if (bonus > 0) s.lootBadge.setText(`+${bonus}`).setVisible(true)
          else           s.lootBadge.setVisible(false)
          s._lastLootBonus = bonus
        }
      }
    }

    // Drop sprites whose minions are gone (e.g. unplaced via NightPhase
    // removal). A minion mid sell-swallow is kept — _tickSelling owns its
    // sprite until the animation finishes.
    for (const id of Object.keys(this._sprites)) {
      if (seen.has(id)) continue
      if (this._sprites[id]?.selling) continue
      this._destroySprite(id)
    }
    this._drawUpgradeGlow(minions, this._scene.time.now)
    this._tickSelling(this._scene.time.now)
  }

  // Draw colour-coded glow rings under every upgradeable minion while the
  // UPGRADE tool is armed (cleared + redrawn each tick). Green = affordable,
  // dim red = eligible but unaffordable right now; ineligible / maxed minions
  // get no ring. The ring breathes via a sine pulse so it reads as interactive.
  _drawUpgradeGlow(minions, now) {
    const g = this._upgradeGlow
    if (!g) return
    g.clear()
    if (this._toolMode !== 'upgrade' || this._gameState.meta?.phase !== 'night') return
    const evo = this._scene.minionEvolutionSystem
    if (!evo?.canUpgrade) return
    const gold    = this._gameState.player?.gold ?? 0
    const devGold = !!Balance.DEV_INFINITE_GOLD
    const pulse   = 0.5 + 0.5 * Math.sin(now / 320)   // 0..1 breathing
    for (const m of (minions ?? [])) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (!evo.canUpgrade(m)) continue
      const cost   = upgradeCost(this._gameState, m, this._minionDefs, this._chains)
      const afford = devGold || gold >= cost
      const color  = afford ? 0x6ee06e : 0xcf5b5b
      const alpha  = afford ? (0.40 + 0.45 * pulse) : 0.30
      const r      = TS * (0.52 + 0.05 * pulse) * this._tierScaleFor(m.definitionId)
      g.lineStyle(afford ? 3 : 2, color, alpha)
      g.strokeCircle(m.worldX, m.worldY, r)
      if (afford) {
        g.lineStyle(1, 0xffffff, 0.12 + 0.18 * pulse)
        g.strokeCircle(m.worldX, m.worldY, r - 3)
      }
    }
  }

  destroy() {
    EventBus.off('MINION_DIED',         this._onMinionDied,  this)
    EventBus.off('NIGHT_PHASE_STARTED', this._refreshAll,    this)
    EventBus.off('DAY_PHASE_STARTED',   this._returnHeldToOrigin, this)
    EventBus.off('TOOL_MODE_CHANGED',   this._onToolModeChanged,  this)
    EventBus.off('ENTITY_SOLD',         this._onEntitySold,       this)
    this._scene?.input?.off?.('pointerdown', this._onScenePointerDown)
    this._hoverLabel?.destroy()
    this._upgradeGlow?.destroy()
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  // ── Hover tooltip ─────────────────────────────────────────────────────────

  _showHoverLabel(m) {
    const def = this._defMap[m.definitionId]
    const name = m.name ?? def?.name ?? m.definitionId ?? 'Minion'
    this._hoverLabel.setText(name).setVisible(true)
    this._hoverMinion = m
  }

  _hideHoverLabel(m) {
    if (m && this._hoverMinion !== m) return
    this._hoverLabel.setVisible(false)
    this._hoverMinion = null
  }

  // ── Pickup-and-move ───────────────────────────────────────────────────────

  // Toggles pickup: clicking an unheld minion picks it up; clicking the held
  // minion drops it in place. event.stopPropagation in the caller prevents
  // the scene-level handler from also firing. Pickup is gated to NightPhase
  // + MOVE tool mode — day-phase clicks and clicks without MOVE armed do
  // nothing. Drop-on-click on the held minion always works so the player
  // isn't trapped carrying one.
  _handleMinionClick(m, pointer) {
    if (this._heldMinion === m) {
      this._dropMinion(pointer.worldX, pointer.worldY)
      return
    }
    if (this._heldMinion) return
    if (this._isPlacingMinion()) return
    if (!this._isMoveModeArmed()) return
    // Mimic Vault spawn lock (2026-05-27). Mimics that spawn from the
    // Mimic Vault room are tied to the room — they re-bait at dawn,
    // they sit in the room's reserved slots, and the room's
    // bait-chest pairing depends on the spawn location staying put.
    // Player-PLACED mimics (built via BuildMenu, no
    // `isMimicVaultSpawn` flag) stay movable like any other player-
    // built minion. Surface a placement-error toast so the player
    // sees WHY their click did nothing.
    if (m.isMimicVaultSpawn) {
      const np = this._scene?.scene?.get?.('NightPhase')
      np?._showPlacementError?.('Vault mimics can\'t be moved')
      return
    }
    // Risen zombies (raised from slain heroes) are not part of the player's
    // managed roster — they can't be picked up / repositioned.
    if (m._raisedZombie) {
      const np = this._scene?.scene?.get?.('NightPhase')
      np?._showPlacementError?.('Risen zombies can\'t be moved')
      return
    }
    this._beginPickup(m)
  }

  // Returns true when the NightPhase scene has a minion type queued in its
  // placement palette. Cached `scene.get('NightPhase')` is cheap.
  _isPlacingMinion() {
    const np = this._scene?.scene?.get?.('NightPhase')
    return !!(np && np._selectedKind === 'minion' && np._selected)
  }

  // Pickup is only allowed during the build (Night) phase with the MOVE
  // tool armed on the action bar. This blocks day-phase clicks entirely
  // and forces the player to opt into rearrangement deliberately.
  _isMoveModeArmed() {
    const sm = this._scene?.scene
    if (!sm?.isActive?.('NightPhase')) return false
    const np = sm.get?.('NightPhase')
    return !!(np && np._toolMode === 'move')
  }

  _beginPickup(m) {
    // DAMNED · The Insomniac — a locked night seals the dungeon: no moving
    // minions either. Refuse the pickup + surface the same error toast the
    // NightPhase placement/sell paths use.
    if ((this._gameState?._mechanicFlags ?? {}).insomniacLockTonight) {
      this._scene?.scene?.get?.('NightPhase')?._showPlacementError?.('The Insomniac — the dungeon is sealed tonight')
      return
    }
    this._heldMinion = m
    this._pickupOrigin = {
      tileX: m.tileX, tileY: m.tileY,
      worldX: m.worldX, worldY: m.worldY,
      assignedRoomId: m.assignedRoomId ?? null,
      homeTileX: m.homeTileX ?? m.tileX,
      homeTileY: m.homeTileY ?? m.tileY,
    }
    m._heldByPlayer = true
    const rec = this._sprites[m.instanceId]
    if (rec) rec.container.setDepth(100)   // float above walls/doors while carried
    this._playPickupDropSfx()
    EventBus.emit('MINION_PICKED_UP', { minion: m })
  }

  _playPickupDropSfx() {
    const s = this._scene
    if (!s?.cache?.audio?.exists?.('sfx-minion-place')) return
    try { s.sound.play('sfx-minion-place', { volume: 0.7 }) } catch {}
  }

  // Snap to the cursor's tile (centered) and re-anchor home + room. Drops on
  // a non-walkable tile are rejected — the minion just stays held until a
  // valid drop is made. (Click on the minion itself still drops at its
  // current tile, which is always walkable since the minion was standing
  // there before pickup.)
  _dropMinion(wx, wy) {
    const m = this._heldMinion
    if (!m) return
    const tileX = Math.floor(wx / TS)
    const tileY = Math.floor(wy / TS)
    const tiles = this._scene.dungeonGrid?.getTiles?.()
    const row   = tiles?.[tileY]
    if (!row || !PathfinderSystem.isWalkable(row[tileX])) {
      this._showPlacementError("Can't place a minion there")
      return
    }
    // Boss chamber + entry hall are off-limits — minions can't be parked
    // there (matches _validateMinionPlacement for fresh placements).
    const dropRoom = this._scene.dungeonGrid?.getRoomAtTile?.(tileX, tileY)
    if (dropRoom?.definitionId === 'boss_chamber' || dropRoom?.definitionId === 'entry_hall') {
      this._showPlacementError(dropRoom.definitionId === 'entry_hall'
        ? "Can't place a minion in the entry hall"
        : "Can't place a minion in the boss chamber")
      return
    }

    // Per-room minion cap — same rule as fresh placement. Excludes the
    // held minion from the count so a same-room re-drop doesn't trip the
    // gate. NightPhase owns the canonical count helper; reach in rather
    // than duplicate the filter.
    if (dropRoom) {
      const np = this._scene?.scene?.get?.('NightPhase')
      const roomCap = Balance.MINIONS_PER_ROOM_CAP ?? 5
      const inRoom  = np?._roomMinionCount?.(dropRoom.instanceId, m.instanceId) ?? 0
      if (inRoom >= roomCap) {
        this._showPlacementError(`Room full (${inRoom}/${roomCap} minions)`)
        return
      }
    }

    // One minion per tile — reject a drop onto another live minion. The held
    // minion is excluded so a same-tile re-drop (cancel-in-place) still works.
    const np = this._scene?.scene?.get?.('NightPhase')
    if (np?._minionAtTile?.(tileX, tileY, m.instanceId)) {
      this._showPlacementError('A minion is already standing here')
      return
    }

    m.tileX  = tileX
    m.tileY  = tileY
    m.worldX = tileX * TS + TS / 2
    m.worldY = tileY * TS + TS / 2
    m.homeTileX = tileX
    m.homeTileY = tileY
    const room = this._scene.dungeonGrid?.getRoomAtTile?.(tileX, tileY)
    if (room) m.assignedRoomId = room.instanceId
    // Reset transient AI state so the minion behaves as fresh at the new spot.
    m._patrolTarget = null
    m._patrolAccum  = 0
    m._chasePath    = null

    m._heldByPlayer = false
    const rec = this._sprites[m.instanceId]
    if (rec) rec.container.setDepth(7)
    this._heldMinion = null
    this._pickupOrigin = null
    this._playPickupDropSfx()
    EventBus.emit('MINION_PLACED', { minion: m })
  }

  // Surface a transient error through NightPhase's existing toast so feedback
  // matches the rest of placement validation. Silent fallback if NightPhase
  // isn't reachable (shouldn't happen given pickup is gated to it).
  _showPlacementError(msg) {
    const np = this._scene?.scene?.get?.('NightPhase')
    np?._showPlacementError?.(msg)
  }

  // Force the held minion back to its pickup tile. Called when the player
  // exits MOVE mode or the day starts — leaving a minion floating attached
  // to the cursor in DayPhase would defeat the "no movement during day" rule.
  _returnHeldToOrigin() {
    const m = this._heldMinion
    if (!m) return
    const o = this._pickupOrigin
    if (o) {
      m.tileX  = o.tileX
      m.tileY  = o.tileY
      m.worldX = o.worldX
      m.worldY = o.worldY
      m.homeTileX = o.homeTileX
      m.homeTileY = o.homeTileY
      m.assignedRoomId = o.assignedRoomId
    }
    m._patrolTarget = null
    m._patrolAccum  = 0
    m._chasePath    = null
    m._heldByPlayer = false
    const rec = this._sprites[m.instanceId]
    if (rec) rec.container.setDepth(7)
    this._heldMinion = null
    this._pickupOrigin = null
  }

  _onToolModeChanged({ mode } = {}) {
    this._toolMode = mode ?? null
    if (mode !== 'move') this._returnHeldToOrigin()
    if (mode !== 'upgrade') this._upgradeGlow?.clear()
  }

  // Background click anywhere in the world — drop the held minion. Object-
  // level pointerdown handlers stop propagation, so this only fires for
  // empty-space clicks.
  _onScenePointerDown(pointer) {
    if (!this._heldMinion) return
    this._dropMinion(pointer.worldX, pointer.worldY)
  }


  // ── Internals ──────────────────────────────────────────────────────────────

  _createSprite(m) {
    // The Undying Court / Lich raise — a RISEN minion must render its fallen
    // adventurer's LPC sprite, NEVER the skeleton base. The base sheets load
    // on-demand, so after a save/reload (where no living adv of that class has
    // spawned this session) the sheet isn't loaded yet. Stream it in and DON'T
    // build a sprite this frame — otherwise we'd create a skeleton the player
    // sees the risen unit "revert" to. It stays briefly invisible (a frame or
    // two) until the real sheet lands, then renders as its exact adventurer.
    if (m._raisedSpriteVariant) {
      const key = `adv-${m._raisedSpriteVariant.replace('/', '-')}`
      if (!this._scene?.textures?.exists?.(key)) {
        const [cls, vId] = m._raisedSpriteVariant.split('/')
        if (cls && vId) { ensureAdventurerBaseSheet(this._scene, cls, vId); return null }
        // Malformed variant — fall through to the normal (skeleton) path.
      }
    }
    const def     = this._defMap[m.definitionId]
    const idleKey = this._idleTextureKey(def, m.definitionId, m)
    const hasSprite = def && idleKey && this._scene.textures.exists(idleKey)
    const rec = hasSprite ? this._createAnimatedSprite(m, def, idleKey)
                          : this._createPlaceholder(m)
    if (rec) rec._lastDefId = m.definitionId
    // Lich Necromancy: raised dead retain the dead adventurer's LPC sprite,
    // tinted darker to read as undead. Applied after creation so it survives
    // any later setTexture / setTint calls in the per-tick path.
    if (rec?.sprite && m._raisedSpriteVariant) {
      rec.sprite.setTint(0x5d5566)
      rec._raisedDeadTint = 0x5d5566
    }
    return rec
  }

  // Per-family idle "personality" for the night ambient micro-motion.
  //   float — hovering drifters (ghosts, bats, imps): slow vertical + side drift
  //   sway  — rooted/plant things (plants, mushrooms, ents): gentle side-to-side
  //   hop   — bouncy bodies (slimes): little upward bobs
  //   bob   — everyone else: a soft breathing rise/fall
  _idleStyle(defId) {
    const id = defId ?? ''
    if (/^(ghost|wisp|bat|imp|wraith|specter|spirit|banshee)/.test(id)) return 'float'
    if (/^(plant|mushroom|ent|vine|fungal|treant|shroom)/.test(id))     return 'sway'
    if (/^(slime|ooze|blob|jelly|goo)/.test(id))                        return 'hop'
    return 'bob'
  }

  // Apply the night-only idle micro-motion. Position-only and recomputed from the
  // container's per-frame world position, so it can never accumulate or persist
  // into the day combat phase. Skips moving minions (their walk anim is the life).
  _applyNightIdle(s, m) {
    if (!s?.container || !s?.sprite) return
    if (this._gameState?.meta?.phase !== 'night') return
    if (s.isMoving) return
    // Stable per-minion phase so a roomful doesn't pulse in lockstep.
    if (s._idleSeed == null) {
      let h = 0; const str = String(m.instanceId ?? '')
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
      s._idleSeed = ((h >>> 0) % 628) / 100   // 0..~2π
    }
    const t = (this._scene.time?.now ?? 0) / 1000
    const ph = s._idleSeed
    let ox = 0, oy = 0
    switch (this._idleStyle(m.definitionId)) {
      case 'float': oy = Math.sin(t * 1.5 + ph) * 3.2; ox = Math.sin(t * 0.85 + ph) * 1.6; break
      case 'sway':  ox = Math.sin(t * 1.25 + ph) * 2.3; oy = Math.sin(t * 2.5 + ph) * 0.5; break
      case 'hop':   oy = -Math.abs(Math.sin(t * 2.1 + ph)) * 3.0; break
      default:      oy = Math.sin(t * 1.7 + ph) * 1.4; break
    }
    s.container.x = m.worldX + ox
    s.container.y = m.worldY + oy
  }

  // Texture key for the idle frame — boss-skin finals use the boss texture
  // set (`${bossSkinId}-idle`), raised dead use the LPC adv texture for the
  // dead adventurer's class+variant, everyone else uses
  // `minion-${defId}-idle`.
  _idleTextureKey(def, defId, m) {
    const raised = this._raisedDeadPrefix(m)
    if (raised) return raised
    if (def?.bossSkinId) return `${def.bossSkinId}-idle`
    return `minion-${defId}-idle`
  }

  // For Lich-raised undead: the LPC adv prefix derived from the dead
  // adventurer's spriteVariant. Returns null if the minion isn't a
  // raised undead OR the LPC texture isn't loaded for that variant
  // (falls through to the standard skeleton sheet in that case).
  _raisedDeadPrefix(m) {
    if (!m?._raisedSpriteVariant) return null
    const prefix = `adv-${m._raisedSpriteVariant.replace('/', '-')}`
    if (!this._scene?.textures?.exists?.(prefix)) return null
    return prefix
  }

  // Scale multiplier for the minion's current evolution tier. Position-based
  // (chain index) so each evolution makes the sprite visibly larger.
  _tierScaleFor(defId) {
    for (const v of Object.values(this._chains)) {
      if (Array.isArray(v?.chain)) {
        const idx = v.chain.indexOf(defId)
        if (idx >= 0) return EVOLUTION_TIER_SCALE[Math.min(idx, EVOLUTION_TIER_SCALE.length - 1)]
      }
    }
    return 1.0
  }

  // Live rat count per room (for the SWARM seethe). Memoized per frame (`now`) so
  // it's O(minions) once, not O(rats²): the first rat that asks rebuilds the map.
  _ratPackCount(roomId, now) {
    if (this._ratCacheAt !== now) {
      this._ratCacheAt = now; this._ratCache = {}
      for (const mm of (this._gameState?.minions ?? [])) {
        if (mm.faction !== 'dungeon' || mm.aiState === 'dead' || (mm.resources?.hp ?? 0) <= 0) continue
        if (!Array.isArray(mm.tags) || !mm.tags.includes('rat')) continue
        this._ratCache[mm.assignedRoomId] = (this._ratCache[mm.assignedRoomId] ?? 0) + 1
      }
    }
    return this._ratCache[roomId] ?? 0
  }

  // Live zombie count per room (for the fly-swarm body tell — denser outbreak = more
  // flies on each body). Memoized per frame, same shape as _ratPackCount. Counts the
  // whole horde: placed zombies (tag 'zombie') AND short-lived Risen (tag 'raised').
  _zombieRoomCount(roomId, now) {
    if (this._zCacheAt !== now) {
      this._zCacheAt = now; this._zCache = {}
      for (const mm of (this._gameState?.minions ?? [])) {
        if (mm.faction !== 'dungeon' || mm.aiState === 'dead' || (mm.resources?.hp ?? 0) <= 0) continue
        if (!Array.isArray(mm.tags) || !(mm.tags.includes('zombie') || mm.tags.includes('raised'))) continue
        this._zCache[mm.assignedRoomId] = (this._zCache[mm.assignedRoomId] ?? 0) + 1
      }
    }
    return this._zCache[roomId] ?? 0
  }

  // Set of minion ids currently inside a guardian golem's Aegis aura (same room, within
  // its radius). Memoized per frame (`now`) so the aegis-sheen check is O(golems×minions)
  // once, not per-minion. Mirrors MinionAbilities.aegisMul's gate.
  _aegisProtectedSet(now) {
    if (this._aegisCacheAt !== now) {
      this._aegisCacheAt = now
      const set = new Set()
      const mins = this._gameState?.minions ?? []
      const golems = mins.filter(g => g.faction === 'dungeon' && g.aiState !== 'dead' && (g.resources?.hp ?? 0) > 0 && (g.definitionId === 'golem2' || g.definitionId === 'golem_warden'))
      for (const g of golems) {
        const R = g.definitionId === 'golem_warden' ? 3 : 2.5
        for (const m of mins) {
          if (m === g || m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
          if (m.assignedRoomId !== g.assignedRoomId) continue
          if (Math.hypot((m.tileX ?? 0) - (g.tileX ?? 0), (m.tileY ?? 0) - (g.tileY ?? 0)) > R + 0.01) continue
          set.add(m.instanceId)
        }
      }
      this._aegisCache = set
    }
    return this._aegisCache
  }

  // 1-based evolution tier of a minion def (chain position + 1); 1 for defs
  // with no chain. Mirrors minionRevive.tierOf, computed locally off _chains so
  // the renderer stays self-contained for the per-frame badge draw.
  _tierOf(defId) {
    for (const v of Object.values(this._chains)) {
      if (Array.isArray(v?.chain)) {
        const idx = v.chain.indexOf(defId)
        if (idx >= 0) return idx + 1
      }
    }
    return 1
  }

  // Transparent rows above the art in frame 0 of `key` (frame px, 0..fs).
  // Used to anchor the HP bar / status badge just above the minion's actual
  // visible top instead of the (often empty) frame top. Measured once per
  // texture key via an offscreen canvas, then cached. Returns 0 on any
  // failure so callers fall back to frame-top anchoring.
  _visibleTopPadding(key, fs) {
    this._topPadCache ??= {}
    if (key in this._topPadCache) return this._topPadCache[key]
    let pad = 0
    try {
      const img = this._scene.textures.get(key)?.getSourceImage?.()
      if (img) {
        const cv = this._padCanvas ??= document.createElement('canvas')
        const cx = cv.getContext('2d', { willReadFrequently: true })
        cv.width = fs; cv.height = fs
        cx.clearRect(0, 0, fs, fs)
        cx.drawImage(img, 0, 0, fs, fs, 0, 0, fs, fs)   // frame 0 = top-left cell
        const data = cx.getImageData(0, 0, fs, fs).data
        // Require a few opaque pixels per row so stray AA specks don't count.
        const need = Math.max(2, Math.round(fs * 0.03))
        for (let y = 0; y < fs; y++) {
          let c = 0
          for (let x = 0; x < fs; x++) if (data[(y * fs + x) * 4 + 3] > 50) c++
          if (c >= need) { pad = y; break }
        }
      }
    } catch { pad = 0 }
    this._topPadCache[key] = pad
    return pad
  }

  // Resolve the best available animation key for a given prefix+state+facing.
  // Tries the exact key first, then other directions, then a fallback state.
  // Returns null only for `death` with no death sheet (sprite stays on last frame,
  // which is the correct corpse appearance).
  _resolveAnimKey(prefix, state, facing) {
    const dirs = [facing, 'down', 'right', 'left', 'up']

    // 1. Exact direction, then other directions for the same state.
    for (const dir of dirs) {
      const key = `${prefix}-${state}-${dir}`
      if (this._scene.anims.exists(key)) return key
    }

    // 2. State fallbacks. Normal minion sheets have no death anim and freeze on
    //    their last frame (already a corpse pose). Adventurer-sprite (raised /
    //    revived-adventurer) minions instead play their HURT strip as the death
    //    animation — exactly like a living adventurer — so a felled revived hero
    //    drops with a proper death pose rather than freezing mid-stride.
    const fallbacks = { hurt: ['idle'], attack: ['idle'], run: ['walk', 'idle'] }
    if (prefix.startsWith('adv-')) fallbacks.death = ['hurt', 'idle']
    for (const fbState of (fallbacks[state] ?? [])) {
      for (const dir of dirs) {
        const key = `${prefix}-${fbState}-${dir}`
        if (this._scene.anims.exists(key)) return key
      }
    }

    return null
  }

  // Re-skin a live sprite record after the minion's definitionId changed
  // (evolved or reset). Swaps texture, rescales, and clears anim cache so
  // the next frame replays with the new prefix.
  _morphToDef(s, m) {
    if (!s.sprite) return  // placeholder path — definitionId changes are rare
    const def = this._defMap[m.definitionId]
    if (!def) return
    const idleKey = this._idleTextureKey(def, m.definitionId)
    if (this._scene.textures.exists(idleKey)) s.sprite.setTexture(idleKey, 0)
    const tierScale = this._tierScaleFor(m.definitionId)
    const baseScale = m._raisedSpriteVariant ? RAISED_DEAD_SCALE : MINION_SCALE
    const dispScale = _displayScaleFor(m, def)
    s.sprite.setScale(baseScale * tierScale * dispScale)
    s.currentAnim = null   // force play() with the new prefix next tick
  }

  _createAnimatedSprite(m, def, idleKey) {
    const s = this._scene
    // Depth 7 — below the dungeon overhead (9) and doors (9.5) so the
    // minion walks UNDER wall caps + closed doors, matching the design
    // intent (capstones / wall tops should hide entities behind them).
    const c = s.add.container(m.worldX, m.worldY).setDepth(7)

    const tierScale = this._tierScaleFor(m.definitionId)
    const baseScale = m._raisedSpriteVariant ? RAISED_DEAD_SCALE : MINION_SCALE
    const dispScale = _displayScaleFor(m, def)
    const sprite = s.add.sprite(0, 0, idleKey, 0)
      .setOrigin(0.5)
      .setScale(baseScale * tierScale * dispScale)

    // Slimeling pop-in — a newly-split mini-slime bounces into existence (after
    // the gooey slimeSplit animation) so it reads as emerging from the split,
    // not just appearing. One-shot on first render; container scale isn't
    // touched per-frame so the tween isn't fought.
    if (m._isMiniSlime && !m._poppedIn) {
      m._poppedIn = true
      c.setScale(0)
      s.tweens.add({ targets: c, scale: 1, duration: 280, delay: 140, ease: 'Back.easeOut' })
    }

    const fs          = def.frameSize ?? 64
    const displaySize = fs * baseScale * dispScale
    const hpBarW      = Math.round(displaySize * 0.55)
    // HP bar + status badge sit just above the sprite's ACTUAL visible top
    // edge — auto-detected (and cached) per texture, NOT anchored to the
    // frame top. Many minion frames (especially the 128px ones) leave a lot
    // of empty space above the art, which previously floated the bar + the
    // star/LV badge way above the character's head. `_visibleTopPadding`
    // measures the transparent rows above frame 0's art so every minion's
    // badge lands directly above it regardless of frame padding.
    //
    // `def.hpBarYOffset` is kept as an optional manual nudge on top (rarely
    // needed now that the position is measured; positive = down).
    const topPad      = this._visibleTopPadding(idleKey, fs)
    const hpY         = (topPad - fs / 2) * (baseScale * dispScale) - 4 + (def.hpBarYOffset ?? 0)

    const hpBg = s.add.rectangle(0,            hpY, hpBarW, 2, 0x220a06, 0.9).setOrigin(0.5).setVisible(false)
    const hp   = s.add.rectangle(-hpBarW / 2,  hpY, hpBarW, 2, 0xcc4422, 1).setOrigin(0, 0.5).setVisible(false)

    // Status badge — combined bounty star (★) + level (LV n), as ONE
    // label centred above the HP bar so the pair always reads centred on
    // the minion. Built each tick from m.hasBounty + m.level.
    const lvLabel = s.add.text(0, hpY - 7, '', {
      fontSize: '8px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(0.5, 0.5).setVisible(false)

    // Phase 1b.1 — Orc Loot the Fallen badge. Bottom-left of the sprite,
    // mirroring lvLabel's bottom-right placement. Hidden until lootAtkBonus > 0
    // AND the active boss is the orc archetype (toggled in the tick loop).
    const lootBadge = s.add.text(-displaySize / 2 + 1, displaySize / 2 - 2, '', {
      fontSize: '7px', color: '#ff8855', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(0, 1).setVisible(false)

    c.add([sprite, hpBg, hp, lvLabel, lootBadge])

    // Pixel-perfect hit testing on the sprite itself — pointer events only
    // register on non-transparent pixels of the actual art. Containers can't
    // do pixel-perfect (no texture), so we put interactivity on the sprite
    // and let it bubble up. Marker `_isMinionInteractive` lets NightPhase's
    // scene-level pointerdown skip room-pickup when the click lands on a
    // minion.
    sprite.setInteractive(this._scene.input.makePixelPerfect(1))
    sprite.input.cursor = 'pointer'
    sprite._isMinionInteractive = true
    sprite.on('pointerover', () => this._showHoverLabel(m))
    sprite.on('pointerout',  () => this._hideHoverLabel(m))
    sprite.on('pointerdown', (pointer, x, y, event) => {
      // Always announce — listeners (e.g. Demon sacrifice picker) can't rely
      // on scene-level pointerdown because we stopPropagation below.
      EventBus.emit('MINION_CLICKED', { minion: m, pointer })
      event?.stopPropagation?.()
      // Stamp the shared pointer so NightPhase's scene-level handler
      // (separate input plugin — gameObjects filter doesn't see this sprite)
      // can skip room pickup / room removal. Game scene's input runs before
      // NightPhase's, so the flag is set in time.
      pointer._consumedByMinion = true
      // Right-click no longer sells — selling is sell-button-only now.
      if (pointer.rightButtonDown()) return
      this._handleMinionClick(m, pointer)
    })

    const rec = {
      container: c, sprite, body: null, hp, hpBg, hpBarW, lvLabel, lootBadge,
      facing: 'down', currentAnim: null,
      lastX: null, lastY: null, lastHp: null,
      sampleX: 0, sampleY: 0, sampleAt: 0, isMoving: false,
      hurtUntil: 0, _lastLv: null, _lastBounty: null, _lastTint: null, _lastLootBonus: null,
    }
    this._sprites[m.instanceId] = rec
    return rec
  }

  _createPlaceholder(m) {
    const s = this._scene
    const SIZE = PLACEHOLDER_SIZE
    // Depth 7 — below the dungeon overhead (9) and doors (9.5) so the
    // minion walks UNDER wall caps + closed doors, matching the design
    // intent (capstones / wall tops should hide entities behind them).
    const c = s.add.container(m.worldX, m.worldY).setDepth(7)

    const body = s.add.rectangle(0, 0, SIZE, SIZE, 0x0a0e16, 1)
    body.setStrokeStyle(2, m.color, 1)

    const label = s.add.text(0, 0, m.sigil, {
      fontSize: '11px', color: '#e0e6f0', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)

    const hpBarW = SIZE
    // Placeholder path mirrors the sprite path: HP bar just above the body.
    const hpYP = -SIZE / 2 - 4
    const hpBg = s.add.rectangle(0,           hpYP, hpBarW, 2, 0x220a06, 0.9).setOrigin(0.5).setVisible(false)
    const hp   = s.add.rectangle(-SIZE / 2,   hpYP, hpBarW, 2, 0xcc4422, 1).setOrigin(0, 0.5).setVisible(false)

    // Status badge — combined bounty star (★) + level (LV n), one centred
    // label (see the sprite-path twin above for the rationale).
    const lvLabel = s.add.text(0, hpYP - 7, '', {
      fontSize: '8px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(0.5, 0.5).setVisible(false)

    // Phase 1b.1 — Orc Loot the Fallen badge (placeholder path mirrors sprite path).
    const lootBadge = s.add.text(-SIZE / 2 + 1, SIZE / 2 - 2, '', {
      fontSize: '7px', color: '#ff8855', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(0, 1).setVisible(false)

    c.add([body, label, hpBg, hp, lvLabel, lootBadge])

    // Placeholder has no texture for pixel-perfect — use the body's default
    // rectangle bounds (matches the visible square). Marker
    // `_isMinionInteractive` lets NightPhase skip room-pickup on this click.
    body.setInteractive({ useHandCursor: true })
    body._isMinionInteractive = true
    body.on('pointerover', () => this._showHoverLabel(m))
    body.on('pointerout',  () => this._hideHoverLabel(m))
    body.on('pointerdown', (pointer, x, y, event) => {
      EventBus.emit('MINION_CLICKED', { minion: m, pointer })
      event?.stopPropagation?.()
      pointer._consumedByMinion = true
      // Right-click no longer sells — selling is sell-button-only now.
      if (pointer.rightButtonDown()) return
      this._handleMinionClick(m, pointer)
    })

    const rec = {
      container: c, sprite: null, body, hp, hpBg, hpBarW, lvLabel, lootBadge,
      facing: 'down', currentAnim: null,
      lastX: null, lastY: null, lastHp: null,
      sampleX: 0, sampleY: 0, sampleAt: 0, isMoving: false,
      hurtUntil: 0, _lastLv: null, _lastBounty: null, _lastStroke: null, _lastLootBonus: null,
    }
    this._sprites[m.instanceId] = rec
    return rec
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s._dreadField?.destroy?.()   // ghost dread-field lives at floor depth, outside the container
    s.container.destroy()
    delete this._sprites[id]
    // If the hover label was tracking this minion, hide it — otherwise the
    // label remains glued to the last known worldX/worldY (e.g. after a
    // Demon Sacrifice strips the minion mid-day).
    if (this._hoverMinion?.instanceId === id) {
      this._hoverMinion = null
      this._hoverLabel?.setVisible(false)
    }
  }

  _onMinionDied(_evt) {
    // No-op — death anim plays in update() and freezes on its last frame.
    // The sprite is parked at its death position until NIGHT_PHASE_STARTED.
  }

  // ── Sell: death anim → fade ──────────────────────────────────────────────
  // The player sold this minion. Play its death animation; _tickSelling holds
  // while it plays, then fades the sprite out and destroys it. Fired by
  // NightPhase BEFORE the minion is spliced from gameState, so the sprite
  // record is still live.
  _onEntitySold({ kind, minion } = {}) {
    if (kind !== 'minion' || !minion) return
    const s = this._sprites[minion.instanceId]
    if (!s || s.selling) return
    // Death animation (corpse pose). Falls through harmlessly when the
    // minion's sheet has no death anim (_resolveAnimKey returns null).
    if (s.sprite) {
      const def    = this._defMap[minion.definitionId]
      const prefix = this._raisedDeadPrefix(minion)
        ?? (def?.bossSkinId ? def.bossSkinId : `minion-${minion.definitionId}`)
      const deathKey = this._resolveAnimKey(prefix, 'death', s.facing)
      if (deathKey) { s.currentAnim = deathKey; s.sprite.play(deathKey, true) }
    }
    // Drop any hover label still glued to this minion.
    if (this._hoverMinion?.instanceId === minion.instanceId) {
      this._hoverMinion = null
      this._hoverLabel?.setVisible(false)
    }
    s.selling = { startedAt: this._scene.time.now }
  }

  // Advance every sprite mid sell: hold while the death animation plays, then
  // fade the sprite out and destroy it when done.
  _tickSelling(now) {
    for (const id of Object.keys(this._sprites)) {
      const s = this._sprites[id]
      if (!s?.selling) continue
      const t = Math.min(1, (now - s.selling.startedAt) / SELL_FADE_MS)
      // Hold (death anim plays), then fade away over the back half.
      const fade = t > 0.45 ? (t - 0.45) / 0.55 : 0
      s.container.setAlpha(1 - fade)
      if (t >= 1) this._destroySprite(id)
    }
  }

  _refreshAll() {
    // Wipe all corpse sprites at the start of a night so they don't linger
    // into the next day. Live minions stay; the update() guard above also
    // keeps gameState entries flagged 'dead' from re-spawning fresh sprites.
    for (const id of Object.keys(this._sprites)) {
      if (this._sprites[id].isDead) this._destroySprite(id)
    }
  }
}
