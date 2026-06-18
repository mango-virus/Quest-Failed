#!/usr/bin/env node
// phaser-changelog-search.mjs
// ----------------------------------------------------------------------------
// "Is this a known Phaser bug fixed in a later version?" — answer it in ~30s
// instead of an afternoon of code-spelunking.
//
// Fetches the official Phaser changelogs (github.com/phaserjs/phaser) for every
// version NEWER than the one we currently ship and greps them for keywords.
// First run downloads + caches the changelog markdown under tools/.cache/ so
// every run after that is instant + offline.
//
// USAGE
//   node tools/phaser-changelog-search.mjs <keyword> [<keyword> ...]
//   node tools/phaser-changelog-search.mjs resize "render target" postfx
//   node tools/phaser-changelog-search.mjs scroll --from 3.60 --to 3.90
//   node tools/phaser-changelog-search.mjs --list                 # just list versions
//   node tools/phaser-changelog-search.mjs camera --refresh       # bust the cache
//
// Keywords are OR'd and matched case-insensitively as substrings (or pass a
// /regex/ token for a real regex). --from defaults to the phaser@x.y.z version
// pinned in index.html; --to defaults to the newest changelog available.
//
// WHY THIS EXISTS: the boss-sprite-displaces-on-resize bug (2026-06-18) was a
// Phaser 3.60 engine bug (PostFX render target not resizing with the canvas,
// fixed in 3.70 #6503). We burned hours on game-code workarounds before
// suspecting the engine. Run this FIRST when a render/scale/input/audio bug is
// weird, isolated, and not obviously our code.
// ----------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(__dirname, '.cache', 'phaser-changelogs')
// Phaser keeps two changelog trees: v3 (the stable 3.x line, drop-in compatible)
// and v4 (a MAJOR rewrite — new renderer + breaking API changes; a migration, not
// a bump). We scan both. `latest` on npm currently points at 4.x.
const TREE = (ver) => (parseVer(ver)[0] >= 4 ? 'v4' : 'v3')
const RAW = (ver) => `https://raw.githubusercontent.com/phaserjs/phaser/master/changelog/${TREE(ver)}/${ver}/CHANGELOG-v${ver}.md`
const API_DIR = (tree) => `https://api.github.com/repos/phaserjs/phaser/contents/changelog/${tree}`
const API_FOLDER = (ver) => `https://api.github.com/repos/phaserjs/phaser/contents/changelog/${TREE(ver)}/${ver}`

// --- arg parsing ------------------------------------------------------------
const argv = process.argv.slice(2)
const flags = { from: null, to: null, refresh: false, list: false }
const keywords = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--from') flags.from = argv[++i]
  else if (a === '--to') flags.to = argv[++i]
  else if (a === '--refresh') flags.refresh = true
  else if (a === '--list') flags.list = true
  else if (a === '-h' || a === '--help') { printHelp(); process.exit(0) }
  else keywords.push(a)
}

function printHelp() {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 26).join('\n').replace(/^\/\/ ?/gm, ''))
}

// --- version helpers --------------------------------------------------------
// Parse "3.88.2" -> [3,88,2]; compare numerically, missing parts = 0.
const parseVer = (v) => v.split('.').map(n => parseInt(n, 10) || 0)
function cmpVer(a, b) {
  const pa = parseVer(a), pb = parseVer(b)
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d }
  return 0
}

// Read the pinned phaser version from index.html (source of truth for what we ship).
function shippedVersion() {
  try {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8')
    const m = html.match(/phaser@(\d+\.\d+(?:\.\d+)?)/i)
    if (m) return m[1]
  } catch {}
  return '3.60.0'
}

async function listVersions() {
  const cacheFile = path.join(CACHE_DIR, '_versions.json')
  if (!flags.refresh && fs.existsSync(cacheFile)) {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch {}
  }
  const all = []
  for (const tree of ['v3', 'v4']) {
    const res = await fetch(API_DIR(tree), { headers: { 'User-Agent': 'qf-changelog-tool', 'Accept': 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`GitHub API ${res.status} listing ${tree} changelog versions (rate-limited? try again in a bit, or use a cached run)`)
    const json = await res.json()
    // Keep only dir entries that are a plain version number — skips 'assets',
    // pre-releases ('4.0-rc') and placeholders ('4.NEXT').
    all.push(...json.filter(e => e.type === 'dir' && /^\d+\.\d+(\.\d+)?$/.test(e.name)).map(e => e.name))
  }
  all.sort(cmpVer)
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(cacheFile, JSON.stringify(all, null, 0))
  return all
}

async function getChangelog(ver) {
  const cacheFile = path.join(CACHE_DIR, `${ver}.md`)
  if (!flags.refresh && fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8')
  // Fast path: the v3 line names its file CHANGELOG-v<folder>.md, so the raw URL
  // is predictable. v4 folders are major.minor ("4.1") but the file is the full
  // version ("CHANGELOG-v4.1.0.md") — so on a 404 we ask the API for the folder's
  // real .md filename and fetch that.
  let res = await fetch(RAW(ver), { headers: { 'User-Agent': 'qf-changelog-tool' } })
  if (!res.ok) {
    const dir = await fetch(API_FOLDER(ver), { headers: { 'User-Agent': 'qf-changelog-tool', 'Accept': 'application/vnd.github+json' } })
    if (!dir.ok) return null
    const entries = await dir.json()
    const md = entries.find(e => /^CHANGELOG-v.*\.md$/i.test(e.name))
    if (!md?.download_url) return null
    res = await fetch(md.download_url, { headers: { 'User-Agent': 'qf-changelog-tool' } })
    if (!res.ok) return null
  }
  const text = await res.text()
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(cacheFile, text)
  return text
}

// Build matchers: a bare token = case-insensitive substring; /re/ = regex.
function buildMatchers(words) {
  return words.map(w => {
    const re = w.match(/^\/(.*)\/([a-z]*)$/)
    if (re) return new RegExp(re[1], (re[2] || '') + (re[2].includes('i') ? '' : 'i'))
    return new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  })
}

// Walk a changelog, tracking the nearest "## Heading" so each hit shows its
// section (Bug Fixes / Updates / etc). Returns [{section, line}].
function searchText(text, matchers) {
  const out = []
  let section = ''
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const h = line.match(/^#{1,4}\s+(.*)/)
    if (h) { section = h[1].trim(); continue }
    if (!line.trim()) continue
    if (matchers.some(m => m.test(line))) out.push({ section, line: line.replace(/^\s*[-*]\s*/, '').trim() })
  }
  return out
}

// --- main -------------------------------------------------------------------
const ANSI = process.stdout.isTTY
const c = (s, code) => ANSI ? `\x1b[${code}m${s}\x1b[0m` : s

async function main() {
  const shipped = shippedVersion()
  let versions = await listVersions()

  if (flags.list) {
    console.log(c(`Phaser changelogs available (${versions.length}, v3 + v4):`, 1))
    console.log(versions.join('  '))
    console.log(c(`\nWe ship: phaser@${shipped} (from index.html)`, 36))
    return
  }

  if (!keywords.length) { printHelp(); process.exit(1) }

  const from = flags.from || shipped
  const to = flags.to || versions[versions.length - 1]
  // Inclusive of `to`, EXCLUSIVE of `from` (we want what's NEWER than shipped).
  const inRange = versions.filter(v => cmpVer(v, from) > 0 && cmpVer(v, to) <= 0)

  console.log(c(`Searching Phaser changelogs ${from} → ${to}  (${inRange.length} versions, newer than shipped)`, 1))
  console.log(c(`Keywords: ${keywords.join('  |  ')}`, 36))
  if (inRange.some(v => parseVer(v)[0] >= 4)) {
    console.log(c('⚠ Range includes Phaser 4.x — a MAJOR rewrite (new renderer + breaking API), NOT a drop-in bump.', '1;31'))
    console.log(c('  A fix that only appears under a v4.x heading is not available via a 3.x upgrade — it would', 31))
    console.log(c('  need a local patch or a planned v4 migration. See changelog/v4/4.0/MIGRATION-GUIDE.md.', 31))
  }
  console.log('')

  const matchers = buildMatchers(keywords)
  let total = 0
  // Newest first — most relevant fixes surface at the top.
  for (const ver of [...inRange].reverse()) {
    const text = await getChangelog(ver)
    if (!text) continue
    const hits = searchText(text, matchers)
    if (!hits.length) continue
    total += hits.length
    const major4 = parseVer(ver)[0] >= 4
    console.log(c(`── v${ver} ──${major4 ? '  (4.x — major rewrite, not a drop-in)' : ''}`, major4 ? '1;31' : '1;33'))
    for (const h of hits) {
      const tag = /fix/i.test(h.section) ? c('[fix]', 32) : c(`[${h.section || '?'}]`, 90)
      console.log(`  ${tag} ${h.line}`)
    }
    console.log('')
  }
  if (!total) console.log(c('No matches. Try broader keywords, or --refresh to re-pull changelogs.', 90))
  else console.log(c(`${total} matching entries across ${inRange.length} versions.`, 1))
  console.log(c(`Cache: ${path.relative(REPO_ROOT, CACHE_DIR)}  (delete or --refresh to re-pull)`, 90))
}

main().catch(e => { console.error(c('Error: ' + e.message, 31)); process.exit(1) })
