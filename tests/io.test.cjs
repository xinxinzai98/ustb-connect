'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const zlib=require('node:zlib');
const {Engine,SimulationTransport}=require('../src/engine.cjs');const {serve,call,equalToken}=require('../src/control.cjs');
const {DraftStore,atomic,recentLogs}=require('../src/store.cjs');const {request,decode}=require('../src/transport.cjs');
test('historical log reader keeps recent complete records after a partial line',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bkql-logs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'log.jsonl');const rows=Array.from({length:240},(_,i)=>JSON.stringify({time:i,level:'info',code:'cycleComplete',message:'检测完成'}));
  fs.writeFileSync(file,rows.join('\n')+'\n{"partial":');const saved=recentLogs(file);
  assert.equal(saved.length,200);assert.equal(saved[0].time,40);assert.equal(saved.at(-1).time,239);
});
test('compressed/Chinese responses are decoded and decompression is bounded',()=>{
  const text='{"msg":"账号余额不足"}';assert.equal(decode(zlib.gzipSync(text),{'content-encoding':'gzip'}),text);
  assert.throws(()=>decode(zlib.gzipSync(Buffer.alloc(300000)),{'content-encoding':'gzip'}));
});
test('encrypted draft has no plaintext fallback and locked store is preserved',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bkql-draft-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const data={accounts:[{username:'demo',password:'private-fixture-8291'}],settings:{ssid:'BKQL'},wifi:{},runtime:{running:false}};
  const store=new DraftStore(root,{encrypt:async value=>Buffer.from(value).reverse(),decrypt:async bytes=>Buffer.from(bytes).reverse().toString()});
  await store.save(data);const text=fs.readFileSync(path.join(root,'preferences.json'),'utf8');assert.equal(text.includes('private-fixture-8291'),false);
  assert.deepEqual(await store.load(),data);store.encrypt=async()=>{throw new Error('locked');};
  await assert.rejects(store.save({...data,accounts:[{password:'new'}]}));assert.equal(fs.readFileSync(path.join(root,'preferences.json'),'utf8'),text);
  fs.symlinkSync(path.join(root,'preferences.json'),path.join(root,'link'));assert.throws(()=>atomic(path.join(root,'link'),'bad'));
});
test('local HTTP fixture: no redirects, explicit address and hard timeout',async t=>{
  const server=http.createServer((req,res)=>{if(req.url==='/slow')return;if(req.url==='/redirect'){res.writeHead(302,{Location:'http://202.204.48.66/'});res.end();return;}res.end('fixture');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const r=await request(base,{localAddress:'127.0.0.1'});assert.equal(r.text,'fixture');assert.equal(r.localIP,'127.0.0.1');
  assert.equal((await request(base+'/redirect')).status,302);
  await assert.rejects(request(base+'/slow',{timeout:25}));
  await assert.rejects(request('http://user:secret@127.0.0.1/'));
});
test('a Wi-Fi-only draft also encrypts its password',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ustb-wifi-vault-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new DraftStore(root,{encrypt:async value=>Buffer.from(value).reverse(),decrypt:async bytes=>Buffer.from(bytes).reverse().toString()});
  const value={accounts:[],wifi:{ssid:'Friends WiFi',password:'wireless-private-fixture'},settings:{ssid:'Friends WiFi'},runtime:{}};
  await store.save(value);assert.equal(fs.readFileSync(path.join(root,'preferences.json'),'utf8').includes('wireless-private-fixture'),false);assert.deepEqual(await store.load(),value);
});
test('controller rejects other origins, wrong tokens and unknown commands; exposes no secrets',async t=>{
  const engine=new Engine({transport:new SimulationTransport()});t.after(()=>engine.dispose());
  await engine.upsert({username:'demo_a',password:'private-test-secret'});
  const token='a'.repeat(64);const server=await serve(engine,{token,port:0});t.after(()=>{server.closeAllConnections();server.close();});
  const port=server.address().port;
  const value=await call('status',{}, {port,token});assert.equal(value.version,require('../package.json').version);assert.equal(JSON.stringify(value).includes('private-test-secret'),false);
  const raw=(endpoint,headers={})=>new Promise(resolve=>{const q=http.request({hostname:'127.0.0.1',port,path:endpoint,method:'POST',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});q.end('{}');});
  assert.equal(await raw('/status',{'X-BKQL-Token':'b'.repeat(64)}),403);
  assert.equal(await raw('/status',{'X-BKQL-Token':token,Origin:'http://untrusted.invalid'}),403);
  assert.equal(await raw('/shell',{'X-BKQL-Token':token}),404);
  assert.equal(equalToken('中'.repeat(64),token),false);
  assert.throws(()=>serve(engine,{token,host:'0.0.0.0'}));
});
test('controller can stop an in-flight start without waiting for network timeout',async t=>{
  const transport=new SimulationTransport();let entered;const gate=new Promise(r=>entered=r);
  transport.auth=async(_info,signal)=>{entered();return new Promise((_r,j)=>signal.addEventListener('abort',()=>j(new Error('cancel')),{once:true}));};
  const engine=new Engine({transport,data:{settings:{ssid:'演练无线网络'}}});const token='c'.repeat(64);const server=await serve(engine,{token,port:0});
  t.after(()=>{engine.dispose();server.closeAllConnections();server.close();});const connection={port:server.address().port,token};
  await call('start',{},connection);await gate;const result=await call('stop',{},connection);
  assert.equal(result.running,false);assert.equal(result.status,'paused');
});
