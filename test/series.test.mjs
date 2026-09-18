// 반복 일정의 회차 다루기 (EV-07)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../main/store.mjs';

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whencal-series-'));
  return createStore(path.join(dir, 'store.sqlite'));
}

// 2026-09-17(목) 09:30 시작, 매주 목요일
const START = new Date(2026, 8, 17, 9, 30).toISOString();
const END = new Date(2026, 8, 17, 9, 45).toISOString();
const RANGE = [new Date(2026, 8, 1).toISOString(), new Date(2026, 10, 1).toISOString()];
const ymd = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function weekly() {
  const s = freshStore();
  const cal = s.localCalendarId();
  const id = s.addEvent({
    calendarId: cal,
    title: '주간 회의',
    startsAt: START,
    endsAt: END,
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
  });
  return { s, id };
}

test('반복 일정은 한 줄로 저장되고 조회에서 펼쳐진다', () => {
  const { s } = weekly();
  assert.equal(s.countEvents(), 1);
  const out = s.listBetween(...RANGE);
  assert.deepEqual(out.map((e) => ymd(e.startsAt)), ['9/17', '9/24', '10/1', '10/8', '10/15', '10/22', '10/29']);
  s.close();
});

test('이 회차만 뺀다 — EXDATE (EV-07)', () => {
  const { s, id } = weekly();
  const second = s.listBetween(...RANGE)[1];
  assert.equal(s.excludeOccurrence(id, second.recurrenceId), true);

  const out = s.listBetween(...RANGE).map((e) => ymd(e.startsAt));
  assert.ok(!out.includes('9/24'), '그 회차만 빠진다');
  assert.ok(out.includes('9/17') && out.includes('10/1'), '앞뒤는 남는다');
  s.close();
});

test('이 회차만 제목을 바꾼다 — 나머지는 그대로 (EV-07)', () => {
  const { s, id } = weekly();
  const second = s.listBetween(...RANGE)[1];
  assert.equal(s.setOverride(id, second.recurrenceId, { title: '주간 회의 (특별판)' }), true);

  const out = s.listBetween(...RANGE);
  assert.equal(out[1].title, '주간 회의 (특별판)');
  assert.equal(out[0].title, '주간 회의');
  assert.equal(out[2].title, '주간 회의');
  assert.equal(out[1].edited, true, '고쳐진 회차라는 표시가 붙는다');
  s.close();
});

test('이 회차만 시간을 옮긴다', () => {
  const { s, id } = weekly();
  const third = s.listBetween(...RANGE)[2];
  const moved = new Date(2026, 9, 1, 14).toISOString();
  s.setOverride(id, third.recurrenceId, { startsAt: moved, endsAt: new Date(2026, 9, 1, 15).toISOString() });

  const out = s.listBetween(...RANGE);
  assert.equal(new Date(out[2].startsAt).getHours(), 14);
  assert.equal(new Date(out[1].startsAt).getHours(), 9, '다른 회차는 그대로');
  s.close();
});

test('이 회차만 취소한다', () => {
  const { s, id } = weekly();
  const second = s.listBetween(...RANGE)[1];
  s.setOverride(id, second.recurrenceId, { cancelled: true });
  assert.ok(!s.listBetween(...RANGE).map((e) => ymd(e.startsAt)).includes('9/24'));
  s.close();
});

test('이 회차부터 뒤를 끊는다 — UNTIL (EV-07)', () => {
  const { s, id } = weekly();
  const third = s.listBetween(...RANGE)[2]; // 10/1
  assert.equal(s.truncateSeries(id, third.recurrenceId), true);

  const out = s.listBetween(...RANGE).map((e) => ymd(e.startsAt));
  assert.deepEqual(out, ['9/17', '9/24'], '직전 회차까지만 남는다');
  s.close();
});

test('끊을 때 규칙 자체를 고친다 — 회차를 하나씩 지우지 않는다', () => {
  const { s, id } = weekly();
  const third = s.listBetween(...RANGE)[2];
  s.truncateSeries(id, third.recurrenceId);

  const ev = s.getEvent(id);
  assert.match(ev.rrule, /UNTIL=/, '규칙에 UNTIL이 박힌다 — .ics로 내보내도 같은 뜻이다');
  assert.equal(s.countEvents(), 1, '행은 여전히 하나');
  s.close();
});

test('두 번 끊어도 UNTIL이 겹쳐 쌓이지 않는다', () => {
  const { s, id } = weekly();
  s.truncateSeries(id, s.listBetween(...RANGE)[3].recurrenceId);
  s.truncateSeries(id, s.listBetween(...RANGE)[1].recurrenceId);
  const ev = s.getEvent(id);
  assert.equal((ev.rrule.match(/UNTIL=/g) ?? []).length, 1);
  assert.equal(s.listBetween(...RANGE).length, 1);
  s.close();
});

test('전체를 지우면 한 회차도 남지 않는다', () => {
  const { s, id } = weekly();
  s.softDeleteEvent(id);
  assert.equal(s.listBetween(...RANGE).length, 0);
  s.restoreEvent(id);
  assert.ok(s.listBetween(...RANGE).length > 0, '되돌리면 시리즈 전체가 돌아온다');
  s.close();
});

test('구독으로 들어온 반복 일정은 회차도 건드릴 수 없다', () => {
  const s = freshStore();
  const sub = s.addCalendar({ kind: 'subscription', name: '회사', url: 'https://x/y.ics' });
  const id = s.addEvent({ calendarId: sub, title: '스크럼', startsAt: START, rrule: 'FREQ=WEEKLY', uid: 'a' });

  assert.equal(s.excludeOccurrence(id, START), false);
  assert.equal(s.setOverride(id, START, { title: 'x' }), false);
  assert.equal(s.truncateSeries(id, START), false);
  s.close();
});
