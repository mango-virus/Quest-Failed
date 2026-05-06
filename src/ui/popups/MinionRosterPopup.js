// Phase 31E — Minion Roster popup.
//
// Two-column: sortable list (left) with name / class / HP bar / level /
// kills, and a detail pane (right) showing the selected minion's
// portrait, class, name, assigned room, HP, kills/dmg/armor/speed,
// traits. Information-only — no Summon / Heal / Reassign / Dismiss
// actions per design.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelBar, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'

const ROW_H = 28

export class MinionRosterPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sortKey   = 'kills'  // 'name' | 'class' | 'hp' | 'level' | 'kills'
    this._selectedId = null
    this._frame = makePopupFrame({
      scene,
      w:    980,
      h:    580,
      title:'MINION ROSTER',
      depth: 200,
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  open() {
    if (!this._selectedId) {
      const sortedNow = this._sortedMinions()
      this._selectedId = sortedNow[0]?.instanceId ?? null
    }
    this._frame.open()
  }
  close() { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 205
    const listW = 580
    const gap   = 16
    this._renderList(cx, cy, listW, ch, D, addChild)
    this._renderDetail(cx + listW + gap, cy, cw - listW - gap, ch, D, addChild)
  }

  _sortedMinions() {
    const list = (this._gameState.minions ?? []).slice()
    list.sort((a, b) => {
      switch (this._sortKey) {
        case 'name':  return (a.name ?? a.definitionId).localeCompare(b.name ?? b.definitionId)
        case 'tier':  return this._tierFor(b) - this._tierFor(a)
        case 'hp':    return (b.resources?.hp ?? 0) - (a.resources?.hp ?? 0)
        case 'level': return (b.level ?? 0) - (a.level ?? 0)
        case 'kills':
        default:      return (b.lifetime?.kills ?? 0) - (a.lifetime?.kills ?? 0)
      }
    })
    return list
  }

  // Evolution tier: parsed from the trailing digit of the def id. Falls
  // back to 1 if the id has no digit (e.g., 'mimic'). Tiers cap at 4 in
  // the current minionEvolutions chains.
  _tierFor(m) {
    const id = m.definitionId ?? ''
    const match = id.match(/(\d+)$/)
    return match ? parseInt(match[1], 10) : 1
  }

  _renderList(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)

    // Column headers — also act as sort buttons. 'TIER' replaces the old
    // 'CLASS' column and shows each minion's evolution tier (1-4) parsed
    // from the trailing digit of the definition id (skeleton1 -> 1,
    // skeleton2 -> 2, etc.).
    const cols = [
      { key: 'name',  label: 'NAME',  x: 14,    w: 120 },
      { key: 'tier',  label: 'TIER',  x: 138,  w: 80  },
      { key: 'hp',    label: 'HP',    x: 230,  w: 140 },
      { key: 'level', label: 'LV',    x: 380,  w: 30  },
      { key: 'kills', label: 'KILLS', x: 422,  w: 60  },
    ]
    const headerY = y + 12
    for (const col of cols) {
      const isActive = col.key === this._sortKey
      const t = this._scene.add.text(x + col.x, headerY, col.label, {
        fontFamily: FONT_HEAD, fontSize: '8px',
        color: isActive ? CRYPT.accent2Css : CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0, 0.5).setDepth(D + 2)
      addChild(t)
      // Hit zone for sort
      const hit = this._scene.add.zone(x + col.x - 4, headerY - 8, col.w, 16)
        .setOrigin(0).setDepth(D + 3).setInteractive({ useHandCursor: true })
      hit.on('pointerup', () => {
        this._sortKey = col.key
        this.close()
        this.open()
      })
      addChild(hit)
    }

    // Header rule
    const rule = this._scene.add.graphics().setDepth(D + 1)
    rule.fillStyle(CRYPT.panelEdgeS, 1)
    rule.fillRect(x + 8, headerY + 12, w - 16, 1)
    addChild(rule)

    // Rows
    const rowsY = headerY + 22
    const minions = this._sortedMinions()
    if (minions.length === 0) {
      addChild(this._scene.add.text(x + w / 2, y + h / 2, '— NO MINIONS PLACED —', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      return
    }
    const visibleH = h - (rowsY - y) - 8
    const visibleRows = Math.floor(visibleH / ROW_H)
    minions.slice(0, visibleRows).forEach((m, i) => {
      const ry = rowsY + i * ROW_H
      this._renderRow(m, x, ry, w, ROW_H - 2, cols, D, addChild)
    })
  }

  _renderRow(m, x, y, w, h, cols, D, addChild) {
    const isSelected = m.instanceId === this._selectedId
    const rowG = this._scene.add.graphics().setDepth(D + 1)
    rowG.fillStyle(isSelected ? CRYPT.bgStone3 : CRYPT.bgStone2, 1)
    rowG.fillRect(x + 8, y, w - 16, h)
    if (isSelected) {
      rowG.lineStyle(1, CRYPT.accent2, 1)
      rowG.strokeRect(x + 8, y, w - 16, h)
    }
    addChild(rowG)

    const def = this._minionDef(m.definitionId)
    const name = m.name ?? def?.name ?? m.definitionId ?? '?'
    const tier = this._tierFor(m)
    const hp   = m.resources?.hp ?? 0
    const max  = m.resources?.maxHp ?? 1

    addChild(this._scene.add.text(x + cols[0].x, y + h / 2, this._truncate(name, 14), {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(D + 3))
    // Tier rendered as 'T{N}' in gold so it reads as a rank (matches the
    // 'L{N}' unlock badge styling on locked build slots).
    addChild(this._scene.add.text(x + cols[1].x, y + h / 2, `T${tier}`, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.goldCss, letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(D + 3))
    const bar = pixelBar(this._scene, x + cols[2].x, y + h / 2 - 5, cols[2].w, 10, hp, max,
      { color: m.aiState === 'dead' ? 'red' : 'cyan',
        label: `${hp}/${max}`, depth: D + 3, fontSize: 7 })
    addChild(bar.g, bar.txt)
    addChild(this._scene.add.text(x + cols[3].x, y + h / 2, String(m.level ?? 1), {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(D + 3))
    addChild(this._scene.add.text(x + cols[4].x, y + h / 2, String(m.lifetime?.kills ?? 0), {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.accent2Css, letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(D + 3))

    // Click row → select
    const hit = this._scene.add.zone(x + 8, y, w - 16, h)
      .setOrigin(0).setDepth(D + 4).setInteractive({ useHandCursor: true })
    hit.on('pointerup', () => {
      this._selectedId = m.instanceId
      this.close()
      this.open()
    })
    addChild(hit)
  }

  _renderDetail(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)

    const m = (this._gameState.minions ?? []).find(x => x.instanceId === this._selectedId)
    if (!m) {
      addChild(this._scene.add.text(x + w / 2, y + h / 2, '— SELECT A MINION —', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      return
    }
    const def = this._minionDef(m.definitionId)

    // Portrait box — mirrors BossOverviewPopup's portrait pattern: an
    // inset panel with the minion's looping idle-down animation playing
    // inside it. Falls back to the giant sigil letter if a sprite sheet
    // for this minion id isn't loaded (legacy save w/ removed minion).
    const pxBox = 140
    const boxX  = x + (w - pxBox) / 2
    const boxY  = y + 14
    const portraitG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(portraitG, boxX, boxY, pxBox, pxBox, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(portraitG)

    const idleKey = `minion-${m.definitionId}-idle`
    if (this._scene.textures.exists(idleKey)) {
      const cxImg = boxX + pxBox / 2
      const cyImg = boxY + pxBox / 2
      const sprite = this._scene.add.sprite(cxImg, cyImg, idleKey, 0).setDepth(D + 2)
      sprite.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
      // Most minion sheets ship at 64 px content; 128-frame sheets
      // (demon/golem/ent/elder_slime/rat) centre a ~64-px character
      // with transparent padding. Treat both as 64-px content for
      // scaling math and let any padding overflow be clipped by the
      // mask below — keeps demons / golems readable instead of
      // shrunken to half size.
      const fw            = sprite.frame?.width || 64
      const effectiveChar = fw >= 128 ? 64 : fw
      const PADDING       = 8
      const scale         = (pxBox - PADDING * 2) / effectiveChar
      sprite.setScale(scale)
      // Clip to the portrait box so 128-frame padding doesn't poke
      // past the panel edges into the surrounding stat tiles.
      const maskG = this._scene.make.graphics({ x: 0, y: 0, add: false })
      maskG.fillStyle(0xffffff)
      maskG.fillRect(boxX, boxY, pxBox, pxBox)
      sprite.setMask(maskG.createGeometryMask())
      const animKey = `${idleKey}-down`
      if (this._scene.anims.exists(animKey)) sprite.play(animKey)
      addChild(sprite)
    } else {
      // Fallback — original sigil letter for unknown minion ids.
      const sigil = m.sigil ?? def?.sigil ?? def?.id?.[0]?.toUpperCase() ?? '?'
      addChild(this._scene.add.text(boxX + pxBox / 2, boxY + pxBox / 2, sigil, {
        fontFamily: FONT_HEAD, fontSize: '48px',
        color: this._minionColor(def), letterSpacing: 1,
      }).setOrigin(0.5).setDepth(D + 2))
    }

    let yy = y + 14 + pxBox + 16
    addChild(this._scene.add.text(x + 14, yy,
      `${(def?.name ?? m.definitionId ?? '?').toUpperCase()} · LVL ${m.level ?? 1}`, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D + 2))
    yy += 14
    addChild(this._scene.add.text(x + 14, yy, m.name ?? def?.name ?? m.definitionId ?? '?', {
      fontFamily: FONT_HEAD, fontSize: '12px', color: CRYPT.ink, letterSpacing: 1,
    }).setDepth(D + 2))
    yy += 22

    addChild(this._scene.add.text(x + 14, yy,
      `Assigned to: ${this._roomLabelFor(m.assignedRoomId)}`, {
      fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setDepth(D + 2))
    yy += 16

    const hpBar = pixelBar(this._scene, x + 14, yy, w - 28, 12,
      m.resources?.hp ?? 0, m.resources?.maxHp ?? 1,
      { color: 'red', label: `${m.resources?.hp ?? 0} / ${m.resources?.maxHp ?? 0}`, depth: D + 2, fontSize: 8 })
    addChild(hpBar.g, hpBar.txt)
    yy += 22

    // 4 stat tiles
    const tileW = (w - 28 - 12) / 4
    const tileH = 50
    const tiles = [
      { l: 'KILLS',    v: m.lifetime?.kills ?? 0 },
      { l: 'DMG/HIT',  v: m.stats?.attack ?? 0 },
      { l: 'ARMOR',    v: m.stats?.defense ?? 0 },
      { l: 'SPEED',    v: (m.stats?.speed ?? 1).toFixed(1) },
    ]
    tiles.forEach((t, i) => {
      const tx = x + 14 + i * (tileW + 4)
      const tileG = this._scene.add.graphics().setDepth(D + 2)
      pixelPanel(tileG, tx, yy, tileW, tileH, {
        fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
      })
      addChild(tileG)
      addChild(this._scene.add.text(tx + tileW / 2, yy + 14, String(t.v), {
        fontFamily: FONT_HEAD, fontSize: '14px', color: CRYPT.ink, letterSpacing: 1,
      }).setOrigin(0.5, 0).setDepth(D + 3))
      addChild(this._scene.add.text(tx + tileW / 2, yy + tileH - 8, t.l, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5, 1).setDepth(D + 3))
    })
    yy += tileH + 14

    // Traits
    addChild(this._scene.add.text(x + 14, yy, 'TRAITS', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D + 2))
    yy += 14
    const traits = (m.tags ?? def?.tags ?? []).slice(0, 6)
    if (traits.length === 0) {
      addChild(this._scene.add.text(x + 14, yy, '— none —', {
        fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setDepth(D + 2))
    } else {
      let tx = x + 14
      for (const tag of traits) {
        const tagW = tag.length * 6 + 12
        const tagG = this._scene.add.graphics().setDepth(D + 2)
        pixelPanel(tagG, tx, yy, tagW, 16, {
          fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeS,
        })
        addChild(tagG)
        addChild(this._scene.add.text(tx + tagW / 2, yy + 8, tag.toUpperCase(), {
          fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.ink, letterSpacing: 1,
        }).setOrigin(0.5).setDepth(D + 3))
        tx += tagW + 4
      }
    }
  }

  _minionDef(id) {
    return (this._scene.cache.json.get('minionTypes') ?? []).find(d => d.id === id)
  }

  _minionColor(def) {
    if (!def?.color) return CRYPT.ink
    if (typeof def.color === 'string') return def.color.startsWith('0x') ? `#${def.color.slice(2)}` : def.color
    return `#${def.color.toString(16).padStart(6, '0')}`
  }

  _roomLabelFor(roomId) {
    if (!roomId) return 'Unassigned'
    const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === roomId)
    if (!room) return 'Unassigned'
    const def = (this._scene.cache.json.get('rooms') ?? []).find(r => r.id === room.definitionId)
    return def?.name ?? room.definitionId
  }

  _truncate(s, n) {
    s = String(s ?? '')
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }
}
