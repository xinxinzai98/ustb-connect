'use strict';
const draftActions=new Set(['settings','upsertAccount','removeAccount','reorderAccounts','retryAccount','saveWifi','stop','diagnostics']);
function draftData(value={}){
  const data=structuredClone(value);
  data.accounts=(data.accounts||[]).filter(a=>!(String(a.username).startsWith('demo_')&&String(a.password).startsWith('DEMO-ONLY-')));
  const demoWifi=data.wifi?.ssid==='示例无线网络'&&String(data.wifi.password).startsWith('DEMO-ONLY-');
  data.wifi=demoWifi?{}:{...data.wifi,verifiedRevision:null,validation:{state:data.wifi?.ssid?'unverified':'unconfigured',at:null}};
  if(demoWifi)data.settings={...data.settings,ssid:''};
  data.runtime={};
  return data;
}
function desktopSnapshot(value,{mode,connected,preview}){
  if(preview||(mode==='system'&&connected&&value.mode!=='simulation'))return value;
  return {...value,activeId:null,loginAccountId:null,stats:{},network:null,lastResult:null,lastCheckedAt:null,lastLoginAt:0,nextCheckAt:null,
    running:false,busy:false,campus:'notChecked',ipv4:'notChecked',ipv6:'notChecked',
    status:'backendUnavailable',statusLabel:mode==='setup'?'请安装并连接后台服务':'后台状态待确认，请重新连接'};
}
function requireDesktopAction(method,{mode,connected,preview}){
  if(preview||(mode==='system'&&connected))return;
  if(mode==='setup'&&draftActions.has(method))return;
  throw new Error('请先安装并连接后台服务，再执行网络操作。');
}
module.exports={draftData,desktopSnapshot,requireDesktopAction};
