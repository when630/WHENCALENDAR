// 빈 시간 찾기와 가능 시간 문구 (FIND-01~FIND-06)
import test from 'node:test';
import assert from 'node:assert/strict';
import { findFreeSlots, formatSlots, formatSlot } from '../main/free.mjs';

// 2026-09-17은 목요일, 9/19~20이 주말
const at = (day, h, m = 0) => new Date(2026, 8, day, h, m).toISOString();
const ev = (title, day, h1, h2, extra = {}) => ({ title, startsAt: at(day, h1), endsAt: at(day, h2), ...extra });

const DAY = (d) => new Date(2026, 8, d).toISOString();
const hm = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const dd = (iso) => new Date(iso).getDate();

test('일정 사이의 빈 시간을 찾는다 (FIND-01)', () => {
  const events = [ev('오전 회의', 17, 10, 11), ev('오후 회의', 17, 14, 15)];
  const slots = findFreeSlots(events, DAY(17), DAY(18), { minMinutes: 60 });

  assert.deepEqual(
    slots.map((s) => `${hm(s.from)}–${hm(s.to)}`),
    ['09:00–10:00', '11:00–14:00', '15:00–18:00'],
    '업무 시간(09–18) 안에서 세 구간'
  );
});

test('앞뒤에 무엇이 있는지 함께 알려준다 (FIND-02)', () => {
  const events = [ev('오전 회의', 17, 10, 11), ev('오후 회의', 17, 14, 15)];
  const [, mid] = findFreeSlots(events, DAY(17), DAY(18), { minMinutes: 60 });
  assert.equal(mid.beforeTitle, '오전 회의');
  assert.equal(mid.afterTitle, '오후 회의');
});

test('요청한 길이보다 짧은 틈은 버린다', () => {
  const events = [ev('a', 17, 10, 11), ev('b', 17, 11, 30, 12)];
  const slots = findFreeSlots(events, DAY(17), DAY(18), { minMinutes: 120 });
  for (const s of slots) assert.ok(s.minutes >= 120, `${s.minutes}분짜리가 끼면 안 된다`);
});

test('업무 시간 밖은 기본으로 보지 않는다', () => {
  const slots = findFreeSlots([], DAY(17), DAY(18), { minMinutes: 60 });
  assert.equal(slots.length, 1);
  assert.equal(hm(slots[0].from), '09:00');
  assert.equal(hm(slots[0].to), '18:00');
});

test('아무 때나로 바꾸면 하루 전체를 본다', () => {
  const slots = findFreeSlots([], DAY(17), DAY(18), { minMinutes: 60, anyTime: true });
  assert.equal(hm(slots[0].from), '00:00');
  assert.equal(hm(slots[0].to), '00:00', '다음 날 0시');
  assert.equal(slots[0].minutes, 24 * 60);
});

test('주말은 기본으로 빠진다', () => {
  const slots = findFreeSlots([], DAY(14), DAY(21), { minMinutes: 60 });
  const days = slots.map((s) => dd(s.from));
  assert.deepEqual(days, [14, 15, 16, 17, 18], '19(토)·20(일)은 없다');
});

test('주말도 보게 할 수 있다', () => {
  const slots = findFreeSlots([], DAY(19), DAY(21), { minMinutes: 60, workdaysOnly: false });
  assert.deepEqual(slots.map((s) => dd(s.from)), [19, 20]);
});

test('종일 일정이 있는 날은 통째로 뺀다 — 휴가에 회의를 잡을 수는 없다', () => {
  const events = [{ title: '휴가', startsAt: DAY(18), endsAt: DAY(19), allDay: true }];
  const slots = findFreeSlots(events, DAY(17), DAY(19), { minMinutes: 60 });
  assert.deepEqual(slots.map((s) => dd(s.from)), [17]);
});

test('겹친 일정이 있어도 한 덩어리로 본다', () => {
  const events = [ev('긴 회의', 17, 10, 15), ev('그 안의 회의', 17, 11, 12)];
  const slots = findFreeSlots(events, DAY(17), DAY(18), { minMinutes: 30 });
  assert.deepEqual(slots.map((s) => `${hm(s.from)}–${hm(s.to)}`), ['09:00–10:00', '15:00–18:00']);
});

test('하루가 꽉 차 있으면 그 날은 안 나온다', () => {
  const events = [ev('종일 워크숍', 17, 9, 18)];
  assert.equal(findFreeSlots(events, DAY(17), DAY(18), { minMinutes: 30 }).length, 0);
});

test('앞뒤 여유를 두게 할 수 있다', () => {
  const events = [ev('회의', 17, 10, 11)];
  const slots = findFreeSlots(events, DAY(17), DAY(18), { minMinutes: 30, bufferMinutes: 15 });
  assert.equal(hm(slots[1].from), '11:15', '회의 끝나자마자 붙여 잡지 않는다');
});

test('최대 개수를 넘기지 않는다', () => {
  const slots = findFreeSlots([], DAY(1), DAY(30), { minMinutes: 60, maxSlots: 5 });
  assert.equal(slots.length, 5);
});

// ── 문구

const SLOTS = [
  { from: at(17, 14, 30), to: at(17, 16), minutes: 90 },
  { from: at(18, 11), to: at(18, 14), minutes: 180 },
];

test('한 칸을 사람이 읽는 줄로', () => {
  assert.equal(formatSlot(SLOTS[0]), '9월 17일 (목) 14:30 – 16:00');
});

test('목록 형식 — 높임말 (FIND-04·06)', () => {
  const text = formatSlots(SLOTS, { style: 'list', polite: true });
  assert.match(text, /편하신 때를 알려주시면/);
  assert.match(text, /• 9월 17일 \(목\) 14:30 – 16:00/);
  assert.match(text, /• 9월 18일 \(금\) 11:00 – 14:00/);
  assert.match(text, /감사합니다/);
});

test('문장 형식과 평어', () => {
  const s = formatSlots(SLOTS, { style: 'sentence', polite: false });
  assert.match(s, /편한 때 알려줘/);
  assert.ok(!s.includes('•'));
});

test('표 형식', () => {
  const t = formatSlots(SLOTS, { style: 'table' });
  assert.match(t, /\| 날짜 \| 시간 \|/);
  assert.equal(t.split('\n').length, 4, '머리 2줄 + 2건');
});

test('복사되는 글에 일정 제목이 절대 들어가지 않는다 (FIND-05)', () => {
  // 제목이 붙어 있어도 문구에는 나오면 안 된다 — 상대에게 내 일정이 새어 나가는 일이다
  const withTitles = SLOTS.map((s) => ({ ...s, beforeTitle: '김부장 미팅', afterTitle: '연봉 협상' }));
  for (const style of ['list', 'sentence', 'table']) {
    const text = formatSlots(withTitles, { style });
    assert.ok(!text.includes('김부장'), `${style}에 제목이 샜다`);
    assert.ok(!text.includes('연봉'), `${style}에 제목이 샜다`);
  }
});

test('고른 것이 없으면 빈 글', () => {
  assert.equal(formatSlots([]), '');
});
