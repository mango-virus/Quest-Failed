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
    // Companion cards override `accent` with the companion's own
    // `--cmp-accent` color when available — see `_themeFor` below.
    accent: 'var(--blood)',
    banner: '♥  NEW COMPANION  ♥',
    sfx:    'unlock_reward',
  },
  title: {
    accent: 'var(--gold-bright, #ffd964)',
    banner: '✦  NEW TITLE  ✦',
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
    this._overlay = new Overlay({
      // The shell title stays generic — the per-card banner (which
      // changes type-to-type as the player advances) lives INSIDE the
      // body so it can be swapped without rebuilding the shell. The
      // shell's accent is fixed to the first card's color since the
      // shell doesn't expose a per-frame setter; the per-type theming
      // shows up via the card body's data-type styling instead.
      title:     '✦  UNLOCK  ✦',
      // Compact modal — tightened 560×580 → 460×480 so the celebration
      // reads as an intimate spotlight rather than a half-empty dialog.
      // The card inside fills the box; padding + per-element sizing in
      // styles.css does the rest.
      width:     460,
      height:    480,
      accent:    theme.accent,
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

  // Resolve the theme for a queue entry. Companions can override the
  // accent with their own `--cmp-accent` token (jester-yellow for
  // Rattle Bones, twilight-violet for Nocturna, etc.) so the modal
  // glow matches the character.
  _themeFor(entry) {
    const base = TYPE_THEMES[entry?.type] ?? TYPE_THEMES.achievement
    if (entry?.type === 'companion' && entry?.id) {
      // Try the registry's accent first via a synthetic data attr; if
      // CSS doesn't have a per-companion --cmp-accent, the modal falls
      // back to the base blood accent (no visual harm).
      const cmpAccent = `var(--cmp-accent-${entry.id}, ${base.accent})`
      return { ...base, accent: cmpAccent }
    }
    return base
  }

  // The modal body — a single card whose internals dispatch on type.
  // Returns a DOM element ready to be passed as the shell's `body`.
  _renderCard(entry) {
    const total = this._queue.length
    const idx   = this._index + 1
    const theme = this._themeFor(entry)
    const card = h('div', {
      className: 'qf-unlock-card',
      dataset:   { type: entry?.type ?? 'unknown' },
      // Click anywhere on the card → next. The Overlay shell handles
      // backdrop-click separately (which fully closes — also fine).
      on: { click: () => this._onBodyClick() },
    }, [
      // Per-type banner. Lives inside the body so it swaps per card
      // without needing a shell-title setter (the shell doesn't have
      // one). Color comes from the card's data-type attribute via CSS.
      h('div', { className: 'pix qf-unlock-banner' }, theme.banner),
      // Centerpiece — boss portrait / companion sprite / achievement
      // icon / title chip, depending on type.
      this._renderArt(entry),
      // Name + subtitle row.
      h('div', { className: 'pix qf-unlock-name' }, this._nameFor(entry)),
      this._subtitleFor(entry) &&
        h('div', { className: 'qf-unlock-subtitle' }, this._subtitleFor(entry)),
      // Footer — queue counter + advance hint.
      h('div', { className: 'qf-unlock-footer' }, [
        h('span', { className: 'pix qf-unlock-counter' }, `${idx} / ${total}`),
        h('span', { className: 'pix qf-unlock-hint' },
          (idx === total) ? '› PRESS ENTER TO CLOSE'
                          : '› PRESS ENTER FOR NEXT'),
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
        // Titles don't have artwork — render the title text BIG inside
        // a styled chip. This is the centerpiece itself.
        return h('div', { className: 'qf-unlock-art qf-unlock-art--title' }, [
          h('div', { className: 'pix qf-unlock-art-title' }, entry.title || '—'),
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
      default:
        return ''
    }
  }
}
