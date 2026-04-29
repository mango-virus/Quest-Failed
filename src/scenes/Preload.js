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
    this.load.json('trapTypes',         'src/data/trapTypes.json')
    this.load.json('lootDefinitions',   'src/data/lootDefinitions.json')
    this.load.json('adventurerClasses', 'src/data/adventurerClasses.json')
    this.load.json('lastWords',         'src/data/lastWords.json')
    this.load.json('chatLines',         'src/data/chatLines.json')
    this.load.json('bossAbilities',     'src/data/bossAbilities.json')

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

    // Per-boss portrait images for the COMPENDIUM grid slots. Each is a 22×22
    // pixel-art bust. Bosses without a portrait file (lich) fall back to the
    // procedural silhouette in ArchetypeSelect.
    // Per-boss bestiary art keys: 22×22 portraits, name banners, and full
    // body images now exist for all 10 bosses.
    const ALL_BOSSES = ['beholder', 'demon', 'gnoll', 'golem', 'lich', 'lizardman', 'myconid', 'orc', 'vampire', 'wraith']
    for (const id of ALL_BOSSES) {
      this.load.image(`bestiary-portrait-${id}`, BEST + `portraits/${id}_p.png`)
      this.load.image(`bestiary-name-${id}`,     BEST + `names/${id}_n.png`)
      this.load.image(`bestiary-full-${id}`,     BEST + `full/${id}.png`)
    }
    // Decorative red-and-gold banner that holds the boss name on the right page.
    this.load.image('bestiary-nameplate', BEST + 'names/name_plate.png')

    // Boss sprite sheets — craftpix.net 4-direction monster pack ("In use" set).
    // Texture key per state = `<archetypeId>-<state>`; BossRenderer keys by id.
    for (const skin of BOSS_SKINS) {
      const folder = `assets/sprites/${skin.id}/`
      const fs = skin.frameSize ?? DEFAULT_FRAME_SIZE
      for (const s of BOSS_SHEET_STATES) {
        this.load.spritesheet(`${skin.id}-${s.key}`, folder + `${skin.prefix}_${s.file}_with_shadow.png`, { frameWidth: fs, frameHeight: fs })
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
  }

  create() {
    this._registerBossAnimations()
    this._registerMinionAnimations()
    this.scene.start('MainMenu')
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
        // ships a different number of frames.
        const tex = texture.source[0]
        const frameCount = Math.floor(tex.width / fs)
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
