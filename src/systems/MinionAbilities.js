// Centralised minion-ability effects.
//
// Pass-1 abilities are mostly passive on-hit/on-death/on-tick effects. To keep
// the change surface small, each callsite (CombatSystem, MinionAISystem) calls
// into one of three entrypoints here:
//
//   onHit(scene, attacker, target, damage, gameState)
//     Hook from CombatSystem.tryAttack right after damage is applied.
//     Routes by attacker.definitionId to apply DoTs, lifesteal, root, etc.
//
//   onMinionDeath(scene, minion, gameState)
//     Hook from MinionAISystem._die. Currently used to credit pickpocketed
//     gold to the dungeon when the minion would have otherwise carried it
//     home.
//
//   tickEntity(entity, scene, delta)
//     Per-frame DoT / status-expiry processor. Called from AISystem (advs)
//     and MinionAISystem (minions). Applies poison/burn ticks, clears expired
//     root/stagger flags.
//
//   isRooted(entity, now), isStaggered(entity, now)
//     Quick predicates for AISystem to gate movement/combat actions.

import { AbilityVfx } from '../ui/AbilityVfx.js'
import { EventBus }   from './EventBus.js'
import { NerveBands } from './NerveSystem.js'
import { TILE }       from './DungeonGrid.js'

// ── Data-driven ability layer (Thread E) ────────────────────────────────────
// Combat abilities now live in minionTypes.json under a top-level `abilities`
// array on each type: [{ type, trigger, ...params }]. Triggers: 'onHit',
// 'onDeath', 'onTick'. Resolved by definitionId so an evolved form (zombie2,
// elder_lich, elder_slime1…) automatically runs ITS tier's abilities — which
// is how Thread D gives mid/final forms signatures the old tier-1-only family
// Sets couldn't. Movement behaviors (hide/teleport/scavenge/march) stay in
// code (tickBehavior); only buff/debuff/heal/summon/DoT effects are data.
//
// Data comes from the Phaser/sim JSON cache (scene.cache.json.get) — the same
// pattern every other system uses — lazily indexed into a definitionId→abilities
// Map on first access so we don't rebuild it per hit.
let _abilityMap = null
function _abilityMapFrom(scene) {
  if (_abilityMap) return _abilityMap
  const defs = scene?.cache?.json?.get?.('minionTypes')
  if (!Array.isArray(defs)) return null   // cache not ready yet — try again next call
  _abilityMap = new Map()
  for (const def of defs) {
    if (def?.id && Array.isArray(def.abilities) && def.abilities.length) {
      _abilityMap.set(def.id, def.abilities)
    }
  }
  return _abilityMap
}
function _abilitiesFor(entity, scene, trigger) {
  if (!entity?.definitionId) return null
  const map = _abilityMapFrom(scene)
  if (!map) return null
  const all = map.get(entity.definitionId)
  if (!all) return null
  return trigger ? all.filter(a => a.trigger === trigger) : all
}

// Family helpers — keep ability application keyed off definitionId so we can
// add new evolutions without rewiring this file. Boss-archetype mini-boss
// final forms are included so they retain their family abilities when
// summoned by BossArchetypeSystem (otherwise the evolution silently drops
// Petrify Gaze, Hellfire Brand, etc).
const RAT_IDS         = new Set(['rat1', 'rat2', 'rat3'])
const DEMON_IDS       = new Set(['demon1', 'demon2', 'demon_lord'])
const VAMPIRE_IDS     = new Set(['vampire_minion1', 'vampire_minion2', 'vampire_sovereign'])
const BEHOLDER_IDS    = new Set(['beholder1', 'beholder2', 'beholder_tyrant'])
const GOLEM_IDS       = new Set(['golem1', 'golem2', 'golem_warden'])
const GOBLIN_IDS      = new Set(['goblin1', 'goblin2', 'goblin3'])
const LIZARDMAN_IDS   = new Set(['lizardman1', 'lizardman2', 'serpent_captain'])
const SLIME_IDS       = new Set(['slime1', 'slime2', 'slime3', 'slime4'])
const GNOLL_IDS       = new Set(['gnoll1', 'gnoll2', 'gnoll_alpha'])
const ORC_IDS         = new Set(['orc1', 'orc2', 'orc_veteran'])
const GHOST_IDS       = new Set(['ghost1', 'ghost2', 'dark_wraith'])
const LICH_IDS        = new Set(['lich1', 'lich2', 'elder_lich'])
const MUSHROOM_IDS    = new Set(['mushroom1', 'mushroom2', 'myconid_stalker'])

// ── Player-facing ability/behavior text ─────────────────────────────────────
// One entry per buildable minion (Tier-1s + Mimic). BuildMenuTooltip pulls
// these straight into the hover panel so the player knows what they're
// buying without reading the source. Keep both lines short — they're side-
// scrolling text in a 270px panel with 9px font.
export const MINION_ABILITY_INFO = {
  // WIPED for the ground-up ability redesign. Repopulated per family as each
  // family's kit is locked — one entry PER TIER (not just tier-1) so the
  // BuildMenu / UPGRADE info / hover UI always show the correct current ability
  // and the next tier's ability. Mimic keeps its identity (re-added with the
  // first family pass).
  mimic: { ability: 'Devour — instakills any adventurer who loots it, and banks +5g to your treasury per hit.', behavior: 'Ambush — hides as a treasure chest (re-disguises each night) and springs on whoever opens it.' },

  // ── GOBLIN — mechanic: PLUNDER (steal gold) ──────────────────────────────
  goblin1: { ability: 'Pilfer — every hit instantly banks +2g to your treasury.', behavior: 'Greed: a cheap, fragile gold faucet during invasions.' },
  goblin2: { ability: 'Pilfer (+2g/hit) + Mark for Plunder — brands a hero so every minion that hits them also steals gold, plus a gold-bleed.', behavior: 'Greed: turns one hero into payday for the whole room.' },
  goblin3: { ability: "Pilfer + Mark + Warband's Cut (doubles goblin plunder in-room) + Grand Heist — periodically brands every hero in the room.", behavior: 'Greed: the capstone of a goblin gold-rush dungeon.' },

  // ── SKELETON — mechanic: REASSEMBLY ("they don't stay dead") ─────────────
  skeleton1: { ability: 'Reassemble — when killed, collapses then clatters back up once at 50% HP. The party has to kill it twice.', behavior: 'Attrition: a cheap body that wastes the enemy’s time and HP.' },
  skeleton2: { ability: 'Reassemble ×2 — gets back up twice, and each rise it returns in a bone-armor shell (damage reduction) and flings a ring of bone shards at nearby heroes.', behavior: 'Attrition: the more you break it, the harder it is to put down.' },
  skeleton3: { ability: 'Reassemble ×3 + bone-armor & shards, plus Undying Legion — periodically raises every fallen undead nearby and turns near-unkillable for a few seconds.', behavior: 'Attrition: a self-resurrecting commander that drags the dead back up with it.' },

  // ── ORC — mechanic: BLOODLUST (escalating attack from hits landed) ────────
  orc1: { ability: 'Bloodlust — every hit it lands stacks +ATK (up to a cap); the longer it brawls, the harder it swings. Stacks fade out of combat.', behavior: 'Aggression: a brawler that snowballs a sustained fight.' },
  orc2: { ability: 'Bloodlust + War Cry — periodically shouts, granting Bloodlust stacks to EVERY orc in the room so the whole warband ramps together.', behavior: 'Aggression: the warband ramps as one.' },
  orc_veteran: { ability: 'Bloodlust + War Cry + Warpath — maxes its own and the warband’s fury and goes on a Rampage (big ATK + speed surge), bulldozing the room.', behavior: 'Aggression: an unstoppable rampage that can wipe a committed party.' },

  // ── SLIME · SPLITTER — mechanic: SPLIT (swarm by division) ────────────────
  slime2: { ability: 'Split — when killed, divides into 2 weak slimelings. Kill it and you’ve made two problems.', behavior: 'Swarm: a cheap body that multiplies and ties up the party.' },
  slime9: { ability: 'Split (×2 on death) + buds off a slimeling when it’s badly hurt — bleeds copies under pressure.', behavior: 'Swarm: divides faster the harder you hit it.' },
  slime1: { ability: 'Splits into 3 on death, and the slimelings can split once themselves — a cascading swarm.', behavior: 'Swarm: one kill becomes a tide of slimes.' },
  elder_slime2: { ability: 'Mitosis Storm — constantly buds slimelings on a timer and erupts into a big batch when killed. Near-endless division.', behavior: 'Swarm: the room drowns in slime.' },

  // ── SLIME · PLAGUE — mechanic: CONTAGION (spreading poison) ───────────────
  slime3: { ability: 'Infect — every hit lands a stacking poison that ticks the hero down over time.', behavior: 'Plague: an attrition DoT that punishes a long fight.' },
  slime7: { ability: 'Infect + Contagion — infected heroes spread the poison to nearby allies; the plague jumps through the party.', behavior: 'Plague: the more they cluster, the faster it spreads.' },
  slime8: { ability: 'Infect (stronger) + Contagion — spreads farther & faster, and infected heroes leave a brief toxic trail.', behavior: 'Plague: a walking epidemic.' },
  elder_slime1: { ability: 'Infect + Contagion + Outbreak — periodically infects every hero in the room in a toxic cloud.', behavior: 'Plague: a room-wide pandemic that can rot the whole party.' },

  // ── SLIME · CORROSIVE — mechanic: ACID PUDDLES (floor denial) ─────────────
  slime4: { ability: 'Acid Burst — when killed, bursts into a lingering caustic puddle that damages anyone who stands in it.', behavior: 'Denial: punishes the spot where it dies — pushes heroes off ground you choose.' },
  slime5: { ability: 'Acid Trail + Acid Burst — leaves a smoking caustic trail everywhere it roams, and bursts into a puddle on death.', behavior: 'Denial: paints the room with hazard the party has to path around.' },
  slime6: { ability: 'Corrosive Trail + Pool — bigger, longer puddles that MELT armor (shred defense) and slow heroes who linger in them.', behavior: 'Denial: turns the floor into an armor-stripping bog.' },
  elder_slime3: { ability: 'Acid Flood — periodically floods the ENTIRE room with armor-melting acid. Total floor denial.', behavior: 'Denial: there is nowhere safe to stand while it floods.' },

  // ── VAMPIRE · LIFE DRAIN — mechanic: heal off the life it takes ───────────
  vampire_minion1: { ability: 'Lifesteal — heals for a share of the damage it deals on every hit.', behavior: 'Sustain: outlasts a slow fight — burst it down or it heals back up.' },
  vampire_minion2: { ability: 'Bloodgorge — stronger lifesteal; healing past full HP banks as a temporary blood-shield that absorbs hits.', behavior: 'Sustain: the longer it drains, the tankier it gets. Front-load damage.' },
  vampire_sovereign: { ability: 'Blood Feast — periodically siphons HP from EVERY hero in the room at once, gorging to overflow (huge blood-shield) + healing vampire-kin.', behavior: 'Sustain: a self-healing wall the party must out-burst, not out-last.' },

  // ── RAT · SWARM — mechanic: strength in numbers ──────────────────────────
  rat1: { ability: 'Swarm — bites harder for every other rat sharing its room (capped). Pathetic alone, dangerous in a pack.', behavior: 'Swarm: cheap bodies — flood the room, keep them clustered.' },
  rat2: { ability: 'Pack Tactics — steeper swarm damage AND takes less damage per pack member. A clustered pack is bite-y AND tanky.', behavior: 'Swarm: cleave them apart to drop the count and break the pack.' },
  rat3: { ability: 'Vermin Tide — periodically frenzies every rat in the room: max swarm bonus (damage + armor) + a speed surge.', behavior: 'Swarm: the pack-lord — turns even a small pack into a horde on cue.' },

  // ── ZOMBIE · RAISE THE DEAD — mechanic: slain heroes rise as your zombies ──
  zombie1: { ability: 'Reanimate — a hero this zombie lands the killing blow on rises as a weak Risen zombie under your control (room-capped).', behavior: 'Outbreak: cheap relentless body — every kill grows the horde.' },
  zombie2: { ability: 'Contagion Bite — its bites infect heroes with rot; an infected hero that dies to ANY source rises as a zombie. The plague spreads the outbreak.', behavior: 'Outbreak: turns the whole party into potential recruits.' },
  zombie3: { ability: 'Mass Grave — periodically claws the room\'s fallen heroes back up at once as a zombie horde + a room-wide rot infection.', behavior: 'Outbreak: the dead rise en masse — the more that died here, the bigger the horde.' },

  // ── DEMON · HELLFIRE — mechanic: escalating burn aura ─────────────────────
  demon1: { ability: 'Burning Aura — radiates hellfire; nearby heroes burn for escalating fire each second (cools when they back off).', behavior: 'Immolation: a walking bonfire — burst it from range, never melee it.' },
  demon2: { ability: 'Burning Aura (hotter/wider) + Combustion — a hero burned to MAX heat detonates, blasting fire onto nearby allies, then resets.', behavior: 'Immolation: punishes a clustered party — keep them spread.' },
  demon_lord: { ability: 'Inferno — periodically erupts the ENTIRE room into hellfire: max heat on everyone + a big fire AoE. No safe distance.', behavior: 'Immolation: the room burns — a damage-race the party usually loses.' },

  // ── GOLEM · FORTRESS — mechanic: damage mitigation (self → allies → room) ──
  golem1: { ability: 'Bulwark — a slow, immovable wall that takes heavily reduced damage from everything.', behavior: 'Fortress: break the golem first, or make no progress past it.' },
  golem2: { ability: 'Bulwark + Aegis — bigger self damage-reduction AND a protective aura: allies near it take far less damage too.', behavior: 'Fortress: place it up front and the whole line behind it hardens.' },
  golem_warden: { ability: 'Bastion — periodically raises a stone bastion: a big damage-reduction window on itself AND every ally in the room.', behavior: 'Fortress: the garrison turtles up — a near-unbreakable wall on a timer.' },

  // ── GHOST · FEAR — mechanic: nerve warfare (bite → haunt → mass rout) ──────
  ghost1: { ability: 'Dread — its psychic attacks and lingering aura drain a hero\'s NERVE from across the room. Broken nerve makes them panic and fight worse.', behavior: 'Terror: softens the party\'s resolve from afar — no flesh required.' },
  ghost2: { ability: 'Dread + Haunt — a hit haunts a hero: their nerve keeps bleeding and won\'t recover, they fight worse, and their panic spreads to nearby party-mates.', behavior: 'Terror: turns one frightened hero into a spreading morale collapse.' },
  dark_wraith: { ability: 'Dread + Haunt + Pall of Dread — periodically craters every hero\'s nerve so the whole room panics in place, frozen, for the kill.', behavior: 'Terror: the capstone of a fear dungeon — freeze the whole party for the kill.' },

  // ── BEHOLDER · GAZE — mechanic: domination (charm → mass charm → petrify room) ──
  beholder1: { ability: 'Mesmerize — its gaze CHARMS the hero it hits: for a few seconds they turn and attack their own nearest ally. One eye, one traitor.', behavior: 'Domination: a ranged eye that turns the party against itself.' },
  beholder2: { ability: 'Mesmerize + Mass Hypnosis — its eyestalks fire a volley that charms SEVERAL nearby heroes at once, so a chunk of the party turns on each other in chaos.', behavior: 'Domination: sows friendly-fire across the whole front line.' },
  beholder_tyrant: { ability: "Mesmerize + Mass Hypnosis + Tyrant's Glare — the great eye periodically PETRIFIES every hero in the room (frozen, helpless) and HEXES them (take heavy extra damage): a room turned to soft statues for the slaughter.", behavior: 'Domination: the capstone — freeze and break the entire party at once.' },

  // ── GNOLL · BLOOD HUNT — mechanic: bleed them, smell it, run them down ───────
  gnoll1: { ability: 'Bleed — every hit opens a lasting wound that STACKS; bleeding heroes lose HP over time and leave a blood trail. Death by a thousand cuts.', behavior: 'Blood Hunt: marks prey with bleed for the pack to track and finish.' },
  gnoll2: { ability: 'Bleed + Bloodhound — SMELLS bleeding prey anywhere in the dungeon and abandons its post to SPRINT them down (faster, relentless). No wounded hero is safe in any room.', behavior: 'Blood Hunt: leaves its room to chase the bleeding across the whole dungeon.' },
  gnoll_alpha: { ability: "Bleed + Bloodhound + Blood Frenzy — the alpha howls: every bleed ruptures at once, wounds can't be healed for a while, and the whole pack goes feral to run the bloodied down.", behavior: 'Blood Hunt: the capstone — turn a wave of cuts into a slaughter.' },

  // ── ENT · THORNS — mechanic: a losing trade (reflect + regrow) ──────────────
  ent1: { ability: 'Thornskin — a hero who strikes it in MELEE takes thorn damage straight back. Swinging at the tree is a losing trade. (Ranged attackers are safe.)', behavior: 'Old Growth: a slow wall that punishes everything that touches it.' },
  ent2: { ability: 'Thornskin + Old Growth — sharper thorns reflect even MORE melee damage, and the treant slowly REGROWS its HP, so you can\'t out-trade it — the thorns just keep coming.', behavior: 'Old Growth: an enduring wall that heals faster than you can chip it.' },
  ent3: { ability: 'Thornskin + Old Growth + Thornburst — periodically erupts a thorn-thicket that rakes EVERY hero in the room, surges with regrowth (a big self-heal), and amplifies its thorns for a while.', behavior: 'Old Growth: the capstone — the whole room bleeds itself out on the bark.' },

  // ── LICH · SOUL HARVEST — mechanic: deaths bank souls → escalating necrotic power ──
  lich1: { ability: 'Soul Siphon — devours the soul of anything that dies in its room (hero OR minion), banking power that makes its necrotic blasts hit harder. Weak alone; a room-clearing artillery piece once the corpses pile up.', behavior: 'Soul Harvest: a ranged caster that scales off your kills — protect it and feed it bodies.' },
  lich2: { ability: 'Soul Siphon + Soul Conduit — the harvested power overflows: every nearby undead ally also hits harder, scaled by how many souls the Lich has banked. The whole crypt sharpens as the dead pile up.', behavior: 'Soul Harvest: turns a pile of corpses into a buff for the entire undead garrison.' },
  elder_lich: { ability: 'Soul Siphon + Soul Conduit + Soul Storm — periodically SPENDS its whole soul bank in a room-wide necrotic detonation (the more souls harvested, the bigger the blast). And its Phylactery won\'t let it die: the first kill only puts it down for a moment before it reforms.', behavior: 'Soul Harvest: the capstone — bank the dead, then erase the room. Kill it twice.' },

  // ── LIZARDMAN · CAMOUFLAGE — mechanic: untargetable ambush from concealment ──
  lizardman1: { ability: 'Camouflage — blends into the dungeon, UNSEEN and untargetable: heroes can\'t hit what they can\'t see. Its strike from hiding lands a heavy ambush hit — but striking reveals it.', behavior: 'Stalk: a hidden opener — one free ambush each wave, then a fragile melee.' },
  lizardman2: { ability: 'Camouflage + Stalk — after it strikes it slinks back and RE-CAMOUFLAGES mid-fight (moving faster while hidden to reposition), and landing a kill re-cloaks it instantly. It vanishes and re-strikes over and over.', behavior: 'Stalk: a persistent predator the party can never quite pin down.' },
  serpent_captain: { ability: 'Camouflage + Stalk + Vanishing Warband — periodically the captain hisses and the WHOLE reptile pack re-cloaks at once (every target the party was fighting blinks out), then they erupt in a synchronized ambush.', behavior: 'Stalk: the capstone — the room empties, then the fangs come from everywhere.' },

  // ── IMP · BLINK — mechanic: the uncatchable teleporting harasser ──
  imp1: { ability: 'Blink — a fast ranged devil that TELEPORTS away the instant a hero closes to melee, snapping back to range to keep flinging fire. You can never corner it.', behavior: 'Blink: an unkillable nuisance — plinks from safety and winks away from every swing.' },
  imp2: { ability: 'Blink + Flicker Strike — also teleports OFFENSIVELY: flickers straight past the front line to the MOST-WOUNDED hero, stings them, and blinks back out. Your tank can\'t protect the backline.', behavior: 'Blink: a backline assassin that ignores your formation entirely.' },
  imp3: { ability: 'Blink + Flicker + Hellrift — periodically tears a hellrift: a room-wide fire blast and the WHOLE imp pack flies into a teleport frenzy, blinking everywhere and raining fire.', behavior: 'Blink: the capstone — the room fills with teleporting, fire-flinging devils.' },

  // ── PLANT · ENTANGLE — mechanic: root heroes in place (control / zoning) ──
  plant1: { ability: 'Entangle — its hit ROOTS the hero in place: vines snare their legs so they can\'t move, flee, or advance (they can still swing). Locks them in the kill zone for the rest of the dungeon.', behavior: 'Entangle: a cheap snare — pins heroes where your damage is.' },
  plant2: { ability: 'Entangle + Devour — a stronger, longer root, and the man-eater CHOMPS a rooted hero for bonus damage — it feeds harder on prey it\'s already holding down.', behavior: 'Entangle: pins prey, then bites deeper while they can\'t escape.' },
  plant3: { ability: 'Entangle + Devour + Stranglethorn — periodically erupts a briar thicket that ROOTS every hero in the room at once and DRAINS their blood (healing itself) — the whole party pinned while it feeds.', behavior: 'Entangle: the capstone — snare the room and drink it dry.' },

  // ── MUSHROOM · HALLUCINATION — mechanic: daze heroes so they whiff (accuracy denial) ──
  mushroom1: { ability: 'Hallucinogenic Spores — its hit DAZES the hero: for a few seconds they hallucinate and WHIFF a chunk of their attacks (swinging at things that aren\'t there). Craters the party\'s damage.', behavior: 'Spores: a fragile disruptor — its job is to make heroes miss, not to kill.' },
  mushroom2: { ability: 'Hallucinogenic Spores + Spore Cloud — a stronger daze on hit, and it periodically belches a drifting cloud that dazes EVERY hero near it — the whole front line starts swinging at phantoms.', behavior: 'Spores: blankets the front line in a miss-inducing haze.' },
  myconid_stalker: { ability: 'Spores + Spore Storm — periodically blooms a room-wide hallucinogenic storm: every hero is heavily dazed and whiffs most of their attacks, flailing at ghosts while your minions cut them down.', behavior: 'Spores: the capstone — the whole party fights blind while you butcher them.' },
}

// Family-wide resolver — maps ANY minion definitionId (including evolved
// tier-2/3 forms and boss-archetype mini-boss finals) to its family's
// player-facing ability/behavior text. Tier-1 ids hit MINION_ABILITY_INFO
// directly; evolved ids fall through the family ID sets above, since the
// on-hit / tick effects key off those same sets. Zombie / skeleton /
// plant / imp / ent / mushroom abilities are tier-1-only by design, so
// their evolutions correctly resolve to no ability text.
const _FAMILY_ABILITY_KEY = [
  [RAT_IDS, 'rat1'], [DEMON_IDS, 'demon1'], [VAMPIRE_IDS, 'vampire_minion1'],
  [BEHOLDER_IDS, 'beholder1'], [GOLEM_IDS, 'golem1'], [GOBLIN_IDS, 'goblin1'],
  [LIZARDMAN_IDS, 'lizardman1'], [SLIME_IDS, 'slime2'], [GNOLL_IDS, 'gnoll1'],
  [ORC_IDS, 'orc1'], [GHOST_IDS, 'ghost1'], [LICH_IDS, 'lich1'],
]
export function minionAbilityInfo(definitionId) {
  if (!definitionId) return null
  if (MINION_ABILITY_INFO[definitionId]) return MINION_ABILITY_INFO[definitionId]
  for (const [set, key] of _FAMILY_ABILITY_KEY) {
    if (set.has(definitionId)) return MINION_ABILITY_INFO[key] ?? null
  }
  return null
}

// Self-Combust (imp) + Confusion Spore (mushroom) AoE constants.
const IMP_BLAST_DAMAGE        = 8       // fire AoE damage on Self-Combust
const IMP_BLAST_RADIUS_TILES  = 1.5
const SPORE_RADIUS_TILES      = 2.0
const SPORE_STAGGER_MS        = 3000

const TS                      = 32     // tile size (matches Balance.TILE_SIZE)

export const MinionAbilities = {

  // ── On-hit (CombatSystem.tryAttack hook) ─────────────────────────────────

  onHit(scene, attacker, target, damageDealt, gameState) {
    if (!attacker || !target || !scene) return
    const id = attacker.definitionId
    if (!id) return   // adventurer attacker — nothing to do here

    // Mimic — Greedy Bite: 5g per hit (the mimic is intentionally left as-is;
    // its Devour instakill lives in AISystem). Credited on death below.
    if (id === 'mimic') {
      attacker._stolenGold = (attacker._stolenGold ?? 0) + 5
      AbilityVfx.floatingText(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 22, '+5g', { color: '#ffdd44' })
    }

    // Data-driven onHit abilities — runs the minion's JSON `abilities`. This is
    // now the ONLY ability path (the old family-Set blocks were wiped for the
    // ground-up redesign); each family's kit is authored per-tier in JSON.
    this.runHitAbilities(scene, attacker, target, damageDealt, gameState)

    // Goblin Mark for Plunder — GLOBAL rule: any dungeon minion that hits a
    // branded hero also steals gold for the dungeon (the whole room profits).
    this._tryMarkedSteal(scene, attacker, target, gameState)
  },

  // ── On minion dying (MinionAISystem._die pre-hook) ───────────────────────
  // Returns true if the death should be aborted (minion was revived). The
  // caller must skip the rest of its death routine when true is returned.

  onMinionDying(scene, minion, _gameState) {
    if (!minion) return false
    // Skeleton — REASSEMBLE: instead of dying, collapse into a bone pile that
    // self-revives after a delay. While "down" the minion sits at hp 0 /
    // aiState 'dead' — which makes it a non-targetable, AI-skipped corpse that
    // renders its death animation (the bone pile) for free. tickReassemble
    // brings it back. Each rise consumes one of `maxRevives`; once spent, the
    // next death falls through to the normal death routine (returns false).
    const dyingAbs = _abilitiesFor(minion, scene, 'onDying')

    // Lich · PHYLACTERY — the Elder Lich's soul-vessel won't let it stay dead.
    // The FIRST death is intercepted: it collapses to a dead husk and tickLich
    // resurrects it once after a delay (keeping its harvested souls). Once the
    // phylactery is spent, the next death falls through to the real death routine.
    const phy = dyingAbs?.find(a => a.type === 'phylactery')
    if (phy) {
      const now = scene?.time?.now ?? 0
      const usedP = minion._phylacteryUsed ?? 0
      if (usedP < (phy.maxRevives ?? 1)) {
        minion._phylacteryUsed   = usedP + 1
        minion._phylacteryReviveAt = now + (phy.reviveDelayMs ?? 3500)
        minion._phylacteryFrac   = phy.hpFraction ?? 0.5
        if (!phy.keepSouls) minion._souls = 0
        minion.aiState         = 'dead'   // soul-vessel husk: untargetable + death anim
        minion.resources.hp    = 0
        minion.currentTargetId = null
        if (scene && Number.isFinite(minion.worldX)) {
          AbilityVfx.phylacteryShatterFx?.(scene, minion.worldX, minion.worldY)
          AbilityVfx.floatingText(scene, minion.worldX, (minion.worldY ?? 0) - 18, phy.label ?? 'PHYLACTERY', { color: '#7CFFB2', fontSize: '11px' })
        }
        EventBus.emit('MINION_COLLAPSED', { minion })
        return true
      }
    }

    const ab = dyingAbs?.find(a => a.type === 'reassemble')
    if (!ab) return false
    const now = scene?.time?.now ?? 0
    // Grave Knight — Undying Legion grants a near-unkillable window: while it's
    // active the rise is near-instant and DOESN'T consume a revive charge.
    const rapid = minion._reassembleRapidUntil && now < minion._reassembleRapidUntil
    const used = minion._reassemblesUsed ?? 0
    if (!rapid && used >= (ab.maxRevives ?? 1)) return false   // revives spent

    minion._reassembling    = true
    minion._reassembleAt    = now + (rapid ? (ab.rapidReviveDelayMs ?? 500) : (ab.delayMs ?? 3000))
    minion._reassembleFrac  = ab.hpFraction ?? 0.5
    minion._reassembleFree  = !!rapid   // ult-window rises are free (no charge spent)
    minion.aiState          = 'dead'   // bone-pile corpse: untargetable + death anim
    minion.resources.hp     = 0
    minion.currentTargetId  = null
    // Collapse VFX — the skeleton bursts apart into tumbling bone shards.
    if (scene && Number.isFinite(minion.worldX)) {
      AbilityVfx.boneShatter?.(scene, minion.worldX, minion.worldY, { count: 14, spread: 40 })
      AbilityVfx.floatingText(scene, minion.worldX, (minion.worldY ?? 0) - 18, ab.label ?? 'REASSEMBLING', { color: '#cfc8b0', fontSize: '11px' })
    }
    EventBus.emit('MINION_COLLAPSED', { minion })
    return true
  },

  // Per-frame revival check for collapsed (reassembling) skeletons. Called from
  // MinionAISystem.update. When the delay elapses the bones clatter back up at
  // a fraction of max HP, the rise is banked, and the renderer flips off the
  // death animation automatically (hp > 0 again).
  tickReassemble(scene, gameState, _delta) {
    const list = gameState?.minions
    if (!list || !list.length) return
    const now = scene?.time?.now ?? 0
    for (const m of list) {
      if (!m._reassembling) continue
      if (now < (m._reassembleAt ?? 0)) continue
      m._reassembling     = false
      m._reassembleAt     = null
      if (!m._reassembleFree) m._reassemblesUsed = (m._reassemblesUsed ?? 0) + 1
      m._reassembleFree   = false
      const maxHp = m.resources?.maxHp ?? m.stats?.hp ?? m.resources?.hp ?? 1
      m.resources.hp = Math.max(1, Math.round(maxHp * (m._reassembleFrac ?? 0.5)))
      m.aiState = 'idle'
      m.currentTargetId = null
      // (MinionRenderer detects the dead→alive transition and plays the death
      // clip in reverse for the "knit back together + stand up" rise.)
      // Boneguard / Grave Knight — each rise it returns sheathed in a temporary
      // bone-armor shell (damage reduction, read in damageTakenMul) and flings a
      // ring of bone shards at adjacent heroes.
      const rab = _abilitiesFor(m, scene, 'onDying')?.find(a => a.type === 'reassemble')
      if (rab?.armorMs) { m._boneShellUntil = now + rab.armorMs; m._boneShellRed = rab.armorReduction ?? 0.4 }
      if (rab?.shardDamage) this._boneShardBurst(scene, gameState, m, rab.shardDamage, rab.shardRadiusTiles ?? 2)
      // Reassemble VFX — bone shards knit back INWARD + a necrotic flash as they
      // meet (complements the reverse-death rise the renderer plays).
      if (scene && Number.isFinite(m.worldX)) {
        AbilityVfx.boneKnit?.(scene, m.worldX, m.worldY - 4, { count: 11, fromR: 32 })
        // Bone-armor rise (Boneguard/Grave Knight): a hard plated bone shell snaps on.
        if (rab?.armorMs) AbilityVfx.boneShatter?.(scene, m.worldX, m.worldY - 4, { color: 0xcfe6ff, count: 8, spread: 22, durationMs: 420 })
        AbilityVfx.floatingText(scene, m.worldX, (m.worldY ?? 0) - 22, 'REASSEMBLED', { color: '#bfe8c0', fontSize: '11px' })
      }
      EventBus.emit('MINION_REASSEMBLED', { minion: m })
    }
  },

  // Boneguard / Grave Knight rise — a ring of bone shards flung at adjacent
  // heroes (chip damage), keeping the attrition pressure on the party.
  _boneShardBurst(scene, gameState, minion, dmg, radiusTiles) {
    const advs = gameState?.adventurers?.active ?? []
    let hits = 0
    for (const adv of advs) {
      if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const d = Math.hypot((adv.tileX ?? 0) - (minion.tileX ?? 0), (adv.tileY ?? 0) - (minion.tileY ?? 0))
      if (d > radiusTiles + 0.01) continue
      const floor = (adv._lightParty || adv._shadowMonarch)
        ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      adv.resources.hp = Math.max(floor, adv.resources.hp - dmg)
      adv._lastHitBy = minion.instanceId; adv._lastHitType = 'physical'
      EventBus.emit('COMBAT_HIT', { sourceId: minion.instanceId, targetId: adv.instanceId, damage: dmg, damageType: 'physical', isCritical: false })
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${dmg}`, { color: '#e8e2cc' })
      hits += 1
    }
    if (scene && Number.isFinite(minion.worldX)) {
      AbilityVfx.boneShatter?.(scene, minion.worldX, minion.worldY - 4, { count: 16, spread: (radiusTiles ?? 2) * 30, durationMs: 520 })
    }
    return hits
  },

  // Grave Knight ULT — UNDYING LEGION: plant the sword and unleash a necrotic
  // pulse. Every fallen undead in range erupts back to its feet, and the Knight
  // itself enters a near-instant self-revive window (_reassembleRapidUntil) so a
  // "cleared" room becomes a full fight again. onTick (periodic) handler.
  _undyingLegion(knight, scene, gameState, ab) {
    const now = scene?.time?.now ?? 0
    const radius = ab.raiseRadiusTiles ?? 6
    let raised = 0
    for (const m of (gameState?.minions ?? [])) {
      if (m === knight || m.faction !== 'dungeon') continue
      // only the FALLEN (dead corpses / collapsed bone piles)
      if (m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0) continue
      if (!(Array.isArray(m.tags) && m.tags.includes('undead'))) continue
      const d = Math.hypot((m.tileX ?? 0) - (knight.tileX ?? 0), (m.tileY ?? 0) - (knight.tileY ?? 0))
      if (d > radius + 0.01) continue
      m._reassembling = false; m._reassembleAt = null
      const maxHp = m.resources?.maxHp ?? m.stats?.hp ?? 1
      m.resources.hp = Math.max(1, Math.round(maxHp * 0.5))
      m.aiState = 'idle'; m.currentTargetId = null   // renderer plays the rise
      raised += 1
    }
    // The Knight's own near-unkillable window.
    knight._reassembleRapidUntil = now + (ab.rapidReviveMs ?? 6000)
    if (scene && Number.isFinite(knight.worldX)) {
      // A necrotic ground pulse + bone spikes erupting — the dead clawing up.
      AbilityVfx.necroticErupt?.(scene, knight.worldX, (knight.worldY ?? 0) + 6, { radius: radius * 26, spikes: 10 })
      AbilityVfx.screenShake?.(scene, { intensity: 0.007, durationMs: 240 })
      AbilityVfx.floatingText(scene, knight.worldX, (knight.worldY ?? 0) - 34, ab.label ?? 'UNDYING LEGION', { color: '#bfe8c0', fontSize: '13px' })
    }
    EventBus.emit('MINION_ULT', { minion: knight, ability: 'undyingLegion', raised })
    return raised
  },

  // ── ORC — BLOODLUST (stacking attack from hits landed) ───────────────────
  _isOrc(m) { return Array.isArray(m?.tags) && (m.tags.includes('orc') || m.tags.includes('greenskin')) },

  // Add Bloodlust stacks + the rising fury VFX (intensifies with stacks).
  _addBloodlust(scene, minion, ab, n) {
    if (!minion) return
    const now = scene?.time?.now ?? 0
    const max = ab?.maxStacks ?? minion._bloodlustMax ?? 6
    minion._bloodlustMax   = max
    minion._bloodlustPer   = ab?.atkPerStack ?? minion._bloodlustPer ?? 0.08
    minion._bloodlustDecay = ab?.decayMs ?? minion._bloodlustDecay ?? 4000
    // decayed since the last stack? start fresh.
    if (now - (minion._bloodlustAt ?? 0) > minion._bloodlustDecay) minion._bloodlustStacks = 0
    const prev = minion._bloodlustStacks ?? 0
    const cur  = Math.min(max, prev + n)
    minion._bloodlustStacks = cur
    minion._bloodlustAt     = now
    if (scene && Number.isFinite(minion.worldX)) {
      const k = cur / max
      AbilityVfx.furyAura?.(scene, minion.worldX, (minion.worldY ?? 0) + 6, { intensity: k })
      if (cur === max && prev < max) {
        AbilityVfx.soundWave?.(scene, minion.worldX, (minion.worldY ?? 0) - 6, { color: 0xff3a1e, toR: 60, arcs: 2 })
        AbilityVfx.screenShake?.(scene, { intensity: 0.005, durationMs: 160 })
        AbilityVfx.floatingText(scene, minion.worldX, (minion.worldY ?? 0) - 30, 'BLOODLUST', { color: '#ff5a2a', fontSize: '12px' })
      }
    }
  },

  // Live attack multiplier from Bloodlust + Rampage — read in CombatSystem.
  // Decays the stacks lazily (out of combat) so no per-frame tick is needed.
  bloodlustAtkMul(minion, scene) {
    if (!minion) return 1
    const now = scene?.time?.now ?? 0
    let mul = 1
    if ((minion._bloodlustStacks ?? 0) > 0) {
      if (now - (minion._bloodlustAt ?? 0) > (minion._bloodlustDecay ?? 4000)) {
        minion._bloodlustStacks = 0
      } else {
        mul *= 1 + Math.min(minion._bloodlustStacks, minion._bloodlustMax ?? 6) * (minion._bloodlustPer ?? 0.08)
      }
    }
    if (minion._rampageUntil > now && minion._rampageAtkMul > 1) mul *= minion._rampageAtkMul
    return mul
  },

  // ── Rat · SWARM (strength in numbers — the pack empowers each rat) ─────────
  // Count living swarm-rats (minions carrying a `swarm` ability) sharing roomId.
  _swarmCount(gameState, roomId, scene) {
    if (!roomId) return 1
    let n = 0
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.assignedRoomId !== roomId) continue
      const abs = _abilitiesFor(m, scene)
      if (abs && abs.some(a => a.type === 'swarm')) n += 1
    }
    return Math.max(1, n)
  },
  // Effective swarm stacks for a rat (pack size − 1, capped; Vermin Tide frenzy
  // forces the cap). Shared by the atk + DR reads so they stay in lockstep.
  _swarmStacks(minion, scene, gameState, ab, cap) {
    const now = scene?.time?.now ?? 0
    let stacks = Math.max(0, this._swarmCount(gameState, minion.assignedRoomId, scene) - 1)
    if ((minion._swarmFrenzyUntil ?? 0) > now) stacks = cap
    return Math.min(cap, stacks)
  },
  // ATK multiplier from the swarm — read in CombatSystem (like bloodlustAtkMul).
  swarmAtkMul(minion, scene, gameState) {
    const abs = minion ? _abilitiesFor(minion, scene) : null
    const ab = abs && abs.find(a => a.type === 'swarm')
    if (!ab) return 1
    const now = scene?.time?.now ?? 0
    const stacks = this._swarmStacks(minion, scene, gameState, ab, ab.cap ?? 6)
    const frenzy = (minion._swarmFrenzyUntil ?? 0) > now ? (ab.frenzyAtk ?? 0.2) : 0
    return 1 + stacks * (ab.atkPer ?? 0.12) + frenzy
  },
  // Pack Armor (T2+) — damage-reduction multiplier from the swarm. Folded into
  // damageTakenMul. Floored so a big pack is tanky, never invincible.
  swarmDrMul(target, scene, gameState) {
    const abs = target ? _abilitiesFor(target, scene) : null
    const ab = abs && abs.find(a => a.type === 'swarm')
    if (!ab || !ab.drPer) return 1
    const stacks = this._swarmStacks(target, scene, gameState, ab, ab.drCap ?? ab.cap ?? 6)
    return Math.max(0.35, 1 - stacks * ab.drPer)
  },

  // ── Golem · FORTRESS / BULWARK (damage mitigation: self → allies → room) ───
  // Aegis aura — a living guardian golem (carrying an `aegis` ability) sharing the
  // room passively softens damage to allied minions within its radius. Strongest guard wins.
  aegisMul(target, scene, gameState) {
    if (!target || target.faction !== 'dungeon') return 1
    let best = 1
    for (const m of (gameState?.minions ?? [])) {
      if (m === target || m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.assignedRoomId !== target.assignedRoomId) continue
      const abs = _abilitiesFor(m, scene)
      const ag = abs && abs.find(a => a.type === 'aegis')
      if (!ag) continue
      if (Math.hypot((m.tileX ?? 0) - (target.tileX ?? 0), (m.tileY ?? 0) - (target.tileY ?? 0)) > (ag.radiusTiles ?? 2.5) + 0.01) continue
      best = Math.min(best, ag.mult ?? 0.7)
    }
    return best
  },

  // Golem Warden BASTION (ULT, onTick) — raise a bastion: a big DR window on the
  // Warden + EVERY allied minion in the room (read in damageTakenMul via _bastionUntil).
  _bastion(golem, scene, gameState, ab) {
    const home = this._roomOf(gameState, golem.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const until = now + (ab.durationMs ?? 5000), mul = ab.mult ?? 0.4
    const allies = []
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.assignedRoomId !== golem.assignedRoomId) continue
      m._bastionUntil = until; m._bastionMul = mul
      if (m !== golem && Number.isFinite(m.worldX) && Number.isFinite(m.worldY)) allies.push({ x: m.worldX, y: m.worldY })
    }
    if (scene && Number.isFinite(golem.worldX)) {
      AbilityVfx.bastionFx?.(scene, golem.worldX, golem.worldY, { allies })
      AbilityVfx.screenShake?.(scene, { intensity: 0.005, durationMs: 320 })
      AbilityVfx.floatingText(scene, golem.worldX, (golem.worldY ?? 0) - 30, ab.label ?? 'BASTION', { color: '#cdc6b0', fontSize: '13px' })
    }
  },

  // ── Ghost · FEAR (break their morale, not their HP) ───────────────────────
  // Central nerve write for the ghost kit. Clamps adv.nerve, recomputes the mood
  // band (one source of truth = NerveBands) and emits NERVE_BAND_CHANGED so the
  // renderer pip + AISystem._checkMoraleBreak react at once. deltaNerve is signed
  // (negative = fear). Returns the amount of nerve LOST (>=0), or null for a
  // non-adventurer / dead target. (AISystem already writes nerve for story beats,
  // so a fear write here is consistent with the existing pattern.)
  _applyFear(adv, deltaNerve, scene) {
    if (!adv || typeof adv.nerve !== 'number' || adv.aiState === 'dead') return null
    if (!deltaNerve) return 0
    const before = adv.nerve
    adv.nerve = Math.max(0, Math.min(100, adv.nerve + deltaNerve))
    if (adv.nerve === before) return 0
    const band = NerveBands.bandFor(adv.nerve)
    if (band !== adv.mood) {
      const prev = adv.mood; adv.mood = band
      EventBus.emit('NERVE_BAND_CHANGED', { adventurer: adv, band, prev })
    }
    return before - adv.nerve
  },

  // Dread presence (onTick, interval-gated by tickAbilities) — lingering near a
  // ghost bleeds nerve, scaled by closeness. A directional cold mist reaches
  // toward each adv it touches (dreadAuraFx — spectral eyes, not a ring).
  _dreadAura(ghost, scene, gameState, ab) {
    const r = ab.radiusTiles ?? 3.5, amt = ab.nervePerTick ?? 1.5
    const targets = []
    let fearAccum = 0
    for (const a of this._liveAdvs(gameState)) {
      if (typeof a.nerve !== 'number') continue
      const d = Math.hypot((a.tileX ?? 0) - (ghost.tileX ?? 0), (a.tileY ?? 0) - (ghost.tileY ?? 0))
      if (d > r) continue
      const closeness = 1 - d / r
      this._applyFear(a, -amt * (0.55 + 0.45 * closeness), scene)
      if (Number.isFinite(a.worldX)) targets.push({ x: a.worldX, y: a.worldY })
      // how much terror this ghost is actively projecting (closeness + how rattled the
      // prey already is) → drives the renderer's reactive "seethe" tell (C).
      fearAccum += 0.5 * closeness + 0.5 * Math.max(0, 1 - (a.nerve ?? 100) / 100)
    }
    // stamp the projected-fear intensity (0..1) + timestamp; the renderer lerps the
    // ghost's glow/shroud/field toward this and decays it to 0 when the tick goes stale.
    ghost._dreadAt = scene?.time?.now ?? 0
    ghost._dreadFearK = Math.min(1, fearAccum / 2.4)
    if (targets.length && scene && Number.isFinite(ghost.worldX)) {
      AbilityVfx.dreadAuraFx?.(scene, ghost.worldX, ghost.worldY, { radiusTiles: r, targets })
    }
  },

  // Pall of Dread (ULT, onTick) — the Dark Wraith craters every room adventurer's
  // nerve toward a floor, slamming them to Breaking → a mass ROUT (the existing
  // AISystem._checkMoraleBreak, satisfied by the wraith's own threatening presence).
  _pallOfDread(wraith, scene, gameState, ab) {
    const home = this._roomOf(gameState, wraith.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const floor = ab.nerveFloor ?? 12, panicMs = ab.panicMs ?? 2600
    const victims = this._liveAdvs(gameState).filter(a => typeof a.nerve === 'number' && this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    for (const a of victims) {
      if (a.nerve > floor) this._applyFear(a, floor - a.nerve, scene)   // crater, never raise
      // MASS PANIC (nerve rework) — the room freezes in terror IN PLACE (helpless,
      // defenceless kills), not a mass rout. AISystem reads _panickedUntil (cower +
      // no attack + +50% vuln); seeding it directly makes the ult instant + reliable.
      if (a.classId !== 'barbarian' && !a.flags?.noFlee && !a._charmed) {
        a._panickedUntil = Math.max(a._panickedUntil ?? 0, now + panicMs)
      }
    }
    if (scene && Number.isFinite(wraith.worldX)) {
      const TS = 32
      // the EXACT room rectangle (world coords) so the VFX can black out the whole room
      // the wraith stands in — not a blob centred on the wraith.
      const roomRect = { x: (home.gridX ?? 0) * TS, y: (home.gridY ?? 0) * TS, w: Math.max(1, home.width ?? 6) * TS, h: Math.max(1, home.height ?? 6) * TS }
      const rw = roomRect.w, rh = roomRect.h
      AbilityVfx.pallOfDreadFx?.(scene, wraith.worldX, wraith.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), roomRect, victims: victims.map(a => ({ x: a.worldX, y: a.worldY })) })
      if (victims.length) AbilityVfx.floatingText(scene, wraith.worldX, (wraith.worldY ?? 0) - 30, ab.label ?? 'PALL OF DREAD', { color: '#8c9fd0', fontSize: '13px' })
    }
  },

  // Per-frame haunt processor (wired in MinionAISystem, like tickVampire). Bleeds
  // a haunted adv's nerve over the window, spreads contagion to nearby party-mates,
  // and expires the haunt cleanly. The recovery-suppression + attack-fumble live in
  // NerveSystem / _computeDamage respectively (they read _hauntedUntil).
  tickGhost(scene, gameState, delta) {
    const now = scene?.time?.now ?? 0
    const dt = Math.max(0, (delta ?? 16) / 1000)
    const advs = gameState?.adventurers?.active ?? []
    for (const a of advs) {
      if (!a || a.aiState === 'dead' || typeof a.nerve !== 'number' || !a._hauntedUntil) continue
      if (now >= a._hauntedUntil) {
        a._hauntedUntil = 0; a._hauntNervePerSec = 0; a._hauntFumbleMul = 1
        a._hauntContagionR = 0; a._hauntContagionPS = 0; a._hauntSource = null
        continue
      }
      this._applyFear(a, -(a._hauntNervePerSec ?? 4) * dt, scene)
      const cr = a._hauntContagionR ?? 0, cps = a._hauntContagionPS ?? 0
      if (cr > 0 && cps > 0) {
        for (const b of advs) {
          if (b === a || b.aiState === 'dead' || typeof b.nerve !== 'number') continue
          if (a.partyId && b.partyId !== a.partyId) continue
          const d = Math.hypot((b.tileX ?? 0) - (a.tileX ?? 0), (b.tileY ?? 0) - (a.tileY ?? 0))
          if (d <= cr) this._applyFear(b, -cps * dt, scene)
        }
      }
    }
  },

  // Attack-fumble multiplier (read in CombatSystem._computeDamage): a haunted adv
  // who is already Spooked/Breaking fights worse — their fear makes them falter.
  fearAtkMul(attacker, now) {
    if (!attacker || !attacker._hauntedUntil || attacker._hauntedUntil <= (now ?? 0)) return 1
    if (attacker.mood !== 'spooked' && attacker.mood !== 'breaking') return 1
    return attacker._hauntFumbleMul ?? 0.72
  },

  // ── Beholder · GAZE / DOMINATION (the eye that seizes control) ────────────
  // Can this adventurer be mind-controlled? (Adventurers only; barbarians are
  // unstoppable; scripted/already-charmed roles are off-limits.)
  _canControl(adv) {
    return !!adv && adv.classId !== undefined && adv.aiState !== 'dead' &&
      adv.classId !== 'barbarian' && !adv._shadowMonarch && !adv._lightParty && !adv._nemesis && !adv._charmed
  },

  // Mass Hypnosis (T2, onTick) — an eyestalk volley charms the N nearest room heroes
  // at once (a chunk of the party turns on each other). Reuses _possessedUntil.
  _massHypnosis(beholder, scene, gameState, ab) {
    const home = this._roomOf(gameState, beholder.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const dur = ab.durationMs ?? 3500, want = ab.targets ?? 3
    const heroes = this._liveAdvs(gameState)
      .filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home) && this._canControl(a))
      .sort((p, q) => Math.hypot(p.tileX - beholder.tileX, p.tileY - beholder.tileY) - Math.hypot(q.tileX - beholder.tileX, q.tileY - beholder.tileY))
      .slice(0, want)
    if (!heroes.length) return
    for (const a of heroes) a._possessedUntil = Math.max(a._possessedUntil ?? 0, now + dur)
    beholder._gazeFlashUntil = now + 620; beholder._gazeFlashMs = 620; beholder._gazeFlashStr = 5   // sprite eye blazes wider
    if (scene && Number.isFinite(beholder.worldX)) {
      AbilityVfx.manyEyesFx?.(scene, beholder.worldX, beholder.worldY, heroes.map(a => ({ x: a.worldX, y: a.worldY })), {})
      AbilityVfx.floatingText(scene, beholder.worldX, (beholder.worldY ?? 0) - 30, ab.label ?? 'HYPNOSIS', { color: '#cc88ff', fontSize: '12px' })
    }
  },

  // Tyrant's Glare (ULT, onTick) — the great eye sweeps the room: every hero is
  // PETRIFIED (frozen, can't act — AISystem reads _petrifiedUntil) AND deep-HEXED
  // (heavy +damage-taken — gazeHexMul in _computeDamage) for a window. Total control.
  _tyrantGlare(tyrant, scene, gameState, ab) {
    const home = this._roomOf(gameState, tyrant.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const petrifyMs = ab.petrifyMs ?? 2200, hexMs = ab.hexMs ?? 5000, hexMul = ab.hexMul ?? 1.6
    const victims = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home) && this._canControl(a))
    for (const a of victims) {
      a._petrifiedUntil = Math.max(a._petrifiedUntil ?? 0, now + petrifyMs)
      a._hexUntil = Math.max(a._hexUntil ?? 0, now + hexMs)
      a._hexVulnMul = Math.max(a._hexVulnMul ?? 1, hexMul)
    }
    tyrant._gazeFlashUntil = now + 820; tyrant._gazeFlashMs = 820; tyrant._gazeFlashStr = 8   // the Tyrant's eye blazes huge
    if (scene && Number.isFinite(tyrant.worldX)) {
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.tyrantGlareFx?.(scene, tyrant.worldX, tyrant.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), victims: victims.map(a => ({ x: a.worldX, y: a.worldY })) })
      AbilityVfx.screenShake?.(scene, { intensity: 0.006, durationMs: 340 })
      if (victims.length) AbilityVfx.floatingText(scene, tyrant.worldX, (tyrant.worldY ?? 0) - 30, ab.label ?? "TYRANT'S GLARE", { color: '#ff77dd', fontSize: '13px' })
    }
  },

  // Hex vulnerability multiplier (read in CombatSystem._computeDamage): a gaze-hexed
  // hero takes amplified damage for the window.
  gazeHexMul(target, now) {
    if (!target || !target._hexUntil || target._hexUntil <= (now ?? 0)) return 1
    return target._hexVulnMul ?? 1
  },

  // ── Gnoll · BLOOD HUNT (bleed them, smell it, run them down) ───────────────
  // Bleed (onHit) — each attack stacks a long-lasting BLEED on the hero (capped). The
  // damage ticks in tickGnoll (stacks × perStack each interval); the stacks also drive
  // the blood-trail, the bloodhound scent, and the alpha's Rupture. Heroes only.
  _bleed(scene, attacker, target, ab) {
    if (!target || target.classId === undefined || target.aiState === 'dead') return
    const now = scene?.time?.now ?? 0
    const max = ab.maxStacks ?? 6
    if (!(target._bleedUntil > now)) { target._bleedStacks = 0; target._bleedTickAt = now }
    target._bleedStacks   = Math.min(max, (target._bleedStacks ?? 0) + 1)
    target._bleedUntil    = now + (ab.durationMs ?? 9000)
    target._bleedPerStack = ab.perStack ?? 2
    target._bleedInterval = ab.intervalMs ?? 1000
    target._bleedSource   = attacker.instanceId
    if (scene && Number.isFinite(target.worldX)) {
      AbilityVfx.bleedSlashFx?.(scene, target.worldX, target.worldY, { stacks: target._bleedStacks })
      this._statusPopup(scene, target, ab.label ?? 'BLEEDING', '#d23a2a', 24)
    }
  },

  isBleeding(adv, now) { return !!(adv && adv._bleedStacks > 0 && adv._bleedUntil > (now ?? 0)) },

  // The nearest BLEEDING hero to a gnoll — drives the Bloodhound hunt (MinionAISystem._pickTarget).
  nearestBleedingAdv(gameState, minion, now) {
    let best = null, bd = Infinity
    for (const a of (gameState?.adventurers?.active ?? [])) {
      if (!a || a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      if (!this.isBleeding(a, now)) continue
      const d = Math.hypot((a.tileX ?? 0) - (minion.tileX ?? 0), (a.tileY ?? 0) - (minion.tileY ?? 0))
      if (d < bd) { bd = d; best = a }
    }
    return best
  },

  // Blood Frenzy (ULT, onTick) — the alpha HOWLS: every bleed RUPTURES (a burst scaled
  // by stacks), bleeds deepen to max + can't be healed for a window (_noHealUntil), and
  // the WHOLE pack is force-scented (tickGnoll sprints them all at the bloodied).
  _bloodFrenzy(alpha, scene, gameState, ab) {
    const now = scene?.time?.now ?? 0
    const ruptureDmg = ab.ruptureDmgPerStack ?? 7, noHealMs = ab.noHealMs ?? 5000
    const frenzyMs = ab.frenzyMs ?? 6000, maxStacks = ab.maxStacks ?? 6
    const victims = []
    for (const a of this._liveAdvs(gameState)) {
      if (!this.isBleeding(a, now)) continue
      const burst = (a._bleedStacks ?? 0) * ruptureDmg
      if (burst > 0 && a.resources) { a.resources.hp = Math.max(0, a.resources.hp - burst); a._lastHitBy = alpha.instanceId; a._lastHitType = 'bleed' }
      a._bleedStacks = Math.max(a._bleedStacks ?? 0, maxStacks)
      a._bleedUntil = now + 9000
      a._bleedPerStack = Math.max(a._bleedPerStack ?? 0, 4)
      a._bleedSource = alpha.instanceId
      a._noHealUntil = now + noHealMs
      if (Number.isFinite(a.worldX)) victims.push({ x: a.worldX, y: a.worldY, burst })
    }
    // the whole pack goes feral — every dungeon gnoll (anything that can bleed) sprints
    // to the bloodied for the window (tickGnoll reads _forceScentUntil).
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (!this._hasAbility(m, scene, 'bleed')) continue
      m._forceScentUntil = now + frenzyMs
    }
    if (scene && Number.isFinite(alpha.worldX)) {
      AbilityVfx.bloodFrenzyFx?.(scene, alpha.worldX, alpha.worldY, { victims })
      AbilityVfx.screenShake?.(scene, { intensity: 0.006, durationMs: 360 })
      AbilityVfx.floatingText(scene, alpha.worldX, (alpha.worldY ?? 0) - 30, ab.label ?? 'BLOOD FRENZY', { color: '#e0301a', fontSize: '13px' })
    }
  },

  // Per-frame gnoll processor (wired in MinionAISystem). (1) Bleed: tick stacks×perStack
  // damage on bleeding heroes + drip the blood trail + a bleeding tell + expire. (2)
  // Bloodhound: a gnoll that can scent (has bloodhound, or force-scented by Blood Frenzy)
  // SPRINTS while any hero is bleeding — boost speed (restore when none); _pickTarget
  // then chases the nearest bleeder cross-room and the run anim plays automatically.
  tickGnoll(scene, gameState) {
    const now = scene?.time?.now ?? 0
    const advs = gameState?.adventurers?.active ?? []
    let anyBleeding = false
    for (const a of advs) {
      if (!a || a.aiState === 'dead' || !a._bleedStacks) continue
      if (a._bleedUntil <= now) { a._bleedStacks = 0; a._bleedUntil = 0; continue }
      anyBleeding = true
      const iv = a._bleedInterval ?? 1000
      if (now - (a._bleedTickAt ?? now) >= iv) {
        a._bleedTickAt = now
        const dmg = (a._bleedStacks ?? 0) * (a._bleedPerStack ?? 2)
        if (dmg > 0 && a.resources) {
          a.resources.hp = Math.max(0, a.resources.hp - dmg)
          a._lastHitBy = a._bleedSource ?? a._lastHitBy; a._lastHitType = 'bleed'
          if (scene && Number.isFinite(a.worldX)) AbilityVfx.floatingText?.(scene, a.worldX, (a.worldY ?? 0) - 16, `-${dmg}`, { color: '#cc3322', fontSize: '11px' })
        }
      }
      if (scene && Number.isFinite(a.worldX)) {
        const dx = a.worldX - (a._bloodDripX ?? a.worldX), dy = a.worldY - (a._bloodDripY ?? a.worldY)
        if (a._bloodDripX == null || (dx * dx + dy * dy) >= 22 * 22) { a._bloodDripX = a.worldX; a._bloodDripY = a.worldY; AbilityVfx.bloodTrailFx?.(scene, a.worldX, a.worldY + 8, { stacks: a._bleedStacks }) }
        if (now - (a._bleedAuraAt ?? 0) >= 700) { a._bleedAuraAt = now; AbilityVfx.bleedingAuraFx?.(scene, a.worldX, a.worldY, { stacks: a._bleedStacks }) }
      }
    }
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const forced = (m._forceScentUntil ?? 0) > now
      if (!forced && !this._hasAbility(m, scene, 'bloodhound')) continue
      const want = forced || anyBleeding
      if (want && !m._bloodScent) {
        const bh = (_abilitiesFor(m, scene) ?? []).find(x => x.type === 'bloodhound')
        const mul = bh?.sprintMul ?? 1.6
        m._bloodScent = true; m._huntSprinting = true
        if (m._sprintBaseSpeed == null && m.stats) { m._sprintBaseSpeed = m.stats.speed; m.stats.speed = m.stats.speed * mul }
      } else if (!want && m._bloodScent) {
        m._bloodScent = false; m._huntSprinting = false
        if (m._sprintBaseSpeed != null && m.stats) { m.stats.speed = m._sprintBaseSpeed; m._sprintBaseSpeed = null }
      }
    }
  },

  // ── Ent · THORNS / OLD GROWTH (a losing trade: it reflects + regrows) ──────
  // THORNS (passive) — a MELEE hero that damages a thorned ent takes reflect damage
  // (max of a flat minimum + a fraction of the hit). Called from CombatSystem right
  // after the hit lands. Ranged heroes don't get pricked. Amplified during Thornburst.
  thornsReflect(target, attacker, damageDealt, scene) {
    if (!target || !attacker || target.faction !== 'dungeon' || attacker.faction === 'dungeon') return 0
    if ((attacker.attackRange ?? 1) > 1.5) return 0   // melee only — not touching the thorns
    const abs = _abilitiesFor(target, scene, 'passive')
    const t = abs && abs.find(a => a.type === 'thorns')
    if (!t) return 0
    const now = scene?.time?.now ?? 0
    let reflect = Math.max(t.flat ?? 2, Math.round((damageDealt ?? 0) * (t.reflectFrac ?? 0.4)))
    if (target._thornsAmpUntil > now) reflect = Math.round(reflect * (target._thornsAmpMul ?? 1))
    if (reflect <= 0) return 0
    if (attacker.resources) attacker.resources.hp = Math.max(0, attacker.resources.hp - reflect)
    attacker._lastHitBy = target.instanceId; attacker._lastHitType = 'thorns'
    if (scene && Number.isFinite(target.worldX)) AbilityVfx.thornGuardFx?.(scene, target.worldX, target.worldY, { amped: target._thornsAmpUntil > now })   // bark flexes + thorns bristle ON the ent
    if (scene && Number.isFinite(attacker.worldX) && Number.isFinite(target.worldX)) AbilityVfx.thornLashFx?.(scene, target.worldX, target.worldY, attacker.worldX, attacker.worldY, {})
    AbilityVfx.floatingText?.(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 18, `-${reflect}`, { color: '#7bbf4a', fontSize: '11px' })
    return reflect
  },

  // Regrow (onTick) — Old Growth slowly heals a % of max HP, so you can't out-trade it.
  _regrow(ent, scene, gameState, ab) {
    if (!ent?.resources || ent.aiState === 'dead') return
    const max = ent.resources.maxHp ?? 0
    if (ent.resources.hp <= 0 || ent.resources.hp >= max) return
    const heal = Math.max(1, Math.round(max * (ab.healFrac ?? 0.03)))
    ent.resources.hp = Math.min(max, ent.resources.hp + heal)
    if (scene && Number.isFinite(ent.worldX)) AbilityVfx.regrowFx?.(scene, ent.worldX, ent.worldY, { heal })
  },

  // Thornburst (ULT, onTick) — the oak erupts a thicket: AoE thorn damage to every hero
  // in the room, a big regrowth self-heal surge, and amplified thorns for a window.
  _thornburst(oak, scene, gameState, ab) {
    const home = this._roomOf(gameState, oak.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0, dmg = ab.dmg ?? 14
    const victims = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    for (const a of victims) {
      if (!a.resources) continue
      const fl = (a._lightParty || a._shadowMonarch || a._nemesis) ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.1)) : 0
      a.resources.hp = Math.max(fl, a.resources.hp - dmg)
      a._lastHitBy = oak.instanceId; a._lastHitType = 'thorns'
    }
    if (oak.resources) { const max = oak.resources.maxHp ?? 0; oak.resources.hp = Math.min(max, oak.resources.hp + Math.round(max * (ab.healFrac ?? 0.25))) }
    oak._thornsAmpUntil = now + (ab.ampMs ?? 4000); oak._thornsAmpMul = ab.ampMul ?? 1.6
    if (scene && Number.isFinite(oak.worldX)) {
      AbilityVfx.thornburstFx?.(scene, oak.worldX, oak.worldY, { roomRect: this._roomFloorRectWorld(scene, home), victims: victims.map(a => ({ x: a.worldX, y: a.worldY })) })
      AbilityVfx.screenShake?.(scene, { intensity: 0.005, durationMs: 300 })
      if (victims.length) AbilityVfx.floatingText(scene, oak.worldX, (oak.worldY ?? 0) - 30, ab.label ?? 'THORNBURST', { color: '#8fd14a', fontSize: '13px' })
    }
  },

  // ── LICH · SOUL HARVEST ─────────────────────────────────────────────────
  // Soul Siphon (onTick) — the Lich devours the souls of the dead. Every NEW
  // corpse in its room (a hero who fell THIS day + any fallen dungeon minion,
  // each flagged `_soulHarvested` so it's counted once) banks one soul, capped.
  // Banked souls scale the Lich's necrotic attack (read by soulAtkMul in
  // CombatSystem); at T2+ (`shareUndead`) the power overflows to nearby undead.
  _soulHarvest(lich, scene, gameState, ab) {
    const home = this._roomOf(gameState, lich.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const cap = ab.soulCap ?? 8
    lich._souls = lich._souls ?? 0
    lich._soulCap = cap
    lich._perSoulAtk = ab.perSoulAtk ?? 0.07
    let gained = 0
    const harvest = (wx, wy) => {
      if (lich._souls >= cap) return
      lich._souls += 1; gained += 1
      if (scene && Number.isFinite(wx) && Number.isFinite(lich.worldX)) {
        AbilityVfx.soulHarvestFx?.(scene, wx, wy, { toX: lich.worldX, toY: lich.worldY })
      }
    }
    // 1) hero corpses that fell in this room this day
    const grave = gameState.adventurers?.graveyard ?? []
    const day = gameState.meta?.dayNumber
    for (const g of grave) {
      if (g._soulHarvested) continue
      if (day != null && g.diedOnDay !== day) continue
      if (!this._inRoom(g.tileX, g.tileY, home)) continue
      g._soulHarvested = true
      harvest(g.worldX ?? (g.tileX * 32 + 16), g.worldY ?? (g.tileY * 32 + 16))
    }
    // 2) fallen dungeon minions in the room
    for (const m of (gameState.minions ?? [])) {
      if (m === lich || m._soulHarvested) continue
      if (m.faction !== 'dungeon') continue
      if (m.aiState !== 'dead' && (m.resources?.hp ?? 1) > 0) continue
      if (m.assignedRoomId !== lich.assignedRoomId && !this._inRoom(m.tileX, m.tileY, home)) continue
      m._soulHarvested = true
      harvest(m.worldX, m.worldY)
    }
    // T2+ Soul Conduit — overflow the soul-power to nearby undead allies.
    if (ab.shareUndead && lich._souls > 0) {
      const perSoul = ab.allyAtkPerSoul ?? 0.035
      const shareMul = 1 + Math.min(ab.allyAtkCap ?? 0.5, lich._souls * perSoul)
      const until = now + (ab.intervalMs ?? 600) * 2.5
      const tethered = []
      for (const m of (gameState.minions ?? [])) {
        if (m === lich) continue
        if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        if (m.faction !== 'dungeon') continue
        if (!(Array.isArray(m.tags) && m.tags.includes('undead'))) continue
        if (!this._inRoom(m.tileX, m.tileY, home)) continue
        m._soulShareUntil = until; m._soulShareMul = shareMul
        if (Number.isFinite(m.worldX)) tethered.push({ x: m.worldX, y: m.worldY })
      }
      if (gained && tethered.length && scene && Number.isFinite(lich.worldX)) {
        AbilityVfx.soulConduitFx?.(scene, lich.worldX, lich.worldY, { targets: tethered })
      }
    }
    if (gained && scene && Number.isFinite(lich.worldX)) {
      AbilityVfx.floatingText(scene, lich.worldX, (lich.worldY ?? 0) - 28, '+SOUL', { color: '#7CFFB2', fontSize: '10px' })
    }
  },

  // The attack multiplier from banked souls — read in CombatSystem._computeDamage
  // (attacker-side, alongside bloodlust/swarm). Applies to the Lich itself
  // (`_souls`) and to any undead under its Soul Conduit share window.
  soulAtkMul(attacker, scene) {
    if (!attacker) return 1
    const now = scene?.time?.now ?? 0
    let mul = 1
    if (attacker._souls > 0) {
      const per = attacker._perSoulAtk ?? 0.07
      const cap = attacker._soulCap ?? 8
      mul *= 1 + Math.min(cap, attacker._souls) * per
    }
    if (attacker._soulShareUntil && now < attacker._soulShareUntil && attacker._soulShareMul > 1) {
      mul *= attacker._soulShareMul
    }
    return mul
  },

  // Soul Storm (ULT, onTick) — spend the entire soul bank in a room-wide necrotic
  // detonation; damage scales with souls harvested, then the souls reset to 0.
  _soulStorm(lich, scene, gameState, ab) {
    const home = this._roomOf(gameState, lich.assignedRoomId); if (!home) return
    const souls = lich._souls ?? 0
    const dmg = Math.round((ab.baseDmg ?? 8) + souls * (ab.dmgPerSoul ?? 4))
    const victims = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    for (const a of victims) {
      if (!a.resources) continue
      const fl = (a._lightParty || a._shadowMonarch || a._nemesis) ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.1)) : 0
      a.resources.hp = Math.max(fl, a.resources.hp - dmg)
      a._lastHitBy = lich.instanceId; a._lastHitType = 'necrotic'
    }
    if (ab.spendSouls !== false) lich._souls = 0
    if (scene && Number.isFinite(lich.worldX)) {
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.soulStormFx?.(scene, lich.worldX, lich.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), souls, victims: victims.map(a => ({ x: a.worldX, y: a.worldY })) })
      AbilityVfx.screenShake?.(scene, { intensity: 0.006, durationMs: 320 })
      AbilityVfx.floatingText(scene, lich.worldX, (lich.worldY ?? 0) - 32, ab.label ?? 'SOUL STORM', { color: '#7CFFB2', fontSize: '13px' })
    }
  },

  // Per-frame Lich processor (wired in MinionAISystem, like tickGhost). Resurrects
  // a phylactery-bound lich once its revive delay elapses — a green soul-flame
  // rebirth at a fraction of HP (keeping its harvested souls).
  tickLich(scene, gameState) {
    const list = gameState?.minions; if (!list || !list.length) return
    const now = scene?.time?.now ?? 0
    for (const m of list) {
      if (!m._phylacteryReviveAt) continue
      if (now < m._phylacteryReviveAt) continue
      m._phylacteryReviveAt = null
      const maxHp = m.resources?.maxHp ?? m.stats?.hp ?? m.resources?.hp ?? 1
      m.resources.hp = Math.max(1, Math.round(maxHp * (m._phylacteryFrac ?? 0.5)))
      m.aiState = 'idle'
      m.currentTargetId = null
      if (scene && Number.isFinite(m.worldX)) {
        AbilityVfx.phylacteryReviveFx?.(scene, m.worldX, m.worldY)
        AbilityVfx.floatingText(scene, m.worldX, (m.worldY ?? 0) - 30, 'REBORN', { color: '#7CFFB2', fontSize: '12px' })
      }
      EventBus.emit('MINION_REASSEMBLED', { minion: m })   // renderer plays the reverse-death rise
    }
  },

  // ── LIZARDMAN · CAMOUFLAGE ──────────────────────────────────────────────
  // The `camouflage` ability is PASSIVE — the real logic lives in combat hooks
  // (CombatSystem: the untargetable guard + the ambush bonus + reveal-on-strike +
  // kill-recamo) and in `tickLizard` (the cloak lifecycle). These helpers read the
  // family's camouflage ability def.
  camoAbilityOf(minion, scene) {
    const abs = minion && _abilitiesFor(minion, scene)
    return abs ? abs.find(a => a.type === 'camouflage') : null
  },
  // The damage multiplier for a strike FROM camouflage (read in CombatSystem).
  ambushStrikeMul(attacker, scene) {
    if (!attacker?._camouflaged) return 1
    const ab = this.camoAbilityOf(attacker, scene)
    return ab ? (ab.ambushMul ?? 2) : 1
  },
  // Reveal — striking from camo exposes the lizardman: clear the flag, stamp the
  // reveal time (drives the re-camo timer), restore hidden-speed, and snap a
  // materialize-and-strike VFX. Called from CombatSystem after a camo strike lands.
  revealCamouflage(minion, scene) {
    if (!minion?._camouflaged) return
    minion._camouflaged = false
    minion._revealedAt = scene?.time?.now ?? 0
    if (minion._camoBaseSpeed != null && minion.stats) { minion.stats.speed = minion._camoBaseSpeed; minion._camoBaseSpeed = null }
    if (scene && Number.isFinite(minion.worldX)) AbilityVfx.ambushStrikeFx?.(scene, minion.worldX, minion.worldY)
  },
  // Slip back into hiding — re-cloak the lizardman (vanish puff) and clear the
  // reveal stamp so it ambushes again on its next strike.
  recamouflage(minion, scene) {
    if (!minion || minion._camouflaged) return
    minion._camouflaged = true
    minion._revealedAt = 0
    if (scene && Number.isFinite(minion.worldX)) AbilityVfx.camouflageFx?.(scene, minion.worldX, minion.worldY)
  },
  // Kill-recamo — a T2+ stalker that lands a KILLING blow vanishes instantly (a
  // clean getaway). Called from CombatSystem when a camo-kit attacker drops a hero.
  maybeKillRecamo(attacker, scene) {
    const ab = this.camoAbilityOf(attacker, scene)
    if (ab && ab.killRecamo) this.recamouflage(attacker, scene)
  },
  // Per-frame camouflage lifecycle (wired in MinionAISystem, like tickGnoll).
  // Initial cloak on first sight, mid-combat re-cloak once revealed for `recamoMs`,
  // and the faster-while-hidden speed swap (`hiddenSpeedMul`).
  tickLizard(scene, gameState) {
    const list = gameState?.minions; if (!list || !list.length) return
    const now = scene?.time?.now ?? 0
    for (const m of list) {
      if (m.faction !== 'dungeon') continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const ab = this.camoAbilityOf(m, scene)
      if (!ab) continue
      // initial cloak — a freshly-placed/seen stalker starts hidden
      if (m._camoInit !== true) { m._camoInit = true; m._camouflaged = true; m._revealedAt = 0 }
      // mid-combat re-cloak (T2+): slink back after being exposed for recamoMs
      const recamoMs = ab.recamoMs ?? 0
      if (!m._camouflaged && recamoMs > 0 && (now - (m._revealedAt ?? 0)) >= recamoMs) {
        this.recamouflage(m, scene)
      }
      // faster while hidden — reposition for the next ambush
      if (m._camouflaged && ab.hiddenSpeedMul && m.stats) {
        if (m._camoBaseSpeed == null) { m._camoBaseSpeed = m.stats.speed; m.stats.speed = m.stats.speed * ab.hiddenSpeedMul }
      } else if (m._camoBaseSpeed != null && m.stats) {
        m.stats.speed = m._camoBaseSpeed; m._camoBaseSpeed = null
      }
    }
  },
  // Vanishing Warband (ULT, onTick) — the captain hisses and the WHOLE reptile
  // pack in the room re-cloaks at once (every target the party was fighting blinks
  // out), priming a synchronized ambush as they each strike from concealment.
  _vanishingWarband(captain, scene, gameState, ab) {
    const home = this._roomOf(gameState, captain.assignedRoomId); if (!home) return
    let n = 0
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (!this._inRoom(m.tileX, m.tileY, home)) continue
      if (!this.camoAbilityOf(m, scene)) continue
      if (!m._camouflaged) { this.recamouflage(m, scene); n += 1 }
      else n += 1
    }
    if (scene && Number.isFinite(captain.worldX)) {
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.vanishingWarbandFx?.(scene, captain.worldX, captain.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), count: Math.max(4, n) })
      AbilityVfx.floatingText(scene, captain.worldX, (captain.worldY ?? 0) - 30, ab.label ?? 'VANISHING WARBAND', { color: '#7fd98f', fontSize: '13px' })
    }
  },

  // ── IMP · BLINK ─────────────────────────────────────────────────────────
  // The `blink` ability is PASSIVE — the teleport lifecycle lives in `tickImp`
  // (escape-blink when a hero closes, flicker-blink to the backline at T2+).
  blinkAbilityOf(minion, scene) {
    const abs = minion && _abilitiesFor(minion, scene)
    return abs ? abs.find(a => a.type === 'blink') : null
  },
  // Accept the dungeonGrid's numeric floor tiles (FLOOR=1 / BOSS_FLOOR=5) AND the
  // headless sim's string stub ('floor'/'boss_floor').
  _isFloorTile(t) { return t === 1 || t === 5 || t === 'floor' || t === 'boss_floor' },
  // Sample a floor tile in `room` matching `ok(tx,ty)`. `opts.center`+`opts.radius`
  // bias the sampling to a box around a point (so a flicker reliably lands near its
  // prey instead of rolling the whole room); else samples the full room.
  _pickBlinkTile(dungeonGrid, room, ok, opts = {}) {
    if (!room) return null
    const tries = opts.tries ?? 24
    let minX = room.gridX, minY = room.gridY, maxX = room.gridX + Math.max(1, room.width), maxY = room.gridY + Math.max(1, room.height)
    if (opts.center) {
      const c = opts.center, rad = (opts.radius ?? 3) + 1
      minX = Math.max(minX, c.x - rad); maxX = Math.min(maxX, c.x + rad + 1)
      minY = Math.max(minY, c.y - rad); maxY = Math.min(maxY, c.y + rad + 1)
    }
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY)
    for (let i = 0; i < tries; i++) {
      const tx = minX + Math.floor(Math.random() * w)
      const ty = minY + Math.floor(Math.random() * h)
      if (!this._isFloorTile(dungeonGrid?.getTileType?.(tx, ty))) continue
      if (ok && !ok(tx, ty)) continue
      return { x: tx, y: ty }
    }
    return null
  },
  // Teleport a minion to a tile (fire-tinged blink VFX at both ends; clears path
  // so the AI doesn't immediately walk back).
  _teleportMinion(minion, tx, ty, scene) {
    const TS = 32
    const fromX = minion.worldX, fromY = minion.worldY
    minion.tileX = tx; minion.tileY = ty
    minion.worldX = tx * TS + TS / 2; minion.worldY = ty * TS + TS / 2
    minion.path = null; minion.pathIndex = 0; minion._patrolTarget = null
    if (scene && Number.isFinite(fromX) && Number.isFinite(minion.worldX)) AbilityVfx.blinkFx?.(scene, fromX, fromY, minion.worldX, minion.worldY)
  },
  // Per-frame imp blink processor (wired in MinionAISystem — it has the grid).
  // ESCAPE-blink (a hero too close → teleport to kite range) takes priority; else
  // T2+ FLICKER-blink to the most-wounded room hero. Cooldown-gated (`_blinkAt`),
  // shortened during a Hellrift frenzy (`_blinkFrenzyUntil`).
  tickImp(scene, gameState, dungeonGrid) {
    const list = gameState?.minions; if (!list || !list.length) return
    const now = scene?.time?.now ?? 0
    const advs = this._liveAdvs(gameState)
    if (!advs.length) return
    for (const m of list) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const ab = this.blinkAbilityOf(m, scene); if (!ab) continue
      if (now < (m._blinkAt ?? 0)) continue
      const home = this._roomOf(gameState, m.assignedRoomId); if (!home) continue
      const inRoom = advs.filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
      if (!inRoom.length) continue
      const cd = (m._blinkFrenzyUntil && now < m._blinkFrenzyUntil) ? (ab.frenzyCdMs ?? 500) : (ab.cooldownMs ?? 1500)
      const esc = ab.escapeRangeTiles ?? 1.7, kite = ab.kiteRangeTiles ?? 3
      let nearest = null, nd = Infinity
      for (const a of inRoom) { const d = Math.hypot(a.tileX - m.tileX, a.tileY - m.tileY); if (d < nd) { nd = d; nearest = a } }
      // ESCAPE — a hero is in melee → blink to a tile clear of every hero
      if (nearest && nd <= esc) {
        const tile = this._pickBlinkTile(dungeonGrid, home, (tx, ty) => inRoom.every(a => Math.hypot(a.tileX - tx, a.tileY - ty) >= kite))
        if (tile) { this._teleportMinion(m, tile.x, tile.y, scene); m._blinkAt = now + cd }
        continue
      }
      // FLICKER (T2+) — blink in to within attack range of the most-wounded hero
      if (ab.flicker) {
        let prey = null, lowest = Infinity
        for (const a of inRoom) { const hp = a.resources?.hp ?? 0; if (hp < lowest) { lowest = hp; prey = a } }
        if (!prey) continue
        const fr = ab.flickerRangeTiles ?? 3
        const dPrey = Math.hypot(prey.tileX - m.tileX, prey.tileY - m.tileY)
        if (dPrey <= fr && m.currentTargetId === prey.instanceId) continue   // already harassing it
        const tile = this._pickBlinkTile(dungeonGrid, home, (tx, ty) => { const d = Math.hypot(prey.tileX - tx, prey.tileY - ty); return d >= 1.4 && d <= fr }, { center: { x: prey.tileX, y: prey.tileY }, radius: fr })
        if (tile) { this._teleportMinion(m, tile.x, tile.y, scene); m._blinkAt = now + cd; m.currentTargetId = prey.instanceId }
      }
    }
  },
  // Hellrift Frenzy (ULT, onTick) — a room-wide fire pulse + a self-teleport + the
  // whole imp pack in the room blinks into a frenzy (shortened cooldown) for a window.
  _hellrift(imp, scene, gameState, ab) {
    const home = this._roomOf(gameState, imp.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0, dmg = ab.dmg ?? 12
    const victims = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    for (const a of victims) {
      if (!a.resources) continue
      const fl = (a._lightParty || a._shadowMonarch || a._nemesis) ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.1)) : 0
      a.resources.hp = Math.max(fl, a.resources.hp - dmg)
      a._lastHitBy = imp.instanceId; a._lastHitType = 'fire'
    }
    let frenzied = 0
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (!this._inRoom(m.tileX, m.tileY, home)) continue
      if (this.blinkAbilityOf(m, scene)) { m._blinkFrenzyUntil = now + (ab.frenzyMs ?? 4000); frenzied += 1 }
    }
    if (scene && Number.isFinite(imp.worldX)) {
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.hellriftFx?.(scene, imp.worldX, imp.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), victims: victims.map(a => ({ x: a.worldX, y: a.worldY })) })
      AbilityVfx.screenShake?.(scene, { intensity: 0.005, durationMs: 280 })
      AbilityVfx.floatingText(scene, imp.worldX, (imp.worldY ?? 0) - 30, ab.label ?? 'HELLRIFT', { color: '#ff7a3a', fontSize: '13px' })
    }
    return frenzied
  },

  // ── PLANT · ENTANGLE ────────────────────────────────────────────────────
  // Devour (T2+) — the carnivore feeds harder on prey it's ALREADY holding down:
  // bonus damage vs a target that is currently rooted. Read in CombatSystem
  // _computeDamage (attacker-side, like bloodlust/swarm/soul).
  devourMul(attacker, target, scene) {
    if (!attacker || !target) return 1
    const now = scene?.time?.now ?? 0
    if (!(target._rootedUntil && target._rootedUntil > now)) return 1
    const ab = (_abilitiesFor(attacker, scene) ?? []).find(a => a.type === 'entangle')
    return (ab && ab.devourMul > 1) ? ab.devourMul : 1
  },
  // Stranglethorn (ULT, onTick) — a briar thicket erupts: ROOT every hero in the
  // room + DRAIN HP from each (blood-fed, healing the briar). The whole party
  // pinned while it feeds.
  _stranglethorn(briar, scene, gameState, ab) {
    const home = this._roomOf(gameState, briar.assignedRoomId); if (!home) return
    const victims = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    const drain = ab.drain ?? 8, heal = ab.healPerHit ?? 6
    let healed = 0
    for (const a of victims) {
      if (!a.resources) continue
      this._applyRoot(a, scene, ab.rootMs ?? 3000)
      const fl = (a._lightParty || a._shadowMonarch || a._nemesis) ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.1)) : 0
      const before = a.resources.hp
      a.resources.hp = Math.max(fl, a.resources.hp - drain)
      a._lastHitBy = briar.instanceId; a._lastHitType = 'physical'
      if (a.resources.hp < before) healed += heal
    }
    if (healed && briar.resources) { const max = briar.resources.maxHp ?? 0; briar.resources.hp = Math.min(max, briar.resources.hp + healed); briar._briarFedUntil = (scene?.time?.now ?? 0) + 1600 }   // flare the well-fed life-glow (renderer)
    if (scene && Number.isFinite(briar.worldX)) {
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.stranglethornFx?.(scene, briar.worldX, briar.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), victims: victims.map(a => ({ x: a.worldX, y: a.worldY })) })
      AbilityVfx.screenShake?.(scene, { intensity: 0.004, durationMs: 260 })
      AbilityVfx.floatingText(scene, briar.worldX, (briar.worldY ?? 0) - 30, ab.label ?? 'STRANGLETHORN', { color: '#9fcf5a', fontSize: '13px' })
    }
  },

  // ── MUSHROOM · HALLUCINATION ────────────────────────────────────────────
  // Daze — hallucinogenic spores scramble a hero's senses: stamp a daze window +
  // whiff chance (keep-strongest), drawing the spore-mote tell. Read by
  // CombatSystem (`dazeMissChance`) so the hero swings at phantoms.
  _applyDaze(adv, scene, durationMs, missChance) {
    if (!adv || adv.faction === 'dungeon') return
    const now = scene?.time?.now ?? 0
    const next = now + (durationMs ?? 3000)
    if ((adv._dazedUntil ?? 0) < next) adv._dazedUntil = next
    adv._dazeMissChance = Math.max(adv._dazeMissChance ?? 0, missChance ?? 0.3)
    if (scene && Number.isFinite(adv.worldX)) AbilityVfx.dazeFx?.(scene, adv.worldX, adv.worldY)
  },
  // The whiff chance for a currently-dazed attacker (read in CombatSystem.tryAttack).
  dazeMissChance(attacker, now) {
    if (!attacker || !(attacker._dazedUntil && attacker._dazedUntil > (now ?? 0))) return 0
    return attacker._dazeMissChance ?? 0
  },
  // Spore Cloud (T2, onTick) — the cap belches a cloud that dazes every hero within
  // `radiusTiles` (a spreading AoE haze over the front line).
  _sporePuff(mushroom, scene, gameState, ab) {
    const home = this._roomOf(gameState, mushroom.assignedRoomId); if (!home) return
    const radius = ab.radiusTiles ?? 2.5
    let hit = 0
    for (const a of this._liveAdvs(gameState)) {
      if (!this._onFloorInRoom(scene, a.tileX, a.tileY, home)) continue
      if (Math.hypot(a.tileX - mushroom.tileX, a.tileY - mushroom.tileY) > radius + 0.01) continue
      this._applyDaze(a, scene, ab.durationMs ?? 3000, ab.missChance ?? 0.3); hit += 1
    }
    if (scene && Number.isFinite(mushroom.worldX)) {
      AbilityVfx.sporePuffFx?.(scene, mushroom.worldX, mushroom.worldY, { radius: radius * 32 })
      if (hit) AbilityVfx.floatingText(scene, mushroom.worldX, (mushroom.worldY ?? 0) - 26, ab.label ?? 'SPORE CLOUD', { color: '#b98fd0', fontSize: '11px' })
    }
  },
  // Spore Storm (ULT, onTick) — a room-wide hallucinogenic bloom: heavy daze on
  // EVERY hero in the room (they whiff most of their attacks).
  _sporeStorm(stalker, scene, gameState, ab) {
    const home = this._roomOf(gameState, stalker.assignedRoomId); if (!home) return
    const victims = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    for (const a of victims) this._applyDaze(a, scene, ab.durationMs ?? 4500, ab.missChance ?? 0.55)
    if (scene && Number.isFinite(stalker.worldX)) {
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.sporeStormFx?.(scene, stalker.worldX, stalker.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), victims: victims.map(a => ({ x: a.worldX, y: a.worldY })) })
      AbilityVfx.floatingText(scene, stalker.worldX, (stalker.worldY ?? 0) - 30, ab.label ?? 'SPORE STORM', { color: '#c79fe0', fontSize: '13px' })
    }
  },

  // Vermin Tide (ULT, onTick) — whip every rat in the room into a frenzy: max
  // swarm stacks (atk + DR) + a speed surge for a window. tickRat restores speed.
  _verminTide(rat, scene, gameState, ab) {
    const home = this._roomOf(gameState, rat.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const frenzyMs = ab.frenzyMs ?? 4000, speedMul = ab.speedMul ?? 1.4
    let n = 0
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.assignedRoomId !== rat.assignedRoomId) continue
      const abs = _abilitiesFor(m, scene)
      if (!abs || !abs.some(a => a.type === 'swarm')) continue
      m._swarmFrenzyUntil = now + frenzyMs
      if (m._swarmFrenzyBaseSpeed == null && m.stats) { m._swarmFrenzyBaseSpeed = m.stats.speed; m.stats.speed = m.stats.speed * speedMul }
      n += 1
    }
    if (scene && Number.isFinite(rat.worldX)) {
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.verminTideFx?.(scene, rat.worldX, rat.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), count: Math.max(10, n * 4) })
      AbilityVfx.floatingText(scene, rat.worldX, (rat.worldY ?? 0) - 30, ab.label ?? 'VERMIN TIDE', { color: '#c9a14a', fontSize: '13px' })
    }
  },
  // Restore base speed when a rat's Vermin Tide frenzy ends (mirrors tickOrc).
  tickRat(scene, gameState) {
    const now = scene?.time?.now ?? 0
    for (const m of (gameState?.minions ?? [])) {
      if (m._swarmFrenzyBaseSpeed == null) continue
      if ((m._swarmFrenzyUntil ?? 0) > now) continue
      if (m.stats) m.stats.speed = m._swarmFrenzyBaseSpeed
      m._swarmFrenzyBaseSpeed = null
    }
  },

  // ── Demon · HELLFIRE / IMMOLATION (escalating burn aura → Inferno) ─────────
  // Burning Aura (onTick) — heroes near the demon take fire damage that ESCALATES
  // with a per-hero Hellfire heat stack (builds while close, cools via tickDemon).
  _burningAura(demon, scene, gameState, ab) {
    const home = this._roomOf(gameState, demon.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const radius = ab.radiusTiles ?? 2.5, maxStacks = ab.maxStacks ?? 5
    const advs = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    let any = false
    for (const a of advs) {
      if (Math.hypot(a.tileX - demon.tileX, a.tileY - demon.tileY) > radius + 0.01) continue
      any = true
      a._hellfireStacks = Math.min(maxStacks, (a._hellfireStacks ?? 0) + 1)
      a._hellfireMax = maxStacks   // AdventurerRenderer reads this for the heat-ratio tell
      a._hellfireAt = now
      const dmg = Math.max(1, Math.round((ab.dmg ?? 3) * (1 + (a._hellfireStacks - 1) * (ab.per ?? 0.4))))
      const fl = (a._lightParty || a._shadowMonarch) ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.10)) : 0
      a.resources.hp = Math.max(fl, a.resources.hp - dmg)
      a._lastHitBy = demon.instanceId; a._lastHitType = 'fire'
      if (scene && Number.isFinite(a.worldX)) {
        AbilityVfx.floatingText(scene, a.worldX, (a.worldY ?? 0) - 14, `-${dmg}`, { color: '#ff7733' })
        // burn rides IN FRONT of the hero's sprite (entity band ≈ 7 + worldY*0.0005)
        AbilityVfx.burnFx?.(scene, a.worldX, a.worldY - 6, { intensity: 0.3 + 0.14 * a._hellfireStacks, depth: 11 + (a.worldY ?? 0) * 0.0005, rate: 24, spread: 9, rise: 50 })
      }
      // T2+ Combustion — a max-heat hero detonates, then their heat resets.
      if (ab.combust && a._hellfireStacks >= maxStacks) this._combust(scene, gameState, a, ab, demon, home)
    }
    if (any && scene && Number.isFinite(demon.worldX)) AbilityVfx.hellfireAuraFx?.(scene, demon.worldX, demon.worldY, { radius: radius * 32, flames: demon.definitionId !== 'demon1' })
  },

  // A max-Hellfire hero COMBUSTS — a fire blast to nearby heroes, then heat resets.
  _combust(scene, gameState, hero, ab, demon, home) {
    const advs = this._liveAdvs(gameState).filter(a => a !== hero && this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    const r = ab.combustRadiusTiles ?? 1.5, dmg = ab.combustDmg ?? 8
    for (const a of advs) {
      if (Math.hypot(a.tileX - hero.tileX, a.tileY - hero.tileY) > r + 0.01) continue
      const fl = (a._lightParty || a._shadowMonarch) ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.10)) : 0
      a.resources.hp = Math.max(fl, a.resources.hp - dmg)
      a._lastHitBy = demon?.instanceId; a._lastHitType = 'fire'
      a._hellfireStacks = Math.max(a._hellfireStacks ?? 0, Math.ceil((ab.maxStacks ?? 5) * 0.4))   // splash heat onto neighbours
    }
    hero._hellfireStacks = 0
    if (scene && Number.isFinite(hero.worldX)) {
      AbilityVfx.combustFx?.(scene, hero.worldX, hero.worldY)
      AbilityVfx.screenShake?.(scene, { intensity: 0.005, durationMs: 220 })
      AbilityVfx.floatingText(scene, hero.worldX, (hero.worldY ?? 0) - 26, 'COMBUST', { color: '#ffcc33' })
    }
  },

  // Decay stale Hellfire heat — a hero who left the aura (not re-stacked recently) cools off.
  tickDemon(scene, gameState) {
    const now = scene?.time?.now ?? 0
    for (const a of this._liveAdvs(gameState)) {
      if (!a._hellfireStacks) continue
      if (now - (a._hellfireAt ?? 0) < 1400) continue
      a._hellfireStacks = Math.max(0, a._hellfireStacks - 1)
      a._hellfireAt = now
    }
  },

  // Demon Lord INFERNO (ULT, onTick) — erupt the whole room: max heat + a big fire AoE.
  _inferno(demon, scene, gameState, ab) {
    const home = this._roomOf(gameState, demon.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const advs = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    const dmg = ab.dmg ?? 6
    for (const a of advs) {
      const fl = (a._lightParty || a._shadowMonarch) ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.10)) : 0
      a.resources.hp = Math.max(fl, a.resources.hp - dmg)
      a._hellfireStacks = ab.maxStacks ?? 6; a._hellfireAt = now
      a._lastHitBy = demon.instanceId; a._lastHitType = 'fire'
    }
    if (scene && Number.isFinite(demon.worldX)) {
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.infernoFx?.(scene, demon.worldX, demon.worldY, { rectW: rw, rectH: rh })
      AbilityVfx.screenShake?.(scene, { intensity: 0.011, durationMs: 420 })
      if (advs.length) AbilityVfx.floatingText(scene, demon.worldX, (demon.worldY ?? 0) - 30, ab.label ?? 'INFERNO', { color: '#ff8833', fontSize: '13px' })
    }
  },

  // ── Zombie · RAISE THE DEAD (slain heroes rise as your zombies) ───────────
  ZOMBIE_ROOM_CAP: 10,
  // The slain hero doesn't snap back instantly — its corpse DECAYS into a zombie:
  // a Risen spawns dead and slowly fades in over the adventurer corpse (which
  // dissolves), then reverse-rises. This is that crossfade/decay window.
  REANIM_DECAY_MS: 1300,
  _hasAbility(m, scene, type) { const a = m && _abilitiesFor(m, scene); return !!(a && a.some(x => x.type === type)) },
  // True if this minion has an AREA/room offensive ability (an "AoE threat") —
  // used by the bestiary POSITIONING counter so a studied party spreads out near
  // it (an area attack then catches fewer of them). NEEDS_ENEMY_TICK is the set
  // of room/radius ticks that only fire with a hero present — the AoE proxy.
  isAoeThreat(m, scene) { const a = m && _abilitiesFor(m, scene); return !!(a && a.some(x => this.NEEDS_ENEMY_TICK.has(x.type))) },
  _liveRaisedZombies(gameState, roomId) {
    // Counts toward the room cap: living Risen AND ones spawned dead that are
    // mid-decay (pending reverse-rise, `_reanimRiseAt`) — so a burst of kills
    // can't queue more than the cap before any of them stand up. A truly KILLED
    // Risen (dead, no pending rise) frees its slot.
    return (gameState?.minions ?? []).filter(m =>
      m._raisedZombie && m.assignedRoomId === roomId &&
      ((m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0) || m._reanimRiseAt)).length
  },

  // Spawn a weak Risen zombie at `adv`'s position (reuses the slime-split runtime
  // shape). class:'garrison' + `_raisedZombie` → wiped each dawn; STERILE (renders
  // as zombie1 but the recursion gate in onAdventurerDied checks `_raisedZombie`).
  _raiseZombie(scene, gameState, adv, roomId, opts = {}) {
    if (!gameState?.minions || !adv) return null
    const { silent = false, dead = false, fadeIn = false, riseDelayMs = 0 } = opts
    const room = roomId ?? adv.assignedRoomId
    if (this._liveRaisedZombies(gameState, room) >= this.ZOMBIE_ROOM_CAP) return null
    const TS = 32, lvl = gameState.boss?.level ?? 1, now = scene?.time?.now ?? 0
    const hp = Math.max(12, Math.round(20 + lvl * 4)), atk = Math.max(3, Math.round(5 + lvl * 1.2))
    let tx = adv.tileX ?? Math.round((adv.worldX ?? 0) / TS), ty = adv.tileY ?? Math.round((adv.worldY ?? 0) / TS)
    let wx = adv.worldX ?? (tx * TS + TS / 2), wy = adv.worldY ?? (ty * TS + TS / 2)
    // Don't raise the Risen inside a wall/door (the corpse may have fallen on a
    // doorway or been knocked into a wall) — snap to the nearest open floor.
    const _ft = scene?.dungeonGrid?.nearestFloorTile?.(tx, ty)
    if (_ft && (_ft.x !== tx || _ft.y !== ty)) { tx = _ft.x; ty = _ft.y; wx = tx * TS + TS / 2; wy = ty * TS + TS / 2 }
    const z = {
      instanceId: `min_risen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      definitionId: 'zombie1', name: 'Risen', color: 0x668844, sigil: '☠',
      tileX: tx, tileY: ty, worldX: wx, worldY: wy,
      homeTileX: tx, homeTileY: ty, assignedRoomId: room,
      class: 'garrison', behaviorType: 'roam', tags: ['undead', 'melee', 'raised'],
      damageType: 'physical', attackRange: 1, faction: 'dungeon', factionExpiresOn: null,
      raisedByAdvId: null, tamedByAdvId: null, isMiniBoss: false, _raisedZombie: true,
      stats: { hp, attack: atk, defense: 2, speed: 0.6, abilities: [] },
      resources: { hp: dead ? 0 : hp, maxHp: hp },
      level: 1, xp: 0, evolutionHistory: [], killHistory: [], lifetime: { kills: 0, damageDealt: 0 },
      equippedGear: [], hasBounty: false, bountyKillCount: 0, aiState: dead ? 'dead' : 'idle',
    }
    if (dead) {
      // Spawn as a corpse; tickReanimations flips it alive at _reanimRiseAt so
      // MinionRenderer reverse-plays the zombie death anim (it stands up).
      z._reanimRiseAt = now + riseDelayMs
      if (fadeIn) { z._reanimFadeFrom = now; z._reanimFadeMs = riseDelayMs }
    }
    gameState.minions.push(z)
    // Mass Grave / decay-crossfade own their own VFX → skip the single-raise burst.
    if (!silent && scene && Number.isFinite(z.worldX)) AbilityVfx.reanimateFx?.(scene, z.worldX, z.worldY, {})
    return z
  },

  // ADVENTURER_DIED hook (subscribed in MinionAISystem). Raise a Risen zombie when
  // the hero was killed by a (non-raised) reanimate-zombie [T1] OR was rot-infected
  // [T2 — rises no matter what killed it]. payload = {adventurer, killerId, roomId}.
  onAdventurerDied(scene, gameState, payload) {
    if (!payload || !gameState) return
    const adv = payload.adventurer; if (!adv) return
    const now = scene?.time?.now ?? 0
    const room = payload.roomId ?? adv.assignedRoomId
    let raise = (adv._rotInfectedUntil ?? 0) > now
    if (!raise && payload.killerId) {
      const killer = (gameState.minions ?? []).find(m => m.instanceId === payload.killerId)
      if (killer && !killer._raisedZombie && this._hasAbility(killer, scene, 'reanimate')) raise = true
    }
    if (raise) this._reanimateAdv(scene, gameState, adv, room, now)
  },

  // DECAY → RISE: the slain hero doesn't snap up instantly. A Risen spawns DEAD at
  // the death spot and slowly fades IN over REANIM_DECAY_MS while the adventurer
  // corpse dissolves (renderer reads `_reanimFadeOutFrom` on the graveyard entry) —
  // so it reads as the body rotting into a zombie. tickReanimations then flips the
  // Risen alive so MinionRenderer reverse-plays the zombie death anim (it stands up).
  _reanimateAdv(scene, gameState, adv, room, now) {
    const z = this._raiseZombie(scene, gameState, adv, room, { silent: true, dead: true, fadeIn: true, riseDelayMs: this.REANIM_DECAY_MS })
    if (!z) return
    const g = (gameState.adventurers?.graveyard ?? []).find(e => e.instanceId === adv.instanceId) ?? adv
    g._reanimFadeOutFrom = now
    g._reanimFadeMs = this.REANIM_DECAY_MS
  },

  // Wired in MinionAISystem.update. Flips spawned-dead Risen alive once their
  // decay/crossfade has elapsed → MinionRenderer reverse-rises them. O(minions).
  tickReanimations(scene, gameState) {
    if (!gameState) return
    const now = scene?.time?.now ?? 0
    for (const m of (gameState.minions ?? [])) {
      if (!m._reanimRiseAt || now < m._reanimRiseAt) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) {
        m.aiState = 'idle'
        m.resources.hp = m.resources.maxHp ?? m.stats?.hp ?? 1
        if (scene && Number.isFinite(m.worldX)) AbilityVfx.reanimateFx?.(scene, m.worldX, m.worldY, {})
      }
      m._reanimRiseAt = null
    }
  },

  // Crypt Lord MASS GRAVE (ULT, onTick) — claw the room's fallen back up at once
  // (each corpse raises once) + a room-wide rot infection so the outbreak continues.
  _massGrave(crypt, scene, gameState, ab) {
    const home = this._roomOf(gameState, crypt.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const TS = 32
    const grave = gameState.adventurers?.graveyard ?? []
    const inRoom = grave.filter(g => !g._massRaised && this._inRoom(g.tileX, g.tileY, home))
    const maxRaise = ab.maxRaise ?? 5
    let raised = 0
    const risePts = []
    // Each fallen hero claws its way up AT ITS OWN DEATH SPOT (so the eruption reads
    // as "everywhere a hero fell, it rises"); Mass Grave's VFX erupts at each point.
    for (const g of inRoom) {
      if (raised >= maxRaise) break
      const tx = g.tileX ?? crypt.tileX, ty = g.tileY ?? crypt.tileY
      const wx = Number.isFinite(g.worldX) ? g.worldX : tx * TS + TS / 2
      const wy = Number.isFinite(g.worldY) ? g.worldY : ty * TS + TS / 2
      const z = this._raiseZombie(scene, gameState, { tileX: tx, tileY: ty, worldX: wx, worldY: wy }, crypt.assignedRoomId, { silent: true, dead: true, riseDelayMs: 150 })
      if (z) { g._massRaised = true; raised += 1; risePts.push({ x: wx, y: wy }) }
    }
    const advs = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    for (const a of advs) a._rotInfectedUntil = now + (ab.infectMs ?? 9000)
    if (scene && Number.isFinite(crypt.worldX)) {
      const rw = Math.min(360, (home.width ?? 6) * 32), rh = Math.min(240, (home.height ?? 6) * 32)
      AbilityVfx.massGraveFx?.(scene, crypt.worldX, crypt.worldY, { rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), risePts, count: Math.max(5, raised + advs.length) })
      AbilityVfx.floatingText(scene, crypt.worldX, (crypt.worldY ?? 0) - 30, ab.label ?? 'MASS GRAVE', { color: '#9bd07a', fontSize: '13px' })
    }
  },

  // Warlord WAR CRY (onTick) — grant Bloodlust stacks to every orc in the room.
  _warCry(orc, scene, gameState, ab) {
    const stacks = ab?.stacks ?? 2
    let hit = 0
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || !this._isOrc(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.assignedRoomId !== orc.assignedRoomId) continue
      this._addBloodlust(scene, m, null, stacks)
      if (scene && m !== orc && Number.isFinite(m.worldX)) AbilityVfx.floatingText(scene, m.worldX, (m.worldY ?? 0) - 30, '↑RAGE', { color: '#ff7a2a', fontSize: '10px' })
      hit += 1
    }
    if (scene && Number.isFinite(orc.worldX)) {
      AbilityVfx.soundWave?.(scene, orc.worldX, (orc.worldY ?? 0) - 8, { color: 0xff7a2a, arcs: 3, toR: 110 })
      AbilityVfx.screenShake?.(scene, { intensity: 0.006, durationMs: 200 })
      AbilityVfx.floatingText(scene, orc.worldX, (orc.worldY ?? 0) - 36, ab?.label ?? 'WAR CRY', { color: '#ffb03a', fontSize: '12px' })
    }
    return hit
  },

  // Veteran WARPATH (ult, onTick) — max own + warband Bloodlust, then enter a
  // Rampage (ATK + speed surge for a window). tickOrc restores the base speed.
  _warpath(vet, scene, gameState, ab) {
    const now = scene?.time?.now ?? 0
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || !this._isOrc(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.assignedRoomId !== vet.assignedRoomId) continue
      m._bloodlustMax   = m._bloodlustMax ?? 6
      m._bloodlustPer   = m._bloodlustPer ?? 0.08
      m._bloodlustDecay = m._bloodlustDecay ?? 4000
      m._bloodlustStacks = m._bloodlustMax
      m._bloodlustAt = now
    }
    // Rampage surge on the Veteran (guard against re-capturing a boosted base).
    if (!(vet._rampageUntil > now)) vet._rampageBaseSpeed = vet.stats?.speed ?? 1
    if (vet.stats) vet.stats.speed = (vet._rampageBaseSpeed ?? 1) * (ab?.speedMult ?? 1.5)
    vet._rampageUntil  = now + (ab?.rampageMs ?? 5000)
    vet._rampageAtkMul = ab?.atkMult ?? 1.6
    if (scene && Number.isFinite(vet.worldX)) {
      AbilityVfx.groundCrack?.(scene, vet.worldX, (vet.worldY ?? 0) + 8, { radius: 56, cracks: 7 })
      AbilityVfx.furyAura?.(scene, vet.worldX, (vet.worldY ?? 0) + 6, { intensity: 1, durationMs: 900 })
      AbilityVfx.soundWave?.(scene, vet.worldX, (vet.worldY ?? 0) - 8, { color: 0xff3a1e, arcs: 4, toR: 130 })
      AbilityVfx.screenShake?.(scene, { intensity: 0.012, durationMs: 360 })
      AbilityVfx.floatingText(scene, vet.worldX, (vet.worldY ?? 0) - 42, '☠ WARPATH', { color: '#ff5a2a', fontSize: '14px' })
    }
    EventBus.emit('MINION_ULT', { minion: vet, ability: 'warpath' })
  },

  // Per-frame Orc upkeep (called from MinionAISystem.update) — restore the
  // Veteran's base movement speed when its Rampage window ends.
  tickOrc(scene, gameState) {
    const now = scene?.time?.now ?? 0
    for (const m of (gameState?.minions ?? [])) {
      if (!m._rampageUntil || now < m._rampageUntil) continue
      if (m._rampageBaseSpeed != null && m.stats) m.stats.speed = m._rampageBaseSpeed
      m._rampageUntil = 0; m._rampageBaseSpeed = null; m._rampageAtkMul = 1
    }
  },

  // ── Vampire · LIFE DRAIN (lifesteal → blood-shield → room-wide Blood Feast) ──
  _isVampire(m) { return Array.isArray(m?.tags) && m.tags.includes('vampire') },

  // Bank overheal as a temporary blood-shield (absorbs damage before HP), capped
  // at shieldFracMax × maxHP. Stamps the decay clock so a feeding vampire keeps
  // its shell while it drains; tickVampire bleeds it away once it stops.
  _gainBloodShield(minion, amount, shieldFracMax, now) {
    if (!minion?.resources || amount <= 0) return 0
    const cap = Math.ceil((minion.resources.maxHp ?? 0) * (shieldFracMax ?? 0.6))
    const before = minion._bloodShield ?? 0
    minion._bloodShield = Math.min(cap, before + amount)
    minion._bloodShieldAt = now ?? 0
    return minion._bloodShield - before
  },
  bloodShieldOf(minion) { return minion?._bloodShield ?? 0 },

  // CombatSystem calls this when a shielded vampire takes a hit — the blood-shield
  // soaks damage first. Returns the damage REMAINING after absorption.
  absorbBloodShield(target, dmg, scene) {
    const sh = target?._bloodShield ?? 0
    if (sh <= 0 || dmg <= 0) return dmg
    const absorbed = Math.min(sh, dmg)
    target._bloodShield = sh - absorbed
    if (scene && Number.isFinite(target.worldX)) AbilityVfx.bloodShieldHit?.(scene, target.worldX, target.worldY - 12, {})
    return dmg - absorbed
  },

  // Decays every vampire's blood-shield so it's TEMPORARY — overheal from active
  // feeding outpaces the decay, but the shell bleeds away once it stops drainning.
  tickVampire(scene, gameState, delta) {
    const now = scene?.time?.now ?? 0
    for (const m of (gameState?.minions ?? [])) {
      if (!m._bloodShield || m._bloodShield <= 0) continue
      if (now - (m._bloodShieldAt ?? now) < 1200) continue            // grace right after a drain
      const dec = Math.max(1, Math.ceil(m._bloodShield * 0.06 * ((delta ?? 16) / 1000)))
      m._bloodShield = Math.max(0, m._bloodShield - dec)
    }
  },

  // Vampire · BLOOD FEAST (ULT, onTick) — siphon HP from EVERY adventurer in the
  // room at once; the Sovereign heals to overflow (blood-shield) + tops up kin.
  _bloodFeast(vampire, scene, gameState, ab) {
    const home = this._roomOf(gameState, vampire.assignedRoomId); if (!home) return
    const now = scene?.time?.now ?? 0
    const advs = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    if (!advs.length) return
    const drain = ab.drainPerAdv ?? 6, maxHp = vampire.resources?.maxHp ?? 0
    let total = 0; const pts = []
    for (const a of advs) {
      const fl = (a._lightParty || a._shadowMonarch) ? Math.max(1, Math.ceil((a.resources.maxHp ?? 1) * 0.10)) : 0
      const dealt = Math.min((a.resources.hp ?? 0) - fl, drain); if (dealt <= 0) continue
      a.resources.hp = Math.max(fl, a.resources.hp - drain)
      a._lastHitBy = vampire.instanceId; a._lastHitType = 'blood'
      total += dealt
      if (Number.isFinite(a.worldX)) pts.push({ x: a.worldX, y: a.worldY - 10 })
    }
    if (total <= 0) return
    const before = vampire.resources.hp
    vampire.resources.hp = Math.min(maxHp, before + total)
    const overheal = total - (vampire.resources.hp - before)
    if (overheal > 0) this._gainBloodShield(vampire, overheal, ab.shieldFracMax ?? 0.8, now)
    // top up nearby vampire-kin
    for (const m of (gameState.minions ?? [])) {
      if (m === vampire || m.faction !== 'dungeon' || !this._isVampire(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (!this._inRoom(m.tileX, m.tileY, home)) continue
      m.resources.hp = Math.min(m.resources.maxHp ?? 0, m.resources.hp + Math.ceil(drain * 0.5))
    }
    if (scene && Number.isFinite(vampire.worldX)) {
      AbilityVfx.bloodFeastFx?.(scene, vampire.worldX, vampire.worldY, pts, {})
      AbilityVfx.floatingText(scene, vampire.worldX, (vampire.worldY ?? 0) - 34, ab.label ?? 'BLOOD FEAST', { color: '#ff3355', fontSize: '13px' })
    }
  },

  // ── On minion death (MinionAISystem._die hook) ───────────────────────────

  onMinionDeath(scene, minion, gameState) {
    // Credit any pickpocketed gold to the dungeon — surviving the day banks
    // the loot, dying en route hands it back.
    if (minion?._stolenGold > 0) {
      const owed = minion._stolenGold
      minion._stolenGold = 0
      if (gameState?.player) gameState.player.gold = (gameState.player.gold ?? 0) + owed
      if (scene) AbilityVfx.floatingText(scene, minion.worldX ?? 0, (minion.worldY ?? 0) - 14, `+${owed}g`, { color: '#ffdd44' })
    }

    if (!minion) return
    const id = minion.definitionId

    // Slime Split on Death is now data-driven (split onDeath in minionTypes.json
    // on every split-capable slime tier — including the elders, which the old
    // tier-1-4-only SLIME_IDS set never covered). Handled by runDeathAbilities
    // below; the hardcoded block lived here.

    // Imp Self-Combust + Mushroom Confusion Spores are now data-driven
    // (aoeOnDeath / staggerCloud onDeath in minionTypes.json) — handled by
    // runDeathAbilities below alongside the slime/elder Split.

    // Data-driven onDeath abilities (Thread E) — split / aoe / stagger-cloud
    // authored in JSON.
    this.runDeathAbilities(scene, minion, gameState)
  },

  // ── Per-tick (AISystem + MinionAISystem hooks) ───────────────────────────

  tickEntity(entity, scene, delta) {
    if (!entity || entity.aiState === 'dead' || (entity.resources?.hp ?? 0) <= 0) return
    const now = scene?.time?.now ?? 0

    // DoT processing
    if (entity._dot && entity._dot.length > 0) {
      const remaining = []
      for (const d of entity._dot) {
        const last = d._lastTickAt ?? now
        if (now - last >= d.intervalMs) {
          d._lastTickAt = now
          d.ticksLeft -= 1
          entity.resources.hp = Math.max(0, entity.resources.hp - d.dmgPerTick)
          // Death attribution — stamp the DoT's source minion + element so
          // a poison/burn that lands the killing blow (often on a standing-
          // still adv) is credited to that minion in the graveyard. Without
          // this, _kill falls back to the 'dot' hint, which _lookupKillerName
          // can't resolve → "Unknown (physical)".
          if (d.source) entity._lastHitBy = d.source
          if (d.type)   entity._lastHitType = d.type
          if (scene) {
            const color = d.type === 'burn' ? '#ff7733' : '#88dd44'
            AbilityVfx.floatingText(scene, entity.worldX ?? 0, (entity.worldY ?? 0) - 14, `-${d.dmgPerTick}`, { color })
          }
        }
        if (d.ticksLeft > 0) remaining.push(d)
      }
      entity._dot = remaining
    }

    // Status expiry — clear flags whose deadline has passed so isRooted /
    // isStaggered cleanup happens even if the entity isn't actively queried.
    if (entity._rootedUntil && now >= entity._rootedUntil) entity._rootedUntil = 0
    if (entity._staggeredUntil && now >= entity._staggeredUntil) entity._staggeredUntil = 0
    if (entity._slowUntil && now >= entity._slowUntil) { entity._slowUntil = 0; entity._slowMult = 1 }
    if (entity._armorShredUntil && now >= entity._armorShredUntil) { entity._armorShredUntil = 0; entity._armorShred = 0 }
  },

  // ── Data-driven ability runner (Thread E) ────────────────────────────────
  // Public trigger entrypoints. Each iterates the minion's JSON `abilities`
  // (filtered by trigger) and dispatches to a handler. Designed to run
  // ALONGSIDE the legacy family-Set blocks while we migrate, then those
  // blocks get deleted and only data remains.

  // onHit data abilities — ctx carries the struck target + damage dealt.
  runHitAbilities(scene, attacker, target, damageDealt, gameState) {
    // A dead attacker fires nothing — guards the rare case where the strike that
    // resolves this onHit also downed the attacker (simultaneous trade).
    if (!attacker || attacker.aiState === 'dead' || (attacker.resources?.hp ?? 0) <= 0) return
    // No abilities while standing in a doorway / door — only inside a room.
    if (scene?.dungeonGrid?.getTileType?.(attacker.tileX, attacker.tileY) === TILE.DOOR) return
    const abilities = _abilitiesFor(attacker, scene, 'onHit')
    if (!abilities) return
    for (const ab of abilities) {
      if (ab.chance != null && Math.random() >= ab.chance) continue
      if (ab.oncePerFight) {
        const key = `_abOnce_${ab.type}`
        if (attacker[key]) continue
        attacker[key] = true
      }
      this._applyHitAbility(scene, attacker, target, damageDealt, gameState, ab)
    }
  },

  // onDeath data abilities — split / aoe / stagger-cloud, etc.
  runDeathAbilities(scene, minion, gameState) {
    const abilities = _abilitiesFor(minion, scene, 'onDeath')
    if (!abilities) return
    for (const ab of abilities) {
      if (ab.chance != null && Math.random() >= ab.chance) continue
      this._applyDeathAbility(scene, minion, gameState, ab)
    }
  },

  // onTick data abilities — heal/revive/buff/contagion/summon/hazard auras.
  // Called from MinionAISystem._tickMinion (minions only). Per-ability accums
  // live in minion._abAccum keyed by ability type so intervals are independent.
  tickAbilities(minion, scene, gameState, dungeonGrid, delta) {
    if (!minion || minion.aiState === 'dead' || (minion.resources?.hp ?? 0) <= 0) return
    if (minion.faction !== 'dungeon') return
    // No abilities while standing in a doorway / door — only inside a room.
    if (dungeonGrid?.getTileType?.(minion.tileX, minion.tileY) === TILE.DOOR) return
    const abilities = _abilitiesFor(minion, scene, 'onTick')
    if (!abilities) return
    minion._abAccum = minion._abAccum ?? {}
    for (const ab of abilities) {
      const iv = ab.intervalMs ?? 1000
      const k = ab.type
      minion._abAccum[k] = (minion._abAccum[k] ?? 0) + delta
      if (minion._abAccum[k] < iv) continue
      // Anti-spam (best-time gating): an offensive tick only fires when there's
      // a real target in the room. If not, hold the cooldown CHARGED (clamp at
      // the interval, don't reset to 0) so it goes off the instant a hero walks
      // in — instead of blowing the ult into an empty room every interval.
      if (!this._tickAbilityArmed(minion, scene, gameState, ab)) { minion._abAccum[k] = iv; continue }
      minion._abAccum[k] = 0
      this._applyTickAbility(minion, scene, gameState, dungeonGrid, ab)
    }
  },

  // Passive damage-taken multiplier queried by CombatSystem._computeDamage.
  // Sums 'damageReduction' abilities on the TARGET minion (Ent Gnarled Hide,
  // Skeleton Shieldwall). damageType-gated; shieldwall can require a same-room
  // family ally to be present.
  damageTakenMul(target, attacker, gameState, scene) {
    const abilities = _abilitiesFor(target, scene, 'passive')
    if (!abilities) return 1
    const dmgType = attacker?.damageType ?? attacker?.stats?.damageType ?? 'physical'
    let mul = 1
    for (const ab of abilities) {
      if (ab.type !== 'damageReduction') continue
      if (ab.damageType && ab.damageType !== dmgType) continue
      if (ab.requireFamilyAllyTag && gameState) {
        const has = (gameState.minions ?? []).some(m =>
          m !== target && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 &&
          m.assignedRoomId === target.assignedRoomId &&
          Array.isArray(m.tags) && m.tags.includes(ab.requireFamilyAllyTag))
        if (!has) continue
      }
      mul *= (ab.mult ?? 1)
    }
    // Skeleton bone-shell — temporary damage reduction granted on each Reassemble
    // rise (Boneguard / Grave Knight). Decays on its own timer.
    const nowS = scene?.time?.now ?? 0
    if (target._boneShellUntil && nowS < target._boneShellUntil) {
      mul *= (1 - (target._boneShellRed ?? 0))
    }
    // Rat Pack Armor — clustered swarm-rats take less damage per pack member.
    mul *= this.swarmDrMul(target, scene, gameState)
    // Golem Aegis — a nearby guardian golem softens damage to the allies it shields.
    mul *= this.aegisMul(target, scene, gameState)
    // Golem Warden Bastion — a room-wide damage-absorbing window (self + all allies).
    if (target._bastionUntil && nowS < target._bastionUntil) mul *= (target._bastionMul ?? 1)
    return mul
  },

  // Effective bonus damage from buff auras the attacker is currently standing
  // in (set as a flag by the aura's onTick). Read in CombatSystem.
  // (Stored on the minion as _rallyAtkMul / _rallyDefMul.)

  // Status predicates / queries.
  isSlowed(entity, now)  { return !!(entity?._slowUntil && entity._slowUntil > (now ?? 0)) },
  slowMult(entity, now)  { return (entity?._slowUntil && entity._slowUntil > (now ?? 0)) ? (entity._slowMult ?? 1) : 1 },
  armorShredOf(entity, now) { return (entity?._armorShredUntil && entity._armorShredUntil > (now ?? 0)) ? (entity._armorShred ?? 0) : 0 },

  // ── Ability handlers ──────────────────────────────────────────────────────

  // Dev VFX-Lab helper — fire ONE named ability (by its trigger) at a target so
  // its effect/VFX can be reviewed in isolation. Not used in normal play.
  fireAbility(scene, entity, target, gameState, ab) {
    if (!ab) return
    switch (ab.trigger) {
      case 'onTick':  this._applyTickAbility(entity, scene, gameState, null, ab); break
      case 'onDeath': this._applyDeathAbility(scene, entity, gameState, ab); break
      case 'passive': /* passives are queried, not fired — no-op */ break
      default:        this._applyHitAbility(scene, entity, target, 10, gameState, ab)
    }
  },

  // Per-hit status label with a built-in anti-spam throttle. These statuses
  // re-apply on EVERY hit, so without this the word (POISON / SLOWED / ROOTED /
  // BLEEDING / …) machine-guns into a column over the target. Keyed by
  // target + word so re-applies refresh silently; shows at most once per ~2.5s.
  _statusPopup(scene, target, label, color, yOff = 22, fontSize = null) {
    if (!scene || !Number.isFinite(target?.worldX)) return
    AbilityVfx.floatingText(scene, target.worldX, (target.worldY ?? 0) - yOff, label, {
      color,
      ...(fontSize ? { fontSize } : {}),
      throttleKey: `${target.instanceId ?? `${target.worldX},${target.worldY}`}:${label}`,
      throttleMs: 2500,
    })
  },

  _applyHitAbility(scene, attacker, target, damageDealt, gameState, ab) {
    const now = scene?.time?.now ?? 0
    switch (ab.type) {
      case 'dot':
        this._applyDot(target, scene, {
          type: ab.element ?? 'poison', dmgPerTick: ab.dmgPerTick ?? 1,
          intervalMs: ab.intervalMs ?? 1000, ticksLeft: ab.ticks ?? 3,
          source: attacker.instanceId,
        })
        if (ab.popup !== false) this._statusPopup(scene, target, ab.label ?? (ab.element === 'burn' ? 'BURN' : 'POISON'), ab.element === 'burn' ? '#ff7733' : '#88dd44')
        break
      case 'slow': {
        const next = now + (ab.durationMs ?? 1500)
        // Keep the strongest (lowest) slow + the latest expiry.
        if (!target._slowUntil || target._slowUntil < next) target._slowUntil = next
        target._slowMult = Math.min(target._slowMult ?? 1, ab.mult ?? 0.6)
        this._statusPopup(scene, target, ab.label ?? 'SLOWED', '#66ccee')
        if (Number.isFinite(target.worldX)) AbilityVfx.pulseRing(scene, target.worldX, target.worldY, { color: 0x66ccee, fromR: 6, toR: 16, alpha: 0.7, durationMs: 400 })
        break
      }
      case 'root':
        this._applyRoot(target, scene, ab.durationMs ?? 2000)
        this._statusPopup(scene, target, ab.label ?? 'ROOTED', '#559944')
        if (Number.isFinite(target.worldX)) AbilityVfx.pulseRing(scene, target.worldX, target.worldY, { color: 0x559944, fromR: 6, toR: 18, alpha: 0.8, durationMs: 500 })
        break
      // Plant ENTANGLE — vines cinch a HERO in place (root). Minions are never
      // rooted by it. Distinct (vine-cinch) VFX vs the generic `root` pulse-ring.
      case 'entangle':
        if (target.faction !== 'dungeon') {
          this._applyRoot(target, scene, ab.durationMs ?? 1800)
          if (Number.isFinite(target.worldX)) AbilityVfx.entangleFx?.(scene, target.worldX, target.worldY)
          this._statusPopup(scene, target, ab.label ?? 'ROOTED', '#7fb04a')
        }
        break
      // Mushroom HALLUCINATION — hallucinogenic spores DAZE a HERO so they whiff
      // their attacks (read in CombatSystem). Minions are immune.
      case 'daze':
        if (target.faction !== 'dungeon') this._applyDaze(target, scene, ab.durationMs ?? 3000, ab.missChance ?? 0.3)
        break
      case 'stagger':
        this._applyStagger(target, scene, ab.durationMs ?? 1000)
        this._statusPopup(scene, target, ab.label ?? 'STAGGERED', '#aa9988')
        break
      case 'lifesteal': {
        if (damageDealt <= 0) break
        const heal = Math.max(1, Math.floor(damageDealt * (ab.frac ?? 0.5)))
        const maxHp = attacker.resources.maxHp ?? 0
        const before = attacker.resources.hp
        attacker.resources.hp = Math.min(maxHp, attacker.resources.hp + heal)
        const restored = attacker.resources.hp - before
        // Vampire · BLOODGORGE — healing past full HP banks as a temporary
        // blood-shield (overheal → absorb), capped at a fraction of maxHP.
        const overheal = heal - restored
        if (ab.overheal && overheal > 0) this._gainBloodShield(attacker, overheal, ab.shieldFracMax ?? 0.6, now)
        // Lifesteal VFX — a crimson thread reels off the bitten hero into the
        // vampire's CENTRE. Minion sprites are setOrigin(0.5) on the container at
        // worldY, so worldY (no offset) IS the exact sprite centre.
        if (scene && Number.isFinite(target?.worldX) && Number.isFinite(attacker?.worldX)) {
          AbilityVfx.bloodThread?.(scene, target.worldX, target.worldY - 10, attacker.worldX, attacker.worldY, {})
        }
        if (restored > 0) AbilityVfx.floatingText(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 22, `+${restored}`, { color: '#ff5577' })
        break
      }
      case 'armorShred': {
        const next = now + (ab.durationMs ?? 4000)
        target._armorShred = Math.min((target._armorShred ?? 0) + (ab.amount ?? 2), ab.max ?? 8)
        target._armorShredUntil = Math.max(target._armorShredUntil ?? 0, next)
        this._statusPopup(scene, target, ab.label ?? 'ARMOR SHRED', '#cc8844')
        break
      }
      // Ghost · FEAR — psychic attacks frighten as they wound: drain the struck
      // adventurer's NERVE on top of HP. Pushed toward Breaking, an adv under
      // pressure routs via AISystem._checkMoraleBreak.
      case 'fear': {
        const dropped = this._applyFear(target, -(ab.amount ?? 9), scene)
        if (dropped != null) {
          AbilityVfx.fearStrikeFx?.(scene, attacker.worldX ?? 0, attacker.worldY ?? 0, target.worldX ?? 0, target.worldY ?? 0, {})
          this._statusPopup(scene, target, ab.label ?? 'FEAR', '#9fb6e8')
        }
        break
      }
      // Ghost · HAUNT (T2+) — the hit leaves a clinging haunt: a window during
      // which the adv's nerve bleeds + can't recover (tickGhost + NerveSystem),
      // they fight worse if already Spooked/Breaking (fearAtkMul in _computeDamage),
      // and their panic infects nearby party-mates (contagion, tickGhost).
      case 'haunt': {
        if (typeof target.nerve === 'number') {
          target._hauntedUntil       = now + (ab.durationMs ?? 5000)
          target._hauntNervePerSec   = ab.nervePerSec ?? 4
          target._hauntContagionR    = ab.contagionRadiusTiles ?? 3
          target._hauntContagionPS   = ab.contagionPerSec ?? 1.6
          target._hauntFumbleMul     = ab.fumbleMul ?? 0.72
          target._hauntSource        = attacker.instanceId
          if (scene && Number.isFinite(target.worldX)) AbilityVfx.hauntCloakFx?.(scene, target.worldX, target.worldY, { durationMs: ab.durationMs ?? 5000 })
          this._statusPopup(scene, target, ab.label ?? 'HAUNTED', '#7fa0d8', 34)
        }
        break
      }
      // Beholder GAZE · DOMINATION — Mesmerize: charm the struck hero. For a window
      // their swings redirect to their OWN nearest ally (reuses _possessedUntil +
      // maybeRedirectPossessedAttack, already wired in CombatSystem.tryAttack).
      case 'mesmerize': {
        if (this._canControl(target)) {
          target._possessedUntil = Math.max(target._possessedUntil ?? 0, now + (ab.durationMs ?? 3500))
          // the beholder's OWN eye blazes (renderer reads these → Glow flash on the sprite)
          attacker._gazeFlashUntil = now + 560; attacker._gazeFlashMs = 560; attacker._gazeFlashStr = 4
          if (scene && Number.isFinite(target.worldX) && Number.isFinite(attacker.worldX)) AbilityVfx.mesmerizeFx?.(scene, attacker.worldX, attacker.worldY, target.worldX, target.worldY, {})
          this._statusPopup(scene, target, ab.label ?? 'MESMERIZED', '#d28cff', 30)
        }
        break
      }
      // Gnoll BLOOD HUNT — Bleed: each hit stacks a long bleed (damage ticks in
      // tickGnoll = stacks × perStack); the stacks drive the trail + bloodhound + rupture.
      case 'bleed':
        this._bleed(scene, attacker, target, ab)
        break
      // Goblin PLUNDER — Pilfer: steal gold for the treasury on every hit.
      // Doubled if a Plunder King (plunderAura) shares the attacker's room.
      case 'stealGold':
        this._grantPlunder(scene, attacker, target, gameState, ab.amount ?? 2, 'goblin_plunder')
        break
      // Goblin Mark for Plunder — brand the hero so EVERY dungeon minion that
      // hits them also steals (handled in onHit via _tryMarkedSteal) plus a
      // slow gold-bleed off the brand (ticked in tickPlunderMarks).
      case 'markForPlunder':
        this._applyPlunderMark(scene, attacker, target, ab)
        break
      // Orc BLOODLUST — each landed hit stacks attack (decays out of combat).
      case 'bloodlust':
        this._addBloodlust(scene, attacker, ab, 1)
        break
      // Slime · PLAGUE — Infect: apply a (contagious) stacking poison DoT.
      case 'infect':
        this._infect(scene, attacker, target, ab)
        break
      // Rat · SWARM — the stat bonus is a passive query (swarmAtkMul/swarmDrMul);
      // the onHit just fires the pack-bite VFX, scaled by the live pack size.
      case 'swarm': {
        if (scene && Number.isFinite(target?.worldX)) {
          const count = this._swarmCount(gameState, attacker.assignedRoomId, scene)
          if (count > 1) AbilityVfx.swarmBiteFx?.(scene, target.worldX, target.worldY, { count: Math.min(8, count) })
        }
        break
      }
      // Zombie · CONTAGION BITE — infect the hero with rot. An infected hero that
      // dies to ANY source reanimates (onAdventurerDied reads `_rotInfectedUntil`).
      case 'rotBite': {
        if (!target) break
        target._rotInfectedUntil = Math.max(target._rotInfectedUntil ?? 0, now + (ab.durationMs ?? 8000))
        if (ab.dmgPerTick) this._applyDot(target, scene, { type: 'poison', dmgPerTick: ab.dmgPerTick, intervalMs: ab.intervalMs ?? 1500, ticksLeft: ab.ticks ?? 3, source: attacker.instanceId })
        if (scene && Number.isFinite(target.worldX)) {
          AbilityVfx.graveRotFx?.(scene, target.worldX, target.worldY - 4)
          AbilityVfx.floatingText(scene, target.worldX, (target.worldY ?? 0) - 22, ab.label ?? 'ROT', { color: '#9bd07a' })
        }
        break
      }
      default: break
    }
  },

  _applyDeathAbility(scene, minion, gameState, ab) {
    switch (ab.type) {
      case 'split':
        this._spawnSplitChildren(scene, minion, gameState, ab)
        break
      case 'aoeOnDeath':
        this._aoeOnDeath(scene, minion, gameState, ab)
        break
      case 'staggerCloud':
        this._staggerCloud(scene, minion, gameState, ab)
        break
      // Slime · CORROSIVE — leave a lingering caustic acid puddle where it dies.
      case 'acidPool':
        this._acidPool(scene, minion, gameState, ab)
        break
      default: break
    }
  },

  _applyTickAbility(minion, scene, gameState, dungeonGrid, ab) {
    switch (ab.type) {
      case 'healAura':      this._healAura(minion, scene, gameState, ab); break
      case 'reviveAlly':    this._reviveAlly(minion, scene, gameState, ab); break
      case 'buffAura':      this._buffAura(minion, scene, gameState, ab); break
      case 'contagionAura': this._contagionAura(minion, scene, gameState, ab); break
      case 'summon':        this._summonAdd(minion, scene, gameState, ab); break
      case 'hazardTrail':   this._hazardTrail(minion, scene, gameState, ab); break
      case 'novaBurst':     this._novaBurst(minion, scene, gameState, ab); break
      case 'massMark':      this._massMark(minion, scene, gameState, ab); break
      case 'undyingLegion': this._undyingLegion(minion, scene, gameState, ab); break
      case 'warCry':        this._warCry(minion, scene, gameState, ab); break
      case 'warpath':       this._warpath(minion, scene, gameState, ab); break
      case 'splitWhenHurt': this._splitWhenHurt(minion, scene, gameState, ab); break
      case 'mitosis':       this._mitosis(minion, scene, gameState, ab); break
      case 'contagion':     this._contagion(minion, scene, gameState, ab); break
      case 'outbreak':      this._outbreak(minion, scene, gameState, ab); break
      case 'acidFlood':     this._acidFlood(minion, scene, gameState, ab); break
      case 'bloodFeast':    this._bloodFeast(minion, scene, gameState, ab); break
      case 'verminTide':    this._verminTide(minion, scene, gameState, ab); break
      case 'massGrave':     this._massGrave(minion, scene, gameState, ab); break
      case 'burningAura':   this._burningAura(minion, scene, gameState, ab); break
      case 'inferno':       this._inferno(minion, scene, gameState, ab); break
      case 'bastion':       this._bastion(minion, scene, gameState, ab); break
      case 'dreadAura':     this._dreadAura(minion, scene, gameState, ab); break
      case 'pallOfDread':   this._pallOfDread(minion, scene, gameState, ab); break
      case 'massHypnosis':  this._massHypnosis(minion, scene, gameState, ab); break
      case 'tyrantGlare':   this._tyrantGlare(minion, scene, gameState, ab); break
      case 'bloodFrenzy':   this._bloodFrenzy(minion, scene, gameState, ab); break
      case 'regrow':        this._regrow(minion, scene, gameState, ab); break
      case 'thornburst':    this._thornburst(minion, scene, gameState, ab); break
      case 'soulHarvest':   this._soulHarvest(minion, scene, gameState, ab); break
      case 'soulStorm':     this._soulStorm(minion, scene, gameState, ab); break
      case 'vanishingWarband': this._vanishingWarband(minion, scene, gameState, ab); break
      case 'hellrift':      this._hellrift(minion, scene, gameState, ab); break
      case 'stranglethorn': this._stranglethorn(minion, scene, gameState, ab); break
      case 'sporePuff':     this._sporePuff(minion, scene, gameState, ab); break
      case 'sporeStorm':    this._sporeStorm(minion, scene, gameState, ab); break
      default: break
    }
  },

  isRooted(entity, now) {
    return !!(entity?._rootedUntil && entity._rootedUntil > (now ?? 0))
  },

  isStaggered(entity, now) {
    return !!(entity?._staggeredUntil && entity._staggeredUntil > (now ?? 0))
  },

  // Pass-3 Ghost Possession — if `attacker` is currently possessed and a
  // same-party ally is within attack range, return that ally as the redirect
  // target. Otherwise returns the original `target` unchanged. Called from
  // CombatSystem.tryAttack at the start of each swing.
  maybeRedirectPossessedAttack(attacker, target, gameState, scene) {
    if (!attacker?._possessedUntil) return target
    const now = scene?.time?.now ?? 0
    if (attacker._possessedUntil <= now) return target
    if (attacker.classId === undefined) return target   // only applies to advs
    const allies = (gameState?.adventurers?.active ?? []).filter(a =>
      a !== attacker &&
      a.partyId && a.partyId === attacker.partyId &&
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0
    )
    if (!allies.length) return target
    const reach = attacker.attackRange ?? 1
    let best = null
    let bestDist = Infinity
    for (const ally of allies) {
      const d = Math.hypot(ally.tileX - attacker.tileX, ally.tileY - attacker.tileY)
      if (d > reach + 0.01) continue
      if (d < bestDist) { best = ally; bestDist = d }
    }
    return best ?? target
  },

  // Called by MinionAISystem.respawnAll to clear any per-fight one-shot flags.
  resetOneShotsForNight(minion) {
    if (!minion) return
    // Engine-state resets only (DoTs, statuses, onTick accumulators, Thread-C
    // flags, oncePerFight re-arm). Legacy per-family flags were wiped.
    minion._dot = null
    minion._rootedUntil = 0
    minion._staggeredUntil = 0
    minion._slowUntil = 0; minion._slowMult = 1
    minion._armorShredUntil = 0; minion._armorShred = 0
    minion._enraged = false              // Thread C: clear wounded-state flags
    minion._fallingBack = false
    minion._abAccum = {}                 // reset onTick ability accumulators
    // Skeleton Reassemble — fresh body each dawn: re-arm its revives + clear
    // any mid-collapse state so a loaded/respawned skeleton starts whole.
    minion._reassembling   = false
    minion._reassembleAt   = null
    minion._reassemblesUsed = 0
    minion._reassembleFree = false
    minion._reassembleRapidUntil = 0
    minion._boneShellUntil = 0
    // Orc Bloodlust / Warpath — fresh fury each dawn; restore any base speed
    // captured during a Rampage so applyMinionScaling rescales from clean stats.
    minion._bloodlustStacks = 0
    if (minion._rampageBaseSpeed != null && minion.stats) minion.stats.speed = minion._rampageBaseSpeed
    minion._rampageUntil = 0; minion._rampageBaseSpeed = null; minion._rampageAtkMul = 1
    // Vampire Bloodgorge — fresh, unshielded each dawn.
    minion._bloodShield = 0; minion._bloodShieldAt = 0
    // Rat Vermin Tide — clear any frenzy + restore captured base speed.
    if (minion._swarmFrenzyBaseSpeed != null && minion.stats) minion.stats.speed = minion._swarmFrenzyBaseSpeed
    minion._swarmFrenzyUntil = 0; minion._swarmFrenzyBaseSpeed = null
    // Golem Warden Bastion — clear the DR window.
    minion._bastionUntil = 0; minion._bastionMul = 1
    // Lich Soul Harvest — souls are wave-scoped: empty the bank, drop any ally
    // soul-share window, and re-arm the phylactery for a fresh fight each dawn.
    minion._souls = 0
    minion._soulShareUntil = 0; minion._soulShareMul = 1
    minion._phylacteryUsed = 0; minion._phylacteryReviveAt = null
    // Lizardman Camouflage — fresh ambush each dawn: re-cloak + clear the reveal
    // timer + restore any captured hidden-speed so applyMinionScaling is clean.
    if (minion._camoBaseSpeed != null && minion.stats) minion.stats.speed = minion._camoBaseSpeed
    minion._camoBaseSpeed = null
    // A stalker that has cloaked before (or any future tick) re-hides for a fresh
    // dawn ambush; a never-ticked one gets cloaked by tickLizard's initial pass.
    if (minion._camoInit) { minion._camouflaged = true; minion._revealedAt = 0 }
    // Imp Blink — clear the scene-time blink cooldown + frenzy each dawn.
    minion._blinkAt = 0; minion._flickerAt = 0; minion._blinkFrenzyUntil = 0
    // re-arm oncePerFight ability gates (keys are `_abOnce_<type>`)
    for (const k of Object.keys(minion)) { if (k.startsWith('_abOnce_')) minion[k] = false }
  },

  // Initial flag setup at spawn time. Called from createMinion (entities/Minion.js).
  // (No per-family init flags after the wipe — kept as a hook for future kits.)
  initFlags(_minion, _typeDef) {},

  // ── Internals ────────────────────────────────────────────────────────────

  _applyDot(target, scene, dot) {
    target._dot = target._dot ?? []
    target._dot.push({ ...dot, _lastTickAt: scene?.time?.now ?? 0 })
  },

  _applyRoot(target, scene, durationMs) {
    const now = scene?.time?.now ?? 0
    const next = now + durationMs
    if ((target._rootedUntil ?? 0) < next) target._rootedUntil = next
  },

  _applyStagger(target, scene, durationMs) {
    const now = scene?.time?.now ?? 0
    const next = now + durationMs
    if ((target._staggeredUntil ?? 0) < next) target._staggeredUntil = next
  },

  // ── SLIME — SPLIT (the Splitter chain) ───────────────────────────────────
  // Slimelings carry `_isMiniSlime` (temporary — dawn-wiped, cap-exempt) + a
  // `_splitDepth` generation counter so cascading is bounded by the ability's
  // `maxDepth` (T1/T2 = 1: only originals split; T3+ = 2: children split once).
  // A per-room live-slimeling cap keeps the tide from exploding (perf + balance).
  SPLIT_ROOM_CAP: 12,

  _liveSplitChildren(gameState, roomId) {
    return (gameState?.minions ?? []).filter(m =>
      m._isMiniSlime && m.assignedRoomId === roomId &&
      m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0).length
  },

  // Bud `count` slimelings off `parent` (respecting the room cap). Returns the
  // number actually spawned. Each child's generation = parent's + 1.
  _budSlimelings(scene, parent, gameState, count, hpFrac, cap) {
    if (!gameState?.minions) return 0
    const roomCap = cap ?? this.SPLIT_ROOM_CAP
    const allow = Math.max(0, roomCap - this._liveSplitChildren(gameState, parent.assignedRoomId))
    if (allow <= 0) return 0
    const n = Math.min(count, allow)
    const px = parent.tileX, py = parent.tileY
    const offs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
    let spawned = 0
    for (const [dx, dy] of offs) {
      if (spawned >= n) break
      const child = this._cloneAsMiniSlime(parent, px + dx, py + dy, hpFrac ?? 0.45)
      child._splitDepth = (parent._splitDepth ?? 0) + 1
      gameState.minions.push(child)
      spawned += 1
    }
    if (scene && spawned > 0 && Number.isFinite(parent.worldX)) {
      AbilityVfx.slimeSplit?.(scene, parent.worldX, parent.worldY, { color: parent.color })
    }
    return spawned
  },

  // onDeath split — divide into `count` slimelings if the lineage hasn't hit maxDepth.
  _spawnSplitChildren(scene, parent, gameState, ab) {
    if ((parent._splitDepth ?? 0) >= (ab.maxDepth ?? 1)) return  // lineage exhausted
    this._budSlimelings(scene, parent, gameState, ab.count ?? 2, ab.childHpFrac ?? 0.45, ab.roomCap)
  },

  // onTick — Splitter Slime buds ONCE when first driven below `hpThreshold` ("splits
  // under pressure"). Originals only (clones don't chain-bud).
  _splitWhenHurt(minion, scene, gameState, ab) {
    if (minion._isMiniSlime || minion._hasBudded) return
    const frac = (minion.resources?.maxHp > 0) ? minion.resources.hp / minion.resources.maxHp : 1
    if (frac > (ab.hpThreshold ?? 0.5)) return
    minion._hasBudded = true
    this._budSlimelings(scene, minion, gameState, ab.count ?? 1, ab.childHpFrac ?? 0.35, ab.roomCap)
  },

  // onTick — The Endless: Mitosis Storm. Constantly buds a slimeling on a timer.
  // Originals only; the room cap keeps the stream bounded.
  _mitosis(minion, scene, gameState, ab) {
    if (minion._isMiniSlime) return
    this._budSlimelings(scene, minion, gameState, ab.count ?? 1, ab.childHpFrac ?? 0.3, ab.roomCap ?? this.SPLIT_ROOM_CAP)
  },

  // ── SLIME · PLAGUE — CONTAGION (infect + spread hero-to-hero) ─────────────
  // An adventurer is "infected" while `_infectUntil > now`; the damage rides the
  // normal poison-DoT system (tickEntity). Contagion spreads the infection from
  // infected heroes to nearby uninfected allies — a true epidemic.

  // Mark `target` infected + apply the poison DoT carrying the infection's params.
  _infectAdv(scene, target, dmg, iv, ticks, src, now) {
    this._applyDot(target, scene, { type: 'poison', dmgPerTick: dmg, intervalMs: iv, ticksLeft: ticks, source: src })
    target._infectUntil    = now + ticks * iv
    target._infectDmg      = dmg
    target._infectInterval = iv
    target._infectTicks    = ticks
    target._infectSrc      = src
  },

  // onHit — Toxic Slime's hit infects the struck hero (stacking poison + contagion seed).
  _infect(scene, attacker, target, ab) {
    if (!target) return
    const now = scene?.time?.now ?? 0
    this._infectAdv(scene, target, ab.dmgPerTick ?? 2, ab.intervalMs ?? 1500, ab.ticks ?? 4, attacker.instanceId, now)
    if (scene && Number.isFinite(target.worldX)) {
      AbilityVfx.plagueBurst?.(scene, target.worldX, (target.worldY ?? 0) - 10, {})
      AbilityVfx.floatingText(scene, target.worldX, (target.worldY ?? 0) - 24, ab.label ?? 'INFECTED', { color: '#9fe04a', fontSize: '11px' })
    }
  },

  // onTick — Plague/Pestilent Slime: the plague JUMPS from infected heroes to nearby
  // uninfected allies in the room (capped per tick). T3 also drops a brief toxic trail
  // under infected heroes.
  _contagion(slime, scene, gameState, ab) {
    const home = this._roomOf(gameState, slime.assignedRoomId)
    if (!home) return
    const now = scene?.time?.now ?? 0
    const radius = ab.spreadRadiusTiles ?? 3
    const advs = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    const infected = advs.filter(a => (a._infectUntil ?? 0) > now)
    if (!infected.length) return
    let spreads = 0
    const maxSpread = ab.maxSpread ?? 3
    for (const src of infected) {
      // T3 toxic trail — a brief poison hazard under the infected hero.
      if (ab.trail && gameState.dungeon) {
        gameState.dungeon.hazards = gameState.dungeon.hazards ?? []
        gameState.dungeon.hazards.push({ tileX: src.tileX, tileY: src.tileY, element: 'poison', dmg: ab.trailDmg ?? 1, radius: 0.6, expiresAt: now + (ab.trailMs ?? 2000), color: 0x88cc33, sourceId: slime.instanceId })
      }
      if (spreads >= maxSpread) continue
      for (const tgt of advs) {
        if (spreads >= maxSpread) break
        if ((tgt._infectUntil ?? 0) > now) continue   // already infected (incl. just now)
        if (Math.hypot(tgt.tileX - src.tileX, tgt.tileY - src.tileY) > radius + 0.01) continue
        this._infectAdv(scene, tgt, src._infectDmg ?? 2, src._infectInterval ?? 1500, src._infectTicks ?? 4, src._infectSrc ?? src.instanceId, now)
        if (scene && Number.isFinite(src.worldX) && Number.isFinite(tgt.worldX)) AbilityVfx.contagionTendril?.(scene, src.worldX, src.worldY - 8, tgt.worldX, tgt.worldY - 8, {})
        spreads += 1
      }
    }
  },

  // onTick — Pandemic ULT: Outbreak. Infects EVERY hero in the room at once + a cloud.
  _outbreak(slime, scene, gameState, ab) {
    const home = this._roomOf(gameState, slime.assignedRoomId)
    if (!home) return
    const now = scene?.time?.now ?? 0
    const advs = this._liveAdvs(gameState).filter(a => this._onFloorInRoom(scene, a.tileX, a.tileY, home))
    let n = 0
    for (const adv of advs) {
      // dot* fields — `intervalMs` is the onTick FIRING cadence, not the DoT period.
      this._infectAdv(scene, adv, ab.dotDmg ?? 3, ab.dotIntervalMs ?? 1200, ab.dotTicks ?? 5, slime.instanceId, now)
      n += 1
    }
    if (scene && Number.isFinite(slime.worldX)) {
      AbilityVfx.plagueCloud?.(scene, slime.worldX, slime.worldY, { radius: ab.radius ?? 110 })
      if (n > 0) AbilityVfx.floatingText(scene, slime.worldX, (slime.worldY ?? 0) - 32, ab.label ?? 'OUTBREAK', { color: '#b06ac0', fontSize: '13px' })
    }
  },

  _cloneAsMiniSlime(parent, tx, ty, hpFrac = 0.5) {
    const TS = 32
    const halfHp  = Math.max(3, Math.floor((parent.resources?.maxHp ?? 12) * hpFrac))
    const halfAtk = Math.max(1, Math.floor((parent.stats?.attack ?? 4) * Math.max(0.5, hpFrac + 0.1)))
    return {
      instanceId:    `min_split_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      definitionId:  parent.definitionId,
      name:          null,
      color:         parent.color,
      sigil:         parent.sigil,
      tileX:   tx,
      tileY:   ty,
      worldX:  tx * TS + TS / 2,
      worldY:  ty * TS + TS / 2,
      homeTileX: tx,
      homeTileY: ty,
      assignedRoomId: parent.assignedRoomId,
      class:          'garrison',          // room-bound, not counted toward roster cap
      behaviorType:   parent.behaviorType,
      tags:           [...(parent.tags ?? [])],
      damageType:     parent.damageType,
      attackRange:    parent.attackRange ?? 1,
      faction:        'dungeon',
      factionExpiresOn: null,
      raisedByAdvId:  null,
      tamedByAdvId:   null,
      isMiniBoss:     false,
      stats: {
        hp:      halfHp,
        attack:  halfAtk,
        defense: parent.stats?.defense ?? 0,
        speed:   parent.stats?.speed ?? 1.0,
        abilities: [],
      },
      resources: { hp: halfHp, maxHp: halfHp },
      level: 1, xp: 0,
      evolutionHistory: [], killHistory: [],
      lifetime: { kills: 0, damageDealt: 0 },
      equippedGear: [], hasBounty: false, bountyKillCount: 0,
      aiState: 'idle',
      currentTargetId: null,
      lastAttackAt: 0,
      deathDay: null,
      path: null, pathIndex: 0,
      bossLevel: parent.bossLevel ?? 1,
      _baseMaxHp: halfHp,
      _baseAtk:   halfAtk,
      _isMiniSlime: true,
    }
  },

  // Imp Self-Combust — fire AoE on death.
  _impSelfCombust(scene, imp, gameState) {
    if (!gameState?.adventurers?.active) return
    let hits = 0
    for (const adv of gameState.adventurers.active) {
      if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const d = Math.hypot(adv.tileX - imp.tileX, adv.tileY - imp.tileY)
      if (d > IMP_BLAST_RADIUS_TILES + 0.01) continue
      // Light Party / Shadow Monarch floor — defense-in-depth so an imp blast
      // can't drop them to 0 before the boss room (AISystem._kill catches it
      // anyway since we never stamp 'boss' here, but flooring keeps the bar honest).
      const _impFl = (adv._lightParty || adv._shadowMonarch)
        ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      adv.resources.hp = Math.max(_impFl, adv.resources.hp - IMP_BLAST_DAMAGE)
      hits += 1
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${IMP_BLAST_DAMAGE}`, { color: '#ff6633' })
    }
    if (scene) {
      AbilityVfx.pulseRing(scene, imp.worldX ?? 0, imp.worldY ?? 0, {
        color: 0xff6633, fromR: 8, toR: IMP_BLAST_RADIUS_TILES * 32, durationMs: 350, alpha: 0.85,
      })
      AbilityVfx.particleBurst(scene, imp.worldX ?? 0, imp.worldY ?? 0, {
        color: 0xff6633, count: 14, durationMs: 600, speed: 110,
      })
      if (hits > 0) AbilityVfx.floatingText(scene, imp.worldX ?? 0, (imp.worldY ?? 0) - 22, 'BOOM', { color: '#ff8844' })
    }
  },

  // ── Pass-3 behavior dispatcher (per-tick) ───────────────────────────────
  // Called from MinionAISystem._tickMinion before the idle wander block so
  // we can override _patrolTarget, set visibility flags, fire teleports, etc.

  // Per-minion BASE-BEHAVIOR quirks (camouflage / ceiling-sleep / teleport /
  // march / demon-sense / loot-scavenger) were WIPED for the redesign — they
  // made minions "too complicated" (user). Minions now use only the engine's
  // standard movement (behaviorType guard/patrol/roam/ambush) + their data
  // abilities. Kept as a no-op hook so MinionAISystem's per-tick call is intact.
  tickBehavior(_minion, _scene, _gameState, _dungeonGrid, _delta) {},

  // Visibility filter for _pickTarget. Nothing hides post-wipe, so always
  // visible — kept so the MinionAISystem callsite needs no change.
  isMinionHidden(minion) {
    return !!minion?._hidden
  },

  // Wire global EventBus listeners. Called from Game.create after gameState/
  // dungeonGrid exist. (Previously hosted Mimic Migrate; that handler was
  // removed 2026-05-22 when mimics became stationary chest traps — see
  // AISystem._springMimic for the new mechanic. attach/detach are kept as
  // stubs so future per-system hooks can land here without re-wiring
  // MinionAISystem's create/destroy.)
  attach(_scene, _gameState, _dungeonGrid) {
    // Cache the live scene + grid so the geometry helpers below (floor-tile /
    // room-containment gating) can resolve tiles without threading the grid
    // through every handler signature. Refreshed each create().
    this._scene       = _scene ?? this._scene ?? null
    this._gameState   = _gameState ?? this._gameState ?? null
    this._dungeonGrid = _dungeonGrid ?? this._dungeonGrid ?? null
    if (this._attached) return
    this._attached = true
  },

  detach() {
    this._scene = null; this._gameState = null; this._dungeonGrid = null
    if (!this._attached) return
    this._attached = false
  },

  // ── Data-ability handler internals (Thread E/D/B/Widen) ──────────────────

  _roomOf(gameState, id) {
    return (gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === id) ?? null
  },
  _inRoom(x, y, room) {
    return room && x >= room.gridX && x < room.gridX + room.width &&
           y >= room.gridY && y < room.gridY + room.height
  },
  _liveAdvs(gameState) {
    return (gameState?.adventurers?.active ?? []).filter(a =>
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
  },

  // ── Floor / room containment helpers ──────────────────────────────────────
  // `_inRoom` is a pure bounding-box test, and a room's rect INCLUDES its wall
  // ring + carved door tiles. So an entity standing in a doorway (mid-passage)
  // or a wall is "in the bbox" but NOT on the room floor. These helpers add the
  // floor-tile check so AoE abilities can't strike someone transiting a door
  // and flood VFX can be clamped to the actual floor. Degrade to bbox-only when
  // no grid is available (headless per-family checks that stub the scene).
  _grid(scene) {
    const g = this._dungeonGrid ?? scene?.dungeonGrid ?? this._scene?.dungeonGrid ?? null
    if (!g || typeof g.getTileType !== 'function') return null
    // Reject the headless makeScene() Proxy's chainable stub (an unset scene
    // property resolves to a function that returns a chainable, not a tile id).
    // A real DungeonGrid returns TILE.VOID (a number) for out-of-bounds coords.
    try { if (typeof g.getTileType(-1, -1) !== 'number') return null } catch (e) { return null }
    return g
  },
  // Is (x,y) a spot a living entity can be FOUGHT on — i.e. NOT a doorway it's
  // mid-transit through? Living entities only ever stand on floor or door tiles
  // (walls/void aren't walkable), so excluding DOOR is the whole job. Narrow on
  // purpose: a mismatched/headless grid that reports wall/void for these coords
  // stays permissive rather than wrongly suppressing the hit.
  _onFloor(scene, x, y) {
    const g = this._grid(scene)
    if (!g) return true
    const t = g.getTileType(Math.floor(x), Math.floor(y))
    return t !== TILE.DOOR && t !== 'door'
  },
  _onFloorInRoom(scene, x, y, room) {
    return this._inRoom(x, y, room) && this._onFloor(scene, x, y)
  },
  // Any live adventurer standing on a FLOOR tile inside `room`? Used to arm
  // offensive onTick abilities only when there's a real target (anti-spam).
  _enemyInRoomOnFloor(scene, gameState, room) {
    if (!room) return false
    return this._liveAdvs(gameState).some(a => this._onFloorInRoom(scene, a.tileX, a.tileY, room))
  },
  // The room's FLOOR bounding rect in WORLD coords (excludes the wall ring +
  // doors), so flood/ground VFX can be clamped to it. Derives the tight floor
  // extent from the grid when present; otherwise insets the room rect by the
  // wall thickness.
  _roomFloorRectWorld(scene, room) {
    const TS = 32
    if (!room) return null
    const g = this._grid(scene)
    if (g?.getTileType) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let dy = 0; dy < (room.height ?? 0); dy++) {
        for (let dx = 0; dx < (room.width ?? 0); dx++) {
          const tx = room.gridX + dx, ty = room.gridY + dy
          if (!this._isFloorTile(g.getTileType(tx, ty))) continue
          if (tx < minX) minX = tx
          if (ty < minY) minY = ty
          if (tx > maxX) maxX = tx
          if (ty > maxY) maxY = ty
        }
      }
      if (minX <= maxX) {
        return { x: minX * TS, y: minY * TS, w: (maxX - minX + 1) * TS, h: (maxY - minY + 1) * TS }
      }
    }
    const WT = 2   // Balance.WALL_THICKNESS — floor = room rect inset one wall ring per side
    const fx = (room.gridX ?? 0) + WT, fy = (room.gridY ?? 0) + WT
    const fw = Math.max(1, (room.width ?? 6) - 2 * WT), fh = Math.max(1, (room.height ?? 6) - 2 * WT)
    return { x: fx * TS, y: fy * TS, w: fw * TS, h: fh * TS }
  },

  // Offensive onTick ability types that are pointless / wasteful (and read as
  // "spam") when no hero is in the room — gated in tickAbilities so they hold
  // their cooldown charged and fire the instant a hero arrives. Support /
  // maintenance auras (healAura, reviveAlly, buffAura, regrow, summon,
  // soulHarvest, mitosis, splitWhenHurt) are NOT listed: their handlers already
  // no-op when there's nothing to do, and some are useful between fights.
  NEEDS_ENEMY_TICK: new Set([
    'pallOfDread', 'dreadAura', 'massHypnosis', 'tyrantGlare', 'bloodFrenzy',
    'thornburst', 'soulStorm', 'hellrift', 'stranglethorn', 'sporePuff',
    'sporeStorm', 'burningAura', 'inferno', 'novaBurst', 'acidFlood',
    'contagion', 'outbreak', 'contagionAura', 'massMark', 'bloodFeast',
    'verminTide', 'vanishingWarband', 'undyingLegion', 'warCry', 'warpath',
    'bastion',
  ]),
  // Should this onTick ability fire right now? Offensive ticks need a hero in
  // the room; Mass Grave also fires when there are un-raised corpses to raise.
  _tickAbilityArmed(minion, scene, gameState, ab) {
    const type = ab.type
    if (type === 'massGrave') {
      const home = this._roomOf(gameState, minion.assignedRoomId)
      if (!home) return false
      if (this._enemyInRoomOnFloor(scene, gameState, home)) return true
      const grave = gameState?.adventurers?.graveyard ?? []
      return grave.some(g => !g._massRaised && this._inRoom(g.tileX, g.tileY, home))
    }
    if (!this.NEEDS_ENEMY_TICK.has(type)) return true
    // The "vice versa": a caster mid-transit through a doorway doesn't fight —
    // hold the ability until it has stepped back onto room floor.
    if (!this._onFloor(scene, minion.tileX, minion.tileY)) return false
    const home = this._roomOf(gameState, minion.assignedRoomId)
    return this._enemyInRoomOnFloor(scene, gameState, home)
  },

  // Generalised death AoE (imp Self-Combust + any future on-death blast).
  _aoeOnDeath(scene, minion, gameState, ab) {
    const radius = ab.radiusTiles ?? 1.5
    const dmg    = ab.dmg ?? 8
    const color  = ab.color ?? 0xff6633
    // Same-room/floor gate — a death blast must not reach through a doorway into
    // the next room. Use the room the minion actually died in (it may have been
    // roaming), falling back to its assigned room, then to radius-only headless.
    const home = this._grid(scene)?.getRoomAtTile?.(Math.floor(minion.tileX), Math.floor(minion.tileY))
              ?? this._roomOf(gameState, minion.assignedRoomId)
    let hits = 0
    for (const adv of this._liveAdvs(gameState)) {
      if (home && !this._onFloorInRoom(scene, adv.tileX, adv.tileY, home)) continue
      if (Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY) > radius + 0.01) continue
      const fl = (adv._lightParty || adv._shadowMonarch) ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      adv.resources.hp = Math.max(fl, adv.resources.hp - dmg)
      hits += 1
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${dmg}`, { color: '#ff6633' })
    }
    if (scene) {
      AbilityVfx.pulseRing(scene, minion.worldX ?? 0, minion.worldY ?? 0, { color, fromR: 8, toR: radius * 32, durationMs: 350, alpha: 0.85 })
      AbilityVfx.particleBurst(scene, minion.worldX ?? 0, minion.worldY ?? 0, { color, count: 14, durationMs: 600, speed: 110 })
      if (hits > 0) AbilityVfx.floatingText(scene, minion.worldX ?? 0, (minion.worldY ?? 0) - 22, ab.label ?? 'BOOM', { color: '#ff8844' })
    }
  },

  // Generalised death stagger cloud (mushroom Confusion Spores).
  _staggerCloud(scene, minion, gameState, ab) {
    const radius = ab.radiusTiles ?? SPORE_RADIUS_TILES
    const home = this._grid(scene)?.getRoomAtTile?.(Math.floor(minion.tileX), Math.floor(minion.tileY))
              ?? this._roomOf(gameState, minion.assignedRoomId)
    for (const adv of this._liveAdvs(gameState)) {
      if (home && !this._onFloorInRoom(scene, adv.tileX, adv.tileY, home)) continue
      if (Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY) > radius + 0.01) continue
      this._applyStagger(adv, scene, ab.durationMs ?? SPORE_STAGGER_MS)
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 22, ab.label ?? 'CONFUSED', { color: '#cc88ff' })
    }
    if (scene) {
      AbilityVfx.pulseRing(scene, minion.worldX ?? 0, minion.worldY ?? 0, { color: 0x9966cc, fromR: 8, toR: radius * 32, durationMs: 600, alpha: 0.7 })
      AbilityVfx.particleBurst(scene, minion.worldX ?? 0, minion.worldY ?? 0, { color: 0x9966cc, count: 12, durationMs: 800, speed: 50 })
    }
  },

  // Heal Undead aura — generalised from the lich1-only version so ALL lich
  // tiers (and any future support minion) heal the most-wounded same-room ally
  // carrying `tag`. Interval gating is handled by tickAbilities.
  _healAura(lich, scene, gameState, ab) {
    const home = this._roomOf(gameState, lich.assignedRoomId)
    if (!home) return
    const tag = ab.tag ?? 'undead'
    let best = null, bestMissing = 0
    for (const m of (gameState.minions ?? [])) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction !== 'dungeon') continue
      if (!Array.isArray(m.tags) || !m.tags.includes(tag)) continue
      if (!this._inRoom(m.tileX, m.tileY, home)) continue
      const missing = (m.resources?.maxHp ?? 0) - (m.resources?.hp ?? 0)
      if (missing > bestMissing) { best = m; bestMissing = missing }
    }
    if (!best) return
    const before = best.resources.hp
    best.resources.hp = Math.min(best.resources.maxHp ?? 0, best.resources.hp + (ab.amount ?? 6))
    const restored = best.resources.hp - before
    if (restored > 0) {
      EventBus.emit('ALLY_HEALED', { sourceId: lich.instanceId, targetId: best.instanceId, amount: restored, roomId: lich.assignedRoomId })
      if (scene && Number.isFinite(best.worldX)) {
        AbilityVfx.floatingText(scene, best.worldX, best.worldY - 22, `+${restored}`, { color: '#ffe27a' })
        AbilityVfx.pulseRing(scene, best.worldX, best.worldY, { color: 0xffe27a, fromR: 6, toR: 16, alpha: 0.7, durationMs: 420 })
      }
    }
  },

  // Raise Dead — Elder Lich periodically reanimates ONE fallen same-room ally
  // (tagged) back to a fraction of HP. Capped by interval; the revived minion
  // is flagged _raisedAdd so it's swept at dawn (no permanent army growth).
  _reviveAlly(lich, scene, gameState, ab) {
    const home = this._roomOf(gameState, lich.assignedRoomId)
    if (!home) return
    const tag = ab.tag ?? 'undead'
    const fallen = (gameState.minions ?? []).find(m =>
      m !== lich && m.aiState === 'dead' &&
      m.faction === 'dungeon' && m.assignedRoomId === lich.assignedRoomId &&
      Array.isArray(m.tags) && m.tags.includes(tag) && !m._raisedAdd)
    if (!fallen) return
    const max = fallen.resources?.maxHp ?? 1
    fallen.resources.hp = Math.max(1, Math.floor(max * (ab.frac ?? 0.5)))
    fallen.aiState = 'idle'
    fallen.deathDay = null
    fallen._raisedAdd = true
    fallen.tileX = lich.tileX; fallen.tileY = lich.tileY
    fallen.worldX = lich.worldX; fallen.worldY = lich.worldY
    EventBus.emit('MINION_RESPAWNED', { minionId: fallen.instanceId, sourceId: lich.instanceId })
    if (scene && Number.isFinite(fallen.worldX)) {
      AbilityVfx.floatingText(scene, fallen.worldX, fallen.worldY - 22, ab.label ?? 'RISE', { color: '#bb99ff' })
      AbilityVfx.pulseRing(scene, fallen.worldX, fallen.worldY, { color: 0xbb99ff, fromR: 6, toR: 24, alpha: 0.8, durationMs: 600 })
    }
  },

  // Rally Aura — Commander buffs nearby dungeon minions' ATK/DEF. Stamps a
  // short-lived flag (expiry slightly past the interval) so the buff persists
  // between ticks but DROPS shortly after the commander dies/leaves the room.
  _buffAura(commander, scene, gameState, ab) {
    const home = this._roomOf(gameState, commander.assignedRoomId)
    if (!home) return
    const now = scene?.time?.now ?? 0
    const until = now + (ab.intervalMs ?? 1000) * 1.6
    let buffed = 0
    for (const m of (gameState.minions ?? [])) {
      if (m === commander) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction !== 'dungeon') continue
      if (!this._inRoom(m.tileX, m.tileY, home)) continue
      m._rallyUntil  = until
      m._rallyAtkMul = ab.atkMul ?? 1.2
      m._rallyDefMul = ab.defMul ?? 1.0
      buffed += 1
    }
    if (scene && buffed > 0 && Number.isFinite(commander.worldX)) {
      AbilityVfx.pulseRing(scene, commander.worldX, commander.worldY, { color: 0xffcc44, fromR: 8, toR: 40, alpha: 0.45, durationMs: 620 })
    }
  },

  // Contagion Aura — Crypt Lord: same-room adventurers take periodic poison.
  _contagionAura(minion, scene, gameState, ab) {
    const home = this._roomOf(gameState, minion.assignedRoomId)
    if (!home) return
    const radius = ab.radiusTiles ?? 99   // default = whole room
    let hit = false
    for (const adv of this._liveAdvs(gameState)) {
      if (!this._onFloorInRoom(scene, adv.tileX, adv.tileY, home)) continue
      if (radius < 99 && Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY) > radius + 0.01) continue
      const dmg = ab.dmgPerTick ?? 2
      const fl = (adv._lightParty || adv._shadowMonarch) ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      adv.resources.hp = Math.max(fl, adv.resources.hp - dmg)
      adv._lastHitBy = minion.instanceId
      adv._lastHitType = ab.element ?? 'poison'
      hit = true
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${dmg}`, { color: '#88dd44' })
    }
    if (scene && hit && Number.isFinite(minion.worldX)) {
      AbilityVfx.pulseRing(scene, minion.worldX, minion.worldY, { color: 0x77aa33, fromR: 8, toR: 30, alpha: 0.35, durationMs: 700 })
    }
  },

  // Nova Burst — the generic miniboss "ult": a periodic, telegraphed AoE that
  // hits every adventurer in range (whole room by default) for `dmg`, applies an
  // optional `status` (burn/poison/stagger/root/slow/nerve), and can drain a
  // fraction of the total damage back to the caster (`lifestealFrac`). Used to
  // give final/miniboss forms a dramatic signature beat on top of their
  // inherited family passive. Fires nothing (no VFX) when no one's in range.
  _novaBurst(minion, scene, gameState, ab) {
    const home = this._roomOf(gameState, minion.assignedRoomId)
    const radius = ab.radiusTiles   // undefined → whole room
    const targets = []
    for (const adv of this._liveAdvs(gameState)) {
      // Always confine to the caster's room + floor (no blasting through a
      // doorway into the next room); `radius`, when set, narrows it further.
      if (home && !this._onFloorInRoom(scene, adv.tileX, adv.tileY, home)) continue
      if (radius != null && Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY) > radius + 0.01) continue
      targets.push(adv)
    }
    if (!targets.length) return
    const now = scene?.time?.now ?? 0
    const dmg = ab.dmg ?? 8
    let total = 0
    for (const adv of targets) {
      const fl = (adv._lightParty || adv._shadowMonarch) ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      const before = adv.resources.hp
      adv.resources.hp = Math.max(fl, adv.resources.hp - dmg)
      total += before - adv.resources.hp
      adv._lastHitBy = minion.instanceId
      adv._lastHitType = ab.element ?? 'physical'
      switch (ab.status) {
        case 'burn':    this._applyDot(adv, scene, { type: 'burn',   dmgPerTick: 2, intervalMs: 1000, ticksLeft: 3, source: minion.instanceId }); break
        case 'poison':  this._applyDot(adv, scene, { type: 'poison', dmgPerTick: 2, intervalMs: 1000, ticksLeft: 4, source: minion.instanceId }); break
        case 'stagger': this._applyStagger(adv, scene, ab.statusMs ?? 1200); break
        case 'root':    this._applyRoot(adv, scene, ab.statusMs ?? 1500); break
        case 'slow': {
          const next = now + (ab.statusMs ?? 1800)
          if (!adv._slowUntil || adv._slowUntil < next) adv._slowUntil = next
          adv._slowMult = Math.min(adv._slowMult ?? 1, ab.slowMult ?? 0.6)
          break
        }
        case 'nerve':   if (typeof adv.nerve === 'number') adv.nerve = Math.max(0, adv.nerve - (ab.nerveAmt ?? 14)); break
        default: break
      }
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${dmg}`, { color: '#ffffff' })
    }
    if (ab.lifestealFrac && total > 0) {
      const heal = Math.max(1, Math.floor(total * ab.lifestealFrac))
      const before = minion.resources.hp
      minion.resources.hp = Math.min(minion.resources.maxHp ?? 0, minion.resources.hp + heal)
      const restored = minion.resources.hp - before
      if (restored > 0 && scene) AbilityVfx.floatingText(scene, minion.worldX ?? 0, (minion.worldY ?? 0) - 24, `+${restored}`, { color: '#ff77aa' })
    }
    if (scene && Number.isFinite(minion.worldX)) {
      const col = (typeof ab.color === 'number') ? ab.color : 0xffffff
      AbilityVfx.shockwaveFx(scene, minion.worldX, minion.worldY, { color: col, fromR: 10, toR: (radius ? radius * 32 : 130), durationMs: 620, rings: 2 })
      if (ab.label) AbilityVfx.floatingText(scene, minion.worldX, minion.worldY - 28, ab.label, { color: '#' + col.toString(16).padStart(6, '0') })
    }
  },

  // Summon — Bone Totem / Hive Node spawns a weak, capped add. Adds carry
  // `_summonedBy` + `_isSummonedAdd` so the cap can count them and the dawn
  // respawn sweep can wipe them (no permanent growth).
  _summonAdd(minion, scene, gameState, ab) {
    const cap = ab.cap ?? 3
    const alive = (gameState.minions ?? []).filter(m =>
      m._summonedBy === minion.instanceId && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0).length
    if (alive >= cap) return
    const defs = scene?.cache?.json?.get?.('minionTypes') ?? []
    const addDef = defs.find(d => d.id === (ab.addId ?? 'swarmling'))
    if (!addDef) return
    const tile = { x: minion.tileX, y: minion.tileY }
    const add = this._makeAdd(addDef, tile, minion.assignedRoomId, minion)
    gameState.minions.push(add)
    if (scene && Number.isFinite(minion.worldX)) {
      AbilityVfx.particleBurst(scene, minion.worldX, minion.worldY, { color: add.color ?? 0xccccaa, count: 8, durationMs: 450, speed: 60 })
      AbilityVfx.floatingText(scene, minion.worldX, minion.worldY - 22, ab.label ?? 'SUMMON', { color: '#ddccaa' })
    }
  },

  _makeAdd(typeDef, tile, roomId, summoner) {
    const TS = 32
    const bs = typeDef.baseStats ?? {}
    const hp = bs.hp ?? 10
    let color = typeDef.color
    if (typeof color === 'string') color = parseInt(color.replace(/^0x/i, ''), 16) || 0xccccaa
    return {
      instanceId: `min_add_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      definitionId: typeDef.id, name: null, color, sigil: (typeDef.id[0] ?? 'S').toUpperCase(),
      tileX: tile.x, tileY: tile.y, worldX: tile.x * TS + TS / 2, worldY: tile.y * TS + TS / 2,
      homeTileX: tile.x, homeTileY: tile.y, assignedRoomId: roomId,
      class: 'garrison', behaviorType: typeDef.behaviorType ?? 'guard',
      tags: [...(typeDef.tags ?? [])], damageType: bs.damageType ?? 'physical', attackRange: bs.attackRange ?? 1,
      faction: 'dungeon', factionExpiresOn: null, raisedByAdvId: null, tamedByAdvId: null, isMiniBoss: false,
      stats: { hp, attack: bs.attack ?? 3, defense: bs.defense ?? 0, speed: bs.speed ?? 1.0, abilities: [] },
      resources: { hp, maxHp: hp }, level: 1, xp: 0, evolutionHistory: [], killHistory: [],
      lifetime: { kills: 0, damageDealt: 0 }, equippedGear: [], hasBounty: false, bountyKillCount: 0,
      aiState: 'idle', currentTargetId: null, lastAttackAt: 0, deathDay: null, path: null, pathIndex: 0,
      bossLevel: summoner.bossLevel ?? 1, _baseMaxHp: hp, _baseAtk: bs.attack ?? 3,
      _summonedBy: summoner.instanceId, _isSummonedAdd: true,
    }
  },

  // Acid puddles persist for the whole raid (cleared at day-end in Game._onDayEnded)
  // rather than fading on a timer. A long finite expiry (not Infinity → JSON-safe)
  // means HazardRenderer never enters its fade-out window, so they stay full-strength.
  ACID_PERSIST_MS: 3_600_000,
  // Cap acid zones so a long-roaming Caustic Slime can't carpet the whole room
  // (HazardRenderer + tickHazards both iterate every zone each frame). Oldest acid
  // puddles dissolve first once the cap is hit.
  ACID_ZONE_CAP: 60,
  _pushAcidHazard(gameState, h) {
    const hz = (gameState.dungeon.hazards = gameState.dungeon.hazards ?? [])
    hz.push(h)
    let over = hz.filter(z => z.element === 'acid').length - this.ACID_ZONE_CAP
    if (over > 0) for (let i = 0; i < hz.length && over > 0; i++) { if (hz[i].element === 'acid') { hz[i].expiresAt = 0; over-- } }
  },

  // Hazard Trail — a minion drops a lingering damage zone behind it as it moves.
  // Zones live on gameState.dungeon.hazards and are ticked/expired by tickHazards
  // (called once per frame from MinionAISystem.update). Acid trails persist until
  // day-end; other elements (fire/poison) keep their timed zoneMs fade.
  _hazardTrail(minion, scene, gameState, ab) {
    if (!gameState.dungeon) return
    // Only drop when the minion has actually moved to a new tile.
    if (minion._lastHazardTile && minion._lastHazardTile.x === minion.tileX && minion._lastHazardTile.y === minion.tileY) return
    minion._lastHazardTile = { x: minion.tileX, y: minion.tileY }
    const now = scene?.time?.now ?? 0
    gameState.dungeon.hazards = gameState.dungeon.hazards ?? []
    const isAcid = ab.element === 'acid'
    const radius = ab.radiusTiles ?? (isAcid ? 0.9 : 0.7)
    const h = {
      tileX: minion.tileX, tileY: minion.tileY, element: ab.element ?? 'fire',
      dmg: ab.dmg ?? 2, radius, expiresAt: now + (isAcid ? this.ACID_PERSIST_MS : (ab.zoneMs ?? 4000)),
      color: ab.color ?? (isAcid ? 0xaadd33 : 0xff7733), sourceId: minion.instanceId,
      armorShred: ab.armorShred, slow: ab.slow,   // Corrosive Ooze: melt armor + slow
    }
    if (isAcid) this._pushAcidHazard(gameState, h); else gameState.dungeon.hazards.push(h)
    if (isAcid && scene && Number.isFinite(minion.worldX)) AbilityVfx.acidSplash?.(scene, minion.worldX, minion.worldY, { color: 0xaadd33, radiusTiles: radius })
  },

  // Slime · CORROSIVE — drop a lingering acid puddle on death. Reuses the hazard-zone
  // system; tickHazards damages + (optionally) melts armor / slows. Persists to day-end.
  _acidPool(scene, minion, gameState, ab) {
    if (!gameState?.dungeon) return
    const now = scene?.time?.now ?? 0
    const radius = ab.radiusTiles ?? 0.9
    this._pushAcidHazard(gameState, {
      tileX: minion.tileX, tileY: minion.tileY, element: 'acid',
      dmg: ab.dmg ?? 3, radius, expiresAt: now + this.ACID_PERSIST_MS,
      color: 0xaadd33, sourceId: minion.instanceId, armorShred: ab.armorShred, slow: ab.slow,
    })
    if (scene && Number.isFinite(minion.worldX)) AbilityVfx.acidSplash?.(scene, minion.worldX, minion.worldY, { color: 0xaadd33, radiusTiles: radius })
  },

  // Slime · CORROSIVE ULT — The Dissolving's Acid Flood: floods the whole room with
  // acid puddles for a window (total floor denial). onTick (periodic).
  _acidFlood(slime, scene, gameState, ab) {
    const home = this._roomOf(gameState, slime.assignedRoomId)
    if (!home || !gameState.dungeon) return
    const now = scene?.time?.now ?? 0
    gameState.dungeon.hazards = gameState.dungeon.hazards ?? []
    const floodMs = ab.floodMs ?? 4000
    // tile a sampling of the room (every other tile) with acid puddles.
    let n = 0
    for (let ty = home.gridY; ty < home.gridY + home.height; ty += 2) {
      for (let tx = home.gridX; tx < home.gridX + home.width; tx += 2) {
        gameState.dungeon.hazards.push({
          tileX: tx, tileY: ty, element: 'acid', dmg: ab.dmg ?? 4, radius: 1.1,
          expiresAt: now + floodMs, color: 0xaadd33, sourceId: slime.instanceId,
          armorShred: ab.armorShred, slow: ab.slow,
        })
        n += 1
      }
    }
    if (scene && Number.isFinite(slime.worldX)) {
      // Room-wide caustic deluge — erupting geysers + flooding sheet, centred on
      // the slime and sized to the room (so it reads on-stage in the lab too).
      const rw = Math.min(380, (home.width ?? 6) * 32), rh = Math.min(260, (home.height ?? 6) * 32)
      AbilityVfx.acidFloodFx?.(scene, slime.worldX, slime.worldY, { color: 0xaadd33, rectW: rw, rectH: rh, roomRect: this._roomFloorRectWorld(scene, home), geysers: 8 })
      AbilityVfx.screenShake?.(scene, { intensity: 0.006, durationMs: 300 })
      if (n > 0) AbilityVfx.floatingText(scene, slime.worldX, (slime.worldY ?? 0) - 30, ab.label ?? 'ACID FLOOD', { color: '#cdef5a', fontSize: '13px' })
    }
  },

  // Per-frame hazard-zone processor (called once from MinionAISystem.update).
  tickHazards(scene, gameState, delta) {
    const hazards = gameState?.dungeon?.hazards
    if (!Array.isArray(hazards) || !hazards.length) return
    const now = scene?.time?.now ?? 0
    const advs = this._liveAdvs(gameState)
    const remaining = []
    for (const h of hazards) {
      if (now >= h.expiresAt) continue
      // Tick damage ~1×/sec per standing adv.
      h._lastTick = h._lastTick ?? 0
      const isAcid = h.element === 'acid'
      if (now - h._lastTick >= 1000) {
        h._lastTick = now
        for (const adv of advs) {
          if (Math.hypot(adv.tileX - h.tileX, adv.tileY - h.tileY) > (h.radius ?? 0.7) + 0.01) continue
          const fl = (adv._lightParty || adv._shadowMonarch) ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
          adv.resources.hp = Math.max(fl, adv.resources.hp - (h.dmg ?? 2))
          adv._lastHitBy = h.sourceId; adv._lastHitType = h.element ?? 'fire'
          // Corrosive Ooze — acid that melts armor / slows while you stand in it.
          if (h.armorShred) { adv._armorShred = Math.min((adv._armorShred ?? 0) + h.armorShred, h.armorShredMax ?? 8); adv._armorShredUntil = Math.max(adv._armorShredUntil ?? 0, now + 1600) }
          if (h.slow) { const next = now + 1600; if (!adv._slowUntil || adv._slowUntil < next) adv._slowUntil = next; adv._slowMult = Math.min(adv._slowMult ?? 1, h.slow) }
          if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${h.dmg ?? 2}`, { color: isAcid ? '#cdef5a' : '#ff7733' })
        }
      }
      remaining.push(h)
    }
    gameState.dungeon.hazards = remaining
  },

  // ── Goblin PLUNDER (gold-steal) helpers ───────────────────────────────────

  // Warband's Cut — if a living Plunder King (a minion carrying a `plunderAura`
  // ability) shares `roomId`, goblin plunder in that room is multiplied.
  _plunderMult(scene, gameState, roomId) {
    if (!roomId) return 1
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.assignedRoomId !== roomId) continue
      const abs = _abilitiesFor(m, scene)
      const aura = abs && abs.find(a => a.type === 'plunderAura')
      if (aura) return aura.mult ?? 2
    }
    return 1
  },

  // Bank gold to the treasury + fire the coin-burst VFX at the hero (reuses
  // CoinBurstRenderer via RESOURCES_AWARDED). Returns the gold granted.
  _grantPlunder(scene, attacker, target, gameState, baseAmount, reason) {
    if (!gameState?.player) return 0
    const mult = this._plunderMult(scene, gameState, attacker?.assignedRoomId)
    const g = Math.max(1, Math.round(baseAmount * mult))
    gameState.player.gold = (gameState.player.gold ?? 0) + g
    // Pop the coin burst around the hero's waist (worldY is their feet) so it
    // reads as coins flicked off them, not pooling at the floor.
    EventBus.emit('RESOURCES_AWARDED', { gold: g, reason, worldX: target?.worldX, worldY: (target?.worldY ?? 0) - 12 })
    return g
  },

  // Mark for Plunder — brand the hero so every dungeon hit on them steals, plus
  // a slow gold-bleed. Stores the marking room so Warband's Cut can double it.
  _applyPlunderMark(scene, attacker, target, ab) {
    if (!target) return
    const now = scene?.time?.now ?? 0
    target._plunderUntil     = now + (ab.durationMs ?? 6000)
    target._plunderMarkSteal = ab.markSteal ?? 1
    target._plunderBleedGold = ab.bleedGold ?? 1
    target._plunderBleedMs   = ab.bleedMs ?? 1500
    target._plunderSrcRoom   = attacker?.assignedRoomId ?? null
    if (scene && Number.isFinite(target.worldX)) {
      AbilityVfx.goldStamp?.(scene, target.worldX, (target.worldY ?? 0) - 16, {})
      AbilityVfx.floatingText(scene, target.worldX, (target.worldY ?? 0) - 30, ab.label ?? 'MARKED', { color: '#ffd23f' })
    }
  },

  // GLOBAL marked-steal — called from onHit for EVERY minion hit. If the struck
  // hero is branded, the dungeon pockets a little gold (doubled by Warband's Cut
  // when a Plunder King is in the attacker's room).
  _tryMarkedSteal(scene, attacker, target, gameState) {
    if (!attacker || attacker.faction !== 'dungeon') return
    const now = scene?.time?.now ?? 0
    if (!(target?._plunderUntil > now)) return
    this._grantPlunder(scene, attacker, target, gameState, target._plunderMarkSteal ?? 1, 'plunder_mark')
  },

  // Grand Heist (Plunder King ult) — brand EVERY hero in the King's room at once
  // with a warhorn shock-ring greed-cry.
  _massMark(king, scene, gameState, ab) {
    const home = this._roomOf(gameState, king.assignedRoomId)
    if (!home) return
    let branded = 0
    for (const adv of this._liveAdvs(gameState)) {
      if (!this._onFloorInRoom(scene, adv.tileX, adv.tileY, home)) continue
      this._applyPlunderMark(scene, king, adv, ab)
      branded++
    }
    if (scene && Number.isFinite(king.worldX)) {
      // Greed-cry: a golden shock-ring + a shower of coins raining over the room + a kick.
      AbilityVfx.shockwaveFx?.(scene, king.worldX, king.worldY, { color: 0xffe27a, fromR: 10, toR: 120, durationMs: 560, rings: 2 })
      AbilityVfx.coinRain?.(scene, king.worldX, (king.worldY ?? 0) - 16, { radius: 86, count: 18 })
      AbilityVfx.screenShake?.(scene, { intensity: 0.005, durationMs: 200 })
      if (branded > 0) AbilityVfx.floatingText(scene, king.worldX, (king.worldY ?? 0) - 34, ab.label ?? 'GRAND HEIST', { color: '#ffd23f', fontSize: '13px' })
    }
  },

  // Per-frame plunder-mark processor (called once from MinionAISystem.update):
  // bleeds gold off active brands and expires them.
  tickPlunderMarks(scene, gameState, delta) {
    const now = scene?.time?.now ?? 0
    for (const adv of this._liveAdvs(gameState)) {
      if (!(adv._plunderUntil > now)) { if (adv._plunderUntil) adv._plunderUntil = 0; continue }
      adv._plunderBleedAccum = (adv._plunderBleedAccum ?? 0) + delta
      if (adv._plunderBleedAccum < (adv._plunderBleedMs ?? 1500)) continue
      adv._plunderBleedAccum = 0
      const mult = this._plunderMult(scene, gameState, adv._plunderSrcRoom)
      const g = Math.max(1, Math.round((adv._plunderBleedGold ?? 1) * mult))
      if (gameState?.player) {
        gameState.player.gold = (gameState.player.gold ?? 0) + g
        EventBus.emit('RESOURCES_AWARDED', { gold: g, reason: 'plunder_bleed', worldX: adv.worldX, worldY: adv.worldY })
      }
    }
  },
}
