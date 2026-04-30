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

import { EventBus } from '../systems/EventBus.js'

const MINION_SCALE     = 1.0    // native — 64 → 64 px, 128 → 128 px (NEAREST keeps it crisp)
const PLACEHOLDER_SIZE = 18
const HURT_FLASH_MS    = 300
const ATTACK_FLASH_MS  = 400
const WALK_MIN_DELTA   = 0.15
const WALK_SAMPLE_MS   = 120

export class MinionRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}   // instanceId → sprite record (see _createSprite)

    const defs = scene.cache.json.get('minionTypes') ?? []
    this._defMap = Object.fromEntries(defs.map(d => [d.id, d]))

    EventBus.on('MINION_DIED',         this._onMinionDied,  this)
    EventBus.on('NIGHT_PHASE_STARTED', this._refreshAll,    this)
  }

  update() {
    const minions = this._gameState.minions ?? []
    const seen    = new Set()

    for (const m of minions) {
      seen.add(m.instanceId)
      let s = this._sprites[m.instanceId]
      if (!s) s = this._createSprite(m)
      if (!s) continue

      const now  = this._scene.time.now
      const curHp = m.resources?.hp ?? 0
      const isDead = m.aiState === 'dead' || curHp <= 0

      // Position
      s.container.setPosition(m.worldX, m.worldY)

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

      // Play anim if changed and registered.
      if (s.sprite) {
        const animKey = `minion-${m.definitionId}-${wantState}-${s.facing}`
        if (s.currentAnim !== animKey && this._scene.anims.exists(animKey)) {
          s.currentAnim = animKey
          s.sprite.play(animKey, true)
        }
      }

      // Visibility — spectral minions translucent; hidden mimics fully invisible;
      // dead minions hidden (death anim is loaded but the existing flow snaps
      // dead minions to alpha 0 immediately on death).
      let alpha = 1
      if (m.isSpectral) alpha = 0.55
      if (m.isMimic && m.hiddenAsLoot) alpha = 0
      s.container.setAlpha(isDead ? 0 : alpha)

      // HP bar
      const hpFrac = (m.resources?.maxHp ?? 0) > 0
        ? Math.max(0, curHp / m.resources.maxHp) : 0
      s.hp.width = Math.max(0, Math.round(hpFrac * s.hpBarW))

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
    }

    // Drop sprites whose minions are gone (e.g. unplaced via NightPhase removal).
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  destroy() {
    EventBus.off('MINION_DIED',         this._onMinionDied,  this)
    EventBus.off('NIGHT_PHASE_STARTED', this._refreshAll,    this)
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _createSprite(m) {
    const def     = this._defMap[m.definitionId]
    const idleKey = `minion-${m.definitionId}-idle`
    const hasSprite = def && this._scene.textures.exists(idleKey)
    return hasSprite ? this._createAnimatedSprite(m, def, idleKey)
                     : this._createPlaceholder(m)
  }

  _createAnimatedSprite(m, def, idleKey) {
    const s = this._scene
    const c = s.add.container(m.worldX, m.worldY).setDepth(7)

    const sprite = s.add.sprite(0, 0, idleKey, 0)
      .setOrigin(0.5)
      .setScale(MINION_SCALE)

    const fs          = def.frameSize ?? 64
    const displaySize = fs * MINION_SCALE
    const hpBarW      = Math.round(displaySize * 0.55)
    // HP bar sits just above the sprite's top edge (a few pixels of gap so
    // it reads clearly without feeling detached). Frame size varies by
    // minion (64 vs 128) so this auto-scales.
    const hpY         = -displaySize / 2 - 4

    const hpBg = s.add.rectangle(0,            hpY, hpBarW, 2, 0x220a06, 0.9).setOrigin(0.5)
    const hp   = s.add.rectangle(-hpBarW / 2,  hpY, hpBarW, 2, 0xcc4422, 1).setOrigin(0, 0.5)

    const lvLabel = s.add.text(displaySize / 2 - 1, displaySize / 2 - 2, '', {
      fontSize: '7px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(1, 1).setVisible(false)

    // Bounty star sits just above the HP bar.
    const bountyMark = s.add.text(0, hpY - 7, '★', {
      fontSize: '10px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false)

    c.add([sprite, hpBg, hp, lvLabel, bountyMark])

    // Hit area for click — sized to ~70% of the displayed sprite.
    const hitW = displaySize * 0.7, hitH = displaySize * 0.7
    c.setSize(hitW, hitH)
    c.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-hitW / 2, -hitH / 2, hitW, hitH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    })
    c.on('pointerdown', (pointer, x, y, event) => {
      event?.stopPropagation?.()
      EventBus.emit('MINION_CLICKED', { minion: m })
    })

    const rec = {
      container: c, sprite, body: null, hp, hpBg, hpBarW, lvLabel, bountyMark,
      facing: 'down', currentAnim: null,
      lastX: null, lastY: null, lastHp: null,
      sampleX: 0, sampleY: 0, sampleAt: 0, isMoving: false,
      hurtUntil: 0, _lastLv: null, _lastBounty: null, _lastTint: null,
    }
    this._sprites[m.instanceId] = rec
    return rec
  }

  _createPlaceholder(m) {
    const s = this._scene
    const SIZE = PLACEHOLDER_SIZE
    const c = s.add.container(m.worldX, m.worldY).setDepth(7)

    const body = s.add.rectangle(0, 0, SIZE, SIZE, 0x0a0e16, 1)
    body.setStrokeStyle(2, m.color, 1)

    const label = s.add.text(0, 0, m.sigil, {
      fontSize: '11px', color: '#e0e6f0', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)

    const hpBarW = SIZE
    // Placeholder path mirrors the sprite path: HP bar just above the body.
    const hpYP = -SIZE / 2 - 4
    const hpBg = s.add.rectangle(0,           hpYP, hpBarW, 2, 0x220a06, 0.9).setOrigin(0.5)
    const hp   = s.add.rectangle(-SIZE / 2,   hpYP, hpBarW, 2, 0xcc4422, 1).setOrigin(0, 0.5)

    const lvLabel = s.add.text(SIZE / 2 - 1, SIZE / 2 - 2, '', {
      fontSize: '7px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#0a0e16', strokeThickness: 2,
    }).setOrigin(1, 1).setVisible(false)

    const bountyMark = s.add.text(0, hpYP - 7, '★', {
      fontSize: '10px', color: '#ffcc44', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false)

    c.add([body, label, hpBg, hp, lvLabel, bountyMark])

    body.setInteractive({ useHandCursor: true })
    body.on('pointerdown', (pointer, x, y, event) => {
      event?.stopPropagation?.()
      EventBus.emit('MINION_CLICKED', { minion: m })
    })

    const rec = {
      container: c, sprite: null, body, hp, hpBg, hpBarW, lvLabel, bountyMark,
      facing: 'down', currentAnim: null,
      lastX: null, lastY: null, lastHp: null,
      sampleX: 0, sampleY: 0, sampleAt: 0, isMoving: false,
      hurtUntil: 0, _lastLv: null, _lastBounty: null, _lastStroke: null,
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

  _onMinionDied({ minion }) {
    const s = this._sprites[minion?.instanceId]
    if (s) s.container.setAlpha(0)
  }

  _refreshAll() {
    // Forces full refresh on next update tick — useful after respawn.
  }
}
