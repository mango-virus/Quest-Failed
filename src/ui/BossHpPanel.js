// Bottom-center boss HP panel for the HudScene.
//
// Layout: [22×22 portrait scaled to PORTRAIT_SIZE] | name + HP numeric stacked,
// with a wide HP bar spanning the rest of the panel.
//
// Animations:
//   heartbeat — fill brightness pulses on a slow rhythm; period and amplitude
//               scale with HP (faster + more pronounced at low HP). Folds the
//               low-HP-warning visual into the same mechanic.
//   ghost trail — when HP drops, the freshly-emptied bar segment is painted
//               white and fades out over GHOST_DURATION_MS.

const PANEL_W   = 380
const PANEL_H   = 46
// Vertical offset from the bottom of the UI canvas to the bottom of the
// panel. Smaller = sits lower. The panel's HP bar lands at
// (uiH − PANEL_BOTTOM_OFFSET − PADDING − BAR_H), so dropping this shifts
// the whole panel (and its bar) down together.
const PANEL_BOTTOM_OFFSET = 10
// Horizontal anchor — centered on the UI canvas.
const PORTRAIT_SIZE = 36
const PADDING = 8
const BAR_H   = 14

const BG_COLOR  = 0x0a0510
const BG_ALPHA  = 0.85
const BG_STROKE = 0x33223a
const BAR_BG    = 0x1a0a1e

const HB_AMP_FULL    = 0.08
const HB_AMP_LOW     = 0.28
const HB_PERIOD_FULL = 1200
const HB_PERIOD_LOW  = 500

const GHOST_DURATION_MS = 600
const GHOST_COLOR       = 0xffffff
const GHOST_ALPHA0      = 0.7

export class BossHpPanel {
  constructor(hudScene, gameState) {
    this._scene     = hudScene
    this._gameState = gameState
    this._lastHp    = null
    this._ghosts    = []   // { rect, untilMs }

    const archId = gameState.player?.bossArchetypeId
    const archs  = hudScene.cache.json.get('bossArchetypes') ?? []
    const arch   = archs.find(a => a.id === archId)
    this._archId    = archId
    this._archName  = arch?.name ?? 'Boss'
    this._barColor  = parseColor(arch?.color, 0xcc44ff)

    this._build()
  }

  _build() {
    const s = this._scene
    const px = Math.round((s.uiW - PANEL_W) / 2)
    const py = Math.round(s.uiH - PANEL_BOTTOM_OFFSET - PANEL_H)

    const bg = s.add.rectangle(px, py, PANEL_W, PANEL_H, BG_COLOR, BG_ALPHA)
      .setOrigin(0).setDepth(40)
      .setStrokeStyle(1, this._barColor, 0.55)

    // Portrait
    let portrait = null
    const pkey = `bestiary-portrait-${this._archId}`
    if (s.textures.exists(pkey)) {
      const tex = s.textures.get(pkey)
      if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
      const src = tex.source[0]
      portrait = s.add.image(px + PADDING + PORTRAIT_SIZE / 2, py + PANEL_H / 2, pkey)
        .setOrigin(0.5).setDepth(41)
        .setScale(PORTRAIT_SIZE / Math.max(src.width, src.height))
    }

    // Name + numeric HP
    const textX = px + PADDING + PORTRAIT_SIZE + 10
    const nameLabel = s.add.text(textX, py + 6, this._archName.toUpperCase(), {
      fontFamily: 'monospace', fontSize: '14px', color: '#f4d28a', fontStyle: 'bold',
      stroke: '#0a0010', strokeThickness: 2,
    }).setDepth(41)

    const hpRightX = px + PANEL_W - PADDING
    const hpLabel = s.add.text(hpRightX, py + 8, '', {
      fontFamily: 'monospace', fontSize: '11px', color: '#a08868',
    }).setOrigin(1, 0).setDepth(41)

    // Bar
    const barX = textX
    const barY = py + PANEL_H - PADDING - BAR_H
    const barW = (px + PANEL_W - PADDING) - barX

    const barBg = s.add.rectangle(barX, barY, barW, BAR_H, BAR_BG, 1)
      .setOrigin(0).setDepth(41)
      .setStrokeStyle(1, BG_STROKE, 1)

    const barFill = s.add.rectangle(barX, barY, barW, BAR_H, this._barColor, 1)
      .setOrigin(0).setDepth(42)

    this._refs = { bg, portrait, nameLabel, hpLabel, barBg, barFill }
    this._barX = barX
    this._barY = barY
    this._barW = barW
  }

  update() {
    const boss = this._gameState.boss
    if (!boss) return
    const max = boss.maxHp ?? 0
    const cur = Math.max(0, boss.hp ?? 0)
    if (max <= 0) return

    const frac = Math.min(1, cur / max)

    // Spawn a ghost-trail rect on HP drop.
    if (this._lastHp !== null && cur < this._lastHp) {
      const x0 = this._barX + this._barW * (cur / max)
      const x1 = this._barX + this._barW * Math.min(1, this._lastHp / max)
      const w  = Math.max(1, Math.round(x1 - x0))
      const ghost = this._scene.add
        .rectangle(x0, this._barY, w, BAR_H, GHOST_COLOR, GHOST_ALPHA0)
        .setOrigin(0).setDepth(43)
      this._ghosts.push({ rect: ghost, bornAt: this._scene.time.now })
    }
    this._lastHp = cur

    // Fill width tracks current HP.
    this._refs.barFill.width = Math.max(0, Math.round(this._barW * frac))
    this._refs.hpLabel.setText(`${cur} / ${max}`)

    // Heartbeat — brightness pulse on the fill rect.
    const lowness = 1 - frac
    const period  = lerp(HB_PERIOD_FULL, HB_PERIOD_LOW, lowness)
    const amp     = lerp(HB_AMP_FULL,    HB_AMP_LOW,    lowness)
    const phase   = (this._scene.time.now % period) / period
    const t       = thump(phase) * amp
    this._refs.barFill.fillColor = blendTowardWhite(this._barColor, t)

    // Tick ghosts — fade alpha → destroy when expired.
    const now = this._scene.time.now
    this._ghosts = this._ghosts.filter(g => {
      const age = now - g.bornAt
      if (age >= GHOST_DURATION_MS) { g.rect.destroy(); return false }
      g.rect.setAlpha(GHOST_ALPHA0 * (1 - age / GHOST_DURATION_MS))
      return true
    })
  }

  destroy() {
    Object.values(this._refs ?? {}).forEach(r => r?.destroy?.())
    this._ghosts.forEach(g => g.rect.destroy())
    this._ghosts = []
    this._refs = null
  }
}

function lerp(a, b, t) { return a + (b - a) * t }

// Double-pulse waveform (lub-dub). p in [0,1]; returns 0..1-ish.
function thump(p) {
  const g = (c, w) => Math.exp(-((p - c) * (p - c)) / (w * w))
  return g(0.06, 0.04) + 0.7 * g(0.20, 0.04)
}

function blendTowardWhite(color, t) {
  const r = (color >> 16) & 0xff
  const g = (color >> 8)  & 0xff
  const b = color & 0xff
  const k = Math.min(1, Math.max(0, t))
  const nr = Math.round(r + (255 - r) * k)
  const ng = Math.round(g + (255 - g) * k)
  const nb = Math.round(b + (255 - b) * k)
  return (nr << 16) | (ng << 8) | nb
}

function parseColor(c, fallback) {
  if (typeof c === 'number') return c
  if (typeof c === 'string') {
    const s = c.startsWith('0x') || c.startsWith('0X') ? c.slice(2) : c
    const n = parseInt(s, 16)
    if (!Number.isNaN(n)) return n
  }
  return fallback
}
