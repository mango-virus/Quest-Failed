// Quest Failed — Electron desktop shell (Phase 1: offline-capable wrapper).
//
// GOAL: run the EXISTING static web game as a double-clickable desktop app,
// fully offline, WITHOUT modifying the web build (index.html et al. stay as-is).
//
// HOW IT WORKS:
//   1. The whole game directory (the parent of desktop/) is served over a custom
//      `app://qf/` scheme. Registering it as a *standard + secure* scheme is what
//      makes ES modules (`<script type="module">`) load and what makes
//      localStorage / IndexedDB persist to disk per-origin across launches — so
//      the game's existing localStorage saves "just work" and survive restarts.
//   2. index.html still has `<script src="https://cdn.jsdelivr.net/...phaser...">`.
//      We intercept https and serve the vendored copy in desktop/vendor/phaser.min.js
//      instead, so the engine boots with zero network. Everything else https
//      (leaderboard, fonts) passes straight through when online and
//      degrades gracefully when offline (the game already has fallbacks).
//
// Phase 2 (separate): steamworks.js — achievements, Steam Cloud saves, leaderboards.
// Phase 3 (separate): electron-builder packaging + code signing + Steam depot upload.

const { app, BrowserWindow, protocol, net, Menu, shell, ipcMain } = require('electron')
const path = require('node:path')

// Let each monitor render at its true device pixel ratio so text/UI rasterize at
// the screen's native resolution (crisp). The DOM HUD is laid out fluidly at the
// window's real size (no fixed-1920 buffer scaled to fit), so there is no
// non-integer-scale blur to compensate for. Must be set before app 'ready'.
app.commandLine.appendSwitch('high-dpi-support', '1')
const fs = require('node:fs')
const { Readable } = require('node:stream')
const { pathToFileURL } = require('node:url')

// The game's static files live one level up from this desktop/ folder.
const GAME_ROOT = path.join(__dirname, '..')
const PHASER_LOCAL = path.join(__dirname, 'vendor', 'phaser.min.js')
const FONTS_CSS_LOCAL = path.join(__dirname, 'vendor', 'fonts.css')

// The single logical origin for the app. host = "qf" → app://qf/index.html.
const APP_SCHEME = 'app'
const APP_HOST = 'qf'

const MIME = {
  '.html': 'text/html', '.htm': 'text/html',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
}

// A custom scheme must be declared privileged BEFORE app "ready". `standard`
// gives it a real origin (so relative URLs + localStorage partitioning work),
// `secure` lets it run as a secure context (modules, crypto), and the rest
// enable fetch/XHR and HTTP-range streaming for audio/video.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
])

// Stream a local file as a web Response with an explicit MIME type. Streaming
// (rather than readFile) keeps large audio/video off the heap, and the explicit
// content-type matters: ES modules are rejected unless served as a JS MIME type.
function serveFile(absPath, contentTypeOverride) {
  const ext = path.extname(absPath).toLowerCase()
  const type = contentTypeOverride || MIME[ext] || 'application/octet-stream'
  const stream = fs.createReadStream(absPath)
  // Convert Node stream → web ReadableStream for the Response body.
  // `cache-control: no-store` keeps Chromium from caching ES modules served
  // over app://, so an in-app reload always picks up live src/ edits (the game
  // is served straight from the source tree — see GAME_ROOT). Re-reading local
  // files per load is negligible; correctness of the dev/reload loop matters more.
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      'content-type': type,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  })
}

function registerProtocols() {
  // app://qf/<path>  →  GAME_ROOT/<path>
  protocol.handle(APP_SCHEME, (request) => {
    let rel
    try { rel = decodeURIComponent(new URL(request.url).pathname) }
    catch { return new Response('bad request', { status: 400 }) }
    if (rel === '/' || rel.endsWith('/')) rel += 'index.html'
    const abs = path.normalize(path.join(GAME_ROOT, rel))
    // Path-traversal guard: never serve anything outside the game directory.
    if (abs !== GAME_ROOT && !abs.startsWith(GAME_ROOT + path.sep)) {
      return new Response('forbidden', { status: 403 })
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return new Response('not found', { status: 404 })
    }
    return serveFile(abs)
  })

  // Intercept https so the Phaser CDN tag resolves to the vendored local copy
  // (offline boot). Everything else passes through to the real network.
  protocol.handle('https', (request) => {
    const u = new URL(request.url)
    if (u.hostname === 'cdn.jsdelivr.net' && /\/phaser(@|\/|\.)/i.test(u.pathname)) {
      console.log('[desktop] serving Phaser from local vendor (offline):', PHASER_LOCAL)
      return serveFile(PHASER_LOCAL, 'text/javascript')
    }
    // Google Fonts CSS → local vendored copy (its url()s point at app://qf/.../fonts/*.woff2,
    // served by the app handler). This is what makes fonts render with no network.
    if (u.hostname === 'fonts.googleapis.com' && u.pathname.startsWith('/css')) {
      console.log('[desktop] serving Google Fonts CSS from local vendor (offline)')
      return serveFile(FONTS_CSS_LOCAL, 'text/css')
    }
    // bypassCustomProtocolHandlers avoids re-entering this very handler.
    return net.fetch(request, { bypassCustomProtocolHandlers: true })
  })
}

// Resolve a renderer-supplied relative path to an absolute path inside the game
// root, or null if it would escape (same traversal guard the app:// handler uses).
function resolveInRoot(relPath) {
  const abs = path.normalize(path.join(GAME_ROOT, String(relPath || '')))
  if (abs !== GAME_ROOT && !abs.startsWith(GAME_ROOT + path.sep)) return null
  return abs
}

// Project-tree file bridge for the editor scenes (see preload.cjs). Replaces the
// browser File System Access API, which Electron doesn't wire up for app://. All
// writes are confined to the game root by resolveInRoot(); this is a local dev/
// editor capability, consistent with the app:// handler already serving the tree.
function registerFsBridge() {
  // Synchronous root-name lookup for the preload's one-time display string.
  ipcMain.on('qf:rootName', (e) => { e.returnValue = path.basename(GAME_ROOT) })

  ipcMain.handle('qf:writeFile', async (_e, relPath, data) => {
    const abs = resolveInRoot(relPath)
    if (!abs) return { ok: false, error: 'path escapes project root' }
    try {
      await fs.promises.mkdir(path.dirname(abs), { recursive: true })
      const buf = typeof data === 'string'
        ? Buffer.from(data, 'utf8')
        : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : (data ?? []))
      await fs.promises.writeFile(abs, buf)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) }
    }
  })

  ipcMain.handle('qf:readFile', async (_e, relPath) => {
    const abs = resolveInRoot(relPath)
    if (!abs) return null
    try { return await fs.promises.readFile(abs) } catch { return null }
  })

  ipcMain.handle('qf:listDir', async (_e, relPath) => {
    const abs = resolveInRoot(relPath)
    if (!abs) return null
    try { return await fs.promises.readdir(abs) } catch { return null }
  })
}

function createWindow() {
  const win = new BrowserWindow({
    // The game renders at the window's native resolution (the canvas via Phaser
    // Scale.RESIZE, the DOM HUD via a fluid layout), so it stays crisp at ANY size
    // or aspect — the window is freely resizable/maximizable with no sharpness
    // trade-off. A 1600×900 default content area is a comfortable windowed size;
    // the player can resize or go fullscreen (F11) freely.
    useContentSize: true,
    width: 1600,
    height: 900,
    center: true,
    minWidth: 1024,
    minHeight: 576,
    backgroundColor: '#0b0a0f', // dark, matches the Crypt theme — no white flash
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // never throttle the render loop when unfocused
    },
  })

  win.once('ready-to-show', () => win.show())
  win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`)

  // Open external links in the OS browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'deny' }
  })

  return win
}

function buildMenu() {
  // Minimal menu: a View menu with fullscreen + reload + devtools. autoHideMenuBar
  // keeps it out of the way (Alt reveals it); the accelerators work regardless.
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'togglefullscreen' }, // F11 (Windows/Linux), Ctrl+Cmd+F (mac)
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'quit' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Single-instance: focus the existing window instead of opening a second.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWin = null
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus() }
  })

  app.whenReady().then(() => {
    registerProtocols()
    registerFsBridge()
    buildMenu()
    mainWin = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
