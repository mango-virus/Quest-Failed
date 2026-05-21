// Throwaway: dump transparent-gutter structure of each trap sheet so we can
// figure out frame boundaries before baking them into uniform grids.
import sharp from 'sharp'
import path from 'path'

const SRC = 'D:/Documents/Game Jam Code/Quest-Failed assets/!To do/TRAPS'
const FILES = [
  'Arrow2.png', 'Bomb.png',
  'Cannon_up.png', 'Cannon_down.png', 'Cannon_left.png', 'Cannon_right.png',
  'dragon_updown.png', 'dragon_rightleft.png',
  'column_trap.png', 'plate_trap.png',
  'Rotating_blades.png',
  'trap_saw_horizontal.png', 'trap_saw_vertical.png',
]

// Compress a boolean array into runs: [{val, start, len}, ...]
function runs(arr) {
  const out = []
  let i = 0
  while (i < arr.length) {
    let j = i
    while (j < arr.length && arr[j] === arr[i]) j++
    out.push({ val: arr[i], start: i, len: j - i })
    i = j
  }
  return out
}

for (const file of FILES) {
  const img = sharp(path.join(SRC, file))
  const { width, height } = await img.metadata()
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const colHas = new Array(width).fill(false)
  const rowHas = new Array(height).fill(false)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * ch + (ch - 1)]
      if (a > 8) { colHas[x] = true; rowHas[y] = true }
    }
  }
  const colRuns = runs(colHas)
  const rowRuns = runs(rowHas)
  const colContent = colRuns.filter(r => r.val).map(r => `${r.start}+${r.len}`)
  const colGap     = colRuns.filter(r => !r.val).map(r => `${r.start}+${r.len}`)
  const rowContent = rowRuns.filter(r => r.val).map(r => `${r.start}+${r.len}`)
  const rowGap     = rowRuns.filter(r => !r.val).map(r => `${r.start}+${r.len}`)
  console.log(`\n=== ${file}  (${width}x${height}) ===`)
  console.log(`  col content blocks (${colContent.length}): ${colContent.join('  ')}`)
  console.log(`  col gaps           : ${colGap.join('  ') || '(none)'}`)
  console.log(`  row content blocks (${rowContent.length}): ${rowContent.join('  ')}`)
  console.log(`  row gaps           : ${rowGap.join('  ') || '(none)'}`)
}
