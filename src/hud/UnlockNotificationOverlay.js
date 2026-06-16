// UnlockNotificationOverlay — full-screen celebratory takeover that drains
// the player's pending-unlocks queue one card at a time, with a per-type
// sound + a per-type centerpiece (boss portrait / companion sprite / title
// plate / achievement medal / leaderboard rank / demotion skull). Triggered
// by MainMenuOverlay on first main-menu open after a run that earned things.
//
// Queue source of truth: `PlayerProfile.getPendingUnlocks()`. The queue
// is filled by `AchievementSystem._unlock` during live in-game checks
// (NOT during the retroactive boot scan — see that file for the gate).
// Each entry: `{ type, id, achId?, title?, ts }`. Walked FIFO so the
// player sees them in earn-order.
//
// Player-paced: each card waits for Enter / Space / Z / click NEXT before
// advancing. Esc / SKIP ALL skips the entire remaining queue. On close, the
// queue is fully cleared regardless of how it ended — better to lose one
// celebration than nag the player every menu open with the same stack.

import { h, mount }           from './dom.js'
import { ensureStageScaled }  from './stageScale.js'
import { HudSfx }             from './HudSfx.js'
import { PlayerProfile }      from '../systems/PlayerProfile.js'
import { AchievementSystem }  from '../systems/AchievementSystem.js'
import { COMPANIONS }         from '../systems/companions.js'
import { UNLOCK_GATES }       from '../data/bossUnlocks.js'
import { titleFxClass }       from './titleFx.js'

// Per-type theming. Drives the per-card sfx (the accent now flows through
// _accentFor for the full-screen takeover, but the sfx cue still reads from
// here so the existing audio mapping is preserved verbatim).
const TYPE_THEMES = {
  achievement: { accent: 'var(--gold)',  banner: '◆  NEW ACHIEVEMENT  ◆', sfx: 'unlock_achievement' },
  boss:        { accent: 'var(--blood)', banner: '◆  NEW BOSS UNLOCKED  ◆', sfx: 'unlock_reward' },
  companion:   { accent: '#ff6fa3',      banner: '♥  NEW COMPANION  ♥',    sfx: 'unlock_reward' },
  title:       { accent: '#b85cff',      banner: '✦  NEW TITLE  ✦',        sfx: 'unlock_reward' },
  leaderboard: { accent: 'var(--gold-bright, #ffd964)', banner: '★  TOP 3  ★', sfx: 'unlock_reward' },
  demotion:    { accent: '#b3414f',      banner: '✖  DETHRONED  ✖',        sfx: 'demote' },
}

// Rank → sfx overrides for leaderboard cards. Resolved in _themeFor.
const LEADERBOARD_RANK_THEMES = {
  1: { accent: 'var(--gold-bright, #ffd964)', banner: '★ ★ ★   CHAMPION   ★ ★ ★', sfx: 'unlock_reward' },
  2: { accent: '#cad6e0', banner: '★ ★   RUNNER-UP   ★ ★', sfx: 'unlock_reward' },
  3: { accent: '#d18b4a', banner: '★   PODIUM FINISH   ★', sfx: 'unlock_reward' },
}

// Boss archetype display data. Pulled from the Phaser JSON cache at
// `bossArchetypes` (loaded in Preload) — same path the main menu uses
// for the saved-boss heading. We grab it lazily on first card render
// so the overlay can construct even before the cache is populated.
function _readBossArchetypes() {
  try {
    const scenes = window.__game?.scene?.scenes ?? []
    for (const s of scenes) {
      const archs = s.cache?.json?.get?.('bossArchetypes')
      if (Array.isArray(archs) && archs.length > 0) return archs
    }
  } catch {}
  return []
}

// Per-kind accent for the full-screen takeover. Mirrors the design's
// per-card colour (tier / rank / kind), distinct from the legacy TYPE_THEMES.
const TIER_COLOR = { gold: '#ffd86a', silver: '#c8c8d0', bronze: '#c8884a' }
const RANK_ACCENT = (r) => r === 1 ? '#ffd86a' : r === 2 ? '#c8c8d0' : '#c8884a'

const UN_HEADERS = {
  achievement: 'ACHIEVEMENT UNLOCKED',
  boss:        'NEW BOSS UNLOCKED',
  companion:   'NEW COMPANION',
  title:       'NEW TITLE EARNED',
}

export class UnlockNotificationOverlay {
  constructor(opts = {}) {
    this._onClose = opts.onClose ?? null
    this._queue   = []
    this._index   = 0
    this._layer   = null
    this._keyHandler = (e) => this._onKey(e)
  }

  // Full-screen celebratory takeover that steps through the pending-unlocks
  // queue one card at a time. Returns false (and skips) if the queue is empty.
  open() {
    if (this._layer) return false
    ensureStageScaled()
    this._queue = PlayerProfile.getPendingUnlocks() || []
    if (this._queue.length === 0) return false
    this._index = 0
    const stage = document.getElementById('hud-stage') || document.body
    this._layer = h('div', { className: 'qf-un-layer' })
    stage.appendChild(this._layer)
    this._renderCurrent()
    window.addEventListener('keydown', this._keyHandler, true)
    // First card's chime lands just after the layer fades in.
    setTimeout(() => { if (this._layer) HudSfx.playUi(this._themeFor(this._queue[0]).sfx) }, 150)
    return true
  }

  close() {
    if (!this._layer) return
    window.removeEventListener('keydown', this._keyHandler, true)
    this._layer.remove()
    this._layer = null
    // Clear regardless of how it ended — never replay the same stack.
    try { PlayerProfile.clearPendingUnlocks() } catch {}
    this._onClose?.()
  }

  destroy() { this.close() }

  _onKey(e) {
    if (!this._layer) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'z' || e.key === 'Z') {
      e.preventDefault()
      this._advance()
    }
  }

  _advance() {
    this._index += 1
    if (this._index >= this._queue.length) { this.close(); return }
    this._renderCurrent()
    HudSfx.playUi(this._themeFor(this._queue[this._index]).sfx)
  }

  // ── Render ───────────────────────────────────────────────────────────
  _renderCurrent() {
    if (!this._layer) return
    const entry  = this._queue[this._index]
    const accent = this._accentFor(entry)
    const isDown = entry?.type === 'demotion'
    const total  = this._queue.length
    const idx    = this._index
    const last   = idx >= total - 1
    this._layer.style.setProperty('--uc', accent)
    mount(this._layer, [
      h('div', { className: 'qf-un-rays' }),
      h('div', { className: 'qf-un-burst' }),
      h('div', { className: 'qf-un-confetti' }, this._confettiPieces(accent, isDown)),
      total > 1 && h('button', { className: 'pix qf-un-skip', on: { click: () => this.close() } }, 'SKIP ALL ✕'),
      h('div', { className: 'qf-un-card' }, [
        h('div', { className: 'sil qf-un-eyebrow' }, [
          h('span', { className: 'ln' }), this._headerFor(entry), h('span', { className: 'ln r' }),
        ]),
        ...this._unBody(entry, accent),
      ]),
      h('div', { className: 'qf-un-nav' }, [
        total > 1 && h('div', { className: 'qf-un-dots' },
          this._queue.map((_, k) => h('span', { className: 'qf-un-dot' + (k === idx ? ' on' : k < idx ? ' done' : '') }))),
        h('button', { className: 'pix qf-un-next', on: { click: () => this._advance() } },
          last ? (isDown ? 'DISMISS' : 'CLAIM  ✦') : `NEXT  ▶  (${idx + 1}/${total})`),
      ].filter(Boolean)),
    ].filter(Boolean))
  }

  _headerFor(entry) {
    if (entry?.type === 'leaderboard') return `YOU REACHED #${entry.rank ?? 3}`
    if (entry?.type === 'demotion')    return entry.toRank ? 'YOU SLIPPED' : 'DETHRONED'
    return UN_HEADERS[entry?.type] || 'UNLOCK'
  }

  _accentFor(entry) {
    switch (entry?.type) {
      case 'demotion':    return '#e0566e'
      case 'leaderboard': return RANK_ACCENT(entry.rank ?? 3)
      case 'achievement': {
        const def = AchievementSystem.getDefinition?.(entry.id)
        return TIER_COLOR[def?.legendary ? 'gold' : 'silver']
      }
      case 'companion':   return '#ff6ba0'
      case 'title':       return '#ffd964'
      default:            return 'var(--blood)'
    }
  }

  // Per-kind card body (array of elements under the eyebrow header).
  _unBody(entry, accent) {
    const viaName = (achId) => achId ? (AchievementSystem.getDefinition?.(achId)?.name) : null
    switch (entry?.type) {
      case 'achievement': {
        const def  = AchievementSystem.getDefinition?.(entry.id) || {}
        const tier = def.legendary ? 'GOLD' : 'SILVER'
        return [
          h('div', { className: 'qf-un-medal' }, [
            h('span', { className: 'ic' }, def.icon || '★'),
            h('span', { className: 'pix seal' }, '✓'),
          ]),
          h('div', { className: 'pix qf-un-name' }, this._nameFor(entry)),
          def.description && h('div', { className: 'qf-un-desc' }, def.description),
          h('div', { className: 'sil qf-un-tierchip', style: { color: accent, borderColor: accent } }, tier + ' TROPHY'),
        ].filter(Boolean)
      }
      case 'boss': {
        const id  = String(entry.id || '').replace(/^the_/, '')
        const via = viaName(entry.achId)
        const sub = this._subtitleFor(entry)
        return [
          h('div', { className: 'qf-un-frame' }, [this._portrait(id, 132)]),
          h('div', { className: 'pix qf-un-name' }, this._nameFor(entry)),
          sub && h('div', { className: 'qf-un-desc' }, sub),
          via && h('div', { className: 'sil qf-un-via' }, ['◆ Earned via ', h('b', null, via)]),
          h('div', { className: 'qf-un-hint' }, 'A new archetype to reign as. Choose it on your next NEW EVIL.'),
        ].filter(Boolean)
      }
      case 'companion': {
        const cmp = COMPANIONS[entry.id] || {}
        const src = cmp.spriteDir ? `${cmp.spriteDir}idle.webp` : ''
        const via = viaName(entry.achId)
        return [
          h('div', { className: 'qf-un-frame comp' }, [
            h('div', { className: 'qf-un-ph' }, [h('span', { className: 'pix ic' }, '♛')]),
            src && h('img', {
              className: 'qf-un-compimg', src, alt: cmp.name || '',
              on: { error: (e) => { e.currentTarget.style.display = 'none' } },
            }),
          ].filter(Boolean)),
          cmp.role && h('div', { className: 'sil qf-un-role', style: { color: accent } }, cmp.role),
          h('div', { className: 'pix qf-un-name' }, this._nameFor(entry)),
          cmp.tagline && h('div', { className: 'qf-un-desc' }, cmp.tagline),
          via && h('div', { className: 'sil qf-un-via' }, ['♥ Earned via ', h('b', null, via)]),
        ].filter(Boolean)
      }
      case 'title': {
        const fxCls = entry.titleFx ? titleFxClass(entry.titleFx) : ''
        const nameStyle = (!entry.titleFx && entry.titleColor) ? { color: entry.titleColor } : { color: accent }
        return [
          h('div', { className: 'qf-un-titleglyph' }, '✦'),
          h('div', { className: 'pix qf-un-titleplate', style: { borderColor: accent } }, [
            h('span', { className: fxCls, style: nameStyle }, entry.title || this._nameFor(entry)),
          ]),
          this._subtitleFor(entry) && h('div', { className: 'qf-un-via' }, this._subtitleFor(entry)),
          h('div', { className: 'qf-un-hint' }, 'Equip it from the Hall of Trophies to wear it on the leaderboard.'),
        ].filter(Boolean)
      }
      case 'leaderboard': {
        const rank   = entry.rank ?? 3
        const bossId = String(entry.bossId || '').replace(/^the_/, '')
        const kp     = entry.companionId ? (COMPANIONS[entry.companionId]?.name) : null
        const stat = (label, val, color) => h('span', null, [
          h('i', null, label), h('b', { style: color ? { color } : undefined }, String(val ?? '?')),
        ])
        return [
          h('div', { className: 'pix qf-un-rankbig', style: { color: accent } }, '#' + rank),
          h('div', { className: 'qf-un-frame lb', style: { borderColor: accent } }, [
            h('span', { className: 'crown', style: { color: accent } }, '♛'),
            this._portrait(bossId, 96),
          ]),
          h('div', { className: 'pix qf-un-name' }, this._nameFor(entry)),
          h('div', { className: 'qf-un-hint' }, 'You climbed onto the Hall of Evil podium.'),
          h('div', { className: 'qf-un-stats' }, [
            stat('BOSS LV', entry.bossLevel, 'var(--gold)'),
            stat('DAYS', entry.days),
            stat('KILLS', entry.kills, 'var(--blood-glow)'),
            kp && stat('KEEPER', kp),
          ].filter(Boolean)),
        ]
      }
      case 'demotion':
      default: {
        return [
          h('div', { className: 'qf-un-skull' }, '☠'),
          h('div', { className: 'qf-un-demorow' }, [
            h('span', { className: 'pix r from' }, '#' + (entry.fromRank ?? 1)),
            h('span', { className: 'arr' }, '▶'),
            h('span', { className: 'pix r to' }, entry.toRank ? '#' + entry.toRank : 'OFF PODIUM'),
          ]),
          h('div', { className: 'pix qf-un-name', style: { color: '#e0566e' } },
            entry.toRank ? 'Another keeper surpassed you.' : 'You were cast from the podium.'),
          h('div', { className: 'qf-un-hint' }, 'Begin a new run and take back what is yours.'),
        ]
      }
    }
  }

  _portrait(id, size) {
    const clean = String(id || '').replace(/^the_/, '')
    return h('img', {
      src: `assets/ui/bestiary/portraits/${clean}_p.png`, alt: '',
      style: { width: `${size}px`, height: `${size}px`, objectFit: 'contain', imageRendering: 'pixelated', display: 'block' },
      on: { error: (e) => { e.currentTarget.style.visibility = 'hidden' } },
    })
  }

  _confettiPieces(accent, isDown) {
    const cols = isDown
      ? ['#5a4a4e', '#3a3034', '#6a5345']
      : [accent, '#ffd964', '#e8dcc8', '#ff6ba0', '#5cc8d8']
    const out = []
    for (let k = 0; k < 46; k++) {
      const left  = (k * 2.17 + (k % 7) * 3.3) % 100
      const delay = (k % 11) * 0.32
      const dur   = 2.6 + (k % 5) * 0.55
      const size  = isDown ? 4 + (k % 3) * 2 : 6 + (k % 4) * 3
      const rot   = (k * 47) % 360
      const col   = cols[k % cols.length]
      const round = k % 3 === 0
      out.push(h('span', {
        className: 'qf-un-piece',
        style: {
          left: left + '%', width: size + 'px', height: size + 'px',
          background: col, borderRadius: round ? '50%' : '0',
          transform: `rotate(${rot}deg)`,
          animationDelay: delay + 's', animationDuration: dur + 's',
          boxShadow: isDown ? 'none' : `0 0 6px ${col}`,
        },
      }))
    }
    return out
  }

  _themeFor(entry) {
    if (entry?.type === 'leaderboard') {
      return LEADERBOARD_RANK_THEMES[entry.rank] ?? TYPE_THEMES.leaderboard
    }
    return TYPE_THEMES[entry?.type] ?? TYPE_THEMES.achievement
  }

  _nameFor(entry) {
    if (!entry) return ''
    switch (entry.type) {
      case 'achievement': return (AchievementSystem.getDefinition?.(entry.id)?.name) || entry.id
      case 'companion':   return (COMPANIONS[entry.id]?.name) || entry.id
      case 'boss': {
        const archs = _readBossArchetypes()
        return (archs.find(a => a.id === entry.id)?.name) || entry.id
      }
      case 'title': return entry.title || ''
      case 'leaderboard': {
        const archs = _readBossArchetypes()
        const rawId    = String(entry.bossId || '').toLowerCase()
        const stripped = rawId.replace(/^the_/, '')
        const arch = archs.find(a => {
          const aId = String(a?.id || '').toLowerCase()
          return aId === rawId || aId === stripped || aId.replace(/^the_/, '') === stripped
        })
        if (arch?.name) return arch.name
        return (rawId || 'your reign').replace(/_/g, ' ').toUpperCase()
      }
      default: return entry.id || ''
    }
  }

  _subtitleFor(entry) {
    if (!entry) return ''
    switch (entry.type) {
      case 'achievement': return (AchievementSystem.getDefinition?.(entry.id)?.description) || ''
      case 'companion':   return (COMPANIONS[entry.id]?.tagline) || ''
      case 'boss': {
        const archs = _readBossArchetypes()
        const arch  = archs.find(a => a.id === entry.id)
        const fallbackGate = Object.values(UNLOCK_GATES).find(g => g?.achId === entry.achId)
        return arch?.tagline || arch?.summary || fallbackGate?.label || ''
      }
      case 'title': {
        const def = AchievementSystem.getDefinition?.(entry.achId)
        return def?.name ? `Earned via ${def.name}` : ''
      }
      default: return ''
    }
  }
}
