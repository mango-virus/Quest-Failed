// Per-class trait pools used by the LPC variant baker.
//
// Each item name maps to a sheet_definition's `name` field in the LPC pack.
// The bake script resolves names → JSON files → layer paths at run time.
//
// Pool structure:
//   bodyTypes:   which body builds are valid (the LPC paths resolve from these)
//   heads:       which head shapes are allowed (must match body type)
//   hair:        'any' = sample any non-beard hairstyle; or a list
//   beardChance: float — probability of layering a beard on male bodies
//   torso/legs/feet/headwear/weapon/etc.: arrays of allowed item names,
//      OR { items, chance } for optional layers (chance = picked-or-skipped)
//
// Special rules:
//   - 'all_shields' resolves to every shield item
//   - 'all_human_hair' resolves to every non-beard / non-mustache hairstyle
//   - weaponPair: when picked, force-add a paired layer (Crystal on Diamond/Loop staff)
//   - alwaysShield: true → Knight always gets a shield layer
//   - barehanded:   true → no weapon layer ever
//   - shirtlessTorso: extra torso items only used when bodyType is in
//                     `shirtlessFor` (typically male/muscular). Used by Monk
//                     and Barbarian so only their male/muscular variants can
//                     have bare-chested Sleeveless / Original Sleeveless / Obi.
//                     Female variants of those classes still get full shirts.
//   - clothColorPool: override list for cloth recolor palettes (e.g. necromancer
//                     restricted to dark colors).

export const COMMON = {
  bodyTypes: ['male', 'muscular', 'female'],
  // Heads keyed by body type — sampler must pick from the matching list.
  humanHeadsByBody: {
    male:      ['Human Male', 'Human Male Plump', 'Human Male Gaunt', 'Human Male Small', 'Human Male Elderly'],
    muscular:  ['Human Male', 'Human Male Plump'],
    female:    ['Human Female', 'Human Female Elderly', 'Human Female Small'],
  },
  noses: ['Big nose', 'Button nose', 'Elderly nose', 'Large nose', 'Straight nose'],
  eyebrows: ['Thick Eyebrows', 'Thin Eyebrows'],
};

// Hairstyles that wear cleanly UNDER a helmet. Hair renders at zPos 120 and
// helmets at 125–135, so the helm covers the skull — but anything TALLER than
// the helmet silhouette (afros, spikes, mohawks, top-knots, big buns) still
// pokes out the crown. These two lists are the safe set:
//   _SHORT — close-cropped styles the helm fully hides (clean on any body)
//   _LONG  — long pieces whose volume hangs down the back/shoulders BELOW the
//            helmet rim; reads great on female knights especially.
// NOTE: 'Twists fade' and 'Flat top fade' were removed — both carry crown
// VOLUME that crests above the (low-rimmed) Hood, reading as hair poking out
// the top. They look fine bare/under a bandana, but the baker rolls hair and
// headwear independently, so a clean-under-hood set is the safe contract.
// (Black-haired flat-tops hid the poke; lighter colours exposed it — a latent
// bug, so the style is out regardless of colour.) 'Cornrows' STAYS: it lies
// flat to the scalp (no crown height) and the hood covers it cleanly.
export const HELMET_SAFE_HAIR_SHORT = [
  'Buzzcut', 'High and tight', 'Balding', 'Page', 'Page2', 'Pixie',
  'Bob', 'Bob side part', 'Lob', 'Plain', 'Parted', 'Parted 2', 'Parted 3',
  'Side Parted w/Bangs', 'Bangs', 'Bangsshort', 'Half up', 'Loose',
  'Natural', 'Swoop', 'Cornrows',
];
// Only FLAT-CROWNED long styles that hang straight down — these sit below the
// helmet rim and never add height at the crown. Excluded: anything with crown
// volume or a high-gathered base (Long band/messy, Ponytail(2), Braid(2),
// Princess, Wavy) — those poke through the top of shorter helms.
export const HELMET_SAFE_HAIR_LONG = [
  'Long', 'Long straight', 'Long center part', 'Long tied',
  'Curtains long', 'Shoulderl', 'Shoulderr', 'Single',
];

// Crystal pairs ONLY with Diamond staff and Loop staff.
const STAFF_WITH_CRYSTAL = new Set(['Diamond staff', 'Loop staff']);
const CRYSTAL_COLORS = ['blue', 'orange', 'green', 'purple', 'red', 'yellow', 'white'];
export const CRYSTAL_RULE = { staves: STAFF_WITH_CRYSTAL, colors: CRYSTAL_COLORS };

export const POOLS = {
  // Knight — heraldic man-at-arms. Full plate broken up by a coloured surcoat
  // (Tabard) in a house colour shared by the painted heater shield, plate
  // limbs + sabatons, topped by a great helm (some with a visored bascinet).
  // Body skews male/muscular (broad, armoured); female knights still appear
  // and get long hair flowing below the helm.
  knight: {
    bodyTypes: COMMON.bodyTypes,
    bodyTypeWeights: { male: 4, muscular: 3, female: 2 },
    heads: 'auto_human',
    // Knights are ALWAYS helmeted, so short "on-top" hair is either hidden by
    // the helm or pokes raggedly through its crown (reads as missing pixels).
    // Per the design rule (men → beards, women → long hair): men get NO top
    // hair (their beard carries the face under open helms); women get only the
    // long back/shoulder styles, which flow visibly BELOW the helm rim without
    // clipping its top.
    hair: {
      male:     [],
      muscular: [],
      female:   HELMET_SAFE_HAIR_LONG,
    },
    beardChance: 0.5,
    torso: ['Plate'],
    // Coloured surcoat UNDER the breastplate (Tabard zPos 55 < Plate 60), so
    // the house-colour skirt/shoulders show below/around the armour.
    torsoOverlay: { items: ['Tabard'], chance: 0.65 },
    // Plate greaves are the look; cloth breeches are the minority. (Plate legs
    // share the name "Armour" with arms/feet plate — qualified as "legs:Armour".)
    legs: { items: ['legs:Armour', 'legs:Armour', 'Hose', 'Cuffed Pants', 'Long Pants'], chance: 1.0 },
    feet: ['feet:Armour', 'feet:Armour', 'Plated Toe', 'Thick Plated Toe', 'Basic Boots', 'Folded Rim Boots', 'Rimmed Boots'],
    // Always armored arms. Muscular bodies get full plate vambraces ONLY —
    // shoulder-/cloth-pieces (Pauldrons/Epaulets/Mantal) leave a muscular
    // forearm bare. Male/female bodies (slimmer, more covered by the plate
    // sleeve) roll a varied set, still weighted toward vambraces.
    arms: {
      male:     { items: ['arms:Armour', 'arms:Armour', 'Pauldrons', 'Pauldrons', 'Bauldron', 'Mantal', 'Epaulets'], chance: 1.0 },
      female:   { items: ['arms:Armour', 'arms:Armour', 'Pauldrons', 'Pauldrons', 'Bauldron', 'Mantal', 'Epaulets'], chance: 1.0 },
      muscular: { items: ['arms:Armour'], chance: 1.0 },
    },
    headwear: {
      // Excluded: Crest / Plumage / Centurion Crest / Centurion Plumage /
      // Helmet wings — these are decoration accessories that need a base helm.
      // Pigface bascinet/visor dropped from headwear (visors are added as a
      // paired layer over a plain bascinet via visorChance below).
      // 'Greathelm' dropped per user (kept the pointed 'Sugarloaf greathelm').
      items: [
        'Close helm', 'Norman helm', 'Bascinet', 'Round bascinet',
        'Pointed helm', 'Sugarloaf greathelm', 'Spangenhelm',
        'Maximus', 'Mail', 'Armet', 'Simple Armet', 'Barbuta', 'Simple barbuta',
        'Kettle helm', 'Morion',
      ],
      chance: 1.0,
    },
    // When the rolled helm is a bascinet, 60% drop a metal-matched visor.
    visorChance: 0.6,
    visors: ['Pigface visor', 'Grated visor', 'Slit visor', 'Round visor'],
    weapon: {
      items: ['Longsword', 'Arming Sword', 'Saber'],
      chance: 1.0,
    },
    // Heraldic house colours valid across Tabard variants, heater shield paint,
    // AND the cloth palette (so surcoat + painted shield + any cloth legs match).
    clothColorPool: ['red', 'blue', 'navy', 'purple', 'forest', 'green', 'white', 'teal', 'sky', 'orange'],
    // Armour/helm/weapon metal — silver / steel / ceramic (warm clay) / iron
    // (darker gunmetal); no gold/brass. Drives plate, vambraces, helm, sword
    // blade, shield trim.
    metalColorPool: ['silver', 'steel', 'ceramic', 'iron'],
    alwaysShield: true,
    // Mostly heraldic-painted heater shields, some round shields.
    shieldTypes: ['heater', 'heater', 'round'],
    heraldicShield: true,
  },

  // Rogue — lithe hooded leather thief/assassin in dark muted tones. Hood-heavy
  // silhouette, leather armour, bracers, a belt on everyone, a dagger, often a
  // face scarf. No muscular bodies (nimble, not bulky).
  rogue: {
    bodyTypes: ['male', 'female'],
    heads: 'auto_human',
    // Full hair variety. The baker's covering-safe rule auto-swaps voluminous
    // hair to a flat style under the rogue's hoods/bandanas (HAIR_COVERINGS),
    // so the hooded majority stays clip-free while the bare / eyepatch / mask
    // rogues show the whole range. (Was restricted to the flat HELMET_SAFE lists
    // before covering-safe existed.)
    hair: 'all_human_hair',
    beardChance: 0.2,
    // Leather armour primary; males can wear a leather vest; dark tunics fill in.
    torso: {
      male:   ['Leather', 'Leather', 'Vest', 'Vest open', 'Longsleeve', 'Shortsleeve'],
      female: ['Leather', 'Leather', 'Longsleeve', 'Longsleeve 2', 'Shortsleeve'],
    },
    // Belt on EVERY rogue (waist overlay, zPos 65–70 — over the leather). Mix of
    // leather belts + cloth sashes, in varied dark leather tones (the colours
    // every one of these belts ships, so none falls back to a stray white).
    torsoOverlay: { items: ['Leather Belt', 'Double Belt', 'Loose Belt', 'Sash', 'Narrow sash'], chance: 1.0 },
    torsoOverlayColor: ['charcoal', 'brown', 'leather', 'slate', 'walnut'],
    legs: ['Pants', 'Cuffed Pants', 'Leggings'],
    feet: ['Ghillies', 'Basic Shoes', 'Revised Shoes', 'Sara Shoes', 'Folded Rim Boots'],
    // Pants + shoes roll their OWN dark colour (independent of the torso) so they
    // don't always match the shirt — a mix, occasionally the same, mostly not.
    // Same dark thief palette, so it always reads dark/cohesive.
    legsColor: ['black', 'charcoal', 'brown', 'leather', 'walnut', 'slate', 'gray'],
    feetColor: ['black', 'charcoal', 'brown', 'leather', 'walnut', 'slate'],
    // Bracers signature (weighted) + gloves/cuffs.
    arms: { items: ['Bracers', 'Bracers', 'Gloves', 'Cuffs'], chance: 0.75 },
    // Hood-heavy (the rogue tell), with bandanas / eyepatch / mask for variety.
    headwear: {
      items: [
        'Hood', 'Hood', 'Hood', 'Hood', 'Sack Cloth Hood', 'Sack Cloth Hood',
        'Bandana', 'Bordered Bandana', 'Pirate Bandana',
        'Eyepatch Left', 'Eyepatch Right', 'Plain Mask',
      ],
      chance: 0.85,
    },
    // Skull is a bandana OVERLAY — only added on top of a rolled bandana (~40%),
    // white so it reads on a dark bandana.
    headOverlay: {
      when:   ['Bandana', 'Bordered Bandana', 'Pirate Bandana'],
      items:  ['Skull Bandana Overlay'],
      chance: 0.4,
      color:  'white',
    },
    // Independent accessory rolls: scarf 60%, stud ring 30%, single earring 25%.
    accessory: [
      { items: ['Scarf'], chance: 0.6, color: ['black', 'gray', 'brown', 'red'] }, // dark/bandit tones, no white/blue
      { items: ['Stud Ring'], chance: 0.3 },                                         // subtle outfit-toned gem
      { items: ['Simple Earring Left', 'Simple Earring Right'], chance: 0.25, color: 'silver' },
    ],
    weapon: { items: ['Dagger'], chance: 1.0 },
    clothColorPool: ['black', 'charcoal', 'brown', 'leather', 'walnut', 'slate', 'gray'],
    metalColorPool: ['steel', 'iron', 'silver'],
  },

  // Mage — kimono sorceress. Female-bodied. The signature is a deliberate
  // TWO-TONE kimono: a MAIN colour (kimono body + sleeves) with a distinct
  // ACCENT colour shared by every trim piece (kimono trim + sleeve trim), the
  // bodice, the obi sash, AND the hat — so the accent reads as one coordinated
  // set against the main robe. Uses the modular LPC kimono layer set: base,
  // trim, sleeves and sleeve-trim are SEPARATE colour-variant items, so each
  // locks to its own colour independently (see the `outfit` handler in
  // bake-lpc-variants.mjs). A wizard/witch hat ~half the time; always a staff.
  mage: {
    bodyTypes: ['female'],
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0, // female-bodied — no beards
    // Two-tone layered outfit. The baker rolls outfitMainColor + a distinct
    // outfitAccentColor, then composes a base dress (main) + its trim (accent),
    // ONE sleeve style (main) + its trim (accent), and an optional bodice
    // (accent). 'main'/'accent' in the layer specs resolve to those colours.
    outfit: {
      bases: [
        { layers: [['Kimono', 'main'], ['Kimono Trim', 'accent']] },
        { layers: [['Split Kimono', 'main'], ['Split Kimono Trim', 'accent']] },
        // Sash dress has no kimono-shaped trim item, so it always pairs a
        // bodice to carry its accent. Minority option.
        { layers: [['Sash dress', 'main']], forceBodice: true },
      ],
      sleeves: [
        { layers: [['Kimono Sleeves', 'main'], ['Kimono Sleeves Trim', 'accent']] },
        { layers: [['Kimono Oversized Sleeves', 'main'], ['Kimono Oversized Sleeves Trim', 'accent']] },
      ],
      // Some mages add a fitted bodice (accent) over the kimono.
      bodice: { item: 'Bodice', color: 'accent', chance: 0.4 },
    },
    // Obi sash at the waist (zPos 65, over the kimono+bodice), accent-coloured.
    // Sash / Narrow sash ship all 24 cloth colours; Mage/Robe Belt do NOT, so
    // they're intentionally excluded (they couldn't match an arbitrary accent).
    torsoOverlay: { items: ['Sash', 'Narrow sash'], chance: 1.0 },
    torsoOverlayColor: 'accent',
    // Leggings/Hose (zPos 20) sit UNDER the dress — invisible beneath a full
    // Kimono, and they fill the opening of a Split Kimono in the main colour.
    legs: ['Leggings', 'Hose'],
    feet: ['Slippers', 'Sandals', 'Basic Shoes'],
    // Self-contained wizard / witch hats only, ~50%. No hoods, no crown, no
    // tiara. Accent-locked so the hat joins the trim/bodice/sash accent set.
    // (Large Hat ships only brown → stays a brown leather wide-brim; Wizard Hat
    // Buckle is just the metal buckle ornament, not a full hat, so it's out.)
    headwear: {
      items: [
        'Wizard Hat Base', 'Wizard Hat Belt',
        'Celestial Wizard Hat', 'Celestial Wizard Moon Hat',
        'Large Hat',
      ],
      chance: 0.5,
    },
    headwearColor: 'accent',
    weapon: {
      items: ['Simple staff', 'Gnarled staff', 'Diamond staff', 'Loop staff', 'S staff'],
      chance: 1.0,
    },
    // Full cloth palette — both main and accent draw from it (accent ≠ main).
    clothColorPool: [
      'black', 'blue', 'bluegray', 'brown', 'charcoal', 'forest', 'gray', 'green',
      'lavender', 'leather', 'maroon', 'navy', 'orange', 'pink', 'purple', 'red',
      'rose', 'sky', 'slate', 'tan', 'teal', 'walnut', 'white', 'yellow',
    ],
  },

  // Cleric — holy priest-healer in clean white-and-gold vestments. A bright,
  // devout foil to the necromancer, and deliberately NOT the off-limits
  // white_mage (no wizard hat, no pastels). A floor-length robe under a
  // tone-matched Tabard surcoat, a gold/silver Cross amulet on some, a veil or
  // circlet, and a holy Mace or staff (50/50).
  cleric: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.3,
    // Floor-length vestment robe = a light longsleeve top + long skirt. (The
    // dedicated female "Robe" item is intentionally NOT used: its colour
    // variants are oddly named — black/dark gray/forest green/light gray/… — so
    // a clothColor like teal/sky/tan finds no match and falls back to a RANDOM
    // variant. Longsleeves palette-recolour cleanly to any holy colour.)
    torso: ['Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Buttoned', 'Longsleeve Polo'],
    // Skirt-dominant so the robe reaches the floor; a minority in plain trousers.
    legs: ['Plain skirt', 'Plain skirt', 'Plain skirt', 'Slit skirt', 'Long Pants', 'Hose'],
    feet: ['Sandals', 'Basic Shoes', 'Revised Shoes', 'Slippers'],
    arms: { items: ['Cuffs', 'Gloves'], chance: 0.3 },
    // Tabard surcoat — a CONTRASTING holy accent over the light robe (heraldic
    // surcoat, like the knight's). The tone-on-tone version read flat; this
    // gives the eye a clear second element. ~85% so most clerics have it.
    torsoOverlay: { items: ['Tabard'], chance: 0.85 },
    torsoOverlayColor: ['blue', 'navy', 'maroon', 'red', 'purple', 'teal', 'forest'],
    // Holy detail: a gold/silver Cross amulet on nearly everyone (`<metal>_<gem>`
    // variant names), plus a liturgical stole (neck scarf) on some in a
    // contrasting liturgical colour.
    accessory: [
      { items: ['Cross amulet'], chance: 0.9, color: ['gold_red', 'gold_blue', 'silver_blue', 'gold_purple', 'silver_red'] },
      { items: ['Scarf'], chance: 0.3, color: ['red', 'blue', 'white'] },
    ],
    // Devout headwear — veil (Hijab) or circlet (Tiara). The veil locks to the
    // robe colour (light), contrasting the tabard. NO hoods, NO wizard hats.
    headwear: {
      items: ['Hijab', 'Hijab', 'Tiara'],
      chance: 0.6,
    },
    // Robe + veil stay LIGHT (white-dominant) so the contrasting tabard + gold
    // cross carry the detail. Avoids white_mage's pink/rose/lavender.
    clothColorPool: ['white', 'white', 'white', 'sky', 'tan', 'gray', 'bluegray'],
    metalColorPool: ['gold', 'gold', 'silver', 'brass'],
    // 50/50 holy mace (overhead oversize swing) : holy staff (thrust). Mace is
    // the traditional "no bladed bloodshed" clergy weapon.
    weapon: {
      items: ['Mace', 'Mace', 'Mace', 'Loop staff', 'Loop staff', 'Simple staff'],
      chance: 1.0,
    },
  },

  // Necromancer — hooded reaper / death-cultist. Deliberately NOTHING like the
  // off-limits black_mage (no wizard hats, no clean robes). Two silhouettes mix:
  // ~40% wear the same modular kimono as the mage but in DARK two-tone (a death
  // priestess), the other ~60% wear a ragged floor-length reaper robe. Half are
  // faceless under a Sack Cloth Hood, half wear a bone-white skull bandana.
  // Scythe or bone-staff, often a tattered cloak. Dark palette only.
  necromancer: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.4,
    // ~40% use the mage's modular kimono, DARK two-tone (main = the 5 permitted
    // darks; accent mostly those + the other dark tones sprinkled occasionally).
    outfit: {
      chance: 0.4,
      bases: [
        { layers: [['Kimono', 'main'], ['Kimono Trim', 'accent']] },
        { layers: [['Split Kimono', 'main'], ['Split Kimono Trim', 'accent']] },
      ],
      sleeves: [
        { layers: [['Kimono Sleeves', 'main'], ['Kimono Sleeves Trim', 'accent']] },
        { layers: [['Kimono Oversized Sleeves', 'main'], ['Kimono Oversized Sleeves Trim', 'accent']] },
      ],
      bodice: { item: 'Bodice', color: 'accent', chance: 0.4 },
      underLegs: ['Leggings', 'Hose'],
      accentColors: ['black', 'charcoal', 'slate', 'gray', 'purple', 'purple', 'maroon', 'navy', 'forest', 'bluegray'],
    },
    // Reaper-robe (the ~60% without a kimono): a dark longsleeve top + a long
    // skirt (legs) = floor-length robe on any body. Men also get death-priest
    // coats; women the dedicated Robe. All one dark clothColor.
    // (No female "Robe" — its colour variants don't cover the dark palette and
    // fall back to a random off-palette colour, e.g. a stray brown robe. The
    // Longsleeve+skirt robe palette-recolours cleanly. See Robe gotcha.)
    torso: {
      male:     ['Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Buttoned', 'Frock coat', 'Iverness cloak'],
      muscular: ['Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Buttoned'],
      female:   ['Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Buttoned'],
    },
    // Floor-length robe: the skirt (Plain/Slit) IS the hem — kept dominant so
    // the robe reaches the floor; a small minority wear plain dark trousers.
    legs: ['Plain skirt', 'Plain skirt', 'Plain skirt', 'Slit skirt', 'Slit skirt', 'Long Pants'],
    feet: ['Slippers', 'Sandals', 'Basic Shoes'],
    arms: { items: ['Gloves', 'Bracers'], chance: 0.4 },
    // Dark belt cinch at the waist (varied dark leather tones).
    torsoOverlay: { items: ['Leather Belt', 'Double Belt', 'Sash'], chance: 0.7 },
    torsoOverlayColor: ['charcoal', 'black', 'walnut', 'slate'],
    // Tattered reaper cloak ~50%, in the robe colour.
    cape: { items: ['Tattered', 'Tattered', 'Solid'], chance: 0.5 },
    // ~60% hooded (faceless under a Sack Cloth Hood / Hood), the rest bare-headed
    // (hair showing). NO wizard hats (separates from black_mage).
    headwear: {
      items: ['Sack Cloth Hood', 'Sack Cloth Hood', 'Hood'],
      chance: 0.6,
    },
    // Featureless face mask on ~half, a MIX of bone-white + black — worn WITH a
    // hood (masked face inside the cowl) or without (masked, hair showing). The
    // mask is a facial layer (zPos 114), independent of the hood slot, so the
    // two combine freely. (Replaces the old skull bandana per user.)
    accessory: [
      { items: ['Plain Mask'], chance: 0.5, color: ['white', 'white', 'black', 'black'] },
    ],
    // Main colours: ONLY these 5 darks (user-locked). Other darks appear only as
    // occasional kimono accents (see outfit.accentColors).
    clothColorPool: ['black', 'charcoal', 'slate', 'gray', 'purple'],
    // 50% scythe (the reaper) : 50% bone/gnarled staves. Scythe renders via
    // slash_oversize, staves via thrust_oversize (both visible mid-attack).
    weapon: {
      items: ['Scythe', 'Scythe', 'Scythe', 'Gnarled staff', 'S staff', 'Loop staff'],
      chance: 1.0,
    },
  },

  // Ranger — woodland archer / scout (Robin Hood / Aragorn). Leather-clad, a
  // quiver of arrows on EVERY back, a feathered leather cap, sometimes a forest
  // cloak. Bow only (walk_128 carry + shoot attack + a nocked Arrow). Earthy
  // woodland palette. Distinct from the bounty hunter (dark crossbow merc) and
  // beast master (spear tamer).
  ranger: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.35,
    // Leather armour primary + a forest tunic / shirt.
    torso: ['Leather', 'Leather', 'Tunic', 'Shortsleeve', 'Longsleeve 2'],
    legs: ['Long Pants', 'Cuffed Pants', 'Fur Pants', 'Pants'],
    feet: ['Basic Boots', 'Folded Rim Boots', 'Revised Boots', 'Ghillies'],
    // Pants + shoes roll their OWN earthy colour (independent of the torso) so
    // they don't always match the shirt — a mix (occasionally the same colour
    // lands, mostly not). Same earthy family as the cloth palette, so it always
    // reads woodland.
    legsColor: ['brown', 'walnut', 'leather', 'tan', 'charcoal', 'black', 'slate', 'gray', 'forest'],
    feetColor: ['brown', 'black', 'walnut', 'leather', 'charcoal', 'slate', 'tan'],
    // Metal archer's bracers (arm guards) on most.
    arms: { items: ['Bracers', 'Bracers', 'Gloves'], chance: 0.6 },
    // A leather belt at the waist on nearly everyone (dark leather tones).
    torsoOverlay: { items: ['Leather Belt', 'Double Belt', 'Loose Belt', 'Leather Belt Alt'], chance: 0.9 },
    torsoOverlayColor: ['brown', 'leather', 'walnut', 'charcoal', 'black', 'slate'],
    // Quiver of arrows on EVERY ranger (the archer signature; zPos 8, back).
    accessory: [
      { items: ['Quiver'], chance: 1.0 },
    ],
    // Forest cloak on MOST (green/brown, draped behind).
    cape: { items: ['Tattered', 'Solid'], chance: 0.72 },
    capeColor: ['forest', 'brown', 'walnut', 'green', 'leather'],
    // EVERY ranger wears a leather cap (the base cap, random colour) with a
    // feather plume layered on top in a DIFFERENT colour. NOTE: the LPC "Leather
    // Cap Feather" item is the feather PLUME ONLY (no cap) in our baker — the
    // generator auto-pairs the base cap, we don't — so it MUST be layered over a
    // plain "Leather Cap" via headOverlay, else you get a floating capless feather.
    headwear: {
      items: ['Leather Cap'],
      chance: 1.0,
    },
    // Cap stays EARTHY/muted (no bright pink/red/orange/etc.); the feather can
    // be any colour (it contrasts the cap).
    headwearColor: ['leather', 'brown', 'walnut', 'tan', 'forest', 'gray', 'charcoal', 'black', 'slate'],
    headOverlay: {
      when:   ['Leather Cap'],
      items:  ['Leather Cap Feather'],
      chance: 1.0,
      color:  'any', // random (colourful) feather, biased to contrast the cap
    },
    // Bow only — Normal / Great / Recurve. The renderer plays 'shoot' for
    // rangers; the bow's walk_128 shows it carried while walking; bow users get
    // a nocked Arrow ('Ammo') in the shoot frames (paired in the baker).
    weapon: {
      items: ['Normal', 'Great', 'Recurve'],
      chance: 1.0,
    },
    // Woodland earth tones.
    clothColorPool: ['forest', 'green', 'brown', 'leather', 'walnut', 'tan', 'gray', 'charcoal'],
    metalColorPool: ['iron', 'steel', 'bronze'],
  },

  // Bounty hunter — the professional tracker who enters the dungeon to
  // slay a famous (3+ kill) minion. A dark, practical, leather-armoured
  // silhouette: leather torso, hood / brimmed hat, sturdy boots, often
  // pauldrons, a crossbow, and a dark earthy palette — reads as a
  // seasoned mercenary, not a fresh recruit. Uses only proven LPC item
  // names so the bake never misses a layer. The crossbow renders via the
  // thrust-oversize attack sheet, so bounty_hunter must also be listed in
  // ATK_CLASSES (bake-weapons.cjs) + ADVENTURER_ATK_CLASSES (Preload.js),
  // and `node bake-weapons.cjs bounty_hunter` must run after the base bake.
  // Bounty Hunter — dark professional merc / tracker (enters the dungeon to
  // slay a famous minion). Leather + a dark duster, a chest BANDOLIER, the
  // signature SUNGLASSES + face scarf, and a crossbow. Dark earthy palette.
  bounty_hunter: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.45,
    // Leather + a dark duster (Frock/Collared coat, men); leather/longsleeve others.
    torso: {
      male:     ['Leather', 'Frock coat', 'Frock coat', 'Collared coat', 'Longsleeve 2'],
      muscular: ['Leather', 'Leather', 'Longsleeve 2'],
      female:   ['Leather', 'Leather', 'Longsleeve 2', 'Longsleeve'],
    },
    legs: ['Long Pants', 'Cuffed Pants', 'Pants'],
    legsColor: ['black', 'charcoal', 'brown', 'walnut', 'slate', 'gray'],
    feet: ['Basic Boots', 'Folded Rim Boots', 'Revised Boots'],
    feetColor: ['black', 'brown', 'walnut', 'charcoal', 'leather'],
    arms: { items: ['Pauldrons', 'Bracers', 'Gloves'], chance: 0.8 },
    // Chest BANDOLIER (Straps, zPos 110, over the coat) — the merc tell; some
    // get a heavy belt instead. Dark leather tones.
    torsoOverlay: { items: ['Straps', 'Straps', 'Straps', 'Double Belt', 'Leather Belt'], chance: 0.85 },
    torsoOverlayColor: ['black', 'charcoal', 'brown', 'walnut', 'leather'],
    // Hood / leather cap / tricorne / bandana, dark. (No feathered cap — plume
    // gotcha.) ~50% — the other half go bare-headed (hair + the signature shades).
    headwear: {
      items: ['Hood', 'Leather Cap', 'Tricorne', 'Bordered Bandana'],
      chance: 0.5,
    },
    headwearColor: ['black', 'charcoal', 'brown', 'walnut', 'leather', 'slate', 'gray'],
    // SIGNATURE: dark shades on EVERY bounty hunter + a face scarf on most.
    accessory: [
      { items: ['Sunglasses', 'Shades'], chance: 1.0, color: ['black', 'black', 'charcoal'] },
      { items: ['Scarf'], chance: 0.8, color: ['black', 'gray', 'brown', 'red'] },
    ],
    // Dark, earthy, professional palette.
    clothColorPool: ['brown', 'leather', 'walnut', 'slate', 'gray', 'charcoal', 'black', 'navy', 'forest', 'maroon', 'bluegray'],
    metalColorPool: ['iron', 'steel', 'silver'],
    weapon: { items: ['Crossbow'], chance: 1.0 },
  },

  // ── Twitch Streamer — FLASHY "DRIP" GAMER ──────────────────────────────
  // An isekai'd streamer dropped into the dungeon: loud DYED hair, shades,
  // bright casual clothes, and bling (gold chains + gem necklace + earrings).
  // Reads modern + out-of-place beside the medieval roster. LPC ships no
  // headset / cap / hoodie, so the modern signal is dyed-hair + eyewear +
  // bling + sweatband. (No more random wings/tails — the look is intentional.)
  twitch_streamer: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    // ALWAYS dyed — only loud fantasy hair colours, never natural tones.
    hairColorPool: ['blue', 'green', 'purple', 'violet', 'navy', 'rose', 'pink', 'orange', 'red', 'platinum'],
    beardChance: 0.2,
    // Casual modern tops — tees + tanktop — in LOUD colours.
    torso: [
      'TShirt', 'TShirt VNeck', 'TShirt Scoop', 'TShirt Buttoned',
      'Tanktop', 'Tanktop', 'Shortsleeve', 'Shortsleeve Polo',
    ],
    clothColorPool: ['red', 'blue', 'green', 'orange', 'pink', 'purple', 'sky', 'lavender', 'maroon', 'rose'],
    // Casual bottoms (joggers / shorts) in calm dark tones — loud top, calm legs.
    legs: ['Pants', 'Cuffed Pants', 'Long Pants', 'Shorts', 'Short Shorts'],
    legsColor: ['black', 'charcoal', 'gray', 'navy', 'slate', 'blue', 'maroon', 'walnut'],
    // Bright sneakers.
    feet: ['Basic Shoes', 'Revised Shoes', 'Sara Shoes', 'Slippers'],
    feetColor: ['white', 'black', 'red', 'blue', 'gray', 'green'],
    arms: { items: ['Gloves', 'Cuffs', 'Stud Ring'], chance: 0.3 },
    // A normal casual belt on some (z70, over the tee) in plain leather tones.
    torsoOverlay: { items: ['Leather Belt', 'Double Belt', 'Loose Belt'], chance: 0.4 },
    torsoOverlayColor: ['brown', 'charcoal', 'walnut', 'leather', 'tan', 'slate'],
    // Gamer sweatband (sits ON the hair → the dyed colour still shows) + a rare
    // "top-streamer" Crown (ignores headwearColor → renders in metalColor/gold).
    headwear: {
      items: ['Thick Headband', 'Thick Headband', 'Tied Headband', 'Tied Headband', 'Crown'],
      chance: 0.5,
    },
    headwearColor: ['red', 'blue', 'green', 'orange', 'pink', 'purple', 'black', 'white', 'navy', 'sky'],
    // The DRIP — eyewear (almost everyone) + gold/silver chain + earrings.
    accessory: [
      { items: ['Sunglasses', 'Shades', 'Nerd Glasses', 'Round Glasses', 'Halfmoon Glasses'], chance: 0.5, color: ['black', 'charcoal', 'black', 'navy', 'green'] },
      { items: ['Chain Necklace', 'Large Beaded Necklace', 'Small Beaded Necklace'], chance: 0.6, color: ['gold', 'gold', 'silver', 'brass'] },
      { items: ['Stud earrings', 'Moon earrings', 'Pear earrings', 'Princess earrings'], chance: 0.4, color: ['gold', 'silver'] },
    ],
    metalColorPool: ['gold', 'silver', 'gold', 'brass'],
    weapon: {
      // a random "grabbed-it-on-stream" weapon — chaos energy, clean look.
      items: [
        'Longsword', 'Arming Sword', 'Saber', 'Mace', 'Waraxe', 'Spear',
        'Dagger', 'Rapier', 'Scimitar', 'Katana', 'Glowsword',
        'Simple staff', 'Gnarled staff', 'Diamond staff',
        'Scythe', 'Cane', 'Flail',
        'Recurve', 'Crossbow', 'Slingshot',
      ],
      chance: 0.8,
    },
    // No shields — a streamer wouldn't carry one (user).
    sometimesShield: 0,
  },

  // Beast Master — feral wilderness tamer. MOST are beast-bonded: matched
  // wolf/cat EARS + TAIL coloured to their hair (fur). Rugged leather + fur
  // clothing, a beast-tooth necklace, and a hunting POLEARM (spear/trident —
  // strikes with a thrust). Distinct from the ranger (clean archer) and
  // barbarian (bare-chested brute). (Whip is unusable — see notes; no carry/
  // thrust frames, only a disconnected oversize whip-crack overlay.)
  beast_master: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    // ALL hair colours (natural + fantasy) for hair/ears/tail — no hairColorPool
    // restriction (defaults to every hair palette; the ear/tail PNGs ship them all).
    beardChance: 0.4,
    // ALL are beast-bonded: matched ears + tail, coloured to the hair (fur).
    beastKin: {
      chance: 1.0,
      types: [
        { ears: 'Wolf Ears', tail: 'Wolf Tail' },
        { ears: 'Wolf Ears', tail: 'Fluffy Wolf Tail' },
        { ears: 'Cat Ears', tail: 'Cat Tail' },
      ],
    },
    // Fur-pelt feral: a bare/sleeveless base (feral arms) or a leather jerkin.
    torso: ['Original Sleeveless', 'Sleeveless 2', 'Leather', 'Leather'],
    legs: ['Fur Pants', 'Fur Pants', 'Fur Pants', 'Long Pants', 'Cuffed Pants'],
    legsColor: ['brown', 'walnut', 'leather', 'tan', 'gray', 'charcoal', 'forest', 'black'],
    feet: ['Basic Boots', 'Folded Rim Boots', 'Ghillies', 'Sandals'],
    feetColor: ['brown', 'black', 'walnut', 'leather', 'charcoal'],
    // Fur shoulder-PELT (Mantal) on most — the feral signature, in a natural fur
    // tone (distinct from the outfit); pauldrons/bracers are the minority.
    arms: { items: ['Mantal', 'Mantal', 'Mantal', 'Pauldrons', 'Bracers'], chance: 0.85 },
    armsColor: ['brown', 'tan', 'walnut', 'gray', 'charcoal', 'white', 'leather'],
    // Leather belt at the waist.
    torsoOverlay: { items: ['Leather Belt', 'Double Belt', 'Loose Belt', 'Sash'], chance: 0.7 },
    torsoOverlayColor: ['brown', 'walnut', 'leather', 'charcoal', 'black'],
    // Non-feral (~30%) get a fur hood / leather cap / bandana.
    headwear: {
      items: ['Hood', 'Leather Cap', 'Bordered Bandana', 'Bonnie'],
      chance: 0.85,
    },
    headwearColor: ['brown', 'walnut', 'leather', 'forest', 'gray', 'charcoal', 'tan'],
    // NO headwear — all are beast-kin (ears must show), so no hats at all.
    // Beast-tooth / bone necklace on some.
    accessory: [
      { items: ['Large Beaded Necklace', 'Small Beaded Necklace'], chance: 0.4, color: ['ceramic', 'bronze', 'copper'] },
    ],
    // Whip (animal-tamer's lash) — uses the LPC "Tool Whip" oversize sheet as a
    // thrust-overlay attack (wired in bake-weapons). NOTE: the whip has no walk-
    // carry art, so it only appears during the attack. Mixed with hunting spears.
    weapon: {
      items: ['Whip', 'Whip', 'Whip', 'Whip', 'Whip', 'Whip', 'Spear', 'Spear', 'Cane', 'Halberd'],
      chance: 1.0,
    },
    clothColorPool: ['brown', 'leather', 'walnut', 'tan', 'forest', 'green', 'gray', 'charcoal'],
    metalColorPool: ['iron', 'steel', 'bronze'],
  },

  // Barbarian — primal brute. Male/muscular (muscular-skewed), mostly
  // bare-chested, fur pants, a horned helm or wild hair + big beard, and a
  // heavy axe. Earthy primal palette, no gold.
  barbarian: {
    bodyTypes: ['male', 'muscular'],
    bodyTypeWeights: { male: 2, muscular: 3 }, // lean muscular
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.7,
    // MOSTLY bare-chested: the sleeveless set is weighted ~3:1 over the few
    // rugged shirts (shirtlessTorso merges into the pool for male/muscular).
    torso: ['Shortsleeve', 'TShirt Buttoned'],
    shirtlessTorso: ['Original Sleeveless', 'Original Sleeveless', 'Sleeveless 2', 'Sleeveless 2', 'Sleeveless', 'Sleeveless 2 Buttoned'],
    shirtlessFor: ['male', 'muscular'],
    legs: ['Fur Pants', 'Fur Pants', 'Pantaloons', 'Hose'],
    // Pants + boots roll their own earthy/fur colour (a mix, not lock-step).
    legsColor: ['brown', 'walnut', 'leather', 'tan', 'gray', 'charcoal', 'black'],
    feet: ['Basic Boots', 'Folded Rim Boots', 'Sandals'],
    feetColor: ['brown', 'black', 'walnut', 'leather', 'charcoal'],
    // Fur shoulder mantle / pauldrons / bracers over the bare arms.
    arms: { items: ['Pauldrons', 'Mantal', 'Mantal', 'Bracers', 'Stud Ring'], chance: 0.6 },
    // A thick leather belt at the waist (over the fur pants / loincloth) on most.
    torsoOverlay: { items: ['Leather Belt', 'Double Belt', 'Loose Belt'], chance: 0.8 },
    torsoOverlayColor: ['brown', 'walnut', 'leather', 'charcoal', 'black'],
    // A primal bead/bone trophy necklace on some (ceramic = bone-white; bronze/
    // copper = primitive metal) — sits on the bare chest (zPos 80).
    accessory: [
      { items: ['Large Beaded Necklace', 'Large Beaded Necklace', 'Small Beaded Necklace'], chance: 0.5, color: ['ceramic', 'ceramic', 'bronze', 'copper', 'iron'] },
    ],
    // Hide cloak on some (brown/fur tones).
    cape: { items: ['Tattered'], chance: 0.3 },
    capeColor: ['brown', 'walnut', 'leather', 'charcoal'],
    // Barbarian / viking helms (metal → metalColor). ~0.7; rest go bare-headed
    // (wild hair + beard carry the look).
    headwear: {
      items: ['Barbarian', 'Barbarian nasal', 'Viking spangenhelm', 'Horned helmet', 'Barbarian Viking'],
      chance: 0.7,
    },
    // Layer metal horns (Upward/Downward/Short, zPos 139, recolor to metalColor)
    // on the PLAIN helms — the Horned helmet / Barbarian Viking already have horns.
    headOverlay: [
      { when: ['Barbarian', 'Barbarian nasal', 'Viking spangenhelm'], items: ['Upward Horns', 'Downward Horns', 'Short Horns'], chance: 0.7 },
    ],
    // Axe-heavy (~50% axes), split evenly between the Waraxe and the two-handed
    // great-axe ("Smash" tool, from sheet_definitions/tools), with a heavy
    // supporting mix. Both swing via slash_oversize/slash_128.
    weapon: {
      items: ['Waraxe', 'Waraxe', 'Waraxe', 'Smash', 'Smash', 'Smash', 'Club', 'Mace', 'Flail', 'Halberd', 'Spear', 'Longsword'],
      chance: 1.0,
    },
    // Primal earthy palette, no gold.
    clothColorPool: ['brown', 'leather', 'walnut', 'tan', 'gray', 'charcoal', 'black', 'maroon', 'forest'],
    metalColorPool: ['iron', 'steel', 'bronze'],
    // A crude round shield on some — but ONLY with a one-handed weapon (a
    // two-handed great-axe/halberd/spear can't also carry a shield).
    sometimesShield: 0.35,
    shieldTypes: ['round'],
    shieldWeapons: ['Waraxe', 'Mace', 'Club', 'Longsword'],
    roundShieldColors: ['brown', 'brown', 'black', 'silver'], // wooden-leaning
  },

  // Monk — barehanded martial ascetic (shaolin / karate). Bare-chested or in a
  // gi-top (even mix), a coloured martial-arts BELT (obi/sash in rank colours),
  // a headband, a prayer-bead mala, and saffron/white robes. Distinct from the
  // off-limits samurai by being unarmed + bright-robed (samurai = dark lamellar
  // + saber). Strikes with a punch (the thrust animation); barehanded-locked.
  monk: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    baldChance: 0.5, // half are shaved/bald (can still have a beard)
    beardChance: 0.3,
    // Kimono / Split Kimono ROBE (main colour) + its matching trim in a
    // CONTRASTING accent (e.g. orange robe + black trim). NO sleeves — bare
    // arms, the martial-artist's sleeveless robe. (Two-tone like the mage, but
    // sleeveless + no bodice.)
    outfit: {
      bases: [
        { layers: [['Kimono', 'main'], ['Kimono Trim', 'accent']] },
        { layers: [['Split Kimono', 'main'], ['Split Kimono Trim', 'accent']] },
      ],
      underLegs: ['Pantaloons', 'Long Pants', 'Leggings'], // trousers under the robe
      mainColors:   ['orange', 'orange', 'white', 'red', 'maroon', 'brown', 'gray', 'yellow'],
      accentColors: ['black', 'black', 'charcoal', 'white', 'red', 'navy', 'maroon', 'walnut'],
    },
    feet: { items: ['Sandals', 'Sandals', 'Tabi Socks'], chance: 0.9 },
    feetColor: ['brown', 'tan', 'leather', 'walnut'],
    // Waist belt/sash, MATCHING the trim (accent). Obi on all bodies; Sash/
    // Narrow sash male+female; Waistband female-only. (Buckles excluded — no
    // thrust frame, vanishes mid-punch; Robe Belt excluded — only ships teal/white.)
    torsoOverlay: {
      male:     ['Obi', 'Sash', 'Narrow sash'],
      muscular: ['Obi'],
      female:   ['Obi', 'Sash', 'Narrow sash', 'Waistband'],
    },
    torsoOverlayColor: 'accent',
    // Prayer-bead mala (wood/bone beads) on some.
    accessory: [
      { items: ['Large Beaded Necklace', 'Small Beaded Necklace'], chance: 0.4, color: ['ceramic', 'bronze', 'copper'] },
    ],
    // Dojo headband on some (classic white/red/black/blue), tied/thick.
    headwear: {
      items: ['Tied Headband', 'Thick Headband', 'Thick Headband Rune', 'Hair Tie'],
      chance: 0.5,
    },
    headwearColor: ['white', 'red', 'black', 'blue'],
    // Saffron/Buddhist (orange) + white lean, with red/brown/gray (robe main).
    clothColorPool: ['orange', 'orange', 'white', 'red', 'maroon', 'brown', 'gray', 'yellow'],
    metalColorPool: ['bronze', 'iron', 'steel'],
    barehanded: true, // user-locked: monks always bare-handed (punch = thrust anim)
  },

  // Bard — flamboyant minstrel / performer. Vibrant fancy coats, a plumed
  // Cavalier hat, a bowtie, frilly cuffs — the saturated, flashy opposite of
  // the muted woodland ranger. Ranged (bow, no quiver — user-locked ranged,
  // kept distinct from the ranger by dropping the quiver + the flashy dress).
  bard: {
    bodyTypes: ['male', 'female'], // no muscular (user)
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.2,
    // Men: fancy frock/collared coats (24-colour, vibrant) + formal shirts.
    // Women: palette-swap formal shirts + cardigan (the coats are male-only art).
    torso: {
      male:   ['Frock coat', 'Frock coat', 'Frock coat', 'Collared coat', 'Collared coat', 'Longsleeve 2 Buttoned'],
      female: ['Cardigan', 'Longsleeve Polo', 'Longsleeve 2 Buttoned', 'Longsleeve'],
    },
    legs: ['Striped Formal Pants', 'Formal Pants', 'Pantaloons', 'Cuffed Pants'],
    // Pants are a NORMAL/neutral colour (NOT the vibrant torso colour) — see
    // legsColor, which overrides the cloth recolour just for the legs.
    legsColor: ['black', 'charcoal', 'gray', 'slate', 'brown', 'walnut', 'navy', 'tan', 'leather'],
    feet: ['Folded Rim Boots', 'Basic Shoes', 'Revised Shoes', 'Sara Shoes'],
    // Normal shoe/boot leather colours (NOT the vibrant outfit colour).
    feetColor: ['brown', 'black', 'walnut', 'leather', 'charcoal', 'tan', 'slate'],
    // Frilly lace cuffs (the foppish performer tell).
    arms: { items: ['Lace Cuffs', 'Lace Cuffs', 'Cuffs', 'Gloves'], chance: 0.6 },
    // ONLY: Bonnie / Bonnie Alt Tilt, Cavalier, or Formal Tophat (all 24-colour
    // → 'any' is flicker-safe). ~85% hatted.
    headwear: {
      items: ['Bonnie', 'Bonnie', 'Bonnie Alt Tilt', 'Cavalier', 'Cavalier', 'Formal Tophat'],
      chance: 0.85,
    },
    headwearColor: 'any',
    // Overlays per hat: the bonnie gets a center-trim band + a feather (each a
    // different, contrasting colour); the cavalier gets a feather. Tophat plain.
    headOverlay: [
      { when: ['Bonnie', 'Bonnie Alt Tilt'], items: ['Bonnie Center Trim'], chance: 1.0, color: 'any' },
      { when: ['Bonnie', 'Bonnie Alt Tilt'], items: ['Bonnie feather'],     chance: 1.0, color: 'any' },
      { when: ['Cavalier'],                  items: ['Cavalier feather'],    chance: 1.0, color: 'any' },
    ],
    // Dapper bowtie (vibrant) — the performer's neckwear.
    accessory: [
      { items: ['Bowtie', 'Bowtie 2'], chance: 0.6, color: ['red', 'blue', 'maroon', 'purple', 'forest', 'navy', 'teal', 'rose', 'sky', 'orange', 'white', 'black'] },
    ],
    // Ranged bow, NO quiver (kept distinct from the ranger). shoot + Ammo arrow.
    weapon: { items: ['Normal', 'Great', 'Recurve'], chance: 1.0 },
    // Vibrant, saturated palette — flashy performer (torso/hat); pants neutral.
    clothColorPool: ['red', 'purple', 'blue', 'teal', 'forest', 'green', 'maroon', 'navy', 'sky', 'orange', 'rose', 'pink', 'white', 'lavender', 'yellow'],
    metalColorPool: ['gold', 'silver', 'brass'],
  },

  // Cartographer Scholar — Cartographer's Convention event spawn. Robed
  // researcher silhouette closer to mage / cleric than to a fighter:
  // long pants/shoes, no armor, hood or wizard hat sometimes, and
  // mandatory glasses (chance 1.0 on the headwear pool entry — the
  // visual tell the user asked for). Barehanded so they read as
  // "scientist, not soldier"; AISystem skips combat for them anyway.
  // Cartographer Scholar — Cartographer's Convention event spawn. A bespectacled
  // ACADEMIC: waistcoat / frock coat / cardigan, a professorial bowler/tophat
  // (or a mage-scholar wizard hat), a map satchel (backpack) on some, and
  // MANDATORY glasses (the scholar tell). Barehanded (AISystem skips combat).
  cartographer_scholar: {
    bodyTypes: ['male', 'female'], // no muscular — refined scholars, not brawny
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 1.0, // EVERY man has a beard or mustache (distinguished)
    // Refined, fancy attire: frock coat / waistcoat (men); cardigan + formal
    // shirts (women — the coats are male-only art).
    torso: {
      male:     ['Frock coat', 'Frock coat', 'Vest', 'Collared/Formal Longsleeve', 'Longsleeve 2 Buttoned'],
      female:   ['Cardigan', 'Longsleeve 2 Buttoned', 'Longsleeve Polo', 'Longsleeve'],
    },
    legs: ['Formal Pants', 'Striped Formal Pants', 'Pantaloons'],
    // Trousers + shoes roll their OWN colour (dark formal trousers + leather
    // shoes), NOT the coat colour — so they don't lock-step with the shirt.
    legsColor: ['charcoal', 'black', 'navy', 'gray', 'slate', 'brown', 'walnut', 'bluegray'],
    feet: ['Basic Shoes', 'Revised Shoes', 'Sara Shoes', 'Folded Rim Boots'],
    feetColor: ['black', 'brown', 'walnut', 'charcoal', 'leather'],
    // Frilly lace cuffs — the refined gentleman/lady touch.
    arms: { items: ['Lace Cuffs', 'Lace Cuffs', 'Cuffs', 'Gloves'], chance: 0.6 },
    // Refined formal hats only — tophat / bowler / tricorne. ~70% (rest bare,
    // showing hair + beard + glasses). NO hoods/wizard hats (un-fancy).
    headwear: {
      items: ['Formal Tophat', 'Formal Tophat', 'Formal Bowler Hat', 'Formal Bowler Hat', 'Tricorne'],
      chance: 0.7,
    },
    headwearColor: ['black', 'charcoal', 'navy', 'maroon', 'brown', 'forest', 'gray', 'walnut'],
    // MANDATORY glasses (every cartographer) + a cravat/bowtie on most + a map
    // satchel (backpack) on some.
    accessory: [
      { items: ['Round Glasses', 'Nerd Glasses', 'Halfmoon Glasses', 'Secretary Glasses'], chance: 1.0, color: ['black', 'brown', 'gold', 'silver', 'charcoal'] },
      { items: ['Bowtie', 'Bowtie 2'], chance: 0.6, color: ['black', 'maroon', 'navy', 'forest', 'purple', 'red'] },
      { items: ['Backpack', 'Square pack'], chance: 0.3, color: ['brown', 'leather', 'walnut'] },
    ],
    // Rich, formal palette (refined).
    clothColorPool: ['navy', 'maroon', 'forest', 'charcoal', 'brown', 'walnut', 'slate', 'bluegray', 'black', 'purple', 'teal'],
    metalColorPool: ['gold', 'silver', 'brass'],
    barehanded: true,
  },

  // Cosplay Adventurer — Cosplay Contest event spawn. Body is always a
  // human (so every torso / legs / arms / shoe layer composites cleanly)
  // but the HEAD is always a monster: beastman, reptilian, undead,
  // farm animal, fantasy creature. Per-bodyType head map keeps gendered
  // monster heads matched to the gendered body so a "Lizard female"
  // head doesn't end up on a male body. Stacked with a wing/tail
  // accessory for the full "in costume" silhouette.
  cosplay_adventurer: {
    bodyTypes: ['male', 'muscular', 'female'],
    // ── COORDINATED COSTUMES ────────────────────────────────────────────
    // A contestant is ONE creature: a monster HEAD plus the matching feature
    // pieces (wings / tail / horns), all in a single shared hue so the costume
    // reads as deliberate — a green dragon (lizard head + green scaly wings +
    // tail), a black werewolf (wolf head + fur tail), a vampire (bat wings), a
    // blue fairy (cute head + butterfly wings), an imp/demon (horns + bat wings
    // + tail), etc. The set OVERRIDES the head pick and supplies the colour-
    // locked pieces (see v.costume in bake-lpc-variants.mjs). Feature-rich
    // costumes are duplicated to weight them above the head-only ones. `heads`
    // here is only a never-used fallback — costumeSets always overrides it.
    heads: ['Skeleton'],
    costumeSets: [
      // 🐉 Dragon — lizard head + colour-matched scaly wings + tail (×2 weight)
      { name: 'dragon',
        heads: { male: ['Lizard male'], muscular: ['Lizard male'], female: ['Lizard female'] },
        wings: ['Lizard Wings (Alt Colors)'],
        tail:  ['Lizard Tail (Alt Colors)'],
        color: ['green', 'blue', 'red', 'purple', 'orange'] },
      { name: 'dragon',
        heads: { male: ['Lizard male'], muscular: ['Lizard male'], female: ['Lizard female'] },
        wings: ['Lizard Wings (Alt Colors)'],
        tail:  ['Lizard Tail (Alt Colors)'],
        color: ['green', 'blue', 'red', 'purple', 'orange'] },
      // 🐺 Werewolf — wolf head + matching fur tail (×2 weight)
      { name: 'werewolf',
        heads: { male: ['Wolf male'], muscular: ['Wolf male'], female: ['Wolf female'] },
        tail:  ['Wolf Tail', 'Fluffy Wolf Tail'],
        color: ['black', 'gray', 'white', 'raven', 'ash', 'ginger'] },
      { name: 'werewolf',
        heads: { male: ['Wolf male'], muscular: ['Wolf male'], female: ['Wolf female'] },
        tail:  ['Wolf Tail', 'Fluffy Wolf Tail'],
        color: ['black', 'gray', 'white', 'raven', 'ash', 'ginger'] },
      // 🦇 Vampire — vampire head + black bat wings
      { name: 'vampire',
        heads: ['Vampire'],
        wings: ['Bat Wings'],
        color: ['black', 'raven'] },
      // 😈 Demon / imp — goblin or troll head + dark horns + bat wings + tail
      { name: 'demon',
        heads: ['Goblin', 'Troll'],
        horns: ['Curled Horns'],
        wings: ['Bat Wings'],
        tail:  ['Lizard Tail (Alt Colors)'],
        color: ['black', 'red'],
        hornColor: ['black', 'raven', 'red'] },
      // 🦋 Fairy / butterfly — cute critter head + bright butterfly wings (×2)
      { name: 'fairy',
        heads: ['Rabbit', 'Mouse', 'Sheep'],
        wings: ['Monarch Wings', 'Pixie Wings', 'Dragonfly Wings'],
        color: ['blue', 'green', 'gold', 'lavender', 'amber'] },
      { name: 'fairy',
        heads: ['Rabbit', 'Mouse', 'Sheep'],
        wings: ['Monarch Wings', 'Pixie Wings', 'Dragonfly Wings'],
        color: ['blue', 'green', 'gold', 'lavender', 'amber'] },
      // 🐗 Beastman — boar / minotaur / orc head (the head IS the costume)
      { name: 'beastman',
        heads: { male: ['Boarman', 'Minotaur', 'Wartotaur', 'Orc male'],
                 muscular: ['Boarman', 'Minotaur', 'Wartotaur', 'Orc male'],
                 female: ['Boarman', 'Minotaur female', 'Orc female'] } },
      // 🐷 Critter — farm / rodent head, no extra pieces
      { name: 'critter',
        heads: ['Pig', 'Rat', 'Sheep', 'Rabbit', 'Mouse'] },
      // 💀 Undead — skeleton / zombie / frankenstein head
      { name: 'undead',
        heads: ['Skeleton', 'Zombie', 'Frankenstein'] },
      // 👽 Spooky — alien / jack-o-lantern head
      { name: 'spooky',
        heads: ['Alien', 'Jack O Lantern'] },
    ],
    // No hair / beard / nose / eyebrows — every face layer would composite on
    // top of the monster head's built-in features and break the illusion. The
    // monster head sprite already has its own eyes + snout / muzzle / beak art.
    // (Headwear is auto-suppressed for costume heads in the baker.)
    hair: null,
    beardChance: 0,
    noses: null,
    eyebrows: null,
    // The person's own outfit under the costume — varied casual + a little
    // adventurer flair, independent of the creature's colour.
    torso: [
      'TShirt', 'TShirt Buttoned', 'TShirt Scoop', 'Shortsleeve', 'Shortsleeve Polo',
      'Longsleeve', 'Longsleeve 2', 'Longsleeve Polo', 'Cardigan',
      'Plate', 'Leather',
    ],
    legs: ['Pants', 'Cuffed Pants', 'Long Pants', 'Fur Pants', 'Pantaloons', 'Shorts'],
    feet: ['Basic Boots', 'Basic Shoes', 'Revised Boots', 'Folded Rim Boots', 'Sara Shoes'],
    feetColor: ['black', 'brown', 'walnut', 'charcoal', 'leather', 'gray'],
    arms: { items: ['Gloves', 'Cuffs', 'Pauldrons', 'Lace Cuffs'], chance: 0.4 },
    weapon: {
      // Any weapon — costume contest contestants brought their own.
      items: [
        'Longsword', 'Arming Sword', 'Saber', 'Mace', 'Waraxe', 'Spear',
        'Dagger', 'Rapier', 'Scimitar',
        'Simple staff', 'Gnarled staff',
        'Recurve', 'Slingshot',
      ],
      chance: 0.8,
    },
    sometimesShield: 0.2,
  },

  // ─────────────────────────────────────────────────────────────────────
  // Light Party event classes (FFXIV trinity: T / H / D / D)
  // ─────────────────────────────────────────────────────────────────────

  // Paladin — Light Party tank. Heavy plate + always-shield silhouette
  // (knight foundation), but with a tighter "noble holy knight" palette:
  // always-armored arms + always-helm + always-shield + gold/silver metal
  // trim + blue-tone cloth. Reads instantly as a tank when standing beside
  // the white_mage / samurai / black_mage in the diamond formation.
  paladin: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Plate'],
    legs: ['Hose', 'Long Pants', 'Cuffed Pants'],
    feet: ['Plated Toe', 'Thick Plated Toe'],
    // Always-armored arms — paladins never have bare-arm variants.
    arms: { items: ['Pauldrons', 'Mantal', 'Epaulets', 'Gloves'], chance: 1.0 },
    // Tall, noble closed helms only — no pigface visors / kettle helms;
    // those read as common infantry. Always wearing one.
    headwear: {
      items: [
        'Greathelm', 'Sugarloaf greathelm', 'Pointed helm', 'Norman helm',
        'Bascinet', 'Round bascinet', 'Armet', 'Simple Armet', 'Spangenhelm',
      ],
      chance: 1.0,
    },
    // Holy-knight palette — blue / regal / clean tones only. Drops the
    // muddier earth tones used by knight. (Palette names must match keys
    // in the LPC cloth_ulpc.json — see CLOTH list at top of bake script.)
    clothColorPool: ['navy', 'blue', 'bluegray', 'slate', 'white', 'sky', 'teal'],
    // Bright metal finishes only — paladin reads as gilded, not iron-clad.
    metalColorPool: ['gold', 'brass', 'silver', 'steel'],
    weapon: {
      items: ['Longsword', 'Arming Sword', 'Mace'],
      chance: 1.0,
    },
    alwaysShield: true,
  },

  // White Mage — Light Party healer. Robed silhouette with a tall headpiece
  // and a staff that pairs with a crystal (Diamond / Loop staff trigger the
  // CRYSTAL_RULE auto-pair). White / pink / lilac cloth so they read as
  // holy / healing rather than arcane / damage (vs black_mage).
  white_mage: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.15,
    torso: ['Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Buttoned', 'Longsleeve Polo'],
    legs: ['Long Pants', 'Hose'],
    feet: ['Slippers', 'Sandals'],
    arms: { items: ['Lace Cuffs', 'Cuffs'], chance: 0.7 },
    // Tall pointed headpiece OR holy tiara/hood. Always wearing something
    // so the silhouette reads as "robed caster, not commoner".
    headwear: {
      items: [
        'Wizard Hat Base', 'Wizard Hat Belt', 'Wizard Hat Buckle',
        'Celestial Wizard Hat', 'Celestial Wizard Hat Second Color',
        'Tiara', 'Crown', 'Hood',
      ],
      chance: 1.0,
    },
    // Holy / soft palette — whites, pinks, pale blues, lavender. NO darks
    // (those go to black_mage / necromancer). Palette names must match keys
    // in the LPC cloth_ulpc.json — see CLOTH list at top of bake script.
    clothColorPool: ['white', 'pink', 'rose', 'sky', 'lavender'],
    // Crystal-pair staves only — Diamond / Loop staff trigger the
    // CRYSTAL_RULE in the bake (auto-adds a glowing crystal to the staff).
    weapon: {
      items: ['Diamond staff', 'Loop staff'],
      chance: 1.0,
    },
  },

  // Samurai — Light Party melee DPS. Light lamellar / robed silhouette
  // (no plate, no closed helm), tabi socks, headband, single curved blade.
  // Saber is the LPC katana proxy — actual Katana / Scimitar ship only as
  // 128px oversize art that renders invisible in the 64px base sheet
  // (same gotcha that shadow_monarch's comment documents below).
  samurai: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.5,
    // Robed / light-armor torsos. Leather mixed in for the lamellar feel.
    torso: ['Longsleeve', 'Longsleeve 2', 'Shortsleeve', 'Leather', 'Longsleeve Polo'],
    legs: ['Pantaloons', 'Long Pants', 'Hose'],
    // Tabi + sandals — the iconic samurai footwear.
    feet: ['Tabi Socks', 'Sandals'],
    arms: { items: ['Cuffs', 'Gloves'], chance: 0.5 },
    // Headband / bandana / hair tie — no helmet. Sometimes bare-headed.
    headwear: {
      items: [
        'Bandana', 'Tied Headband', 'Thick Headband', 'Thick Headband Rune',
        'Hair Tie', 'Hair Tie Rune',
      ],
      chance: 0.6,
    },
    // Sober samurai palette — dark reds, blacks, deep blues. No bright
    // / pastel tones (those belong to white_mage / paladin).
    clothColorPool: ['maroon', 'navy', 'black', 'forest', 'charcoal', 'walnut'],
    metalColorPool: ['steel', 'iron', 'silver'],
    // Saber is the working katana proxy — see header comment + the
    // shadow_monarch entry's weapon comment for the LPC gotcha.
    weapon: {
      items: ['Saber'],
      chance: 1.0,
    },
  },

  // Black Mage — Light Party ranged DPS. The iconic tall pointed wizard
  // hat is mandatory — that hat IS the silhouette. Dark robes, staff with
  // crystal. Foil to white_mage (light/holy) — same robed shape, opposite
  // palette, opposite role.
  black_mage: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Longsleeve 2', 'Longsleeve', 'Longsleeve 2 Buttoned', 'Longsleeve 2 Scoop'],
    legs: ['Long Pants', 'Hose'],
    feet: ['Slippers', 'Sandals'],
    arms: { items: ['Cuffs', 'Stud Ring'], chance: 0.4 },
    // Mandatory tall wizard hat — the black mage silhouette. No tiaras
    // or hoods; those go to white_mage / necromancer.
    headwear: {
      items: [
        'Wizard Hat Base', 'Wizard Hat Belt', 'Wizard Hat Buckle',
        'Celestial Wizard Hat', 'Celestial Wizard Hat Second Color',
        'Celestial Wizard Moon Hat', 'Celestial Wizard Moon Hat Second Color',
      ],
      chance: 1.0,
    },
    // Dark mage palette — black / purple / midnight. Foil to white_mage.
    clothColorPool: ['black', 'charcoal', 'navy', 'purple', 'maroon', 'slate'],
    weapon: {
      items: ['S staff', 'Diamond staff', 'Gnarled staff', 'Loop staff'],
      chance: 1.0,
    },
  },
};

// ============================================================
// Cheater — maximum-chaos pool. The whole point of this class is
// "looks like a modded client with every cosmetic toggled on at once."
// We deliberately let the sampler pick combinations that read as wrong:
//   • mixed armor + civilian torso/legs/feet (Plate + Pantaloons + Tabi
//     Socks; Sleeveless + Striped Formal Pants + Plated Toe; etc.)
//   • bizarre headwear range — armored helms beside Christmas Hat,
//     Wizard Hat, Tophat, Crown, Bicorne, Pirate Bandana, Eyepatches,
//     Plain Mask, even Hijab. Forced 1.0 chance so every cheater wears
//     SOMETHING on their head.
//   • weapon chaos — every weapon LPC ships: swords, daggers, staves,
//     scythe, flail, katana, glowsword, cane, plus all four bow types
//     and crossbow + slingshot. Driven by the same `weapon` field every
//     other class uses; AdventurerRenderer's variant→attackRange sync
//     reads the source-class range so a Mage-staff cheater attacks at
//     range 4, a bow-cheater at the appropriate ranged range.
//   • mandatory multi-accessory roll: 2–4 picks per variant from the
//     full wings + tails + gems + necklaces + scarves + bowties pool.
//     Forces the "weighed down with hacks" silhouette every spawn.
//   • sometimesShield 0.4 — random shield on ~40% of cheaters layered
//     on top of whatever weapon they're already holding.
// Fantasy body palettes (blue / bright_green / dark_green skin) are
// rolled at 30% in bake-lpc-variants.mjs for cheaters — Twitch Streamer
// is the only other class that can pull fantasy skin (15%).
POOLS.cheater = {
  bodyTypes: COMMON.bodyTypes,
  heads: 'auto_human',
  hair: 'all_human_hair',
  beardChance: 0.4,
  // EVERY cheater wields a glowing blade — the "lightsaber mod" (user). The
  // Glowsword ships only blue/red, so we mix them per-variant (locked, no
  // flicker) for a blue/red split instead of 50 identical blades.
  weapon: { items: ['Glowsword'], chance: 1.0 },
  weaponColor: ['blue', 'red'],
  // ── 50 / 50 MODE SPLIT (user) ────────────────────────────────────────
  // Half the cheaters are MAXED CHAOS (a modded client with every cosmetic
  // toggled on — impossible armor/civvie combos, a random helm/hat, stacked
  // wings+tails+bling), the other half are obvious HACKERS (modded fantasy
  // skin, god-mode gold crown, fly-hack wings, neon-RGB gear, an OP glowing
  // blade). The baker rolls one mode and merges its slots over this shared
  // head/hair/beard base (see `modes` handling in sampleVariant). Every
  // colour-variant cosmetic is colour-LOCKED per group so nothing flickers,
  // and all floating plume-/overlay-only headwear has been removed.
  modes: [
    {
      // ───────── MAXED CHAOS ─────────
      name: 'chaos',
      weight: 0.5,
      // Mix every silhouette — plate/mail armor next to civvies next to
      // monk-bare next to overalls/apron/bandages (previously-unused pieces).
      torso: [
        'Plate', 'Leather', 'Chainmail',
        'TShirt', 'TShirt Buttoned', 'TShirt Scoop', 'TShirt VNeck',
        'Shortsleeve', 'Shortsleeve Polo', 'Shortsleeve Cardigan',
        'Longsleeve', 'Longsleeve 2', 'Longsleeve Polo', 'Cardigan',
        'Tunic', 'Vest', 'Overalls', 'Suspenders', 'Apron', 'Bandages',
        'Obi', 'Original Sleeveless', 'Sleeveless 2',
      ],
      // Cloth tops/bottoms pull from the standard 24-colour set every variant
      // sheet ships → no flicker; legs roll their OWN colour (legsColor) so the
      // pants never match the shirt (user).
      clothColorPool: ['black', 'blue', 'bluegray', 'brown', 'charcoal', 'forest', 'gray', 'green', 'lavender', 'leather', 'maroon', 'navy', 'orange', 'pink', 'purple', 'red', 'rose', 'sky', 'slate', 'tan', 'teal', 'walnut', 'white', 'yellow'],
      legs: [
        'Pants', 'Cuffed Pants', 'Long Pants', 'Pantaloons', 'Hose',
        'Shorts', 'Short Shorts', 'Fur Pants', 'Striped Formal Pants',
        'Formal Pants', 'Wide pants', 'Armour',
      ],
      legsColor: ['black', 'charcoal', 'gray', 'navy', 'slate', 'brown', 'walnut', 'maroon', 'forest', 'tan'],
      feet: [
        // Plate boots next to sandals next to tabi socks — peak desync.
        'Plated Toe', 'Thick Plated Toe', 'Basic Boots', 'Folded Rim Boots',
        'Revised Boots', 'Basic Shoes', 'Revised Shoes', 'Sara Shoes',
        'Slippers', 'Sandals', 'Ghillies', 'Tabi Socks',
      ],
      arms: { items: ['Pauldrons', 'Epaulets', 'Mantal', 'Gloves', 'Cuffs', 'Lace Cuffs'], chance: 0.85 },
      // A belt over whatever they're wearing (user) — leather tones.
      torsoOverlay: { items: ['Leather Belt', 'Double Belt', 'Loose Belt'], chance: 0.7 },
      torsoOverlayColor: ['brown', 'charcoal', 'walnut', 'leather', 'tan', 'slate'],
      // Forced 1.0 — every chaos cheater wears SOMETHING. Only COMPLETE pieces
      // (the plume-only Cavalier/Bonnie/Leather Cap Feather, Skull Bandana
      // Overlay, Wizard Hat Belt/Buckle band, and helm-visor overlays were
      // dropped — they float with no base). Metal helms recolor via metalColor;
      // the cloth/civvie hats are colour-variant and ALL share the dark set
      // below, so headwearColor locks them flicker-free.
      headwear: {
        items: [
          'Greathelm', 'Close helm', 'Norman helm', 'Bascinet', 'Pointed helm',
          'Spangenhelm', 'Kettle helm', 'Morion', 'Armet', 'Barbuta', 'Maximus', 'Mail',
          'Barbarian', 'Barbarian nasal', 'Horned helmet', 'Viking spangenhelm',
          'Wizard Hat Base', 'Formal Tophat', 'Christmas Hat', 'Crown', 'Tiara',
          'Hijab', 'Tricorne', 'Bicorne Athwart', 'Leather Cap', 'Bonnie',
          'Large Hat', 'Kerchief',
          'Hood', 'Sack Cloth Hood', 'Bandana', 'Bordered Bandana', 'Pirate Bandana',
          'Eyepatch Left', 'Eyepatch Right', 'Plain Mask',
        ],
        chance: 1.0,
      },
      headwearColor: ['black', 'brown', 'charcoal', 'forest', 'gray', 'maroon', 'navy'],
      // Stacked cosmetics — each group rolled independently + colour-LOCKED
      // (no flicker). 0–5 piled on → the "weighed down with hacks" silhouette.
      // Adds previously-unused neckwear (cravat/jabot/necktie) + gem amulets.
      accessory: [
        { items: ['Bat Wings', 'Feathered Wings', 'Lizard Wings (Alt Colors)'], chance: 0.5, color: ['red', 'blue', 'green', 'purple', 'orange', 'pink', 'navy'] },
        { items: ['Cat Tail', 'Wolf Tail', 'Fluffy Wolf Tail', 'Lizard Tail (Alt Colors)'], chance: 0.5, color: ['red', 'blue', 'green', 'purple', 'orange', 'pink', 'navy'] },
        { items: ['Chain Necklace', 'Large Beaded Necklace', 'Small Beaded Necklace'], chance: 0.4, color: ['gold', 'silver', 'brass'] },
        { items: ['Dangling amulet', 'Star amulet'], chance: 0.3, color: ['gold_red', 'gold_purple', 'silver_blue', 'silver_green', 'bronze_orange'] },
        { items: ['Cravat', 'Jabot', 'Necktie'], chance: 0.3, color: ['red', 'blue', 'purple', 'navy', 'maroon', 'white'] },
        { items: ['Scarf', 'Bowtie', 'Bowtie 2'], chance: 0.3, color: ['red', 'blue', 'green', 'purple', 'navy', 'maroon'] },
      ],
      metalColorPool: ['iron', 'steel', 'gold', 'silver', 'bronze'],
      sometimesShield: 0.4, // shield ON TOP of a glowsword — peak desync
    },
    {
      // ───────── HACKER ─────────
      name: 'hacker',
      weight: 0.5,
      // Modded skin on EVERY hacker — impossible blue / bright-green / dark-green
      // body. The single clearest "this is a cheat client" tell.
      bodyColorPool: ['blue', 'bright_green', 'dark_green'],
      // Neon-RGB gear: gold god-plate + glowing tanktops/tees.
      torso: ['Plate', 'Tanktop', 'Tanktop', 'TShirt', 'TShirt VNeck', 'Longsleeve', 'Sleeveless 2'],
      clothColorPool: ['red', 'blue', 'sky', 'purple', 'pink', 'teal', 'green', 'orange', 'rose'],
      legs: ['Pants', 'Long Pants', 'Shorts', 'Hose'],
      legsColor: ['black', 'charcoal', 'navy', 'slate'], // dark legs → neon top pops
      feet: ['Basic Boots', 'Plated Toe', 'Basic Shoes', 'Revised Shoes'],
      feetColor: ['white', 'black', 'red', 'blue', 'gray'],
      arms: { items: ['Pauldrons', 'Gloves'], chance: 0.5 },
      // Flashy "donator" cape — solid bright cloak draped behind (previously
      // unused; a proper 2-layer cape) in a vivid colour.
      cape: { items: ['Solid'], chance: 0.45 },
      capeColor: ['purple', 'red', 'blue', 'sky', 'teal', 'yellow', 'rose', 'orange'],
      // A belt over the gear (user) — leather tones.
      torsoOverlay: { items: ['Leather Belt', 'Double Belt', 'Loose Belt'], chance: 0.7 },
      torsoOverlayColor: ['brown', 'charcoal', 'walnut', 'leather', 'tan', 'slate'],
      // God-mode gold crowns (Crown/Tiara both ship 'gold').
      headwear: { items: ['Crown', 'Crown', 'Tiara'], chance: 0.85 },
      headwearColor: ['gold'],
      // Fly-hack wings (most) + a literal modded JETPACK on some + max gold
      // bling + cool shades.
      accessory: [
        { items: ['Feathered Wings', 'Bat Wings', 'Lizard Wings (Alt Colors)'], chance: 0.75, color: ['gold', 'blonde', 'blue', 'green', 'black'] },
        { items: ['Jetpack'], chance: 0.3, color: ['gold', 'steel'] },
        { items: ['Chain Necklace', 'Large Beaded Necklace'], chance: 0.7, color: ['gold', 'gold', 'silver'] },
        { items: ['Shades', 'Sunglasses'], chance: 0.6, color: ['black', 'charcoal'] },
      ],
      metalColorPool: ['gold', 'gold', 'silver'],
      // Inherits the shared all-Glowsword weapon (blue/red blade) from the base.
      sometimesShield: 0.3,
    },
  ],
}

// ============================================================
// Templar — holy DEFENDER (normal-roster class, NOT the Light Party event
// `paladin`). A FULLY-ARMOURED crusader: every plate slot (cuirass / greaves /
// sabatons / shoulders / helm + visor) shares ONE blessed-metal finish so the
// whole suit MATCHES, drawn from the icy/holy LPC-Revised metals (white, revised
// silver, pearl, lavender, ice, steel, revised gold). A full-face helm+visor, a
// flowing solid cape (some trimmed), a fixed crusader/plus heraldic shield, and
// a cross amulet. Reads distinct from the generic Knight (matched holy metal +
// full visor + crusader shield) and the FFXIV event Paladin. Always helmeted, so
// men carry the face under the visor and women wear long back hair below the rim.
POOLS.templar = {
  bodyTypes: COMMON.bodyTypes,
  bodyTypeWeights: { male: 4, muscular: 4, female: 2 }, // heavy defender → lean male/muscular
  heads: 'auto_human',
  hair: { male: [], muscular: [], female: HELMET_SAFE_HAIR_LONG },
  beardChance: 0.6,
  // FULLY ARMOURED — every body slot is plate; all metal pieces share v.metalColor
  // so the suit matches (cuirass + greaves + sabatons).
  torso: ['Plate'],
  legs: ['legs:Armour'],
  feet: ['feet:Armour'],
  // FULL plate ARMS (arms:Armour, metal → matches the suit) so the forearms are
  // never bare, + metal GAUNTLETS over the hands.
  arms: ['arms:Armour'],
  hands: { items: ['Gloves'], chance: 1.0 },
  // Shoulder piece layered on top of the plate arm (always one): metal Legion
  // segments + pauldrons / epaulets / shoulder-mantle.
  shoulder: { items: ['arms:Legion', 'Epaulets', 'Mantal', 'Pauldrons'], chance: 1.0 },
  // Always helmeted — armets / greathelm / xeon / flattop.
  headwear: {
    items: ['Armet', 'Simple Armet', 'Xeon helmet', 'Greathelm', 'Flattop'],
    chance: 1.0,
  },
  // Visor on the open-faced helms (Armet / Simple Armet / Xeon), using the FULL
  // 9-visor set for variety. The Greathelm is already a closed full-face helm
  // and the Flattop is open-topped — neither takes a visor. Visors recolor to
  // metalColor → match the helm.
  visorChance: 1.0,
  visorOnAnyHelm: true,
  visorExcludeHelms: ['Flattop', 'Greathelm'],
  visors: [
    'Grated visor', 'Narrow grated visor', 'Horned visor', 'Pigface visor',
    'Pigface visor raised', 'Round visor', 'Round visor raised', 'Slit visor',
    'Narrow slit visor',
  ],
  // Blessed metal — the icy/holy LPC-Revised finishes; ALL plate pieces share it.
  metalColorPool: ['white', 'rev_silver', 'pearl', 'lavender', 'ice', 'steel', 'rev_gold'],
  // Pale holy cloth for the fabric shoulder pieces (harmonise with the metal).
  clothColorPool: ['white', 'white', 'lavender', 'sky', 'bluegray', 'gray'],
  // Always a flowing solid cape (in a holy hue); ~45% add a contrasting trim.
  cape: { items: ['Solid'], chance: 1.0 },
  capeColor: ['white', 'sky', 'lavender', 'blue', 'navy', 'red', 'purple', 'teal'],
  // Holy loadout — longsword / flail / mace (all one-handed → shield pairs).
  weapon: { items: ['Longsword', 'Flail', 'Mace'], chance: 1.0 },
  // Fixed heraldic shields — a crusader-cross face, or a plus-cross with the
  // two-engrailed trim border.
  alwaysShield: true,
  shieldTypes: ['crusader', 'plus'],
  // 50% stud ring · 50% cross amulet (ANY of its 48 colours) · ~45% cape trim.
  accessory: [
    { items: ['Stud Ring'], chance: 0.5 },
    {
      items: ['Cross amulet'], chance: 0.5,
      color: [
        'brass_blue', 'brass_green', 'brass_orange', 'brass_purple', 'brass_red', 'brass_yellow',
        'bronze_blue', 'bronze_green', 'bronze_orange', 'bronze_purple', 'bronze_red', 'bronze_yellow',
        'ceramic_blue', 'ceramic_green', 'ceramic_orange', 'ceramic_purple', 'ceramic_red', 'ceramic_yellow',
        'copper_blue', 'copper_green', 'copper_orange', 'copper_purple', 'copper_red', 'copper_yellow',
        'gold_blue', 'gold_green', 'gold_orange', 'gold_purple', 'gold_red', 'gold_yellow',
        'iron_blue', 'iron_green', 'iron_orange', 'iron_purple', 'iron_red', 'iron_yellow',
        'silver_blue', 'silver_green', 'silver_orange', 'silver_purple', 'silver_red', 'silver_yellow',
        'steel_blue', 'steel_green', 'steel_orange', 'steel_purple', 'steel_red', 'steel_yellow',
      ],
    },
    { items: ['Cape Trim'], chance: 0.45, color: ['white', 'yellow', 'gray', 'lavender'] },
  ],
}

// ============================================================
// Pirate — swashbuckler DUELIST (normal roster). A motley crew: mostly scruffy
// buccaneers (laced shirts / open vests + a bold waist sash, bandanas — some
// with the jolly-roger skull — eyepatches, chest bandoliers, hook hands &
// peg-legs) with the occasional fancy captain (tricorne/bicorne + skull, frock
// coat, a cape). Cutlass loadout (saber/scimitar/rapier — LPC ships no
// firearms). Fast + hard-hitting + medium HP. Mechanics (grog rage + plunder)
// live in code, keyed on classId 'pirate'.
POOLS.pirate = {
  bodyTypes: COMMON.bodyTypes,
  bodyTypeWeights: { male: 4, muscular: 2, female: 2 },
  heads: 'auto_human',
  hair: 'all_human_hair',
  beardChance: 0.6,
  // Motley crew — buccaneer shirts/vests + the occasional captain frock coat.
  torso: [
    'Longsleeve laced', 'Longsleeve laced', 'Vest open', 'Shortsleeve',
    'Longsleeve', 'Sleeveless 2', 'TShirt Scoop',
    'Frock coat', // captain
  ],
  clothColorPool: ['red', 'white', 'navy', 'blue', 'black', 'teal', 'maroon', 'forest', 'brown', 'charcoal'],
  // Every pirate wears a belt (belly / loose / double) — leather tones only.
  torsoOverlay: { items: ['Belly belt', 'Loose Belt', 'Double Belt'], chance: 1.0 },
  torsoOverlayColor: ['brown', 'charcoal', 'walnut', 'leather', 'tan', 'slate'],
  legs: ['Pants', 'Cuffed Pants', 'Pantaloons', 'Long Pants'],
  legsColor: ['black', 'charcoal', 'navy', 'brown', 'walnut', 'slate', 'maroon'],
  feet: ['Folded Rim Boots', 'Rimmed Boots', 'Basic Boots', 'Revised Boots'],
  feetColor: ['black', 'brown', 'walnut', 'leather', 'charcoal'],
  arms: { items: ['Cuffs', 'Lace Cuffs', 'Gloves'], chance: 0.4 },
  // Motley headwear — bandanas (deckhands, common) + tricorne/bicorne officers.
  // Hat BASE favours black/brown (weighted) but keeps colour variety so the
  // bandanas can be any hue (per "favour black & brown hats, bandanas any colour").
  headwear: {
    items: [
      'Pirate Bandana', 'Pirate Bandana', 'Pirate Bandana',
      'Tricorne Captain', 'Tricorne Captain', 'Tricorne Lieutenant',
      'Bicorne Athwart', 'Bicorne Athwart', 'Bicorne Athwart Admiral',
    ],
    chance: 0.9,
  },
  headwearColor: ['black', 'black', 'black', 'brown', 'brown', 'brown', 'charcoal', 'walnut', 'navy', 'maroon', 'forest', 'red', 'teal', 'white'],
  // Skull / trim / cockade overlays. Skulls favour WHITE (other colours too);
  // trims + cockades use any colour (gold/silver naval trim). Multiple rules can
  // fire on one hat → "skull and/or trim". (when[] matches the rolled headwear.)
  headOverlay: [
    { when: ['Pirate Bandana'], items: ['Skull Bandana Overlay'], chance: 0.6, color: ['white', 'white', 'white', 'black', 'red', 'yellow', 'navy'] },
    { when: ['Tricorne Captain'], items: ['Tricorne Captain Skull'], chance: 0.55, color: ['white', 'white', 'white', 'black', 'red', 'yellow'] },
    { when: ['Tricorne Captain'], items: ['Tricorne Captain Trim'], chance: 0.5, color: ['gold', 'silver', 'red', 'navy', 'maroon', 'white', 'yellow'] },
    { when: ['Tricorne Lieutenant'], items: ['Tricorne Lieutenant Trim'], chance: 0.5, color: ['gold', 'silver', 'red', 'navy', 'maroon', 'white'] },
    { when: ['Bicorne Athwart'], items: ['Bicorne Athwart Skull', 'Bicorne Athwart Captain Skull'], chance: 0.6, color: ['white', 'white', 'white', 'black', 'red', 'yellow'] },
    { when: ['Bicorne Athwart Admiral'], items: ['Bicorne Athwart Admiral Cockade'], chance: 0.65, color: ['gold', 'red', 'navy', 'white', 'black', 'yellow'] },
    { when: ['Bicorne Athwart Admiral'], items: ['Bicorne Athwart Admiral Trim'], chance: 0.6, color: ['gold', 'silver', 'red', 'navy', 'maroon', 'white'] },
  ],
  // Grizzled extras — eyepatch, chest bandolier, hook hand, peg leg.
  accessory: [
    { items: ['Eyepatch Left', 'Eyepatch Right', 'Eyepatch 2 Left', 'Eyepatch 2 Right'], chance: 0.45, color: ['black'] },
    { items: ['Straps'], chance: 0.6, color: ['brown', 'leather', 'walnut', 'charcoal', 'black'] },
    { items: ['Hook hand'], chance: 0.22 },
    { items: ['Peg leg'], chance: 0.18 },
  ],
  metalColorPool: ['iron', 'steel', 'brass', 'bronze', 'gold'],
  // Most wield rapier or scimitar; some sabers + daggers. (Scimitar swings via
  // its slash_128 oversize → the _atk sheet; Dagger uses the contained base slash.)
  weapon: { items: ['Rapier', 'Rapier', 'Rapier', 'Scimitar', 'Scimitar', 'Scimitar', 'Saber', 'Dagger'], chance: 1.0 },
  // Captain's cape on some officers.
  cape: { items: ['Solid'], chance: 0.25 },
  capeColor: ['red', 'navy', 'maroon', 'black', 'teal', 'forest'],
}

// ============================================================
// Shadow Monarch — Sung Jinwoo (Solo Leveling event). A NAMED character,
// so every slot is locked to one option + every palette is pinned: the
// bake is deterministic (one variant = the canonical Jinwoo look).
//   • black spiky hair, light skin
//   • black trench coat + black long pants + black shoes (clothColorPool black)
//   • a single steel scimitar (dual-wield isn't an LPC layer)
// Bake with: node tools/bake-lpc-variants.mjs "<lpc-root>" assets/sprites/adventurers 1 shadow_monarch
// (Hair swap candidates if "Spiked2" reads wrong: Messy2, Messy3, Cowlick,
//  Bedhead, Unkempt, Halfmessy.)
POOLS.shadow_monarch = {
  bodyTypes:     ['male'],
  heads:         ['Human Male'],
  hair:          ['Spiked2'],
  hairColorPool: ['black'],
  bodyColorPool: ['light'],
  clothColorPool:['charcoal'],
  feetColor:     'black',     // black shoes (rest of outfit is charcoal)
  metalColorPool:['steel'],
  beardChance:   0,
  noses:         null,        // no nose overlay
  torso:         ['Frock coat'],
  legs:          ['Long Pants'],
  feet:          ['Basic Shoes'],
  // Saber, not Scimitar: the scimitar (and katana) ship ONLY oversize 128px
  // art that can't composite into the 64px base sheet, so it rendered
  // invisible. The saber is a curved single-edged blade (visually ~a
  // scimitar) that DOES ship standard 64px walk/slash art, so it actually
  // shows in-hand.
  weapon: {
    items: ['Saber'],
    chance: 1.0,
  },
}

// Per-class variant count for the bake (default when no count arg is passed).
// 100 is the shipped count for the 15 redesigned adventurer classes. The
// named/event classes are always baked with an EXPLICIT count (shadow_monarch
// 1; Light Party paladin/white_mage/samurai/black_mage 50), so this default
// only applies to a no-arg full bake.
export const VARIANT_COUNT = 100;
