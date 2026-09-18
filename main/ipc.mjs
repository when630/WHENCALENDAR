// main/ipc.mjs — 렌더러가 저장소에 닿는 유일한 통로(03_기술_스펙 §7).
//
// 렌더러는 SQL도 Date 계산도 하지 않는다. 여기서 도메인 모양으로 주고받는다.
import { ipcMain } from 'electron';
import { parseLine, describe } from './parse.mjs';
import { syncCalendar, syncAll } from './sync.mjs';
import { findFreeSlots, formatSlots } from './free.mjs';

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

  // 프레임리스라 최소화·닫기도 우리가 맡는다. 닫기는 숨기기다 — 앱은 트레이에 남는다.
  ipcMain.on('win:hide', () => ctx.mainWindow?.hide());
  ipcMain.on('win:minimize', () => ctx.mainWindow?.window?.minimize());
}
