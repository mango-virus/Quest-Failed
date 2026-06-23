// soundboard.mjs — self-contained HTML soundboard to audition EVERY chiptune SFX
// in the build without playing the game. Scans assets/audio/sfx-*.wav and writes
// tools/audio/soundboard.html.
//
// USAGE:
//   npm run audio:board          # (re)generate the page
//   npm run serve                # in another terminal
//   open http://localhost:8767/tools/audio/soundboard.html   (or :8080)
//
// Click a row to play it. Re-run after generating/tuning sounds (cache-busts).

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const AUDIO = join(ROOT, 'assets/audio')
const LEDGER = join(ROOT, 'assets/audio/ai-placeholders.json')
const OUT   = join(ROOT, 'tools/audio/soundboard.html')

// Gap-fill / big-moment keys that live alongside the cinematics group.
const BIG = ['sfx-wave-start','sfx-legendary','sfx-alert','sfx-act-clear','sfx-overtime','sfx-summary','sfx-duel-begin','sfx-defect','sfx-casualty']
const CATS = [
  { title: 'Cinematics & big moments', test: k => k.startsWith('sfx-cin-') || BIG.includes(k) },
  { title: 'Boss signatures',          test: k => k.startsWith('sfx-boss-') },
  { title: 'Traps',                    test: k => k.startsWith('sfx-trap-') },
  { title: 'Class abilities',          test: k => k.startsWith('sfx-abil-') },
  { title: 'Core game sounds',         test: () => true },   // everything else
]

function main() {
  // Optional nice labels from the (legacy) ledger; fall back to the key.
  const moments = {}
  if (existsSync(LEDGER)) { try { for (const e of (JSON.parse(readFileSync(LEDGER, 'utf8')).entries || [])) moments[e.key] = e.moment } catch {} }

  const bust = `?v=${Date.now()}`
  const keys = readdirSync(AUDIO).filter(f => f.startsWith('sfx-') && f.endsWith('.wav')).map(f => basename(f, '.wav')).sort()

  const assigned = new Set()
  const groups = CATS.map(c => {
    const ks = keys.filter(k => !assigned.has(k) && c.test(k))
    ks.forEach(k => assigned.add(k))
    return { title: c.title, items: ks.map(k => ({ key: k, moment: moments[k] || '', src: `../../assets/audio/${k}.wav${bust}` })) }
  }).filter(g => g.items.length)

  const data = JSON.stringify(groups)
  const total = keys.length

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quest Failed — Chiptune Soundboard (${total})</title>
<style>
  :root { --bg:#14110d; --panel:#1d1812; --edge:#3a2f22; --gold:#e8c374; --gold2:#caa24a;
          --text:#e9e0cf; --dim:#9a8f78; --play:#5a8f3a; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.4 ui-monospace,Menlo,Consolas,monospace; }
  header { position:sticky; top:0; z-index:5; background:linear-gradient(#1d1812,#161109); border-bottom:1px solid var(--edge); padding:14px 18px; }
  h1 { margin:0 0 2px; font-size:18px; color:var(--gold); letter-spacing:.5px; }
  .sub { color:var(--dim); font-size:12px; }
  .controls { margin-top:10px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  input[type=search]{ flex:1; min-width:180px; background:#0f0c08; border:1px solid var(--edge); color:var(--text); padding:7px 10px; border-radius:6px; font:inherit; }
  label { color:var(--dim); font-size:12px; display:flex; align-items:center; gap:6px; }
  input[type=range]{ accent-color:var(--gold2); }
  main { padding:8px 18px 40px; }
  section { margin-top:20px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:1px; color:var(--gold2); border-bottom:1px solid var(--edge); padding-bottom:5px; margin:0 0 8px; }
  .row { display:flex; align-items:center; gap:10px; padding:7px 10px; border:1px solid transparent; border-radius:7px; cursor:pointer; }
  .row:hover { background:var(--panel); border-color:var(--edge); }
  .row.playing { background:#26200f; border-color:var(--gold2); }
  .row.failed { background:#3a1414; border-color:#a44; }
  .play { width:30px; height:30px; flex:none; border-radius:50%; border:1px solid var(--edge); background:#0f0c08; color:var(--play); font-size:13px; display:grid; place-items:center; }
  .row.playing .play { color:var(--gold); border-color:var(--gold); }
  .row.failed .play { color:#f88; border-color:#a44; }
  .key { color:var(--gold); min-width:230px; }
  .moment { color:var(--dim); font-size:12px; flex:1; }
  .err { color:#f88; font-size:11px; flex:none; }
  .count { color:var(--dim); font-size:11px; font-weight:normal; margin-left:8px; }
  kbd { background:#0f0c08; border:1px solid var(--edge); border-radius:4px; padding:1px 5px; font-size:11px; }
  #banner { background:#5a1a1a; color:#ffd; padding:10px 14px; border-radius:6px; margin:10px 0; font-size:13px; display:none; }
  #banner.show { display:block; }
</style></head>
<body>
<header>
  <h1>Quest Failed — Chiptune Soundboard</h1>
  <div class="sub">${total} synthesized 8-bit SFX · click a row to play · <kbd>Esc</kbd> stop</div>
  <div class="controls">
    <input type="search" id="filter" placeholder="filter by key or moment…">
    <label>vol <input type="range" id="vol" min="0" max="1" step="0.05" value="0.8"></label>
    <label><input type="checkbox" id="autonext"> auto-advance</label>
  </div>
</header>
<div style="padding:0 18px"><div id="banner"></div></div>
<main id="board"></main>
<script>
const GROUPS = ${data};
if (location.protocol === 'file:') {
  const b = document.getElementById('banner'); b.className = 'show';
  b.innerHTML = '⚠ Opened as a file (file://) — audio can\\'t load. Run <b>npm run serve</b> and open <b>http://localhost:8767/tools/audio/soundboard.html</b>.';
}
const board = document.getElementById('board');
const volEl = document.getElementById('vol');
const filterEl = document.getElementById('filter');
const autonextEl = document.getElementById('autonext');
let cur = null, curRow = null, flat = [];
for (const g of GROUPS) {
  const sec = document.createElement('section');
  const h = document.createElement('h2');
  h.innerHTML = g.title + '<span class="count">' + g.items.length + '</span>';
  sec.appendChild(h);
  for (const it of g.items) {
    const row = document.createElement('div');
    row.className = 'row'; row.dataset.search = (it.key + ' ' + it.moment).toLowerCase();
    row.innerHTML = '<div class="play">▶</div><div class="key"></div><div class="moment"></div>';
    row.querySelector('.key').textContent = it.key;
    row.querySelector('.moment').textContent = it.moment;
    row.addEventListener('click', () => play(it.src, row));
    sec.appendChild(row);
    flat.push({ it, row });
  }
  board.appendChild(sec);
}
function fail(row, msg) {
  row.classList.remove('playing'); row.classList.add('failed');
  if (!row.querySelector('.err')) { const s = document.createElement('span'); s.className = 'err'; row.appendChild(s); }
  row.querySelector('.err').textContent = '⚠ ' + msg;
}
function play(src, row) {
  if (cur) { cur.pause(); cur = null; }
  if (curRow) curRow.classList.remove('playing');
  row.classList.remove('failed'); const e = row.querySelector('.err'); if (e) e.remove();
  const a = new Audio(src); a.volume = parseFloat(volEl.value);
  cur = a; curRow = row; row.classList.add('playing');
  a.addEventListener('error', () => fail(row, 'could not load (serve via npm run serve?)'));
  a.addEventListener('ended', () => {
    row.classList.remove('playing');
    if (autonextEl.checked) { const i = flat.findIndex(f => f.row === row); const n = flat[i+1]; if (n) play(n.it.src, n.row); }
  });
  a.play().catch(err => fail(row, 'blocked: ' + (err && err.name || err)));
}
filterEl.addEventListener('input', () => {
  const q = filterEl.value.toLowerCase();
  for (const { row } of flat) row.style.display = row.dataset.search.includes(q) ? '' : 'none';
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) { cur.pause(); cur = null; if (curRow) curRow.classList.remove('playing'); } });
</script>
</body></html>
`
  writeFileSync(OUT, html)
  console.log(`wrote ${OUT}`)
  console.log(`  ${total} chiptune SFX across ${groups.length} groups`)
  console.log(`  serve: npm run serve → http://localhost:8767/tools/audio/soundboard.html`)
}

main()
