const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gideon', {
  setAlwaysOnTop: (v) => ipcRenderer.invoke('set-always-on-top', v),
  setStealth: (v) => ipcRenderer.invoke('set-stealth', v),
  setClickThrough: (v) => ipcRenderer.invoke('set-click-through', v),
  close: () => ipcRenderer.invoke('close-app'),
  minimize: () => ipcRenderer.invoke('minimize-app'),
  onHotkeyListen: (cb) => ipcRenderer.on('hotkey-listen', cb),
  onHotkeyAsk: (cb) => ipcRenderer.on('hotkey-ask', cb),
  onMeetingDetected: (cb) => ipcRenderer.on('meeting-detected', (_e, name) => cb(name)),
  onMeetingCleared: (cb) => ipcRenderer.on('meeting-cleared', cb),
  dismissMeeting: (name) => ipcRenderer.invoke('dismiss-meeting', name),
});
