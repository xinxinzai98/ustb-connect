'use strict';
const crypto = require('node:crypto');

const DEFAULTS = Object.freeze({
  ssid: '', interface: 'auto', autoWifi: true, checkInterval: 30,
  confirmInterval: 5, failureThreshold: 3, loginCooldown: 300, wifiRetry: 60,
  statsInterval: 300, ipv6Recovery: false, rotation: 'fallback',
  startOnBoot: false,
});
const ranges = { checkInterval: [15, 300], confirmInterval: [3, 60], failureThreshold: [2, 10],
  loginCooldown: [120, 1800], wifiRetry: [30, 600], statsInterval: [60, 3600] };
const fieldNames={checkInterval:'正常检测间隔',confirmInterval:'异常确认间隔',failureThreshold:'连续失败次数',loginCooldown:'认证请求间隔',wifiRetry:'无线重连间隔',statsInterval:'用量刷新间隔'};
const STATUSES = Object.freeze({
  paused: '自动重连已停止', checking: '正在检测网络', online: '网络连接正常',
  wifiUnconfigured:'请先设置并验证无线网络',
  degraded: 'IPv4 可用，IPv6 未验证通过', confirming: '正在确认连接异常',
  loggingIn: '正在提交校园认证', verifying: '正在确认恢复结果',
  cooldown: '等待下次认证请求', wifiDisconnected: '无线网络未连接',
  connectingWifi: '正在连接已保存的 Wi-Fi', wrongNetwork: '当前不在指定网络',
  routeMismatch: '校园流量未经过指定接口', noAccounts: '请添加校园网账号',
  noEligibleAccount: '暂无可用于认证的账号', credential: '账号或密码需要更新',
  quota: '账号余额或使用额度不足', restricted: '账号暂不可用',
  rateLimited: '校园认证要求稍后重试', deviceLimit: '校园网在线设备达到上限',
  needsUser: '需要在校园页面处理', tlsError: '证书校验未通过',
  toolError: '本机网络检测暂不可用', authUnknown: '校园网认证状态待确认',
  legacyConflict: '旧版重连脚本仍在运行', dnsError:'域名解析异常，当前不重登', error: '本轮检测未完成',
});

function settings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式不正确');
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (ranges[key]) {
      if (!Number.isInteger(value) || value < ranges[key][0] || value > ranges[key][1])
        throw new Error(`${fieldNames[key]}须为 ${ranges[key].join('–')} ${key==='failureThreshold'?'次':'秒'}的整数。`);
    } else if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('开关设置格式不正确');
    } else if (key === 'ssid') {
      if (typeof value !== 'string' || (value&&!value.trim()) || Buffer.byteLength(value) > 32 || /[\x00-\x1f]/.test(value))
        throw new Error('Wi-Fi 名称不正确');
    } else if (key === 'interface') {
      if (typeof value !== 'string' || value.length > 80 || /[\x00-\x1f]/.test(value)) throw new Error('网络接口不正确');
    } else if (key === 'rotation' && value !== 'fallback') throw new Error('当前仅支持故障时切换备用账号');
    result[key] = value;
  }
  return result;
}

function account(input, previous) {
  if (!input || typeof input !== 'object') throw new Error('账号格式不正确');
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const password = typeof input.password === 'string' && input.password.length ? input.password : previous?.password;
  if (!username || username.length > 100 || /[\x00-\x1f]/.test(username)) throw new Error('请填写有效的校园网账号');
  if (!password || password.length > 512 || /[\x00\r\n]/.test(password)) throw new Error('请填写有效的密码');
  if (label.length > 40 || /[\x00-\x1f]/.test(label)) throw new Error('账号备注过长或包含控制字符');
  const changed = !previous || previous.username !== username || previous.password !== password;
  return { id: previous?.id || crypto.randomUUID(), label: label || `账号 ${username.slice(-4)}`,
    username, password, enabled: input.enabled !== false, revision: changed ? crypto.randomUUID() : previous.revision };
}

function publicAccount(item, blocked = {}) {
  return { id: item.id, label: item.label, username: item.username, enabled: item.enabled,
    hasPassword: Boolean(item.password), blocked: blocked[item.id]?.revision === item.revision ? blocked[item.id].reason : null };
}
function wifi(input,previous={}){
  if(!input||typeof input.ssid!=='string'||!input.ssid.trim()||Buffer.byteLength(input.ssid)>32||/[\x00-\x1f]/.test(input.ssid))throw new Error('Wi-Fi 名称须为 1–32 字节，不能包含控制字符');
  if(!['wpa2','wpa3','open'].includes(input.security))throw new Error('当前版本仅支持 WPA2/WPA3 个人网络及开放网络。');
  const same=input.ssid===previous.ssid&&input.security===previous.security;
  if(input.password!=null&&typeof input.password!=='string')throw new Error('Wi-Fi 密码格式不正确');
  const password=input.security==='open'?'':input.password|| (same?previous.password:'')||'';
  const length=Buffer.byteLength(password);
  if(input.security!=='open'&&!((length>=8&&length<=63)||(input.security==='wpa2'&&/^[a-f0-9]{64}$/i.test(password)))||/[\x00-\x1f\x7f]/.test(password))throw new Error('Wi-Fi 密码须为 8–63 字节；WPA2 也支持 64 个十六进制字符。');
  const unchanged=same&&password===previous.password;
  return {ssid:input.ssid,security:input.security,password,revision:unchanged?previous.revision:crypto.randomUUID(),
    verifiedRevision:unchanged?previous.verifiedRevision:null,validation:unchanged?previous.validation:{state:'unverified',at:null}};
}
function publicWifi(value={}){return {ssid:value.ssid||'',security:value.security||'wpa2',hasPassword:Boolean(value.password),validation:value.validation||{state:'unconfigured',at:null},verified:Boolean(value.revision&&value.verifiedRevision===value.revision)};}

function masked(value = '') { return value.length <= 4 ? '****' : `${value.slice(0, 1)}***${value.slice(-4)}`; }
function publicError(error){
  const message=String(error?.message||'');
  const prefixes=['账号','密码','格式','设置','范围','Wi-Fi','接口','请','模拟','演练','隔离','系统','平台','后台','当前','已有','这个','最多','开关','操作','运行','合并','导入','需要','本机',...Object.values(fieldNames)];
  return prefixes.some(x=>message.startsWith(x))?message:'操作未完成，请检查设置或后台服务状态。';
}

function publicRuntime(value) {
  const keys = ['activeId', 'lastSuccessId', 'lastLoginAt', 'lastWifiAt', 'blocked', 'running', 'globalBlockedUntil', 'stats'];
  return Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, structuredClone(value[k])]));
}

function redact(value, accounts = []) {
  const secrets=accounts.flatMap(a=>[a.password,a.username]).filter(Boolean).sort((a,b)=>b.length-a.length);
  function scrub(text){
    for(const secret of secrets)text=text.split(secret).join('[已隐藏]');
    return text.replace(/(upass|password|authorization|cookie|token)\s*[=:]\s*[^\s&,;]+/gi,'$1=[已隐藏]');
  }
  function walk(v){
    if(typeof v==='string')return scrub(v);
    if(Array.isArray(v))return v.map(walk);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/^(password|upass|authorization|cookie|token)$/i.test(k)?'[已隐藏]':walk(x)]));
    return v;
  }
  return typeof value==='string'?scrub(value):JSON.stringify(walk(value));
}

module.exports = { DEFAULTS, STATUSES, settings, account, wifi, publicWifi, publicAccount, publicRuntime, masked, redact,publicError };
