'use strict';
const http=require('node:http');
const https=require('node:https');
const dns=require('node:dns').promises;
const zlib=require('node:zlib');
const net=require('node:net');
const platform=require('./platform.cjs');
const P=require('./protocol.cjs');

function decode(bytes,headers={}) {
  const encoding=String(headers['content-encoding']||'').toLowerCase();
  const options={maxOutputLength:262144};
  if(encoding==='gzip')bytes=zlib.gunzipSync(bytes,options);
  else if(encoding==='deflate')bytes=zlib.inflateSync(bytes,options);
  else if(encoding==='br')bytes=zlib.brotliDecompressSync(bytes,options);
  if(bytes.length>262144)throw new Error('ResponseTooLarge');
  const charset=String(headers['content-type']||'').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  if(charset){try{return new TextDecoder(charset).decode(bytes);}catch{}}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030').decode(bytes);}
}

function request(url,{method='GET',body='',family=4,localAddress='',address='',signal,timeout=6000}={}) {
  const uri=new URL(url);
  if(uri.username||uri.password||!['http:','https:'].includes(uri.protocol))return Promise.reject(new Error('InvalidDestination'));
  if(localAddress&&net.isIP(localAddress)!==family)return Promise.reject(new Error('WrongAddressFamily'));
  return new Promise((resolve,reject)=>{
    let size=0;const chunks=[];
    const options={method,family,localAddress:localAddress||undefined,signal,rejectUnauthorized:true,
      headers:{'Cache-Control':'no-cache, no-store','Accept-Encoding':'gzip, deflate, br'}};
    if(address)options.lookup=(_host,opts,callback)=>opts.all?callback(null,[{address,family}]):callback(null,address,family);
    if(body){options.headers['Content-Type']='application/x-www-form-urlencoded';options.headers['Content-Length']=Buffer.byteLength(body);}
    const req=(uri.protocol==='https:'?https:http).request(uri,options,res=>{
      const connection={localIP:res.socket?.localAddress||'',remoteIP:res.socket?.remoteAddress||'',certificateValid:uri.protocol==='https:'&&res.socket?.authorized===true};
      res.on('data',chunk=>{size+=chunk.length;if(size>262144)req.destroy(new Error('ResponseTooLarge'));else chunks.push(chunk);});
      res.on('error',()=>reject(new Error('NetworkReadFailed')));
      res.on('end',()=>{
        try{
          resolve({status:res.statusCode,headers:res.headers,text:method==='HEAD'?'':decode(Buffer.concat(chunks),res.headers),
            ...connection});
        }catch(error){reject(error);}
      });
    });
    req.setTimeout(timeout,()=>req.destroy(new Error('RequestTimeout')));
    const deadline=setTimeout(()=>req.destroy(new Error('RequestTimeout')),timeout);deadline.unref?.();
    req.once('close',()=>clearTimeout(deadline));
    req.on('error',error=>{const e=new Error('NetworkRequestFailed');e.code=error.code||error.message;reject(e);});
    req.end(body||undefined);
  });
}

async function resolve6(host) {
  try{return (await Promise.race([dns.resolve6(host),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('DnsTimeout')),2500);t.unref?.();})])).find(P.global6)||'';}catch{}
  try{const resolver=new dns.Resolver({timeout:2500,tries:1});resolver.setServers(['223.5.5.5']);return (await resolver.resolve6(host)).find(P.global6)||'';}catch{return '';}
}

class CampusTransport {
  constructor(){this.simulated=false;this.timeScale=1;}
  context(policy,signal){return platform.context(policy,signal);}
  connectWifi(info,policy,signal,configuration){return platform.connectWifi(info,policy,signal,configuration);}
  async auth(info,signal) {
    try{const r=await request(`${P.PORTAL}/drcom/chkstatus?callback=dr1002&jsVersion=4.1&v=${Date.now()}`,{localAddress:info.source4,signal});return r.status===200?P.authState(r.text):P.authState('');}
    catch(error){if(signal?.aborted)throw error;return P.authState('');}
  }
  async probe(info,family,signal) {
    const source=family===6?info.source6:info.source4;
    if(!source)return {state:'noAddress'};
    let tlsFailure=false,dnsFailure=false,interceptions=0;const peers=[];
    for(const host of ['www.baidu.com','www.qq.com']){
      const address=family===6?await resolve6(host):'';
      if(family===6&&!address){dnsFailure=true;continue;}
      try{
        const r=await request(`https://${host}/`,{method:'HEAD',family,localAddress:source,address,signal});
        const sourceMatches=r.localIP.replace(/^::ffff:/,'')===source;
        if(r.certificateValid&&sourceMatches&&r.status>=100&&r.status<=599)return {state:'online',httpStatus:r.status,certificateValid:true,localIP:r.localIP,remoteIP:r.remoteIP};
      }catch(error){
        if(signal?.aborted)throw error;
        if(/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code||''))tlsFailure=true;
        if(/ENOTFOUND|EAI_AGAIN|ENODATA/.test(error.code||''))dnsFailure=true;
      }
      try{
        const r=await request(`http://${host}/`,{method:'HEAD',family,localAddress:source,address,signal,timeout:4000});
        if(r.status>=300&&r.status<400&&P.campusRedirect(r.headers.location))interceptions++;
      }catch(error){if(signal?.aborted)throw error;}
      peers.push(host);
    }
    return {state:interceptions>0?'intercepted':tlsFailure?'tlsError':dnsFailure?'dns':'unavailable',confirmed:interceptions===2,certificateValid:false};
  }
  probe4(info,signal){return this.probe(info,4,signal);}
  probe6(info,signal){return this.probe(info,6,signal);}
  async login(info,item,signal) {
    const r=await request(`${P.PORTAL}/drcom/login`,{method:'POST',body:P.loginForm(item,info.source6||''),localAddress:info.source4,signal,timeout:8000});
    const result=P.loginReply(r.text);
    if(result.errorCode&&!result.errorCode.includes(item.username)&&!result.errorCode.includes(item.password)){
      try{
        const extra=await request(`${P.EPORTAL}/err_code/loadErrorPrompt?callback=dr1005&error_code=${encodeURIComponent(result.errorCode)}&jsVersion=4.1&v=${Date.now()}`,{localAddress:info.source4,signal});
        const value=P.jsonp(extra.text);
        if(['1','ok'].includes(String(value?.result)))result.kind=P.failureClass(String(value.error_prompt_zh||value.error_prompt_en||'').slice(0,512));
      }catch(error){if(signal?.aborted)throw error;}
    }
    // Only the fixed classification leaves this method. No portal body/error text is logged.
    return {kind:result.kind,httpStatus:r.status};
  }
  async stats(info,username,signal) {
    const fresh=await this.auth(info,signal);
    if(fresh.state!=='online'||fresh.uid.toLowerCase()!==username.toLowerCase())return P.statistics('','',username);
    const page=await request(`${P.PORTAL}/`,{localAddress:info.source4,signal});
    let flow={text:''};
    try{flow=await request(`${P.EPORTAL}/visitor/loadUserFlow?callback=dr1006&account=${encodeURIComponent(username)}&jsVersion=4.1&v=${Date.now()}`,{localAddress:info.source4,signal});}
    catch(error){if(signal?.aborted)throw error;}
    return P.statistics(page.text,flow.text,username);
  }
}

module.exports={CampusTransport,request,decode};
