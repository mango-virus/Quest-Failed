// Procedural handles for the Cheater class — generates names that read
// as "online gamer with too much time on their hands": leetspeak +
// number suffixes + edgy adjective combos. Replaces the random
// adventurer-name roll so a Cheater shows up labelled like
// "xX_d4rk_l0rd_Xx" instead of "Aldric the Bold".
//
// Generation: pick a template, fill with random words / numbers,
// optionally wrap in xX_ ... _Xx. Deterministic per call (no save-stable
// seed needed — the result is stamped onto adv.name at spawn and never
// re-rolled).

const ADJ = [
  'd4rk', 'pr0', 'leet', 'sneaky', 'shadow', 'cracked', 'salty', 'toxic',
  'sweaty', 'tilted', 'cursed', 'epic', 'godlike', 'ultra', 'mega', 'legit',
  '420', 'noob', 'tryhard', 'sus', 'cringe', 'based', 'kek', 'gigachad',
]
const NOUN = [
  'l0rd', 'killer', 'g0d', 'slayer', 'sn1per', 'h4xx0r', 'm4ster', 'b0ss',
  'reaper', 'demon', 'ghost', 'wraith', 'angel', 'goblin', 'wizard', 'knight',
  'ninja', 'samurai', 'gamer', 'streamer', 'shadow', 'fury', 'storm', 'doom',
]
const SUFFIXES = ['', '69', '420', '99', '420', '666', '777', '1337', '420', '69', '88']
const PREFIXES = ['xX_', 'xx_', '', '', '', 'pr0_', '_', 'iAm', 'No_', '']
const POSTFIXES = ['_Xx', '_xx', '', '', '', '_pr0', '_yt', '_ttv', '']

// Hand-picked "memes" that pop in once in a while — bypasses the
// templated leet-speak for variety. Kept short so they read at a glance
// in the dungeon log.
const HAND_CRAFTED = [
  'totallylegit', 'AimGod', 'n0sc0pe', 'WallHax', 'TeleportKing',
  'BannedAgain', 'CtrlAltDelete', 'RageQuit', 'OneShotOnly', 'DesyncQueen',
  'NotCheating', 'KeyboardCowboy', 'PingMaster', 'LagSwitch',
]

function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateCheaterName() {
  // 25% chance to use a hand-crafted handle for variety.
  if (Math.random() < 0.25) return _pick(HAND_CRAFTED)
  // Templated leet-speak handle.
  const adj  = _pick(ADJ)
  const noun = _pick(NOUN)
  const num  = _pick(SUFFIXES)
  const pre  = _pick(PREFIXES)
  const post = _pick(POSTFIXES)
  return `${pre}${adj}_${noun}${num}${post}`
}
