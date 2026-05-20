// Tiny DOM helpers for the HTML/CSS HUD layer.
//
// h(tag, attrs?, children?) creates an element. Special attrs:
//   className: string | string[]
//   style:     plain object (camelCase or kebab-case keys)
//   dataset:   { key: value, ... }
//   on:        { event: handler, ... }
//   ref:       (el) => void  — invoked with the created element
// Other attrs become DOM attributes via setAttribute (or direct prop for
// 'value', 'checked', 'disabled').
//
// Children: a Node, a string/number, an array of any of those, or null/false.

export function h(tag, attrs = null, children = null) {
  const el = document.createElement(tag)
  if (attrs) applyAttrs(el, attrs)
  if (children != null) appendChildren(el, children)
  return el
}

// Render-or-update helper: replace `parent`'s children with `nodes`.
export function mount(parent, nodes) {
  parent.replaceChildren()
  appendChildren(parent, nodes)
}

function applyAttrs(el, attrs) {
  for (const k of Object.keys(attrs)) {
    const v = attrs[k]
    if (v == null || v === false) continue
    if (k === 'className') {
      el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v)
    } else if (k === 'style' && typeof v === 'object') {
      applyStyle(el, v)
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const dk of Object.keys(v)) {
        if (v[dk] == null) continue
        el.dataset[dk] = String(v[dk])
      }
    } else if (k === 'on' && typeof v === 'object') {
      for (const ev of Object.keys(v)) el.addEventListener(ev, v[ev])
    } else if (k === 'ref' && typeof v === 'function') {
      v(el)
    } else if (k === 'value' || k === 'checked' || k === 'disabled') {
      el[k] = v
    } else if (k === 'html') {
      el.innerHTML = String(v)
    } else {
      el.setAttribute(k, v === true ? '' : String(v))
    }
  }
}

function appendChildren(parent, child) {
  if (child == null || child === false) return
  if (Array.isArray(child)) {
    for (const c of child) appendChildren(parent, c)
    return
  }
  if (child instanceof Node) {
    parent.appendChild(child)
    return
  }
  parent.appendChild(document.createTextNode(String(child)))
}

// Apply a style object to an element. Handles three shapes correctly:
//   * `'marginTop'`  → direct assignment to el.style (canonical camelCase)
//   * `'margin-top'` → kebab → CSSOM via setProperty (also accepts shorthand)
//   * `'--my-var'`   → CSS custom property via setProperty (Object.assign
//                       would mangle this name through any camel-case path)
// Skips null / undefined values.
function applyStyle(el, styleObj) {
  for (const k of Object.keys(styleObj)) {
    const v = styleObj[k]
    if (v == null) continue
    if (k.startsWith('--') || k.includes('-')) {
      el.style.setProperty(k, String(v))
    } else {
      el.style[k] = v
    }
  }
}

// Animate a ticker count from `from` to `to` over `duration` ms with a
// cubic ease-out. Calls `setText(value)` each frame with the rounded
// intermediate value. Cancellable via the returned function.
//
// Edge: when `from === to` we still defer setText to the next frame
// rather than calling it synchronously. Callers commonly invoke tween
// from a ref callback inside h(), and h() then APPENDS children after
// the ref runs (textContent= sets create a text node; appendChild
// adds another). Calling setText synchronously here would leave the
// element with two text nodes ("↗ 0↗ 0" on a zero pill). Deferring
// matches the async path so init-text is overwritten cleanly.
export function tween(from, to, duration, setText) {
  if (from === to) {
    const raf0 = requestAnimationFrame(() => setText(to))
    return () => cancelAnimationFrame(raf0)
  }
  let raf = 0
  const start = performance.now()
  const delta = to - from
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1)
    const eased = 1 - Math.pow(1 - t, 3)
    setText(Math.round(from + delta * eased))
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}
