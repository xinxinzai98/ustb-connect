'use strict';
const path=require('node:path');const {execFileSync}=require('node:child_process');
module.exports=async function(context){
  if(context.electronPlatformName!=='darwin')return;
  const app=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app');
  // This is the fresh build directory, before signing; downloaded test copies keep their quarantine attributes.
  execFileSync('/usr/bin/xattr',['-cr',app],{stdio:'pipe'});
};
