# Visual Standards — Quest Failed (Steam-bound)

**Quest Failed is being built into a full indie game for Steam. Visuals, VFX,
and animation are first-class requirements, not finishing touches.** This is the
canonical reference for the visual bar. Every session — and every UI / VFX /
screen / ability / effect / animation — is held to it.

> The test for everything we ship: **does this screenshot make someone want to
> buy the game?** If it looks like a gray-box that "just works," it isn't done.

`CLAUDE.md` carries the hard gate that points here. When in doubt, this file +
the live preview win.

---

## 0. The non-negotiable ritual — verify visuals before you commit

Building UI/VFX without looking at it is how messiness ships. For **any**
change that renders something (a screen, panel, button, effect, animation):

1. **Build it** using the tokens + components below (don't reinvent).
2. **Run it in the preview** (`preview_start` / reload).
3. **Screenshot it** (`preview_screenshot`) AND snapshot/inspect for exact
   values (`preview_snapshot`, `preview_inspect`) — OCR lies about small text.
4. **Self-audit** against the [pre-ship checklist](#9-pre-ship-checklist) —
   especially overlap, alignment, spacing, contrast, and motion smoothness.
5. **Fix** anything that reads as messy or accidental, then re-screenshot.
6. **Only then commit.** Put the proof screenshot in front of the user.

If a change isn't reachable in the preview yet, build a mango-gated test-fire
path (see §8) so it *can* be seen — never ship blind.

---

## 1. Design tokens — one palette, one scale, no raw values

The HUD already defines a real token system in `src/hud/styles.css` `:root`.
**Use the tokens. Never hardcode a hex color, font name, or magic number that a
token already covers.** Raw `#hex` in a component is a smell — it drifts from
the palette and breaks the alternate boss-archetype themes (the green/amber
`:root` variants further down `styles.css` retint via these same vars).

**Color (canonical — from `styles.css`):**
- Surfaces: `--void --bg-0 --bg-1 --bg-2 --bg-3 --bg-elev`
- Lines/borders: `--line --line-2 --line-bright`
- Text: `--text --text-mute --text-dim --text-faint`
- Accents: `--blood --blood-glow --blood-deep` (loss/boss),
  `--gold --gold-bright` (gains/milestones), `--xp --xp-bright`,
  `--hp --hp-low`, `--poison` (win), `--rumor` (arrival), `--warn`, `--info`
- Glows: `--glow-blood --glow-gold --glow-rumor`
- Layout: `--hud-top --hud-bottom --hud-side`

**Type (canonical):** `--pix` (Press Start 2P — headings/labels),
`--term` (VT323 — body/dialogue), `--mono` (JetBrains Mono — numbers/data).

**Gaps to fill (do this as part of the tokens pass — these don't exist yet and
their absence is why spacing/motion drift):**
- **Spacing scale** — `--space-1..6` (e.g. 4/8/12/16/24/32px). All padding,
  gap, and margin should snap to it. No more ad-hoc `13px`.
- **Type scale** — `--fs-xs..xl` so headings/body/captions are consistent.
- **Radius** — `--radius-sm/md/lg`.
- **Motion** — `--ease-*` and `--dur-*` (see §4). **Critical for animation.**

When you add a token, add it in `:root` and (if color) in each theme variant.

---

## 2. Layout & tidiness — nothing messy, nothing overlapping

The user's explicit bar: **no overlapping text or graphics unless deliberate;
elements aligned and correctly placed; never messy.**

- **No accidental overlap.** Text must never collide with text or graphics
  unless it's an intentional, designed layering. Screenshot and look.
- **Align to a grid.** Things line up — shared left edges, consistent gaps
  (snap to the spacing scale), optical centering. Ragged = unfinished.
- **Centering with corner items:** position corner items `absolute`; let the
  main item center via `justify-content: center`. **Never** `space-between` to
  fake centering — corner widths bias the middle. (Lesson #3.)
- **Size to content.** Spotlight/"look at this" modals start compact (~460×480),
  grow only on overflow — the `Overlay` default (1200×780) is too big for one
  item. Audit empty space before shipping. (Lessons #8.)
- **Re-tune on content change.** Change a component's shape (1-line↔2-line,
  icon add/remove) → re-walk its padding/gap/min-height. (Lesson #9.)
- **Responsive / scale-safe.** The HUD scales (`stageScale.js`). Prefer
  relative units / `clamp()`; don't hardcode absolute pixel positions that
  break at other scales. Test at mobile/tablet/desktop via `preview_resize`.
- **`filter`/`opacity` don't un-set on descendants** — to keep a child bright
  inside a dimmed parent, move it structurally OUT of the filtered subtree.
  (Lesson #2.)

---

## 3. Typography

- Use the three font tokens by role (`--pix` headings, `--term` body/dialogue,
  `--mono` numbers). Don't introduce new fonts.
- **Press Start 2P is heavy** — keep it for short labels/headings; never long
  paragraphs (use `--term`). Watch legibility at small sizes; give it
  letter-spacing and enough line-height.
- Establish hierarchy with the type scale + weight/color, not random sizes.
- Every text slot communicates something **distinct** — no showing the same
  string in a centerpiece and a name slot. (Lesson #7.)

---

## 4. Animation & motion — beautiful, smooth, professional (a core focus)

**Always ask first: would an animation make this moment more impressive and
polished?** Often yes. When you animate, it must look *professional* — smooth,
choreographed, intentional — not "janky motion that technically works." A
polished animation is one of the strongest signals of "this is a complete game."

**Pick the depth deliberately:**
- **Basic** (tooltips, hovers, value changes, list items): a crisp fade/slide
  with proper easing. Fast, clean, unobtrusive.
- **Advanced / cinematic** (Victory, boss evolution, the Act IV duel, rare
  unlocks, big state changes): full choreography — staggered reveals, particle
  bursts, camera/letterbox moves, slow-mo, overshoot settles. These are the
  screenshot/trailer moments — invest in them.

**Principles (apply the classic animation principles):**
- **Easing is everything.** Never linear for UI motion (only for continuous
  loops). Entrances ease-OUT, exits ease-IN, emphasis uses overshoot/spring.
  Define easing tokens and use them:
  - `--ease-out: cubic-bezier(.16,.84,.3,1)` (entrances)
  - `--ease-in: cubic-bezier(.6,0,.84,.16)` (exits)
  - `--ease-spring: cubic-bezier(.18,.9,.25,1.2)` (pop/emphasis)
- **Duration scale:** `--dur-fast: 120ms` `--dur-base: 240ms` `--dur-slow: 400ms`
  `--dur-hero: 800ms+`. Be consistent; don't scatter random ms values.
- **Anticipation → action → follow-through.** Add squash/stretch, a small
  overshoot-and-settle, and secondary motion. Motion with no follow-through
  reads cheap.
- **Choreography.** Stagger related elements (~40–80ms apart) instead of
  popping everything at once. Sequence beats so the eye is led.
- **Smoothness = animate `transform`/`opacity` only** (GPU-composited, 60fps).
  **Do NOT animate layout properties** (`width/height/top/left/margin`) — they
  jank. Use `will-change` sparingly and remove it after.
- **No jank, ever.** No teleporting elements, no abrupt start/stop, no
  re-animating in place — to re-run a CSS entrance, swap a fresh DOM node
  (`replaceChild`). (Lesson #17.) Watch it run in the preview before commit.
- **Avoid INFINITE animations on overlays — they break `preview_screenshot`.**
  A perpetual DOM animation (`... infinite`) keeps the page from ever reaching a
  stable frame, so the screenshot tool hangs and times out (30s) — which kills
  your own visual-QA loop. Confirmed on the Kingdom Response reveal: an infinite
  emblem float made every screenshot time out; removing it fixed capture
  instantly. Prefer finite entrance animations that settle. If you truly need an
  ambient idle loop, gate it so a screenshot pass can pause it, or animate a
  non-compositing property — but the safe default is: entrance plays, then hold.
- **Honor reduced motion.** Gate the big stuff behind
  `@media (prefers-reduced-motion: no-preference)` / our reduced-motion toggle,
  with a tasteful non-animated fallback (see §7 accessibility).

---

## 5. VFX & game feel — "juice"

> ### ⛔ The anti-generic gate (read before building ANY new VFX)
> A plain **circle / ellipse / ring** (`shockwaveFx`, `pulseRing`, `add.circle`,
> `add.ellipse`) as the **hero read** of an effect is the cheap, same-y fallback —
> the user has flagged it more than once ("this is just a circle again. you keep
> falling back to that"). The discipline is now **enforced**, not optional:
>
> 1. **Concept first.** Before coding a VFX, write a one-line concept naming its
>    unique **silhouette + motion** and *why it isn't a ring/circle* — and show it
>    to the user. (e.g. Acid Flood = "erupting acid geysers sweeping outward + a
>    lobed flooding sheet," not a shockwave ring.)
> 2. **Build to the detail bar.** Custom shaded silhouette (drop-shadow + body +
>    shade-side + highlight, drawn as a path — see `_drawBoneSpike` / `_drawAcidColumn`
>    / `_drawMiasmaPuff`), choreographed motion (anticipation → overshoot → settle),
>    composed sub-elements. A flat single-colour shape is never acceptable as a hero.
> 3. **`npm run lint-vfx` must pass** (it's in the pre-commit hook). It fails on any
>    untagged `add.circle/ellipse`/`pulseRing`/`shockwaveFx` in `AbilityVfx.js`. A
>    legit incidental (bubble, droplet, spec dot, flash core, deliberate accent ring)
>    gets a conscious `// circle-ok: <reason>` tag; a lazy hero-ring gets replaced.
> 4. **Compare in the gallery.** `__qfDev.vfxGallery()` renders the whole library in
>    a grid — eyeball your new effect against the others; if it *rhymes* with one,
>    redesign it.
> 5. **Verify zoomed-in, then show the user.** Screenshot the hero element at full
>    extent in the VFX Lab (`__qfDev.vfxLab()`); if it reads as a generic shape, redo
>    it. Don't claim a VFX done without the screenshot.
>
> **No hard geometric shapes.** A flat oval/ellipse, a square/rectangle, or a clean
> circle/ring as a VFX field/glow/hero element reads cheap. Make it **organic** — an
> irregular lobed blob (outline = a ring of points × per-vertex noise), layered in
> 2–3 tones, gently breathing/animated (see the `heat()`/`wash()` helpers in
> `hellfireAuraFx`/`infernoFx`, or `_drawAcidBlob`). Clean shapes are fine only for a
> tiny incidental (bubble, spec dot, flash core), a deliberate accent ring, or when
> the fiction itself is geometric (a sigil, shield dome, UI frame). `lint-vfx` catches
> `add.circle/ellipse/ring` but NOT `add.rectangle` / graphics `fillEllipse/fillRect`
> — keep those organic yourself.
>
> **Vary the COMPOSITION, not just the shapes.** A second same-y trap (user flagged
> it 2026-06-11: "you keep doing similar animations… some graphic in a circle around
> the sprite"): even with organic shapes, every ult had defaulted to the SAME staging
> — *N objects spawned in a ring/spread around the caster, erupting outward* (tombstone
> ring, geyser spread, fire columns, stone rampart). Don't reuse that layout. Each ult
> picks a **deliberately different composition** — effect ON the unit (a material/state
> transform), **converging/assembling inward** (opposite motion), a directional sweep,
> a single giant hero element (not N small ones), a link/network between units, a
> vertical drop-in. Name the chosen composition in the concept line and why it isn't
> "another ring of objects." (Fix that landed: Golem Bastion ring-of-slabs → **Stone
> Carapace** = plates fly *inward* and clamp onto the golem's body slots — armour
> assembling ON the sprite, verified on-screen.)
>
> This gate is a **definition of done** for VFX, not a suggestion.

The biggest lever from "asset flip" to "premium." Layer it on, tastefully:
- **Impact:** hitstop (freeze a few frames on a big hit/kill), screen shake
  (scaled to weight), flash/chromatic pop on crits.
- **Particles:** bursts on kills, seals, level-ups, evolutions; ambient motes
  for atmosphere. Reuse the existing VFX pack / `DungeonFx`.
- **Squash & stretch / scale punches** on spawn, pickup, button press.
- **Anticipation telegraphs** for abilities (wind-up → release).
- **Audio-visual sync** — a beat lands *with* its sound. Route audio through
  `src/hud/HudSfx.js` (volume/cooldown/mute-aware); never raw `sound.play()`.
  (Lesson #16.)
- Keep it **cohesive** — one VFX language (color, particle style, timing), not
  a grab-bag. It should all feel like the same dark-fantasy "BONEMAKER" game.

### The VFX toolkit — compose effects from these (don't hand-draw Graphics)

`src/ui/AbilityVfx.js` has a toolkit built on Phaser 3.60's real VFX (GPU
particles + additive blend + `postFX.addGlow` — WebGL is on via `Phaser.AUTO`).
**Compose new effects from these**, not from raw `Graphics` circles/lines (which
read flat). All are Canvas-safe (postFX in try/catch), quality-aware, self-cleaning:

- `particleBurstFx` (energy burst) · `impactFx` (hit: flash+spray+ring) ·
  `shockwaveFx` (glow rings) · `beamFx` (A→B beam) · `projectileFx` (travelling
  orb + trail + impact) · `burnFx` (sustained DoT/aura emitter) · `glowPulseFx`
  (charge/heal aura) · `sparkleFx` (accents) · `juice` (impact + camera shake +
  flash — the "feel" layer) · `flipbookFx` (play an authored `vfx-*` 64×64 sheet
  + glow).
- Colour via `VfxPalette` presets — pass `palette: 'fire'|'ice'|'holy'|'shadow'|
  'poison'|'arcane'|'blood'` for cohesion (don't hardcode random colours).

**Iterate on motion** with the filmstrip: `window.__qfDev.filmstrip(name, {slow})`
fires one effect heavily slowed (and dismisses act-intro popups) so you can
screenshot frames across its lifecycle and tune the timing — VFX/animation is
iteration on motion, so *watch it*, don't ship from one frame.

Root note: before 2026-06-05 every effect was hand-drawn `Graphics`+tweens (zero
particles/postFX/shaders) despite the engine supporting all of it — that's what
made effects read "basic." Use the toolkit.

---

## 6. Component reuse — don't reinvent the chrome

Consistency *is* tidiness. Before inventing UI, reuse what exists:
- **Buttons:** the pixel-bevel `.btn` (+ `.primary` blood variant) in
  `styles.css` ~L376. It already gives font, bevel, shadow, hover sheen,
  press, focus ring. A custom `box-shadow:0 0 14px` button reads as a generic
  web button next to BEGIN DAY. (Lesson #1.)
- **Modals:** the `Overlay` shell (`src/hud/Overlay.js`) — built once;
  per-state header/accent goes INSIDE the body, not the shell. Scope
  per-overlay tweaks with `:has(.qf-your-card)`. (Lessons #4, #5.)
- **Frame vs content:** the outer frame is the feature's identity; per-state
  accent goes on inner content only — don't let it leak to the frame. (#6.)
- **Audio:** add a cue to `HudSfx.js`. **Components self-inject their CSS once**
  (the ActIntro/NemesisPortrait/VictoryScreen pattern) — keep that.

---

## 7. Accessibility (also helps Steam Deck "Verified")

- **Contrast:** body text meets a readable contrast on its surface. Don't put
  `--text-dim` on `--bg-3` for anything that must be read.
- **Colorblind-safe:** never encode critical state in hue alone — pair color
  with icon/shape/label. (Plan a colorblind palette toggle.)
- **Text size + reduced-motion toggles** (settings). Reduced-motion must have
  real non-animated fallbacks, not just disabled transitions that break layout.

---

## 8. Signature screenshot moments + test paths

- **Make the hero screens key-art quality:** Victory, Game Over, boss
  evolution, the Act IV duel. These are the Steam store images and trailer
  beats — they get the cinematic animation treatment (§4 advanced).
- **Test-fire path:** any UI that fires on a future/rare event (unlock,
  level-up, victory, evolution) needs a mango-gated test trigger in
  `MainMenuOverlay` so it can be iterated + screenshot-QA'd without grinding.
  (Lesson #15.)

---

## 9. Pre-ship checklist

Walk this before screenshotting/committing any visual work:

1. **Tokens** — colors/fonts/spacing/easing all from tokens, no raw values?
2. **Reuse** — used `.btn` / `Overlay` / `HudSfx` instead of reinventing?
3. **Overlap** — no text/graphic colliding unless deliberate?
4. **Alignment & spacing** — aligned to grid, gaps on the spacing scale?
5. **Centering** — corners absolute, not `space-between`?
6. **Sizing** — compact for its content; empty-space audited?
7. **Slots** — each text/visual slot distinct content?
8. **Filter scope** — anything meant-bright trapped in a dimmed parent?
9. **Frame vs accent** — outer frame = identity; per-state color stays inner?
10. **Motion** — eased (not linear), `transform`/`opacity` only, smooth at
    60fps, staggered, reduced-motion fallback?
11. **Juice** — does the moment deserve impact/particles/sound, and are they in?
12. **Responsive** — checked at other scales (`preview_resize`)?
13. **Contrast** — readable; state not hue-only?
14. **Proof** — screenshot taken, audited, shown to the user?

Any "no" → fix before commit.

---

## File pointers

- Tokens / palette: `src/hud/styles.css` `:root` (~L60+) and theme variants.
- Buttons: `src/hud/styles.css` ~L376 (`.btn`, `.btn.primary`).
- Overlay shell: `src/hud/Overlay.js`. `:has()` scoping: search `:has(.qf-ach)`.
- Audio cues: `src/hud/HudSfx.js`. VFX: `src/hud/DungeonFx.js` + the VFX pack.
- Self-injecting component CSS pattern: `src/hud/VictoryScreen.js`,
  `NemesisPortrait.js`, `ActIntro.js`.
- Scene/phase transitions: `src/hud/PhaseTransition.js`.
- Cinematic reference (advanced motion done right): `src/hud/SoloLevelingCinematic.js`,
  `LightPartyCinematic.js`.
- Mango-gated dev/test triggers: `src/hud/MainMenuOverlay.js` (`isCheatName()`).
