'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const P=require('../src/protocol.cjs');const M=require('../src/model.cjs');

test('JSONP accepts data only, never executes script',()=>{
  assert.equal(P.authState('dr1002({"result":1,"uid":"demo_a","v6ip":"2001:db8::10"});').state,'online');
  assert.equal(P.authState('{"result":0}').state,'offline');
  assert.equal(P.authState('{"result":1}').state,'unknown');
  assert.equal(P.jsonp('dr1002({"result":1});process.exit()'),null);
});
test('balance uses the school prepaid flag and ten-thousandths of yuan',()=>{
  const s=P.statistics("uid='demo_a'; fsele=1; fee1=186600;",'dr1006({"result":1,"data":{"v4":"2457.6","v6":8806.4}});','demo_a',1234);
  assert.equal(s.balance,18.66);assert.equal(s.ipv4MB,2457.6);assert.equal(s.ipv6MB,8806.4);
  assert.equal(s.updatedAt,1234);assert.equal(s.period,'校方未提供统计周期');
});
test('zero, unavailable, inactive account and invalid numbers stay distinct',()=>{
  const page="uid='demo_a'; fsele=1; fee1=0;";
  assert.equal(P.statistics(page,'{"result":1,"data":{"v4":0}}','demo_a').ipv4MB,0);
  assert.equal(P.statistics(page,'{"result":1,"data":{"v4":0}}','demo_a').ipv6MB,null);
  assert.equal(P.statistics(page,'','demo_b').state,'accountMismatch');
  assert.equal(P.statistics("uid='demo_a'; fsele=0; fee1=10000;",'','demo_a').balance,null);
  assert.equal(P.statistics(page,'{"result":1,"data":{"v4":-2,"v6":"NaN"}}','demo_a').ipv4MB,null);
  assert.equal(P.literal("fee1=(function(){throw 1})();",'fee1'),null);
});
test('login form preserves special characters, includes the chosen IPv6 and no GET secret',()=>{
  const value=new URLSearchParams(P.loginForm({username:'demo+a&b',password:'p&=+%"中'},'2001:db8::10'));
  assert.equal(value.get('upass'),'p&=+%"中');assert.equal(value.get('DDDDD'),'demo+a&b');
  assert.equal(value.get('v6ip'),'2001:db8::10');assert.equal(value.get('R1'),'0');
  assert.equal(new URLSearchParams(P.loginForm({username:'a',password:'b'})).get('v6ip'),'');
  for(const ip of ['fe80::1','fd00::1','::1','192.0.2.1'])assert.throws(()=>P.loginForm({username:'a',password:'b'},ip));
});
test('portal failures separate account failures from session/device/line issues',()=>{
  for(const [message,kind] of [['密码错误','credential'],['余额不足','quota'],['账号已停用','restricted'],['在线设备数量超过上限','deviceLimit'],['操作过于频繁，请稍后','rateLimited'],['验证码错误','needsUser'],['线路暂不可用','retryable']])assert.equal(P.failureClass(message),kind,message);
  assert.equal(P.campusRedirect('http://202.204.48.82/chkuser?url=x'),true);
  assert.equal(P.campusRedirect('http://dr.com.attacker.invalid/'),false);
  assert.equal(P.campusRedirect('/relative'),false);
});
test('editing a blank password preserves it; a changed credential has a new revision',()=>{
  const a=M.account({username:'demo_a',password:'first',label:'主用'});
  const b=M.account({username:'demo_a',password:'',label:'新备注'},a);
  assert.equal(b.password,'first');assert.equal(b.revision,a.revision);
  assert.notEqual(M.account({username:'demo_a',password:'second'},a).revision,a.revision);
  assert.equal(Object.hasOwn(M.publicAccount(a),'password'),false);
  assert.throws(()=>M.settings({checkInterval:1}));assert.throws(()=>M.settings({ssid:'x\n'}));
});
test('redaction handles quotes and structured objects without corrupting JSON',()=>{
  const a={username:'demo_student',password:'p"&\\word'};
  const value=JSON.parse(M.redact({nested:{message:'demo_student used p"&\\word',password:a.password},count:3},[a]));
  assert.equal(value.nested.message,'[已隐藏] used [已隐藏]');assert.equal(value.nested.password,'[已隐藏]');assert.equal(value.count,3);
});
