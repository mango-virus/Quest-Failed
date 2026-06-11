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
function _displayScaleFor(m) {
  return (typeof m?._mbDisplayScale === 'number') ? m._mbDisplayScale : 1.0
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

// Duration of the sell "shadow-swallow" animation (ms) — the death anim
// plays while the minion sinks into an opening shadow pool, then both go.
const SELL_SWALLOW_MS = 650

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
      const yOffset = ((def?.frameSize ?? PLACEHOLDER_SIZE) * MINION_SCALE) / 2 + 8
      this._hoverLabel.setPosition(this._hoverMinion.worldX, this._hoverMinion.worldY - yOffset)
    }

    const minions = this._gameState.minions ?? []
    const seen    = new Set()

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
      // VFX Lab — pin a facing direction for sprite review.
      if (m._vfxLabFacing) s.facing = m._vfxLabFacing
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
      if (s.sprite) {
        const resolved = this._resolveAnimKey(prefix, wantState, s.facing)
        if (resolved && s.currentAnim !== resolved) {
          s.currentAnim = resolved
          s.sprite.play(resolved, true)
        }
      }

      // Visibility — spectral minions translucent; hidden mimics fully invisible.
      // Dead minions stay visible at their last frame as corpses until
      // NIGHT_PHASE_STARTED clears them. Doorway shadow dim: standing on a
      // doorway INNER (threshold) cell multiplies alpha by 0.55 to sell
      // stepping into the underpass shadow.
      let alpha = 1
      if (m.isSpectral) alpha = 0.55
      // Phase 1b.6 — Lizardman Camouflage: player can see camouflaged minions
      // but they're translucent so the camo state reads at a glance.
      if (m._camouflaged) alpha *= 0.5
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
      s.container.setAlpha(alpha)

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
    const dispScale = _displayScaleFor(m)
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
    const dispScale = _displayScaleFor(m)
    const sprite = s.add.sprite(0, 0, idleKey, 0)
      .setOrigin(0.5)
      .setScale(baseScale * tierScale * dispScale)

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
    s.sellPool?.destroy()
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

  // ── Sell shadow-swallow ─────────────────────────────────────────────────
  // The player sold this minion. Play its death animation and open a
  // shadow pool beneath it; _tickSelling sinks the sprite into the pool and
  // destroys it when the swallow completes. Fired by NightPhase BEFORE the
  // minion is spliced from gameState, so the sprite record is still live.
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
    // Shadow pool that opens beneath the minion, then closes over it.
    const baseX = s.container.x
    const baseY = s.container.y
    s.sellPool = this._scene.add.ellipse(baseX, baseY + 6, 42, 19, 0x080410, 0.92)
      .setDepth(1.5).setScale(0)
    s.selling = { startedAt: this._scene.time.now, baseX, baseY }
  }

  // Advance every sprite mid sell-swallow: open the shadow pool, sink the
  // minion into it with a fade, then destroy sprite + pool when done.
  _tickSelling(now) {
    for (const id of Object.keys(this._sprites)) {
      const s = this._sprites[id]
      if (!s?.selling) continue
      const t = Math.min(1, (now - s.selling.startedAt) / SELL_SWALLOW_MS)
      // Pool opens fast (t 0→0.3), holds, then closes shut (t 0.65→1).
      if (s.sellPool) {
        const open  = Math.min(1, t / 0.3)
        const close = t > 0.65 ? (t - 0.65) / 0.35 : 0
        s.sellPool.setScale(Math.max(0, open - close))
      }
      // Minion sinks into the pool and fades once it has opened.
      const sink = t > 0.25 ? (t - 0.25) / 0.75 : 0
      s.container.y = s.selling.baseY + sink * 16
      s.container.setAlpha(1 - sink)
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
