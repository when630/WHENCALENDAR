// main/window.mjs — 본체 창. 오버레이와 달리 가끔 열리고, 열리면 보통 창처럼 군다(D-02).
//
// 창을 닫아도 앱은 트레이에 남는다(WIN-08). 닫기는 파괴가 아니라 숨기기다 — 다시 열 때
// 저장소를 다시 읽고 창을 다시 만드는 비용이 사람이 느낄 만큼 크다.
import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_W = 960;
export const DEFAULT_H = 640;
export const MIN_W = 760;
export const MIN_H = 540;

export function createMainWindow(settings) {
  let win = null;

  function build() {
    const saved = settings.get('mainBounds', null);
    win = new BrowserWindow({
      width: saved?.width ?? DEFAULT_W,
      height: saved?.height ?? DEFAULT_H,
      x: saved?.x,
      y: saved?.y,
      minWidth: MIN_W,
      minHeight: MIN_H,
      show: false,
      backgroundColor: '#16171c',
      autoHideMenuBar: true,
      title: 'WHENCALENDAR',
      webPreferences: { preload: path.join(HERE, 'preload.cjs') },
    });

    win.loadFile(path.join(HERE, '..', 'renderer', 'main.html'));

    const remember = () => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      settings.set('mainBounds', win.getBounds());
    };
    win.on('moved', remember);
    win.on('resized', remember);

    // 닫기는 숨기기다. 앱은 트레이에 남는다.
    win.on('close', (e) => {
      if (win.__reallyClose) return;
      e.preventDefault();
      win.hide();
    });
  }

  return {
    get window() {
      return win;
    },

    show() {
      if (!win || win.isDestroyed()) build();
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },

    hide() {
      if (win && !win.isDestroyed()) win.hide();
    },

    // 보이기만 하면 끄는 것이 아니라 **포커스까지 있을 때만** 끈다.
    // 다른 창을 쓰다가 단축키를 누르는 것은 "가려 달라"가 아니라 "보여 달라"다 —
    // 뒤에 깔린 창을 숨겨 버리면 한 번 더 눌러야 나온다.
    toggle() {
      if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) this.hide();
      else this.show();
    },

    // 일정이 바뀌면 열려 있는 창에 알린다. 닫혀 있으면 다음에 열 때 어차피 다시 읽는다.
    notifyChanged() {
      if (win && !win.isDestroyed()) win.webContents.send('cal:changed');
    },

    destroy() {
      if (win && !win.isDestroyed()) {
        win.__reallyClose = true;
        win.destroy();
      }
      win = null;
    },
  };
}
