// 구독 갱신 (SUB-02·SUB-03·SUB-04). 네트워크 없이 가짜 fetch로 돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../main/store.mjs';
import { syncCalendar, syncAll, explain } from '../main/sync.mjs';

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whencal-sync-'));
  return createStore(path.join(dir, 'store.sqlite'));
}

const ICS = (events) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', 'X-WR-CALNAME:회사 캘린더', ...events, 'END:VCALENDAR'].join('\r\n');

const EV = (uid, summary, start, extra = []) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART:${start}`, ...extra, 'END:VEVENT'].join('\r\n');

// 가짜 응답
const reply = (body, { status = 200, etag = null, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { get: (k) => (k.toLowerCase() === 'etag' ? etag : (headers[k] ?? null)) },
});

const calOf = (store, id) => store.listCalendars().find((c) => c.id === id);

test('구독을 받아 일정이 들어온다 (SUB-01)', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'https://x/y.ics', url: 'https://x/y.ics' });

  const res = await syncCalendar(s, calOf(s, id), {
    fetchImpl: async () => reply(ICS([EV('a', '스크럼', '20260917T003000Z'), EV('b', '리뷰', '20260917T050000Z')])),
  });

  assert.equal(res.ok, true);
  assert.equal(res.added, 2);
  assert.equal(s.countEvents(), 2);
  assert.equal(calOf(s, id).last_error, null);
  assert.ok(calOf(s, id).last_sync_at);
  s.close();
});

test('달력 이름을 사용자가 안 정했으면 .ics 이름을 쓴다', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'https://x/y.ics', url: 'https://x/y.ics' });
  await syncCalendar(s, calOf(s, id), { fetchImpl: async () => reply(ICS([EV('a', 'x', '20260917T003000Z')])) });
  assert.equal(calOf(s, id).name, '회사 캘린더');
  s.close();
});

test('다시 받으면 더하지 않고 맞춘다 — 멱등', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });
  const body = ICS([EV('a', '스크럼', '20260917T003000Z')]);
  const f = async () => reply(body);

  await syncCalendar(s, calOf(s, id), { fetchImpl: f });
  const second = await syncCalendar(s, calOf(s, id), { fetchImpl: f });

  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
  assert.equal(s.countEvents(), 1);
  s.close();
});

test('제목이 바뀌면 갱신되고, 사라진 것은 지워진다', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });

  await syncCalendar(s, calOf(s, id), {
    fetchImpl: async () => reply(ICS([EV('a', '스크럼', '20260917T003000Z'), EV('b', '없어질 회의', '20260917T050000Z')])),
  });
  assert.equal(s.countEvents(), 2);

  const res = await syncCalendar(s, calOf(s, id), {
    fetchImpl: async () => reply(ICS([EV('a', '스크럼 (이름 바뀜)', '20260917T003000Z')])),
  });

  assert.equal(res.updated, 1);
  assert.equal(res.removed, 1);
  assert.equal(s.countEvents(), 1);
  s.close();
});

test('실패해도 이미 받아둔 일정은 그대로 둔다 (SUB-03)', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });
  await syncCalendar(s, calOf(s, id), { fetchImpl: async () => reply(ICS([EV('a', '스크럼', '20260917T003000Z')])) });
  assert.equal(s.countEvents(), 1);

  const res = await syncCalendar(s, calOf(s, id), { fetchImpl: async () => reply('', { status: 404 }) });

  assert.equal(res.ok, false);
  assert.equal(s.countEvents(), 1, '네트워크가 죽었다고 오늘 일정이 사라지면 안 된다');
  assert.match(calOf(s, id).last_error, /404/);
  s.close();
});

test('네트워크 자체가 안 될 때도 일정은 남는다 (SUB-03)', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });
  await syncCalendar(s, calOf(s, id), { fetchImpl: async () => reply(ICS([EV('a', '스크럼', '20260917T003000Z')])) });

  const res = await syncCalendar(s, calOf(s, id), {
    fetchImpl: async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    },
  });

  assert.equal(res.ok, false);
  assert.equal(s.countEvents(), 1);
  s.close();
});

test('실패 문구가 원인과 다음 행동을 말한다 (SUB-04)', () => {
  assert.match(explain(404), /비공개 주소/, '무엇을 하면 되는지까지');
  assert.match(explain(403), /권한/);
  assert.match(explain(500), /상대 서버/);
  assert.match(explain(0, { code: 'ENOTFOUND' }), /네트워크/);
  assert.match(explain(0, { name: 'AbortError' }), /20초/);
  for (const s of [404, 403, 500]) assert.ok(explain(s).length > 20, '한 마디로 끝내지 않는다');
});

test('성공하면 이전 오류 표시가 사라진다', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });
  await syncCalendar(s, calOf(s, id), { fetchImpl: async () => reply('', { status: 404 }) });
  assert.ok(calOf(s, id).last_error);

  await syncCalendar(s, calOf(s, id), { fetchImpl: async () => reply(ICS([EV('a', 'x', '20260917T003000Z')])) });
  assert.equal(calOf(s, id).last_error, null);
  s.close();
});

test('ETag로 안 바뀐 것은 건너뛴다 (SUB-02)', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });

  await syncCalendar(s, calOf(s, id), {
    fetchImpl: async () => reply(ICS([EV('a', 'x', '20260917T003000Z')]), { etag: 'W/"v1"' }),
  });
  assert.equal(calOf(s, id).etag, 'W/"v1"');

  let sentHeader = null;
  const res = await syncCalendar(s, calOf(s, id), {
    fetchImpl: async (_u, init) => {
      sentHeader = init.headers['If-None-Match'];
      return reply('', { status: 304 });
    },
  });

  assert.equal(sentHeader, 'W/"v1"', '가진 etag를 보낸다');
  assert.equal(res.notModified, true);
  assert.equal(s.countEvents(), 1, '304에도 일정은 그대로');
  s.close();
});

test('취소된 일정은 들이지 않는다', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });
  const res = await syncCalendar(s, calOf(s, id), {
    fetchImpl: async () =>
      reply(
        ICS([EV('a', '살아있는 회의', '20260917T003000Z'), EV('b', '취소된 회의', '20260917T050000Z', ['STATUS:CANCELLED'])])
      ),
  });
  assert.equal(res.added, 1);
  assert.equal(res.skipped, 1);
  s.close();
});

test('구독한 반복 일정이 조회에서 펼쳐진다 — 경계', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });
  await syncCalendar(s, calOf(s, id), {
    fetchImpl: async () =>
      reply(ICS([EV('r', '스크럼', '20260917T003000Z', ['DTEND:20260917T004500Z', 'RRULE:FREQ=WEEKLY;COUNT=4'])])),
  });
  assert.equal(s.countEvents(), 1, '저장은 한 줄');

  const from = new Date(2026, 8, 14).toISOString();
  const to = new Date(2026, 9, 12).toISOString();
  assert.equal(s.listBetween(from, to).length, 4, '조회하면 네 번으로 펼쳐진다');
  s.close();
});

test('구독을 지우면 그 일정만 사라진다 (STOR-04)', async () => {
  const s = freshStore();
  const sub = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });
  await syncCalendar(s, calOf(s, sub), { fetchImpl: async () => reply(ICS([EV('a', '구독 일정', '20260917T003000Z')])) });
  s.addEvent({ calendarId: s.localCalendarId(), title: '직접 등록', startsAt: new Date(2026, 8, 17, 19).toISOString() });
  assert.equal(s.countEvents(), 2);

  s.deleteCalendar(sub);
  assert.equal(s.countEvents(), 1, '직접 등록한 것은 남는다');
  s.close();
});

test('여럿을 돌릴 때 하나가 실패해도 나머지는 계속한다', async () => {
  const s = freshStore();
  s.addCalendar({ kind: 'subscription', name: 'ok', url: 'https://ok/y.ics' });
  s.addCalendar({ kind: 'subscription', name: 'bad', url: 'https://bad/y.ics' });

  const results = await syncAll(s, {
    fetchImpl: async (url) =>
      url.includes('bad') ? reply('', { status: 500 }) : reply(ICS([EV('a', 'x', '20260917T003000Z')])),
  });

  assert.equal(results.length, 2);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => !r.ok).length, 1);
  s.close();
});

test('꺼둔 구독은 갱신하지 않는다 (SUB-06)', async () => {
  const s = freshStore();
  const id = s.addCalendar({ kind: 'subscription', name: 'c', url: 'https://x/y.ics' });
  s.updateCalendar(id, { enabled: false });

  let called = 0;
  await syncAll(s, {
    fetchImpl: async () => {
      called++;
      return reply(ICS([]));
    },
  });
  assert.equal(called, 0);
  s.close();
});
