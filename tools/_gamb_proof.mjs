import sharp from 'sharp';import fs from 'node:fs';import path from 'node:path';
const OUT='assets/sprites/adventurers';
const layout=JSON.parse(fs.readFileSync(path.join(OUT,'layout.json'),'utf8'));
const man=JSON.parse(fs.readFileSync(path.join(OUT,'manifest.json'),'utf8'));
const L=man.variants.gambler;const F=layout.frame;
const walk=layout.rows.find(r=>r.anim==='walk');const DIRS={up:0,left:1,down:2,right:3};
const find=(pred)=>L.find(pred);
// representative spread
const picks=[
  find(v=>v.mode==='coat'&&v.torsoOverlay==='Frock coat lapel'&&v.weapon==='Cane'),
  find(v=>v.mode==='coat'&&v.headwear==='Formal Tophat'&&v.weapon==='Rapier'),
  find(v=>v.mode==='coat'&&v.torsoOverlay==='Frock collar'),
  find(v=>v.mode==='vest'&&v.weapon==='Cane'&&v.headwear==='Formal Tophat'),
  find(v=>v.mode==='vest'&&v.headwear==='Formal Bowler Hat'),
  find(v=>v.mode==='vest'&&v.weapon==='Rapier'),
  find(v=>(v.body||v.bodyType)==='female'&&v.mode==='coat'),
  find(v=>(v.body||v.bodyType)==='female'&&v.mode==='vest'),
  find(v=>v.weapon==='Dagger'&&v.mode==='coat'),
  find(v=>v.weapon==='Dagger'&&v.mode==='vest'),
].filter(Boolean);
const seen=new Set();const ids=[];for(const v of picks){if(!seen.has(v.id)){seen.add(v.id);ids.push(v.id);}}
const SCALE=6,CELL=F*SCALE,PAD=8,LABEL=34;
const COLS=ids.length,cellW=CELL+PAD*2,cellH=CELL*2+PAD*3+LABEL,W=COLS*cellW,H=cellH;
const comps=[],labels=[];
for(let i=0;i<ids.length;i++){const v=L.find(x=>x.id===ids[i]);const sheet=path.join(OUT,'gambler',`${v.id}.png`);const cx=i*cellW+PAD;
  const fr=await sharp(sheet).extract({left:1*F,top:walk.y+DIRS.down*F,width:F,height:F}).resize(CELL,CELL,{kernel:'nearest'}).toBuffer();comps.push({input:fr,left:cx,top:PAD});
  const bk=await sharp(sheet).extract({left:1*F,top:walk.y+DIRS.up*F,width:F,height:F}).resize(CELL,CELL,{kernel:'nearest'}).toBuffer();comps.push({input:bk,left:cx,top:PAD*2+CELL});
  const hat=v.headwear==='Formal Bowler Hat'?'bowler':'tophat';
  labels.push(`<text x="${cx+CELL/2}" y="${CELL*2+PAD*2+14}" font-family="monospace" font-size="13" fill="#fff" text-anchor="middle">${v.id} ${v.mode} ${(v.body||v.bodyType)[0]}</text>`);
  labels.push(`<text x="${cx+CELL/2}" y="${CELL*2+PAD*2+28}" font-family="monospace" font-size="11" fill="#cc9" text-anchor="middle">${v.weapon}·${hat}</text>`);
}
const svg=`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`;
await sharp({create:{width:W,height:H,channels:4,background:{r:0x14,g:0x16,b:0x1e,alpha:1}}}).composite([...comps,{input:Buffer.from(svg),left:0,top:0}]).png().toFile('tools/_gamb_proof.png');
console.log('wrote tools/_gamb_proof.png',W+'x'+H,'ids:',ids.join(','));
