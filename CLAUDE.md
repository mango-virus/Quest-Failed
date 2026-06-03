# Working on Quest Failed

## ⛔ Visual quality bar — this game is going to Steam (read first, applies to ALL sessions)

**Quest Failed is being built into a full, polished indie game for sale on Steam.
Visuals, VFX, and animation are first-class requirements — not afterthoughts.**
This is a hard gate on every UI / screen / menu / ability / effect / animation you
touch (new or existing):

- **Make it look bought, not bootstrapped.** Real visual investment, every time.
  The test: *would this screenshot make someone want to buy the game?*
- **Clean & tidy.** No overlapping text or graphics unless deliberate; elements
  aligned and correctly placed; never messy or accidental-looking.
- **Animation is a focus.** Always consider whether an animation would make a
  moment more impressive/polished — it often does. When you animate, it must be
  **beautiful, smooth, and professional** (proper easing, choreographed timing,
  follow-through), not "janky motion that just works." Choose basic vs. advanced
  deliberately; give hero moments (Victory, boss evolution, the duel) cinematic
  treatment.
- **Verify visuals before committing.** For anything that renders: build it with
  the tokens/components, run it in the preview, **screenshot + self-audit**
  against the checklist, fix what's messy, *then* commit and show the proof.

**`VISUAL_STANDARDS.md` is the canonical reference** (palette/tokens, layout &
tidiness rules, the animation + motion standard, the juice/VFX guide, the
pre-ship checklist). Read it before doing visual work. The bar applies
retroactively too — older placeholder UI/VFX gets brought up to standard.

## The one rule that prevents stale references

**The code is the source of truth for what exists.** Before asserting any feature's status
("traps aren't done", "there are 45 achievements", "combos work"), grep/read the actual code —
**never trust a ✅ in a doc blindly.** The docs drift; the code doesn't. The docs below describe
*intent* and *structure*; for *current reality*, verify against `src/`.

## Reference documents (read `STATUS.md` first)

1. **`STATUS.md`** — the short, reality-derived snapshot of what's actually built right now
   (live content counts + what's solid vs. stubbed). **Read this first every session.** It is
   re-verified against code periodically (last: 2026-05-31). When any other doc disagrees with
   STATUS.md or the code, STATUS.md + the code win.

2. **`ARCHITECTURE.md`** — technical reference: systems, scenes, the two-layer (Phaser canvas +
   DOM HUD) rendering, GameState schema, cross-cutting patterns + gotchas. Regenerated from code
   2026-05-31. How things are wired.

3. **`DESIGN.md`** — FROZEN design intent / history (the original brief + struck-through cuts).
   Source of truth for *what the game is meant to include and why* — **not** for what's currently
   built. On design-intent questions, this file wins.

4. **`DESIGN_COVERAGE.md`** — the per-deliverable ledger (design → phase → status). Useful for
   history and scope, but it had drifted from code (corrected 2026-05-31); always verify a row's
   ✅ against the code before trusting it.

5. **`VISUAL_STANDARDS.md`** — the canonical visual bar for this Steam-bound game: design tokens,
   layout & tidiness rules, the animation/motion standard, the VFX/juice guide, and the pre-ship
   visual-QA checklist. **Read before any UI / VFX / screen / animation work** (see the gate at
   the top of this file).

---

## Keeping the docs honest (lightweight)

The game is past the "march through numbered phases" stage — it's in mature feature-add +
polish mode. The old heavy "audit every DESIGN_COVERAGE row at every phase exit" ritual was
too costly to actually follow, and skipping it is exactly how the docs drifted (combos shown
✅ when retired, "45 achievements" when there are 92, etc.). Replace it with this much cheaper
discipline, applied **when you finish a piece of work**:

1. **If you changed a content count** (added/removed a room, minion, trap, pact, event, class,
   companion, achievement…), update the count in **`STATUS.md`** — it's one short table, keep
   it true. Don't hand-count: run **`npm run verify-docs:fix`** to auto-sync the counts from
   the data files, or **`npm run verify-docs`** to just check (exits non-zero on any drift).
2. **If you finished or changed a tracked feature**, update its row in `DESIGN_COVERAGE.md` to
   match reality. Don't mark ✅ unless you verified it in code.
3. **If the user adds a new design idea**, record it in `DESIGN.md` (their wording) +
   `DESIGN_COVERAGE.md` (phase + status) before implementing.
4. **Never write a ✅ you didn't verify.** A status you can't back with a code reference should
   be 🟡 / ⏳, not ✅.

That's it. A correct one-line STATUS.md edit beats a 1,000-row audit nobody runs.

---

## When the user adds new design ideas

If the user mentions a new mechanic, room, personality, etc. mid-conversation:
1. Add it to `DESIGN.md` (preserve their wording).
2. Add it to `DESIGN_COVERAGE.md` with phase + status (default ⏳ PENDING).
3. Implement only after both files are updated.

If the user wants something *removed*, mark it as removed in both files (don't silently delete history) and update phase assumptions.

---

## ⛔ Spec fidelity for multi-part features (READ — a major miss happened here)

When the user locks a feature that has **multiple specified details** (a class's abilities, a
multi-step mechanic, an event's beats), follow this exactly — drift on these is the most
damaging failure mode:

1. **Capture VERBATIM.** Put the user's *exact wording* into `DESIGN.md` the moment it's locked
   — never a paraphrase. You implement from the verbatim spec, **not** from memory. (Memory
   notes summarize and drift; they are a pointer to the spec, not the spec.)
2. **Build a per-detail acceptance checklist** (one ☐ per spec detail) in `DESIGN.md`/
   `DESIGN_COVERAGE.md`. Every clause of the spec = one checkbox.
3. **Suggest freely, but CONFIRM before implementing.** Proposing additions/inventions/ideas is
   encouraged — that's wanted. What's NOT allowed is silently *building* your own interpretation
   into a locked feature. If a detail is missing/ambiguous or you have an idea, surface it and get
   a yes before coding it. (The norm is to do this well; the miss here was implementing an
   unconfirmed interpretation.)
4. **Verify before "done":** re-read the verbatim spec, tick each checklist item against the
   **actual code**, and **show the user the checklist**. Don't claim a feature is built/verified
   until every box is ticked or explicitly deferred.

History: the 5 new-class abilities (2026-06-03) were built from a drifted memory paraphrase
instead of the locked spec — the Miner became a teleport (should be a dig-and-travel hole), the
Valkyrie's Rally gained an invented buff and lost its cast-time revive, Gladiator's Block didn't
cover boss fights, etc. The user flagged it as a major issue. Don't repeat it.

---

## When implementation diverges from design

If during implementation you find yourself changing scope (renaming things, splitting a feature, dropping a sub-item):
- **Surface it explicitly** to the user before committing.
- If approved, update `DESIGN.md` (with a "(deviation noted: …)" parenthetical) and `DESIGN_COVERAGE.md` to match.
- Never silently rewrite the design.

---

## Specific gotchas for this codebase

- **Scenes communicate via `EventBus`**, never direct calls. New systems should subscribe/emit.
- **GameState must stay JSON-serializable** — no class instances inside, plain objects only. SaveSystem rehydrates on load.
- **All game content lives in `src/data/*.json`** — adding a new room/personality/minion/trap is a JSON edit, not a code change. Behavior hooks reference handler IDs registered in code.
- **Tile size is 32px** (`Balance.TILE_SIZE`). World coords = tile coords × 32. Don't hardcode 32.
- **Renderer is currently Graphics-based wireframe** — pixel art tilesets land opportunistically when assets arrive. Don't polish the procedural look further.
- **AdventurerRenderer reads `worldX/worldY`** which AISystem updates each tick — don't compute positions in the renderer.
- **`window.__game`** is the Phaser game instance (set in `src/main.js`); useful for browser console debugging.
- **LPC sprites — use the REVISED palette, not Universal (user rule, 2026-06-03).** When choosing colors for any LPC adventurer sprite (hair, metal/armour, cloth, etc.), prefer the LPC **revised** ("ZAP"/revised) color names the items expose (e.g. `rev_silver`, `rev_gold`, `ice`, `lavender`, `porcelain`, `ivory`, `amethyst`, `cerise`, `apricot`, `beige`, `linen`, `peach`, `platinum`, `blonde`, `sky`) over the older Universal names. Verify the chosen names exist in the item's `variants`/palette before baking.

---

## Project maturity (not "Phase 6 next" anymore)

The numbered-phase plan (1–10b in `DESIGN_COVERAGE.md` §29) is **all shipped**. The game is
mature: 12 bosses, 21 rooms, 64 minions, 8 traps, 96 pacts, 36 events, 25 classes, 9
companions, 92 achievements, a full DOM HUD (`src/hud/`, default on), audio, VFX, leaderboard,
and scripted set-piece events (Solo Leveling, Light Party). Current work is **bug-fixing,
balance, content additions, and polish** — plus the bigger open questions for a commercial
release (a win condition / run structure, active day-phase boss agency, and filing off the
Solo Leveling / FFXIV / Twitch IP references). See `STATUS.md` for the live snapshot.
