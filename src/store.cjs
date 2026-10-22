'use strict';
const fs=require('node:fs');
const path=require('node:path');
const platform=require('./platform.cjs');

function atomic(file,text) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('拒绝写入符号链接');
  const temp=file+'.new';
  if(fs.existsSync(temp)&&fs.lstatSync(temp).isSymbolicLink())throw new Error('临时文件不是普通文件');
  fs.writeFileSync(temp,text,{mode:0o600});fs.renameSync(temp,file);
}
function recentLogs(file){
  if(!fs.existsSync(file))return [];
  const size=fs.statSync(file).size,length=Math.min(size,262144);const bytes=Buffer.alloc(length);const fd=fs.openSync(file,'r');
  try{fs.readSync(fd,bytes,0,length,size-length);}finally{fs.closeSync(fd);}
  return bytes.toString('utf8').split('\n').slice(size>length?1:0).flatMap(line=>{
    try{const row=JSON.parse(line);return Number.isFinite(row.time)&&['info','success','warning'].includes(row.level)&&typeof row.message==='string'&&typeof row.code==='string'?[row]:[];}catch{return [];}
  }).slice(-200);
}

class DraftStore {
  constructor(root,{encrypt,decrypt,memory=false}={}){this.root=root;this.encrypt=encrypt;this.decrypt=decrypt;this.memory=memory;this.value={};this.queue=Promise.resolve();}
  async load(){
    if(this.memory)return this.value;
    const file=path.join(this.root,'preferences.json');
    if(!fs.existsSync(file))return {};
    if(fs.statSync(file).size>512*1024)throw new Error('本地设置文件过大');
    const v=JSON.parse(fs.readFileSync(file,'utf8'));
    const encrypted=v.secretsEncrypted||v.accountsEncrypted;
    const secrets=encrypted?JSON.parse(await this.decrypt(Buffer.from(encrypted,'base64'))):{};
    return {settings:v.settings,runtime:v.runtime,accounts:Array.isArray(secrets)?secrets:secrets.accounts||[],wifi:Array.isArray(secrets)?{}:secrets.wifi||{}};
  }
  async save(value){
    value=structuredClone(value);this.value=value;
    if(this.memory)return;
    const operation=async()=>{
      const encrypted=value.accounts.length||value.wifi?.ssid?(await this.encrypt(JSON.stringify({accounts:value.accounts,wifi:value.wifi||{}}))).toString('base64'):'';
      atomic(path.join(this.root,'preferences.json'),JSON.stringify({settings:value.settings,runtime:value.runtime,secretsEncrypted:encrypted},null,2));
    };
    const done=this.queue.then(operation);this.queue=done.catch(()=>{});return done;
  }
}

class MachineStore {
  constructor(root=platform.machineRoot()){this.root=root;this.lastAccounts=null;this.queue=Promise.resolve();}
  async readAccounts(){
    if(process.platform==='win32'){
      const file=path.join(this.root,'vault.bin');if(!fs.existsSync(file))return [];
      const raw=await platform.run(platform.powershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'..','service','vault-windows.ps1'),'-Mode','Unprotect'],{input:fs.readFileSync(file).toString('base64')});
      return JSON.parse(raw);
    }
    if(process.platform==='darwin'){
      try{
        const raw=await platform.run('/usr/bin/security',['find-generic-password','-a','service','-s','local.bkql.campusconnect.machine','-w','/Library/Keychains/System.keychain']);
        return JSON.parse(Buffer.from(raw,'base64').toString('utf8'));
      }catch(error){if(error.code===44)return [];throw new Error('系统钥匙串暂不可读取');}
    }
    throw new Error('系统后台仅支持 Windows 和 macOS');
  }
  async load(){
    const file=path.join(this.root,'preferences.json');
    const value=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
    const secrets=await this.readAccounts();const normalized=Array.isArray(secrets)?{accounts:secrets,wifi:{}}:secrets;
    this.lastAccounts=JSON.stringify(normalized);return {...value,accounts:normalized.accounts||[],wifi:normalized.wifi||{}};
  }
  async save(value){
    const copy=structuredClone(value);
    const done=this.queue.then(async()=>{
      const text=JSON.stringify({accounts:copy.accounts,wifi:copy.wifi||{}});
      if(text!==this.lastAccounts){
        if(process.platform==='win32'){
          const encoded=await platform.run(platform.powershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'..','service','vault-windows.ps1'),'-Mode','Protect'],{input:text});
          atomic(path.join(this.root,'vault.bin'),Buffer.from(encoded,'base64'));
        }else if(process.platform==='darwin'){
          // Payload is base64 on stdin, never a password argument or shell command.
          const payload=Buffer.from(text).toString('base64');
          await platform.run('/usr/bin/security',['-i'],{input:`add-generic-password -a service -s local.bkql.campusconnect.machine -w ${payload} -U -T /usr/bin/security /Library/Keychains/System.keychain\nquit\n`});
        }else throw new Error('平台不支持系统凭据保存');
        if(JSON.stringify(await this.readAccounts())!==text)throw new Error('系统凭据回读未通过');
        this.lastAccounts=text;
      }
      atomic(path.join(this.root,'preferences.json'),JSON.stringify({settings:copy.settings,runtime:copy.runtime},null,2));
    });
    this.queue=done.catch(()=>{});return done;
  }
}

module.exports={DraftStore,MachineStore,atomic,recentLogs};
