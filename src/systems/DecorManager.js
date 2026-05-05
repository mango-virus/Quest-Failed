// Global decoration sprite registry.
// Decor sprites are user-uploaded PNGs saved to assets/sprites/decor/.
// Manifest: assets/sprites/decor/manifest.json → [{id, file}]
// Texture key convention (Phaser): `decor-${id}`

export const DECOR_TEXTURE_KEY    = (id) => `decor-${id}`
export const DECOR_MANIFEST_PATH  = 'assets/sprites/decor/manifest.json'

const _sprites = []   // ordered list
const _byId    = new Map()

export class DecorManager {
  static load(manifest) {
    if (!Array.isArray(manifest)) return
    for (const entry of manifest) {
      if (!entry?.id || !entry?.file) continue
      if (_byId.has(entry.id)) continue
      const s = { id: entry.id, file: entry.file }
      _sprites.push(s)
      _byId.set(entry.id, s)
    }
  }

  static listSprites() { return [..._sprites] }

  static getSprite(id) { return _byId.get(id) ?? null }

  static hasSprite(id) { return _byId.has(id) }

  // Add a sprite entry (called after upload). Returns the new entry.
  static addSprite(id, file) {
    if (_byId.has(id)) {
      _byId.get(id).file = file   // update file path on re-upload
      return _byId.get(id)
    }
    const s = { id, file }
    _sprites.push(s)
    _byId.set(id, s)
    return s
  }

  static removeSprite(id) {
    const idx = _sprites.findIndex(s => s.id === id)
    if (idx !== -1) _sprites.splice(idx, 1)
    _byId.delete(id)
  }

  // Serialise to the manifest format.
  static toManifest() {
    return _sprites.map(s => ({ id: s.id, file: s.file }))
  }

  static clear() { _sprites.length = 0; _byId.clear() }
}
