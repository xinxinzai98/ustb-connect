'use strict';
const {execFileSync}=require('node:child_process');const path=require('node:path');
const root=path.join(__dirname,'..');
if(process.platform!=='darwin'){console.log('Mac Wi-Fi helper compilation requires macOS; skipped on this platform.');process.exit(0);}
execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang',['-arch','arm64','-target','arm64-apple-macos13','-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk','-fobjc-arc','-fmodules-cache-path=/private/tmp/ustb-clang-cache','-framework','Foundation','-framework','CoreWLAN',path.join(root,'service','wifi-macos.m'),'-o',path.join(root,'service','wifi-macos-arm64')],{stdio:'inherit'});
console.log('Mac ARM64 Wi-Fi helper compiled; no network operation executed.');
