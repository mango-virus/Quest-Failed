// Shared pact card chrome — used by DarkPactPopup (the choose-one menu)
// and PactDetailPopup (the read-only review opened from Boss Overview).
// Owning these constants and the renderer in one place guarantees the
// detail view looks identical to the menu card.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel } from '../UIKit.js'

export const RARITIES = {
  common:    { color: CRYPT.inkDim,    label: 'COMMON',    hex: 0x8a8678, weight: 0 },
  uncommon:  { color: CRYPT.greenCss,  label: 'UNCOMMON',  hex: 0x6fa84a, weight: 1 },
  rare:      { color: CRYPT.goldCss,   label: 'RARE',      hex: 0xe8c34a, weight: 2 },
  epic:      { color: '#c47cf2',       label: 'EPIC',      hex: 0xc47cf2, weight: 3 },
  legendary: { color: CRYPT.accent2Css,label: 'LEGENDARY', hex: 0xff5566, weight: 4 },
  // Damned — solid black tier (devil's-bargain curses). Blood-tinted edge
  // so the near-black card still reads; weight 4 → gets the epic+ glow.
  damned:    { color: '#d4555f',       label: 'DAMNED',    hex: 0x6e2630, weight: 4 },
}

// Per-pact flavor lines. One per mechanic in dungeonMechanics.json so no
// two cards share the same italic quote. Mix of funny / serious / evil.
// Falls back to DEFAULT_FLAVOR only for new mechanics not yet listed.
export const PACT_FLAVOR = {
  // Economy / tax
  taxation_of_souls:       'every threshold demands its tithe',
  gold_rush:               'death gilds the dungeon floor',
  tower_tax:               'the high ground costs the most',
  tax_the_living:          'breath is a billable service',
  ransom_note:             'pay the dungeon, or pay the dungeon',
  pyramid_scheme:          'the bottom always falls out',
  gilded_demise:           'they die rich, you stay richer',
  blood_money:             'every coin is washed in something',
  famine_decree:           'an empty belly is a loud one',

  // Minions — survival, growth, sacrifice
  bloodbound:              'the blood remembers what the body forgets',
  undying_horde:           'death was always the lesser punishment',
  pack_synergy:            'they fight as one, they die as one',
  kennel_discipline:       'better dogs, shorter leash',
  ironhide_rite:           'flesh remembers the forge',
  frenzy_pact:             'pain is just a faster heartbeat',
  last_stand_doctrine:     'the last to fall hits the hardest',
  vampires_toll:           'every kill is a fresh communion',
  avengers_rite:           'one falls, three rise',
  final_breath:            'their last word becomes your first weapon',
  drill_sergeant:          'the loudest voice wins the fastest legs',
  endless_garrison:        'death is a uniform you get to take off',
  the_cull:                'mercy is a load-bearing weakness',
  soul_tether:             'a leash you can never see — only feel',

  // Adventurer manipulation
  crusaders_curse:         'their faith was always the weak point',
  mage_hunt:               'spells are just stories until they bleed',
  glory_hounds:            'the bravest are the easiest to bait',
  sworn_rivals:            'their hatred outlives their loyalty',
  schism:                  'a house divided pays the same rent',
  inquisitors_mark:        'wear my mark or wear nothing at all',
  doomsday_clock:          'tick. tock. one of them is a verb.',
  the_long_game:           'patience is just hunger you can name',

  // Information / knowledge
  false_maps:              'the map was always lying to them',
  whispered_lies:          'truth, but only the version that hurts',
  open_book:               'know thy enemy — and be known',
  whisperers_tongue:       'every kind word costs them a step',
  great_erasure:           'the names of the dead are unspoken',

  // Summons / reinforcements
  summon_adds_i:           'reinforcements never knock',
  summon_adds_ii:          'the dungeon breeds in the dark',
  summon_adds_iii:         'you have always been outnumbered — surprise',

  // Traps & rooms
  sealed_paths:            'one less door, one more decision',
  hasty_architect:         'measure twice, never measure',
  trap_masons_touch:       "a good trap doesn't need a name",
  trapsmiths_guild:        'wholesale cruelty, retail satisfaction',
  forbidden_workshop:      'the schematics were never meant to be drawn',
  architects_vision:       'every wall remembers who built it',
  cursed_soil:             'the floor is hungry today',
  sundered_floor:          'gravity has opinions',

  // Boss abilities
  tyrants_gaze:            'they bow before they understand why',
  hellfire_breath:         'fire forgives, ash does not',
  lightning_strike:        'no second to spare, no second chance',
  shockwave_slam:          'the floor is also a weapon',
  dark_vortex:             'gravity, but personal',
  soul_drain:              'every breath of theirs is one of yours',
  doppelgangers:           "who's the real one? — does it matter?",
  petrifying_stare:        'eyes do most of the killing',

  // Pact-of-the-X archetypes
  pact_of_the_mirror:      'a mirror keeps every secret it shows',
  pact_of_the_cartographer:'know every door before you choose one',
  pact_of_the_jester:      'comedy is just tragedy with timing',
  pact_of_the_whisperer:   'whispers travel further than shouts',
  pact_of_the_brand:       'wear the brand or wear the wound',
  pact_of_the_reaper:      'the harvest is patient, but never late',
  pact_of_the_marionette:  "you don't notice the strings until they pull",

  // Damned (solid-black) pacts — devil's bargains: a sliver of bribe, a
  // lifetime of curse.
  the_leech:               'it drinks slowly. it never stops drinking.',
  pact_of_the_last_heart:  'one heartbeat left to spend — spend it well',
}
export const DEFAULT_FLAVOR = 'they will not remember signing this'

// Tag → sigil shape. Picks the first tag in def.tags that has a mapping;
// falls back to 'horns'. Drawn by drawSigil — no sprite assets required.
export const SIGIL_FOR_TAG = {
  gold: 'coin', economy: 'coin', bounty: 'coin',
  minion: 'skull', summon: 'skull', undead: 'skull', evolution: 'skull',
  damage: 'blade', attack: 'blade', burst: 'blade',
  adventurer: 'arrow', anti_class: 'arrow',
  trap: 'spike', defense: 'shield',
  boss: 'crown', possession: 'crown',
  speed: 'chevron',
  control: 'eye', knowledge: 'eye', intel: 'eye',
  vfx: 'spark', curse: 'spark',
  attrition: 'hourglass', permanent: 'hourglass', scaling: 'hourglass',
  slot: 'box',
}

// Draw one of a small set of pixel-art sigils centred at (cx,cy). The
// graphics object's coords are local to the parent container (or scene).
// Each shape is intentionally simple — they read as iconography at 32px
// and scale up cleanly to the 60px sigil box.
export function drawSigil(g, cx, cy, s, kind, color) {
  g.fillStyle(color, 1)
  g.lineStyle(2, color, 1)
  switch (kind) {
    case 'coin':
      g.strokeCircle(cx, cy, s)
      g.fillCircle(cx, cy, s - 5)
      g.lineStyle(2, 0x000000, 1)
      g.beginPath(); g.moveTo(cx, cy - s + 4); g.lineTo(cx, cy + s - 4); g.strokePath()
      break
    case 'skull':
      g.fillRoundedRect(cx - s, cy - s + 2, s * 2, s * 1.6, 4)
      g.fillRect(cx - s + 4, cy + s - 6, s * 2 - 8, 4)
      g.fillStyle(0x000000, 1)
      g.fillRect(cx - s + 5, cy - 2, 5, 6)
      g.fillRect(cx + s - 10, cy - 2, 5, 6)
      g.fillRect(cx - 2, cy + s - 10, 4, 5)
      g.fillStyle(color, 1)
      break
    case 'blade':
      g.lineStyle(3, color, 1)
      g.beginPath(); g.moveTo(cx - s, cy + s); g.lineTo(cx + s, cy - s); g.strokePath()
      g.beginPath(); g.moveTo(cx + s, cy + s); g.lineTo(cx - s, cy - s); g.strokePath()
      break
    case 'arrow':
      g.beginPath()
      g.moveTo(cx, cy - s)
      g.lineTo(cx + s, cy + s - 2)
      g.lineTo(cx, cy + s / 3)
      g.lineTo(cx - s, cy + s - 2)
      g.closePath(); g.fillPath()
      break
    case 'spike':
      g.beginPath()
      g.moveTo(cx, cy - s)
      g.lineTo(cx + s, cy + s)
      g.lineTo(cx - s, cy + s)
      g.closePath(); g.fillPath()
      break
    case 'shield':
      g.beginPath()
      g.moveTo(cx - s, cy - s)
      g.lineTo(cx + s, cy - s)
      g.lineTo(cx + s, cy)
      g.lineTo(cx, cy + s)
      g.lineTo(cx - s, cy)
      g.closePath(); g.fillPath()
      break
    case 'crown':
      g.fillRect(cx - s, cy + s / 2, s * 2, s - 2)
      g.fillTriangle(cx - s,     cy + s/2, cx - s/2, cy - s/2, cx,         cy + s/2)
      g.fillTriangle(cx - s/2,   cy + s/2, cx,        cy - s,   cx + s/2,   cy + s/2)
      g.fillTriangle(cx,         cy + s/2, cx + s/2,  cy - s/2, cx + s,     cy + s/2)
      break
    case 'chevron':
      g.lineStyle(3, color, 1)
      g.beginPath(); g.moveTo(cx - s, cy + s/2); g.lineTo(cx, cy - s/2); g.lineTo(cx + s, cy + s/2); g.strokePath()
      g.beginPath(); g.moveTo(cx - s, cy + s);   g.lineTo(cx, cy);       g.lineTo(cx + s, cy + s);   g.strokePath()
      break
    case 'eye':
      g.lineStyle(2, color, 1)
      g.strokeEllipse(cx, cy, s * 1.9, s)
      g.fillCircle(cx, cy, s / 2)
      break
    case 'spark':
      g.lineStyle(2, color, 1)
      g.beginPath(); g.moveTo(cx, cy - s);  g.lineTo(cx, cy + s);  g.strokePath()
      g.beginPath(); g.moveTo(cx - s, cy);  g.lineTo(cx + s, cy);  g.strokePath()
      const d = s * 0.7
      g.beginPath(); g.moveTo(cx - d, cy - d); g.lineTo(cx + d, cy + d); g.strokePath()
      g.beginPath(); g.moveTo(cx + d, cy - d); g.lineTo(cx - d, cy + d); g.strokePath()
      break
    case 'hourglass':
      g.beginPath()
      g.moveTo(cx - s, cy - s); g.lineTo(cx + s, cy - s)
      g.lineTo(cx - s, cy + s); g.lineTo(cx + s, cy + s)
      g.closePath(); g.fillPath()
      break
    case 'box':
      g.lineStyle(2, color, 1)
      g.strokeRect(cx - s, cy - s, s * 2, s * 2)
      g.strokeRect(cx - s + 5, cy - s + 5, s * 2 - 10, s * 2 - 10)
      break
    case 'horns':
    default:
      g.lineStyle(3, color, 1)
      g.beginPath(); g.arc(cx - s/2, cy, s, Math.PI * 0.15, Math.PI * 0.85, false); g.strokePath()
      g.beginPath(); g.arc(cx + s/2, cy, s, Math.PI * 0.15, Math.PI * 0.85, true);  g.strokePath()
      break
  }
}

// Build the static pact-card visual into a Phaser container at (x, y).
// Returns { container, tweens }: the container is scene-attached, the
// tweens array contains looping tweens (rare+ halo, epic+ ribbon glow)
// that the caller should `.stop()` on cleanup.
//
// opts.depth — sets container.setDepth (default: leave Phaser default)
export function renderPactCard(scene, def, x, y, w, h, opts = {}) {
  const tweens = []
  const rarKey    = def?.rarity ?? 'common'
  const rar       = RARITIES[rarKey] ?? RARITIES.common
  const tag       = (def?.tags ?? []).find(t => SIGIL_FOR_TAG[t]) ?? 'horns'
  const sigilKind = SIGIL_FOR_TAG[tag] ?? 'horns'
  const flavor    = PACT_FLAVOR[def?.id] ?? DEFAULT_FLAVOR

  const cont = scene.add.container(x, y)
  cont.setSize(w, h)
  if (opts.depth != null) cont.setDepth(opts.depth)

  // Card background (rarity-tinted edge)
  const card = scene.add.graphics()
  pixelPanel(card, 0, 0, w, h, {
    fill: CRYPT.bgStone1, edgeH: rar.hex, edgeS: CRYPT.panelEdgeS,
  })
  cont.add(card)

  // Rarity-color halo on rare+ — pulses as a thin inner stroke
  if (rar.weight >= 1) {
    const halo = scene.add.graphics()
    halo.lineStyle(2, rar.hex, 0.5)
    halo.strokeRect(3, 3, w - 6, h - 6)
    cont.add(halo)
    tweens.push(scene.tweens.add({
      targets:  halo,
      alpha:    { from: 0.5, to: 1 },
      duration: 1400 - rar.weight * 180,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    }))
  }

  // Sigil box (top-left) — drawn pixel art, tinted by rarity
  const gBox = 60
  const sigilBg = scene.add.graphics()
  pixelPanel(sigilBg, 14, 14, gBox, gBox, {
    fill: CRYPT.bgStone3, edgeH: rar.hex, edgeS: CRYPT.panelEdgeH, inset: true,
  })
  cont.add(sigilBg)
  const sigilG = scene.add.graphics()
  drawSigil(sigilG, 14 + gBox / 2, 14 + gBox / 2, 18, sigilKind, rar.hex)
  cont.add(sigilG)

  // Rarity ribbon (top-right)
  const rW = rar.label.length * 7 + 16
  const rX = w - rW - 14
  const rY = 18
  const ribbon = scene.add.graphics()
  ribbon.fillStyle(rar.hex, 0.18)
  ribbon.fillRect(rX, rY, rW, 18)
  ribbon.lineStyle(1, rar.hex, 1)
  ribbon.strokeRect(rX, rY, rW, 18)
  cont.add(ribbon)
  const ribTxt = scene.add.text(rX + rW / 2, rY + 9, rar.label, {
    fontFamily: FONT_HEAD, fontSize: '8px', color: rar.color, letterSpacing: 1,
  }).setOrigin(0.5)
  cont.add(ribTxt)
  // Epic+ ribbon glow halo
  if (rar.weight >= 3) {
    const ribGlow = scene.add.graphics()
    ribGlow.lineStyle(1, rar.hex, 1)
    ribGlow.strokeRect(rX - 2, rY - 2, rW + 4, 22)
    cont.add(ribGlow)
    tweens.push(scene.tweens.add({
      targets: [ribGlow, ribTxt],
      alpha:    { from: 0.3, to: 1 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    }))
  }

  // Name (with shadow) — flowed below sigil
  const nameY = 14 + gBox + 14
  const nameT = scene.add.text(14, nameY, (def?.name ?? '?').toUpperCase(), {
    fontFamily: FONT_HEAD, fontSize: '12px', color: CRYPT.ink, letterSpacing: 1,
    wordWrap: { width: w - 28, useAdvancedWrap: true },
  })
  nameT.setShadow(2, 2, '#000000', 0, false, true)
  cont.add(nameT)

  // Flavor (italic dim) — sits under the name
  const flavorY = nameY + nameT.height + 6
  const flavorT = scene.add.text(14, flavorY, '" ' + flavor + ' "', {
    fontFamily: FONT_BODY, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
    fontStyle: 'italic',
    wordWrap: { width: w - 28, useAdvancedWrap: true }, lineSpacing: 2,
  })
  cont.add(flavorT)

  // Description — green up arrow + body text
  const descY = flavorY + flavorT.height + 14
  const upG = scene.add.graphics()
  upG.fillStyle(CRYPT.green, 1)
  upG.fillTriangle(14, descY + 10, 26, descY + 10, 20, descY)
  cont.add(upG)
  const descT = scene.add.text(32, descY - 2, def?.description ?? '— no description —', {
    fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
    wordWrap: { width: w - 46, useAdvancedWrap: true }, lineSpacing: 4,
  })
  cont.add(descT)

  // Divider between benefit and tradeoff so the eye groups them
  const divY = descY + descT.height + 14
  const div = scene.add.graphics()
  div.fillStyle(CRYPT.panelEdgeS, 1)
  div.fillRect(14, divY, w - 28, 1)
  div.fillStyle(CRYPT.panelEdgeH, 0.4)
  div.fillRect(14, divY + 1, w - 28, 1)
  cont.add(div)

  // Tradeoff — red down arrow + label + body, immediately below divider
  const tradeY = divY + 12
  const dnG = scene.add.graphics()
  dnG.fillStyle(CRYPT.accent, 1)
  dnG.fillTriangle(14, tradeY, 26, tradeY, 20, tradeY + 10)
  cont.add(dnG)
  cont.add(scene.add.text(32, tradeY - 2, 'TRADEOFF', {
    fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.accentCss, letterSpacing: 2,
  }))
  cont.add(scene.add.text(32, tradeY + 14, def?.tradeoffDescription ?? '—', {
    fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.warnCss, letterSpacing: 1,
    wordWrap: { width: w - 46, useAdvancedWrap: true }, lineSpacing: 3,
  }))

  return { container: cont, tweens }
}
