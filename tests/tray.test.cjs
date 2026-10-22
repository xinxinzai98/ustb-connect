'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {trayInformation}=require('../src/tray.cjs');
const fixture=()=>({mode:'system',service:{connected:true,known:true,running:true},running:true,campus:'online',ipv4:'online',ipv6:'online',activeId:'a',accounts:[{id:'a',username:'fixture_student_main',password:'FAKE-PRIVATE-SECRET'}],lastCheckedAt:Date.UTC(2026,9,22),stats:{a:{balance:12.34,ipv4MB:1,ipv6MB:2,updatedAt:Date.UTC(2026,9,22)}}});
test('tray identifies simulation and actual backend independently without exposing credentials',()=>{
  const s=fixture();s.mode='simulation';s.running=false;const rows=trayInformation(s);const text=rows.join('\n');
  assert.ok(rows.includes('当前显示：模拟数据'));assert.ok(rows.includes('实际后台：运行中'));assert.ok(rows.includes('模拟监测：已停止'));
  assert.ok(!text.includes(s.accounts[0].username));assert.ok(!text.includes(s.accounts[0].password));assert.ok(text.includes('f***main'));
});
test('disconnected backend suppresses stale account and billing details',()=>{
  const s=fixture();s.service.connected=false;const text=trayInformation(s).join('\n');
  assert.ok(text.includes('实际后台：状态待确认'));assert.ok(text.includes('IPv4：待确认'));assert.ok(text.includes('当前账号：待确认'));
  assert.ok(!text.includes('余额：'));assert.ok(!text.includes('已用：'));assert.ok(!text.includes('f***main'));
});
test('tray preserves valid zero and MB units while omitting missing statistics',()=>{
  const s=fixture();s.stats.a={balance:0,ipv4MB:0,ipv6MB:null,updatedAt:Date.UTC(2026,9,22)};
  const rows=trayInformation(s);assert.ok(rows.includes('余额：¥ 0.00'));assert.ok(rows.includes('IPv4 已用：0 MB'));assert.ok(!rows.some(x=>x.startsWith('IPv6 已用：')));
  s.campus='unknown';assert.ok(!trayInformation(s).some(x=>x.startsWith('余额：')));
});
