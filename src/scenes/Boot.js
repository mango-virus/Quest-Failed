export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    // Only assets needed for the Preload scene's loading bar.
  }

  create() {
    this.scene.start('Preload')
  }
}
