// SoundCustom — IndexedDB store for custom uploaded SFX (the Sound Studio's
// "swap in your own file" feature). Blobs persist across reloads; on boot they're
// hydrated back into the Phaser audio cache under `sfx-custom-<fileKey>` keys so a
// trigger whose override points at a custom sound keeps playing it. See SOUND_STUDIO.md.

const DB_NAME = 'qf-sound'
const STORE   = 'custom'
const VERSION = 1

function _db() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'))
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export function customKeyFor(fileKey) { return 'sfx-custom-' + fileKey }

export async function putBlob(fileKey, blob) {
  const db = await _db()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, fileKey)
    tx.oncomplete = () => res(true)
    tx.onerror    = () => rej(tx.error)
  })
}

export async function getAllBlobs() {
  const db = await _db()
  return new Promise((res) => {
    const out = []
    const tx = db.transaction(STORE, 'readonly')
    const cur = tx.objectStore(STORE).openCursor()
    cur.onsuccess = (e) => { const c = e.target.result; if (c) { out.push({ fileKey: c.key, blob: c.value }); c.continue() } else res(out) }
    cur.onerror = () => res(out)
  })
}

export async function removeBlob(fileKey) {
  try {
    const db = await _db()
    return new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(fileKey)
      tx.oncomplete = () => res(true)
      tx.onerror    = () => res(false)
    })
  } catch { return false }
}

// Load a blob into `scene`'s Phaser audio cache under customKeyFor(fileKey).
// Re-loadable (removes an existing same-key entry first). cb(ok) when done.
export function loadIntoCache(scene, fileKey, blob, cb) {
  if (!scene || !scene.load || !blob) { cb && cb(false); return }
  const key = customKeyFor(fileKey)
  try { if (scene.cache?.audio?.exists?.(key)) scene.cache.audio.remove(key) } catch {}
  let url
  try { url = URL.createObjectURL(blob) } catch { cb && cb(false); return }
  const done = (ok) => { try { URL.revokeObjectURL(url) } catch {} ; cb && cb(ok) }
  scene.load.once('filecomplete-audio-' + key, () => done(true))
  scene.load.once('loaderror', () => done(false))
  try { scene.load.audio(key, url); scene.load.start() } catch { done(false) }
}

// On boot: pull every stored custom blob into the cache so persisted overrides
// keep playing. Safe to call repeatedly (per-scene) and on browsers w/o IDB.
export async function hydrateCustomSounds(scene) {
  if (typeof indexedDB === 'undefined' || !scene?.load) return
  try {
    const all = await getAllBlobs()
    for (const { fileKey, blob } of all) loadIntoCache(scene, fileKey, blob)
  } catch {}
}
