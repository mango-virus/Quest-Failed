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
| 0 — Foundation & sweep | 7 | 7 |
| 1 — Input & accessibility | 7 | 7 |
| 2 — Hero moments & game feel | 6 | 6 |
| 3 — Discoverability & onboarding | 5 | 2 |
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

### P0-4 — Persist & re-apply fullscreen `[S]` ✅ *(pending commit)*
- **Problem:** `qf.video.fullscreen` is saved but never re-applied on boot — "saved" setting that's actually session-only.
- **Acceptance:**
  - [x] On boot, `HudRoot._applyInitialVideoClasses` reads `qf.video.fullscreen`; since `requestFullscreen()` needs a user gesture, it re-applies on the **first** interaction via a one-shot listener that self-removes (won't fight a manual Esc/F11 exit). Cleaned up in `destroy()`.
  - [x] Boots clean with the pref on, gesture path error-free (preview). ⚠ Actual fullscreen entry to be eyeballed in Electron (the preview iframe sandboxes the Fullscreen API).
- **Files:** `src/hud/HudRoot.js`.

### P0-5 — z-index token band + toast stacking `[M]` ✅ *(pending commit)*
- **Problem:** ~30 ad-hoc z-index literals (order lives only in comments); toasts at `z:30` sit *below* modals/cinematics so a notification fired during an overlay hides behind it.
- **Decision (user):** toasts sit **above menus/overlays, below cinematics**.
- **Acceptance:**
  - [x] Added a `--z-*` band to `:root` (chrome < menu < overlay < select < **toast** < cinematic < transition < boot < debug), documenting the global order.
  - [x] Toasts → `--z-toast` (8000): verified **above** an open overlay (150) and below the 9000 cinematic band. Bumped the three cinematic/blocking layers stuck at 160 (`.qf-cf-layer` CoinFlip, `.qf-un-layer` Unlock, `.qf-eventconfirm`) to `--z-cinematic` so the invariant holds. Zero console errors.
  - ⏭ **Deferred to Phase 4:** migrating the remaining ~70 *purely-local* intra-component z-index literals (they don't affect cross-component stacking — a big sweep with regression risk belongs in the discipline pass). Also flagged: `.qf-archdec` CSS is orphaned by P0-1's delete — fold into the P4 dead-CSS sweep.
- **Files:** `src/hud/styles.css`.

### P0-6 — Resolve the `?newhud=0` legacy fallback `[L]` ✅ *(f3be8426 strip + delete commit)*
- **Decision (user, 2026-06-18):** **RETIRE it.** The DOM HUD becomes the only path. ✅ Done 2026-06-18 in two commits (strip code paths → delete orphaned files). Verified in the running game (fresh demon run): boot, night build, BEGIN DAY → real wave spawns, boss-fight cinematic, INFERNAL PACT archetype day-action, a DOM overlay — all clean, zero console errors. Minor deviation from the sketch below: `isNewHudEnabled()` was **deleted** (HudScene was its only code caller) rather than forced to `return true`.
- **Scope already mapped (so next session moves fast):**
  - **Force flag on:** `HudRoot.isNewHudEnabled()` (HudRoot.js:452) → `return true`; remove the local `_useNewHud` localStorage reads in the sites below.
  - **`HudScene.js` → DOM-only rewrite:** drop the `else` legacy-chrome block (BossTopBar/MiniMapPanel/BuildMenu/KnowledgePin/DungeonLog/ActionBar + backing rects), the whole Phaser `this._popups` suite + `_closeAllPopups`/`_isPopupOpen`/`togglePopup`/`wirePopup` + every `!useNewHud` wire + the legacy `onPhaseChange`; keep the HudRoot (DOM) build/teardown + `BossArchetypeUI`.
  - **`Game.js`:** remove the dead `BossFightOverlay` import (line 53 — no instantiation, moved to HudScene); remove the `_useNewHud` branches constructing Phaser `MinionInspector` (~408) + `WantedPoster` (~413) and their imports.
  - **`DayPhase.js` (~153–209):** collapse the `_useNewHud` branch to the new-HUD spawn path (spawn on `PHASE_TRANSITION_FINISHED` + defensive fallback); drop the legacy immediate-spawn `else`.
  - **`BossArchetypeUI.js` (49–57):** remove the `!_useNewHud` button-build branch (+ the now-dead `_buildEarthquakeButton`/`_buildSacrificeButton`). DOM `BossArchetypeStrip` owns the buttons.
  - **Delete legacy files** (imported only by the above — re-grep each first): `src/ui/{BossTopBar,ActionBar,KnowledgePin,DungeonLog,BuildMenu,BuildMenuTooltip,MiniMapPanel,BossFightOverlay,EventBanner}.js`, all of `src/ui/popups/*` (12 files), `src/ui/{MinionInspector,WantedPoster}.js`. Watch for a shared popup-frame base used only by the deleted popups.
  - **⚠ Keep** (run under the new HUD, NOT gated): `ChatBubbles`, `KnowledgeOverlay`, `BossArchetypeUI` itself, `applyUiCamera`/`UIKit`.
- **Acceptance:**
  - [x] Two stages/commits: (1) strip the code paths, (2) delete the orphaned files.
  - [x] Verify in Electron/preview: boot, night build, **BEGIN DAY → real wave spawns**, a **boss-fight cinematic**, archetype day-action buttons, and the DOM overlays — all clean, zero console errors.
- **Files:** `src/scenes/HudScene.js`, `src/scenes/Game.js`, `src/scenes/DayPhase.js`, `src/hud/HudRoot.js`, `src/ui/BossArchetypeUI.js`, + the legacy files above.

### P0-7 — Reconcile stale docs `[S]` ✅ *(2026-06-18)*
- **Problem:** `ARCHITECTURE.md §4/§9` still describes the removed dual main-menu + fallback.
- **Acceptance:**
  - [x] Updated `ARCHITECTURE.md` (§3 scene list, §4 two-layers + the feature-flag para, §9 `src/ui` description, §11 cross-cutting, §14 cruft), `STATUS.md` (DOM-HUD line), and `DESIGN_COVERAGE.md` (`hud2-flag-flip` row) to reflect that the `newhud` flag + legacy Phaser chrome were retired in P0-6.
- **Files:** `ARCHITECTURE.md`, `STATUS.md`, `DESIGN_COVERAGE.md`.

---

## Phase 1 — Input & accessibility
*Steam-blocking and the biggest single "feels finished" lever. The action bar is currently mouse-only; the project's own `VISUAL_STANDARDS §7` accessibility reqs are unmet.*

### P1-1 — Keyboard bindings for HUD actions `[M]` ✅ *(2026-06-18)*
- **Problem:** No keys for the core action bar (MOVE/SELL/UPGRADE/PLACE/BEGIN-DAY/ROSTER/MAP/INTEL/speed) — mouse-only. The Settings CONTROLS tab *documents* a keymap but nothing implements it.
- **Locked key map (user decisions, 2026-06-18 — verbatim):**
  | Action | Key | Event emitted | Phase |
  |---|---|---|---|
  | PLACE / build drawer | **B** | disarm armed tool → `TOGGLE_BUILD_DRAWER` | night |
  | MOVE | **M** | `TOOL_MOVE` | night |
  | UPGRADE | **U** | `TOOL_UPGRADE` | night *(user: "Add U = UPGRADE")* |
  | SELL | **X** | `TOOL_SELL` | night |
  | BEGIN DAY | **Space** | `PHASE_TOGGLE_REQUEST` (only if ready) | night |
  | GAME SPEED (4 buttons) | **1 / 2 / 3 / 4** | `TIME_SCALE_SET {scale: steps[i]}` | day *(user: "1/2/3/4 = the 4 buttons"; early 3=4× 4=8×, day30+ 4=16×; **retire DayPhase's old 1/2/4/8/6**; Space stays = pause in day)* |
  | KNOWLEDGE MAP | **K** | `OPEN_KNOWLEDGE_MAP` | both |
  | ADVENTURER INTEL | **I** | `OPEN_ADV_INTEL` | both |
  | MINION ROSTER | **R** | `OPEN_MINION_ROSTER` | both — **contextual** *(user: "R rotates when placing, opens roster when not")* |
  | PAUSE / MENU | **Esc** | existing PauseManager / cancel-then-pause | both |
- **Design:** new `src/hud/HudKeybinds.js` (window-level keydown, owned by HudRoot) emits the **existing** button events — no logic duplication. Contextual R stays owned by NightPhase (it has placement state): rotate when `_selectedKind`/tool armed, else `OPEN_MINION_ROSTER`; HudKeybinds handles R only in **day** (night belongs to NightPhase). Day-speed digits + Space=begin-day are phase-guarded so they never double-fire against DayPhase's Space=pause. Canonical defaults exported from HudKeybinds and consumed by `SettingsOverlay` (single source → feeds P1-3).
- **Acceptance:**
  - [x] `HudKeybinds` emits the existing EventBus events (no logic dup); B/M/U/X/Space gated to night, 1-4 to day, K/I/R both. *(live: M/U/X arm, B disarms+toggles drawer, K/I/day-R open overlays, Space→PHASE_TOGGLE_REQUEST)*
  - [x] Guards: text input focused (digit blocked while input focused, fired after), modifier, key-repeat, phase∉{night,day}, and `.overlay` modal open (Welcome overlay suppressed all keys — confirmed).
  - [x] Contextual R verified live: room selected → R rotates 0→90° (roster stays closed); idle → R opens roster. No double-fire (HudKeybinds defers R to NightPhase at night).
  - [x] DayPhase's `1/2/4/8/6` speed keydowns removed; `1-4` drive the 4 visible speed buttons via `TIME_SCALE_SET` (live: 1→1× 2→2× 3→4× 4→8×, bar highlight synced to 8×). Space=pause kept in day.
  - [x] `SettingsOverlay` CONTROLS panel renders from the shared `KEYBIND_DEFAULTS` (incl. UPGRADE→U + ROTATE/ROSTER both R); verified the import + row data (code-level).
  - [x] Verified live in Electron-path preview; zero console errors throughout.
- **Files:** new `src/hud/HudKeybinds.js`, `src/hud/HudRoot.js` (own/destroy it), `src/scenes/NightPhase.js` (contextual R), `src/scenes/DayPhase.js` (drop digit keydowns), `src/hud/SettingsOverlay.js` (real defaults). Events already in `BottomBar.js`.

### P1-2 — Controller / gamepad navigation `[L]` ✅ *(2026-06-19)*
- **Problem:** No gamepad nav anywhere (Steam Deck "Verified" needs it).
- **Decisions (user, 2026-06-19 — verbatim):** focus ring = **amber-gold**; B button = **"B always sends Esc"** (uniform Esc semantics everywhere); **include LB/RB tab-cycling** now.
- **Design (built):** ONE global singleton `src/hud/GamepadNav.js`, installed from `main.js` (covers the title screen before HudRoot mounts; rAF poll runs **only while a pad is connected**). Navigates **native DOM focus spatially** (every HUD surface is already a `<button>`, so no per-surface wiring). D-pad/left-stick → nearest focusable in-direction (centre distance + cross-axis penalty); **A** = `activeElement.click()`; **B** = back-as-Esc (modal/menu → synthetic window `Escape`; in-game no-modal → `OPEN_PAUSE_MENU`, since Phaser's scene `keydown-ESC` ignores synthetic events — net = identical to Esc); **LB/RB** = cycle `.qf-op-catbtn`/`.qf-cdx-tab` tab strips. Focus is **scoped** to the topmost modal layer (`.overlay, .qf-cf-layer, .qf-nameentry` → else `.qf-cm` menu → else `#hud-stage` chrome) so it can't leak behind a modal. Amber-gold ring via `html.gamepad-active :focus` (class added on pad input, dropped on `pointermove`; keyed off `:focus` not `:focus-visible` so programmatic focus shows it; hides the custom cursor). MainMenu got a `focus→_select` bridge so its `.on` highlight tracks the ring; peripheral footer chips (version/dev) marked `data-nav-skip` so they don't hijack cardinal nav.
- **Found + fixed a pre-existing bug:** `MainMenuOverlay._onKey` had **no guard** for open child overlays — pressing **Esc** to close What's New / Options / etc. on the title also fell through to the menu's `Escape`→QUIT (`window.close()` actually quits in Electron). Added the same modal-open guard HudKeybinds uses. Fixes it for keyboard Esc **and** gamepad B.
- **Out of scope (noted):** driving the dungeon WORLD cursor (placing rooms/aiming) by stick, and the Phaser pick scenes (CompanionSelect/ArchetypeSelect are canvas, not DOM) — separate future input items.
- **Acceptance:**
  - [x] Focus model across HUD chrome + menus; D-pad/stick move, A/B select/back. *(CDP-verified live in the Electron build: menu grid flow NEW EVIL↔LEADERBOARD/ACHIEVEMENTS↔OPTIONS/QUIT with the `.on` highlight tracking; A activates; B closes a modal / pauses in-game [`OPEN_PAUSE_MENU` branch verified]; scope-trap inside Settings [11 candidates]; LB/RB cycle AUDIO→VIDEO→CONTROLS.)*
  - [x] Visible focus ring; works on main menu, in-game, overlays. *(Amber-gold ring captured rendering on the menu via CDP focus-emulation; scope verified on menu, Settings overlay, and `#hud-stage` in-game chrome.)*
- **Files:** new `src/hud/GamepadNav.js`, `src/main.js` (install), `src/hud/styles.css` (ring), `src/hud/MainMenuOverlay.js` (focus bridge + `data-nav-skip` chips + the Esc-guard fix).

### P1-3 — Rebindable controls `[M]` ✅ *(2026-06-18)*
- **Problem:** Settings CONTROLS tab is view-only.
- **Decisions (user, 2026-06-18 — verbatim):** scope = **"Everything"** (all bindings rebindable, incl. speed slots, Space, contextual R); conflict = **"Block + tell me"** (reject + inline message, keep listening; reserved keys also blocked).
- **Design:** central bind store in `src/hud/HudKeybinds.js` — `KEYBIND_DEFAULTS` (each row `{id, action, defaultKey, phase}`; GAME SPEED split into 4 slot ids speed1–4; ROSTER+ROTATE merged into one contextual `roster` id) + `loadBinds()/setBind()/resetBinds()/getBind()` over `localStorage['qf.controls.binds']`, emitting `KEYBINDS_CHANGED`. HudKeybinds builds a key→action map from the live binds (rebuilt on change) and routes DOM-owned actions. NightPhase's R handler reads the live `roster` bind (contextual rotate/roster preserved). Reserved (un-bindable): `w/a/s/d` (camera), modifiers, Tab/Enter/Arrows. **Esc stays a permanent universal close/cancel/pause** (overlay-close + NightPhase cancel are wired into ~20 files; not rerouted) — the PAUSE row rebinds an *additional* pause key via HudKeybinds (Esc always works); noted in the panel.
- **Acceptance:**
  - [x] Interactive rebinding UI in the CONTROLS tab: click a key-cap → "PRESS…" → captures next key; "↺ RESET TO DEFAULTS"; persists to `localStorage['qf.controls.binds']` (immediate-apply, separate from the audio/video draft+Apply flow).
  - [x] Conflict + reserved detection: blocked with inline "⚠ 'B' is already bound to PLACE / BUILD" / "⚠ 'W' is reserved", keeps listening (live-verified).
  - [x] HudKeybinds + NightPhase honor the custom binds live (re-read on `KEYBINDS_CHANGED`): rebound MOVE→G armed move while M went dead; ROSTER→T opened the roster. Defaults unchanged when nothing customized.
  - [x] Live: rebind worked, conflict/reserved blocked, reset restored, persisted across a reload (`sell→c` survived). Panel renders polished (screenshot). Zero console errors.
- **Files:** `src/hud/HudKeybinds.js` (store + data-driven handler), `src/hud/SettingsOverlay.js` (rebinding UI), `src/scenes/NightPhase.js` (R reads live bind).

### P1-4 — Reduced-motion setting + finish fallbacks `[M]` ✅ *(2026-06-19)*
- **Problem:** No in-game reduced-motion toggle (only partial OS-media-query coverage); 5 cinematics ignore it.
- **Design (deep-spec 2026-06-19):** a JS-driven `html.reduce-motion` class is the single source, fed by setting + OS so the setting can override OS in both directions.
  - **`src/hud/motion.js`** (new): `isReducedMotion()` = `setting==='on' || (setting!=='off' && matchMedia('(prefers-reduced-motion: reduce)').matches)`; `applyReduceMotion()` toggles `document.documentElement.classList['reduce-motion']`; self-installs an `mql` `change` listener for live OS changes. Setting key `qf.video.reduceMotion` ∈ {auto,on,off}, default **auto**.
  - **Setting:** VIDEO tab seg **REDUCE MOTION — AUTO / ON / OFF** (consistent with PARTICLES). `_applyVideoFlags` calls `applyReduceMotion`; `STORE_KEYS`/`DEFAULTS` get the new key.
  - **CSS:** one global `html.reduce-motion *,::before,::after { animation-duration/iteration + transition-duration → ~instant }` reset — covers ALL declarative motion in one place (the 5 cinematics' injected `@keyframes`, coin spin, day-stamp slam, champion pulse, KRI, titlefx). **Cleaner than copying KRI's block into each of the 5 cinematic files** (deviation from the bullet below, same goal, less drift). Reconcile the existing scattered `@media (prefers-reduced-motion: reduce/no-preference)` blocks → drive off the class so OFF truly overrides.
  - **JS juice:** `runCountUp()` (`countUp.js`) early-returns when reduced (numbers render at final value, no climb/sound) — covers treasury + all result-screen count-ups. (Screen shake already has its own toggle.)
- **Acceptance:**
  - [x] REDUCE MOTION seg (AUTO/ON/OFF) in Settings VIDEO sets `html.reduce-motion`; helper folds OS pref (AUTO→OS, ON→true, OFF→false — live-verified). Renders consistent with the other segs (screenshot).
  - [x] The 5 cinematics + KRI freeze under the class — global reset drove the menu glow `3.4s → 1e-05s`; grep confirms all 5 cinematics use `forwards`/`both` fill so reveals hold their END state (no vanish); boss-fight bar + an act-intro card render fully visible under reduced motion (screenshot).
  - [x] Chrome juice gated: count-up instant (countUp.js early-returns when reduced — verified stays `1200` vs `0`); coin spin / day-stamp slam / champion pulse are CSS → frozen by the global reset.
  - [x] Live: ON freezes (`1e-05s`), OFF restores (`3.4s`), AUTO follows OS, persists (`localStorage['qf.video.reduceMotion']`); zero console errors.
- **Files:** new `src/hud/motion.js`, `src/main.js` (early apply on import — chosen over HudRoot so the class is set before the menu renders), `src/hud/SettingsOverlay.js`, `src/hud/styles.css` (one global reset), `src/hud/countUp.js`.

### P1-5 — Text-size setting `[S]` ✅ *(2026-06-19)*
- **Problem:** No text-scaling option (`VISUAL_STANDARDS §7`).
- **Decision (user, 2026-06-19):** **Relabel UI SCALE.** The HUD is a uniform CSS-`zoom` stage (`stageScale.js`), so UI SCALE already enlarges chrome + text together, crisply, and `zoom` can't overflow the fixed-px layouts. A separate independent text-size would be redundant (whole-UI zoom) or a large/risky per-text retrofit — so the honest, no-redundancy choice is to make UI SCALE clearly serve as the text-size accessibility control.
- **Acceptance:**
  - [x] UI SCALE seg relabelled **"UI & TEXT SIZE"** + finer **110%** step added (AUTO/100/110/125/150/200). `uiScalePref()` coerces `'1.1'`→`1.1` (range 0.5–3); selecting 110% → `effectiveUiScale()===1.1` and `--ui-scale` var = 1.1 (zoom applies). Verified via import (the Boot wedge blocked a full screenshot; the DOM seg + scaling logic confirmed). Zero console errors.
- **Files:** `src/hud/SettingsOverlay.js`.

### P1-6 — Colorblind / high-contrast `[L]` ✅ *(2026-06-19)*
- **Problem:** No colorblind/high-contrast palette.
- **Decisions (user, 2026-06-19 — verbatim):** modes = **"Colorblind-safe + High Contrast"** (OFF / COLORBLIND-SAFE / HIGH CONTRAST — one tuned CB palette + a contrast mode); reach = **"DOM HUD + menus + overlays"** (the in-dungeon canvas reads its own color source — Balance/sprites/Phaser — so it's a separate follow-up, flagged below).
- **Design (built):** accessibility color modes are a **separate, global, persistent axis** from the aesthetic THEME (which only retints `#hud-root` in-game and isn't even re-applied on boot). New `src/hud/colorMode.js` (parallel to `motion.js`) reads `qf.video.colorMode ∈ {off,cbsafe,contrast}` (default off) and toggles `html.cb-safe`/`html.high-contrast`; self-applies on import (imported early in `main.js` so it's set before the menu renders). CSS blocks override the semantic accent/surface tokens, scoped to **both `html.<mode>` AND `html.<mode> #hud-root`** with `!important` so they beat an active `#hud-root.palette-*` theme's ID-specificity redefinitions (verified) while also covering the menu. **Colorblind-safe** = Okabe-Ito based: the critical red/green pair blood↔poison becomes **vermillion (#d55e00) ↔ teal (#009e73)**, separable for deuteranopia/protanopia; the warm trio (blood/warn/gold) split by hue+lightness, backstopped by existing control labels. **High contrast** = white text, darkened surfaces, brightened borders + accents (token-only — crypt layering intact). Surfaced as a **COLOR MODE** `_seg` in Settings → VIDEO (grouped with REDUCE MOTION / UI & TEXT SIZE / PARTICLES), routed through `_applyVideoFlags` so construct/APPLY/CANCEL/RESET all handle it.
- **Out of scope (noted):** the in-dungeon **canvas** (unit HP bars, minimap dots, entity/status tints, VFX) reads Balance/sprites/Phaser, not the CSS tokens — a separate future item for a complete colorblind story.
- **Acceptance:**
  - [x] Optional palette variant(s) selectable in Settings. *(CDP-verified live in the Electron build: COLOR MODE seg [OFF/COLORBLIND/CONTRAST] in VIDEO; live apply [`html.cb-safe`/`html.high-contrast`] + CANCEL revert; tokens remap [blood #c8334a→#d55e00 cbsafe / #ff4458 contrast; poison →#009e73 / #8ed85a]; **beats an active `.palette-necro` theme** on `#hud-root`; APPLY persists `qf.video.colorMode` and **re-applies on boot** [menu `--text`→#fff under contrast]; high-contrast menu + cb-safe Codex screenshots render clean.)*
- **Files:** new `src/hud/colorMode.js`, `src/main.js` (boot import), `src/hud/styles.css` (palette blocks), `src/hud/SettingsOverlay.js` (COLOR MODE seg + store key/default + apply path).

### P1-7 — Name input validation `[S]` ✅ *(2026-06-19)*
- **Problem:** Name pipeline only checks non-empty — no length floor, profanity filter, or dupe check before a *public* leaderboard.
- **Decisions (user, 2026-06-19):** dupe = **normalize-only** (offline-safe; true uniqueness stays a server concern); profanity = **lenient** (curated, no innocent-substring false positives).
- **Design:** shared `PlayerProfile.validateName(raw) → {ok, value, reason}` (NAME_MIN 2 / NAME_MAX 16; trim + collapse internal whitespace; reject blank/punctuation-only; lenient leet-normalized block list curated to unambiguous terms — omits ass/cum/sex/shit/spic/rape/cock stems). `NameEntryOverlay` gained an optional `validate` opt + inline `.qf-nameentry-error` (clears on input); the player-name callers (MainMenuOverlay + the SettingsOverlay identity field via `_commitName`) pass it. Minion rename stays non-empty-only (local cosmetic, not public).
- **Acceptance:**
  - [x] Length min/max + profanity + whitespace normalization + clear inline error — all live-verified.
  - [x] No false positives: Assassin / Hispanic / therapist / Cockburn / Shitij / mango all pass; blocked: empty, `a` (short), 17-char, `!!!`, `fuckyou`, `N1GG3R` (leet), `f u c k` (spaced). `"  Dark   Lord  "` → `Dark Lord`.
  - [x] Both UI paths show the inline ⚠ error + keep the bad value out (NameEntryOverlay stays open; Settings field shows error — screenshot); cheat name `mango` still passes; zero console errors.
- **Files:** `src/systems/PlayerProfile.js` (validateName + block list), `src/hud/NameEntryOverlay.js`, `src/hud/MainMenuOverlay.js`, `src/hud/SettingsOverlay.js`, `src/hud/styles.css`.

---

## Phase 2 — Hero moments & game feel
*The cinematic set-pieces are visually rich but uniformly silent and shake-less; VictoryScreen is the most under-invested screen relative to its trailer importance. Tokenize + de-dup these files as we touch them.*

### P2-1 — Audio on cinematic apexes `[M]` ✅ *(2026-06-19)*
- **Problem:** Every full-screen cinematic beat is silent (`HudSfx` not imported).
- **User constraint (2026-06-19):** **"for audio, dont add anything, as i will add audio files later."** → wire the cue trigger points + define the expected cue→audio-key tables; add **NO audio files** and **no Preload load calls**. The cues stay **dormant** until the files land (see below).
- **Design (built):** 11 cinematic apex cues routed through `HudSfx.playUi(cue)` — which already (a) respects mute/volume via `SfxVolume`, (b) rate-limits per-cue, and (c) **silently no-ops when the cue's audio key isn't in the Phaser cache**. So the wiring ships zero assets and zero errors; each cue lights up the moment its file is added to Preload under the matching key. Added a "cinematic apex stingers" group to HudSfx's `UI_VOL` / `UI_KEY` / `COOLDOWN` tables (cue → `sfx-cin-*` audio key). Cues + locations:
  - `cin_arise` — SoloLeveling `_playEntrance` (the "ARISE." slam)
  - `cin_ascension` — Ascension `_show` (DARK ASCENSION reveal)
  - `cin_kingdom` — KingdomResponseIntro `_onDrawn` ("THE KINGDOM RESPONDS")
  - `cin_bladelock` / `cin_finalblow` — Aldric `_onBeat` (placed BEFORE the `def` early-return so finalblow — which has no `BEAT` entry — still fires)
  - `cin_collapse` (`_onBeat`) / `cin_verdict` (`_onEnd`) — Rival
  - `cin_duty` — LightParty `_onDutyBanner` (only `kind==='commenced'` — the duty-start fanfare) / `cin_lb3` — `_onDuelBeat` (`kind==='lb3'`)
  - `cin_coin_land` (+ `cin_coin_win` on a win) — CoinFlip `_reveal` + `_revealDemon`
- **⚠ Integration note (overlap with the Phaser `SfxSystem`):** the duels + coin already have *gameplay* SFX via `SfxSystem` (`_onNemesisDuelSfx` finalblow→`sfx-boss-attack`, lock→melee; `_onLpDuelBeat`; `_onCoinRevealed`). These cinematic cues are an additive *dramatic stinger* layer over those. Genuinely-silent (no existing SFX) beats: **ARISE, DARK ASCENSION, THE KINGDOM RESPONDS, DUTY COMMENCED**. For the rest, a `cin_*` file will layer on the combat SFX — the user picks per-file whether to provide one.
- **To activate later:** drop the file + register in Preload, e.g. `this.load.audio('sfx-cin-arise', 'assets/audio/cin/arise.mp3')`. Keys: `sfx-cin-{arise,ascension,kingdom,bladelock,finalblow,collapse,verdict,duty,lb3,coin-land,coin-win}`.
- **Acceptance:**
  - [x] Cue the marquee beats (ARISE, Aldric blade-lock/final blow, LightParty duty/LB3, Rival verdict/collapse, CoinFlip land/win, DARK ASCENSION) via `HudSfx`, settings-aware + rate-limited. *(CDP-verified in the Electron build: all 7 cinematics + HudSfx import clean; all 11 `sfx-cin-*` keys are dormant [not in cache]; firing all 11 cues throws nothing [graceful no-op]; spy confirmed `cin_kingdom` fires from `_onDrawn` and `cin_bladelock`/`cin_finalblow` from `_onBeat`.)*
- **Files:** `src/hud/HudSfx.js` (cue tables), `AldricCinematic`, `SoloLevelingCinematic`, `LightPartyCinematic`, `RivalShowdownCinematic`, `AscensionCinematic`, `CoinFlipCinematic`, `KingdomResponseIntro`.

### P2-2 — Screen shake + hitstop on apexes `[M]` ✅ *(2026-06-19)*
- **Problem:** No shake/freeze-frame on climaxes — they lean on a white flash.
- **Decision (user, 2026-06-19):** duel set-pieces = **"Leave duels camera-only."** The duels (Aldric / Rival / Light Party / Solo) already get camera-shake + hitstop from `BossSystem` (the dungeon view is visible during them), so P2-2 only adds shake to the **pure-DOM** cinematics that dim the canvas (a camera shake wouldn't show behind them) and currently lean on a white flash alone.
- **Design (built):** new `src/hud/screenShake.js` → `domShake(el, {intensity, durationMs})` jolts a DOM element with a brief decaying random `transform: translate` jitter via the **Web Animations API** (self-reverts — fill defaults to `none` — so no injected CSS; matches the DOM-transform shake `BossFightOverlay` already uses). Gated on **both** the SCREEN SHAKE setting (`userSettings.isShakeEnabled()`) **and** `isReducedMotion()` — JS/WAAPI motion isn't caught by P1-4's global `html.reduce-motion` CSS reset, so it checks explicitly. Wired at the 4 apexes (alongside the P2-1 cues): SoloLeveling ARISE (`_playEntrance`, int 9), Dark Ascension (`_show`, int 9, delayed to ~380ms to land on the form-pop), The Kingdom Responds (`_onDrawn`, int 8, delayed to ~500ms for the name-slam; timer cleared in `_teardown`), CoinFlip land (`_reveal`/`_revealDemon`, int 6 → **11 on a win**).
- **Hitstop:** the duels already have real hitstop (`BossSystem._hitstop` freezes game time on blade-lock/final-blow/etc.); the static DOM card reveals have no continuous motion to freeze, so no DOM hitstop was built (the "(+ optional hitstop)" is satisfied by the existing duel hitstop).
- **Acceptance:**
  - [x] Each set-piece apex emits a brief shake (+ optional hitstop) via the existing EventBus/camera-shake pattern. *(CDP-verified in Electron: `domShake` runs 1 WAAPI anim when shake-on, 0 when shake-off, 0 under reduced-motion; KingdomResponseIntro root confirmed shaking at its apex — live `transform: matrix(… -1.97, 2.63)` mid-shake. Duels remain on BossSystem's camera-shake + hitstop per the decision.)*
- **Files:** new `src/hud/screenShake.js`; `SoloLevelingCinematic`, `AscensionCinematic`, `KingdomResponseIntro`, `CoinFlipCinematic`.

### P2-3 — VictoryScreen rebuild `[L]` ✅ *(2026-06-19)*
- **Problem:** The trailer moment is static rays + fade-ins, no music, hardcoded hex, no run summary.
- **Constraint (user):** "audio files come later" → the music cue is wired **dormant** (no asset added), same approach as P2-1.
- **Design (built):** rebuilt `src/hud/VictoryScreen.js` (self-injected CSS, kept full-bleed at z-60 — the menu's `--z-menu` 100 only competes at the title screen, never in-game). Adds:
  - **Music** — new `src/systems/VictoryMusic.js` mirroring `GameOverMusic` (ducks gameplay/title layers, syncs to the music slider, loops `victory-music`). DORMANT: `start()` guards on `cache.audio.exists('victory-music')`, so with no file it silences the other layers and plays nothing. ⚠ path gotcha: `TitleMusic`/`GameplayMusic` live in `src/systems/` (not `src/hud/`) — import `./`, not `../hud/`.
  - **Juice** — `runCountUp(root)` on the 5 stat tickers (staggered cascade, reduced-motion-aware) + a FINITE 22-spark radial burst (CSS custom-prop `--dx/--dy` per spark, no infinite animation → screenshot-safe) + a `domShake` jolt on the VICTORY slam (gated on shake + reduced-motion, P2-2 helper).
  - **Run summary + FULL LOG** — a 5-tile count-up stat grid (DAYS/SLAIN/CHAMPIONS/BOSS LV/GOLD, GameOver-parity tiles) + the campaign detail rows (Aldric / lost-to-thieves / strategies broken / final form) + a **FULL LOG** button → `FullLogOverlay`, alongside CONTINUE·ETERNAL REIGN + RETURN TO MENU.
  - **Tokenized** — all gold/purple/red hex → `--gold`/`--gold-bright`/`--info`/`--blood-glow`/`--text` (+ `color-mix` for glows), so it retints under boss palettes + the colorMode accessibility palettes.
  - **Reduced-motion** — every reveal uses `forwards`/`both` fill so the global `html.reduce-motion` reset freezes them on their END (visible) state; count-up + shake self-gate.
- **Acceptance:**
  - [x] Music cue; particle/juice + staggered stat reveal. *(CDP-verified in Electron: VictoryMusic imports + is dormant [no `victory-music` file → no-op]; 22 sparks render; count-up cascades 0→742/18650/3/41; VICTORY slam shake fires.)*
  - [x] Run-summary content + a FULL LOG button (parity with GameOver). *(5 count-up stat tiles + 4 detail rows + FULL LOG button → FullLogOverlay; buttons = CONTINUE·ETERNAL REIGN / FULL LOG / RETURN TO MENU.)*
  - [x] Colors tokenized (retints under boss palettes). *(GOLD value computes to `rgb(212,166,72)` = the `--gold` token; all accents are tokens/`color-mix`.)*
  - [x] reduced-motion fallback. *(Under `html.reduce-motion`: title/eyebrow/stat opacity all hold at 1 [content visible], count-up renders final values instantly [742, no climb].)*
- **Files:** `src/hud/VictoryScreen.js`, new `src/systems/VictoryMusic.js`.

### P2-4 — HP-bar fills → `transform: scaleX` `[S]` ✅ *(2026-06-19)*
- **Problem:** Bars animate `width` (jank property) across BossFightOverlay + 4 cinematics; Rival nexus animates `left`/`linear`.
- **Design (built):** every HP-bar fill (+ ghost trails) now keeps `width:100%` and the JS sets `transform: scaleX(frac)`; the CSS transition moved `width → transform`, with `transform-origin` matching the anchored edge (`left center` for `left:0` fills, `right center` for `right:0` fills) so the bar shrinks toward the correct side exactly as before — but GPU-composited, no layout. Converted: `qf-bossfight-bar-fill`/`-ghost` (single + slime bars, `styles.css`), `qf-sl-fill`/`qf-sl-corner-fill` (Solo), `qf-ald-fill`/`qf-ald-ghost` (Aldric), `qf-lp-bar-fill`/`qf-lp-duel-boss-fill` (Light Party). Rival: dominance fills `qf-riv-fill.v`/`.b` → `scaleX` (`width:50%` base → `width:100%` + initial `scaleX(.5)` so they still meet at the centre seam); the **nexus** now rides via `transform: translate(calc(-50% + (d-0.5)×trackWidth px), -50%)` instead of animating `left`; and the `linear` easing was dropped (→ `ease`).
- **Acceptance:**
  - [x] Convert fills to `transform: scaleX()`; drop Rival's `linear` easing. *(CDP-verified in Electron — all fills compute the right matrix + origin + `transition-property: transform`: Rival fillV `scaleX(.7)`/origin-left, fillB `scaleX(.3)`/origin-right, nexus `translateX(149.8px)` w/ `transform` transition [no `left`/`linear`]; Aldric left `scaleX(.4)`/origin-left + right `scaleX(.9)`/origin-right; Solo `scaleX(.3)`; Light Party boss `scaleX(.6)`/origin-right; BossFightOverlay fill `transition: transform, background` + origin-left.)*
- **Files:** `BossFightOverlay.js`, `SoloLevelingCinematic.js`, `AldricCinematic.js`, `LightPartyCinematic.js`, `RivalShowdownCinematic.js`, `styles.css`.

### P2-5 — CoinFlip soft-lock fallback `[S]` ✅ *(2026-06-19)*
- **Problem:** If `GAMBLER_DOUBLE_RESULT` never arrives, the overlay soft-locks — after DOUBLE OR NOTHING, `_chooseDouble` sets `_awaitingDouble=true` (which blocks click-to-dismiss) and there's no auto-close, so a missing/errored EventSystem reply strands it on "the imp grins…" forever.
- **Design (built):** `_chooseDouble` now arms a tracked `_after(DOUBLE_RESULT_TIMEOUT_MS=1500, …)` guard **before** emitting `GAMBLER_DOUBLE_REQUEST`. A reply (synchronous or not) runs `_onDoubleResult → _runFlip → _clearTimers`, which cancels the guard; only a genuinely-missing reply lets it fire — it clears `_awaitingDouble`, shows "the imp vanishes with the wager…", and `_dismiss()`es after a 900ms beat. Doubly safe: the guard also early-returns if `!_awaitingDouble`, so a late/stale fire can't dismiss a live round-2 flip.
- **Acceptance:**
  - [x] Timeout fallback resolves/closes safely. *(CDP-verified both paths in Electron: with a reply → `_awaitingDouble` clears, round-2 flip runs [`_round:2`], and the overlay is still present 1700ms later [guard cancelled, no wrongful dismiss]; with NO reply → the stranded overlay auto-dismisses [`_el` null, DOM gone] instead of soft-locking.)*
- **Files:** `src/hud/CoinFlipCinematic.js`.

### P2-6 — Extract `CinematicKit` + tokenize/clean cinematics `[L]` ✅ *(2026-06-19)*
- **Problem:** Beat-label / VS-header / finale-card / mount-dismiss / tracked-timer logic is reimplemented ~4–5× with drift; raw hex + hardcoded ms; Solo letterbox dead code; CoinFlip CSS external + duration-coupled by comment.
- **Decision (user, 2026-06-19):** **"Pragmatic kit + all cleanups"** — share the genuinely-common lifecycle bits; deliberately **skip** unifying the divergent duel HP-headers (two-bar / tug-of-war / single-bar — high regression risk, low payoff).
- **Design (built):** new `src/hud/CinematicKit.js` → `CinematicBase` (extended by SoloLeveling / Aldric / Rival / LightParty / CoinFlip): tracked timers (`_after`/`_clearTimers`), **detached** timers (`_afterDetached`, survive `_clearTimers` so a finale card isn't yanked by the `_end()`/`_teardown()` that fires on the entity's death — replaces the old raw `setTimeout`), `_destroyTimers()`, and `_beatLabel(host, text, className, holdMs)` (the shared build→reflow→show→auto-remove lifecycle; caller owns the CSS class). `CDUR` centralises the drifted beat/finale/card hold durations. Adopted: Solo/Aldric/Rival route beat labels through `_beatLabel` + finale cards through `_afterDetached`; LightParty + CoinFlip adopt the timer base (LightParty's beat label keeps its own raw removal — it lives on `_stage`, which `_end` doesn't clear, so it must outlive a phase-end). Deleted Solo's dead `_showLetterbox`/`_hideLetterbox` + `.qf-sl-letterbox` CSS.
- **Acceptance:**
  - [x] Shared `CinematicKit` (beat, finale-card timer, mount/dismiss, tracked-timer base) adopted by the big cinematics. *(VS-header intentionally excluded per the decision. CDP-verified: all 5 cinematics import clean; Aldric/Rival/Solo beat labels fire via `_beatLabel`.)*
  - [x] Untracked `setTimeout` removals routed through the kit. *(Finale cards now use `_afterDetached`; CDP-verified the Aldric finale card SURVIVES a `DAY_PHASE_ENDED`/`_teardown` fired right after — the exact strand the old raw setTimeout guarded, now handled by the kit.)*
  - [x] Tokenize durations; delete Solo's dead letterbox subsystem. *(Durations → `CDUR`; letterbox deleted — `_showLetterbox` gone, no `.qf-sl-letterbox`, CDP-confirmed.)*
  - [⏭] **Self-inject CoinFlip CSS + full hex tokenize — DEFERRED.** The CoinFlip CSS is a ~275-line block; a blind hand-transcription into a JS template literal risks a silent dropped-rule regression for a pure co-location gain — not worth it here. The **hex→token sweep is P4-1's dedicated job** (it says "most done inline in Phases 2–3" + adds the lint rule); folding CoinFlip's CSS move + the remaining cinematic hex into that discipline pass is the right home. *(Flagged for P4-1.)*
- **Files:** new `src/hud/CinematicKit.js`, `SoloLevelingCinematic.js`, `AldricCinematic.js`, `RivalShowdownCinematic.js`, `LightPartyCinematic.js`, `CoinFlipCinematic.js`.

---

## Phase 3 — Discoverability & onboarding

### P3-1 — Action-bar tooltips `[S]` ✅ *(2026-06-19)*
- **Problem:** The primary control surface (PLACE/MOVE/UPGRADE/SELL/ROSTER/MAP/INTEL/MENU) has no `title`/hover description.
- **Design (built):** a lightweight `data-tip` CSS tooltip (not the heavy `.tooltip` InspectPopup shell) that pops ABOVE the button (the bar is bottom-anchored) on **hover AND focus-visible** (so keyboard/gamepad nav from P1-2 surfaces it too), ~0.35s show delay, hides instantly. Each tip is dual-purpose for the discoverability goal: a short **semantic description + the live keybind** read from the rebindable store (`getBind`/`keyLabel`) and refreshed on `KEYBINDS_CHANGED`. `BottomBar._registerTip(el, desc, bindId)` collects the 8 buttons + sets `data-tip`; `styles.css` has the `.qf-bottombar [data-tip]::after/::before` rule.
- **Acceptance:**
  - [x] Each `qf-bb-mode`/`qf-bb-menu` button has a tooltip explaining its tool/semantics. *(CDP-verified in-game: all 8 buttons carry a correct `data-tip` with the live key — PLACE·B, MOVE·M, UPGRADE·U, SELL·X, ROSTER·R, MAP·K, INTEL·I, MENU·ESC; `::after` content resolves, base opacity 0, tooltip box renders [screenshot].)*
- **Files:** `src/hud/BottomBar.js`, `src/hud/styles.css`.

### P3-2 — WelcomeIntro → real onboarding `[L]` ✅ *(2026-06-19)*
- **Problem:** The first screen a buyer sees is a 3-paragraph text wall.
- **Decisions (user, 2026-06-19):** trigger = **"All first-run players, replaces companion intro"** (the paced onboarding is the single canonical first-run teach for everyone; the companion just does her normal day-1 barks — `open()` no longer defers to `NPC_DELIVER_INTRO`); imagery = **"Real in-game sprites + snapshots"**.
- **Design (built):** rebuilt `WelcomeIntroOverlay` as a paced **3-step** intro in the crypt `Overlay` shell, with real imagery: **THE LOOP** (the chosen boss as the hero via `animatedBossSprite` + "YOU ARE THE DUNGEON" + a 3-phase NIGHT→DAY→GROW loop using **real** sprites only — minion `snapshotMinion('goblin1')` + boss-mini `animatedBossSprite`, both loaded with the run; the DAY adventurer's base sheet is on-demand so it starts as a ⚔ glyph and `_fillAdventurer` loads `adv-knight-v01` via `ensureAdventurerBaseSheet` and swaps the real `snapshotAdventurer('knight')` in — no procedural `pixelSprite` fallbacks anywhere), **CONTROLS** (live keybinds from the rebindable store via `getBind`/`keyLabel` + camera + gamepad note), **DARK PACTS** (sigil + the devil's-bargain explainer + the 6 rarity chips). Footer = progress dots + BACK/NEXT (last = "ENTER THE DUNGEON") + the tutorial-hints opt-in (persists `meta.tutorialEnabled` + `qf.gameplay.tutorials`). SKIP button + Esc both skip. Still gated on `meta.introSeen`; dev test-stage still skips it. Finish emits `INTRO_DISMISSED`.
- **Acceptance:**
  - [x] Paced 2–3 step intro with imagery, the core "you are the dungeon" loop, controls reference, and a "what's a Dark Pact" beat. *(CDP-verified: step 0 tagline + boss hero art + 3 phase sprites; step 1 "CONTROLS" 10 rows w/ live key "B"; step 2 "DARK PACTS" sigil + 6 rarities; nav dots track; screenshot confirms a polished, store-worthy first screen.)*
  - [x] Still first-run-gated; skippable on repeat. *(`introSeen` gate; SKIP/Esc; finish sets `introSeen=true` + persists the hint choice + emits `INTRO_DISMISSED` + closes clean — all verified, zero errors.)*
- **Files:** `src/hud/WelcomeIntroOverlay.js`, `src/hud/styles.css`.

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
  - [ ] **(Deferred from P2-6)** Self-inject the CoinFlip CSS (the ~275-line `.qf-coinflip*` block in `styles.css`) into `CoinFlipCinematic.js` like the other cinematics, and sweep the cinematics' bespoke-palette hex (Solo blue / Rival purple/crimson / FFXIV gold) → local CSS vars/tokens.
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
