'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,SimulationTransport}=require('../src/engine.cjs');
const {stopMonitoring,serve,call}=require('../src/control.cjs');
function fixture(){const transport=new SimulationTransport();const engine=new Engine({transport,data:{settings:{ssid:'Test WiFi'}},sleep:async()=>{}});return {engine,transport};}
test('unmanaged online identity does not inherit the previous account or its balance',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.upsert({username:'test_A',password:'fake-private-value'});
  transport.auth=async()=>({state:'online',uid:'test_A'});await engine.check({readOnly:true,refreshStats:true});const id=engine.accounts[0].id;
  assert.equal(engine.state.activeId,id);transport.auth=async()=>({state:'online',uid:'test_unmanaged_B'});await engine.check({readOnly:true});
  assert.equal(engine.state.activeId,null);assert.equal(engine.state.stats[id].balance,18.66);assert.equal(transport.loginCalls,0);
});
test('changing network or losing observation clears the previous successful status',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.upsert({username:'test_A',password:'fake-private-value'});
  transport.auth=async()=>({state:'online',uid:'test_A'});await engine.check({readOnly:true});
  const context=transport.context.bind(transport);transport.context=async(...args)=>({...await context(...args),ssid:'Other WiFi'});await engine.check({readOnly:true});
  assert.equal(engine.state.campus,'unknown');assert.equal(engine.state.activeId,null);assert.equal(engine.state.ipv4,'unknown');
  transport.context=async()=>{throw new Error('fixture failure');};await engine.check({readOnly:true});assert.equal(engine.state.network,null);
});
test('a statistics identity mismatch invalidates the current-account display',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.upsert({username:'test_A',password:'fake-private-value'});
  transport.auth=async()=>({state:'online',uid:'test_A'});transport.stats=async()=>({state:'accountMismatch'});await engine.check({readOnly:true,refreshStats:true});
  assert.equal(engine.state.activeId,null);assert.equal(engine.state.status,'authUnknown');
});
test('unknown authentication plus a line outage does not automatically submit a password',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.upsert({username:'test_A',password:'fake-private-value'});engine.state.running=true;
  transport.auth=async()=>({state:'unknown',uid:''});transport.probe4=transport.probe6=async()=>({state:'unavailable'});
  for(let n=0;n<5;n++)await engine.check();assert.equal(transport.loginCalls,0);assert.equal(engine.state.status,'authUnknown');
});
test('identity change during post-login statistics cannot retain the attempted account as current',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.upsert({username:'test_A',password:'fake-private-value'});
  transport.setScene('campusOffline');transport.stats=async()=>({state:'accountMismatch'});await engine.check({manualLogin:true});
  assert.equal(transport.loginCalls,1);assert.equal(engine.state.activeId,null);assert.equal(engine.state.status,'authUnknown');
});
test('global stop reaches the real service while the visible UI can be in simulation',async t=>{
  const {engine}=fixture();t.after(()=>engine.dispose());engine.state.running=true;let realRunning=true,requests=0;
  const result=await stopMonitoring(engine,{serviceCall:async method=>{assert.equal(method,'stop');requests++;realRunning=false;return {running:false};}});
  assert.equal(engine.state.running,false);assert.equal(realRunning,false);assert.equal(requests,1);assert.equal(result.ok,true);
});
test('wireless rejection after validation stops retries without rotating campus accounts',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.saveWifi({ssid:'Test WiFi',security:'wpa2',password:'fake-wireless-key'});await engine.validateWifi();
  transport.setScene('wifiDown');transport.connectWifi=async()=>{throw Object.assign(new Error('rejected'),{code:'authRejected'});};engine.state.running=true;await engine.check();
  assert.equal(engine.state.running,false);assert.equal(engine.snapshot().wifi.verified,false);assert.equal(engine.snapshot().wifi.validation.state,'authRejected');assert.equal(transport.loginCalls,0);
});
test('global stop does not report success for a missing or unresponsive acknowledgement',async t=>{
  const {engine}=fixture();t.after(()=>engine.dispose());
  for(const value of [{running:true},{},undefined]){const result=await stopMonitoring(engine,{serviceCall:async()=>value});assert.equal(result.ok,false);assert.equal(result.systemState,'unconfirmed');}
  const failed=await stopMonitoring(engine,{serviceCall:async()=>{throw new Error('offline');}});assert.equal(failed.ok,false);
});
test('isolated preview stop cannot contact a real service',async t=>{
  const {engine}=fixture();t.after(()=>engine.dispose());let called=false;
  const result=await stopMonitoring(engine,{includeService:false,serviceCall:async()=>{called=true;}});assert.equal(called,false);assert.equal(result.simulationStopped,true);
});
test('stop has priority over an in-progress account save',async t=>{
  const {engine}=fixture();t.after(()=>engine.dispose());let entered,release;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let writes=0;
  engine.persist=async()=>{if(++writes===1){entered();await gate;}};
  const token='d'.repeat(64),server=await serve(engine,{token,port:0});t.after(()=>{server.closeAllConnections();server.close();});const connection={port:server.address().port,token};
  engine.state.running=true;const save=call('upsertAccount',{username:'test_A',password:'fake-private-value'},connection);await started;
  const stopped=await call('stop',{},connection);assert.equal(stopped.running,false);release();await save;assert.equal(engine.state.running,false);
});
test('stopping during startup prevents a delayed initial network check',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());let entered,release;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let writes=0,reads=0;
  engine.persist=async()=>{if(++writes===1){entered();await gate;}};transport.context=async()=>{reads++;throw new Error('must not read');};
  const starting=engine.start();await started;await engine.stop();release();await starting;assert.equal(reads,0);assert.equal(engine.state.running,false);
});
test('a failed wireless save cannot restore monitoring after a concurrent stop',async t=>{
  const {engine}=fixture();t.after(()=>engine.dispose());let entered,release;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let writes=0;
  engine.state.running=true;engine.persist=async()=>{if(++writes===1){entered();await gate;throw new Error('locked');}};
  const saving=engine.saveWifi({ssid:'Changed WiFi',security:'open',password:''});const rejected=assert.rejects(saving);await started;await engine.stop();release();await rejected;
  assert.equal(engine.state.running,false);assert.equal(engine.state.status,'paused');
});
