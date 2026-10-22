'use strict';
const {call}=require('./control.cjs');
call('stop').then(value=>{
  if(value?.running!==false)throw new Error('StillRunning');
  process.stdout.write('自动联网已暂停。重新打开界面或重启系统仍保持暂停；需要恢复时在界面中开启。\n');
}).catch(()=>{process.stderr.write('未能确认停止。请打开界面暂停，或由管理员检查系统后台；未提交校园认证。\n');process.exitCode=1;});
