// CoachMark — the onboarding coach-mark toolkit (Phase 1 foundation of the
// onboarding overhaul; see DESIGN.md "Onboarding overhaul — LOCKED").
//
// Shows ONE spotlight at a time: dims the screen, cuts a hole around a LIVE
// target element, shows a short caption (≤8 words) + an optional ghost-cursor
// demo, and advances on a Next button OR when the player performs the real
// action. Research rules baked in: one-at-a-time, never chained, the highlighted
// control stays real/clickable, everything skippable.
//
// Usage:
//   await CoachMark.show({ target: el, text: 'Place a room', gesture: 'tap', advance: 'tap' })
//   await CoachMark.sequence([ {…}, {…} ])   // guided tour, one at a time
//   CoachMark.hide()
//
// Coordinates: mounts into #hud-stage (same transform-scaled space as the HUD
// targets) and measures each target RELATIVE to the stage, so it lines up at
// any uiScale. Re-measures on resize + a light interval so it tracks layout.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

let _injected = false
let _active = null   // { layer, finish } for the current mark

// Opt out of ALL onboarding guide messages from any coach-mark's "Turn off hints"
// control. Mirrors the Settings → GAMEPLAY HINTS lever: flip the global key and
// announce it. TutorialSystem syncs the per-run meta.tutorialEnabled flag, GuidedRun
// aborts its scripted run, and DripCoach stops — all off the one SETTINGS_CHANGED.
function _disableHints() {
  try { localStorage.setItem('qf.gameplay.tutorials', 'false') } catch {}
  EventBus.emit('SETTINGS_CHANGED')
}

function _injectCss() {
  if (_injected) return
  _injected = true
  // Crypt-console aesthetic to match the action bar (.hc-*): sharp 2-3px corners,
  // beveled stone-tablet shadows (inset highlight + dark inset + hard drop), the
  // bone/gold/blood palette, Press Start 2P, and the action-bar sheen-sweep on
  // the CTA. No soft rounded "modal" look. No raw hex (palette tokens + rgba).
  const css = `
  .qf-cm-layer { position:absolute; inset:0; z-index:4000; pointer-events:none;
    font-family:'Press Start 2P',monospace; }
  .qf-cm-dim { position:absolute; background:rgba(4,2,8,.74); pointer-events:auto; }
  .qf-cm-ring { position:absolute; border-radius:3px; pointer-events:none;
    box-shadow: 0 0 0 2px var(--gold), 0 0 16px 3px rgba(212,166,72,.5), inset 0 0 12px rgba(212,166,72,.22),
      0 0 0 4px rgba(0,0,0,.55);
    animation: qf-cm-ringpulse 1.5s ease-in-out infinite; }
  @keyframes qf-cm-ringpulse {
    0%,100% { box-shadow:0 0 0 2px var(--gold), 0 0 13px 2px rgba(212,166,72,.42), inset 0 0 10px rgba(212,166,72,.2), 0 0 0 4px rgba(0,0,0,.55); }
    50%     { box-shadow:0 0 0 2px var(--gold), 0 0 24px 6px rgba(212,166,72,.68), inset 0 0 15px rgba(212,166,72,.3), 0 0 0 4px rgba(0,0,0,.55); } }
  /* Matches the action-bar pop-out panels (TrayShell .htr-fill): rounded frame,
     dark sheen gradient, layered inset borders, glowing gold top accent + a faint
     dotted texture, big soft drop shadow. */
  .qf-cm-bubble { position:absolute; max-width:340px; pointer-events:auto; border-radius:8px; padding:16px 18px 15px;
    border:1.5px solid color-mix(in srgb, var(--gold) 70%, transparent);
    background: radial-gradient(120% 80% at 12% 0%, rgba(255,255,255,.04), transparent 60%),
      linear-gradient(180deg, rgba(26,21,36,1), rgba(12,9,18,1));
    box-shadow: inset 0 0 0 1px rgba(6,4,9,1), inset 0 0 0 2px var(--line2),
      inset 0 0 38px rgba(0,0,0,.55), 0 20px 50px rgba(0,0,0,.6); }
  /* glowing gold top accent line */
  .qf-cm-bubble::before { content:''; position:absolute; left:0; right:0; top:0; height:2px; border-radius:8px 8px 0 0;
    background: linear-gradient(90deg, transparent, var(--gold), transparent); box-shadow:0 0 12px var(--gold); }
  /* faint dotted texture overlay */
  .qf-cm-bubble::after { content:''; position:absolute; inset:0; border-radius:8px; pointer-events:none; opacity:.5;
    background-image: radial-gradient(rgba(255,255,255,.04) 1px, transparent 1px); background-size:4px 4px; mix-blend-mode:overlay; }
  .qf-cm-bubble > * { position:relative; z-index:1; }
  .qf-cm-eyebrow { font-family:'Silkscreen',monospace; font-size:9.5px; letter-spacing:.22em; text-transform:uppercase;
    color: color-mix(in srgb, var(--gold) 78%, white); margin-bottom:10px; display:flex; align-items:center; gap:6px; }
  .qf-cm-eyebrow::after { content:''; flex:1; height:1px; background: color-mix(in srgb, var(--gold) 35%, transparent); }
  .qf-cm-text { font-size:13px; line-height:1.7; color: var(--bone); }
  .qf-cm-arrow { position:absolute; width:13px; height:13px; transform:rotate(45deg); pointer-events:none;
    background: rgba(26,21,36,1); border:1.5px solid color-mix(in srgb, var(--gold) 70%, transparent); }
  .qf-cm-row { display:flex; gap:10px; align-items:center; justify-content:flex-end; margin-top:12px; }
  /* opt-out: a quiet text link on the left so it never competes with the gold CTA */
  .qf-cm-row.has-optout { justify-content:space-between; }
  .qf-cm-optout { pointer-events:auto; cursor:pointer; font-family:'Silkscreen',monospace;
    font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; line-height:1.4;
    color: rgba(240,230,212,.42); background:none; border:none; padding:2px 0; text-align:left; }
  .qf-cm-optout:hover { color: color-mix(in srgb, var(--blood) 65%, var(--bone)); text-decoration:underline; }
  /* CTA = a gold action-bar tablet button with the signature sheen-sweep */
  .qf-cm-next { position:relative; overflow:hidden; cursor:pointer; font-family:'Press Start 2P',monospace;
    font-size:10px; letter-spacing:.05em; text-transform:uppercase; color: rgba(20,8,2,1);
    background: linear-gradient(180deg, color-mix(in srgb, var(--gold) 70%, white), var(--gold));
    border:1px solid rgba(0,0,0,.45); border-radius:2px; padding:9px 13px;
    box-shadow: inset 1px 1px 0 rgba(255,255,255,.3), inset -1px -1px 0 rgba(0,0,0,.4), 0 3px 0 rgba(0,0,0,.55); }
  .qf-cm-next::before { content:''; position:absolute; top:0; bottom:0; left:-60%; width:38%; transform:skewX(-20deg);
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent); transition:left .5s; }
  .qf-cm-next:hover::before { left:140%; }
  .qf-cm-next:active { transform:translateY(2px); filter:brightness(1.1); }
  .qf-cm-hint { font-family:'Silkscreen',monospace; font-size:10.5px; letter-spacing:.1em;
    color: color-mix(in srgb, var(--gold) 62%, white); opacity:.9; }
  .qf-cm-skip { position:absolute; right:20px; bottom:18px; pointer-events:auto; cursor:pointer;
    font-family:'Silkscreen',monospace; font-size:10px; letter-spacing:.14em; text-transform:uppercase;
    color: rgba(240,230,212,.55); background:none; border:none; }
  .qf-cm-skip:hover { color: var(--bone); }
  .qf-cm-cursor { position:absolute; width:26px; height:26px; pointer-events:none; z-index:2;
    color: var(--gold); font-size:22px; line-height:26px; text-align:center;
    text-shadow:0 0 6px rgba(0,0,0,.9), 0 0 10px rgba(212,166,72,.6);
    transition: left .7s cubic-bezier(.4,0,.4,1), top .7s cubic-bezier(.4,0,.4,1); }
  .qf-cm-cursor.tap { animation: qf-cm-tap 1.1s ease-in-out infinite; }
  @keyframes qf-cm-tap { 0%,100%{ transform:scale(1); opacity:.9; } 50%{ transform:scale(.66); opacity:1; } }
  .qf-cm-layer.intro .qf-cm-bubble, .qf-cm-layer.intro .qf-cm-ring { animation: qf-cm-in .26s ease-out both; }
  @keyframes qf-cm-in { from{ opacity:0; transform:translateY(7px); } to{ opacity:1; transform:none; } }
  `
  const tag = document.createElement('style')
  tag.id = 'qf-cm-style'
  tag.textContent = css
  document.head.appendChild(tag)
}

function _stage() { return document.getElementById('hud-stage') || document.body }

// Target rect in the stage's LOGICAL coordinate space (undoes the stage transform-scale).
function _rectInStage(el) {
  const stage = _stage()
  const sr = stage.getBoundingClientRect()
  const scale = (sr.width / stage.offsetWidth) || 1
  const r = el.getBoundingClientRect()
  return { x: (r.left - sr.left) / scale, y: (r.top - sr.top) / scale, w: r.width / scale, h: r.height / scale }
}

function _resolveTarget(t) {
  if (!t) return null
  if (typeof t === 'function') { try { return t() } catch { return null } }
  if (typeof t === 'string') return document.querySelector(t)
  return t
}

export class CoachMark {
  // Show one coach-mark. Resolves true on advance (Next / action), false on skip.
  //  target  element | selector | () => element   (null = centered, no hole)
  //  text    caption (keep ≤ ~8 words)
  //  gesture 'tap' | 'drag' | null   (ghost-cursor demo)
  //  dragTo  element|selector|fn — destination for gesture 'drag'
  //  advance 'next' (button) | 'tap' (click the target) ; default 'next'
  //  pad     spotlight padding px (default 8)
  //  allowSkip  show the SKIP control (default true)
  static show(opts = {}) {
    CoachMark.hide()
    _injectCss()
    const stage = _stage()
    const pad = opts.pad ?? 8
    const advance = opts.advance ?? 'next'

    const ring   = h('div', { className: 'qf-cm-ring' })
    const arrow  = h('div', { className: 'qf-cm-arrow' })
    const textEl = h('div', { className: 'qf-cm-text', html: String(opts.text || '') })
    const dims   = [0, 1, 2, 3].map(() => h('div', { className: 'qf-cm-dim' }))
    const cursor = opts.gesture ? h('div', { className: 'qf-cm-cursor' + (opts.gesture === 'tap' ? ' tap' : '') }, '➤') : null
    const bubble = h('div', { className: 'qf-cm-bubble' },
      [opts.eyebrow ? h('div', { className: 'qf-cm-eyebrow' }, opts.eyebrow) : null, textEl].filter(Boolean))
    const skipBtn = opts.allowSkip === false ? null
      : h('button', { className: 'qf-cm-skip', on: { click: () => finish(false) } }, 'Skip ✕')
    const layer = h('div', { className: 'qf-cm-layer intro hc' },
      [...dims, opts.target ? ring : null, cursor, bubble, arrow, skipBtn].filter(Boolean))
    stage.appendChild(layer)

    let done = false, dragTimer = 0, remeasure = 0, dragInit = false
    let curTarget = null, clickHandler = null

    const teardown = () => {
      if (dragTimer) clearInterval(dragTimer)
      if (remeasure) clearInterval(remeasure)
      if (curTarget && clickHandler) curTarget.removeEventListener('click', clickHandler)
      window.removeEventListener('resize', layout)
      try { layer.remove() } catch {}
    }
    let _resolve
    const p = new Promise((res) => { _resolve = res })
    const finish = (ok) => {
      if (done) return
      done = true
      teardown()
      if (_active && _active.layer === layer) _active = null
      _resolve(ok)
    }

    function layout() {
      const sw = stage.offsetWidth, sh = stage.offsetHeight
      const t = opts.target ? _resolveTarget(opts.target) : null
      // (Re)bind the tap-advance listener if the live target changed (HUD re-renders).
      if (advance === 'tap' && t !== curTarget) {
        if (curTarget && clickHandler) curTarget.removeEventListener('click', clickHandler)
        if (!clickHandler) clickHandler = () => finish(true)
        if (t) t.addEventListener('click', clickHandler)
      }
      curTarget = t
      if (!t) {
        // No spotlight target. passThrough = don't dim/cover the screen (e.g. the
        // "watch the fight" beat — the player must SEE the gameplay). anchor places
        // the bubble out of the action ('top' | 'bottom' | 'left' | 'right' | 'center').
        if (opts.passThrough) {
          for (let i = 0; i < 4; i++) dims[i].style.display = 'none'
        } else {
          dims[0].style.cssText = 'position:absolute;background:rgba(4,2,8,.72);pointer-events:auto;left:0;top:0;width:100%;height:100%'
          for (let i = 1; i < 4; i++) dims[i].style.display = 'none'
        }
        ring.style.display = 'none'; arrow.style.display = 'none'
        const bw = bubble.offsetWidth || 280, bh = bubble.offsetHeight || 80
        if (opts.anchor === 'aboveBar') {
          // Horizontally centred, sitting just ABOVE the action bar — keeps the play
          // area clear while reading (user pref 2026-06-23). offsetHeight is logical
          // (the bar lives in the same scaled #hud-stage), so no scale conversion.
          const bar = document.querySelector('.qf-bottombar')
          const barH = bar ? bar.offsetHeight : 96
          bubble.style.left = (sw / 2 - bw / 2) + 'px'
          bubble.style.top  = (sh - bh - barH - 18) + 'px'
        } else if (opts.anchor === 'left' || opts.anchor === 'right') {
          bubble.style.left = opts.anchor === 'left' ? '32px' : (sw - bw - 32) + 'px'
          bubble.style.top  = (sh / 2 - bh / 2) + 'px'
        } else {
          bubble.style.left = (sw / 2 - bw / 2) + 'px'
          bubble.style.top  = opts.anchor === 'top'    ? '64px'
                            : opts.anchor === 'bottom' ? (sh - bh - 96) + 'px'
                            : (sh / 2 - bh / 2) + 'px'
        }
        return
      }
      const r = _rectInStage(t)
      const hx = r.x - pad, hy = r.y - pad, hw = r.w + pad * 2, hh = r.h + pad * 2
      if (opts.passThrough) {
        // Non-blocking: drop the dim panels so the player can use the WHOLE screen
        // — needed for multi-step actions like "pick a room, then click the map to
        // place it" (the map is outside the spotlight). Just the ring + bubble guide.
        for (let i = 0; i < 4; i++) dims[i].style.display = 'none'
      } else {
        const set = (d, x, y, w, ht) => { d.style.display = 'block'; d.style.cssText =
          `position:absolute;background:rgba(4,2,8,.72);pointer-events:auto;left:${x}px;top:${y}px;width:${Math.max(0, w)}px;height:${Math.max(0, ht)}px` }
        set(dims[0], 0, 0, sw, hy)
        set(dims[1], 0, hy + hh, sw, sh - (hy + hh))
        set(dims[2], 0, hy, hx, hh)
        set(dims[3], hx + hw, hy, sw - (hx + hw), hh)
      }
      ring.style.display = 'block'
      ring.style.left = hx + 'px'; ring.style.top = hy + 'px'
      ring.style.width = hw + 'px'; ring.style.height = hh + 'px'
      const bw = bubble.offsetWidth || 280, bh = bubble.offsetHeight || 80
      const below = (hy + hh + 14 + bh) <= sh
      const bx = Math.min(Math.max(8, r.x + r.w / 2 - bw / 2), sw - bw - 8)
      const by = below ? (hy + hh + 14) : (hy - 14 - bh)
      bubble.style.left = bx + 'px'; bubble.style.top = by + 'px'
      arrow.style.display = 'block'
      arrow.style.left = Math.min(Math.max(bx + 14, r.x + r.w / 2 - 7), bx + bw - 22) + 'px'
      arrow.style.top = (below ? by - 7 : by + bh - 7) + 'px'
      if (cursor) {
        const cx0 = r.x + r.w / 2 - 13, cy0 = r.y + r.h / 2 - 13
        if (opts.gesture === 'tap') { cursor.style.left = cx0 + 'px'; cursor.style.top = cy0 + 'px' }
        else if (opts.gesture === 'drag' && !dragInit) {
          dragInit = true
          const dt = _resolveTarget(opts.dragTo); const dr = dt ? _rectInStage(dt) : r
          const cx1 = dr.x + dr.w / 2 - 13, cy1 = dr.y + dr.h / 2 - 13
          cursor.style.left = cx0 + 'px'; cursor.style.top = cy0 + 'px'
          let toEnd = true
          dragTimer = setInterval(() => {
            cursor.style.left = (toEnd ? cx1 : cx0) + 'px'
            cursor.style.top  = (toEnd ? cy1 : cy0) + 'px'
            toEnd = !toEnd
          }, 900)
        }
      }
    }

    // Opt-out: a small "Turn off hints" control on EVERY guide message so the
    // player can leave the onboarding early without hunting through Settings.
    // Disables all hints globally, then dismisses this mark (skip).
    const optOutBtn = opts.allowOptOut === false ? null
      : h('button', { className: 'qf-cm-optout', on: { click: () => { _disableHints(); finish(false) } } }, 'Turn off hints')

    let actionEl = null
    if (advance === 'next') {
      actionEl = h('button', { className: 'qf-cm-next', on: { click: () => finish(true) } }, opts.nextLabel || 'Got it ›')
    } else if (advance === 'tap' || advance === 'hold') {
      // 'tap' advances when the target is clicked (listener bound in layout()).
      // 'hold' shows the same hint but binds NO listener — the caller keeps the
      // spotlight up through a multi-step action and dismisses it externally
      // (CoachMark.hide()) once a game event confirms the action.
      actionEl = h('span', { className: 'qf-cm-hint' }, opts.hint || 'Try it →')
    }
    if (optOutBtn || actionEl) {
      bubble.appendChild(h('div', { className: 'qf-cm-row' + (optOutBtn ? ' has-optout' : '') },
        [optOutBtn, actionEl].filter(Boolean)))
    }

    layout()
    window.addEventListener('resize', layout)
    remeasure = setInterval(layout, 250)
    _active = { layer, finish }
    return p
  }

  static hide() { if (_active) _active.finish(false) }

  // Run a guided sequence, one mark at a time. true if completed, false if skipped.
  static async sequence(marks, { onSkip } = {}) {
    for (const m of marks) {
      const ok = await CoachMark.show(m)
      if (!ok) { if (onSkip) onSkip(); return false }
    }
    return true
  }

  static get isActive() { return !!_active }
}
