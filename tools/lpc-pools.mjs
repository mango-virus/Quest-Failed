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

// Crystal pairs ONLY with Diamond staff and Loop staff.
const STAFF_WITH_CRYSTAL = new Set(['Diamond staff', 'Loop staff']);
const CRYSTAL_COLORS = ['blue', 'orange', 'green', 'purple', 'red', 'yellow', 'white'];
export const CRYSTAL_RULE = { staves: STAFF_WITH_CRYSTAL, colors: CRYSTAL_COLORS };

export const POOLS = {
  knight: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Plate'],
    legs: ['Hose', 'Cuffed Pants', 'Long Pants'],
    feet: ['Plated Toe', 'Thick Plated Toe', 'Basic Boots', 'Folded Rim Boots', 'Revised Boots', 'Rimmed Boots'],
    arms: { items: ['Pauldrons', 'Epaulets', 'Mantal', 'Gloves'], chance: 0.85 },
    headwear: {
      // Excluded: Crest / Plumage / Centurion Crest / Centurion Plumage /
      // Helmet wings — these are decoration accessories that need a base helm.
      items: [
        'Greathelm', 'Close helm', 'Norman helm', 'Bascinet', 'Round bascinet',
        'Pointed helm', 'Sugarloaf greathelm', 'Spangenhelm',
        'Pigface bascinet', 'Pigface visor', 'Maximus', 'Mail',
        'Armet', 'Simple Armet', 'Barbuta', 'Simple barbuta', 'Kettle helm',
        'Morion',
      ],
      chance: 1.0,
    },
    weapon: {
      items: ['Longsword', 'Arming Sword', 'Saber', 'Mace', 'Waraxe', 'Halberd', 'Spear'],
      chance: 1.0,
    },
    alwaysShield: true,
  },

  rogue: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.15,
    torso: ['TShirt', 'TShirt Buttoned', 'TShirt Scoop', 'TShirt VNeck', 'Shortsleeve', 'Shortsleeve Polo', 'Longsleeve', 'Longsleeve 2'],
    legs: ['Pants', 'Cuffed Pants'],
    feet: ['Basic Shoes', 'Revised Shoes', 'Sara Shoes', 'Ghillies', 'Ankle Socks', 'Slippers'],
    arms: { items: ['Gloves', 'Cuffs', 'Lace Cuffs', 'Stud Ring'], chance: 0.5 },
    headwear: {
      items: [
        'Hood', 'Bandana', 'Bordered Bandana', 'Pirate Bandana',
        'Skull Bandana Overlay', 'Sack Cloth Hood',
        'Eyepatch Left', 'Eyepatch Right', 'Eyepatch Ambidextrous',
        'Plain Mask',
      ],
      chance: 0.7,
    },
    weapon: {
      items: ['Dagger', 'Rapier', 'Scimitar', 'Saber'],
      chance: 1.0,
    },
  },

  mage: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.45, // wizards are bearded often
    torso: ['Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Scoop', 'Longsleeve 2 Buttoned', 'Longsleeve 2 VNeck'],
    legs: ['Long Pants', 'Hose'],
    feet: ['Slippers', 'Sandals', 'Basic Shoes'],
    arms: { items: ['Lace Cuffs', 'Cuffs'], chance: 0.4 },
    headwear: {
      items: [
        'Wizard Hat Base', 'Wizard Hat Belt', 'Wizard Hat Buckle',
        'Celestial Wizard Hat', 'Celestial Wizard Hat Second Color',
        'Celestial Wizard Moon Hat', 'Celestial Wizard Moon Hat Second Color',
        'Hood',
      ],
      chance: 0.95, // mages almost always have headwear
    },
    weapon: {
      items: ['Simple staff', 'Gnarled staff', 'Diamond staff', 'Loop staff', 'S staff'],
      chance: 1.0,
    },
  },

  cleric: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.3,
    torso: ['Longsleeve Polo', 'Longsleeve 2 VNeck', 'Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Buttoned', 'Longsleeve 2 Scoop'],
    legs: ['Long Pants', 'Hose', 'Pantaloons'],
    feet: ['Sandals', 'Basic Shoes', 'Revised Shoes', 'Slippers'],
    arms: { items: ['Cuffs', 'Gloves'], chance: 0.3 },
    headwear: {
      items: ['Hood', 'Sack Cloth Hood', 'Tiara', 'Crown', 'Hijab'],
      chance: 0.6,
    },
    weapon: {
      items: ['Mace', 'Loop staff', 'Simple staff'],
      chance: 1.0,
    },
  },

  necromancer: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Longsleeve 2', 'Longsleeve', 'Longsleeve 2 Buttoned', 'Longsleeve 2 Scoop', 'Longsleeve 2 VNeck'],
    legs: ['Long Pants', 'Hose'],
    feet: ['Slippers', 'Sandals'],
    arms: { items: ['Stud Ring', 'Gloves'], chance: 0.3 },
    headwear: {
      items: ['Sack Cloth Hood', 'Hood', 'Skull Bandana Overlay'],
      chance: 0.95,
    },
    // Dark / sinister cloth palette only (12 of 24 cloth options).
    clothColorPool: ['brown', 'leather', 'walnut', 'maroon', 'purple', 'navy', 'forest', 'slate', 'gray', 'black', 'charcoal', 'bluegray'],
    weapon: {
      items: ['Scythe', 'Gnarled staff', 'S staff', 'Loop staff'],
      chance: 1.0,
    },
  },

  ranger: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.35,
    torso: ['Shortsleeve', 'Shortsleeve Polo', 'Longsleeve', 'Longsleeve 2', 'TShirt', 'TShirt Buttoned'],
    legs: ['Long Pants', 'Cuffed Pants', 'Pants'],
    feet: ['Basic Boots', 'Folded Rim Boots', 'Revised Boots', 'Ghillies'],
    arms: { items: ['Cuffs', 'Gloves'], chance: 0.4 },
    headwear: {
      items: ['Leather Cap', 'Leather Cap Feather', 'Bonnie', 'Bonnie feather', 'Hood', 'Bordered Bandana'],
      chance: 0.7,
    },
    weapon: {
      items: ['Normal', 'Great', 'Recurve', 'Crossbow', 'Slingshot'],
      chance: 1.0,
    },
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
  bounty_hunter: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.45,
    torso: ['Leather', 'Longsleeve 2', 'Longsleeve'],
    legs: ['Long Pants', 'Cuffed Pants', 'Pants'],
    feet: ['Basic Boots', 'Folded Rim Boots', 'Revised Boots'],
    arms: { items: ['Pauldrons', 'Gloves', 'Cuffs'], chance: 0.8 },
    headwear: {
      items: ['Hood', 'Leather Cap', 'Leather Cap Feather', 'Bonnie', 'Bordered Bandana', 'Tricorne'],
      chance: 0.9,
    },
    // Signature look — every bounty hunter wears sunglasses + a scarf.
    // pickCount 2 over a 2-item pool at chance 1.0 forces BOTH onto every
    // variant (the sampler dedups picks, so it always lands on the full set).
    accessory: {
      items: ['Sunglasses', 'Scarf'],
      pickCount: { min: 2, max: 2 },
      chance: 1.0,
    },
    // Dark, earthy, professional — a subset of the proven cloth palette.
    clothColorPool: ['brown', 'leather', 'walnut', 'slate', 'gray', 'charcoal', 'black', 'navy', 'forest', 'maroon', 'bluegray'],
    weapon: {
      items: ['Crossbow'],
      chance: 1.0,
    },
  },

  twitch_streamer: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.25,
    torso: [
      'TShirt', 'TShirt Buttoned', 'TShirt Scoop', 'TShirt VNeck',
      'Shortsleeve Polo', 'Cardigan', 'Shortsleeve Cardigan',
      'Longsleeve', 'Longsleeve 2', 'Longsleeve Polo',
    ],
    legs: ['Pants', 'Cuffed Pants', 'Long Pants', 'Shorts', 'Short Shorts', 'Pantaloons', 'Striped Formal Pants'],
    feet: ['Basic Shoes', 'Revised Shoes', 'Sara Shoes', 'Slippers', 'Basic Boots'],
    arms: { items: ['Gloves', 'Cuffs', 'Lace Cuffs', 'Stud Ring'], chance: 0.4 },
    headwear: {
      items: [
        'Sunglasses', 'Shades', 'Round Glasses', 'Nerd Glasses', 'Halfmoon Glasses',
        'Pirate Bandana', 'Bandana', 'Crown', 'Tricorne', 'Tricorne Captain',
        'Hood', 'Cavalier feather', 'Christmas Hat', 'Formal Tophat',
        'Wizard Hat Base', 'Greathelm', 'Pirate Bandana',
      ],
      chance: 0.85,
    },
    accessory: {
      // chaos accessories — wings + tails (full anim) and necklaces/charms (vanish on run)
      // Amulets removed per user request.
      items: [
        // wings
        'Bat Wings', 'Feathered Wings', 'Lizard Wings', 'Lizard Wings (Alt Colors)', 'Batlike Lizard Wings',
        // tails
        'Cat Tail', 'Wolf Tail', 'Fluffy Wolf Tail', 'Lizard tail', 'Lizard Tail (Alt Colors)',
        // charms / gems / necklaces
        'Box Charm', 'Oval Charm', 'Ring Charm', 'Star Charm',
        'Emerald cut Gem', 'Marquise cut Gem', 'Natural cut Gem', 'Pear cut Gem',
        'Pearl Gem', 'Princess cut Gem', 'Round cut Gem', 'Trilliant cut Gem',
        'Necklace', 'Large Beaded Necklace', 'Small Beaded Necklace', 'Chain Necklace', 'Simple Necklace',
        'Scarf', 'Bowtie', 'Bowtie 2',
      ],
      // chaos: each variant gets 1-3 random accessories
      pickCount: { min: 1, max: 3 },
      chance: 1.0,
    },
    weapon: {
      // any weapon — chaos
      items: [
        'Longsword', 'Arming Sword', 'Saber', 'Mace', 'Waraxe', 'Halberd', 'Spear',
        'Dagger', 'Rapier', 'Scimitar',
        'Simple staff', 'Gnarled staff', 'Diamond staff', 'Loop staff', 'S staff',
        'Scythe', 'Cane', 'Flail', 'Katana', 'Glowsword',
        'Normal', 'Great', 'Recurve', 'Crossbow', 'Slingshot',
      ],
      chance: 0.9,
    },
    sometimesShield: 0.2, // 20% of streamers also have a shield (chaos)
  },

  beast_master: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Shortsleeve', 'Shortsleeve Polo', 'Longsleeve', 'Longsleeve 2', 'TShirt', 'TShirt Buttoned'],
    legs: ['Pants', 'Long Pants', 'Cuffed Pants', 'Fur Pants'],
    feet: ['Basic Boots', 'Ghillies', 'Sandals'],
    arms: { items: ['Cuffs', 'Gloves'], chance: 0.4 },
    headwear: {
      items: ['Leather Cap', 'Leather Cap Feather', 'Bonnie', 'Hood', 'Bordered Bandana'],
      chance: 0.6,
    },
    weapon: {
      items: ['Spear', 'Halberd', 'Cane', 'Slingshot'],
      chance: 1.0,
    },
  },

  barbarian: {
    bodyTypes: ['male', 'muscular'], // barbarians lean muscular
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.7,
    // Female-bodied (none in pool today) and any future gentler variants would
    // get a TShirt-style shirt here. Male/muscular bodies pull from
    // shirtlessTorso for the iconic bare-chested barbarian look.
    torso: ['TShirt Buttoned', 'Shortsleeve'],
    shirtlessTorso: ['Original Sleeveless', 'Sleeveless 2', 'Sleeveless 2 Buttoned'],
    shirtlessFor: ['male', 'muscular'],
    legs: ['Fur Pants', 'Pantaloons', 'Hose', 'Pants'],
    feet: ['Basic Boots', 'Folded Rim Boots', 'Sandals'],
    arms: { items: ['Pauldrons', 'Mantal', 'Stud Ring'], chance: 0.6 },
    headwear: {
      // Excluded: Helmet wings / Upward Horns / Downward Horns / Short Horns /
      // Backwards Horns — these are decoration accessories that need a base helm.
      items: [
        'Barbarian', 'Barbarian nasal', 'Barbarian Viking',
        'Horned helmet', 'Horned visor', 'Viking spangenhelm',
      ],
      chance: 0.7, // some go bare-headed
    },
    weapon: {
      items: ['Waraxe', 'Mace', 'Flail', 'Halberd', 'Longsword', 'Spear'],
      chance: 1.0,
    },
  },

  monk: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.3,
    // Female monks get full shirts; male monks pull from shirtlessTorso for
    // the bare-chested obi look (the LPC obi alone leaves the chest exposed).
    torso: ['Longsleeve', 'Longsleeve 2', 'Shortsleeve', 'TShirt'],
    shirtlessTorso: ['Obi', 'Obi Knot Left', 'Obi Knot Right', 'Sleeveless 2', 'Original Sleeveless'],
    shirtlessFor: ['male', 'muscular'],
    legs: ['Pantaloons', 'Long Pants', 'Pants'],
    feet: ['Tabi Socks', 'Sandals', 'Slippers'],
    arms: { items: ['Cuffs'], chance: 0.2 },
    headwear: {
      items: ['Bandana', 'Tied Headband', 'Thick Headband', 'Thick Headband Rune', 'Hair Tie', 'Hair Tie Rune'],
      chance: 0.4, // many monks have shaved heads / nothing
    },
    barehanded: true, // user-locked: monks always bare-handed
  },

  bard: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.25,
    torso: ['Longsleeve 2 Buttoned', 'Cardigan', 'Shortsleeve Cardigan', 'Shortsleeve Polo', 'Longsleeve', 'Longsleeve 2', 'TShirt Buttoned', 'Longsleeve Polo'],
    legs: ['Cuffed Pants', 'Pantaloons', 'Striped Formal Pants', 'Formal Pants'],
    feet: ['Folded Rim Boots', 'Basic Shoes', 'Revised Shoes'],
    arms: { items: ['Cuffs', 'Lace Cuffs', 'Gloves'], chance: 0.6 },
    headwear: {
      items: [
        'Cavalier feather', 'Bonnie feather', 'Tricorne', 'Bicorne Athwart',
        'Leather Cap Feather', 'Hood', 'Tiara', 'Hijab',
      ],
      chance: 0.85,
    },
    accessory: {
      items: ['Scarf', 'Bowtie', 'Bowtie 2'],
      chance: 0.55,
    },
    // user-locked: ranged-only, no daggers/canes
    weapon: {
      items: ['Normal', 'Great', 'Recurve', 'Crossbow', 'Slingshot'],
      chance: 1.0,
    },
  },

  // Cartographer Scholar — Cartographer's Convention event spawn. Robed
  // researcher silhouette closer to mage / cleric than to a fighter:
  // long pants/shoes, no armor, hood or wizard hat sometimes, and
  // mandatory glasses (chance 1.0 on the headwear pool entry — the
  // visual tell the user asked for). Barehanded so they read as
  // "scientist, not soldier"; AISystem skips combat for them anyway.
  cartographer_scholar: {
    bodyTypes: COMMON.bodyTypes,
    heads: 'auto_human',
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Buttoned', 'Cardigan', 'Longsleeve Polo'],
    legs: ['Long Pants', 'Hose', 'Pantaloons'],
    feet: ['Slippers', 'Sandals', 'Basic Shoes', 'Revised Shoes'],
    arms: { items: ['Cuffs', 'Lace Cuffs'], chance: 0.5 },
    headwear: {
      items: [
        'Hood', 'Sack Cloth Hood',
        'Wizard Hat Base', 'Wizard Hat Belt', 'Wizard Hat Buckle',
      ],
      chance: 0.6,
    },
    accessory: {
      // Forced glasses on every variant — the iconic "scholar" tell.
      items: ['Round Glasses', 'Nerd Glasses', 'Halfmoon Glasses'],
      chance: 1.0,
    },
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
    // Heads must read instantly as "not a human" at 64×64. The trimmed
    // set keeps only clearly non-human silhouettes (snouts, beaks,
    // muzzles, animal ears, skulls, alien crania, jack-o-lantern). The
    // following were INTENTIONALLY EXCLUDED because they're humanoid
    // enough at game scale to look like a normal pale/green human:
    //   Vampire, Frankenstein, Zombie, Orc male/female, Goblin, Troll
    heads: {
      male: [
        'Boarman', 'Wolf male', 'Wartotaur', 'Minotaur',
        'Lizard male',
        'Pig', 'Sheep', 'Rabbit', 'Rat', 'Mouse',
        'Alien', 'Jack O Lantern', 'Skeleton',
      ],
      muscular: [
        'Boarman', 'Wolf male', 'Wartotaur', 'Minotaur',
        'Lizard male',
        'Pig', 'Sheep',
        'Alien', 'Jack O Lantern', 'Skeleton',
      ],
      female: [
        'Wolf female', 'Minotaur female',
        'Lizard female',
        'Boarman', 'Pig', 'Sheep', 'Rabbit', 'Rat', 'Mouse',
        'Alien', 'Jack O Lantern', 'Skeleton',
      ],
    },
    // No hair / beard / nose / eyebrows — every face layer (zPos 105+)
    // would composite on top of the monster head's built-in features
    // and break the illusion. The monster head sprite already has its
    // own eyes + snout / muzzle / beak art.
    hair: null,
    beardChance: 0,
    noses: null,
    eyebrows: null,
    torso: [
      'TShirt', 'TShirt Buttoned', 'TShirt Scoop', 'Shortsleeve', 'Shortsleeve Polo',
      'Longsleeve', 'Longsleeve 2', 'Longsleeve Polo', 'Cardigan',
      'Plate', 'Leather',
    ],
    legs: ['Pants', 'Cuffed Pants', 'Long Pants', 'Fur Pants', 'Pantaloons', 'Shorts'],
    feet: ['Basic Boots', 'Basic Shoes', 'Revised Boots', 'Folded Rim Boots', 'Sara Shoes'],
    arms: { items: ['Gloves', 'Cuffs', 'Pauldrons', 'Lace Cuffs'], chance: 0.4 },
    // Headwear chance lower than other classes because the monster head
    // IS the visual story. A helmet on a wolf face hides the joke.
    headwear: {
      items: [
        'Hood', 'Sack Cloth Hood', 'Bandana', 'Pirate Bandana',
        'Cavalier feather', 'Tricorne',
      ],
      chance: 0.25,
    },
    accessory: {
      // Wing / tail accessories layered on top of the monster head and
      // body for full creature silhouette. 1-2 picks per variant.
      items: [
        // wings — bat / feathered / lizard / batlike-lizard
        'Bat Wings', 'Feathered Wings', 'Lizard Wings', 'Lizard Wings (Alt Colors)', 'Batlike Lizard Wings',
        // tails — cat / wolf / fluffy wolf / lizard
        'Cat Tail', 'Wolf Tail', 'Fluffy Wolf Tail', 'Lizard tail', 'Lizard Tail (Alt Colors)',
      ],
      pickCount: { min: 1, max: 2 },
      chance: 1.0,
    },
    weapon: {
      // Any weapon — costume contest contestants brought their own.
      items: [
        'Longsword', 'Arming Sword', 'Saber', 'Mace', 'Waraxe', 'Spear',
        'Dagger', 'Rapier', 'Scimitar',
        'Simple staff', 'Gnarled staff',
        'Recurve', 'Slingshot',
      ],
      chance: 0.85,
    },
    sometimesShield: 0.25,
  },
};

// Per-class variant count for the bake.
export const VARIANT_COUNT = 50;
