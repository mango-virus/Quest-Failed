// DissolvePipeline — a reusable WebGL post-FX that DISINTEGRATES a sprite's
// pixels, sampled on a pixel-art-quantized grid so the art crumbles in blocks
// of pixels (never a smooth gradient). A glowing EMBER edge (orange→white)
// rides the dissolve front as each block chars away, so it reads as the art
// being incinerated to ash rather than just fading out.
//
// Concept (per VISUAL_STANDARDS §5 anti-generic gate): the silhouette IS the
// source art itself eroding — a noise-thresholded "Thanos-snap" scatter with a
// hot burn-line at the unmaking front. Not a ring, not a burst.
//
// Drive it by tweening the per-instance `progress` 0→1. `uOffset` lets several
// sprites (e.g. the tiles of one room) share ONE continuous noise field so the
// scatter reads as a single surface, not a per-tile repeat.
//
// WebGL only (Phaser.AUTO → WEBGL in the Electron build). Callers must gate on
// `scene.renderer.type === Phaser.WEBGL` and fall back when registration fails.

const FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform float progress;   // 0 = intact, 1 = fully dissolved
uniform vec2  uBlocks;    // noise cells across x,y (square pixel-blocks on any aspect)
uniform float uEdge;      // width of the ember burn band, in noise units
uniform vec2  uOffset;    // whole-cell offset → continuous field across sprites
uniform vec3  uEmber;     // burn colour at the band's trailing edge
uniform vec3  uTip;       // hot colour at the immediate dissolve front
varying vec2 outTexCoord;

// cheap value hash → per-cell threshold in [0,1]
float hash(vec2 p) {
  p = floor(p);
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = outTexCoord;
  vec4 col = texture2D(uMainSampler, uv);

  // Quantize to a grid so dissolve happens in blocks of pixels, and offset by
  // whole cells so adjacent sprites continue the same noise field.
  vec2 cell = floor(uv * uBlocks) + uOffset;
  float n = hash(cell);

  // Past the front → unmade. Transparent source pixels never glow.
  if (n < progress) { discard; }

  if (col.a > 0.01) {
    float d = n - progress;            // how far this cell is ahead of the front
    if (d < uEdge) {
      float t = 1.0 - d / uEdge;       // 1 at the front, 0 at the band's far edge
      vec3 burn = mix(uEmber, uTip, t * t);
      col.rgb = mix(col.rgb, burn, min(1.0, t * 1.35));   // char the block toward ember
      col.rgb += burn * 0.9 * pow(t, 2.0);                // additive hot lip at the front
    }
  }
  gl_FragColor = col;
}
`

function _PipelineClass() {
  return class DissolvePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game) {
      super({ game, name: 'QFDissolve', fragShader: FRAG })
      this.progress = 0
      this.blocks   = [16, 16]    // cells across x,y; set per-clone for square ~3px blocks
      this.edge     = 0.20
      this.uOffset  = [0, 0]
      this.ember    = [1.0, 0.45, 0.08]   // orange
      this.tip      = [1.0, 0.95, 0.70]   // near-white hot lip
    }
    onPreRender() {
      this.set1f('progress', this.progress)
      this.set2f('uBlocks',  this.blocks[0], this.blocks[1])
      this.set1f('uEdge',    this.edge)
      this.set2f('uOffset',  this.uOffset[0], this.uOffset[1])
      this.set3f('uEmber',   this.ember[0], this.ember[1], this.ember[2])
      this.set3f('uTip',     this.tip[0],   this.tip[1],   this.tip[2])
    }
  }
}

let _registered = false

// Register the pipeline once on the game's WebGL renderer. Returns true if the
// pipeline is available to use, false on Canvas / any failure (caller falls back).
export function ensureDissolvePipeline(scene) {
  if (_registered) return true
  const renderer = scene?.renderer || scene?.sys?.game?.renderer
  if (!renderer || renderer.type !== Phaser.WEBGL || !renderer.pipelines) return false
  try {
    renderer.pipelines.addPostPipeline('QFDissolve', _PipelineClass())
    _registered = true
    return true
  } catch (e) {
    return false
  }
}

export const DISSOLVE_PIPELINE_KEY = 'QFDissolve'
