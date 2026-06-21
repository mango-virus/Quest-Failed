// ResTestOverlay — DEV resolution-test harness for the resolution-independence
// pass. Toggle with `__qfDev.resTest()`.
//
// What it does: forces #hud-stage to a target LOGICAL resolution + uiScale (via
// stageScale.setSimStage) and letterbox-fits it into the current window, so every
// preset (720p → 4K → ultrawide) can be laid out + inspected on ANY monitor. It
// also runs an OVERFLOW SCANNER that flags HUD elements spilling past the stage
// edge (the classic "anchored to a 1920 frame" bug), skipping anything clipped by
// an overflow:hidden ancestor so intentionally-offscreen things (e.g. the title
// walkers) don't false-positive. Plus alignment guides (edges + centre cross).
//
// It is a SIMULATION of layout/anchoring, not of pixels — real crispness/DPR must
// still be checked by running natively at each resolution. The panel mounts on
// document.body (outside the scaled stage) so it isn't transformed with it.

import { setSimStage, clearSimStage, getSimStage, effectiveUiScale } from '../hud/stageScale.js'

// Each preset is the LOGICAL stage size a real display now maps to (after the
// sub-1× downscale fix in stageScale). 720p/1080p both → 1920×1080; Steam Deck
// (1280×800) → 1920×1200; 4K → 1920×1080 at zoom 2; ultrawides as-is.
const PRESETS = [
  { label: '1080p',     w: 1920, h: 1080, ui: 1 },   // also where 720p lands now
  { label: 'Deck',      w: 1920, h: 1200, ui: 1 },   // 1280×800 16:10 downscaled
  { label: '1440p',     w: 2560, h: 1440, ui: 1 },
  { label: '4K (×2)',   w: 1920, h: 1080, ui: 2 },   // 4K auto = logical 1920×1080, zoom 2
  { label: 'UW 3440',   w: 3440, h: 1440, ui: 1 },
  { label: '21:9',      w: 2560, h: 1080, ui: 1 },
  { label: '32:9',      w: 5120, h: 1440, ui: 1 },
]

let _el = null
let _guides = null
let _onResize = null
let _lastScan = []

function _stage() { return document.getElementById('hud-stage') }

// Walk up to the stage; true if any ancestor clips overflow (so the element can't
// actually be seen spilling past the stage even if its rect does).
function _clipped(el, stage) {
  let p = el.parentElement
  while (p && p !== stage && p !== document.body) {
    const o = getComputedStyle(p)
    if (o.overflow !== 'visible' || o.clipPath !== 'none') return true
    p = p.parentElement
  }
  return false
}

function _scan() {
  const stage = _stage()
  if (!stage) return []
  const sr = stage.getBoundingClientRect()
  const tol = 2
  const out = []
  for (const el of stage.querySelectorAll('*')) {
    if (el === _guides || (_guides && _guides.contains(el))) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const over = {
      left: sr.left - r.left, right: r.right - sr.right,
      top: sr.top - r.top,    bottom: r.bottom - sr.bottom,
    }
    const worst = Math.max(over.left, over.right, over.top, over.bottom)
    if (worst <= tol) continue
    if (_clipped(el, stage)) continue
    const sides = Object.entries(over).filter(([, v]) => v > tol).map(([k, v]) => `${k}+${Math.round(v)}`)
    out.push({ el, worst, sides, tag: _idOf(el) })
  }
  // Drop a parent if a flagged child overflows the same side worse (report the
  // tightest offender, not every ancestor).
  return out.sort((a, b) => b.worst - a.worst).slice(0, 40)
}

function _idOf(el) {
  const id = el.id ? `#${el.id}` : ''
  const cls = (typeof el.className === 'string' && el.className) ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
  return `${el.tagName.toLowerCase()}${id}${cls}`
}

function _runScan() {
  _lastScan = _scan()
  const out = document.getElementById('qf-rt-scanout')
  if (out) {
    out.textContent = _lastScan.length
      ? `${_lastScan.length} overflow(s) — see console`
      : 'no overflows ✓'
    out.style.color = _lastScan.length ? '#ff8a8a' : '#7fe0a0'
  }
  if (_lastScan.length) {
    console.group(`%c[resTest] ${_lastScan.length} element(s) overflow the stage`, 'color:#ff8a8a;font-weight:bold')
    for (const o of _lastScan) { console.log(`${o.sides.join(' ')}  ${o.tag}`, o.el) }
    console.groupEnd()
  } else {
    console.log('%c[resTest] no stage overflows ✓', 'color:#7fe0a0')
  }
  return _lastScan
}

function _readout() {
  const ro = document.getElementById('qf-rt-readout')
  if (!ro) return
  const sim = getSimStage()
  const dpr = window.devicePixelRatio || 1
  const logiW = sim ? sim.w : Math.round(window.innerWidth / effectiveUiScale())
  const logiH = sim ? sim.h : Math.round(window.innerHeight / effectiveUiScale())
  const asp = (logiW / logiH).toFixed(2)
  ro.innerHTML =
    `window <b>${window.innerWidth}×${window.innerHeight}</b> · dpr ${dpr}<br>` +
    `logical <b>${logiW}×${logiH}</b> · uiScale <b>${effectiveUiScale()}</b> · aspect <b>${asp}</b>` +
    (sim ? ` · <span style="color:#ffcf6a">SIM</span>` : ` · native`)
}

function _toggleGuides() {
  const stage = _stage()
  if (!stage) return
  if (_guides) { _guides.remove(); _guides = null; return }
  _guides = document.createElement('div')
  _guides.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:99998;' +
    'box-shadow:inset 0 0 0 2px rgba(120,220,255,.9);'
  _guides.innerHTML =
    '<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(120,220,255,.5)"></div>' +
    '<div style="position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(120,220,255,.5)"></div>'
  stage.appendChild(_guides)
}

function _apply(p) {
  if (p) setSimStage(p.w, p.h, p.ui); else clearSimStage()
  _readout()
  // let the reflow settle, then scan
  setTimeout(_runScan, 60)
}

function _build() {
  _el = document.createElement('div')
  _el.id = 'qf-restest'
  _el.style.cssText =
    'position:fixed;right:10px;bottom:10px;z-index:2147483600;width:230px;' +
    'font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#dfe7ee;' +
    'background:rgba(14,18,24,.94);border:1px solid #2a3744;border-radius:8px;' +
    'padding:9px 10px;box-shadow:0 8px 28px rgba(0,0,0,.55);user-select:none'
  const btn = (label, on) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'all:unset;cursor:pointer;padding:3px 7px;margin:2px 3px 0 0;border-radius:5px;' +
      'background:#1d2a36;border:1px solid #314454;font:11px ui-monospace,monospace;color:#cfe'
    b.onmouseenter = () => b.style.background = '#283a4a'
    b.onmouseleave = () => b.style.background = '#1d2a36'
    b.onclick = on
    return b
  }
  const title = document.createElement('div')
  title.innerHTML = '<b style="color:#7fd0ff">RES TEST</b> <span style="opacity:.6">— anchoring/overflow</span>'
  title.style.marginBottom = '6px'
  const close = btn('✕', () => hide()); close.style.cssText += ';float:right;margin:0'
  title.prepend(close)

  const ro = document.createElement('div')
  ro.id = 'qf-rt-readout'
  ro.style.cssText = 'margin:2px 0 7px;padding:5px 6px;background:#10161d;border-radius:5px;font-size:10px'

  const presets = document.createElement('div')
  for (const p of PRESETS) presets.appendChild(btn(p.label, () => _apply(p)))
  presets.appendChild(btn('Native', () => _apply(null)))

  const tools = document.createElement('div')
  tools.style.marginTop = '7px'
  tools.appendChild(btn('Scan', _runScan))
  tools.appendChild(btn('Guides', _toggleGuides))
  const scanout = document.createElement('span')
  scanout.id = 'qf-rt-scanout'
  scanout.style.cssText = 'margin-left:6px;font-size:10px;opacity:.9'
  scanout.textContent = '—'
  tools.appendChild(scanout)

  _el.append(title, ro, presets, tools)
  document.body.appendChild(_el)
  _onResize = () => _readout()
  window.addEventListener('resize', _onResize)
  _readout()
}

export function show() { if (!_el) _build(); _el.style.display = ''; _readout(); return '[resTest] open — pick a preset; check the Scan count + console' }
export function hide() {
  if (_guides) { _guides.remove(); _guides = null }
  clearSimStage()
  if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null }
  _el?.remove(); _el = null
  return '[resTest] closed (stage restored to native)'
}
export function toggle() { return _el ? hide() : show() }

// DEV — run the overflow scan across EVERY preset on the current screen and log a
// summary. Lets the test pass be driven entirely from logs when there's no console
// or window access. Synchronous: getBoundingClientRect after each setSimStage
// flushes the pending layout, so each scan sees the reflowed positions.
export function sweep() {
  const prev = getSimStage()
  const lines = ['[resTest] AUTO-SWEEP — per-preset overflow scan (current screen):']
  for (const p of PRESETS) {
    setSimStage(p.w, p.h, p.ui)
    const found = _scan()
    lines.push(`  ${p.label} (${p.w}x${p.h} ui${p.ui}): ${found.length} overflow(s)`)
    for (const o of found.slice(0, 16)) lines.push(`      ${o.sides.join(' ')}  ${o.tag}`)
  }
  if (prev) setSimStage(prev.w, prev.h, prev.uiScale); else clearSimStage()
  console.log(lines.join('\n'))
  return lines.length
}

// Self-install a global keybind (Ctrl+Shift+0) + window.__qfResTest so the harness
// is reachable on EVERY screen — including the title menu, where __qfDev isn't
// installed. Gated to localhost / desktop so web players never see it.
try {
  const h = typeof location !== 'undefined' ? location.hostname : ''
  const dev = h === 'localhost' || h === '127.0.0.1' ||
    (typeof window !== 'undefined' && window.__desktop && window.__desktop.isDev)
  if (dev && typeof window !== 'undefined' && !window.__qfResTest) {
    window.__qfResTest = toggle
    window.__qfResSweep = sweep
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'Digit0' || e.key === '0')) {
        e.preventDefault(); console.log(toggle())
      }
    })
    console.log('[resTest] harness ready — Ctrl+Shift+0, __qfResTest(), or __qfDev.resTest()')
  } else {
    console.log('[resTest] NOT installed — host:', h,
      'desktop:', (typeof window !== 'undefined' && window.__desktop && window.__desktop.isDesktop))
  }
} catch (e) { try { console.log('[resTest] init error', e) } catch {} }
