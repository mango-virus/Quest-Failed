// On-demand base-sheet loader.
//
// The 64×64 base adventurer spritesheets (`adv-<class>-vNN`) are ~228MB across
// ~2221 PNGs — by far the biggest chunk of the cold-start boot. Preload used to
// eager-load ALL of them (and register their anims) before the title menu could
// show, even though a single run only ever spawns a handful of variants.
//
// Now nothing base-sheet related blocks the boot. Instead the renderer calls
// `ensureAdventurerBaseSheet` the first time a given variant is needed; the sheet
// streams in the background (the adventurer renders as the procedural-circle
// fallback meanwhile) and its walk/slash/etc. anims register the moment it lands.
// AdventurerRenderer then upgrades the circle to the real sprite on the next tick
// (see `_lpcPending`). Only the variants that actually spawn ever load.
//
// Anim layout MUST match Preload's old `_registerAdventurerAnimations` (rows from
// layout.json, dirs up/left/down/right, per-anim frameRate/repeat below).

const ADVENTURER_DIRS = ['up', 'left', 'down', 'right']
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

// Register the walk/slash/thrust/... anims for one freshly-loaded base sheet.
// Idempotent (skips anims that already exist). Keys: `adv-<cls>-<vNN>-<anim>-<dir>`
// (hurt is a single south-facing strip → `...-hurt-down`).
function registerBaseAnimsForKey(scene, key) {
  const layout = scene.cache?.json?.get('adventurerLayout')
  if (!layout || !scene.textures.exists(key)) return
  const tex = scene.textures.get(key)
  if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
  const cols = Math.floor(layout.width / layout.frame) // 13
  for (const row of layout.rows) {
    const meta = ADVENTURER_ANIM_META[row.anim]
    if (!meta) continue
    const baseRow = Math.floor(row.y / layout.frame)
    if (row.dirRows === 1) {
      const start = baseRow * cols
      const end   = start + row.frames - 1
      const animKey = `${key}-${row.anim}-down`
      if (!scene.anims.exists(animKey)) {
        scene.anims.create({
          key: animKey,
          frames: scene.anims.generateFrameNumbers(key, { start, end }),
          frameRate: meta.frameRate, repeat: meta.repeat,
        })
      }
      continue
    }
    for (let d = 0; d < ADVENTURER_DIRS.length; d++) {
      const start = (baseRow + d) * cols
      const end   = start + row.frames - 1
      const animKey = `${key}-${row.anim}-${ADVENTURER_DIRS[d]}`
      if (scene.anims.exists(animKey)) continue
      scene.anims.create({
        key: animKey,
        frames: scene.anims.generateFrameNumbers(key, { start, end }),
        frameRate: meta.frameRate, repeat: meta.repeat,
      })
    }
  }
}

// Ensure the base sheet for `<cls>/<vId>` is loaded + its anims registered.
// Returns true if it's already ready; otherwise kicks a one-file stream (deduped
// via an in-flight set) and returns false. The renderer renders a circle until
// the upgrade fires. Safe to call every frame for a not-yet-loaded variant.
export function ensureAdventurerBaseSheet(scene, cls, vId) {
  if (!scene) return false
  const key = `adv-${cls}-${vId}`
  if (scene.textures.exists(key)) return true
  scene._advBaseInflight ??= new Set()
  if (scene._advBaseInflight.has(key)) return false
  scene._advBaseInflight.add(key)
  scene.load.spritesheet(key, `assets/sprites/adventurers/${cls}/${vId}.png`,
    { frameWidth: 64, frameHeight: 64 })
  scene.load.once(`filecomplete-spritesheet-${key}`, () => {
    registerBaseAnimsForKey(scene, key)
  })
  // Start the loader if it's idle. If a batch is already running, Phaser queues
  // this file onto it automatically.
  if (!scene.load.isLoading()) scene.load.start()
  return false
}
