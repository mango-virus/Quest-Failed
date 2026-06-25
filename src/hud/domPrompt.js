// domPrompt — a small async text-input modal: Promise<string|null>.
//
// A drop-in replacement for window.prompt(), which ELECTRON DOES NOT SUPPORT
// (it returns null + logs a warning, so any prompt-driven button silently
// no-ops in the desktop build — the primary target). Reuses ConfirmPopup's
// crypt slate (.qf-cf-* in styles.css) so it matches the in-game dialogs; the
// text field is styled inline so this file is self-contained.
//
// Resolves to the entered string on OK / Enter, or null on Cancel / Esc /
// backdrop click.

import { h } from './dom.js'

export function domPrompt({
  title = 'INPUT', message = '', value = '', placeholder = '',
  kicker = '◆  EDIT  ◆', confirmLabel = 'OK', cancelLabel = 'CANCEL',
  accent = 'var(--gold)',
} = {}) {
  return new Promise((resolve) => {
    const stage = document.getElementById('hud-stage') ?? document.body
    let done = false
    let input = null

    const finish = (val) => {
      if (done) return
      done = true
      layer.classList.add('closing')
      setTimeout(() => layer.remove(), 200)
      resolve(val)
    }

    input = h('input', {
      type: 'text', value, placeholder, spellcheck: 'false',
      style: {
        width: '100%', boxSizing: 'border-box', marginTop: '14px',
        padding: '11px 13px', fontFamily: "var(--body, 'Pixelify Sans', sans-serif)",
        fontSize: '17px', letterSpacing: '.04em', color: 'var(--text)',
        background: 'var(--bg-1)', border: '2px solid color-mix(in srgb, var(--ac) 55%, var(--line-2))',
        borderRadius: '4px', outline: 'none', textAlign: 'center',
      },
      // Keep keystrokes from leaking to the editor's / Phaser's window hotkeys
      // while typing; commit on Enter, cancel on Esc.
      on: {
        keydown: (e) => {
          e.stopPropagation()
          if (e.key === 'Enter')  { e.preventDefault(); finish(input.value) }
          else if (e.key === 'Escape') { e.preventDefault(); finish(null) }
        },
        // Belt-and-suspenders: if anything suppressed the default focus-on-click
        // (a global pointer handler / custom cursor), force focus after the click.
        pointerdown: () => { setTimeout(() => { try { if (document.activeElement !== input) input.focus() } catch {} }, 0) },
      },
    })

    const layer = h('div', { className: 'qf-cf-layer qf-prompt-layer' }, [
      h('div', { className: 'qf-cf-back', on: { click: () => finish(null) } }),
      h('div', { className: 'qf-cf', style: { '--ac': accent } }, [
        h('div', { className: 'qf-cf-inner' }, [
          h('div', { className: 'sil qf-cf-kick' }, kicker),
          h('div', { className: 'pix qf-cf-title' }, title),
          h('div', { className: 'qf-cf-rule' }),
          message ? h('div', { className: 'qf-cf-body' }, message) : null,
          input,
          h('div', { className: 'qf-cf-btns' }, [
            h('button', { className: 'pix qf-cf-btn', on: { click: () => finish(null) } }, cancelLabel),
            h('button', { className: 'pix qf-cf-btn go', on: { click: () => finish(input.value) } }, confirmLabel),
          ]),
        ].filter(Boolean)),
      ]),
    ])

    stage.appendChild(layer)
    // Force reflow so the .show fade/slam transition runs.
    // eslint-disable-next-line no-unused-expressions
    layer.offsetHeight
    layer.classList.add('show')
    // Defer the focus. domPrompt is opened from a CLICK handler; focusing the
    // field synchronously here lets the browser then apply the click's default
    // focus to the button that was just clicked, stealing focus back — so the
    // field silently ignores typing (the "can't change the value" bug). Running
    // after the current event settles (rAF + a late fallback) makes focus stick.
    const grab = () => { try { input.focus(); input.select() } catch {} }
    requestAnimationFrame(grab)
    setTimeout(grab, 60)
  })
}
