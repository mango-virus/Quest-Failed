// Preload — runs in an isolated context with limited Node access, bridges a tiny,
// safe surface to the game's window. Exposes a desktop marker (so game code can
// detect it's running on desktop and branch save/leaderboard logic to Steam) plus
// a direct project-tree file bridge for the editor scenes.
//
// Why the file bridge: the editor's "Save to disk" normally uses the browser File
// System Access API (showDirectoryPicker). Electron does NOT implement that picker
// under the custom app:// scheme — the call throws with no dialog ("Folder not
// granted"). But the desktop shell already serves the game straight from the
// source tree, so here we let the renderer write back into that same tree via
// Node fs in the main process (path-guarded to the project root). No picker needed.
// Steamworks IPC is added here in Phase 2.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__desktop', {
  isDesktop: true,
  platform: process.platform,
  // Display name for the editor's "saving to <folder>" UI. Resolved once, synchronously,
  // at preload time (the main handler is registered before the window loads).
  rootName: ipcRenderer.sendSync('qf:rootName'),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // Project-tree file IO, all paths relative to the game root (e.g.
  // "assets/themes/manifest.json"). writeFile data is a string (text/JSON) or an
  // ArrayBuffer (binary, e.g. PNG bytes). Each resolves { ok, error? } / bytes / names.
  writeFile: (relPath, data) => ipcRenderer.invoke('qf:writeFile', relPath, data),
  readFile:  (relPath)       => ipcRenderer.invoke('qf:readFile', relPath),
  listDir:   (relPath)       => ipcRenderer.invoke('qf:listDir', relPath),
})
