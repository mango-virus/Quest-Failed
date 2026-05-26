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
    // CompanionSelect portrait tuning — bumped from 0.88 → 1.15 → 1.05
    // (final). At 1.15 (matching the locked teasers' raw scale) she
    // and the other starters read SLIGHTLY too big, because the
    // starter sources are tight-cropped (figure dominates canvas)
    // while the locked-teaser sources have more surrounding whitespace.
    // 1.05 brings starter and teaser apparent heights into visual
    // parity. Bottom-anchored origin keeps her feet on the name plate.
    // 560px bake → ~651px displayed = downscale, no quality loss.
    // `portraitFlipX` mirrors the sprite so they can face each other.
    portraitScale: 1.05,
    portraitOrigin: '50% 100%',
    portraitFlipX: false,
    // In-game HUD portrait scale — multiplier on the .qf-npc-img sprite.
    // Lets a companion whose art wastes frame space (e.g. tall wings) be
    // grown so its BODY reads at a comparable size to the other's.
    // Bumped to match Malakor — at 1 her body read noticeably smaller than
    // the other keepers in the in-game corner.
    hudScale: 1.15,
    spriteDir: 'assets/npc/',
    restExpr:  'smile',
    // Pool of faces she swaps to when clicked / selected on the recruit
    // screen — a random one is rolled per new selection so the reaction
    // varies between picks. All entries must exist in `expressions[]`
    // below. For Lilith: cute / flirty / sexy + her full lovestruck +
    // smitten + preening register so a "you picked me!" reaction lands
    // somewhere on her doting / flirty / playful axis every time.
    pickedExprs: [
      'cute', 'flirty', 'sexy', 'sexy-2',
      'excited', 'giggling', 'winking',
      'heart-eyes', 'in-love', 'lovestruck', 'swooning',
      'adoring', 'preening',
    ],
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
    // Scaled 1.05 → 1.15 (a little bigger) with `portraitOrigin`
    // shifted from `'50% 100%'` (pure bottom anchor) → `'50% 88%'`
    // → `'50% 75%'`. The Y value controls how the 1.15× scale-up
    // distributes between upward and downward growth: at 75%, about
    // 25% of the growth pushes the image down, sliding his body
    // further into the card. Wings still overflow the top of the
    // portrait box (by design — see hudScale comment below).
    portraitScale: 1.15,
    portraitOrigin: '50% 65%',
    portraitFlipX: true,
    // Malakor's sprite carries tall wings above his head, so at a shared
    // frame height his BODY renders smaller than Lilith's. Scale his HUD
    // portrait up a touch so the bodies read at a comparable size — the
    // wings simply extend further past the portrait box (that's fine).
    hudScale: 1.15,
    spriteDir: 'assets/npc-malakor/',
    // 'idle-2' is his neutral resting face (he also has 'smile', but a
    // rude keeper resting on a grin reads wrong — idle suits him; idle-2
    // chosen over idle-1 for the default at the designer's request).
    restExpr:  'idle-2',
    // Picked-face pool — rolled per new selection for variety. Lands on
    // Malakor's "good choice, boss" register: evil approval, mischievous
    // smirk, war-sergeant's salute, confident pride, commanding stance,
    // smug satisfaction, mocking the rejected, battle-cry victory, or
    // greedy gold-coin joy. No giddy joy faces — he's a rude sergeant,
    // not a puppy.
    pickedExprs: [
      'evil', 'mischievous', 'salute',
      'confident-1', 'confident-2', 'commanding', 'proud',
      'battle-roar', 'smug', 'mocking', 'happy-gold',
    ],
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
    // Locked behind the `hoard_lord` achievement (2026-05-25): accumulate
    // 10,000 gold in a single run. Thematic — an ancient dragon recognises
    // a fellow hoarder. AchievementSystem fires PlayerProfile.unlockCompanion
    // when the threshold is met. See `src/data/achievements.json`.
    locked: true,
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
    // Bumped 2.2 → 2.9 (2026-05-25) so his head reaches the same vertical
    // height as the humanoid companions on the recruit screen. His
    // source art is a wide composition (~1.79 aspect) — at default
    // contain-fit in the 410×620 portrait box, his IMG renders only
    // 410×229 (width-constrained), leaving his face MUCH lower than the
    // height-constrained humanoids. The 2.9× scale (bottom-anchored via
    // `portraitOrigin: 65% 100%`) lifts his face from portrait y≈166
    // back up to y≈89 — matching Lilith's at y≈92. His wings extend
    // ~44px above the portrait box top, just clearing the header's
    // sub-text. Keep `archScale` (boss-select side panel) at its
    // original 2.3 since that surface has a different layout box.
    //
    // Origin x bumped through several iterations on 2026-05-25:
    // 60% → 65% → 70%. Each 5% step shifts him ~39px further left in
    // the card. At higher origin-x, more of his source sits to the left
    // of the pivot, so the scale-up stretches further leftward; net
    // visual is a leftward shift while his bottom stays anchored. By 70%
    // his head sits comfortably toward the card's centre-right rather
    // than crowding the right edge.
    portraitScale: 2.9,
    portraitOrigin: '70% 100%',
    archScale: 2.3,
    archOrigin: '60% 100%',
    // Tail-side fade — the source art's left half (his rear half:
    // hind legs + tail) gradually dissolves so his long dragon body
    // doesn't read as a hard-edged rectangle overflowing the card.
    // Without flip (post-2026-05-25), source-left = visual-left, so the
    // fade is on his back half as he faces right. Stops nudged 2026-05-25
    // through a few iterations: 12%/58% → 18%/68% → 22%/72%. At the
    // current values, the leftmost 22% of source is fully transparent,
    // the fade zone covers 22-72% (a wide 50% region), and only the
    // rightmost 28% (his head + front body / wings) stays solid. Tuned
    // for the 2.9× scale + 65% origin where his rear half extends far
    // off-card; the long fade tail makes the dissolve read as anatomy
    // rather than a sharp horizontal slice.
    fadeMask: 'linear-gradient(to right, transparent 0%, transparent 22%, #fff 72%, #fff 100%)',
    // Under the paginator layout (2026-05-25) Zul'Gath sits at the LEFT
    // of page 2, with Nocturna to his right. His wide body extends in the
    // direction his head faces; flipping him so he faces Nocturna keeps
    // his bulk on his own card instead of overflowing across hers. With
    // `false` (no flip) the source art's natural right-facing pose lands
    // correctly + the `fadeMask` (which fades source-left) puts the fade
    // on his trailing tail-side, same as before. If he ever moves back
    // beside neighbours on his RIGHT, flip this to `true` again.
    portraitFlipX: false,
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
    // Picked-face pool — rolled per new selection. Zul'Gath registers
    // being chosen via deadpan dragon-pride: commanding stance, menacing
    // weight, the eons-old "you have chosen wisely" superior look, smug
    // self-satisfaction, a sly wink, joking jovial, playful side, or
    // even pulling out his handheld game like "alright, I'm staying".
    // No squeal-with-delight faces — he's bored of squealing.
    pickedExprs: [
      'commanding', 'menacing', 'gaming',
      'superior', 'self-satisfied', 'smug', 'proud',
      'winking', 'joking', 'playful', 'mischievous', 'evil',
    ],
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

  // Nocturna — fifth keeper, ships LOCKED on the recruit screen. Only an
  // `idle` portrait is wired up; the locked-card treatment dims/desaturates
  // it into a silhouette while keeping the character's pose + colour
  // teaser readable. No `linesKey` because she has no banter bank yet —
  // CompanionSelectOverlay skips locked ids from the speaker rotation, so
  // a missing bank can't blow up the bicker code.
  //
  // When she becomes playable: drop the rest of her expression art into
  // the source folder, fill out tools/bake-npc-sprites.mjs's `nocturna.map`,
  // re-run the bake, expand `expressions` here, add her `linesKey` +
  // dialogue bank, and remove `locked` below (or call
  // PlayerProfile.unlockCompanion('nocturna') wherever the unlock fires).
  // Luna — sixth keeper. Ships LOCKED on the recruit screen (same
  // teaser-only treatment as Nocturna). Only an `idle` portrait is
  // wired today; no `linesKey` because she has no banter bank yet —
  // CompanionSelectOverlay skips locked ids from the speaker rotation,
  // so a missing bank can't blow up the bicker code.
  //
  // When she becomes playable: drop the rest of her expression art into
  // the source folder (`Quest-Failed assets/Companions/Luna`), fill out
  // tools/bake-npc-sprites.mjs's `luna.map`, re-run the bake, expand
  // `expressions` here, add her `linesKey` + dialogue bank, and remove
  // `locked` below (or call `PlayerProfile.unlockCompanion('luna')`
  // wherever the unlock fires — condition TBD).
  luna: {
    id:        'luna',
    name:      'Luna',
    tagline:   'A quiet keeper of the moon.',
    traits:    [],
    locked:    true,
    // Tuned to match Nocturna's apparent height on the recruit screen.
    // Bottom-anchored origin so any extra height grows UP rather than
    // centred — keeps feet just above the name plate. Re-tune if Luna's
    // source art proportions differ noticeably from Nocturna's.
    portraitScale: 1.15,
    portraitOrigin: '50% 100%',
    portraitFlipX: false,
    hudScale: 1.15,
    spriteDir: 'assets/npc-luna/',
    restExpr:  'idle',
    // No dialogue bank yet — see header comment.
    linesKey:  null,
    expressions: ['idle'],
  },

  // Rattle Bones — seventh keeper. Ships LOCKED on the recruit screen
  // (same teaser-only treatment as Luna + Nocturna). Only an `idle`
  // portrait is wired today; no `linesKey` because she has no banter
  // bank yet — CompanionSelectOverlay skips locked ids from the
  // speaker rotation, so a missing bank can't blow up the bicker code.
  //
  // When she becomes playable: drop the rest of her expression art into
  // the source folder (`Quest-Failed assets/Companions/Rattle Bones`),
  // fill out `tools/bake-npc-sprites.mjs`'s `rattlebones.map`, re-run
  // the bake, expand `expressions` here, add her `linesKey` + dialogue
  // bank, and remove `locked` below (or call
  // `PlayerProfile.unlockCompanion('rattlebones')` wherever the unlock
  // fires — condition TBD).
  rattlebones: {
    id:        'rattlebones',
    name:      'Rattle Bones',
    tagline:   'Bone-clatter from the crypt — a skeletal keeper.',
    traits:    [],
    locked:    true,
    // Tuned to match the other locked teasers (Luna / Nocturna). If
    // her source art proportions differ noticeably, bump up/down — see
    // the long iterations on Cinder & Marina in the git history for
    // examples of how to balance scale against `portraitOrigin`.
    portraitScale: 1.15,
    portraitOrigin: '50% 100%',
    portraitFlipX: false,
    hudScale: 1.15,
    spriteDir: 'assets/npc-rattlebones/',
    restExpr:  'idle',
    // No dialogue bank yet — see header comment.
    linesKey:  null,
    expressions: ['idle'],
  },

  // The Necroknight — eighth keeper. Ships LOCKED on the recruit screen
  // (same teaser-only treatment as the other unlock-pending companions).
  // Armored undead warrior with a spectral-green aura — the
  // `--cmp-accent` token in styles.css is set to a phosphor green so
  // his hover/select halo reads as ghostfire instead of the default
  // blood-red. Only an `idle` portrait is wired today; no `linesKey`
  // because he has no banter bank yet — CompanionSelectOverlay skips
  // locked ids from the speaker rotation, so a missing bank is safe.
  //
  // When he becomes playable: drop the rest of his expression art into
  // the source folder (`Quest-Failed assets/Companions/The Necroknight`),
  // fill out `tools/bake-npc-sprites.mjs`'s `necroknight.map`, re-run
  // the bake, expand `expressions` here, add his `linesKey` + dialogue
  // bank, and remove `locked` below (or call
  // `PlayerProfile.unlockCompanion('necroknight')` wherever the unlock
  // fires — condition TBD).
  necroknight: {
    id:        'necroknight',
    name:      'Necroknight',
    tagline:   'Sworn to no king, served by every restless dead.',
    traits:    [],
    locked:    true,
    // Tuned to match the other locked teasers. Re-tune if his source
    // art reads visually larger or smaller than Nocturna in the card.
    portraitScale: 1.15,
    portraitOrigin: '50% 100%',
    portraitFlipX: false,
    hudScale: 1.15,
    spriteDir: 'assets/npc-necroknight/',
    restExpr:  'idle',
    // No dialogue bank yet — see header comment.
    linesKey:  null,
    expressions: ['idle'],
  },

  // Spectra — ninth keeper. Ships LOCKED on the recruit screen (same
  // teaser-only treatment as the other unlock-pending companions).
  // Only an `idle` portrait is wired today; no `linesKey` because she
  // has no banter bank yet — CompanionSelectOverlay skips locked ids
  // from the speaker rotation, so a missing bank is safe.
  //
  // When she becomes playable: drop the rest of her expression art into
  // the source folder (`Quest-Failed assets/Companions/Spectra`), fill
  // out `tools/bake-npc-sprites.mjs`'s `spectra.map`, re-run the bake,
  // expand `expressions` here, add her `linesKey` + dialogue bank, and
  // remove `locked` below (or call
  // `PlayerProfile.unlockCompanion('spectra')` wherever the unlock
  // fires — condition TBD).
  spectra: {
    id:        'spectra',
    name:      'Spectra',
    tagline:   'A wraith\'s whisper at the edge of every shadow.',
    traits:    [],
    locked:    true,
    // Tuned to match the other locked teasers. Re-tune if her source
    // art reads visually larger or smaller than the rest in the card.
    portraitScale: 1.15,
    portraitOrigin: '50% 100%',
    // Flipped 2026-05-26 — her source art faces one way; mirror so
    // she faces inward toward the other cards on Page 3.
    portraitFlipX: true,
    hudScale: 1.15,
    spriteDir: 'assets/npc-spectra/',
    restExpr:  'idle',
    // No dialogue bank yet — see header comment.
    linesKey:  null,
    expressions: ['idle'],
  },

  nocturna: {
    id:        'nocturna',
    name:      'Nocturna',
    tagline:   'A keeper of the witching hour.',
    traits:    [],
    locked:    true,
    // Her source art is tall + portrait, with the character filling most
    // of the frame but reading visually smaller than Lilith / Safira when
    // contained at scale 1. Bumped to 1.15 so her body matches the other
    // humanoids at a glance. Paired with a bottom-anchored origin so the
    // extra height grows UP (head goes higher) rather than centred (which
    // would push her feet down over the name plate). NB: tuned for the
    // 620px portrait box (post-banter-removal); was 1.25 in the prior
    // 462px box, scaled back since the bigger box already magnifies her.
    portraitScale: 1.15,
    portraitOrigin: '50% 100%',
    // Faces left in the source art; mirror so she leans inward toward the
    // other cards in the grid.
    portraitFlipX: true,
    hudScale: 1.15,
    spriteDir: 'assets/npc-nocturna/',
    restExpr:  'idle',
    // No dialogue bank yet — see header comment.
    linesKey:  null,
    expressions: ['idle'],
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
    // Bumped from 1 → 1.15 → 1.05 (final). At 1.15 (matching the
    // locked teasers' raw scale) the starters read SLIGHTLY too big
    // because their source art is tight-cropped while the locked-
    // teaser sources have more whitespace. 1.05 brings her into
    // visual parity with the locked teasers' apparent heights.
    portraitScale: 1.05,
    portraitOrigin: '50% 100%',
    portraitFlipX: false,
    // In-game HUD sprite scale — matched to Lilith / Malakor.
    hudScale: 1.15,
    spriteDir: 'assets/npc-safira/',
    // Neutral resting face — a genie at ease, lamp-side.
    restExpr:  'idle',
    // Picked-face pool — rolled per new selection. Peak-energy chaotic
    // genie: full chaotic / crazy variants, the three wish-granting
    // poses (she frames the player's pick as a wish), empowered surge,
    // happy, winking, excited, smitten in-love, devoted flirty, and the
    // hyper laughing register. Lots of variety because she has the
    // largest expression bank of any companion (53 faces).
    pickedExprs: [
      'chaotic-1', 'chaotic-2',
      'crazy-1', 'crazy-2',
      'happy', 'winking', 'excited',
      'wish-1', 'wish-2', 'wish-3',
      'empowered', 'in-love-1', 'flirty-1', 'laughing',
    ],
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

// Stable display order for the CompanionSelect screen. The recruit screen
// shows three companions at a time in a paginated row; this array is the
// flat reading order across all pages (left→right, page 1 first). Locked
// ids stay in the list — the overlay renders them silhouetted in-place and
// skips them from banter / hover / click; never strip locked ids here.
// Append new companions to the end; pagination auto-extends.
export const COMPANION_ORDER = ['lilith', 'rattlebones', 'safira', 'necroknight', 'nocturna', 'malakor', 'zulgath', 'luna', 'spectra']

// Roster of companion ids that ship UNLOCKED out of the box — used by
// PlayerProfile to seed the per-player unlock set on first run. Locked
// ids are NOT in this list and require an explicit unlock call.
//   • Zul'Gath unlocks via the `hoard_lord` achievement (10,000 gold
//     in a single run).
//   • Nocturna's unlock condition is TBD (character work in progress).
//   • Luna's unlock condition is TBD — added 2026-05-26 as a teaser
//     slot next to Nocturna with one shared `idle` sprite.
//   • Rattle Bones' unlock condition is TBD — added 2026-05-26 as a
//     third locked teaser, one idle sprite, no dialogue bank.
//   • The Necroknight's unlock condition is TBD — added 2026-05-26 as
//     a fourth locked teaser, one idle sprite, green spectral accent.
//   • Spectra's unlock condition is TBD — added 2026-05-26 as a fifth
//     locked teaser, one idle sprite.
export const STARTER_COMPANIONS = ['lilith', 'malakor', 'safira']
