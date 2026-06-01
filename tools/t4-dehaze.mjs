// Re-import the hand-authored T4 sheets from their SOURCE and strip the flat
// alpha-36 background haze: alpha <= THRESHOLD -> fully transparent. THRESHOLD
// sits just above the haze (36) and well below the drop-shadow (81+) and any
// death/dissolve fade (kept >= 41), so it's lossless to sprite + shadow + VFX.
import sharp from 'sharp'
import { promises as fs } from 'fs'
const SRC = 'D:/Documents/Game Jam Code/Quest-Failed assets/!To do/boss tiers'
const THRESHOLD = 40
const STATES = ['idle','walk','run','attack','hurt','death']
const FOLDER = { beholder:'Beholder4', demon:'Demon4', gnoll:'Gnoll4', golem:'Golem4',
  lich:'Lich4', lizardman:'Lizardman4', myconid:'Mushroom4', orc:'Orc4', slime:'Slime4',
  vampire:'Vampires4', wraith:'Ghost? Wraith4' }
FOLDER.wraith = 'Wraith4'
// pick the shortest filename in `dir` matching *_<state>_with_shadow.png (ci)
async function pick(dir, state){
  const files = await fs.readdir(dir)
  const re = new RegExp(`_${state}_with_shadow\.png$`, 'i')
  const m = files.filter(f => re.test(f)).sort((a,b)=>a.length-b.length)
  return m[0] ? `${dir}/${m[0]}` : null
}
let done=0, info=[]
for (const [id, folder] of Object.entries(FOLDER)) {
  const dir = `${SRC}/${folder}`
  for (const st of STATES) {
    const sp = await pick(dir, st)
    if (!sp) { info.push(`MISSING src ${id} ${st}`); continue }
    const { data, info: meta } = await sharp(sp).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let haze=0, fade=0
    for (let i=0;i<data.length;i+=4){ const a=data[i+3]
      if (a<=THRESHOLD){ data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0; if(a>0)haze++ }
      else if (a<=80) fade++ }
    await sharp(data,{raw:{width:meta.width,height:meta.height,channels:4}}).png().toFile(`assets/sprites/${id}/${id}-t4-${st}.png`)
    done++
  }
}
console.log(`re-imported + de-hazed ${done} T4 sheets at threshold <=${THRESHOLD}`)
if(info.length) console.log(info.join('\n'))
