export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    // Only assets needed for the Preload scene's loading bar.
  }

  create() {
    // Wait for the Google Fonts (Press Start 2P + VT323) to actually
    // download before any scene renders text. Phaser bakes each Text
    // into an off-screen canvas at create() time and does NOT re-render
    // when a font finishes loading later, so unloaded fonts result in
    // permanent monospace-fallback glyphs even though .style.fontFamily
    // claims the right family. Forcing the load here gates Preload (and
    // therefore MainMenu) on the fonts being cached.
    this._awaitFontsThenStart()
  }

  async _awaitFontsThenStart() {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          // Hit a few sizes — browsers may key cache entries by size, and
          // Phaser will request whatever pixel size the scene asks for.
          document.fonts.load('10px "Press Start 2P"'),
          document.fonts.load('78px "Press Start 2P"'),
          document.fonts.load('15px "VT323"'),
        ])
      } catch (e) { /* swallow — fall back to monospace if Google Fonts unreachable */ }
    }
    this.scene.start('Preload')
  }
}
