// 오버레이 렌더러가 쓰는 유일한 통로. 창은 클릭을 통과시키므로 CSS :hover가 걸리지 않는다 —
// 렌더러가 mousemove로 직접 판정해 setHover로 알린다(D-04).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onState: (fn) => ipcRenderer.on('overlay:state', (_e, payload) => fn(payload)),
  setHover: (on) => ipcRenderer.send('overlay:hover', !!on),
});
