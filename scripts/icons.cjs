'use strict';
const fs=require('node:fs');const path=require('node:path');
const sharp=require('sharp');
async function main(){
  const assets=path.join(__dirname,'..','assets');const svg=fs.readFileSync(path.join(assets,'icon.svg'));
  const images=[];
  for(const size of [16,32,48,64,128,256])images.push({size,data:await sharp(svg).resize(size,size).png().toBuffer()});
  const header=Buffer.alloc(6);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=6+images.length*16;
  const entries=images.map(({size,data})=>{const e=Buffer.alloc(16);e[0]=size===256?0:size;e[1]=size===256?0:size;e.writeUInt16LE(1,4);e.writeUInt16LE(32,6);e.writeUInt32LE(data.length,8);e.writeUInt32LE(offset,12);offset+=data.length;return e;});
  fs.writeFileSync(path.join(assets,'app.ico'),Buffer.concat([header,...entries,...images.map(x=>x.data)]));
  await sharp(svg).resize(1024).png().toFile(path.join(assets,'app.png'));
  await sharp(svg).resize(32).png().toFile(path.join(assets,'tray.png'));
  const template=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M1.8 4.5a9.2 9.2 0 0 1 12.4 0M4 7a5.9 5.9 0 0 1 8 0M6.5 9.3H4.4a2.5 2.5 0 0 0 0 5H7a2.5 2.5 0 0 0 2.5-2.5m0-2.5h2.1a2.5 2.5 0 0 1 0 5H9" fill="none" stroke="black" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  await sharp(template).resize(16,16).withMetadata({density:72}).png().toFile(path.join(assets,'trayTemplate.png'));
  await sharp(template).resize(32,32).withMetadata({density:144}).png().toFile(path.join(assets,'trayTemplate@2x.png'));
  const chunks=[];
  // macOS uses an approximately 824 px coloured shape on a 1024 px transparent canvas.
  const macIcon=await sharp(svg).resize(872,872).extend({top:76,bottom:76,left:76,right:76,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
  for(const [type,size] of [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]]){
    const image=await sharp(macIcon).resize(size,size).png().toBuffer();const chunk=Buffer.alloc(8);
    chunk.write(type,0,4,'ascii');chunk.writeUInt32BE(image.length+8,4);chunks.push(chunk,image);
  }
  const icns=Buffer.alloc(8);icns.write('icns');icns.writeUInt32BE(8+chunks.reduce((n,b)=>n+b.length,0),4);
  fs.writeFileSync(path.join(assets,'app.icns'),Buffer.concat([icns,...chunks]));
  process.stdout.write('BKQL application, Windows, macOS and tray icons generated.\n');
}
main().catch(()=>{process.stderr.write('Icon generation failed\n');process.exitCode=1;});
