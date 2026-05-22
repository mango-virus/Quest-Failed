// companions.js — the dungeon-keeper companion registry.
//
// The game ships two companion characters; the player picks one per run
// on the CompanionSelect screen. Everything that differs between them
// (sprite folder, expression vocabulary, dialogue bank, name) lives here
// so NpcCompanion / NpcDirector / Preload / CompanionSelect stay generic
// and a third companion is a data edit, not a code change.
//
// `expressions` is the controlled vocabulary of `<id>.webp` files baked
// into `spriteDir` (see tools/bake-npc-sprites.mjs). Each companion's
// dialogue bank may only reference ids in its own list. `restExpr` is
// the neutral face the portrait settles back to between lines.

export const DEFAULT_COMPANION = 'lilith'

export const COMPANIONS = {
  lilith: {
    id:        'lilith',
    name:      'Lilith',
    // One-line character read used by the CompanionSelect screen.
    tagline:   'Flirty, wicked, sweetly sinister.',
    // Player-facing "what this keeper is like to play with" descriptors,
    // shown on the CompanionSelect card.
    traits:    ['gentle guidance', 'warmth', 'encouragement'],
    // CompanionSelect portrait tuning — `portraitScale` evens out the two
    // companions' on-screen size (their source art is framed differently);
    // `portraitFlipX` mirrors the sprite so they can face each other.
    portraitScale: 0.88,
    portraitFlipX: false,
    // In-game HUD portrait scale — multiplier on the .qf-npc-img sprite.
    // Lets a companion whose art wastes frame space (e.g. tall wings) be
    // grown so its BODY reads at a comparable size to the other's.
    hudScale: 1,
    spriteDir: 'assets/npc/',
    restExpr:  'smile',
    // Phaser JSON-cache key (loaded in Preload).
    linesKey:  'npcLines',
    expressions: [
      'aggressive', 'angry', 'bored', 'building', 'cackling', 'commanding',
      'confident', 'crying', 'cute', 'cute-2', 'determined', 'evil', 'excited',
      'eye-roll', 'flirty', 'guilty', 'happy', 'happy-gold', 'impatient',
      'laughing', 'level-up', 'mischievous', 'mischievous-2', 'proud-1',
      'proud-2', 'sad', 'scared', 'sexy', 'shocked', 'sleeping', 'reading',
      'smile', 'smug', 'stunned', 'surprised', 'surprised-2', 'thinking',
      'unimpressed', 'unimpressed-2', 'upset', 'winking', 'worried',
    ],
  },

  malakor: {
    id:        'malakor',
    name:      'Malakor',
    tagline:   'Rude, sinister, loyal to the bone.',
    traits:    ['blunt truth', 'no hand-holding', 'fierce loyalty'],
    portraitScale: 1,
    portraitFlipX: true,
    // Malakor's sprite carries tall wings above his head, so at a shared
    // frame height his BODY renders smaller than Lilith's. Scale his HUD
    // portrait up a touch so the bodies read at a comparable size — the
    // wings simply extend further past the portrait box (that's fine).
    hudScale: 1.15,
    spriteDir: 'assets/npc-malakor/',
    // 'idle-1' is his neutral resting face (he also has 'smile', but a
    // rude keeper resting on a grin reads wrong — idle suits him).
    restExpr:  'idle-1',
    linesKey:  'malakorLines',
    // 39 expressions. Adding more later: drop the PNGs in, extend
    // tools/bake-npc-sprites.mjs's map, re-run the bake, append ids here.
    expressions: [
      'aggressive', 'angry', 'bored', 'building', 'commanding', 'confident-1',
      'confident-2', 'cool', 'crying', 'determined', 'evil', 'excited',
      'eye-roll', 'guilty', 'happy', 'happy-gold', 'idle-1', 'idle-2',
      'impatient', 'laughing', 'level-up', 'mischievous', 'proud', 'mocking',
      'mocking-2', 'mocking-3', 'sad', 'scared', 'shocked', 'sleeping',
      'reading', 'smile', 'smug', 'stunned', 'thinking', 'unimpressed',
      'upset', 'upset-2', 'worried',
    ],
  },
}

// Resolve a companion config by id, falling back to the default so a
// missing / legacy / corrupt id never leaves the HUD without a companion.
export function getCompanion(id) {
  return COMPANIONS[id] || COMPANIONS[DEFAULT_COMPANION]
}

// Stable display order for the CompanionSelect screen.
export const COMPANION_ORDER = ['lilith', 'malakor']
