// main/overlay.mjs — 상단 아일랜드 창. 이 앱의 존재 이유다(OVL-01~14).
//
// 창은 화면 전체가 아니라 상단 작은 영역만 덮는다(D-03). 투명·클릭 통과·포커스 없음이고,
// z-order는 주기적으로 다시 잡는다(D-14) — 이게 없으면 전체화면 앱이 나중에 뜰 때 가려진다.
import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const WIN_W = 620;
export const WIN_H = 156;

// z-order를 다시 잡는 주기. 짧을수록 전체화면 앱이 뜬 직후 가려지는 시간이 줄지만,
// 상주 앱이 계속 도는 일이라 1초면 충분하다(D-14).
const KEEP_TOP_MS = 1000;

export function createOverlay() {
  let win = null;
  let keepTopTimer = null;
  let hovering = false;
  let suspended = false; // OVL-13 — 발표·녹화 중 잠시 끄기

  function placeOn(display) {
    const b = display.bounds;
    return {
      x: Math.round(b.x + (b.width - WIN_W) / 2),
      y: b.y,
    };
  }

  function build() {
    const { x, y } = placeOn(screen.getPrimaryDisplay());
    win = new BrowserWindow({
      x,
      y,
      width: WIN_W,
      height: WIN_H,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false, // 타이핑하던 창의 커서를 뺏지 않는다 (OVL-04)
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: path.join(HERE, 'preload.cjs') },
    });

    // 마우스는 통과시키되 이동 이벤트만 렌더러로 넘긴다 — 호버 확장을 위해(OVL-03·OVL-11)
    win.setIgnoreMouseEvents(true, { forward: true });
    raise();
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    win.loadFile(path.join(HERE, '..', 'renderer', 'overlay.html'));
    win.webContents.once('did-finish-load', () => {
      if (!suspended) win.showInactive();
    });
  }

  function raise() {
    if (!win || win.isDestroyed()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }

  // 전체화면·TopMost 창이 나중에 뜨면 같은 z-order 밴드에서 우리 위로 올라간다.
  // 레벨을 올려서 풀리는 문제가 아니라 주기적으로 다시 잡아야 한다(D-14).
  function startKeepTop() {
    stopKeepTop();
    keepTopTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      raise();
    }, KEEP_TOP_MS);
  }

  function stopKeepTop() {
    if (keepTopTimer) clearInterval(keepTopTimer);
    keepTopTimer = null;
  }

  // 아일랜드 위에 마우스가 올라오면 잠깐 통과를 끈다. 벗어나면 되돌린다.
  ipcMain.on('overlay:hover', (_e, on) => {
    hovering = !!on;
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(!hovering, { forward: true });
  });

  function relocate() {
    if (!win || win.isDestroyed()) return;
    const { x, y } = placeOn(screen.getPrimaryDisplay());
    win.setBounds({ x, y, width: WIN_W, height: WIN_H });
    raise();
  }

  return {
    start() {
      if (win) return;
      build();
      startKeepTop();
      // 모니터를 붙였다 뗐다 하면 주 모니터가 바뀐다 (PLAT-04)
      screen.on('display-metrics-changed', relocate);
      screen.on('display-added', relocate);
      screen.on('display-removed', relocate);
    },

    push(payload) {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('overlay:state', payload);
    },

    get hovering() {
      return hovering;
    },

    get suspended() {
      return suspended;
    },

    // OVL-13 — 발표·녹화 중에는 잠시 감춘다. 상태 계산은 계속 돈다.
    setSuspended(v) {
      suspended = !!v;
      if (!win || win.isDestroyed()) return;
      if (suspended) {
        win.hide();
      } else {
        win.showInactive();
        raise();
      }
    },

    destroy() {
      stopKeepTop();
      screen.removeListener('display-metrics-changed', relocate);
      screen.removeListener('display-added', relocate);
      screen.removeListener('display-removed', relocate);
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
