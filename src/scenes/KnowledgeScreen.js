// KnowledgeScreen — "Threat Assessment" full-screen intel dashboard.
//
// Launched via:  scene.launch('KnowledgeScreen', { gameState, knowledgeSystem })
// Closed via:    ESC key or the ✕ button.
//
// Live updates: while this scene is open during a day phase the dashboard
// polls KnowledgeSystem every REFRESH_MS and re-renders any panels whose
// stats changed.  Newly-changed values flash briefly (yellow for the %
// gauge, green for newly-discovered rooms / traps / loot) so the player
// can see intel arriving in real time as adventurers explore.
//
// Layout (1280 × 720 logical):
//   Header strip  — top 44px  — title, subtitle, close button
//   Left panel    — 260px wide, below header  — % meter + survivor roster
//   Center map    — remaining width, below header, above footer
//   Right panel   — 260px wide, below header  — room detail on hover
//   Footer strip  — bottom 28px  — hotkey hint

import { PALETTE, glowPanel, makeBar, applyUiCamera } from '../ui/UIKit.js'
import { Balance } from '../config/balance.js'
import { PauseManager } from '../systems/PauseManager.js'

const TS = Balance.TILE_SIZE

// Threat-intel colour scheme — dark background, red/amber map overlays
const COL = {
  bg:        0x030608,
  header:    0x060b10,
  panel:     0x050a0f,
  border:    0x0d1f2e,
  confirmed: 0xcc2222,
  stale:     0xcc8822,
  unknown:   0x111820,
  accent:    0xaa0000,
  veteran:   0xff6644,
  threatLow: 0x33cc77,
  threatMid: 0xddaa22,
  threatHi:  0xcc3322,
}

// ── Knowledge-category color scheme ─────────────────────────────────
// The ONE 4-category palette shared across all three knowledge
// surfaces (the LeftPanels mini-map, this menu, the big Knowledge Map
// overlay). Each category is "what kind of intel the adventurers
// leaked": ROOMS / TRAPS / MINIONS / ITEMS. Kept byte-for-byte in
// sync with LeftPanels.CAT_COLOR and KnowledgeMapOverlay.CAT_COLOR —
// the only difference is Phaser wants numeric hex, the DOM wants
// strings, so each surface declares its own copy of the same values.
const CAT_COLOR = {
  ROOMS:   0x5cc8d8,
  TRAPS:   0xe89a3c,
  MINIONS: 0xc8334a,
  ITEMS:   0xc879d8,
}
// CSS-string form of the same palette for text-object colours.
const CAT_COLOR_STR = {
  ROOMS:   '#5cc8d8',
  TRAPS:   '#e89a3c',
  MINIONS: '#c8334a',
  ITEMS:   '#c879d8',
}

// Tile size for the mini-map — small enough that even 30×30 grids fit in center panel
const MAP_TILE = 8

// Real-time refresh cadence + flash-on-change polish.
const REFRESH_MS         = 250        // poll KnowledgeSystem 4× per second
const FLASH_MS           = 900        // duration of the yellow/green flash
const FLASH_NEW_COLOR    = '#66ff88'  // green — for newly-learned values
const FLASH_PCT_COLOR    = '#ffe066'  // yellow — for the threat % gauge
const ROOM_PULSE_COLOR   = 0x66ff88   // green pulse over a room when its
                                      // knowledge state changes

export class KnowledgeScreen extends Phaser.Scene {
  constructor() {
    super('KnowledgeScreen')
    this._gameState = null
    this._ks        = null   // KnowledgeSystem reference
    this._hoveredRoomId = null
    this._detailObjects = []
    this._hitZones      = []
    this._escKey        = null

    // ── Real-time refresh state ───────────────────────────────────────────
    // Live UI references captured during build* and updated each refresh.
    this._headerPctText  = null
    this._barFill        = null
    this._barFillW       = 0
    this._barPctLabel    = null
    this._statTextRefs   = []      // [{ text, color, label, compute, lastValue }]
    this._mapLayout      = null    // { ts, ox, oy, drawW, drawH }
    this._mapGraphics    = null    // rooms/floor base layer
    this._mapIconGraphics= null    // small icons per room
    this._lastRoomStates = {}      // roomId -> 'confirmed'|'stale'|'unknown'
    this._lastStats      = {}
    this._lastDetailHash = ''
    this._lastRefreshAt  = 0
  }

  init(data) {
    this._gameState = data?.gameState ?? this.scene.get('Game')?.gameState
    this._ks        = data?.knowledgeSystem ?? this.scene.get('Game')?.knowledgeSystem
  }

  create() {
    const { width: W, height: H } = applyUiCamera(this)

    // ── Backdrop ───────────────────────────────────────────────────────────
    this.add.rectangle(0, 0, W, H, COL.bg, 0.97).setOrigin(0).setDepth(0)

    // ── Layout constants ───────────────────────────────────────────────────
    const HEADER_H  = 44
    const FOOTER_H  = 28
    const PANEL_W   = 260
    const CONTENT_Y = HEADER_H + 8
    const CONTENT_H = H - HEADER_H - FOOTER_H - 16

    // ── Panels ─────────────────────────────────────────────────────────────
    this._drawPanelFrame(W, H, HEADER_H, FOOTER_H, PANEL_W, CONTENT_Y, CONTENT_H)

    // ── Header ─────────────────────────────────────────────────────────────
    this._buildHeader(W, HEADER_H)

    // ── Left: stats + roster ───────────────────────────────────────────────
    this._buildLeftPanel(PANEL_W, CONTENT_Y, CONTENT_H)

    // ── Center: dungeon minimap ────────────────────────────────────────────
    const mapX = PANEL_W + 8
    const mapW = W - PANEL_W * 2 - 16
    this._buildMap(mapX, CONTENT_Y, mapW, CONTENT_H)

    // ── Right: room detail panel (initially empty) ─────────────────────────
    this._buildRightPanel(W - PANEL_W, CONTENT_Y, PANEL_W, CONTENT_H)

    // ── Footer ─────────────────────────────────────────────────────────────
    this.add.text(W / 2, H - FOOTER_H / 2,
      '✕ — close  ·  hover room for details  ·  ESC = pause  ·  updates live as the dungeon is explored', {
        fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(5)

    // ── Input ──────────────────────────────────────────────────────────────
    // ESC opens the pause menu (consistent with all other gameplay scenes).
    // The ✕ button in the header strip is the dedicated close affordance.
    this.input.keyboard?.on('keydown-ESC', () => PauseManager.toggle(this))

    // ── Real-time refresh seed ─────────────────────────────────────────────
    // Snapshot current stats / room states so the first refresh tick
    // diffs against the actual open-time state (no spurious flash on the
    // very first poll).
    this._lastStats      = this._ks?.computeKnowledgeStats?.() ?? {}
    this._lastRoomStates = this._snapshotRoomStates()
    this._lastRefreshAt  = this.time.now
  }

  update() {
    // Throttled real-time refresh — see REFRESH_MS.  Polling rather than
    // event-driven because the data set is small (handful of rooms /
    // traps / minions), and the work is bounded.
    const now = this.time.now
    if (now - this._lastRefreshAt < REFRESH_MS) return
    this._lastRefreshAt = now
    this._refreshDynamic()
  }

  shutdown() {
    this._hitZones.forEach(z => z.destroy())
    this._hitZones = []
    this._detailObjects.forEach(o => o.destroy())
    this._detailObjects = []
  }

  // ── Frame / panels ─────────────────────────────────────────────────────────

  _drawPanelFrame(W, H, HEADER_H, FOOTER_H, PANEL_W, CONTENT_Y, CONTENT_H) {
    const g = this.add.graphics().setDepth(1)

    // Header strip
    glowPanel(g, 0, 0, W, HEADER_H, {
      fill: COL.header, border: COL.accent, glow: 0x330000,
    })

    // Left panel
    glowPanel(g, 4, CONTENT_Y, PANEL_W - 8, CONTENT_H, {
      fill: COL.panel, border: COL.border, glow: 0x020408,
    })

    // Right panel
    glowPanel(g, W - PANEL_W + 4, CONTENT_Y, PANEL_W - 8, CONTENT_H, {
      fill: COL.panel, border: COL.border, glow: 0x020408,
    })

    // Footer strip
    glowPanel(g, 0, H - FOOTER_H, W, FOOTER_H, {
      fill: COL.header, border: COL.border, glow: 0,
    })
  }

  // ── Header ──────────────────────────────────────────────────────────────────

  _buildHeader(W, HEADER_H) {
    const stats = this._ks?.computeKnowledgeStats?.() ?? { percentage: 0 }

    this.add.text(18, HEADER_H / 2,
      '◈  THREAT ASSESSMENT', {
        fontSize: '12px', color: '#cc2222', fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0, 0.5).setDepth(5)

    this.add.text(W / 2, HEADER_H / 2,
      `DUNGEON INTELLIGENCE REPORT  —  DAY ${this._gameState?.meta?.dayNumber ?? 1}`, {
        fontSize: '10px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(5)

    // Knowledge % in header — captured for live updates.
    const pct = stats.percentage ?? 0
    this._headerPctText = this.add.text(W - 100, HEADER_H / 2,
      `${pct}% KNOWN`, {
        fontSize: '11px',
        color: this._pctColor(pct),
        fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(5)

    // Close button
    const closeBtn = this.add.text(W - 22, HEADER_H / 2, '✕', {
      fontSize: '14px', color: PALETTE.textDim, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5).setInteractive({ useHandCursor: true })
    closeBtn.on('pointerover', () => closeBtn.setStyle({ color: '#ff4444' }))
    closeBtn.on('pointerout',  () => closeBtn.setStyle({ color: PALETTE.textDim }))
    closeBtn.on('pointerdown', () => this._close())
  }

  _pctColor(pct) {
    return pct >= 75 ? '#cc2222' : pct >= 40 ? '#cc8822' : PALETTE.textDim
  }

  // ── Left panel: meter + survivors ───────────────────────────────────────────

  _buildLeftPanel(panelW, panelY, panelH) {
    const px = 12
    let cy = panelY + 12
    const stats = this._ks?.computeKnowledgeStats?.() ?? {}

    // Section label
    this.add.text(px, cy, 'THREAT GAUGE', {
      fontSize: '9px', color: '#aa0000', fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(5)
    cy += 14

    // % meter bar — captured for live updates.
    const barW = panelW - 20
    const barH = 10
    const barBg = this.add.rectangle(px + barW / 2, cy + barH / 2, barW, barH, 0x0d1520)
      .setDepth(5)
    barBg.setStrokeStyle(1, 0x1a2a3a)

    const pct = (stats.percentage ?? 0) / 100
    this._barFillW = barW
    this._barFill  = this.add.rectangle(px, cy + barH / 2, Math.max(2, barW * pct), barH, COL.confirmed)
      .setOrigin(0, 0.5).setDepth(6)

    const pctLabel = stats.percentage ?? 0
    this._barPctLabel = this.add.text(px + barW / 2, cy + barH / 2,
      `${pctLabel}%`, {
        fontSize: '8px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(7)
    cy += barH + 8

    cy += 4

    // ── Intel categories legend + breakdown ────────────────────────
    // Section label, then one row per intel category. Each row carries
    // a colour swatch (the shared CAT_COLOR) on the left so the player
    // can read which colour means what on the map + the other two
    // knowledge surfaces. The right-aligned number is the live count.
    this.add.text(px, cy, 'INTEL CATEGORIES', {
      fontSize: '9px', color: '#aa0000', fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(5)
    cy += 14

    // Each row: a 8×8 swatch in the category colour + a label + a
    // live count. Captured into _statTextRefs so the refresh loop can
    // update the count and flash it green when new intel arrives.
    const rows = [
      { key: 'rooms',   label: 'Rooms known',   swatch: CAT_COLOR.ROOMS,   color: CAT_COLOR_STR.ROOMS,
        compute: (s) => (s.confirmedRooms ?? 0) + (s.staleRooms ?? 0) },
      { key: 'traps',   label: 'Traps known',   swatch: CAT_COLOR.TRAPS,   color: CAT_COLOR_STR.TRAPS,
        compute: (s) => (s.confirmedTraps ?? 0) + (s.staleTraps ?? 0) },
      { key: 'minions', label: 'Minion rooms',  swatch: CAT_COLOR.MINIONS, color: CAT_COLOR_STR.MINIONS,
        compute: (s) => s.confirmedEnemyRooms ?? 0 },
      { key: 'items',   label: 'Items known',   swatch: CAT_COLOR.ITEMS,   color: CAT_COLOR_STR.ITEMS,
        compute: (s) => (s.confirmedItems ?? 0) + (s.staleItems ?? 0) },
    ]
    for (const row of rows) {
      const val = row.compute(stats)
      // Colour swatch — matches the map pips + mini-map legend.
      const sg = this.add.graphics().setDepth(5)
      sg.fillStyle(row.swatch, 0.95); sg.fillRect(px, cy + 1, 8, 8)
      const t = this.add.text(px + 14, cy,
        `${row.label.padEnd(15)}${val}`, {
          fontSize: '9px', color: row.color, fontFamily: 'monospace',
        }).setDepth(5)
      this._statTextRefs.push({
        text: t, color: row.color, label: row.label.padEnd(15),
        compute: row.compute, lastValue: val,
      })
      cy += 13
    }
    cy += 4

    // Stale / unknown breakdown — secondary detail under the category
    // legend. These aren't categories, they're the room-state tiers
    // used for the map shading, kept dim so they don't compete.
    const subRows = [
      { key: 'staleRooms',   label: 'Stale rooms',   color: '#cc8822',
        compute: (s) => s.staleRooms ?? 0 },
      { key: 'unknownRooms', label: 'Unknown rooms', color: PALETTE.textDim,
        compute: (s) => (s.totalRooms ?? 0) - (s.confirmedRooms ?? 0) - (s.staleRooms ?? 0) },
      { key: 'confirmedLoot', label: 'Floor loot',   color: '#ddaa22',
        compute: (s) => s.confirmedLoot ?? 0 },
    ]
    for (const row of subRows) {
      const val = row.compute(stats)
      const t = this.add.text(px + 14, cy,
        `${row.label.padEnd(15)}${val}`, {
          fontSize: '8px', color: row.color, fontFamily: 'monospace',
        }).setDepth(5)
      this._statTextRefs.push({
        text: t, color: row.color, label: row.label.padEnd(15),
        compute: row.compute, lastValue: val,
      })
      cy += 12
    }
    cy += 8

    // Divider
    const dg = this.add.graphics().setDepth(5)
    dg.lineStyle(1, COL.border, 0.8)
    dg.beginPath(); dg.moveTo(px, cy); dg.lineTo(panelW - 8, cy); dg.strokePath()
    cy += 8

    // Survivors roster — static during day phase (only changes on
    // day-end death/flee events, which we're not displayed during).
    this.add.text(px, cy, 'HERO ROSTER', {
      fontSize: '9px', color: '#aa0000', fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(5)
    cy += 14

    const survivors = this._ks?.getSurvivors?.() ?? []
    if (survivors.length === 0) {
      this.add.text(px, cy, 'No survivors recorded.', {
        fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(5)
      cy += 13
      this.add.text(px, cy, 'Party wipe resets all intel.', {
        fontSize: '8px', color: '#330000', fontFamily: 'monospace',
      }).setDepth(5)
    } else {
      for (const s of survivors) {
        if (cy + 30 > panelY + panelH - 8) break  // clamp to panel height
        const threatColor = s.runCount >= 4 ? COL.threatHi
                          : s.runCount >= 2 ? COL.threatMid
                          : COL.threatLow

        this.add.text(px, cy, `↩ ${s.name}`, {
          fontSize: '9px', color: COL.veteran, fontFamily: 'monospace', fontStyle: 'bold',
        }).setDepth(5)
        cy += 12

        this.add.text(px + 8, cy,
          `${this._classLabel(s.classId).slice(0, 12).padEnd(12)} Runs: ${s.runCount}`, {
            fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
          }).setDepth(5)
        cy += 11

        this.add.text(px + 8, cy,
          `Threat: ${'■'.repeat(Math.min(s.runCount, 5))}`, {
            fontSize: '8px', color: threatColor, fontFamily: 'monospace',
          }).setDepth(5)
        cy += 14
      }
    }
  }

  // ── Center: dungeon minimap ─────────────────────────────────────────────────

  _buildMap(mapX, mapY, mapW, mapH) {
    const gs    = this._gameState
    const gw    = gs.dungeon.gridWidth
    const gh    = gs.dungeon.gridHeight

    // Scale tile size so the whole grid fits inside mapW × mapH
    const ts = Math.floor(Math.min(mapW / gw, mapH / gh, MAP_TILE))
    if (ts < 1) return

    const drawW = gw * ts
    const drawH = gh * ts
    const ox    = mapX + Math.floor((mapW - drawW) / 2)
    const oy    = mapY + Math.floor((mapH - drawH) / 2)

    // Cache layout for refresh redraw + room-pulse positioning.
    this._mapLayout = { ts, ox, oy, drawW, drawH }

    // Two graphics layers: the base layer (rooms + corridors) and a
    // foreground icon layer.  Both are cleared and redrawn each
    // refresh tick.  Hit zones are built once below.
    this._mapGraphics     = this.add.graphics().setDepth(3)
    this._mapIconGraphics = this.add.graphics().setDepth(4)

    // Render the static room-overlay border once for boss chamber etc.
    // (handled inside _drawMap to keep redraw consistent).
    this._drawMap()

    // Hover hit zones — created once and persist across refreshes.
    for (const room of gs.dungeon.rooms) {
      const rx = ox + room.gridX * ts
      const ry = oy + room.gridY * ts
      const rw = room.width  * ts
      const rh = room.height * ts
      const hz = this.add.rectangle(
        rx + rw / 2, ry + rh / 2, rw, rh, 0xffffff, 0
      ).setDepth(8).setInteractive()
      hz.on('pointerover', () => this._onRoomHover(room))
      hz.on('pointerout',  () => this._onRoomHoverEnd())
      this._hitZones.push(hz)
    }

    // ── Legend ─────────────────────────────────────────────────────
    // Two rows so the player can read the map at a glance:
    //   Row 1 — ROOM STATE: how each room block is shaded (the room's
    //           own knowledge tier — confirmed / stale / unknown).
    //   Row 2 — INTEL CATEGORY: the four pip colours drawn inside a
    //           room, one per category of intel the adventurers hold.
    //           Same palette + order as the mini-map and the big
    //           Knowledge Map overlay.
    const legY = oy + drawH + 6
    if (legY + 12 < mapY + mapH) {
      // Row 1 — room-state shading.
      this.add.text(ox, legY, 'ROOM:', {
        fontSize: '8px', color: '#aa0000', fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(5)
      let lx = ox + 42
      for (const li of [
        { color: COL.confirmed, label: 'confirmed' },
        { color: COL.stale,     label: 'stale' },
        { color: COL.unknown,   label: 'unknown' },
      ]) {
        const lg = this.add.graphics().setDepth(5)
        lg.fillStyle(li.color, 0.8); lg.fillRect(lx, legY, 8, 8)
        this.add.text(lx + 10, legY, li.label, {
          fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
        }).setDepth(5)
        lx += 64
      }
      // Row 2 — the 4-category intel pips.
      const legY2 = legY + 13
      if (legY2 + 10 < mapY + mapH) {
        this.add.text(ox, legY2, 'INTEL:', {
          fontSize: '8px', color: '#aa0000', fontFamily: 'monospace', fontStyle: 'bold',
        }).setDepth(5)
        let lx2 = ox + 42
        for (const li of [
          { color: CAT_COLOR.ROOMS,   label: 'rooms' },
          { color: CAT_COLOR.TRAPS,   label: 'traps' },
          { color: CAT_COLOR.MINIONS, label: 'minions' },
          { color: CAT_COLOR.ITEMS,   label: 'items' },
        ]) {
          const lg = this.add.graphics().setDepth(5)
          lg.fillStyle(li.color, 0.95); lg.fillRect(lx2, legY2, 8, 8)
          this.add.text(lx2 + 10, legY2, li.label, {
            fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
          }).setDepth(5)
          lx2 += 58
        }
      }
    }
  }

  _drawMap() {
    if (!this._mapLayout || !this._mapGraphics) return
    const { ts, ox, oy, drawW, drawH } = this._mapLayout
    const gs = this._gameState
    const gw = gs.dungeon.gridWidth
    const gh = gs.dungeon.gridHeight

    const g  = this._mapGraphics
    const ig = this._mapIconGraphics
    g.clear()
    ig.clear()

    // Background void
    g.fillStyle(0x040810, 1)
    g.fillRect(ox, oy, drawW, drawH)

    // Rooms
    for (const room of gs.dungeon.rooms) {
      const state = this._ks?.getRoomKnowledgeState(room.instanceId) ?? 'unknown'
      const baseColor = state === 'confirmed' ? COL.confirmed
                      : state === 'stale'     ? COL.stale
                      : COL.unknown

      const rx = ox + room.gridX * ts
      const ry = oy + room.gridY * ts
      const rw = room.width  * ts
      const rh = room.height * ts

      // Fill
      g.fillStyle(baseColor, state === 'unknown' ? 0.6 : 0.45)
      g.fillRect(rx, ry, rw, rh)

      // Border
      g.lineStyle(1, baseColor, state === 'unknown' ? 0.2 : 0.85)
      g.strokeRect(rx, ry, rw, rh)

      // Boss chamber special outline
      if (room.definitionId === 'boss_chamber') {
        g.lineStyle(2, 0xaa22ff, 0.8)
        g.strokeRect(rx - 1, ry - 1, rw + 2, rh + 2)
      }

      // Room icons (only when state is known)
      if (state !== 'unknown' && ts >= 5) {
        this._drawMapRoomIcons(room, rx, ry, rw, rh, state, ig)
      }
    }

    // Corridors / door tiles overlay
    const tiles = gs.dungeon.tiles
    for (let y = 0; y < gh; y++) {
      const row = tiles[y]
      if (!row) continue
      for (let x = 0; x < gw; x++) {
        const t = row[x]
        if (t === 3 /* CORRIDOR */ || t === 4 /* DOOR */) {
          g.fillStyle(0x224466, 0.6)
          g.fillRect(ox + x * ts, oy + y * ts, ts, ts)
        }
      }
    }
  }

  // Per-room category intel pips — one small square per known intel
  // category, coloured from the shared CAT_COLOR palette so they match
  // the legend and the other two knowledge surfaces. Loot keeps a gold
  // pip (it's a distinct floor-loot bucket, not one of the 4 build
  // categories).
  _drawMapRoomIcons(room, rx, ry, rw, rh, state, ig) {
    const details = this._ks?.getRoomKnowledgeDetails(room.instanceId)
    if (!details) return

    let iconX = rx + 2
    const dim = state === 'stale' ? 0.5 : 0.9

    if (details.enemies.length > 0) {
      ig.fillStyle(CAT_COLOR.MINIONS, dim)
      ig.fillRect(iconX, ry + 2, 3, 3)
      iconX += 5
    }
    if (details.traps.length > 0) {
      ig.fillStyle(CAT_COLOR.TRAPS, dim)
      ig.fillRect(iconX, ry + 2, 3, 3)
      iconX += 5
    }
    // Placed-item intel marker (phylactery / beacons).
    if ((details.items?.length ?? 0) > 0) {
      ig.fillStyle(CAT_COLOR.ITEMS, dim)
      ig.fillRect(iconX, ry + 2, 3, 3)
      iconX += 5
    }
    if (details.loot.length > 0) {
      ig.fillStyle(0xddaa22, dim)
      ig.fillRect(iconX, ry + 2, 3, 3)
    }
  }

  // ── Right panel: room detail ────────────────────────────────────────────────

  _buildRightPanel(px, panelY, panelW, panelH) {
    this._rightPanelX = px + 8
    this._rightPanelY = panelY + 8
    this._rightPanelW = panelW - 16
    this._rightPanelH = panelH - 16
    this._showRightPanelEmpty()
  }

  _showRightPanelEmpty() {
    this._clearDetailPanel()
    const tx = this._rightPanelX
    const ty = this._rightPanelY

    const t = this.add.text(tx, ty + 20, 'HOVER A ROOM\nFOR DETAILS', {
      fontSize: '9px', color: '#330000', fontFamily: 'monospace', align: 'center',
      wordWrap: { width: this._rightPanelW },
    }).setOrigin(0, 0).setDepth(5)
    this._detailObjects.push(t)
    this._lastDetailHash = ''
  }

  _onRoomHover(room) {
    if (this._hoveredRoomId === room.instanceId) return
    this._hoveredRoomId = room.instanceId
    this._lastDetailHash = ''        // force a fresh render
    this._refreshDetailPanel(room)
    this._lastDetailHash = this._detailHash(room)
  }

  _onRoomHoverEnd() {
    this._hoveredRoomId = null
    this._showRightPanelEmpty()
  }

  _refreshDetailPanel(room) {
    this._clearDetailPanel()

    const tx = this._rightPanelX
    let cy   = this._rightPanelY
    const w  = this._rightPanelW

    const state   = this._ks?.getRoomKnowledgeState(room.instanceId) ?? 'unknown'
    const details = this._ks?.getRoomKnowledgeDetails(room.instanceId)
    const roomDefs= this.cache.json.get('rooms') ?? []
    const def     = roomDefs.find(d => d.id === room.definitionId) ?? {}

    const stateColor = state === 'confirmed' ? '#cc2222'
                     : state === 'stale'     ? '#cc8822'
                     : PALETTE.textDim

    // Room name + state badge — resolve through the room name helper
    // so a missing def never leaks the raw definitionId.
    this._push(this.add.text(tx, cy,
      this._roomLabel(room.definitionId, def), {
        fontSize: '11px', color: stateColor, fontFamily: 'monospace', fontStyle: 'bold',
        wordWrap: { width: w },
      }).setDepth(5))
    cy += 14

    this._push(this.add.text(tx, cy,
      `[${state.toUpperCase()}]`, {
        fontSize: '8px', color: stateColor, fontFamily: 'monospace',
      }).setDepth(5))
    cy += 14

    if (state === 'unknown') {
      this._push(this.add.text(tx, cy, 'No intel on this room.', {
        fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(5))
      return
    }

    const roomEntry = details?.room
    if (roomEntry) {
      this._push(this.add.text(tx, cy,
        `Visited: ${roomEntry.visitCount ?? 0}×  Day ${roomEntry.firstVisitedDay ?? '?'}`, {
          fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
        }).setDepth(5))
      cy += 12
    }
    cy += 6

    // Enemies — section header + per-line text in the MINIONS category
    // colour so the panel matches the legend.
    const enemies = details?.enemies ?? []
    if (enemies.length > 0) {
      this._push(this.add.text(tx, cy, '☠ MINIONS', {
        fontSize: '9px', color: CAT_COLOR_STR.MINIONS, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(5))
      cy += 13
      for (const e of enemies) {
        const staleTag = e.stale ? ' [STALE]' : ''
        this._push(this.add.text(tx + 4, cy,
          `· ${this._minionLabel(e.minionType)}${staleTag}`, {
            fontSize: '8px', color: e.stale ? '#886622' : PALETTE.textNormal,
            fontFamily: 'monospace',
          }).setDepth(5))
        cy += 11
      }
      cy += 4
    }

    // Traps — TRAPS category colour.
    const traps = details?.traps ?? []
    if (traps.length > 0) {
      this._push(this.add.text(tx, cy, '⚡ TRAPS', {
        fontSize: '9px', color: CAT_COLOR_STR.TRAPS, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(5))
      cy += 13
      for (const t of traps) {
        const staleTag = t.stale ? ' [STALE]' : ''
        this._push(this.add.text(tx + 4, cy,
          `· ${this._trapLabel(t.type)} @(${t.tileX},${t.tileY})${staleTag}`, {
            fontSize: '8px', color: t.stale ? '#886622' : CAT_COLOR_STR.TRAPS,
            fontFamily: 'monospace',
          }).setDepth(5))
        cy += 11
      }
      cy += 4
    }

    // Loot — buff-piles the adventurers spotted on the floor. Each pile
    // carries its own readable buff label (e.g. "+2 ATK"); show it raw.
    const loot = details?.loot ?? []
    if (loot.length > 0) {
      this._push(this.add.text(tx, cy, '◈ LOOT', {
        fontSize: '9px', color: '#ddaa22', fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(5))
      cy += 13
      for (const l of loot) {
        const staleTag = l.stale ? ' [STALE]' : ''
        this._push(this.add.text(tx + 4, cy,
          `· ${l.label ?? 'Loot'}${staleTag}`, {
            fontSize: '8px', color: l.stale ? '#886622' : '#ddaa22',
            fontFamily: 'monospace',
          }).setDepth(5))
        cy += 11
      }
    }

    // Items — placed item-entities the adventurers know about (Lich
    // phylactery / soul-bound beacons). ITEMS category colour; same
    // stale-tag treatment as the sections above so the player sees
    // what intel is going rumour-tier.
    const items = details?.items ?? []
    if (items.length > 0) {
      this._push(this.add.text(tx, cy, '✦ ITEMS', {
        fontSize: '9px', color: CAT_COLOR_STR.ITEMS, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(5))
      cy += 13
      for (const it of items) {
        const staleTag = it.stale ? ' [STALE]' : ''
        this._push(this.add.text(tx + 4, cy,
          `· ${this._itemLabel(it.itemType)}${staleTag}`, {
            fontSize: '8px', color: it.stale ? '#886622' : CAT_COLOR_STR.ITEMS,
            fontFamily: 'monospace',
          }).setDepth(5))
        cy += 11
      }
    }

    if (enemies.length === 0 && traps.length === 0 && loot.length === 0 &&
        items.length === 0) {
      this._push(this.add.text(tx, cy, 'Room clear.', {
        fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(5))
    }
  }

  // Resolve an item-entity type id to its display name via items.json.
  _itemLabel(itemType) {
    if (!itemType) return 'item'
    const def = (this.cache.json.get('items') ?? []).find(d => d.id === itemType)
    return def?.name ?? itemType
  }

  // Resolve a room definition id to its player-facing display name via
  // rooms.json. `defHint` is the already-looked-up def when the caller
  // has one; pass null to look it up here. Never returns a raw dev id
  // when the def is found — falls back to a generic word otherwise.
  _roomLabel(definitionId, defHint = null) {
    const def = defHint && defHint.name != null
      ? defHint
      : (this.cache.json.get('rooms') ?? []).find(d => d.id === definitionId)
    return def?.name ?? definitionId ?? 'Room'
  }

  // Resolve an adventurer class id to its display name via
  // adventurerClasses.json — the survivor roster must show "Cosplayer",
  // never the raw `cosplay_adventurer` dev id.
  _classLabel(classId) {
    if (!classId) return 'Adventurer'
    const def = (this.cache.json.get('adventurerClasses') ?? []).find(d => d.id === classId)
    return def?.name ?? classId
  }

  // Resolve a minion / trap definition id to its player-facing display
  // name — the raw dev ids (rat1, shooting_arrows) must never reach the UI.
  _minionLabel(minionType) {
    if (!minionType) return 'enemy'
    const def = (this.cache.json.get('minionTypes') ?? []).find(d => d.id === minionType)
    return def?.name ?? minionType
  }

  _trapLabel(trapType) {
    if (!trapType) return 'trap'
    const def = (this.cache.json.get('trapTypes') ?? []).find(d => d.id === trapType)
    return def?.name ?? trapType
  }

  _push(obj) {
    this._detailObjects.push(obj)
    return obj
  }

  _clearDetailPanel() {
    this._detailObjects.forEach(o => o.destroy())
    this._detailObjects = []
  }

  // ── Real-time refresh ──────────────────────────────────────────────────────

  _refreshDynamic() {
    const stats = this._ks?.computeKnowledgeStats?.() ?? {}
    this._refreshHeader(stats)
    this._refreshLeftPanelStats(stats)
    this._refreshMap()
    if (this._hoveredRoomId) {
      const room = this._gameState.dungeon.rooms.find(
        r => r.instanceId === this._hoveredRoomId)
      if (room) this._maybeRefreshDetailPanel(room)
    }
    this._lastStats = stats
  }

  _refreshHeader(stats) {
    if (!this._headerPctText) return
    const pct = stats.percentage ?? 0
    const old = this._lastStats?.percentage ?? pct
    const restColor = this._pctColor(pct)
    this._headerPctText.setText(`${pct}% KNOWN`)
    if (pct !== old) this._flashText(this._headerPctText, restColor, FLASH_PCT_COLOR)
    else this._headerPctText.setColor(restColor)
  }

  _refreshLeftPanelStats(stats) {
    // Bar fill — snap to the new width.  Phaser Rectangles need
    // setSize() rather than a property tween for the geometry to
    // actually redraw, and at the 250 ms refresh cadence a snap
    // reads fine.
    if (this._barFill) {
      const pctFrac = (stats.percentage ?? 0) / 100
      const targetW = Math.max(2, this._barFillW * pctFrac)
      this._barFill.setSize(targetW, this._barFill.height)
    }

    // % label inside the bar.
    if (this._barPctLabel) {
      const pct = stats.percentage ?? 0
      const old = this._lastStats?.percentage ?? pct
      this._barPctLabel.setText(`${pct}%`)
      if (pct !== old) this._flashText(this._barPctLabel, '#ffffff', FLASH_PCT_COLOR)
    }

    // Stats breakdown — flash green on any value change so newly-
    // discovered rooms / traps / minions / items read as "just
    // learned". `ref.label` is already padded at build time, so the
    // value is appended directly (no re-pad — that would drift the
    // column from how the row was first laid out).
    for (const ref of this._statTextRefs) {
      const newVal = ref.compute(stats)
      ref.text.setText(`${ref.label}${newVal}`)
      if (newVal !== ref.lastValue) {
        this._flashText(ref.text, ref.color, FLASH_NEW_COLOR)
      }
      ref.lastValue = newVal
    }
  }

  _refreshMap() {
    if (!this._mapLayout) return
    // Detect newly-changed room states BEFORE redrawing so we can pulse
    // the changed rooms over the freshly-painted base layer.
    const changed = []
    for (const room of this._gameState.dungeon.rooms) {
      const prev = this._lastRoomStates[room.instanceId] ?? 'unknown'
      const cur  = this._ks?.getRoomKnowledgeState(room.instanceId) ?? 'unknown'
      if (prev !== cur) {
        changed.push(room)
        this._lastRoomStates[room.instanceId] = cur
      }
    }
    this._drawMap()
    for (const room of changed) this._pulseRoomOnMap(room)
  }

  _maybeRefreshDetailPanel(room) {
    const hash = this._detailHash(room)
    if (hash === this._lastDetailHash) return
    this._lastDetailHash = hash
    this._refreshDetailPanel(room)
  }

  // Cheap content fingerprint of a room's intel — when it changes we
  // know to rebuild the right-side detail panel.  Captures state,
  // visit count, and per-entry stale flags so a freshly-stale trap
  // or a brand-new minion sighting both invalidate the cache.
  _detailHash(room) {
    const d     = this._ks?.getRoomKnowledgeDetails(room.instanceId)
    const state = this._ks?.getRoomKnowledgeState(room.instanceId) ?? 'unknown'
    if (!d) return state
    const enemies = (d.enemies ?? []).map(e => `${e.minionType}:${e.stale ? 1 : 0}`).join(',')
    const traps   = (d.traps   ?? []).map(t => `${t.type}@${t.tileX},${t.tileY}:${t.stale ? 1 : 0}`).join(',')
    const loot    = (d.loot    ?? []).map(l => `${l.label}:${l.stale ? 1 : 0}`).join(',')
    const items   = (d.items   ?? []).map(i => `${i.itemType}:${i.stale ? 1 : 0}`).join(',')
    const visits  = d.room?.visitCount ?? 0
    return `${state}|${visits}|${enemies}|${traps}|${loot}|${items}`
  }

  _flashText(textObj, restColor, flashColor) {
    if (!textObj) return
    textObj.setColor(flashColor)
    if (textObj._flashTween) textObj._flashTween.stop()
    textObj._flashTween = this.tweens.addCounter({
      from: 0, to: 1, duration: FLASH_MS, ease: 'Linear',
      onComplete: () => {
        if (textObj.active) textObj.setColor(restColor)
        textObj._flashTween = null
      },
    })
  }

  _pulseRoomOnMap(room) {
    if (!this._mapLayout) return
    const { ts, ox, oy } = this._mapLayout
    const rx = ox + room.gridX * ts
    const ry = oy + room.gridY * ts
    const rw = room.width  * ts
    const rh = room.height * ts
    // Bright overlay rectangle that fades out — sells the moment of
    // discovery without leaving the map cluttered.
    const pulse = this.add.rectangle(
      rx + rw / 2, ry + rh / 2, rw, rh, ROOM_PULSE_COLOR, 0.55,
    ).setDepth(7)
    this.tweens.add({
      targets:    pulse,
      alpha:      0,
      scale:      1.15,
      duration:   1000,
      ease:       'Cubic.out',
      onComplete: () => pulse.destroy(),
    })
  }

  _snapshotRoomStates() {
    const out = {}
    for (const room of this._gameState?.dungeon?.rooms ?? []) {
      out[room.instanceId] = this._ks?.getRoomKnowledgeState(room.instanceId) ?? 'unknown'
    }
    return out
  }

  _close() {
    this.scene.stop()
  }
}
