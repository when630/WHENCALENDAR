// main/ipc.mjs — 렌더러가 저장소에 닿는 유일한 통로(03_기술_스펙 §7).
//
// 렌더러는 SQL도 Date 계산도 하지 않는다. 여기서 도메인 모양으로 주고받는다.
import { app, ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { parseLine, describe } from './parse.mjs';
import { syncCalendar, syncAll } from './sync.mjs';
import { findFreeSlots, formatSlots } from './free.mjs';
import { buildIcs } from './ics.mjs';

// 렌더러가 준 날짜 범위를 ISO로 바꾼다. 하루 경계는 로컬 자정이다 —
// UTC로 자르면 한국에서 오전 9시 이전 일정이 전날로 밀린다.
function rangeOf(dayISO, days = 1) {
  const base = dayISO ? new Date(dayISO) : new Date();
  const from = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const to = new Date(from.getTime() + days * 86_400_000);
  return [from.toISOString(), to.toISOString()];
}

export function registerIpc(ctx) {
  const store = () => ctx.store;

  ipcMain.handle('cal:list', (_e, { day = null, days = 1 } = {}) => {
    if (!store()?.ok) return { ok: false, events: [] };
    const [from, to] = rangeOf(day, days);
    return { ok: true, from, to, events: store().listBetween(from, to) };
  });

  // 해석만 한다. 등록은 따로 — 사람이 결과를 보고 Enter를 눌러야 들어간다(EV-02).
  ipcMain.handle('cal:parse', (_e, line) => {
    const parsed = parseLine(line, new Date());
    return { ...parsed, summary: describe(parsed) };
  });

  ipcMain.handle('cal:add', (_e, line) => {
    if (!store()?.ok) return { ok: false, reason: 'store' };
    const parsed = parseLine(line, new Date());
    if (!parsed.ok) return { ok: false, reason: 'parse', parsed };
    const id = store().addEvent({
      calendarId: store().localCalendarId(),
      title: parsed.title,
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt,
      allDay: parsed.allDay ? 1 : 0,
      rrule: parsed.rrule ?? null,
    });
    ctx.onChanged?.();
    return { ok: true, id, parsed };
  });

  ipcMain.handle('cal:get', (_e, id) => (store()?.ok ? store().getEvent(id) : null));

  ipcMain.handle('cal:update', (_e, { id, patch }) => {
    if (!store()?.ok) return { ok: false, reason: 'store' };
    const ok = store().updateEvent(id, patch);
    if (ok) ctx.onChanged?.();
    return { ok, reason: ok ? null : 'readonly' };
  });

  // 날짜·시각만 한 줄로 다시 받는다. 제목은 그대로 두고 시간만 옮길 때 쓴다(EV-05).
  ipcMain.handle('cal:reschedule', (_e, { id, line }) => {
    if (!store()?.ok) return { ok: false, reason: 'store' };
    const cur = store().getEvent(id);
    if (!cur) return { ok: false, reason: 'missing' };
    // 제목을 붙여 같은 파서를 태운다 — 규칙이 두 벌이 되지 않게
    const parsed = parseLine(`${line} ${cur.title}`, new Date());
    if (!parsed.startsAt) return { ok: false, reason: 'parse' };
    const ok = store().updateEvent(id, {
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt,
      allDay: parsed.allDay ? 1 : 0,
    });
    if (ok) ctx.onChanged?.();
    return { ok, reason: ok ? null : 'readonly', parsed, summary: describe(parsed) };
  });

  ipcMain.handle('cal:delete', (_e, id) => {
    if (!store()?.ok) return { ok: false };
    store().softDeleteEvent(id);
    ctx.onChanged?.();
    return { ok: true };
  });

  /**
   * 반복 일정을 회차 단위로 다룬다 (EV-07).
   *
   * scope — 'one'(이 회차만) · 'after'(이 회차부터 뒤) · 'all'(전부)
   */
  ipcMain.handle('cal:series', (_e, { id, recurrenceId, scope, op, patch }) => {
    const st = store();
    if (!st?.ok) return { ok: false, reason: 'store' };

    if (op === 'delete') {
      if (scope === 'one') return { ok: st.excludeOccurrence(id, recurrenceId), reason: 'readonly' };
      if (scope === 'after') return { ok: st.truncateSeries(id, recurrenceId), reason: 'readonly' };
      st.softDeleteEvent(id);
      return { ok: true };
    }

    if (op === 'edit') {
      if (scope === 'one') return { ok: st.setOverride(id, recurrenceId, patch), reason: 'readonly' };
      // 이후 전부는 원래 시리즈를 끊고 남은 것을 새 일정으로 세운다 —
      // 규칙 하나로는 "어느 날부터 제목이 달라진다"를 표현할 수 없다
      if (scope === 'after') {
        const cur = st.getEvent(id);
        if (!cur) return { ok: false, reason: 'missing' };
        if (!st.truncateSeries(id, recurrenceId)) return { ok: false, reason: 'readonly' };
        const dur = cur.endsAt ? Date.parse(cur.endsAt) - Date.parse(cur.startsAt) : 0;
        const startsAt = patch.startsAt ?? recurrenceId;
        st.addEvent({
          calendarId: cur.calendarId,
          title: patch.title ?? cur.title,
          startsAt,
          endsAt: patch.endsAt ?? (dur ? new Date(Date.parse(startsAt) + dur).toISOString() : null),
          allDay: cur.allDay ? 1 : 0,
          rrule: cur.rrule ? String(cur.rrule).replace(/;?UNTIL=[^;]+/, '') : null,
        });
        return { ok: true };
      }
      return { ok: st.updateEvent(id, patch), reason: 'readonly' };
    }

    return { ok: false, reason: 'unknown-op' };
  });

  ipcMain.handle('cal:restore', (_e, id) => {
    if (!store()?.ok) return { ok: false };
    store().restoreEvent(id);
    ctx.onChanged?.();
    return { ok: true };
  });

  ipcMain.handle('app:info', () => ({
    storeOk: !!store()?.ok,
    storeFile: store()?.file ?? null,
    reason: store()?.state?.reason ?? null,
  }));

  ipcMain.handle('cal:search', (_e, query) => {
    if (!store()?.ok) return [];
    return store().searchEvents(query);
  });

  // ── 빈 시간 찾기 (FIND)
  ipcMain.handle('find:slots', (_e, opts = {}) => {
    if (!store()?.ok) return { slots: [] };
    const days = opts.days ?? 14;
    const from = new Date();
    const to = new Date(from.getTime() + days * 86_400_000);
    const events = store().listBetween(from.toISOString(), to.toISOString());
    const slots = findFreeSlots(events, from.toISOString(), to.toISOString(), opts);
    return { slots, from: from.toISOString(), to: to.toISOString() };
  });

  // 클립보드까지만 만든다. 보내는 것은 사람이 한다(FIND-04).
  ipcMain.handle('find:format', (_e, { slots, style, polite }) =>
    formatSlots(slots, { style, polite })
  );

  // ── 구독 (SUB)
  ipcMain.handle('sub:list', () => {
    if (!store()?.ok) return [];
    return store()
      .listCalendars()
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        url: c.url,
        color: c.color,
        enabled: !!c.enabled,
        lastSyncAt: c.last_sync_at,
        lastError: c.last_error,
      }));
  });

  ipcMain.handle('sub:add', async (_e, url) => {
    if (!store()?.ok) return { ok: false, error: '저장소에 쓸 수 없습니다.' };
    const clean = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(clean)) {
      return { ok: false, error: 'http(s)로 시작하는 .ics 주소를 붙여 주세요.' };
    }
    if (store().listCalendars().some((c) => c.url === clean)) {
      return { ok: false, error: '이미 등록된 주소입니다.' };
    }
    // 이름은 일단 주소로 둔다 — 첫 동기화가 달력이 알려 주는 이름으로 바꿔 준다
    const id = store().addCalendar({ kind: 'subscription', name: clean, url: clean });
    const cal = store().listCalendars().find((c) => c.id === id);
    const res = await syncCalendar(store(), cal);
    ctx.onChanged?.();
    return { ok: true, id, sync: res };
  });

  ipcMain.handle('sub:sync', async (_e, id = null) => {
    if (!store()?.ok) return { ok: false };
    if (id == null) {
      const results = await syncAll(store());
      ctx.onChanged?.();
      return { ok: true, results };
    }
    const cal = store().listCalendars().find((c) => c.id === id);
    if (!cal) return { ok: false };
    const res = await syncCalendar(store(), cal);
    ctx.onChanged?.();
    return res;
  });

  ipcMain.handle('sub:toggle', (_e, id) => {
    const cal = store()?.listCalendars().find((c) => c.id === id);
    if (!cal) return { ok: false };
    store().updateCalendar(id, { enabled: !cal.enabled });
    ctx.onChanged?.();
    return { ok: true, enabled: !cal.enabled };
  });

  ipcMain.handle('sub:color', (_e, { id, color }) => {
    store()?.updateCalendar(id, { color });
    ctx.onChanged?.();
    return { ok: true };
  });

  ipcMain.handle('sub:delete', (_e, id) => {
    const cal = store()?.listCalendars().find((c) => c.id === id);
    if (!cal || cal.kind !== 'subscription') return { ok: false };
    store().deleteCalendar(id);
    ctx.onChanged?.();
    return { ok: true };
  });

  // ── 설정·데이터
  ipcMain.handle('settings:get', () => {
    const st = store();
    if (!st?.ok) return null;
    return {
      revealStartSec: st.getSetting('revealStartSec', 1800),
      revealFullSec: st.getSetting('revealFullSec', 600),
      endSoonEnabled: st.getSetting('endSoonEnabled', true),
      ringSize: st.getSetting('ringSize', 20),
      osNotify: st.getSetting('osNotify', false),
      remindMin: st.getSetting('remindMin', 10),
      autoStart: app.getLoginItemSettings().openAtLogin,
      dataDir: path.dirname(st.file),
    };
  });

  ipcMain.handle('settings:set', (_e, { key, value }) => {
    if (key === 'autoStart') {
      // 개발 실행에 자동 시작을 걸면 설치본과 싸운다 — 패키징된 앱에서만 건다
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!value });
      return { ok: app.isPackaged, packaged: app.isPackaged };
    }
    store()?.setSetting(key, value);
    ctx.onChanged?.();
    return { ok: true };
  });

  ipcMain.handle('app:openDataDir', () => {
    const st = store();
    if (st?.file) shell.openPath(path.dirname(st.file));
    return { ok: true };
  });

  ipcMain.handle('data:export', async () => {
    const st = store();
    if (!st?.ok) return { ok: false, error: '저장소에 닿지 못했습니다.' };
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '내보내기',
      defaultPath: `whencalendar-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(filePath, JSON.stringify(st.exportAll(), null, 2), 'utf8');
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  });

  ipcMain.handle('data:exportIcs', async () => {
    const st = store();
    if (!st?.ok) return { ok: false, error: '저장소에 닿지 못했습니다.' };
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '.ics로 내보내기',
      defaultPath: `whencalendar-${stamp}.ics`,
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      const dump = st.exportAll();
      fs.writeFileSync(filePath, buildIcs(dump.events, { name: 'WHENCALENDAR' }), 'utf8');
      return { ok: true, filePath, count: dump.events.length };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  });

  ipcMain.handle('data:import', async () => {
    const st = store();
    if (!st?.ok) return { ok: false, error: '저장소에 닿지 못했습니다.' };
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '가져오기 — 지금 데이터를 갈아끼웁니다',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch (err) {
      return { ok: false, error: '파일을 읽지 못했습니다 — JSON이 아닙니다.' };
    }

    // 갈아끼우기 전에 지금 상태를 옆에 남긴다 (DATA-02)
    let backup = null;
    try {
      backup = path.join(path.dirname(st.file), `before-import-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify(st.exportAll(), null, 2), 'utf8');
    } catch {
      backup = null;
    }

    const res = st.importAll(data);
    if (res.ok) ctx.onChanged?.();
    return { ...res, backup };
  });

  // 프레임리스라 최소화·닫기도 우리가 맡는다. 닫기는 숨기기다 — 앱은 트레이에 남는다.
  ipcMain.on('win:hide', () => ctx.mainWindow?.hide());
  ipcMain.on('win:minimize', () => ctx.mainWindow?.window?.minimize());
}
