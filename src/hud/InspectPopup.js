// InspectPopup — hover inspector for dungeon entities.
//
// Replaces the old two-tab RoomTooltip and the full-screen
// MinionInspectorOverlay with one lean hover surface that covers rooms,
// minions, adventurers, and dropped loot items.
//
// A small cursor-following panel appears for whatever entity is under
// the pointer. pointer-events:none, purely informational. Its visual
// language deliberately matches the construction-panel footer: a
// category-coloured name, a row of stat boxes, an italic flavor line,
// and (for minions) tagged ABILITY / BEHAVIOR lines.
//
// Hit-detection lives in HudRoot (a canvas pointermove hit-test against
// gameState). This module only listens for the resulting SHOW_INSPECT /
// HIDE_INSPECT events and renders.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { effectiveUiScale } from './stageScale.js'
import { minionAbilityInfo } from '../systems/MinionAbilities.js'
import { ABILITY_DEFS } from '../systems/ClassAbilitySystem.js'
import { passiveIncomeMul } from '../config/balance.js'
import { hasActiveLibrary, hasClassIntel } from './wavePreview.js'
import { MINION_HOVER_ABILITIES, BOSS_HOVER_ABILITIES } from '../data/hoverAbilities.js'
import { ascensionInfo } from '../config/acts.js'

const STAT_LABEL = { attack: 'ATK', defense: 'DEF', maxHp: 'MAX HP', speed: 'SPD' }

// Per-entity accent colour — mirrors the construction panel's category
// colours (ROOMS red / MINIONS green / TRAPS blue / ITEMS gold) so the
// hover panel reads as the same family of surface.
const CAT_COLOR = {
  room:       'var(--blood)',
  minion:     'var(--poison)',
  adventurer: 'var(--warn)',
  item:       'var(--gold-bright)',
  placed:     'var(--info)',
  trap:       'var(--rumor)',
  boss:       'var(--blood-glow)',
}


// ABILITY_DEFS keys are prefixed by a short class tag, not the full
// classId — map classId → prefix so the hover panel can list a class's
// abilities. Classes absent here have no active class abilities.
const CLASS_ABILITY_PREFIX = {
  knight: 'knight', rogue: 'rogue', mage: 'mage', cleric: 'cleric',
  necromancer: 'necro', ranger: 'ranger',
  beast_master: 'bm', barbarian: 'barb', monk: 'monk', bard: 'bard',
  // New classes (2026-06-03) — so the hover panel lists their abilities too
  // (Tunnel / Rally / Strength in Numbers / Crowd Roar + Block / Roll the Dice).
  gladiator: 'glad', peasant: 'peasant', valkyrie: 'valkyrie',
  gambler: 'gambler', miner: 'miner',
}

// Names of every class ability for the hover panel (e.g. "Protective
// Aura · Taunt"). Empty for classes with no active abilities.
function advAbilityLabels(classId) {
  const prefix = CLASS_ABILITY_PREFIX[classId]
  if (!prefix) return ''
  return Object.entries(ABILITY_DEFS)
    .filter(([key]) => key.startsWith(`${prefix}_`))
    .map(([, def]) => def.label)
    .join(' · ')
}

// Raid-only abilities that DON'T carry over when an adventurer is revived as a
// minion by The Undying Court (matches the carriesToRevived exclusions).
const NON_CARRIED_ABILITY_IDS = new Set([
  'lockpick', 'trap_expert', 'tame_beast', 'sic_em', 'tunnel',
])
// The ability labels a REVIVED adventurer keeps as a minion (class abilities
// minus the raid-only ones above).
function revivedAbilityLabels(classId) {
  const prefix = CLASS_ABILITY_PREFIX[classId]
  if (!prefix) return ''
  return Object.entries(ABILITY_DEFS)
    .filter(([key]) => key.startsWith(`${prefix}_`))
    .filter(([, def]) => !NON_CARRIED_ABILITY_IDS.has(def.id))
    .map(([, def]) => def.label)
    .join(' · ')
}

export class InspectPopup {
  constructor(gameState) {
    this._gs   = gameState
    this._el   = null
    this._key  = null

    this._onShow = (p) => this._show(p)
    this._onHide = () => this._hide()
    EventBus.on('SHOW_INSPECT', this._onShow)
    EventBus.on('HIDE_INSPECT', this._onHide)
  }

  // ── Hover panel ───────────────────────────────────────────────────
  _show({ kind, entity, defId = null, x = 0, y = 0 } = {}) {
    if (!kind || !entity) return
    // Bail if the hovered entity died (or HP hit 0) since the popup
    // opened. Without this, the DOM keeps rendering the original
    // hover-start HP/ATK/DEF — the panel never re-renders mid-hover
    // (intentional, to avoid flicker on cursor movement), so a target
    // that gets burst down while the cursor lingers looks alive at,
    // say, 12 HP until the cursor leaves the (now-dead) entity. Only
    // adv/minion have a death state worth checking.
    if (this._isEntityDead(kind, entity)) {
      this._hide()
      return
    }
    const key = this._idOf(kind, entity)
    // Same entity still hovered — just reposition, keep the DOM.
    if (key === this._key && this._el) {
      this._position(x, y)
      return
    }
    this._hide()
    this._key = key
    const kicker = this._kicker(kind, entity, defId)
    this._el = h('div', {
      className: 'qf-inspect',
      style: { '--cat-color': CAT_COLOR[kind] || 'var(--line-bright)' },
    }, [
      h('div', { className: 'qf-inspect-head' }, [
        h('div', { className: 'qf-inspect-name' }, this._title(kind, entity, defId)),
        kicker ? h('div', { className: 'qf-inspect-kicker', dataset: kicker.tier ? { tier: String(kicker.tier) } : {} }, kicker.text) : null,
      ].filter(Boolean)),
      h('div', { className: 'qf-inspect-body' }, this._content(kind, entity, defId)),
    ])
    document.body.appendChild(this._el)
    this._position(x, y)
  }

  _position(x, y) {
    const el = this._el
    if (!el) return
    // The popup is a `position: fixed` element on document.body, so it does
    // NOT inherit #hud-stage's `zoom`. Scale it ourselves to match the HUD,
    // around a clean `transform-origin: 0 0` so the box grows down-right from
    // (left, top) and the flip/clamp math below stays a plain affine.
    const s = effectiveUiScale()
    el.style.transformOrigin = '0 0'
    // --tt-scale makes the `tooltip-in` entrance keyframe animate TO scale(s)
    // so it lands on the resting transform below instead of popping.
    el.style.setProperty('--tt-scale', String(s))
    el.style.transform = s === 1 ? '' : `scale(${s})`
    // On-screen footprint = unscaled box × scale (offset* report the unscaled,
    // pre-transform layout size).
    const w  = (el.offsetWidth  || 230) * s
    const ht = (el.offsetHeight || 130) * s
    // Default down-right of the cursor; flip / clamp to stay on-screen.
    // y+44 clears the 42-px custom cursor sprite's bottom edge so the
    // tooltip header isn't covered. x+16 keeps it anchored close to
    // the cursor hotspot horizontally.
    let left = x + 16
    let top  = y + 44
    if (left + w  > window.innerWidth  - 8) left = x - w - 16
    if (top  + ht > window.innerHeight - 8) top  = window.innerHeight - ht - 8
    el.style.left = `${Math.max(8, left)}px`
    el.style.top  = `${Math.max(8, top)}px`
  }

  _hide() {
    this._el?.remove()
    this._el  = null
    this._key = null
  }

  // True if an adv/minion is dead or at 0 HP — used by _show to tear
  // the popup down rather than render a stale corpse. Rooms / items /
  // traps / placed have no death state and always return false.
  _isEntityDead(kind, entity) {
    if (kind !== 'adventurer' && kind !== 'minion') return false
    if (!entity) return true
    if (entity.aiState === 'dead') return true
    const hp = entity.resources?.hp ?? entity.hp
    if (Number.isFinite(hp) && hp <= 0) return true
    return false
  }

  // ── Content (crypt-console redesign: stat chips + ability list) ────
  _content(kind, entity, defId) {
    let parts = []
    if      (kind === 'room')       parts = this._roomContent(entity)
    else if (kind === 'minion')     parts = this._minionContent(entity)
    else if (kind === 'adventurer') parts = this._advContent(entity)
    else if (kind === 'item')       parts = this._itemContent(entity)
    else if (kind === 'placed')     parts = this._placedContent(defId, entity)
    else if (kind === 'trap')       parts = this._trapContent(entity, defId)
    else if (kind === 'boss')       parts = this._bossContent(entity)
    return parts.filter(Boolean)
  }

  // Right-side header chip → { text, tier? }. tier (1–4) colour-codes the chip as
  // a rarity ramp (steel → blue → purple → gold). Level chips carry no tier.
  _kicker(kind, entity, defId) {
    if (kind === 'minion') {
      if (entity._revivedAdv) return { text: `LV ${this._int(entity._raisedLevel ?? entity.level ?? 1)}` }
      const tier = this._minionTierNum(entity)
      return { text: `TIER ${tier}`, tier }
    }
    if (kind === 'adventurer') {
      if (entity._shadowMonarch || entity.classId === 'shadow_monarch') return { text: 'LV ∞' }
      return { text: `LV ${this._int(entity.displayLevel ?? entity.level ?? 1)}` }
    }
    if (kind === 'boss') return { text: `LV ${this._int(entity.level ?? 1)}` }
    return null
  }

  _statsGrid(boxes) {
    if (!boxes.length) return null
    // Never show decimals — round any numeric stat value at the display.
    const disp = (v) => String(Number.isFinite(v) ? Math.round(v) : v)
    return h('div', {
      className: 'qf-inspect-stats',
      style: { gridTemplateColumns: `repeat(${boxes.length}, 1fr)` },
    }, boxes.map(([label, value]) => h('div', { className: 'qf-inspect-stat' }, [
      h('div', { className: 'qf-inspect-stat-label' }, label),
      h('div', { className: 'qf-inspect-stat-value' + (disp(value) === '∞' ? ' inf' : '') }, disp(value)),
    ])))
  }

  _descLine(text, locked = false) {
    return h('div', { className: 'qf-inspect-desc' + (locked ? ' qf-inspect-locked' : '') }, text)
  }

  // Never show decimals in player-facing numbers — round, pass non-numbers
  // (e.g. the '?' fallback) through untouched.
  _int(v) { return Number.isFinite(v) ? Math.round(v) : v }

  // Ability list — each entry is a coloured NAME over a brief generic one-liner.
  // `abilities` = [{ name, desc }]. `divided` adds a top rule (separates it from
  // the labeled lines above, e.g. on the adventurer panel).
  _abilityList(abilities, divided = false) {
    const list = (abilities || []).filter(a => a && a.name)
    if (!list.length) return null
    return h('div', { className: 'qf-inspect-abilities' + (divided ? ' divided' : '') },
      list.map(ab => h('div', { className: 'qf-inspect-ability' }, [
        h('div', { className: 'qf-inspect-ability-name' }, String(ab.name)),
        ab.desc ? h('div', { className: 'qf-inspect-ability-desc' }, ab.desc) : null,
      ].filter(Boolean))))
  }

  // Labeled rows (CLASS / PERSONALITY) — `rows` = [[tag, value], …].
  _labeledLines(rows) {
    const valid = (rows || []).filter(([, v]) => v != null && v !== '')
    if (!valid.length) return null
    return h('div', { className: 'qf-inspect-lines' }, valid.map(([tag, val]) =>
      h('div', { className: 'qf-inspect-line' }, [
        h('div', { className: 'qf-inspect-line-tag' }, tag),
        h('div', { className: 'qf-inspect-line-val' }, val),
      ])))
  }

  // Extract a clean ability NAME from a longer "Name — blurb" / "Name (note)"
  // string (used for the boss-ability fallback off bossArchetypes.json).
  _cleanAbilityName(text) {
    const s = String(text || '')
    const i = s.search(/\s[—(]/)
    return (i > 0 ? s.slice(0, i) : s).trim()
  }

  _roomContent(room) {
    const def = this._roomDef(room)
    return [
      room.isActive === false ? this._descLine('⊘ OFFLINE — not connected to the dungeon.', true) : null,
      def?.description ? this._descLine(def.description) : null,
    ]
  }

  _minionContent(m) {
    // The Undying Court — a revived adventurer is a minion, but it should read
    // as the FALLEN HERO it was (its class, carried stats + abilities), not as
    // the skeleton base def it's built on.
    if (m._revivedAdv) return this._revivedAdvContent(m)
    const hp    = m.resources?.hp ?? m.stats?.hp ?? '?'
    const maxHp = m.resources?.maxHp ?? hp
    // Converted thralls share the vampire_minion1 def but roam in the open — give
    // them their own ability line rather than the base def's.
    const abilities = m._isVampireThrall
      ? [{ name: 'Bloodthirst', desc: 'Heals itself for part of the damage it deals.' }]
      : (MINION_HOVER_ABILITIES[m.definitionId] || this._fallbackMinionAbilities(m))
    return [
      this._reinforcementBadge(m),
      this._statsGrid([
        ['HP',  `${this._int(hp)}/${this._int(maxHp)}`],
        ['ATK', m.stats?.attack ?? '?'],
      ]),
      this._abilityList(abilities),
    ]
  }

  // Until a family's generic lines are authored in hoverAbilities.js, parse the
  // existing MINION_ABILITY_INFO "Name — blurb" string into one {name, desc}.
  _fallbackMinionAbilities(m) {
    const info = minionAbilityInfo(m.definitionId)
    if (!info?.ability) return null
    const i = info.ability.indexOf(' — ')
    return [{
      name: i > 0 ? info.ability.slice(0, i).trim() : 'Ability',
      desc: i > 0 ? info.ability.slice(i + 3).trim() : info.ability.trim(),
    }]
  }

  _minionTierNum(m) {
    const id     = m?.definitionId
    const chains = this._cachedJson('minionEvolutions') ?? {}
    for (const data of Object.values(chains)) {
      const chain = data?.chain
      if (Array.isArray(chain)) { const i = chain.indexOf(id); if (i !== -1) return i + 1 }
    }
    const def = this._minionDef(m)
    return def?.tier || 1
  }

  // The Undying Court — hover content for a revived adventurer minion: reads as
  // the risen hero (class, carried combat profile + abilities), not the skeleton
  // base def it's rendered on. (Level shows in the header kicker.)
  _revivedAdvContent(m) {
    const cls = (this._cachedJson('adventurerClasses') ?? []).find(x => x.id === m._raisedClassId)
    const className = cls?.name || (m._raisedClassId
      ? m._raisedClassId.charAt(0).toUpperCase() + m._raisedClassId.slice(1)
      : 'Adventurer')
    const hp    = m.resources?.hp ?? '?'
    const maxHp = m.resources?.maxHp ?? hp
    const labels = revivedAbilityLabels(m._raisedClassId)
    return [
      h('div', { className: 'qf-inspect-reinf' }, [
        h('span', { className: 'qf-inspect-reinf-icon' }, '⚰'),
        `RISEN ${className.toUpperCase()}`,
      ]),
      this._statsGrid([
        ['HP',  `${this._int(hp)}/${this._int(maxHp)}`],
        ['ATK', m.stats?.attack ?? '?'],
        ['DEF', m.stats?.defense ?? 0],
      ]),
      labels
        ? this._abilityList([{ name: 'Risen Hero', desc: `Fights for you, keeping its ${className} abilities: ${labels}.` }])
        : this._descLine(`A fallen ${className} raised to fight for the dungeon.`),
    ]
  }

  // Tag for ascension reinforcements (KR P6) — the boss's kin that the dungeon
  // fields each act — so the free units the player didn't place read as earned,
  // not mysterious. Null for normal minions.
  _reinforcementBadge(m) {
    if (!m?._reinforcement) return null
    // Ascension throne guard — boss-room-bound kin that evolve each act.
    const label = m._ascGuardian
      ? (m._reinforcementElite ? 'THRONE GUARD · ELITE FORM' : 'ASCENSION THRONE GUARD')
      : (m._reinforcementElite ? 'ELITE ASCENSION REINFORCEMENT' : 'ASCENSION REINFORCEMENT')
    return h('div', { className: `qf-inspect-reinf${m._reinforcementElite ? ' elite' : ''}` }, [
      h('span', { className: 'qf-inspect-reinf-icon' }, '✦'),
      label,
    ])
  }

  _advContent(a) {
    const def   = this._advDef(a)
    const cls   = def?.name || a.classId || 'Adventurer'
    // Intel gate (2026-06-20): a class's stats / personality / abilities are
    // hidden until the player has a Library AND has killed one of that class
    // this run. Until then the hover shows a locked notice (the class is still
    // visible on screen, so its name + sprite read; only the intel is masked).
    if (!hasClassIntel(this._gs, def)) return this._advLockedContent(cls)
    const hp    = a.resources?.hp ?? a.stats?.hp ?? '?'
    const maxHp = a.resources?.maxHp ?? hp
    return [
      this._statsGrid([
        ['HP',  `${this._int(hp)}/${this._int(maxHp)}`],
        ['ATK', a.stats?.attack ?? '?'],
      ]),
      this._labeledLines([
        ['CLASS',       cls],
        ['PERSONALITY', this._personalityNames(a) || '—'],
      ]),
      this._advAbilityList(def),
    ]
  }

  // Locked hover for a class whose intel isn't unlocked yet — class identity +
  // how to unlock it (build a Library, or defeat one of this class this run).
  _advLockedContent(cls) {
    const notice = hasActiveLibrary(this._gs)
      ? `Defeat a ${cls} this run to study its stats and abilities.`
      : 'Build a Library of Whispers to study the fallen.'
    return [
      this._labeledLines([['CLASS', cls]]),
      this._descLine(`⊘ INTEL LOCKED — ${notice}`, true),
    ]
  }

  // Per-class abilities (name + brief desc) from adventurerClasses.json's
  // `abilities`; falls back to the ClassAbilitySystem labels for classes that
  // have no authored copy.
  _advAbilityList(def) {
    const abilities = Array.isArray(def?.abilities) ? def.abilities : []
    if (abilities.length) {
      return this._abilityList(abilities.map(ab => ({ name: ab.name, desc: ab.desc })), true)
    }
    const labels = advAbilityLabels(def?.id)
    return labels ? this._abilityList([{ name: labels, desc: '' }], true) : null
  }

  _personalityNames(a) {
    const defs = this._cachedJson('personalities') ?? []
    return (a.personalityIds ?? [])
      .map(pid => defs.find(d => d.id === pid)?.name ?? pid)
      .join(' · ')
  }

  _itemContent(p) {
    const stat  = p.buff?.stat ?? 'speed'
    const label = STAT_LABEL[stat] ?? String(stat).toUpperCase()
    const amt   = p.buff?.amount
    return [
      this._descLine(amt != null
        ? `Dropped loot. An adventurer who grabs it permanently gains +${amt} ${label}.`
        : `Dropped loot. An adventurer who grabs it gains a permanent ${label} boost.`),
    ]
  }

  // Placed construction item (treasure chest / beacon / fountain / key
  // chest / phylactery / door lock) — resolved from items.json by defId.
  // Mimic Vault cursed chest gets its own bespoke content (the regular
  // items.json def describes a normal tier-N chest, none of which is
  // true for the cursed version).
  _placedContent(defId, entity) {
    if (entity?._mimicCursed) return this._cursedChestContent()
    const def = this._itemsDef(defId)
    if (!def) return []
    const boxes = []
    if (def.treasure?.goldPerDay != null) {
      // Show the SCALED payout (boss-level-only by default) so the readout
      // matches what AISystem actually pays out each night.
      const perDay = Math.round(def.treasure.goldPerDay * passiveIncomeMul(
        this._gs?.boss?.level ?? 1, this._gs?.meta?.dayNumber ?? 1))
      boxes.push(['GOLD / DAY', `${perDay}g`])
    }
    if (def.baseStats?.hp != null)        boxes.push(['HP', def.baseStats.hp])
    const parts = []
    if (boxes.length)    parts.push(this._statsGrid(boxes))
    if (def.description) parts.push(this._descLine(def.description))
    return parts
  }

  _cursedChestContent() {
    return [
      this._statsGrid([['PENALTY', '25% gold on escape']]),
      this._descLine(
        "Disguised as a treasure chest. Adventurers see ordinary loot and " +
        "want to steal it. If the opener escapes the dungeon alive, you " +
        "lose 25% of your current gold. Killing them en route nullifies " +
        "the curse. Refreshes daily; cannot be sold or moved individually.",
      ),
    ]
  }

  // Placed trap — resolved from trapTypes.json: damage chip + generic description.
  _trapContent(t, defId) {
    const def = this._trapDef(defId)
    const dmg = t.stats?.damage ?? def?.damage ?? def?.baseDamage ?? def?.baseStats?.damage
    return [
      dmg != null ? this._statsGrid([['DAMAGE', dmg]]) : null,
      def?.description ? this._descLine(def.description) : null,
    ]
  }

  // Boss hover — name + level (kicker) + ascension tier + HP/ATK + its abilities
  // (the throne-fight signature + passive mechanics), EXCLUDING the day-active
  // ability, each with a brief generic line.
  _bossContent(b) {
    const def = this._bossDef(b)
    const hp    = b.hp ?? b.resources?.hp ?? '?'
    const maxHp = b.maxHp ?? b.resources?.maxHp ?? hp
    const atk   = b.attack ?? b.stats?.attack ?? def?.baseFightStats?.attack ?? '?'
    const asc   = ascensionInfo(this._gs)
    const tier  = asc ? (asc.tierLabel || asc.label || (asc.tier != null ? `Tier ${asc.tier}` : null)) : null
    return [
      this._statsGrid([
        ['HP',  `${this._int(hp)}/${this._int(maxHp)}`],
        ['ATK', this._int(atk)],
      ]),
      tier ? this._labeledLines([['ASCENSION', tier]]) : null,
      this._abilityList(this._bossAbilities(b, def), true),
    ]
  }

  // Boss abilities for the hover: authored generic lines if present, else derived
  // from bossArchetypes.json — the throne-fight signature (`headline`) + passive
  // `mechanics`, dropping any mechanic tagged "(day active)".
  _bossAbilities(b, def) {
    const authored = BOSS_HOVER_ABILITIES[def?.id]
    if (authored?.length) return authored
    if (!def) return null
    const out = []
    if (def.headline?.name) {
      out.push({ name: this._cleanAbilityName(def.headline.name), desc: def.headline.brief || def.headline.summary || '' })
    }
    for (const m of (def.mechanics || [])) {
      if (/\(day active\)/i.test(m.text || '')) continue
      out.push({ name: this._cleanAbilityName(m.text), desc: m.brief || '' })
    }
    return out
  }

  _bossDef(b) {
    // player.bossArchetypeId is sometimes prefixed "the_" (e.g. the_lich); the
    // JSON ids are not — strip it so the lookup matches.
    const id = String(b?.archetypeId || b?.definitionId || this._gs?.player?.bossArchetypeId || '').replace(/^the_/, '')
    return id ? ((this._cachedJson('bossArchetypes') ?? []).find(d => d.id === id) || null) : null
  }

  // ── Title ─────────────────────────────────────────────────────────
  _title(kind, entity, defId) {
    if (kind === 'room')       return (this._roomName(entity) || entity.definitionId || 'Room').toUpperCase()
    if (kind === 'minion')     return (entity.name || this._minionName(entity) || 'Minion').toUpperCase()
    if (kind === 'adventurer') return (entity.name || 'Adventurer').toUpperCase()
    if (kind === 'item')       return 'DROPPED LOOT'
    if (kind === 'placed') {
      if (entity?._mimicCursed) return 'CURSED CHEST'
      return (this._itemsDef(defId)?.name || 'Item').toUpperCase()
    }
    if (kind === 'trap')       return (this._trapDef(defId)?.name || 'Trap').toUpperCase()
    if (kind === 'boss')       return (entity.name || this._bossDef(entity)?.name || 'The Dark Lord').toUpperCase()
    return ''
  }

  _idOf(kind, entity) {
    const id = entity.instanceId ?? entity.id ??
      (entity.tileX != null ? `${entity.tileX},${entity.tileY}` : '?')
    return `${kind}:${id}`
  }

  // ── JSON-cache lookups ────────────────────────────────────────────
  // Accept both arrays (rooms, minionTypes, adventurerClasses, items,
  // trapTypes, personalities — flat lists) AND plain objects
  // (minionEvolutions — keyed by starter id). Mirrors RosterOverlay's
  // _cachedJson so both surfaces resolve the same JSON shapes.
  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
    }
    return null
  }

  _roomDef(room)   { return (this._cachedJson('rooms') ?? []).find(d => d.id === room.definitionId) || null }
  _roomName(room)  { return this._roomDef(room)?.name || null }
  _minionDef(m)    { return (this._cachedJson('minionTypes') ?? []).find(x => x.id === m.definitionId) || null }
  _minionName(m)   { return this._minionDef(m)?.name || null }
  _advDef(a)       { return (this._cachedJson('adventurerClasses') ?? []).find(x => x.id === a.classId) || null }
  _itemsDef(defId) { return defId ? ((this._cachedJson('items') ?? []).find(d => d.id === defId) || null) : null }
  _trapDef(defId)  { return defId ? ((this._cachedJson('trapTypes') ?? []).find(d => d.id === defId) || null) : null }

  // Tier = the minion's position in its evolution chain: chain[0] is T1,
  // chain[1] T2, chain[2] T3. The definitionId mutates up the chain on
  // each evolution, so the current id directly encodes the tier.
  // Mirrors RosterOverlay._tierOf — same logic, kept inline so this
  // module stays self-contained. Fallback to def.tier or T1 for
  // minions outside any evolution chain (mimics, garrison spawns).
  destroy() {
    EventBus.off('SHOW_INSPECT', this._onShow)
    EventBus.off('HIDE_INSPECT', this._onHide)
    this._hide()
  }
}
