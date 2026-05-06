// BuildMenuTooltip — pixel-styled hover panel for the BuildMenu slots.
//
// Shows name + cost (with affordability tint) + description + a small set
// of kind-specific key stats so the player knows what they're buying
// before they spend gold. Pops up adjacent to the hovered slot, clamped
// to stay inside the viewport. Hidden by default; show()/hide() are the
// only entry points the BuildMenu needs to call.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel } from './UIKit.js'
import { MINION_ABILITY_INFO } from '../systems/MinionAbilities.js'
import { Balance }              from '../config/balance.js'

const W = 270             // panel width (px, design-space)
const PAD = 10
const LINE = 12           // body line height
const HEAD_LINE = 14
const COST_GLYPH = '◆'

// Hover-tooltip summaries — kept in code so we don't have to touch the
// data files. Tooltip prefers `def.summary` if a future room/item ships
// one in JSON; otherwise it falls back to ROOM_SUMMARIES / ITEM_SUMMARIES
// here, then finally to `def.description`. Minion descriptions are
// suppressed entirely (their stats + ABILITY/BEHAVIOR sections cover it).
const ROOM_SUMMARIES = {
  entry_hall:           'Required entry point. Only one allowed.',
  starter_corridor:     'Connecting passage. Place between rooms to link them.',
  starter_barracks:     '+5 roster minion slots. Required for any patrolling minions.',
  starter_guard_post:   'Minions hunt adventurers in connected rooms, then return.',
  crypt:                'Garrison of 4 Risen Bones. Room-bound, refills nightly.',
  trap_factory:         '+5 trap slots. Required to place any traps.',
  treasury:             'Daily gold stipend + 4 lootable chests. Pulls more adventurers.',
  armory:               '+ATK to minions in connected rooms.',
  library_of_whispers:  "Reveals next party's intel the night before. Detail grows with boss level.",
  watchtower:           'Minions in connected rooms get a first-strike on entry.',
  wandering_gate:       'Entry chance to teleport adventurer to a random room.',
  veil_of_forgetting:   'Erases adventurer intel for connected rooms each night.',
  catacombs:            'Adventurers who die here rise as Tier-2 Revenants (max 2).',
  mimic_vault:          'Looks like a Treasury. 2 Mimics + 1 thieving false chest.',
  hall_of_trials:       "Garrisons one random Tier-2 minion. Doesn't respawn same day.",
  wishing_well:         "Coin flip on entry: buff or 'Marked' (+50% damage taken).",
  false_exit:           'Tricks fleeing adventurers — teleports them back inside.',
  hall_of_madness:      'Chance for adventurers to attack each other instead of moving.',
  throne_room:          'Garrisons 1 Mini-Boss that scales with boss level.',
  sanctum:              'Boss regenerates HP between fights. Connected minions regen too.',
}

const ITEM_SUMMARIES = {
  phylactery_heart:     'Spare life. Respawn while it lives — adventurers can destroy it.',
  door_lock:            'Locks a doorway. Requires a Key Chest placed nearby.',
  key_chest:            'Holds the key to a locked door. Refills daily.',
  soul_bound_beacon:    '+30% HP/ATK to minions in the room. Requires a Healing Fountain.',
  healing_fountain:     'Heals adventurers to full once per day. Tradeoff for the Beacon.',
  treasure_chest_1:     'T1. Pays 10g/day. Adventurers may steal 10% (10% tempted).',
  treasure_chest_2:     'T2. Pays 20g/day. Adventurers may steal 17% (14% tempted).',
  treasure_chest_3:     'T3. Pays 35g/day. Adventurers may steal 24% (19% tempted).',
  treasure_chest_4:     'T4. Pays 55g/day. Adventurers may steal 31% (23% tempted).',
  treasure_chest_5:     'T5. Pays 80g/day. Adventurers may steal 38% (28% tempted).',
  treasure_chest_6:     'T6. Pays 110g/day. Adventurers may steal 45% (32% tempted).',
  treasure_chest_7:     'T7. Pays 145g/day. Adventurers may steal 52% (37% tempted).',
  treasure_chest_8:     'T8. Pays 185g/day. Adventurers may steal 59% (41% tempted).',
  treasure_chest_9:     'T9. Pays 230g/day. Adventurers may steal 66% (46% tempted).',
  treasure_chest_10:    'T10. Pays 300g/day. Adventurers may steal 75% (50% tempted).',
}

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
    // Rooms with freeFirstN: first N placements are free, then base cost.
    if (kind === 'room') {
      const freeFirstN = def.placementRules?.freeFirstN ?? 0
      if (freeFirstN > 0) {
        const placed = (gameState?.dungeon?.rooms ?? []).filter(r => r.definitionId === def.id).length
        if (placed < freeFirstN) cost = 0
      }
    }
    // Mirror BuildMenu's hastyArchitect discount so the displayed cost
    // matches the actual debit on purchase.
    if (kind === 'trap' && (gameState?._mechanicFlags ?? {}).hastyArchitect) {
      cost = Math.max(0, Math.round(cost * 0.5))
    }
    // Minion costs scale with boss level (mirrors NightPhase + BuildMenu).
    if (kind === 'minion') {
      const bossLv = gameState?.boss?.level ?? 1
      const lvMul  = 1 + Balance.MINION_COST_PER_BOSS_LV * Math.max(0, bossLv - 1)
      cost = Math.max(0, Math.round(cost * lvMul))
    }
    return cost
  }

  _composeLines(def, kind, gameState) {
    const out = []
    // Minions skip description — their stat block + ABILITY/BEHAVIOR
    // sections cover what the player needs to know. Rooms and items
    // prefer a curated short summary (def.summary or the per-id maps
    // above) and only fall back to the full description as a last resort.
    if (kind !== 'minion') {
      let summary = def.summary?.trim()
      if (!summary) {
        if (kind === 'room') summary = ROOM_SUMMARIES[def.id]
        else if (kind === 'item') summary = ITEM_SUMMARIES[def.id]
      }
      const text = (summary && summary.trim()) || def.description?.trim()
      if (text) out.push({ text, wrap: true, color: CRYPT.inkDim })
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
