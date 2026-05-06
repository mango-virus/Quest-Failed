// BuildMenuTooltip — pixel-styled hover panel for the BuildMenu slots.
//
// Shows name + cost (with affordability tint) + description + a small set
// of kind-specific key stats so the player knows what they're buying
// before they spend gold. Pops up adjacent to the hovered slot, clamped
// to stay inside the viewport. Hidden by default; show()/hide() are the
// only entry points the BuildMenu needs to call.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel } from './UIKit.js'
import { MINION_ABILITY_INFO } from '../systems/MinionAbilities.js'

const W = 270             // panel width (px, design-space)
const PAD = 10
const LINE = 12           // body line height
const HEAD_LINE = 14
const COST_GLYPH = '◆'

export class BuildMenuTooltip {
  constructor(scene, opts = {}) {
    this._scene = scene
    this._depth = opts.depth ?? 200    // above everything in the HUD
    this._objects = []                  // child Phaser objects (text + graphics)
    this._visible = false
    this._currentKey = null             // for de-duping pointerover spam
  }

  // Show the tooltip for `def`. `anchor` is the slot's screen rect:
  // { x, y, w, h } in design-space coords. The tooltip prefers to sit
  // immediately to the right of the slot; if that would clip off-screen,
  // it falls back to the left side.
  show(def, kind, anchor, gameState) {
    if (!def) return
    const key = `${kind}:${def.id}`
    if (this._visible && this._currentKey === key) return
    this._currentKey = key
    this.hide()
    this._visible = true

    const lines = this._composeLines(def, kind, gameState)
    const D = this._depth

    // Build all text objects up-front at (0,0) so we can measure their
    // real rendered height — wrapped description text spans multiple
    // visual lines and a flat lines.length * LINE estimate clips it.
    const built = []
    let bodyH = 0
    for (const line of lines) {
      const t = this._scene.add.text(0, 0, line.text, {
        fontFamily: line.head ? FONT_HEAD : FONT_BODY,
        fontSize:   line.head ? '7px'    : '9px',
        color:      line.color ?? CRYPT.ink,
        letterSpacing: 1,
        wordWrap: line.wrap ? { width: W - PAD * 2, useAdvancedWrap: true } : undefined,
      }).setDepth(D + 2).setVisible(false)
      // Empty rows ({ text: '' }) act as a small spacer.
      const measured = line.text === '' ? Math.round(LINE / 2)
                                        : Math.max(LINE, Math.ceil(t.height) + 2)
      built.push({ t, h: measured })
      bodyH += measured
    }

    const h = PAD + HEAD_LINE + 6 + bodyH + PAD

    // Position: prefer right of slot, else left, clamped to design rect.
    const designW = this._scene.uiW ?? this._scene.scale.width  ?? 1280
    const designH = this._scene.uiH ?? this._scene.scale.height ?? 720
    let x = anchor.x + anchor.w + 8
    if (x + W > designW - 8) x = anchor.x - W - 8
    if (x < 8) x = 8
    let y = anchor.y
    if (y + h > designH - 8) y = designH - 8 - h
    if (y < 8) y = 8

    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, x, y, W, h, {
      fill: CRYPT.bgStone1, edgeH: CRYPT.accent2, edgeS: CRYPT.panelEdgeS,
    })
    this._objects.push(bg)

    // Header strip — name on the left, cost on the right.
    const headStrip = this._scene.add.graphics().setDepth(D + 1)
    headStrip.fillStyle(CRYPT.panel2, 1)
    headStrip.fillRect(x + 2, y + 2, W - 4, HEAD_LINE + 6)
    headStrip.fillStyle(CRYPT.panelEdgeS, 1)
    headStrip.fillRect(x + 2, y + 2 + HEAD_LINE + 6, W - 4, 1)
    this._objects.push(headStrip)

    const name = String(def.name ?? def.id ?? '?').toUpperCase()
    this._objects.push(this._scene.add.text(x + PAD, y + PAD, name, {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
    }).setOrigin(0, 0).setDepth(D + 2))

    const cost = this._costFor(def, kind, gameState)
    if (cost != null) {
      const affordable = cost <= (gameState?.player?.gold ?? 0)
      const color = affordable ? CRYPT.goldCss : CRYPT.accent2Css
      // Coin icon + number, right-aligned to the cost-row's right edge.
      // Icon swaps to gold-coins for prices > 20.
      const coinKey = (cost > 20) ? 'ui-gold-coins' : 'ui-coin'
      const ICON_H  = 12
      const numT = this._scene.add.text(0, 0, String(cost), {
        fontFamily: FONT_HEAD, fontSize: '9px', color, letterSpacing: 1,
      }).setDepth(D + 2)
      const numW = numT.width
      const rightX = x + W - PAD
      const topY   = y + PAD
      let iconW = 0, iconObj = null
      if (this._scene.textures.exists(coinKey)) {
        iconObj = this._scene.add.image(0, 0, coinKey).setDepth(D + 2)
        const tex = this._scene.textures.get(coinKey).getSourceImage()
        iconW = (tex?.width ?? ICON_H) * (ICON_H / (tex?.height ?? ICON_H))
        iconObj.setDisplaySize(iconW, ICON_H)
      } else {
        // Fallback glyph if coin texture isn't loaded.
        iconObj = this._scene.add.text(0, 0, COST_GLYPH, {
          fontFamily: FONT_HEAD, fontSize: '9px', color, letterSpacing: 1,
        }).setDepth(D + 2)
        iconW = iconObj.width
      }
      const ICON_GAP = 3
      // Right-align the group: icon flush right, number to the left of icon.
      iconObj.setOrigin(1, 0).setPosition(rightX, topY)
      numT.setOrigin(1, 0).setPosition(rightX - iconW - ICON_GAP, topY)
      this._objects.push(numT)
      this._objects.push(iconObj)
    }

    // Place pre-built body text objects now that we know x/y.
    let cy = y + PAD + HEAD_LINE + 8
    for (const { t, h: lineH } of built) {
      t.setPosition(x + PAD, cy).setVisible(true)
      this._objects.push(t)
      cy += lineH
    }
  }

  hide() {
    if (!this._visible) return
    this._visible = false
    this._currentKey = null
    for (const o of this._objects) o?.destroy?.()
    this._objects = []
  }

  destroy() {
    this.hide()
  }

  // ─── Composition ──────────────────────────────────────────────────────
  _costFor(def, kind, gameState) {
    let cost = def.cost ?? def.goldCost ?? null
    if (cost == null) return null
    // Mirror BuildMenu's hastyArchitect discount so the displayed cost
    // matches the actual debit on purchase.
    if (kind === 'trap' && (gameState?._mechanicFlags ?? {}).hastyArchitect) {
      cost = Math.max(0, Math.round(cost * 0.5))
    }
    return cost
  }

  _composeLines(def, kind, gameState) {
    const out = []
    const desc = def.description?.trim()
    if (desc) {
      out.push({ text: desc, wrap: true, color: CRYPT.inkDim })
    }

    const stats = []
    if (kind === 'room') {
      if (def.width && def.height) stats.push(['SIZE', `${def.width}×${def.height}`])
      if (def.category)            stats.push(['CATEGORY', String(def.category).toUpperCase()])
      const cap = def.placementRules?.maxPerDungeon
      if (cap)                     stats.push(['MAX/DUNGEON', String(cap)])
    } else if (kind === 'minion') {
      const b = def.baseStats ?? {}
      if (b.hp      != null) stats.push(['HP',  String(b.hp)])
      if (b.attack  != null) stats.push(['ATK', String(b.attack)])
      if (b.defense != null) stats.push(['DEF', String(b.defense)])
      if (b.speed   != null) stats.push(['SPD', String(b.speed)])
      if (b.damageType)      stats.push(['DMG', String(b.damageType).toUpperCase()])
      if (Array.isArray(b.abilities) && b.abilities.length) {
        stats.push(['ABILITIES', b.abilities.map(a => String(a).toUpperCase()).join(', ')])
      }
    } else if (kind === 'trap') {
      const b = def.baseStats ?? {}
      if (b.damage  != null) stats.push(['DMG',  String(b.damage)])
      if (b.uses    != null) stats.push(['USES', String(b.uses)])
      if (def.category)      stats.push(['TYPE', String(def.category).toUpperCase()])
    } else if (kind === 'item') {
      const b = def.baseStats ?? {}
      if (b.hp      != null) stats.push(['HP',  String(b.hp)])
      if (b.defense != null) stats.push(['DEF', String(b.defense)])
      if (def.archetypeRestriction) {
        stats.push(['BOSS ONLY', String(def.archetypeRestriction).toUpperCase()])
      }
      if (def.maxPerDungeon) stats.push(['MAX/DUNGEON', String(def.maxPerDungeon)])
    }

    if (stats.length) {
      if (out.length) out.push({ text: '', head: true })   // small gap
      for (const [label, value] of stats) {
        out.push({ text: `${label}  ${value}`, head: true, color: CRYPT.accent2Css })
      }
    }

    // Per-minion ability + behavior summary (Pass 1-3 minion identities).
    if (kind === 'minion') {
      const info = MINION_ABILITY_INFO[def.id]
      if (info?.ability || info?.behavior) {
        out.push({ text: '', head: true })
        if (info.ability) {
          out.push({ text: 'ABILITY',  head: true, color: CRYPT.goldCss })
          out.push({ text: info.ability,  wrap: true, color: CRYPT.ink })
        }
        if (info.behavior) {
          out.push({ text: 'BEHAVIOR', head: true, color: CRYPT.goldCss })
          out.push({ text: info.behavior, wrap: true, color: CRYPT.ink })
        }
      }
    }

    if (def.unlockLevel && def.unlockLevel > 1) {
      out.push({ text: `UNLOCKS LV ${def.unlockLevel}`, head: true, color: CRYPT.inkMute })
    }

    return out
  }
}
