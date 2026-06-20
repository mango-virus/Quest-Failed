// File System Access API wrapper for editor scenes that write back to the
// project folder.  The browser doesn't allow direct FS writes, so the user
// has to grant a folder handle once via showDirectoryPicker(); we then keep
// that handle in IndexedDB so the next reload can pick it up without another
// prompt (the permission still has to be re-granted with a click — browsers
// do not let us write silently across reloads).
//
// Public API:
//   FsHandle.isSupported()                  → boolean
//   await FsHandle.acquireRoot()            → FileSystemDirectoryHandle | null
//                                             prompts the user once and stores
//                                             the handle; returns null on
//                                             cancel / unsupported / denied.
//   await FsHandle.tryRestoreRoot()         → handle | null
//                                             pulls the cached handle from
//                                             IndexedDB and re-asks for write
//                                             permission silently if granted.
//   await FsHandle.writeFile(path, blob)    → writes a Blob to <root>/<path>,
//                                             creating directories as needed.
//   await FsHandle.readFile(path)           → File | null
//   await FsHandle.listDir(path)            → string[] | null  (file names)
//   FsHandle.clear()                        → drop the cached handle.
//
// Path strings use forward slashes ("assets/themes/foo/manifest.json").
// Editor scenes call acquireRoot() lazily — only when the user hits Save.

const DB_NAME    = 'questFailed.fsHandle'
const STORE_NAME = 'handles'
const KEY_ROOT   = 'projectRoot'

let _root = null      // cached FileSystemDirectoryHandle for this session

// ── Desktop (Electron) bridge ───────────────────────────────────────────────
// On the Electron desktop build the browser File System Access API picker isn't
// available (Electron doesn't implement showDirectoryPicker for the app:// scheme
// — it throws with no dialog). The desktop shell instead exposes a direct project-
// tree file bridge on window.__desktop (see desktop/preload.cjs + main.js). When
// present we route all reads/writes through it and skip the folder-grant flow
// entirely — the game IS served from the project tree, so there's nothing to pick.
function _desktopFs() {
  return (typeof window !== 'undefined'
    && window.__desktop?.isDesktop === true
    && typeof window.__desktop.writeFile === 'function')
    ? window.__desktop
    : null
}
const DESKTOP_ROOT = { _desktop: true }   // truthy sentinel returned by acquireRoot()

// ── IndexedDB tiny wrapper ─────────────────────────────────────────────────
function _openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function _idbGet(key) {
  const db = await _openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function _idbSet(key, value) {
  const db = await _openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

async function _idbDel(key) {
  const db = await _openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

// ── Permission + root acquisition ──────────────────────────────────────────
async function _ensureWritePermission(handle) {
  if (!handle?.queryPermission) return false
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted')   return true
  if ((await handle.requestPermission(opts)) === 'granted') return true
  return false
}

async function _navigatePath(path, { create }) {
  if (!_root) return null
  const parts = path.split('/').filter(Boolean)
  const fileName = parts.pop()
  let dir = _root
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create })
  }
  return { dir, fileName }
}

export const FsHandle = {
  isSupported() {
    return !!_desktopFs()
        || (typeof window !== 'undefined'
            && typeof window.showDirectoryPicker === 'function')
  },

  hasRoot() { return _desktopFs() ? true : !!_root },

  rootName() {
    const d = _desktopFs()
    if (d) return d.rootName || 'project (desktop)'
    return _root?.name ?? null
  },

  // Validate the picked folder looks like the Quest-Failed project root —
  // it should contain `src/` and `assets/` subfolders. Surfaces a warning
  // to the user if not, so a misplaced pick (like the sibling
  // "Quest-Failed assets/" folder) gets caught before files land in the
  // wrong tree. Returns true to proceed, false to abort.
  async _validateRoot(handle) {
    let hasSrc = false, hasAssets = false
    try {
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === 'directory') {
          if (name === 'src')    hasSrc = true
          if (name === 'assets') hasAssets = true
        }
      }
    } catch (_) { return true } // if we can't enumerate, allow and let writes fail loudly later
    if (hasSrc && hasAssets) return true
    const missing = [
      hasSrc    ? null : 'src/',
      hasAssets ? null : 'assets/',
    ].filter(Boolean).join(' + ')
    return window.confirm(
      `The folder "${handle.name}" is missing ${missing}. ` +
      `It probably isn't the Quest-Failed project root.\n\n` +
      `Save here anyway? (Cancel to pick a different folder.)`
    )
  },

  // First-time prompt OR re-prompt if cached handle lost write permission.
  async acquireRoot() {
    // Desktop: writes go straight to the project tree — no folder grant needed.
    if (_desktopFs()) return DESKTOP_ROOT
    if (!this.isSupported()) return null
    try {
      // Prefer existing handle if user already granted this session
      if (_root && await _ensureWritePermission(_root)) return _root
      const handle = await window.showDirectoryPicker({
        id: 'questFailedProjectRoot',
        mode: 'readwrite',
        startIn: 'documents',
      })
      if (!await _ensureWritePermission(handle)) return null
      if (!await this._validateRoot(handle)) return null
      _root = handle
      try { await _idbSet(KEY_ROOT, handle) } catch (_) {} // best-effort cache
      return _root
    } catch (err) {
      // user cancelled the picker, or browser denied — surface as null
      console.warn('[FsHandle] acquireRoot:', err?.message || err)
      return null
    }
  },

  // Pull the cached handle on app start; only returns it if permission is
  // still granted silently (no prompt).  Caller should fall back to
  // acquireRoot() on user save action if this returns null.
  async tryRestoreRoot() {
    if (_desktopFs()) return DESKTOP_ROOT
    if (!this.isSupported()) return null
    try {
      const cached = await _idbGet(KEY_ROOT)
      if (!cached?.queryPermission) return null
      if ((await cached.queryPermission({ mode: 'readwrite' })) !== 'granted') return null
      _root = cached
      return _root
    } catch (_) {
      return null
    }
  },

  async writeFile(path, blob) {
    const d = _desktopFs()
    if (d) {
      // Strings pass through as text; everything else (Blob/File/ArrayBuffer) is
      // sent as raw bytes and written verbatim by the main process.
      const data = (typeof blob === 'string') ? blob
        : (blob instanceof Blob) ? await blob.arrayBuffer()
        : blob
      const res = await d.writeFile(path, data)
      if (!res?.ok) throw new Error(`[FsHandle] desktop write failed: ${res?.error || 'unknown'}`)
      return
    }
    if (!_root) throw new Error('[FsHandle] no root — call acquireRoot() first')
    const { dir, fileName } = await _navigatePath(path, { create: true })
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable   = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
  },

  async writeText(path, text) {
    return this.writeFile(path, new Blob([text], { type: 'text/plain' }))
  },

  async writeJson(path, obj) {
    return this.writeText(path, JSON.stringify(obj, null, 2))
  },

  async readFile(path) {
    const d = _desktopFs()
    if (d) {
      const bytes = await d.readFile(path)   // Uint8Array | null
      return bytes ? new Blob([bytes]) : null
    }
    if (!_root) return null
    try {
      const { dir, fileName } = await _navigatePath(path, { create: false })
      const fileHandle = await dir.getFileHandle(fileName, { create: false })
      return await fileHandle.getFile()
    } catch (_) {
      return null
    }
  },

  async readText(path) {
    const f = await this.readFile(path)
    return f ? await f.text() : null
  },

  async readJson(path) {
    const t = await this.readText(path)
    if (t == null) return null
    try { return JSON.parse(t) } catch (_) { return null }
  },

  async listDir(path) {
    const d = _desktopFs()
    if (d) return await d.listDir(path)   // string[] | null
    if (!_root) return null
    try {
      const parts = path.split('/').filter(Boolean)
      let dir = _root
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: false })
      const names = []
      for await (const [name] of dir.entries()) names.push(name)
      return names
    } catch (_) {
      return null
    }
  },

  async clear() {
    _root = null
    try { await _idbDel(KEY_ROOT) } catch (_) {}
  },

  // Fallback for browsers without FS Access API: trigger a download instead.
  // Editor scenes use this when isSupported() is false so the user at least
  // gets the file and can drop it into the project manually.
  downloadFallback(path, blob) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = path.split('/').pop() || 'file'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  },
}
