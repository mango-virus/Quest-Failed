// modeSelectArt — the hero "gate portal" art for the Choose-Your-Path screen,
// ported faithfully from the design handoff (path-portal.jsx / fx.jsx) into
// plain SVG/HTML strings the overlay injects via `html:`.
//
// Each gate frames an ornate runic medallion set into a carved doorway: stone
// side-jambs with etched runes + a pixel wall-torch on each, a per-mode particle
// motif (Campaign = rising war-embers; Endless = orbiting motes), and a swappable
// outer ring (Campaign = engraved rune-halo; Endless = interlocking iron chain).
// All colours resolve from the --ac/--acB/--acD/--acg CSS vars set by the gate's
// accent class, so the art tints itself per mode. Motion is CSS-driven (the
// gp-* classes animate only while the gate is hover/focus/active).
//
// Pure string builders — no DOM, no deps. Geometry mirrors the prototype's math
// exactly (CX/CY 130,100; medallion R 44; 48-tick ring; 8 runes/rivets; 16-link
// chain with clip-stamped crossings) so the screenshots reproduce 1:1.

const rad = (d) => (d * Math.PI) / 180

// medallion centre (also the outer-ring centre)
const CX = 130, CY = 100, R = 44
// outer-ring helpers use a Y-up convention (matches the JSX PP())
const PP = (a, r) => [CX + r * Math.cos(rad(a)), CY - r * Math.sin(rad(a))]

// ── reusable gradient/filter defs (one set per gate, keyed by uid) ──────────
function defs(uid) {
  return `
    <radialGradient id="key-${uid}" cx="50%" cy="30%" r="90%">
      <stop offset="0%" stop-color="var(--acB)"/><stop offset="60%" stop-color="var(--ac)"/><stop offset="100%" stop-color="var(--acD)"/>
    </radialGradient>
    <radialGradient id="bezel-${uid}" cx="50%" cy="28%" r="80%">
      <stop offset="0%" stop-color="#3a3040"/><stop offset="48%" stop-color="#211a28"/><stop offset="100%" stop-color="#0c0812"/>
    </radialGradient>
    <radialGradient id="core-${uid}" cx="50%" cy="34%" r="85%">
      <stop offset="0%" stop-color="rgba(var(--acg),.30)"/><stop offset="46%" stop-color="#120c1a"/><stop offset="100%" stop-color="#080510"/>
    </radialGradient>
    <radialGradient id="rivet-${uid}" cx="36%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#7a6353"/><stop offset="100%" stop-color="#1a120e"/>
    </radialGradient>
    <linearGradient id="steel-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4c4552"/><stop offset="46%" stop-color="#2a2430"/>
      <stop offset="56%" stop-color="#191420"/><stop offset="100%" stop-color="#0b0712"/>
    </linearGradient>
    <radialGradient id="iron-${uid}" cx="38%" cy="30%" r="82%">
      <stop offset="0%" stop-color="#3e3744"/><stop offset="100%" stop-color="#120e18"/>
    </radialGradient>
    <filter id="soft-${uid}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2"/></filter>`
}

// ── outer ring C · engraved metal rune-halo (Campaign) ──────────────────────
function ringHalo(uid) {
  let ticks = ''
  for (let i = 0; i < 48; i++) {
    const a = i * 7.5, big = i % 4 === 0
    const [x1, y1] = PP(a, big ? 69 : 72), [x2, y2] = PP(a, 82)
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${big ? 'var(--ac)' : 'rgba(var(--acg),.4)'}" stroke-width="${big ? 1.8 : 1}" stroke-linecap="round"/>`
  }
  let studs = ''
  for (let i = 0; i < 8; i++) { const [x, y] = PP(i * 45 + 22.5, 76); studs += `<circle cx="${x}" cy="${y}" r="2.6" fill="url(#rivet-${uid})" stroke="#000" stroke-width="0.5"/>` }
  return `<g class="gp-arch gp-halo">
    <circle cx="${CX}" cy="${CY}" r="88" fill="none" stroke="url(#steel-${uid})" stroke-width="5"/>
    <circle class="gp-keystone" cx="${CX}" cy="${CY}" r="88" fill="none" stroke="var(--ac)" stroke-width="1" opacity="0.5"/>
    <circle cx="${CX}" cy="${CY}" r="63" fill="none" stroke="url(#steel-${uid})" stroke-width="2.6"/>
    <g class="gp-halo-band">${ticks}${studs}</g>
  </g>`
}

// ── outer ring D · genuinely interlocking iron chain (Endless) ──────────────
// Draw every link, then stamp the correct neighbour ON TOP at each rim crossing
// (clipped to a small disc) so each pair threads through the other.
function ringChain(uid) {
  const N = 16, RR = 74, rx = 20, ry = 14
  const links = []
  for (let i = 0; i < N; i++) { const a = i * (360 / N); links.push({ a, c: PP(a, RR), rot: -(a + 90) }) }
  const ring = (l) => `<g transform="translate(${l.c[0]} ${l.c[1]}) rotate(${l.rot})">
    <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="#050308" stroke-width="9"/>
    <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="url(#iron-${uid})" stroke-width="5.5"/>
    <ellipse rx="${rx - 0.8}" ry="${ry - 0.8}" fill="none" stroke="rgba(255,255,255,.20)" stroke-width="1.1"/>
  </g>`
  let clips = '', stamps = '', body = ''
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, li = links[i], lj = links[j]
    const aj = i === N - 1 ? lj.a + 360 : lj.a
    const am = (li.a + aj) / 2
    const u = [Math.cos(rad(am)), -Math.sin(rad(am))]
    const M = [(li.c[0] + lj.c[0]) / 2, (li.c[1] + lj.c[1]) / 2]
    const d = ry + 1, cr = 9
    const Po = [M[0] + u[0] * d, M[1] + u[1] * d]
    const Pi = [M[0] - u[0] * d, M[1] - u[1] * d]
    clips += `<clipPath id="clo-${uid}-${i}"><circle cx="${Po[0]}" cy="${Po[1]}" r="${cr}"/></clipPath>`
    clips += `<clipPath id="cli-${uid}-${i}"><circle cx="${Pi[0]}" cy="${Pi[1]}" r="${cr}"/></clipPath>`
    stamps += `<g clip-path="url(#clo-${uid}-${i})">${ring(li)}</g>`
    stamps += `<g clip-path="url(#cli-${uid}-${i})">${ring(lj)}</g>`
  }
  for (const l of links) body += ring(l)
  return `<g class="gp-arch gp-chain"><defs>${clips}</defs>${body}${stamps}</g>`
}

// ── centre glyphs ───────────────────────────────────────────────────────────
function swordsGlyph() {
  const blade = `<g>
    <polygon points="0,-19 -2.4,-12 -2.4,8 2.4,8 2.4,-12" fill="#e9e2d4" stroke="var(--acD)" stroke-width="0.8"/>
    <polygon points="0,-19 -2.4,-12 0,-12" fill="#fff"/>
    <line x1="0" y1="-17" x2="0" y2="7" stroke="rgba(0,0,0,.25)" stroke-width="0.7"/>
    <rect x="-7" y="8" width="14" height="3" rx="1" fill="var(--acB)" stroke="var(--acD)" stroke-width="0.6"/>
    <rect x="-1.6" y="11" width="3.2" height="7" fill="#3a2e26"/>
    <circle cx="0" cy="19.5" r="2.4" fill="var(--ac)" stroke="var(--acD)" stroke-width="0.6"/>
  </g>`
  return `<g><g transform="rotate(34)" opacity="0.96">${blade}</g><g transform="rotate(-34)">${blade}</g></g>`
}
function infinityGlyph() {
  const knot = 'M -13 0 C -13 -7 -3 -7 0 0 C 3 7 13 7 13 0 C 13 -7 3 -7 0 0 C -3 7 -13 7 -13 0 Z'
  return `<g>
    <path d="M 0 -15 A 15 15 0 1 1 -13 7.5" fill="none" stroke="var(--acD)" stroke-width="1.4" stroke-linecap="round" opacity="0.7" class="gp-cycle"/>
    <polygon points="-13,7.5 -17,4 -10,3.5" fill="var(--ac)" opacity="0.85"/>
    <path d="${knot}" fill="none" stroke="var(--acB)" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="${knot}" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1" stroke-linejoin="round"/>
  </g>`
}

// ── the full medallion SVG (recess + beam + ring + runic seal) ──────────────
function gatePortalSVG(uid, glyphKind, ring) {
  let ticks = ''
  for (let i = 0; i < 48; i++) {
    const a = i * 7.5, big = i % 4 === 0
    const r1 = R - 2.5, r2 = big ? R - 10 : R - 6.5
    const x1 = CX + r1 * Math.cos(rad(a)), y1 = CY + r1 * Math.sin(rad(a))
    const x2 = CX + r2 * Math.cos(rad(a)), y2 = CY + r2 * Math.sin(rad(a))
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${big ? 'var(--acB)' : 'rgba(var(--acg),.55)'}" stroke-width="${big ? 1.8 : 1}" stroke-linecap="round"/>`
  }
  let rivets = ''
  for (let i = 0; i < 8; i++) {
    const a = i * 45 + 22.5
    const x = CX + (R - 2) * Math.cos(rad(a)), y = CY + (R - 2) * Math.sin(rad(a))
    rivets += `<circle cx="${x}" cy="${y}" r="2.6" fill="url(#rivet-${uid})" stroke="#000" stroke-width="0.5"/>`
  }
  const runeChars = ['ᚱ', 'ᚲ', 'ᚦ', 'ᛟ', 'ᛉ', 'ᚨ', 'ᛞ', 'ᚷ']
  let runes = ''
  runeChars.forEach((g, i) => {
    const a = i * 45 - 90, r = R - 19
    const x = CX + r * Math.cos(rad(a)), y = CY + r * Math.sin(rad(a)) + 2.6
    runes += `<text x="${x}" y="${y}" text-anchor="middle" class="gp-rune" font-size="7">${g}</text>`
  })
  const outer = ring === 'chain' ? ringChain(uid) : ringHalo(uid)
  const glyph = glyphKind === 'swords' ? swordsGlyph() : infinityGlyph()
  return `<svg class="gp" viewBox="0 0 260 196" role="img" aria-hidden="true">
    <defs>${defs(uid)}</defs>
    <ellipse cx="${CX}" cy="${CY + 4}" rx="82" ry="80" fill="#06040a" opacity="0.92"/>
    <polygon class="gp-beam" points="${CX - 26},${CY - 80} ${CX + 26},${CY - 80} ${CX + 70},196 ${CX - 70},196" fill="url(#core-${uid})"/>
    ${outer}
    <g class="gp-seal">
      <circle class="gp-glow" cx="${CX}" cy="${CY}" r="${R + 8}" fill="rgba(var(--acg),.30)" filter="url(#soft-${uid})"/>
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#bezel-${uid})" stroke="var(--acD)" stroke-width="3"/>
      <circle cx="${CX}" cy="${CY}" r="${R - 0.5}" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="1" stroke-dasharray="3 200" stroke-dashoffset="-60" transform="rotate(-90 ${CX} ${CY})"/>
      <g>${ticks}</g>
      <circle class="gp-band" cx="${CX}" cy="${CY}" r="${R - 14}" fill="none" stroke="var(--ac)" stroke-width="1.4" stroke-dasharray="1.5 5" opacity="0.65"/>
      ${runes}
      <circle cx="${CX}" cy="${CY}" r="${R - 22}" fill="url(#core-${uid})" stroke="var(--acD)" stroke-width="1.6"/>
      <circle cx="${CX}" cy="${CY}" r="${R - 22}" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="2.4" opacity="0.5"/>
      <g class="gp-glyph" transform="translate(${CX} ${CY})">${glyph}</g>
      ${rivets}
    </g>
  </svg>`
}

// ── pixel wall-torch (jamb sconces), ported from fx.jsx Torch ───────────────
const TORCH_HANDLE = ['..bbbbb..', '.bWwwwWb.', '..bbbbb..', '...wWw...', '...wWw...', '...wWw...', '...wWw...', '...wWw...']
const FLAME_A = ['....c....', '...fcf...', '...fcf...', '..offfo..', '..offfo..', '.offcffo.', '.offcffo.', '..offfo..', '...ooo...']
const FLAME_B = ['...c.....', '...cf....', '..fcff...', '..offo...', '.offffo..', '.offcffo.', '.offcffo.', '..offfo..', '...ooo...']

function torchSVG(flame, core, wood) {
  const u = 3.4 * 0.82
  const COLS = {
    o: `color-mix(in srgb, ${flame} 60%, #5a1400)`, f: flame, c: core,
    w: wood, W: `color-mix(in srgb, ${wood} 70%, #d8b48c)`, b: '#24160d',
  }
  const W = 9, totalH = 17
  const rects = (map, y0) => map.map((row, y) =>
    [...row].map((ch, x) => (ch === '.' || ch === ' ') ? '' :
      `<rect x="${x * u}" y="${(y0 + y) * u}" width="${u + 0.4}" height="${u + 0.4}" fill="${COLS[ch]}"/>`).join('')
  ).join('')
  return `<div class="pg-torch-wrap" style="width:${W * u}px;height:${totalH * u}px;">
    <div class="pg-torch-glow" style="left:50%;top:${-u}px;width:${u * 12}px;height:${u * 12}px;
      background:radial-gradient(circle, color-mix(in srgb,${flame} 55%, transparent) 0%, rgba(0,0,0,0) 68%);"></div>
    <svg width="${W * u}" height="${totalH * u}" viewBox="0 0 ${W * u} ${totalH * u}" shape-rendering="crispEdges"
      style="position:relative;image-rendering:pixelated;display:block;filter:drop-shadow(0 0 ${u * 1.5}px ${COLS.o});">
      <g>${rects(TORCH_HANDLE, 9)}</g>
      <g class="pg-flameA">${rects(FLAME_A, 0)}</g>
      <g class="pg-flameB" style="opacity:0">${rects(FLAME_B, 0)}</g>
    </svg>
  </div>`
}

// ── particle motifs (deterministic so they never reflow on re-render) ───────
function emberField(color) {
  let out = ''
  for (let k = 0; k < 8; k++) {
    const left = (k * 12.3 + (k % 3) * 7) % 100
    const dur = 6 + (k % 4) * 1.6
    const delay = -((k % 5) * 1.3)
    const sz = 2 + (k % 3)
    out += `<span class="pg-ember" style="left:${left}%;width:${sz}px;height:${sz}px;background:${color};
      box-shadow:0 0 ${sz * 2}px ${color};animation-duration:${dur}s;animation-delay:${delay}s;"></span>`
  }
  return out
}

function orbitMotes() {
  const motes = [
    { r: 96, d: 13, rev: false }, { r: 112, d: 17, rev: true }, { r: 88, d: 10, rev: false },
    { r: 120, d: 20, rev: true }, { r: 104, d: 15, rev: false }, { r: 94, d: 12, rev: true },
  ]
  return motes.map((m, i) =>
    `<span class="pg-mote${m.rev ? ' rev' : ''}" style="--r:${m.r}px;animation-duration:${m.d}s;animation-delay:${-(m.d * (i / motes.length))}s;"></span>`
  ).join('')
}

// ── full portal scene for one gate: jambs + torches + particles + medallion ─
export function portalSceneHTML(mode) {
  const campaign = mode === 'campaign'
  const torch = campaign
    ? torchSVG('#ff5a3c', '#ffcf66', '#43342a')
    : torchSVG('#ffac3c', '#ffe79a', '#43342a')
  const runes = campaign ? ['ᛏ', 'ᚱ', 'ᚷ'] : ['ᛜ', 'ᛟ', 'ᛞ']
  const jamb = (side) => `<div class="pg-jamb ${side}">
    <div class="pg-jamb-runes">${runes.map(r => `<span>${r}</span>`).join('')}</div>
    <div class="pg-sconce"><div class="pg-torch">${torch}</div><div class="pg-sconce-plate"></div></div>
  </div>`
  const particles = campaign
    ? `<div class="pg-emberbox l">${emberField('#ff7a3d')}</div><div class="pg-emberbox r">${emberField('#ff7a3d')}</div>`
    : `<div class="pg-orbit">${orbitMotes()}</div>`
  const medallion = gatePortalSVG('ms-' + mode, campaign ? 'swords' : 'infinity', campaign ? 'halo' : 'chain')
  return jamb('l') + jamb('r') + particles + medallion
}

// Small inline pixel padlock for the lock pills (ported from LockGlyph).
export function lockGlyphSVG(color = 'currentColor', size = 11) {
  const h = Math.round(size * 1.18)
  return `<svg width="${size}" height="${h}" viewBox="0 0 11 13" shape-rendering="crispEdges" style="display:inline-block;vertical-align:-1px">
    <path d="M3 5.2V3.6a2.5 2.5 0 0 1 5 0V5.2" fill="none" stroke="${color}" stroke-width="1.3"/>
    <rect x="1.4" y="5" width="8.2" height="7" rx="1" fill="${color}"/>
    <rect x="5" y="7.4" width="1" height="2.4" fill="#0a0710"/>
  </svg>`
}
