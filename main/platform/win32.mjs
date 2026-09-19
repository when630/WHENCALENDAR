// main/platform/win32.mjs — Windows가 하는 방식. v0.1.1까지 코드에 박혀 있던 그대로다 (PLAT-06).
//
// electron을 import하지 않는다. 여기는 "무엇을 할지"를 적은 표일 뿐이고, 부르는 것은
// lifecycle·overlay·update가 한다 — 그래야 창 없이 도는 테스트가 이 표를 읽을 수 있다(D-27).

export const win32 = {
  id: 'win32',

  tray: {
    // 트레이 아이콘은 밝은·어두운 작업 표시줄 양쪽에 서므로 아이콘의 파랑을 그대로 쓴다.
    icons: ['tray.png'],
    template: false,
    // 작업 표시줄의 트레이 아이콘은 왼쪽 클릭으로 창을 여는 것이 관습이다.
    clickOpensWindow: true,
  },

  // Dock이 없다. 응용 프로그램 메뉴도 두지 않는다 — 기본 메뉴의 단축키(F12·Ctrl+R)를
  // 그대로 남긴다. 여기서 null이 아닌 것을 돌려주면 그것을 지우게 된다.
  hideDock: false,
  appMenu: null,

  overlay: {
    // 화면 맨 위. 작업 표시줄이 위에 붙어 있어도 오버레이는 항상 위에 뜬다.
    top: (display) => display.bounds.y,
    // 창 종류는 기본값. `type`은 macOS 전용이다.
    windowType: null,
    // 전체화면·TopMost 창이 나중에 뜨면 같은 z-order 밴드에서 우리 위로 올라간다.
    // 레벨만으로는 풀리지 않아 1초마다 다시 잡는다 (D-14).
    keepTopMovesTop: true,
    workspaces: { visibleOnFullScreen: true },
  },

  update: {
    // 미서명이어도 NSIS는 설치된다. 내려받아 두고 종료할 때 설치한다 (REL-03).
    autoDownload: true,
    installOnQuit: true,
    manual: false,
  },

  dataDirLabel: '%APPDATA%\\whencalendar',
};
