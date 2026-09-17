// main/sync.mjs — `.ics` 구독을 받아 저장소에 반영한다 (SUB-01~SUB-04).
//
// 가장 중요한 규칙: **실패했을 때 기존 일정을 건드리지 않는다**(SUB-03). 네트워크가 끊겼다고
// 오늘 일정이 사라지면 이 앱은 믿을 수 없는 물건이 된다. 그래서 받아오기가 확실히 성공한
// 경우에만 replaceCalendarEvents를 부른다.
//
// fetch를 주입받는다 — 그래야 네트워크 없이 테스트할 수 있다.
import { parseIcs, isCancelled } from './ics.mjs';

export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

// "동기화 실패"로 끝내지 않는다. 무엇이 잘못됐고 무엇을 하면 되는지까지 적는다(SUB-04).
export function explain(status, err) {
  if (err?.name === 'AbortError') return '응답이 없어 20초 만에 끊었습니다. 잠시 뒤 R로 다시 시도해 보세요.';
  if (err) return `네트워크에 닿지 못했습니다 (${err.code ?? err.message ?? err}). 연결을 확인해 주세요.`;
  if (status === 404)
    return '404 — 주소를 찾을 수 없습니다. 캘린더가 비공개로 바뀌었거나 주소가 만료됐습니다. 구글 캘린더 설정 → 캘린더 통합 → 비공개 주소(iCal 형식)를 다시 복사해 E로 바꿔 주세요.';
  if (status === 401 || status === 403)
    return `${status} — 접근이 거부됐습니다. 공개 주소가 아니거나 권한이 바뀌었습니다. 비공개 iCal 주소를 다시 받아 주세요.`;
  if (status === 410) return '410 — 이 주소는 폐기됐습니다. 캘린더에서 주소를 새로 발급해 주세요.';
  if (status >= 500) return `${status} — 상대 서버 문제입니다. 잠시 뒤 다시 시도합니다.`;
  return `${status} — 받아오지 못했습니다.`;
}

/**
 * URL 하나를 받아온다. 조건부 요청(ETag)으로 안 바뀐 것은 건너뛴다.
 */
export async function fetchIcs(url, { etag = null, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1',
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
    });

    if (res.status === 304) return { ok: true, notModified: true, status: 304 };
    if (!res.ok) return { ok: false, status: res.status, error: explain(res.status) };

    const text = await res.text();
    if (text.length > MAX_BYTES) {
      return { ok: false, status: res.status, error: '파일이 너무 큽니다(8MB 초과). 기간을 좁힌 주소를 써 주세요.' };
    }
    return {
      ok: true,
      status: res.status,
      text,
      etag: res.headers?.get?.('etag') ?? null,
    };
  } catch (err) {
    return { ok: false, status: 0, error: explain(0, err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 구독 하나를 갱신한다.
 *
 * 성공하면 last_error를 지우고, 실패하면 **일정은 그대로 두고** last_error만 남긴다.
 */
export async function syncCalendar(store, cal, { fetchImpl = fetch, now = () => new Date() } = {}) {
  if (!cal?.url) return { ok: false, error: '주소가 없습니다.' };

  const got = await fetchIcs(cal.url, { etag: cal.etag, fetchImpl });

  if (!got.ok) {
    store.updateCalendar(cal.id, { lastError: got.error, lastSyncAt: cal.last_sync_at ?? null });
    return { ok: false, error: got.error, status: got.status };
  }

  if (got.notModified) {
    store.updateCalendar(cal.id, { lastError: null, lastSyncAt: now().toISOString() });
    return { ok: true, notModified: true, added: 0, updated: 0, removed: 0 };
  }

  const parsed = parseIcs(got.text);
  if (!parsed.ok) {
    const error = 'iCalendar 형식이 아닙니다. 주소가 캘린더 페이지가 아니라 .ics 파일을 가리키는지 확인해 주세요.';
    store.updateCalendar(cal.id, { lastError: error });
    return { ok: false, error };
  }

  const usable = parsed.events.filter((e) => !isCancelled(e));
  const stats = store.replaceCalendarEvents(cal.id, usable);

  const patch = { lastError: null, lastSyncAt: now().toISOString(), etag: got.etag ?? null };
  // 이름을 사용자가 정하지 않았으면 달력이 알려 준 이름을 쓴다
  if (parsed.name && (!cal.name || cal.name === cal.url)) patch.name = parsed.name;
  store.updateCalendar(cal.id, patch);

  return { ok: true, ...stats, skipped: parsed.events.length - usable.length, errors: parsed.errors.length };
}

// 켜져 있는 구독 전부. 하나가 실패해도 나머지는 계속한다.
export async function syncAll(store, opts = {}) {
  const subs = store.listCalendars().filter((c) => c.kind === 'subscription' && c.enabled);
  const results = [];
  for (const cal of subs) {
    results.push({ id: cal.id, name: cal.name, ...(await syncCalendar(store, cal, opts)) });
  }
  return results;
}
