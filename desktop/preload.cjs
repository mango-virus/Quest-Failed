// Preload — runs in an isolated context with limited Node access, bridges a tiny,
// safe surface to the game's window. Phase 1 only exposes a marker so game code
// can detect it's running on desktop (and later branch save/leaderboard logic to
// Steam). Steamworks IPC is added here in Phase 2.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('__desktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
})
