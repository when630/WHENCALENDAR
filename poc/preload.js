'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlay', {
  onState: (fn) => ipcRenderer.on('state', (_e, payload) => fn(payload)),
  setHover: (on) => ipcRenderer.send('hover', on)
})
