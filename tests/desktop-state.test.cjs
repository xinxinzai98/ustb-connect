'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {draftData,desktopSnapshot,requireDesktopAction}=require('../src/desktop-state.cjs');
test('production setup preserves credentials but drops demonstration data and local verification claims',()=>{
  const saved={accounts:[{username:'fixture_real',password:'FAKE-REAL-KEY'},{username:'demo_student_a',password:'DEMO-ONLY-A-NOT-REAL'}],wifi:{ssid:'Test WiFi',password:'FAKE-WIFI-KEY',verifiedRevision:'old',validation:{state:'verified'}},runtime:{running:true,stats:{a:{balance:123}}}};
  const data=draftData(saved);assert.equal(data.accounts.length,1);assert.equal(data.accounts[0].password,'FAKE-REAL-KEY');assert.equal(data.wifi.password,'FAKE-WIFI-KEY');assert.equal(data.wifi.verifiedRevision,null);assert.deepEqual(data.runtime,{});assert.equal(saved.accounts.length,2);
  const demo=draftData({wifi:{ssid:'示例无线网络',password:'DEMO-ONLY-WIFI'},settings:{ssid:'示例无线网络'}});assert.equal(demo.settings.ssid,'');assert.deepEqual(demo.wifi,{});
});
test('a disconnected desktop cannot present cached connectivity or billing as current',()=>{
  const old={mode:'system',activeId:'a',campus:'online',ipv4:'online',ipv6:'online',running:true,lastCheckedAt:123,stats:{a:{balance:99}}};
  for(const mode of ['setup','system']){const value=desktopSnapshot(old,{mode,connected:false,preview:false});assert.equal(value.running,false);assert.equal(value.activeId,null);assert.equal(value.ipv4,'notChecked');assert.deepEqual(value.stats,{});assert.equal(value.lastCheckedAt,null);}
  assert.equal(desktopSnapshot(old,{mode:'system',connected:true,preview:false}),old);
  const demo={...old,mode:'simulation'};assert.deepEqual(desktopSnapshot(demo,{mode:'system',connected:true,preview:false}).stats,{});
});
test('network and unknown actions require a real backend while local configuration remains available',()=>{
  const setup={mode:'setup',connected:false,preview:false};
  for(const method of ['check','login','start','verifyWifi','unexpected'])assert.throws(()=>requireDesktopAction(method,setup),/后台服务/);
  for(const method of ['settings','upsertAccount','saveWifi','stop'])assert.doesNotThrow(()=>requireDesktopAction(method,setup));
  assert.throws(()=>requireDesktopAction('upsertAccount',{mode:'system',connected:false,preview:false}),/后台服务/);
  assert.doesNotThrow(()=>requireDesktopAction('login',{mode:'system',connected:true,preview:false}));
  assert.doesNotThrow(()=>requireDesktopAction('check',{mode:'simulation',connected:false,preview:true}));
});
