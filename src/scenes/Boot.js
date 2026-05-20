// Hard cap on the font wait. `document.fonts.load` never rejects when the
// network can't reach Google Fonts — it just never resolves — so without
// this cap the game would hang forever on a black Boot screen for any
// player who's offline or on a network that blocks fonts.gstatic.com.
const FONT_LOAD_TIMEOUT_MS = 3000

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
      const fonts = Promise.all([
        // Hit a few sizes — browsers may key cache entries by size, and
        // Phaser will request whatever pixel size the scene asks for.
        document.fonts.load('10px "Press Start 2P"'),
        document.fonts.load('78px "Press Start 2P"'),
        document.fonts.load('15px "VT323"'),
      ])
      // Race the font load against a timeout: whichever finishes first
      // wins. A normal connection resolves `fonts` in well under the cap,
      // so this never delays a healthy load — it only rescues a player
      // who can't reach Google Fonts (the game then starts with monospace
      // fallback glyphs instead of hanging on a black screen forever).
      const timeout = new Promise(resolve => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS))
      try {
        await Promise.race([fonts, timeout])
      } catch (e) { /* swallow — fall back to monospace if Google Fonts unreachable */ }
    }
    this.scene.start('Preload')
  }
}
