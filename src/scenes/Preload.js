import { allEmoteVariants, emoteKey } from '../systems/EmoteSystem.js'
import { Balance } from '../config/balance.js'

// Boss skin table. Folder name on disk must equal `id`; texture keys are
// `${id}-<state>`. Adding a new boss skin = drop the 6 sheets into
// assets/sprites/<id>/ and add an entry here.
//
// Optional fields:
//   frameSize: square frame size in px. Default 64. Demon/golem ship as 128.
//   rowDirs:   row→direction order. Default ['down','up','left','right'].
//              All current sheets follow the default — keep the field for
//              future skins that ship a different row layout.
//
// Frame COUNTS are not hardcoded — they're derived per-sheet at runtime from
// (sheet.width / frameSize), since every boss × state pair ships with a
// different number of frames.
const DEFAULT_ROW_DIRS = ['down', 'up', 'left', 'right']
const DEFAULT_FRAME_SIZE = 64
const BOSS_SKINS = [
  { id: 'beholder',  prefix: 'Beholder3' },
  { id: 'demon',     prefix: 'Demon3',     frameSize: 128 },
  { id: 'gnoll',     prefix: 'Gnoll3' },
  { id: 'golem',     prefix: 'Golem3',     frameSize: 128 },
  { id: 'lich',      prefix: 'Lich3' },
  { id: 'lizardman', prefix: 'Lizardman3' },
  { id: 'myconid',   prefix: 'Mushroom3' },
  { id: 'orc',       prefix: 'orc3' },
  { id: 'vampire',   prefix: 'Vampires3' },
  { id: 'wraith',    prefix: 'Ghost3' },
  // Succubus uses a custom asset pack with non-square frames per state and
  // no `_with_shadow` filename suffix. `noShadow` flips the path; `states`
  // overrides per-state frame width/height.
  {
    id: 'succubus', prefix: 'Succubus', noShadow: true,
    states: {
      idle:   { frameW: 73, frameH: 70 },
      walk:   { frameW: 73, frameH: 70 },
      run:    { frameW: 73, frameH: 70 },
      attack: { frameW: 81, frameH: 89 },
      hurt:   { frameW: 73, frameH: 70 },
      death:  { frameW: 73, frameH: 70 },
    },
  },
]

// Per-state metadata. frameRate and repeat are uniform across bosses; frame
// counts are derived from sheet dimensions (see _registerBossAnimations).
const BOSS_SHEET_STATES = [
  { file: 'Idle',   key: 'idle',   frameRate: 6,  repeat: -1 },
  { file: 'Walk',   key: 'walk',   frameRate: 10, repeat: -1 },
  { file: 'Run',    key: 'run',    frameRate: 12, repeat: -1 },
  { file: 'Attack', key: 'attack', frameRate: 18, repeat:  0 },
  { file: 'Hurt',   key: 'hurt',   frameRate: 14, repeat:  0 },
  { file: 'Death',  key: 'death',  frameRate: 10, repeat:  0 },
]

// Minion skin table — every minion ships 6 sheets with normalized filenames
// (idle.png/walk.png/run.png/attack.png/hurt.png/death.png) inside
// assets/sprites/minions/<id>/. Texture keys are `minion-<id>-<state>` so
// they don't collide with boss texture keys. Anim keys are
// `minion-<id>-<state>-<dir>` (down/up/left/right).
//
// Most sheets are 64-frame; demons, golems, ents, elder slimes, and rats are
// 128-frame. Add the id to MINION_FRAMES_128 if a new 128-frame skin lands.
const MINION_FRAMES_128 = new Set([
  'demon1', 'demon2',
  'elder_slime1', 'elder_slime2', 'elder_slime3',
  'ent1', 'ent2', 'ent3',
  'golem1', 'golem2',
  'rat1', 'rat2', 'rat3',
])
const MINION_IDS = [
  'beholder1', 'beholder2',
  'demon1', 'demon2',
  'elder_slime1', 'elder_slime2', 'elder_slime3',
  'ent1', 'ent2', 'ent3',
  'ghost1', 'ghost2',
  'gnoll1', 'gnoll2',
  'goblin1', 'goblin2', 'goblin3',
  'golem1', 'golem2',
  'imp1', 'imp2', 'imp3',
  'lich1', 'lich2',
  'lizardman1', 'lizardman2',
  'mushroom1', 'mushroom2',
  'orc1', 'orc2',
  'plant1', 'plant2', 'plant3',
  'rat1', 'rat2', 'rat3',
  'skeleton1', 'skeleton2', 'skeleton3',
  'slime1', 'slime2', 'slime3', 'slime4', 'slime5', 'slime6', 'slime7', 'slime8', 'slime9',
  'vampire_minion1', 'vampire_minion2',
  'zombie1', 'zombie2', 'zombie3',
]
// LPC adventurer roster — every class with baked variants under
// assets/sprites/adventurers/<class>/v01.png … v50.png. Texture keys are
// `adv-<class>-vNN`. Animation rows per sheet come from layout.json.
const ADVENTURER_CLASS_IDS = [
  'knight', 'rogue', 'mage', 'cleric', 'necromancer', 'ranger',
  'twitch_streamer', 'beast_master', 'barbarian', 'monk', 'bard',
  // Event-only classes — no normal spawn (unlockLevel: 99 in
  // adventurerClasses.json) but baked + preloaded so the corresponding
  // dungeon events render their dedicated LPC art rather than falling
  // back to procedural silhouettes.
  'cartographer_scholar', 'cosplay_adventurer',
  // Sprite-only class — bounty hunters spawn with `ranger` gameplay but
  // wear this dedicated baked sheet (assigned via spriteVariant in DayPhase).
  'bounty_hunter',
]
const ADVENTURER_VARIANTS_PER_CLASS = 50

// Classes whose combat animation is slash or thrust ship a separate
// `_atk.png` at 192×192 frames so long weapons (longsword, halberd, spear)
// render at native scale rather than being clipped/shrunk into 64×64. Texture
// keys are `adv-<class>-vNN-atk`. AdventurerRenderer swaps to this texture
// during combat and back when idle/walking.
const ADVENTURER_ATK_CLASSES = new Set([
  'knight', 'rogue', 'barbarian', 'twitch_streamer', 'beast_master',
  'mage', 'cleric', 'necromancer', 'ranger', 'bard',
  // Cosplayers fight when provoked, so they need the long-weapon attack
  // sheet. Cartographer scholars are barehanded + non-combatant — no
  // attack sheet needed; they reuse the main 64×64 sheet's slash row
  // for the rare retaliation case if it ever comes up.
  'cosplay_adventurer',
  // Bounty hunters carry crossbows — crossbow combat is thrust-oversize,
  // which lives in the _atk.png sheet.
  'bounty_hunter',
])
const ADVENTURER_ATK_FRAME = 192
const ADVENTURER_ATK_COLS  = 8
// Atk-sheet row layout: rows 0–3 = slash up/left/down/right (6 frames each),
// rows 4–7 = thrust up/left/down/right (8 frames each).
const ADVENTURER_ATK_ANIM_LAYOUT = {
  slash:  { startRow: 0, frames: 6 },
  thrust: { startRow: 4, frames: 8 },
}

// LPC sheets store directions in N / W / S / E row order within each
// animation block. Map them to the down/up/left/right convention the rest of
// the game uses.
const ADVENTURER_DIRS = ['up', 'left', 'down', 'right']

// Per-animation playback metadata. Frame counts come from layout.json at
// runtime, not hardcoded here.
const ADVENTURER_ANIM_META = {
  spellcast: { frameRate: 12, repeat: 0  },
  thrust:    { frameRate: 14, repeat: 0  },
  walk:      { frameRate: 10, repeat: -1 },
  slash:     { frameRate: 18, repeat: 0  },
  shoot:     { frameRate: 14, repeat: 0  },
  hurt:      { frameRate: 12, repeat: 0  },
  idle:      { frameRate: 4,  repeat: -1 },
  run:       { frameRate: 14, repeat: -1 },
}

const MINION_SHEET_STATES = [
  { file: 'idle',   key: 'idle',   frameRate: 6,  repeat: -1 },
  { file: 'walk',   key: 'walk',   frameRate: 10, repeat: -1 },
  { file: 'run',    key: 'run',    frameRate: 12, repeat: -1 },
  { file: 'attack', key: 'attack', frameRate: 18, repeat:  0 },
  { file: 'hurt',   key: 'hurt',   frameRate: 14, repeat:  0 },
  { file: 'death',  key: 'death',  frameRate: 10, repeat:  0 },
]

export class Preload extends Phaser.Scene {
  constructor() {
    super('Preload')
  }

  preload() {
    const { width, height } = this.scale

    // Loading bar
    this.add.rectangle(width / 2, height / 2, 440, 24, 0x1a0a2e)
    const bar = this.add.rectangle(width / 2 - 218, height / 2, 4, 20, 0x9b32d4)
    bar.setOrigin(0, 0.5)

    this.add.text(width / 2, height / 2 - 30, 'LOADING...', {
      fontSize: '14px',
      color: '#444455',
      fontFamily: 'monospace',
    }).setOrigin(0.5)

    this.load.on('progress', (p) => { bar.width = 4 + 432 * p })

    // Per-scene UI layout overrides written by UIEditor (Ctrl+S). Files are
    // optional — Phaser's loader will log a 404 if missing and the editor
    // falls back to code defaults. Add a line per scene that wires up the
    // editor.
    this.load.json('layout-ArchetypeSelect', 'assets/layouts/ArchetypeSelect.json')

    // Game content definitions — all data-driven, nothing hardcoded
    this.load.json('bossArchetypes',    'src/data/bossArchetypes.json')
    this.load.json('rooms',             'src/data/rooms.json')
    this.load.json('personalities',     'src/data/personalities.json')
    this.load.json('personalityCombos', 'src/data/personalityCombos.json')
    this.load.json('dungeonMechanics',  'src/data/dungeonMechanics.json')
    this.load.json('minionTypes',       'src/data/minionTypes.json')
    this.load.json('minionEvolutions',  'src/data/minionEvolutions.json')
    this.load.json('trapTypes',         'src/data/trapTypes.json')
    this.load.json('adventurerClasses', 'src/data/adventurerClasses.json')
    this.load.json('lastWords',         'src/data/lastWords.json')
    this.load.json('chatLines',         'src/data/chatLines.json')
    this.load.json('bossAbilities',     'src/data/bossAbilities.json')
    this.load.json('items',             'src/data/items.json')
    this.load.json('events',            'src/data/events.json')

    // Dark Deal demon — 5×4 sheet of 80×80 frames. Row 1 (frames 0-4)
    // appearing animation, rows 2-3 (frames 5-14) idle, row 4 (15-19)
    // leaving animation. Spawned in the boss room on Dark Deal nights.
    this.load.spritesheet('event-dark-deal-demon',
      'assets/sprites/event_dark_deal_demon.png',
      { frameWidth: 80, frameHeight: 80 })

    // Succubus special anims — bat-form swarm (4×4: rows = LD/RD/LU/RU,
    // 4 frames each), boss-on-target transform (2×2: top row right-facing,
    // bottom row left-facing), and a 1-row 6-frame smoke puff overlay.
    this.load.spritesheet('succubus-bat',
      'assets/sprites/succubus/Succubus_Bat.png',
      { frameWidth: 32, frameHeight: 29 })
    this.load.spritesheet('succubus-transform',
      'assets/sprites/succubus/Succubus_Transform.png',
      { frameWidth: 57, frameHeight: 51 })
    this.load.spritesheet('succubus-transform-smoke',
      'assets/sprites/succubus/Succubus_TransformSmoke.png',
      { frameWidth: 44, frameHeight: 49 })

    // ── Audio ────────────────────────────────────────────────────────────
    // Title-screen / boss-picker loop.  Lives across MainMenu and
    // ArchetypeSelect (see Audio helpers in those scenes); stops when
    // the player commits to a run and Game starts.
    this.load.audio('title_music', 'assets/audio/title_music.mp3')

    // Title-screen background images. MainMenu picks one at random per
    // visit. Add new files by dropping them into assets/title-screen/
    // and listing them here.
    const TITLE_BACKGROUNDS = [
      'Gemini_Generated_Image_1l7d3f1l7d3f1l7d.png',
      'Gemini_Generated_Image_5zo1l45zo1l45zo1.png',
      'Gemini_Generated_Image_77yfph77yfph77yf.png',
      'Gemini_Generated_Image_7j1nj67j1nj67j1n.png',
      'Gemini_Generated_Image_85xlhl85xlhl85xl.png',
      'Gemini_Generated_Image_daftk2daftk2daft.png',
      'Gemini_Generated_Image_lbja7blbja7blbja.png',
      'Gemini_Generated_Image_m6r33um6r33um6r3.png',
      'Gemini_Generated_Image_qlsz2fqlsz2fqlsz.png',
      'Gemini_Generated_Image_r1iihlr1iihlr1ii.png',
      'Gemini_Generated_Image_wvfuiawvfuiawvfu.png',
    ]
    TITLE_BACKGROUNDS.forEach((file, i) => {
      this.load.image(`title-bg-${i}`, `assets/title-screen/${file}`)
    })
    this.registry.set('titleBgKeys', TITLE_BACKGROUNDS.map((_, i) => `title-bg-${i}`))

    // Animated title-screen backgrounds — MainMenu picks one at random per
    // visit, layered behind the QUEST/FAILED title stack on the left half.
    // To add a clip: drop bgNN.mp4 in assets/title-screen/videos/ and add
    // its number here. To remove: delete the file and the number.
    const TITLE_VIDEO_NUMBERS = [2, 4, 5, 6, 9, 11, 12, 13, 14, 15, 16, 17]
    const titleVideoKeys = []
    for (const i of TITLE_VIDEO_NUMBERS) {
      const num = String(i).padStart(2, '0')
      const key = `title-vid-${num}`
      this.load.video(key, `assets/title-screen/videos/bg${num}.mp4`, 'loadeddata', false, true)
      titleVideoKeys.push(key)
    }
    this.registry.set('titleVideoKeys', titleVideoKeys)

    // Room-placement SFX — one is picked at random when the player
    // places a room during NightPhase.
    this.load.audio('sfx-build-1', 'assets/audio/build1.wav')
    this.load.audio('sfx-build-2', 'assets/audio/build2.wav')
    this.load.audio('sfx-build-3', 'assets/audio/build3.wav')

    // Minion pickup / drop SFX — single sample, plays on both actions.
    this.load.audio('sfx-minion-place', 'assets/audio/pickup and drop.wav')

    // Gameplay SFX — managed by SfxSystem.
    this.load.audio('sfx-death',          'assets/audio/adventurer and minion death.wav')
    this.load.audio('sfx-archer-shoot',   'assets/audio/archer long range shoot.mp3')
    this.load.audio('sfx-beholder-beam',  'assets/audio/beholder eye beam.mp3')
    this.load.audio('sfx-boss-attack',    'assets/audio/boss attack1.mp3')
    this.load.audio('sfx-boss-death',     'assets/audio/boss death.wav')
    this.load.audio('sfx-break-door',     'assets/audio/break door.wav')
    this.load.audio('sfx-chest-open',     'assets/audio/chest open.mp3')
    this.load.audio('sfx-cleric-heal',    'assets/audio/cleric heal.wav')
    this.load.audio('sfx-close-door',     'assets/audio/close door.wav')
    this.load.audio('sfx-collect-gold',   'assets/audio/collect gold.wav')
    this.load.audio('sfx-dark-pact',      'assets/audio/dark pact menu open.wav')
    this.load.audio('sfx-day-end',        'assets/audio/day phase end.wav')
    this.load.audio('sfx-day-start',      'assets/audio/day phase start.wav')
    this.load.audio('sfx-door-open',      'assets/audio/door open.mp3')
    this.load.audio('sfx-door-unlock',    'assets/audio/Door Unlock.wav')
    this.load.audio('sfx-error',          'assets/audio/error.wav')
    this.load.audio('sfx-mage-attack',    'assets/audio/long range mage attack.wav')
    this.load.audio('sfx-melee-1',        'assets/audio/melee weapon attack1.wav')
    this.load.audio('sfx-melee-2',        'assets/audio/melee weapon attack2.wav')
    this.load.audio('sfx-monk-1',         'assets/audio/monk attack1.wav')
    this.load.audio('sfx-monk-2',         'assets/audio/monk attack2.wav')
    this.load.audio('sfx-necro-summon',   'assets/audio/necromancer summon.mp3')
    this.load.audio('sfx-remove-room',    'assets/audio/remove room.wav')
    this.load.audio('sfx-revive',         'assets/audio/revive.wav')
    this.load.audio('sfx-score-countup',  'assets/audio/score or number count up.mp3')
    this.load.audio('sfx-take-damage',    'assets/audio/take damge.wav')
    this.load.audio('sfx-teleport',       'assets/audio/teleport.wav')
    this.load.audio('sfx-btn-hover',       'assets/audio/cursor hover button.mp3')
    this.load.audio('sfx-btn-click',       'assets/audio/Press button.wav')
    this.load.audio('sfx-build-menu-press','assets/audio/build menu press.wav')
    this.load.audio('sfx-book-open',       'assets/audio/book-open.mp3')
    this.load.audio('sfx-speech',          'assets/audio/speech-2.wav')

    // Boss fight music — one picked at random when a party enters the boss room.
    // Keys must match BOSS_TRACKS in src/systems/GameplayMusic.js.
    this.load.audio('boss-fight-1', 'assets/audio/Boss Fight 1.mp3')
    this.load.audio('boss-fight-2', 'assets/audio/Boss Fight 2.mp3')
    this.load.audio('boss-fight-3', 'assets/audio/Boss Fight 3.mp3')
    this.load.audio('boss-fight-4', 'assets/audio/Boss Fight 4.mp3')
    this.load.audio('boss-fight-5', 'assets/audio/Boss Fight 5.mp3')

    // Gameplay-music playlist — shuffled by GameplayMusic.js once the
    // player drops into a run.  Keys here must match the TRACKS array
    // in src/systems/GameplayMusic.js.
    this.load.audio('gpm-chupasangre',         'assets/audio/chupasangre_music.mp3')
    this.load.audio('gpm-clockwork-castle',    'assets/audio/clockwork castle.mp3')
    this.load.audio('gpm-catacombs',           'assets/audio/catacombs.mp3')
    this.load.audio('gpm-wallachian-waltz',    'assets/audio/Wallachian Waltz.mp3')
    this.load.audio('gpm-midnight-masquerade', 'assets/audio/midnight masquerade.mp3')
    this.load.audio('gpm-endless-accent',      'assets/audio/endless accent.mp3')
    this.load.audio('gpm-suck-em-dry',         'assets/audio/suck em dry.mp3')

    // Dungeon tile sprites — loaded per named tileset.
    // The default tileset is 'room' and uses the un-namespaced keys
    // (tile-FLOOR, tile-WALL, …) so existing room defs don't need changes.
    //
    // To add a new tileset (e.g. 'cave'), place 32×32 PNGs in
    // assets/tiles/cave/ with the same filenames, then call loadTileset():
    //
    //   loadTileset('cave', 'assets/tiles/cave/')
    //
    // DungeonRenderer will pick tile-cave-FLOOR etc. for any room whose def
    // has `tileset: "cave"`, falling back to tile-FLOOR if not found.
    const TILE_VARIANTS = [
      ['tile-FLOOR',          'FLOOR.png'],
      ['tile-WALL',           'WALL.png'],
      ['tile-WALL_CAP',       'WALL_CAP.png'],
      ['tile-WALL_BOTTOM',    'Wall_BOTTOM.png'],
      ['tile-WALL_L',         'WALL_L.png'],
      ['tile-WALL_R',         'WALL_R.png'],
      ['tile-WALL_CORNER_TL', 'WALL_CORNER_TL.png'],
      ['tile-WALL_CORNER_TR', 'WALL_CORNER_TR.png'],
      ['tile-WALL_CORNER_BL', 'WALL_CORNER_BL.png'],
      ['tile-WALL_CORNER_BR', 'WALL_CORNER_BR.png'],
    ]
    const loadTileset = (name, folder) => {
      const prefix = name === 'room' ? 'tile-' : `tile-${name}-`
      const files  = name === 'room' ? TILE_VARIANTS
        : TILE_VARIANTS.map(([k, f]) => [`${prefix}${k.slice(5)}`, f])
      files.forEach(([key, file]) => this.load.image(key, folder + file))
    }
    loadTileset('room', 'assets/tiles/room/')
    // Add more tilesets here as art lands:
    // loadTileset('cave',  'assets/tiles/cave/')
    // loadTileset('boss',  'assets/tiles/boss/')

    // Theme manifest — describes every user-uploaded tile sprite + per-theme
    // slot assignments. Optional: if the file is absent (404), the loader
    // emits 'loaderror' and the game runs without themes (procedural look
    // only). When present, _loadThemesAndStart() in create() reads it and
    // queues a second loader pass for each referenced PNG.
    this.load.json('themes-manifest', 'assets/themes/manifest.json')

    // Decor manifest — user-uploaded decoration sprites. Optional; absent on
    // first run. Loaded alongside themes in _loadThemesAndStart().
    this.load.json('decor-manifest', 'assets/sprites/decor/manifest.json')

    // ── Boss HP hearts ─────────────────────────────────────────────────────
    const HEARTS = 'assets/ui/hearts/'
    this.load.image('heart-full',  HEARTS + 'heart_full.png')
    this.load.image('heart-empty', HEARTS + 'heart_empty.png')
    this.load.spritesheet('heart-lose', HEARTS + 'lose_heart.png', { frameWidth: 17, frameHeight: 16 })

    // ── Bestiary book UI (boss-select screen) ──────────────────────────────
    // Pack: Craftpix bestiary-book-pixel-art-asset-pack. Each animation sheet
    // is a 4-col × N-row grid of 272×272 frames. Static UI sheets load as
    // single images and we crop sub-rects in code.
    const BEST = 'assets/ui/bestiary/'
    this.load.spritesheet('bestiary-open',         BEST + 'Open_book.png',                 { frameWidth: 272, frameHeight: 272 })
    this.load.spritesheet('bestiary-close',        BEST + 'Close_book.png',                { frameWidth: 272, frameHeight: 272 })
    this.load.spritesheet('bestiary-pageturn-l',   BEST + 'Turning_pages_left.png',        { frameWidth: 272, frameHeight: 272 })
    this.load.spritesheet('bestiary-pageturn-r',   BEST + 'Turning_pages_right.png',       { frameWidth: 272, frameHeight: 272 })
    this.load.spritesheet('bestiary-pages-appear', BEST + 'pages_apper.png',               { frameWidth: 240, frameHeight: 176 })
    this.load.spritesheet('bestiary-pages-vanish', BEST + 'pages_desappear-Sheet.png',     { frameWidth: 240, frameHeight: 176 })
    this.load.image('bestiary-page-l-above-claws', BEST + 'Page_only_above_claws_left.png')
    this.load.image('bestiary-page-r-above-claws', BEST + 'Page_only_above_claws_right.png')
    this.load.image('bestiary-monsters',           BEST + 'Monsters.png')
    this.load.image('bestiary-monsters-noshadow',  BEST + 'Monsters_no_shadow.png')
    this.load.image('bestiary-icons',              BEST + 'Icons.png')
    this.load.image('bestiary-pages-elements',     BEST + 'Pages_elements_full.png')
    this.load.image('bestiary-details',            BEST + 'Details.png')
    this.load.image('bestiary-claws',              BEST + 'Claws.png')
    this.load.image('bestiary-claws-back',         BEST + 'Claws_backward.png')
    this.load.image('bestiary-titles',             BEST + 'Titles_text.png')
    this.load.image('bestiary-text',               BEST + 'Text.png')
    this.load.image('bestiary-portrait-border',    BEST + 'portrait_border.png')
    this.load.image('bestiary-portrait-highlight', BEST + 'portrait_highlight.png')

    // Currency icons — replace the ◆ glyph in BuildMenu costs and the
    // BossTopBar treasury readout. coin = ≤20g, gold-coins = >20g, coin-bag
    // = treasury total.
    this.load.image('ui-coin',       'assets/ui/coin.png')
    this.load.image('ui-gold-coins', 'assets/ui/gold-coins.png')
    this.load.image('ui-coin-bag',   'assets/ui/coin-bag.png')

    // Per-boss portrait images for the COMPENDIUM grid slots. Each is a 22×22
    // pixel-art bust. Bosses without a portrait file (lich) fall back to the
    // procedural silhouette in ArchetypeSelect.
    // Per-boss bestiary art keys: 22×22 portraits, name banners, and full
    // body images now exist for all 10 bosses.
    const ALL_BOSSES = ['beholder', 'demon', 'gnoll', 'golem', 'lich', 'lizardman', 'myconid', 'orc', 'succubus', 'vampire', 'wraith', 'slime']
    for (const id of ALL_BOSSES) {
      this.load.image(`bestiary-portrait-${id}`, BEST + `portraits/${id}_p.png`)
      this.load.image(`bestiary-name-${id}`,     BEST + `names/${id}_n.png`)
      this.load.image(`bestiary-full-${id}`,     BEST + `full/${id}.png`)
    }
    // Decorative red-and-gold banner that holds the boss name on the right page.
    this.load.image('bestiary-nameplate', BEST + 'names/name_plate.png')

    // Boss sprite sheets — craftpix.net 4-direction monster pack ("In use" set).
    // Texture key per state = `<archetypeId>-<state>`; BossRenderer keys by id.
    // Per-skin overrides: `noShadow` drops the `_with_shadow` filename suffix,
    // `states[k].frameW/frameH` overrides the default square frameSize for
    // skins (like the succubus) whose states ship at different dimensions.
    for (const skin of BOSS_SKINS) {
      const folder = `assets/sprites/${skin.id}/`
      const fs = skin.frameSize ?? DEFAULT_FRAME_SIZE
      const suffix = skin.noShadow ? '' : '_with_shadow'
      for (const s of BOSS_SHEET_STATES) {
        const stateConf = skin.states?.[s.key]
        const fW = stateConf?.frameW ?? fs
        const fH = stateConf?.frameH ?? fs
        this.load.spritesheet(`${skin.id}-${s.key}`, folder + `${skin.prefix}_${s.file}${suffix}.png`, { frameWidth: fW, frameHeight: fH })
      }
    }

    // Minion sprite sheets — same craftpix pack, filenames normalized to
    // <state>.png on copy. Texture key = `minion-<id>-<state>`.
    for (const id of MINION_IDS) {
      const folder = `assets/sprites/minions/${id}/`
      const fs = MINION_FRAMES_128.has(id) ? 128 : 64
      for (const s of MINION_SHEET_STATES) {
        this.load.spritesheet(`minion-${id}-${s.key}`, folder + `${s.file}.png`, { frameWidth: fs, frameHeight: fs })
      }
    }

    // ── LPC adventurer spritesheets ──────────────────────────────────────────
    // 50 baked variants per class × 11 classes = 550 sheets. Each is 832×1856
    // RGBA with 64×64 frames in a 13-col × 29-row grid containing 8 animations
    // (spellcast / thrust / walk / slash / shoot / hurt / idle / run). Layout
    // offsets live in layout.json and per-variant trait picks in manifest.json
    // (used by AdventurerRenderer to decide which variant a given adventurer
    // renders as, save-stable via adv.spriteVariant).
    this.load.json('adventurerManifest', 'assets/sprites/adventurers/manifest.json')
    this.load.json('adventurerLayout',   'assets/sprites/adventurers/layout.json')
    for (const id of ADVENTURER_CLASS_IDS) {
      for (let i = 1; i <= ADVENTURER_VARIANTS_PER_CLASS; i++) {
        const v = `v${String(i).padStart(2, '0')}`
        this.load.spritesheet(`adv-${id}-${v}`,
          `assets/sprites/adventurers/${id}/${v}.png`,
          { frameWidth: 64, frameHeight: 64 })
      }
    }

    // ── LPC adventurer attack sheets — DEFERRED ─────────────────────────
    // 192×192 frames for slash + thrust so long weapons render at native
    // scale. ~650 separate file requests, mostly bigger than the main
    // sheets — historically the dominant chunk of cold-start load time.
    // Now loaded in the BACKGROUND from MainMenu while the player is on
    // the title screen (see MainMenu._kickOffDeferredLoad). The renderer
    // already falls back to the main 64×64 sheet for slash/thrust if an
    // atk sheet hasn't finished loading yet, so an early Start Run is
    // visually graceful (combat anims look slightly compressed for a
    // moment, then upgrade once the sheets land).

    // ── Adventurer emote bubbles ─────────────────────────────────────────
    // 96×32 sheets with three 32×32 frames each. EmoteSystem.js owns the
    // catalog (trigger → variant filename) and the per-frame trigger logic;
    // here we just queue the spritesheet load. Texture key = emoteKey(name).
    for (const variant of allEmoteVariants()) {
      this.load.spritesheet(emoteKey(variant),
        `assets/sprites/emotes/${variant}.png`,
        { frameWidth: 32, frameHeight: 32 })
    }

    // ── Demon Hellgate portal ─────────────────────────────────────────────
    // 96×64 sheet, 3 cols × 2 rows, each frame 32×32. 6-frame looping portal.
    this.load.spritesheet('demon-portal', 'assets/sprites/demon_portal.png', { frameWidth: 32, frameHeight: 32 })

    // ── Game-jam portal (MainMenu hyperlink to the jam lobby) ────────────
    // 96×64 sheet, 3 cols × 2 rows, each frame 32×32. 6-frame looping portal.
    this.load.spritesheet('jam-portal', 'assets/sprites/jam_portal.png', { frameWidth: 32, frameHeight: 32 })

    // ── VFX: Hit Spark (damage-type-coded combat impact) ─────────────────
    // 896×576 sheet, 14 cols × 9 rows, each frame 64×64. One row per color
    // variant (mapped to damage types in HitSparkSystem). Plays once on
    // every COMBAT_HIT and destroys.
    this.load.spritesheet('vfx-hit-spark', 'assets/sprites/vfx/hit-spark.png', { frameWidth: 64, frameHeight: 64 })

    // ── Traps ─────────────────────────────────────────────────────────────
    // Sheets re-baked from the raw art into clean uniform grids by
    // tools/bake-traps.mjs. Frame dims mirror assets/sprites/traps/manifest.json.
    const TRAP = 'assets/sprites/traps/'
    this.load.spritesheet('trap-arrow',           TRAP + 'arrow.png',           { frameWidth: 16,  frameHeight: 157 })
    this.load.spritesheet('trap-bomb',            TRAP + 'bomb.png',            { frameWidth: 48,  frameHeight: 48  })
    this.load.spritesheet('trap-cannon-up',       TRAP + 'cannon-up.png',       { frameWidth: 16,  frameHeight: 100 })
    this.load.spritesheet('trap-cannon-down',     TRAP + 'cannon-down.png',     { frameWidth: 16,  frameHeight: 123 })
    this.load.spritesheet('trap-cannon-left',     TRAP + 'cannon-left.png',     { frameWidth: 128, frameHeight: 32  })
    this.load.spritesheet('trap-cannon-right',    TRAP + 'cannon-right.png',    { frameWidth: 127, frameHeight: 32  })
    this.load.spritesheet('trap-dragon-ud',       TRAP + 'dragon-ud.png',       { frameWidth: 32,  frameHeight: 76  })
    this.load.spritesheet('trap-dragon-rl',       TRAP + 'dragon-rl.png',       { frameWidth: 96,  frameHeight: 32  })
    this.load.spritesheet('trap-spike-pillar',    TRAP + 'spike-pillar.png',    { frameWidth: 48,  frameHeight: 64  })
    this.load.spritesheet('trap-spike-pit',       TRAP + 'spike-pit.png',       { frameWidth: 48,  frameHeight: 32  })
    this.load.spritesheet('trap-rotating-blades', TRAP + 'rotating-blades.png', { frameWidth: 48,  frameHeight: 48  })
    this.load.spritesheet('trap-saw-h',           TRAP + 'saw-h.png',           { frameWidth: 70,  frameHeight: 32  })
    this.load.spritesheet('trap-saw-v',           TRAP + 'saw-v.png',           { frameWidth: 16,  frameHeight: 64  })

    // ── Items: lock / key / key chest ────────────────────────────────────
    // Padlock + key are 16×16 single-frame icons. Key chest is a 29×61
    // sheet — two frames (closed on top, open on bottom) of 29×30 with a
    // 1-pixel separator row. Frame 0 = closed, frame 1 = opened.
    this.load.image('item-padlock', 'assets/sprites/items/padlock.png')
    this.load.image('item-key',     'assets/sprites/items/key.png')
    this.load.spritesheet('item-key-chest',
      'assets/sprites/items/key_chest.png',
      { frameWidth: 29, frameHeight: 30, spacing: 1 })

    // ── Items: Soul-Bound Beacon + Healing Fountain (Phase C) ───────────
    // Beacon: 47×144 sheet, 3 frames stacked vertically (47×48 each).
    // Pulsing stone monolith — looped at 4 fps.
    this.load.spritesheet('item-soul-beacon',
      'assets/sprites/items/soul_bound_beacon.png',
      { frameWidth: 47, frameHeight: 48 })
    // Fountain: 288×64 sheet, 6 frames horizontal (48×64 each).
    // Cascading water — looped at 8 fps.
    this.load.spritesheet('item-healing-fountain',
      'assets/sprites/items/healing_fountain.png',
      { frameWidth: 48, frameHeight: 64 })

    // Floating gold-coin icon shown above adventurers carrying stolen
    // treasure (Phase D). 24×26 single-frame image.
    this.load.image('item-gold-coins', 'assets/sprites/items/gold_coins.png')

    // Pixel-art accent diamond shared by every panel header / popup
    // ornament. 18×26 single-frame; pixelDiamond() in UIKit swaps it in
    // for the procedural rhombus when the texture is loaded.
    this.load.image('ui-diamond', 'assets/sprites/items/diamond.png')

    // ── Items: Treasure Chests (Phase D) ─────────────────────────────────
    // 10 tiers, each a 31×128 sheet of 4 frames (31×32 each):
    // closed → cracking → opening → fully open. Frame 0 = idle (closed),
    // frames 1–3 = one-shot open animation, holds frame 3 after.
    for (let tier = 1; tier <= 10; tier++) {
      this.load.spritesheet(`item-treasure-chest-${tier}`,
        `assets/sprites/items/treasure_chest_${tier}.png`,
        { frameWidth: 31, frameHeight: 32 })
    }
  }

  create() {
    this._registerHeartAnimation()
    this._registerBossAnimations()
    this._registerMinionAnimations()
    this._registerAdventurerAnimations()
    this._registerAdventurerAttackAnimations()
    this._registerEmoteAnimations()
    this._registerDemonPortalAnimation()
    this._registerJamPortalAnimation()
    this._registerHitSparkAnimations()
    this._registerSoulBeaconAnimation()
    this._registerDarkDealDemonAnimations()
    this._registerSuccubusSpecialAnimations()
    this._registerHealingFountainAnimation()
    this._registerTreasureChestAnimations()
    // Themes load asynchronously (second loader pass for sprite PNGs); kick
    // off MainMenu once that's done. If no manifest exists, this resolves
    // immediately and the game runs with the procedural-only look.
    this._loadThemesAndStart()
  }

  _registerHeartAnimation() {
    if (this.anims.exists('heart-lose')) return
    this.anims.create({
      key:       'heart-lose',
      frames:    this.anims.generateFrameNumbers('heart-lose', { start: 0, end: 4 }),
      frameRate: 10,
      repeat:    0,
    })
  }

  // Emote bubbles — one anim per variant, 3 frames @ 4fps, looped 3 times
  // (matches EMOTE_ANIM_REPEATS in EmoteSystem so a viewer reads the bubble).
  _registerEmoteAnimations() {
    for (const variant of allEmoteVariants()) {
      const key = emoteKey(variant)
      if (!this.textures.exists(key)) continue
      if (this.anims.exists(key)) continue
      this.anims.create({
        key,
        frames:    this.anims.generateFrameNumbers(key, { start: 0, end: 2 }),
        frameRate: 4,
        repeat:    2,
      })
    }
  }

  // Read the themes manifest (if present), queue every referenced sprite PNG
  // for load, then seed ThemeManager state and transition to MainMenu. The
  // manifest itself was queued in preload() — its absence is silently
  // tolerated (cache.json.get returns undefined). Sprites that fail to load
  // (deleted file, etc.) trigger Phaser 'loaderror' and are simply absent at
  // render time; DungeonRenderer falls back to procedural for any cell whose
  // sprite texture isn't registered.
  async _loadThemesAndStart() {
    const startMain = () => this.scene.start('MainMenu')
    let ThemeManager, DecorManager
    try {
      ThemeManager = (await import('../systems/ThemeManager.js')).ThemeManager
      DecorManager = (await import('../systems/DecorManager.js')).DecorManager
    } catch (err) {
      console.warn('[Preload] manager import failed:', err)
      return startMain()
    }

    const manifest      = this.cache.json.get('themes-manifest')
    const decorManifest = this.cache.json.get('decor-manifest')

    if (!manifest && !decorManifest) return startMain()

    // Queue theme sprite PNGs.
    let queued = 0
    if (manifest?.sprites && typeof manifest.sprites === 'object') {
      for (const [id, meta] of Object.entries(manifest.sprites)) {
        const key = `themesprite-${id}`
        if (this.textures.exists(key)) continue
        const file = meta?.file || `assets/themes/sprites/${id}.png`
        this.load.image(key, file)
        queued++
      }
    }

    // Queue decor sprite PNGs (`decor-<id>` keys).
    if (Array.isArray(decorManifest)) {
      for (const entry of decorManifest) {
        if (!entry?.id || !entry?.file) continue
        const key = `decor-${entry.id}`
        if (this.textures.exists(key)) continue
        this.load.image(key, entry.file)
        queued++
      }
    }

    if (queued > 0) {
      await new Promise(resolve => {
        const done = () => { this.load.off('complete', done); resolve() }
        this.load.on('complete', done)
        this.load.start()
      })
    }

    if (manifest)      ThemeManager.load(manifest)
    if (decorManifest) DecorManager.load(decorManifest)
    startMain()
  }

  // Phaser anims are global, so define once here. Each sheet has 4 rows
  // (down/up/left/right) × N frame columns; we slice each row into its own
  // direction-specific anim. Hurt/Attack/Death are one-shot; idle/walk/run loop.
  _registerBossAnimations() {
    for (const skin of BOSS_SKINS) {
      const dirs = skin.rowDirs ?? DEFAULT_ROW_DIRS
      const fs   = skin.frameSize ?? DEFAULT_FRAME_SIZE
      for (const s of BOSS_SHEET_STATES) {
        const sheetKey = `${skin.id}-${s.key}`
        if (!this.textures.exists(sheetKey)) continue
        // Pixel-art assets blur when upscaled with the game's default LINEAR
        // filtering (antialias:true in main.js). Force NEAREST per-texture so
        // bosses stay crisp at any BOSS_SPRITE_SCALE value.
        const texture = this.textures.get(sheetKey)
        if (texture.setFilter) texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
        // Derive frame count from texture width — every boss × state pair
        // ships a different number of frames. Skins with a `states` table
        // (e.g. succubus) override frame width per-state.
        const tex = texture.source[0]
        const stateConf = skin.states?.[s.key]
        const fW = stateConf?.frameW ?? fs
        const frameCount = Math.floor(tex.width / fW)
        if (frameCount < 1) continue
        for (let row = 0; row < dirs.length; row++) {
          const start = row * frameCount
          const end   = start + frameCount - 1
          const animKey = `${sheetKey}-${dirs[row]}`
          if (this.anims.exists(animKey)) continue
          this.anims.create({
            key:       animKey,
            frames:    this.anims.generateFrameNumbers(sheetKey, { start, end }),
            frameRate: s.frameRate,
            repeat:    s.repeat,
          })
        }
      }
    }
  }

  // LPC adventurer animations — each sheet is 13 cols × 29 rows of 64×64
  // frames. Animation row blocks come from layout.json. For each variant ×
  // animation × direction we register one anim keyed
  // `adv-<class>-<vNN>-<anim>-<dir>` (or `adv-<class>-<vNN>-hurt-down` for
  // the single-direction hurt block).
  _registerAdventurerAnimations() {
    const layout = this.cache.json.get('adventurerLayout')
    if (!layout) return
    const cols = Math.floor(layout.width / layout.frame) // 13
    for (const id of ADVENTURER_CLASS_IDS) {
      for (let i = 1; i <= ADVENTURER_VARIANTS_PER_CLASS; i++) {
        const v = `v${String(i).padStart(2, '0')}`
        const key = `adv-${id}-${v}`
        if (!this.textures.exists(key)) continue
        const tex = this.textures.get(key)
        if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)

        for (const row of layout.rows) {
          const meta = ADVENTURER_ANIM_META[row.anim]
          if (!meta) continue
          const baseRow = Math.floor(row.y / layout.frame)
          if (row.dirRows === 1) {
            // hurt — single south-facing strip
            const start = baseRow * cols
            const end   = start + row.frames - 1
            const animKey = `${key}-${row.anim}-down`
            if (this.anims.exists(animKey)) continue
            this.anims.create({
              key: animKey,
              frames: this.anims.generateFrameNumbers(key, { start, end }),
              frameRate: meta.frameRate,
              repeat: meta.repeat,
            })
            continue
          }
          for (let d = 0; d < ADVENTURER_DIRS.length; d++) {
            const start = (baseRow + d) * cols
            const end   = start + row.frames - 1
            const animKey = `${key}-${row.anim}-${ADVENTURER_DIRS[d]}`
            if (this.anims.exists(animKey)) continue
            this.anims.create({
              key: animKey,
              frames: this.anims.generateFrameNumbers(key, { start, end }),
              frameRate: meta.frameRate,
              repeat: meta.repeat,
            })
          }
        }
      }
    }
  }

  // LPC adventurer attack animations — registered on the separate `_atk`
  // textures (192×192 frames, 8 cols × 8 rows). Slash anim per dir reads
  // frames 0–5 of rows 0–3; thrust per dir reads frames 0–7 of rows 4–7.
  // Anim key = `adv-<class>-<vNN>-atk-<slash|thrust>-<dir>`. Variants whose
  // _atk.png didn't load (e.g. weapon: null) are silently skipped — the
  // renderer falls back to the main texture for those.
  _registerAdventurerAttackAnimations() {
    for (const id of ADVENTURER_CLASS_IDS) {
      if (!ADVENTURER_ATK_CLASSES.has(id)) continue
      for (let i = 1; i <= ADVENTURER_VARIANTS_PER_CLASS; i++) {
        const v   = `v${String(i).padStart(2, '0')}`
        const key = `adv-${id}-${v}-atk`
        if (!this.textures.exists(key)) continue
        const tex = this.textures.get(key)
        if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)

        for (const [animName, cfg] of Object.entries(ADVENTURER_ATK_ANIM_LAYOUT)) {
          const meta = ADVENTURER_ANIM_META[animName]
          if (!meta) continue
          for (let d = 0; d < ADVENTURER_DIRS.length; d++) {
            const start   = (cfg.startRow + d) * ADVENTURER_ATK_COLS
            const end     = start + cfg.frames - 1
            const animKey = `${key}-${animName}-${ADVENTURER_DIRS[d]}`
            if (this.anims.exists(animKey)) continue
            this.anims.create({
              key: animKey,
              frames: this.anims.generateFrameNumbers(key, { start, end }),
              frameRate: meta.frameRate,
              repeat: meta.repeat,
            })
          }
        }
      }
    }
  }

  _registerDemonPortalAnimation() {
    if (!this.textures.exists('demon-portal')) return
    if (this.anims.exists('demon-portal-spin')) return
    const tex = this.textures.get('demon-portal')
    if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.anims.create({
      key:       'demon-portal-spin',
      frames:    this.anims.generateFrameNumbers('demon-portal', { start: 0, end: 5 }),
      frameRate: 8,
      repeat:    -1,
    })
  }

  _registerJamPortalAnimation() {
    if (!this.textures.exists('jam-portal')) return
    if (this.anims.exists('jam-portal-spin')) return
    const tex = this.textures.get('jam-portal')
    if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.anims.create({
      key:       'jam-portal-spin',
      frames:    this.anims.generateFrameNumbers('jam-portal', { start: 0, end: 5 }),
      frameRate: 8,
      repeat:    -1,
    })
  }

  // 9 one-shot hit-spark animations, one per color row of the 14×9 sheet.
  // HitSparkSystem picks the right key by damage type and plays it on
  // COMBAT_HIT. Frame range = 14 frames per row.
  _registerHitSparkAnimations() {
    if (!this.textures.exists('vfx-hit-spark')) return
    const tex = this.textures.get('vfx-hit-spark')
    if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
    const COLS = 14
    const ROWS = 9
    const fps = (typeof Balance !== 'undefined' && Balance.VFX_HIT_SPARK_FPS) || 28
    for (let row = 0; row < ROWS; row++) {
      const key = `vfx-hit-spark-${row}`
      if (this.anims.exists(key)) continue
      this.anims.create({
        key,
        frames:    this.anims.generateFrameNumbers('vfx-hit-spark', {
          start: row * COLS,
          end:   row * COLS + COLS - 1,
        }),
        frameRate: fps,
        repeat:    0,
      })
    }
  }

  _registerSoulBeaconAnimation() {
    if (!this.textures.exists('item-soul-beacon')) return
    if (this.anims.exists('item-soul-beacon-pulse')) return
    const tex = this.textures.get('item-soul-beacon')
    if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.anims.create({
      key:       'item-soul-beacon-pulse',
      frames:    this.anims.generateFrameNumbers('item-soul-beacon', { start: 0, end: 2 }),
      frameRate: 4,
      repeat:    -1,
    })
  }

  // Dark Deal demon — appearing (smoke→demon), idle bouncing, leaving
  // (demon→smoke). Sprite is 5 cols × 4 rows of 80px frames; rows are
  // numbered top-to-bottom so frame 0 = top-left, frame 4 = top-right,
  // frame 19 = bottom-right.
  _registerDarkDealDemonAnimations() {
    const key = 'event-dark-deal-demon'
    if (!this.textures.exists(key)) return
    const tex = this.textures.get(key)
    if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
    if (!this.anims.exists('event-dark-deal-demon-appear')) {
      this.anims.create({
        key:       'event-dark-deal-demon-appear',
        frames:    this.anims.generateFrameNumbers(key, { start: 0, end: 4 }),
        frameRate: 8,
        repeat:    0,
      })
    }
    // Idle uses the two middle rows (frames 5-14) so the demon has some
    // body language while the player decides.
    if (!this.anims.exists('event-dark-deal-demon-idle')) {
      this.anims.create({
        key:       'event-dark-deal-demon-idle',
        frames:    this.anims.generateFrameNumbers(key, { start: 5, end: 14 }),
        frameRate: 6,
        repeat:    -1,
      })
    }
    if (!this.anims.exists('event-dark-deal-demon-leave')) {
      this.anims.create({
        key:       'event-dark-deal-demon-leave',
        frames:    this.anims.generateFrameNumbers(key, { start: 15, end: 19 }),
        frameRate: 8,
        repeat:    0,
      })
    }
  }

  // Succubus specials — bat-form (4 directions × 4 frames), boss transform
  // anim (2 directions × 2 frames), and one-shot smoke puff (6 frames).
  // Bat directional anims are keyed by row order LD/RD/LU/RU. The boss
  // mid-day "Bat-Form Seduction" sequence stitches them together with the
  // smoke overlay played at start + end.
  _registerSuccubusSpecialAnimations() {
    // Bat — 4×4 sheet, rows = LD/RD/LU/RU, 4 flap frames each
    const batKey = 'succubus-bat'
    if (this.textures.exists(batKey)) {
      const tex = this.textures.get(batKey)
      if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
      const dirs = ['ld', 'rd', 'lu', 'ru']
      for (let i = 0; i < dirs.length; i++) {
        const k = batKey + '-' + dirs[i]
        if (this.anims.exists(k)) continue
        this.anims.create({
          key:       k,
          frames:    this.anims.generateFrameNumbers(batKey, { start: i * 4, end: i * 4 + 3 }),
          frameRate: 12,
          repeat:    -1,
        })
      }
    }
    // Boss transform — 2×2 sheet. Top row (frames 0-1) = facing right,
    // bottom row (frames 2-3) = facing left. Played once when the boss
    // shifts into the bat-swarm and again when she returns.
    const trKey = 'succubus-transform'
    if (this.textures.exists(trKey)) {
      const tex = this.textures.get(trKey)
      if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
      if (!this.anims.exists('succubus-transform-right')) {
        this.anims.create({
          key:       'succubus-transform-right',
          frames:    this.anims.generateFrameNumbers(trKey, { start: 0, end: 1 }),
          frameRate: 6,
          repeat:    0,
        })
      }
      if (!this.anims.exists('succubus-transform-left')) {
        this.anims.create({
          key:       'succubus-transform-left',
          frames:    this.anims.generateFrameNumbers(trKey, { start: 2, end: 3 }),
          frameRate: 6,
          repeat:    0,
        })
      }
    }
    // Smoke puff — 6-frame one-shot, plays under the transform sprite.
    const smKey = 'succubus-transform-smoke'
    if (this.textures.exists(smKey)) {
      const tex = this.textures.get(smKey)
      if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
      if (!this.anims.exists('succubus-transform-smoke-puff')) {
        this.anims.create({
          key:       'succubus-transform-smoke-puff',
          frames:    this.anims.generateFrameNumbers(smKey, { start: 0, end: 5 }),
          frameRate: 12,
          repeat:    0,
        })
      }
    }
  }

  _registerHealingFountainAnimation() {
    if (!this.textures.exists('item-healing-fountain')) return
    if (this.anims.exists('item-healing-fountain-flow')) return
    const tex = this.textures.get('item-healing-fountain')
    if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.anims.create({
      key:       'item-healing-fountain-flow',
      frames:    this.anims.generateFrameNumbers('item-healing-fountain', { start: 0, end: 5 }),
      frameRate: 8,
      repeat:    -1,
    })
  }

  _registerTreasureChestAnimations() {
    // One-shot 4-frame open per tier: frame 0 = closed (idle), frames 1–3
    // play on open and hold on the last frame. Renderer drives playback;
    // we just register the anims here so they exist in the global pool.
    for (let tier = 1; tier <= 10; tier++) {
      const texKey  = `item-treasure-chest-${tier}`
      const animKey = `${texKey}-open`
      if (!this.textures.exists(texKey)) continue
      if (this.anims.exists(animKey)) continue
      const tex = this.textures.get(texKey)
      if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
      this.anims.create({
        key:       animKey,
        frames:    this.anims.generateFrameNumbers(texKey, { start: 0, end: 3 }),
        frameRate: 10,
        repeat:    0,
      })
    }
  }

  // Mirror of _registerBossAnimations for minion sheets. Same row order
  // (down/up/left/right) — no minion has a swapped layout right now.
  _registerMinionAnimations() {
    for (const id of MINION_IDS) {
      const fs = MINION_FRAMES_128.has(id) ? 128 : 64
      for (const s of MINION_SHEET_STATES) {
        const sheetKey = `minion-${id}-${s.key}`
        if (!this.textures.exists(sheetKey)) continue
        const texture = this.textures.get(sheetKey)
        if (texture.setFilter) texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
        const tex = texture.source[0]
        const frameCount = Math.floor(tex.width / fs)
        if (frameCount < 1) continue
        for (let row = 0; row < DEFAULT_ROW_DIRS.length; row++) {
          const start   = row * frameCount
          const end     = start + frameCount - 1
          const animKey = `${sheetKey}-${DEFAULT_ROW_DIRS[row]}`
          if (this.anims.exists(animKey)) continue
          this.anims.create({
            key:       animKey,
            frames:    this.anims.generateFrameNumbers(sheetKey, { start, end }),
            frameRate: s.frameRate,
            repeat:    s.repeat,
          })
        }
      }
    }
  }

}
