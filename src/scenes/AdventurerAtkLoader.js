// On-demand loader for adventurer attack spritesheets.
//
// LPC adventurers ship with a separate _atk.png per variant (192×192 frames so
// long weapons render at native scale) + a _walk128.png carry sheet for some
// polearms. There are ~650 of these across all classes × variants. They used to
// be bulk-streamed on the title screen (Preload skipped them to keep cold-boot
// fast), but decoding/GPU-uploading all ~650 on the main thread lagged the menu.
//
// Now they load ON-DEMAND, a few files at a time: AdventurerRenderer calls
// `requestAdvAtkSheet(scene, baseKey)` the first time an adventurer of a given
// variant needs its oversize sheet, so only the handful of variants actually in
// a run get fetched. Until a sheet lands the renderer falls back to the 64×64
// base slash/thrust, so it stays visually graceful (anims look slightly
// compressed for a beat, then upgrade once the sheet + its anims register).

const ADVENTURER_CLASS_IDS = [
  'knight', 'rogue', 'mage', 'cleric', 'necromancer', 'ranger',
  'beast_master', 'barbarian', 'monk', 'bard',
  'cartographer_scholar', 'cosplay_adventurer', 'templar', 'pirate', 'miner', 'valkyrie', 'peasant', 'gladiator', 'gambler',
  // Tank / blade-DPS / healer / caster-DPS support classes (1 variant each).
  'paladin', 'samurai', 'priest', 'sorcerer',
  // Aldric (KR Nemesis) — 4 per-act forms; longsword slash_oversize atk sheets.
  'aldric',
  // KR Kingdom-Response champions — named one-offs (1 variant each), pinned via
  // spriteVariant in DayPhase.
  'champion_garreth', 'champion_necrarch', 'champion_vane', 'champion_mordrake', 'champion_velloran', 'champion_aurelia', 'champion_halric',
  // All-Stars with an _atk sheet: Auberon (Longsword) + Mortessa (staff cast). Kael
  // (barehanded) + Rourke (standard spear) have no _atk, so they're not listed here.
  'champion_auberon', 'champion_mortessa',
]
const ADVENTURER_ATK_CLASSES = new Set([
  'knight', 'rogue', 'barbarian', 'beast_master',
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
  // Paladin/Samurai — slash_oversize blades; Priest/Sorcerer — thrust_oversize staves.
  'paladin', 'samurai', 'priest', 'sorcerer',
  // Aldric — longsword swordsman; his swing is slash_oversize (the 64px base row
  // clips the blade away, so without this his sword is invisible mid-attack).
  'aldric',
  // Garreth (Longsword) · Necrarch (Scythe) · Vane (Scimitar) — all slash_oversize.
  'champion_garreth', 'champion_necrarch', 'champion_vane', 'champion_mordrake', 'champion_velloran', 'champion_aurelia', 'champion_halric',
  // All-Stars with an _atk sheet: Auberon (Longsword) + Mortessa (staff cast). Kael
  // (barehanded) + Rourke (standard spear) have no _atk, so they're not listed here.
  'champion_auberon', 'champion_mortessa',
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
// variants — named one-offs trimmed to their canonical variant count. Keeps the
// loader from firing missing-file requests (which would 404). MUST match the
// actual bake counts (and Preload).
const ADVENTURER_VARIANT_COUNT = {
  aldric: 4,
  paladin: 1, samurai: 1, priest: 1, sorcerer: 1,
  champion_garreth: 1, champion_necrarch: 1, champion_vane: 1, champion_mordrake: 1, champion_velloran: 1, champion_aurelia: 1, champion_halric: 1,
  champion_auberon: 1, champion_mortessa: 1,
}
const advVariantCount = (id) => ADVENTURER_VARIANT_COUNT[id] ?? ADVENTURER_VARIANTS_PER_CLASS
const ADVENTURER_ATK_FRAME = 192
const ADVENTURER_ATK_COLS  = 8
// Oversize CARRY sheet (_walk128) — 128px walk block (9 frames × 4 dirs) for
// polearms whose LPC walk is a `walk_128` animation (dragon/long spear, trident).
// Walk/idle/run render from this so the long shaft shows at native size.
// Scimitar + Katana are walk_128-ONLY (no 64px walk layer) → they MUST carry-
// render or the blade is invisible while walking. Polearms carry for shaft
// length. MUST match the same set in AdventurerRenderer.js + bake-weapons.cjs.
const CARRY_WALK_WEAPONS = new Set(['Dragon spear', 'Long spear', 'Trident', 'Scimitar', 'Katana'])
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

// ── On-demand, throttled per-variant loading ───────────────────────────────
// Replaces the old bulk title-screen prewarm. That prewarm streamed ~650 sheets
// the moment you sat on the menu and decoded/GPU-uploaded each on the main
// thread, which is what made the menu lag. Now the renderer asks for a single
// variant's atk/carry sheet the first time an adventurer of that variant needs
// it (requestAdvAtkSheet) — so only the handful of variants actually in play get
// loaded, a few files at a time. Until a sheet lands the renderer falls back to
// the 64px base slash/thrust, so it stays visually graceful.

const ATK_MAX_INFLIGHT = 3            // throttle: at most N sheet files fetching at once
let   _atkScene    = null             // scene whose loader we've wired
let   _atkInFlight = 0                // files currently downloading
const _atkPending  = new Set()        // base keys queued / loading (dedupe)
const _atkDone     = new Set()        // base keys fully resolved (nothing left to fetch)
const _atkQueue    = []               // [{ id, v, baseKey, needAtk, needCarry }] awaiting a slot
let   _atkWeaponOf = null             // manifest weapon lookup, cached

function _weaponLookup(scene) {
  if (_atkWeaponOf) return _atkWeaponOf
  const manifest = scene.cache?.json?.get('adventurerManifest')
  // Manifest not loaded yet — return an empty lookup but DON'T cache it, or every
  // later call is permanently stuck with "no weapon" (→ no _atk sheet ever loads).
  if (!manifest?.variants) return {}
  _atkWeaponOf = {}
  for (const [cid, list] of Object.entries(manifest.variants)) {
    for (const vv of list) _atkWeaponOf[`${cid}/${vv.id}`] = vv.weapon
  }
  return _atkWeaponOf
}

// 'adv-<classId>-<vNN>' → { id, v }. classId uses underscores (beast_master,
// champion_garreth); the variant is always the trailing 'vNN',
// so split on the LAST hyphen.
function _parseBaseKey(baseKey) {
  if (typeof baseKey !== 'string' || !baseKey.startsWith('adv-')) return null
  const body = baseKey.slice(4)
  const i = body.lastIndexOf('-')
  if (i < 0) return null
  const id = body.slice(0, i), v = body.slice(i + 1)
  return /^v\d+$/.test(v) ? { id, v } : null
}
function _parseAtkKey(key) {
  const m = /^adv-(.+)-(v\d+)-(?:atk|walk128)$/.exec(key || '')
  return m ? { id: m[1], v: m[2] } : null
}

// Whether a variant wants an atk / carry sheet at all (the weapon gates from the
// old bulk loader — barehanded + Dagger/Club have no _atk.png; only walk_128
// polearms ship a _walk128). Aldric is a named one-off with no manifest entry
// but always ships a slash_oversize atk sheet.
function _wantSheets(scene, id, v) {
  const wpn = _weaponLookup(scene)[`${id}/${v}`]
  return {
    atk:   (id === 'aldric') || (!!wpn && !NORMAL_ATTACK_WEAPONS.has(wpn)),
    carry: CARRY_WALK_WEAPONS.has(wpn),
  }
}

// Called by the renderer when an adventurer needs its oversize sheet. `baseKey`
// is the variant's base LPC texture key, e.g. 'adv-knight-v03'. Cheap no-op once
// the variant is resolved (loaded or nothing to load), so per-frame calls are fine.
export function requestAdvAtkSheet(scene, baseKey) {
  if (!scene?.load || typeof baseKey !== 'string') return
  // New scene (a fresh run) — drop stale in-flight bookkeeping and re-wire the
  // per-file hooks on the new scene's loader. `_atkDone` persists: textures +
  // anims live at the game level, so a variant resolved last run stays resolved.
  if (_atkScene !== scene) {
    _atkScene = scene
    _atkInFlight = 0
    _atkPending.clear()
    _atkQueue.length = 0
    scene.load.on(Phaser.Loader.Events.FILE_COMPLETE, _onAtkFile)
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, _onAtkErr)
  }
  if (_atkDone.has(baseKey) || _atkPending.has(baseKey)) return
  const parsed = _parseBaseKey(baseKey)
  if (!parsed) { _atkDone.add(baseKey); return }
  const { id, v } = parsed
  if (!ADVENTURER_ATK_CLASSES.has(id)) { _atkDone.add(baseKey); return }
  // Manifest not loaded yet → we can't classify the weapon. Bail WITHOUT marking
  // the variant done, so a later call (once the manifest lands) resolves it.
  if (!scene.cache?.json?.get('adventurerManifest')?.variants) return
  const want = _wantSheets(scene, id, v)
  const needAtk   = want.atk   && !scene.textures.exists(`${baseKey}-atk`)
  const needCarry = want.carry && !scene.textures.exists(`${baseKey}-walk128`)
  if (!needAtk && !needCarry) {
    // Nothing to fetch (no oversize sheet for this weapon, or already loaded).
    // Register whatever's present + mark done so we don't re-check every frame.
    registerVariantAtkAnims(scene, id, v)
    _atkDone.add(baseKey)
    return
  }
  _atkPending.add(baseKey)
  _atkQueue.push({ id, v, baseKey, needAtk, needCarry })
  _pumpAtk(scene)
}

function _onAtkFile(key) {
  const p = _parseAtkKey(key)
  if (!p || !_atkScene) return
  registerVariantAtkAnims(_atkScene, p.id, p.v)
  _atkInFlight = Math.max(0, _atkInFlight - 1)
  const baseKey = `adv-${p.id}-${p.v}`
  const want = _wantSheets(_atkScene, p.id, p.v)
  const atkOk   = !want.atk   || _atkScene.textures.exists(`${baseKey}-atk`)
  const carryOk = !want.carry || _atkScene.textures.exists(`${baseKey}-walk128`)
  if (atkOk && carryOk) { _atkDone.add(baseKey); _atkPending.delete(baseKey) }
  _pumpAtk(_atkScene)
}
function _onAtkErr(file) {
  const p = _parseAtkKey(file?.key || '')
  if (!p) return
  _atkInFlight = Math.max(0, _atkInFlight - 1)
  // A missing file (404) shouldn't wedge the queue or re-request forever.
  _atkPending.delete(`adv-${p.id}-${p.v}`)
  _atkDone.add(`adv-${p.id}-${p.v}`)
  if (_atkScene) _pumpAtk(_atkScene)
}

function _pumpAtk(scene) {
  let started = false
  while (_atkInFlight < ATK_MAX_INFLIGHT && _atkQueue.length) {
    const job = _atkQueue.shift()
    const { id, v } = job
    const atkKey = `adv-${id}-${v}-atk`, carryKey = `adv-${id}-${v}-walk128`
    let added = 0
    if (job.needAtk && !scene.textures.exists(atkKey)) {
      scene.load.spritesheet(atkKey, `assets/sprites/adventurers/${id}/${v}_atk.png`,
        { frameWidth: ADVENTURER_ATK_FRAME, frameHeight: ADVENTURER_ATK_FRAME }); added++
    }
    if (job.needCarry && !scene.textures.exists(carryKey)) {
      scene.load.spritesheet(carryKey, `assets/sprites/adventurers/${id}/${v}_walk128.png`,
        { frameWidth: ADVENTURER_CARRY_FRAME, frameHeight: ADVENTURER_CARRY_FRAME }); added++
    }
    if (added === 0) {
      // Already present (raced in) — resolve + don't count against the cap.
      registerVariantAtkAnims(scene, id, v)
      _atkDone.add(job.baseKey); _atkPending.delete(job.baseKey)
      continue
    }
    _atkInFlight += added
    started = true
  }
  if (started) scene.load.start()
}

// Register the slash/thrust (+ carry walk/idle) anims for ONE variant. Idempotent
// (guarded by textures/anims existence), so it's safe to call repeatedly.
export function registerVariantAtkAnims(scene, id, v) {
  const key = `adv-${id}-${v}-atk`
  if (scene.textures.exists(key)) {
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

  // CARRY sheet (_walk128) anims — a 9-frame walk block per dir + a 1-frame idle
  // (frame 0). Run reuses the walk anim (renderer maps run→walk).
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
