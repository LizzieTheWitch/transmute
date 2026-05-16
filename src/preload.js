const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickSave: (defaultName) => ipcRenderer.invoke('pick-save', defaultName),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  buildPdf: (opts) => ipcRenderer.invoke('build-pdf', opts),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  onProgress: (cb) => {
    ipcRenderer.on('progress', (_, data) => cb(data));
  },
  removeProgressListener: () => ipcRenderer.removeAllListeners('progress'),
});
