'use strict';
const paths={
  overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  accounts:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  settings:'<path d="M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8M5.6 18.4l2.8-2.8m7.2-7.2 2.8-2.8"/><circle cx="12" cy="12" r="5"/>',
  logs:'<path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h6m-6 4h6m-6 4h4"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',check:'<path d="m5 12 4 4L19 6"/>',
  wifi:'<path d="M2 8.8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0m-11 3a5 5 0 0 1 8 0"/><circle cx="12" cy="19" r=".8"/>',
  shield:'<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5m-4.1-5a8 8 0 0 1 13-2L20 8M4 16l2.1 3a8 8 0 0 0 13-2"/>',
  pause:'<path d="M8 5v14m8-14v14"/>',play:'<path d="m8 4 11 8-11 8V4Z"/>',
  wallet:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V5a2 2 0 0 1 2-2h12m-1 8h5v5h-5a2.5 2.5 0 0 1 0-5Z"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  link:'<path d="m10 13 4-4m-6 7H6a5 5 0 0 1 0-10h4m4 2h4a5 5 0 0 1 0 10h-4"/>',
  flask:'<path d="M9 3h6m-5 0v6l-6 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-9V3M7 15h10"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',edit:'<path d="m16 3 5 5-12 12H4v-5L16 3Zm-3 3 5 5"/>',
  trash:'<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  up:'<path d="m6 14 6-6 6 6"/>',down:'<path d="m6 10 6 6 6-6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>',
  folder:'<path d="M3 7V4h6l2 3h10v13H3V7Z"/>',bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7l0-8Z"/>',
};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.info}</svg>`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=selector=>document.querySelector(selector);
const labels={overview:'网络状态',wifi:'无线网络',accounts:'校园网账号',settings:'重连设置',diagnostics:'运行日志'};
const known={online:['已连通','green'],offline:['未登录','orange'],unknown:['待确认',''],notChecked:['未检查',''],noAddress:['未获地址',''],unavailable:['不可达','orange'],intercepted:['认证拦截','orange'],dns:['解析异常','orange'],tlsError:['证书异常','red'],toolError:['检测异常','red']};
const reasons={credential:'账密需更新',quota:'额度不足',restricted:'账号不可用'};
const scenes={healthy:'正常连接',campusOffline:'校园认证掉线',ipv4Failure:'IPv4 出站失败',ipv6Intercepted:'IPv6 尚未关联',badPassword:'主账号密码失效',quota:'主账号额度不足',dns:'DNS 解析异常',wifiDown:'Wi-Fi 断开',rateLimited:'校园认证频控',deviceLimit:'在线设备达到上限',htmlReply:'认证响应格式变化后恢复',unmanagedAccount:'在线账号不在配置列表',authUnavailable:'认证状态无法确认'};
let state=null,page='overview',editingId=null,policyDirty=false,wifiDirty=false,firstState=true,logFilter='all',snapshotAt=Date.now(),confirmHandler=null;
const api=window.bkql;
function liveState(){return state.mode==='simulation'||state.service.connected;}
function tag(value){if(!liveState())value='unknown';const [name,color]=known[value]||[value||'—',''];return `<span class="tag ${color}">${esc(name)}</span>`;}
function time(value){return value?new Date(value).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'尚未检测';}
function stamp(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无记录';}
function mb(value){if(value===null||value===undefined)return ['—',''];return [Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2}),'MB'];}
function toast(message,error=false){const t=$('#toast');t.textContent=message;t.className='toast visible'+(error?' error':'');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className='toast',4300);}
async function invoke(method,body={}){try{return await api.invoke(method,body);}catch(error){toast(String(error.message).replace(/^Error invoking remote method '[^']+': Error: /,''),true);throw error;}}
function use(value){if(!value||!value.settings)return;if(firstState&&!value.settings.ssid)page='wifi';firstState=false;state=value;snapshotAt=Date.now();render();}
function active(){return liveState()&&state.campus==='online'?state.accounts.find(a=>a.id===state.activeId):null;}
function accountCaption(account){
  const attempt=state.accounts.find(a=>a.id===state.loginAccountId);
  if(!liveState())return '后台服务连接中断，当前网络与账号状态尚未确认。';
  if(attempt)return `正在认证：${attempt.label} · ${attempt.username}`;
  if(account)return `已认证账号：${account.label} · ${account.username}`;
  if(state.campus==='online')return '当前在线账号未在本应用中管理，暂不显示其余额与用量。';
  return state.accounts.length?'当前认证账号尚未确认；历史用量可在账号列表查看。':'请配置校园网账号后启用自动重连。';
}
function detailText(row){
  const d=row.detail||{},parts=[];const names={authRejected:'无线认证未通过',notFound:'未找到目标网络',permissionDenied:'系统权限不足',unsupportedSecurity:'无线安全类型不支持',noAddress:'未获取可用 IP 地址',notConnected:'未连接指定网络',legacyConflict:'旧版服务正在运行',cancelled:'操作已取消',failed:'操作未完成',credential:'账号或密码无效',quota:'余额或流量额度不足',restricted:'账号暂不可用',rateLimited:'请求频率限制',deviceLimit:'在线设备数量限制',needsUser:'需要人工处理'};
  const label=value=>known[value]?.[0]||value;
  if(d.status)parts.push('处理结果：'+(state.statusLabels?.[d.status]||label(d.status)));
  for(const [key,name] of [['campus','校园认证'],['ipv4','IPv4'],['ipv6','IPv6']])if(d[key])parts.push(`${name}：${label(d[key])}`);
  if(d.reason)parts.push('原因：'+(names[d.reason]||d.reason));
  if(d.account)parts.push('认证账号：'+d.account);
  if(d.consecutiveFailures!==undefined)parts.push('连续失败：'+d.consecutiveFailures+' 次');
  if(d.nextLoginInSeconds!==undefined)parts.push('认证等待：'+d.nextLoginInSeconds+' 秒');
  if(d.ipv6Included!==undefined)parts.push('IPv6 关联：'+(d.ipv6Included?'已包含源地址':'未取得可用源地址'));
  if(d.routeOk!==undefined)parts.push('校园网络出口：'+(d.routeOk?'匹配':'不匹配'));
  if(d.interface)parts.push('接口：'+d.interface);
  if(d.ipv6Source)parts.push('IPv6 源地址：'+d.ipv6Source);
  if(d.manualLogin)parts.push('触发方式：手动认证');else if(d.readOnly)parts.push('触发方式：手动检测');
  return parts.join('；');
}
function heading(title,description,buttons=''){return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${buttons}</div></div>`;}
function button(action,label,symbol,kind='secondary',extra=''){return `<button class="button ${kind}" data-action="${action}" ${extra}>${symbol?icon(symbol):''}${label}</button>`;}
function eventRows(full=false){
  const list=state.logs.filter(x=>logFilter==='all'||x.level===logFilter).slice(full?-100:-4).reverse();
  if(!list.length)return '<div class="empty-inline">暂无运行日志，完成检测后将显示相关记录。</div>';
  return list.map(row=>`<div class="event-row"><time>${time(row.time)}</time><span class="event-icon ${esc(row.level)}">${icon(row.level==='success'?'check':row.level==='warning'?'info':'clock')}</span><div>${esc(row.message)}${full?`<div class="event-detail">${esc(detailText(row))}</div>`:''}</div>${full?'':`<span class="event-code">${row.level==='warning'?'警告':row.level==='success'?'完成':'信息'}</span>`}</div>`).join('');
}
function simulation(){return state.mode==='simulation'?`<div class="simulation-panel">${icon('flask')}<strong>模拟场景</strong><small>时间 ×10 · 不发送网络请求</small><select id="scenario" aria-label="选择模拟场景">${Object.entries(scenes).map(([k,v])=>`<option value="${k}" ${state.simulationScene===k?'selected':''}>${v}</option>`).join('')}</select></div>`:'';}
function overview(){
  const a=active(),stats=state.stats[a?.id]||{},good=liveState()&&state.ipv4==='online'&&state.campus==='online';
  const v4=mb(stats.ipv4MB),v6=mb(stats.ipv6MB);
  const reconnect=`<div class="card controller-card"><div class="row-between"><h3>自动重连</h3><span class="tag ${state.running?'green':''}">${state.running?'运行中':'已停止'}</span></div><p class="controller-text">${state.running?'持续检查校园认证与出网状态。连接异常后先复核，再按认证间隔重新登录。':'开启后自动监测网络。当前账号正常时保持连接，明确不可用才换备用。'}</p>${button(state.running?'stop':'start',state.mode==='simulation'?(state.running?'停止模拟监测':'启动模拟监测'):(state.running?'停止自动重连':'启动自动重连'),state.running?'pause':'play',state.running?'secondary':'primary',state.busy&&!state.running?'disabled':'')}<div class="controller-footer"><span>${state.service.connected?'系统后台独立运行':'模拟模式'}</span><span id="countdown">${state.running?'等待下次检测':'已停止监测'}</span></div></div>`;
  return heading('网络状态','查看校园网认证、IPv4/IPv6 连通性及账号用量。',button('check','立即检测','refresh')+button('login','登录一次','link','secondary',state.busy||!state.accounts.some(x=>x.enabled)?'disabled':''))+
    `<div class="overview-grid"><div class="card connection-card"><div class="row-between"><span class="card-kicker">连接状态</span><span class="tag ${good?'green':'blue'}">${good?'最近检测通过':state.busy?'正在检测':'等待有效检测'}</span></div><div class="connection-status"><div class="status-mark ${good?'':state.status==='paused'?'neutral':'warning'}">${icon(good?'check':state.status==='paused'?'wifi':'refresh')}</div><div><h2>${esc(liveState()?state.statusLabel:'后台状态待确认')}</h2><p>${esc(accountCaption(a))}</p></div></div><div class="network-path"><div class="path-node"><span class="node-icon ${liveState()&&state.network?.link?'ok':''}">${icon('wifi')}</span><span>${esc(state.network?.ssid||state.settings.ssid)}</span></div><span class="path-line"></span><div class="path-node"><span class="node-icon ${liveState()&&state.campus==='online'?'ok':''}">${icon('shield')}</span><span>校园认证</span>${tag(state.campus)}</div><span class="path-line"></span><div class="path-node"><span class="node-icon ${liveState()&&state.ipv6==='online'?'ok':''}">${icon('globe')}</span><span>IPv6</span>${tag(state.ipv6)}</div></div></div>${reconnect}</div>`+
    `<div class="metrics"><div class="card metric"><div class="metric-top">${icon('wallet')}账号余额</div><div class="metric-value">${stats.balance===null||stats.balance===undefined?'—':`<span class="unit">¥</span> ${Number(stats.balance).toFixed(2)}`}</div><div class="metric-caption">${stats.simulated?'模拟数据，仅供功能验证':stats.balance!==null&&stats.balance!==undefined?'校方返回的账号余额':'确认在线账号后查询'}</div></div><div class="card metric"><div class="metric-top">${icon('upload')}IPv4 已用流量</div><div class="metric-value">${v4[0]}<span class="unit">${v4[1]}</span></div><div class="metric-caption">${esc(stats.period||'以校方返回数据为准')}</div></div><div class="card metric"><div class="metric-top">${icon('download')}IPv6 已用流量</div><div class="metric-value">${v6[0]}<span class="unit">${v6[1]}</span></div><div class="metric-caption">${stats.updatedAt?'更新于 '+stamp(stats.updatedAt):'以校方返回数据为准'}</div></div></div>`+
    `<div class="card network-detail"><div class="detail-row"><span>IPv4 公网访问</span>${tag(state.ipv4)}</div><div class="detail-row"><span>网络接口</span><code>${esc(state.network?.interface||'自动识别')}</code></div><div class="detail-row"><span>本机 IPv6 源地址</span><code>${esc(state.network?.source6||'尚未读取')}</code></div><div class="detail-row"><span>上次完成检测</span><code>${time(state.lastCheckedAt)}</code></div></div>`+
    `<div class="section-row"><h3>最近运行日志</h3><button class="text-button" data-action="show-logs">查看全部 ${icon('arrow')}</button></div><div class="card logs-card">${eventRows()}</div>`+
    (state.accounts.length?'':`<div class="section-row">${button('add-account','添加校园账号','plus','primary')}${state.mode==='simulation'?button('load-demo','加载示例账号','flask','secondary'):''}</div>`)+simulation();
}
function accounts(){
  const rows=state.accounts.map((a,index)=>{
    const s=state.stats[a.id]||{};const current=liveState()&&state.campus==='online'&&a.id===state.activeId;
    return `<tr class="${current?'current':''}"><td><div class="account-main"><span class="account-avatar">${String(index+1).padStart(2,'0')}</span><div><div class="account-title">${esc(a.label)}</div><div class="account-subtitle">${esc(a.username)}</div></div></div></td><td>${a.blocked?`<span class="tag orange">${esc(reasons[a.blocked]||'暂停重试')}</span>`:current?'<span class="tag green">当前账号</span>':a.enabled?'<span class="tag blue">备用就绪</span>':'<span class="tag">已停用</span>'}</td><td>${s.balance===null||s.balance===undefined?'—':'¥ '+Number(s.balance).toFixed(2)}<div class="account-subtitle">${s.updatedAt?stamp(s.updatedAt)+' 历史记录':'认证后查询'}</div></td><td><div class="cell-actions"><button class="icon-button" data-action="move-up" data-id="${esc(a.id)}" title="提高优先级" ${index===0?'disabled':''}>${icon('up')}</button><button class="icon-button" data-action="move-down" data-id="${esc(a.id)}" title="降低优先级" ${index===state.accounts.length-1?'disabled':''}>${icon('down')}</button><button class="icon-button" data-action="edit-account" data-id="${esc(a.id)}" title="编辑账号">${icon('edit')}</button>${a.blocked?`<button class="icon-button" data-action="retry-account" data-id="${esc(a.id)}" title="已处理问题，允许重试">${icon('refresh')}</button>`:''}<button class="icon-button red" data-action="delete-account" data-id="${esc(a.id)}" title="移除账号">${icon('trash')}</button></div></td></tr>`;
  }).join('');
  return heading('校园网账号','管理校园网账号、认证密码与备用优先级。',button('import','导入账号文件','upload')+button('add-account','添加账号','plus','primary'))+
    (state.mode==='system'&&!state.accounts.length?`<div class="section-row">${button('sync-draft','导入本机保存的账号与设置','upload')}</div>`:'')+
    `<div class="account-policy">${icon('shield')}<div><h3>当前账号优先，明确不可用时才切换</h3><p>仅账密失效、账号失效或额度不足时使用备用。线路故障、DNS 异常、设备上限和频控保持原账号。</p></div><span class="tag blue">账号备用策略</span></div>`+
    (rows?`<div class="card account-table-wrap"><table class="account-table"><thead><tr><th>账号 / 备注</th><th>可用状态</th><th>最近余额</th><th style="text-align:right">优先级与管理</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="card empty-state"><div class="empty-symbol">${icon('accounts')}</div><h2>尚未配置校园网账号</h2><p>可导入 JSON 账号文件。密码使用安全存储，不显示在界面或诊断文件中。</p>${button('add-account','添加校园账号','plus','primary')}${state.mode==='simulation'?button('load-demo','加载示例账号','flask','ghost'):''}</div>`)+
    `<p class="account-footnote">备用账号按列表顺序使用；健康连接不按时强制切换。停用或移除账号不会主动注销现有校园会话。未登录的备用账号仅显示历史记录，不额外登录查询余额。</p>`+simulation();
}
function numberField(name,title,min,max,note){return `<label class="field"><span>${title}</span><div class="with-unit"><input type="number" name="${name}" min="${min}" max="${max}" value="${state.settings[name]}" required><span>${name==='failureThreshold'?'次':'秒'}</span></div>${note?`<small>${note}</small>`:''}</label>`;}
function wifiPage(){
  const w=state.wifi||{},v=w.validation||{};
  const description={unconfigured:'请先填写无线网络',unverified:'已保存，尚未验证连接',testing:'正在重新连接并核对网络',verified:'Wi-Fi 连接与 IP 已验证',authRejected:'无线认证被拒绝，请检查密码',notFound:'未找到目标网络或无线网卡',permissionDenied:'系统无线权限不足，请在系统设置检查',unsupportedSecurity:'安全类型不匹配或系统暂不支持',noAddress:'未取得可用 IPv4 地址，请检查 DHCP',notConnected:'未连到指定配置，请检查名称、密码与信号',routeMismatch:'Wi-Fi 已连通，校园流量经过其他接口',campusUnavailable:'Wi-Fi 已连接，校园认证暂时不可达',cancelled:'验证已取消',failed:'验证未完成，请检查无线网络与系统权限'};
  return heading('无线网络','配置本机无线网络。无线网络密码与校园网认证密码分别管理。')+
    `<div class="settings-grid"><form class="card form-card" id="wifi-form"><div class="form-section"><h3>目标无线网络</h3><label class="field"><span>无线网络名称（SSID）</span><input name="ssid" value="${esc(w.ssid||'')}" placeholder="请输入无线网络名称" required autocomplete="off"><small>名称区分大小写和空格，长度不超过 32 字节。</small></label><label class="field wifi-field"><span>安全类型</span><select name="security"><option value="wpa2" ${w.security==='wpa2'?'selected':''}>WPA2 个人网络（常用）</option><option value="wpa3" ${w.security==='wpa3'?'selected':''}>WPA3 个人网络</option><option value="open" ${w.security==='open'?'selected':''}>开放网络（无无线密码）</option></select><small>本版本暂不支持企业级 802.1X 无线认证。</small></label><label class="field wifi-field"><span>无线网密码</span><div class="password-wrap"><input name="password" type="password" maxlength="128" autocomplete="new-password" placeholder="${w.hasPassword?'留空保留已保存密码':'请输入无线网络密码'}" ${w.security==='open'?'disabled':''}><button type="button" class="icon-button" data-action="reveal-wifi" aria-label="显示本次输入的无线密码">${icon('eye')}</button></div><small>已保存密码不显示；更换网络名称后须重新填写。开放网络无需密码。</small></label></div><div class="settings-save"><button class="button secondary" type="button" data-action="verify-wifi" ${!w.ssid||state.busy||wifiDirty?'disabled':''}>${icon('wifi')}连接并验证</button><button class="button primary" type="submit" ${state.busy?'disabled':''}>保存无线配置</button></div><div class="form-section"><div class="row-between"><h3>连接验证</h3><span class="tag ${w.verified?'green':v.state==='testing'?'blue':'orange'}">${esc(description[v.state]||'尚未验证')}</span></div><p class="wifi-copy">验证会重新连接目标 Wi-Fi，再核对实际 SSID、配置与 IP。校园认证另行检查，不在这一步提交校园账号密码。</p><div class="network-detail"><div class="detail-row"><span>无线配置</span><span>${w.hasPassword?'密码已安全保存':w.security==='open'?'开放网络':'尚未填写密码'}</span></div><div class="detail-row"><span>最近验证</span><span>${v.at?stamp(v.at):'尚无记录'}</span></div><div class="detail-row"><span>校园认证</span>${tag(v.campus||'unknown')}</div></div></div></form><aside class="card help-card"><div class="help-icon">${icon('wifi')}</div><h3>配置步骤</h3><p>填写当前电脑使用的无线网络名称与密码，保存并验证后，再配置校园网账号。</p><div class="help-divider"></div><h3>验证范围</h3><p>名称与密码先检查格式。只有重新连接指定配置并取得 IP，才显示连接已验证；校园网是否已登录单独显示。</p><div class="help-divider"></div><h3>网络切换提示</h3><p>实际验证会重新连接无线网络。名称或密码有误时，可能需要在系统中手动恢复原网络。${state.mode==='simulation'?'模拟模式不会更改本机无线网络。':'请在方便恢复网络时验证。'}</p><div class="help-divider"></div><h3>Mac 系统权限</h3><p>系统可能要求无线或定位权限来读取 SSID；无法核对时显示验证未完成，不会标记为验证通过。</p></aside></div>`+simulation();
}
function toggle(name,title,description){return `<label class="switch-row"><div><strong>${title}</strong><p>${description}</p></div><input type="checkbox" class="switch" name="${name}" ${state.settings[name]?'checked':''}></label>`;}
function settingsPage(){return heading('重连设置','设置检测频率、认证间隔和开机运行方式。')+
  `<div class="settings-grid"><form class="card form-card" id="settings-form"><div class="form-section"><h3>网络与自动检测</h3><div class="form-fields"><label class="field"><span>目标 Wi-Fi</span><input name="ssid" value="${esc(state.settings.ssid)}" readonly><small>名称与密码请在“无线网络”页面填写并验证。</small></label><label class="field"><span>网络接口</span><select name="interface"><option value="auto">自动识别 Wi-Fi 接口</option>${(state.network?.interfaces||[{Name:state.network?.interface}]).filter(x=>x.Name).map(x=>`<option value="${esc(x.Name)}" ${x.Name===state.settings.interface?'selected':''}>${esc(x.Name)}</option>`).join('')}</select><small>认证流量须经过所选接口。</small></label>${numberField('checkInterval','正常检测间隔',15,300,'正常连接时的检测频率。')}${numberField('confirmInterval','认证离线复核间隔',3,60,'明确未认证后加快复核。')}${numberField('failureThreshold','连续失败确认次数',2,10,'达到阈值后才允许自动提交。')}${numberField('loginCooldown','两次登录最短间隔',120,1800,'所有账号共用认证间隔，避免连续提交。')}</div></div><div class="form-section"><h3>恢复策略</h3>${toggle('autoWifi','Wi-Fi 断开时自动补连','使用已验证的无线配置补连，不接管其他已连接网络。')}${toggle('ipv6Recovery','IPv6 被认证拦截时补认证','默认关闭。开启后仍需连续确认和认证间隔；普通 DNS、证书或线路异常不触发账号轮换。')}<div class="form-fields" style="margin-top:14px">${numberField('wifiRetry','Wi-Fi 补连最短间隔',30,600,'避免不断请求切换无线网络。')}${numberField('statsInterval','余额与用量刷新间隔',60,3600,'仅刷新当前已登录账号。')}</div></div><div class="form-section"><div class="row-between"><h3 style="margin:0">开机运行</h3><span class="tag ${state.service.connected?'green':''}">${state.service.connected?'已连接系统后台':'后台服务未连接'}</span></div>${toggle('startOnBoot','开机后自动恢复联网监测','依靠系统后台运行，不依赖登录桌面或打开本界面。安装后台后生效。')}<div class="mode-choice"><strong>${state.platform==='win32'?'Windows SYSTEM 开机任务':'Mac LaunchDaemon 系统后台'}</strong><p>${state.platform==='darwin'?'系统服务已安装且权限可用时，可在未登录桌面阶段运行；FileVault 预启动解锁前不支持运行。':'由 SYSTEM 在开机后运行。旧版重连任务仍在运行时，新版安装器会停止安装，避免两套后台同时提交。'}</p>${button('install-info','安装后台服务','shield','secondary small')}</div></div><div class="settings-save"><button class="button secondary" type="button" data-action="reset-settings">放弃未保存的修改</button><button class="button primary" type="submit">保存设置</button></div></form><aside class="card help-card"><div class="help-icon">${icon('bolt')}</div><h3>自动重连流程</h3><div class="help-step"><b>01</b><div><strong>确认正确网络</strong><p>核对 Wi-Fi、接口和源地址，避免通过其他网络提交账号。</p></div></div><div class="help-step"><b>02</b><div><strong>复核认证与出网</strong><p>连续检测确认异常后，再按配置发起认证。</p></div></div><div class="help-step"><b>03</b><div><strong>一次登录，携带 IPv6</strong><p>使用当前账号和实际 IPv6 源地址，不主动注销当前会话。</p></div></div><div class="help-step"><b>04</b><div><strong>核对恢复结果</strong><p>分别检查校园认证、IPv4 和 IPv6，以账号身份匹配和可信网络连通性为准。</p></div></div><div class="help-divider"></div><h3>关闭窗口与停止监测</h3><p>关闭窗口后，后台服务仍可继续运行。选择“停止全部监测”可保存停止状态，重新打开界面不会自动恢复。</p><div class="help-divider"></div><h3>账号如何保存</h3><p>${state.preview?'隔离测试仅在内存保存配置，退出后清除。':'界面草稿使用系统安全存储。系统后台使用 Windows DPAPI 或 macOS 系统钥匙串，不提供密码明文落盘降级。'}</p></aside></div>`;}
function diagnostics(){return heading('运行日志','查看检测、认证及恢复记录，支持导出脱敏诊断文件。',button('open-logs','日志目录','folder')+button('export','导出脱敏诊断','download','primary'))+
  `<div class="diagnostic-cards"><div class="card diagnostic-mini"><span>当前运行环境</span><strong>${state.mode==='simulation'?'模拟模式':'系统后台'}</strong><small>${state.mode==='simulation'?'模拟数据 · 不提交校园认证':'与界面分开运行'}</small></div><div class="card diagnostic-mini"><span>最近检测完成</span><strong>${time(state.lastCheckedAt)}</strong><small>每次检测完成后更新时间</small></div><div class="card diagnostic-mini"><span>最近登录提交</span><strong>${state.lastLoginAt?time(state.lastLoginAt):'尚未提交'}</strong><small>单次提交后先观察恢复结果</small></div></div><div class="logs-toolbar">${[['all','全部'],['info','一般'],['success','恢复'],['warning','需关注']].map(([key,name])=>`<button class="filter-button ${logFilter===key?'active':''}" data-filter="${key}">${name}</button>`).join('')}<span class="tag">最近 ${state.logs.length} 条</span></div><div class="card logs-card full-events">${eventRows(true)}</div><div class="safety-note">${icon('lock')}诊断导出不包含密码、账号全文、余额或流量账单，也不保存认证响应原文。</div>`+simulation();}

function render(){
  if(!state)return;
  $('#page-label').textContent=labels[page];$('#account-count').textContent=state.accounts.length;
  $('#mode-label').textContent=state.mode==='simulation'?'模拟模式':'系统后台';$('#sidebar-mode').textContent=state.mode==='simulation'?'模拟模式中':'后台服务已连接';
  $('#platform-label').textContent=state.platform==='darwin'?'macOS · Apple 芯片':state.platform==='win32'?'Windows · 64 位':'本地界面预览';
  $('#switch-mode').innerHTML=(state.mode==='simulation'?'连接后台服务':'切换至模拟模式')+icon('arrow');
  const banner=$('#mode-banner');banner.className='mode-banner'+(state.mode==='system'?' system':'');
  banner.innerHTML=state.mode==='simulation'?`${icon('flask')}<div><strong>模拟模式</strong><span>网络状态与用量均为模拟数据，不连接无线网络或提交校园网认证。</span></div><span class="banner-end">${state.preview?'隔离测试':'模拟模式'}</span>`:`${icon('shield')}<div><strong>后台服务已连接</strong><span>关闭窗口后仍继续运行。需要停止时，请选择“停止全部监测”。</span></div>`;
  if(state.mode==='system'&&!state.service.connected){banner.className='mode-banner disconnected';banner.innerHTML=`${icon('info')}<div><strong>系统后台连接中断</strong><span>下方保留上次读取的状态，当前监测和联网情况尚未确认。请重新连接后台。</span></div>`;$('#sidebar-mode').textContent='后台连接中断';}
  if(state.mode==='simulation'&&state.service.known){banner.innerHTML+=`<div class="service-alert">${state.service.running===true?'实际后台仍在运行；如需同时停止，请选择“停止全部监测”。':state.service.running===false?'实际后台已停止。':'实际后台状态尚未确认，请重新连接后台服务。'}</div>`;}
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  if((page==='settings'&&policyDirty)||(page==='wifi'&&wifiDirty))return;
  $('#view').innerHTML=page==='overview'?overview():page==='wifi'?wifiPage():page==='accounts'?accounts():page==='settings'?settingsPage():diagnostics();
  $('#version-label').textContent='v'+state.version;hydrate();countdown();
}
function hydrate(){document.querySelectorAll('[data-icon]').forEach(el=>{if(!el.firstElementChild)el.innerHTML=icon(el.dataset.icon);});}
function countdown(){if(!state)return;const el=$('#countdown');if(!el)return;const now=state.time+(Date.now()-snapshotAt)*(state.mode==='simulation'?10:1);const remaining=Math.max(0,Math.ceil(((state.nextCheckAt||now)-now)/1000));el.textContent=state.running?(state.busy?'正在检测…':`下次检查 ${remaining} 秒`):'已停止监测';}
function showAccount(id){
  editingId=id||null;const a=state.accounts.find(x=>x.id===id);const form=$('#account-form');form.reset();
  form.elements.label.value=a?.label||'';form.elements.username.value=a?.username||'';form.elements.password.type='password';form.elements.enabled.checked=a?.enabled!==false;
  form.elements.password.required=!a;form.elements.password.placeholder=a?'留空保持原密码':'填写校园网密码';
  $('#password-required').textContent=a?'':'*';$('#account-error').textContent='';$('#account-dialog-title').textContent=a?'编辑校园账号':'添加校园账号';
  $('#credential-note').textContent=state.preview?'隔离测试中的配置仅在当前会话有效，不写入系统安全存储或提交认证。':'密码使用系统安全存储，保存后不会回传到界面。';
  $('#account-dialog').showModal();
}
function confirmBox(title,content,action,label='确认'){
  $('#confirm-dialog .confirm-body').innerHTML=`<h2>${esc(title)}</h2>${content}<div class="dialog-footer"><button class="button secondary" data-action="close-confirm">取消</button><button class="button primary" data-action="confirm-action">${esc(label)}</button></div>`;
  confirmHandler=action;$('#confirm-dialog').showModal();
}
async function installation(){
  const info=await invoke('installationInfo');
  confirmBox('安装独立系统后台',`<p>将安装 ${esc(info.kind)}，使无人登录时也能监测校园网络。</p><ul>${info.actions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>系统目录：<code>${esc(info.root)}</code></p><p>${esc(info.caveat)}</p>${state.preview?'<p><strong>本次隔离测试禁止安装，先查看界面与流程即可。</strong></p>':''}`,async()=>{const r=await invoke('installBackend',{confirm:true});toast(r.message);},state.preview?'隔离测试不安装':'请求系统安装');
}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-page]');if(nav){page=nav.dataset.page;policyDirty=false;wifiDirty=false;render();return;}
  const filter=event.target.closest('[data-filter]');if(filter){logFilter=filter.dataset.filter;render();return;}
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  const action=target.dataset.action,id=target.dataset.id;
  try{
    if(action==='add-account')return showAccount();
    if(action==='edit-account')return showAccount(id);
    if(action==='close-account'){$('#account-form').elements.password.value='';$('#account-dialog').close();return;}
    if(action==='reveal-password'){const input=$('#account-form').elements.password;input.type=input.type==='password'?'text':'password';return;}
    if(action==='stop-all'){const result=await invoke('stopAll');use(result.snapshot);toast(result.message,!result.ok);return;}
    if(action==='reveal-wifi'){const input=$('#wifi-form').elements.password;input.type=input.type==='password'?'text':'password';return;}
    if(action==='verify-wifi'){$('#toast').className='toast';return confirmBox('确认验证无线网络连接',state.mode==='simulation'?'<p>模拟模式，只模拟连接、密码错误与 IP 核对，不更改本机无线网络。</p>':'<p>会短暂断开并重新连接你保存的目标 Wi-Fi，以验证这份无线密码。输入错误或信号不可达时，可能需要手动恢复原网络；本步不会提交校园账号或主动注销校园网。</p>',async()=>{use(await invoke('verifyWifi'));},state.mode==='simulation'?'开始模拟验证':'重新连接并验证');}
    if(action==='close-confirm'){$('#confirm-dialog').close();confirmHandler=null;return;}
    if(action==='confirm-action'){const fn=confirmHandler;$('#confirm-dialog').close();confirmHandler=null;if(fn)await fn();return;}
    if(action==='delete-account')return confirmBox('移除这个校园账号？','<p>只从本应用移除，不删除校园账号，也不会主动注销当前网络连接。</p>',async()=>{use(await invoke('removeAccount',{id}));toast('账号已移除');},'移除');
    if(action==='move-up'||action==='move-down'){const ids=state.accounts.map(a=>a.id),i=ids.indexOf(id),j=i+(action==='move-up'?-1:1);[ids[i],ids[j]]=[ids[j],ids[i]];use(await invoke('reorderAccounts',{ids}));return;}
    if(action==='retry-account'){use(await invoke('retryAccount',{id}));toast('已允许这个账号在下次符合条件时重试');return;}
    if(action==='show-logs'){page='diagnostics';render();return;}
    if(action==='install-info')return installation();
    if(action==='sync-draft')return confirmBox('导入本机保存的账号与设置？','<p>将本机草稿写入尚无账号的系统后台，不提交校园认证。导入后请检查账号，再开启自动重连。</p>',async()=>{use(await invoke('syncDraft'));toast('账号与设置已导入系统后台');},'导入到后台');
    if(action==='switch-mode'){
      const r=await invoke('setMode',{mode:state.mode==='simulation'?'system':'simulation'});
      if(r.installationRequired){if(r.versionMismatch)toast('后台服务版本与当前应用不一致，请更新后台服务。',true);return installation();}use(r);return;
    }
    if(action==='reset-settings'){policyDirty=false;render();return;}
    if(action==='import'){const r=await invoke('importAccounts');use(r);if(!r.cancelled)toast('账号已导入');return;}
    if(action==='export'){const r=await invoke('exportDiagnostics');if(r.saved)toast('脱敏诊断已导出');return;}
    if(action==='open-logs'){await invoke('openLogFolder');return;}
    const method={start:'start',stop:'stop',check:'check',login:'login', 'load-demo':'loadDemo'}[action];
    if(method){target.disabled=true;use(await invoke(method,method==='check'?{refreshStats:true}:{}));}
  }catch{}finally{if(target.isConnected)target.disabled=false;}
});
document.addEventListener('change',async event=>{
  if(event.target.id==='scenario'){try{use(await invoke('setScene',{scene:event.target.value}));}catch{}return;}
  if(event.target.closest('#settings-form'))policyDirty=true;
  if(event.target.closest('#wifi-form')){wifiDirty=true;if(event.target.name==='security')$('#wifi-form [name=password]').disabled=event.target.value==='open';document.querySelector('[data-action=verify-wifi]').disabled=true;}
});
document.addEventListener('input',event=>{if(event.target.closest('#settings-form'))policyDirty=true;if(event.target.closest('#wifi-form')){wifiDirty=true;document.querySelector('[data-action=verify-wifi]').disabled=true;}});
document.addEventListener('submit',async event=>{
  event.preventDefault();
  if(event.target.id==='wifi-form'){
    const f=event.target.elements;try{const result=await invoke('saveWifi',{ssid:f.ssid.value,security:f.security.value,password:f.password.value});f.password.value='';wifiDirty=false;use(result);toast('无线配置已保存，请再点击连接并验证');}catch{}return;
  }
  if(event.target.id==='account-form'){
    const f=event.target.elements;const payload={id:editingId,label:f.label.value,username:f.username.value,password:f.password.value,enabled:f.enabled.checked};
    const submit=event.target.querySelector('[type=submit]');submit.disabled=true;
    try{use(await invoke('upsertAccount',payload));f.password.value='';$('#account-dialog').close();toast('账号已保存，下次需要登录时按新配置使用');}
    catch(error){$('#account-error').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}finally{submit.disabled=false;}
  }
  if(event.target.id==='settings-form'){
    const f=event.target.elements;const patch={};
    for(const key of ['checkInterval','confirmInterval','failureThreshold','loginCooldown','wifiRetry','statsInterval'])patch[key]=Number(f[key].value);
    for(const key of ['autoWifi','ipv6Recovery','startOnBoot'])patch[key]=f[key].checked;
    patch.interface=f.interface.value;
    try{const value=await invoke('settings',patch);policyDirty=false;use(value);toast(state.mode==='simulation'?'模拟配置已保存。后台服务须单独导入此配置。':'后台服务配置已保存。');}catch{}
  }
});

hydrate();$('#view').innerHTML='<div class="loading">正在加载配置…</div>';
api.subscribe(use);api.invoke('status').then(use).catch(()=>toast('本地界面未能连接应用主进程',true));
setInterval(countdown,1000);
