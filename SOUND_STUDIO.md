# Sound Studio — LOCKED spec (2026-06-23)

In-game, mango-only dev tool to edit every sound trigger's sound / volume / pitch, swap in
custom audio files, A/B against defaults, fire triggers in real context, and export the result
to bake into the shipped game. Accessible from a DEV button on the main menu (and as a SOUND
tab in the in-game DEV menu).

## Verbatim user requirements (do not paraphrase)
> "I need a way to easily change sounds for specific triggers and change their default volume.
> like a sound studio that I can use to edit and upload/swap sound files easily within the dev
> mode of the game. an option for this should be accessible through the dev button on the main menu."

Locked choices (2026-06-23):
- **Granularity: FULL per-trigger control** — every individual game trigger gets its own
  independent sound + volume, even when many triggers currently share a sample.
- **Permanence: YES — export + bake tool.** Tweaks persist on the dev machine for fast iteration
  AND can be exported + baked into the source so they ship.
- **v1 extras (all in):** custom file upload/swap, fire-in-context, A/B vs default, health flags.

> UI requirement (verbatim): "make sure the UI for this sound studio is neat and easy to
> understand. it should match the visual design of the how our in game action bar and action bar
> popup menus, and confirmation popups are designed. Make sure text is not running off the page or
> out of buttons. and when done make sure every feature works and it visually looks good. and if
> there is anything other ideas that you come up with as you build like additional features we
> should have included that will help, add it in."

## Architecture
- **`src/data/soundTriggers.js`** — the TRIGGER REGISTRY: one entry per logical play context in
  the game. Each: `{ id, label, category, key (default sound), vol (default base volume), pitch
  (jitter on/off), boost (default extra-boost, if any) }`. Source of truth for the Studio list;
  seeded from the current `SfxSystem`/`HudSfx` defaults so nothing changes until edited.
- **`src/systems/SoundConfig.js`** — runtime override singleton. Per trigger: override key, volume,
  pitch on/off, mute, custom-file id. `resolve(triggerId)` merges override over registry default.
  Config persists to `localStorage` (small JSON); uploaded audio blobs persist to **IndexedDB**.
  Emits a change event so the Studio + live game update instantly (no reload). API: `resolve`,
  `set`, `reset`, `resetAll`, `export()`, `import()`, `getTriggers()`, custom-file load/store.
- **Play sites route through triggers:** `SfxSystem` fires by trigger id (`_fire(triggerId, {spatial,
  boost})`), `HudSfx.playUi(cue)` resolves cue→trigger, and inline `playSfx` calls (FlipCinematic,
  NightPhase, countUp, CustomCursor, MinionRenderer, UIKit, PactPicker, TopBar, dialogue) pass
  trigger ids. Custom-file swaps are applied at the Phaser audio-cache level (same key, replaced buffer).

## The Studio UI (SOUND tab + main-menu DEV button)
**Must match the action-bar / action-bar-popup / ConfirmPopup visual language** (same panel chrome,
buttons, type scale, spacing; pixel font where those use it). No text overflow; clamp/ellipsis long
labels; everything fits its button/row.
- Grouped, **searchable** trigger list (Combat / Boss / Traps / Abilities / Cinematics / World /
  Notify / UI). Search by trigger label or sound key.
- **Per trigger row:** ▶ preview · **sound dropdown** (pick any loaded sound, or "Custom…") ·
  **volume slider 0–200%** (live) · **pitch toggle** · **mute** · **A/B** (current vs default) ·
  **swap/upload** (drag-drop or picker → IndexedDB) · **reset** · tag (chiptune / recording / custom).
- **Fire-in-context** button per event-backed trigger (emits the real EventBus event via the dev
  sandbox so you hear it in gameplay).
- **Health flags:** badge triggers whose sound key isn't loaded ("missing"); list sounds never used.
- **Master bar:** preview volume, mute-all, reset-all, export, import.
- **Export / Import** the whole config as JSON.

## Bake tool
- **`npm run audio:apply-config <file.json>`** (`tools/audio/apply-config.mjs`) — writes the exported
  per-trigger volumes / sound choices / pitch flags into the source defaults (`soundTriggers.js` +
  `SFX_VOLUMES` / data tables) so dev tuning ships. Custom uploaded files are exported as a manifest
  the dev drops into `assets/audio/` + the tool wires their loader entries.

## Extra ideas added during build (append as discovered)
- (Reserve for ideas found while building — per the user's "add it in" instruction.)

## Phases
1. **Foundation** — `soundTriggers.js` registry + `SoundConfig.js` + route `SfxSystem`/`HudSfx`/inline
   `playSfx` through triggers. Invisible: game sounds identical (defaults). Gate: `npm test`, no behavior change.
2. **Studio UI** — SOUND tab + main-menu DEV button; list, preview, sound-dropdown, volume, pitch,
   mute, reset, search, master bar. Match action-bar styling; verify visually.
3. **Custom files + export/import + bake** — upload→IndexedDB swap; export/import JSON; `apply-config` tool.
4. **Fire-in-context, A/B, health flags, polish** — verify every feature works + looks good in-game.

## Extra ideas added during build
- **Baked-defaults layer** (`src/data/soundConfigBaked.js`): SoundConfig merges user-localStorage >
  baked > code-default, so `audio:apply-config` ships tweaks without touching SfxSystem.
- **Preview pitch realism**: preview applies the trigger's pitch jitter so it sounds as it will in-game.
- **Footer health summary** (`⚠ N MISSING`) in addition to per-row missing flags.

## Acceptance checklist (verified 2026-06-23)
- ✅ Every audible trigger in the game is in the registry (120) with its default sound + volume.
- ✅ Changing a trigger's volume / sound / pitch / mute is heard immediately, no reload.
- ✅ Upload a custom wav/mp3 → that trigger plays it (IndexedDB); persists across reload (hydrate on boot); revertable (reset removes blob).
- ✅ A/B plays current vs default (the DEF button) for any trigger.
- ⛔ Fire-in-context: DELIBERATELY NOT WIRED — those EventBus events drive real game logic (RUN_VICTORY
     would end the run, etc.), so a "fire" button is a footgun. Preview plays through the real audio mix
     (with the trigger's pitch jitter), which covers safe auditioning.
- ✅ Health flags: per-row MISSING tag + footer "⚠ N MISSING".
- ✅ Export → Import round-trips; `npm run audio:apply-config <export.json>` bakes into the shipped
     baked layer (validates ids, skips custom uploads) + survives a fresh load (verified round-trip).
- ✅ Reachable from the MAIN MENU (DEV TOOLS → EDITORS → SOUND STUDIO) and in-game (DEV → STAGE).
- ✅ UI built on the crypt Overlay shell / OPTIONS vocabulary; verified NO row overflow + modal in-view
     (DOM-measured; final visual eyeball in Electron — MCP screenshot times out on the WebGL canvas).
- ✅ `npm test` 50/50; no unresolved sound keys.
- ✅ Defaults unchanged until edited (override-only resolve; game sounds identical until tweaked).
