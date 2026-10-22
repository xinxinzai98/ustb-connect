'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const R=require('resedit');const root=path.resolve(__dirname,'..');const pkg=require('../package.json');
const out=path.resolve(root,pkg.build.directories.output);const work=path.resolve(root,'..','work','ustb-connect-v1');
fs.mkdirSync(work,{recursive:true});const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function requireTrue(value,message){if(!value)throw new Error(message);}
function files(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(directory,x.name)):[path.join(directory,x.name)]);}
const sources=['src','renderer','service','assets'].flatMap(x=>files(path.join(root,x))).concat(['README.md','FLOW.md'].map(x=>path.join(root,x)));
const targets=[{name:'mac-arm64',directory:path.join(out,'mac-arm64',pkg.build.productName+'.app','Contents','Resources','app'),prefix:pkg.build.productName+'.app/Contents/Resources/app/'},{name:'win-x64',directory:path.join(out,'win-unpacked','resources','app'),prefix:'resources/app/'}];
const report={version:pkg.version,checkedAt:new Date().toISOString(),timezone:'Asia/Shanghai',tests:{},packages:[],native:{},boundaries:{remoteAccess:false,realCampusAuthentication:false,realWifiJoin:false,systemBackendInstalled:false,systemStartupModified:false,nativeWindowsAcceptance:false,unattendedBootAcceptance:false}};
const testFiles=fs.readdirSync(path.join(root,'tests')).filter(x=>x.endsWith('.test.cjs')).map(x=>path.join(root,'tests',x));
const tests=execFileSync(process.execPath,['--test','--test-reporter=spec',...testFiles],{cwd:root,encoding:'utf8'});
fs.writeFileSync(path.join(work,'unit-tests.txt'),tests);
report.tests={passed:Number(tests.match(/pass (\d+)/)?.[1]),failed:Number(tests.match(/fail (\d+)/)?.[1])};requireTrue(report.tests.passed>=57&&report.tests.failed===0,'Unit validation did not pass');
for(const target of targets){
  const zip=path.join(out,`USTB-Connect-${pkg.version}-${target.name}.zip`);
  const entries=execFileSync('/usr/bin/unzip',['-Z','-1',zip],{encoding:'utf8'}).trim().split('\n');
  requireTrue(!entries.some(x=>/(^|\/)(account\.json|preferences\.json|controller\.token|vault\.bin)$/.test(x)||/\/node_modules\//.test(x)),'Unexpected credentials, preferences or dependencies in archive');
  for(const file of sources){
    const rel=path.relative(root,file),expected=sha(fs.readFileSync(file));
    requireTrue(sha(fs.readFileSync(path.join(target.directory,rel)))===expected,`Staged source mismatch: ${target.name}/${rel}`);
    const entry=target.prefix+rel.split(path.sep).join('/');
    requireTrue(sha(execFileSync('/usr/bin/unzip',['-p',zip,entry],{maxBuffer:16*1024*1024}))===expected,`Archive source mismatch: ${target.name}/${rel}`);
  }
  const data=fs.readFileSync(zip);report.packages.push({platform:target.name,file:path.basename(zip),bytes:data.length,sha256:sha(data),checkedSourceFiles:sources.length,privateDataIncluded:false});
}
const exe=fs.readFileSync(path.join(out,'win-unpacked','USTB Connect.exe'));
requireTrue(exe.readUInt16LE(exe.readUInt32LE(0x3c)+4)===0x8664,'Windows executable is not x64');
const resource=R.NtExecutableResource.from(R.NtExecutable.from(exe));
const images=resource.entries.filter(x=>x.type===3).map(x=>sha(Buffer.from(x.bin)));
const ico=fs.readFileSync(path.join(root,'assets','app.ico'));const count=ico.readUInt16LE(4);
for(let n=0;n<count;n++){const entry=6+n*16;const length=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12);requireTrue(images.includes(sha(ico.subarray(offset,offset+length))),'Windows application icon differs');}
const macho=fs.readFileSync(path.join(out,'mac-arm64','USTB Connect.app','Contents','MacOS','USTB Connect'));
requireTrue(macho.readUInt32LE(4)===0x0100000c,'Mac executable is not ARM64');
const helper=path.join(root,'service','wifi-macos-arm64');requireTrue(fs.readFileSync(helper).readUInt32LE(4)===0x0100000c,'Wi-Fi helper is not ARM64');
const dryRun=JSON.parse(execFileSync(helper,[],{input:JSON.stringify({action:'validateOnly',ssid:'No network test',security:'wpa2',password:'fake-test-password'}),encoding:'utf8'}));
requireTrue(dryRun.ok&&dryRun.networkTouched===false,'Native input-only validation failed');
report.native={macAppArch:'arm64',windowsAppArch:'x64',windowsIconSizes:count,macWifiHelperArch:'arm64',macWifiHelperInputOnly:dryRun,developerSigned:false};
const setup=path.join(out,`USTB-Connect-${pkg.version}-win-x64-setup.exe`);const setupBytes=fs.readFileSync(setup);requireTrue(setupBytes.subarray(0,2).toString()==='MZ','Installer missing');
report.packages.push({platform:'win-x64-setup',file:path.basename(setup),bytes:setupBytes.length,sha256:sha(setupBytes)});
const uiFile=path.join(work,'ui-checks.json');if(fs.existsSync(uiFile)){report.ui=JSON.parse(fs.readFileSync(uiFile,'utf8'));requireTrue(report.ui.checks.length>=22&&report.ui.errors.length===0,'UI checks not confirmed');}
fs.writeFileSync(path.join(out,'验证报告.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),report.packages.map(x=>`${x.sha256}  ${x.file}`).join('\n')+'\n');
for(const file of ['README.md','FLOW.md'])fs.copyFileSync(path.join(root,file),path.join(out,file==='README.md'?'使用说明.md':'检测与登录流程.md'));
for(const file of ['TESTING.md','CHANGELOG.md'])fs.copyFileSync(path.join(root,file),path.join(out,file));
const screenshots=path.join(out,'界面预览');fs.mkdirSync(screenshots,{recursive:true});
for(const name of ['wifi','overview','accounts','settings','logs','minimum-window']){const source=path.join(root,'output','playwright',name+'.png');if(fs.existsSync(source))fs.copyFileSync(source,path.join(screenshots,name+'.png'));}
console.log(JSON.stringify({version:pkg.version,tests:report.tests,uiChecks:report.ui?.checks.length,artifacts:report.packages.map(x=>({file:x.file,bytes:x.bytes})),sourceFiles:sources.length}));
