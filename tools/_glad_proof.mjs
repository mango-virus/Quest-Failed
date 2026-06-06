import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const OUT='assets/sprites/adventurers';
const layout=JSON.parse(fs.readFileSync(path.join(OUT,'layout.json'),'utf8'));
const man=JSON.parse(fs.readFileSync(path.join(OUT,'manifest.json'),'utf8'));
const L=man.variants.gladiator;
const F=layout.frame;
const walk=layout.rows.find(r=>r.anim==='walk');
const DIRS={up:0,left:1,down:2,right:3};
// 2 per metal color: one bare, one armored — shows even spread + 50/50 split.
const isBare=v=>!v.torso||v.torso.length===0;
const metals=['bronze','iron','steel','gold','ceramic'];
const ids=[];
for(const mc of metals){const b=L.find(v=>v.metalColor===mc&&isBare(v));const a=L.find(v=>v.metalColor===mc&&!isBare(v));if(b)ids.push(b.id);if(a)ids.push(a.id);}
const SCALE=6, CELL=F*SCALE, PAD=8, LABEL=30;
const COLS=ids.length, cellW=CELL+PAD*2, cellH=CELL*2+PAD*3+LABEL;
const W=COLS*cellW, H=cellH;
const comps=[], labels=[];
for(let i=0;i<ids.length;i++){
  const v=L.find(x=>x.id===ids[i]);
  const sheet=path.join(OUT,'gladiator',`${v.id}.png`);
  const cx=i*cellW+PAD;
  const front=await sharp(sheet).extract({left:1*F,top:walk.y+DIRS.down*F,width:F,height:F}).resize(CELL,CELL,{kernel:'nearest'}).toBuffer();
  comps.push({input:front,left:cx,top:PAD});
  const back=await sharp(sheet).extract({left:1*F,top:walk.y+DIRS.up*F,width:F,height:F}).resize(CELL,CELL,{kernel:'nearest'}).toBuffer();
  comps.push({input:back,left:cx,top:PAD*2+CELL});
  labels.push(`<text x="${cx+CELL/2}" y="${CELL*2+PAD*2+14}" font-family="monospace" font-size="13" fill="#fff" text-anchor="middle">${v.id} ${isBare(v)?'BARE':'armor'}</text>`);
  labels.push(`<text x="${cx+CELL/2}" y="${CELL*2+PAD*2+28}" font-family="monospace" font-size="12" fill="#fc6" text-anchor="middle">${v.metalColor}${v.cape?' +cape':''}</text>`);
}
const svg=`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`;
await sharp({create:{width:W,height:H,channels:4,background:{r:0x1a,g:0x1c,b:0x24,alpha:1}}})
 .composite([...comps,{input:Buffer.from(svg),left:0,top:0}]).png().toFile('tools/_glad_proof.png');
console.log('wrote tools/_glad_proof.png',W+'x'+H);
