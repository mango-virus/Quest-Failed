# Quest Failed — Desktop shell (Electron)

This folder wraps the existing static web game as a desktop application, the first
step toward a Steam release. It does **not** modify the web build — `index.html` and
everything under `src/` are loaded as-is. The web version still runs unchanged.

## Run it

```sh
cd desktop
npm install      # one-time: pulls Electron (~big download)
npm start        # launches the game in a desktop window
```

`npm start` runs the game in-place (it reads the game files from the parent folder),
so there's no copy/build step for local dev.

## How it works (Phase 1)

- The whole game directory is served over a custom **`app://qf/`** scheme. Registering
  it as *standard + secure* is what lets the game's ES modules load and lets
  `localStorage` (the current save mechanism) **persist to disk and survive restarts**,
  per-origin, automatically.
- The Phaser CDN `<script>` in `index.html` is transparently redirected to the vendored
  copy in `vendor/phaser.min.js`, so the engine **boots with no network**.
- The Google Fonts `<link>` is redirected to the vendored `vendor/fonts.css`, whose
  `url()`s point at locally vendored `vendor/fonts/*.woff2`, so **fonts render with no
  network**.
- All other `https` (the leaderboard) passes through to the real network when
  online and degrades gracefully when offline (the game already has fallbacks).

### Keyboard
- **F11** — toggle fullscreen
- **Alt** — reveal the menu bar (auto-hidden)
- **Ctrl+Shift+I** — devtools

### Crispness / window size
The game renders at the window's **native resolution** (Phaser `Scale.RESIZE` — the
drawing buffer tracks the window size), so it's crisp at **any** size or aspect,
including fullscreen. The window is freely resizable (default 1600×900). On
non-16:9 windows the playfield simply shows a bit more space instead of letterboxing.
(HiDPI note: at devicePixelRatio > 1, `RESIZE` renders at CSS pixels, so a HiDPI
display would still upscale slightly — a future tweak can multiply the buffer by DPR;
unverified pending a HiDPI machine.)

## Known Phase-1 gaps (intentional — later phases)

- **Saves** live in Electron's per-origin localStorage on disk. Robust on-disk save
  files + **Steam Cloud** sync come in Phase 2 (with steamworks.js).
- **No packaging yet.** `npm start` runs in dev. Producing a distributable `.exe`/`.app`
  (electron-builder) + code signing + Steam depot upload is Phase 3 — that step also has
  to relocate the game files into the packaged app's resources.

## Vendored files

- `vendor/phaser.min.js` — Phaser 3.60.0 (matches the CDN version in `index.html`).
  Re-vendor if the game bumps its Phaser version.
- `vendor/fonts.css` + `vendor/fonts/*.woff2` — the Google Fonts families referenced in
  `index.html` (Cinzel, JetBrains Mono, Jersey 25, Pixelify Sans, Press Start 2P,
  Silkscreen, VT323), rewritten to local paths. Re-vendor if the `<link>` in `index.html`
  changes which families/weights it requests.
