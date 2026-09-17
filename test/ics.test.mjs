// .ics 읽기와 반복 펼치기 (SUB-01·SUB-07·SUB-08)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, isCancelled } from '../main/ics.mjs';
import { expand, expandOne, overlaps } from '../main/recur.mjs';

const wrap = (body) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', body, 'END:VCALENDAR'].join('\r\n');

const vevent = (lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

const hm = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const ymd = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('기본 VEVENT를 읽는다', () => {
  const ics = wrap(
    vevent([
      'UID:abc@google.com',
      'SUMMARY:주간 회의',
      'DTSTART:20260917T050000Z',
      'DTEND:20260917T060000Z',
      'LOCATION:회의실 B',
    ])
  );
  const r = parseIcs(ics);
  assert.equal(r.ok, true);
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.uid, 'abc@google.com');
  assert.equal(e.title, '주간 회의');
  assert.equal(e.location, '회의실 B');
  assert.equal(e.allDay, false);
  assert.equal(new Date(e.startsAt).toISOString(), '2026-09-17T05:00:00.000Z');
  assert.equal(new Date(e.endsAt).toISOString(), '2026-09-17T06:00:00.000Z');
});

test('UTC가 로컬 시각으로 옮겨진다 (SUB-08)', () => {
  // 05:00Z는 한국에서 14:00
  const ics = wrap(vevent(['UID:z', 'SUMMARY:회의', 'DTSTART:20260917T050000Z', 'DTEND:20260917T060000Z']));
  const [e] = parseIcs(ics).events;
  assert.equal(hm(e.startsAt), '14:00', '한국 시간대에서 돌린다는 전제');
});

test('VTIMEZONE이 붙은 시각도 해석한다 (SUB-08)', () => {
  const ics = wrap(
    [
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Seoul',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0900',
      'TZOFFSETTO:+0900',
      'TZNAME:KST',
      'END:STANDARD',
      'END:VTIMEZONE',
      vevent(['UID:tz', 'SUMMARY:서울 회의', 'DTSTART;TZID=Asia/Seoul:20260917T140000', 'DTEND;TZID=Asia/Seoul:20260917T150000']),
    ].join('\r\n')
  );
  const [e] = parseIcs(ics).events;
  assert.equal(hm(e.startsAt), '14:00');
});

test('종일 일정은 allDay로 표시된다', () => {
  const ics = wrap(vevent(['UID:ad', 'SUMMARY:휴가', 'DTSTART;VALUE=DATE:20260921', 'DTEND;VALUE=DATE:20260925']));
  const [e] = parseIcs(ics).events;
  assert.equal(e.allDay, true);
  assert.equal(ymd(e.startsAt), '2026-09-21');
});

test('DURATION만 있어도 끝 시각을 만든다', () => {
  const ics = wrap(vevent(['UID:d', 'SUMMARY:통화', 'DTSTART:20260917T050000Z', 'DURATION:PT30M']));
  const [e] = parseIcs(ics).events;
  assert.equal(new Date(e.endsAt) - new Date(e.startsAt), 30 * 60_000);
});

test('RRULE은 펼치지 않고 원문 그대로 들고 나간다 (D-07)', () => {
  const ics = wrap(
    vevent(['UID:r', 'SUMMARY:스크럼', 'DTSTART:20260917T003000Z', 'DTEND:20260917T004500Z', 'RRULE:FREQ=WEEKLY;BYDAY=TH'])
  );
  const [e] = parseIcs(ics).events;
  assert.match(e.rrule, /FREQ=WEEKLY/);
  assert.match(e.rrule, /BYDAY=TH/);
});

test('EXDATE를 모아 온다', () => {
  const ics = wrap(
    vevent([
      'UID:x',
      'SUMMARY:스크럼',
      'DTSTART:20260917T003000Z',
      'DTEND:20260917T004500Z',
      'RRULE:FREQ=WEEKLY',
      'EXDATE:20260924T003000Z',
    ])
  );
  const [e] = parseIcs(ics).events;
  assert.equal(e.exdates.length, 1);
  assert.equal(new Date(e.exdates[0]).toISOString(), '2026-09-24T00:30:00.000Z');
});

test('제목이 없으면 비어 있는 채로 두지 않는다', () => {
  const ics = wrap(vevent(['UID:n', 'DTSTART:20260917T050000Z']));
  const [e] = parseIcs(ics).events;
  assert.equal(e.title, '(제목 없음)');
});

test('취소된 일정을 구분할 수 있다', () => {
  const ics = wrap(vevent(['UID:c', 'SUMMARY:취소된 회의', 'DTSTART:20260917T050000Z', 'STATUS:CANCELLED']));
  const [e] = parseIcs(ics).events;
  assert.equal(isCancelled(e), true);
});

test('깨진 파일은 앱을 멈추지 않는다', () => {
  const r = parseIcs('이건 ics가 아니다');
  assert.equal(r.ok, false);
  assert.equal(r.events.length, 0);
  assert.ok(r.errors.length > 0);
});

test('일정 하나가 깨져도 나머지는 읽는다', () => {
  const ics = wrap(
    [
      vevent(['UID:good1', 'SUMMARY:정상1', 'DTSTART:20260917T050000Z']),
      vevent(['UID:bad', 'SUMMARY:끝 시각 없음']), // DTSTART 없음 — 건너뛴다
      vevent(['UID:good2', 'SUMMARY:정상2', 'DTSTART:20260917T070000Z']),
    ].join('\r\n')
  );
  const r = parseIcs(ics);
  assert.deepEqual(r.events.map((e) => e.uid), ['good1', 'good2']);
});

test('달력 이름(X-WR-CALNAME)을 가져온다', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//t//EN',
    'X-WR-CALNAME:회사 캘린더',
    vevent(['UID:a', 'SUMMARY:x', 'DTSTART:20260917T050000Z']),
    'END:VCALENDAR',
  ].join('\r\n');
  assert.equal(parseIcs(ics).name, '회사 캘린더');
});

// ── 펼치기

const weekly = {
  id: 1,
  title: '스크럼',
  startsAt: new Date(2026, 8, 17, 9, 30).toISOString(), // 목 09:30
  endsAt: new Date(2026, 8, 17, 9, 45).toISOString(),
  rrule: 'FREQ=WEEKLY;BYDAY=TH',
};

test('매주 반복을 범위만큼만 펼친다', () => {
  const from = new Date(2026, 8, 14).toISOString(); // 9/14 월
  const to = new Date(2026, 9, 12).toISOString(); // 10/12 월 — 4주
  const out = expandOne(weekly, from, to);
  assert.deepEqual(out.map((e) => ymd(e.startsAt)), ['2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08']);
  assert.equal(hm(out[0].startsAt), '09:30', '시각이 유지된다');
  assert.equal(new Date(out[1].endsAt) - new Date(out[1].startsAt), 15 * 60_000, '길이도 유지된다');
});

test('범위 밖은 한 건도 나오지 않는다', () => {
  const before = expandOne(weekly, new Date(2026, 7, 1).toISOString(), new Date(2026, 7, 31).toISOString());
  assert.equal(before.length, 0, '시작 전');
  const oneDay = expandOne(weekly, new Date(2026, 8, 18).toISOString(), new Date(2026, 8, 19).toISOString());
  assert.equal(oneDay.length, 0, '반복이 없는 날');
});

test('EXDATE로 뺀 회차는 나오지 않는다', () => {
  const withEx = { ...weekly, exdates: [new Date(2026, 8, 24, 9, 30).toISOString()] };
  const out = expandOne(withEx, new Date(2026, 8, 14).toISOString(), new Date(2026, 9, 5).toISOString());
  assert.deepEqual(out.map((e) => ymd(e.startsAt)), ['2026-09-17', '2026-10-01']);
});

test('COUNT·UNTIL이 있으면 거기서 멈춘다', () => {
  const counted = { ...weekly, rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=2' };
  const out = expandOne(counted, new Date(2026, 8, 1).toISOString(), new Date(2026, 11, 31).toISOString());
  assert.equal(out.length, 2);
});

test('반복이 없는 일정은 겹칠 때만 한 건', () => {
  const once = { id: 2, title: '치과', startsAt: new Date(2026, 8, 17, 19).toISOString(), endsAt: new Date(2026, 8, 17, 19, 30).toISOString() };
  assert.equal(expandOne(once, new Date(2026, 8, 17).toISOString(), new Date(2026, 8, 18).toISOString()).length, 1);
  assert.equal(expandOne(once, new Date(2026, 8, 18).toISOString(), new Date(2026, 8, 19).toISOString()).length, 0);
});

test('규칙을 못 읽어도 일정이 사라지지 않는다', () => {
  const broken = { ...weekly, rrule: '이건 규칙이 아니다' };
  const out = expandOne(broken, new Date(2026, 8, 17).toISOString(), new Date(2026, 8, 18).toISOString());
  assert.equal(out.length, 1, '반복은 포기하되 원본 한 건은 남긴다');
});

test('매일 반복이 무한히 돌지 않는다', () => {
  const daily = { ...weekly, rrule: 'FREQ=DAILY' };
  const out = expandOne(daily, new Date(2026, 8, 17).toISOString(), new Date(2036, 8, 17).toISOString());
  assert.ok(out.length <= 5000, '상한이 걸린다');
  assert.ok(out.length > 100);
});

test('여러 건을 한꺼번에 펼치면 시간순으로 온다', () => {
  const list = [
    weekly,
    { id: 3, title: '치과', startsAt: new Date(2026, 8, 17, 8).toISOString(), endsAt: new Date(2026, 8, 17, 8, 30).toISOString() },
  ];
  const out = expand(list, new Date(2026, 8, 17).toISOString(), new Date(2026, 8, 18).toISOString());
  assert.deepEqual(out.map((e) => e.title), ['치과', '스크럼']);
});

test('겹침 판정 — 맞닿기만 한 것은 겹친 게 아니다', () => {
  const ev = { startsAt: new Date(2026, 8, 17, 10).toISOString(), endsAt: new Date(2026, 8, 17, 11).toISOString() };
  assert.equal(overlaps(ev, new Date(2026, 8, 17, 9).toISOString(), new Date(2026, 8, 17, 10).toISOString()), false);
  assert.equal(overlaps(ev, new Date(2026, 8, 17, 10, 30).toISOString(), new Date(2026, 8, 17, 12).toISOString()), true);
});

test('.ics에서 읽은 반복 일정이 그대로 펼쳐진다 — 경계', () => {
  const ics = wrap(
    vevent([
      'UID:pipe',
      'SUMMARY:주간 회의',
      'DTSTART:20260917T003000Z',
      'DTEND:20260917T004500Z',
      'RRULE:FREQ=WEEKLY;COUNT=3',
    ])
  );
  const [e] = parseIcs(ics).events;
  const out = expandOne(e, new Date(2026, 8, 1).toISOString(), new Date(2026, 10, 1).toISOString());
  assert.equal(out.length, 3, '파서가 낸 모양을 펼치기가 그대로 먹어야 한다');
  assert.equal(out[0].title, '주간 회의');
});
