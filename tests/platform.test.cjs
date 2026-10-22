'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process');const {parseWindowsWifi,parseMacSSID}=require('../src/platform.cjs');
const one='11111111-1111-1111-1111-111111111111',two='22222222-2222-2222-2222-222222222222';
test('SSID parsing selects the requested adapter and preserves meaningful spaces',()=>{
  const text=`Name : WLAN\nGUID : ${one}\nState : disconnected\nName : USB Wi-Fi\nGUID : ${two}\nSSID :  Campus WiFi \nProfile : USTB-known\n`;
  assert.equal(parseWindowsWifi(text,one).ssid,'');assert.equal(parseWindowsWifi(text,two).ssid,' Campus WiFi ');
  assert.equal(parseWindowsWifi(text.replace('Profile','配置文件'),two).profile,'USTB-known');
  assert.equal(parseMacSSID('Current Wi-Fi Network:  Campus WiFi \n'),' Campus WiFi ');
});
function loadPlatform(platform,callback,{interfaces={}}={}){
  const module={exports:{}};const sockets={createSocket:()=>({once(){},connect(_p,_h,ready){ready();},address(){return {address:'192.0.2.10'};},close(){}})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','src','platform.cjs'),'utf8'),{module,exports:module.exports,require:n=>n==='node:child_process'?{execFile:(file,args,options,done)=>{callback(file,args,done);return {stdin:{end(){}}};}}:n==='node:os'?{networkInterfaces:()=>interfaces}:n==='node:dgram'?sockets:n==='./protocol.cjs'?require('../src/protocol.cjs'):require(n),process:{platform,env:{}},Buffer,setTimeout,clearTimeout,__dirname:path.join(__dirname,'..','src')});return module.exports;
}
test('Mac association without DHCP is a connected link, not a disconnected radio',async()=>{
  const platform=loadPlatform('darwin',(file,args,done)=>{
    const value=args.includes('-listallhardwareports')?'Hardware Port: Wi-Fi\nDevice: en0\n':args.includes('-getairportnetwork')?'Current Wi-Fi Network:  Campus WiFi \n':file==='/sbin/ifconfig'?'status: active\n':'interface: en0\n';queueMicrotask(()=>done(null,value));
  });
  const result=await platform.context({interface:'auto'});assert.equal(result.link,true);assert.equal(result.source4,'');assert.equal(result.ssid,' Campus WiFi ');
});
test('Windows auto selection prefers the connected adapter on the campus route',async t=>{
  const powershell=process.env.USTB_TEST_POWERSHELL||(process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'):'');
  if(!powershell||!fs.existsSync(powershell)){t.skip('Set USTB_TEST_POWERSHELL to run the stubbed PowerShell query');return;}
  let query='';const platform=loadPlatform('win32',(_file,args,done)=>{query=args.at(-1);queueMicrotask(()=>done(null,JSON.stringify({guid:two,rawWlan:`GUID : ${two}\nSSID : Test WiFi\nProfile : USTB-test\n`,source4:'192.0.2.10',source6:''})));});
  await platform.context({interface:'auto'});
  const fixture=`
function Get-NetAdapter {[pscustomobject]@{Name='WLAN';ifIndex=1;Status='Disconnected';HardwareInterface=$true;InterfaceDescription='Internal WiFi';InterfaceGuid=[guid]'${one}' };[pscustomobject]@{Name='USB Wi-Fi';ifIndex=2;Status='Up';HardwareInterface=$true;InterfaceDescription='USB WiFi';InterfaceGuid=[guid]'${two}'}}
function Find-NetRoute {param($RemoteIPAddress) [pscustomobject]@{IPAddress=$(if($RemoteIPAddress -match ':'){'2001:db8::10'}else{'192.0.2.10'});InterfaceIndex=2}}
function Get-NetIPAddress {param($InterfaceIndex,$AddressFamily) [pscustomobject]@{IPAddress=$(if($AddressFamily -eq 'IPv6'){'2001:db8::10'}else{'192.0.2.10'});AddressState='Preferred';SkipAsSource=$false}}
function Get-ScheduledTask {[pscustomobject]@{State='Ready'}}
function netsh {"GUID : ${two}";"SSID : Test WiFi";"Profile : USTB-test"}
`;
  const result=JSON.parse(execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',fixture+query],{encoding:'utf8'}));
  assert.equal(result.interface,'USB Wi-Fi');assert.equal(result.routeOk,true);assert.equal(result.link,true);
});
