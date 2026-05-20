// countUp.js — count-up animation for result-screen numbers.
//
// Any element tagged with class `cu` is treated as a number that
// animates from 0 up to its already-rendered value. Each number starts
// climbing as soon as its panel has finished its entrance animation —
// it does NOT wait for earlier numbers to finish. A small minimum
// stagger keeps numbers whose panels reveal together from all firing on
// the exact same frame, so they still read as a cascade.
//
// Audio (respects the SFX volume slider / mute):
//   * plain `cu`  → the count-up tone (`sfx-score-countup`), a single
//                   loop kept running continuously across the whole
//                   cascade (per-number restarts stuttered), stopped
//                   when the last number lands.
//   * `cu cu-gold`→ the gold-pickup sound (`sfx-collect-gold`), fired
//                   rapidly while the number climbs.
// Sound only plays for numbers greater than 1 — a 0→1 climb is silent.
//
// Usage: render the screen normally (final numbers in the text), then
// call `runCountUp(rootEl)` once after mounting. It returns a cancel
// function — call it from the screen's close/destroy so a mid-count
// teardown doesn't leave the loop sound playing or write to dead DOM.

import { SfxVolume } from '../systems/SfxVolume.js'

const ITEM_DURATION_MS = 850   // per-number climb duration
const MIN_STAGGER_MS   = 150   // min spacing between two numbers starting
const FIRST_DELAY_MS   = 60    // tiny beat before the very first number
const GOLD_TICK_MS     = 85    // gold-pickup sound repeat interval
const ENTRANCE_PAD_MS  = 55    // settle beat after a panel finishes appearing

// Parse "47" / "+5" / "85%" / "1,200g" → { prefix, value, suffix }, or
// null when the text isn't a number (labels etc. are left alone).
function parseNum(text) {
  const m = String(text ?? '').trim().match(/^(\D*?)(\d[\d,]*)(\D*)$/)
  if (!m) return null
  const value = parseInt(m[2].replace(/,/g, ''), 10)
  if (!Number.isFinite(value)) return null
  return { prefix: m[1], value, suffix: m[3] }
}

// ── Audio ──────────────────────────────────────────────────────────
function audioReady(key) {
  const g = window.__game
  if (!g?.sound) return false
  return (g.scene?.scenes ?? []).some(s => s.cache?.audio?.exists?.(key))
}

// A looped count-up tone. Returns { start, stop }.
function makeLoopTone() {
  if (SfxVolume.isMuted() || !audioReady('sfx-score-countup')) {
    return { start() {}, stop() {} }
  }
  let snd = null
  return {
    start() {
      try {
        snd = window.__game.sound.add('sfx-score-countup', {
          loop: true,
          volume: Math.min(3, 1.15 * SfxVolume.getVolume()),
        })
        snd.play()
      } catch { snd = null }
    },
    stop() {
      try { snd?.stop(); snd?.destroy() } catch {}
      snd = null
    },
  }
}

// Rapid-fire gold-pickup sound. Returns { start, stop }.
function makeGoldTicker() {
  if (SfxVolume.isMuted() || !audioReady('sfx-collect-gold')) {
    return { start() {}, stop() {} }
  }
  let timer = null
  const play = () => {
    try {
      // The collect-gold wav is inherently quiet — push the gain hard so
      // the rapid ticks read clearly over the count-up tone / music.
      window.__game.sound.play('sfx-collect-gold', {
        volume: Math.min(4, 2.4 * SfxVolume.getVolume()),
      })
    } catch {}
  }
  return {
    start() { play(); timer = setInterval(play, GOLD_TICK_MS) },
    stop()  { if (timer) clearInterval(timer); timer = null },
  }
}

// ── Entrance sync ──────────────────────────────────────────────────
// Result screens slide / fade their panels in with staggered CSS
// animations. If the count-up starts at open() the early numbers (and
// their sound) run while their panel is still off-screen. These helpers
// work out, per number, when its panel has finished appearing so the
// cascade can hold each number until it's actually visible.
function parseTimeList(s) {
  return String(s || '').split(',').map(part => {
    const t = part.trim()
    if (t.endsWith('ms')) return parseFloat(t) || 0
    if (t.endsWith('s'))  return (parseFloat(t) || 0) * 1000
    return parseFloat(t) || 0
  })
}

// Latest (delay + duration) of any finite CSS entrance animation on the
// element or its ancestors, in ms from now. Infinite loops (idle pulses)
// are skipped — they never "finish".
function entranceEndMs(el) {
  let end = 0
  let node = el
  while (node && node.nodeType === 1 && node.id !== 'hud-stage' && node !== document.body) {
    let cs = null
    try { cs = getComputedStyle(node) } catch { cs = null }
    if (cs && cs.animationName && cs.animationName !== 'none') {
      const names  = cs.animationName.split(',')
      const delays = parseTimeList(cs.animationDelay)
      const durs   = parseTimeList(cs.animationDuration)
      const iters  = cs.animationIterationCount.split(',').map(s => s.trim())
      for (let i = 0; i < names.length; i++) {
        if ((iters[i % iters.length] || '') === 'infinite') continue
        const d = delays[i % delays.length] || 0
        const u = durs[i % durs.length]   || 0
        end = Math.max(end, d + u)
      }
    }
    node = node.parentElement
  }
  return end
}

// ── Runner ─────────────────────────────────────────────────────────
export function runCountUp(rootEl) {
  if (!rootEl) return () => {}

  const items = []
  for (const el of rootEl.querySelectorAll('.cu')) {
    const parsed = parseNum(el.textContent)
    if (!parsed) continue
    items.push({
      el, parsed,
      gold: el.classList.contains('cu-gold'),
      // When this number's panel finishes its entrance animation. The
      // cascade won't begin a number before it's on screen.
      readyAt: entranceEndMs(el),
    })
    // Zero it right away so the final value never flashes first.
    el.textContent = `${parsed.prefix}0${parsed.suffix}`
  }
  if (items.length === 0) return () => {}

  // Cascade order = reveal order. Each number is scheduled to start the
  // moment its panel is up — numbers may climb concurrently. A minimum
  // stagger keeps numbers whose panels reveal together from all firing on
  // the same frame, so they still read as a cascade.
  items.sort((a, b) => a.readyAt - b.readyAt)
  let prevStart = -Infinity
  for (const it of items) {
    it.startAt = Math.max(
      FIRST_DELAY_MS,
      it.readyAt + ENTRANCE_PAD_MS,
      prevStart + MIN_STAGGER_MS,
    )
    prevStart = it.startAt
  }

  // One loop tone shared across the whole cascade. Starting / stopping it
  // per number stuttered badly, so it's started the first time a plain
  // number worth counting climbs and left running until every number has
  // landed (or the cascade is cancelled).
  const loop = makeLoopTone()
  let loopOn = false
  const stopLoop = () => { if (loopOn) { loop.stop(); loopOn = false } }

  const ctrl = { cancelled: false }
  const t0 = performance.now()   // ≈ when the panels' entrances started
  let done = 0

  const finishOne = () => {
    done += 1
    if (done >= items.length) stopLoop()
  }

  const cancel = () => {
    if (ctrl.cancelled) return
    ctrl.cancelled = true
    for (const it of items) {
      if (it._timer) clearTimeout(it._timer)
      if (it._raf)   cancelAnimationFrame(it._raf)
      it._gold?.stop()
      it._gold = null
      // Snap to the final value.
      it.el.textContent = `${it.parsed.prefix}${it.parsed.value}${it.parsed.suffix}`
    }
    stopLoop()
  }

  const runItem = (it) => {
    const { prefix, value, suffix } = it.parsed
    if (value <= 0) { it.el.textContent = `${prefix}${value}${suffix}`; finishOne(); return }
    // Sound only for numbers actually worth counting — a 0→1 climb isn't.
    if (value > 1) {
      if (it.gold) {
        it._gold = makeGoldTicker()
        it._gold.start()
      } else if (!loopOn) {
        loop.start()
        loopOn = true
      }
    }
    const start = performance.now()
    const step = (now) => {
      if (ctrl.cancelled) return
      const t = Math.min(1, (now - start) / ITEM_DURATION_MS)
      const e = 1 - Math.pow(1 - t, 3)   // ease-out cubic
      it.el.textContent = `${prefix}${Math.round(value * e)}${suffix}`
      if (t < 1) {
        it._raf = requestAnimationFrame(step)
      } else {
        it.el.textContent = `${prefix}${value}${suffix}`
        it._raf = 0
        if (it._gold) { it._gold.stop(); it._gold = null }
        finishOne()
      }
    }
    it._raf = requestAnimationFrame(step)
  }

  // Schedule every number against the shared clock.
  for (const it of items) {
    const wait = Math.max(0, it.startAt - (performance.now() - t0))
    it._timer = setTimeout(() => {
      it._timer = 0
      if (!ctrl.cancelled) runItem(it)
    }, wait)
  }

  return cancel
}
