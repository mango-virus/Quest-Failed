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
  'cartographer_scholar', 'cosplay_adventurer', 'templar', 'pirate', 'miner', 'valkyrie', 'peasant', 'gladiator', 'gambler',
  // Sung Jinwoo (Solo Leveling) — single canonical variant; see the count
  // override below so we don't request v02..v50.
  'shadow_monarch',
  // Light Party event classes — must mirror Preload.js's ADVENTURER_CLASS_IDS
  // or the atk-sheet streamer skips them and the slash/thrust anims fall back
  // to the compressed 64x64 base sheet permanently.
  'paladin', 'white_mage', 'samurai', 'black_mage',
  // Aldric (KR Nemesis) — 4 per-act forms; longsword slash_oversize atk sheets.
  'aldric',
  // KR Kingdom-Response champions — named one-offs (1 variant each), pinned via
  // spriteVariant in DayPhase.
  'champion_garreth',
]
const ADVENTURER_ATK_CLASSES = new Set([
  'knight', 'rogue', 'barbarian', 'twitch_streamer', 'beast_master',
  'mage', 'cleric', 'necromancer', 'ranger', 'bard',
  'cosplay_adventurer',
  // Templar — slash_oversize Mace/Flail/Longsword; the swing lives in the atk sheet.
  'templar',
  // Pirate — slash_oversize cutlasses (Saber/Scimitar/Rapier).
  'pirate',
  // Miner (pickaxe slash_128) + Valkyrie (longsword slash_oversize, spear
  // thrust_oversize + walk_128 carry sheet).
  'miner', 'valkyrie',
  // Peasant — Scythe slash_oversize; Spear/Thrust-tool contained thrust baked
  // into the atk thrust row.
  'peasant',
  // Gladiator — gladius (Arming Sword slash_128 / Saber slash_oversize).
  'gladiator',
  // Gambler — Rapier (slash_oversize) + Cane (contained thrust in the atk thrust
  // row); Dagger is normal-attack (no atk sheet).
  'gambler',
  // Jinwoo's Saber swing only exists as 192×192 slash_oversize art — the atk
  // sheet is what makes his blade visible mid-attack.
  'shadow_monarch',
  // Light Party event classes — paladin/samurai slash_oversize blades,
  // white_mage/black_mage thrust_oversize staves. Same loader contract.
  'paladin', 'white_mage', 'samurai', 'black_mage',
  // Aldric — longsword swordsman; his swing is slash_oversize (the 64px base row
  // clips the blade away, so without this his sword is invisible mid-attack).
  'aldric',
  // Sir Garreth (All-Stars champion) — Longsword slash_oversize.
  'champion_garreth',
])
// Weapons whose attack is the standard 64×64 slash (contained, shield-up
// "normal" swing) rather than the oversize 192×192 arc. Variants wielding one
// have no `_atk.png` baked, so we must NOT request it here (else a 404 per
// variant) — the renderer falls back to the base slash row. Dagger has its own
// 64px base slash, so it skips the oversize atk sheet. MUST stay in sync with
// the same set in bake-weapons.cjs.
const NORMAL_ATTACK_WEAPONS = new Set(['Dagger', 'Club'])
const ADVENTURER_VARIANTS_PER_CLASS = 100
// Per-class override for classes that ship fewer than the default 100 baked
// variants — named one-offs (shadow_monarch) + the Light Party classes trimmed
// to their single canonical v01. Keeps the loader from firing missing-file
// requests (which would 404). MUST match the actual bake counts (and Preload).
const ADVENTURER_VARIANT_COUNT = {
  shadow_monarch: 1,
  paladin: 1, white_mage: 1, samurai: 1, black_mage: 1,
  aldric: 4,
  champion_garreth: 1,
}
const advVariantCount = (id) => ADVENTURER_VARIANT_COUNT[id] ?? ADVENTURER_VARIANTS_PER_CLASS
const ADVENTURER_ATK_FRAME = 192
const ADVENTURER_ATK_COLS  = 8
// Oversize CARRY sheet (_walk128) — 128px walk block (9 frames × 4 dirs) for
// polearms whose LPC walk is a `walk_128` animation (dragon/long spear, trident).
// Walk/idle/run render from this so the long shaft shows at native size.
const CARRY_WALK_WEAPONS = new Set(['Dragon spear', 'Long spear', 'Trident'])
const ADVENTURER_CARRY_FRAME = 128
const ADVENTURER_CARRY_COLS  = 9
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

  // Per-variant weapon lookup from the manifest — used to skip atk-sheet
  // requests for normal-attack weapons (no _atk.png is baked for those).
  // Defensive: if the manifest isn't cached, weaponOf stays empty and every
  // variant is requested (the prior behaviour).
  const manifest = scene.cache?.json?.get('adventurerManifest')
  const weaponOf = {}
  if (manifest?.variants) {
    for (const [cid, list] of Object.entries(manifest.variants)) {
      for (const vv of list) weaponOf[`${cid}/${vv.id}`] = vv.weapon
    }
  }

  for (const id of ADVENTURER_CLASS_IDS) {
    if (!ADVENTURER_ATK_CLASSES.has(id)) continue
    for (let i = 1; i <= advVariantCount(id); i++) {
      const v   = `v${String(i).padStart(2, '0')}`
      // No atk sheet on disk for: barehanded variants (no weapon) and
      // normal-attack weapons (Dagger/Club — contained 64px base slash). Don't
      // request those (else a 404 per variant); the renderer falls back to the
      // base slash row. Aldric is a hand-authored named one-off with NO manifest
      // entry (weaponOf is empty for him) but DOES ship a slash_oversize atk sheet
      // for every form — so bypass the weapon gate for him.
      if (id !== 'aldric') {
        const wpn = weaponOf[`${id}/${v}`]
        if (!wpn || NORMAL_ATTACK_WEAPONS.has(wpn)) continue
      }
      const key = `adv-${id}-${v}-atk`
      // Skip if already loaded (Phaser's loader would warn otherwise).
      if (scene.textures.exists(key)) continue
      scene.load.spritesheet(key,
        `assets/sprites/adventurers/${id}/${v}_atk.png`,
        { frameWidth: ADVENTURER_ATK_FRAME, frameHeight: ADVENTURER_ATK_FRAME })
    }
  }

  // Oversize CARRY sheets (_walk128) — only for variants fielding a walk_128
  // polearm (dragon/long spear, trident). Skip otherwise (no file → 404).
  for (const id of ADVENTURER_CLASS_IDS) {
    if (!ADVENTURER_ATK_CLASSES.has(id)) continue
    for (let i = 1; i <= advVariantCount(id); i++) {
      const v = `v${String(i).padStart(2, '0')}`
      if (!CARRY_WALK_WEAPONS.has(weaponOf[`${id}/${v}`])) continue
      const key = `adv-${id}-${v}-walk128`
      if (scene.textures.exists(key)) continue
      scene.load.spritesheet(key,
        `assets/sprites/adventurers/${id}/${v}_walk128.png`,
        { frameWidth: ADVENTURER_CARRY_FRAME, frameHeight: ADVENTURER_CARRY_FRAME })
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
    for (let i = 1; i <= advVariantCount(id); i++) {
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

      // CARRY sheet (_walk128) anims — a 9-frame walk block per dir + a 1-frame
      // idle (frame 0). Run reuses the walk anim (renderer maps run→walk).
      const ckey = `adv-${id}-${v}-walk128`
      if (scene.textures.exists(ckey)) {
        const ctex = scene.textures.get(ckey)
        if (ctex.setFilter) ctex.setFilter(Phaser.Textures.FilterMode.NEAREST)
        for (let d = 0; d < ADVENTURER_DIRS.length; d++) {
          const base = d * ADVENTURER_CARRY_COLS
          const walkKey = `${ckey}-walk-${ADVENTURER_DIRS[d]}`
          if (!scene.anims.exists(walkKey)) {
            scene.anims.create({
              key: walkKey,
              frames: scene.anims.generateFrameNumbers(ckey, { start: base, end: base + ADVENTURER_CARRY_COLS - 1 }),
              frameRate: 9, repeat: -1,
            })
          }
          const idleKey = `${ckey}-idle-${ADVENTURER_DIRS[d]}`
          if (!scene.anims.exists(idleKey)) {
            scene.anims.create({
              key: idleKey,
              frames: scene.anims.generateFrameNumbers(ckey, { start: base, end: base }),
              frameRate: 1, repeat: -1,
            })
          }
        }
      }
    }
  }
}
