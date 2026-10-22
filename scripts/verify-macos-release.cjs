'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');
const pkg=require('../package.json');

function verifyArchive(archive){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ustb-mac-signature-'));
  try{
    execFileSync('/usr/bin/ditto',['-x','-k',path.resolve(archive),directory],{stdio:'pipe'});
    const app=path.join(directory,pkg.build.productName+'.app');
    execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app],{stdio:'pipe'});
    const helper=path.join(app,'Contents','Resources','app','service','wifi-macos-arm64');
    execFileSync('/usr/bin/codesign',['--verify','--strict','--verbose=2',helper],{stdio:'pipe'});
    return {file:path.basename(archive),signatureValid:true,nativeHelperSignatureValid:true};
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}

module.exports=async function(context){
  for(const archive of context.artifactPaths||[]){
    if(archive.endsWith('-mac-arm64.zip'))console.log('Mac archive signature verified:',JSON.stringify(verifyArchive(archive)));
  }
  return [];
};
module.exports.verifyArchive=verifyArchive;
if(require.main===module){
  if(!process.argv[2])throw new Error('Usage: node scripts/verify-macos-release.cjs <Mac ZIP>');
  console.log(JSON.stringify(verifyArchive(process.argv[2])));
}
