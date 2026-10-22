'use strict';
const {masked}=require('./model.cjs');
const labels={online:'已连通',offline:'未登录',unknown:'待确认',notChecked:'未检查',noAddress:'未获地址',unavailable:'不可达',intercepted:'认证拦截',dns:'解析异常',tlsError:'证书异常',toolError:'检测异常'};
const number=value=>typeof value==='number'&&Number.isFinite(value);
const stamp=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未检测';
function trayInformation(s={}){
  const simulated=s.mode!=='system',service=s.service||{},available=simulated||service.connected===true;
  const backend=service.connected?(service.running===true?'运行中':service.running===false?'已停止':'状态待确认'):service.known?'状态待确认':'未连接';
  const account=available&&s.campus==='online'?(s.accounts||[]).find(a=>a.id===s.activeId):null;
  const rows=[`当前显示：${simulated?'模拟数据':'系统后台'}`,`实际后台：${backend}`,
    `${simulated?'模拟监测':'自动重连'}：${available?(s.running?'运行中':'已停止'):'状态待确认'}`,
    `校园认证：${available?(labels[s.campus]||'待确认'):'待确认'}`,
    `IPv4：${available?(labels[s.ipv4]||'待确认'):'待确认'}`,
    `IPv6：${available?(labels[s.ipv6]||'待确认'):'待确认'}`,
    `当前账号：${account?masked(account.username):'待确认'}`,
    `最近检测：${available?stamp(s.lastCheckedAt):'状态待确认'}`];
  const stats=account?s.stats?.[account.id]:null;
  if(stats?.updatedAt){
    if(number(stats.balance))rows.push(`余额：¥ ${stats.balance.toFixed(2)}`);
    for(const [key,label] of [['ipv4MB','IPv4 已用'],['ipv6MB','IPv6 已用']]){
      if(number(stats[key])&&stats[key]>=0)rows.push(`${label}：${stats[key].toLocaleString('zh-CN',{maximumFractionDigits:2})} MB`);
    }
    if(rows.length>8)rows.push(`用量更新：${stamp(stats.updatedAt)}`);
  }
  return rows;
}
module.exports={trayInformation};
