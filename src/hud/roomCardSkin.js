// roomCardSkin — pure mapping from a room definition to its build-menu skin-PNG
// icon URL, or null when the room has no skin (those cards render blank). No DOM
// or Phaser deps, so it is unit-testable headless (tools/sim/room-card-skin-check.mjs).

export function roomCardSkinSrc(def) {
  const skin = def && typeof def.backgroundImage === 'string' ? def.backgroundImage : null
  return skin ? `assets/themes/roomskins/${skin}.png` : null
}
