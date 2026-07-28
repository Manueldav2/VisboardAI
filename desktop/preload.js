const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gideon', {
  setAlwaysOnTop: (val) => ipcRenderer.invoke('set-always-on-top', val),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
