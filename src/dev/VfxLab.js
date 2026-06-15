// VFX Lab — a dev-only isolated stage for reviewing minion/adventurer VFX and
// sprite animations in a controlled environment. Opened via __qfDev.vfxLab()
// or the dev menu. It:
//   • drops ONE frozen entity (minion OR adventurer) + a static dummy target
//     far off-grid, on a flat dark backdrop, with the camera locked on it
//   • freezes their AI (_vfxLabFrozen) so nothing moves
//   • exposes a DOM panel to fire each of the entity's abilities, force each
//     sprite-animation state, and fire raw AbilityVfx primitives — with a
//     loop toggle + slow-mo for studying motion
//
// It reuses the REAL renderers + ability handlers, so what you preview here is
// exactly what ships. Nothing here runs in normal play.

import { createMinion, applyMinionScaling } from '../entities/Minion.js'
import { createAdventurer } from '../entities/Adventurer.js'
import { MinionAbilities } from '../systems/MinionAbilities.js'
import { CLASS_ABILITIES, ABILITY_DEFS } from '../systems/ClassAbilitySystem.js'
import { AbilityVfx, VfxPalette } from '../ui/AbilityVfx.js'

const MINION_ANIMS = ['idle', 'walk', 'run', 'attack', 'hurt', 'death']
const ADV_ANIMS    = ['idle', 'walk', 'slash', 'thrust', 'spellcast', 'shoot', 'hurt', 'death']
// Grouped by toolkit so the RAW VFX panel renders under collapsible-style section
// headers (it was a single long flat grid). Each group = { label, fx: [...] }.
const RAW_VFX_GROUPS = [
  { label: 'Core',      fx: ['impactFx', 'shockwaveFx', 'glowPulseFx', 'sparkleFx', 'burnFx', 'particleBurstFx', 'pulseRing', 'juice', 'beamFx', 'projectileFx'] },
  { label: 'Brute',     fx: ['furyAura', 'soundWave', 'groundCrack', 'streakDash'] },
  { label: 'Bone',      fx: ['boneShatter', 'boneKnit', 'necroticErupt'] },
  { label: 'Gold',      fx: ['goldStamp', 'coinRain'] },
  { label: 'Slime',     fx: ['slimeSplit'] },
  { label: 'Plague',    fx: ['plagueBurst', 'contagionTendril', 'plagueCloud', 'plagueAuraFx'] },
  { label: 'Acid',      fx: ['acidSplash', 'acidGeyser', 'acidFloodFx'] },
  { label: 'Vampire',   fx: ['bloodThread', 'bloodShieldFx', 'bloodShieldHit', 'bloodFeastFx'] },
  { label: 'Rat',       fx: ['swarmBiteFx', 'verminTideFx', 'gnashFx'] },
  { label: 'Zombie',    fx: ['reanimateFx', 'massGraveFx', 'graveRotFx', 'rotAuraFx'] },
  { label: 'Demon',     fx: ['flameLickFx', 'hellfireAuraFx', 'combustFx', 'infernoFx', 'emberRiseFx', 'heatShimmerFx'] },
  { label: 'Golem',     fx: ['bulwarkFx', 'bastionFx', 'aegisShimmerFx'] },
  { label: 'Ghost',     fx: ['fearStrikeFx', 'dreadAuraFx', 'hauntCloakFx', 'pallOfDreadFx', 'panicStateFx'] },
  { label: 'Beholder',  fx: ['mesmerizeFx', 'manyEyesFx', 'tyrantGlareFx'] },
  { label: 'Gnoll',     fx: ['bleedSlashFx', 'bleedingAuraFx', 'bloodTrailFx', 'ruptureFx', 'bloodFrenzyFx'] },
  { label: 'Ent',       fx: ['thornGuardFx', 'thornLashFx', 'regrowFx', 'thornburstFx'] },
  { label: 'Lich',      fx: ['soulHarvestFx', 'soulConduitFx', 'soulStormFx', 'phylacteryShatterFx', 'phylacteryReviveFx'] },
  { label: 'Lizardman', fx: ['camouflageFx', 'camoShimmerFx', 'ambushStrikeFx', 'vanishingWarbandFx'] },
  { label: 'Imp',       fx: ['blinkFx', 'hellriftFx'] },
  { label: 'Plant',     fx: ['entangleFx', 'stranglethornFx'] },
  { label: 'Mushroom',  fx: ['dazeFx', 'sporePuffFx', 'sporeStormFx'] },
  // ── Adventurer ability VFX (bespoke per class) ──
  { label: 'Adv·Barbarian', fx: ['chargeWindupFx', 'recklessChargeFx', 'staggerHitFx'] },
  { label: 'Adv·Bard',      fx: ['crescendoFx', 'discordShatterFx', 'encoreFx'] },
  { label: 'Adv·Monk',      fx: ['focusStanceFx', 'riposteFx', 'stunningPalmFx'] },
  { label: 'Adv·Mage',      fx: ['emberBurnFx', 'frostChillFx', 'arcBoltFx', 'gustFx', 'arcaneChargeFx', 'arcaneBurstFx'] },
  { label: 'Adv·Cleric',    fx: ['healLightFx', 'resurrectionFx'] },
  { label: 'Adv·Necro',     fx: ['necroSummonFx', 'boneArmorFx'] },
  { label: 'Adv·Ranger',    fx: ['piercingArrowFx', 'disarmFx'] },
  { label: 'Adv·BeastMaster', fx: ['tameFx', 'pounceFx', 'packFlankFx'] },
  { label: 'Adv·Knight',    fx: ['bulwarkWallFx', 'tauntFx'] },
  { label: 'Adv·Peasant',   fx: ['mobFervorFx'] },
  { label: 'Adv·Miner',     fx: ['digBurstFx'] },
  { label: 'Adv·Valkyrie',  fx: ['wingedFlightFx', 'valkyrieRaiseFx'] },
  { label: 'Adv·Rogue',     fx: ['vanishSmokeFx'] },
  { label: 'Adv·Gladiator', fx: ['gladiatorBlockFx', 'crowdRoarFx'] },
  { label: 'Adv·Gambler',   fx: ['diceRoll', 'coinFlip'] },
  { label: 'Champion/Event', fx: ['lastVowFx', 'holyAegisFx', 'shadowAriseFx', 'consecrateFx'] },
  // ── Boss ability VFX (bespoke per archetype) ──
  { label: 'Boss·Orc (Trophy)', fx: ['trophyClaimFx', 'orcCleaveFx', 'shieldBashFx', 'hexboltFx', 'volleyFx', 'reaverSmiteFx', 'veteransArmoryFx', 'trophyThrowFx'] },
  { label: 'Boss·Lich (Withering)', fx: ['soulAuraFx', 'soulHarvestWispFx', 'soulChannelFx', 'deathCoilFx', 'soulSiphonFx', 'soulNovaFx', 'soulCageFx'] },
  { label: 'Boss·Slime (Mitosis)', fx: ['slimeSplitFx', 'slimeMergeFx', 'acidPuddleFx', 'slimeSurgeFx', 'slimeEngulfFx'] },
  { label: 'Boss·Beholder (Eye Tyrant)', fx: ['beholderEyeChargeFx', 'beholderRayFx_petrify', 'beholderRayFx_drain', 'beholderRayFx_hex', 'beholderRayFx_disintegrate', 'beholderRayFx_silence', 'beholderRayFx_slow', 'tyrantGazeSweepFx'] },
  { label: 'Boss·Myconid (The Bloom)', fx: ['bloomFx', 'sporeBurstFx', 'sporeVentFx', 'creepingRotFx', 'bloomFinaleFx'] },
  { label: 'Boss·Demon (Brimstone)', fx: ['infernalPactFx', 'brimstoneMeteorFx', 'pactFinaleFx', 'combustFx', 'infernoFx'] },
  { label: 'Boss·Golem (Fortress)', fx: ['seismicSlamFx', 'fissureFx', 'risePillarFx', 'golemBulwarkFx', 'collapseFx'] },
]
const PALETTE_KEYS = ['fire', 'ice', 'holy', 'shadow', 'poison', 'arcane', 'blood']

let _instance = null

export class VfxLab {
  constructor(scene) {
    this._scene = scene
    this._gs = scene.gameState
    this._open = false
    this._entity = null      // the lab entity
    this._dummy = null       // static target
    this._backdrop = null
    this._panel = null
    this._loopTimer = null
    this._lastAction = null
    this._slow = false
    this._savedCam = null
  }

  static toggle(scene) {
    if (!_instance) _instance = new VfxLab(scene)
    if (_instance._open) _instance.close(); else _instance.open()
    return _instance._open
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  open() {
    if (this._open) return
    this._open = true
    this._scene._vfxLabActive = true   // suspends Game._clampCameraToPlayArea
    this._scene._vfxLab = this          // Game.update drives our per-frame tick()
    const cam = this._scene.cameras.main
    this._savedCam = { x: cam.scrollX, y: cam.scrollY, zoom: cam.zoom }
    // The play camera is CLAMPED to the dungeon bounds (and the renderers cull
    // off-screen entities). Drop the clamp + any follow so the camera can reach
    // the off-grid stage and the lab entity stays on-screen (un-culled).
    this._savedBounds = cam.useBounds
      ? { x: cam._bounds.x, y: cam._bounds.y, w: cam._bounds.width, h: cam._bounds.height } : null
    cam.stopFollow()
    cam.removeBounds()
    // Stage coords: far BELOW the boss → off any room (void). Positive Y keeps
    // the entity's Y-sorted depth (7 + worldY*0.0005) safely ABOVE the backdrop
    // (6.9); a negative Y would sink the sprite behind it.
    const boss = this._gs.boss
    this._x = (boss?.worldX ?? 1600)
    this._y = (boss?.worldY ?? 1600) + 3000
    // Flat dark backdrop pinned to the camera so the void reads as a clean
    // stage. Depth 5 sits ABOVE the dungeon floor/decor but BELOW every entity
    // (containers Y-sort at 7 + worldY*0.0005, i.e. ≥~6), so it never occludes
    // the lab entity regardless of where it's parked. The stage is off-grid
    // void anyway, so there's no decor in view to leak through.
    this._backdrop = this._scene.add.rectangle(0, 0, this._scene.scale.width, this._scene.scale.height, 0x15111c, 1)
      .setOrigin(0).setScrollFactor(0).setDepth(5)
    cam.centerOn(this._x, this._y)
    cam.setZoom(3.2)
    this._spawn('minion', 'goblin1')
    this._buildPanel()
  }

  close() {
    if (!this._open) return
    this._open = false
    this._scene._vfxLabActive = false
    this._scene._vfxLab = null
    this._stopLoop()
    this._despawn()
    this._backdrop?.destroy(); this._backdrop = null
    if (this._panel) { this._panel.remove(); this._panel = null }
    const cam = this._scene.cameras.main
    if (this._savedBounds) cam.setBounds(this._savedBounds.x, this._savedBounds.y, this._savedBounds.w, this._savedBounds.h)
    if (this._savedCam) { cam.setZoom(this._savedCam.zoom); cam.setScroll(this._savedCam.x, this._savedCam.y) }
  }

  // ── entity spawn/despawn ─────────────────────────────────────────────────
  _removeFrom(arr, e) { if (!e || !arr) return; const i = arr.indexOf(e); if (i >= 0) arr.splice(i, 1) }

  _despawn() {
    // Sweep every lab-frozen entity AND anything spawned in the off-grid lab
    // zone (e.g. necromancer summons fired during a test) so nothing leaks into
    // the save. The dungeon sits far above the zone, so live entities are safe.
    const zone = (this._y ?? Infinity) - 1200
    const sweep = (arr) => {
      if (!arr) return
      for (let i = arr.length - 1; i >= 0; i--) {
        const x = arr[i]
        if (x?._vfxLabFrozen || (Number.isFinite(x?.worldY) && x.worldY > zone)) arr.splice(i, 1)
      }
    }
    sweep(this._gs.minions)
    sweep(this._gs.adventurers?.active)
    if (this._bossStandIn) { try { this._bossStandIn.destroy() } catch (e) {} this._bossStandIn = null }
    this._entity = null; this._dummy = null
    this._lab2ndHero = null; this._labFallen = null   // primed-precondition entities (swept above)
  }

  _spawn(kind, id) {
    this._despawn()
    this._curKind = kind; this._curId = id   // for the RESET button
    const cache = this._scene.cache.json
    // The lab entity.
    if (kind === 'minion') {
      const def = (cache.get('minionTypes') ?? []).find(d => d.id === id)
      if (!def) return
      const tile = { x: Math.round(this._x / 32), y: Math.round(this._y / 32) }
      const m = createMinion(def, tile, this._gs.boss?.assignedRoomId ?? null, { bossLevel: this._gs.boss?.level ?? 1 })
      applyMinionScaling(m, this._gs.boss?.level ?? 1, 1)
      m.worldX = this._x; m.worldY = this._y; m.tileX = tile.x; m.tileY = tile.y
      m._vfxLabFrozen = true; m._hidden = false; m.aiState = 'idle'
      this._gs.minions.push(m)
      this._entity = m
    } else if (kind === 'boss') {
      // Boss stand-in — a positioned anchor + a visible sprite so the boss's
      // bespoke throne-fight VFX can be fired from the ABILITIES section. Not
      // pushed into gs (no AI/renderer entity); we own the sprite's lifecycle.
      const tile = { x: Math.round(this._x / 32), y: Math.round(this._y / 32) }
      this._entity = {
        worldX: this._x, worldY: this._y, tileX: tile.x, tileY: tile.y,
        _vfxLabFrozen: true, aiState: 'idle', isBossStandIn: true, archId: id, color: 0xaa3322,
      }
      // Depth must clear the lab backdrop (depth 5); match the entity Y-sort band.
      const bossDepth = 7 + this._y * 0.0005
      const key = `${id}-idle`
      if (this._scene.textures.exists(key)) {
        // Center-anchor to MATCH BossRenderer (origin 0.5,0.5 at boss.worldY), so
        // a VFX fired at the entity's worldX/worldY lands on the sprite exactly
        // where it will in the real throne fight.
        this._bossStandIn = this._scene.add.sprite(this._x, this._y, key).setOrigin(0.5, 0.5).setDepth(bossDepth).setScale(1.6)
        const anim = `${id}-idle-down`
        if (this._scene.anims.exists(anim)) { try { this._bossStandIn.play(anim) } catch (e) {} }
      } else {
        this._bossStandIn = this._scene.add.circle(this._x, this._y, 24, 0xaa3322, 0.85).setStrokeStyle(2, 0xffcaa0, 0.9).setDepth(bossDepth)
      }
    } else {
      const def = (cache.get('adventurerClasses') ?? []).find(d => d.id === id)
      if (!def) return
      const tile = { x: Math.round(this._x / 32), y: Math.round(this._y / 32) }
      const a = createAdventurer(def, tile, this._gs.boss?.level ?? 1)
      a.worldX = this._x; a.worldY = this._y; a.tileX = tile.x; a.tileY = tile.y
      a._vfxLabFrozen = true; a.aiState = 'idle'; a._lpcDir = 'down'
      this._gs.adventurers.active.push(a)
      this._entity = a
    }
    this._spawnDummy()
    // Give both entities a shared ROOM context (the boss room) so room-scoped
    // abilities (auras, mass-marks, summons, contagion) can find each other.
    // Only their TILE coords sit inside the room; their WORLD coords stay
    // off-grid so they still render on the clean isolated stage.
    const room = (this._gs.dungeon?.rooms ?? []).find(r => r.instanceId === this._gs.boss?.assignedRoomId)
      ?? (this._gs.dungeon?.rooms ?? []).find(r => r.definitionId === 'boss_chamber')
      ?? (this._gs.dungeon?.rooms ?? [])[0]
    if (room) {
      const cx = room.gridX + Math.floor(room.width / 2)
      const cy = room.gridY + Math.floor(room.height / 2)
      if (this._entity) { this._entity.assignedRoomId = room.instanceId; this._entity.tileX = cx; this._entity.tileY = cy }
      if (this._dummy)  { this._dummy.assignedRoomId  = room.instanceId; this._dummy.tileX = cx + 1; this._dummy.tileY = cy }
    }
    this._setupAdvArena()
    this._refreshButtons()
    this._loopFn = null; this._loopKind = null   // don't loop a stale action onto the new entity
    // Keep the camera locked on the (re)spawned entity so switching entities
    // never leaves it off-screen (which would get it culled by the renderers).
    if (this._entity) this._scene.cameras.main.centerOn(this._entity.worldX, this._entity.worldY)
  }

  _spawnDummy() {
    this._removeFrom(this._gs.adventurers?.active, this._dummy)
    const def = (this._scene.cache.json.get('adventurerClasses') ?? []).find(d => d.id === 'knight')
    if (!def) return
    const dx = this._x + 110, dy = this._y
    const tile = { x: Math.round(dx / 32), y: Math.round(dy / 32) }
    const a = createAdventurer(def, tile, 1)
    a.worldX = dx; a.worldY = dy; a.tileX = tile.x; a.tileY = tile.y
    a._vfxLabFrozen = true; a.aiState = 'idle'; a._lpcDir = 'down'
    a.resources.hp = a.resources.maxHp = 9999  // a punching bag that won't die
    this._gs.adventurers.active.push(a)
    this._dummy = a
  }

  // ── actions ──────────────────────────────────────────────────────────────
  // For an adventurer entity, stand up a tiny fake "arena" so its class
  // abilities' combat conditions pass: a hostile minion + a wounded living ally
  // (the dummy) + a fallen ally. TILE coords sit in the entity's room (for
  // range/condition checks); WORLD coords are off-grid near the entity so the
  // VFX render on the clean stage. All tagged _vfxLabFrozen → swept on despawn.
  _setupAdvArena() {
    const e = this._entity
    if (!e || e.definitionId || e.isBossStandIn) return
    const cache = this._scene.cache.json
    const tx = e.tileX, ty = e.tileY
    // Shared party so party-scoped abilities (knight aura, bard inspire, cleric
    // heal, valkyrie/cleric revive…) can find allies.
    e.partyId = '__vfxlab'
    // Wounded living ally = the dummy: same party, fighting, ~40% HP.
    if (this._dummy) {
      this._dummy.partyId = '__vfxlab'; this._dummy.aiState = 'fighting'
      this._dummy.resources.maxHp = 100; this._dummy.resources.hp = 40
    }
    const mdef = (cache.get('minionTypes') ?? []).find(d => d.id === 'goblin1')
    if (mdef) {
      const m = createMinion(mdef, { x: tx - 1, y: ty }, e.assignedRoomId, {})
      m._vfxLabFrozen = true; m.aiState = 'idle'; m.faction = 'dungeon'
      m.tileX = tx - 1; m.tileY = ty; m.worldX = e.worldX - 90; m.worldY = e.worldY
      m.assignedRoomId = e.assignedRoomId
      this._gs.minions.push(m)
    }
    const adefs = cache.get('adventurerClasses') ?? []
    const adef = adefs.find(d => d.id === 'cleric') ?? adefs[0]
    if (adef) {
      const f = createAdventurer(adef, { x: tx + 2, y: ty }, 1)
      f._vfxLabFrozen = true; f.assignedRoomId = e.assignedRoomId; f.partyId = '__vfxlab'
      f.tileX = tx + 2; f.tileY = ty; f.worldX = e.worldX + 160; f.worldY = e.worldY
      f.resources.hp = 0; f.aiState = 'dead'; f._lpcDir = 'down'
      this._gs.adventurers.active.push(f)
    }
  }

  // ── per-frame tick (driven by Game.update while the lab is open) ──────────
  // The real MinionAISystem.update loop is idle at night, so time-based and
  // death-triggered kit (Skeleton Reassemble revival, DoTs, Goblin plunder
  // bleed) never advances in the lab. Drive those ticks here so day-combat
  // mechanics are fully reviewable. Scoped to safe, leak-free ticks: global
  // sweeps are harmless on the inert real entities, and the per-entity DoT
  // tick only touches the lab entity. (onTick auras/summons/hazards still fire
  // via their ability button — auto-running them could drop summons/hazards
  // into the real dungeon via the entity's in-room tile coords.)
  tick(delta) {
    if (!this._open) return
    const s = this._scene, gs = this._gs
    try {
      MinionAbilities.tickReassemble?.(s, gs, delta)
      MinionAbilities.tickPlunderMarks?.(s, gs, delta)
      MinionAbilities.tickVampire?.(s, gs, delta)
      MinionAbilities.tickRat?.(s, gs)
      const e = this._entity
      if (e?.definitionId) MinionAbilities.tickEntity?.(e, s, delta)
    } catch (err) { /* never let a lab tick break the frame */ }
  }

  // ☠ KILL — run the REAL death pipeline on the lab entity so death-triggered
  // abilities fire exactly as they would in combat (Skeleton Reassemble's
  // onDying interrupt, slime Split / imp aoe onDeath, …). For an adventurer
  // there's no death-ability hook, so just drop it to the death animation.
  _killEntity() {
    const e = this._entity
    if (!e) return
    if (e.definitionId) {
      e.resources.hp = 0
      const idx = this._gs.minions.indexOf(e)
      this._scene.minionAiSystem?._die?.(e, idx)
    } else {
      e.resources.hp = 0
      e.aiState = 'dead'
      this._playAnim('death')
    }
  }

  _respawnCurrent() {
    if (this._curKind && this._curId) this._spawn(this._curKind, this._curId)
  }

  // Uniform ability list — each item is { label, fire }. Minions use their JSON
  // data abilities; adventurers use their class abilities (force-fired via
  // ClassAbilitySystem.devFireAbility, with the fake arena set up in _spawn).
  _abilitiesOf(entity) {
    if (!entity) return []
    // Boss stand-in — its bespoke throne-fight abilities fire the real VFX on the
    // boss + the dummy target. Tier cycles 1→4 per press (see _orcTier) to show
    // escalation. Only the Orc is built so far; other archetypes list nothing yet.
    if (entity.isBossStandIn) {
      const e = entity
      const tX = () => this._dummy?.worldX ?? (e.worldX + 100)
      // dummy is foot-anchored → aim at its chest (−16), matching the in-game
      // BossSystem._chestY lift, so the lab preview lines up like the real fight.
      const tY = () => (this._dummy?.worldY ?? e.worldY) - 16
      const dir = () => ({ dx: tX() - e.worldX, dy: tY() - e.worldY })
      if (entity.archId === 'lich') {
        // Soul AURA level previews — see/test how the in-world aura reads at each
        // saturation (matches BossRenderer's live aura via shared helpers).
        const aura = (sat, overK, orbit) => () => AbilityVfx.soulAuraFx(this._scene, e.worldX, e.worldY, { sat, overK, orbit, sprite: this._bossStandIn, dsz: this._bossStandIn?.displayHeight || 100, durationMs: 3600 })
        return [
          { label: 'Aura: Low (25%)',  fire: aura(0.25, 0, 2) },
          { label: 'Aura: Mid (60%)',  fire: aura(0.6, 0, 4) },
          { label: 'Aura: High (95%)', fire: aura(0.95, 0, 7) },
          { label: 'Aura: OVERSOULED', fire: aura(1, 0.85, 8) },
          { label: 'Harvest Soul', fire: () => AbilityVfx.soulHarvestWispFx(this._scene, tX(), tY(), { toX: e.worldX, toY: e.worldY - 20 }) },
          { label: 'Channel Souls (day)', fire: () => AbilityVfx.soulChannelFx(this._scene, tX(), tY(), { tier: this._orcTier(), fromX: e.worldX, fromY: e.worldY, victims: [{ x: tX(), y: tY() }, { x: e.worldX - 40, y: e.worldY + 30 }] }) },
          { label: 'Death Coil', fire: () => AbilityVfx.deathCoilFx(this._scene, e.worldX, e.worldY - 10, { toX: tX(), toY: tY(), tier: this._orcTier() }) },
          { label: 'Soul Siphon', fire: () => AbilityVfx.soulSiphonFx(this._scene, e.worldX, e.worldY - 8, { tier: this._orcTier(), targets: [{ x: tX(), y: tY() }, { x: e.worldX - 90, y: e.worldY - 10 }] }) },
          { label: 'Soul Nova', fire: () => AbilityVfx.soulNovaFx(this._scene, e.worldX, e.worldY, { tier: this._orcTier() }) },
          { label: 'Soul Cage', fire: () => AbilityVfx.soulCageFx(this._scene, tX(), tY(), { tier: this._orcTier() }) },
        ]
      }
      if (entity.archId === 'slime') {
        const aura = (sat) => () => AbilityVfx.bossAuraFx(this._scene, e.worldX, e.worldY, { sat, sprite: this._bossStandIn, lo: 0x2e7d3a, hi: 0x9aff7a, durationMs: 3600 })
        return [
          { label: 'Aura: Low Mass', fire: aura(0.3) },
          { label: 'Aura: Mid Mass', fire: aura(0.65) },
          { label: 'Aura: High Mass', fire: aura(1) },
          { label: 'Split', fire: () => AbilityVfx.slimeSplitFx(this._scene, e.worldX, e.worldY, { tier: this._orcTier(), children: [{ x: e.worldX - 26, y: e.worldY + 6 }, { x: e.worldX + 26, y: e.worldY + 6 }] }) },
          { label: 'Merge', fire: () => AbilityVfx.slimeMergeFx(this._scene, e.worldX, e.worldY) },
          { label: 'Acid Puddle', fire: () => AbilityVfx.acidPuddleFx(this._scene, tX(), tY(), { tier: this._orcTier() }) },
          { label: 'Mitosis Surge', fire: () => AbilityVfx.slimeSurgeFx(this._scene, e.worldX, e.worldY, { count: 7 }) },
          { label: 'Engulf', fire: () => AbilityVfx.slimeEngulfFx(this._scene, tX(), tY() - 16, { tier: this._orcTier() }) },
        ]
      }
      if (entity.archId === 'beholder') {
        const aura = (sat) => () => AbilityVfx.bossAuraFx(this._scene, e.worldX, e.worldY, { sat, sprite: this._bossStandIn, lo: 0x3a2a6a, hi: 0xc9a6ff, durationMs: 3600 })
        const ray = (kind) => () => AbilityVfx.beholderRayFx(this._scene, e.worldX, e.worldY - 8, { toX: tX(), toY: tY(), kind, tier: this._orcTier() })
        return [
          { label: 'Aura: T1 (dim)',  fire: aura(0.25) },
          { label: 'Aura: T2 (mid)',  fire: aura(0.5) },
          { label: 'Aura: T3 (high)', fire: aura(0.75) },
          { label: 'Aura: T4 (max)',  fire: aura(1) },
          { label: 'Eye Charge (tell)', fire: () => AbilityVfx.beholderEyeChargeFx(this._scene, e.worldX, e.worldY - 8, { tier: this._orcTier() }) },
          { label: 'Ray: Petrify', fire: ray('petrify') },
          { label: 'Ray: Drain',   fire: ray('drain') },
          { label: 'Ray: Hex',     fire: ray('hex') },
          { label: 'Ray: Disintegrate', fire: ray('disintegrate') },
          { label: 'Ray: Silence (day)', fire: ray('silence') },
          { label: 'Ray: Slow (day)',    fire: ray('slow') },
          { label: "Tyrant's Gaze sweep", fire: () => AbilityVfx.tyrantGazeSweepFx(this._scene, tX(), tY(), { tier: this._orcTier(), rectW: 200, rectH: 150 }) },
        ]
      }
      if (entity.archId === 'myconid') {
        const aura = (sat) => () => AbilityVfx.bossAuraFx(this._scene, e.worldX, e.worldY, { sat, sprite: this._bossStandIn, lo: 0x2e5d28, hi: 0x9ee870, durationMs: 3600 })
        return [
          { label: 'Aura: Low Biomass',  fire: aura(0.3) },
          { label: 'Aura: Mid Biomass',  fire: aura(0.65) },
          { label: 'Aura: High Biomass', fire: aura(1) },
          { label: 'Seed Bloom (room)', fire: () => AbilityVfx.bloomFx(this._scene, e.worldX, e.worldY, { tier: this._orcTier(), rectW: 180, rectH: 140 }) },
          { label: 'Spore Burst (pod)', fire: () => AbilityVfx.sporeBurstFx(this._scene, tX(), tY(), { tier: this._orcTier() }) },
          { label: 'Spore Vent (hero)', fire: () => AbilityVfx.sporeVentFx(this._scene, tX(), tY() - 16, { tier: this._orcTier() }) },
          { label: 'Creeping Rot (floor)', fire: () => AbilityVfx.creepingRotFx(this._scene, tX(), tY(), { tier: this._orcTier() }) },
          { label: 'Bloom Finale (T4)', fire: () => AbilityVfx.bloomFinaleFx(this._scene, e.worldX, e.worldY, { tier: 4, rectW: 260, rectH: 190 }) },
        ]
      }
      if (entity.archId === 'golem') {
        const aura = (sat) => () => AbilityVfx.bossAuraFx(this._scene, e.worldX, e.worldY, { sat, sprite: this._bossStandIn, lo: 0x4a4036, hi: 0xd8a24a, durationMs: 3600 })
        return [
          { label: 'Aura: Low Bedrock',  fire: aura(0.3) },
          { label: 'Aura: Mid Bedrock',  fire: aura(0.65) },
          { label: 'Aura: High Bedrock', fire: aura(1) },
          { label: 'Seismic Slam (room)', fire: () => AbilityVfx.seismicSlamFx(this._scene, tX(), tY(), { tier: this._orcTier(), rectW: 200, rectH: 150 }) },
          { label: 'Fissure', fire: () => AbilityVfx.fissureFx(this._scene, tX(), tY(), { tier: this._orcTier(), rectW: 200 }) },
          { label: 'Raise Pillar', fire: () => AbilityVfx.risePillarFx(this._scene, tX(), tY(), { tier: this._orcTier() }) },
          { label: 'Bulwark', fire: () => AbilityVfx.golemBulwarkFx(this._scene, e.worldX, e.worldY, { tier: this._orcTier() }) },
          { label: 'Collapse (T4)', fire: () => AbilityVfx.collapseFx(this._scene, e.worldX, e.worldY, { tier: 4, rectW: 240, rectH: 180 }) },
        ]
      }
      if (entity.archId === 'demon') {
        const aura = (sat) => () => AbilityVfx.bossAuraFx(this._scene, e.worldX, e.worldY, { sat, sprite: this._bossStandIn, lo: 0x5a1e08, hi: 0xff7a1e, durationMs: 3600 })
        return [
          { label: 'Aura: Low Brimstone',  fire: aura(0.3) },
          { label: 'Aura: Mid Brimstone',  fire: aura(0.65) },
          { label: 'Aura: High Brimstone', fire: aura(1) },
          { label: 'Infernal Pact (room)', fire: () => AbilityVfx.infernalPactFx(this._scene, tX(), tY(), { tier: this._orcTier(), rectW: 200, rectH: 150, fromX: e.worldX - 50, fromY: e.worldY + 20, demonX: e.worldX, demonY: e.worldY }) },
          { label: 'Brimstone Meteor', fire: () => AbilityVfx.brimstoneMeteorFx(this._scene, tX(), tY(), { tier: this._orcTier() }) },
          { label: 'Immolation (combust)', fire: () => AbilityVfx.combustFx(this._scene, e.worldX, e.worldY) },
          { label: 'Pact Fulfilled (T4)', fire: () => AbilityVfx.pactFinaleFx(this._scene, e.worldX, e.worldY, { tier: 4, rectW: 260, rectH: 190 }) },
        ]
      }
      if (entity.archId !== 'orc') return []
      return [
        { label: 'Claim Trophy', fire: () => AbilityVfx.trophyClaimFx(this._scene, tX(), tY(), { color: 0xd0d4dc, toX: e.worldX, toY: e.worldY - 20, isNew: true }) },
        { label: 'Cleave (Blade)', fire: () => { const { dx, dy } = dir(); AbilityVfx.orcCleaveFx(this._scene, e.worldX, e.worldY, { dirX: dx, dirY: dy, tier: this._orcTier() }) } },
        { label: 'Shield Bash (Heavy)', fire: () => { const { dx, dy } = dir(); AbilityVfx.shieldBashFx(this._scene, e.worldX, e.worldY, { dirX: dx, dirY: dy, tier: this._orcTier() }) } },
        { label: 'Hexbolt (Arcane)', fire: () => AbilityVfx.hexboltFx(this._scene, e.worldX, e.worldY - 10, { toX: tX(), toY: tY() - 10, tier: this._orcTier() }) },
        { label: 'Volley (Hunter)', fire: () => AbilityVfx.volleyFx(this._scene, e.worldX, e.worldY, { tier: this._orcTier(), targets: [{ x: tX(), y: tY() }, { x: e.worldX - 90, y: e.worldY - 10 }, { x: e.worldX + 60, y: e.worldY + 50 }] }) },
        { label: "Reaver's Smite (Faith)", fire: () => AbilityVfx.reaverSmiteFx(this._scene, tX(), tY(), { fromX: e.worldX, fromY: e.worldY - 10, tier: this._orcTier() }) },
        { label: "Veteran's Armory (T4 ULT)", fire: () => AbilityVfx.veteransArmoryFx(this._scene, e.worldX, e.worldY, { trophies: ['blade', 'heavy', 'arcane', 'hunter', 'faith'] }) },
        { label: 'Trophy Throw (day)', fire: () => AbilityVfx.trophyThrowFx(this._scene, e.worldX, e.worldY - 8, { tier: this._orcTier(), toX: tX(), toY: tY(), weapons: [{ id: 'blade', color: 0xd0d4dc }, { id: 'heavy', color: 0xc9a23f }, { id: 'arcane', color: 0x9a6cff }, { id: 'hunter', color: 0x66cc66 }, { id: 'faith', color: 0xffe9a8 }] }) },
      ]
    }
    if (entity.definitionId) {
      const def = (this._scene.cache.json.get('minionTypes') ?? []).find(d => d.id === entity.definitionId)
      return (def?.abilities ?? []).map(ab => ({
        label: `${ab.label ?? ab.type} ·${ab.trigger}`,
        ab,
        // onDying kit (Skeleton Reassemble) only fires through the real death
        // pipeline — running it via the hit/tick dispatch is a silent no-op. So
        // route those buttons through KILL (respawn first if already down so each
        // press cleanly re-demos the death→revive).
        fire: () => {
          if (ab.trigger === 'onDying') {
            const e = this._entity
            if (!e || e.aiState === 'dead' || (e.resources?.hp ?? 1) <= 0) this._respawnCurrent()
            this._killEntity()
            return
          }
          MinionAbilities.fireAbility(this._scene, this._entity, this._dummy, this._gs, ab)
        },
      }))
    }
    return (CLASS_ABILITIES[entity.classId] ?? []).map(key => ({
      label: ABILITY_DEFS[key]?.label ?? key,
      // devDemoVfx = a deterministic VFX-only demo (fires the real bespoke effect
      // on the entity + a target every press, incl. combat-proc effects the
      // _consider tick can't reach). Falls back to devFireAbility for unmapped ids.
      fire: () => this._scene.classAbilitySystem?.devDemoVfx(this._entity, key),
    }))
  }

  _fireAbility(item) {
    this._primeForAbility(item.ab)
    item.fire(); this._setLoop('fire', item.fire)
  }

  // Several abilities only DO something when a precondition holds (an infected
  // hero to spread from, a fallen undead to raise, a wounded self to bud from…).
  // In an empty lab those buttons silently no-op, which reads as "the lab stopped
  // working". Seed the minimal state right before firing so every button produces
  // a visible effect. Safe: all seeded entities are _vfxLabFrozen → swept on despawn.
  _primeForAbility(ab) {
    const e = this._entity
    if (!ab || !e || !e.definitionId) return
    const now = this._scene.time?.now ?? 0
    switch (ab.type) {
      case 'contagion': {
        // Needs an already-infected hero in the room to spread FROM + an
        // uninfected hero to spread TO. Infect the dummy, keep the 2nd hero
        // clean each press so the spread re-demos every time.
        const h2 = this._ensureSecondHero()
        if (h2) h2._infectUntil = 0
        if (this._dummy) MinionAbilities._infectAdv?.(this._scene, this._dummy, 2, 1500, 4, e.instanceId, now)
        break
      }
      case 'undyingLegion':
        this._ensureFallenUndead()   // a fallen undead in the room to raise
        break
      case 'bloodFeast':
        this._ensureSecondHero()     // a 2nd hero so the ult reels multiple threads
        break
      case 'swarm':
      case 'verminTide':
        this._ensureSwarmPack(4)      // sibling rats so the pack-scaling + tide show
        break
      case 'massGrave':
        this._seedGraveyard(5)        // fallen heroes in the room for the Crypt Lord to raise
        break
      case 'burningAura':
      case 'inferno':
        this._ensureSecondHero()      // heroes in the aura to burn (+ a neighbour for Combustion)
        if (this._dummy) this._dummy._hellfireStacks = (ab.maxStacks ?? 5) - 1   // pre-heat so a press can show Combustion
        break
      case 'splitWhenHurt': {        // only buds below its HP threshold, once — re-arm + wound
        const thr = ab.hpThreshold ?? 0.5
        e._hasBudded = false
        e.resources.hp = Math.max(1, Math.floor((e.resources.maxHp ?? 10) * thr * 0.8))
        break
      }
      case 'hazardTrail':            // only drops on a NEW tile — nudge so each press lays a fresh puddle
        e._lastHazardTile = null; e.tileX += (this._trailFlip = !this._trailFlip) ? 1 : -1
        break
      default: break
    }
  }

  // A second live hero standing by the entity (for spread / multi-target abilities).
  _ensureSecondHero() {
    const gs = this._gs, e = this._entity
    if (this._lab2ndHero && gs.adventurers?.active?.includes(this._lab2ndHero)) return this._lab2ndHero
    const def = (this._scene.cache.json.get('adventurerClasses') ?? []).find(d => d.id === 'knight')
    if (!def || !e) return null
    const a = createAdventurer(def, { x: e.tileX, y: e.tileY }, 1)
    a._vfxLabFrozen = true; a.aiState = 'fighting'; a.partyId = '__vfxlab'
    a.assignedRoomId = e.assignedRoomId; a.tileX = e.tileX; a.tileY = e.tileY
    a.worldX = e.worldX + 64; a.worldY = e.worldY + 44
    a.resources.hp = a.resources.maxHp = 220; a._lpcDir = 'down'
    gs.adventurers.active.push(a); this._lab2ndHero = a
    return a
  }

  // Sibling rats clustered around the entity so the SWARM scaling (count-based
  // atk/DR) + the pack-bite/Vermin-Tide VFX have a real pack to act on.
  _ensureSwarmPack(n = 3) {
    const gs = this._gs, e = this._entity
    if (!e || !e.definitionId) return
    const def = (this._scene.cache.json.get('minionTypes') ?? []).find(d => d.id === e.definitionId)
    if (!def) return
    const have = (gs.minions ?? []).filter(m => m._vfxLabPackRat).length
    for (let i = have; i < n; i++) {
      const m = createMinion(def, { x: e.tileX, y: e.tileY }, e.assignedRoomId, { bossLevel: gs.boss?.level ?? 1 })
      m._vfxLabFrozen = true; m._vfxLabPackRat = true; m.faction = 'dungeon'; m.aiState = 'idle'
      m.assignedRoomId = e.assignedRoomId; m.tileX = e.tileX; m.tileY = e.tileY
      m.worldX = e.worldX + (i - 1) * 42 - 20; m.worldY = e.worldY + 34
      gs.minions.push(m)
    }
  }

  // Seed the run graveyard with fallen heroes IN the entity's room so the Crypt
  // Lord's Mass Grave has corpses to claw back up. Tagged so RESET/re-prime tops up.
  _seedGraveyard(n = 4) {
    const gs = this._gs, e = this._entity
    gs.adventurers = gs.adventurers ?? {}
    gs.adventurers.graveyard = gs.adventurers.graveyard ?? []
    const have = gs.adventurers.graveyard.filter(g => g._vfxLabGrave).length
    for (let i = have; i < n; i++) {
      gs.adventurers.graveyard.push({ instanceId: `lab_grave_${i}`, classId: 'knight', tileX: e?.tileX ?? 5, tileY: e?.tileY ?? 5, worldX: e?.worldX ?? 160, worldY: e?.worldY ?? 160, _vfxLabGrave: true })
    }
  }

  // A fallen undead minion in the entity's room (for raise/reanimate abilities).
  _ensureFallenUndead() {
    const gs = this._gs, e = this._entity
    if (this._labFallen && gs.minions?.includes(this._labFallen) && this._labFallen.aiState === 'dead') return this._labFallen
    const def = (this._scene.cache.json.get('minionTypes') ?? []).find(d => d.id === 'skeleton1')
    if (!def || !e) return null
    const m = createMinion(def, { x: e.tileX, y: e.tileY }, e.assignedRoomId, {})
    m._vfxLabFrozen = true; m.faction = 'dungeon'; m.assignedRoomId = e.assignedRoomId
    m.tileX = e.tileX; m.tileY = e.tileY; m.worldX = e.worldX - 70; m.worldY = e.worldY + 34
    m.resources.hp = 0; m.aiState = 'dead'
    gs.minions.push(m); this._labFallen = m
    return m
  }

  _playAnim(state) {
    if (!this._entity) return
    this._entity._vfxLabAnim = state || null
    this._forceReplay()
    // Loop: keep the state pinned and re-play one-shot anims (slash/thrust/cast…)
    // the INSTANT they finish, so they loop continuously (idle/walk loop on
    // their own). 'resume' (null) clears the override + the loop.
    this._setLoop(state ? 'anim' : null, state ? () => {
      if (!this._entity) return
      this._entity._vfxLabAnim = state
      if (!this._animPlaying()) this._forceReplay()
    } : null)
  }

  // Clear the active renderer's "already playing this anim" guard so the next
  // renderer tick re-plays the pinned _vfxLabAnim from frame 0.
  _forceReplay() {
    const e = this._entity; if (!e) return
    if (e.definitionId) {
      const rec = this._scene.minionRenderer?._sprites?.[e.instanceId]
      if (rec) rec.currentAnim = null
    } else {
      const rec = this._scene.adventurerRenderer?._sprites?.[e.instanceId]
      if (rec?.lpc) rec.lpc.lastAnim = null
    }
  }

  // Is the entity's sprite mid-animation right now? (Used to detect when a
  // one-shot anim has finished so the loop can replay it seamlessly.)
  _animPlaying() {
    const e = this._entity; if (!e) return false
    const rec = e.definitionId ? this._scene.minionRenderer?._sprites?.[e.instanceId]
                               : this._scene.adventurerRenderer?._sprites?.[e.instanceId]
    const img = e.definitionId ? rec?.sprite : rec?.lpc?.image
    return !!img?.anims?.isPlaying
  }

  // Pin the facing direction — minions read `_vfxLabFacing` (renderer override),
  // adventurers read `_lpcDir`. Replay so the new direction shows immediately.
  _setFacing(dir) {
    if (!this._entity) return
    this._entity._vfxLabFacing = dir
    this._entity._lpcDir = dir
    this._forceReplay()
  }

  // Cycle tier 1→4 on each press so the lab demonstrates how the boss VFX
  // escalates per act (e.g. Cleave: single → double-X → +ground-gash → whirlwind).
  _orcTier() {
    this._orcTierTick = ((this._orcTierTick ?? -1) + 1) % 4
    return this._orcTierTick + 1
  }

  _fireRaw(name, colorKey) {
    const s = this._scene, e = this._entity, d = this._dummy
    if (!e) return
    const pal = VfxPalette[colorKey] ?? VfxPalette.holy
    const opts = { color: pal.color, accent: pal.accent, slow: this._slow ? 6 : 1 }
    const fn = () => {
      switch (name) {
        case 'beamFx':       AbilityVfx.beamFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), opts); break
        case 'recklessChargeFx': AbilityVfx.recklessChargeFx(s, e.worldX - 70, e.worldY, e.worldX + 40, e.worldY, opts); break
        case 'arcBoltFx':    AbilityVfx.arcBoltFx(s, e.worldX, e.worldY - 10, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY) - 10, opts); break
        case 'piercingArrowFx': AbilityVfx.piercingArrowFx(s, e.worldX, e.worldY - 8, (d?.worldX ?? e.worldX + 120), (d?.worldY ?? e.worldY) - 8, opts); break
        case 'pounceFx':     AbilityVfx.pounceFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), opts); break
        // Boss · Orc Veteran (Trophy Hunter) — repeated presses cycle tier 1→4 to show escalation.
        case 'orcCleaveFx':  { const dx = (d?.worldX ?? e.worldX + 90) - e.worldX, dy = (d?.worldY ?? e.worldY) - e.worldY; AbilityVfx.orcCleaveFx(s, e.worldX, e.worldY, { ...opts, dirX: dx, dirY: dy, tier: this._orcTier() }); break }
        case 'shieldBashFx': { const dx = (d?.worldX ?? e.worldX + 90) - e.worldX, dy = (d?.worldY ?? e.worldY) - e.worldY; AbilityVfx.shieldBashFx(s, e.worldX, e.worldY, { ...opts, dirX: dx, dirY: dy, tier: this._orcTier() }); break }
        case 'hexboltFx':    AbilityVfx.hexboltFx(s, e.worldX, e.worldY - 10, { ...opts, toX: (d?.worldX ?? e.worldX + 110), toY: (d?.worldY ?? e.worldY) - 10, tier: this._orcTier() }); break
        case 'volleyFx':     AbilityVfx.volleyFx(s, e.worldX, e.worldY, { ...opts, tier: this._orcTier(), targets: [{ x: (d?.worldX ?? e.worldX + 100), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 90, y: e.worldY - 10 }, { x: e.worldX + 60, y: e.worldY + 50 }] }); break
        case 'reaverSmiteFx': AbilityVfx.reaverSmiteFx(s, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), { ...opts, fromX: e.worldX, fromY: e.worldY - 10, tier: this._orcTier() }); break
        case 'trophyClaimFx': AbilityVfx.trophyClaimFx(s, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), { ...opts, toX: e.worldX, toY: e.worldY - 20, isNew: true }); break
        case 'veteransArmoryFx': AbilityVfx.veteransArmoryFx(s, e.worldX, e.worldY, { ...opts, trophies: ['blade', 'heavy', 'arcane', 'hunter', 'faith'] }); break
        case 'trophyThrowFx': AbilityVfx.trophyThrowFx(s, e.worldX, e.worldY - 8, { tier: this._orcTier(), toX: (d?.worldX ?? e.worldX + 120), toY: (d?.worldY ?? e.worldY), weapons: [{ id: 'blade', color: 0xd0d4dc }, { id: 'heavy', color: 0xc9a23f }, { id: 'arcane', color: 0x9a6cff }, { id: 'hunter', color: 0x66cc66 }, { id: 'faith', color: 0xffe9a8 }] }); break
        // Boss · Elder Lich (The Withering)
        case 'soulHarvestWispFx': AbilityVfx.soulHarvestWispFx(s, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), { ...opts, toX: e.worldX, toY: e.worldY - 20 }); break
        case 'soulChannelFx': AbilityVfx.soulChannelFx(s, e.worldX + 40, e.worldY, { ...opts, tier: this._orcTier(), fromX: e.worldX, fromY: e.worldY, victims: [{ x: (d?.worldX ?? e.worldX + 100), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 40, y: e.worldY + 30 }] }); break
        case 'deathCoilFx': AbilityVfx.deathCoilFx(s, e.worldX, e.worldY - 10, { ...opts, toX: (d?.worldX ?? e.worldX + 110), toY: (d?.worldY ?? e.worldY) - 10, tier: this._orcTier() }); break
        case 'soulSiphonFx': AbilityVfx.soulSiphonFx(s, e.worldX, e.worldY - 8, { ...opts, tier: this._orcTier(), targets: [{ x: (d?.worldX ?? e.worldX + 100), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 90, y: e.worldY - 10 }] }); break
        case 'soulNovaFx': AbilityVfx.soulNovaFx(s, e.worldX, e.worldY, { ...opts, tier: this._orcTier() }); break
        case 'soulCageFx': AbilityVfx.soulCageFx(s, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), { ...opts, tier: this._orcTier() }); break
        case 'soulAuraFx': { const t = this._orcTier(); AbilityVfx.soulAuraFx(s, e.worldX, e.worldY, { sat: [0.25, 0.6, 0.95, 1][t - 1], overK: t >= 4 ? 0.85 : 0, orbit: [2, 4, 7, 8][t - 1], sprite: this._bossStandIn, dsz: this._bossStandIn?.displayHeight || 100 }); break }
        // Boss · Slime King (Mitosis) — tier cycles 1→4.
        case 'slimeSplitFx':  AbilityVfx.slimeSplitFx(s, e.worldX, e.worldY, { tier: this._orcTier(), children: [{ x: e.worldX - 26, y: e.worldY + 6 }, { x: e.worldX + 26, y: e.worldY + 6 }] }); break
        case 'slimeMergeFx':  AbilityVfx.slimeMergeFx(s, e.worldX, e.worldY); break
        case 'acidPuddleFx':  AbilityVfx.acidPuddleFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY), { tier: this._orcTier() }); break
        case 'slimeSurgeFx':  AbilityVfx.slimeSurgeFx(s, e.worldX, e.worldY, { count: 6 }); break
        case 'slimeEngulfFx': AbilityVfx.slimeEngulfFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY) - 16, { tier: this._orcTier() }); break
        // Boss · Beholder (Eye Tyrant) — tier cycles 1→4.
        case 'beholderEyeChargeFx': AbilityVfx.beholderEyeChargeFx(s, e.worldX, e.worldY - 8, { tier: this._orcTier() }); break
        case 'beholderRayFx_petrify':      AbilityVfx.beholderRayFx(s, e.worldX, e.worldY - 8, { toX: (d?.worldX ?? e.worldX + 110), toY: (d?.worldY ?? e.worldY) - 16, kind: 'petrify', tier: this._orcTier() }); break
        case 'beholderRayFx_drain':        AbilityVfx.beholderRayFx(s, e.worldX, e.worldY - 8, { toX: (d?.worldX ?? e.worldX + 110), toY: (d?.worldY ?? e.worldY) - 16, kind: 'drain', tier: this._orcTier() }); break
        case 'beholderRayFx_hex':          AbilityVfx.beholderRayFx(s, e.worldX, e.worldY - 8, { toX: (d?.worldX ?? e.worldX + 110), toY: (d?.worldY ?? e.worldY) - 16, kind: 'hex', tier: this._orcTier() }); break
        case 'beholderRayFx_disintegrate': AbilityVfx.beholderRayFx(s, e.worldX, e.worldY - 8, { toX: (d?.worldX ?? e.worldX + 110), toY: (d?.worldY ?? e.worldY) - 16, kind: 'disintegrate', tier: this._orcTier() }); break
        case 'beholderRayFx_silence':      AbilityVfx.beholderRayFx(s, e.worldX, e.worldY - 8, { toX: (d?.worldX ?? e.worldX + 110), toY: (d?.worldY ?? e.worldY) - 16, kind: 'silence', tier: this._orcTier() }); break
        case 'beholderRayFx_slow':         AbilityVfx.beholderRayFx(s, e.worldX, e.worldY - 8, { toX: (d?.worldX ?? e.worldX + 110), toY: (d?.worldY ?? e.worldY) - 16, kind: 'slow', tier: this._orcTier() }); break
        case 'tyrantGazeSweepFx': AbilityVfx.tyrantGazeSweepFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY), { tier: this._orcTier(), rectW: 200, rectH: 150 }); break
        // Boss · Myconid (The Bloom) — tier cycles 1→4.
        case 'bloomFx':       AbilityVfx.bloomFx(s, e.worldX, e.worldY, { tier: this._orcTier(), rectW: 180, rectH: 140 }); break
        case 'sporeBurstFx':  AbilityVfx.sporeBurstFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY), { tier: this._orcTier() }); break
        case 'sporeVentFx':   AbilityVfx.sporeVentFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY) - 16, { tier: this._orcTier() }); break
        case 'creepingRotFx': AbilityVfx.creepingRotFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY), { tier: this._orcTier() }); break
        case 'bloomFinaleFx': AbilityVfx.bloomFinaleFx(s, e.worldX, e.worldY, { tier: 4, rectW: 260, rectH: 190 }); break
        // Boss · Demon (The Brimstone Pact) — tier cycles 1→4.
        case 'infernalPactFx':   AbilityVfx.infernalPactFx(s, e.worldX, e.worldY, { tier: this._orcTier(), rectW: 200, rectH: 150, fromX: e.worldX - 50, fromY: e.worldY + 20, demonX: e.worldX, demonY: e.worldY }); break
        case 'brimstoneMeteorFx': AbilityVfx.brimstoneMeteorFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY), { tier: this._orcTier() }); break
        case 'pactFinaleFx':     AbilityVfx.pactFinaleFx(s, e.worldX, e.worldY, { tier: 4, rectW: 260, rectH: 190 }); break
        // Boss · Golem (The Living Fortress) — tier cycles 1→4.
        case 'seismicSlamFx':  AbilityVfx.seismicSlamFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY), { tier: this._orcTier(), rectW: 200, rectH: 150 }); break
        case 'fissureFx':      AbilityVfx.fissureFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY), { tier: this._orcTier(), rectW: 200 }); break
        case 'risePillarFx':   AbilityVfx.risePillarFx(s, (d?.worldX ?? e.worldX + 60), (d?.worldY ?? e.worldY), { tier: this._orcTier() }); break
        case 'golemBulwarkFx': AbilityVfx.golemBulwarkFx(s, e.worldX, e.worldY, { tier: this._orcTier() }); break
        case 'collapseFx':     AbilityVfx.collapseFx(s, e.worldX, e.worldY, { tier: 4, rectW: 240, rectH: 180 }); break
        case 'diceRoll':     AbilityVfx.diceRoll(s, e.worldX, e.worldY - 30, 1 + Math.floor(Math.random() * 6), opts); break
        case 'coinFlip':     AbilityVfx.coinFlip(s, e.worldX, e.worldY - 20, Math.random() < 0.5, opts); break
        case 'projectileFx': AbilityVfx.projectileFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), opts); break
        case 'pulseRing':    AbilityVfx.pulseRing(s, e.worldX, e.worldY, { color: pal.color, fromR: 6, toR: 40, alpha: 0.85, durationMs: 500 }); break
        case 'juice':        AbilityVfx.juice(s, e.worldX, e.worldY, opts); break
        case 'streakDash':   AbilityVfx.streakDash(s, e.worldX - 34, e.worldY, e.worldX + 34, e.worldY, opts); break
        case 'furyAura':     AbilityVfx.furyAura(s, e.worldX, e.worldY + 6, { ...opts, intensity: 1 }); break
        case 'soundWave':    AbilityVfx.soundWave(s, e.worldX, e.worldY - 6, opts); break
        case 'groundCrack':  AbilityVfx.groundCrack(s, e.worldX, e.worldY + 8, opts); break
        case 'contagionTendril': AbilityVfx.contagionTendril(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), opts); break
        case 'bloodThread':  AbilityVfx.bloodThread(s, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), e.worldX, e.worldY - 12, opts); break
        case 'bloodFeastFx': AbilityVfx.bloodFeastFx(s, e.worldX, e.worldY - 12, [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) - 10 }, { x: e.worldX - 80, y: e.worldY - 10 }], opts); break
        case 'fearStrikeFx': AbilityVfx.fearStrikeFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY) - 6, opts); break
        case 'dreadAuraFx':  AbilityVfx.dreadAuraFx(s, e.worldX, e.worldY, { ...opts, radiusTiles: 4, targets: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) - 16 }] }); break
        case 'pallOfDreadFx': AbilityVfx.pallOfDreadFx(s, e.worldX, e.worldY, { ...opts, rectW: 130, rectH: 92, victims: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 80, y: e.worldY + 6 }] }); break
        case 'mesmerizeFx':  AbilityVfx.mesmerizeFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY) - 6, opts); break
        case 'manyEyesFx':   AbilityVfx.manyEyesFx(s, e.worldX, e.worldY, [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) - 16 }, { x: e.worldX - 80, y: e.worldY + 8 }], opts); break
        case 'tyrantGlareFx': AbilityVfx.tyrantGlareFx(s, e.worldX, e.worldY, { ...opts, rectW: 130, rectH: 92, victims: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 80, y: e.worldY + 6 }] }); break
        case 'thornGuardFx': AbilityVfx.thornGuardFx(s, e.worldX, e.worldY, opts); break
        case 'thornLashFx':  AbilityVfx.thornLashFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY) - 6, opts); break
        case 'thornburstFx': AbilityVfx.thornburstFx(s, e.worldX, e.worldY, { ...opts, victims: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 80, y: e.worldY + 6 }] }); break
        case 'soulHarvestFx': AbilityVfx.soulHarvestFx(s, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY) + 14, { ...opts, toX: e.worldX, toY: e.worldY - 18 }); break
        case 'soulConduitFx': AbilityVfx.soulConduitFx(s, e.worldX, e.worldY, { ...opts, targets: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) - 6 }, { x: e.worldX - 80, y: e.worldY + 8 }] }); break
        case 'soulStormFx':   AbilityVfx.soulStormFx(s, e.worldX, e.worldY, { ...opts, souls: 12, rectW: 130, rectH: 92, victims: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 80, y: e.worldY + 6 }] }); break
        case 'blinkFx':       AbilityVfx.blinkFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY) - 6, opts); break
        case 'hellriftFx':    AbilityVfx.hellriftFx(s, e.worldX, e.worldY, { ...opts, rectW: 130, rectH: 92, victims: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 80, y: e.worldY + 6 }] }); break
        case 'stranglethornFx': AbilityVfx.stranglethornFx(s, e.worldX, e.worldY, { ...opts, rectW: 130, rectH: 92, victims: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 80, y: e.worldY + 6 }] }); break
        case 'sporeStormFx':  AbilityVfx.sporeStormFx(s, e.worldX, e.worldY, { ...opts, rectW: 130, rectH: 92, victims: [{ x: (d?.worldX ?? e.worldX + 90), y: (d?.worldY ?? e.worldY) }, { x: e.worldX - 80, y: e.worldY + 6 }] }); break
        default:             (AbilityVfx[name] ?? AbilityVfx.impactFx)(s, e.worldX, e.worldY, opts)
      }
    }
    fn(); this._setLoop('fire', fn)
  }

  // Loop plumbing — one fast tick (140ms). 'anim' loops re-pin + replay the
  // instant the anim completes (seamless). 'fire' loops re-fire VFX/abilities
  // on a slower ~1.1s cadence so they don't spam.
  _setLoop(kind, fn) { this._loopKind = kind; this._loopFn = fn; this._loopLast = 0 }
  _toggleLoop(on) {
    this._stopLoop()
    if (on) this._loopTimer = setInterval(() => {
      try {
        if (!this._loopFn) return
        if (this._loopKind === 'anim') { this._loopFn() }
        else { const now = Date.now(); if (now - this._loopLast >= 1100) { this._loopFn(); this._loopLast = now } }
      } catch (e) {}
    }, 140)
  }
  _stopLoop() { if (this._loopTimer) { clearInterval(this._loopTimer); this._loopTimer = null } }

  // ── DOM panel ────────────────────────────────────────────────────────────
  _el(tag, style, text) { const e = document.createElement(tag); if (style) e.style.cssText = style; if (text != null) e.textContent = text; return e }

  _btn(label, onClick) {
    const b = this._el('button', 'display:inline-block;margin:2px;padding:4px 7px;font:10px monospace;background:#2a2233;color:#ffd23f;border:1px solid #5a4a66;border-radius:3px;cursor:pointer;')
    b.textContent = label
    b.onmouseenter = () => b.style.background = '#3a3045'
    b.onmouseleave = () => b.style.background = '#2a2233'
    b.onclick = onClick
    return b
  }

  _section(title) {
    const wrap = this._el('div', 'margin:6px 0;border-top:1px solid #3a3040;padding-top:5px;')
    wrap.appendChild(this._el('div', 'font:bold 10px monospace;color:#9fd8ff;margin-bottom:3px;letter-spacing:1px;', title))
    return wrap
  }

  _buildPanel() {
    const p = this._el('div', 'position:fixed;top:8px;right:8px;width:280px;max-height:96vh;overflow-y:auto;z-index:99999;background:rgba(20,16,26,0.96);border:1px solid #5a4a66;border-radius:6px;padding:8px;box-shadow:0 4px 20px rgba(0,0,0,0.6);')
    // Header
    const head = this._el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;')
    head.appendChild(this._el('div', 'font:bold 12px monospace;color:#ffd23f;', '★ VFX LAB'))
    const x = this._btn('✕ EXIT', () => VfxLab.toggle(this._scene)); x.style.color = '#ff6677'
    head.appendChild(x)
    p.appendChild(head)

    // Entity picker
    const pick = this._el('select', 'width:100%;margin:3px 0;padding:3px;font:10px monospace;background:#1a1622;color:#eee;border:1px solid #5a4a66;border-radius:3px;')
    const ogM = this._el('optgroup'); ogM.label = 'MINIONS'
    for (const d of (this._scene.cache.json.get('minionTypes') ?? [])) { const o = this._el('option'); o.value = 'minion:' + d.id; o.textContent = `${d.name} (${d.id})`; ogM.appendChild(o) }
    const ogA = this._el('optgroup'); ogA.label = 'ADVENTURERS'
    for (const d of (this._scene.cache.json.get('adventurerClasses') ?? [])) { const o = this._el('option'); o.value = 'adv:' + d.id; o.textContent = d.name ?? d.id; ogA.appendChild(o) }
    const ogB = this._el('optgroup'); ogB.label = 'BOSSES'
    for (const d of (this._scene.cache.json.get('bossArchetypes') ?? [])) { const o = this._el('option'); o.value = 'boss:' + d.id; o.textContent = d.name ?? d.id; ogB.appendChild(o) }
    pick.appendChild(ogM); pick.appendChild(ogA); pick.appendChild(ogB)
    pick.value = 'minion:goblin1'
    pick.onchange = () => { const [k, id] = pick.value.split(':'); this._spawn(k, id) }
    p.appendChild(pick)

    // Loop + slow toggles
    const opts = this._el('div', 'margin:3px 0;')
    const loop = this._el('label', 'font:10px monospace;color:#ccc;margin-right:10px;cursor:pointer;')
    const loopCb = this._el('input'); loopCb.type = 'checkbox'; loopCb.onchange = () => this._toggleLoop(loopCb.checked)
    loop.appendChild(loopCb); loop.appendChild(document.createTextNode(' loop'))
    const slow = this._el('label', 'font:10px monospace;color:#ccc;cursor:pointer;')
    const slowCb = this._el('input'); slowCb.type = 'checkbox'; slowCb.onchange = () => this._slow = slowCb.checked
    slow.appendChild(slowCb); slow.appendChild(document.createTextNode(' slow-mo'))
    opts.appendChild(loop); opts.appendChild(slow)
    // Zoom controls — recenter on the entity at the new zoom.
    const cam = () => this._scene.cameras.main
    const rezoom = (z) => { const c = cam(); c.setZoom(Math.max(1, Math.min(8, z))); if (this._entity) c.centerOn(this._entity.worldX, this._entity.worldY) }
    const zout = this._btn('−', () => rezoom(cam().zoom - 0.5)); zout.style.float = 'right'
    const zin = this._btn('+', () => rezoom(cam().zoom + 0.5)); zin.style.float = 'right'
    opts.appendChild(zin); opts.appendChild(zout)
    p.appendChild(opts)

    // Facing direction
    const faceRow = this._el('div', 'margin:4px 0;')
    faceRow.appendChild(this._el('span', 'font:10px monospace;color:#9aa;margin-right:6px;', 'FACE'))
    for (const [lbl, dir] of [['↑', 'up'], ['↓', 'down'], ['←', 'left'], ['→', 'right']]) {
      faceRow.appendChild(this._btn(lbl, () => this._setFacing(dir)))
    }
    p.appendChild(faceRow)

    // State controls — KILL runs the real death pipeline (fires onDying/onDeath
    // kit, e.g. Skeleton Reassemble); RESET respawns a fresh entity.
    const stateSec = this._section('STATE')
    const kill = this._btn('☠ KILL', () => this._killEntity()); kill.style.color = '#ff7766'; kill.style.borderColor = '#7a3a3a'
    const reset = this._btn('↺ RESET', () => this._respawnCurrent()); reset.style.color = '#7ee0a0'
    stateSec.appendChild(kill); stateSec.appendChild(reset)
    p.appendChild(stateSec)

    // Dynamic sections (rebuilt per entity)
    this._abilitySec = this._section('ABILITIES')
    this._animSec = this._section('ANIMATIONS')
    p.appendChild(this._abilitySec)
    p.appendChild(this._animSec)

    // Raw VFX (static)
    const rawSec = this._section('RAW VFX')
    let colorKey = 'holy'
    const colorRow = this._el('div', 'margin-bottom:3px;')
    for (const c of PALETTE_KEYS) {
      const sw = this._el('button', `width:18px;height:18px;margin:1px;border:1px solid #000;border-radius:3px;cursor:pointer;background:#${(VfxPalette[c].color).toString(16).padStart(6, '0')};`)
      sw.title = c; sw.onclick = () => { colorKey = c; for (const k of colorRow.children) k.style.outline = 'none'; sw.style.outline = '2px solid #fff' }
      colorRow.appendChild(sw)
    }
    rawSec.appendChild(colorRow)
    for (const grp of RAW_VFX_GROUPS) {
      const hdr = this._el('div', 'width:100%;margin:5px 0 1px;font:9px monospace;color:#9a8fb0;letter-spacing:1px;border-bottom:1px solid #3a3045;', grp.label.toUpperCase())
      rawSec.appendChild(hdr)
      for (const v of grp.fx) rawSec.appendChild(this._btn(v.replace('Fx', ''), () => this._fireRaw(v, colorKey)))
    }
    p.appendChild(rawSec)

    document.body.appendChild(p)
    this._panel = p
    this._refreshButtons()
  }

  _refreshButtons() {
    if (!this._abilitySec) return
    // Abilities
    while (this._abilitySec.children.length > 1) this._abilitySec.lastChild.remove()
    const abs = this._abilitiesOf(this._entity)
    if (!abs.length) this._abilitySec.appendChild(this._el('div', 'font:9px monospace;color:#777;', '(no abilities — stat-block / event class)'))
    for (const item of abs) this._abilitySec.appendChild(this._btn(item.label, () => this._fireAbility(item)))
    // Animations (boss stand-in has its own idle sprite — no adv/minion anims)
    while (this._animSec.children.length > 1) this._animSec.lastChild.remove()
    if (!this._entity?.isBossStandIn) {
      const isMinion = !!this._entity?.definitionId
      const states = isMinion ? MINION_ANIMS : ADV_ANIMS
      for (const st of states) this._animSec.appendChild(this._btn(st, () => this._playAnim(st)))
      this._animSec.appendChild(this._btn('▸ resume', () => this._playAnim(null)))
    }
  }
}
