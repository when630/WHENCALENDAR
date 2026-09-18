// 내보내기·가져오기 (DATA-01·DATA-02)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, validateExport, EXPORT_VERSION } from '../main/store.mjs';

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whencal-data-'));
  return createStore(path.join(dir, 'store.sqlite'));
}
const ISO = (h, m = 0) => new Date(2026, 8, 17, h, m, 0).toISOString();

function seeded() {
  const s = freshStore();
  const cal = s.localCalendarId();
  s.addEvent({ calendarId: cal, title: '치과', startsAt: ISO(19), endsAt: ISO(19, 30) });
  s.addEvent({ calendarId: cal, title: '주간 회의', startsAt: ISO(14), endsAt: ISO(15) });
  s.addCalendar({ kind: 'subscription', name: '회사', url: 'https://x/y.ics' });
  s.setSetting('ringSize', 26);
  return s;
}

test('전체를 JSON 하나로 내보낸다 (DATA-01)', () => {
  const s = seeded();
  const d = s.exportAll();
  assert.equal(d.app, 'whencalendar');
  assert.equal(d.version, EXPORT_VERSION);
  assert.equal(d.events.length, 2);
  assert.equal(d.calendars.length, 2);
  assert.equal(d.settings.ringSize, 26);
  assert.ok(JSON.stringify(d).length > 0, '직렬화된다');
  s.close();
});

test('구독으로 받아온 일정은 내보내지 않는다 — 다음 갱신에 다시 온다', () => {
  const s = seeded();
  const sub = s.listCalendars().find((c) => c.kind === 'subscription');
  s.addEvent({ calendarId: sub.id, title: '남의 회의', startsAt: ISO(11), uid: 'x' });

  const d = s.exportAll();
  assert.equal(d.events.length, 2, '직접 등록한 둘만');
  assert.ok(!d.events.some((e) => e.title === '남의 회의'));
  assert.ok(d.calendars.some((c) => c.url === 'https://x/y.ics'), '구독 주소는 담는다');
  s.close();
});

test('내보낸 것을 다른 저장소에서 되살리면 같은 상태다 (DATA-02)', () => {
  const a = seeded();
  const dump = JSON.parse(JSON.stringify(a.exportAll()));
  a.close();

  const b = freshStore();
  const res = b.importAll(dump);
  assert.equal(res.ok, true);
  assert.equal(b.countEvents(), 2);
  assert.equal(b.getSetting('ringSize'), 26);

  const again = b.exportAll();
  assert.deepEqual(
    again.events.map((e) => [e.title, e.startsAt]).sort(),
    dump.events.map((e) => [e.title, e.startsAt]).sort(),
    '왕복해도 같다'
  );
  b.close();
});

test('가져오기는 지금 데이터를 갈아끼운다', () => {
  const a = seeded();
  const dump = JSON.parse(JSON.stringify(a.exportAll()));
  a.close();

  const b = freshStore();
  b.addEvent({ calendarId: b.localCalendarId(), title: '없어질 일정', startsAt: ISO(8) });
  assert.equal(b.countEvents(), 1);

  b.importAll(dump);
  assert.equal(b.countEvents(), 2);
  assert.ok(!b.listBetween(ISO(7), ISO(9)).some((e) => e.title === '없어질 일정'));
  b.close();
});

test('형식이 아니면 아무것도 건드리지 않는다', () => {
  const s = seeded();
  const before = s.countEvents();

  for (const bad of [null, {}, { app: 'other', version: 1 }, { app: 'whencalendar' }]) {
    const r = s.importAll(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.error);
  }
  assert.equal(s.countEvents(), before, '반쯤 들어간 상태가 제일 나쁘다');
  s.close();
});

test('더 새로운 버전은 거절한다 — 앱을 먼저 올려야 한다', () => {
  const err = validateExport({ app: 'whencalendar', version: EXPORT_VERSION + 1, calendars: [], events: [] });
  assert.match(err, /업데이트/);
});

test('시각이 깨진 일정이 섞이면 통째로 거절한다', () => {
  const err = validateExport({
    app: 'whencalendar',
    version: EXPORT_VERSION,
    calendars: [],
    events: [{ title: 'x', startsAt: '이건 날짜가 아니다' }],
  });
  assert.match(err, /읽을 수 없는 시각/);
});

test('빈 내보내기도 되살릴 수 있다', () => {
  const s = freshStore();
  const r = s.importAll({ app: 'whencalendar', version: EXPORT_VERSION, calendars: [], events: [] });
  assert.equal(r.ok, true);
  assert.equal(s.countEvents(), 0);
  assert.ok(s.localCalendarId(), '직접 등록용 달력은 만들어 둔다');
  s.close();
});
