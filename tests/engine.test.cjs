'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {Engine,SimulationTransport}=require('../src/engine.cjs');const {account}=require('../src/model.cjs');
function fixture(scene='healthy',extra={}){
  let clock=1800000000000;const transport=new SimulationTransport();transport.timeScale=1;transport.setScene(scene);
  const accounts=[account({username:'demo_student_a',password:'secret-a'}),account({username:'demo_student_b',password:'secret-b'})];
  const saves=[];const engine=new Engine({transport,data:{accounts,settings:{ssid:'BKQL'},...extra},now:()=>clock,persist:async v=>saves.push(structuredClone(v)),sleep:async()=>{}});
  return {engine,transport,accounts,saves,advance:seconds=>{clock+=seconds*1000;}};
}
async function failingRounds(engine,n=3){for(let i=0;i<n;i++)await engine.check();}

test('healthy network does not submit or switch accounts',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());engine.state.running=true;
  await failingRounds(engine,4);assert.equal(transport.loginCalls,0);assert.equal(engine.state.status,'online');
  assert.equal(engine.state.lastSuccessId,engine.accounts[0].id);
});
test('read-only checks do not confirm failures, submit or reconnect Wi-Fi',async t=>{
  const {engine,transport}=fixture('campusOffline');t.after(()=>engine.dispose());engine.state.running=true;
  for(let i=0;i<5;i++)await engine.check({readOnly:true});
  assert.equal(transport.loginCalls,0);assert.equal(engine.state.failures,0);
  transport.setScene('wifiDown');let connections=0;transport.connectWifi=async()=>connections++;
  await engine.check({readOnly:true});assert.equal(connections,0);
});
test('confirmed campus logout uses short confirmation path and one POST',async t=>{
  const {engine,transport,saves}=fixture('campusOffline');t.after(()=>engine.dispose());engine.state.running=true;
  let probes=0;const old=transport.probe6.bind(transport);transport.probe6=async(...args)=>{probes++;return old(...args);};
  await failingRounds(engine,2);assert.equal(probes,0);assert.equal(transport.loginCalls,0);
  await engine.check();assert.equal(transport.loginCalls,1);assert.equal(engine.state.status,'online');
  assert.ok(saves.some(v=>v.runtime.lastLoginAt>0));assert.equal(probes,1);
  assert.equal(engine.logs.filter(x=>x.code==='cycleComplete').length,3);
});
test('global cooldown survives an engine restart and applies to manual login',async t=>{
  const f=fixture('campusOffline');t.after(()=>f.engine.dispose());f.engine.state.running=true;await failingRounds(f.engine);
  const saved=f.saves.at(-1);const transport=new SimulationTransport();transport.timeScale=1;transport.setScene('campusOffline');
  const copy=new Engine({transport,data:saved,now:()=>1800000000001,sleep:async()=>{}});t.after(()=>copy.dispose());
  await copy.check({manualLogin:true});assert.equal(transport.loginCalls,0);assert.equal(copy.state.status,'cooldown');
});
for(const scene of ['badPassword','quota'])test(`${scene}: only an explicit account failure enables backup after cooldown`,async t=>{
  const {engine,transport,advance}=fixture(scene);t.after(()=>engine.dispose());engine.state.running=true;
  await failingRounds(engine);assert.equal(transport.loginCalls,1);assert.ok(engine.state.blocked[engine.accounts[0].id]);
  await engine.check({manualLogin:true});assert.equal(transport.loginCalls,1);
  advance(301);await engine.check();assert.equal(transport.loginCalls,2);assert.equal(engine.state.lastSuccessId,engine.accounts[1].id);
});
for(const scene of ['dns','rateLimited','deviceLimit'])test(`${scene}: no account rotation`,async t=>{
  const {engine,transport,advance}=fixture(scene);t.after(()=>engine.dispose());engine.state.running=true;
  const submitted=[];const login=transport.login.bind(transport);transport.login=async(info,item,signal)=>{submitted.push(item.username);return login(info,item,signal);};
  await failingRounds(engine);advance(301);await engine.check();
  assert.equal(Object.keys(engine.state.blocked).length,0);assert.ok(submitted.every(value=>value===engine.accounts[0].username));
  assert.equal(engine.state.activeId,scene==='dns'?engine.accounts[0].id:null);
  assert.equal(transport.loginCalls,scene==='dns'?0:1);
});
test('IPv6-only recovery is opt-in and requires confirmed campus interception',async t=>{
  const f=fixture('ipv6Intercepted');t.after(()=>f.engine.dispose());f.engine.state.running=true;
  await failingRounds(f.engine,4);assert.equal(f.transport.loginCalls,0);assert.equal(f.engine.state.status,'degraded');
  await f.engine.configure({ipv6Recovery:true});await failingRounds(f.engine);assert.equal(f.transport.loginCalls,1);
  assert.equal(f.engine.state.ipv6,'online');
});
test('unconfirmed IPv6 and TLS failures never trigger automatic credentials',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());engine.state.running=true;engine.policy.ipv6Recovery=true;
  transport.probe6=async()=>({state:'intercepted',confirmed:false});await failingRounds(engine);
  transport.probe4=async()=>({state:'tlsError'});await failingRounds(engine);
  assert.equal(transport.loginCalls,0);
});
test('missing IPv6 does not prevent IPv4 authentication recovery',async t=>{
  const {engine,transport}=fixture('campusOffline');t.after(()=>engine.dispose());engine.state.running=true;
  const original=transport.context.bind(transport);transport.context=async(...args)=>({...await original(...args),source6:''});
  await failingRounds(engine);assert.equal(transport.loginCalls,1);assert.equal(engine.state.status,'degraded');assert.equal(engine.state.ipv6,'noAddress');
});
for(const mismatch of ['ssid','routeOk','legacyRunning'])test(`route safety: ${mismatch} blocks password submission`,async t=>{
  const {engine,transport}=fixture('campusOffline');t.after(()=>engine.dispose());engine.state.running=true;
  const orig=transport.context.bind(transport);transport.context=async(...args)=>({...await orig(...args),[mismatch]:mismatch==='ssid'?'Other':mismatch==='routeOk'?false:true});
  if(mismatch==='legacyRunning')transport.simulated=false;
  await engine.check({manualLogin:true});assert.equal(transport.loginCalls,0);
});
test('HTML response is verified using actual authentication and HTTPS',async t=>{
  const {engine,transport}=fixture('htmlReply');t.after(()=>engine.dispose());engine.state.running=true;
  await failingRounds(engine);assert.equal(engine.state.status,'online');assert.equal(transport.loginCalls,1);
  assert.equal(engine.logs.find(x=>x.code==='recovered').detail.response,'htmlOrUnknown');
});
test('a claimed success without restored connectivity is not success',async t=>{
  const {engine,transport}=fixture('campusOffline');t.after(()=>engine.dispose());engine.state.running=true;
  transport.login=async()=>({kind:'accepted'});await failingRounds(engine);
  assert.notEqual(engine.state.status,'online');assert.equal(engine.logs.some(x=>x.code==='recovered'),false);
});
test('stop aborts an in-flight cycle and prevents subsequent login',async t=>{
  const {engine,transport}=fixture('campusOffline');t.after(()=>engine.dispose());engine.state.running=true;
  let entered;const waiting=new Promise(r=>entered=r);
  transport.auth=async(_c,signal)=>{entered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancel')),{once:true}));};
  const cycle=engine.check({manualLogin:true});await waiting;await engine.stop();await cycle;
  assert.equal(engine.state.status,'paused');assert.equal(engine.state.running,false);assert.equal(transport.loginCalls,0);
});
test('parallel detection and manual requests never duplicate a POST',async t=>{
  const {engine,transport}=fixture('campusOffline');t.after(()=>engine.dispose());engine.state.running=true;
  await Promise.all([engine.check({manualLogin:true}),engine.check({manualLogin:true}),engine.check()]);
  assert.equal(transport.loginCalls,1);
});
test('failed credential save rolls back and diagnostics contain no password',async t=>{
  const {engine}=fixture();t.after(()=>engine.dispose());const original=engine.accounts[0];
  engine.persist=async()=>{throw new Error('locked');};
  await assert.rejects(engine.upsert({...original,password:'new-secret'}));assert.equal(engine.accounts[0].password,original.password);
  const raw=JSON.stringify(engine.diagnostics());assert.equal(raw.includes('secret-a'),false);assert.equal(raw.includes('demo_student_a'),false);
});
test('cached usage survives restart and an account rename clears attribution',async t=>{
  const {engine,saves}=fixture();t.after(()=>engine.dispose());await engine.check({readOnly:true,refreshStats:true});
  const saved=saves.at(-1);assert.equal(saved.runtime.stats[engine.accounts[0].id].balance,18.66);
  const a=engine.accounts[0];await engine.upsert({...a,username:'another_student'});assert.equal(engine.state.stats[a.id],undefined);
});
