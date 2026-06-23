# Quest Failed — SFX Generation Prompt List (2026-06-23)

> Your **work order** for generating the missing / differentiating SFX. Grounded in the real
> code (`SfxSystem.js` boss/trap maps, `adventurerClasses.json` abilities, the cinematic cues in
> `HudSfx.js`). Pairs with `AUDIO_AUDIT.md` (the gap analysis) and `assets/audio/ai-placeholders.json`
> (the swap ledger).

## How to use this
For each sound: **(1)** paste the prompt into ElevenLabs (free tier for now — placeholder only,
see the licensing note in `AUDIO_AUDIT.md`), pick the best of the 4 variants → **(2)** save the raw
clip into `assets/audio/_raw/` → **(3)** run `npm run audio:retrofy` to bake the 16-bit feel →
**(4)** tell me and I wire it in (loader line + key/event mapping) and log it in the ledger.

ElevenLabs prompt tips: keep them short and physical, name the **material + action + emotion**, and
give a duration. "Duration: ~1.5s" in the prompt helps. All output gets 16-bit-styled by `retrofy`,
so don't ask for "8-bit/chiptune" in the prompt — generate a clean realistic sound and let the tool
crush it (more controllable than asking the AI for retro).

Priorities: **P1 = cinematics** (wired, just need files) · **P2 = boss signatures** (the 18-on-4
reuse fix) · **P3 = traps** · **P4 = class abilities**.

---

## P1 — Cinematic apex stingers (9) — already wired in `HudSfx`
These are tracked in `assets/audio/ai-placeholders.json`. Keys are `sfx-cin-*`; add the file to
`Preload.js`/`DeferredAudioLoader.js` under the key and they light up automatically.

| Key | Moment | Prompt |
|---|---|---|
| `sfx-cin-ascension` | DARK ASCENSION — boss ascends in power | Dark ominous power surge, a low demonic choir swell rising into a bright metallic shockwave chime, evil triumphant. Duration ~2s. |
| `sfx-cin-kingdom` | "THE KINGDOM RESPONDS" intro | Heroic royal brass/horn fanfare blast with one heavy war-drum hit, grand and foreboding. ~2s. |
| `sfx-cin-bladelock` | Aldric duel — swords lock | Two heavy swords clashing then grinding in a held lock, sharp metallic scrape with tension. ~1s. |
| `sfx-cin-finalblow` | Aldric duel — decisive strike | One massive decisive sword strike, sharp metallic slash with a deep impact boom and a brief ringing tail. ~1.5s. |
| `sfx-cin-collapse` | Rival showdown — throne collapses | Deep rumbling collapse of stone with debris and dust, ending on a heavy final thud. ~2s. |
| `sfx-cin-verdict` | Rival showdown — verdict sting | A single heavy ominous judgment bell strike with a dark resonant tail, fate sealed. ~2s. |
| `sfx-cin-coin-land` | Gambler coin lands | A single large gold coin landing and spinning to rest on stone, bright metallic clink then wobble settle. ~1s. |
| `sfx-cin-coin-win` | Gambler wins the toss | A triumphant jackpot cascade of gold coins, bright ascending metallic sparkle. ~1.5s. |
| _(8 listed; the ledger holds the canonical set)_ | | |

---

## P2 — Boss signature cues (12) — fix the 18-events-on-4-samples problem
Today every boss shares `sfx-boss-attack` / `sfx-beholder-beam` / `sfx-necro-summon` / `sfx-dark-pact`.
Give each of the 12 a **recognizable signature** matching its committed identity. Suggested new keys
`sfx-boss-<id>`; I'll remap `BOSS_ABILITY_SFX` (`SfxSystem.js:137`) to them when files land.

| Boss (identity) | Signature event | Suggested key | Prompt |
|---|---|---|---|
| Orc — Trophy Hunter | `ORC_TROPHY_THROW_FIRED` | `sfx-boss-orc-throw` | Brutal guttural orc war-bellow then a heavy meaty whoosh and bone-crunch thud as a severed trophy is hurled. ~1.5s. |
| Lich — The Withering | `LICH_CHANNEL_FIRED` | `sfx-boss-lich-wither` | Dry necrotic decay channel, a cold hollow draining hiss with rattling bones and a withering moan. ~2s. |
| Slime King — Mitosis | `SLIME_SURGE_FIRED` | `sfx-boss-slime-surge` | Huge wet gelatinous split and squelch followed by a bubbling gloopy surge. ~1.5s. |
| Beholder — Eye Tyrant | `BEHOLDER_GAZE_FIRED` | `sfx-boss-beholder-gaze` | Crackling concentrated arcane energy beam, high humming charge into a piercing zap. ~1.5s. |
| Beholder — petrify | `BEHOLDER_PETRIFY_FIRED` | `sfx-boss-beholder-petrify` | Stony crystallizing crackle, flesh hardening to rock with a grinding seize and a low thud. ~1.5s. |
| Myconid — The Bloom | `MYCONID_SEED_FIRED` | `sfx-boss-myconid-bloom` | Soft organic fungal burst, a wet spore-puff hiss spreading and a damp earthy bloom. ~1.5s. |
| Demon — Brimstone Pact | `DEMON_SACRIFICE_FIRED` | `sfx-boss-demon-sacrifice` | Dark ritual ignition, a sucking infernal whoosh into a roaring gout of hellfire. ~2s. |
| Golem — Living Fortress | `GOLEM_EARTHQUAKE_FIRED` | `sfx-boss-golem-quake` | Deep grinding stone-on-stone groan into a massive ground-shaking seismic slam and rubble. ~2s. |
| Lizardman — Plague-Bearer | `LIZARD_SPIT_FIRED` | `sfx-boss-lizard-spit` | Wet venomous hawk-and-spit launch with a sizzling corrosive acid hiss on impact. ~1.5s. |
| Vampire — Blood Sovereign | `VAMPIRE_RITE_FIRED` | `sfx-boss-vampire-rite` | Visceral wet blood-draw and pulse, a dark aristocratic whoosh with a deep lifedrain throb. ~2s. |
| Wraith — Dread Harvest | `WRAITH_TERROR_FIRED` | `sfx-boss-wraith-terror` | Ghostly rising wail and chilling spectral shriek, hollow and reverberant, dread-inducing. ~2s. |
| Gnoll — Blood Hunt | `GNOLL_HUNT_FIRED` | `sfx-boss-gnoll-howl` | Feral hyena cackle rising into a frenzied pack war-howl, snarling and bloodthirsty. ~1.5s. |
| Succubus — The Rapture | `SUCCUBUS_KISS_FIRED` | `sfx-boss-succubus-kiss` | Enchanting shimmering charm chime with a breathy seductive whoosh and a soft heartbeat pulse. ~1.5s. |

_Pact-granted generic boss abilities (`PACT_BOSS_HELLFIRE/LIGHTNING/SHOCKWAVE/VORTEX_FIRED`) are
shared across bosses by design — lower priority; they can keep generic cues or get their own later._

---

## P3 — Trap timbres (give traps their own mechanical sounds)
Today traps borrow boss/combat samples (`TRAP_SFX`, `SfxSystem.js:119`). Make them read as machinery.

| Trap | Currently borrows | Suggested key | Prompt |
|---|---|---|---|
| `bomb` | sfx-boss-attack | `sfx-trap-bomb` | A sharp explosive blast, quick fuse pop into a concussive boom with debris. ~1s. |
| `cannon` | sfx-boss-attack | `sfx-trap-cannon` | A heavy cannon firing, deep gunpowder boom with a metallic clang and echo. ~1s. |
| `dragon_trap` | sfx-beholder-beam | `sfx-trap-dragonfire` | A roaring jet of dragon fire, igniting whoosh sustaining into a crackling flame breath. ~1.5s. |
| `spike_pillar` | sfx-take-damage | `sfx-trap-spikes` | Metallic spikes shooting up fast, a sharp shing then a wet impaling thud. ~0.8s. |
| `spike_pit` | sfx-take-damage | `sfx-trap-pit` | A trapdoor giving way and a body dropping onto spikes, wood snap into a wet impalement crunch. ~1s. |
| `rotating_blades` | sfx-melee-2 | `sfx-trap-blades` | Whirling steel blades spinning, a fast metallic whoosh-whir with a slicing edge. ~1s loopable. |
| `saw_blade` | sfx-melee-1 | `sfx-trap-saw` | A grinding circular saw biting, harsh metal-on-metal whirr with a gory rip. ~1s. |
| `shooting_arrows` | sfx-archer-shoot | `sfx-trap-arrows` | A volley of arrows loosing in unison, multiple bowstring twangs and whistling shafts. ~1s. |

---

## P4 — Class ability cues (currently only 3 of these have sound)
Fires on `ABILITY_TRIGGERED` (`SfxSystem.js:482`). Grounded in `adventurerClasses.json`. Suggested keys
`sfx-abil-<id>`. The variant-pool + pitch-jitter engine already handles repetition, so one good clip each.

| Class | Ability | Suggested key | Prompt |
|---|---|---|---|
| knight | Bulwark | `sfx-abil-bulwark` | A heavy shield slamming down to brace, metallic clank with a solid wooden-and-steel thunk. ~0.8s. |
| templar | Lay on Hands | `sfx-abil-layhands` | A warm holy healing chime, soft radiant shimmer with an uplifting bell. ~1.2s. |
| pirate | Plunder Run | `sfx-abil-plunder` | A quick greedy grab of coins and a dash, jingling gold snatch with a whoosh. ~1s. |
| rogue | Vanish | `sfx-abil-vanish` | A soft magical vanish, a quick whoosh-poof into a muffled disappearance shimmer. ~0.8s. |
| mage | Elemental Affinity | `sfx-abil-arcane` | A crackling arcane elemental burst, charged magical energy releasing with a sharp zap. ~1s. (maps to existing `arcane_burst`) |
| cleric | Heal | `sfx-abil-heal` | A gentle restorative chime, soft glowing harp shimmer, comforting. ~1s. (or keep `sfx-cleric-heal`) |
| necromancer | Summon Undead | `sfx-abil-summon` | A dark necromantic summon, low ghostly groan with rattling bones rising from the ground. ~1.5s. (or keep `sfx-necro-summon`) |
| ranger | Piercing Shot | `sfx-abil-pierce` | A powerful charged arrow loosing, deep bow thrum with a sharp whistling pierce. ~0.8s. |
| beast_master | Tame Beast | `sfx-abil-tame` | A commanding whistle/horn call with a beast's answering growl turning loyal. ~1.2s. |
| barbarian | Reckless Charge | `sfx-abil-charge` | A roaring barbarian battle-charge, heavy stomping rush into a body-slam impact. ~1.2s. |
| monk | Riposte / Stunning Palm | `sfx-abil-riposte` / `sfx-abil-stun` | (riposte) a swift cloth-whoosh dodge into a snapping counter-strike; (stun) a sharp focused palm-strike thud with a ringing daze. ~0.6s each. (stunning_palm/riposte already wired to monk samples) |
| bard | Battle Hymn / Crescendo | `sfx-abil-hymn` | A rousing musical flourish, a lute/horn motif swelling brighter as it stacks. ~1.2s. |
| gladiator | Crowd Roar | `sfx-abil-roar` | A swelling arena crowd roar building behind a sharpened blade-ring. ~1.2s. |
| peasant | Strength in Numbers | `sfx-abil-mob` | A gruff mob cheer/grunt of emboldened peasants rallying together. ~1s. |
| valkyrie | Winged Flight | `sfx-abil-wings` | A powerful winged takeoff, feathery wing-beats with a soaring whoosh. ~1s. |
| gambler | Roll the Dice / Double or Nothing | `sfx-abil-dice` | Dice tumbling and clattering to a stop with a tense little chime. ~0.8s. |
| miner | Tunnel | `sfx-abil-tunnel` | A pickaxe biting rock and a crumbling dig-through, earthy crunch with falling rubble. ~1.2s. |

_(`adventurerClasses.json` has 28 class entries; the 17 above are the ones with a standard player
ability block. Event/champion classes — e.g. `cheater` Teleport — and any I couldn't cleanly parse
are TBD; flag them and I'll pull exact ids when we get to them.)_

---

## Quick wins to verify first (no generation needed)
`AUDIO_AUDIT.md` flags samples already loaded but maybe unwired: `sfx-build-1/2/3`, `sfx-minion-place`,
`sfx-build-menu-press`, `sfx-revive-minions`. If those are real files not yet hooked to events, wiring
them is free night-phase/placement feedback — worth checking before generating anything new.
