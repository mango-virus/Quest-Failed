// Generic, brief ability descriptions for the hover inspector (2026-06-21).
//
// One entry per minion definitionId / boss id → an array of { name, desc }.
// Authored to be GENERIC and SHORT — state only WHAT the ability does, no exact
// numbers or flavour (those live in MINION_ABILITY_INFO / bossArchetypes.json for
// the build menu + dossier). The hover lists each ability's name + this one-liner.

export const MINION_HOVER_ABILITIES = {
  // ── MIMIC — ambush devourer ──────────────────────────────────────────────
  mimic: [
    { name: 'Devour', desc: 'Instantly kills any hero who loots it and banks gold for you.' },
    { name: 'Disguise', desc: 'Hides as a treasure chest and springs on whoever opens it.' },
  ],

  // ── GOBLIN — PLUNDER (steal gold) ────────────────────────────────────────
  goblin1: [
    { name: 'Pilfer', desc: 'Earns you bonus gold on every hit it lands.' },
  ],
  goblin2: [
    { name: 'Pilfer', desc: 'Earns you bonus gold on every hit it lands.' },
    { name: 'Mark for Plunder', desc: 'Brands a hero so every minion that hits them also steals gold.' },
  ],
  goblin3: [
    { name: 'Pilfer', desc: 'Earns you bonus gold on every hit it lands.' },
    { name: 'Mark for Plunder', desc: 'Brands a hero so every minion that hits them also steals gold.' },
    { name: "Warband's Cut", desc: 'Doubles the gold other goblins steal in its room.' },
    { name: 'Grand Heist', desc: 'Periodically brands every hero in the room.' },
  ],

  // ── SKELETON — REASSEMBLY (won't stay dead) ──────────────────────────────
  skeleton1: [
    { name: 'Reassemble', desc: 'Revives once after it dies, so it must be killed twice.' },
  ],
  skeleton2: [
    { name: 'Reassemble', desc: 'Revives twice after it dies.' },
    { name: 'Bone Armor', desc: 'Each revival shields it and bursts bone shards at nearby heroes.' },
  ],
  skeleton3: [
    { name: 'Reassemble', desc: 'Revives several times after it dies.' },
    { name: 'Bone Armor', desc: 'Each revival shields it and bursts bone shards at nearby heroes.' },
    { name: 'Undying Legion', desc: 'Periodically raises nearby fallen undead and turns briefly near-unkillable.' },
  ],

  // ── ORC — BLOODLUST (escalating attack) ──────────────────────────────────
  orc1: [
    { name: 'Bloodlust', desc: 'Each hit it lands raises its attack; the stacks fade out of combat.' },
  ],
  orc2: [
    { name: 'Bloodlust', desc: 'Each hit it lands raises its attack; the stacks fade out of combat.' },
    { name: 'War Cry', desc: 'Periodically grants attack stacks to every orc in the room.' },
  ],
  orc_veteran: [
    { name: 'Bloodlust', desc: 'Each hit it lands raises its attack; the stacks fade out of combat.' },
    { name: 'War Cry', desc: 'Periodically grants attack stacks to every orc in the room.' },
    { name: 'Warpath', desc: 'Maxes the warband’s fury and rampages with bonus attack and speed.' },
  ],

  // ── SLIME · SPLITTER — SPLIT (swarm by division) ─────────────────────────
  slime2: [
    { name: 'Split', desc: 'Divides into two weak slimelings when killed.' },
  ],
  slime9: [
    { name: 'Split', desc: 'Divides into two slimelings when killed.' },
    { name: 'Bud', desc: 'Sheds extra slimelings when it is badly hurt.' },
  ],
  slime1: [
    { name: 'Split', desc: 'Divides into three slimelings when killed.' },
    { name: 'Cascade', desc: 'Its slimelings can split once more — one kill becomes a swarm.' },
  ],
  elder_slime2: [
    { name: 'Mitosis', desc: 'Constantly buds new slimelings on a timer.' },
    { name: 'Mitosis Storm', desc: 'Erupts into a large batch of slimelings when killed.' },
  ],

  // ── SLIME · PLAGUE — CONTAGION (spreading poison) ────────────────────────
  slime3: [
    { name: 'Infect', desc: 'Every hit lands a stacking poison that ticks the hero down.' },
  ],
  slime7: [
    { name: 'Infect', desc: 'Every hit lands a stacking poison that ticks the hero down.' },
    { name: 'Contagion', desc: 'Infected heroes spread the poison to nearby allies.' },
  ],
  slime8: [
    { name: 'Infect', desc: 'Every hit lands a stacking poison that ticks the hero down.' },
    { name: 'Contagion', desc: 'Spreads farther and faster; infected heroes leave a toxic trail.' },
  ],
  elder_slime1: [
    { name: 'Infect', desc: 'Every hit lands a stacking poison that ticks the hero down.' },
    { name: 'Contagion', desc: 'Infected heroes spread the poison to nearby allies.' },
    { name: 'Outbreak', desc: 'Periodically infects every hero in the room with a toxic cloud.' },
  ],

  // ── SLIME · CORROSIVE — ACID PUDDLES (floor denial) ──────────────────────
  slime4: [
    { name: 'Acid Burst', desc: 'Bursts into a lingering caustic puddle when killed.' },
  ],
  slime5: [
    { name: 'Acid Trail', desc: 'Leaves a damaging caustic trail wherever it roams.' },
    { name: 'Acid Burst', desc: 'Bursts into a caustic puddle when killed.' },
  ],
  slime6: [
    { name: 'Corrosive Pool', desc: 'Bigger, longer puddles that melt armor and slow heroes who linger.' },
    { name: 'Acid Burst', desc: 'Bursts into a caustic puddle when killed.' },
  ],
  elder_slime3: [
    { name: 'Acid Flood', desc: 'Periodically floods the entire room with armor-melting acid.' },
  ],

  // ── VAMPIRE · LIFE DRAIN — heal off the damage it deals ──────────────────
  vampire_minion1: [
    { name: 'Lifesteal', desc: 'Heals itself for a share of the damage it deals.' },
  ],
  vampire_minion2: [
    { name: 'Bloodgorge', desc: 'Stronger lifesteal; healing past full HP banks as an absorbing blood-shield.' },
  ],
  vampire_sovereign: [
    { name: 'Lifesteal', desc: 'Heals itself for a share of the damage it deals.' },
    { name: 'Blood Feast', desc: 'Periodically siphons HP from every hero at once and heals vampire-kin.' },
  ],

  // ── RAT · SWARM — strength in numbers ────────────────────────────────────
  rat1: [
    { name: 'Swarm', desc: 'Bites harder for every other rat sharing its room.' },
  ],
  rat2: [
    { name: 'Pack Tactics', desc: 'Hits harder and takes less damage with each rat in the pack.' },
  ],
  rat3: [
    { name: 'Pack Tactics', desc: 'Hits harder and takes less damage with each rat in the pack.' },
    { name: 'Vermin Tide', desc: 'Periodically frenzies every rat with max swarm bonus and a speed surge.' },
  ],

  // ── ZOMBIE · RAISE THE DEAD — slain heroes rise as your zombies ──────────
  zombie1: [
    { name: 'Reanimate', desc: 'A hero it kills rises as a weak zombie under your control.' },
  ],
  zombie2: [
    { name: 'Contagion Bite', desc: 'Infects heroes with rot; an infected hero that dies rises as a zombie.' },
  ],
  zombie3: [
    { name: 'Reanimate', desc: 'A hero it kills rises as a weak zombie under your control.' },
    { name: 'Mass Grave', desc: 'Periodically claws the room’s fallen heroes back up as a zombie horde.' },
  ],

  // ── DEMON · HELLFIRE — escalating burn aura ──────────────────────────────
  demon1: [
    { name: 'Burning Aura', desc: 'Nearby heroes burn for escalating fire each second.' },
  ],
  demon2: [
    { name: 'Burning Aura', desc: 'Nearby heroes burn for escalating fire each second.' },
    { name: 'Combustion', desc: 'A fully-burned hero detonates, splashing fire onto nearby allies.' },
  ],
  demon_lord: [
    { name: 'Burning Aura', desc: 'Nearby heroes burn for escalating fire each second.' },
    { name: 'Inferno', desc: 'Periodically erupts the whole room into hellfire.' },
  ],

  // ── GOLEM · FORTRESS — damage mitigation (self → allies → room) ──────────
  golem1: [
    { name: 'Bulwark', desc: 'A slow, immovable wall that takes heavily reduced damage.' },
  ],
  golem2: [
    { name: 'Bulwark', desc: 'A slow, immovable wall that takes heavily reduced damage.' },
    { name: 'Aegis', desc: 'Allies near it take far less damage too.' },
  ],
  golem_warden: [
    { name: 'Bulwark', desc: 'A slow, immovable wall that takes heavily reduced damage.' },
    { name: 'Bastion', desc: 'Periodically grants a big damage-reduction window to itself and every ally.' },
  ],

  // ── GHOST · FEAR — nerve warfare ─────────────────────────────────────────
  ghost1: [
    { name: 'Dread', desc: 'Drains a hero’s nerve from afar; broken nerve makes them fight worse.' },
  ],
  ghost2: [
    { name: 'Dread', desc: 'Drains a hero’s nerve from afar; broken nerve makes them fight worse.' },
    { name: 'Haunt', desc: 'A hit keeps draining a hero’s nerve and spreads panic to nearby allies.' },
  ],
  dark_wraith: [
    { name: 'Dread', desc: 'Drains a hero’s nerve from afar; broken nerve makes them fight worse.' },
    { name: 'Haunt', desc: 'A hit keeps draining a hero’s nerve and spreads panic to nearby allies.' },
    { name: 'Pall of Dread', desc: 'Periodically craters every hero’s nerve so the room panics in place.' },
  ],

  // ── BEHOLDER · GAZE — domination ─────────────────────────────────────────
  beholder1: [
    { name: 'Mesmerize', desc: 'Charms the hero it hits into attacking their own nearest ally.' },
  ],
  beholder2: [
    { name: 'Mesmerize', desc: 'Charms the hero it hits into attacking their own nearest ally.' },
    { name: 'Mass Hypnosis', desc: 'Charms several nearby heroes at once into friendly fire.' },
  ],
  beholder_tyrant: [
    { name: 'Mesmerize', desc: 'Charms the hero it hits into attacking their own nearest ally.' },
    { name: 'Mass Hypnosis', desc: 'Charms several nearby heroes at once into friendly fire.' },
    { name: "Tyrant's Glare", desc: 'Periodically petrifies every hero and makes them take extra damage.' },
  ],

  // ── GNOLL · BLOOD HUNT — bleed and run prey down ─────────────────────────
  gnoll1: [
    { name: 'Bleed', desc: 'Every hit opens a stacking wound that drains HP over time.' },
  ],
  gnoll2: [
    { name: 'Bleed', desc: 'Every hit opens a stacking wound that drains HP over time.' },
    { name: 'Bloodhound', desc: 'Leaves its room to sprint down any bleeding hero in the dungeon.' },
  ],
  gnoll_alpha: [
    { name: 'Bleed', desc: 'Every hit opens a stacking wound that drains HP over time.' },
    { name: 'Bloodhound', desc: 'Leaves its room to sprint down any bleeding hero in the dungeon.' },
    { name: 'Blood Frenzy', desc: 'Ruptures all bleeds at once, blocks healing, and sends the pack feral.' },
  ],

  // ── ENT · THORNS — reflect + regrow ──────────────────────────────────────
  ent1: [
    { name: 'Thornskin', desc: 'Heroes who strike it in melee take thorn damage back.' },
  ],
  ent2: [
    { name: 'Thornskin', desc: 'Heroes who strike it in melee take thorn damage back.' },
    { name: 'Old Growth', desc: 'Slowly regrows its HP, so it can’t be out-traded.' },
  ],
  ent3: [
    { name: 'Thornskin', desc: 'Heroes who strike it in melee take thorn damage back.' },
    { name: 'Old Growth', desc: 'Slowly regrows its HP, so it can’t be out-traded.' },
    { name: 'Thornburst', desc: 'Periodically rakes every hero in the room and heals itself.' },
  ],

  // ── LICH · SOUL HARVEST — deaths bank souls → necrotic power ─────────────
  lich1: [
    { name: 'Soul Siphon', desc: 'Banks power from anything that dies in its room, hitting harder over time.' },
  ],
  lich2: [
    { name: 'Soul Siphon', desc: 'Banks power from anything that dies in its room, hitting harder over time.' },
    { name: 'Soul Conduit', desc: 'Shares its banked power so nearby undead allies hit harder too.' },
  ],
  elder_lich: [
    { name: 'Soul Siphon', desc: 'Banks power from anything that dies in its room, hitting harder over time.' },
    { name: 'Soul Conduit', desc: 'Shares its banked power so nearby undead allies hit harder too.' },
    { name: 'Soul Storm', desc: 'Spends its soul bank on a room-wide necrotic blast; reforms once when killed.' },
  ],

  // ── LIZARDMAN · CAMOUFLAGE — untargetable ambush ─────────────────────────
  lizardman1: [
    { name: 'Camouflage', desc: 'Hides unseen and untargetable until it strikes for a heavy ambush hit.' },
  ],
  lizardman2: [
    { name: 'Camouflage', desc: 'Hides unseen and untargetable until it strikes for a heavy ambush hit.' },
    { name: 'Stalk', desc: 'Re-hides after striking and re-cloaks instantly on a kill.' },
  ],
  serpent_captain: [
    { name: 'Camouflage', desc: 'Hides unseen and untargetable until it strikes for a heavy ambush hit.' },
    { name: 'Stalk', desc: 'Re-hides after striking and re-cloaks instantly on a kill.' },
    { name: 'Vanishing Warband', desc: 'Periodically re-cloaks the whole pack for a synchronized ambush.' },
  ],

  // ── IMP · BLINK — uncatchable teleporting harasser ───────────────────────
  imp1: [
    { name: 'Blink', desc: 'Teleports away the instant a hero closes to melee, then plinks from range.' },
  ],
  imp2: [
    { name: 'Blink', desc: 'Teleports away the instant a hero closes to melee, then plinks from range.' },
    { name: 'Flicker Strike', desc: 'Blinks past the front line to sting the most-wounded hero, then back out.' },
  ],
  imp3: [
    { name: 'Blink', desc: 'Teleports away the instant a hero closes to melee, then plinks from range.' },
    { name: 'Flicker Strike', desc: 'Blinks past the front line to sting the most-wounded hero, then back out.' },
    { name: 'Hellrift', desc: 'Periodically blasts the room with fire as the whole imp pack teleport-frenzies.' },
  ],

  // ── PLANT · ENTANGLE — root heroes in place ──────────────────────────────
  plant1: [
    { name: 'Entangle', desc: 'Its hit roots a hero in place so they can’t move or flee.' },
  ],
  plant2: [
    { name: 'Entangle', desc: 'Its hit roots a hero in place so they can’t move or flee.' },
    { name: 'Devour', desc: 'Bites a rooted hero for bonus damage while they can’t escape.' },
  ],
  plant3: [
    { name: 'Entangle', desc: 'Its hit roots a hero in place so they can’t move or flee.' },
    { name: 'Devour', desc: 'Bites a rooted hero for bonus damage while they can’t escape.' },
    { name: 'Stranglethorn', desc: 'Periodically roots every hero in the room and drains them to heal itself.' },
  ],

  // ── MUSHROOM · HALLUCINATION — make heroes whiff (accuracy denial) ───────
  mushroom1: [
    { name: 'Hallucinogenic Spores', desc: 'Its hit dazes a hero so they miss many of their attacks.' },
  ],
  mushroom2: [
    { name: 'Hallucinogenic Spores', desc: 'Its hit dazes a hero so they miss many of their attacks.' },
    { name: 'Spore Cloud', desc: 'Periodically belches a cloud that dazes every hero near it.' },
  ],
  myconid_stalker: [
    { name: 'Hallucinogenic Spores', desc: 'Its hit dazes a hero so they miss many of their attacks.' },
    { name: 'Spore Storm', desc: 'Periodically blooms a room-wide haze so the whole party fights blind.' },
  ],
}

export const BOSS_HOVER_ABILITIES = {
  // Per-boss: throne-fight signature + passive mechanics. The day-active ability
  // is excluded — the hover shows what the boss IS, not the button the player
  // presses. Keys = bossArchetypes.json ids. Falls back to that file if missing.
  beholder: [
    { name: 'Eye Barrage', desc: 'Its eye-stalks fire rotating curse-rays that petrify, drain, hex, and disintegrate.' },
    { name: 'Anti-Magic Aura', desc: 'Marks rooms each day that silence all hero abilities inside.' },
  ],
  demon: [
    { name: 'The Brimstone Pact', desc: 'Every kill and sacrifice banks Infernal Power — the bigger the reserve, the bigger its hellfire.' },
    { name: 'Volatile Legion', desc: 'Its imps explode in hellfire when a hero kills them.' },
    { name: 'Hellgate', desc: 'A portal spawns free imps every dawn that roam the dungeon.' },
  ],
  myconid: [
    { name: 'The Bloom', desc: 'Colonizes rooms that gas heroes with spores while its minions inside regenerate.' },
    { name: 'Corpse Bloom', desc: 'Dead heroes rot into fungal corpses that poison on contact and bloom their room.' },
  ],
  wraith: [
    { name: 'The Dread Harvest', desc: 'Every fright banks Dread, amplifying all fear so the party panics and dies faster.' },
    { name: 'Fear Breaks', desc: 'Enough fear makes a hero flee, knife an ally, or die of fright.' },
    { name: 'Haunting', desc: 'Dead heroes leave free wall-phasing ghosts that haunt their room.' },
  ],
  gnoll: [
    { name: 'The Blood Hunt', desc: 'Every kill banks Ferocity, whipping the free pack into a fiercer frenzy.' },
    { name: "Hunter's Pack", desc: 'Free gnolls respawn each dawn with no cap and stack attack per kill.' },
  ],
  golem: [
    { name: 'The Living Fortress', desc: 'The dungeon is its body — every room you hold raises its HP, defense, and quake power.' },
    { name: 'Aftershock', desc: 'Periodic tremors chip the most-occupied rooms; later acts quake every occupied room.' },
  ],
  lich: [
    { name: 'The Withering', desc: 'Spends banked Soul Essence to blast, drain, and wither the party while self-healing.' },
    { name: 'Soul Harvest', desc: 'Slowly regenerates while it holds essence; every death banks more.' },
  ],
  lizardman: [
    { name: 'The Plague-Bearer', desc: 'Its bite carries a plague that spreads hero-to-hero through the raid.' },
    { name: 'Venom Stack', desc: 'Its minions’ attacks stack a poison that lingers for the rest of the run.' },
  ],
  orc: [
    { name: 'Trophy Hunter', desc: 'Every hero class he kills arms him with their weapon; his arsenal grows all run.' },
    { name: 'Warband', desc: 'Orcs in a room buff each other’s attack and defense and loot permanent attack per kill.' },
    { name: 'Mastery', desc: 'His most-claimed trophy radiates a dungeon-wide boon.' },
  ],
  vampire: [
    { name: 'The Blood Sovereign', desc: 'Runs the dungeon as a blood economy — every wound banks Blood that heals him and powers his rites.' },
    { name: 'The Court', desc: 'Charms heroes into roaming thralls that fight for the dungeon.' },
  ],
  succubus: [
    { name: 'The Rapture', desc: 'Banks Allure to mesmerize the party — some turn on their own, some freeze, some walk into traps.' },
    { name: 'Doppelgänger', desc: 'Hides among seductive mirror-images you must shatter to land a real hit.' },
  ],
  slime: [
    { name: 'Mitosis', desc: 'A self-multiplying ooze that buds free gooplings and absorbs the dead to swell its mass.' },
    { name: 'The Horde', desc: 'Roaming gooplings coalesce into bigger slimes and leave acid trails.' },
  ],
}
