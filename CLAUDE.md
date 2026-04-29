# Working on Quest Failed

This project has three reference documents. **Read them in this order at the start of any session.**

1. **`DESIGN.md`** — the player/designer's original game design sheet, preserved verbatim. **This is the source of truth for what the game must include.** When anything else in the repo conflicts with this file, this file wins.

2. **`DESIGN_COVERAGE.md`** — enumerated checklist of every concrete deliverable from the design sheet, with phase assignment and current status. **This is the file you check off against.** Never declare a phase complete without auditing every row tagged for that phase.

3. **`ARCHITECTURE.md`** — technical reference for systems, scenes, schemas, and the phase build order. Implementation guide.

---

## Phase exit ritual (mandatory)

Before declaring any phase complete, run this audit:

1. **Open `DESIGN_COVERAGE.md`** and find every row tagged with the current phase.
2. **For each row**, verify the status against the codebase — don't trust the file blindly, actually grep / read the relevant code.
3. **Update statuses** in `DESIGN_COVERAGE.md` to reflect reality (✅ DONE / 🟡 PARTIAL / ⏳ PENDING / 💭 OPEN).
4. **For anything still PENDING or PARTIAL** at phase exit:
   - Either implement it now, OR
   - Get explicit user approval to defer to a later phase, AND update the row's phase column to reflect the new target.
5. **Surface any new design items** the user mentioned in conversation that aren't yet in `DESIGN_COVERAGE.md` — add them with phase + status before continuing.
6. **Bump the "Last full audit" date** at the top of `DESIGN_COVERAGE.md`.

Skipping this ritual is what caused 10 personalities + 3 classes to silently drift out of Phase 5. Don't repeat that.

---

## When the user adds new design ideas

If the user mentions a new mechanic, room, personality, etc. mid-conversation:
1. Add it to `DESIGN.md` (preserve their wording).
2. Add it to `DESIGN_COVERAGE.md` with phase + status (default ⏳ PENDING).
3. Implement only after both files are updated.

If the user wants something *removed*, mark it as removed in both files (don't silently delete history) and update phase assumptions.

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

---

## Current phase

See `DESIGN_COVERAGE.md` section 29 ("Phase-by-phase summary") for the canonical phase list and status. As of the last audit, Phase 5 (Personality System) is complete and Phase 6 (Combat) is next.
