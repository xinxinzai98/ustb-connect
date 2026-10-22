'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const platform=require('./platform.cjs');
const {publicError}=require('./model.cjs');

const METHODS=new Set(['status','check','login','start','stop','settings','upsertAccount','removeAccount','reorderAccounts','retryAccount','saveWifi','verifyWifi','diagnostics']);

async function dispatch(engine,method,body={}) {
  if(!METHODS.has(method))throw new Error('操作不支持');
  switch(method){
    case 'status':return engine.snapshot();
    case 'check':return engine.beginCheck({readOnly:true,refreshStats:body.refreshStats===true});
    case 'login':return engine.beginCheck({manualLogin:true});
    case 'start':return engine.start();
    case 'stop':return engine.stop();
    case 'settings':return engine.configure(body);
    case 'upsertAccount':return engine.upsert(body);
    case 'removeAccount':return engine.remove(String(body.id));
    case 'reorderAccounts':return engine.reorder(body.ids);
    case 'retryAccount':return engine.retryAccount(String(body.id));
    case 'diagnostics':return engine.diagnostics();
    case 'saveWifi':return engine.saveWifi(body);
    case 'verifyWifi':return engine.beginWifiValidation();
  }
}

function equalToken(provided,expected){
  return typeof provided==='string'&&/^[a-f0-9]{64}$/.test(provided)&&provided.length===expected.length&&crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
}
async function stopMonitoring(engine,{serviceCall=call,includeService=true}={}){
  const targets=await Promise.allSettled([engine.stop(),includeService?serviceCall('stop'):Promise.resolve(null)]);
  const simulationStopped=targets[0].status==='fulfilled'&&targets[0].value.running===false;
  const systemState=includeService?(targets[1].status==='fulfilled'&&targets[1].value?.running===false?'stopped':'unconfirmed'):'notRequested';
  return {simulationStopped,systemState,ok:simulationStopped&&systemState!=='unconfirmed',
    systemSnapshot:systemState==='stopped'?targets[1].value:null};
}

function serve(engine,{token,port=28763,host='127.0.0.1',onError=()=>{}}={}) {
  if(!/^[a-f0-9]{64}$/.test(token)||host!=='127.0.0.1')throw new Error('后台控制通道配置无效');
  let mutating=false;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.headers.origin||!equalToken(req.headers['x-bkql-token'],token)||req.method!=='POST'){
      res.writeHead(403);res.end('{"error":"本机控制通道拒绝访问"}');return;
    }
    const method=req.url?.slice(1);
    if(!METHODS.has(method)){res.writeHead(404);res.end('{"error":"操作不支持"}');return;}
    let size=0;const chunks=[];
    try{
      for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error('请求过大');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
      // Stop is never queued behind a slow account/settings write.
      const write=!['status','diagnostics','stop'].includes(method);
      if(write&&mutating){res.writeHead(409);res.end('{"error":"正在处理上一项操作"}');return;}
      if(write)mutating=true;
      try{const result=await dispatch(engine,method,body);res.end(JSON.stringify({result}));}
      finally{if(write)mutating=false;}
    }catch(error){onError();if(!res.headersSent)res.writeHead(400);res.end(JSON.stringify({error:publicError(error)}));}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>resolve(server));});
}

function call(method,body={},connection=platform.connectionInfo(),{timeout=60000}={}) {
  if(!connection)return Promise.reject(new Error('系统后台尚未安装或本用户没有控制权限'));
  if(!METHODS.has(method))return Promise.reject(new Error('操作不支持'));
  return new Promise((resolve,reject)=>{
    const payload=JSON.stringify(body);
    const req=http.request({hostname:'127.0.0.1',port:connection.port,path:'/'+method,method:'POST',
      headers:{'X-BKQL-Token':connection.token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{
      let size=0;const chunks=[];
      res.on('data',c=>{size+=c.length;if(size>1024*1024)req.destroy(new Error('后台响应过大'));else chunks.push(c);});
      res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks));if(res.statusCode!==200)reject(new Error(value.error||'后台操作失败'));else resolve(value.result);}catch{reject(new Error('系统后台响应无效'));}});
    });
    req.setTimeout(timeout,()=>req.destroy(new Error('后台操作超时')));
    req.on('error',()=>reject(new Error('系统后台暂时不可连接')));req.end(payload);
  });
}

module.exports={dispatch,serve,call,equalToken,METHODS,stopMonitoring};
