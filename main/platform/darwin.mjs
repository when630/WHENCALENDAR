// main/platform/darwin.mjs — macOS가 다르게 하는 것 (PLAT-07).
//
// 다섯 군데가 다르다. 그 외에는 Windows와 같은 코드가 돈다.
//
//   1. 메뉴 막대 아이콘은 Template이다 — 알파만 남긴 검정을 OS가 다크/라이트에 맞춰 칠한다.
//      색이 든 tray.png를 그대로 얹으면 어두운 메뉴 막대에서 파란 덩어리가 된다.
//   2. Dock에 뜨지 않는다 — 메뉴 막대에 사는 앱이다. 창을 닫아도 남는 것은 양쪽이 같다.
//   3. 그런데 Dock에서 빠지면(=액세서리 앱) 응용 프로그램 메뉴가 없어 **Cmd+C·V가 죽는다.**
//      메뉴 자체는 화면에 보이지 않지만, 키 조합은 그 메뉴를 타고 들어온다 — 그래서 둔다.
//   4. 오버레이는 메뉴 막대 **아래**에 붙인다 — 화면 맨 위는 메뉴 막대이고, 노치가 있는
//      맥에서는 그 자리가 곧 노치다. workArea가 둘 다 비켜 준다.
//   5. 자동 업데이트가 없다 — Squirrel.Mac은 서명된 앱만 갈아끼운다 (D-31).

export const darwin = {
  id: 'darwin',

  tray: {
    // 앞에서부터 있는 것을 쓴다. Template이 없으면 색 아이콘이라도 떠야 앱을 끌 수 있다.
    icons: ['tray-Template.png', 'tray.png'],
    template: true,
    // 메뉴 막대 아이콘은 왼쪽 클릭으로 메뉴가 열리는 것이 관습이다. 여기서 창까지 열면
    // 메뉴와 창이 함께 튀어나온다.
    clickOpensWindow: false,
  },

  hideDock: true,

  // 화면에 그려지지는 않는다(Dock에 없는 앱의 메뉴 막대는 표시되지 않는다). 그래도
  // Cmd+C·V·A·Z와 Cmd+W·Cmd+Q가 이 표를 타고 들어온다.
  appMenu: () => [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ],

  overlay: {
    top: (display) => display.workArea.y,
    // NSPanel로 띄운다. 보통 창은 **다른 앱의 전체화면 공간 위로는 올라가지 못한다** —
    // 레벨을 screen-saver로 올려도 그렇다. 전체화면 IDE 위에 떠 있는 것이 이 앱의 존재
    // 이유이므로(OVL-02) 여기서는 창 종류부터 다르다.
    windowType: 'panel',
    // 'screen-saver' 레벨이면 전체화면 위에 그대로 선다. Windows처럼 매초 moveTop을
    // 부르면 액세서리 앱이 앞으로 끌려 나와 쓰던 창의 포커스를 흔든다.
    keepTopMovesTop: false,
    // skipTransformProcessType가 없으면 이 호출이 프로세스 종류를 잠깐 바꿔 Dock에
    // 아이콘이 깜빡 떴다 사라진다 — 메뉴 막대 앱에서는 그것이 곧 버그로 보인다.
    workspaces: { visibleOnFullScreen: true, skipTransformProcessType: true },
  },

  update: {
    autoDownload: false,
    installOnQuit: false,
    // 새 버전이 나온 것만 알리고 받는 것은 사람이 한다 (D-31).
    manual: true,
  },

  dataDirLabel: '~/Library/Application Support/whencalendar',
};
