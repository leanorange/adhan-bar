const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  state: () => ipcRenderer.invoke('state'),
  set: (s) => ipcRenderer.invoke('set', s),
  pick: () => ipcRenderer.invoke('pick'),
  test: () => ipcRenderer.invoke('test'),
  stop: () => ipcRenderer.invoke('stop'),
  ended: () => ipcRenderer.send('ended'),
  onState: (cb) => ipcRenderer.on('state', (_, s) => cb(s)),
});
