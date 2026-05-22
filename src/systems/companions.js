// companions.js — the dungeon-keeper companion registry.
//
// The game ships four companion characters; the player picks one per run
// on the CompanionSelect screen. Everything that differs between them
// (sprite folder, expression vocabulary, dialogue bank, name) lives here
// so NpcCompanion / NpcDirector / Preload / CompanionSelect stay generic
// and another companion would be a data edit, not a code change.
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
    // Bumped to match Malakor — at 1 her body read noticeably smaller than
    // the other keepers in the in-game corner.
    hudScale: 1.15,
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
      // Costume / activity expressions — Lilith playing a handheld game
      // (idle / casual moments) and a maid-cosplay (playful, doting,
      // "at your service" lines).
      'gaming-1', 'gaming-2', 'maid',
      // 2026-05-22 expansion — 18 more faces. Romance / affection shades
      // (her doting register has real range now), vanity, cruelty, and
      // casual idle beats. NB: the redrawn cute-2 / mischievous /
      // mischievous-2 art keeps the same ids — a re-bake swapped the art.
      'adorable', 'adoring', 'changing-outfit', 'cruel', 'in-love',
      'disgusted', 'preening', 'giggling', 'heart-eyes', 'lovestruck',
      'menacing', 'obsessed', 'obsessive-love', 'tail-play', 'sexy-2',
      'affection', 'sneering', 'swooning',
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
    // 43 expressions. Adding more later: drop the PNGs in, extend
    // tools/bake-npc-sprites.mjs's map, re-run the bake, append ids here.
    expressions: [
      'aggressive', 'angry', 'bored', 'building', 'commanding', 'confident-1',
      'confident-2', 'cool', 'crying', 'determined', 'evil', 'excited',
      'eye-roll', 'guilty', 'happy', 'happy-gold', 'idle-1', 'idle-2',
      'impatient', 'laughing', 'level-up', 'mischievous', 'proud', 'mocking',
      'mocking-2', 'mocking-3', 'sad', 'scared', 'shocked', 'sleeping',
      'reading', 'smile', 'smug', 'stunned', 'thinking', 'unimpressed',
      'upset', 'upset-2', 'worried',
      // Activity expression — Malakor killing time on a handheld game
      // (idle / casual moments).
      'gaming',
      // 2026-05-22 expansion — 3 more faces: a full-throated battle roar,
      // a menacing glower, and a crisp war-sergeant's salute.
      'battle-roar', 'menacing', 'salute',
    ],
  },

  zulgath: {
    id:        'zulgath',
    name:      "Zul'Gath",
    tagline:   'Ancient, unbothered, has seen it all before.',
    traits:    ['the long view', 'deadpan calm', 'nothing surprises him'],
    // Zul'Gath's art is a WIDE landscape composition (aspect ~1.79) — the
    // other companions are tall portraits, and every companion slot is a
    // tall portrait shape. He is sized BIG (height matched to the humanoids)
    // and his tail/backside is FADED to transparent (`fadeMask`) so the wide
    // overflow dissolves into the background instead of reading as a sprite
    // jutting out. These fields are Zul'Gath-only — absent on the humanoids,
    // who keep defaults.
    //   portraitScale / portraitOrigin — CompanionSelect card: scaled to the
    //     others' height; anchored so his head sits near the card's left and
    //     the faded tail overflows RIGHT into the empty stage margin.
    //   archScale / archOrigin — same idea on the boss-picker side panel.
    //   fadeMask — CSS mask gradient fading his tail. Source art faces RIGHT
    //     (tail on the source-LEFT), so the gradient fades the left; the
    //     scaleX(-1) display flip then puts the fade on his trailing edge.
    //   hudScale — in-game HUD sprite scale; large, because a wide sprite
    //     `contain`-fit into the tall portrait box renders small.
    //   hudImgOrigin / hudImgOriginDocked — in-game scale anchors. Corner:
    //     bottom-LEFT, so he grows RIGHT (into the view) instead of left
    //     under the construction panel. Docked: bottom-RIGHT, so he grows
    //     LEFT (off-screen) instead of right over the menu modal.
    //   hudBubbleScale — keeps the speech bubble at base height (his
    //     scaled-up wide sprite is still short — the normal scale-driven
    //     lift would fling the bubble too high).
    portraitScale: 2.2,
    portraitOrigin: '60% 100%',
    archScale: 2.3,
    archOrigin: '60% 100%',
    fadeMask: 'linear-gradient(to right, transparent 0%, #fff 42%, #fff 100%)',
    // Sits on the right of the CompanionSelect line-up — mirror so he
    // faces inward toward the others.
    portraitFlipX: true,
    hudScale: 2.5,
    hudBubbleScale: 1,
    hudImgOrigin: '0% 100%',
    hudImgOriginDocked: '100% 100%',
    // Corner-mode fine-placement nudge (px): pull him left off the play
    // area and lift him a touch. Corner only — docked is unaffected.
    hudOffsetX: -190,
    hudOffsetY: -50,
    // Raise his corner speech bubble (px). Corner only.
    hudBubbleLift: 60,
    // Docked-mode (menu open) nudge (px): shove him RIGHT so less of his
    // bulk runs off the left screen edge. Separate from the corner nudge.
    hudOffsetXDocked: 190,
    hudOffsetYDocked: 0,
    spriteDir: 'assets/npc-zulgath/',
    // Neutral resting face — a dragon at ease, eons-bored.
    restExpr:  'idle',
    linesKey:  'zulgathLines',
    // 45 expressions. Adding more later: drop the PNGs in, extend
    // tools/bake-npc-sprites.mjs's map, re-run the bake, append ids here.
    expressions: [
      'aggressive', 'angry', 'attacking', 'bored', 'building', 'commanding',
      'confident', 'cool', 'crying', 'determined', 'evil', 'evil-2',
      'eye-roll', 'guilty', 'hoarding', 'idle', 'impatient', 'joking',
      'laughing', 'level-up', 'menacing', 'mischievous', 'mocking', 'playful',
      'gaming', 'proud', 'reading', 'sad', 'scared', 'shame', 'shocked',
      'sleeping', 'stunned', 'thinking', 'unimpressed', 'upset', 'happy',
      'winking', 'worried',
      // 2026-05-22 expansion — 6 more faces, all deepening his deadpan
      // register: smug, self-satisfied, an "above all this" superior look,
      // a second bored face, and the rare wistful / nostalgic cracks where
      // an eons-old dragon shows he remembers things long gone.
      'superior', 'bored-2', 'nostalgic', 'self-satisfied', 'smug', 'wistful',
    ],
  },

  safira: {
    id:        'safira',
    name:      'Safira',
    tagline:   'Chaotic, dazzling — your every wish, over-granted.',
    traits:    ['boundless enthusiasm', 'wish-granting devotion', 'gleeful chaos'],
    // CompanionSelect line-up: Safira sits THIRD (between Malakor and
    // Zul'Gath) and faces RIGHT, toward Zul'Gath. The studio art faces
    // right already, so no mirror is needed. If she ends up facing the
    // wrong way in the recruit screen, flipping this one boolean fixes it.
    portraitScale: 1,
    portraitFlipX: false,
    // In-game HUD sprite scale — matched to Lilith / Malakor.
    hudScale: 1.15,
    spriteDir: 'assets/npc-safira/',
    // Neutral resting face — a genie at ease, lamp-side.
    restExpr:  'idle',
    linesKey:  'safiraLines',
    // 53 expressions. Adding more later: drop the PNGs in, extend
    // tools/bake-npc-sprites.mjs's map, re-run the bake, append ids here.
    expressions: [
      'summoned', 'bored', 'building', 'blueprint', 'chaotic-1', 'chaotic-2',
      'lamp-cleaning', 'crazy-1', 'crazy-2', 'crying', 'cute', 'determined',
      'evil', 'excited', 'explaining', 'flirty-1', 'flirty-2', 'empowered',
      'wish-1', 'wish-2', 'wish-3', 'guilty', 'happy', 'treasure',
      'controller', 'idle', 'impatient', 'in-love-1', 'in-love-2',
      'lamp-inspecting', 'laughing', 'mischievous', 'nervous-1', 'nervous-2',
      'obsessive', 'gaming', 'pouting', 'interested', 'sad', 'scared', 'sexy',
      'shame', 'shocked', 'sleeping', 'reading', 'surprised', 'sweet',
      'taunting', 'unimpressed', 'upset', 'magic', 'winking', 'worried',
    ],
  },
}

// Resolve a companion config by id, falling back to the default so a
// missing / legacy / corrupt id never leaves the HUD without a companion.
export function getCompanion(id) {
  return COMPANIONS[id] || COMPANIONS[DEFAULT_COMPANION]
}

// Stable display order for the CompanionSelect screen.
export const COMPANION_ORDER = ['lilith', 'malakor', 'safira', 'zulgath']
