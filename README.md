<div align="center">
  <h1>WHENCALENDAR</h1>
  <p><b>몰입해도 시간은 놓치지 않는다. 보려고 하지 않아도 남은 시간이 보인다.</b></p>
  <p>Windows · macOS 트레이 상주 앱 · 한국어</p>
</div>

---

> **상태: v0.1.0 준비 중.** 기능은 다 돌아가고 설치 파일도 Windows·macOS 양쪽으로 만들어집니다. 아직 공개 릴리스를 올리지 않았습니다.

코드에 파묻혀 있다가 회의 시간을 넘긴 적이 있다면 그게 이 앱이 푸는 문제입니다.

알림은 **한 번** 울리고 끝납니다. 몰입한 사람은 그 한 번을 놓칩니다. 그리고 10분 전 팝업은 이미 늦습니다 — 하던 것을 정리할 시간이 없습니다. 시계와 트레이 아이콘은 **봐야** 보이고, 몰입하면 보지 않습니다.

그래서 WHENCALENDAR는 알림을 울리지 않습니다. 화면 위쪽에 작은 아일랜드가 상주하면서, 다음 일정이 가까워질수록 **스스로 커집니다.**

- **평소엔 점 하나** — 60분 넘게 남으면 링만 조용히 떠 있습니다
- **30분부터 펼쳐집니다** — 일정 이름과 남은 시간이 옆으로 흘러나오고, 링이 줄어듭니다
- **5분부터 붉어지고 1분에 숨을 쉽니다** — 색과 두께로만 말합니다. 몰입 중에 숫자를 읽을 여유는 없습니다
- **회의가 시작되면 청록으로** — 이번엔 끝날 때까지를 셉니다. **종료 5분 전에 다시 색이 들어옵니다** — 다음이 있는데 회의가 안 끝날 때를 위한 신호입니다
- **마우스를 올리면 펼쳐집니다** — 시간과 상관없이, 그 다음 일정까지

창을 열 일은 드뭅니다. 일정은 `.ics` 구독으로 알아서 들어오고, 직접 등록할 때만 창이 필요합니다.

## 형제 앱

같은 트레이에 나란히 사는 네 앱입니다. 서로 코드를 공유하지 않고, 영역도 겹치지 않습니다.

| 앱 | 답하는 질문 |
|---|---|
| [WHENWORK](https://github.com/when630/whenwork) | 뭘 해야 하지 · 뭐가 밀렸지 |
| [WHENNOTE](https://github.com/when630/whennote) | 그때 뭐라고 적었더라 |
| [WHENMAIL](https://github.com/when630/whenmail) | 이 사람한테 마지막으로 언제 연락했지 |
| **WHENCALENDAR** | **다음 하나까지 몇 분 남았지 · 이번 주 어디가 비지** |

**이 앱이 하지 않는 것** — 할 일·체크박스·마감(WHENWORK), 긴 메모·태그·백링크(WHENNOTE), 사람·연락 기록(WHENMAIL). 특히 **타임블로킹(할 일을 캘린더로 끌어다 놓기)은 넣지 않습니다** — 그 순간 WHENWORK를 삼킵니다.

## 만들 것

**v1 (다 됐습니다)**
- 상단 아일랜드 오버레이 — 링 게이지, 남은 일정 점, 진행 중·종료 임박, 호버 확장
- `.ics` 구독 (읽기 전용) + 이 PC에 직접 등록
- 오늘 · 주 · 월 · 구독 · 설정
- 한 줄 입력 — `담주 화 3시 김부장 미팅 1시간`, `매주 화 3시 주간회의`
- 반복 일정을 회차 단위로 — 이 회차만 / 이 회차부터 뒤 / 전체
- 빈 시간 찾기 <kbd>G</kbd> · 가능 시간 복사 <kbd>Y</kbd> · 검색 <kbd>/</kbd>
- 내보내기·가져오기 (JSON · `.ics`)

**나중에** — 타임존 전환 UI, 클립보드·음성에서 일정 낚아채기

## 설치

[Releases](../../releases)에서 자기 것을 받습니다. 데이터베이스도, 계정도, 다른 프로그램도
필요 없습니다.

| | 받을 파일 | |
|---|---|---|
| Windows | `WHENCALENDAR-<버전>-win-x64.exe` | 실행하면 끝입니다 |
| macOS · Apple 실리콘 | `WHENCALENDAR-<버전>-mac-arm64.dmg` | 열어서 **응용 프로그램**으로 끌어 놓습니다 |
| macOS · 인텔 | `WHENCALENDAR-<버전>-mac-x64.dmg` | 〃 |

자기 맥이 어느 쪽인지 모르면 애플 메뉴 → **이 Mac에 관하여**의 칩 이름을 봅니다 —
Apple M으로 시작하면 arm64입니다.

### macOS에서는 Dock이 아니라 메뉴 막대에 삽니다

트레이 상주 앱이라 Dock에도, <kbd>Cmd</kbd>+<kbd>Tab</kbd>에도 뜨지 않습니다. 오른쪽 위
**메뉴 막대 아이콘**이 그 자리를 대신합니다 — 누르면 메뉴가 열리고, 거기서 일정을 보거나
종료합니다. 오버레이는 메뉴 막대 바로 아래에 붙습니다(노치가 있는 맥에서도 가려지지 않습니다).

### 처음 실행할 때 경고가 뜹니다

코드 서명 인증서를 쓰지 않아서 OS가 경고를 냅니다. 서명에는 연 수십만 원이 들고 macOS는
공증까지 필요합니다. 이 앱은 그 비용을 쓰지 않습니다. 대신 무엇을 하는 앱인지는 이
저장소의 코드가 전부입니다.

**Windows** — "Windows의 PC 보호" 파란 창이 뜨면 **추가 정보** → **실행**을 누릅니다.

**macOS** — "확인되지 않은 개발자"나 **"손상되었기 때문에 열 수 없습니다"**가 뜹니다.
뒤쪽 문구는 파일이 깨진 것이 아니라 내려받은 파일에 붙는 **격리 표시** 때문입니다.
터미널에서 한 번 떼면 됩니다.

```bash
xattr -dr com.apple.quarantine /Applications/WHENCALENDAR.app
```

또는 앱을 한 번 실행해 거절당한 뒤, 시스템 설정 → **개인정보 보호 및 보안**을 아래로 내려
"WHENCALENDAR을(를) 열 수 없습니다" 옆의 **그래도 열기**를 누릅니다.

### 업데이트

새 버전이 올라오면 앱이 알아서 알립니다 — 켜고 1분 뒤 한 번, 이후 하루 한 번 확인합니다.
**Windows는** 새 버전을 내려받아 두고 **앱을 종료할 때** 설치합니다. 쓰는 도중에 스스로
재시작하지 않습니다 — 상주 앱이 그 순간 사라지면, 놓친 일정이 이 앱이 막으려던 바로 그 일입니다.

**macOS는 알리기만 합니다.** 서명하지 않은 앱은 스스로 갈아끼울 수 없습니다(Squirrel.Mac이
서명을 요구합니다). 메뉴에 `새 버전 0.1.2 — 눌러서 받으러 갑니다`가 뜨고, 누르면 Releases가
열립니다. 새 dmg를 받아 응용 프로그램에 덮어쓰면 됩니다 — 데이터는 앱 바깥에 있어 그대로 남습니다.

트레이·메뉴 막대 메뉴에서 언제든 직접 확인할 수 있습니다.

### 내 데이터

`store.sqlite` 파일 하나에 있습니다 — Windows는 `%APPDATA%\whencalendar`,
macOS는 `~/Library/Application Support/whencalendar`입니다. 설정 탭이 그 경로를 열어 주고,
거기서 JSON으로 내보내거나 되살릴 수 있습니다. `.ics`로도 내보냅니다.

가져오기는 지금 데이터를 **갈아끼우고**, 직전 상태를 `before-import-<시각>.json`으로 남깁니다.

## 개발 실행

```bash
npm install
npm run seed     # 검증용 일정 3건 (지금으로부터 15분·75분·180분 뒤)
npm start
```

| 키 | |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> | 어디서든 창 열기·닫기 |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> | 오버레이 잠시 끄기 (발표·녹화용) |
| <kbd>N</kbd> | 새 일정 — `담주 화 3시 김부장 미팅 1시간`처럼 한 줄로 |
| <kbd>j</kbd> <kbd>k</kbd> · <kbd>←</kbd> <kbd>→</kbd> · <kbd>t</kbd> | 이동 · 날짜 넘기기 · 오늘로 |
| <kbd>X</kbd> <kbd>U</kbd> | 삭제 · 되돌리기 |
| <kbd>?</kbd> | 전체 키맵 |

macOS에서 <kbd>Ctrl</kbd>은 **Control**입니다(<kbd>Cmd</kbd>가 아닙니다) — 네 앱이 두 OS에서
같은 조합을 씁니다. 입력 칸의 <kbd>Cmd</kbd>+<kbd>C</kbd>·<kbd>V</kbd>는 그대로 됩니다.

종료는 트레이 아이콘 우클릭 → 종료(macOS는 메뉴 막대 아이콘 → 종료, 또는
<kbd>Cmd</kbd>+<kbd>Q</kbd>). 단축키가 다른 프로그램과 겹쳐 등록되지 못하면 그 메뉴에 그
사실이 적힙니다 — 눌러도 안 되는 이유를 알 방법이 그것뿐입니다.

```bash
npm test         # 183개. 전부 순수 모듈이라 화면 없이 돈다
npm run smoke    # 창을 띄우지 않고 저장소·상태 계산·트레이 아이콘까지 자가진단
npm run build    # 지금 OS의 설치 파일 → dist/
npm run build:win   # Windows 설치 파일(.exe)  — Windows에서
npm run build:mac   # macOS 설치 파일(.dmg·.zip, arm64+x64) — macOS에서
```

**설치 파일은 그 OS에서만 만듭니다.** dmg는 `hdiutil`·`codesign`이 있어야 하고, 그것들은
macOS에만 있습니다. CI도 같은 이유로 러너를 둘 씁니다(`.github/workflows/release.yml`).

macOS 빌드에는 **ad-hoc 서명**이 붙습니다(`tools/adhoc-sign.cjs`). 인증서가 아니라 봉인이라
Gatekeeper 경고는 그대로 남지만, 이것이 없으면 Apple 실리콘에서 앱이 아예 뜨지 않습니다.

Windows에서는 빌드 전에 **실행 중인 앱을 먼저 끕니다.** 켜 둔 채로 돌리면 electron-builder가
`EPERM: unlink dist\win-unpacked\WHENCALENDAR.exe`로 넘어지는데, 그때 이미
`win-unpacked`가 반쯤 지워져 있어 다음 실행이 ICU 오류로 죽습니다 — 빌드가 깨진 것처럼
보이지만 원인은 잠긴 파일 하나입니다.

브라우저로 여는 시안들:

| 파일 | |
|---|---|
| `design/mockups/whencalendar-mockups.html` | 본체 화면 12종 |
| `poc/flow.html` | 하루를 흘려보내며 보는 상태 전이 |
| `poc/ring.html` · `poc/island.html` · `poc/compare.html` | 오버레이 변형 탐색 기록 |

`poc/verify-fullscreen.ps1`은 오버레이가 전체화면 앱 위에 남는지 확인한다 — 화면을 캡처하므로 눈으로 본다.
PowerShell 스크립트라 Windows 전용이다. macOS에서는 아직 눈으로 본다(REL-05).

## 만들어진 방식

Electron + `node:sqlite` 단일 파일 저장소, 로컬 우선, 계정 없음, 서버 없음.
디자인 토큰은 WHENWORK·WHENNOTE의 `renderer/tokens.css`와 같은 팔레트를 씁니다 — 네 앱이 한 트레이에 산다면 서로 남처럼 생겨서는 안 됩니다.

## 라이선스

MIT. 번들할 [Pretendard](https://github.com/orioncactus/pretendard) 글꼴은 SIL Open Font License 1.1을 따릅니다.
