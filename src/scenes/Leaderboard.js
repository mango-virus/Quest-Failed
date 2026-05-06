// Leaderboard scene — fetches the top runs from Supabase and shows them
// in a Crypt-styled pixel table. Reachable from the MainMenu LEADERBOARD
// button. Sort order is days_survived desc, total_kills desc (server-side).
//
// Columns: rank, player, boss class, days, kills, date.

import {
  CRYPT, FONT_HEAD, FONT_BODY,
  pixelPanel, pixelButton, applyUiCamera,
} from '../ui/UIKit.js'
import { Leaderboard as LeaderboardAPI } from '../systems/Leaderboard.js'
import { TitleMusic } from '../systems/TitleMusic.js'

const W = 1280
const H = 720

const TOP_N = 50

export class Leaderboard extends Phaser.Scene {
  constructor() {
    super('Leaderboard')
    this._objects = []
    this._buttons = []
  }

  create() {
    TitleMusic.ensurePlaying(this)
    this._setupCamera()
    this.scale.on('resize', this._setupCamera, this)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this._setupCamera, this)
      this._buttons.forEach(b => b?.destroy?.())
      this._objects.forEach(o => o?.destroy?.())
      this._buttons = []
      this._objects = []
    })

    // Backdrop
    const bg = this.add.graphics().setDepth(0)
    bg.fillStyle(CRYPT.bgDeep, 1)
    bg.fillRect(0, 0, W, H)
    this._objects.push(bg)

    this._buildHeader()
    this._buildTableChrome()
    this._buildBackButton()
    this._loadAndRender()
  }

  _setupCamera() {
    applyUiCamera(this, W, H)
  }

  _buildHeader() {
    // Header gradient strip
    const headerH = 90
    const grad = this.add.graphics().setDepth(1)
    for (let i = 0; i < 8; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(CRYPT.bgStone1),
        Phaser.Display.Color.IntegerToColor(CRYPT.bgDeep),
        7, i,
      )
      grad.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      grad.fillRect(0, Math.round((headerH * i) / 8), W, Math.ceil(headerH / 8) + 1)
    }
    grad.fillStyle(CRYPT.outline, 1);     grad.fillRect(0, headerH,     W, 2)
    grad.fillStyle(CRYPT.panelEdgeH, 1);  grad.fillRect(0, headerH + 2, W, 1)
    this._objects.push(grad)

    this._objects.push(this.add.text(W / 2, 22, 'GLOBAL HALL OF EVIL', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 4,
    }).setOrigin(0.5).setDepth(2))

    const title = this.add.text(W / 2, 50, 'LEADERBOARD', {
      fontFamily: FONT_HEAD, fontSize: '28px', color: CRYPT.accentCss, letterSpacing: 6,
    }).setOrigin(0.5).setDepth(2)
    title.setShadow(3, 3, '#000000', 0, false, true)
    this._objects.push(title)
  }

  _buildTableChrome() {
    // Table panel
    const px = 40, py = 110, pw = W - 80, ph = H - 110 - 80
    const panelG = this.add.graphics().setDepth(1)
    pixelPanel(panelG, px, py, pw, ph, { fill: CRYPT.bgStone1 })
    this._objects.push(panelG)

    // Column header strip
    const headerY = py + 16
    const headerStrip = this.add.graphics().setDepth(2)
    headerStrip.fillStyle(CRYPT.panel2, 1)
    headerStrip.fillRect(px + 8, headerY - 4, pw - 16, 28)
    headerStrip.fillStyle(CRYPT.panelEdgeS, 1)
    headerStrip.fillRect(px + 8, headerY - 4 + 28, pw - 16, 1)
    this._objects.push(headerStrip)

    this._cols = this._columnLayout(px, pw)
    const headerStyle = {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.accent2Css, letterSpacing: 2,
    }
    for (const col of this._cols) {
      this._objects.push(this.add.text(col.x, headerY + 10, col.label, headerStyle)
        .setOrigin(col.originX, 0.5).setDepth(3))
    }

    // Rows render area
    this._rowsTop  = headerY + 32
    this._rowsLeft = px
    this._rowsW    = pw
    this._rowsH    = ph - (this._rowsTop - py) - 12
    this._rowsBot  = this._rowsTop + this._rowsH
    this._tableX   = px
    this._tableW   = pw
    this._tableY   = py
    this._tableH   = ph
  }

  // Column positions / widths chosen to fit the panel cleanly. Left-anchor
  // for text columns, right-anchor for numbers, center for rank/boss.
  _columnLayout(px, pw) {
    const inset = 24
    const left  = px + inset
    const right = px + pw - inset
    const span  = right - left
    // Approximate widths: rank 6%, player 28%, boss 22%, days 12%, kills 12%, date 20%
    const c = (frac) => left + span * frac
    return [
      { key: 'rank',   label: '#',       x: c(0.00),                originX: 0,   align: 0 },
      { key: 'name',   label: 'PLAYER',  x: c(0.06),                originX: 0,   align: 0 },
      { key: 'boss',   label: 'BOSS',    x: c(0.40),                originX: 0,   align: 0 },
      { key: 'days',   label: 'DAYS',    x: c(0.66),                originX: 1,   align: 1 },
      { key: 'kills',  label: 'KILLS',   x: c(0.80),                originX: 1,   align: 1 },
      { key: 'date',   label: 'DATE',    x: right,                  originX: 1,   align: 1 },
    ]
  }

  _buildBackButton() {
    const w = 200, h = 44
    const x = (W - w) / 2
    const y = H - 60
    const btn = pixelButton(this, x, y, w, h, 'BACK TO MENU', {
      depth: 5, fontSize: 10,
      onClick: () => this.scene.start('MainMenu'),
    })
    this._buttons.push(btn)
  }

  // ─── Data ─────────────────────────────────────────────────────────────
  async _loadAndRender() {
    this._statusText?.destroy?.()
    this._statusText = this.add.text(W / 2, this._rowsTop + this._rowsH / 2,
      'LOADING…', {
      fontFamily: FONT_HEAD, fontSize: '12px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setOrigin(0.5).setDepth(3)
    this._objects.push(this._statusText)

    let rows
    try {
      rows = await LeaderboardAPI.fetchTop(TOP_N)
    } catch (err) {
      console.warn('[Leaderboard] fetch failed:', err.message)
      this._statusText.setText('FAILED TO LOAD').setColor(CRYPT.accentCss)
      return
    }
    if (!this.scene.isActive()) return  // user navigated away mid-fetch

    this._statusText.destroy()
    this._statusText = null

    if (!rows.length) {
      const t = this.add.text(W / 2, this._rowsTop + this._rowsH / 2,
        '— NO RUNS YET — BE THE FIRST —', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(3)
      this._objects.push(t)
      return
    }

    this._renderRows(rows)
  }

  _renderRows(rows) {
    const archs  = this.cache.json.get('bossArchetypes') ?? []
    const nameOf = (id) => archs.find(a => a.id === id)?.name ?? id
    // Row height bumped from 24 → 52 so the 22×22 bestiary portrait
    // can render at 44×44 (2× nearest-neighbour upscale) without
    // crushing the row vertically.
    const rowH   = 52
    const maxRows = Math.floor(this._rowsH / rowH)
    const visible = rows.slice(0, maxRows)

    visible.forEach((r, i) => {
      // Centre each row in its own row slot. The old `+ 12` was tuned
      // for the 24-px row height; with rowH = 52 it left the first
      // row's portrait poking 10 px above _rowsTop into the BOSS
      // header. `+ rowH/2` always centres the row inside its slot.
      const y = this._rowsTop + rowH / 2 + i * rowH

      // Zebra stripe for readability
      if (i % 2 === 1) {
        const stripe = this.add.graphics().setDepth(2)
        stripe.fillStyle(CRYPT.bgStone2, 0.55)
        stripe.fillRect(this._rowsLeft + 8, y - rowH / 2, this._rowsW - 16, rowH)
        this._objects.push(stripe)
      }

      const cells = {
        rank:  String(i + 1).padStart(2, '0'),
        name:  String(r.player_name ?? 'ANON').toUpperCase().slice(0, 16),
        boss:  String(nameOf(r.boss_id) ?? '???').toUpperCase().slice(0, 18),
        days:  String(r.days_survived ?? 0),
        kills: String(r.total_kills   ?? 0),
        date:  this._fmtDate(r.created_at),
      }
      const headRows = new Set(['rank', 'days', 'kills', 'date'])
      const rankColor = i === 0 ? CRYPT.accentCss
                      : i === 1 ? CRYPT.accent2Css
                      : i === 2 ? CRYPT.goldCss
                      :           CRYPT.inkMute

      // Boss portrait in the BOSS column — uses the bestiary portrait
      // (22×22 pixel-art bust at assets/ui/bestiary/portraits/<id>_p.png,
      // loaded as `bestiary-portrait-<id>`) scaled to 44×44 (2×) with
      // NEAREST filtering so the pixel art stays crisp instead of
      // bilinear-blurring. Falls back silently if missing.
      const PORTRAIT_SIZE = 44
      const PORTRAIT_GAP  = 10
      const bossCol       = this._cols.find(c => c.key === 'boss')
      const portraitKey   = r.boss_id ? `bestiary-portrait-${r.boss_id}` : null
      const hasPortrait   = portraitKey && this.textures.exists(portraitKey)
      if (bossCol && hasPortrait) {
        const tex = this.textures.get(portraitKey)
        if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
        const portrait = this.add.image(
          bossCol.x + PORTRAIT_SIZE / 2, y, portraitKey,
        ).setOrigin(0.5).setDepth(3)
        portrait.setDisplaySize(PORTRAIT_SIZE, PORTRAIT_SIZE)
        this._objects.push(portrait)
      }

      for (const col of this._cols) {
        const isRank = col.key === 'rank'
        const text   = cells[col.key]
        const style = {
          fontFamily: headRows.has(col.key) ? FONT_HEAD : FONT_BODY,
          fontSize:   '10px',
          color:      isRank ? rankColor
                    : col.key === 'name' ? CRYPT.ink
                    : col.key === 'boss' ? CRYPT.accent2Css
                    :                      CRYPT.inkMute,
          letterSpacing: 1,
        }
        // Boss text shifts right when a portrait is present so the two
        // don't overlap. Other columns render at their declared x.
        const xOffset = (col.key === 'boss' && hasPortrait)
          ? (PORTRAIT_SIZE + PORTRAIT_GAP)
          : 0
        this._objects.push(this.add.text(col.x + xOffset, y, text, style)
          .setOrigin(col.originX, 0.5).setDepth(3))
      }
    })
  }

  _fmtDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    // YYYY-MM-DD, compact and locale-stable
    const y  = d.getFullYear()
    const m  = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }
}
