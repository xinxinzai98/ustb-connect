'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {Engine}=require('./engine.cjs');
const {CampusTransport}=require('./transport.cjs');
const {MachineStore,atomic,recentLogs}=require('./store.cjs');
const {machineRoot}=require('./platform.cjs');
const {serve}=require('./control.cjs');

async function main(){
  if(process.platform==='darwin'&&process.getuid()!==0)throw new Error('系统后台需要 root 身份');
  const root=machineRoot();
  if(!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())throw new Error('系统后台目录无效');
  const token=fs.readFileSync(path.join(root,'controller.token'),'utf8').trim();
  const store=new MachineStore(root);const data=await store.load();
  const bootEpoch=Date.now()-os.uptime()*1000;
  const sameBoot=typeof data.runtime?.bootEpoch==='number'&&Math.abs(data.runtime.bootEpoch-bootEpoch)<60000;
  const engine=new Engine({transport:new CampusTransport(),data,persist:async value=>store.save({...value,runtime:{...value.runtime,bootEpoch}})});
  const logs=path.join(root,'diagnostics.jsonl');
  engine.logs=recentLogs(logs);
  engine.on('log',record=>{
    if(fs.existsSync(logs)&&fs.statSync(logs).size>5*1024*1024)fs.renameSync(logs,logs+'.1');
    fs.appendFileSync(logs,JSON.stringify(record)+'\n',{mode:0o600});
  });
  engine.on('change',state=>atomic(path.join(root,'status.json'),JSON.stringify({time:Date.now(),version:require('../package.json').version,pid:process.pid,status:state.status,running:state.running,campus:state.campus,ipv4:state.ipv4,ipv6:state.ipv6,lastCheckedAt:state.lastCheckedAt})));
  const server=await serve(engine,{token});
  if(data.runtime?.running&&(data.settings?.startOnBoot||sameBoot))await engine.start();
  else engine.changed();
  const heartbeat=setInterval(()=>engine.changed(),30000);heartbeat.unref();
  const exit=async()=>{engine.dispose();await engine.save();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();};
  process.once('SIGTERM',exit);process.once('SIGINT',exit);
}

main().catch(()=>{process.stderr.write('BKQL 系统后台未启动，请检查服务目录权限与系统凭据存储。\n');process.exitCode=1;});
