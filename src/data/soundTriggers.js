// soundTriggers.js — the SOUND TRIGGER REGISTRY.
//
// One entry per logical "thing that makes a sound" in the game. Drives the Sound
// Studio list (label/category/default sound + volume) and the "reset to default"
// targets. NOTE: actual PLAYBACK defaults live in code (SfxSystem SFX_VOLUMES /
// HudSfx UI_VOL / the event→key maps); the values here MIRROR those for display
// and are what a Studio "reset" shows. SoundConfig stores only overrides, so the
// game is unchanged until the dev edits a trigger. See SOUND_STUDIO.md.
//
// Fields: id, label, category, key|keys (default sound), vol (0..1 base), pitch
// (jitter on/off), boost (extra-boost some cues use), event (EventBus name, for
// the Studio's "fire in context" button where applicable).

export const SOUND_TRIGGERS = [
  // ── Combat ──────────────────────────────────────────────────────────────
  { id: 'adv_hurt',     label: 'Adventurer hurt',     category: 'Combat', keys: ['sfx-human-hit-1','sfx-human-hit-2','sfx-human-hit-3'], vol: 0.78, pitch: true },
  { id: 'adv_die',      label: 'Adventurer dies',     category: 'Combat', keys: ['sfx-human-die-1','sfx-human-die-2'], vol: 0.82, pitch: true, event: 'ADVENTURER_DIED' },
  { id: 'minion_hurt',  label: 'Minion/boss takes damage', category: 'Combat', key: 'sfx-take-damage', vol: 0.70, pitch: true },
  { id: 'minion_die',   label: 'Minion dies',         category: 'Combat', key: 'sfx-death', vol: 0.75, pitch: true, event: 'MINION_DIED' },
  { id: 'adv_melee',    label: 'Adventurer melee attack', category: 'Combat', keys: ['sfx-melee-1','sfx-melee-2'], vol: 0.95, pitch: true },
  { id: 'minion_attack',label: 'Minion attack',       category: 'Combat', keys: ['sfx-melee-1','sfx-melee-2'], vol: 0.95, pitch: true },
  { id: 'monk_strike',  label: 'Monk strike',         category: 'Combat', keys: ['sfx-monk-1','sfx-monk-2'], vol: 0.88, pitch: true },
  { id: 'ranger_shoot', label: 'Ranger shoot',        category: 'Combat', key: 'sfx-archer-shoot', vol: 0.82, pitch: true },
  { id: 'mage_attack',  label: 'Mage attack',         category: 'Combat', key: 'sfx-mage-attack', vol: 0.88, pitch: true },

  // ── Boss ────────────────────────────────────────────────────────────────
  { id: 'boss_melee',        label: 'Boss melee hit',      category: 'Boss', key: 'sfx-boss-attack', vol: 0.82, pitch: true, event: 'BOSS_MELEE_HIT' },
  { id: 'boss_fight_start',  label: 'Boss fight starts',   category: 'Boss', key: 'sfx-boss-attack', vol: 0.82, event: 'BOSS_FIGHT_STARTED' },
  { id: 'boss_death',        label: 'Boss dies',           category: 'Boss', key: 'sfx-boss-death', vol: 0.95 },
  { id: 'boss_levelup',      label: 'Boss level-up (earned)', category: 'Boss', key: 'sfx-door-unlock', vol: 0.46, event: 'BOSS_LEVELED_UP' },
  { id: 'miniboss_promoted', label: 'Miniboss promoted',   category: 'Boss', key: 'sfx-necro-summon', vol: 0.85, event: 'MINIBOSS_PROMOTED' },
  // Per-boss signature abilities
  { id: 'boss_orc_throw',        label: 'Orc — Trophy Throw',     category: 'Boss', key: 'sfx-boss-orc-throw', vol: 0.88, pitch: true, event: 'ORC_TROPHY_THROW_FIRED' },
  { id: 'boss_lich_wither',      label: 'Lich — Withering',       category: 'Boss', key: 'sfx-boss-lich-wither', vol: 0.85, pitch: true, event: 'LICH_CHANNEL_FIRED' },
  { id: 'boss_slime_surge',      label: 'Slime — Surge',          category: 'Boss', key: 'sfx-boss-slime-surge', vol: 0.85, pitch: true, event: 'SLIME_SURGE_FIRED' },
  { id: 'boss_beholder_gaze',    label: 'Beholder — Gaze',        category: 'Boss', key: 'sfx-boss-beholder-gaze', vol: 0.85, pitch: true, event: 'BEHOLDER_GAZE_FIRED' },
  { id: 'boss_beholder_petrify', label: 'Beholder — Petrify',     category: 'Boss', key: 'sfx-boss-beholder-petrify', vol: 0.85, pitch: true, event: 'BEHOLDER_PETRIFY_FIRED' },
  { id: 'boss_myconid_bloom',    label: 'Myconid — Bloom',        category: 'Boss', key: 'sfx-boss-myconid-bloom', vol: 0.82, pitch: true, event: 'MYCONID_SEED_FIRED' },
  { id: 'boss_demon_sacrifice',  label: 'Demon — Sacrifice',      category: 'Boss', key: 'sfx-boss-demon-sacrifice', vol: 0.88, pitch: true, event: 'DEMON_SACRIFICE_FIRED' },
  { id: 'boss_golem_quake',      label: 'Golem — Earthquake',     category: 'Boss', key: 'sfx-boss-golem-quake', vol: 0.90, pitch: true, event: 'GOLEM_EARTHQUAKE_FIRED' },
  { id: 'boss_lizard_spit',      label: 'Lizardman — Spit',       category: 'Boss', key: 'sfx-boss-lizard-spit', vol: 0.85, pitch: true, event: 'LIZARD_SPIT_FIRED' },
  { id: 'boss_vampire_rite',     label: 'Vampire — Blood Rite',   category: 'Boss', key: 'sfx-boss-vampire-rite', vol: 0.85, pitch: true, event: 'VAMPIRE_RITE_FIRED' },
  { id: 'boss_wraith_terror',    label: 'Wraith — Terror',        category: 'Boss', key: 'sfx-boss-wraith-terror', vol: 0.88, pitch: true, event: 'WRAITH_TERROR_FIRED' },
  { id: 'boss_gnoll_howl',       label: 'Gnoll — Hunt Howl',      category: 'Boss', key: 'sfx-boss-gnoll-howl', vol: 0.88, pitch: true, event: 'GNOLL_HUNT_FIRED' },
  { id: 'boss_succubus_kiss',    label: 'Succubus — Kiss',        category: 'Boss', key: 'sfx-boss-succubus-kiss', vol: 0.82, pitch: true, event: 'SUCCUBUS_KISS_FIRED' },
  { id: 'boss_final_breath',     label: 'Boss — Final Breath',    category: 'Boss', key: 'sfx-boss-attack', vol: 0.82, pitch: true, event: 'FINAL_BREATH_TRIGGERED' },
  { id: 'boss_pact_hellfire',    label: 'Pact boss — Hellfire',   category: 'Boss', key: 'sfx-boss-attack', vol: 0.82, pitch: true, event: 'PACT_BOSS_HELLFIRE_FIRED' },
  { id: 'boss_pact_lightning',   label: 'Pact boss — Lightning',  category: 'Boss', key: 'sfx-beholder-beam', vol: 0.80, pitch: true, event: 'PACT_BOSS_LIGHTNING_FIRED' },
  { id: 'boss_pact_shockwave',   label: 'Pact boss — Shockwave',  category: 'Boss', key: 'sfx-boss-attack', vol: 0.82, pitch: true, event: 'PACT_BOSS_SHOCKWAVE_FIRED' },
  { id: 'boss_pact_vortex',      label: 'Pact boss — Vortex',     category: 'Boss', key: 'sfx-teleport', vol: 0.90, event: 'PACT_BOSS_VORTEX_FIRED' },
  { id: 'boss_pact_petrify',     label: 'Pact boss — Petrify',    category: 'Boss', key: 'sfx-beholder-beam', vol: 0.80, event: 'PACT_BOSS_PETRIFY_FIRED' },

  // ── Traps ───────────────────────────────────────────────────────────────
  { id: 'trap_bomb',       label: 'Trap — Bomb',        category: 'Traps', key: 'sfx-trap-bomb', vol: 0.70, pitch: true },
  { id: 'trap_cannon',     label: 'Trap — Cannon',      category: 'Traps', key: 'sfx-trap-cannon', vol: 0.70, pitch: true },
  { id: 'trap_dragonfire', label: 'Trap — Dragon fire', category: 'Traps', key: 'sfx-trap-dragonfire', vol: 0.70, pitch: true },
  { id: 'trap_spikes',     label: 'Trap — Spikes',      category: 'Traps', key: 'sfx-trap-spikes', vol: 0.70, pitch: true },
  { id: 'trap_pit',        label: 'Trap — Spike pit',   category: 'Traps', key: 'sfx-trap-pit', vol: 0.70, pitch: true },
  { id: 'trap_blades',     label: 'Trap — Rotating blades', category: 'Traps', key: 'sfx-trap-blades', vol: 0.70, pitch: true },
  { id: 'trap_saw',        label: 'Trap — Saw',         category: 'Traps', key: 'sfx-trap-saw', vol: 0.70, pitch: true },
  { id: 'trap_arrows',     label: 'Trap — Arrows',      category: 'Traps', key: 'sfx-trap-arrows', vol: 0.70, pitch: true },

  // ── Class abilities ───────────────────────────────────────────────────────
  { id: 'abil_arcane',   label: 'Mage — Arcane Burst',    category: 'Abilities', key: 'sfx-abil-arcane', vol: 0.70, pitch: true },
  { id: 'abil_stun',     label: 'Monk — Stunning Palm',   category: 'Abilities', key: 'sfx-abil-stun', vol: 0.70, pitch: true },
  { id: 'abil_riposte',  label: 'Monk — Riposte',         category: 'Abilities', key: 'sfx-abil-riposte', vol: 0.70, pitch: true },
  { id: 'abil_bulwark',  label: 'Knight — Bulwark',       category: 'Abilities', key: 'sfx-abil-bulwark', vol: 0.70 },
  { id: 'abil_charge',   label: 'Barbarian — Reckless Charge', category: 'Abilities', key: 'sfx-abil-charge', vol: 0.70, pitch: true },
  { id: 'abil_dice',     label: 'Gambler — Dice',         category: 'Abilities', key: 'sfx-abil-dice', vol: 0.70, pitch: true },
  { id: 'abil_hymn',     label: 'Bard — Battle Hymn',     category: 'Abilities', key: 'sfx-abil-hymn', vol: 0.70 },
  { id: 'abil_mob',      label: 'Peasant — Strength in Numbers', category: 'Abilities', key: 'sfx-abil-mob', vol: 0.70 },
  { id: 'abil_tame',     label: 'Beast-master — Tame',    category: 'Abilities', key: 'sfx-abil-tame', vol: 0.70 },
  { id: 'abil_tunnel',   label: 'Miner — Tunnel',         category: 'Abilities', key: 'sfx-abil-tunnel', vol: 0.70 },
  { id: 'abil_vanish',   label: 'Rogue — Vanish',         category: 'Abilities', key: 'sfx-abil-vanish', vol: 0.70 },
  { id: 'abil_pierce',   label: 'Ranger — Piercing Shot', category: 'Abilities', key: 'sfx-abil-pierce', vol: 0.70, pitch: true },
  { id: 'abil_roar',     label: 'Gladiator — Crowd Roar', category: 'Abilities', key: 'sfx-abil-roar', vol: 0.70, pitch: true },
  { id: 'abil_wings',    label: 'Valkyrie — Winged Flight', category: 'Abilities', key: 'sfx-abil-wings', vol: 0.70, pitch: true },
  { id: 'abil_plunder',  label: 'Pirate — Plunder Run',   category: 'Abilities', key: 'sfx-abil-plunder', vol: 0.70 },
  { id: 'abil_layhands', label: 'Templar — Lay on Hands', category: 'Abilities', key: 'sfx-abil-layhands', vol: 0.70, event: 'TEMPLAR_LAY_ON_HANDS' },
  { id: 'ally_healed',   label: 'Cleric heal',            category: 'Abilities', key: 'sfx-cleric-heal', vol: 0.90, event: 'ALLY_HEALED' },
  { id: 'adv_revived',   label: 'Adventurer revived',     category: 'Abilities', key: 'sfx-revive', vol: 0.58, event: 'ADVENTURER_RESURRECTED' },
  { id: 'necro_summon',  label: 'Necromancer summon',     category: 'Abilities', key: 'sfx-necro-summon', vol: 0.85, event: 'MINION_SUMMONED' },

  // ── World / building ──────────────────────────────────────────────────────
  { id: 'collect_gold',     label: 'Collect gold',        category: 'World', key: 'sfx-collect-gold', vol: 0.95, boost: 3.0, event: 'RESOURCES_AWARDED' },
  { id: 'sell_refund',      label: 'Sell refund gold',    category: 'World', key: 'sfx-collect-gold', vol: 0.95, boost: 3.0, event: 'ENTITY_SOLD' },
  { id: 'room_sell',        label: 'Remove room/minion',  category: 'World', key: 'sfx-remove-room', vol: 0.95, event: 'ROOM_REMOVED' },
  { id: 'door_open',        label: 'Door opens',          category: 'World', key: 'sfx-door-open', vol: 0.80, event: 'DOOR_OPENING' },
  { id: 'door_close',       label: 'Door closes',         category: 'World', key: 'sfx-close-door', vol: 0.75, event: 'DOOR_CLOSED' },
  { id: 'chest_open',       label: 'Chest opens / mimic', category: 'World', key: 'sfx-chest-open', vol: 0.82, event: 'MIMIC_SPRUNG' },
  { id: 'teleport',         label: 'Teleport / warp gate', category: 'World', key: 'sfx-teleport', vol: 0.90, event: 'WANDERING_GATE_TELEPORTED' },
  { id: 'minion_levelup',   label: 'Minion level-up/evolve', category: 'World', key: 'sfx-minion-levelup', vol: 0.82, event: 'MINION_LEVELED_UP' },
  { id: 'minion_place',     label: 'Place minion',        category: 'World', key: 'sfx-minion-place', vol: 0.70 },
  { id: 'build_place',      label: 'Place room/trap',     category: 'World', keys: ['sfx-build-1','sfx-build-2','sfx-build-3'], vol: 0.70 },
  { id: 'build_menu_press', label: 'Build menu press',    category: 'World', key: 'sfx-build-menu-press', vol: 0.70 },
  { id: 'day_start',        label: 'Day phase begins',    category: 'World', key: 'sfx-day-start', vol: 0.82, event: 'DAY_PHASE_BEGAN' },
  { id: 'day_end',          label: 'Day phase ends',      category: 'World', key: 'sfx-day-end', vol: 0.80, event: 'DAY_PHASE_ENDED' },
  { id: 'night_begins',     label: 'Night/build begins',  category: 'World', key: 'sfx-dark-pact', vol: 0.92, event: 'NIGHT_PHASE_BEGAN' },
  { id: 'dark_pact_open',   label: 'Dark Pact popup opens', category: 'World', key: 'sfx-dark-pact', vol: 0.92, boost: 3.5, event: 'SHOW_DARK_PACT' },
  { id: 'pact_sealed',      label: 'Pact sealed',         category: 'World', key: 'sfx-dark-pact', vol: 0.92, boost: 2.0, event: 'PACT_SEALED' },

  // ── Notify / progression ──────────────────────────────────────────────────
  { id: 'event_notif',       label: 'Event notification',  category: 'Notify', key: 'sfx-event-notif', vol: 0.80, event: 'DUNGEON_EVENT_ANNOUNCED' },
  { id: 'event_boss',        label: 'Boss-tier event notif', category: 'Notify', key: 'sfx-event-boss', vol: 0.80 },
  { id: 'intel_scrubbed',    label: 'Intel scrubbed',      category: 'Notify', key: 'sfx-scrub-intel', vol: 0.78, event: 'KNOWLEDGE_SCRUBBED' },
  { id: 'intel_leaked',      label: 'Intel leaked',        category: 'Notify', key: 'sfx-error', vol: 0.58, boost: 1.2, event: 'INTEL_LEAKED' },
  { id: 'build_error',       label: 'Build error',         category: 'Notify', key: 'sfx-error', vol: 0.58, event: 'BUILD_ERROR' },
  { id: 'bounty_posted',     label: 'Minion bounty posted', category: 'Notify', key: 'sfx-door-unlock', vol: 0.46, boost: 0.8, event: 'MINION_BOUNTY_POSTED' },
  { id: 'boss_levelup_screen', label: 'Ascension / level-up screen', category: 'Notify', key: 'sfx-boss-levelup', vol: 0.85, event: 'SHOW_BOSS_LEVEL_UP' },
  { id: 'game_over',         label: 'Game over burn-in',   category: 'Notify', key: 'sfx-boss-death', vol: 0.95, boost: 2.5, event: 'SHOW_GAME_OVER' },
  { id: 'coin_flip',         label: 'Gambler coin toss',   category: 'Notify', key: 'sfx-collect-gold', vol: 0.95, boost: 1.6, event: 'GAMBLER_COIN_FLIP' },
  { id: 'coin_win',          label: 'Gambler coin win',    category: 'Notify', key: 'sfx-collect-gold', vol: 0.95, boost: 3.5 },
  { id: 'coin_lose',         label: 'Gambler coin loss',   category: 'Notify', key: 'sfx-error', vol: 0.58, boost: 1.3 },
  // Gap-fill cues (new moments)
  { id: 'wave_start',        label: 'Wave start',          category: 'Notify', key: 'sfx-wave-start', vol: 0.70, event: 'ADVENTURERS_SPAWNED' },
  { id: 'legendary_arrival', label: 'Legendary hero arrives', category: 'Notify', key: 'sfx-legendary', vol: 0.70, boost: 1.2, event: 'LEGENDARY_HERO_ARRIVED' },
  { id: 'threat_alert',      label: 'Threat incoming (alert)', category: 'Notify', key: 'sfx-alert', vol: 0.70, event: 'CHAMPION_RAID_INCOMING' },
  { id: 'act_clear',         label: 'Act cleared',         category: 'Notify', key: 'sfx-act-clear', vol: 0.70, boost: 1.3, event: 'ACT_CLEARED' },
  { id: 'act_overtime',      label: 'Act overtime',        category: 'Notify', key: 'sfx-overtime', vol: 0.70, boost: 1.2, event: 'ACT_OVERTIME' },
  { id: 'post_wave_summary', label: 'Post-wave summary',   category: 'Notify', key: 'sfx-summary', vol: 0.70, event: 'SHOW_POST_WAVE_SUMMARY' },
  { id: 'minion_defected',   label: 'Minion defected',     category: 'Notify', key: 'sfx-defect', vol: 0.70, event: 'MINION_DEFECTED' },
  { id: 'minions_lost',      label: 'Minions lost (tally)', category: 'Notify', key: 'sfx-casualty', vol: 0.70, event: 'MINIONS_LOST_FALLEN' },
  { id: 'run_victory',       label: 'Run victory',         category: 'Notify', key: 'sfx-cin-victory', vol: 0.70, boost: 1.6, event: 'RUN_VICTORY' },

  // ── Cinematics ────────────────────────────────────────────────────────────
  { id: 'cin_flip',      label: 'Opening — THE FLIP eruption', category: 'Cinematics', key: 'sfx-cin-flip', vol: 1.0 },
  { id: 'cin_ascension', label: 'Dark Ascension sting',    category: 'Cinematics', key: 'sfx-cin-ascension', vol: 1.6 },
  { id: 'cin_kingdom',   label: 'The Kingdom Responds',    category: 'Cinematics', key: 'sfx-cin-kingdom', vol: 1.55 },
  { id: 'cin_bladelock', label: 'Duel — blade lock',       category: 'Cinematics', key: 'sfx-cin-bladelock', vol: 1.3 },
  { id: 'cin_finalblow', label: 'Duel — final blow',       category: 'Cinematics', key: 'sfx-cin-finalblow', vol: 1.6 },
  { id: 'cin_collapse',  label: 'Rival — collapse',        category: 'Cinematics', key: 'sfx-cin-collapse', vol: 1.6 },
  { id: 'cin_verdict',   label: 'Rival — verdict',         category: 'Cinematics', key: 'sfx-cin-verdict', vol: 1.45 },
  { id: 'cin_coin_land', label: 'Gambler cinematic — coin lands', category: 'Cinematics', key: 'sfx-cin-coin-land', vol: 1.25 },
  { id: 'cin_coin_win',  label: 'Gambler cinematic — win', category: 'Cinematics', key: 'sfx-cin-coin-win', vol: 1.55 },
  { id: 'duel_begin',    label: 'Duel begins',             category: 'Cinematics', key: 'sfx-duel-begin', vol: 0.70 },

  // ── UI ──────────────────────────────────────────────────────────────────
  { id: 'ui_hover',              label: 'Button hover',     category: 'UI', key: 'sfx-btn-hover', vol: 0.5 },
  { id: 'ui_click',             label: 'Button click',      category: 'UI', key: 'sfx-btn-click', vol: 2.5 },
  { id: 'ui_click_danger',      label: 'Danger/destructive click', category: 'UI', key: 'sfx-error', vol: 0.8 },
  { id: 'ui_denied',            label: 'Locked / denied',   category: 'UI', key: 'sfx-error', vol: 0.8 },
  { id: 'ui_toast',             label: 'Toast appears',     category: 'UI', key: 'sfx-door-open', vol: 0.7 },
  { id: 'ui_tab',               label: 'Tab switch',        category: 'UI', key: 'sfx-chest-open', vol: 0.7 },
  { id: 'ui_open_panel',        label: 'Panel open',        category: 'UI', key: 'sfx-chest-open', vol: 0.7 },
  { id: 'ui_close_panel',       label: 'Panel close',       category: 'UI', key: 'sfx-close-door', vol: 0.7 },
  { id: 'ui_unlock_reward',     label: 'Unlock — reward card', category: 'UI', key: 'sfx-unlock-reward', vol: 0.9 },
  { id: 'ui_unlock_achievement',label: 'Unlock — achievement', category: 'UI', key: 'sfx-unlock-achievement', vol: 0.9 },
  { id: 'ui_demote',            label: 'Demoted / dethroned', category: 'UI', key: 'sfx-boss-death', vol: 0.7 },
  { id: 'ui_cursor_click',      label: 'Cursor click',      category: 'UI', key: 'sfx-cursor-click', vol: 0.6 },

  // ── Dialogue ──────────────────────────────────────────────────────────────
  { id: 'speech',    label: 'Dialogue text blip', category: 'Dialogue', key: 'sfx-speech', vol: 0.5 },
  { id: 'book_open', label: 'Codex / book open',  category: 'Dialogue', key: 'sfx-book-open', vol: 0.6 },
]

// Ordered category list for the Studio's grouping.
export const SOUND_CATEGORIES = ['Combat', 'Boss', 'Traps', 'Abilities', 'Cinematics', 'World', 'Notify', 'UI', 'Dialogue']
