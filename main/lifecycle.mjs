// main/lifecycle.mjs — 앱 수명·트레이·틱. 엔트리포인트는 bootstrap() 하나뿐이다(WHENWORK D-08 승계).
//
// 틱은 1초 고정이 아니다. clock.msUntilNextChange가 "다음에 화면이 바뀌는 시각"을 알려 주므로
// 접혀 있을 때는 오래 자고 펼쳐졌을 때만 매초 깨운다 — 상주 앱이라 안 깨는 것이 이득이다.
import { app, Tray, Menu, nativeImage, globalShortcut, powerMonitor, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createSettings } from './settings.mjs';
import { createOverlay } from './overlay.mjs';
import { createMainWindow } from './window.mjs';
import { registerIpc } from './ipc.mjs';
import { stateAt, msUntilNextChange, DEFAULTS, dueReminders, remindText } from './clock.mjs';
import { syncAll, SYNC_INTERVAL_MS } from './sync.mjs';
import { createUpdater } from './update.mjs';

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

  // 월 격자의 가로지르는 막대를 확인하려면 여러 날에 걸친 일정이 있어야 한다(D-10)
  const day = (n) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d.toISOString();
  };
  const spans = [
    ['제주 출장', 3, 8], // 주 경계를 넘는다
    ['개발 워크숍', 1, 3],
  ];
  spans.forEach(([title, from, to], i) => {
    store.addEvent({
      calendarId: cal,
      title,
      startsAt: day(from),
      endsAt: day(to),
      allDay: 1,
      uid: `seed-span-${i + 1}`,
    });
  });

  return rows.length + spans.length;
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

  const ctx = { store: null, settings: null, overlay: null, mainWindow: null, tray: null, timer: null, syncTimer: null };
  const sentReminders = new Set();
  const failedShortcuts = [];

  function loadEvents() {
    const [from, to] = dayRange();
    return ctx.store.ok ? ctx.store.listBetween(from, to) : [];
  }

  // OS 알림은 켠 사람에게만, 일정마다 한 번만 (EV-08).
  // 기본은 오버레이 단계 변화이므로 이것이 꺼져 있어도 놓치지 않는다.
  function fireReminders(events) {
    if (!ctx.store?.ok) return;
    if (!ctx.store.getSetting('osNotify', false)) return;
    if (!Notification.isSupported()) return;

    const defaultMin = ctx.store.getSetting('remindMin', 10);
    for (const due of dueReminders(Date.now(), events, { defaultMin, sent: sentReminders })) {
      sentReminders.add(due.key);
      const { title, body } = remindText(due.event, due.leftSec);
      new Notification({ title, body, silent: false }).show();
    }
    // 하루치만 들고 있으면 된다 — 무한히 자라지 않게 가끔 비운다
    if (sentReminders.size > 500) sentReminders.clear();
  }

  function tick() {
    clearTimeout(ctx.timer);
    const events = loadEvents();
    const opts = overlayOptions(ctx.store);
    const st = stateAt(Date.now(), events, opts);
    ctx.overlay.push(toPayload(st, ctx.store));
    fireReminders(events);

    // 오늘 일정이 없어도 자정에는 다시 봐야 한다
    const next = msUntilNextChange(Date.now(), events, opts) ?? 60_000;
    ctx.timer = setTimeout(tick, next);
  }

  // 업데이트 상태에 따라 문구가 바뀌므로 메뉴는 다시 만든다.
  function rebuildTrayMenu(tray) {
    const t = tray ?? ctx.tray;
    if (!t) return;

    const items = [
      { label: '일정 보기', click: () => ctx.mainWindow.show() },
      { type: 'separator' },
      {
        label: '오버레이 잠시 끄기',
        type: 'checkbox',
        checked: ctx.overlay?.suspended ?? false,
        click: (item) => ctx.overlay.setSuspended(item.checked),
      },
    ];

    // 등록에 실패한 단축키가 있으면 알린다 — 눌러도 안 되는 이유를 알 방법이 그것뿐이다
    if (failedShortcuts.length) {
      items.push({ type: 'separator' });
      for (const f of failedShortcuts) {
        items.push({
          label: `⚠ ${f.accel} 등록 실패 (${f.label}) — 다른 앱이 쓰는 중`,
          enabled: false,
        });
      }
    }

    items.push(
      { type: 'separator' },
      {
        label: ctx.updater ? ctx.updater.line(app.getVersion()) : `버전 ${app.getVersion()}`,
        click: () => {
          if (!ctx.updater || ctx.updater.state.status === 'unsupported') return;
          ctx.updater.check();
        },
      },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() }
    );

    t.setContextMenu(Menu.buildFromTemplate(items));
  }

  function buildTray() {
    const tray = new Tray(trayIcon());
    tray.setToolTip('WHENCALENDAR');
    rebuildTrayMenu(tray);
    tray.on('click', () => ctx.mainWindow.toggle());
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
          version: app.getVersion(),
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
    ctx.mainWindow = createMainWindow(ctx.settings);

    // 일정이 바뀌면 열린 창을 새로 그리고, 오버레이도 즉시 다시 센다 —
    // 방금 넣은 일정이 아일랜드에 안 보이면 넣은 것 같지가 않다.
    ctx.onChanged = () => {
      ctx.mainWindow.notifyChanged();
      tick();
    };
    registerIpc(ctx);

    ctx.updater = createUpdater({ onChange: () => rebuildTrayMenu() });
    ctx.tray = buildTray();
    ctx.updater.start();

    // 자는 동안 틱이 멈춰 있었다 — 깨어난 순간 과거 상태를 보여서는 안 된다 (OVL-14)
    powerMonitor.on('resume', tick);
    powerMonitor.on('unlock-screen', tick);

    // whenwork(Ctrl+Alt+Space)·whennote(Ctrl+Alt+M/N)와 겹치지 않는 키 (오픈이슈 #2)
    // 구독은 주기적으로 알아서 받아 온다 (SUB-02). 첫 회는 창이 뜨는 것을 막지 않게 조금 늦춘다.
    const pump = async () => {
      if (!ctx.store?.ok) return;
      const results = await syncAll(ctx.store);
      if (results.length) {
        ctx.mainWindow.notifyChanged();
        tick();
      }
    };
    setTimeout(pump, 4000);
    ctx.syncTimer = setInterval(pump, SYNC_INTERVAL_MS);

    // register는 이미 잡힌 조합이면 **조용히 false를 돌려준다**(PLAT-02). 확인하지 않으면
    // 사용자는 눌러도 안 되는 이유를 영영 알 수 없다 — 트레이 메뉴에 적어 둔다.
    const bind = (accel, label, fn) => {
      let ok = false;
      try {
        ok = globalShortcut.register(accel, fn) && globalShortcut.isRegistered(accel);
      } catch {
        ok = false;
      }
      if (!ok) failedShortcuts.push({ accel, label });
      return ok;
    };
    bind('Ctrl+Alt+C', '창 열기·닫기', () => ctx.mainWindow.toggle());
    bind('Ctrl+Alt+O', '오버레이 잠시 끄기', () => ctx.overlay.setSuspended(!ctx.overlay.suspended));

    tick();
  });

  app.on('will-quit', () => {
    clearTimeout(ctx.timer);
    clearInterval(ctx.syncTimer);
    globalShortcut.unregisterAll();
    ctx.updater?.stop();
    ctx.overlay?.destroy();
    ctx.mainWindow?.destroy();
    ctx.settings?.flush();
    ctx.store?.close();
  });

  // 트레이에 사는 앱이라 창을 닫아도 끝나지 않는다 (WIN-08)
  app.on('window-all-closed', () => {});
}
