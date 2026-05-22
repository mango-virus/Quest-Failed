// Boot — the first scene. Warms the Google Fonts cache, then hands off to
// Preload immediately.
//
// IMPORTANT: Boot must NOT block on the font load. The previous version
// awaited `Promise.race([document.fonts.load(...), setTimeout(...)])` —
// but in a throttled / backgrounded tab (the dev preview, a minimized
// window) `setTimeout` is suspended AND `document.fonts.load` never
// resolves when fonts.gstatic.com is unreachable, so NEITHER side of the
// race settled and the game hung forever on a black Boot screen.
//
// Fonts are warmed fire-and-forget instead. Preload then spends seconds
// loading sprite/audio assets — far longer than the three tiny font files
// take — so MainMenu virtually always draws with the real glyphs anyway;
// on a rare slow connection it just falls back to monospace briefly
// instead of hanging.

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create() {
    this._warmFonts()
    this.scene.start('Preload')
  }

  // Kick the Google Font downloads (Press Start 2P + VT323) without
  // awaiting them — see the file header for why blocking here is unsafe.
  _warmFonts() {
    try {
      if (typeof document === 'undefined' || !document.fonts?.load) return
      // A few sizes — browsers may key font cache entries by pixel size.
      document.fonts.load('10px "Press Start 2P"')
      document.fonts.load('78px "Press Start 2P"')
      document.fonts.load('15px "VT323"')
    } catch { /* fonts unreachable — scenes fall back to monospace */ }
  }
}
