import sharp from 'sharp';import fs from 'node:fs';import path from 'node:path';
const OUT='assets/sprites/adventurers';
const layout=JSON.parse(fs.readFileSync(path.join(OUT,'layout.json'),'utf8'));
const man=JSON.parse(fs.readFileSync(path.join(OUT,'manifest.json'),'utf8'));
const L=man.variants.gambler;const F=layout.frame;
const walk=layout.rows.find(r=>r.anim==='walk');const DIRS={up:0,left:1,down:2,right:3};
const has=(v,n)=>(v.accessories||[]).some(a=>a.name===n);
const bare=v=>v.mode==='vest'; // open vest → chest visible for the chain
const picks=[
  L.find(v=>has(v,'Chain Necklace')&&bare(v)),
  L.find(v=>has(v,'Simple Necklace')&&bare(v)),
  L.find(v=>has(v,'Chain Necklace')&&v.mode==='coat'),
  L.find(v=>has(v,'Stud Ring')&&bare(v)),
  L.find(v=>has(v,'Stud Ring')&&has(v,'Chain Necklace')),
  L.find(v=>has(v,'Simple Necklace')&&(v.body||v.bodyType)==='female'),
].filter(Boolean);
const seen=new Set();const ids=[];for(const v of picks){if(!seen.has(v.id)){seen.add(v.id);ids.push(v.id);}}
const S=12,CELL=F*S,PAD=10,LABEL=32;
const COLS=ids.length,cellW=CELL+PAD*2,cellH=CELL+PAD*2+LABEL,W=COLS*cellW,H=cellH;
const comps=[],labels=[];
for(let i=0;i<ids.length;i++){const v=L.find(x=>x.id===ids[i]);const sheet=path.join(OUT,'gambler',`${v.id}.png`);const cx=i*cellW+PAD;
  const fr=await sharp(sheet).extract({left:1*F,top:walk.y+DIRS.down*F,width:F,height:F}).resize(CELL,CELL,{kernel:'nearest'}).toBuffer();comps.push({input:fr,left:cx,top:PAD});
  const bling=(v.accessories||[]).map(a=>a.name).filter(n=>/Necklace|Ring/.test(n)).join('+')||'?';
  labels.push(`<text x="${cx+CELL/2}" y="${CELL+PAD+15}" font-family="monospace" font-size="14" fill="#fff" text-anchor="middle">${v.id} ${v.mode}</text>`);
  labels.push(`<text x="${cx+CELL/2}" y="${CELL+PAD+30}" font-family="monospace" font-size="11" fill="#fd6" text-anchor="middle">${bling}</text>`);
}
const svg=`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`;
await sharp({create:{width:W,height:H,channels:4,background:{r:0x14,g:0x16,b:0x1e,alpha:1}}}).composite([...comps,{input:Buffer.from(svg),left:0,top:0}]).png().toFile('tools/_gamb_bling.png');
console.log('wrote',W+'x'+H,'ids:',ids.join(','));
