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

export const COMMON = {
  bodyTypes: ['male', 'muscular', 'female'],
  humanHeads: [
    'Human Male', 'Human Female',
    'Human Male Plump', 'Human Male Gaunt', 'Human Male Small',
    'Human Male Elderly', 'Human Female Elderly', 'Human Female Small',
  ],
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
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Plate'],
    legs: ['Hose', 'Cuffed Pants', 'Long Pants'],
    feet: ['Plated Toe', 'Thick Plated Toe', 'Basic Boots', 'Folded Rim Boots', 'Revised Boots', 'Rimmed Boots'],
    arms: { items: ['Pauldrons', 'Epaulets', 'Mantal', 'Gloves'], chance: 0.85 },
    headwear: {
      items: [
        'Greathelm', 'Close helm', 'Norman helm', 'Bascinet', 'Round bascinet',
        'Pointed helm', 'Sugarloaf greathelm', 'Helmet wings', 'Spangenhelm',
        'Crest', 'Plumage', 'Centurion Crest', 'Centurion Plumage',
        'Pigface bascinet', 'Pigface visor', 'Maximus', 'Mail',
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
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.15,
    torso: ['TShirt', 'TShirt Buttoned', 'Sleeveless 2', 'Sleeveless 2 Buttoned', 'Shortsleeve', 'Shortsleeve Polo'],
    legs: ['Pants', 'Cuffed Pants', 'Shorts'],
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
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.45, // wizards are bearded often
    torso: ['Longsleeve', 'Longsleeve 2', 'Longsleeve 2 Scoop', 'Longsleeves 2 Overlay', 'Cuffed Longsleeves Overlay'],
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
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.3,
    torso: ['Longsleeve Polo', 'Longsleeve 2 VNeck', 'Cuffed Longsleeves Overlay', 'Sleeveless 2 Cardigan'],
    legs: ['Long Pants', 'Hose', 'Pantaloons'],
    feet: ['Sandals', 'Basic Shoes', 'Revised Shoes', 'Slippers'],
    arms: { items: ['Cuffs', 'Gloves'], chance: 0.3 },
    headwear: {
      items: ['Hood', 'Sack Cloth Hood', 'Tiara', 'Crown', 'Hijab'],
      chance: 0.6,
    },
    accessory: {
      items: ['Cross amulet', 'Dangling amulet', 'Spider amulet', 'Star amulet'],
      chance: 0.5,
    },
    weapon: {
      items: ['Mace', 'Loop staff', 'Simple staff'],
      chance: 1.0,
    },
  },

  necromancer: {
    bodyTypes: COMMON.bodyTypes,
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Longsleeves 2 Overlay', 'Cuffed Longsleeves Overlay', 'Longsleeve 2'],
    legs: ['Long Pants', 'Hose'],
    feet: ['Slippers', 'Sandals'],
    arms: { items: ['Stud Ring', 'Gloves'], chance: 0.3 },
    headwear: {
      items: ['Sack Cloth Hood', 'Hood', 'Skull Bandana Overlay'],
      chance: 0.95,
    },
    accessory: {
      items: ['Spider amulet', 'Star amulet'],
      chance: 0.5,
    },
    weapon: {
      items: ['Scythe', 'Gnarled staff', 'S staff', 'Loop staff'],
      chance: 1.0,
    },
  },

  ranger: {
    bodyTypes: COMMON.bodyTypes,
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.35,
    torso: ['Sleeveless 2', 'Shortsleeve', 'Cuffed Longsleeves Overlay', 'Suspenders'],
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

  twitch_streamer: {
    bodyTypes: COMMON.bodyTypes,
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.25,
    torso: [
      'TShirt', 'TShirt Buttoned', 'TShirt Scoop', 'TShirt VNeck',
      'Shortsleeve Polo', 'Cardigan', 'Shortsleeve Cardigan',
      'Longsleeve', 'Longsleeve 2', 'Cuffed Longsleeves Overlay',
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
      items: [
        // wings
        'Bat Wings', 'Feathered Wings', 'Lizard Wings', 'Lizard Wings (Alt Colors)', 'Batlike Lizard Wings',
        // tails
        'Cat Tail', 'Wolf Tail', 'Fluffy Wolf Tail', 'Lizard tail', 'Lizard Tail (Alt Colors)',
        // jewelry
        'Cross amulet', 'Dangling amulet', 'Spider amulet', 'Star amulet',
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
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.4,
    torso: ['Sleeveless 2', 'Shortsleeve', 'Suspenders', 'Cuffed Longsleeves Overlay'],
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
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.7,
    torso: ['Original Sleeveless', 'Sleeveless 2', 'Sleeveless 2 Buttoned'],
    legs: ['Fur Pants', 'Pantaloons', 'Hose', 'Pants'],
    feet: ['Basic Boots', 'Folded Rim Boots', 'Sandals'],
    arms: { items: ['Pauldrons', 'Mantal', 'Stud Ring'], chance: 0.6 },
    headwear: {
      items: [
        'Barbarian', 'Barbarian nasal', 'Barbarian Viking',
        'Horned helmet', 'Horned visor', 'Viking spangenhelm', 'Helmet wings',
        'Upward Horns', 'Downward Horns', 'Short Horns', 'Backwards Horns',
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
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.3,
    torso: ['Obi', 'Obi Knot Left', 'Obi Knot Right', 'Sleeveless 2', 'Original Sleeveless'],
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
    heads: COMMON.humanHeads,
    hair: 'all_human_hair',
    beardChance: 0.25,
    torso: ['Cuffed Longsleeves Overlay', 'Longsleeve 2 Buttoned', 'Cardigan', 'Shortsleeve Cardigan', 'Sleeveless 2 Cardigan', 'Shortsleeve Polo'],
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
};

// Per-class variant count for the bake.
export const VARIANT_COUNT = 50;
