// 렌더러가 쓰는 유일한 통로. 오버레이와 본체 창이 같은 preload를 쓰되 각자 필요한 것만 부른다.
const { contextBridge, ipcRenderer } = require('electron');

// 오버레이 — 창이 클릭을 통과시키므로 CSS :hover가 걸리지 않는다.
// 렌더러가 mousemove로 직접 판정해 setHover로 알린다(D-04).
contextBridge.exposeInMainWorld('overlay', {
  onState: (fn) => ipcRenderer.on('overlay:state', (_e, payload) => fn(payload)),
  setHover: (on) => ipcRenderer.send('overlay:hover', !!on),
});

// 본체 창 — 저장소에 닿는 것은 전부 여기를 지난다. 렌더러는 SQL을 모른다.
contextBridge.exposeInMainWorld('cal', {
  list: (opts) => ipcRenderer.invoke('cal:list', opts),
  parse: (line) => ipcRenderer.invoke('cal:parse', line),
  add: (line) => ipcRenderer.invoke('cal:add', line),
  remove: (id) => ipcRenderer.invoke('cal:delete', id),
  restore: (id) => ipcRenderer.invoke('cal:restore', id),
  info: () => ipcRenderer.invoke('app:info'),
  onChanged: (fn) => ipcRenderer.on('cal:changed', () => fn()),
  hide: () => ipcRenderer.send('win:hide'),
  minimize: () => ipcRenderer.send('win:minimize'),
});
