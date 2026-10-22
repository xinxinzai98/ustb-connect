'use strict';
const { EventEmitter } = require('node:events');
const { settings, account, wifi, publicWifi, publicAccount, publicRuntime, STATUSES, redact, masked } = require('./model.cjs');

class Engine extends EventEmitter {
  constructor({ transport, data = {}, persist = async () => {}, now = Date.now, sleep } = {}) {
    super();
    this.transport = transport;
    this.policy = settings(data.settings);
    this.accounts = (data.accounts || []).map(a => account(a, a));
    this.wifi=data.wifi||{};
    this.persist = persist;
    this.now = now;
    this.sleep = sleep || ((ms, signal) => new Promise((resolve,reject) => {
      if (signal?.aborted) return reject(new Error('Cancelled'));
      const timer=setTimeout(done,ms);
      function done(){signal?.removeEventListener('abort',cancel);resolve();}
      function cancel(){clearTimeout(timer);reject(new Error('Cancelled'));}
      signal?.addEventListener('abort',cancel,{once:true});
    }));
    const old = data.runtime || {};
    this.state = { status:'paused', running:false, activeId:old.activeId || null,
      lastSuccessId:old.lastSuccessId || null, lastLoginAt:old.lastLoginAt || 0,
      lastWifiAt:old.lastWifiAt || 0, blocked:old.blocked || {}, globalBlockedUntil:old.globalBlockedUntil || 0,
      failures:0, lastCheckedAt:null, nextCheckAt:null, network:null,loginAccountId:null,
      campus:'unknown', ipv4:'unknown', ipv6:'unknown', stats:old.stats || {}, lastResult:null };
    this.logs=[]; this.busy=false; this.generation=0; this.timer=null; this.controller=null;
  }
  snapshot() {
    return structuredClone({ ...this.state, busy:this.busy, statusLabel:STATUSES[this.state.status] || '网络状态已更新',
      settings:this.policy, accounts:this.accounts.map(a => publicAccount(a,this.state.blocked)), logs:this.logs,
      wifi:publicWifi(this.wifi),version:require('../package.json').version,time:this.now(), mode:this.transport.simulated ? 'simulation' : 'system' });
  }
  changed(){this.emit('change',this.snapshot());}
  event(level, code, message, detail={}) {
    const secrets=[...this.accounts,{password:this.wifi.password}];
    const record={time:this.now(),level,code,message:redact(message,secrets),detail:JSON.parse(redact(detail,secrets))};
    this.logs.push(record); if(this.logs.length>200)this.logs.shift();
    this.emit('log',record);this.changed();
  }
  async save(){await this.persist({settings:this.policy,accounts:this.accounts,wifi:this.wifi,runtime:publicRuntime(this.state)});}
  clearObservation(){this.state.activeId=null;this.state.campus='unknown';this.state.ipv4='unknown';this.state.ipv6='unknown';this.state.lastResult=null;}
  acceptStatistics(id,value){
    if(value.state==='accountMismatch'){
      this.clearObservation();this.state.status='authUnknown';this.event('warning','accountIdentityChanged','认证身份发生变化，已隐藏当前账号统计，等待重新确认。');return false;
    }
    this.state.stats[id]=value;return true;
  }
  async saveWifi(input){
    if(this.busy)throw new Error('当前正在检测，请先暂停或等待完成');
    const previous=this.wifi,oldPolicy=this.policy,oldRun={running:this.state.running,status:this.state.status,nextCheckAt:this.state.nextCheckAt};
    this.wifi=wifi(input,previous);this.policy=settings({...this.policy,ssid:this.wifi.ssid});this.cancelCycle();
    if(this.wifi.verifiedRevision!==this.wifi.revision){this.state.running=false;this.state.status='wifiUnconfigured';this.state.nextCheckAt=null;}
    const generation=this.generation;
    try{await this.save();}catch(error){this.wifi=previous;this.policy=oldPolicy;if(this.generation===generation)Object.assign(this.state,oldRun);this.schedule();throw error;}
    this.event('info','wifiSaved','无线配置已安全保存；变更后须验证连接，再开启自动重连');this.schedule();return this.snapshot();
  }
  beginWifiValidation(){
    if(this.busy)throw new Error('当前正在检测，请先暂停或等待完成');
    if(!this.wifi.ssid)throw new Error('请先保存无线网络名称与密码');
    void this.validateWifi().catch(()=>{});return this.snapshot();
  }
  async validateWifi(){
    this.cancelCycle();this.busy=true;const controller=new AbortController();this.controller=controller;const signal=controller.signal;
    const revision=this.wifi.revision;this.wifi.validation={state:'testing',at:this.now()};this.changed();
    try{
      const initial=await this.transport.context(this.policy,signal);
      if(initial.legacyRunning&&!this.transport.simulated)throw Object.assign(new Error('LegacyConflict'),{code:'legacyConflict'});
      const requested=await this.transport.connectWifi(initial,this.policy,signal,{...this.wifi,force:true});
      let current;
      for(let n=0;n<10;n++){
        if(signal.aborted)throw new Error('Cancelled');
        current=await this.transport.context(this.policy,signal);
        if(current.link&&current.ssid===this.wifi.ssid&&current.source4&&(!requested?.profile||current.profile===requested.profile))break;
        await this.sleep(2000/(this.transport.timeScale||1),signal);
      }
      if(!current?.link||current.ssid!==this.wifi.ssid)throw Object.assign(new Error('WifiNotConnected'),{code:'notConnected'});
      if(requested?.profile&&current.profile!==requested.profile)throw Object.assign(new Error('AnotherProfile'),{code:'notConnected'});
      if(!current.source4)throw Object.assign(new Error('NoIPv4'),{code:'noAddress'});
      const auth=current.routeOk?await this.transport.auth(current,signal):{state:'unknown'};
      if(signal.aborted||this.wifi.revision!==revision)throw new Error('Cancelled');
      this.state.network=current;this.state.campus=auth.state;this.state.ipv4='notChecked';this.state.ipv6='notChecked';this.wifi.verifiedRevision=revision;
      this.wifi.validation={state:!current.routeOk?'routeMismatch':auth.state==='unknown'?'campusUnavailable':'verified',at:this.now(),campus:auth.state};
      this.event('success','wifiValidated','已重新连接指定无线网络并取得 IP；校园认证状态已另行核对',{campus:auth.state,routeOk:current.routeOk});
    }catch(error){
      this.wifi.verifiedRevision=null;
      const allowed=['authRejected','notFound','permissionDenied','unsupportedSecurity','noAddress','notConnected','legacyConflict'];
      this.wifi.validation={state:signal.aborted?'cancelled':allowed.includes(error.code)?error.code:'failed',at:this.now()};
      this.event('warning','wifiValidationFailed','无线验证未通过，未将这份密码标为可用',{reason:this.wifi.validation.state});
    }finally{this.busy=false;if(this.controller===controller)this.controller=null;await this.save();this.changed();this.schedule();}
    return this.snapshot();
  }
  async upsert(input) {
    const before=this.accounts.slice(),beforeStats=structuredClone(this.state.stats);
    const index=this.accounts.findIndex(a => a.id===input.id);
    const item=account(input,index>=0?this.accounts[index]:undefined);
    if(this.accounts.some(a=>a.id!==item.id && a.username.toLowerCase()===item.username.toLowerCase()))throw new Error('这个校园账号已经添加');
    if(index<0 && this.accounts.length>=12)throw new Error('最多保存 12 个账号');
    if(index>=0)this.accounts[index]=item;else this.accounts.push(item);
    if(index>=0&&before[index].username.toLowerCase()!==item.username.toLowerCase())delete this.state.stats[item.id];
    this.cancelCycle();try{await this.save();}catch(error){this.accounts=before;this.state.stats=beforeStats;this.schedule();throw error;}
    this.event('info','accountSaved','账号设置已保存');this.schedule();return this.snapshot();
  }
  async remove(id){
    const before=this.accounts.slice(), blocked=structuredClone(this.state.blocked), stats=structuredClone(this.state.stats);
    this.accounts=this.accounts.filter(a=>a.id!==id);delete this.state.blocked[id];delete this.state.stats[id];this.cancelCycle();
    try{await this.save();}catch(error){this.accounts=before;this.state.blocked=blocked;this.state.stats=stats;this.schedule();throw error;}
    this.changed();this.schedule();return this.snapshot();
  }
  async reorder(ids){
    if(!Array.isArray(ids)||ids.length!==this.accounts.length||new Set(ids).size!==ids.length||ids.some(id=>!this.accounts.some(a=>a.id===id)))throw new Error('账号顺序无效');
    const before=this.accounts.slice();this.accounts=ids.map(id=>this.accounts.find(a=>a.id===id));
    try{await this.save();}catch(error){this.accounts=before;throw error;}this.changed();return this.snapshot();
  }
  async retryAccount(id){delete this.state.blocked[id];await this.save();this.changed();return this.snapshot();}
  async configure(patch){
    const before=this.policy;this.policy=settings({...this.policy,...patch});this.cancelCycle();this.state.failures=0;
    try{await this.save();}catch(error){this.policy=before;this.schedule();throw error;}this.changed();this.schedule();return this.snapshot();
  }
  async start(){
    if(!this.policy.ssid||(this.wifi.ssid&&this.wifi.verifiedRevision!==this.wifi.revision))throw new Error('请先在无线网络页面保存并验证连接');
    if(this.state.running)return this.snapshot();this.state.running=true;
    const generation=this.generation;
    try{await this.save();}catch(error){this.state.running=false;throw error;}
    if(!this.state.running||this.generation!==generation)return this.snapshot();
    this.event('info','monitorStarted','自动监测已启用');this.beginCheck();return this.snapshot();
  }
  beginCheck(options={}){
    void this.check(options).catch(()=>{this.state.running=false;this.state.status='error';this.cancelCycle();this.changed();}).finally(()=>this.schedule());
    return this.snapshot();
  }
  async stop(){this.state.running=false;this.cancelCycle();this.state.status='paused';this.state.nextCheckAt=null;this.state.failures=0;await this.save();this.event('info','monitorStopped','自动重连已暂停，重新打开界面或重启后台仍保持暂停');return this.snapshot();}
  cancelCycle(){this.generation++;clearTimeout(this.timer);this.timer=null;this.controller?.abort();}
  dispose(){this.cancelCycle();}
  schedule(){
    clearTimeout(this.timer);if(!this.state.running)return;
    const wait=this.state.status==='confirming'?this.policy.confirmInterval:this.policy.checkInterval;
    this.state.nextCheckAt=this.now()+wait*1000;
    this.timer=setTimeout(async()=>{await this.check();this.schedule();},wait*1000/ (this.transport.timeScale||1));
    this.timer.unref?.();this.changed();
  }
  eligible() {
    const list=this.accounts.filter(a=>a.enabled && this.state.blocked[a.id]?.revision!==a.revision);
    const preferred=this.state.lastSuccessId||this.state.activeId;
    return list.find(a=>a.id===preferred)||list[0]||null;
  }
  cooldownRemaining(){return Math.max(0,Math.ceil((Math.max(this.state.lastLoginAt?this.state.lastLoginAt+this.policy.loginCooldown*1000:0,this.state.globalBlockedUntil)-this.now())/1000));}
  async check({readOnly=false,manualLogin=false,refreshStats=false}={}) {
    if(this.busy)return this.snapshot();
    this.busy=true;const generation=this.generation;const controller=new AbortController();this.controller=controller;
    const signal=controller.signal;const current=()=>{if(signal.aborted||generation!==this.generation)throw new Error('Cancelled');};
    this.state.status='checking';this.changed();
    try {
      if(!this.policy.ssid){this.state.status='wifiUnconfigured';return this.snapshot();}
      const context=await this.transport.context(this.policy,signal);current();this.state.network=context;
      if(context.legacyRunning && !this.transport.simulated){this.clearObservation();this.state.status='legacyConflict';return this.snapshot();}
      if(!context.link){
        this.clearObservation();this.state.failures=0;this.state.ipv4='unavailable';this.state.ipv6='unavailable';this.state.status='wifiDisconnected';
        if(!readOnly && this.state.running && this.policy.autoWifi && this.now()-this.state.lastWifiAt>=this.policy.wifiRetry*1000){
          if(this.wifi.ssid&&this.wifi.verifiedRevision!==this.wifi.revision){this.state.status='wifiUnconfigured';return this.snapshot();}
          this.state.lastWifiAt=this.now();await this.save();await this.transport.connectWifi(context,this.policy,signal,this.wifi);current();
          this.state.status='connectingWifi';this.event('info','wifiConnectRequested','已请求连接系统保存的 Wi-Fi 配置');
        }return this.snapshot();
      }
      if(context.ssid!==this.policy.ssid){this.clearObservation();this.state.status='wrongNetwork';this.state.failures=0;return this.snapshot();}
      if(!context.routeOk||!context.source4){this.clearObservation();this.state.status='routeMismatch';this.state.failures=0;return this.snapshot();}
      if(this.transport.simulated)this.transport.owner=this.accounts.find(a=>a.id===this.state.lastSuccessId)?.username||this.accounts[0]?.username||'demo_student_a';
      const auth=await this.transport.auth(context,signal);current();this.state.campus=auth.state;
      const match=this.accounts.find(a=>a.username.toLowerCase()===String(auth.uid).toLowerCase());
      this.state.activeId=auth.state==='online'&&match?match.id:null;
      if(match && auth.state==='online'){this.state.activeId=match.id;this.state.lastSuccessId=match.id;}
      // A confirmed offline portal takes the short recovery path. External probes
      // cannot improve that decision and must not delay the next confirmation.
      const [v4,v6]=auth.state==='offline'?[{state:'notChecked'},{state:'notChecked'}]:await Promise.all([
        this.transport.probe4(context,signal),
        context.source6?this.transport.probe6(context,signal):Promise.resolve({state:'noAddress'})
      ]);current();
      this.state.ipv4=v4.state;this.state.ipv6=v6.state;
      this.state.lastResult={auth:auth.state,ipv4:v4,ipv6:v6};
      if(auth.state==='online'&&match && (refreshStats||!this.state.stats[match.id]?.updatedAt||this.now()-this.state.stats[match.id].updatedAt>this.policy.statsInterval*1000)){
        try{const stats=await this.transport.stats(context,match.username,signal);current();
          if(!this.acceptStatistics(match.id,stats))return this.snapshot();}
        catch(error){current();if(!this.state.stats[match.id])this.state.stats[match.id]={balance:null,ipv4MB:null,ipv6MB:null,state:'unavailable',updatedAt:null,period:'校方未提供统计周期'};}
      }
      const healthy=v4.state==='online'&&auth.state==='online';
      const v6NeedsRepair=this.policy.ipv6Recovery && v6.state==='intercepted' && v6.confirmed===true && Boolean(context.source6);
      if(healthy&&!manualLogin&&!v6NeedsRepair){this.state.failures=0;this.state.status=v6.state==='online'?'online':'degraded';return this.snapshot();}
      if(auth.state==='unknown'&&v4.state==='online'&&!manualLogin){this.state.failures=0;this.state.status='authUnknown';return this.snapshot();}
      if(auth.state==='unknown'&&v4.state!=='intercepted'&&v6.state!=='intercepted'&&!manualLogin){this.state.failures=0;this.state.status='authUnknown';return this.snapshot();}
      if(['tlsError','toolError'].includes(v4.state)&&auth.state!=='offline'&&!manualLogin){this.state.failures=0;this.state.status=v4.state;return this.snapshot();}
      if(v4.state==='dns'&&auth.state==='online'&&!manualLogin){this.state.failures=0;this.state.status='dnsError';return this.snapshot();}
      if(!readOnly)this.state.failures++;
      if(readOnly || (!this.state.running&&!manualLogin)){this.state.status='confirming';return this.snapshot();}
      if(!manualLogin&&this.state.failures<this.policy.failureThreshold){this.state.status='confirming';return this.snapshot();}
      if(this.state.lastLoginAt>this.now()+600000){this.state.status='needsUser';this.event('warning','clockChanged','系统时间与上次认证记录不一致，请先核对系统时钟');return this.snapshot();}
      if(this.cooldownRemaining()>0){this.state.status='cooldown';return this.snapshot();}
      const chosen=this.eligible();
      if(!chosen){this.state.status=this.accounts.length?'noEligibleAccount':'noAccounts';return this.snapshot();}
      if(!this.transport.simulated&&(chosen.username.startsWith('demo_')||chosen.password.startsWith('DEMO-ONLY-'))){this.state.status='noEligibleAccount';this.event('warning','demoCredentialBlocked','演示账号不会提交到真实校园网，请先替换为有效账号');return this.snapshot();}
      // Re-read route/SSID immediately before any password submission.
      const fresh=await this.transport.context(this.policy,signal);current();
      if(!fresh.link||fresh.ssid!==this.policy.ssid||!fresh.routeOk||fresh.source4!==context.source4||fresh.source6!==context.source6){this.state.status='routeMismatch';this.state.failures=0;return this.snapshot();}
      this.state.loginAccountId=chosen.id;this.state.lastLoginAt=this.now();this.state.status='loggingIn';
      await this.save();current();this.event('info','loginAttempt','正在向校园认证提交一次登录',{account:masked(chosen.username),ipv6Included:Boolean(fresh.source6)});
      const result=await this.transport.login(fresh,chosen,signal);current();this.state.status='verifying';this.changed();
      for(const delay of [2,3,5]){
        await this.sleep(delay*1000/(this.transport.timeScale||1),signal);current();
        const after=await this.transport.auth(fresh,signal);current();
        const check4=after.state==='offline'?{state:'notChecked'}:await this.transport.probe4(fresh,signal);current();
        this.state.campus=after.state;this.state.ipv4=check4.state;
        this.state.activeId=after.state==='online'?this.accounts.find(a=>a.username.toLowerCase()===String(after.uid).toLowerCase())?.id||null:null;
        if(after.state==='online'&&check4.state==='online'&&after.uid.toLowerCase()===chosen.username.toLowerCase()){
          const check6=fresh.source6?await this.transport.probe6(fresh,signal):{state:'noAddress'};current();
          this.state.ipv6=check6.state;this.state.failures=0;this.state.activeId=chosen.id;this.state.lastSuccessId=chosen.id;delete this.state.blocked[chosen.id];
          this.state.status=check6.state==='online'?'online':'degraded';
          this.event('success','recovered','校园认证和 IPv4 已恢复，IPv6 结果已单独核验',{response:result.kind,ipv6:check6.state});
          try{const stats=await this.transport.stats(fresh,chosen.username,signal);current();if(!this.acceptStatistics(chosen.id,stats))return this.snapshot();}catch(error){current();}
          return this.snapshot();
        }
      }
      if(['credential','quota','restricted'].includes(result.kind)){
        this.state.blocked[chosen.id]={revision:chosen.revision,reason:result.kind,at:this.now()};
        this.state.status=result.kind;
        this.event('warning','accountUnavailable','当前账号已暂停自动尝试；备用账号将在冷却结束后按顺序尝试',{reason:result.kind,backupAvailable:Boolean(this.eligible())});
      }else if(['rateLimited','deviceLimit','needsUser'].includes(result.kind)){
        this.state.status=result.kind;this.state.globalBlockedUntil=this.now()+Math.max(this.policy.loginCooldown,600)*1000;
        this.event('warning','campusRequiresAttention','校园认证要求等待或人工处理，保持当前账号，不轮换绕过限制',{reason:result.kind});
      }else{this.state.status='cooldown';this.event('warning','notRecovered','本次登录后尚未确认恢复，等待冷却后重新检测',{response:result.kind});}
      return this.snapshot();
    }catch(error){
      if(!signal.aborted&&generation===this.generation){
        this.clearObservation();this.state.network=null;
        if(error.code==='authRejected'){
          this.wifi.verifiedRevision=null;this.wifi.validation={state:'authRejected',at:this.now()};this.state.running=false;this.state.status='wifiUnconfigured';
          this.event('warning','wirelessAuthenticationRejected','无线认证失败，已停止自动重连。请更新无线密码并重新验证。');
        }else{this.state.status='error';this.event('warning','checkFailed','本次检测未完成，未追加认证请求');}
      }
      return this.snapshot();
    }finally{
      if(generation===this.generation)this.state.lastCheckedAt=this.now();
      this.busy=false;this.state.loginAccountId=null;if(this.controller===controller)this.controller=null;
      if(generation===this.generation)this.event('info','cycleComplete','检测完成',{
        status:this.state.status,campus:this.state.campus,ipv4:this.state.ipv4,ipv6:this.state.ipv6,
        consecutiveFailures:this.state.failures,nextLoginInSeconds:this.cooldownRemaining(),
        interface:this.state.network?.interface||'',ipv6Source:this.state.network?.source6||'',
        readOnly,manualLogin
      });
      await this.save();this.changed();
    }
  }
  diagnostics(){
    const s=this.snapshot();
    return {version:require('../package.json').version,mode:s.mode,exportedAt:new Date(this.now()).toISOString(),
      status:s.status,campus:s.campus,ipv4:s.ipv4,ipv6:s.ipv6,network:s.network,settings:s.settings,
      accounts:this.accounts.map(a=>({id:a.id,account:masked(a.username),enabled:a.enabled,blocked:this.state.blocked[a.id]?.reason||null})),
      lastCheckedAt:s.lastCheckedAt,lastLoginAt:s.lastLoginAt,logs:s.logs};
  }
}

class SimulationTransport {
  constructor(){this.simulated=true;this.timeScale=10;this.scene='healthy';this.loggedIn=false;this.loggedAccount='';this.loginCalls=0;this.owner='';}
  setScene(scene){
    const allowed=['healthy','campusOffline','ipv4Failure','ipv6Intercepted','badPassword','quota','dns','wifiDown','rateLimited','deviceLimit','htmlReply','unmanagedAccount','authUnavailable'];
    if(!allowed.includes(scene))throw new Error('演练场景不支持');
    this.scene=scene;this.loggedIn=false;this.loggedAccount='';
  }
  async context(policy={}){return {link:this.scene!=='wifiDown',ssid:policy.ssid||'演练无线网络',interface:process.platform==='win32'?'WLAN':'en0',routeOk:true,source4:'192.0.2.10',source6:'2001:db8:208:243::10',simulated:true};}
  async connectWifi(_info,_policy,_signal,configuration={}){if(configuration.password?.endsWith('-wrong'))throw Object.assign(new Error('MockRejected'),{code:'authRejected'});this.scene='campusOffline';}
  async auth(){
    if(this.scene==='authUnavailable')return {state:'unknown',uid:''};
    if(this.scene==='unmanagedAccount')return {state:'online',uid:'demo_unmanaged_user'};
    const off=['campusOffline','ipv4Failure','badPassword','quota','rateLimited','deviceLimit','htmlReply'].includes(this.scene)&&!this.loggedIn;
    return {state:off?'offline':'online',uid:this.loggedAccount||this.owner||'demo_student_a',ipv4:'192.0.2.10',ipv6:this.scene==='ipv6Intercepted'&&!this.loggedIn?'::':'2001:db8:208:243::10'};
  }
  async probe4(){return {state:this.scene==='authUnavailable'?'unavailable':this.scene==='dns'?'dns':(!this.loggedIn&&['campusOffline','ipv4Failure','badPassword','quota','rateLimited','deviceLimit','htmlReply'].includes(this.scene))?'unavailable':'online',httpStatus:200,certificateValid:true,simulated:true};}
  async probe6(){return {state:this.scene==='authUnavailable'?'unavailable':this.scene==='dns'?'dns':(!this.loggedIn&&!['healthy','unmanagedAccount'].includes(this.scene))?'intercepted':'online',confirmed:this.scene!=='authUnavailable',httpStatus:200,certificateValid:this.loggedIn||['healthy','unmanagedAccount'].includes(this.scene),simulated:true};}
  async login(context,item){
    this.loginCalls++;
    if(['badPassword','quota'].includes(this.scene)&&item.username.endsWith('_a'))return {kind:this.scene==='quota'?'quota':'credential'};
    if(['rateLimited','deviceLimit'].includes(this.scene))return {kind:this.scene};
    this.loggedIn=true;this.loggedAccount=item.username;return {kind:this.scene==='htmlReply'?'htmlOrUnknown':'accepted'};
  }
  async stats(){return {balance:18.66,ipv4MB:2457.6,ipv6MB:8806.4,updatedAt:Date.now(),state:'available',period:'模拟数据，不代表真实账单',source:'模拟模式',currency:'CNY',simulated:true};}
}

module.exports={Engine,SimulationTransport};
