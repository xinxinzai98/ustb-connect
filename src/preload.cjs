'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('bkql',Object.freeze({
  invoke:(method,body={})=>ipcRenderer.invoke('bkql:call',{method,body}),
  subscribe:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('bkql:state',handler);return()=>ipcRenderer.removeListener('bkql:state',handler);},
}));
