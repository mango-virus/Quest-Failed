# Quest Failed — SFX Audit (2026-06-23)

> Derived directly from `src/systems/SfxSystem.js`, `src/hud/HudSfx.js`,
> `src/scenes/DeferredAudioLoader.js`, and `src/scenes/Preload.js`. Captures what the
> audio engine already does, where samples are **reused** for many distinct meanings, and
> what is **missing** (mapped in code but no asset, or no cue at all). Pair with
> `RESEARCH.md` (acquisition + the 16-bit pipeline) and `tools/audio/retrofy.mjs` (styler).

## ✅ STATUS 2026-06-23 — ORIGINAL RECORDED SOUNDS KEPT + 8-BIT CHIPTUNE FOR EVERYTHING NEW
Final direction (user, 2026-06-23): **keep the original recorded SFX the game already shipped; use
8-bit chiptune only for sounds that were NEW, reused, or missing.**
- **KEPT as original recordings** (~48): all the pre-existing dedicated SFX — combat (melee/monk/archer/
  mage/beholder-beam/boss-attack/boss-death/take-damage/death/human-hit/die), abilities with their own
  sound (cleric-heal/revive/revive-minions/necro-summon), world/build (gold/chest/doors/teleport/
  remove-room/minion-place/build-1-3/dark-pact), phase/notify (day-start/end, boss/minion-levelup,
  event-notif/boss, scrub-intel), dialogue (book-open/speech/score-countup), and UI (cursor-click/
  btn-hover/btn-click/unlock-reward/unlock-achievement/error). `DeferredAudioLoader` + `Preload` point
  back at the original files. PACT-petrify reuses the beholder-beam recording again.
- **CHIPTUNE (56 synthesized, `tools/audio/chiptune.mjs`)** — only the new/reused/missing: 13 boss
  signatures (fixed the old 18-on-4 reuse), 8 cinematic stingers, 8 trap timbres, 17 ability cues
  (previously silent/reused), + 11 gap-fills (opening FlipCinematic FLIP/assault, victory, wave-start,
  legendary, arrival alert, act-clear, overtime, summary, duel-begin, defect, casualty).
- **Background music** left as-is throughout.

`npm test` 50/50; all 112 deferred + 6 UI loader paths resolve; no unresolved keys. Soundboard scans
the 56 chiptune files (the recordings aren't shown — they're the known originals).

🎉 **COMMERCIAL-SAFE — no swap needed.** Synthesized audio is original; the free-tier-AI clips
(archived, unused, in `assets/audio/_raw/`) and the `retrofy` crusher path are superseded. The
earlier "swap before commercial" obligation is GONE. `ai-placeholders.json` now tracks these as
`synth-original`. `npm test` = 50/50.

To tune a sound: edit its SPEC in `tools/audio/chiptune.mjs` → `npm run audio:chiptune` →
`npm run audio:board` → reload http://localhost:8767/tools/audio/soundboard.html.
The historical gap analysis below is kept for reference.

## The engine is already strong — do NOT rebuild it
`SfxSystem` + `HudSfx` already implement the anti-repetition toolkit the research recommended:
- Per-play **pitch (±200¢) + volume (±10%) jitter** on a `PITCH_VARY` set (`SfxSystem.js:620`),
  with UI / musical stings deliberately excluded so signature cues stay crisp.
- **Variant pools with avoid-immediate-repeat** (`_pickVariant`, `SfxSystem.js:639`) — used by
  Human_Hit (×3) and Human_Die (×2).
- Per-cue **rate-limiting / cooldowns**, **positional pan + distance attenuation** (`_spatial`),
  **window-focus drop** (no backlog burst on return), and a **delegated HUD click/hover** layer.

The gap the user flagged ("missing SFX / same effect for many things") is therefore an
**asset-acquisition + wiring** problem, not an engine problem.

---

## 🔴 Reuse hotspots — one sample, many distinct meanings
Highest priority = the boss line: **18 boss signature events share just 4 samples**
(`BOSS_ABILITY_SFX`, `SfxSystem.js:137`). For a game pitched on "12 distinct bosses," giving
each boss a recognizable sonic identity is the biggest perceived-quality win.

| Sample (file) | Distinct things it currently plays | ~Count |
|---|---|---|
| `sfx-boss-attack` (boss attack1.mp3) | boss melee, boss-fight-start, **bomb trap**, **cannon trap**, Final Breath, Gnoll Hunt, Golem Earthquake, Orc Trophy Throw, Hellfire, Shockwave, Slime Surge, duel ult, duel finalblow | **~13** |
| `sfx-dark-pact` (dark pact menu open.wav) | Demon Sacrifice, Succubus Kiss, Vampire Rite, Wraith Terror, **night transition**, pact sealed, pact popup | **7** |
| `sfx-beholder-beam` (beholder eye beam.mp3) | **dragon trap**, Beholder Gaze, Beholder Petrify, Lizard Spit, Lightning | **5** |
| `sfx-necro-summon` | Lich Channel, Myconid Seed, miniboss promoted, necro summon | 4 |
| `sfx-error` (error.wav) | build error, intel leaked, **coin-loss**, HUD denied, HUD danger-click | 4 |
| `sfx-chest-open` | chest open, mimic sprung, **HUD tab-flip**, **HUD panel-open** | 4 |
| `sfx-collect-gold` | gold pickup, **coin toss**, **coin win** | 3 |
| `sfx-take-damage` | generic hurt, **spike_pillar trap**, **spike_pit trap** | 3 |
| `sfx-door-unlock` | boss leveled up, **bounty posted** | 2 |
| `sfx-boss-death` | boss death, **game-over burn-in**, **HUD demote** | 3 |

Note: pitch jitter on the combat-tagged ones (boss-attack, beholder-beam, take-damage) softens
the repetition *within* a wave, but it does not make a trap sound *different from* a boss ability —
they're still the same timbre. Differentiation needs distinct samples.

---

## 🔴 Missing — mapped in code but silent (no asset loaded)
- **9 cinematic apex stingers.** Mapped in `HudSfx.js` to `sfx-cin-*` keys that are in **neither**
  loader → `playUi` silently no-ops. The marquee moments play nothing: `cin_ascension`,
  `cin_kingdom`, `cin_bladelock`, `cin_finalblow`, `cin_collapse`, `cin_verdict`, `cin_coin_land`,
  `cin_coin_win`. **High visibility — these are hero beats (Ascension, the duel final blow, Kingdom
  Response, the Rival showdown, the Gambler coin).** (3 dead cues — `cin_arise`/`cin_duty`/`cin_lb3`,
  leftovers from the removed Solo Leveling / Light Party IP events — were deleted 2026-06-23.)

## 🔴 Missing — no cue wired at all
- **~22 of 25 adventurer-class ability cues.** `_onAbilityTriggered` (`SfxSystem.js:482`) only maps
  `arcane_burst`, `stunning_palm`, `riposte`. Every other class ability (Miner tunnel, Valkyrie
  flight/rally, Gladiator roar, Gambler dice, Bard crescendo, Barbarian charge, Ranger pierce,
  Knight bulwark, etc.) is silent.
- **Per-family minion attack timbre.** `_onCombatHit` plays generic melee for all minions —
  code comment: *"Generic melee for now — minion data carries no per-family attack type."* 18
  families all swing with the same two melee samples.

## 🟡 Loaded but possibly unwired (verify → free wins)
Declared in `DeferredAudioLoader.js` but not obviously referenced by an event handler — confirm
usage, then either wire or drop:
`sfx-build-1/2/3`, `sfx-minion-place`, `sfx-build-menu-press`, `sfx-revive-minions`,
`sfx-book-open`, `sfx-speech`. (Build/placement cues especially would add satisfying night-phase
feedback if not already wired.)

---

## ⚠ Development placeholder policy (decided 2026-06-23)
The game is **pre-commercial / in active development**, so **free-tier ElevenLabs (and similar)
AI audio is being used as PLACEHOLDER** to get the feel as we build — this is within free-tier's
non-commercial terms while the game isn't sold/distributed. **Before going commercial, every
free-tier/placeholder clip MUST be swapped** for a license-clean source (paid ElevenLabs, Sonniss,
Freesound CC0, or a paid pack).

The swap checklist + tracking ledger is **`assets/audio/ai-placeholders.json`** — every placeholder
clip gets an entry (`status: placeholder`, `tier: PLACEHOLDER`). **Do not ship commercially with any
entry not marked `final`.** Workflow per clip: generate free → drop in `assets/audio/_raw/` →
`npm run audio:retrofy` → place at the entry's path + add the loader line → update the ledger entry.

## Acquisition + styling (see RESEARCH.md for license detail)
- **Licensing reality:** free-tier ElevenLabs output is **non-commercial only** — cannot ship in a
  paid Steam game. Paid tier (~$5/mo) grants royalty-free commercial rights, and rights **persist on
  paid-era generations after downgrading** → subscribe one month, batch-generate, cancel (~$5 total).
- **Free/clean alternatives:** Sonniss GDC bundle (royalty-free, no attribution, ⛔ never feed into
  AI), Freesound **CC0** (safe), Beep Yeah! 8-Bit pack (~$4.99 royalty-free), SubspaceAudio 1000
  Retro (CC-BY, needs credits).
- **16-bit styling:** drop any acquired clip into `assets/audio/_raw/` and run `npm run audio:retrofy`
  → it downsamples to 16 kHz + bit-reduces + low-passes to match the pixel art (tunable; see the
  tool header). For hero cues, a true BRR codec pass is more authentic.

---

## Prioritized "what to do" (build order)
1. **9 cinematic stingers** — highest visibility-per-effort; they're already wired, just need assets
   named `sfx-cin-*` added to `Preload.js`/`DeferredAudioLoader.js`.
2. **Boss signature identities** — split the 18-on-4 sharing so each of the 12 bosses has a
   recognizable signature cue (or at least per-archetype: beam / summon / slam / ritual variants).
3. **Trap timbres off the boss/beholder samples** — bomb/cannon/dragon/spike currently borrow boss
   ability sounds; give traps their own mechanical timbres.
4. **Adventurer ability cues** — fill in the ~22 silent class abilities (pool + jitter handles variety).
5. **Per-family minion attack timbre** — needs a small data field (attack type per family) + samples.
6. **Verify + wire the 🟡 loaded-but-unused** build/placement cues (cheap, satisfying night-phase feel).
