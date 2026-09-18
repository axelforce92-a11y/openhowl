// Ponte minimo e sicuro tra le pagine di OpenHowl e l'app desktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('howlDesktop', {
  openApp: () => ipcRenderer.send('app:open'),
  getMascot: () => ipcRenderer.invoke('mascot:get'),
  setMascot: (on) => ipcRenderer.send('mascot:set', !!on),
  onMascot: (cb) => ipcRenderer.on('mascot:state', (_e, on) => cb(on)),
  moveMascot: (x, y) => ipcRenderer.send('mascot:move', x, y),
  mascotMoved: () => ipcRenderer.send('mascot:moved'),
  mascotMenu: () => ipcRenderer.send('mascot:menu'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
});
