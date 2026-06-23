# Quest Failed — Enhancement Research (2026-06-23)

> Deep-research output: dungeon-builder/reverse-roguelike genre study, premium-roguelike
> retention (meta-progression + build depth), UI/UX, and 16-bit sound design + SFX
> acquisition. Harness: 105 agents, 23 sources fetched, 84 claims extracted, 25
> adversarially verified (21 confirmed / 4 killed). Findings are mapped to QF's actual
> systems. **Read the confidence grades — evidence strength is uneven.**

## Confidence grades (trust calibration)

- 🟢 **Sound design + licensing — rock solid.** Primary sources (Unity Learn, ElevenLabs
  ToS, Sonniss EULA, Freesound FAQ, Creative Commons legal text), unanimous 3-0 votes.
  Legally reliable for a commercial Steam release. Act directly.
- 🟡 **Genre + retention — sound but secondary.** Review-site opinions (CBR, GameRant,
  TheGamer, FingerGuns), not primary design docs. Good lessons, not gospel.
- 🔴 **UI/UX — no external evidence survived.** Every UI claim was killed in verification.
  Use our own `UI_POLISH_PLAN.md` / HUD-redesign work, not this report, for UI direction.
  Needs a dedicated second research pass.

---

## 1) Genre study — dungeon-builder / reverse-roguelike

**Validated:** QF's two-phase build/night-combat loop is *proven territory* — Legend of
Keepers runs the same shape (manage/upgrade phase ↔ combat phase, monsters with unique
moves + passives). The loop shape is not the risk.

**The risk to design against (high confidence):** the genre's signature failure —
"build→upgrade→build is fun for the first few hours, then wears thin from repetition and
under-rewarding meta-progression." (CBR, FingerGuns reviews of Legend of Keepers.)

**Loop Hero is QF's closest spectator-satisfaction analog.** Its central tension ports
directly: build the dungeon **lethal enough** to maximize gold/loot, but **not so lethal**
adventurers die before generating value — a self-imposed risk/reward dial. Loop Hero backs
this with concrete tradeoff tiles (mountain: +HP but spawns goblins; village: heals but
attracts bandits). *(medium confidence on the spectator-model framing — 2-1 vote.)*

### What QF should do
1. **Make minion/trap/room choices visible tradeoffs, not pure power-ups** — more reward =
   more risk of losing the kill or loot. We have the bones via boss banked-resource
   economies (Vampire BLOOD, Wraith DREAD); extend tradeoff *legibility* to room/trap placement.
2. **Front-load anti-tedium systems** — this is exactly what the parked Endless meta-game
   (Infamy cash-out + Wrath difficulty ladder) was designed to fix. The research is a direct
   argument to un-park it.
3. **Lean into the spectator payoff** — readable stacking synergies + visible escalating
   kill-numbers. "Watching numbers go up" *is* the product for this genre.

**Killed claims — do NOT build on these:** that Legend of Keepers fails because missions are
too easy (0-3 refuted); that it has almost no run variety (1-2 refuted).

---

## 2) Retention — meta-progression & build depth (premium, not F2P)

**Hades' Mirror of Night is the verified gold standard.** Two principles, both confirmed 3-0:

1. **Linear, progressive unlock order** — don't dump the whole tree on the player at once;
   reveal complexity gradually, funded by a run-earned persistent currency. (Minor source
   correction: Hades' anti-overwhelm gating is via Chthonic Keys; Darkness funds purchases.)
2. **Cheap, full respec** — Hades refunds *all* meta-currency for 1 key, so players
   experiment costlessly between runs. Biggest driver of run-to-run build variety, and the
   exact weakness Legend of Keepers was dinged for.

### What QF should do
- Structure boss/minion meta-upgrades as a **clear linear ladder**, funded by **Infamy**
  (already-spec'd persistent currency). Gate later rows behind progress, not exposed day one.
- **Full free respec of meta-investment between runs.** Cheap to build, highest-leverage
  retention lever in the report. Converts 12 bosses × 18 minion families into a "try a
  totally different dungeon strategy each run" engine.
- Keep meta **light enough not to trivialize skill** — reviews warn an over-rewarding tree
  makes losses feel cheap. Aligns with our "what did it earn me" + systems-integration mandate.

**Killed claim — do NOT build on this:** the "purple vs green reversible Mirror variant"
toggle detail (0-3 refuted; that specific mechanic doesn't exist as described).

---

## 3) UI/UX — evidence thin; use our own plan

No external UI claim survived verification. Actionable direction: **execute the work already
spec'd in `UI_POLISH_PLAN.md`** — action-bar fly-out panels, construction ribbon,
crypt-console HUD cohesion pass. This report adds no externally-validated UI weight. A real
UI research pass needs its own scope (specific games' build-UI / run-summary / bestiary screens).

---

## 4) Sound design + 16-bit SFX acquisition (strongest section)

### Anti-repetition is an engineering pattern, not per-asset authoring
QF reuses the same effect for many things. Fix it centrally. Three verified techniques:

1. **Variant pools + "avoid repeating the last N"** — keep a small pool of clips per logical
   event; pick so at least 2 others fire before any repeats (Unity Audio Random Container's
   exact rule). QF already routes everything through `SfxVolume.playSfx()` → add a pooled
   chooser with an exclude-last-N ring buffer. (Primary: Unity Learn, 3-0.)
2. **Per-play volume + pitch jitter** — verified recipe: ~±2 dB volume, small pitch jitter
   (Unity demo uses ±500 cents; stay tighter ~0–200 cents / 0–2 semitones for naturalness).
   Phaser exposes per-sound `rate`/`detune`/`volume` → implement in `playSfx()`. (Primary:
   Unity Learn + Game Developer, 3-0.)
3. **⚠️ Don't jitter signature cues** — a coin-pickup-style sound must stay recognizable;
   pair jitter with real variants instead.

### Acquisition stack — licensing verified for a COMMERCIAL Steam release

| Source | Commercial? | Attribution? | QF verdict |
|---|---|---|---|
| **Sonniss GDC Bundle** | ✅ royalty-free, worldwide, unlimited projects for life | ❌ none | **Best free source.** Games explicitly permitted; "sold as incorporated into licensee project" OK. ⚠️ **Do NOT feed into an AI/ML pipeline — training use is barred.** Embed directly. |
| **Freesound CC0** | ✅ (even resale) | ❌ none | Safe. Verify per-sound badge. CC0 doesn't waive trademark. |
| **Freesound CC-BY** | ✅ | ⚠️ **required** — credits entry in build | Usable; track attributions + "indicate if changes made." |
| **Freesound CC-BY-NC** | ❌ **banned** | — | A paid game is commercial revenue. Do not use. |
| **ElevenLabs text-to-SFX** | ✅ **PAID plan only** | ❌ none | Prompt → 4 samples in seconds (MP3/WAV). ⚠️ Free-tier output is non-commercial; commercial rights attach only to SFX generated *while on a paid plan* (persist after downgrade). Standalone resale of the raw files is barred — irrelevant, QF bakes audio in. |

### What QF should do (priority order)
1. **Build the pooled chooser + jitter into `SfxVolume.playSfx()` first** — biggest quality
   win, fixes the reuse problem game-wide, touches one file.
2. **ElevenLabs (paid) for missing cues** — 4-variants-per-prompt feeds the variant pools
   naturally. Prompt → pick best → downsample/bitcrush to 16-bit. Slot into `DeferredAudioLoader`.
3. **Sonniss bundle for foundational/ambient SFX** — free, clean; embed directly (never via AI).
4. **Freesound CC0** to fill gaps; maintain a credits list if any CC-BY is used.

---

---

## Follow-up pass (pass B, 2026-06-23) — answers to the open questions

Second harness: 111 agents, 28 sources, 76 claims, 25 verified (24 confirmed / 1 killed).
Resolved Q2/Q3/Q4 strongly; **Q1 (UI build/placement) came back thin again** — see gap below.

### Q1 — UI/UX (PARTIAL; build/placement still under-evidenced)
Only two UI claims survived adversarial verification. The screenshot-gallery / designer-blog
sources for build-UI, result screens, codex gating, and "juice" produced **no falsifiable
claims that passed** — so QF should continue to lean on `UI_POLISH_PLAN.md`, not external data,
for those.

- 🟢 **Onboarding (high):** NN/g is unanimous — upfront tutorials aren't memorable, don't
  improve task performance, and short-term memory of instructions decays in ~20s; showing many
  tips at once causes *faster* dismissal (paradox of the active user). Use **contextual,
  one-hint, learn-by-doing**, visuals over text. (CHI 2012: contextual tutorials raise playtime
  ~29% in complex games.) → **This directly validates our locked Onboarding overhaul**
  (coach-marks + ghost-cursor + companion-as-mentor as just-in-time hints on BUILD/PLACE/night
  steps). Build it; don't revert to an upfront text wall. Sources: nngroup.com/articles/onboarding-tutorials, /mobile-instructional-overlay.
- 🟡 **Keyword tooltips (medium):** Slay the Spire keywords = small icon + bold term + a 1–2
  sentence definition, available on hover *and* pinned, with nested keywords. → QF: make
  **Nerve, minion behaviors (home/patrol/roam), and boss banked-resources** bolded keywords
  with icon + one-line tooltips, nestable. Source: StS fan keyword data model (mirrors in-game).

### Q2 — The 16-bit SFX styling pipeline (🟢 high, primary-sourced)
A plain bitcrush is **wrong**. Authentic SNES character = three stacked steps:
1. **Downsample below 32000 Hz.** SNES hardware caps at 32 kHz and most real samples ran
   **8–16 kHz**. Target **~16 kHz** for that era feel (lower = grittier).
2. **4-bit BRR/ADPCM quantization.** BRR is 32:9 compression — 9-byte blocks of sixteen 4-bit
   nibbles, header bits select one of 4 ADPCM prediction filters (~4:1, 4 bits/sample). The
   nibbles are ADPCM *residuals*, so a true emulation needs an ADPCM codec, not just bit-depth
   reduction. (A generic bitcrusher like Kilohearts gives a *similar* lo-fi feel but does **not**
   model SNES — that claim was refuted 0-3.)
3. **High-frequency low-pass (~8–11 kHz)** to mimic the SNES Gaussian interpolation filter.

**Practical QF recipe (batch a folder of WAVs, free tools):**
- Quick/"good enough": `sox in.wav -r 16000 -b 16 out.wav lowpass 9000` then a bit-depth/decimation
  bitcrush (Audacity → *Effect ▸ Bitcrusher*, or a VST) for the quantization grit. ffmpeg
  equivalent for the resample/low-pass: `ffmpeg -i in.wav -ar 16000 -af "lowpass=f=9000" out.wav`.
- Authentic: run clips through a **real BRR codec** (e.g. `snesbrr` / `BRRtools`) — encode to
  `.brr` then decode back to WAV to bake in the genuine ADPCM artifacting.
- Pipeline: ElevenLabs (4 variants) → pick best → BRR/decimate + low-pass → drop the variant set
  into the SFX variant pool (§4 anti-repetition). Sources: snes.nesdev.org/wiki/BRR_samples,
  wiki.superfamicom.org/bit-rate-reduction-(brr), samplemance.rs/snesguide.

### Q3 — Paid retro-SFX packs, license-verified (🟢 high)
| Pack | Contents | Price | License | QF verdict |
|---|---|---|---|---|
| **Beep Yeah! 8-Bit SFX Pack** (beepyeah.itch.io) | 100+ 8-bit sounds | ~$4.99 (min) | royalty-free commercial, no generative-AI use | **Safest drop-in** — no attribution burden. |
| **SubspaceAudio "1000 Retro Sound Effects"** (subspaceaudio.itch.io) | 1000 retro sounds, broad coverage | paid | **CC BY 4.0** — commercial + editing OK, **attribution required** | Broadest; needs a credits-screen line. (Note: their *free* CC0 packs are different products.) |

⚠️ Caveats: itch grants are tag-style, not full EULAs; prices are sale-volatile; CC-BY is a
compliance task (maintain a credits entry). Sources: the two itch store pages above.

### Q4 — Endless meta-game tuning, benchmarked (🟢 high)
- **Hades Mirror of Night:** run-earned **Darkness** currency funds upgrades; talents unlock in
  **escalating key-gated tiers** (Chthonic Keys gate later rows); **near-free full respec** (1
  key, full Darkness refund).
- **Slay the Spire Ascension:** a **20-rung, win-gated, cumulative** ladder — each rung adds a
  modifier *and keeps all prior ones*. Mid-ladder rungs specifically **attack the economy**: cut
  healing, lower starting HP, add a curse, remove a potion slot, **cut boss gold**, raise shop
  prices — not just "enemies have more HP."

**→ What QF should do (Infamy + Wrath):**
1. **Infamy = run-earned, scarce key-resource gates the tiers.** Two-currency model like Hades:
   a flowing currency (Infamy) buys nodes, a scarcer resource gates *which tier* you can reach,
   so depth is paced by play, not just grind.
2. **Near-free full respec of Infamy between runs** (refund all) — the single biggest build-variety
   lever (already in §2).
3. **Wrath ladder = win-gated + cumulative**, modeled on Ascension. Crucially, **escalate by
   squeezing the economy, not only buffing adventurer HP**: cut gold-per-wave, raise minion/upgrade
   costs, add adventurer perks/curses, shrink build budget. This keeps skill mattering instead of
   becoming a stat check (avoids the "trivialize skill" trap).
4. **Tier depth:** mirror Hades' ~4 escalating tiers before plateau; let Wrath rungs (aim ~15–20)
   be the long-tail "one more run" hook for the 40+ day late game.
Sources: hades.fandom.com/wiki/Mirror_of_Night, slay-the-spire.fandom.com/wiki/Ascension,
Dead Cells difficulty analysis (medium.com).

### Still open after pass B
- **Build/placement UI specifics** (radial vs hotbar vs drag-tray, ghost-preview, grid snapping,
  affordability feedback), result-screen contents, and codex gating — no external evidence
  survived two passes. Decide these from `UI_POLISH_PLAN.md` + playtest, not research.
- **Exact best BRR batch tool** for QF's workflow — pick during the audio sprint (snesbrr vs
  BRRtools vs sox+Audacity) by ear on real QF clips.

## Caveats
- Re-confirm ElevenLabs' paid-plan commercial clause + standalone-resale carve-out at ship
  time (verified vs. March 2026 ToS; vendor terms change).
- Genre/retention findings are review opinions, not primary design documentation.

## Sources (surviving / cited)
- Unity Learn — Audio Random Container (primary): https://learn.unity.com/tutorial/the-basics-of-the-audio-random-container
- Game Developer — The Power of Pitch Shifting: https://www.gamedeveloper.com/audio/the-power-of-pitch-shifting
- ElevenLabs — Sound Effects (primary): https://elevenlabs.io/sound-effects
- Sonniss — GDC bundle + EULA (primary): https://gdc.sonniss.com/ , https://sonniss.com/gdc-bundle-license/
- Freesound — FAQ (primary): https://freesound.org/help/faq/
- Creative Commons — CC0 / CC-BY 4.0 legal text
- CBR — Legend of Keepers review: https://www.cbr.com/legend-of-keepers-game-review-roguelike/
- FingerGuns — Legend of Keepers review: https://fingerguns.net/reviews/2021/04/29/legend-of-keepers-review-pc-a-reverse-dungeon-crawler/
- GameRant — Loop Hero review: https://gamerant.com/loop-hero-review/
- TheGamer — Hades Mirror of Night: https://www.thegamer.com/hades-mirror-of-night-roguelite-progression/
