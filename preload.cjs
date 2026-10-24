const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localClipboard', {
  readImage: () => ipcRenderer.invoke('clipboard:read-image'),
});
