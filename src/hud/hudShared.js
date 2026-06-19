// hudShared.js — small cross-screen helpers consolidated from per-overlay copies
// (UI_POLISH_PLAN P4-2). Several HUD surfaces each carried their own (drift-prone)
// copy of this logic/colour; this is the single source of truth.

import { h } from './dom.js'

// MVP minion = the placed minion with the most lifetime kills. Used by the
// result screens (PostWaveOverlay + GameOverOverlay). Null for an empty roster.
export function mvpMinion(minions) {
  const list = minions ?? []
  if (!list.length) return null
  return list.reduce((best, m) =>
    (m.lifetime?.kills ?? 0) > (best?.lifetime?.kills ?? 0) ? m : best, null)
}

// Per-rank leaderboard colour — gold/silver/bronze for the top 3, neutral for
// the rest. Shared by LeaderboardOverlay + AchievementsOverlay so the achievement
// leaderboard reads identically to the main run-leaderboard.
export function rankColor(rank) {
  if (rank === 1) return '#ffd86a'   // hex-ok: leaderboard rank gold
  if (rank === 2) return '#c8c8d0'   // hex-ok: leaderboard rank silver
  if (rank === 3) return '#c8884a'   // hex-ok: leaderboard rank bronze
  if (rank <= 10) return 'var(--text)'
  return 'var(--text-mute)'
}

// Boss bestiary-portrait tile for leaderboard rows. Strips the legacy `the_`
// prefix; the portrait paints via background-image (a 404 just leaves the box).
// `className` lets each surface keep its own frame styling (the run-leaderboard
// uses qf-lb-portrait-img; the achievement leaderboard qf-ach-lb-portrait-img).
export function bossPortrait(bossId, size, className = 'qf-lb-portrait-img') {
  const id = String(bossId || '').replace(/^the_/, '')
  return h('div', {
    className,
    style: {
      width:  `${size}px`,
      height: `${size}px`,
      backgroundImage:  `url('assets/ui/bestiary/portraits/${id}_p.png')`,
      backgroundSize:   'contain',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      imageRendering:   'pixelated',
    },
  })
}

// Dismiss a "NEW" chip (any `.qf-newchip`) with the shared fade-out + scale-up
// (see styles.css), then remove it from the DOM. Idempotent. Call from a card's
// hover/select handler — pair it with the surface's "mark seen" so the chip
// doesn't reappear on reopen.
export function dismissNewChip(chip) {
  if (!chip || chip.classList.contains('is-dismissing')) return
  chip.classList.add('is-dismissing')
  setTimeout(() => chip.remove(), 240)
}

// Knowledge-intel category colours — the minimap legend (LeftPanels) + the
// knowledge-map category filters (KnowledgeMapOverlay). ITEMS is only used by
// the minimap legend; the knowledge map ignores it.
export const CAT_COLOR = {
  ROOMS:   '#5cc8d8',   // hex-ok: shared knowledge category palette
  TRAPS:   '#e89a3c',   // hex-ok: shared knowledge category palette
  MINIONS: '#c8334a',   // hex-ok: shared knowledge category palette
  ITEMS:   '#c879d8',   // hex-ok: shared knowledge category palette
}
