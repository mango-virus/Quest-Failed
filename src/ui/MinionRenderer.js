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

const MINION_SCALE     = 1.0    // native — 64 → 64 px, 128 → 128 px (NEAREST keeps it crisp)
const PLACEHOLDER_SIZE = 18
const HURT_FLASH_MS    = 300
const ATTACK_FLASH_MS  = 400
const WALK_MIN_DELTA   = 0.15
const WALK_SAMPLE_MS   = 120
const TS               = 32     // tile size — minion sprites are world-space, this matches Balance.TILE_SIZE
// Per-evolution-tier scale multipliers — each tier renders bigger.
// Indexed by chain position (tier 1 → tier 4).
const EVOLUTION_TIER_SCALE = [1.0, 1.2, 1.4, 1.6]

export class MinionRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}   // instanceId → sprite record (see _createSprite)

    const defs = scene.cache.json.get('minionTypes') ?? []
    this._defMap = Object.fromEntries(defs.map(d => [d.id, d]))
    // Evolution chain data — used to scale sprites by tier and to look up
    // animation prefixes when a final form uses a boss texture set.
    this._chains = scene.cache.json.get('minionEvolutions') ?? {}

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
    this._heldMinion = null
    this._onScenePointerDown = this._onScenePointerDown.bind(this)
    scene.input.on('pointerdown', this._onScenePointerDown)

    EventBus.on('MINION_DIED',         this._onMinionDied,  this)
    EventBus.on('NIGHT_PHASE_STARTED', this._refreshAll,    this)
  }

  update() {
    // While a minion is held, its world position tracks the cursor each
    // frame. Tile coords are kept in sync so the AI/render reads correctly
    // when the player drops them. AI itself is paused via _heldByPlayer.
    if (this._heldMinion) {
      const ptr = this._scene.input.activePointer
      this._heldMinion.worldX = ptr.worldX
      this._heldMinion.worldY = ptr.worldY
      this._heldMinion.tileX  = Math.floor(ptr.worldX / TS)
      this._heldMinion.tileY  = Math.floor(ptr.worldY / TS)
    }

    // Keep the hover label glued above the hovered minion.
    if (this._hoverMinion) {
      const def = this._defMap[this._hoverMinion.definitionId]
      const yOffset = ((def?.frameSize ?? PLACEHOLDER_SIZE) * MINION_SCALE) / 2 + 8
      this._hoverLabel.setPosition(this._hoverMinion.worldX, this._hoverMinion.worldY - yOffset)
    }

    const minions = this._gameState.minions ?? []
    const seen    = new Set()

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
      // until dropped.
      s.container.setPosition(m.worldX, m.worldY)
      if (!m._heldByPlayer) s.container.setDepth(7 + m.worldY * 0.0005)

      // Mimic Vault chest disguise — render as a wooden chest until the
      // mimic reveals. Sprite + HP + level + bounty all hidden while in
      // chest state. Bite-on-reveal flips state in RoomBehaviorSystem.
      if (m.isMimic && m.mimicState === 'chest') {
        if (s.sprite) s.sprite.setVisible(false)
        s.body?.setVisible?.(false)
        s.hp?.setVisible?.(false)
        s.hpBg?.setVisible?.(false)
        s.lvLabel?.setVisible?.(false)
        s.bountyMark?.setVisible?.(false)
        if (!s.chestOverlay) {
          const cg = this._scene.add.graphics()
          // Box body
          cg.fillStyle(0x6b3a1a, 1)
          cg.fillRect(-10, -8, 20, 14)
          cg.lineStyle(1, 0x3a1d0a, 1)
          cg.strokeRect(-10, -8, 20, 14)
          // Lid seam
          cg.fillStyle(0x3a1d0a, 1)
          cg.fillRect(-10, -3, 20, 1)
          // Gold trim corners
          cg.fillStyle(0xe8c34a, 1)
          cg.fillRect(-10, -8, 2, 2)
          cg.fillRect( 8, -8, 2, 2)
          cg.fillRect(-10,  4, 2, 2)
          cg.fillRect( 8,  4, 2, 2)
          // Lock
          cg.fillStyle(0xe8c34a, 1)
          cg.fillRect(-2, -2, 4, 4)
          cg.fillStyle(0x000000, 1)
          cg.fillRect(-1, -1, 2, 2)
          s.container.add(cg)
          s.chestOverlay = cg
        }
        s.chestOverlay.setVisible(true)
        s.lastX = m.worldX; s.lastY = m.worldY; s.lastHp = curHp
        continue   // skip the rest of the per-frame update for chest mimics
      } else if (s.chestOverlay) {
        s.chestOverlay.setVisible(false)
        // Restore the normal sprite/body visibility so the revealed mimic renders.
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

      // Attack — short flash window after CombatSystem stamps lastAttackAt.
      const recentAttack = (now - (m.lastAttackAt ?? 0)) < ATTACK_FLASH_MS

      // Pick state — same priority order as BossRenderer.
      const wantState =
        isDead             ? 'death' :
        now < s.hurtUntil  ? 'hurt'  :
        recentAttack       ? 'attack':
        (m.aiState === 'engaging' && s.isMoving) ? 'run' :
        s.isMoving         ? 'walk'  :
                             'idle'

      // Play anim if changed and registered. Final-form minions that reuse
      // a boss texture set use the boss anim prefix (bossSkinId-state-dir);
      // everyone else uses the standard minion-defId-state-dir prefix.
      if (s.sprite) {
        const def = this._defMap[m.definitionId]
        const prefix = def?.bossSkinId ? def.bossSkinId : `minion-${m.definitionId}`
        const animKey = `${prefix}-${wantState}-${s.facing}`
        if (s.currentAnim !== animKey && this._scene.anims.exists(animKey)) {
          s.currentAnim = animKey
          s.sprite.play(animKey, true)
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
      const tx = (m.worldX / TS) | 0
      const ty = (m.worldY / TS) | 0
      if (this._scene._dungeonRenderer?.isDoorwayShadowCell(tx, ty)) alpha *= 0.55
      s.container.setAlpha(alpha)

      // HP bars hidden for minions per user request — bar+bg are still
      // created (so any other code that pokes `s.hp` still works) but the
      // per-tick width update is skipped and they're set invisible at
      // creation time. To restore: remove the setVisible(false) calls in
      // _createSprite + _createPlaceholderSprite and uncomment the line:
      // s.hp.width = Math.max(0, Math.round(((m.resources?.maxHp ?? 0) > 0 ? curHp / m.resources.maxHp : 0) * s.hpBarW))

      // Faction-flip stroke colour (defected minions get a green outline).
      // Only meaningful on the placeholder rect; sprite-rendered minions
      // wear faction via tint instead.
      const expectedStroke = m.faction === 'adventurer' ? 0x33cc77 : m.color
      if (s.body && s._lastStroke !== expectedStroke) {
        s.body.setStrokeStyle(2, expectedStroke, 1)
        s._lastStroke = expectedStroke
      }
      if (s.sprite) {
        const expectedTint = m.faction === 'adventurer' ? 0x88ff99 : 0xffffff
        if (s._lastTint !== expectedTint) {
          s.sprite.setTint(expectedTint)
          s._lastTint = expectedTint
        }
      }

      // Level badge + bounty mark
      const lv = m.level ?? 1
      if (lv >= 2 && s._lastLv !== lv) {
        s.lvLabel.setText(`L${lv}`).setVisible(true)
        s._lastLv = lv
      } else if (lv < 2 && s._lastLv !== lv) {
        s.lvLabel.setVisible(false)
        s._lastLv = lv
      }
      if (m.hasBounty !== s._lastBounty) {
        s.bountyMark.setVisible(!!m.hasBounty)
        s._lastBounty = !!m.hasBounty
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

    // Drop sprites whose minions are gone (e.g. unplaced via NightPhase removal).
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  destroy() {
    EventBus.off('MINION_DIED',         this._onMinionDied,  this)
    EventBus.off('NIGHT_PHASE_STARTED', this._refreshAll,    this)
    this._scene?.input?.off?.('pointerdown', this._onScenePointerDown)
    this._hoverLabel?.destroy()
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
  // the scene-level handler from also firing. Skipped entirely when the
  // NightPhase palette has a minion type selected for placement — that
  // click is meant to place a new minion, not pick up an existing one.
  _handleMinionClick(m, pointer) {
    if (this._isPlacingMinion()) return
    if (this._heldMinion === m) {
      this._dropMinion(pointer.worldX, pointer.worldY)
    } else if (!this._heldMinion) {
      this._beginPickup(m)
    }
  }

  // Returns true when the NightPhase scene has a minion type queued in its
  // placement palette. Cached `scene.get('NightPhase')` is cheap.
  _isPlacingMinion() {
    const np = this._scene?.scene?.get?.('NightPhase')
    return !!(np && np._selectedKind === 'minion' && np._selected)
  }

  _beginPickup(m) {
    this._heldMinion = m
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
    if (!row || !PathfinderSystem.isWalkable(row[tileX])) return
    // Boss chamber is off-limits — minions can't be parked on the boss
    // floor (matches _validateMinionPlacement for fresh placements).
    const dropRoom = this._scene.dungeonGrid?.getRoomAtTile?.(tileX, tileY)
    if (dropRoom?.definitionId === 'boss_chamber') return

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
    this._playPickupDropSfx()
    EventBus.emit('MINION_PLACED', { minion: m })
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
    const def     = this._defMap[m.definitionId]
    const idleKey = this._idleTextureKey(def, m.definitionId)
    const hasSprite = def && idleKey && this._scene.textures.exists(idleKey)
    const rec = hasSprite ? this._createAnimatedSprite(m, def, idleKey)
                          : this._createPlaceholder(m)
    if (rec) rec._lastDefId = m.definitionId
    return rec
  }

  // Texture key for the idle frame — boss-skin finals use the boss texture
  // set (`${bossSkinId}-idle`), everyone else uses `minion-${defId}-idle`.
  _idleTextureKey(def, defId) {
    if (def?.bossSkinId) return `${def.bossSkinId}-idle`
    return `minion-${defId}-idle`
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
    s.sprite.setScale(MINION_SCALE * tierScale)
    s.currentAnim = null   // force play() with the new prefix next tick
  }

  _createAnimatedSprite(m, def, idleKey) {
    const s = this._scene
    // Depth 7 — below the dungeon overhead (9) and doors (9.5) so the
    // minion walks UNDER wall caps + closed doors, matching the design
    // intent (capstones / wall tops should hide entities behind them).
    const c = s.add.container(m.worldX, m.worldY).setDepth(7)

    const tierScale = this._tierScaleFor(m.definitionId)
    const sprite = s.add.sprite(0, 0, idleKey, 0)
      .setOrigin(0.5)
      .setScale(MINION_SCALE * tierScale)

    const fs          = def.frameSize ?? 64
    const displaySize = fs * MINION_SCALE
    const hpBarW      = Math.round(displaySize * 0.55)
    // HP bar sits just above the sprite's top edge (a few pixels of gap so
    // it reads clearly without feeling detached). Frame size varies by
    // minion (64 vs 128) so the base auto-scales.
    //
    // Per-minion tuning: if `def.hpBarYOffset` is set in minionTypes.json
    // it nudges the bar Y. Positive values move it DOWN (use this when a
    // sprite's art only fills the bottom of its frame, like the
    // plant/mushroom/coconut minions where the default would float far
    // above the visible character).
    const hpY         = -displaySize / 2 - 4 + (def.hpBarYOffset ?? 0)

    const hpBg = s.add.rectangle(0,            hpY, hpBarW, 2, 0x220a06, 0.9).setOrigin(0.5).setVisible(false)
    const hp   = s.add.rectangle(-hpBarW / 2,  hpY, hpBarW, 2, 0xcc4422, 1).setOrigin(0, 0.5).setVisible(false)

    const lvLabel = s.add.text(displaySize / 2 - 1, displaySize / 2 - 2, '', {
      fontSize: '7px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(1, 1).setVisible(false)

    // Bounty star sits just above the HP bar.
    const bountyMark = s.add.text(0, hpY - 7, '★', {
      fontSize: '10px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false)

    // Phase 1b.1 — Orc Loot the Fallen badge. Bottom-left of the sprite,
    // mirroring lvLabel's bottom-right placement. Hidden until lootAtkBonus > 0
    // AND the active boss is the orc archetype (toggled in the tick loop).
    const lootBadge = s.add.text(-displaySize / 2 + 1, displaySize / 2 - 2, '', {
      fontSize: '7px', color: '#ff8855', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(0, 1).setVisible(false)

    c.add([sprite, hpBg, hp, lvLabel, bountyMark, lootBadge])

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
      container: c, sprite, body: null, hp, hpBg, hpBarW, lvLabel, bountyMark, lootBadge,
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

    const lvLabel = s.add.text(SIZE / 2 - 1, SIZE / 2 - 2, '', {
      fontSize: '7px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(1, 1).setVisible(false)

    const bountyMark = s.add.text(0, hpYP - 7, '★', {
      fontSize: '10px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false)

    // Phase 1b.1 — Orc Loot the Fallen badge (placeholder path mirrors sprite path).
    const lootBadge = s.add.text(-SIZE / 2 + 1, SIZE / 2 - 2, '', {
      fontSize: '7px', color: '#ff8855', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(0, 1).setVisible(false)

    c.add([body, label, hpBg, hp, lvLabel, bountyMark, lootBadge])

    // Placeholder has no texture for pixel-perfect — use the body's default
    // rectangle bounds (matches the visible square). Marker
    // `_isMinionInteractive` lets NightPhase skip room-pickup on this click.
    body.setInteractive({ useHandCursor: true })
    body._isMinionInteractive = true
    body.on('pointerover', () => this._showHoverLabel(m))
    body.on('pointerout',  () => this._hideHoverLabel(m))
    body.on('pointerdown', (pointer, x, y, event) => {
      event?.stopPropagation?.()
      pointer._consumedByMinion = true
      // Right-click no longer sells — selling is sell-button-only now.
      if (pointer.rightButtonDown()) return
      this._handleMinionClick(m, pointer)
    })

    const rec = {
      container: c, sprite: null, body, hp, hpBg, hpBarW, lvLabel, bountyMark, lootBadge,
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
    s.container.destroy()
    delete this._sprites[id]
  }

  _onMinionDied(_evt) {
    // No-op — death anim plays in update() and freezes on its last frame.
    // The sprite is parked at its death position until NIGHT_PHASE_STARTED.
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
