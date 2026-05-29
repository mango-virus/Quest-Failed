// CompanionSelectOverlay — the DOM screen for picking a dungeon keeper.
//
// Shown by the CompanionSelect scene, between MainMenu's NEW EVIL and the
// ArchetypeSelect boss picker. Companions are displayed THREE AT A TIME at
// full size, flanked by ◀ / ▶ arrows that page through the rest of the
// roster. Cards are pure visual portraits — no recruitment banter / chat
// bubbles (those were dropped 2026-05-25 because they ate too much vertical
// space, blocking the bigger portrait sizing the player asked for). The
// companion's name + tagline + traits remain on the plate below.
//
// Hovering a card is purely visual (CSS glow); clicking selects it; CONFIRM
// locks the choice and moves on to the boss picker. The pick is persisted
// to localStorage `qf.companion`.
//
// Locked companions still render at full size — silhouette-tinted portrait
// + a lock badge in the corner — but they're inert: no click selection.
// When the roster doesn't divide evenly into pages of 3, the remaining
// slots fill with "???" mystery placeholders so every page is exactly 3
// cards.
//
// Pagination behaviour:
//   • last-page padding = ??? placeholders make every page a full 3
//   • arrows clamp at edges (no wrap), disabled at page 0 / last page
//   • arrows are absolutely positioned at the stage edges so a wide
//     companion sprite (Zul'Gath) can never overlap + block them

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'
import { EventBus } from '../systems/EventBus.js'
import {
  COMPANION_ORDER, COMPANIONS, DEFAULT_COMPANION,
} from '../systems/companions.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { AchievementSystem } from '../systems/AchievementSystem.js'

const STORE_KEY  = 'qf.companion'
const PAGE_SIZE  = 3
// Minimum page count — the recruit screen always shows at least this many
// pages so the player gets a sense of "more companions are coming" even
// when the real roster only fills one or two. Any pages beyond the real
// roster fill with `???` mystery placeholders. Bump this if you want a
// deeper teaser; growing the real roster past `MIN_PAGES * PAGE_SIZE`
// (today: 9) naturally adds more pages without touching this constant.
const MIN_PAGES  = 3
// Page-conveyor animation duration. One continuous slide — the cards-
// element temporarily holds BOTH pages (6 cards in a flex strip) and
// translates by exactly one page-width + gap, so the next page's cards
// cross the visible area one-by-one as the strip moves. Tightened from
// 600ms → 450ms (2026-05-25) because the longer duration combined with
// per-card filter overhead read as laggy; 450ms still preserves the
// "one-at-a-time" feel + the `is-sliding` class added in `_setPage`
// suppresses the expensive bits (drop-shadow halo, breathing loop) for
// the duration of the slide.
const SLIDE_MS = 450
// Card layout constants — used to compute conveyor geometry. Must match
// `.qf-cmpsel-card` width and `.qf-cmpsel-cards` gap in styles.css.
const CARD_W   = 410
const CARD_GAP = 34

// Synthetic id used for mystery placeholder cards. Never collides with a
// real companion id (the real ones are slugs without colons).
const PLACEHOLDER_PREFIX = '::placeholder:'

export class CompanionSelectOverlay {
  constructor(scene) {
    this._scene    = scene
    this._el       = null
    this._cardsEl  = null    // .qf-cmpsel-cards — the swappable card row
    this._dotsEl   = null    // .qf-cmpsel-pagedots — page indicator
    this._prevBtn  = null
    this._nextBtn  = null
    this._refs     = {}      // id → { card, img } — ONLY current page's cards
    this._confirmBtn = null
    this._selected = DEFAULT_COMPANION
    // Currently-rolled picked-emote for the selected companion. Rolled
    // ONCE per new selection in `_select` (and on initial mount in `open`),
    // then held stable until a different companion is selected — so page
    // swaps / re-renders don't reshuffle the face mid-browse. Null when
    // the selected companion has no `pickedExprs` (falls back to restExpr).
    this._selectedEmote = null
    // Display roster — recomputed in open(). `_order` is every real
    // companion shown across all pages (locked + unlocked, minus any whose
    // name collides with the player's). `_paged` is `_order` padded with
    // synthetic placeholder ids so its length is a multiple of PAGE_SIZE.
    this._order   = COMPANION_ORDER.slice()
    this._paged   = []
    this._pageIdx = 0
    // Page-slide animation state. `_isSliding` gates re-entry so a
    // mid-animation arrow click can't queue overlapping animations or
    // leave `_selected` pointing at a companion that isn't visible.
    // `_slideTimer` holds the setTimeout handle so `close()` can cancel
    // it cleanly. `_initialMount` is true only for the FIRST _renderPage
    // call (during `open`); after that, page-swap renders create cards
    // with inline `animation: none` so the per-card `cmpsel-card-in`
    // entrance animation doesn't re-trigger on top of the parent's slide.
    this._isSliding = false
    this._slideTimer = null
    this._initialMount = true
    this._keyHandler   = (e) => this._onKey(e)
    this._wheelHandler = (e) => this._onWheel(e)
    // Set of companion ids the player has been "introduced to" — snapshot
    // captured in `open()`. Render reads this; hover-dismiss mutates it
    // in-place (so a re-render via _renderPage doesn't re-paint NEW on
    // an already-dismissed card mid-session).
    this._newAtRender = new Set()
  }

  open() {
    if (this._el) return
    installHudSfxDelegates()
    ensureStageScaled()

    // Recompute the roster each open() so renaming + unlock changes between
    // visits take effect.
    this._order = this._computeVisibleOrder()
    if (!this._order.length) this._order = COMPANION_ORDER.slice()
    // Pad with synthetic ??? placeholders so `_paged.length % PAGE_SIZE == 0`.
    // Pads only the LAST partial page — never adds whole empty pages.
    this._paged = this._padToFullPages(this._order, PAGE_SIZE)

    // If the stored last-pick is hidden or now locked, fall back to the
    // first available unlocked companion so we never start with an invalid
    // selection. Then page to wherever the selected companion lives.
    const allUnlocked = this._order.filter(id => this._isUnlocked(id))
    if (!allUnlocked.includes(this._selected)) {
      this._selected = allUnlocked[0] || DEFAULT_COMPANION
    }

    // Remembered last choice — default-selects the previous companion,
    // but only if that companion is still visible AND unlocked.
    try {
      const stored = localStorage.getItem(STORE_KEY)
      if (stored && COMPANIONS[stored] && allUnlocked.includes(stored)) {
        this._selected = stored
      }
    } catch {}

    // ── NEW-tag bookkeeping (per-player) ────────────────────────────────
    // Auto-detect: any UNLOCKED companion whose id isn't in the persisted
    // seen-set paints a NEW tag above its name plate. Hover dismisses
    // (per-id, via the card's mouseenter handler). No bulk-seed — that
    // anti-pattern was suppressing every NEW tag on existing rosters by
    // marking everything seen on first open. With it removed, fresh
    // players DO see NEW on every starter card the first time the
    // screen opens; one quick hover-pass dismisses each. That's the
    // trade-off the auto-detect approach signed up for.
    this._newAtRender = PlayerProfile.getKnownCompanionIds()

    // Always open on page 1 (2026-05-25 per user request) — players land
    // on the same consistent starting view every visit, regardless of
    // which page their previously-chosen companion lives on. If the
    // stored selection sits on a later page, the CONFIRM button still
    // reads that companion's name (so the player knows their last pick
    // is preserved), but they need to navigate to see them or change.
    this._pageIdx = 0
    // Roll the initial picked-emote so the persisted-selected companion
    // mounts with a random "you picked me!" face (fresh per session).
    // Even if they're not on page 1, this rolled value is used by `_card`
    // when their card is built on the page they DO live on.
    this._selectedEmote = this._rollPickedEmote(this._selected)

    this._render()
    this._preloadSprites()
    this._renderPage(this._pageIdx)
    this._applySelected()
    // After the initial mount, future page-swap renders should NOT
    // re-trigger the per-card entrance pop-up animation (the parent's
    // horizontal slide already handles the transition). Inline
    // `animation: none` on swap-mounted cards prevents the cascade from
    // restarting `cmpsel-card-in` when the slide-in class is removed.
    this._initialMount = false

    window.addEventListener('keydown', this._keyHandler)
    // Wheel-scroll pagination: scroll down/right → next page, up/left → prev.
    // `passive: false` so we can preventDefault() and stop the underlying
    // page from scrolling beneath the full-screen overlay.
    window.addEventListener('wheel', this._wheelHandler, { passive: false })
  }

  close() {
    if (this._slideTimer) { clearTimeout(this._slideTimer); this._slideTimer = null }
    this._isSliding = false
    this._el?.remove()
    this._el = null
    window.removeEventListener('keydown', this._keyHandler)
    window.removeEventListener('wheel', this._wheelHandler)
  }

  // True if the companion id is unlocked for the current player. Synthetic
  // placeholder ids are never unlocked (no `COMPANIONS[id]` entry).
  _isUnlocked(id) {
    if (this._isPlaceholder(id)) return false
    return PlayerProfile.isCompanionUnlocked(id)
  }

  // Roll a random picked-emote expression id for companion `id` from
  // their `pickedExprs[]` pool. Returns null if the companion has no
  // pool (e.g. Nocturna, who only has `idle` baked and is locked anyway)
  // — callers fall back to the rest face in that case.
  // Rolled fresh per new selection so consecutive picks of the same
  // companion yield different reactions; never re-rolled mid-selection.
  _rollPickedEmote(id) {
    const c = COMPANIONS[id]
    if (!c) return null
    const pool = c.pickedExprs
    if (!Array.isArray(pool) || pool.length === 0) return null
    return pool[Math.floor(Math.random() * pool.length)]
  }

  _isPlaceholder(id) {
    return typeof id === 'string' && id.startsWith(PLACEHOLDER_PREFIX)
  }

  // Pad `roster` with synthetic placeholder ids until the length is BOTH
  // a clean multiple of `size` AND at least `MIN_PAGES * size` long. The
  // minimum-pages floor adds extra mystery cards to tease "more
  // companions coming" beyond what the real roster currently provides.
  // Placeholder ids are unique per slot so DOM keys stay distinct, but
  // they all render as the same `???` mystery card.
  _padToFullPages(roster, size) {
    const out = roster.slice()
    // Round up to the next multiple of size, OR to MIN_PAGES worth of
    // slots, whichever is larger. With 5 real companions today, the
    // natural multiple-of-3 ceil is 6 (1 placeholder); the MIN_PAGES=3
    // floor lifts the target to 9 (4 placeholders → 3 full pages of 3).
    const targetLen = Math.max(
      MIN_PAGES * size,
      Math.ceil(out.length / size) * size,
    )
    while (out.length < targetLen) {
      out.push(`${PLACEHOLDER_PREFIX}${out.length}`)
    }
    return out
  }

  _pageCount() {
    return Math.max(1, Math.ceil(this._paged.length / PAGE_SIZE))
  }

  // Which page contains companion `id` (real id, not placeholder). Returns
  // 0 if the id isn't in the visible roster (defensive — clamped page).
  _pageOf(id) {
    const i = this._paged.indexOf(id)
    if (i < 0) return 0
    return Math.floor(i / PAGE_SIZE)
  }

  // Ids visible on page `n`. Always returns PAGE_SIZE entries (placeholders
  // pad short last pages).
  _pageIds(n) {
    const start = n * PAGE_SIZE
    return this._paged.slice(start, start + PAGE_SIZE)
  }

  // ── render ────────────────────────────────────────────────────────────────
  _render() {
    // Stage = relatively-positioned container. The card track sits in the
    // flex flow (centered). The arrows are ABSOLUTELY positioned at the
    // stage's left + right edges so a wide companion sprite's overflow
    // (Zul'Gath) can never push them off-screen or sit on top of them.
    // The arrows are also given a high z-index so even if the sprite
    // visually overlaps the button, clicks still reach the button.
    this._cardsEl = h('div', { className: 'qf-cmpsel-cards' })

    this._prevBtn = h('button', {
      className: 'btn qf-cmpsel-arrow qf-cmpsel-arrow--prev',
      type: 'button',
      'aria-label': 'Previous page',
      on: { click: () => this._setPage(this._pageIdx - 1) },
    }, '◀')

    this._nextBtn = h('button', {
      className: 'btn qf-cmpsel-arrow qf-cmpsel-arrow--next',
      type: 'button',
      'aria-label': 'Next page',
      on: { click: () => this._setPage(this._pageIdx + 1) },
    }, '▶')

    this._dotsEl = h('div', { className: 'qf-cmpsel-pagedots' })

    this._el = h('div', { className: 'qf-cmpsel' }, [
      h('div', { className: 'qf-cmpsel-head' }, [
        h('div', { className: 'pix qf-cmpsel-eyebrow' }, '◆  THE THRONE NEEDS A KEEPER  ◆'),
        h('div', { className: 'pix qf-cmpsel-title' }, 'CHOOSE YOUR COMPANION'),
        h('div', { className: 'qf-cmpsel-sub' },
          'They will run your dungeon, whisper in your ear, and watch you reign. Pick the voice you can stand for a lifetime of nights.'),
      ]),
      h('div', { className: 'qf-cmpsel-stage' }, [
        this._prevBtn,
        this._cardsEl,
        this._nextBtn,
      ]),
      this._dotsEl,
      h('div', { className: 'qf-cmpsel-footer' }, [
        h('button', {
          className: 'btn qf-cmpsel-back',
          on: { click: () => this._back() },
        }, '◀  BACK'),
        h('button', {
          className: 'btn primary lg qf-cmpsel-confirm',
          ref: el => { this._confirmBtn = el },
          on: { click: () => this._confirm() },
        }, 'CONFIRM  ▶'),
      ]),
    ])
    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)
  }

  // Build the cards for page `n` into _cardsEl + sync arrow + dot states.
  // Used for the INITIAL mount and as a fallback for direct page-set without
  // animation. The conveyor-animated path in `_setPage` doesn't go through
  // here — it builds + splices cards manually so it can control the
  // transition between the two pages.
  _renderPage(n) {
    this._refs = {}
    this._cardsEl.replaceChildren(...this._buildPageCards(n))
    this._applySelected()
    this._updateArrowsAndDots()
  }

  // Build fresh DOM nodes for the 3 cards on page `n`. Refs for non-
  // placeholder cards are added to `this._refs` (placeholder cards don't
  // need refs since they can't be selected). Caller decides where to mount
  // them (replace all children, append, or prepend during the conveyor).
  _buildPageCards(n) {
    const ids = this._pageIds(n)
    return ids.map(id =>
      this._isPlaceholder(id) ? this._placeholderCard(id) : this._card(id))
  }

  // Sync arrow enable/disable + page indicator dots to the current
  // `_pageIdx`. Called after every page change (initial mount + conveyor
  // cleanup). Arrows clamp at edges per design.
  _updateArrowsAndDots() {
    const last = this._pageCount() - 1
    const atFirst = this._pageIdx <= 0
    const atLast  = this._pageIdx >= last
    if (this._prevBtn) {
      this._prevBtn.disabled = atFirst
      this._prevBtn.setAttribute('aria-disabled', atFirst ? 'true' : 'false')
    }
    if (this._nextBtn) {
      this._nextBtn.disabled = atLast
      this._nextBtn.setAttribute('aria-disabled', atLast ? 'true' : 'false')
    }
    // Only render dots when there's actually more than one page.
    this._dotsEl.replaceChildren()
    const pages = this._pageCount()
    if (pages > 1) {
      for (let i = 0; i < pages; i++) {
        this._dotsEl.appendChild(h('div', {
          className: 'qf-cmpsel-pagedot',
          dataset:   { active: i === this._pageIdx ? 'true' : 'false' },
        }))
      }
    }
  }

  _card(id) {
    const c       = COMPANIONS[id]
    const locked  = !this._isUnlocked(id)
    const img = h('img', {
      className: 'qf-cmpsel-portrait-img',
      alt: c.name, draggable: 'false',
    })
    // Initial face — currently-rolled picked-emote if this card is the
    // selected companion (so the persisted last-pick reads as "still
    // chosen" on mount, using whatever was rolled in `open`/`_select`),
    // otherwise the rest face. `_applySelected` flips between them
    // after a click. `dataset.expr` tracks the current value so
    // _applySelected can avoid redundant `img.src =` writes (which can
    // re-trigger image decode in some browsers).
    const initialExpr = (!locked && id === this._selected && this._selectedEmote)
      ? this._selectedEmote
      : c.restExpr
    img.src = c.spriteDir + initialExpr + '.webp'
    img.dataset.expr = initialExpr
    // Even out the companions' on-screen size + (optionally) mirror the
    // sprite so they face each other. `portraitOrigin` lets a wide sprite
    // (Zul'Gath) scale up from its bottom edge — growing UP, not down over
    // the name plate — instead of the default centre.
    const flip  = c.portraitFlipX ? -1 : 1
    const scale = c.portraitScale ?? 1
    img.style.transform = `scaleX(${flip}) scale(${scale})`
    if (c.portraitOrigin) img.style.transformOrigin = c.portraitOrigin
    // A wide companion (Zul'Gath) fades his tail/backside out so the big
    // sprite reads as a tall dragon rather than an overflowing rectangle.
    if (c.fadeMask) {
      img.style.maskImage = c.fadeMask
      img.style.webkitMaskImage = c.fadeMask
    }

    // (Lock badge corner-sprite removed 2026-05-25 per user request —
    // the locked state is already communicated by the dimmed/desaturated
    // portrait filter + `◆ LOCKED ◆` caption on the plate, so the badge
    // was redundant clutter. The `.qf-cmpsel-lock-corner` CSS rule is
    // left in styles.css as dead code in case we want to revive it.)
    const portraitKids = [img]

    // Locked cards hide the tagline + traits behind a "LOCKED" caption so
    // the character read isn't fully spoiled before the unlock.
    const plateKids = []
    // "NEW" tag — sits just above the name plate on companions the player
    // hasn't been introduced to yet. Only renders on UNLOCKED cards per
    // the design ("only after unlock"); locked teasers stay tag-free until
    // they actually unlock. Hover-dismiss is wired on `mouseenter` (alongside
    // the hover-SFX call) further down.
    const isNew = !locked && !this._newAtRender.has(id)
    if (isNew) {
      plateKids.push(h('span', { className: 'pix qf-cmpsel-new-tag' }, 'NEW'))
    }
    plateKids.push(h('div', { className: 'pix qf-cmpsel-name' }, c.name))
    if (locked) {
      plateKids.push(h('div', { className: 'pix qf-cmpsel-locked-label' }, '◆  LOCKED  ◆'))
    } else {
      plateKids.push(h('div', { className: 'qf-cmpsel-tag' }, c.tagline))
      plateKids.push(h('div', { className: 'pix qf-cmpsel-traits' },
        (c.traits || []).join('  ·  ')))
      plateKids.push(h('div', { className: 'pix qf-cmpsel-chosen' }, '✦  CHOSEN  ✦'))
    }

    // A11y hint — locked cards announce as disabled to screen readers.
    // `aria-disabled` lives at the top level (h() forwards unknown keys
    // via setAttribute; no `attrs:` wrapper).
    const cardAttrs = {
      className: 'qf-cmpsel-card',
      dataset: {
        id,
        selected: 'false',
        locked: locked ? 'true' : 'false',
      },
      // Locked cards: HOVER works (plays the hover SFX + lifts visually
      // via the `:hover` CSS rules below) so the player can browse the
      // locked companion's silhouette. CLICK now routes to a denied-
      // feedback handler (shake + tooltip + toast + error SFX) instead
      // of being a no-op — players get explicit feedback that the
      // companion isn't unlocked yet. Unlocked cards play the normal
      // UI click sound + run the selection logic.
      on: {
        mouseenter: (e) => {
          this._hover()
          // NEW-tag dismiss on hover (unlocked + still tagged only).
          // Marks this companion as known in PlayerProfile (persists),
          // updates the in-memory snapshot so a sibling re-render won't
          // re-paint it, and fades + removes the tag chip from THIS card
          // without re-rendering the whole row.
          if (!locked && this._newAtRender && !this._newAtRender.has(id)) {
            PlayerProfile.markCompanionKnown(id)
            this._newAtRender.add(id)
            const tag = e.currentTarget?.querySelector('.qf-cmpsel-new-tag')
            if (tag) {
              tag.classList.add('is-dismissing')
              setTimeout(() => tag.remove(), 260)
            }
          }
        },
        click: locked ? () => this._onLockedClick(id) : () => this._select(id),
      },
    }
    if (locked) cardAttrs['aria-disabled'] = 'true'
    const card = h('div', cardAttrs, [
      h('div', { className: 'qf-cmpsel-portrait' }, portraitKids),
      h('div', { className: 'qf-cmpsel-plate' }, plateKids),
    ])
    // Suppress the per-card entrance animation on page-swap renders —
    // the parent's slide-in keyframe already provides the movement, and
    // re-triggering `cmpsel-card-in` after the slide ends would produce
    // an unwanted secondary pop-up. Initial-mount cards (during `open`)
    // get the entrance animation; only swapped cards have it disabled.
    if (!this._initialMount) card.style.animation = 'none'

    this._refs[id] = { card, img }
    return card
  }

  // Mystery placeholder card — fills the partial last page out to PAGE_SIZE.
  // Visually consistent (same outer frame), but completely silhouetted with
  // a giant `?` glyph so it teases "more companions coming" without
  // spoiling specific characters.
  _placeholderCard(id) {
    const card = h('div', {
      className: 'qf-cmpsel-card qf-cmpsel-card--placeholder',
      dataset:   { id, placeholder: 'true' },
      'aria-hidden': 'true',
    }, [
      h('div', { className: 'qf-cmpsel-portrait' }, [
        h('div', { className: 'pix qf-cmpsel-mystery' }, '?'),
      ]),
      h('div', { className: 'qf-cmpsel-plate' }, [
        h('div', { className: 'pix qf-cmpsel-name' }, '???'),
        h('div', { className: 'pix qf-cmpsel-locked-label' }, 'COMING SOON'),
      ]),
    ])
    // Same swap-render entrance-animation suppression as real cards —
    // see `_card` for context.
    if (!this._initialMount) card.style.animation = 'none'
    return card
  }

  _preloadSprites() {
    // Preload the rest-expression PLUS every entry in the picked-emote
    // pool for every real companion. Two reasons:
    //   (a) flipping pages doesn't pop a fresh image request
    //   (b) the click-to-emote swap fires instantly regardless of which
    //       emote rolls — no network round-trip flash on any of them.
    // The pool is small per companion (~11-14 entries) so this is cheap;
    // sprites already exist as baked .webp on disk.
    for (const id of this._order) {
      const c = COMPANIONS[id]
      const exprs = new Set([c.restExpr])
      if (Array.isArray(c.pickedExprs)) {
        for (const e of c.pickedExprs) exprs.add(e)
      }
      for (const expr of exprs) {
        const im = new Image(); im.src = c.spriteDir + expr + '.webp'
      }
    }
  }

  // ── pagination ─────────────────────────────────────────────────────────────
  // Swap to page `n` with a conveyor/film-reel animation: the cards-element
  // temporarily holds BOTH the current and the next page side-by-side on
  // a single horizontal flex strip, and the whole strip translates by
  // exactly one page-width-plus-gap. As the strip moves, each new card
  // crosses the visible area one-by-one — matching "characters arriving
  // one at a time" much more literally than a per-page block swap would.
  //
  // Geometry (PAGE_SIZE=3, CARD_W=410, CARD_GAP=34):
  //   1-page strip width  = 3*410 + 2*34 = 1298 (the natural cards width)
  //   2-page strip width  = 6*410 + 5*34 = 2630 (during the slide)
  //   compensate-shift    = (2630-1298)/2 = 666 (offsets the auto re-center
  //                         when cards-element doubles in size, so the
  //                         CURRENT cards stay in place at slide start)
  //   slide distance      = 1298 + 34 = 1332 (one page + one gap; final
  //                         transform = -compensate so the NEW cards land
  //                         at the original page position)
  //
  // `_isSliding` gates re-entry — rapid arrow clicks are ignored until the
  // current conveyor cycle completes, so we never overlap animations or
  // desync `_selected` (which would otherwise point at a companion that's
  // currently mid-flight off-screen).
  _setPage(n) {
    const last = this._pageCount() - 1
    const clamped = Math.max(0, Math.min(last, n))
    if (clamped === this._pageIdx) return
    if (this._isSliding) return
    HudSfx.playUi('hover')

    const goingForward = clamped > this._pageIdx
    this._isSliding = true
    // `is-sliding` class lets CSS suppress per-card decorations that
    // would otherwise compete with the parent's transform for compositor
    // bandwidth — drop-shadow halo on the selected portrait, the
    // `cmpsel-breathe` infinite loop on the selected portrait, hover
    // transforms, and filter transitions — all paused for the duration
    // of the slide. Restored when the class is removed at slide end.
    this._cardsEl.classList.add('is-sliding')

    // Build the next page's 3 cards. `_buildPageCards` adds refs to
    // `this._refs` for the non-placeholder ones — during the slide,
    // `_refs` legitimately holds BOTH pages' worth of cards. The
    // cleanup step below trims back to just the new page.
    const nextCards = this._buildPageCards(clamped)
    if (goingForward) {
      // Append: new cards to the RIGHT of current cards.
      for (const c of nextCards) this._cardsEl.appendChild(c)
    } else {
      // Prepend: new cards to the LEFT of current cards. Insert in
      // order before the first existing card so they end up cards 1-3.
      for (let i = 0; i < nextCards.length; i++) {
        this._cardsEl.insertBefore(nextCards[i], this._cardsEl.children[i])
      }
    }

    // Conveyor geometry — see the function header for the derivation.
    const PAGE_W     = PAGE_SIZE * CARD_W + (PAGE_SIZE - 1) * CARD_GAP  // 1298
    const COMPENSATE = (PAGE_W + CARD_GAP) / 2                          // 666
    // Forward → start shifted RIGHT (so old cards keep their position
    // even though the strip just grew), end shifted LEFT (so new cards
    // land at the old position). Backward mirrors.
    const startX = goingForward ?  COMPENSATE : -COMPENSATE
    const endX   = goingForward ? -COMPENSATE :  COMPENSATE

    // Apply the compensation transform INSTANTLY (no transition), in the
    // SAME JS task as the DOM insertion above. The browser doesn't paint
    // between the children append/prepend and the transform set, so the
    // current cards never visibly flash to their post-grow positions.
    this._cardsEl.style.transition = 'none'
    this._cardsEl.style.transform  = `translateX(${startX}px)`
    // Force a reflow so the browser commits the start state before the
    // transition begins. Without this, the browser would batch the two
    // transform writes and only animate the final one — no visible slide.
    void this._cardsEl.offsetWidth
    // Now trigger the slide via CSS transition.
    this._cardsEl.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
    this._cardsEl.style.transform  = `translateX(${endX}px)`

    // After the slide finishes: remove the OLD page's 3 cards AND clear
    // the transform in the same JS task — the cards-element shrinks back
    // to one page (1298px) AND re-centers in the stage in a single layout
    // pass, so the new cards' on-screen position doesn't change visibly.
    this._slideTimer = setTimeout(() => {
      if (!this._el) { this._isSliding = false; return }

      // Forward navigation appended new cards → old ones are at the
      // START. Backward prepended → old ones are at the END.
      const removeFromStart = goingForward
      for (let i = 0; i < PAGE_SIZE; i++) {
        const node = removeFromStart ? this._cardsEl.firstChild : this._cardsEl.lastChild
        if (!node) break
        const id = node.dataset?.id
        if (id) delete this._refs[id]
        node.remove()
      }

      // Reset transform — same JS task as the card removal above so the
      // browser computes layout once with both changes applied.
      this._cardsEl.style.transition = 'none'
      this._cardsEl.style.transform  = ''
      void this._cardsEl.offsetWidth
      this._cardsEl.style.transition = ''

      this._pageIdx = clamped
      this._applySelected()
      this._updateArrowsAndDots()

      // Restore per-card decorations now that the slide is settled.
      this._cardsEl.classList.remove('is-sliding')
      this._isSliding = false
      this._slideTimer = null
    }, SLIDE_MS)
  }

  // Filter COMPANION_ORDER to hide any companion whose id or display
  // name matches the player's current name (case-insensitive). A player
  // named "Lilith" cannot pick Lilith-the-companion as their keeper.
  // Returns a fresh array so the global COMPANION_ORDER stays untouched.
  _computeVisibleOrder() {
    const name = PlayerProfile.getName().trim().toLowerCase()
    if (!name) return COMPANION_ORDER.slice()
    return COMPANION_ORDER.filter(id => {
      const c = COMPANIONS[id]
      if (!c) return false
      return id.toLowerCase() !== name && (c.name || '').toLowerCase() !== name
    })
  }

  // ── interaction ─────────────────────────────────────────────────────────────
  _hover() {
    HudSfx.playUi('hover')
  }

  // Click on a LOCKED companion card. Plays the error SFX + mounts an
  // inline tooltip centered on the character. The shake animation +
  // top-right toast emit were dropped 2026-05-26 per user request —
  // the single centered tooltip carries the message clearly enough
  // and the layout reads quieter without the wiggle.
  _onLockedClick(id) {
    HudSfx.playUi('denied')
    this._showLockedTip(id)
  }

  // Build the locked-companion message. Generic format for every
  // companion: `🔒 NAME IS LOCKED`. (The earlier achievement-specific
  // Zul'Gath callout was dropped 2026-05-26 — the user preferred the
  // simpler uniform message across the board.)
  _lockedMessage(id) {
    const cmp  = COMPANIONS[id]
    const name = (cmp?.name || id).toUpperCase()
    return `🔒  ${name} IS LOCKED`
  }

  // Mount an inline tooltip centered on the clicked locked card.
  // Renders as two stacked lines:
  //   Line 1 — `🔒 NAME IS LOCKED` (always shown)
  //   Line 2 — Achievement name that grants this companion (only
  //            when there IS a wired unlock achievement; companions
  //            without one show just line 1).
  // Auto-removes itself after ~2s, or earlier if the player clicks
  // the same card again (replaces the existing tooltip in-place).
  // Appended to the card so it inherits the card's positioning context;
  // CSS positions it absolutely centered (translate(-50%, -50%)) over
  // the portrait.
  _showLockedTip(id) {
    const ref = this._refs?.[id]
    if (!ref?.card) return
    // Tear down any existing tip on this card before showing a new one.
    const existing = ref.card.querySelector('.qf-cmpsel-locked-tip')
    if (existing) existing.remove()
    const msg = this._lockedMessage(id)
    const achDef = this._findUnlockAchievement(id)
    const tip = h('div', { className: 'pix qf-cmpsel-locked-tip' }, [
      h('div', { className: 'qf-cmpsel-locked-tip-title' }, msg),
      achDef && h('div', { className: 'qf-cmpsel-locked-tip-sub' },
        `${achDef.name} ACHIEVEMENT`),
    ])
    ref.card.appendChild(tip)
    // Trigger the fade-in via a class flip on the next frame so the
    // initial-render opacity:0 → opacity:1 transition lands.
    requestAnimationFrame(() => tip.classList.add('is-visible'))
    // Auto-dismiss with a fade-out. Short message = short dwell.
    setTimeout(() => {
      tip.classList.remove('is-visible')
      setTimeout(() => tip.remove(), 240)
    }, 2500)
  }

  // Find the achievement definition whose reward unlocks this
  // companion id, if any. Walks `AchievementSystem.getDefinitions()`
  // looking for `reward.type === 'companion'` + `reward.id === id`.
  // Returns the def (with .name etc.) or null if no achievement is
  // wired to unlock this companion yet (most locked teasers today).
  _findUnlockAchievement(companionId) {
    try {
      const defs = AchievementSystem.getDefinitions?.() || []
      for (const def of defs) {
        if (def?.reward?.type === 'companion' && def.reward.id === companionId) {
          return def
        }
      }
    } catch {}
    return null
  }

  _select(id) {
    if (!COMPANIONS[id]) return
    if (!this._isUnlocked(id)) return
    if (id === this._selected) return
    // Don't accept selection changes while the page is mid-slide —
    // otherwise `_selected` could land on a companion that's already on
    // an outgoing/incoming page, and the CONFIRM button would show a
    // name that isn't visible. Click is silently ignored; user can try
    // again once the slide settles (~600ms).
    if (this._isSliding) return
    // UI click chip — confirms the click registered for an unlocked
    // companion. Locked clicks play `denied` via _onLockedClick instead.
    HudSfx.playUi('click')
    this._selected = id
    // Roll a fresh picked-emote for the new selection — variety per
    // click. `_applySelected` (called below or via `_setPage`'s render)
    // reads `_selectedEmote` to paint the chosen card's face.
    this._selectedEmote = this._rollPickedEmote(id)
    // If the selection moved to a companion on another page, flip the
    // page first. `_setPage` re-renders the cards (so `_applySelected`
    // runs again via _renderPage).
    const targetPage = this._pageOf(id)
    if (targetPage !== this._pageIdx) {
      this._setPage(targetPage)
      return
    }
    this._applySelected()
  }

  _applySelected() {
    // Iterate only the cards currently mounted on the page — _refs is
    // scoped per page so off-page selection is purely a logical state.
    // Also swaps each card's portrait between the rolled picked-emote
    // (selected card's "you picked me!" reaction, randomized once in
    // _select) and `restExpr` (everyone else's neutral resting face).
    // Locked + placeholder cards have no pickedExprs pool — they stay
    // on rest. This method is called on every page render + selection
    // change but does NOT re-roll the emote; the roll is owned by
    // `open` / `_select`.
    for (const id of Object.keys(this._refs)) {
      const r = this._refs[id]
      if (!r) continue
      const isSelected = (id === this._selected)
      r.card.dataset.selected = isSelected ? 'true' : 'false'
      // Picked-face swap. Only applies to unlocked real companions; the
      // `dataset.expr` guard avoids re-setting the same .src (which can
      // trigger a redundant image decode in some browsers).
      if (r.img && !this._isPlaceholder(id) && this._isUnlocked(id)) {
        const c = COMPANIONS[id]
        const expr = (isSelected && this._selectedEmote)
          ? this._selectedEmote
          : c.restExpr
        if (r.img.dataset.expr !== expr) {
          r.img.src = c.spriteDir + expr + '.webp'
          r.img.dataset.expr = expr
        }
      }
    }
    if (this._confirmBtn) {
      this._confirmBtn.textContent =
        `CONFIRM ${COMPANIONS[this._selected].name.toUpperCase()}  ▶`
    }
  }

  // ── navigation ─────────────────────────────────────────────────────────────
  _confirm() {
    // Defensive — never persist a locked / unknown id even if some future
    // keyboard flow routes us here without a valid `_selected`.
    if (!this._isUnlocked(this._selected)) return
    try { localStorage.setItem(STORE_KEY, this._selected) } catch {}
    this.close()
    this._scene?.scene?.start('ArchetypeSelect')
  }

  _back() {
    this.close()
    this._scene?.scene?.start('MainMenu')
  }

  // Mouse-wheel pagination. Scroll vertical (or horizontal via trackpad)
  // pages forward / backward. The `_isSliding` gate filters out the
  // long inertial-scroll trails trackpads emit — once a slide starts,
  // subsequent wheel events are ignored until it completes, so a single
  // gesture never blasts through multiple pages.
  _onWheel(e) {
    // Block default scroll on whatever element would otherwise scroll —
    // the recruit screen is a full-screen modal, wheel input should drive
    // ONLY the pagination, never the underlying canvas / window.
    e.preventDefault()
    if (this._isSliding) return
    // Sum both axes so diagonal trackpad swipes resolve to one direction.
    // 8px threshold filters out tiny accidental deltas (trackpad noise).
    const delta = e.deltaY + e.deltaX
    if (Math.abs(delta) < 8) return
    this._setPage(this._pageIdx + (delta > 0 ? 1 : -1))
  }

  _onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); this._confirm(); return }
    if (e.key === 'Escape') { e.preventDefault(); this._back();    return }
    // PageUp / PageDown jump pages explicitly. Useful when the player
    // wants to browse without changing their selection.
    if (e.key === 'PageUp')   { e.preventDefault(); this._setPage(this._pageIdx - 1); return }
    if (e.key === 'PageDown') { e.preventDefault(); this._setPage(this._pageIdx + 1); return }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'ArrowUp'   || e.key === 'ArrowDown') {
      e.preventDefault()
      // ←/→/↑/↓ cycle through UNLOCKED companions across the whole roster.
      // If the new selection lives on a different page, `_select` flips the
      // page automatically (via `_setPage`). Wraps around the unlocked list.
      const list = this._order.filter(id => this._isUnlocked(id))
      if (!list.length) return
      const i = list.indexOf(this._selected)
      const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1
      const next = list[(i + dir + list.length) % list.length]
      this._select(next)
    }
  }
}
