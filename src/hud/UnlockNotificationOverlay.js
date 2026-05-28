// UnlockNotificationOverlay — celebration modal that drains the player's
// pending-unlocks queue one card at a time, with a per-type sound + a
// per-type visual (boss portrait / companion sprite / title chip /
// achievement icon). Triggered by MainMenuOverlay on first main-menu
// open after a run that earned new things.
//
// Queue source of truth: `PlayerProfile.getPendingUnlocks()`. The queue
// is filled by `AchievementSystem._unlock` during live in-game checks
// (NOT during the retroactive boot scan — see that file for the gate).
// Each entry: `{ type, id, achId?, title?, ts }`. Walked FIFO so the
// player sees them in earn-order.
//
// Player-paced: each card waits for Enter / Space / click before
// advancing. Esc skips the entire remaining queue. On close, the queue
// is fully cleared regardless of how it ended — better to lose one
// celebration than nag the player every menu open with the same stack.

import { h }                  from './dom.js'
import { ensureStageScaled }  from './stageScale.js'
import { Overlay }            from './Overlay.js'
import { HudSfx }             from './HudSfx.js'
import { PlayerProfile }      from '../systems/PlayerProfile.js'
import { AchievementSystem }  from '../systems/AchievementSystem.js'
import { COMPANIONS }         from '../systems/companions.js'
import { UNLOCK_GATES }       from '../data/bossUnlocks.js'

// Per-type theming. Drives the modal accent + the type-banner label
// shown at the top of every card. The accent string is a CSS var (or
// resolved color) — Overlay accepts var() values for its border glow.
const TYPE_THEMES = {
  achievement: {
    accent: 'var(--gold)',
    banner: '◆  NEW ACHIEVEMENT  ◆',
    sfx:    'unlock_achievement',
  },
  boss: {
    accent: 'var(--blood)',
    banner: '◆  NEW BOSS UNLOCKED  ◆',
    sfx:    'unlock_reward',
  },
  companion: {
    // Companion cards use a unified PINK accent (2026-05-27) for the
    // banner / name / frame glow. The per-companion --cmp-accent
    // override that used to drive jester-yellow / twilight-violet
    // banners is intentionally retired — keeps the "new companion"
    // moment visually consistent across the cast.
    accent: '#ff6fa3',
    banner: '♥  NEW COMPANION  ♥',
    sfx:    'unlock_reward',
  },
  title: {
    // Title cards switched gold-bright → PURPLE (2026-05-27) so they
    // read distinctly from achievement (gold) cards. The achievement
    // card stays gold; titles now own purple.
    accent: '#b85cff',
    banner: '✦  NEW TITLE  ✦',
    sfx:    'unlock_reward',
  },
  // Leaderboard top-3 celebration. The actual accent + banner are
  // resolved dynamically in _themeFor based on the entry's `rank`
  // field (1 = gold/champion, 2 = silver/runner-up, 3 = bronze/podium).
  // This entry holds the fallback values used if rank is missing.
  leaderboard: {
    accent: 'var(--gold-bright, #ffd964)',
    banner: '★  TOP 3  ★',
    sfx:    'unlock_reward',
  },
}

// Rank → theme overrides for leaderboard cards. Resolved in _themeFor.
const LEADERBOARD_RANK_THEMES = {
  1: {
    accent: 'var(--gold-bright, #ffd964)',
    banner: '★ ★ ★   CHAMPION   ★ ★ ★',
    sfx:    'unlock_reward',
  },
  2: {
    accent: '#cad6e0',   // silver
    banner: '★ ★   RUNNER-UP   ★ ★',
    sfx:    'unlock_reward',
  },
  3: {
    accent: '#d18b4a',   // bronze
    banner: '★   PODIUM FINISH   ★',
    sfx:    'unlock_reward',
  },
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

export class UnlockNotificationOverlay {
  constructor(opts = {}) {
    this._onClose  = opts.onClose ?? null
    this._queue    = []
    this._index    = 0
    this._overlay  = null
    this._cardEl   = null
    this._keyHandler = (e) => this._onKey(e)
  }

  // Open the overlay with whatever's currently in the pending-unlocks
  // queue. Called from MainMenuOverlay.open() if `getPendingUnlocks()`
  // is non-empty. Returns false (and skips opening) if the queue is
  // empty — caller doesn't need to gate, but we do anyway as defense.
  open() {
    if (this._overlay) return false
    ensureStageScaled()
    this._queue = PlayerProfile.getPendingUnlocks() || []
    if (this._queue.length === 0) return false
    this._index = 0
    const first = this._queue[0]
    const theme = this._themeFor(first)
    const body  = this._renderCard(first)
    this._cardEl = body
    // When a top-3 celebration card is queued anywhere, upsize the
    // shell + retitle it so the finale has room to breathe and reads
    // as a HALL OF FAME moment rather than a generic unlock. Cards
    // that come before it (achievements / companions / etc.) still
    // render inside the same shell — extra room is a strict upgrade
    // for them too.
    const hasLeaderboard = this._queue.some(e => e?.type === 'leaderboard')
    this._overlay = new Overlay({
      // The shell title stays generic — the per-card banner (which
      // changes type-to-type as the player advances) lives INSIDE the
      // body so it can be swapped without rebuilding the shell.
      title:     hasLeaderboard ? '★  HALL OF FAME  ★' : '✦  UNLOCK  ✦',
      // Compact modal — tightened 560×580 → 460×480 so the celebration
      // reads as an intimate spotlight rather than a half-empty dialog.
      // The card inside fills the box; padding + per-element sizing in
      // styles.css does the rest. Leaderboard finales upsize the shell
      // so the dramatic centerpiece has room to live.
      width:     hasLeaderboard ? 560 : 460,
      height:    hasLeaderboard ? 620 : 480,
      // Modal shell border stays fixed blood-red across all card types
      // so the OUTER chrome reads as a consistent "unlock" frame. The
      // per-type accent (gold / blood / gold-bright / --cmp-accent)
      // shows up INSIDE the card on the banner / art / name / button.
      accent:    'var(--blood)',
      // 'unfurl' is the same dramatic flourish the achievements +
      // leaderboard popups use — fits the celebratory tone here.
      animation: 'unfurl',
      onClose:   () => this._onOverlayClose(),
      body,
    })
    this._overlay.open()
    // Play the first card's sfx after the overlay's unfurl visuals
    // begin — a tiny delay so the chime lands ON the card scale-in
    // peak rather than during the empty backdrop fade-in.
    setTimeout(() => HudSfx.playUi(theme.sfx), 150)
    window.addEventListener('keydown', this._keyHandler)
    return true
  }

  close() { this._overlay?.close() }

  // ── Card advancement ────────────────────────────────────────────────

  _onKey(e) {
    if (!this._overlay) return
    if (e.key === 'Escape') {
      // Skip the rest of the queue. Standard "give me back control"
      // affordance — better than forcing the player to click through
      // 8 cards. The queue gets fully cleared in close() either way.
      e.preventDefault()
      this.close()
      return
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      this._advance()
    }
  }

  // Click anywhere on the modal body also advances. Bound via the body's
  // onClick handler in _renderCard so backdrop clicks (handled by the
  // shell) still close-all instead of advancing.
  _onBodyClick() {
    this._advance()
  }

  _advance() {
    this._index += 1
    if (this._index >= this._queue.length) {
      this.close()
      return
    }
    const next  = this._queue[this._index]
    const theme = this._themeFor(next)
    // Swap the body subtree — banner / centerpiece / name / counter
    // all repaint with the new card's content. The Overlay shell keeps
    // its first-card border accent (the shell doesn't expose a per-
    // frame setter), but the card body uses data-type theming so the
    // per-type read is still clear.
    const fresh = this._renderCard(next)
    if (this._cardEl?.parentNode) {
      this._cardEl.parentNode.replaceChild(fresh, this._cardEl)
    }
    this._cardEl = fresh
    HudSfx.playUi(theme.sfx)
  }

  _onOverlayClose() {
    window.removeEventListener('keydown', this._keyHandler)
    // Clear the queue regardless of how the close happened. Even if the
    // player Esc'd partway through, we don't replay; the achievements
    // popup / companion select / archetype select are the persistent
    // surfaces where they can re-browse the unlocks.
    try { PlayerProfile.clearPendingUnlocks() } catch {}
    this._overlay = null
    this._cardEl  = null
    this._onClose?.()
  }

  // ── Per-entry theme + card builders ─────────────────────────────────

  // Resolve the theme for a queue entry. Companions used to override
  // their accent with the per-companion `--cmp-accent` token (jester
  // yellow for Rattle Bones, twilight-violet for Nocturna, etc.) but
  // the unified pink accent (2026-05-27) makes the "new companion"
  // beat read consistently across the cast — the override is retired.
  // Per-type accents now flow straight from TYPE_THEMES.
  _themeFor(entry) {
    // Leaderboard cards have rank-specific theming (gold/silver/bronze)
    // — fall back to the generic 'leaderboard' theme if rank is missing.
    if (entry?.type === 'leaderboard') {
      return LEADERBOARD_RANK_THEMES[entry.rank] ?? TYPE_THEMES.leaderboard
    }
    return TYPE_THEMES[entry?.type] ?? TYPE_THEMES.achievement
  }

  // The modal body — a single card whose internals dispatch on type.
  // Returns a DOM element ready to be passed as the shell's `body`.
  _renderCard(entry) {
    const total = this._queue.length
    const idx   = this._index + 1
    const theme = this._themeFor(entry)
    const isLb  = entry?.type === 'leaderboard'
    // Per-rank dramatic headlines that REPLACE the small chip banner
    // for leaderboard cards. The chip works for achievement/boss/etc.
    // because each card is "look what unlocked"; the top-3 celebration
    // needs to scream PODIUM. The two-line layout reads as a real
    // award-ceremony title rather than a metadata label.
    const LB_HEADLINES = {
      1: { eyebrow: '★   TOP 3 LEADERBOARD   ★', big: 'CHAMPION'      },
      2: { eyebrow: '★   TOP 3 LEADERBOARD   ★', big: 'RUNNER-UP'     },
      3: { eyebrow: '★   TOP 3 LEADERBOARD   ★', big: 'PODIUM FINISH' },
    }
    const lbCopy = isLb ? (LB_HEADLINES[entry.rank] || LB_HEADLINES[3]) : null
    const card = h('div', {
      className: 'qf-unlock-card',
      dataset:   { type: entry?.type ?? 'unknown' },
      // Click anywhere on the card → next. The Overlay shell handles
      // backdrop-click separately (which fully closes — also fine).
      on: { click: () => this._onBodyClick() },
    }, [
      // Per-type banner. Lives inside the body so it swaps per card
      // without needing a shell-title setter (the shell doesn't have
      // one). Leaderboard uses a big two-line headline; other types
      // use the compact chip banner.
      isLb
        ? h('div', { className: 'qf-unlock-lb-headline' }, [
            h('div', { className: 'pix qf-unlock-lb-headline-top' }, lbCopy.eyebrow),
            h('div', { className: 'pix qf-unlock-lb-headline-big' }, lbCopy.big),
          ])
        : h('div', { className: 'pix qf-unlock-banner' }, theme.banner),
      // Centerpiece — boss portrait / companion sprite / achievement
      // icon / title chip, depending on type.
      this._renderArt(entry),
      // Name + subtitle row.
      h('div', { className: 'pix qf-unlock-name' }, this._nameFor(entry)),
      this._subtitleFor(entry) &&
        h('div', { className: 'qf-unlock-subtitle' }, this._subtitleFor(entry)),
      // Footer — counter in the bottom-LEFT corner (position: absolute),
      // button centered horizontally on the same row. The grid-like
      // layout means the button stays dead-centered regardless of the
      // counter's width ("1 / 2" vs "10 / 12"). Enter / Space and the
      // card click-anywhere shortcut still advance too.
      // stopPropagation on the button's click prevents the card-level
      // click handler from also firing (which would skip two cards).
      h('div', { className: 'qf-unlock-footer' }, [
        h('span', { className: 'pix qf-unlock-counter' }, `${idx} / ${total}`),
        h('button', {
          className: 'btn qf-unlock-next' + (isLb ? ' qf-unlock-next--lb' : ''),
          on: {
            click: (e) => {
              e.stopPropagation()
              this._advance()
            },
          },
        }, isLb
            ? 'CLAIM GLORY  ✦'
            : ((idx === total) ? 'CLOSE  ✖' : 'NEXT  ›')),
      ]),
    ])
    return card
  }

  _renderArt(entry) {
    if (!entry) return h('div', { className: 'qf-unlock-art' })
    switch (entry.type) {
      case 'achievement': {
        const def = AchievementSystem.getDefinition?.(entry.id)
        // Achievement icons are emoji strings in the def. Fallback to
        // the trophy glyph for any def-less queue entries (shouldn't
        // happen — defensive).
        const icon = def?.icon ?? '🏆'
        return h('div', { className: 'qf-unlock-art qf-unlock-art--achievement' }, [
          h('div', { className: 'qf-unlock-art-icon' }, icon),
        ])
      }
      case 'companion': {
        const cmp = COMPANIONS[entry.id]
        // Use the baked idle.webp from the companion's sprite dir. The
        // CompanionSelect screen does the same. If the file is missing
        // (e.g. art still in progress for a locked teaser that just
        // unlocked), the broken-img fallback handler hides it and the
        // name still shows.
        const src = cmp?.spriteDir ? `${cmp.spriteDir}idle.webp` : ''
        return h('div', { className: 'qf-unlock-art qf-unlock-art--companion' }, [
          src
            ? h('img', {
                className: 'qf-unlock-art-img',
                src,
                alt: cmp?.name || entry.id,
                // Hide the img if it fails to load — the card still
                // reads coherently with just the name + tagline.
                on: { error: (e) => { e.currentTarget.style.display = 'none' } },
              })
            : h('div', { className: 'qf-unlock-art-placeholder' }, '♥'),
        ])
      }
      case 'boss': {
        const id = String(entry.id || '').replace(/^the_/, '')
        return h('div', { className: 'qf-unlock-art qf-unlock-art--boss' }, [
          h('div', {
            className: 'qf-unlock-art-img',
            style: {
              backgroundImage:  `url('assets/ui/bestiary/portraits/${id}_p.png')`,
              backgroundSize:   'contain',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              imageRendering:   'pixelated',
            },
          }),
        ])
      }
      case 'title': {
        // Crown glyph as the centerpiece so the card reads the same
        // structure as the other three types (icon/portrait in the
        // frame, text NAME below). The title text itself moves to the
        // name slot. Previously this duplicated the title in both
        // slots — confusing repetition.
        return h('div', { className: 'qf-unlock-art qf-unlock-art--title' }, [
          h('div', { className: 'qf-unlock-art-icon' }, '👑'),
        ])
      }
      case 'leaderboard': {
        // Layered stage:
        //   0  sunburst — slow rotating conic-gradient godrays
        //   1  rings — three concentric pulses rippling outward
        //   2  bossart — DIMMED watermark backdrop (the boss looms)
        //   3  confetti — 12 multi-color particles
        //   4  stamp — medal glyph + giant rank number front-and-center
        // The portrait moving to a watermark (vs the original tiny
        // corner inset) makes the boss part of the celebration scene
        // instead of a side-note, and gives the badge real estate to
        // grow into the hero element.
        const rank = entry.rank ?? 3
        const bossId = String(entry.bossId || '').replace(/^the_/, '')
        const medalGlyph = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'
        return h('div', {
          className: 'qf-unlock-art qf-unlock-art--leaderboard',
          dataset:   { rank: String(rank) },
        }, [
          // Rotating sunburst godrays. Repeating-conic-gradient gives
          // a 15-ray star pattern; the spin animation rotates it slowly
          // so light sweeps continuously across the card.
          h('div', { className: 'qf-unlock-lb-sunburst' }),
          // Ripple rings — three concentric pulses staggered so a new
          // ring starts every ~0.8s. Reads as a "energy" radiating from
          // the rank stamp.
          h('div', { className: 'qf-unlock-lb-rings' }, [
            h('span'), h('span'), h('span'),
          ]),
          // Boss portrait — dimmed watermark backdrop filling the
          // frame. Reminds the player WHICH run earned the slot while
          // not stealing focus from the rank stamp on top.
          bossId
            ? h('div', {
                className: 'qf-unlock-lb-bossart',
                style: {
                  backgroundImage:  `url('assets/ui/bestiary/portraits/${bossId}_p.png')`,
                  backgroundSize:   'contain',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'center',
                  imageRendering:   'pixelated',
                },
              })
            : null,
          // Confetti sparkles — 12 particles, alternating accent-color
          // and white via nth-child selectors in CSS.
          h('div', { className: 'qf-unlock-lb-confetti' }, [
            h('span'), h('span'), h('span'), h('span'),
            h('span'), h('span'), h('span'), h('span'),
            h('span'), h('span'), h('span'), h('span'),
          ]),
          // The stamp — medal emoji bobbing above the giant rank
          // number. Stacked vertically so the medal is the "look at me"
          // attention-grabber and the rank is the punchline.
          h('div', { className: 'qf-unlock-lb-stamp' }, [
            h('div', { className: 'qf-unlock-lb-medal' }, medalGlyph),
            h('div', { className: 'pix qf-unlock-lb-rank' }, `#${rank}`),
          ]),
        ])
      }
      default:
        return h('div', { className: 'qf-unlock-art' })
    }
  }

  // Display name for the centerpiece. Achievement uses the def name;
  // companion uses the registry name; boss looks up the archetype name;
  // title shows the title text again (centerpiece IS the title, so the
  // name slot reads "TITLE EARNED" instead of duplicating).
  _nameFor(entry) {
    if (!entry) return ''
    switch (entry.type) {
      case 'achievement':
        return (AchievementSystem.getDefinition?.(entry.id)?.name) || entry.id
      case 'companion':
        return (COMPANIONS[entry.id]?.name) || entry.id
      case 'boss': {
        const archs = _readBossArchetypes()
        const arch  = archs.find(a => a.id === entry.id)
        return arch?.name || entry.id
      }
      case 'title':
        return entry.title || ''
      case 'leaderboard': {
        // Show the boss archetype name so the player remembers WHICH
        // run made the podium. The leaderboard rows + the test fire
        // path both pass `boss_id` values that may carry the legacy
        // `the_` prefix ('the_lich') OR be stripped ('lich'), so look
        // up by both. Final fallback humanises the id ('the_lich' →
        // 'THE LICH') so the player never sees a raw underscored key.
        const archs = _readBossArchetypes()
        const rawId    = String(entry.bossId || '').toLowerCase()
        const stripped = rawId.replace(/^the_/, '')
        const arch = archs.find(a => {
          const aId = String(a?.id || '').toLowerCase()
          return aId === rawId
              || aId === stripped
              || aId.replace(/^the_/, '') === stripped
        })
        if (arch?.name) return arch.name
        return (rawId || 'your reign').replace(/_/g, ' ').toUpperCase()
      }
      default:
        return entry.id || ''
    }
  }

  // Subtitle text — flavorful one-liner per type.
  _subtitleFor(entry) {
    if (!entry) return ''
    switch (entry.type) {
      case 'achievement':
        return (AchievementSystem.getDefinition?.(entry.id)?.description) || ''
      case 'companion':
        return (COMPANIONS[entry.id]?.tagline) || ''
      case 'boss': {
        const archs = _readBossArchetypes()
        const arch  = archs.find(a => a.id === entry.id)
        // Bosses store their summary line in `tagline` (per the bestiary
        // dossier). Fall back to the unlock-gate label so even bosses
        // without copy still have a subtitle.
        const fallbackGate = Object.values(UNLOCK_GATES).find(g => g?.achId === entry.achId)
        return arch?.tagline || arch?.summary || fallbackGate?.label || ''
      }
      case 'title': {
        const def = AchievementSystem.getDefinition?.(entry.achId)
        return def?.name ? `Earned via ${def.name}` : ''
      }
      case 'leaderboard': {
        // Run summary line — mirrors the columns shown in the
        // leaderboard table (boss level / days survived / kills) so
        // the player sees the same stats that earned them the slot.
        const lv    = entry.bossLevel ?? '?'
        const days  = entry.days      ?? '?'
        const kills = entry.kills     ?? '?'
        return `Boss Lv ${lv}  ·  ${days} days  ·  ${kills} kills`
      }
      default:
        return ''
    }
  }
}
