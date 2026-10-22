'use strict';
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const dgram = require('node:dgram');
const { global6 } = require('./protocol.cjs');

function run(file,args,{input='',signal,timeout=10000,rawOutput=false}={}) {
  return new Promise((resolve,reject)=>{
    const child=execFile(file,args,{encoding:'utf8',timeout,windowsHide:true,maxBuffer:1024*1024,signal},(error,stdout)=>{
      if(error){const e=new Error('系统命令未完成');e.code=error.code;reject(e);}else resolve(rawOutput?stdout:stdout.trim());
    });
    if(input)child.stdin.end(input);else child.stdin.end();
  });
}
function powershell(){return path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');}
async function ps(script,options={}) {
  return run(powershell(),['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new();"+script],options);
}
function sourceFor(name,family) {
  return (os.networkInterfaces()[name]||[]).find(a=>!a.internal&&a.family===family&&(family!=='IPv6'||global6(a.address)))?.address||'';
}
function selectedSource(remote,family,signal){
  return new Promise(resolve=>{
    const socket=dgram.createSocket(family===6?'udp6':'udp4');let done=false;
    const finish=address=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);try{socket.close();}catch{}resolve(address);};
    const abort=()=>finish('');const timer=setTimeout(abort,1500);
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    socket.once('error',abort);
    // UDP connect asks the kernel to choose a source; no payload is sent.
    socket.connect(9,remote,()=>{try{finish(socket.address().address);}catch{finish('');}});
  });
}
async function windowsContext(policy,signal) {
  const requested=Buffer.from(policy.interface).toString('base64');
  const script=String.raw`
$all=@(Get-NetAdapter -ErrorAction Stop)
$wireless=@($all|Where-Object {$_.HardwareInterface -and ($_.InterfaceDescription -match 'Wireless|Wi-?Fi|802\.11' -or $_.Name -match '^WLAN$|Wi-?Fi')})
$name=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${requested}'))
$s4=@(Find-NetRoute -RemoteIPAddress '202.204.48.66' -ErrorAction SilentlyContinue)|Where-Object {$_.PSObject.Properties.Name -contains 'IPAddress'}|Select-Object -First 1
$s6=@(Find-NetRoute -RemoteIPAddress '2400:3200::1' -ErrorAction SilentlyContinue)|Where-Object {$_.PSObject.Properties.Name -contains 'IPAddress'}|Select-Object -First 1
if($name -eq 'auto'){
 $a=$wireless|Where-Object {$_.ifIndex -eq $s4.InterfaceIndex -and [string]$_.Status -eq 'Up'}|Select-Object -First 1
 if(!$a){$a=$wireless|Sort-Object @{Expression={if([string]$_.Status -eq 'Up'){0}else{1}}}|Select-Object -First 1}
}else{$a=$wireless|Where-Object {$_.Name -eq $name}|Select-Object -First 1}
if(!$a){throw 'NoWirelessAdapter'}
$v4=Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue|Where-Object {$_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*'}|Select-Object -First 1
$v6=Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue|Where-Object {$_.AddressState -eq 'Preferred' -and !$_.SkipAsSource -and $_.IPAddress -eq $s6.IPAddress}|Select-Object -First 1
$old=Get-ScheduledTask -TaskName 'BKQL-Reconnect-Boot' -ErrorAction SilentlyContinue
[ordered]@{link=([string]$a.Status -eq 'Up');guid=[string]$a.InterfaceGuid;rawWlan=(netsh wlan show interfaces|Out-String);interface=$a.Name;source4=$(if($s4.InterfaceIndex -eq $a.ifIndex){[string]$s4.IPAddress}else{[string]$v4.IPAddress});source6=$(if($s6.InterfaceIndex -eq $a.ifIndex){[string]$v6.IPAddress}else{''});routeOk=($s4.InterfaceIndex -eq $a.ifIndex);legacyRunning=([string]$old.State -in @('Running','Queued'));interfaces=@($wireless|Select-Object Name,InterfaceDescription)}|ConvertTo-Json -Depth 4 -Compress`;
  const {rawWlan,guid,...context}=JSON.parse(await ps(script,{signal}));Object.assign(context,parseWindowsWifi(rawWlan,guid));
  if(!global6(context.source6))context.source6='';if(/^169\.254\./.test(context.source4))context.source4='';return context;
}
async function macContext(policy,signal) {
  const ports=await run('/usr/sbin/networksetup',['-listallhardwareports'],{signal});
  const wifi=ports.match(/Hardware Port:\s*(?:Wi-Fi|AirPort)[\s\S]*?Device:\s*(\S+)/);
  const device=policy.interface==='auto'?(wifi?.[1]||''):policy.interface;
  if(!device)throw new Error('未找到 Wi-Fi 接口');
  let ssid='';
  try{ssid=parseMacSSID(await run('/usr/sbin/networksetup',['-getairportnetwork',device],{signal,rawOutput:true}));}catch{}
  if(!ssid){try{ssid=parseMacSSID(await run('/usr/sbin/ipconfig',['getsummary',device],{signal,rawOutput:true}));}catch{}}
  let media='';try{media=await run('/sbin/ifconfig',[device],{signal});}catch{}
  let route='';try{route=await run('/sbin/route',['-n','get','202.204.48.66'],{signal});}catch{}
  let route6='';try{route6=await run('/sbin/route',['-n','get','-inet6','2400:3200::1'],{signal});}catch{}
  const r4=route.match(/interface:\s*(\S+)/)?.[1]||'';
  const r6=route6.match(/interface:\s*(\S+)/)?.[1]||'';
  const s4=r4===device?await selectedSource('202.204.48.66',4,signal):'';
  const s6=r6===device?await selectedSource('2400:3200::1',6,signal):'';
  const local=os.networkInterfaces()[device]||[];
  const candidate4=local.some(x=>x.address===s4)?s4:sourceFor(device,'IPv4');
  const source4=/^169\.254\./.test(candidate4)?'':candidate4;
  const source6=global6(s6)&&local.some(x=>x.address===s6)?s6:'';
  return {interface:device,ssid,source4,source6,
    routeOk:r4===device,link:media?/\bstatus:\s*active\b/i.test(media):Boolean(ssid),legacyRunning:false,
    interfaces:Object.keys(os.networkInterfaces()).map(Name=>({Name,InterfaceDescription:Name===device?'Wi-Fi':Name}))};
}
function parseWindowsWifi(text,guid){
  const value=String(text||'');const id=String(guid||'').replace(/[{}]/g,'');
  if(!/^[a-f0-9-]{36}$/i.test(id))return {ssid:'',profile:''};
  const marker=new RegExp('^[\\t ]*GUID[\\t ]*:[\\t ]*\\{?'+id+'\\}?[\\t ]*\\r?$','im').exec(value);
  if(!marker)return {ssid:'',profile:''};
  let block=value.slice(marker.index+marker[0].length);const next=block.search(/^[\t ]*GUID[\t ]*:/im);if(next>=0)block=block.slice(0,next);
  const field=key=>new RegExp('^[\\t ]*(?:'+key+')[\\t ]*:[\\t ]?([^\\r\\n]*)','im').exec(block)?.[1]||'';
  return {ssid:field('SSID'),profile:field('Profile|配置文件')};
}
function parseMacSSID(text){return /^(?:Current Wi-Fi Network|[\t ]*SSID)[\t ]*:[\t ]?([^\r\n]*)/m.exec(String(text||''))?.[1]||'';}
async function context(policy,signal) {
  if(process.platform==='win32')return windowsContext(policy,signal);
  if(process.platform==='darwin')return macContext(policy,signal);
  throw new Error('真实联网仅支持 Windows 和 macOS');
}
async function connectWifi(info,policy,signal,configuration={}) {
  if(!info.interface||/[\r\n]/.test(info.interface))throw new Error('接口无效');
  if(configuration.ssid){
    if(configuration.password?.startsWith('DEMO-ONLY-'))throw Object.assign(new Error('DemoCredential'),{code:'unsupportedSecurity'});
    const payload=JSON.stringify({action:'connect',ssid:configuration.ssid,password:configuration.password||'',security:configuration.security,interface:info.interface,force:configuration.force===true});
    const file=path.join(__dirname,'..','service',process.platform==='win32'?'wifi-windows.ps1':'wifi-macos-arm64');
    const result=process.platform==='win32'?await run(powershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file],{input:payload,signal,timeout:45000}):await run(file,[],{input:payload,signal,timeout:45000});
    const value=JSON.parse(result);if(!value.ok)throw Object.assign(new Error('WirelessJoinFailed'),{code:value.code});return value;
  }
  if(process.platform==='win32')return run(path.join(process.env.SystemRoot||'C:\\Windows','System32','netsh.exe'),['wlan','connect',`name=${policy.ssid}`,`ssid=${policy.ssid}`,`interface=${info.interface}`],{signal});
  if(process.platform==='darwin')return run('/usr/sbin/networksetup',['-setairportnetwork',info.interface,policy.ssid],{signal});
  throw new Error('此平台不支持自动连接 Wi-Fi');
}
function machineRoot(){return process.platform==='win32'?path.join(process.env.ProgramData||'C:\\ProgramData','BKQL Connect'):'/Library/Application Support/BKQL Connect';}
function connectionInfo(){
  try{
    const token=fs.readFileSync(path.join(machineRoot(),'controller.token'),'utf8').trim();
    if(!/^[a-f0-9]{64}$/.test(token))return null;
    return {host:'127.0.0.1',port:28763,token};
  }catch{return null;}
}
module.exports={run,ps,powershell,context,connectWifi,machineRoot,connectionInfo,parseWindowsWifi,parseMacSSID};
