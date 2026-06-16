// menuBackdrop — shared "crypt" backdrop (brick wall + flanking torches + low
// fog), extracted so the companion picker and boss picker carry the title
// screen's signature look (MainMenuOverlay's .qcm-bricks / torches).
//
// Returns an array of pointer-events:none layers to PREPEND into a full-stage
// overlay root (.qf-csl / .qf-bp). The layers are z-index 0 so the picker's own
// content (which should be position:relative / z>=1) sits on top. The CSS lives
// in styles.css under .qf-cryptbg-* and reuses the title screen's keyframes
// (qcm-fogdrift / qcm-flicker / qcm-torchburn), so the look stays identical.

import { h } from './dom.js'

export function buildCryptBackdrop() {
  return [
    h('div', { className: 'qf-cryptbg-bricks' }),
    h('div', { className: 'qf-cryptbg-glow l' }),
    h('div', { className: 'qf-cryptbg-glow r' }),
    h('div', { className: 'qf-cryptbg-fog' }),
    h('div', { className: 'qf-cryptbg-torch l' }, [h('div', { className: 'qf-cryptbg-torchsprite' })]),
    h('div', { className: 'qf-cryptbg-torch r' }, [h('div', { className: 'qf-cryptbg-torchsprite' })]),
  ]
}
