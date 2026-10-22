'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {wifi,publicWifi}=require('../src/model.cjs');const {Engine,SimulationTransport}=require('../src/engine.cjs');
function fixture(){const transport=new SimulationTransport();const saves=[];return {transport,saves,engine:new Engine({transport,persist:async v=>saves.push(structuredClone(v)),sleep:async()=>{}})};}
test('sharing defaults to no SSID and performs no scan or join before configuration',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());let reads=0;transport.context=async()=>{reads++;throw new Error('must not run');};
  await engine.check();await assert.rejects(engine.start());assert.equal(engine.state.status,'wifiUnconfigured');assert.equal(engine.policy.ssid,'');assert.equal(reads,0);
});
test('wireless input validation, open networks and blank-password editing',()=>{
  assert.throws(()=>wifi({ssid:'宿舍'.repeat(6),security:'wpa2',password:'12345678'}));
  assert.throws(()=>wifi({ssid:'Home',security:'wpa2',password:'123'}));
  const a=wifi({ssid:'Home',security:'wpa2',password:'test-private-key'});a.verifiedRevision=a.revision;
  const b=wifi({ssid:'Home',security:'wpa2',password:''},a);assert.equal(b.password,a.password);assert.equal(b.verifiedRevision,a.revision);
  assert.throws(()=>wifi({ssid:'Another home',security:'wpa2',password:''},a));
  const c=wifi({ssid:'Another home',security:'wpa2',password:'another-private-key'},a);assert.equal(c.verifiedRevision,null);
  assert.equal(wifi({ssid:'OpenCampus',security:'open',password:''}).password,'');
  assert.equal(Object.hasOwn(publicWifi(a),'password'),false);
});
test('saving a Wi-Fi password is not validation; validation never logs campus accounts in',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());
  await engine.saveWifi({ssid:'Friends apartment',security:'wpa2',password:'wireless-test-key'});
  assert.equal(engine.snapshot().wifi.verified,false);assert.equal(JSON.stringify(engine.snapshot()).includes('wireless-test-key'),false);
  await assert.rejects(engine.start());
  await engine.validateWifi();assert.equal(engine.snapshot().wifi.verified,true);assert.equal(engine.snapshot().wifi.validation.campus,'offline');
  assert.equal(transport.loginCalls,0);assert.equal(JSON.stringify(engine.diagnostics()).includes('wireless-test-key'),false);
});
test('incorrect password does not become a verified saved credential',async t=>{
  const {engine}=fixture();t.after(()=>engine.dispose());await engine.saveWifi({ssid:'Friends apartment',security:'wpa2',password:'test-key-wrong'});
  await engine.validateWifi();assert.equal(engine.snapshot().wifi.verified,false);assert.equal(engine.snapshot().wifi.validation.state,'authRejected');
});
test('an already-connected profile cannot validate a different password/profile',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.saveWifi({ssid:'Friends apartment',security:'wpa2',password:'new-unproven-key'});
  transport.connectWifi=async()=>({profile:'USTB-new-profile'});const original=transport.context.bind(transport);
  transport.context=async(...args)=>({...await original(...args),profile:'old-correct-profile'});
  await engine.validateWifi();assert.equal(engine.snapshot().wifi.verified,false);assert.equal(engine.snapshot().wifi.validation.state,'notConnected');
});
test('no DHCP address or missing route is not a full campus verification',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.saveWifi({ssid:'OpenCampus',security:'open',password:''});
  const original=transport.context.bind(transport);transport.context=async(...args)=>({...await original(...args),source4:''});
  await engine.validateWifi();assert.equal(engine.snapshot().wifi.verified,false);assert.equal(engine.snapshot().wifi.validation.state,'noAddress');
  transport.context=async(...args)=>({...await original(...args),routeOk:false});await engine.validateWifi();
  assert.equal(engine.snapshot().wifi.validation.state,'routeMismatch');
});
test('unverified wireless credentials cannot be used by automatic reconnect',async t=>{
  const {engine,transport}=fixture();t.after(()=>engine.dispose());await engine.saveWifi({ssid:'OpenCampus',security:'open',password:''});
  engine.state.running=true;transport.setScene('wifiDown');let calls=0;transport.connectWifi=async()=>calls++;
  await engine.check();assert.equal(calls,0);assert.equal(engine.state.status,'wifiUnconfigured');
});
