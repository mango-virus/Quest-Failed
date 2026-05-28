// PactPicker — "The Grimoire of Dark Pacts".
//
// The climactic nightly bargain. A demon broker presides over a ritual
// chamber; a cursed violet tome sits CLOSED on the desk until the
// player unseals it. Once open, each of the three offered pacts is a
// two-page spread inside it:
//   left page  — wax sigil, pact name, rarity stamp, flavour
//   right page — the Deal (the boon), the Price (the cost), and the
//                blood-signature line + SIGN button
// Three rarity-coloured bookmarks ride the top of the tome — click one
// to flip (page-turn animation) to that pact. Signing scrawls a blood
// signature, slams a wax seal onto the page, snaps the tome shut, and
// streams the pact's essence to the buff row.
//
// Book sprite sheets live in assets/sprites/pact-book/ (the Craftpix
// "magic book" pack recoloured to arcane purple by
// tools/recolor-pact-book.mjs). The broker uses a per-persona sprite —
// VEX'KAR is the full animated dark-deal demon; the rest are the
// imported idle strips. A small JS frame-player drives everything.
//
// Mandatory modal — the only way out is to seal a pact. Event contract:
//   * SHOW_DARK_PACT opens it.
//   * On seal: DungeonMechanicSystem.activate(), then PACT_SEALED
//     { mechanicId, rarity } + DARK_PACT_SEALED { mechanicId }.
//   * If there are genuinely no offers, DARK_PACT_SEALED { mechanicId:null }.

import { h, mount } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { Balance } from '../config/balance.js'

// Recoloured magic-book sheets. Open/Close are 4×3 (12 frames of 272px);
// the page-turns are 4×4 (16 frames). Frame order is left→right, top→bottom.
const BOOK = {
  open:  'assets/sprites/pact-book/Open_book.png',
  close: 'assets/sprites/pact-book/Close_book.png',
  turnF: 'assets/sprites/pact-book/Turning_pages_left.png',
  turnB: 'assets/sprites/pact-book/Turning_pages_right.png',
}
// The book starts on frame 0 (the closed cover) and opens to frame 11
// (full spread); the close runs the whole way back to a fully-shut book.
// The page-turn sheets are 4×4 but their 16th cell (frame 15) is an
// empty padding cell — the turn animation is frames 0-14.
const OPEN_FROM = 0, OPEN_TO = 11
const CLOSE_FROM = 0, CLOSE_TO = 11
const TURN_LAST = 14

const RARITY = {
  common:    { c1: '#d8d2c0', c2: '#8f8a76', c3: '#3a372e', glow: 'rgba(216,210,192,0.55)', label: 'COMMON',    stamp: 'WHISPERED', weight: 0 },
  uncommon:  { c1: '#86e89a', c2: '#3f9a52', c3: '#1c4a26', glow: 'rgba(122,226,142,0.62)', label: 'UNCOMMON',  stamp: 'SPOKEN',    weight: 1 },
  rare:      { c1: '#ffd86a', c2: '#c8951f', c3: '#5a3c08', glow: 'rgba(255,206,90,0.72)',  label: 'RARE',      stamp: 'BINDING',   weight: 2 },
  epic:      { c1: '#e2a6f2', c2: '#8a3cc0', c3: '#3a1858', glow: 'rgba(212,124,242,0.78)', label: 'EPIC',      stamp: 'ANCIENT',   weight: 3 },
  legendary: { c1: '#ff8a96', c2: '#cc3346', c3: '#5a1018', glow: 'rgba(255,96,112,0.92)',  label: 'LEGENDARY', stamp: 'FORBIDDEN', weight: 4 },
  // Damned — solid black. A desaturated charcoal gradient with a faint
  // blood sheen so the void-black tome still reads against the dark UI.
  damned:    { c1: '#7a6a72', c2: '#1c1a1f', c3: '#040405', glow: 'rgba(150,30,40,0.88)',   label: 'DAMNED',    stamp: 'DAMNED',    weight: 5 },
}
const RARITY_GLYPH = {
  common: '❖', uncommon: '✦', rare: '✠', epic: '❂', legendary: '⛧', damned: '☠',
}

// Lilith — the dungeon keeper — is the broker of the Grimoire. She
// replaced the old roster of demon-broker sprites; the contextual
// dialogue in LINES below is now routed to her companion bubble via the
// NPC_BROKER_SAY event (NpcDirector → NpcCompanion). Each delivery
// carries an expression id so the companion's portrait matches the
// moment. Ids are kept to the set BOTH companions share, so whichever
// keeper the player chose has a real sprite for it.
const VIEW_EXPR = {
  common: 'smug', uncommon: 'mischievous', rare: 'laughing',
  epic: 'evil', legendary: 'excited', damned: 'evil',
}

const LINES = {
  closed: [
    'The tome is shut. Unseal it, and let us bargain.',
    'Three pages wait within. Crack the spine, Architect.',
    'It will not read itself. Open the grimoire.',
    'Go on. It only bites the once.',
    'The book is locked. For your protection. Mine, mostly.',
  ],
  open: [
    'Three pages. Three bargains. One signature.',
    'The tome is open. Read. Choose. Sign.',
    'Leaf through, if you must. The ink waits.',
    'Every page is a debt. Pick the one you can bear.',
  ],
  openLegendary: [
    'One of these pages reeks of the old power… turn carefully.',
    'The tome offers a forbidden bargain tonight. I would know.',
  ],
  // Spoken when the grimoire opens BLACK — an all-Damned hand. Every page
  // is a curse with only a sliver of bribe. There is no safe choice here.
  openDamned: [
    'Black, tonight. The grimoire only opens this colour when it is hungry.',
    'Every page here is a wound. Choose which one you can live around.',
    'No bargains tonight — only debts wearing the shape of gifts.',
    'The black tome. I would say "choose wisely," but… well.',
  ],
  // Periodic chatter while the player browses — funny, sinister, and a
  // little fourth-wall.
  idle: [
    "Take your time. I am paid by the hour. ...And the soul. Mostly the soul.",
    'I receive a commission on every signature. No pressure.',
    'Is it the font? People always blame the font.',
    'I have other appointments, you understand. The dead are dreadfully punctual.',
    'You could read faster. I believe in you. Loosely.',
    "I once waited four centuries for a Lich to choose. Do not be a Lich.",
    'My quill grows cold. So does my patience. So does everything down here.',
    'Every page you pass over… remembers being passed over.',
    'The ink already knows your name. It is merely being polite.',
    'Whatever you pick, I profit. Sit with that a moment.',
    'Your soul has a pleasing heft. Compact. Well-marbled.',
    'The dungeon below can hear you deliberate. It has begun to drool.',
    'There are no wrong choices here. Only debts, and how loudly they come due.',
    'Sign, and we are bound. Refuse, and we are bound anyway — only slower.',
    'I can see your cursor. It hovers. It hesitates. It always hesitates.',
    'You may step away. The tab will keep. I will keep. I am very good at keeping.',
    'You have hovered that page thrice now. We have both noticed.',
    'Somewhere a developer is watching this exchange. Do wave.',
    'Someone laboured a great while over this little book. Honour them — choose.',
    'You cannot truly pause this. You can leave. I will simply… wait. In here.',
    'This is the part of the game where you are meant to feel cunning.',
    'Click something, dread Architect. The silence is unbecoming.',
    'I shall still be here when you alt-tab back. I am always here.',
    'A tip, between us: the bane is never as small as it reads.',
    'Blink if you can hear me. ...I cannot see you blink. That is the horror of it.',
  ],
  // Spoken when a pact is turned to, keyed by its rarity.
  view: {
    common:    [
      'A modest page. Sensible. Forgettable.',
      'Pocket change, for a soul like yours.',
      'Common ink. It still stains forever.',
      'Humble terms. The dungeon will scarcely notice.',
    ],
    uncommon:  [
      'Better. These terms have a little texture.',
      'A fair page — as my pages go.',
      'Respectable. Not the worst thing you will sign tonight.',
      'Middling cruelty. A starter cruelty.',
    ],
    rare:      [
      'Now you are reading. The Ledger approves.',
      'Gilt-edged, this one. A spender, are you?',
      'Rare ink. It costs more than you think — and you already think it costs a lot.',
      'Ooh. Linger there a moment. Let it tempt you.',
    ],
    epic:      [
      'Mmm. That page bites back.',
      'Ambitious ink. I respect a debtor with nerve.',
      'An epic bargain. Epics end in songs. Rarely happy ones.',
      'Careful — that one has opinions about you.',
    ],
    legendary: [
      'Are you certain? This page outlived its last three signatories.',
      'My hands tremble at this one. Sign it… sign it.',
      'Legendary. The word means "the story they tell afterward."',
      'That page was sealed away for a reason. The reason was screaming.',
    ],
    damned: [
      'A damned page. The bribe is real. So is everything that comes after.',
      'Read the small print. Then read the large print. The large print wins.',
      'You may take the coin. The coin, however, also takes you.',
      'This one does not bargain. It simply collects, and collects, and collects.',
    ],
  },
  // Optional jab keyed by a pact's primary tag (see _viewLine).
  tag: {
    gold:       ['Gold. You reek of it already — let me deepen the scent.', 'A money page. My very favourite kind of sin.'],
    minion:     ['Minions. Loyal little things. Loyalty is just a debt that smiles.', 'More bodies for the dungeon. It says thank you.'],
    boss:       ['This one touches YOU. Bold, signing your own flesh away.', 'A bargain for the boss — for you. Do keep that in mind.'],
    trap:       ['Traps. Cowardly. Effective. I adore it.', 'The adventurers never read the fine print either.'],
    knowledge:  ['You would lie to a hero? I am almost proud.', 'Secrets and false maps. Now you speak my language.'],
    adventurer: ['Meddling with the heroes themselves. Personal.', 'You would reach into their little stories and twist. Lovely.'],
    summon:     ['Things from elsewhere, called here. Elsewhere always wants paying.'],
    slot:       ['Room for more wretches. Crowded is cosy.'],
    attack:     ['Teeth. Direct of you. I respect directness in a debtor.'],
    curse:      ['A curse. Curses are just gifts that keep arriving.'],
  },
  reroll: [
    'Cold feet? The pages refresh — my patience does not.',
    'Riffle them away, then. Fresh ink. Same hunger.',
    'Indecision is also a choice. A boring one.',
    'New terms. The old ones will sulk, but they will live.',
  ],
  seal: {
    low:  [
      'Done. The dungeon drinks deep tonight.',
      'Signed and sealed. A pleasure, as these things go.',
      'A small debt. They add up. Oh, how they add up.',
    ],
    mid:  [
      'A fine bargain. The night is yours — most of it.',
      'The wax is set. No refunds, no appeals, no mercy desk.',
      'Sealed. I shall file you under "promising."',
    ],
    high: [
      'It is DONE. The Ledger remembers this name now.',
      'Bound to your bones. Welcome to the red.',
      'You signed the big one. Somewhere, something ancient just woke smiling.',
    ],
  },
}

const SIGNATURE_PATH =
  'M8 44 C 20 8,30 10,34 40 S 44 62,52 32 C 58 12,66 16,70 44 ' +
  'C 74 60,84 58,90 30 C 96 10,106 16,110 46 C 114 62,124 58,132 28 ' +
  'C 140 8,150 14,154 44 C 158 60,170 58,178 30 C 186 10,198 16,204 42 ' +
  'C 210 58,222 54,236 30 L 256 36'

// The summoning-circle SVG for the left page — concentric rings, a band
// of tick runes and an inscribed pentagram. The rings and star trace
// themselves in (stroke-dash animations) on every page-turn, then the
// two groups counter-rotate forever. All colour, glow, star strength
// and spin speed are driven by CSS off the pact's rarity.
const SUMMON_SVG =
  '<svg class="qf-ip-sc-svg" viewBox="0 0 240 240" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<g class="qf-ip-sc-spin qf-ip-sc-cw">' +
      '<circle class="qf-ip-sc-ring qf-ip-sc-r1" cx="120" cy="120" r="113" pathLength="1"/>' +
      '<circle class="qf-ip-sc-ticks" cx="120" cy="120" r="104" pathLength="1"/>' +
    '</g>' +
    '<g class="qf-ip-sc-spin qf-ip-sc-ccw">' +
      '<polygon class="qf-ip-sc-star" points="120,40 167,184.7 43.9,95.3 196.1,95.3 73,184.7" pathLength="1"/>' +
      '<circle class="qf-ip-sc-ring qf-ip-sc-r2" cx="120" cy="120" r="87" pathLength="1"/>' +
    '</g>' +
    '<circle class="qf-ip-sc-ring qf-ip-sc-r3" cx="120" cy="120" r="67" pathLength="1"/>' +
  '</svg>'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
const pick = (arr) => arr[(Math.random() * arr.length) | 0]

export class PactPicker {
  constructor(gameState) {
    this._gameState  = gameState
    this._el         = null
    this._offers     = []
    this._pageIdx    = 0
    this._busy       = false   // gates input during open / turn / seal
    this._signing    = false
    this._sealResolved = false
    this._opened     = false   // has the tome been unsealed yet?
    this._rerollUsed = false
    this._menuOpenEmitted = false   // tracks the HUD_MENU_OPENED/CLOSED pair
    this._timers      = []
    this._ashTimer    = 0
    this._sheetTimer  = 0
    this._chatterTimer = 0

    this._listener = (payload) => this.open(payload)
    EventBus.on('SHOW_DARK_PACT', this._listener)
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  open(opts = {}) {
    if (this._el) return
    // Roll the grimoire's colour ONCE per opening (held across rerolls):
    // a black grimoire (10%) deals an all-Damned hand of curses. Callers can
    // force it — the Dark Deal demon always presents the black grimoire.
    this._blackGrimoire = opts?.forceBlack ? true : this._rollBlackGrimoire()
    this._offers = this._fetchOffers()
    // Mandatory modal with no exit — if there is genuinely nothing to
    // offer, resolve immediately so EndOfDay isn't soft-locked.
    if (!this._offers.length) {
      EventBus.emit('DARK_PACT_SEALED', { mechanicId: null })
      return
    }
    this._pageIdx    = 0
    this._busy       = false
    this._signing    = false
    this._sealResolved = false
    this._opened     = false
    this._rerollUsed = false

    this._build()
    this._startAsh()
    this._renderFooterClosed()
    // Lilith steps in beside the Grimoire as its broker.
    this._menuOpenEmitted = true
    EventBus.emit('HUD_MENU_OPENED', { kind: 'pact' })

    // She beckons toward the shut tome.
    this._after(900, () => this._brokerSay(pick(LINES.closed), 'mischievous'))
  }

  destroy() {
    EventBus.off('SHOW_DARK_PACT', this._listener)
    this._teardown()
  }

  _teardown() {
    for (const t of this._timers) clearTimeout(t)
    this._timers = []
    if (this._ashTimer)     { clearInterval(this._ashTimer);    this._ashTimer = 0 }
    if (this._sheetTimer)   { clearInterval(this._sheetTimer);  this._sheetTimer = 0 }
    if (this._chatterTimer) { clearTimeout(this._chatterTimer); this._chatterTimer = 0 }
    // Release Lilith from her docked-beside-the-Grimoire stance.
    if (this._menuOpenEmitted) {
      this._menuOpenEmitted = false
      EventBus.emit('HUD_MENU_CLOSED', { kind: 'pact' })
    }
    this._el?.remove()
    this._el = null
  }

  _after(ms, fn) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter(t => t !== id)
      fn()
    }, ms)
    this._timers.push(id)
    return id
  }

  // ── Offers ──────────────────────────────────────────────────────────────

  // Black grimoire (10%) → an all-Damned hand. Force via localStorage
  // `qf.forceGrimoire` = 'black' | 'purple' for testing.
  _rollBlackGrimoire() {
    try {
      const forced = localStorage.getItem('qf.forceGrimoire')
      if (forced === 'black')  return true
      if (forced === 'purple') return false
    } catch {}
    const chance = Balance.MECHANIC_BLACK_GRIMOIRE_CHANCE ?? 0.10
    return Math.random() < chance
  }

  _fetchOffers() {
    const game      = window.__game
    const gameScene = game?.scene?.getScene?.('Game')
    const sys       = gameScene?.dungeonMechanicSystem
    const archId    = this._gameState.player?.bossArchetypeId
    const dLv       = this._gameState.boss?.level ?? 1
    const opts      = { onlyDamned: !!this._blackGrimoire }
    if (sys?.getOfferings) return sys.getOfferings(3, archId, dLv, opts) ?? []
    const defs = this._cachedJson('dungeonMechanics') ?? []
    const pool = [...defs]
    const out  = []
    while (out.length < 3 && pool.length > 0) {
      out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0])
    }
    return out
  }

  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
    }
    return null
  }

  _rarKey(idx) { return String(this._offers[idx]?.rarity || 'common').toLowerCase() }
  _rar(idx)    { return RARITY[this._rarKey(idx)] || RARITY.common }

  // ── Build (once) ────────────────────────────────────────────────────────

  _build() {
    const hasLegendary = this._offers.some(o => (o?.rarity ?? '') === 'legendary')

    // One layer per sheet, each with its background-image set ONCE so the
    // browser never re-decodes mid-animation. Inactive layers sit at a
    // near-zero opacity (not 0) — fully transparent layers get their
    // decoded bitmap dropped, which flashed the book blank on the next
    // page-turn; 0.004 keeps them painted (decode warm) yet invisible.
    this._layerOpen  = h('div', { className: 'qf-ip-book-layer',
      style: { backgroundImage: `url(${BOOK.open})`,  backgroundSize: '400% 300%' } })
    this._layerTurnF = h('div', { className: 'qf-ip-book-layer',
      style: { backgroundImage: `url(${BOOK.turnF})`, backgroundSize: '400% 400%', opacity: '0.004' } })
    this._layerTurnB = h('div', { className: 'qf-ip-book-layer',
      style: { backgroundImage: `url(${BOOK.turnB})`, backgroundSize: '400% 400%', opacity: '0.004' } })
    this._layerClose = h('div', { className: 'qf-ip-book-layer',
      style: { backgroundImage: `url(${BOOK.close})`, backgroundSize: '400% 300%', opacity: '0.004' } })
    this._bookEl    = h('div', { className: 'qf-ip-book' }, [
      this._layerOpen, this._layerTurnF, this._layerTurnB, this._layerClose,
    ])
    this._pageL     = h('div', { className: 'qf-ip-page qf-ip-page-l' })
    this._pageR     = h('div', { className: 'qf-ip-page qf-ip-page-r' })
    this._bookmarks = h('div', { className: 'qf-ip-bookmarks' })
    this._bookWrap  = h('div', { className: 'qf-ip-book-wrap is-shut', dataset: { rarity: 'common' } }, [
      this._bookmarks,
      this._bookEl,
      this._pageL,
      this._pageR,
    ])
    this._setLayerFrame(this._layerOpen, OPEN_FROM, 4, 3)   // closed cover

    // Mandatory modal — no backdrop dismiss, no Esc, no walk-away.
    this._el = h('div', {
      className: 'qf-pact-picker qf-ip',
      dataset: {
        legendary: hasLegendary ? 'true' : 'false',
        grimoire:  this._blackGrimoire ? 'black' : 'purple',
      },
    }, [
      h('div', { className: 'qf-ip-circle' }),
      h('div', { className: 'qf-ip-candle qf-ip-candle-l' }),
      h('div', { className: 'qf-ip-candle qf-ip-candle-r' }),
      h('div', { className: 'qf-ip-smoke qf-ip-smoke-1' }),
      h('div', { className: 'qf-ip-smoke qf-ip-smoke-2' }),
      h('div', { className: 'qf-ip-ash', ref: (el) => { this._ashEl = el } }),
      h('div', { className: 'qf-ip-vignette' }),
      h('div', { className: 'qf-ip-flash', ref: (el) => { this._flashEl = el } }),

      h('div', { className: 'qf-ip-stage', ref: (el) => { this._stageEl = el } }, [
        this._buildHeader(),
        this._bookWrap,
        this._buildFooter(),
      ]),
    ])

    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)
  }

  _buildHeader() {
    return h('div', { className: 'qf-ip-titleplate' }, [
      h('div', { className: 'qf-ip-title-rule' }),
      h('div', { className: 'pix qf-ip-title' }, 'THE GRIMOIRE OF DARK PACTS'),
      h('div', { className: 'qf-ip-title-rule' }),
    ])
  }

  _buildFooter() {
    this._footerEl = h('div', { className: 'qf-ip-footer' })
    return this._footerEl
  }

  // Footer before the tome is opened — a single prominent unseal button.
  _renderFooterClosed() {
    this._openBtn = h('button', {
      className: 'btn qf-ip-open-btn',
      on: { click: () => this._openBook() },
    }, [
      h('span', { className: 'pix qf-ip-open-btn-label' }, '✦  UNSEAL THE GRIMOIRE  ✦'),
    ])
    mount(this._footerEl, [this._openBtn])
  }

  // Footer once open — reroll + the mandatory hint.
  _renderFooterOpen() {
    this._rerollBtn = h('button', {
      className: 'btn qf-ip-reroll',
      on: { click: () => this._reroll() },
    }, '↻  DEMAND NEW TERMS  (1 LEFT)')
    mount(this._footerEl, [
      this._rerollBtn,
      h('div', { className: 'mono qf-ip-bind-hint' },
        '— the night will not begin until a pact is sealed —'),
    ])
  }

  // ── Book frame player ───────────────────────────────────────────────────

  _framePos(f, cols, rows) {
    const col = f % cols, row = (f / cols) | 0
    const x = cols > 1 ? (col / (cols - 1)) * 100 : 0
    const y = rows > 1 ? (row / (rows - 1)) * 100 : 0
    return `${x}% ${y}%`
  }

  // Show one book layer; the rest drop to a near-zero opacity (see _build
  // — keeps their images decoded so swapping layers never flashes).
  _showLayer(active) {
    for (const lyr of [this._layerOpen, this._layerTurnF, this._layerTurnB, this._layerClose]) {
      lyr.style.opacity = lyr === active ? '1' : '0.004'
    }
  }

  _setLayerFrame(layer, frame, cols, rows) {
    layer.style.backgroundPosition = this._framePos(frame, cols, rows)
  }

  // Play a sheet layer from `from`→`to`. Single-flight. No background-image
  // swap ever happens — each layer keeps its own sheet — so the book never
  // flashes between frames.
  _playSheet({ layer, cols, rows, from, to, fps, onDone }) {
    if (this._sheetTimer) { clearInterval(this._sheetTimer); this._sheetTimer = 0 }
    this._showLayer(layer)
    this._setLayerFrame(layer, from, cols, rows)
    const step = to >= from ? 1 : -1
    let f = from
    this._sheetTimer = setInterval(() => {
      if (f === to) {
        clearInterval(this._sheetTimer); this._sheetTimer = 0
        onDone && onDone()
        return
      }
      f += step
      this._setLayerFrame(layer, f, cols, rows)
    }, Math.max(16, 1000 / fps))
  }

  _showPages(show) {
    this._bookWrap.classList.toggle('pages-hidden', !show)
  }

  // ── Unseal ──────────────────────────────────────────────────────────────

  // Triggered by the UNSEAL button. Plays the open animation, then deals
  // the pages + bookmarks and swaps the footer to reroll mode.
  _openBook() {
    if (this._busy || this._opened) return
    this._opened = true
    this._busy = true
    this._bookWrap.classList.remove('is-shut')
    mount(this._footerEl, [])           // clear the unseal button
    this._sfx('sfx-book-open', 0.8)
    this._playSheet({
      layer: this._layerOpen, cols: 4, rows: 3, from: OPEN_FROM, to: OPEN_TO, fps: 18,
      onDone: () => {
        this._setLayerFrame(this._layerOpen, OPEN_TO, 4, 3)
        this._renderBookmarks()
        this._renderPage(this._pageIdx)
        this._showPages(true)
        this._renderFooterOpen()
        this._busy = false
        if (this._blackGrimoire) {
          this._brokerSay(pick(LINES.openDamned), 'evil')
        } else {
          const hasLeg = this._offers.some(o => (o?.rarity ?? '') === 'legendary')
          this._brokerSay(hasLeg ? pick(LINES.openLegendary) : pick(LINES.open),
            hasLeg ? 'excited' : 'evil')
        }
      },
    })
  }

  // ── Page content ────────────────────────────────────────────────────────

  _renderPage(idx) {
    const pact   = this._offers[idx]
    const rarKey = this._rarKey(idx)
    const rar    = this._rar(idx)
    this._bookWrap.dataset.rarity = rarKey
    this._bookWrap.style.setProperty('--c1', rar.c1)
    this._bookWrap.style.setProperty('--c2', rar.c2)
    this._bookWrap.style.setProperty('--c3', rar.c3)
    this._bookWrap.style.setProperty('--glow', rar.glow)

    const svgWrap = h('div', { className: 'qf-ip-summon-svg' })
    svgWrap.innerHTML = SUMMON_SVG
    const pips = []
    for (let k = 0; k < 5; k++) {
      pips.push(h('span', { className: 'qf-ip-summon-pip' + (k <= rar.weight ? ' is-on' : '') }))
    }
    mount(this._pageL, [
      h('div', { className: 'pix qf-ip-pg-kicker' },
        'BARGAIN ' + (ROMAN[idx + 1] || (idx + 1)) + ' OF ' + this._offers.length),
      h('div', { className: 'qf-ip-summon', dataset: { rarity: rarKey } }, [
        h('div', { className: 'qf-ip-summon-aura' }),
        svgWrap,
        h('div', { className: 'qf-ip-summon-glyph' },
          pact?.symbol || RARITY_GLYPH[rarKey] || '❖'),
      ]),
      h('div', { className: 'qf-ip-summon-info' }, [
        h('div', { className: 'pix qf-ip-summon-name' },
          String(pact?.name || pact?.id || '?').toUpperCase()),
        h('div', { className: 'qf-ip-summon-tier' }, pips),
        h('div', { className: 'pix qf-ip-summon-stamp' }, '· ' + rar.stamp + ' ·'),
      ]),
    ])

    this._signInk  = h('div', { className: 'qf-ip-sign-ink' })
    this._sealSlot = h('div', { className: 'qf-ip-seal-slot' })
    const signBtn  = h('button', {
      className: 'btn qf-ip-sign-btn',
      on: { click: () => this._confirm() },
    }, [
      h('span', { className: 'pix qf-ip-sign-btn-label' }, 'SIGN IN BLOOD'),
    ])
    this._signBtn = signBtn

    this._pageR.classList.remove('is-signed')
    mount(this._pageR, [
      this._sealSlot,
      h('div', { className: 'qf-ip-pact qf-ip-pact-deal' }, [
        h('div', { className: 'qf-ip-pact-head' }, [
          h('span', { className: 'qf-ip-pact-glyph' }, '☽'),
          h('span', { className: 'pix qf-ip-pact-word' }, 'The Deal'),
        ]),
        h('div', { className: 'pix qf-ip-pact-body' },
          this._colorize(pact?.description || '—')),
      ]),
      h('div', { className: 'qf-ip-pact qf-ip-pact-price' }, [
        h('div', { className: 'qf-ip-pact-head' }, [
          h('span', { className: 'qf-ip-pact-glyph' }, '☠'),
          h('span', { className: 'pix qf-ip-pact-word' }, 'The Price'),
        ]),
        h('div', { className: 'pix qf-ip-pact-body' },
          this._colorize(pact?.tradeoffDescription || '—')),
      ]),
      h('div', { className: 'qf-ip-sign' }, [
        h('div', { className: 'pix qf-ip-sign-label' }, 'BOUND IN BLOOD'),
        h('div', { className: 'qf-ip-sign-line' }, [
          this._signInk,
          h('div', { className: 'qf-ip-sign-x' }, '✕'),
        ]),
      ]),
      signBtn,
    ])
  }

  _colorize(text) {
    if (!text) return ''
    const re = /(\d+%|\d+g|\b\d+\b|adventurers?|minions?|twins?|boss|HP|dies?|escapes?|escaped|toll|ransom|dawn|night|gold)/gi
    return String(text).split(re).map(part => {
      if (!part) return null
      if (/^\d+%$|^\d+g$|^\d+$/.test(part)) return h('span', { className: 'qf-ip-kw-num' }, part)
      if (/^adventurers?$/i.test(part))     return h('span', { className: 'qf-ip-kw-adv' }, part)
      if (/^minions?$/i.test(part))         return h('span', { className: 'qf-ip-kw-min' }, part)
      if (/^twins?$|^dies?$|^boss$/i.test(part)) return h('span', { className: 'qf-ip-kw-boss' }, part)
      if (/^HP$/.test(part))                return h('span', { className: 'qf-ip-kw-hp' }, part)
      if (/^escapes?$|^escaped$|^toll$|^ransom$|^gold$/i.test(part))
        return h('span', { className: 'qf-ip-kw-gold' }, part)
      if (/^dawn$|^night$/i.test(part))     return h('span', { className: 'qf-ip-kw-time' }, part)
      return part
    })
  }

  // ── Bookmarks ───────────────────────────────────────────────────────────

  _renderBookmarks() {
    const stones = this._offers.map((pact, i) => {
      const rar = this._rar(i)
      return h('div', {
        className: 'qf-ip-rune',
        dataset: { active: i === this._pageIdx ? 'true' : 'false' },
        style: {
          '--c1': rar.c1, '--c2': rar.c2, '--c3': rar.c3, '--glow': rar.glow,
          animationDelay: `${i * 110}ms`,
        },
        on: { click: () => this._goToPact(i) },
      }, [
        h('div', { className: 'pix qf-ip-rune-glyph' },
          pact?.symbol || RARITY_GLYPH[this._rarKey(i)] || '❖'),
      ])
    })
    mount(this._bookmarks, stones)
  }

  _updateBookmarks() {
    [...this._bookmarks.children].forEach((tab, i) => {
      tab.dataset.active = i === this._pageIdx ? 'true' : 'false'
    })
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  _goToPact(idx) {
    if (this._busy || this._signing || idx === this._pageIdx) return
    if (idx < 0 || idx >= this._offers.length) return
    this._busy = true
    const forward = idx > this._pageIdx
    this._showPages(false)
    this._sfx('sfx-book-open', 0.5)

    this._playSheet({
      layer: forward ? this._layerTurnF : this._layerTurnB,
      cols: 4, rows: 4, from: 0, to: TURN_LAST, fps: 30,
      onDone: () => {
        this._setLayerFrame(this._layerOpen, OPEN_TO, 4, 3)
        this._showLayer(this._layerOpen)
        this._showPages(true)
        this._busy = false
      },
    })
    this._after(240, () => {
      this._pageIdx = idx
      this._renderPage(idx)
      this._updateBookmarks()
      this._brokerSay(this._viewLine(idx), VIEW_EXPR[this._rarKey(idx)] || 'mischievous')
    })
  }

  // ── Reroll ──────────────────────────────────────────────────────────────

  _reroll() {
    if (this._busy || this._signing || this._rerollUsed) return
    this._rerollUsed = true
    this._busy = true
    this._rerollBtn.disabled = true
    this._rerollBtn.textContent = '— TERMS ARE FINAL —'
    this._brokerSay(pick(LINES.reroll), 'eye-roll')
    this._sfx('sfx-book-open', 0.6)
    this._showPages(false)

    this._playSheet({
      layer: this._layerTurnF, cols: 4, rows: 4, from: 0, to: TURN_LAST, fps: 48,
      onDone: () => this._playSheet({
        layer: this._layerTurnF, cols: 4, rows: 4, from: 0, to: TURN_LAST, fps: 48,
        onDone: () => {
          this._offers  = this._fetchOffers()
          this._pageIdx = 0
          const hasLeg = this._offers.some(o => (o?.rarity ?? '') === 'legendary')
          this._el.dataset.legendary = hasLeg ? 'true' : 'false'
          this._setLayerFrame(this._layerOpen, OPEN_TO, 4, 3)
          this._showLayer(this._layerOpen)
          this._renderBookmarks()
          this._renderPage(0)
          this._showPages(true)
          this._busy = false
        },
      }),
    })
  }

  // ── Seal the pact ───────────────────────────────────────────────────────

  _confirm() {
    if (this._busy || this._signing) return
    const pact = this._offers[this._pageIdx]
    if (!pact) return
    this._signing = true
    this._busy = true

    const sys = window.__game?.scene?.getScene?.('Game')?.dungeonMechanicSystem
    try { sys?.activate?.(pact.id) }
    catch (err) { console.warn('[PactPicker] activate failed:', err?.message) }

    const rar  = this._rar(this._pageIdx)
    const tier = rar.weight <= 1 ? 'low' : rar.weight === 2 ? 'mid' : 'high'
    if (this._signBtn) { this._signBtn.disabled = true; this._signBtn.classList.add('is-spent') }

    // Beat 1 — blood signature scrawls across the line.
    this._after(150, () => {
      this._pageR.classList.add('is-signed')
      this._signInk.innerHTML =
        '<svg class="qf-ip-sig-svg" viewBox="0 0 268 70" preserveAspectRatio="xMidYMid meet">' +
        `<path pathLength="1" d="${SIGNATURE_PATH}" /></svg>`
      this._sfx('sfx-btn-hover', 0.4)
    })

    // Beat 2 — the rarity sigil is SEARED into the page as an infernal
    // brand: a white-hot flash, scattering embers and rising smoke, then
    // the sigil cools to a charred mark with a faint pulsing ember glow.
    this._after(640, () => {
      this._sealSlot.appendChild(h('div', { className: 'qf-ip-brand' }, [
        h('div', { className: 'qf-ip-brand-scorch' }),
        h('div', { className: 'qf-ip-brand-ember' }),
        h('div', { className: 'qf-ip-brand-flash' }),
        h('div', { className: 'qf-ip-brand-glyph' },
          pact.symbol || RARITY_GLYPH[this._rarKey(this._pageIdx)] || '❖'),
        h('div', { className: 'qf-ip-brand-smoke qf-ip-brand-smoke-1' }),
        h('div', { className: 'qf-ip-brand-smoke qf-ip-brand-smoke-2' }),
      ]))
      this._emitEmbers()
      this._stageEl?.classList.add('is-shaking')
      this._after(420, () => this._stageEl?.classList.remove('is-shaking'))
      this._flash(rar)
      this._sfx('sfx-boss-attack', 0.55)
      this._sfx(pick(['sfx-build-1', 'sfx-build-2', 'sfx-build-3']), 0.8)
      this._brokerSay(pick(LINES.seal[tier]), 'excited')
      this._emitEssence(rar)
    })

    // Beat 3 — the tome snaps fully shut over the sealed page; the broker
    // dissipates back into smoke. Held off until the brand has cooled to
    // a charred mark on screen. Resolution waits for the close to FINISH
    // (its onDone) so the animation always completes on screen.
    this._after(2300, () => {
      this._showPages(false)
      this._sfx('sfx-book-open', 0.5)
      this._playSheet({
        layer: this._layerClose, cols: 4, rows: 3,
        from: CLOSE_FROM, to: CLOSE_TO, fps: 22,
        onDone: () => {
          this._setLayerFrame(this._layerClose, CLOSE_TO, 4, 3)
          this._after(440, () => this._finishSeal(pact))   // hold the shut book
        },
      })
    })
    // Fallback — guarantees the day→night handoff resolves even if the
    // close animation is starved (e.g. a backgrounded tab).
    this._after(4400, () => this._finishSeal(pact))
  }

  // Emit the seal events and tear down — once, whichever path reaches it.
  _finishSeal(pact) {
    if (this._sealResolved) return
    this._sealResolved = true
    EventBus.emit('PACT_SEALED', {
      mechanicId: pact.id,
      rarity:     pact.rarity ?? 'common',
    })
    EventBus.emit('DARK_PACT_SEALED', { mechanicId: pact.id })
    this._teardown()
  }

  _flash(rar) {
    if (!this._flashEl) return
    const w = rar.weight
    this._flashEl.style.background = rar.c1
    try {
      this._flashEl.animate([
        { opacity: 0 },
        { opacity: 0.22 + w * 0.13, offset: 0.2 },
        { opacity: 0 },
      ], { duration: 360 + w * 130, easing: 'ease-out' })
    } catch {}
  }

  // The pact's essence bursts from the tome on seal — a radial spray of
  // rarity-coloured sparks that scatter outward from the book and fade
  // in place. (Never streams anywhere — no flying off to a corner.)
  _emitEssence(rar) {
    const stage = document.getElementById('hud-stage')
    if (!stage || !this._bookEl) return
    const stageRect = stage.getBoundingClientRect()
    const sf        = stageRect.width / 1920 || 1
    const r         = this._bookEl.getBoundingClientRect()
    const srcX = (r.left - stageRect.left) / sf + (r.width  / sf) / 2
    const srcY = (r.top  - stageRect.top)  / sf + (r.height / sf) / 2

    const count = 18 + rar.weight * 6
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div')
      dot.className = 'qf-pp-fx-spark'
      dot.style.left = `${srcX}px`
      dot.style.top  = `${srcY}px`
      dot.style.background = rar.c1
      dot.style.boxShadow  = `0 0 8px ${rar.c1}, 0 0 14px ${rar.glow}`
      stage.appendChild(dot)
      const ang     = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5
      const dist    = 80 + Math.random() * 130
      const burstX  = srcX + Math.cos(ang) * dist
      const burstY  = srcY + Math.sin(ang) * dist
      const stagger = i * 16
      const total   = 880
      try {
        dot.animate([
          { transform: 'translate(-50%,-50%) scale(0.5)',  opacity: 0, left: `${srcX}px`,   top: `${srcY}px` },
          { transform: 'translate(-50%,-50%) scale(1.45)', opacity: 1, left: `${burstX}px`, top: `${burstY}px`, offset: 0.36 },
          { transform: 'translate(-50%,-50%) scale(0.25)', opacity: 0,
            left: `${burstX + Math.cos(ang) * 34}px`, top: `${burstY + Math.sin(ang) * 34 - 22}px` },
        ], { duration: total, delay: stagger, easing: 'cubic-bezier(0.22,0.8,0.32,1)', fill: 'forwards' })
      } catch {}
      setTimeout(() => dot.remove(), total + stagger + 60)
    }
  }

  // Scatter glowing embers up and outward from the freshly-seared brand.
  _emitEmbers() {
    const stage = document.getElementById('hud-stage')
    const brand = this._sealSlot?.querySelector('.qf-ip-brand')
    if (!stage || !brand) return
    const stageRect = stage.getBoundingClientRect()
    const sf = stageRect.width / 1920 || 1
    const r  = brand.getBoundingClientRect()
    const cx = (r.left - stageRect.left) / sf + (r.width  / sf) / 2
    const cy = (r.top  - stageRect.top)  / sf + (r.height / sf) / 2
    for (let i = 0; i < 20; i++) {
      const e  = document.createElement('div')
      e.className = 'qf-ip-ember'
      const sz = 3 + Math.random() * 4
      e.style.width = e.style.height = `${sz}px`
      e.style.left  = `${cx}px`
      e.style.top   = `${cy}px`
      stage.appendChild(e)
      const ang   = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3
      const dist  = 46 + Math.random() * 104
      const ex    = cx + Math.cos(ang) * dist
      const ey    = cy + Math.sin(ang) * dist - Math.random() * 26
      const dur   = 700 + Math.random() * 640
      const delay = i * 11
      try {
        e.animate([
          { left: `${cx}px`, top: `${cy}px`, opacity: 1, transform: 'translate(-50%,-50%) scale(1)' },
          { opacity: 1, offset: 0.22 },
          { left: `${ex}px`, top: `${ey}px`, opacity: 0, transform: 'translate(-50%,-50%) scale(0.2)' },
        ], { duration: dur, delay, easing: 'cubic-bezier(0.15,0.6,0.3,1)', fill: 'forwards' })
      } catch {}
      setTimeout(() => e.remove(), dur + delay + 80)
    }
  }

  // ── Broker ──────────────────────────────────────────────────────────────

  // Route a broker line to Lilith's companion bubble — NpcDirector picks
  // up NPC_BROKER_SAY and shows it while she is docked beside the
  // Grimoire. Re-arms the idle-chatter clock so fresh chatter never
  // crowds a reaction.
  _brokerSay(text, expr = 'mischievous') {
    const line = String(text == null ? '' : text)
    if (line) EventBus.emit('NPC_BROKER_SAY', { text: line, expr })
    this._scheduleChatter()
  }

  // A remark for the pact just turned to — half the time a tag-specific
  // jab, otherwise a rarity line.
  _viewLine(idx) {
    const tags = this._offers[idx]?.tags || []
    const tagged = tags.find(t => LINES.tag[t])
    if (tagged && Math.random() < 0.5) return pick(LINES.tag[tagged])
    return pick(LINES.view[this._rarKey(idx)] || LINES.view.common)
  }

  // Periodic idle chatter while the player browses. Re-armed by every
  // line; skips (and retries) while the book is mid-animation or sealing.
  _scheduleChatter() {
    if (this._chatterTimer) clearTimeout(this._chatterTimer)
    this._chatterTimer = setTimeout(() => {
      this._chatterTimer = 0
      if (!this._el) return
      if (this._busy || this._signing) { this._scheduleChatter(); return }
      this._brokerSay(pick(LINES.idle))
    }, 13000 + Math.random() * 8000)
  }

  // ── Ash particles ───────────────────────────────────────────────────────

  _startAsh() {
    this._ashTimer = setInterval(() => {
      if (!this._ashEl) return
      const mote = document.createElement('div')
      mote.className = 'qf-ip-mote'
      const x  = Math.random() * 1920
      const sz = 2 + ((Math.random() * 3) | 0)
      mote.style.left   = `${x}px`
      mote.style.width  = `${sz}px`
      mote.style.height = `${sz}px`
      mote.style.background = Math.random() < 0.4 ? '#ff9a4a' : '#6a5a52'
      this._ashEl.appendChild(mote)
      const life = 5200 + Math.random() * 3600
      try {
        mote.animate([
          { transform: 'translate(0,0)', opacity: 0 },
          { opacity: 0.8, offset: 0.15 },
          { opacity: 0.7, offset: 0.7 },
          { transform: `translate(${(Math.random() - 0.5) * 220}px, -${720 + Math.random() * 300}px)`, opacity: 0 },
        ], { duration: life, easing: 'ease-out', fill: 'forwards' })
      } catch {}
      setTimeout(() => mote.remove(), life + 60)
    }, 300)
  }

  // ── SFX ─────────────────────────────────────────────────────────────────

  _sfx(key, volume = 0.5) {
    try {
      const snd = window.__game?.scene?.getScene?.('Game')?.sound
      if (snd && window.__game?.cache?.audio?.exists?.(key)) snd.play(key, { volume })
    } catch {}
  }
}
