'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const platform=require('./platform.cjs');

function appSource(executable=process.execPath){return process.platform==='darwin'?path.resolve(path.dirname(executable),'..','..'):path.dirname(executable);}
function shellQuote(value){return "'"+String(value).replace(/'/g,"'\\''")+"'";}
function summary(){return {platform:process.platform,root:platform.machineRoot(),
  kind:process.platform==='win32'?'SYSTEM 开机任务':'macOS LaunchDaemon',
  actions:['复制本应用后台到系统保护目录','创建仅本机可访问的后台控制通道','使用系统安全存储保存校园账号与无线密码','注册开机后台和独立停止入口；无线验证、是否自动监测由你在界面控制'],
  caveat:process.platform==='darwin'?'FileVault 预启动解锁前，本应用尚不能运行。系统服务安装需要管理员授权。':'已有旧版脚本运行时会停止安装，保留旧版及其配置。'};}

async function install({app,isPreview,openPath}) {
  if(isPreview)throw new Error('当前为隔离演练，禁止安装系统后台');
  if(!app.isPackaged)throw new Error('请使用已打包的应用安装系统后台');
  const source=appSource();
  if(process.platform==='win32'){
    const owner=(await platform.ps('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value')).trim();
    if(!/^S-1-5-21-(?:\d+-){3}\d+$/.test(owner))throw new Error('无法核定当前 Windows 用户身份');
    const script=path.join(__dirname,'..','service','install-windows.ps1');
    const payload={script,source,owner};
    await platform.ps(`$v=[Console]::In.ReadToEnd()|ConvertFrom-Json;$args='-NoExit -NoProfile -ExecutionPolicy Bypass -File "'+$v.script+'" -Source "'+$v.source+'" -OwnerSid '+$v.owner;Start-Process -FilePath '${platform.powershell().replace(/'/g,"''")}' -Verb RunAs -ArgumentList $args`,{input:JSON.stringify(payload)});
    return {requested:true,message:'系统已请求管理员安装，请在 Windows 提示中核对并授权。'};
  }
  if(process.platform==='darwin'){
    const folder=path.join(app.getPath('userData'),'installer');fs.mkdirSync(folder,{recursive:true,mode:0o700});
    const command=path.join(folder,'BKQL-Install-System-Backend.command');
    const template=fs.readFileSync(path.join(__dirname,'..','service','install-macos.command'),'utf8');
    const text=template.replace('__BKQL_SOURCE_APP__',shellQuote(source)).replace('__BKQL_OWNER_UID__',String(process.getuid()));
    fs.writeFileSync(command,text,{mode:0o700});
    const error=await openPath(command);if(error)throw new Error('请在系统中打开生成的后台安装脚本');
    return {requested:true,message:'已打开系统后台安装脚本；管理员密码只在系统终端中输入。'};
  }
  throw new Error('此平台不支持安装系统后台');
}
module.exports={install,summary,appSource,shellQuote};
