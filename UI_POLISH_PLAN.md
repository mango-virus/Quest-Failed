# UI Polish & Accessibility Plan

> The burn-down backlog for bringing the UI from "polished game" to "polished **Steam**
> product." Derived from a 5-area UI review (2026-06-18). Source of truth for this
> initiative — work items **one at a time**, in phase order.
>
> **Verification target = Electron** (the MCP browser preview's scale/screenshot is
> unreliable for layout — see [[feedback_quest_failed_electron_primary]]). The Electron
> app serves live `src/`, so an in-app reload picks up edits.

## How to use this doc

**Per-item lifecycle (never more than one item open):**
1. **Deep-spec** the item — expand its acceptance bullets into a concrete checklist; capture
   any user decision **verbatim** (CLAUDE.md spec-fidelity rule). Surface ambiguities and
   get a yes before building.
2. **Build** it.
3. **Verify** in Electron against the checklist (+ `npm run sim`/lint where relevant).
4. **Tick** the acceptance boxes, set status ✅, **commit** that item by explicit path.
5. Move to the next item.

**Status legend:** ⬜ todo · 🔨 in progress · ✅ done · ⏸ deferred
**Effort:** S (≲1 sitting) · M · L (multi-sitting)
**File paths below are starting points** — confirm/expand them during deep-spec; code is truth.

## Progress

| Phase | Items | Done |
|---|---|---|
| 0 — Foundation & sweep | 7 | 3 |
| 1 — Input & accessibility | 7 | 0 |
| 2 — Hero moments & game feel | 6 | 0 |
| 3 — Discoverability & onboarding | 5 | 0 |
| 4 — Final discipline | 3 | 0 |

---

## Phase 0 — Foundation & sweep
*Fast, low-risk. Removes the "broken bits" that most undercut the full-game feel and lays foundations (z-index tokens) the later phases lean on.*

### P0-1 — Delete dead HUD modules `[S]` ✅ *(a5d4753e)*
- **Problem:** Five fully-built modules are imported by nothing (cruft; one carries a latent stat bug).
- **Acceptance:**
  - [x] Removed `MinionInspectorOverlay.js`, `TitlePickerOverlay.js` (+ its `styles.css` block), `ArchetypeDecorOverlay.js`, `JamPortalCorner.js`, `HotkeyHints.js` — plus the dangling `HotkeyHints` import in `HudRoot.js` and the dead HotkeyHints CSS block.
  - [x] Grep confirms zero remaining imports/instantiations or orphaned CSS classes.
  - [x] Game boots + main menu + in-game HUD mount clean, zero console errors (Electron-path preview).
- **Files:** `src/hud/{MinionInspectorOverlay,TitlePickerOverlay,ArchetypeDecorOverlay,JamPortalCorner,HotkeyHints}.js`, `src/hud/HudRoot.js`, `src/hud/styles.css`.

### P0-2 — Purge stale `qf-mm-*` menu CSS `[S]` ✅ *(pending commit)*
- **Problem:** The pre-2026-06-09 main-menu generation's CSS (`qf-mm-*`: logo/slab/identity/playername/titlepill/items) is dead — the active menu uses `qcm-*`.
- **Acceptance:**
  - [x] Removed the two dead `qf-mm-*` chunks (454 lines) — spliced around the **live** interleaved `.qf-devtools-*` (DevToolsOverlay) block. **Kept** `@keyframes qf-mm-item-new-pulse-static` + its 3 uses — that's LIVE (Achievements/CompanionSelect/Leaderboard "NEW" chips); only its name carries the old prefix.
  - [x] Repointed the 2 `HudSfx.js` `.qf-mm-item` selectors → `.qcm-item` (the active menu item class).
  - [x] Main menu visually identical in Electron-path preview (full-res screenshot), zero console errors.
- **Files:** `src/hud/styles.css`, `src/hud/HudSfx.js`.

### P0-3 — Fix dead-feel paths `[M]` ✅ *(pending commit)*
- **Problem:** Several surfaces present controls/data that do nothing or never populate, reading as broken.
- **Acceptance:**
  - [x] **SCRUB INTEL** was already wired (`KnowledgeSystem._onScrubRequest` debits gold + scrubs intel) — the "inert" comment was stale; updated it. Button kept.
  - [x] **FullLog LOSSES/LEVELS filters** removed (no event source populates `minion-fell`/`wound`/`level`); ALL/KILLS/LEAKS/PACTS remain — verified live.
  - [x] **KnowledgeMap placeholders:** removed the fake exposure delta + flat sparkline (+ now-unused `_sparkline`); **LAST LEAK made real** (newest `adventurers.known` lastEscapedDay → shows real "DAY 8", `—` if never). Verified live.
  - [x] **`theme: 'soul'`** → `'blue'` (valid ConfirmPopup theme).
  - [x] **IncomingWave:** added "Build a Library of Whispers to reveal who's coming." hint, shown only when no Library is placed — verified live.
- **Files:** `src/hud/KnowledgeMapOverlay.js`, `src/hud/FullLogOverlay.js`, `src/hud/RightPanels.js`, `src/hud/styles.css`.

### P0-4 — Persist & re-apply fullscreen `[S]` ⬜
- **Problem:** `qf.video.fullscreen` is saved but never re-applied on boot — "saved" setting that's actually session-only.
- **Acceptance:**
  - [ ] On boot, read `qf.video.fullscreen` and apply it.
  - [ ] Toggle → reload (Electron) → state restored.
- **Files:** `src/hud/SettingsOverlay.js`, boot path (`src/main.js` / `desktop/main.js` as needed).

### P0-5 — z-index token band + toast stacking `[M]` ⬜
- **Problem:** ~30 ad-hoc z-index literals (order lives only in comments); toasts at `z:30` sit *below* modals/cinematics so a notification fired during an overlay hides behind it.
- **Acceptance:**
  - [ ] Add a `--z-*` band to `:root` (e.g. chrome / overlay / confirm / cinematic / toast / boot / debug) and migrate the literals.
  - [ ] **Decide & implement** toast layering: either lift toasts into the notification band (above modals, below boot/debug) or deliberately document modal-suppression. *(Decision — capture verbatim.)*
- **Files:** `src/hud/styles.css`.

### P0-6 — Resolve the `?newhud=0` legacy fallback `[M]` ⬜ *(decision)*
- **Problem:** The legacy Phaser *menu* was removed, but `HudScene.js` still branches on `!useNewHud` and the legacy `src/ui/` chrome (`ActionBar`, `BossTopBar`, `BuildMenu`, `MiniMapPanel`, `DungeonLog`) still ships — a half-dead path = latent-bug surface.
- **Acceptance:**
  - [ ] **Decide:** fully retire (delete `!useNewHud` branches + legacy `src/ui/` chrome) or restore an end-to-end fallback. *(Decision — capture verbatim.)*
  - [ ] Implement the decision; game boots + plays clean.
- **Files:** `src/scenes/HudScene.js`, `src/ui/*` (legacy chrome).

### P0-7 — Reconcile stale docs `[S]` ⬜
- **Problem:** `ARCHITECTURE.md §4/§9` still describes the removed dual main-menu + fallback.
- **Acceptance:**
  - [ ] Update `ARCHITECTURE.md` (and `STATUS.md` if affected) to match reality once P0-6 is decided.
- **Files:** `ARCHITECTURE.md`, `STATUS.md`.

---

## Phase 1 — Input & accessibility
*Steam-blocking and the biggest single "feels finished" lever. The action bar is currently mouse-only; the project's own `VISUAL_STANDARDS §7` accessibility reqs are unmet.*

### P1-1 — Keyboard bindings for HUD actions `[M]` ⬜
- **Problem:** No keys for the core action bar (MOVE/SELL/UPGRADE/PLACE/BEGIN-DAY/ROSTER/MAP/INTEL/night-speed) — mouse-only.
- **Acceptance:**
  - [ ] A central handler emits the **existing** EventBus events the buttons already fire (no logic duplication).
  - [ ] Bindings work at night; don't steal focus from DOM text inputs (rename/name fields).
  - [ ] Defaults documented (feed P1-3).
- **Files:** `src/scenes/NightPhase.js` (input) / new central handler; events already in `BottomBar.js`.

### P1-2 — Controller / gamepad navigation `[L]` ⬜
- **Problem:** No gamepad nav anywhere (Steam Deck "Verified" needs it).
- **Acceptance:**
  - [ ] Focus model across HUD chrome + menus; D-pad/stick move, A/B select/back.
  - [ ] Visible focus ring; works on main menu, in-game, overlays.
- **Files:** HUD-wide; likely a new focus/nav manager + `Overlay.js`/`HudRoot.js` hooks.

### P1-3 — Rebindable controls `[M]` ⬜
- **Problem:** Settings CONTROLS tab is view-only.
- **Acceptance:**
  - [ ] Interactive rebinding UI; persists to settings; conflict detection; reset-to-default.
- **Files:** `src/hud/SettingsOverlay.js`, input handler from P1-1.

### P1-4 — Reduced-motion setting + finish fallbacks `[M]` ⬜
- **Problem:** No in-game reduced-motion toggle (only partial OS-media-query coverage); 5 cinematics ignore it.
- **Acceptance:**
  - [ ] Settings toggle (sets `--reduced-motion` / a class) honored alongside `@media (prefers-reduced-motion)`.
  - [ ] Add fallbacks to Aldric / LightParty / Rival / Ascension / CoinFlip cinematics (copy KingdomResponseIntro's block).
  - [ ] Gate chrome juice (treasury count-up, coin spin, day-stamp slam, champion pulse).
- **Files:** `src/hud/SettingsOverlay.js`, `src/hud/styles.css`, the cinematic files.

### P1-5 — Text-size setting `[M]` ⬜
- **Problem:** No text-scaling option (`VISUAL_STANDARDS §7`).
- **Acceptance:**
  - [ ] Settings control scales HUD/menu text legibly without breaking fixed-px layouts.
- **Files:** `src/hud/SettingsOverlay.js`, `src/hud/stageScale.js` / `styles.css`.

### P1-6 — Colorblind / high-contrast `[L]` ⏸ *(stretch)*
- **Problem:** No colorblind/high-contrast palette.
- **Acceptance:** [ ] Optional palette variant(s) selectable in Settings. *(Deferable; revisit after P1-1..5.)*
- **Files:** `src/hud/styles.css` (palette vars), `SettingsOverlay.js`.

### P1-7 — Name input validation `[S]` ⬜
- **Problem:** Name pipeline only checks non-empty — no length floor, profanity filter, or dupe check before a *public* leaderboard.
- **Acceptance:**
  - [ ] Length min/max, profanity filter, dupe/normalization handling, clear inline error.
- **Files:** `src/hud/NameEntryOverlay.js`, `PlayerProfile.setName`.

---

## Phase 2 — Hero moments & game feel
*The cinematic set-pieces are visually rich but uniformly silent and shake-less; VictoryScreen is the most under-invested screen relative to its trailer importance. Tokenize + de-dup these files as we touch them.*

### P2-1 — Audio on cinematic apexes `[M]` ⬜
- **Problem:** Every full-screen cinematic beat is silent (`HudSfx` not imported).
- **Acceptance:**
  - [ ] Cue the marquee beats (ARISE, Aldric blade-lock/final blow, LightParty duty/LB3, Rival verdict/collapse, CoinFlip land/win, DARK ASCENSION) via `HudSfx`, settings-aware + rate-limited.
- **Files:** `AldricCinematic`, `SoloLevelingCinematic`, `LightPartyCinematic`, `RivalShowdownCinematic`, `AscensionCinematic`, `CoinFlipCinematic`, `KingdomResponseIntro`.

### P2-2 — Screen shake + hitstop on apexes `[M]` ⬜
- **Problem:** No shake/freeze-frame on climaxes — they lean on a white flash.
- **Acceptance:**
  - [ ] Each set-piece apex emits a brief shake (+ optional hitstop) via the existing EventBus/camera-shake pattern (`EventFx`/`BossFightOverlay`).
- **Files:** the cinematic files + shake emit path.

### P2-3 — VictoryScreen rebuild `[L]` ⬜
- **Problem:** The trailer moment is static rays + fade-ins, no music, hardcoded hex, no run summary.
- **Acceptance:**
  - [ ] Music cue; particle/`juice` + staggered stat reveal.
  - [ ] Run-summary content + a FULL LOG button (parity with GameOver).
  - [ ] Colors tokenized (retints under boss palettes).
  - [ ] reduced-motion fallback.
- **Files:** `src/hud/VictoryScreen.js`, `styles.css`.

### P2-4 — HP-bar fills → `transform: scaleX` `[S]` ⬜
- **Problem:** Bars animate `width` (jank property) across BossFightOverlay + 4 cinematics; Rival nexus animates `left`/`linear`.
- **Acceptance:**
  - [ ] Convert fills to `transform: scaleX()`; drop Rival's `linear` easing.
- **Files:** `BossFightOverlay.js` + Aldric/Solo/LightParty/Rival, `styles.css`.

### P2-5 — CoinFlip soft-lock fallback `[S]` ⬜
- **Problem:** If `GAMBLER_DOUBLE_RESULT` never arrives, the overlay soft-locks.
- **Acceptance:** [ ] Timeout fallback resolves/closes safely.
- **Files:** `src/hud/CoinFlipCinematic.js`.

### P2-6 — Extract `CinematicKit` + tokenize/clean cinematics `[L]` ⬜
- **Problem:** Beat-label / VS-header / finale-card / mount-dismiss / tracked-timer logic is reimplemented ~4–5× with drift; raw hex + hardcoded ms; Solo letterbox dead code; CoinFlip CSS external + duration-coupled by comment.
- **Acceptance:**
  - [ ] Shared `CinematicKit` (beat, VS header, finale card, mount/dismiss, tracked-timer base) adopted by the big cinematics.
  - [ ] Untracked `setTimeout` removals routed through the kit.
  - [ ] Tokenize durations/hex; self-inject CoinFlip CSS; delete Solo's dead letterbox subsystem.
- **Files:** new `src/hud/CinematicKit.js` + the cinematic files.

---

## Phase 3 — Discoverability & onboarding

### P3-1 — Action-bar tooltips `[S]` ⬜
- **Problem:** The primary control surface (PLACE/MOVE/UPGRADE/SELL/ROSTER/MAP/INTEL/MENU) has no `title`/hover description.
- **Acceptance:** [ ] Each `qf-bb-mode`/`qf-bb-menu` button has a tooltip explaining its tool/semantics.
- **Files:** `src/hud/BottomBar.js`, `styles.css`.

### P3-2 — WelcomeIntro → real onboarding `[L]` ⬜
- **Problem:** The first screen a buyer sees is a 3-paragraph text wall.
- **Acceptance:**
  - [ ] Paced 2–3 step intro with imagery, the core "you are the dungeon" loop, controls reference, and a "what's a Dark Pact" beat.
  - [ ] Still first-run-gated; skippable on repeat.
- **Files:** `src/hud/WelcomeIntroOverlay.js`, `styles.css`.

### P3-3 — Codex locked / "???" states `[M]` ⬜
- **Problem:** Every Codex entry is always fully revealed — no discovery feel.
- **Acceptance:** [ ] Undiscovered entries show a locked/"???" state; reveal on first encounter.
- **Files:** `src/hud/CodexOverlay.js` (+ a discovery source).

### P3-4 — Pact-seal entrance feedback `[S]` ⬜
- **Problem:** A newly-sealed pact just appears in the TopBar buff slot — no celebration in the chrome.
- **Acceptance:** [ ] Staggered slide/pop (+ optional "NEW" flag) on `PACT_SEALED`.
- **Files:** `src/hud/TopBar.js`, `styles.css`.

### P3-5 — Boss-portrait fallback glyph `[S]` ⬜
- **Problem:** Archetypes without a portrait PNG (lich) show a bare gradient on the hero portrait button.
- **Acceptance:** [ ] Per-archetype fallback glyph/emblem instead of empty gradient.
- **Files:** `src/hud/TopBar.js`.

---

## Phase 4 — Final discipline

### P4-1 — Raw-hex lint rule + token sweep `[M]` ⬜
- **Problem:** Hundreds of raw `#hex` values in `src/hud/*.js` (cinematics/event/meta) won't retint under boss palettes (`VISUAL_STANDARDS §1`).
- **Acceptance:**
  - [ ] Lint rule bans raw `#hex` in `src/hud/*.js` (allowlist genuine sprite palettes, e.g. `sprites.js`); add to the pre-commit hook.
  - [ ] Sweep remaining hex → palette/`--z-*` tokens (most done inline in Phases 2–3); add `--silver`/`--bronze` tokens for ranks.
- **Files:** `tools/` (lint), `src/hud/*.js`, `styles.css`.

### P4-2 — Helper de-dup `[M]` ⬜
- **Problem:** Duplicated logic: MVP-minion reducer, pact-id humanizers, leaderboard `_bossPortrait`/`rankColor`, `CAT_COLOR` triplicated across 3 knowledge surfaces.
- **Acceptance:** [ ] Consolidate into shared `util/`/`hud/` helpers; remove the copies.
- **Files:** `PostWaveOverlay.js`, `GameOverOverlay.js`, `AchievementsOverlay.js`, `LeaderboardOverlay.js`, `LeftPanels.js`/`KnowledgeMapOverlay.js`/`KnowledgeScreen`.

### P4-3 — Misc hygiene `[S]` ⬜
- **Problem:** Assorted small smells found in review.
- **Acceptance:**
  - [ ] `EventBus.off` honors `context`.
  - [ ] Remove dead `LeaderboardOverlay._selected` + module-level `_bossPortrait` + stale header comment; `ArchetypeSelectOverlay._tipTimer`.
  - [ ] `BottomBar` header comment includes UPGRADE; name magic numbers (wealth tiers, coin throttle, quiet-count) as constants.
  - [ ] `LongGameOverlay` "Rare" → data-driven; `PactDetailPopup` honors stage scale.
- **Files:** `src/systems/EventBus.js`, `LeaderboardOverlay.js`, `ArchetypeSelectOverlay.js`, `BottomBar.js`, `LongGameOverlay.js`, `PactDetailPopup.js`.
