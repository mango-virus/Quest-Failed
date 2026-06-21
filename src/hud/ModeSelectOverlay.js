// ModeSelectOverlay — "Choose Your Path": the DOM screen for choosing a run's MODE.
//
// Shown by the ModeSelect scene, between MainMenu's NEW EVIL and the
// CompanionSelect keeper picker. Two hero "gate" cards — CAMPAIGN (The Kingdom's
// Reckoning, the 4-act win run) and ENDLESS (The Eternal Siege, survive forever) —
// each a runic medallion set into a carved doorway. Beneath each sits a teaser
// card for a future mode: NEW GAME + (unsealed once the campaign is won) and
// CHALLENGE MODE (a planned mode, still sealed). Confirm persists the pick to
// localStorage `qf.runMode`; ArchetypeSelect._beginRun reads it into
// gameState.meta.mode, which isActsEnabled(gameState) keys on.
//
// Ported from the design handoff ("Choose Your Path"): visuals + the hero portal
// art live in modeSelect.css + modeSelectArt.js. Reaching this screen always
// starts a FRESH run (Continue/Resume lives on the Main Menu), so the cards read
// "Begin" — with informational record chips driven by real profile data
// (Endless best days held, Campaign clear/NG+ state), hidden when there's none.
//
// Performance note (same as the companion screen): the Phaser canvas repaints
// under this overlay every frame, so the backdrop is a flat fill + the reused
// crypt layers, and the embers/portal motion animate transform/opacity only.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { buildCryptBackdrop } from './menuBackdrop.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { portalSceneHTML, lockGlyphSVG } from './modeSelectArt.js'

const STORE_KEY = 'qf.runMode'
// Days-in-Endless required to unseal the (planned) Challenge Mode — drives its
// locked progress bar against the player's best single-run length.
const CHALLENGE_UNLOCK_DAYS = 50

export class ModeSelectOverlay {
  constructor(scene) {
    this._scene = scene
    this._el = null
    this._gateRefs = {}       // id → gate element (for .sel / .foc toggling)
    // Nothing is lit at rest (matches the design's clean rest state) — hover /
    // ←→ focus / click light a card. A run only commits via a CTA or card click.
    this._selected = null
    this._kbFocus = null      // transient keyboard focus: null | 'campaign' | 'endless'
    this._lockOpen = null     // which sealed teaser is revealing its progress
    this._shakeTick = 0
    this._launching = false
    this._launchTimer = null
    this._keyHandler = (e) => this._onKey(e)
  }

  open() {
    if (this._el) return
    installHudSfxDelegates()
    ensureStageScaled()

    this._render()
    window.addEventListener('keydown', this._keyHandler)
  }

  close() {
    if (this._launchTimer) { clearTimeout(this._launchTimer); this._launchTimer = null }
    this._el?.remove()
    this._el = null
    window.removeEventListener('keydown', this._keyHandler)
  }

  // ── real profile data ─────────────────────────────────────────────────────
  _reckoningTier() { try { return PlayerProfile.getReckoningTier() || 0 } catch { return 0 } }
  _bestDays() {
    try { return Math.max(0, Math.floor(PlayerProfile.getAchievementMetrics()?.daysSurvivedMax || 0)) }
    catch { return 0 }
  }

  // ── mode content model ────────────────────────────────────────────────────
  _modes() {
    const tier = this._reckoningTier()
    const best = this._bestDays()
    return {
      campaign: {
        key: 'campaign', acc: 'acc-blood', sub: "The Kingdom's Reckoning", name: 'CAMPAIGN',
        // Record chip — only once the campaign has been beaten at least once.
        status: tier > 0 ? `◆ Reckoning won · NG+${tier} ready` : null,
        tagline: 'Four acts. Escalating champions. One final duel — win, or fall trying.',
        points: ['A run with a true beginning and end', 'Your boss ascends a darker form each act', 'Each act adapts — the kingdom counters how you play'],
        cta: 'Begin the Reckoning',
      },
      endless: {
        key: 'endless', acc: 'acc-ember', sub: 'The Eternal Siege', name: 'ENDLESS',
        status: best > 0 ? `◆ Best · ${best} ${best === 1 ? 'day' : 'days'} held` : null,
        tagline: 'No acts. No ending. Hold your dungeon as long as the dark allows.',
        points: ['Survive forever — the siege never stops', 'The full bestiary, pure survival', 'Climb the leaderboard by days held'],
        cta: 'Raise the Siege',
      },
    }
  }

  // The two teaser cards. `unlocked` flips from real progress: NG+ unseals once
  // the campaign is won; Challenge Mode is a planned mode, still sealed.
  _locked() {
    const tier = this._reckoningTier()
    const best = this._bestDays()
    return {
      ngplus: {
        key: 'ngplus', acc: 'acc-abyss', glyph: '☠', name: 'NEW GAME +', sub: 'The Deeper Dark',
        tagline: 'A crueler Reckoning, for those who have already won.',
        unlocked: tier > 0, enter: 'Descend into the Deeper Dark', launchMode: 'campaign',
        unlock: 'Clear the Campaign to unseal',
        progress: { label: 'Campaign cleared', cur: Math.min(tier, 1), max: 1, note: 'The Reckoning is not yet won' },
      },
      challenge: {
        key: 'challenge', acc: 'acc-poison', glyph: '⚑', name: 'CHALLENGE MODE', sub: 'The Gauntlet',
        tagline: 'Curated trials with brutal modifiers and a single life.',
        unlocked: false, enter: 'Take up the Gauntlet',
        // Challenge Mode isn't built yet, so it never actually unseals here. Once
        // the player has already passed the day threshold, swap the "to unseal"
        // copy for an honest "coming soon" instead of a filled-but-locked bar.
        unlock: best >= CHALLENGE_UNLOCK_DAYS ? 'Coming soon — not yet playable' : `Hold ${CHALLENGE_UNLOCK_DAYS} days in Endless to unseal`,
        progress: {
          label: 'Days held', cur: Math.min(best, CHALLENGE_UNLOCK_DAYS), max: CHALLENGE_UNLOCK_DAYS,
          note: best >= CHALLENGE_UNLOCK_DAYS ? 'Coming soon — not yet playable'
            : best > 0 ? `Best siege so far: ${best} ${best === 1 ? 'day' : 'days'}` : 'No siege held yet',
        },
      },
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  _render() {
    const M = this._modes()
    const L = this._locked()

    this._el = h('div', { className: 'qf-msel' }, [
      ...buildCryptBackdrop(),
      h('div', { className: 'qf-msel-embers' }, this._emberField()),
      h('div', { className: 'pg' }, [
        h('button', { className: 'pg-back', on: { click: () => this._back() } }, '‹ Back'),
        h('div', { className: 'pg-head' }, [
          h('div', { className: 'pc-eyebrow' }, [
            h('span', { className: 'ln' }),
            h('span', { className: 'dia' }, '◆'), ' How Will You Reign? ', h('span', { className: 'dia' }, '◆'),
            h('span', { className: 'ln r' }),
          ]),
          h('div', { className: 'pc-title' }, 'CHOOSE YOUR PATH'),
        ]),
        h('div', { className: 'pg-row' }, [
          h('div', { className: 'pg-col' }, [this._gate(M.campaign), this._lockedCard(L.ngplus)]),
          h('div', { className: 'pg-col' }, [this._gate(M.endless, true), this._lockedCard(L.challenge)]),
        ]),
      ]),
      h('div', { className: 'pc-foot' }, [
        h('div', { className: 'pc-hint' }, [h('kbd', null, '←'), h('kbd', null, '→'), ' Choose']),
        h('div', { className: 'pc-hint' }, [h('kbd', null, 'Z'), ' Descend']),
        h('div', { className: 'pc-hint' }, [h('kbd', null, 'Esc'), ' Back']),
      ]),
    ])

    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)
    this._syncGates()
  }

  _gate(m, second) {
    const track = m.key === 'campaign' ? this._actsTrack() : this._eternityTrack()
    const gate = h('div', {
      className: 'gate ' + m.acc + (second ? ' g2' : ''),
      dataset: { id: m.key },
      on: { click: () => this._select(m.key), mouseenter: () => this._clearFocus() },
    }, [
      h('div', { className: 'gate-frame' }, [
        h('div', { className: 'gate-cap' }),
        h('div', { className: 'portal', html: portalSceneHTML(m.key) }),
        h('div', { className: 'gate-body' }, [
          h('div', { className: 'gate-sub' }, m.sub),
          h('div', { className: 'gate-name' }, m.name),
          m.status ? h('div', { className: 'gate-status' }, m.status) : null,
          h('div', { className: 'gate-tag' }, m.tagline),
          h('ul', { className: 'gate-pts' }, m.points.map(t => h('li', null, [h('span', { className: 'b' }, '◆'), h('span', null, t)]))),
          h('div', { className: 'track' }, track),
          h('button', {
            className: 'gate-cta',
            on: { click: (ev) => { ev.stopPropagation(); this._launch(m.key) } },
          }, [h('span', { className: 'arw' }, '▶'), ' ' + m.cta]),
        ]),
      ]),
    ])
    this._gateRefs[m.key] = gate
    return gate
  }

  _actsTrack() {
    const kids = []
    for (const r of ['I', 'II', 'III', 'IV']) {
      kids.push(h('div', { className: 'act' }, h('span', null, r)))
      kids.push(h('div', { className: 'act-link' }))
    }
    kids.push(h('div', { className: 'act crown' }, h('span', null, '♛')))
    return [h('div', { className: 'acts' }, kids), h('span', { className: 'track-cap' }, 'Four acts · a final duel')]
  }

  _eternityTrack() {
    const bars = [10, 16, 13, 22, 18, 26, 30].map(ht => h('i', { style: { height: ht + 'px' } }))
    return [
      h('div', { className: 'eternity' }, [h('span', { className: 'inf' }, '∞'), h('div', { className: 'bars' }, bars), h('span', { className: 'inf' }, '∞')]),
      h('span', { className: 'track-cap' }, 'No end · climb the leaderboard'),
    ]
  }

  _lockedCard(p) {
    if (p.unlocked) {
      // Available teaser — accent-tinted, ✦ New badge, actionable Enter line.
      return h('div', {
        className: 'lockopt avail ' + p.acc, dataset: { id: p.key },
        on: { click: () => this._launchLocked(p), mouseenter: () => this._clearFocus() },
      }, [
        h('span', { className: 'lockopt-new' }, '✦ New'),
        h('div', { className: 'pm' }, h('span', { className: 'pm-glyph' }, p.glyph)),
        h('div', { className: 'lockopt-txt' }, [
          h('div', { className: 'lockopt-row' }, [h('span', { className: 'lockopt-name' }, p.name), h('span', { className: 'lockopt-sub' }, p.sub)]),
          h('div', { className: 'lockopt-tag' }, p.tagline),
          h('span', { className: 'lockopt-enter' }, [h('span', { className: 'arw' }, '▶'), ' ' + p.enter]),
        ]),
      ])
    }
    // Sealed teaser — click shakes + reveals its unlock-progress bar.
    const open = this._lockOpen === p.key
    const shk = open ? (this._shakeTick % 2 ? ' shk1' : ' shk0') : ''
    const pr = p.progress
    const detail = open
      ? h('div', { className: 'lockprog' }, [
          h('div', { className: 'lockprog-top' }, [h('span', null, pr.label), h('span', { className: 'lockprog-num' }, `${pr.cur} / ${pr.max}`)]),
          h('div', { className: 'lockprog-bar' }, h('i', { style: { width: Math.round((pr.cur / pr.max) * 100) + '%' } })),
          h('span', { className: 'lockprog-note' }, [h('span', { html: lockGlyphSVG() }), ' ' + pr.note]),
        ])
      : h('span', { className: 'pl-lock' }, [h('span', { html: lockGlyphSVG() }), ' ' + p.unlock])
    return h('div', {
      className: 'lockopt ' + p.acc + shk, dataset: { id: p.key },
      on: { click: () => this._hitLock(p.key) },
    }, [
      h('div', { className: 'pm' }, h('span', { className: 'pm-glyph' }, p.glyph)),
      h('div', { className: 'lockopt-txt' }, [
        h('div', { className: 'lockopt-row' }, [h('span', { className: 'lockopt-name' }, p.name), h('span', { className: 'lockopt-sub' }, p.sub)]),
        h('div', { className: 'lockopt-tag' }, p.tagline),
        detail,
      ]),
    ])
  }

  _emberField() {
    const out = []
    for (let k = 0; k < 22; k++) {
      const left = (k * 4.7 + (k % 5) * 4.1) % 100
      const delay = -((k % 9) * 0.8)
      const dur = 7 + (k % 5) * 1.5
      const size = 2 + (k % 3)
      out.push(h('span', {
        className: 'pg-ember',
        style: {
          left: left + '%', width: size + 'px', height: size + 'px',
          background: 'var(--ember)', boxShadow: `0 0 ${size * 2}px var(--ember)`,
          animationDelay: delay + 's', animationDuration: dur + 's',
        },
      }))
    }
    return out
  }

  // ── interaction ───────────────────────────────────────────────────────────
  _syncGates() {
    for (const id of Object.keys(this._gateRefs)) {
      const g = this._gateRefs[id]
      g?.classList.toggle('sel', id === this._selected)
      g?.classList.toggle('foc', id === this._kbFocus)
    }
  }

  // Click a card to light it (and reveal its CTA); click the lit card again to
  // un-light it. Mirrors the design's toggle. The run only commits via launch.
  _select(id) {
    if (id !== 'campaign' && id !== 'endless') return
    HudSfx.playUi('click')
    this._selected = (this._selected === id) ? null : id
    this._kbFocus = null
    this._syncGates()
  }

  _focus(id) {
    if (id !== 'campaign' && id !== 'endless') return
    if (id !== this._kbFocus) HudSfx.playUi('hover')
    this._kbFocus = id
    this._syncGates()
  }

  _clearFocus() {
    if (this._kbFocus == null) return
    this._kbFocus = null
    this._syncGates()
  }

  // Commit to a mode → persist + advance to the keeper picker (after a beat so
  // the launch toast reads). Guarded against double-fire.
  _launch(id) {
    if (this._launching) return
    if (id !== 'campaign' && id !== 'endless') return
    this._launching = true
    this._selected = id
    this._syncGates()
    HudSfx.playUi('click')
    try { localStorage.setItem(STORE_KEY, id) } catch {}
    const m = this._modes()[id]
    this._toast(id === 'campaign' ? '⚔' : '∞', `Entering <b>${m.name}</b>…`, m.acc)
    this._advance(() => this._scene?.scene?.start('CompanionSelect'))
  }

  // Launch from an unlocked teaser. NG+ is a Campaign run (its tier is chosen at
  // ArchetypeSelect), so it persists runMode='campaign' and advances the same way.
  _launchLocked(p) {
    if (this._launching || !p.unlocked) return
    this._launching = true
    HudSfx.playUi('click')
    try { localStorage.setItem(STORE_KEY, p.launchMode || 'campaign') } catch {}
    this._toast(p.glyph, `Entering <b>${p.name}</b>…`, p.acc)
    this._advance(() => this._scene?.scene?.start('CompanionSelect'))
  }

  _hitLock(id) {
    HudSfx.playUi('hover')
    this._lockOpen = id
    this._shakeTick++
    // Re-render the locked column in place so the progress block + shake show.
    this._refreshLocked()
  }

  // Rebuild just the two locked cards (cheap) to reflect lockOpen/shake state.
  _refreshLocked() {
    const L = this._locked()
    const cols = this._el?.querySelectorAll('.pg-col')
    if (!cols || cols.length < 2) return
    const map = { 0: 'ngplus', 1: 'challenge' }
    cols.forEach((col, i) => {
      const old = col.querySelector('.lockopt')
      if (old) old.replaceWith(this._lockedCard(L[map[i]]))
    })
  }

  _toast(glyph, html, acc) {
    this._el?.querySelector('.qf-msel-toast')?.remove()
    this._el?.appendChild(h('div', { className: 'qf-msel-toast ' + (acc || 'acc-blood') }, [
      h('span', { className: 'tg' }, glyph),
      h('span', { html }),
    ]))
  }

  _advance(fn) {
    this._launchTimer = setTimeout(() => { this._launchTimer = null; fn() }, 780)
  }

  _back() {
    if (this._launching) return
    HudSfx.playUi('click')
    this.close()
    this._scene?.scene?.start('MainMenu')
  }

  _onKey(e) {
    if (this._launching) return
    if (e.key === 'Escape') { e.preventDefault(); this._back(); return }
    if (e.key === 'z' || e.key === 'Z' || e.key === 'Enter') {
      e.preventDefault()
      const target = this._kbFocus || this._selected
      if (target) this._launch(target)
      else this._focus('campaign')   // nothing lit yet → light the first card
      return
    }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); this._focus('campaign'); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); this._focus('endless');  return }
  }
}
