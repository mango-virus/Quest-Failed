// chiptune.mjs — procedural 8-bit SFX synthesizer (no deps, no network).
//
// WHY: bitcrushing recorded/AI audio sounds "muffled lo-fi", not real 8-bit. True
// chiptune is SYNTHESIZED from square/triangle/saw/noise oscillators with pitch
// sweeps, arpeggios and envelopes — that's what gives the classic bleep/blip/zap.
// Bonus: everything generated here is ORIGINAL and fully commercial-safe (no
// licensing / placeholder swap needed, unlike the AI clips).
//
// USAGE:
//   npm run audio:chiptune                 # render every spec → assets/audio/<key>.wav (8-bit)
//   npm run audio:chiptune -- --era 16bit  # fuller SNES flavor (detune + PWM + warmth)
//   npm run audio:chiptune -- --era 16bit --suffix .16bit  # write the 16-bit A/B set
//   npm run audio:chiptune -- --only boss  # only keys containing "boss"
//   npm run audio:chiptune -- --list       # list spec keys, render nothing
//   npm run audio:chiptune -- --out /tmp   # write elsewhere
// Then: npm run audio:board   and reload the soundboard.
//
// Tuning a sound = edit its entry in SPECS below and re-run. Each spec is one or
// more "voices" (oscillator + envelope + pitch motion) that get summed.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SR = 44100
let ERA = '8bit'   // '8bit' = pure NES bleeps · '16bit' = fuller SNES (detune + PWM + warmth)

// ── one oscillator voice ─────────────────────────────────────────────────────
// Fields (all optional except freq/dur):
//   wave: 'square'|'triangle'|'saw'|'sine'|'noise'   duty: square duty 0..1
//   freq: start Hz    dur: seconds    start: offset seconds into the sound
//   slide: semitones swept across dur (exponential; +up/-down)
//   vib: vibrato depth (fraction of freq)   vibRate: Hz
//   arp: [semitone offsets] cycled every arpRate s (overrides slide)
//   env: {a,d,s,r} attack/decay(s)/sustain(0..1)/release in seconds (default percussive)
//   vol: 0..1       period: noise sample-hold length (samples; >0 = tonal/metallic noise)
function V(o) {
  return { wave:'square', freq:440, dur:0.15, start:0, duty:0.5, slide:0,
           vib:0, vibRate:6, arp:null, arpRate:0.045, env:null, vol:0.5, period:0, ...o }
}

function renderVoice(buf, v) {
  const a = v.env?.a ?? 0.004, d = v.env?.d ?? v.dur, s = v.env?.s ?? 0, r = v.env?.r ?? 0.01
  const n = Math.floor(v.dur * SR)
  const off = Math.floor(v.start * SR)
  let phase = 0, holdVal = 0, holdCnt = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    // pitch
    let f = v.freq
    if (v.arp) { const step = v.arp[Math.floor(t / v.arpRate) % v.arp.length]; f = v.freq * 2 ** (step / 12) }
    else if (v.slide) f = v.freq * 2 ** (v.slide * (t / v.dur) / 12)
    if (v.vib) f *= 1 + v.vib * Math.sin(2 * Math.PI * v.vibRate * t)
    // oscillator
    let sample
    if (v.wave === 'noise') {
      if (v.period > 0) { if (holdCnt <= 0) { holdVal = Math.random() * 2 - 1; holdCnt = v.period } holdCnt--; sample = holdVal }
      else sample = Math.random() * 2 - 1
    } else {
      phase += f / SR; if (phase >= 1) phase -= 1
      let duty = v.duty
      if (v.pwm) duty = Math.max(0.05, Math.min(0.95, v.duty + v.pwmDepth * Math.sin(2 * Math.PI * v.pwmRate * t)))
      if (v.wave === 'square')        sample = phase < duty ? 1 : -1
      else if (v.wave === 'triangle') sample = 4 * Math.abs(phase - 0.5) - 1
      else if (v.wave === 'saw')      sample = 2 * phase - 1
      else                            sample = Math.sin(2 * Math.PI * phase)   // sine
    }
    // ADSR envelope
    let env
    const tToEnd = (n - i) / SR
    if (t < a) env = t / a
    else if (t < a + d) env = 1 - (1 - s) * ((t - a) / d)
    else env = s
    if (tToEnd < r) env *= tToEnd / r            // release tail
    const idx = off + i
    if (idx < buf.length) buf[idx] += sample * env * v.vol
  }
}

// 16-bit (SNES-ish) flavor: thicken each voice with two slightly-detuned copies
// (chorus), add slow PWM to squares (the moving SNES tone) and soften envelopes.
// A gentle warmth low-pass is applied to the final mix in render().
function era16(voices) {
  const out = []
  for (const v of voices) {
    const e = v.env
    const soft = e ? { a: Math.max(e.a, 0.006), d: e.d, s: Math.max(e.s, 0.12), r: Math.max(e.r, 0.03) }
                   : { a: 0.006, d: v.dur, s: 0.12, r: 0.03 }
    const base = { ...v, env: soft }
    if (base.wave === 'square') { base.pwm = true; base.pwmDepth = 0.28; base.pwmRate = 4 }
    out.push({ ...base, vol: v.vol * 0.6 })
    if (base.wave !== 'noise') {                      // detuned chorus layers
      out.push({ ...base, freq: base.freq * 2 ** (7 / 1200),  vol: v.vol * 0.45 })
      out.push({ ...base, freq: base.freq * 2 ** (-7 / 1200), vol: v.vol * 0.45 })
    }
  }
  return out
}

// one-pole low-pass (warmth / rounds the harsh aliasing — SNES Gaussian-ish)
function lowpass(buf, cutoff) {
  const dt = 1 / SR, rc = 1 / (2 * Math.PI * cutoff), alpha = dt / (rc + dt)
  let y = 0
  for (let i = 0; i < buf.length; i++) { y += alpha * (buf[i] - y); buf[i] = y }
}

function render(voicesIn) {
  const voices = ERA === '16bit' ? era16(voicesIn) : voicesIn
  const end = Math.max(...voices.map(v => v.start + v.dur)) + 0.02
  const buf = new Float32Array(Math.ceil(end * SR))
  for (const v of voices) renderVoice(buf, v)
  if (ERA === '16bit') lowpass(buf, 9000)
  // normalize to -1.5dB peak to keep punch without clipping
  let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
  const g = peak > 0 ? 0.84 / peak : 1
  const out = Buffer.alloc(44 + buf.length * 2)
  // WAV header (mono 16-bit PCM)
  out.write('RIFF', 0); out.writeUInt32LE(36 + buf.length * 2, 4); out.write('WAVE', 8)
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22)
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34)
  out.write('data', 36); out.writeUInt32LE(buf.length * 2, 40)
  for (let i = 0; i < buf.length; i++) {
    let s = Math.max(-1, Math.min(1, buf[i] * g))
    out.writeInt16LE((s * 32767) | 0, 44 + i * 2)
  }
  return out
}

// ── archetype helpers (return voice arrays) ──────────────────────────────────
const env = (a, d, s, r) => ({ a, d, s, r })
const blip   = (f, dur=0.08, o={}) => [V({ freq:f, dur, env:env(0.002,dur,0,0.01), ...o })]
const arpUp  = (root, steps, sdur=0.06, wave='square', vol=0.45) =>
  steps.map((st, i) => V({ wave, freq: root * 2 ** (st/12), dur: sdur*1.5, start: i*sdur, vol, env:env(0.002, sdur*1.4, 0, 0.01) }))
const chord  = (freqs, dur=0.4, wave='square', vol=0.32) =>
  freqs.map(f => V({ wave, freq:f, dur, vol, env:env(0.006, dur*0.5, 0.3, 0.06) }))
const laser  = (f=1300, semis=-30, dur=0.22, wave='square') => [V({ wave, freq:f, dur, slide:semis, vol:0.5, env:env(0.002,dur,0,0.01) })]
const boom   = (dur=0.45, low=80, vol=0.7) => [
  V({ wave:'noise', freq:1, dur, slide:-24, vol, env:env(0.001,dur,0,0.03) }),
  V({ wave:'square', freq:low, dur:dur*0.6, slide:-12, vol:vol*0.6, env:env(0.001,dur*0.6,0,0.02) }),
]
const thud   = (f=130, dur=0.18, vol=0.6) => [V({ wave:'square', freq:f, dur, slide:-8, vol, env:env(0.002,dur,0,0.01) })]
const wail   = (f=330, dur=0.7, vol=0.5) => [V({ wave:'triangle', freq:f, dur, vib:0.06, vibRate:7, slide:-5, vol, env:env(0.05,dur,0.4,0.12) })]
const hiss   = (dur=0.6, vol=0.4) => [
  V({ wave:'noise', freq:1, dur, vol, env:env(0.05,0.1,0.75,0.2) }),
  V({ wave:'noise', freq:1, dur, vol:vol*0.5, period:6, env:env(0.05,0.1,0.6,0.2) }),
]
const buzz   = (f=180, dur=0.3, wave='saw', vol=0.4) => [V({ wave, freq:f, dur, vol, env:env(0.005,0.02,1,0.03) })]
const sweep  = (f0, semis, dur=0.25, wave='triangle', vol=0.45) => [V({ wave, freq:f0, dur, slide:semis, vol, env:env(0.004,dur,0,0.02) })]
const coin   = (f=988) => [
  V({ freq:f, dur:0.06, vol:0.5, env:env(0.002,0.06,0,0.01) }),
  V({ freq:f*1.5, dur:0.34, start:0.055, vol:0.5, env:env(0.002,0.32,0,0.02) }),
]

// ── the 46 sounds → chiptune archetypes ──────────────────────────────────────
const SPECS = {
  // CINEMATICS
  'sfx-cin-ascension':  [...arpUp(523,[0,4,7,12,16],0.07,'square',0.42), ...chord([523,659,784,1046],0.6,'square',0.3).map(v=>({...v,start:0.36}))],
  'sfx-cin-kingdom':    [...arpUp(392,[0,4,7,12],0.09,'square',0.45), ...chord([392,494,587,784],0.55,'square',0.3).map(v=>({...v,start:0.37}))],
  'sfx-cin-bladelock':  [V({wave:'noise',freq:1,dur:0.07,vol:0.5,period:3}), V({freq:1900,dur:0.12,slide:-6,vol:0.4}), V({wave:'noise',freq:1,dur:0.07,start:0.13,vol:0.45,period:3}), V({freq:1700,dur:0.12,start:0.13,slide:-6,vol:0.4})],
  'sfx-cin-finalblow':  [...boom(0.5,70,0.75), ...thud(110,0.22,0.6).map(v=>({...v,start:0.04}))],
  'sfx-cin-collapse':   [V({wave:'noise',freq:1,dur:0.85,slide:-30,vol:0.62}), V({wave:'square',freq:90,dur:0.85,slide:-12,vol:0.34,duty:0.5})],
  'sfx-cin-verdict':    [V({wave:'triangle',freq:220,dur:0.65,vol:0.5,env:env(0.002,0.65,0,0.05)}), V({wave:'triangle',freq:110,dur:0.65,vol:0.35})],
  'sfx-cin-coin-land':  coin(880),
  'sfx-cin-coin-win':   arpUp(659,[0,4,7,12,16,19],0.05,'square',0.45),
  // BOSS SIGNATURES
  'sfx-boss-orc-throw':        [V({wave:'noise',freq:1,dur:0.12,slide:-12,vol:0.5}), ...thud(110,0.22,0.6).map(v=>({...v,start:0.05}))],
  'sfx-boss-lich-wither':      [V({wave:'triangle',freq:440,dur:0.6,slide:-19,vib:0.03,vibRate:5,vol:0.45,env:env(0.02,0.6,0.2,0.1)})],
  'sfx-boss-slime-surge':      [V({freq:200,dur:0.4,vib:0.16,vibRate:13,slide:7,vol:0.5,duty:0.25,env:env(0.01,0.4,0.4,0.05)})],
  'sfx-boss-beholder-gaze':    [V({freq:420,dur:0.32,slide:18,vib:0.04,vibRate:18,vol:0.5,env:env(0.01,0.32,0.5,0.03)})],
  'sfx-boss-beholder-petrify': [V({freq:820,dur:0.26,slide:-26,vol:0.5}), V({wave:'noise',freq:1,dur:0.12,start:0.24,vol:0.32,period:4})],
  'sfx-boss-myconid-bloom':    [V({wave:'triangle',freq:300,dur:0.42,slide:12,vol:0.42,env:env(0.04,0.42,0.3,0.08)}), V({wave:'noise',freq:1,dur:0.32,vol:0.13,period:10})],
  'sfx-boss-demon-sacrifice':  [V({wave:'square',freq:110,dur:0.55,slide:-5,vol:0.45,duty:0.5}), V({wave:'noise',freq:1,dur:0.4,start:0.15,slide:8,vol:0.32})],
  'sfx-boss-golem-quake':      [V({wave:'noise',freq:1,dur:0.8,slide:-12,vol:0.6,period:8}), V({wave:'triangle',freq:55,dur:0.8,vol:0.5})],
  'sfx-boss-lizard-spit':      [V({wave:'noise',freq:1,dur:0.12,slide:-18,vol:0.4}), V({freq:620,dur:0.1,slide:-12,vol:0.3})],
  'sfx-boss-vampire-rite':     [V({wave:'square',freq:330,dur:0.5,slide:-12,vib:0.05,vibRate:4,vol:0.45,duty:0.25,env:env(0.02,0.5,0.3,0.08)})],
  'sfx-boss-wraith-terror':    wail(330,0.8),
  'sfx-boss-gnoll-howl':       [V({freq:300,dur:0.5,slide:12,vol:0.45,duty:0.35}), V({freq:600,dur:0.32,start:0.5,slide:-18,vol:0.4,duty:0.35})],
  'sfx-boss-succubus-kiss':    [...arpUp(659,[0,5,9,12],0.07,'triangle',0.4), V({freq:1568,dur:0.2,start:0.3,vol:0.3})],
  // TRAPS
  'sfx-trap-bomb':       boom(0.45,80,0.72),
  'sfx-trap-cannon':     [...boom(0.5,60,0.75), ...thud(70,0.3,0.5).map(v=>({...v,start:0.03}))],
  'sfx-trap-dragonfire': hiss(0.7,0.42),
  'sfx-trap-spikes':     [V({freq:1500,dur:0.1,slide:14,vol:0.42}), V({wave:'noise',freq:1,dur:0.06,vol:0.3})],
  'sfx-trap-pit':        [...thud(150,0.22,0.6), V({wave:'noise',freq:1,dur:0.1,start:0.02,slide:-12,vol:0.3})],
  'sfx-trap-blades':     [V({wave:'square',freq:600,dur:0.32,duty:0.125,vol:0.34,vib:0.06,vibRate:32})],
  'sfx-trap-saw':        buzz(170,0.32,'saw',0.4),
  'sfx-trap-arrows':     [V({wave:'noise',freq:1,dur:0.18,slide:-24,vol:0.34}), V({freq:900,dur:0.08,vol:0.22})],
  // ABILITIES
  'sfx-abil-arcane':   arpUp(523,[0,7,12,19],0.04,'square',0.45),
  'sfx-abil-bulwark':  thud(160,0.18,0.6),
  'sfx-abil-charge':   [V({wave:'noise',freq:1,dur:0.3,slide:12,vol:0.32}), V({freq:150,dur:0.3,slide:10,vol:0.4})],
  'sfx-abil-dice':     [V({freq:800,dur:0.05,vol:0.4}), V({freq:1000,dur:0.06,start:0.09,vol:0.4})],
  'sfx-abil-hymn':     arpUp(392,[0,4,7,12],0.08,'triangle',0.42),
  'sfx-abil-layhands': arpUp(659,[0,4,7],0.085,'triangle',0.4),
  'sfx-abil-mob':      chord([130,165,196],0.26,'square',0.3),
  'sfx-abil-pierce':   laser(1400,-30,0.22),
  'sfx-abil-plunder':  coin(880),
  'sfx-abil-riposte':  [V({freq:2000,dur:0.1,slide:-6,vol:0.4})],
  'sfx-abil-roar':     [V({wave:'noise',freq:1,dur:0.35,slide:12,vol:0.4}), V({freq:200,dur:0.35,slide:10,vol:0.4})],
  'sfx-abil-stun':     [V({wave:'noise',freq:1,dur:0.08,vol:0.4}), V({freq:880,dur:0.3,start:0.05,vib:0.1,vibRate:22,vol:0.3})],
  'sfx-abil-tame':     [V({freq:523,dur:0.12,vol:0.4}), V({freq:784,dur:0.2,start:0.12,vol:0.4})],
  'sfx-abil-tunnel':   [V({wave:'noise',freq:1,dur:0.2,slide:-6,vol:0.4,period:5}), ...thud(90,0.2,0.5).map(v=>({...v,start:0.03}))],
  'sfx-abil-vanish':   [...sweep(400,24,0.2,'triangle',0.42), V({wave:'noise',freq:1,dur:0.12,slide:24,vol:0.18})],
  'sfx-abil-wings':    [...sweep(300,19,0.3,'triangle',0.4), V({wave:'noise',freq:1,dur:0.3,vol:0.12,period:12})],

  // ── GAP-FILL (new moments that had no sound before — chiptune) ──────────────
  'sfx-cin-flip':      [...arpUp(196,[0,7,12,19],0.06,'square',0.4), ...chord([262,330,392,523],0.7,'square',0.3).map(v=>({...v,start:0.3})), V({wave:'noise',freq:1,dur:0.4,start:0.25,slide:8,vol:0.3})],
  'sfx-cin-victory':   [...arpUp(523,[0,4,7,12,16,19],0.075,'square',0.45), ...chord([523,659,784,1046],0.7,'square',0.32).map(v=>({...v,start:0.45}))],
  'sfx-wave-start':    [...arpUp(294,[0,4,7],0.09,'square',0.42), ...chord([294,370,440],0.4,'square',0.28).map(v=>({...v,start:0.27}))],
  'sfx-legendary':     [...arpUp(392,[0,4,7,12],0.08,'square',0.45), ...chord([392,494,587,784],0.5,'square',0.3).map(v=>({...v,start:0.32}))],
  'sfx-alert':         [V({freq:520,dur:0.12,vol:0.4,duty:0.25}), V({freq:520,dur:0.12,start:0.18,vol:0.4,duty:0.25})],
  'sfx-act-clear':     [...arpUp(523,[0,4,7,12],0.09,'square',0.45), ...chord([523,659,784],0.55,'square',0.3).map(v=>({...v,start:0.36}))],
  'sfx-overtime':      [V({freq:880,dur:0.08,vol:0.42}), V({freq:880,dur:0.08,start:0.13,vol:0.42}), V({freq:880,dur:0.1,start:0.26,vol:0.42})],
  'sfx-summary':       [V({freq:660,dur:0.12,slide:5,vol:0.32}), V({freq:990,dur:0.14,start:0.08,vol:0.26})],
  'sfx-duel-begin':    [V({wave:'square',freq:220,dur:0.3,slide:12,vol:0.42}), V({wave:'noise',freq:1,dur:0.15,vol:0.25}), V({freq:440,dur:0.2,start:0.18,vol:0.32})],
  'sfx-defect':        [V({freq:520,dur:0.22,slide:-12,vib:0.09,vibRate:15,vol:0.4})],
  'sfx-casualty':      [V({wave:'triangle',freq:294,dur:0.5,slide:-5,vol:0.42})],
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2)
  let only = null, outDir = join(ROOT, 'assets/audio'), list = false, suffix = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') only = argv[++i]
    else if (argv[i] === '--out') outDir = resolve(ROOT, argv[++i])
    else if (argv[i] === '--era') ERA = argv[++i]
    else if (argv[i] === '--suffix') suffix = argv[++i]
    else if (argv[i] === '--list') list = true
  }
  const keys = Object.keys(SPECS).filter(k => !only || k.includes(only))
  if (list) { keys.forEach(k => console.log('  ' + k)); console.log(`\n  ${keys.length} specs`); return }
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  let n = 0
  for (const k of keys) {
    try { writeFileSync(join(outDir, `${k}${suffix}.wav`), render(SPECS[k])); console.log('  ♪ ' + k + suffix); n++ }
    catch (e) { console.error('  ✗ ' + k + ' — ' + e.message) }
  }
  console.log(`\n  synthesized ${n}/${keys.length} ${ERA} chiptune SFX → ${outDir}`)
  console.log(`  next: npm run audio:board   then reload the soundboard`)
}

main()
