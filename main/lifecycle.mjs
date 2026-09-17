// main/lifecycle.mjs — 앱 수명·트레이·틱. 엔트리포인트는 bootstrap() 하나뿐이다(WHENWORK D-08 승계).
//
// 틱은 1초 고정이 아니다. clock.msUntilNextChange가 "다음에 화면이 바뀌는 시각"을 알려 주므로
// 접혀 있을 때는 오래 자고 펼쳐졌을 때만 매초 깨운다 — 상주 앱이라 안 깨는 것이 이득이다.
import { app, Tray, Menu, nativeImage, globalShortcut, powerMonitor } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createSettings } from './settings.mjs';
import { createOverlay } from './overlay.mjs';
import { stateAt, msUntilNextChange, DEFAULTS } from './clock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const isSmoke = process.argv.includes('--smoke');
const isSeed = process.argv.includes('--seed');

function dayRange(d = new Date()) {
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return [from.toISOString(), to.toISOString()];
}

// 검증용 일정 — `npm run seed`로만 들어간다. 평소 실행에는 아무것도 만들지 않는다.
//
// 고정 시각(14:00 같은)으로 넣으면 저녁에 실행했을 때 전부 지난 일정이라 아무것도 확인할 수
// 없다. 지금으로부터 몇 분 뒤인지로 넣어야 언제 돌려도 오버레이가 살아 있다.
function seedDemo(store) {
  const cal = store.localCalendarId();
  const base = Date.now();
  const at = (min) => new Date(base + min * 60_000).toISOString();

  store.clearSeed();
  const rows = [
    ['다가오는 회의', 15, 45], // 15분 뒤 — 이미 펼쳐진 상태로 보인다
    ['디자인 리뷰', 75, 45],
    ['1:1 미팅', 180, 30],
  ];
  rows.forEach(([title, offset, dur], i) => {
    store.addEvent({
      calendarId: cal,
      title,
      startsAt: at(offset),
      endsAt: at(offset + dur),
      uid: `seed-${i + 1}`,
    });
  });
  return rows.length;
}

// 트레이 아이콘. 비어 있으면 Windows 트레이에 아무것도 안 뜨고, 그러면 앱을 끌 방법이
// 사라진다 — 스모크가 이걸 검사하는 이유다(REL-05).
function trayIcon() {
  const png = path.join(ROOT, 'build', 'tray.png');
  if (!fs.existsSync(png)) return nativeImage.createEmpty();
  return nativeImage.createFromPath(png);
}

function overlayOptions(store) {
  return {
    ...DEFAULTS,
    revealStartSec: store.getSetting('revealStartSec', DEFAULTS.revealStartSec),
    revealFullSec: store.getSetting('revealFullSec', DEFAULTS.revealFullSec),
    endSoonEnabled: store.getSetting('endSoonEnabled', DEFAULTS.endSoonEnabled),
  };
}

// 렌더러에 넘길 만큼만 추린다 — 창 하나가 화면에 그릴 수 있는 것이 전부다.
function toPayload(st, store) {
  return {
    mode: st.mode,
    title: st.event?.title ?? '',
    leftSec: st.leftSec,
    ratio: st.ratio,
    reveal: st.reveal,
    tier: st.tier,
    endingSoon: st.endingSoon,
    beat: st.beat,
    restCount: st.rest.length,
    color: st.event?.color ?? null,
    next: st.next ? { title: st.next.title, startsAt: st.next.startsAt } : null,
    ringSize: store.getSetting('ringSize', 20),
  };
}

export function bootstrap() {
  app.setName('whencalendar');

  // 형제 앱 셋과 같은 PC에서 돌아도 서로 간섭하지 않는다 (PLAT-05).
  //
  // --smoke·--seed는 락을 요구하지 않는다. 검사 도구는 앱이 떠 있는 채로 돌리게 되는데,
  // 락에 걸려 조용히 죽으면 출력이 비어도 통과한 것처럼 보인다 — 실제로 그랬다.
  if (!isSmoke && !isSeed && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const ctx = { store: null, settings: null, overlay: null, tray: null, timer: null };

  function loadEvents() {
    const [from, to] = dayRange();
    return ctx.store.ok ? ctx.store.listBetween(from, to) : [];
  }

  function tick() {
    clearTimeout(ctx.timer);
    const events = loadEvents();
    const opts = overlayOptions(ctx.store);
    const st = stateAt(Date.now(), events, opts);
    ctx.overlay.push(toPayload(st, ctx.store));

    // 오늘 일정이 없어도 자정에는 다시 봐야 한다
    const next = msUntilNextChange(Date.now(), events, opts) ?? 60_000;
    ctx.timer = setTimeout(tick, next);
  }

  function buildTray() {
    const tray = new Tray(trayIcon());
    tray.setToolTip('WHENCALENDAR');
    const menu = Menu.buildFromTemplate([
      {
        label: '오버레이 잠시 끄기',
        type: 'checkbox',
        checked: ctx.overlay.suspended,
        click: (item) => ctx.overlay.setSuspended(item.checked),
      },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    return tray;
  }

  app.whenReady().then(() => {
    const dir = app.getPath('userData');
    ctx.store = createStore(path.join(dir, 'store.sqlite'));
    ctx.settings = createSettings(path.join(dir, 'settings.json'));

    if (isSeed) {
      const n = ctx.store.ok ? seedDemo(ctx.store) : 0;
      console.log(`[seed] ${n} events into ${ctx.store.file}`);
      app.quit();
      return;
    }

    // 창을 띄우지 않고 저장소·상태 계산까지 자가진단한다 (REL-05)
    if (isSmoke) {
      const events = loadEvents();
      const st = stateAt(Date.now(), events, overlayOptions(ctx.store));
      const tray = !trayIcon().isEmpty();
      const ok = ctx.store.ok && tray;
      console.log(
        JSON.stringify({
          store: ctx.store.ok,
          reason: ctx.store.state.reason,
          tray,
          events: events.length,
          mode: st.mode,
          tier: st.tier,
        })
      );
      app.exit(ok ? 0 : 1);
      return;
    }

    ctx.overlay = createOverlay();
    ctx.overlay.start();
    ctx.tray = buildTray();

    // 자는 동안 틱이 멈춰 있었다 — 깨어난 순간 과거 상태를 보여서는 안 된다 (OVL-14)
    powerMonitor.on('resume', tick);
    powerMonitor.on('unlock-screen', tick);

    globalShortcut.register('Ctrl+Alt+O', () => ctx.overlay.setSuspended(!ctx.overlay.suspended));

    tick();
  });

  app.on('will-quit', () => {
    clearTimeout(ctx.timer);
    globalShortcut.unregisterAll();
    ctx.overlay?.destroy();
    ctx.settings?.flush();
    ctx.store?.close();
  });

  // 트레이에 사는 앱이라 창을 닫아도 끝나지 않는다 (WIN-08)
  app.on('window-all-closed', () => {});
}
