// menuWalkers.js — silhouetted figures crossing the base of the title-screen
// wall. Vanilla port of the design prototype's walkers.jsx (React) — same
// behaviour, no framework: a rAF loop moves DOM sprite divs and flipbooks
// them through the game's real LPC adventurer sheets + boss walk/run sheets.
//
// Adventurers (many classes, some with sprite variants) walk or run past;
// some pause, turn around, or switch gait. The picked boss crosses now and
// then (2× size). Adventurers that stray too close to the boss turn and FLEE
// (run animation) in the opposite direction. A fireSignal() burst can be
// triggered for a test/menu-press flourish.
//
// Assets are loaded directly by URL (the dev server serves /assets statically),
// so this is independent of Phaser's preloader. Sheets that 404 are skipped.
//
// Usage:
//   const w = new MenuWalkers(containerEl, { bossId: 'orc', stageW: 1920 })
//   w.start();  …  w.fire();  …  w.destroy()

// Which adventurer classes can walk by, and how many sprite variants each has.
// Loaded at runtime from the generated manifest (assets/sprites/adventurers/
// walkers.json — `npm run gen-walkers`), so EVERY baked sprite is reachable and
// each class is picked uniformly (a 1-variant class is as likely as a 100-
// variant one). This baked copy is only a fallback if the fetch fails.
const WW_MANIFEST_URL = 'assets/sprites/adventurers/walkers.json'
const WW_FALLBACK = {
  aldric: 4, barbarian: 100, bard: 100, beast_master: 100, black_mage: 1, bounty_hunter: 100,
  cartographer_scholar: 100, champion_auberon: 1, champion_aurelia: 1, champion_garreth: 1,
  champion_halric: 1, champion_kael: 1, champion_mordrake: 1, champion_mortessa: 1,
  champion_necrarch: 1, champion_rourke: 1, champion_turncoat: 1, champion_vane: 1,
  champion_velloran: 1, cleric: 100, cosplay_adventurer: 100, gambler: 100, gladiator: 100,
  knight: 100, mage: 100, miner: 100, monk: 100, necromancer: 100, paladin: 1, peasant: 100,
  pirate: 100, ranger: 100, rogue: 100, samurai: 1, shadow_monarch: 1, templar: 100,
  valkyrie: 100, white_mage: 1,
}
const wwAdvSheet = (cls, v) => `assets/sprites/adventurers/${cls}/v${String(v).padStart(2, '0')}.png`

// LPC row indices (64px rows): walk@8-11, idle@21-24, run@25-28; dirs up/left/down/right.
const ADV_ANIM = {
  walk: { rowL: 9,  rowR: 11, frames: 9, fps: 10 },
  run:  { rowL: 26, rowR: 28, frames: 8, fps: 14 },
  idle: { rowL: 22, rowR: 24, frames: 2, fps: 4  },
}

// Boss walk-sheet map: [fileBase, frameW, frameH?]. frameH defaults to frameW.
const WW_BOSS = {
  beholder: ['Beholder3_Walk_with_shadow', 64], demon: ['Demon3_Walk_with_shadow', 128],
  gnoll: ['Gnoll3_Walk_with_shadow', 64], golem: ['Golem3_Walk_with_shadow', 128],
  lich: ['Lich3_Walk_with_shadow', 64], lizardman: ['Lizardman3_Walk_with_shadow', 64],
  myconid: ['Mushroom3_Walk_with_shadow', 64], orc: ['orc3_Walk_with_shadow', 64],
  slime: ['Slime3_Walk_with_shadow', 128], vampire: ['Vampires3_Walk_with_shadow', 64],
  wraith: ['Ghost3_Walk_with_shadow', 64], succubus: ['Succubus_Walk', 73, 70],
}
const wwBossSheet    = (id) => `assets/sprites/${id}/${WW_BOSS[id][0]}.png`
const wwBossRunSheet = (id) => wwBossSheet(id).replace('_Walk', '_Run')

// Display sizing — design proto authored in 1600-space at adv=150px / boss=300px;
// this stage is 1920 (×1.2), so scale up to keep the same on-screen proportion.
const SCALE_K   = 1.2
const ADV_PX    = 150 * SCALE_K   // target on-screen adventurer height
const BOSS_PX   = 300 * SCALE_K   // target on-screen boss CHARACTER height
const ADV_SHEET_W = 832           // LPC sheet width (13 frames × 64)
const ADV_ROWS    = 29

const rnd = (a, b) => a + Math.random() * (b - a)
let WW_ID = 0

// Perf caps (see the title-screen lag fix). The walkers are moving DOM sprites
// with a live filter + masked soft-light blend, so each on-screen figure has a
// real per-frame raster cost — keep the simultaneous count low. And spawn only
// from a small FIXED roster of variants chosen once per session (WW_POOL),
// rather than pulling randomly from the thousands of baked (class × variant)
// combos: that bounds the decoded-image memory (no unbounded WW_STRIP growth)
// and front-loads the one-time canvas strip/decode of each sheet to menu-open,
// instead of a fresh 25–50ms main-thread stall every time a never-seen variant
// walks on. Variety still reads fine — ~9 distinct adventurers pacing the wall.
const WW_MAX  = 5    // hard cap on simultaneous walkers (was 14)
const WW_POOL = 9    // distinct adventurer variants used per session

// Torch-light falloff (logical px). A walker within this horizontal distance of
// a torch column gets lit up — brighter + warmer + a soft glow — so figures feel
// organically lit as they pass under the sconces. Fallback torch centres match
// the CSS (left/right torch centred at 245 / 1675 in the 1920-wide stage).
const WW_LIGHT_RADIUS = 340
const WW_TORCH_FALLBACK = [245, 1675]

// Runtime shadow-strip cache: removes the soft gray oval shadow client-side so
// freshly-imported variants need no pre-processing. Idempotent. Calls cb with a
// data-URL of the cleaned sheet (or the original URL on any failure / CORS).
const WW_STRIP = {}
function wwStrip(url, cb) {
  const cached = WW_STRIP[url]
  if (cached) { cb(cached); return }
  const img = new Image()
  img.onload = () => {
    try {
      const cv = document.createElement('canvas')
      cv.width = img.naturalWidth; cv.height = img.naturalHeight
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0)
      const im = cx.getImageData(0, 0, cv.width, cv.height); const a = im.data
      for (let i = 0; i < a.length; i += 4) {
        const al = a[i + 3]; if (al === 0 || al >= 215) continue
        const r = a[i], g = a[i + 1], b = a[i + 2]
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        if (mx - mn < 30 && mx < 165) a[i + 3] = 0
      }
      cx.putImageData(im, 0, 0)
      const u = cv.toDataURL('image/png'); WW_STRIP[url] = u; cb(u)
    } catch (e) { WW_STRIP[url] = url; cb(url) }
  }
  img.onerror = () => { WW_STRIP[url] = url; cb(url) }
  img.src = url
}

export class MenuWalkers {
  constructor(container, { bossId = 'orc', stageW = 1920 } = {}) {
    this._host = container
    this._bossId = WW_BOSS[bossId] ? bossId : 'orc'
    this._stageW = stageW
    this._walkers = []
    this._bossMeta = {}
    this._raf = 0
    this._spawnTimer = 0
    this._alive = false
    this._last = 0
    // Class roster + per-class variant counts — seeded from the baked fallback,
    // replaced by the generated manifest once it loads (see _loadManifest).
    this._vars = { ...WW_FALLBACK }
    this._classes = Object.keys(this._vars)
    // The fixed per-session spawn pool: ~WW_POOL distinct {cls,v} pairs chosen
    // once (built in start() from the fallback, rebuilt when the manifest lands)
    // and pre-stripped, so spawning never decodes a brand-new sheet mid-frame.
    this._roster = []
  }

  // Load the generated walkers manifest so every baked sprite is reachable and
  // the class roster reflects what's actually on disk. Fire-and-forget; the
  // fallback roster is already usable, so spawning never blocks on this.
  _loadManifest() {
    fetch(WW_MANIFEST_URL).then(r => r.ok ? r.json() : null).then(m => {
      if (!this._alive || !m || typeof m !== 'object') return
      const keys = Object.keys(m)
      if (keys.length) {
        this._vars = m; this._classes = keys
        // Rebuild the spawn pool from the real manifest (start() seeded it from
        // the fallback). One extra strip batch early on; bounded thereafter.
        this._buildRoster()
      }
    }).catch(() => {})
  }

  // Choose the fixed per-session pool of distinct adventurer variants and warm
  // their stripped-sheet cache up front. Bounds decoded-image memory + moves the
  // per-sheet canvas decode off the hot path (one-time, at menu open).
  _buildRoster() {
    const classes = this._classes
    if (!classes.length) return
    const picks = [], seen = new Set()
    let guard = 0
    while (picks.length < WW_POOL && guard++ < WW_POOL * 16) {
      const cls = classes[(Math.random() * classes.length) | 0]
      const v = 1 + ((Math.random() * (this._vars[cls] || 1)) | 0)
      const key = cls + ':' + v
      if (seen.has(key)) continue
      seen.add(key); picks.push({ cls, v })
    }
    this._roster = picks
    // Pre-strip every roster sheet now (idempotent; cached in WW_STRIP) so the
    // first time each one actually spawns it's an instant cache hit.
    for (const p of picks) wwStrip(wwAdvSheet(p.cls, p.v), () => {})
  }

  start() {
    if (this._alive) return
    this._alive = true
    this._loadManifest()
    this._buildRoster()   // seed from the fallback; _loadManifest rebuilds on land
    this._measureBoss()
    this._last = performance.now()
    const loop = (now) => {
      if (!this._alive) return
      this._tick(now)
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
    // Ambient cadence — fewer figures, longer gaps. First spawn after a beat.
    const sched = () => {
      if (!this._alive) return
      this._spawn(Math.random() < 0.1 ? 'boss' : 'adv')
      this._spawnTimer = setTimeout(sched, rnd(4600, 9000))
    }
    this._spawnTimer = setTimeout(sched, 1200)
  }

  // Trigger a small burst (used on menu open / a button press flourish).
  fire() {
    if (!this._alive) return
    // 1–2 figures (was 2–4) — the WW_MAX cap is low now, so a big burst would
    // just slam straight into the cap and no-op the extras anyway.
    const n = 1 + ((Math.random() * 2) | 0)
    for (let i = 0; i < n; i++) setTimeout(() => this._spawn('adv'), i * rnd(280, 620))
    if (Math.random() < 0.5) setTimeout(() => this._spawn('boss'), rnd(300, 1200))
  }

  destroy() {
    this._alive = false
    if (this._raf) cancelAnimationFrame(this._raf)
    if (this._spawnTimer) clearTimeout(this._spawnTimer)
    this._raf = 0; this._spawnTimer = 0
    for (const w of this._walkers) w._el?.remove()
    this._walkers = []
  }

  // ─── boss frame/foot measurement ───────────────────────────────────────
  _measureBoss() {
    const id = this._bossId
    const m = WW_BOSS[id]; if (!m) return
    const fw = m[1], fh = m[2] || m[1]
    const measure = (url, cb) => {
      const img = new Image()
      img.onload = () => {
        const frames = Math.max(1, Math.round(img.naturalWidth / fw))
        let footPad = fh * 0.1, charH = fh * 0.8
        try {
          const cv = document.createElement('canvas')
          cv.width = img.naturalWidth; cv.height = img.naturalHeight
          const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0)
          const y0 = 3 * fh, hh = Math.min(fh, img.naturalHeight - y0)
          const dat = cx.getImageData(0, y0, img.naturalWidth, hh).data
          const Wd = img.naturalWidth
          let minY = -1, maxY = -1
          for (let yy = 0; yy < hh; yy++) {
            let any = false
            for (let xx = 0; xx < Wd; xx++) { if (dat[(yy * Wd + xx) * 4 + 3] > 45) { any = true; break } }
            if (any) { if (minY < 0) minY = yy; maxY = yy }
          }
          if (maxY >= 0) { footPad = fh - (maxY + 1); charH = Math.max(8, maxY - minY + 1) }
        } catch (e) { /* keep fallback */ }
        cb({ frames, footPad, charH })
      }
      img.onerror = () => cb(null)
      img.src = url
    }
    // Strip the soft shadow-oval FIRST (the boss sheets are *_with_shadow), then
    // measure the cleaned sheet — so the foot/height read excludes the shadow and
    // the boss walks without a gray circle under it. wwStrip falls back to the raw
    // url on failure; a still-missing run sheet leaves e.run null (boss won't run).
    const stripAndMeasure = (rawUrl, cb) => {
      wwStrip(rawUrl, (clean) => measure(clean, (meta) => cb(meta ? { ...meta, sheet: clean } : null)))
    }
    this._bossMeta[id] = this._bossMeta[id] || {}
    stripAndMeasure(wwBossSheet(id), (mw) => {
      const e = this._bossMeta[id] || {}
      e.walk = mw || { frames: 4, footPad: fh * 0.1, charH: fh * 0.8, sheet: wwBossSheet(id) }
      this._bossMeta[id] = e
    })
    stripAndMeasure(wwBossRunSheet(id), (mr) => {
      const e = this._bossMeta[id] || {}; e.run = mr; this._bossMeta[id] = e
    })
  }

  // ─── spawn ──────────────────────────────────────────────────────────────
  _spawn(kind) {
    const id = this._bossId
    // Boss only spawns once its sheet is stripped + measured — otherwise it'd
    // briefly show the raw shadow-oval. Until then, spawn an adventurer instead.
    if (kind === 'boss' &&
        (!WW_BOSS[id] || !this._bossMeta[id]?.walk?.sheet ||
         this._walkers.some((w) => w.kind === 'boss'))) kind = 'adv'
    if (this._walkers.length >= WW_MAX) return
    const dir = Math.random() < 0.5 ? 1 : -1
    const wid = ++WW_ID
    const now = performance.now()
    let w
    if (kind === 'boss') {
      const m = WW_BOSS[id]; const fw = m[1], fh = m[2] || m[1]
      const bm = this._bossMeta[id] || {}
      const walkMeta = bm.walk
      // ~50% chance to RUN across (faster) when the run sheet is available.
      const isRun = !!(bm.run && bm.run.sheet) && Math.random() < 0.5
      const meta = isRun ? bm.run : walkMeta
      const scale = BOSS_PX / meta.charH    // size by real character height, not frame size
      w = {
        id: wid, kind: 'boss', sheet: meta.sheet,   // pre-stripped (no shadow)
        fw, fh, sheetRows: 4, scale, bframes: meta.frames, footPad: meta.footPad, dir,
        speed: (isRun ? rnd(118, 150) : rnd(52, 72)) * SCALE_K,
        bfps: isRun ? 12 : 8, yoff: rnd(0, 4), animStart: now,
      }
    } else {
      // Spawn only from the fixed per-session pool (built + pre-stripped in
      // _buildRoster) so we never decode a never-seen sheet mid-frame.
      if (!this._roster.length) this._buildRoster()
      const pick = this._roster[(Math.random() * this._roster.length) | 0]
        || { cls: this._classes[0] || 'knight', v: 1 }
      const cls = pick.cls, v = pick.v
      const scale = ADV_PX / 64
      w = {
        id: wid, kind: 'adv', sheet: wwAdvSheet(cls, v), fw: 64, fh: 64, sheetRows: ADV_ROWS,
        scale, footPad: 6, dir, mode: 'walk', walkSpeed: rnd(88, 130) * SCALE_K,
        fidget: Math.random() < 0.35, yoff: 0, animStart: now,
        nextEvt: now + rnd(2600, 6000), pauseUntil: 0,
      }
      w.speed = w.walkSpeed
    }
    w.x = dir > 0 ? -w.fw * w.scale - 20 : this._stageW + 20

    // DOM node — sprite sheet drives the ::before (dark figure) + ::after (warm
    // top light) via CSS vars; see the .qcm-ww-sprite rules in styles.css.
    const el = document.createElement('div')
    el.className = 'qcm-ww-sprite'
    el.style.width = `${w.fw * w.scale}px`
    el.style.height = `${w.fh * w.scale}px`
    el.style.bottom = `${w.yoff - (w.footPad || 0) * w.scale}px`
    el.style.setProperty('--ww-img', `url('${w.sheet}')`)
    el.style.setProperty('--ww-bgsize',
      `${(w.kind === 'boss' ? w.bframes * w.fw : ADV_SHEET_W) * w.scale}px ${w.sheetRows * w.fh * w.scale}px`)
    el.style.transform = `translateX(${w.x}px)`
    // Drop the walker if its sheet 404s rather than show a broken box.
    const probe = new Image()
    probe.onerror = () => { w._dead = true; el.remove() }
    probe.src = w.sheet
    w._el = el
    this._host.appendChild(el)

    // Adventurers get their shadow oval stripped for a clean silhouette.
    if (w.kind === 'adv') wwStrip(w.sheet, (u) => { if (w._el) w._el.style.setProperty('--ww-img', `url('${u}')`) })

    this._walkers.push(w)
  }

  // Horizontal centres (logical px) of the on-screen torches, used for the
  // walk-under lighting. Measured once from the live torch elements (so it
  // tracks the CSS), with a fallback matching the stylesheet.
  _torchCenters() {
    if (this._torchX) return this._torchX
    try {
      const els = document.querySelectorAll('.qf-cm .qcm-torch')
      const xs = []
      els.forEach(e => { if (e.offsetWidth) xs.push(e.offsetLeft + e.offsetWidth / 2) })
      this._torchX = xs.length ? xs : WW_TORCH_FALLBACK
    } catch { this._torchX = WW_TORCH_FALLBACK }
    return this._torchX
  }

  // ─── per-frame ────────────────────────────────────────────────────────
  _tick(now) {
    const dt = Math.min(60, now - this._last) / 1000; this._last = now
    const stageW = this._stageW
    const torchX = this._torchCenters()
    const dead = []
    const boss = this._walkers.find((b) => b.kind === 'boss' && !b._dead)
    for (const w of this._walkers) {
      if (w._dead) { dead.push(w.id); continue }
      let rowL, rowR, frames, fps, moving
      if (w.kind === 'boss') {
        rowL = 2; rowR = 3; frames = w.bframes; fps = w.bfps || 8; moving = true
      } else {
        // Flee from the boss: stray too close → turn away and bolt (run anim).
        if (!w.fleeing && boss) {
          const advCx = w.x + w.fw * w.scale / 2
          const bossCx = boss.x + boss.fw * boss.scale / 2
          const gap = advCx - bossCx
          const bossW = boss.fw * boss.scale
          if (Math.abs(gap) < bossW * 0.5 + 130 * SCALE_K) {
            w.fleeing = true; w.mode = 'run'
            w.dir = gap >= 0 ? 1 : -1
            w.speed = rnd(156, 198) * SCALE_K
            w.animStart = now
          }
        }
        if (w.fleeing) {
          rowL = ADV_ANIM.run.rowL; rowR = ADV_ANIM.run.rowR
          frames = ADV_ANIM.run.frames; fps = ADV_ANIM.run.fps; moving = true
        } else {
          if (w.mode === 'pause') {
            if (now >= w.pauseUntil) {
              if (Math.random() < 0.5) w.dir *= -1
              w.mode = 'walk'; w.speed = w.walkSpeed
              w.animStart = now; w.nextEvt = now + rnd(2200, 5200)
            }
          } else if (w.fidget && now >= w.nextEvt) {
            const r = Math.random()
            if (r < 0.4) { w.mode = 'pause'; w.pauseUntil = now + rnd(600, 1500); w.animStart = now }
            else if (r < 0.8) { w.dir *= -1; w.animStart = now }
            w.nextEvt = now + rnd(3000, 6500)
          }
          const set = w.mode === 'pause' ? ADV_ANIM.idle : ADV_ANIM.walk
          rowL = set.rowL; rowR = set.rowR; frames = set.frames; fps = set.fps
          moving = w.mode !== 'pause'
        }
      }
      if (moving) w.x += w.dir * w.speed * dt
      const f = Math.floor((now - w.animStart) / 1000 * fps) % frames
      const el = w._el
      if (el) {
        const row = w.dir > 0 ? rowR : rowL
        const bgpos = `-${(f * w.fw * w.scale).toFixed(1)}px -${(row * w.fh * w.scale).toFixed(1)}px`
        el.style.transform = `translateX(${w.x.toFixed(1)}px)`
        el.style.setProperty('--ww-bgpos', bgpos)
        // Organic torch lighting — the ::after warm-light layer (top-bright,
        // masked to the sprite) ramps with horizontal torch proximity. l: 0
        // (in shadow) → 1 (under a torch), eased; kept very subtle.
        const cx = w.x + w.fw * w.scale / 2
        let l = 0
        for (const tx of torchX) l = Math.max(l, 1 - Math.abs(cx - tx) / WW_LIGHT_RADIUS)
        l = l > 0 ? l * l : 0
        if (l !== w._lit) {
          w._lit = l
          el.style.setProperty('--ww-lit', (l * 0.9).toFixed(3))
        }
      }
      if ((w.x > stageW + 60 && w.dir > 0) || (w.x < -w.fw * w.scale - 60 && w.dir < 0)) {
        w._el?.remove(); dead.push(w.id)
      }
    }
    if (dead.length) this._walkers = this._walkers.filter((p) => !dead.includes(p.id))
  }
}
