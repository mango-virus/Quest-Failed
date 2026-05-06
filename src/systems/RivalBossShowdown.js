// RivalBossShowdown — coordinates the special boss-vs-boss flow that fires
// when the Rival Dungeon event sends the rival boss into the player's
// chamber.
//
// Trigger: BOSS_FIGHT_INCOMING with adv._rivalBoss === true.
//
// On showdown start:
//   - Force every alive _monsterInvader adv (excluding the rival boss) to
//     FLEE so the player's minions can clean them up while the showdown
//     plays out alone in the chamber. Flavor: the squad scatters once
//     their boss enters the throne room.
//   - Stamp gameState._rivalShowdown = { active: true, advId } so other
//     systems can read it (e.g. for special chrome).
//   - Show "RIVAL BOSS APPROACHES" banner over the world camera.
//
// On rival-boss-died (player wins):
//   - Award +200 gold and force +1 boss level. Replaces the standard
//     adv-kill rewards (the AISystem._kill rival_boss branch defers to
//     this system instead of stacking 8× gold and 9× XP).
//   - Show "RIVAL BOSS DEFEATED" banner.
//   - Clear _rivalShowdown.
//
// On player-boss-loses-life (rival wins this round):
//   - Standard lose-a-life: BossSystem._endFight already handles draining
//     deathsRemaining, BOSS_FIGHT_RESOLVED firing, etc. We just clear
//     _rivalShowdown and let the normal flow proceed.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

const REWARD_GOLD = 200

export class RivalBossShowdown {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('BOSS_FIGHT_INCOMING', this._onBossFightIncoming)
    on('ADVENTURER_DIED',     this._onAdventurerDied)
    on('BOSS_FIGHT_RESOLVED', this._onBossFightResolved)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
  }

  isActive() {
    return !!this._gameState._rivalShowdown?.active
  }

  _onBossFightIncoming({ adventurer }) {
    if (!adventurer?._rivalBoss) return
    if (this.isActive()) return
    this._gameState._rivalShowdown = {
      active: true,
      advId:  adventurer.instanceId,
      startedAt: this._scene?.time?.now ?? 0,
    }
    this._squadFlee(adventurer.instanceId)
    this._showBanner(`RIVAL BOSS APPROACHES`, '#ff8866')
    EventBus.emit('RIVAL_BOSS_SHOWDOWN_BEGIN', { adventurer })
  }

  _onAdventurerDied({ adventurer }) {
    if (!adventurer?._rivalBoss) return
    if (!this.isActive()) return
    // Player won the showdown.
    this._applyVictoryRewards()
    this._showBanner(`RIVAL BOSS DEFEATED`, '#ffd966')
    this._gameState._rivalShowdown = null
    EventBus.emit('RIVAL_BOSS_SHOWDOWN_END', { winner: 'player' })
  }

  _onBossFightResolved({ winner }) {
    if (!this.isActive()) return
    // Rival boss survived AND drove the player's boss to lose this life
    // (BossSystem fires winner='party' when advs win the chamber). The
    // standard lose-a-life flow continues; we just close the showdown
    // state so the next fight isn't treated as a continuation.
    if (winner === 'party') {
      this._gameState._rivalShowdown = null
      EventBus.emit('RIVAL_BOSS_SHOWDOWN_END', { winner: 'rival' })
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _squadFlee(rivalAdvId) {
    const advs = this._gameState.adventurers?.active ?? []
    for (const a of advs) {
      if (!a._monsterInvader) continue
      if (a.instanceId === rivalAdvId) continue
      if (a.aiState === 'dead' || a.aiState === 'fleeing') continue
      a.goal    = { type: 'FLEE', reason: 'rival_squad_scatter' }
      a.path    = null
      a.aiState = 'fleeing'
    }
  }

  _applyVictoryRewards() {
    const player = this._gameState.player
    if (player) {
      player.gold = (player.gold ?? 0) + REWARD_GOLD
      EventBus.emit('RESOURCES_AWARDED', {
        gold:   REWARD_GOLD,
        reason: 'rival_boss_defeated',
      })
    }
    const boss = this._gameState.boss
    if (boss) {
      // Force a clean +1 level via the existing XP path. Top up exactly
      // enough XP to hit xpToNext, then the AISystem-style increment
      // logic naturally levels up. Doing it via XP (rather than direct
      // boss.level++) keeps BOSS_LEVELED_UP listeners + grid expansion
      // + minion rescaling firing the same way as a normal level.
      const need = Math.max(0, (boss.xpToNext ?? Balance.BOSS_XP_BASE) - (boss.xp ?? 0))
      boss.xp = (boss.xp ?? 0) + need
      while (boss.xp >= (boss.xpToNext ?? Balance.BOSS_XP_BASE)) {
        boss.xp -= boss.xpToNext
        boss.level = (boss.level ?? 1) + 1
        boss.xpToNext = this._xpToNextLevel(boss.level)
        EventBus.emit('BOSS_LEVELED_UP', { newLevel: boss.level, source: 'rival_boss_kill' })
        // Stop after one level even if leftover XP would chain-up.
        break
      }
    }
  }

  _xpToNextLevel(currentLevel) {
    const raw = Balance.BOSS_XP_BASE * Math.pow(Balance.BOSS_XP_SCALE, currentLevel - 1)
    return Math.ceil(raw / 10) * 10
  }

  _showBanner(text, color) {
    const cam = this._scene.cameras?.main
    if (!cam) return
    const cx = cam.midPoint.x
    const cy = cam.midPoint.y - 60
    const banner = this._scene.add.text(cx, cy, text, {
      fontSize: '28px', color, fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(125).setScrollFactor(0).setAlpha(0)
    this._scene.tweens.add({
      targets:  banner,
      alpha:    { from: 0, to: 1 },
      duration: 250,
      yoyo:     true,
      hold:     1100,
      onComplete: () => banner.destroy(),
    })
  }
}
