// sprites.js — vanilla port of the design's sprites.jsx.
//
// CSS pixel-art "sprite placeholders" rendered as positioned divs in a
// 16×16 grid (creatures) or a 14×14 grid (room icons). The design uses
// these as recognizable pixel-block creatures without external assets.
//
// Public API:
//   pixelSprite(kind, size, opts?)  → HTMLDivElement
//   roomIcon(kind, size)            → HTMLDivElement
//   spriteHasKind(kind)             → boolean (creature kinds)
//   roomIconHasKind(kind)           → boolean (room-icon kinds)
//
// Sizes are flexible — div is `size × size` with each ASCII cell
// rendering as a `(size/16)` px block (rounded to fractional pixels for
// smooth scaling). image-rendering: pixelated is forced.

import { h } from './dom.js'

// Creature palettes. Each kind has a 5-color set: a (lightest), b, c, d
// (darkest), and eye (accent).
const PALETTES = {
  gnoll:    { a: '#e8dcc8', b: '#a8826a', c: '#5a3a2a', d: '#2a1812', eye: '#ff4458' },
  hyena:    { a: '#d8a878', b: '#8a6242', c: '#4a3018', d: '#1a1008', eye: '#48ff64' },
  knight:   { a: '#c8d4e0', b: '#7088a0', c: '#3a4858', d: '#16202a', eye: '#ffd860' },
  monk:     { a: '#e8d4a8', b: '#a88858', c: '#5a3818', d: '#2a1a08', eye: '#ffffff' },
  cleric:   { a: '#f0e8c8', b: '#c8a070', c: '#7a5030', d: '#2a1c10', eye: '#5cc8d8' },
  imp:      { a: '#c83a3a', b: '#7a1a20', c: '#3a0a10', d: '#1a0408', eye: '#ffcc40' },
  lich:     { a: '#d8c8a8', b: '#7a6850', c: '#3a2818', d: '#1a1008', eye: '#48ff90' },
  slime:    { a: '#80c850', b: '#508028', c: '#284a10', d: '#10200a', eye: '#ffffff' },
  spore:    { a: '#e8a8c8', b: '#a85878', c: '#5a2840', d: '#2a1018', eye: '#ffffff' },
  bone:     { a: '#e8e0d0', b: '#a89880', c: '#5a4838', d: '#2a2018', eye: '#ff4458' },
}

const GRIDS = {
  gnoll: [
    '................', '.....aa.aa......', '....abaabaa.....', '....abbbbba.....',
    '....beeebbe.....', '....bbccbbb.....', '...bbbaabbbb....', '..bb.bbbb.bb....',
    '..b..baab..b....', '....bbccbb......', '....cc..cc......', '....dd..dd......',
    '................', '................', '................', '................',
  ],
  hyena: [
    '................', '...aa......aa...', '..aabaaaaabbaa..', '..abebbbbeba....',
    '..abbccccbba....', '...abbaabbba....', '...abbbbbba.....', '..aabbbbbbaa....',
    '..b.bb..bb.b....', '....cc..cc......', '....cc..cc......', '................',
    '................', '................', '................', '................',
  ],
  knight: [
    '................', '.....cccc.......', '....cbbbbc......', '....beebbe......',
    '....baaabb......', '...cbbbbbbc.....', '..c.bbbbbb.c....', '..c.cbbbbc.c....',
    '....cbbbbc......', '....c.bb.c......', '....c.bb.c......', '....cc..cc......',
    '...ccc..ccc.....', '................', '................', '................',
  ],
  monk: [
    '................', '.....cccc.......', '....cbbbbc......', '....beeebe......',
    '....bbbbbb......', '...cccbbccc.....', '..ccbbbbbbcc....', '..c.bbbbbb.c....',
    '....bbbbbb......', '....bb..bb......', '....bb..bb......', '....cc..cc......',
    '...ccc..ccc.....', '................', '................', '................',
  ],
  cleric: [
    '................', '......cc........', '.....cbbc.......', '....cbeebe......',
    '....cbbbbc......', '...cccccccc.....', '..cabbbbbbac....', '..cabb..bbac....',
    '...abbaabb......', '....bb..bb......', '....bb..bb......', '....cc..cc......',
    '...ccc..ccc.....', '................', '................', '................',
  ],
  imp: [
    '...c..........c.', '...cc........cc.', '....cc......cc..', '....abccccccba..',
    '....aebccccbea..', '....abbccccbba..', '....abbbccbbba..', '...aabbbbbbbaa..',
    '..aa.bbbbbb.aa..', '.....bb..bb.....', '.....cc..cc.....', '.....cc..cc.....',
    '....ccc..ccc....', '................', '................', '................',
  ],
  lich: [
    '................', '.....cccc.......', '....cabbac......', '....abeeba......',
    '....abccba......', '...cabbbbac.....', '..ccabbbbacc....', '..c.abbbba.c....',
    '.....abba.......', '....c....c......', '....cc..cc......', '....cc..cc......',
    '...ccc..ccc.....', '................', '................', '................',
  ],
  slime: [
    '................', '................', '................', '.....aaaa.......',
    '....aabbaaa.....', '...aabbbbbba....', '..aabbeeeebba...', '..abbbbccbbba...',
    '..abbbbbbbba....', '..aabbbbbbaa....', '...ccaabbcc.....', '....cccccc......',
    '................', '................', '................', '................',
  ],
  spore: [
    '................', '....aaaaaa......', '...aabbbbaa.....', '..aabbbbbbaa....',
    '..abbbccbbba....', '..abbbccbbba....', '...aabbbbaa.....', '....cccccc......',
    '....c.bb.c......', '....bb..bb......', '...bbb..bbb.....', '................',
    '................', '................', '................', '................',
  ],
  bone: [
    '................', '.....aaaa.......', '....aaeeae......', '....aaccaa......',
    '....abccba......', '....aabbaa......', '...aabbbbaa.....', '..aa.aaaa.aa....',
    '..a..a..a..a....', '....aa..aa......', '....aa..aa......', '....cc..cc......',
    '...ccc..ccc.....', '................', '................', '................',
  ],
}

// Room icons — 14×14 glyphs with a fixed palette.
const ROOM_PAL = {
  a: '#e8dcc8', b: '#a8826a', c: '#5a3a2a', d: '#3a2818',
  e: '#c8334a', f: '#1a0a0a', g: '#d4a648',
}

const ROOM_ICONS = {
  entry:    ['..............','.cccccccccccc.','.cbbbbbbbbbbc.','.cb........bc.','.cb..gggg..bc.','.cb..gffg..bc.','.cb..gffg..bc.','.cb..gggg..bc.','.cb........bc.','.cb..b..b..bc.','.cb..b..b..bc.','.cb..b..b..bc.','.cccccccccccc.','..............'],
  corridor: ['..............','.cccccccccccc.','.cbbbbbbbbbbc.','.cb........bc.','.cb.aaaaaa.bc.','.cb........bc.','.cb.aaaaaa.bc.','.cb........bc.','.cb.aaaaaa.bc.','.cb........bc.','.cb.aaaaaa.bc.','.cb........bc.','.cccccccccccc.','..............'],
  barracks: ['..............','.cccccccccccc.','.cbbbbbbbbbbc.','.cb.dd.dd..bc.','.cb.dd.dd..bc.','.cb........bc.','.cb.dd.dd..bc.','.cb.dd.dd..bc.','.cb........bc.','.cb.dd.dd..bc.','.cb.dd.dd..bc.','.cb........bc.','.cccccccccccc.','..............'],
  guard:    ['..............','.cccccccccccc.','.cbbbbbbbbbbc.','.cb..eeee..bc.','.cb.eaaaae.bc.','.cb.eaffae.bc.','.cb.eaffae.bc.','.cb.eaaaae.bc.','.cb..eeee..bc.','.cb..e..e..bc.','.cb..e..e..bc.','.cb..b..b..bc.','.cccccccccccc.','..............'],
  crypt:    ['..............','.cccccccccccc.','.cbbbbbbbbbbc.','.cb..gggg..bc.','.cb..gggg..bc.','.cb.gggggg.bc.','.cb.gggggg.bc.','.cb.g.gg.g.bc.','.cb.g.gg.g.bc.','.cb........bc.','.cb..g..g..bc.','.cb..g..g..bc.','.cccccccccccc.','..............'],
  library:  ['..............','.cccccccccccc.','.cbbbbbbbbbbc.','.cb..a.b...bc.','.cb..a.b...bc.','.cb..a.b...bc.','.cb..a.b...bc.','.cb..a.b...bc.','.cb........bc.','.cb.b.a.b..bc.','.cb.b.a.b..bc.','.cb.b.a.b..bc.','.cccccccccccc.','..............'],
  trap:     ['..............','..............','..c........c..','..cc......cc..','..ccc....ccc..','..eccc..ccce..','..eeccccccee..','...eeccccee...','...eeccccee...','..eeccccccee..','..eccc..ccce..','..ccc....ccc..','..cc......cc..','..c........c.'],
  item:     ['..............','.....aa.......','....agga......','...aggcga.....','..aggcccga....','.aggccccga....','.bbbbbbbb.....','.bbbbbbbb.....','.bbbbbbbb.....','.bbb..bbb.....','..............','..............','..............','..............'],
}

// Some commonly-seen archetype-family aliases — the game's minion IDs
// often have a trailing digit (orc1, slime2, etc); the sprite catalog
// keys off the bare family name. Add aliases as we find them.
const ALIASES = {
  orc:        'gnoll',     // close-enough, until orc grid exists
  goblin:     'hyena',     // visual stand-in
  beholder:   'imp',       // visual stand-in
  vampire:    'bone',
  vampire_minion: 'bone',
  zombie:     'bone',
  skeleton:   'bone',
  ghost:      'bone',
  rat:        'hyena',
  plant:      'spore',
  mushroom:   'spore',
  ent:        'spore',
  myconid:    'spore',
  golem:      'imp',
  elder_slime:'slime',
  lizardman:  'gnoll',
  demon:      'imp',
  wraith:     'bone',
  succubus:   'imp',
  mimic:      'bone',
}

export function spriteHasKind(kind) {
  return !!(GRIDS[kind] || GRIDS[ALIASES[kind]])
}

export function roomIconHasKind(kind) {
  return !!ROOM_ICONS[kind]
}

// Resolve a minion definitionId to a sprite-kind: strip trailing digits
// and look up in PALETTES, then ALIASES, then fall back to 'gnoll'.
export function spriteKindForDefId(defId) {
  if (!defId) return 'gnoll'
  const family = String(defId).replace(/[0-9]+$/, '')
  if (GRIDS[family]) return family
  if (ALIASES[family]) return ALIASES[family]
  return 'gnoll'
}

export function pixelSprite(kind = 'gnoll', size = 48, opts = {}) {
  const resolved = GRIDS[kind] ? kind : (ALIASES[kind] || 'gnoll')
  const grid = GRIDS[resolved]
  const pal  = PALETTES[resolved]
  const px   = size / 16
  const cells = []
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const ch = grid[y][x]
      if (ch === '.') continue
      const color = ch === 'e' ? pal.eye : pal[ch]
      if (!color) continue
      cells.push(h('div', {
        style: {
          position: 'absolute',
          left:  `${x * px}px`,
          top:   `${y * px}px`,
          // +0.5px overscan keeps edges flush at non-integer scales.
          width:  `${px + 0.5}px`,
          height: `${px + 0.5}px`,
          background: color,
        },
      }))
    }
  }
  return h('div', {
    className: 'qf-pixsprite',
    style: {
      width:  `${size}px`,
      height: `${size}px`,
      position: 'relative',
      imageRendering: 'pixelated',
      filter: opts.glow ? `drop-shadow(0 0 6px ${pal.eye})` : 'none',
      ...opts.style,
    },
  }, cells)
}

export function roomIcon(kind = 'entry', size = 56) {
  const grid = ROOM_ICONS[kind] || ROOM_ICONS.entry
  const px = size / 14
  const cells = []
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 14; x++) {
      const ch = grid[y][x]
      if (ch === '.') continue
      const color = ROOM_PAL[ch] || '#fff'
      cells.push(h('div', {
        style: {
          position: 'absolute',
          left:  `${x * px}px`,
          top:   `${y * px}px`,
          width:  `${px + 0.5}px`,
          height: `${px + 0.5}px`,
          background: color,
        },
      }))
    }
  }
  return h('div', {
    className: 'qf-roomicon',
    style: {
      width:  `${size}px`,
      height: `${size}px`,
      position: 'relative',
      imageRendering: 'pixelated',
    },
  }, cells)
}
