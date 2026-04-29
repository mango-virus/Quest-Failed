// Phase 9b — Dossier panel.
//
// Shown briefly at the start of each day with a card per spawning adventurer.
// Lists: name, class, personalities, prior-visit count (from
// gameState.adventurers.known), gear bonuses (returning shoppers), and
// active personality combos.
//
// Auto-dismisses after 5 seconds, or when the player clicks anywhere on the
// dossier overlay.  Informational only — the game keeps running.

import { PALETTE, glowPanel } from './UIKit.js'

const PANEL_W   = 220
const CARD_H    = 70
const SLIDE_MS  = 350
const HOLD_MS   = 4500

export class DossierPanel {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._objects = []
    this._dismissTimer = null
  }

  destroy() {
    this._dismissTimer?.remove(false)
    this._clear()
  }

  show(spawnedParty) {
    if (!Array.isArray(spawnedParty) || spawnedParty.length === 0) return
    this._clear()

    const W = this._scene.uiW
    const H = this._scene.uiH
    const px = W - PANEL_W - 16
    const py = 90
    const totalH = 28 + spawnedParty.length * (CARD_H + 8) + 8

    const bg = this._scene.add.graphics().setDepth(35)
    glowPanel(bg, px, py, PANEL_W, totalH, {
      fill: 0x080d18, border: 0xaaaaff, glow: 0x223366,
    })
    this._objects.push(bg)

    const heading = this._scene.add.text(px + 12, py + 8, "TODAY'S CALLERS", {
      fontSize: '10px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(36)
    this._objects.push(heading)

    let cy = py + 26
    for (const adv of spawnedParty) {
      this._renderCard(adv, px + 8, cy, PANEL_W - 16, CARD_H)
      cy += CARD_H + 8
    }

    // Click anywhere on the bg to dismiss early
    const hit = this._scene.add.rectangle(px + PANEL_W / 2, py + totalH / 2, PANEL_W, totalH, 0xffffff, 0)
      .setDepth(37).setInteractive({ useHandCursor: true })
    hit.on('pointerdown', () => this._clear())
    this._objects.push(hit)

    // Slide in from right
    for (const o of this._objects) {
      if (o.setAlpha) { o.alpha = 0; this._scene.tweens.add({ targets: o, alpha: 1, duration: SLIDE_MS }) }
    }

    this._dismissTimer = this._scene.time.delayedCall(HOLD_MS, () => this._clear())
  }

  _renderCard(adv, x, y, w, h) {
    const inner = this._scene.add.graphics().setDepth(36)
    glowPanel(inner, x, y, w, h, {
      fill: 0x0e1422, border: PALETTE.accent, glow: PALETTE.accentDim,
    })
    this._objects.push(inner)

    // Phase QW — Dossier ?-marks: first-time adventurers reveal little.
    // The boss's intel sources only know about adventurers they've met before.
    // visitCount drives a "reveal level":
    //   0 visits → name only, everything else is ???
    //   1 visit  → class + 1 personality tag visible
    //   2 visits → all personalities + class
    //   3+       → personalities, class, full stats
    // Returning leaders + vendetta hunters are always fully revealed
    // (we obviously know who they are).
    const known = (this._gameState.knowledge?.survivors ?? []).find(k => k.instanceId === adv.instanceId)
    const visitCount = (known?.runCount ?? 0)
    const fullyKnown = adv.flags?.returningVeteran || adv.flags?.vendettaMinionId || visitCount >= 3

    const heading = this._scene.add.text(x + 8, y + 6,
      `${adv.name ?? 'Unknown'}`, {
        fontSize: '10px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(37)
    this._objects.push(heading)

    const classText = (visitCount >= 1 || fullyKnown) ? (adv.classId ?? '???') : '???'
    const sub = this._scene.add.text(x + 8, y + 20,
      `${classText}${visitCount > 0 ? `  · seen ×${visitCount}` : '  · NEW'}` +
      (adv.flags?.shoppedBetweenRuns ? '  · shopped' : '') +
      (adv.flags?.vendettaMinionId ? '  · ★ AVENGER' : '') +
      (adv.flags?.guildRaid ? '  · ★ GUILD' : '') +
      (adv.isLegendary ? '  · ★ LEGENDARY' : ''), {
        fontSize: '8px', color: visitCount > 0 ? PALETTE.textGold : PALETTE.textNormal,
        fontFamily: 'monospace',
      }).setDepth(37)
    this._objects.push(sub)

    // Personality tags — masked until we've seen them at least once
    const personalitySystem = this._scene.personalitySystem
    const tags = personalitySystem?.getTags?.(adv) ?? new Set()
    let tagStr
    if (fullyKnown || visitCount >= 2) {
      tagStr = [...tags].slice(0, 4).join(', ') || '(plain)'
    } else if (visitCount >= 1) {
      // Reveal one tag, mask the rest
      const arr = [...tags]
      tagStr = arr.length > 0 ? `${arr[0]}, ???` : '???'
    } else {
      tagStr = '???'
    }
    const tagLine = this._scene.add.text(x + 8, y + 34, tagStr, {
      fontSize: '8px',
      color: (visitCount >= 1 || fullyKnown) ? PALETTE.textAccent : PALETTE.textDim,
      fontFamily: 'monospace',
      wordWrap: { width: w - 16 },
    }).setDepth(37)
    this._objects.push(tagLine)

    // Stats — only fully shown after multiple visits
    const hp  = (visitCount >= 2 || fullyKnown) ? (adv.resources?.maxHp ?? '?') : '??'
    const atk = (visitCount >= 2 || fullyKnown) ? (adv.stats?.attack ?? '?')   : '??'
    const stats = this._scene.add.text(x + 8, y + h - 14,
      `HP ${hp}  ATK ${atk}`, {
        fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(37)
    this._objects.push(stats)
  }

  _clear() {
    this._dismissTimer?.remove(false)
    this._dismissTimer = null
    for (const o of this._objects) o.destroy?.()
    this._objects = []
  }
}
