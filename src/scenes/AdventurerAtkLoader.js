// Background loader for adventurer attack spritesheets.
//
// LPC adventurers ship with a separate _atk.png per variant (192×192
// frames so long weapons render at native scale). That's ~650 file
// requests — historically the dominant chunk of cold-start load time.
//
// To keep the title screen snappy, Preload no longer queues these in
// its preload phase. Instead, MainMenu calls `kickOffAdventurerAtkLoad`
// from its create() so the sheets stream in while the player is on the
// title screen. AdventurerRenderer falls back to the main 64×64 sheet
// for slash/thrust animations if a particular atk sheet hasn't loaded
// yet, so an early "Start Run" is visually graceful — combat anims
// look slightly compressed for a moment, then upgrade once the sheets
// land in the cache.

const ADVENTURER_CLASS_IDS = [
  'knight', 'rogue', 'mage', 'cleric', 'necromancer', 'ranger',
  'twitch_streamer', 'beast_master', 'barbarian', 'monk', 'bard',
  'cartographer_scholar', 'cosplay_adventurer',
]
const ADVENTURER_ATK_CLASSES = new Set([
  'knight', 'rogue', 'barbarian', 'twitch_streamer', 'beast_master',
  'mage', 'cleric', 'necromancer', 'ranger', 'bard',
  'cosplay_adventurer',
])
const ADVENTURER_VARIANTS_PER_CLASS = 50
const ADVENTURER_ATK_FRAME = 192
const ADVENTURER_ATK_COLS  = 8
const ADVENTURER_ATK_ANIM_LAYOUT = {
  slash:  { startRow: 0, frames: 6 },
  thrust: { startRow: 4, frames: 8 },
}
// LPC dirs in atk sheet: rows are N / W / S / E within each anim block.
const ADVENTURER_DIRS = ['up', 'left', 'down', 'right']
const ADVENTURER_ANIM_META = {
  slash:  { frameRate: 18, repeat: 0 },
  thrust: { frameRate: 14, repeat: 0 },
}

// Idempotent — calling twice on the same scene is harmless because
// loadingStarted gets set on the scene the first time.
export function kickOffAdventurerAtkLoad(scene) {
  if (scene._advAtkLoadStarted) return
  scene._advAtkLoadStarted = true

  for (const id of ADVENTURER_CLASS_IDS) {
    if (!ADVENTURER_ATK_CLASSES.has(id)) continue
    for (let i = 1; i <= ADVENTURER_VARIANTS_PER_CLASS; i++) {
      const v   = `v${String(i).padStart(2, '0')}`
      const key = `adv-${id}-${v}-atk`
      // Skip if already loaded (Phaser's loader would warn otherwise).
      if (scene.textures.exists(key)) continue
      scene.load.spritesheet(key,
        `assets/sprites/adventurers/${id}/${v}_atk.png`,
        { frameWidth: ADVENTURER_ATK_FRAME, frameHeight: ADVENTURER_ATK_FRAME })
    }
  }

  // When this batch finishes, register the anims so the renderer can
  // start using them. Anim registration was historically owned by
  // Preload.create(), but with deferred loading the textures aren't
  // there yet at that point — so we own anim registration here too.
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    registerAdventurerAtkAnims(scene)
  })

  scene.load.start()
}

// Public so Preload's create() can still call it for any sheets that
// happened to be cached from a previous session — and so the post-load
// callback in kickOffAdventurerAtkLoad can use the same code path.
export function registerAdventurerAtkAnims(scene) {
  for (const id of ADVENTURER_CLASS_IDS) {
    if (!ADVENTURER_ATK_CLASSES.has(id)) continue
    for (let i = 1; i <= ADVENTURER_VARIANTS_PER_CLASS; i++) {
      const v   = `v${String(i).padStart(2, '0')}`
      const key = `adv-${id}-${v}-atk`
      if (!scene.textures.exists(key)) continue
      const tex = scene.textures.get(key)
      if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)

      for (const [animName, cfg] of Object.entries(ADVENTURER_ATK_ANIM_LAYOUT)) {
        const meta = ADVENTURER_ANIM_META[animName]
        if (!meta) continue
        for (let d = 0; d < ADVENTURER_DIRS.length; d++) {
          const start   = (cfg.startRow + d) * ADVENTURER_ATK_COLS
          const end     = start + cfg.frames - 1
          const animKey = `${key}-${animName}-${ADVENTURER_DIRS[d]}`
          if (scene.anims.exists(animKey)) continue
          scene.anims.create({
            key: animKey,
            frames: scene.anims.generateFrameNumbers(key, { start, end }),
            frameRate: meta.frameRate,
            repeat: meta.repeat,
          })
        }
      }
    }
  }
}
