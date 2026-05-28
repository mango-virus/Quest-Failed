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
    // Origin x dropped from 70% -> 60% on 2026-05-27 to compensate for the
    // `portraitFlipX: true` swap. Pre-flip, the 70% pivot put his face near
    // the right of the card and his tail extended off-left (where his card
    // had no neighbour). Post-flip, that same 70% pivot pushed his bulk
    // off the RIGHT edge — user feedback "pushed too far to the right".
    // Dropping to 60% mirrors the pivot's distance-from-centre across the
    // flip so his face now sits near the LEFT edge of his card (facing
    // Luna) and his tail extends off-right (faded by the mask, no neighbour
    // on that side either since he's on the rightmost card of page 3).
    portraitOrigin: '60% 100%',
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
    // After the 2026-05-27 swap with Spectra, Zul'Gath sits at the RIGHT
    // of page 3 with Luna to his LEFT. His source art faces RIGHT, so we
    // flip him so he faces LEFT inward toward Luna. The `fadeMask` (a
    // left-to-right gradient) flips with the element under `scaleX(-1)`,
    // which keeps the fade on his trailing tail-side after the flip — so
    // his bulk still spills off his own card edge rather than across Luna.
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

  // Rattle Bones — seventh keeper. Macabre Jester archetype: a skeleton
  // court-jester three centuries dead, who finds the whole death business
  // hilarious. Gallows humour, theatrical, breaks the fourth wall as
  // showman-with-audience. He/him.
  //
  // Locked behind the `curtain_call` achievement (2026-05-26): kill 1000
  // adventurers with traps in a single run. Thematic — a comedian skeleton
  // wants a perfect setup-punchline show before he'll sign on as keeper.
  // AchievementSystem fires PlayerProfile.unlockCompanion('rattlebones')
  // when the threshold is met. See `src/data/achievements.json`.
  //
  // Dialogue bank + registry are FULL — only the sprite art is in
  // progress. Until the rest of his expressions land, the recruit card
  // shows him as a silhouette teaser (locked treatment), with the unlock
  // tooltip pointing to Curtain Call. When the sprites arrive:
  //   1. Drop them into `Quest-Failed assets/Companions/Rattle Bones`
  //   2. Fill out the `rattlebones.map` block in
  //      `tools/bake-npc-sprites.mjs` (one entry per expression below)
  //   3. Re-run `npm run bake:npc -- rattlebones`
  //   4. Verify every id in `expressions` resolves to a .webp under
  //      `assets/npc-rattlebones/`
  // The `locked` flag STAYS true — the achievement unlock handles flipping
  // his playable state per-player automatically (same pattern as Zul'Gath
  // + `hoard_lord`).
  //
  // Yellow accent halo (#ffe34d) is set in styles.css. CompanionSelect
  // shows his tagline + a "CURTAIN CALL ACHIEVEMENT" tooltip on locked
  // click (CompanionSelectOverlay._findUnlockAchievement walks
  // `reward.type === 'companion'` defs to find it).
  rattlebones: {
    id:        'rattlebones',
    name:      'Rattle Bones',
    tagline:   "Three centuries dead and still cracking jokes — the crypt's resident comic.",
    // Player-facing "what this keeper is like to play with" descriptors,
    // shown on the CompanionSelect card.
    traits:    ['gallows humour', 'showman flair', 'practical bone-tips'],
    locked:    true,
    // Tuned to match the other locked teasers (Luna / Nocturna). If
    // his source art proportions differ noticeably, bump up/down — see
    // the long iterations on Cinder & Marina in the git history for
    // examples of how to balance scale against `portraitOrigin`.
    portraitScale: 1.15,
    portraitOrigin: '50% 100%',
    portraitFlipX: false,
    hudScale: 1.15,
    spriteDir: 'assets/npc-rattlebones/',
    // Neutral resting face — the long-dead jester at rest, jaw slightly
    // ajar, bones at ease.
    restExpr:  'idle',
    // Picked-face pool — rolled per new selection on the recruit screen
    // so the reaction to "you picked me!" varies between picks. Lands on
    // Rattle Bones' performer register: laughing variants, cackling
    // delight, mischievous smirk, theatrical bow, smug pride, chef-kiss
    // approval, joke-telling poses. No quiet/melancholy faces — picking
    // him is a moment for the jester to MUG for the camera.
    pickedExprs: [
      'laughing', 'laughing-2', 'laughing-3', 'laughing-hard',
      'cackling', 'crying-laughing', 'facepalm-laugh',
      'mocking', 'smug', 'mischievous', 'evil-grin',
      'excited', 'winking', 'theatrical-bow',
      'chef-kiss', 'telling-joke', 'telling-joke-3',
    ],
    linesKey:  'rattleBonesLines',
    // 55 expressions delivered 2026-05-26 — full sprite set baked into
    // `assets/npc-rattlebones/`. Each id must match a baked `<id>.webp`.
    // The dialogue bank in `src/data/rattleBonesLines.json` only ever
    // references ids from this list. NpcCompanion falls back gracefully
    // to `restExpr` for any unrecognized id.
    expressions: [
      // Idle / quiet beats (4)
      'idle', 'bored', 'sleeping', 'lazy',
      // Laughing register — the comedy hits (10)
      'laughing', 'laughing-2', 'laughing-3', 'laughing-4',
      'laughing-hard', 'laughing-hard-2', 'cackling', 'crying-laughing',
      'chef-kiss', 'facepalm-laugh',
      // Mischievous / smug — the jester smirking (6)
      'mischievous', 'mischievous-2', 'smug', 'mocking', 'winking', 'evil-grin',
      // Excited / shocked — big reactions (5)
      'excited', 'surprised', 'shocked', 'mind-blown', 'mock-horror',
      // Theatrical / performer (7)
      'theatrical-bow', 'narrating', 'pointing', 'singing', 'dancing',
      'taunting', 'showing-prop',
      // Telling-a-joke variants — stand-up poses for joke delivery (5)
      'telling-joke', 'telling-joke-2', 'telling-joke-3', 'telling-joke-4',
      'telling-joke-5',
      // Quiet / thoughtful (6)
      'thinking', 'whisper', 'confused', 'melancholy', 'nostalgic', 'out-of-time',
      // Dismissive / annoyed (4)
      'eye-roll', 'unimpressed', 'annoyed', 'disgusted',
      // Pride / victory (5)
      'proud', 'gloating', 'applauding', 'victorious', 'clapping',
      // Skeleton-specific physical gags (3)
      'falling-apart', 'jaw-dropped', 'salute',
    ],
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

  // Spectra — ninth keeper. Ghost-girl otaku, anime/games/manga/snacks
  // and gets distracted easily. Ships LOCKED on the recruit screen
  // behind the legendary `flawless_reign` achievement (survive the first
  // 30 days of a run without the boss taking any damage) — once that
  // fires, `AchievementSystem._unlock` calls `PlayerProfile.unlockCompanion('spectra')`
  // and she becomes available like Rattle's curtain_call path.
  //
  // Two systems unique to Spectra that other companions don't use:
  //   • `variantGroups` — maps a SEMANTIC expression id (what the
  //     dialogue bank's `x:` references) to a list of variant webp
  //     basenames in `spriteDir`. NpcCompanion._setExpression picks
  //     a random variant per delivery so all 113 source sprites see
  //     screen-time. ArchetypeDecorOverlay does the same for the
  //     boss-select screen. Audit treats the bank as semantic-only
  //     (66 ids) — variants are an art-rotation detail, not a balance
  //     concern. Without `variantGroups`, the renderer's behaviour is
  //     identical to every other companion (file basename = id).
  //   • `ghostFlickerRate` / `ghostFlickerAlpha` — 25% of deliveries
  //     render at 0.70 alpha instead of 1.0. Sells the ghost identity
  //     without needing per-emotion see-through variants. The flicker
  //     dice is rolled once per expression change and the alpha holds
  //     for the full on-screen duration of that line (no strobing
  //     mid-typewriter). `solidOnlyExpressions` are exempt — the
  //     "scary ghost mode" beats land at full intensity always.
  spectra: {
    id:        'spectra',
    name:      'Spectra',
    tagline:   "A ghost with a head full of tropes — the dungeon's resident weeb.",
    traits:    ['anime brain', 'gamer reflexes', 'snack-fueled chaos'],
    locked:    true,
    portraitScale: 1.15,
    portraitOrigin: '50% 100%',
    // After the 2026-05-27 swap with Zul'Gath, Spectra sits at the LEFT
    // of page 3 with Luna to her RIGHT. Her source art faces LEFT, so
    // we leave her unflipped — natural pose has her looking inward
    // toward Luna.
    portraitFlipX: false,
    hudScale: 1.15,
    spriteDir: 'assets/npc-spectra/',
    // Neutral resting face — the ghost in default form. NOT the
    // see-through idle (that source PNG was deliberately dropped from
    // the bake) since the runtime ghost-flicker covers transparency.
    restExpr:  'idle',
    // ── Ghost-flicker overlay ──
    // 25% chance per delivery to render at 0.70 alpha. NpcCompanion's
    // _setExpression rolls this once when the expression changes and
    // the chosen opacity holds for the full line. Spooky-group
    // expressions (below) are exempt so they always land full alpha.
    ghostFlickerRate:  0.25,
    ghostFlickerAlpha: 0.70,
    solidOnlyExpressions: ['scary', 'skulls', 'ghost-power'],
    // Picked-face pool — rolled per recruit-screen selection. Restricted
    // to her hobby registers (gamer / anime / weeb / snacks / plushies)
    // per user request — picking Spectra should ALWAYS land on a pose
    // that screams one of her hobbies, never a generic "happy" face.
    // Includes anime-trope emotional poses (chibi-rage, sweatdrop,
    // wibbly-mouth, dramatic-anger) because they're anime-coded even
    // when negative — the random pool reads as her geeking out in
    // whichever anime mode she's in that day.
    pickedExprs: [
      // Anime / weeb reactions (10)
      'senpai-notice', 'sparkle-eyes', 'bishie-sparkles', 'heart-eyes',
      'looking-cute', 'weeb', 'taking-photo',
      'anime-gasp', 'nose-bleed', 'blushing',
      // Anime dramatic / emphatic poses (4)
      'dramatic-anger', 'chibi-rage', 'sweatdrop', 'wibbly-mouth',
      // Media consumption (2)
      'watching-anime', 'reading-manga',
      // Anime fan / hobby — plushies + figures (3)
      'plush-hug', 'holding-plushies', 'figure-collection',
      // Gamer poses (3)
      'gaming', 'button-mashing', 'gg-victory',
      // Streamer / content-creator beats (3) — headset+mic, phone-on,
      // mid-text. All read as "she's in creator mode" which is her
      // most-on-brand recruit-screen energy.
      'streaming', 'phone-scrolling', 'texting',
      // Snack-time beats (4)
      'cheeks-stuffed', 'pocky-mouth', 'eating-snacks', 'caught-snacking',
    ],
    linesKey:  'spectraLines',
    // 66 semantic expression ids covering 113 source sprites via the
    // variantGroups map below. Dialogue bank `x:` may only reference
    // ids from THIS list — renderer falls back to `restExpr` for any
    // unrecognised id.
    expressions: [
      // Idle / quiet (4)
      'idle', 'bored', 'sleeping', 'yawning',
      // Generic emotional baseline (12)
      'happy', 'excited', 'sad', 'upset', 'crying', 'proud',
      'confused', 'shocked', 'surprised', 'thinking', 'focused', 'annoyed',
      // Anger register (4)
      'angry', 'chibi-rage', 'dramatic-anger', 'scary',
      // Positive (4)
      'laughing', 'smug', 'mischievous', 'winking',
      // General poses (3)
      'pointing', 'explaining', 'looking-away',
      // Anime reactions (14)
      'sparkle-eyes', 'bishie-sparkles', 'anime-gasp', 'sweatdrop',
      'nose-bleed', 'heart-eyes', 'wibbly-mouth', 'senpai-notice',
      'blushing', 'looking-cute', 'weeb', 'watching-anime',
      'reading-manga', 'taking-photo',
      // Gamer (7)
      'gaming', 'button-mashing', 'streaming', 'rage-quit',
      'gg-victory', 'texting', 'phone-scrolling',
      // Snacks (7)
      'eating-snacks', 'cheeks-stuffed', 'pocky-mouth', 'chip-bag-shake',
      'juice-box-sip', 'empty-bag', 'caught-snacking',
      // Distracted (3)
      'distracted', 'doodling', 'mirror-check',
      // Fan / hobby (3)
      'plush-hug', 'holding-plushies', 'figure-collection',
      // Teasing / flirty — rare flavor beats (3)
      'teasing', 'seductive', 'sexy',
      // Spooky — rare, solid-only (2)
      'skulls', 'ghost-power',
    ],
    // Semantic id → list of variant webp basenames in `spriteDir`. Any
    // id NOT in this map falls back to a single-file lookup (basename
    // === id). NpcCompanion._setExpression picks at random from the
    // group; _preloadAll walks all of them so the cache is warm.
    variantGroups: {
      'idle':              ['idle', 'idle-2'],
      'bored':             ['bored', 'bored-2'],
      'sleeping':          ['sleeping', 'sleeping-2'],
      'happy':             ['happy', 'happy-2', 'happy-3'],
      'excited':           ['excited', 'excited-2'],
      'confused':          ['confused', 'confused-2'],
      'focused':           ['focused', 'focused-2'],
      'laughing':          ['laughing', 'laughing-2'],
      'anime-gasp':        ['anime-gasp', 'anime-gasp-2'],
      'heart-eyes':        ['heart-eyes', 'heart-eyes-2'],
      'senpai-notice':     ['senpai-notice', 'senpai-notice-2', 'senpai-notice-3'],
      'blushing':          ['blushing', 'blushing-2'],
      'looking-cute':      ['looking-cute', 'looking-cute-2', 'looking-cute-3'],
      'weeb':              ['weeb', 'weeb-2', 'weeb-3', 'weeb-4'],
      'watching-anime':    ['watching-anime', 'watching-anime-2'],
      'reading-manga':     ['reading-manga', 'reading-manga-2', 'reading-manga-3', 'reading-manga-4'],
      'gaming':            ['gaming', 'gaming-2'],
      'streaming':         ['streaming', 'streaming-2', 'streaming-3'],
      'texting':           ['texting', 'texting-2'],
      'eating-snacks':     ['eating-snacks', 'eating-snacks-2'],
      'pocky-mouth':       ['pocky-mouth', 'pocky-mouth-2'],
      'distracted':        ['distracted', 'distracted-2', 'distracted-3', 'distracted-4'],
      'doodling':          ['doodling', 'doodling-2'],
      'plush-hug':         ['plush-hug', 'plush-hug-2', 'plush-hug-3', 'plush-hug-4', 'plush-hug-5'],
      'holding-plushies':  ['holding-plushies', 'holding-plushies-2', 'holding-plushies-3'],
      'figure-collection': ['figure-collection', 'figure-collection-2', 'figure-collection-3'],
      'teasing':           ['teasing', 'teasing-2', 'teasing-3', 'teasing-4', 'teasing-5'],
      'ghost-power':       ['ghost-power', 'ghost-power-2', 'ghost-power-3'],
    },
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
export const COMPANION_ORDER = ['lilith', 'rattlebones', 'safira', 'necroknight', 'nocturna', 'malakor', 'spectra', 'luna', 'zulgath']

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
