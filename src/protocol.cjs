'use strict';
const net = require('node:net');
const PORTAL = 'http://202.204.48.66';
const EPORTAL = `${PORTAL}:801/eportal/portal`;
const CAMPUS_HOSTS = new Set(['202.204.48.66', '202.204.48.82', 'cipp.ustb.edu.cn', 'cippv6.ustb.edu.cn', 'dr.com']);

function jsonp(text) {
  let value = String(text).trim().replace(/^\uFEFF/, '');
  const match = value.match(/^\w+\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/);
  if (match) value = match[1];
  try { const obj = JSON.parse(value); return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null; }
  catch { return null; }
}

function authState(text) {
  const v = jsonp(text);
  if (!v) return { state: 'unknown', uid: '', ipv4: '', ipv6: '' };
  const uid = typeof v.uid === 'string' && v.uid.length <= 100 ? v.uid.trim() : '';
  const result = String(v.result);
  return { state: result === '0' ? 'offline' : ['1','ok'].includes(result) && uid ? 'online' : 'unknown',
    uid, ipv4: net.isIP(v.v4ip) === 4 ? v.v4ip : '', ipv6: net.isIP(v.v6ip) === 6 ? v.v6ip : '' };
}

function global6(ip) {
  if (net.isIP(ip) !== 6 || ip.includes('%')) return false;
  return /^[23][0-9a-f]{3}:/i.test(ip);
}

function loginForm(item, ipv6 = '') {
  if (!item?.username || !item.password) throw new Error('账号尚未配置');
  if (ipv6 && !global6(ipv6)) throw new Error('IPv6 源地址无效');
  return new URLSearchParams({ callback: 'dr1004', DDDDD: item.username, upass: item.password,
    '0MKKey':'123456', R1:'0', R2:'', R3:'0', R6:'0', para:'00', v6ip:ipv6,
    terminal_type:'1', lang:'zh-cn', jsVersion:'4.1', v:String(Math.floor(Math.random()*9000)+1000) }).toString();
}

function failureClass(text) {
  const v = String(text);
  if (/验证码|captcha|二次验证|短信验证|人机验证/i.test(v)) return 'needsUser';
  if (/(终端|设备|连接|用户).{0,16}(上限|超限|过多)|max.{0,15}(session|device)|too many.{0,12}(session|device)/i.test(v)) return 'deviceLimit';
  if (/频繁|稍后|繁忙|rate.?limit|busy|try again/i.test(v)) return 'rateLimited';
  if (/(密码|口令).{0,16}(错误|不正确|无效)|password.{0,20}(wrong|error|invalid|incorrect)|账号.{0,8}不存在|用户.{0,8}不存在/i.test(v)) return 'credential';
  if (/余额不足|欠费|额度不足|流量.{0,8}(用完|耗尽)|insufficient|quota.{0,8}(exceeded|exhausted)/i.test(v)) return 'quota';
  if (/(账号|账户|用户|account|user).{0,20}(停用|暂停使用|到期|过期|expired|disabled|suspended)/i.test(v)) return 'restricted';
  if (/already.{0,20}(online|login)|已经?登录|已经?在线|重复登录/i.test(v)) return 'alreadyOnline';
  return 'retryable';
}

function loginReply(text) {
  const v = jsonp(text);
  if (!v) return { kind:'htmlOrUnknown', errorCode:'' };
  if (['1','ok'].includes(String(v.result))) return { kind:'accepted', errorCode:'' };
  const prompt = typeof v.msg === 'string' ? v.msg.slice(0,512) : '';
  const code = typeof v.msga === 'string' && /^[A-Za-z0-9 _./:-]{1,80}$/.test(v.msga) ? v.msga : '';
  return { kind:failureClass(prompt), errorCode:code };
}

function campusRedirect(location) {
  try { return CAMPUS_HOSTS.has(new URL(location).hostname.toLowerCase()); } catch { return false; }
}

// Only parse simple literal assignments. Portal JavaScript is never evaluated.
function literal(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(text).match(new RegExp(`\\b${escaped}\\s*=\\s*(?:'([^'\\r\\n]*)'|"([^"\\r\\n]*)"|([0-9]+(?:\\.[0-9]+)?))\\s*(?:;|,)`));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function decimal(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+(?:\.\d+)?$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 1e15 ? number : null;
}

function statistics(page, flowText, expectedAccount, at = Date.now()) {
  const pageAccount = literal(page, 'uid');
  if (!expectedAccount || !pageAccount || pageAccount.toLowerCase() !== expectedAccount.toLowerCase())
    return { balance:null, ipv4MB:null, ipv6MB:null, updatedAt:null, state:'accountMismatch', period:'校方未提供统计周期' };
  const prepaid = literal(page, 'fsele') === '1';
  let money = decimal(literal(page, 'fee1'));
  if (money === null && /\bfee1\s*=\s*fee\s*;/.test(page)) money = decimal(literal(page, 'fee'));
  const flow = jsonp(flowText);
  const valid = flow && ['1','ok'].includes(String(flow.result)) && flow.data && typeof flow.data === 'object';
  return { balance:prepaid && money !== null ? money / 10000 : null,
    ipv4MB:valid ? decimal(flow.data.v4) : null, ipv6MB:valid ? decimal(flow.data.v6) : null,
    updatedAt:at, state:valid || (prepaid && money !== null) ? 'available' : 'unavailable',
    period:'校方未提供统计周期', source:'北科认证页面 / loadUserFlow', currency:'CNY' };
}

module.exports = { PORTAL, EPORTAL, CAMPUS_HOSTS, jsonp, authState, global6, loginForm, failureClass,
  loginReply, campusRedirect, literal, statistics };
