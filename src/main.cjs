'use strict';
const {app,BrowserWindow,ipcMain,Menu,Tray,nativeImage,dialog,shell,safeStorage,powerMonitor}=require('electron');
const path=require('node:path');const fs=require('node:fs');
const {Engine,SimulationTransport}=require('./engine.cjs');
const {DraftStore}=require('./store.cjs');const {dispatch,call,METHODS,stopMonitoring}=require('./control.cjs');
const installer=require('./installer.cjs');
const {publicError,STATUSES}=require('./model.cjs');
const {trayInformation}=require('./tray.cjs');

const preview=process.argv.includes('--preview')||process.env.BKQL_UI_TEST==='1';
if(preview){
  const root=path.join(require('node:os').tmpdir(),`BKQL-Preview-${process.pid}`);
  fs.mkdirSync(root,{recursive:true,mode:0o700});app.setPath('userData',root);
}
const assets=path.join(__dirname,'..','assets');
let window,tray,engine,store,trayMetrics;let mode='simulation',lastSnapshot=null,quitting=false;let systemConnected=false,serviceSeen=false,systemRunning=null,serviceVersion=null;

const extraMethods=new Set(['loadDemo','setScene','setMode','installationInfo','installBackend','importAccounts','exportDiagnostics','openLogFolder','syncDraft','stopAll']);
function presentation(snapshot){return {...snapshot,platform:process.platform,arch:process.arch,version:app.getVersion(),statusLabels:STATUSES,preview,
  service:{connected:systemConnected,known:serviceSeen,running:systemRunning,version:serviceVersion,compatible:serviceVersion===app.getVersion(),mode,installed:serviceSeen,kind:process.platform==='win32'?'SYSTEM 开机任务':'macOS LaunchDaemon'},
  mode,simulationScene:engine.transport.scene||'healthy',...(preview?{ui:{tray:trayMetrics}}:{})};}
function publish(snapshot){lastSnapshot=presentation(snapshot);window?.webContents.send('bkql:state',lastSnapshot);return lastSnapshot;}
function observedService(value){serviceVersion=value.version||'legacy';systemConnected=value.version===app.getVersion();serviceSeen=true;systemRunning=value.running;return value;}
async function status(){if(mode==='system')return publish(observedService(await call('status')));return publish(engine.snapshot());}
async function stopAll(){
  const includeService=!preview&&(serviceSeen||Boolean(require('./platform.cjs').connectionInfo()));
  const result=await stopMonitoring(engine,{includeService,serviceCall:()=>call('stop',{},undefined,{timeout:10000})});
  if(result.systemState==='stopped')observedService(result.systemSnapshot);
  if(result.systemState==='unconfirmed'){systemConnected=false;systemRunning=null;}
  const message=!result.ok?'未能确认全部监测已停止。请检查后台服务或使用桌面停止入口。':includeService?'后台自动重连与模拟监测均已停止。':'模拟监测已停止；当前未连接后台服务。';
  return {ok:result.ok,message,snapshot:publish(mode==='system'&&result.systemSnapshot?result.systemSnapshot:mode==='system'?lastSnapshot:engine.snapshot())};
}

async function encrypt(text){
  const available=typeof safeStorage.isAsyncEncryptionAvailable==='function'?await safeStorage.isAsyncEncryptionAvailable():safeStorage.isEncryptionAvailable();
  if(!available||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend?.()==='basic_text'))throw new Error('系统安全存储暂不可用，密码未明文落盘');
  return typeof safeStorage.encryptStringAsync==='function'?safeStorage.encryptStringAsync(text):safeStorage.encryptString(text);
}
async function decrypt(bytes){
  if(typeof safeStorage.decryptStringAsync==='function'){const v=await safeStorage.decryptStringAsync(bytes);return typeof v==='string'?v:v.result;}
  return safeStorage.decryptString(bytes);
}
async function demo(){
  if(mode!=='simulation')throw new Error('仅可在模拟模式加载示例数据。');
  if(engine.accounts.length)throw new Error('当前已有账号配置。为避免覆盖，未加载示例账号。');
  await engine.upsert({label:'主用校园账号',username:'demo_student_a',password:'DEMO-ONLY-A-NOT-REAL'});
  await engine.upsert({label:'备用校园账号',username:'demo_student_b',password:'DEMO-ONLY-B-NOT-REAL'});
  await engine.saveWifi({ssid:'示例无线网络',security:'wpa2',password:'DEMO-ONLY-WIFI'});
  engine.transport.owner='demo_student_a';await engine.check({readOnly:true,refreshStats:true});return status();
}
function makeWindow(){
  window=new BrowserWindow({width:1240,height:850,minWidth:1020,minHeight:720,show:false,backgroundColor:'#f6f8fc',
    title:'北科校园联网',icon:path.join(assets,'app.png'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.loadFile(path.join(__dirname,'..','renderer','index.html'));
  window.once('ready-to-show',()=>window.show());
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
  window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();}});
}
function show(){if(!window||window.isDestroyed())makeWindow();else{window.show();window.focus();}}
function makeTray(){
  const icon=nativeImage.createFromPath(path.join(assets,process.platform==='darwin'?'trayTemplate.png':'tray.png'));
  if(process.platform==='darwin')icon.setTemplateImage(true);
  trayMetrics={size:icon.getSize(),scales:icon.getScaleFactors(),template:icon.isTemplateImage()};
  tray=new Tray(icon);tray.setToolTip('北科校园联网');
  const actions=[
    {label:'打开主窗口',click:show},
    {label:'停止全部监测',click:async()=>{try{const result=await stopAll();await dialog.showMessageBox({type:result.ok?'info':'warning',title:'停止监测',message:result.message});}catch{dialog.showErrorBox('停止状态未确认','无法确认监测已停止。请使用桌面停止入口或检查后台服务。');}}},
    {type:'separator'},
    {label:'退出界面（后台服务继续运行）',click:()=>{quitting=true;app.quit();}},
  ];
  if(process.platform==='darwin'){
    let menu;
    const popup=()=>{const snapshot=lastSnapshot||presentation(engine.snapshot());menu=Menu.buildFromTemplate([...trayInformation(snapshot).map(label=>({label,enabled:false})),{type:'separator'},...actions]);tray.popUpContextMenu(menu);};
    tray.on('click',popup);tray.on('right-click',popup);
  }else tray.setContextMenu(Menu.buildFromTemplate(actions));
  tray.on('double-click',show);
}

async function handle(method,body){
  if(!METHODS.has(method)&&!extraMethods.has(method))throw new Error('操作不支持');
  if(method==='status')return status();
  if(method==='stopAll')return stopAll();
  if(method==='loadDemo')return demo();
  if(method==='setScene'){if(mode!=='simulation')throw new Error('后台服务模式不支持模拟场景。');engine.transport.setScene(body.scene);engine.state.failures=0;await engine.check({readOnly:true,refreshStats:true});return status();}
  if(method==='setMode'){
    if(body.mode==='simulation'){mode='simulation';return status();}
    if(body.mode!=='system')throw new Error('运行模式无效');
    if(preview)throw new Error('隔离测试模式不允许连接或安装后台服务。');
    try{const value=observedService(await call('status'));if(!systemConnected)return {installationRequired:true,versionMismatch:true};mode='system';return publish(value);}
    catch{return {installationRequired:true,info:installer.summary()};}
  }
  if(method==='installationInfo')return installer.summary();
  if(method==='installBackend'){
    if(body.confirm!==true)throw new Error('需要确认安装范围');
    return installer.install({app,isPreview:preview,openPath:shell.openPath});
  }
  if(method==='syncDraft'){
    if(mode!=='system'||!systemConnected)throw new Error('请先连接系统后台');
    if(engine.accounts.some(a=>a.username.startsWith('demo_')||a.password.startsWith('DEMO-ONLY-'))||engine.wifi.password?.startsWith('DEMO-ONLY-'))throw new Error('请先替换演示账号和无线配置，演示凭据不会导入真实后台');
    const existing=await call('status');
    if(existing.accounts.length)throw new Error('系统后台已有账号，请直接在账号页面管理，避免覆盖');
    for(const item of engine.accounts)await call('upsertAccount',{label:item.label,username:item.username,password:item.password,enabled:item.enabled});
    if(engine.wifi.ssid)await call('saveWifi',engine.wifi);
    await call('settings',engine.policy);return status();
  }
  if(method==='importAccounts'){
    const result=await dialog.showOpenDialog(window,{title:'导入校园网账号',properties:['openFile'],filters:[{name:'账号 JSON',extensions:['json']}]});
    if(result.canceled)return {cancelled:true};
    const file=result.filePaths[0];if(file.startsWith('\\\\')||fs.statSync(file).size>131072)throw new Error('请选择本地的小型账号 JSON');
    let value;try{value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{throw new Error('账号文件格式不正确');}
    const list=Array.isArray(value.accounts)?value.accounts:[value];
    if(list.length<1||list.length>12)throw new Error('账号文件数量应为 1–12 个');
    // Validate the entire batch before changing any account.
    const validate=require('./model.cjs').account;const checked=list.map(item=>validate(item));
    if(new Set(checked.map(a=>a.username.toLowerCase())).size!==checked.length)throw new Error('导入文件包含重复账号');
    const active=mode==='system'?await call('status'):engine.snapshot();
    if(active.accounts.length+checked.filter(a=>!active.accounts.some(x=>x.username.toLowerCase()===a.username.toLowerCase())).length>12)throw new Error('合并后超过 12 个账号');
    for(const item of checked){const previous=active.accounts.find(a=>a.username.toLowerCase()===item.username.toLowerCase());const payload={...item,id:previous?.id};if(mode==='system')await call('upsertAccount',payload);else await engine.upsert(payload);}
    return status();
  }
  if(method==='exportDiagnostics'){
    const data=mode==='system'?await call('diagnostics'):engine.diagnostics();
    const result=await dialog.showSaveDialog(window,{title:'导出脱敏诊断',defaultPath:`USTB-Diagnostics-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'诊断 JSON',extensions:['json']}]});
    if(result.canceled)return {cancelled:true};fs.writeFileSync(result.filePath,JSON.stringify(data,null,2),{mode:0o600});return {saved:true};
  }
  if(method==='openLogFolder'){await shell.openPath(mode==='system'?require('./platform.cjs').machineRoot():app.getPath('userData'));return {opened:true};}
  const value=mode==='system'?await call(method,body):await dispatch(engine,method,body);
  return publish(value);
}

if(!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',show);
  app.whenReady().then(async()=>{
    store=new DraftStore(app.getPath('userData'),{encrypt,decrypt,memory:preview});
    // Do not overwrite an existing vault if the OS cannot decrypt it.
    const data=await store.load();
    const transport=new SimulationTransport();let epoch=Date.now();let base=Date.now();
    const now=()=>epoch+(Date.now()-base)*transport.timeScale;
    engine=new Engine({transport,data,persist:value=>store.save(value),now});
    engine.on('change',value=>{if(mode==='simulation')publish(value);});
    ipcMain.handle('bkql:call',async(event,payload)=>{
      if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('请求来源不正确');
      if(!payload||typeof payload.method!=='string'||JSON.stringify(payload).length>65536)throw new Error('请求格式不正确');
      try{return await handle(payload.method,payload.body||{});}catch(error){throw new Error(publicError(error));}
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform==='darwin'?[{label:'北科校园联网',submenu:[{role:'about'},{type:'separator'},{label:'退出界面',click:()=>{quitting=true;app.quit();}}]}]:[]),
      {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
      {label:'窗口',submenu:[{role:'minimize'},{label:'显示主窗口',click:show}]}
    ]));
    makeWindow();makeTray();
    if(preview)await demo();
    setInterval(async()=>{if(mode==='system'||serviceSeen){try{const value=observedService(await call('status'));publish(mode==='system'?value:engine.snapshot());}catch{systemConnected=false;systemRunning=null;if(lastSnapshot)publish(mode==='system'?lastSnapshot:engine.snapshot());}}},3000).unref();
    powerMonitor.on('resume',()=>{if(mode==='simulation'&&engine.state.running)setTimeout(()=>engine.check(),3000);});
    app.on('activate',show);
  }).catch(()=>{dialog.showErrorBox('北科校园联网启动失败','无法加载本机配置或安全存储。请检查系统权限后重试；尚未提交校园网认证。');app.quit();});
  app.on('before-quit',()=>{quitting=true;engine?.dispose();});
  app.on('window-all-closed',()=>{});
}
