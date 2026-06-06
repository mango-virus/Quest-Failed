// ─────────────────────────────────────────────────────────────────────────────
// Dev VFX Sandbox  (window.__qfDev)
//
// A scriptable dev console for verifying the Kingdom-Response set-pieces without
// hand-playing a whole run. Installed on the Game scene (cheat-name / localhost
// gated). Drives everything from JS so it can be run from the browser console OR
// an automated preview harness — no fragile canvas-clicking required.
//
// Typical flow (in an active DAY phase):
//   __qfDev.fastAbilities()            // signatures fire in ~0.6s, not 4.5s
//   __qfDev.populate()                 // mixed-tier minions (+ undead) + traps near the boss
//   __qfDev.champion('mage_tower')     // fire a champion raid → watch the signature
//   __qfDev.setResponse('betrayer')    // engage an act-wide gimmick (trap-flip / transmute…)
//
// Everything it creates is tagged `_devSandbox` so __qfDev.clear() removes it.
// ─────────────────────────────────────────────────────────────────────────────

import { createMinion, applyMinionScaling } from '../entities/Minion.js'
import { createTrap } from '../entities/Trap.js'
import { EventBus } from '../systems/EventBus.js'
import { currentActResponseId } from '../config/acts.js'
import { TILE } from '../systems/DungeonGrid.js'
import { installDevInvariants } from './DevInvariants.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'

const WALKABLE = new Set([TILE.FLOOR, TILE.BOSS_FLOOR])
// A mixed-tier roster, deliberately including UNDEAD so Inquisition/Excommunicate
// (which prefer undead targets) and the trap-flip have real things to chew on.
const SANDBOX_MINIONS = ['goblin1', 'skeleton1', 'ghost1', 'orc1', 'demon1', 'lich1', 'zombie1', 'gnoll1']
const SANDBOX_TRAPS   = ['shooting_arrows', 'spike_pit', 'saw_blade']   // real trapTypes ids (was 'arrow_trap' — stale, fell back to a random trap)

export function installDevSandbox(scene) {
  const log = (...a) => console.log('[qfDev]', ...a)
  const gs   = () => scene.gameState ?? scene._gameState
  const grid = () => scene.dungeonGrid

  // Walkable tiles in rings around the boss (closest first), skipping the boss tile.
  function floorTilesNearBoss(n) {
    const g = gs(); const b = g?.boss ?? {}
    const cx = b.tileX ?? 10, cy = b.tileY ?? 10
    const out = []
    for (let r = 2; r <= 8 && out.length < n; r++) {
      for (let dx = -r; dx <= r && out.length < n; dx++) {
        for (let dy = -r; dy <= r && out.length < n; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue   // ring perimeter only
          const x = cx + dx, y = cy + dy
          if (x === cx && y === cy) continue
          if (WALKABLE.has(grid()?.getTileType?.(x, y))) out.push({ x, y })
        }
      }
    }
    return out
  }

  const api = {
    // Spawn `minions` test minions + `traps` traps near the boss so champion
    // abilities + the trap-flip have real targets. Returns the counts.
    populate({ minions = 8, traps = 3 } = {}) {
      const g = gs()
      if (!g) { log('no gameState'); return { ok: false } }
      const tiles = floorTilesNearBoss(minions + traps + 6)
      if (tiles.length === 0) { log('no walkable tiles near the boss — is a dungeon built?'); return { ok: false } }
      const bossLv = g.boss?.level ?? 8
      const day    = g.meta?.dayNumber ?? 1
      const roomId = grid()?.getRoomAtTile?.(g.boss?.tileX, g.boss?.tileY)?.instanceId ?? null

      const mDefs = scene.cache.json.get('minionTypes') ?? []
      const mById = Object.fromEntries(mDefs.map(d => [d.id, d]))
      let mc = 0
      for (let i = 0; i < minions && i < tiles.length; i++) {
        const def = mById[SANDBOX_MINIONS[i % SANDBOX_MINIONS.length]] ?? mDefs[i % mDefs.length]
        const t = tiles[i]; if (!def || !t) continue
        const m = createMinion(def, { x: t.x, y: t.y }, roomId, { bossLevel: bossLv, dayNumber: day })
        applyMinionScaling(m, bossLv, day)
        m.aiState = 'idle'; m._devSandbox = true
        g.minions.push(m)
        mc++
      }

      const tDefs = scene.cache.json.get('trapTypes') ?? []
      const tById = Object.fromEntries(tDefs.map(d => [d.id, d]))
      let tc = 0
      for (let i = 0; i < traps; i++) {
        const def = tById[SANDBOX_TRAPS[i % SANDBOX_TRAPS.length]] ?? tDefs[i % tDefs.length]
        const t = tiles[minions + i]; if (!def || !t) continue
        const trap = createTrap(def, { tileX: t.x, tileY: t.y })
        trap._devSandbox = true
        g.dungeon.traps.push(trap)
        tc++
      }
      EventBus.emit('MINION_PLACED', {})   // nudge the renderers to pick the new units up
      log(`populated ${mc} minions + ${tc} traps near the boss (now ${g.minions.length} minions, ${g.dungeon.traps.length} traps)`)
      return { ok: true, minions: mc, traps: tc }
    },

    // Reckoning — spawn the recurring NECRARCH SUMMONER (the immune undead king who
    // stands at the entrance + summons a tide of risen dead, then withdraws when it's
    // spent). The mid-act presence, distinct from the killable champion-day Necrarch.
    necrarch() {
      const dp = scene.scene.get('DayPhase')
      if (!dp?.scene?.isActive?.() || typeof dp._spawnNecrarchSummoner !== 'function') { log('not in a DayPhase — run __qfDev.startDay() first'); return { ok: false } }
      const out = dp._spawnNecrarchSummoner()
      log(`Necrarch summoned — ${out?.length ?? 0} units (king + tide)`)
      return { ok: true, count: out?.length ?? 0 }
    },

    // Rival — force the boss-vs-boss SHOWDOWN NOW: spawn Vorzak (a random T4 boss
    // skin) and immediately run the duel engine on him (the purple RIVAL_DUEL
    // cinematic + kinetic throne clash). Needs an active DayPhase.
    rivalDuel() {
      const dp = scene.scene.get('DayPhase')
      if (!dp?.scene?.isActive?.()) { log('not in a DayPhase — run __qfDev.startDay() (or click BEGIN DAY) first'); return { ok: false, reason: 'no-dayphase' } }
      EventBus.emit('DEV_FORCE_RIVAL_DUEL', {})
      log('rival showdown forced — Vorzak marches on the throne')
      return { ok: true }
    },

    // Betrayer — run the night-dash sabotage NOW (the strongest minion dashes
    // trap-to-trap flipping each, then exits). Populate some minions + traps first.
    betrayerDash() {
      const kms = scene.kingdomModifierSystem
      if (!kms || typeof kms._betrayerNightSabotage !== 'function') { log('KingdomModifierSystem not available'); return { ok: false } }
      const ran = kms._betrayerNightSabotage()
      log(ran ? 'betrayer sabotage dash started' : 'no minions to send — populate first')
      return { ok: !!ran }
    },

    // Fire a champion raid by responseId (spawns the champion + retinue). Needs an
    // active DayPhase — call __qfDev.startDay() first if you're still building.
    champion(responseId) {
      const dp = scene.scene.get('DayPhase')
      if (!dp?.scene?.isActive?.()) { log('not in a DayPhase — run __qfDev.startDay() (or click BEGIN DAY) first'); return { ok: false, reason: 'no-dayphase' } }
      EventBus.emit('DEV_FORCE_CHAMPION_RAID', { responseId })
      log(`fired champion raid: ${responseId}  (signature casts in ${globalThis.__qfDevFastAbilities ? '~0.6s' : '~4.5s'})`)
      return { ok: true }
    },

    // Force the current act's drafted Kingdom Response so its ACT-WIDE gimmick
    // engages (Betrayer trap-flip, Mage Tower transmute, Inquisition purge, …).
    setResponse(responseId) {
      const g = gs(); g.meta ??= {}; g.meta.act ??= {}
      const act = g.meta.act.current ?? 1
      g.meta.act.responses ??= {}
      g.meta.act.responses[act] = responseId
      log(`act ${act} response → '${responseId}'  (act-wide gimmick now active)`)
      return { act, responseId }
    },

    // Collapse the champion / All-Star ability cadences so signatures fire almost
    // immediately — essential for reliably screenshotting a cast.
    fastAbilities(on = true) {
      globalThis.__qfDevFastAbilities = !!on
      log(`fast abilities ${on ? 'ON  (first cast ~0.6s, cooldown ~2.5s)' : 'OFF (normal cadence)'}`)
      return !!on
    },

    // End the build phase and start the day's wave (so champion raids can spawn).
    startDay() {
      const dp = scene.scene.get('DayPhase')
      if (dp?.scene?.isActive?.()) { log('already in DayPhase'); return { ok: true, already: true } }
      const np = scene.scene.get('NightPhase')
      if (np && typeof np._beginDay === 'function') {
        // The dev modal soft-pauses NightPhase; resume it first or _beginDay no-ops.
        try { if (np.scene.isPaused?.()) scene.scene.resume('NightPhase') } catch (e) {}
        if (np.scene.isActive?.()) { np._beginDay(); log('starting the day…'); return { ok: true } }
      }
      log('not in NightPhase — cannot start the day from here'); return { ok: false }
    },

    // End the current day NOW — the proper transition (clears the field, tops up
    // boss/minion HP, advances dayNumber → EndOfDay → night, autosaves). Use it to
    // ESCAPE a QUIET day, which has no wave to clear so it never ends on its own.
    endDay() {
      const dp = scene.scene.get('DayPhase')
      if (!dp?.scene?.isActive?.() || typeof dp._endDay !== 'function') { log('not in a DayPhase — nothing to end'); return { ok: false } }
      dp._endDay()
      log('day ended → EndOfDay (advancing to night)')
      return { ok: true }
    },

    // QUIET MODE — when ON, days spawn NO normal wave and a wave-less day stays
    // OPEN (a persistent stage for isolating one class/boss/champion's VFX). Turn
    // it OFF to resume normal waves; an empty quiet day will then end on its own.
    // Flag-only — use startDay() (or the START DAY button) to actually begin a day.
    quietDay(on = true) {
      globalThis.__qfDevQuietDay = !!on
      log(`quiet mode ${on ? 'ON — days spawn NO wave + stay open' : 'OFF — normal waves resume; an empty day will end'}`)
      return !!on
    },

    // ONE-CLICK ARENA — build a small CONNECTED starter dungeon (the dev day-jumps
    // leave only a bare boss room). A compact cluster: the boss anchors the bottom-
    // right; the LIBRARY + ENTRY HALL stack UP from it; the BARRACKS + TRAP FACTORY
    // sit to the LEFT.
    //
    //        [entry]
    //        [library]
    //   [trap] [ boss ]
    //   [barr] [      ]
    //
    // ORDER matters: the entry hall's own auto-connect is SKIPPED (it owns a pre-
    // authored external entrance + getNeighborRooms ignores external cps), so it
    // links only when a neighbour is placed against it afterward. So place the entry
    // FIRST, then the library beneath it — the library's auto-connect cuts the door
    // to BOTH the entry (above) and the boss (below). `noSnap` keeps exact positions.
    arena() {
      const g = gs(); const gridApi = grid()
      if (!g || !gridApi) { log('no game'); return { ok: false } }
      const rooms = g.dungeon?.rooms ?? []
      const roomDefs = scene.cache.json.get('rooms') ?? []
      const connected = () => (gridApi.getDisconnectedRooms?.()?.length ?? 1) === 0
      if (rooms.some(r => r.definitionId === 'entry_hall') && connected()) { log('dungeon already playable'); return { ok: true, already: true } }
      const boss = rooms.find(r => r.definitionId === 'boss_chamber')
      if (!boss) { log('no boss chamber to anchor the arena'); return { ok: false } }
      const defOf = id => roomDefs.find(d => d.id === id)
      const place = (defId, gx, gy) => {
        const def = defOf(defId); if (!def || gx < 0 || gy < 0) return null
        const room = gridApi.placeRoom(def, gx, gy, { noSnap: true })
        if (room) room._devSandbox = true
        return room
      }
      const bx = boss.gridX, by = boss.gridY
      // Offsets are derived from the ACTUAL room dimensions (never hardcoded) so
      // resizing the boss chamber or any kit room can't make these overlap /
      // fail to place. Each room is laid flush against the boss's outer wall.
      const dH = id => defOf(id)?.height ?? 8
      const dW = id => defOf(id)?.width  ?? 8
      const libH = dH('library_of_whispers')
      // Up the column above the boss: library flush to the boss top, entry above it.
      place('library_of_whispers', bx, by - libH)               // bottom edge meets boss top row
      place('entry_hall',          bx, by - libH - dH('entry_hall'))
      // Left of the boss: barracks flush to the left wall, trap factory above it.
      place('starter_barracks',    bx - dW('starter_barracks'), by + 2)
      place('trap_factory',        bx - dW('trap_factory'),     by + 2 - dH('trap_factory'))

      // Forced multi-entry (2nd @ L5, 3rd @ L10) — add entries to the RIGHT of the
      // boss, then re-run the boss's auto-connect so the new doors form.
      const entryDef = defOf('entry_hall'); const eh = entryDef?.height ?? 8
      let required = 1
      try { required = gridApi.constructor.effectiveMaxPerDungeon?.(entryDef, g.boss?.level ?? 1) ?? 1 } catch (e) {}
      let rightY = by + 2
      while (rooms.filter(r => r.definitionId === 'entry_hall').length < required) {
        const e = place('entry_hall', bx + boss.width, rightY)
        if (!e) break
        gridApi.recheckAutoConnect?.(bx + boss.width - 1, rightY + 1)  // boss tile beside the new entry
        rightY += eh + 1
        if (rightY > by + boss.height) break
      }

      const disc = gridApi.getDisconnectedRooms()
      const built = rooms.filter(r => r._devSandbox).map(r => r.definitionId)
      if (disc.length === 0 && rooms.some(r => r.definitionId === 'entry_hall')) {
        log(`built a connected test dungeon (${built.length} rooms → boss): ${built.join(', ')}`)
        return { ok: true, rooms: built }
      }
      log(`arena partial — disconnected: ${disc.map(r => r.definitionId).join(', ') || 'none'} · placed: ${built.join(', ')}`)
      return { ok: false, disconnected: disc.map(r => r.definitionId), placed: built }
    },

    // Remove everything the sandbox created (minions, traps, raid units).
    clear() {
      const g = gs()
      const m0 = g.minions.length, t0 = g.dungeon.traps.length, a0 = g.adventurers?.active?.length ?? 0
      g.minions = g.minions.filter(m => !m._devSandbox)
      g.dungeon.traps = g.dungeon.traps.filter(t => !t._devSandbox)
      if (g.adventurers?.active) g.adventurers.active = g.adventurers.active.filter(a =>
        !a._kingdomChampion && !a._allStar && !a._championResponseId && !a._defector &&
        !a._necrarch && a.name !== 'Risen Dead' && a.name !== 'Reanimated Thrall')
      log(`cleared ${m0 - g.minions.length} minions, ${t0 - g.dungeon.traps.length} traps, ${a0 - (g.adventurers?.active?.length ?? 0)} raid units`)
      return { ok: true }
    },

    // Current sandbox state — handy for an automated harness to assert on.
    state() {
      const g = gs()
      const active = scene.scene?.manager?.scenes?.filter?.(s => s.scene.isActive())?.map?.(s => s.scene.key)
      return {
        activeScenes: active,
        day: g?.meta?.dayNumber, act: g?.meta?.act?.current,
        response: g ? currentActResponseId(g) : null,
        minions: g?.minions?.length, traps: g?.dungeon?.traps?.length,
        advs: g?.adventurers?.active?.length,
        champions: (g?.adventurers?.active ?? []).filter(a => a._kingdomChampion || a._allStar).map(a => ({ name: a.name, sig: a._allStarSig, resp: a._championResponseId })),
        fastAbilities: !!globalThis.__qfDevFastAbilities,
      }
    },

    // Apply / remove / list any dungeon PACT (mechanic) directly — test any pact
    // without waiting for the RNG draw. Mirrors the TEST EVENT → PACTS picker;
    // routes through the real activate/deactivate so seal effects fire + it
    // registers in gameState.activeMechanics (shows in the live pact UI).
    pact(id) {
      const dms = scene.dungeonMechanicSystem
      if (!dms) { log('no mechanic system — start a run first'); return { ok: false } }
      if (!id)  { log('usage: __qfDev.pact("the_undying_court") — see __qfDev.pacts()'); return { ok: false } }
      if (dms.isActive(id)) { log(`'${id}' already active`); return { ok: true, already: true } }
      dms.activate(id)
      const on = dms.isActive(id)
      log(on ? `pact applied: ${id}` : `pact FAILED: '${id}' — unknown id? (try __qfDev.pacts('${id}'))`)
      return { ok: on, id }
    },
    unpact(id) {
      const dms = scene.dungeonMechanicSystem
      if (!dms) { log('no mechanic system'); return { ok: false } }
      dms.deactivate(id)
      log(`pact removed: ${id}`)
      return { ok: !dms.isActive(id), id }
    },
    pacts(filter) {
      const dms = scene.dungeonMechanicSystem
      const defs = dms?.allDefinitions?.() ?? []
      const f = filter ? String(filter).toLowerCase() : null
      const list = defs
        .filter(d => !f || String(d.id).toLowerCase().includes(f) || String(d.name).toLowerCase().includes(f))
        .map(d => ({ id: d.id, name: d.name, rarity: d.rarity, active: dms.isActive(d.id) }))
      try { console.table(list) } catch (e) {}
      log(`${list.length} pacts${f ? ` matching '${f}'` : ''} (${list.filter(p => p.active).length} active)`)
      return list
    },

    // Fire one AbilityVfx primitive at the boss (centre of view), slowed for a
    // slow-mo filmstrip capture. Handles the toolkit primitives + the hand-drawn
    // particleBurst (before/after). beamFx fires from up-left into the boss.
    fireVfx(name = 'particleBurstFx', opts = {}) {
      const g = gs(); const b = g?.boss ?? {}
      const TS = 32
      const x = (b.tileX ?? 10) * TS + TS / 2
      const y = (b.tileY ?? 10) * TS + TS / 2
      const slow = opts.slow ?? 6
      let r
      if (name === 'particleBurst')   r = AbilityVfx.particleBurst(scene, x, y, { count: 14, color: 0xffe066, speed: 60, durationMs: 450 * slow })
      else if (name === 'beamFx')       r = AbilityVfx.beamFx(scene, x - 150, y - 120, x, y, { slow, ...opts })
      else if (name === 'projectileFx') r = AbilityVfx.projectileFx(scene, x - 170, y - 130, x, y, { slow, ...opts })
      else if (name === 'flipbookFx')   r = AbilityVfx.flipbookFx(scene, x, y, opts.sheet ?? 'vfx-boss-flame', { slow, scale: 2, glow: true, blend: true, ...opts })
      else if (AbilityVfx[name])        r = AbilityVfx[name](scene, x, y, { slow, ...opts })
      else { log(`no such VFX '${name}' — try particleBurstFx/impactFx/shockwaveFx/beamFx/glowPulseFx/sparkleFx/burnFx/projectileFx/juice/flipbookFx`); return { ok: false } }
      log(`fired VFX '${name}' at (${Math.round(x)},${Math.round(y)}) slow=${slow}`)
      return { ok: !!r, name, x, y }
    },

    // Afflict live adventurers with a poison/burn DoT so the persistent status
    // aura (StatusVfxSystem) is testable — watch a sickly-green / ember haze
    // follow each marked adv until it expires. Needs an active day with advs.
    // usage: __qfDev.dotTest()  |  .dotTest('burn')  |  .dotTest('poison', 12)
    dotTest(type = 'poison', ticks = 8) {
      const g = gs()
      const advs = (g?.adventurers?.active ?? []).filter(a => a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
      if (!advs.length) { log('no live adventurers — run __qfDev.startDay() + spawn a wave first'); return { ok: false } }
      const ma = scene.minionAbilities ?? scene.minionAiSystem?.minionAbilities
      const dmg = type === 'burn' ? 2 : 1
      let n = 0
      for (const a of advs) {
        // _dot is plain data → safe to push directly; StatusVfxSystem picks it up next frame.
        a._dot = a._dot ?? []
        a._dot.push({ type, dmgPerTick: dmg, intervalMs: 1000, ticksLeft: ticks, _lastTickAt: scene.time?.now ?? 0 })
        n++
      }
      log(`applied ${type} DoT (${ticks} ticks) to ${n} adventurer(s) — aura should follow them now`)
      return { ok: true, type, ticks, count: n, hasMinionAbilities: !!ma }
    },

    // Slow-mo filmstrip: dismiss blocking popups, fire one effect heavily slowed,
    // and report the window — the operator screenshots ~6 frames across it to
    // review motion/timing and iterate. (Capture clarity > the busy dungeon bg:
    // additive+glow effects read fine over it, as the POC showed.)
    filmstrip(name = 'particleBurstFx', opts = {}) {
      try { for (const bb of document.querySelectorAll('button')) { const t = (bb.textContent || '').replace(/\s+/g, ' ').trim(); if (/^CONTINUE/i.test(t) || /PRESS ANY KEY/i.test(t)) bb.click() } } catch (e) {}
      const slow = opts.slow ?? 12
      const r = api.fireVfx(name, { slow, ...opts })
      const approxMs = 600 * slow
      log(`filmstrip '${name}': slow=${slow} (~${approxMs}ms) — screenshot ~every ${Math.round(approxMs / 6)}ms`)
      return { ...r, slow, approxDurationMs: approxMs }
    },

    // VFX review gallery — staged captures for a visual-regression contact sheet.
    // Drive from a preview harness: read `.plan`, then for each item call
    // `__qfDev.gallery().stage(key)`, wait ~1s for the VFX, and screenshot to
    // `vfx_<label>.png`. Champions/set-pieces need an active day, so stage()
    // builds the arena + starts a quiet day on first use (idempotent).
    gallery() {
      const CHAMPS = ['mage_tower', 'pantheon', 'inquisition', 'forlorn_hope', 'all_stars', 'plunderers', 'betrayer', 'reckoning_dead', 'rival']
      const plan = [
        { key: 'scene:populated', label: 'populated-arena' },
        ...CHAMPS.map(c => ({ key: 'champion:' + c, label: 'champion-' + c })),
        { key: 'setpiece:necrarch',     label: 'setpiece-necrarch' },
        { key: 'setpiece:rivalDuel',    label: 'setpiece-rivalduel' },
        { key: 'setpiece:betrayerDash', label: 'setpiece-betrayerdash' },
      ]
      // Dismiss blocking DOM popups (act intros, etc.) that soft-pause the scene
      // and hide the VFX — otherwise the signature queues behind the overlay.
      const dismissPopups = () => {
        try {
          for (const b of document.querySelectorAll('button')) {
            const t = (b.textContent || '').replace(/\s+/g, ' ').trim()
            if (/^CONTINUE/i.test(t) || /PRESS ANY KEY/i.test(t)) b.click()
          }
        } catch (e) {}
      }
      const ensureDay = () => {
        api.fastAbilities(true)
        dismissPopups()
        const dp = scene.scene.get('DayPhase')
        if (!(dp?.scene?.isActive?.())) { api.quietDay(true); api.arena(); api.startDay() }
        return !!(scene.scene.get('DayPhase')?.scene?.isActive?.())
      }
      return {
        plan,
        stage(key) {
          const dayOk = ensureDay()
          dismissPopups()
          const [kind, id] = String(key).split(':')
          if (kind === 'scene' && id === 'populated') api.populate({ minions: 12, traps: 5 })
          else if (kind === 'champion') { api.populate({ minions: 8, traps: 2 }); api.champion(id) }
          else if (kind === 'setpiece') { try { api[id]?.() } catch (e) {} }
          const item = plan.find(p => p.key === key)
          log(`gallery staged ${key} (dayActive=${dayOk}) — screenshot now`)
          return { key, label: item?.label ?? key, dayActive: dayOk, ready: true }
        },
      }
    },

    help() {
      const h = [
        'window.__qfDev — Kingdom-Response VFX sandbox',
        "  .gallery()                       VFX review: .plan = capture list; .stage(key) stages each for a screenshot",
        "  .arena()                         one-click: wire an entry hall to the boss so a day can start",
        "  .quietDay(true|false)            toggle QUIET mode (no wave + day stays open); false = back to normal",
        "  .startDay()                      end build phase, start the NORMAL wave",
        "  .endDay()                        END the day now → EndOfDay/night (escape a quiet day)",
        "  .fastAbilities(true)             champion signatures fire in ~0.6s (no 4.5s wait)",
        "  .populate({minions=8,traps=3})   spawn mixed-tier minions (+undead) + traps near the boss",
        "  .setResponse('betrayer')         force the act response → engage its act-wide gimmick",
        "  .champion('pantheon')            fire a champion raid (needs an active DayPhase)",
        "  .necrarch()                      spawn the recurring Necrarch summoner + risen-dead tide",
        "  .rivalDuel()                     force the Rival boss-vs-boss showdown (Vorzak vs your boss)",
        "  .betrayerDash()                  run the Betrayer night-dash sabotage now",
        "  .state()                         dump sandbox state",
        "  .clear()                         remove sandbox minions/traps/raid units",
        "  .pact('the_undying_court')       APPLY any pact directly (test it — no RNG draw)",
        "  .unpact('the_undying_court')     remove a pact",
        "  .pacts('court')                  list pacts (optional filter) + their active state",
        '',
        "  responses: plunderers inquisition forlorn_hope mage_tower pantheon all_stars betrayer reckoning_dead rival",
        '',
        "  clean VFX test from the day-jump:  __qfDev.arena(); __qfDev.fastAbilities(); __qfDev.quietDay(); __qfDev.startDay(); __qfDev.populate(); __qfDev.champion('mage_tower')",
        "  act-wide gimmick:                  __qfDev.setResponse('betrayer'); __qfDev.populate()   // traps flip green ⇄ + chew your minions",
      ].join('\n')
      console.log(h); return h
    },
  }

  window.__qfDev = api

  // "JUMP TO TEST STAGE" auto-setup — when the run was launched from that dev
  // shortcut, wait for the build phase to come up, then build an arena + flip on
  // fast abilities + start a QUIET (wave-less) day, so the run lands directly in a
  // clean VFX stage. One-shot: the flag is cleared immediately.
  let testStage = false
  try { testStage = localStorage.getItem('qf.dev.testStage') === '1'; if (testStage) localStorage.removeItem('qf.dev.testStage') } catch (e) {}
  if (testStage) {
    const onNight = () => {
      EventBus.off('NIGHT_PHASE_STARTED', onNight)
      // setTimeout (not scene timers) so this keeps running while an act-intro
      // popup soft-pauses the scene.
      setTimeout(() => {
        api.arena()                       // wire entry hall(s) to the boss
        api.fastAbilities(true)
        globalThis.__qfDevQuietDay = true  // arm the wave-less day
        console.log('[qfDev] TEST STAGE: arena built, quiet + fast armed — will start a QUIET day once any act-intro is dismissed.')
        // Poll until the build phase is live (intro dismissed) → begin the (quiet) day.
        let tries = 0
        const tryBegin = () => {
          const dp = scene.scene.get('DayPhase')
          if (dp?.scene?.isActive?.()) { console.log('[qfDev] TEST STAGE ready — clean quiet day. Open TEST EVENT → Populate, then a champion card.'); return }
          const np = scene.scene.get('NightPhase')
          if (np?.scene?.isActive?.() && typeof np._beginDay === 'function') np._beginDay()
          if (++tries < 30) setTimeout(tryBegin, 800)
        }
        setTimeout(tryBegin, 400)
      }, 700)
    }
    EventBus.on('NIGHT_PHASE_STARTED', onNight)
  }

  // Arm the runtime invariant checks alongside the sandbox (same cheat gate).
  // Fires on phase transitions; manual run via window.__qfCheck(). See DevInvariants.js.
  try { installDevInvariants(scene) } catch (e) { console.warn('[qfInvariant] install failed', e) }

  console.log('[qfDev] VFX sandbox installed — run window.__qfDev.help()')
  return api
}
