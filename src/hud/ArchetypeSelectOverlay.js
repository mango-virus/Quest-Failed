// ArchetypeSelectOverlay — the DOM boss picker (crypt redesign, 2026-06-15).
//
// Shown by the ArchetypeSelect scene after the companion picker: the form you
// BECOME. An enthronement altar — a central crowned boss portrait flanked by
// two engraved ability tablets (SIGNATURE · Boss Fight = the throne-fight
// headline; PASSIVE · Dungeon Power = the first dungeon mechanic), an HP/ATK/DEF
// crest, a flavor line, and a coin rail of all 12 archetypes. The whole scene
// re-tints to each boss's color on select.
//
// "Keep the plumbing, replace the surface": this replaces the old Phaser
// "bestiary book" render, but all run-launch plumbing stays in the scene —
// the overlay just sets `scene._selectedId` + `scene._ngTier` and calls
// `scene._beginRun()` (createGameState → SaveSystem.save → start('Game')).
//   • unlock gating: UNLOCK_GATES + PlayerProfile.isAchievementUnlocked
//   • NEW tags: PlayerProfile.getKnownBossIds / markBossKnown
//   • Reckoning NG+ chip: PlayerProfile.getReckoningTier (shown only once won)
//   • default selection: PlayerProfile.getLastArchetypeId, else first unlocked
//   • BACK → CompanionSelect; CONFIRM → scene._beginRun
//
// Data: src/data/bossArchetypes.json (read from the Phaser JSON cache via the
// scene). The whole-scene re-tint uses a per-boss --bc CSS var set inline.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { buildCryptBackdrop } from './menuBackdrop.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { UNLOCK_GATES } from '../data/bossUnlocks.js'
import { dismissNewChip } from './hudShared.js'

function hexToCss(c) {
  if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0')
  const s = String(c || '').replace(/^0x/, '')
  return /^[0-9a-fA-F]{6}$/.test(s) ? '#' + s : '#ddaa55'
}

// Split a "Name — body" mechanic string into its title + sentence. Mechanics
// in bossArchetypes.json are authored as "Tyrant's Gaze (day active) — arm,
// click a room…"; the em-dash separates the ability name from its effect.
function splitMech(text) {
  const t = String(text || '')
  const i = t.indexOf('—')
  if (i > 0) return { name: t.slice(0, i).trim(), body: t.slice(i + 1).trim() }
  return { name: 'Dungeon Power', body: t }
}

export class ArchetypeSelectOverlay {
  constructor(scene) {
    this._scene    = scene
    this._el       = null
    this._altarEl  = null   // re-rendered per selection
    this._railEl   = null
    this._footEl   = null
    this._coinRefs = {}
    this._archs    = []
    this._selected = null
    this._ngTier   = 0
    this._known    = new Set()
    this._keyHandler = (e) => this._onKey(e)
  }

  open() {
    if (this._el) return
    installHudSfxDelegates()
    ensureStageScaled()

    // Archetypes from the Phaser JSON cache, sorted by name (matches the old
    // book's compendium order).
    this._archs = (this._scene?.cache?.json?.get?.('bossArchetypes') ?? [])
      .slice().sort((a, b) => a.name.localeCompare(b.name))
    if (!this._archs.length) return

    this._known = PlayerProfile.getKnownBossIds()

    // Default selection: the remembered last pick if unlocked, else the first
    // unlocked archetype, else the first in the list.
    const firstUnlocked = this._archs.find(a => !this._isLocked(a.id))
    this._selected = firstUnlocked?.id || this._archs[0].id
    try {
      const last = PlayerProfile.getLastArchetypeId?.()
      if (last && this._archs.some(a => a.id === last) && !this._isLocked(last)) {
        this._selected = last
      }
    } catch {}

    // Reckoning NG+ tier — default to the highest earned (cycles 0..earned).
    // NG+ is a CAMPAIGN concept (it scales the act run); an Endless run never
    // reads it, so force 0 there and hide the chip (see _renderFoot).
    const earned = PlayerProfile.getReckoningTier() || 0
    this._ngTier = this._isEndlessRun() ? 0 : earned

    this._render()
    window.addEventListener('keydown', this._keyHandler, true)
  }

  close() {
    this._el?.remove()
    this._el = null
    window.removeEventListener('keydown', this._keyHandler, true)
  }

  // ── unlock gating (mirrors scene plumbing) ──────────────────────────────
  _isLocked(id) {
    const gate = UNLOCK_GATES[id]
    if (!gate) return false
    return !PlayerProfile.isAchievementUnlocked(gate.achId)
  }

  _arch(id) { return this._archs.find(a => a.id === id) || this._archs[0] }

  // ── render ──────────────────────────────────────────────────────────────
  _render() {
    this._altarEl = h('div', { className: 'qf-bp-altar' })
    this._railEl  = h('div', { className: 'qf-bp-rail' })
    this._footEl  = h('div', { className: 'qf-bp-foot' })

    this._el = h('div', { className: 'qf-bp' }, [
      // Crypt backdrop — brick wall + flanking torches + fog (title-screen look).
      ...buildCryptBackdrop(),
      h('div', { className: 'qf-bp-rays' }),
      h('div', { className: 'qf-bp-halo' }),
      h('div', { className: 'qf-bp-floor' }),
      h('div', { className: 'qf-bp-embers' }, this._emberPieces()),
      h('div', { className: 'qf-bp-vig' }),
      h('button', { className: 'pix qf-bp-back', on: { click: () => this._back() } }, '◀  KEEPER'),
      h('div', { className: 'qf-bp-head' }, [
        h('div', { className: 'sil qf-bp-eyebrow' }, [
          h('span', { className: 'ln' }), '◆ THE DARK THRONE AWAITS ◆', h('span', { className: 'ln r' }),
        ]),
        h('div', { className: 'pix qf-bp-title' }, 'CHOOSE YOUR ARCHETYPE'),
      ]),
      this._altarEl,
      this._railEl,
      this._footEl,
    ])

    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)

    this._renderRail()
    this._renderAltar()
    this._renderFoot()
    this._applyTint()
  }

  // Re-tint the whole scene to the selected boss's color via --bc vars.
  _applyTint() {
    const b = this._arch(this._selected)
    const c = hexToCss(b.color)
    this._el.style.setProperty('--bc', c)
    this._el.style.setProperty('--bcL', `color-mix(in srgb, ${c} 72%, #f0e6d4)`)
    this._el.style.setProperty('--bcD', `color-mix(in srgb, ${c} 55%, #050208)`)
  }

  _portrait(id, size) {
    return h('img', {
      className: 'qf-bp-portimg',
      src: `assets/ui/bestiary/portraits/${id}_p.png`, alt: '',
      style: { width: `${size}px`, height: `${size}px`, objectFit: 'contain', imageRendering: 'pixelated', display: 'block' },
      on: { error: (e) => { e.currentTarget.style.visibility = 'hidden' } },
    })
  }

  // Throne (center) + two ability tablets — rebuilt per selection so the
  // sweep/float entrance animations re-trigger.
  _renderAltar() {
    const b      = this._arch(this._selected)
    const locked = this._isLocked(b.id)
    const stats  = b.baseFightStats || { hp: 200, attack: 12, defense: 10 }
    const sig    = b.headline || {}
    const mech   = splitMech((b.mechanics && b.mechanics[0] && b.mechanics[0].text) || '')

    const leftTablet = h('div', { className: 'qf-bp-tablet left' }, [
      h('span', { className: 'sil qf-bp-ribbon' }, '☠ Signature · Boss Fight'),
      h('div', { className: 'qf-bp-tab-main' }, [
        h('div', { className: 'qf-bp-emblem' }, '☠'),
        h('div', { className: 'pix qf-bp-abname' }, sig.name || b.name),
      ]),
      h('div', { className: 'qf-bp-abtext' }, sig.summary || ''),
    ])

    const throneKids = [
      h('div', { className: 'qf-bp-crown' }, '♛'),
      h('div', { className: 'qf-bp-arch' + (locked ? ' locked' : '') }, [
        this._portrait(b.id, 188),
        locked && h('div', { className: 'qf-bp-archlock' }, '🔒'),
      ].filter(Boolean)),
      h('div', { className: 'pix qf-bp-name' }, b.name),
      h('div', { className: 'sil qf-bp-tag' }, b.tagline || ''),
      h('div', { className: 'qf-bp-crest' }, [
        h('div', { className: 'st' }, [h('i', null, 'HP'),  h('b', null, String(stats.hp ?? '?'))]),
        h('div', { className: 'st' }, [h('i', null, 'ATK'), h('b', null, String(stats.attack ?? '?'))]),
        h('div', { className: 'st' }, [h('i', null, 'DEF'), h('b', null, String(stats.defense ?? '?'))]),
      ]),
      h('div', { className: 'qf-bp-flavor' }, '“' + (b.flavorText || '') + '”'),
    ]
    const throne = h('div', { className: 'qf-bp-throne' }, throneKids)

    const rightTablet = h('div', { className: 'qf-bp-tablet right' }, [
      h('span', { className: 'sil qf-bp-ribbon' }, '◈ Passive · Dungeon Power'),
      h('div', { className: 'qf-bp-tab-main' }, [
        h('div', { className: 'qf-bp-emblem' }, '◈'),
        h('div', { className: 'pix qf-bp-abname' }, mech.name),
      ]),
      h('div', { className: 'qf-bp-abtext' }, mech.body),
    ])

    this._altarEl.replaceChildren(leftTablet, throne, rightTablet)
  }

  _renderRail() {
    this._coinRefs = {}
    this._railEl.replaceChildren(...this._archs.map(a => this._coin(a)))
  }

  _coin(a) {
    const locked = this._isLocked(a.id)
    const isNew  = !locked && !this._known.has(a.id)
    const kids = [this._portrait(a.id, a.id === this._selected ? 66 : 52)]
    if (locked) kids.push(h('div', { className: 'qf-bp-coinlock' }, '🔒'))
    if (isNew)  kids.push(h('span', { className: 'sil qf-bp-coinnew qf-newchip' }, 'NEW'))
    const coin = h('button', {
      className: 'qf-bp-coin' + (a.id === this._selected ? ' on' : '') + (locked ? ' locked' : ''),
      style: { '--cc': hexToCss(a.color) },
      title: a.name,
      on: {
        mouseenter: () => { HudSfx.playUi('hover'); this._ackCoin(a.id) },
        click: () => this._selectCoin(a.id),
      },
    }, kids)
    this._coinRefs[a.id] = coin
    return coin
  }

  // Acknowledge an unlocked archetype's NEW dot (hover or select) — mark it
  // known (persisted + in-memory) and fade the dot out in place. No-op for
  // locked / already-known archetypes.
  _ackCoin(id) {
    if (this._isLocked(id) || this._known.has(id)) return
    PlayerProfile.markBossKnown(id)
    this._known.add(id)
    dismissNewChip(this._coinRefs[id]?.querySelector('.qf-bp-coinnew'))
  }

  // True when the run being started is Endless (mode picked on ModeSelect, stored
  // in localStorage 'qf.runMode'). Endless has no acts, so NG+ / Reckoning UI hides.
  _isEndlessRun() {
    try { return localStorage.getItem('qf.runMode') === 'endless' } catch { return false }
  }

  // Footer — optional Reckoning NG+ chip (shown only once the campaign's been
  // won, and only for a Campaign run) + the big ASCEND / locked notice.
  _renderFoot() {
    const b      = this._arch(this._selected)
    const locked = this._isLocked(b.id)
    const earned = PlayerProfile.getReckoningTier() || 0
    const kids = []

    if (earned > 0 && !this._isEndlessRun()) {
      kids.push(h('button', {
        className: 'pix qf-bp-ngchip',
        on: { click: () => {
          this._ngTier = (this._ngTier + 1) % (earned + 1)
          HudSfx.playUi('click')
          this._renderFoot()
        } },
      }, this._ngTier > 0 ? `RECKONING  NG+${this._ngTier}  ▸` : 'BASE CAMPAIGN  ▸'))
    }

    if (locked) {
      const gate = UNLOCK_GATES[b.id]
      kids.push(h('div', { className: 'sil qf-bp-locknote' }, [
        h('span', { className: 'lk' }, '🔒'), gate?.label || 'LOCKED',
      ]))
    } else {
      kids.push(h('button', {
        className: 'pix qf-bp-confirm',
        on: { click: () => this._confirm() },
      }, `ASCEND AS ${(b.name || '').toUpperCase()}  ▶`))
    }
    this._footEl.replaceChildren(...kids)
  }

  _emberPieces() {
    const out = []
    for (let k = 0; k < 20; k++) {
      const left  = (k * 5.1 + (k % 6) * 3.7) % 100
      const delay = (k % 8) * 0.7
      const dur   = 6.5 + (k % 5) * 1.3
      const size  = 2 + (k % 3)
      out.push(h('span', {
        className: 'qf-bp-ember',
        style: { left: left + '%', width: size + 'px', height: size + 'px', animationDelay: delay + 's', animationDuration: dur + 's' },
      }))
    }
    return out
  }

  // ── interaction ─────────────────────────────────────────────────────────
  _selectCoin(id) {
    if (id === this._selected) return
    const locked = this._isLocked(id)
    HudSfx.playUi(locked ? 'hover' : 'click')
    this._selected = id
    // Dismiss the NEW dot when an unlocked archetype is first selected.
    if (!locked && !this._known.has(id)) {
      PlayerProfile.markBossKnown(id)
      this._known.add(id)
    }
    // Toggle coin highlight + resize selected/deselected portraits.
    for (const cid of Object.keys(this._coinRefs)) {
      const coin = this._coinRefs[cid]
      const on   = cid === this._selected
      coin.classList.toggle('on', on)
      const img = coin.querySelector('.qf-bp-portimg')
      if (img) { const s = on ? 66 : 52; img.style.width = s + 'px'; img.style.height = s + 'px' }
      const nd = coin.querySelector('.qf-bp-coinnew')
      if (on && nd) dismissNewChip(nd)
    }
    this._renderAltar()
    this._renderFoot()
    this._applyTint()
  }

  // ── navigation (delegates to scene plumbing) ────────────────────────────
  _confirm() {
    if (this._isLocked(this._selected)) { HudSfx.playUi('denied'); return }
    HudSfx.playUi('click')
    // Hand the choice back to the scene's run-launch plumbing.
    this._scene._selectedId = this._selected
    this._scene._ngTier     = this._ngTier
    this.close()
    this._scene._beginRun()
  }

  _back() {
    this.close()
    this._scene?.scene?.start('CompanionSelect')
  }

  _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this._back(); return }
    if (e.key === 'Enter')  { e.preventDefault(); this._confirm(); return }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const i = this._archs.findIndex(a => a.id === this._selected)
      const dir = e.key === 'ArrowRight' ? 1 : -1
      const next = this._archs[(i + dir + this._archs.length) % this._archs.length]
      this._selectCoin(next.id)
    }
  }
}
