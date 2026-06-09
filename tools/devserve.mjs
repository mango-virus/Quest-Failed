// devserve — a fast, async static file server for local dev / preview.
//
// WHY THIS EXISTS: the default preview server (server.ps1) is a single-threaded
// PowerShell HttpListener. Phaser's boot loader fires hundreds of parallel asset
// requests; the single-threaded server serializes them and, under any contention
// (e.g. the preview's headless browser + a real browser tab both cold-booting),
// crawls for 20-60s or appears wedged ("stuck on Boot / ~7 textures"). Node's
// http server is async, so all those parallel fetches resolve immediately and the
// game boots in well under 10s, reliably.
//
// USAGE: `npm run serve` (or `node tools/devserve.mjs [port]`), then open
// http://localhost:<port>/ in a browser. Default port 8080; the preview launch
// config passes 8767. Serves the REPO ROOT (derived from this file's location,
// so it works no matter what cwd it's launched from). Dev only.
import http from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { extname, normalize, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// tools/devserve.mjs → repo root is the parent of tools/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv[2] || process.env.PORT) || 8080
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
}

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0])
    if (p === '/' || p.endsWith('/')) p += 'index.html'
    const abs = normalize(join(ROOT, p))
    if (!abs.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return }
    const st = await fs.stat(abs).catch(() => null)
    if (!st || !st.isFile()) { res.writeHead(404).end('not found'); return }
    res.writeHead(200, {
      // Binaries (sprites/audio) cache hard so reloads don't re-fetch; code stays
      // fresh so live edits show on reload.
      'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': /\.(png|jpe?g|gif|svg|ico|ttf|woff2?|mp3|wav|ogg|webm|mp4)$/i.test(abs)
        ? 'public, max-age=86400' : 'no-cache',
      'Access-Control-Allow-Origin': '*',
    })
    const stream = createReadStream(abs)
    stream.on('error', () => { try { res.destroy() } catch {} })
    stream.pipe(res)
  } catch (e) { try { res.writeHead(500).end(String(e)) } catch {} }
}).listen(PORT, () => console.log(`devserve up on http://localhost:${PORT}  (root: ${ROOT})`))
