// NameEntryOverlay — DOM port of `src/ui/NameEntryPanel.js`.
//
// Centered modal that prompts for a name (boss title, minion rename,
// etc). Uses a real <input> element so the player gets normal text
// editing affordances (selection, copy/paste, IME) instead of the
// Phaser version's per-keystroke handler.
//
// Usage:
//   const panel = new NameEntryOverlay({
//     title: 'YOUR NAME, MY LORD',
//     instruction: 'Enter your title — the dungeon will remember it.',
//     initial: '',
//     confirmLabel: 'BEGIN REIGN',
//     onConfirm: (name) => { ... },
//     onCancel:  () => { ... },
//   })
//   panel.open()  // appended to #hud-stage and focuses the input
//
// Closes on Enter (submit, non-empty), Escape (cancel), CONFIRM /
// CANCEL clicks, and backdrop click. Max length 16 to match the
// Phaser version.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'

const MAX_LEN = 16

export class NameEntryOverlay {
  constructor(opts = {}) {
    this._opts = {
      title:        opts.title        ?? 'YOUR NAME, MY LORD',
      instruction:  opts.instruction  ?? 'Enter your title — the dungeon will remember it.',
      initial:      opts.initial      ?? '',
      confirmLabel: opts.confirmLabel ?? 'BEGIN REIGN',
      cancelLabel:  opts.cancelLabel  ?? 'CANCEL',
      onConfirm:    opts.onConfirm    ?? (() => {}),
      onCancel:     opts.onCancel     ?? (() => {}),
    }
    this._el     = null
    this._input  = null
    this._closed = false
    this._keyHandler = (e) => this._onKey(e)
  }

  open() {
    if (this._el) return
    ensureStageScaled()
    const stage = document.getElementById('hud-stage') || document.body
    this._el = h('div', { className: 'qf-nameentry' }, [
      h('div', {
        className: 'qf-nameentry-backdrop',
        on: { click: () => this._cancel() },
      }),
      h('div', { className: 'qf-nameentry-modal' }, [
        h('div', { className: 'pix qf-nameentry-title' }, this._opts.title),
        h('div', { className: 'qf-nameentry-instr' }, this._opts.instruction),
        h('input', {
          className: 'pix qf-nameentry-input',
          type: 'text',
          maxlength: MAX_LEN,
          value: this._opts.initial,
          ref: (el) => { this._input = el },
        }),
        h('div', { className: 'qf-nameentry-actions' }, [
          h('button', {
            className: 'btn qf-nameentry-cancel',
            on: { click: () => this._cancel() },
          }, this._opts.cancelLabel),
          h('button', {
            className: 'btn qf-nameentry-confirm',
            on: { click: () => this._submit() },
          }, this._opts.confirmLabel),
        ]),
      ]),
    ])
    stage.appendChild(this._el)
    window.addEventListener('keydown', this._keyHandler)
    // Defer focus so the click that opened us doesn't immediately
    // bubble + blur.
    setTimeout(() => { this._input?.focus(); this._input?.select() }, 0)
  }

  close() {
    if (this._closed) return
    this._closed = true
    window.removeEventListener('keydown', this._keyHandler)
    this._el?.remove()
    this._el    = null
    this._input = null
  }

  _onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); this._submit(); return }
    if (e.key === 'Escape') { e.preventDefault(); this._cancel(); return }
  }

  _submit() {
    const name = (this._input?.value ?? '').trim()
    if (!name) return                  // mirror Phaser version's non-empty gate
    const cb = this._opts.onConfirm
    this.close()
    cb(name)
  }

  _cancel() {
    const cb = this._opts.onCancel
    this.close()
    cb()
  }

  destroy() { this.close() }
}
