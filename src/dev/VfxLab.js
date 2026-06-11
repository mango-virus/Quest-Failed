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
import { AbilityVfx, VfxPalette } from '../ui/AbilityVfx.js'

const MINION_ANIMS = ['idle', 'walk', 'run', 'attack', 'hurt', 'death']
const ADV_ANIMS    = ['idle', 'walk', 'slash', 'thrust', 'spellcast', 'shoot', 'hurt', 'death']
const RAW_VFX = [
  'impactFx', 'shockwaveFx', 'glowPulseFx', 'sparkleFx', 'burnFx',
  'particleBurstFx', 'pulseRing', 'juice', 'beamFx', 'projectileFx',
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
    // Sweep EVERY lab-frozen entity in-place (robust against any accumulation,
    // and guarantees close() leaves nothing behind to leak into a save).
    const sweep = (arr) => { if (!arr) return; for (let i = arr.length - 1; i >= 0; i--) if (arr[i]?._vfxLabFrozen) arr.splice(i, 1) }
    sweep(this._gs.minions)
    sweep(this._gs.adventurers?.active)
    this._entity = null; this._dummy = null
  }

  _spawn(kind, id) {
    this._despawn()
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
  _abilitiesOf(entity) {
    if (!entity?.definitionId) return []
    const def = (this._scene.cache.json.get('minionTypes') ?? []).find(d => d.id === entity.definitionId)
    return Array.isArray(def?.abilities) ? def.abilities : []
  }

  _fireAbility(ab) {
    const fire = () => MinionAbilities.fireAbility(this._scene, this._entity, this._dummy, this._gs, ab)
    fire(); this._setLoop('fire', fire)
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

  _fireRaw(name, colorKey) {
    const s = this._scene, e = this._entity, d = this._dummy
    if (!e) return
    const pal = VfxPalette[colorKey] ?? VfxPalette.holy
    const opts = { color: pal.color, accent: pal.accent, slow: this._slow ? 6 : 1 }
    const fn = () => {
      switch (name) {
        case 'beamFx':       AbilityVfx.beamFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), opts); break
        case 'projectileFx': AbilityVfx.projectileFx(s, e.worldX, e.worldY, (d?.worldX ?? e.worldX + 90), (d?.worldY ?? e.worldY), opts); break
        case 'pulseRing':    AbilityVfx.pulseRing(s, e.worldX, e.worldY, { color: pal.color, fromR: 6, toR: 40, alpha: 0.85, durationMs: 500 }); break
        case 'juice':        AbilityVfx.juice(s, e.worldX, e.worldY, opts); break
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
    pick.appendChild(ogM); pick.appendChild(ogA)
    pick.value = 'minion:goblin1'
    pick.onchange = () => { const [k, id] = pick.value.split(':'); this._spawn(k === 'adv' ? 'adv' : 'minion', id) }
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
    for (const v of RAW_VFX) rawSec.appendChild(this._btn(v.replace('Fx', ''), () => this._fireRaw(v, colorKey)))
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
    if (!abs.length) this._abilitySec.appendChild(this._el('div', 'font:9px monospace;color:#777;', '(no data abilities — adventurer or stat-block)'))
    for (const ab of abs) this._abilitySec.appendChild(this._btn(`${ab.label ?? ab.type} ·${ab.trigger}`, () => this._fireAbility(ab)))
    // Animations
    while (this._animSec.children.length > 1) this._animSec.lastChild.remove()
    const isMinion = !!this._entity?.definitionId
    const states = isMinion ? MINION_ANIMS : ADV_ANIMS
    for (const st of states) this._animSec.appendChild(this._btn(st, () => this._playAnim(st)))
    this._animSec.appendChild(this._btn('▸ resume', () => this._playAnim(null)))
  }
}
