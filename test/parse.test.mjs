// 한 줄 입력 해석 (EV-01·EV-02). 이 목록이 사실상 "무엇을 알아들어야 하는 앱인지"의 명세다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, describe as describeParsed, DEFAULT_MINUTES } from '../main/parse.mjs';

// 2026-09-17 목요일 10:00을 "지금"으로 고정한다
const NOW = new Date(2026, 8, 17, 10, 0, 0);

const p = (s, now = NOW) => parseLine(s, now);
const ymd = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hm = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const mins = (r) => (new Date(r.endsAt) - new Date(r.startsAt)) / 60000;

test('기본형 — 내일 15:00 치과 1시간', () => {
  const r = p('내일 15:00 치과 1시간');
  assert.equal(r.ok, true);
  assert.equal(r.title, '치과');
  assert.equal(ymd(r.startsAt), '2026-09-18');
  assert.equal(hm(r.startsAt), '15:00');
  assert.equal(mins(r), 60);
  assert.equal(r.allDay, false);
});

test('상대일 — 오늘·내일·낼·모레·글피', () => {
  assert.equal(ymd(p('오늘 14시 회의').startsAt), '2026-09-17');
  assert.equal(ymd(p('내일 14시 회의').startsAt), '2026-09-18');
  assert.equal(ymd(p('낼 14시 회의').startsAt), '2026-09-18');
  assert.equal(ymd(p('모레 14시 회의').startsAt), '2026-09-19');
  assert.equal(ymd(p('글피 14시 회의').startsAt), '2026-09-20');
});

test('요일만 말하면 가장 가까운 앞으로의 그 요일', () => {
  // 2026-09-17은 목요일
  assert.equal(ymd(p('금요일 14시 회의').startsAt), '2026-09-18', '내일이 금');
  assert.equal(ymd(p('월 14시 회의').startsAt), '2026-09-21', '다음 월요일');
  assert.equal(ymd(p('목 14시 회의').startsAt), '2026-09-17', '오늘이 목이면 오늘');
});

test('다음주·담주·차주 + 요일', () => {
  // 이번 주 월요일은 9/14, 다음 주 월요일은 9/21
  assert.equal(ymd(p('다음주 화 15시 김부장 미팅').startsAt), '2026-09-22');
  assert.equal(ymd(p('담주 화 15시 김부장 미팅').startsAt), '2026-09-22');
  assert.equal(ymd(p('차주 화 15시 김부장 미팅').startsAt), '2026-09-22');
  assert.equal(ymd(p('이번주 금 15시 회고').startsAt), '2026-09-18');
  assert.equal(ymd(p('다다음주 월 15시 워크숍').startsAt), '2026-09-28');
});

test('날짜 표기 — 9/23 · 9월 23일', () => {
  assert.equal(ymd(p('9/23 15시 미팅').startsAt), '2026-09-23');
  assert.equal(ymd(p('9월 23일 15시 미팅').startsAt), '2026-09-23');
});

test('이미 지난 날짜는 내년으로 본다', () => {
  assert.equal(ymd(p('1/5 15시 신년회').startsAt), '2027-01-05');
});

test('시각 표기 — 3시 · 3시반 · 3시 30분 · 15시 · 15:30', () => {
  assert.equal(hm(p('내일 3시 회의').startsAt), '15:00', '1~7시는 오후로 본다');
  assert.equal(hm(p('내일 3시반 회의').startsAt), '15:30');
  assert.equal(hm(p('내일 3시 30분 회의').startsAt), '15:30');
  assert.equal(hm(p('내일 15시 회의').startsAt), '15:00');
  assert.equal(hm(p('내일 15:30 회의').startsAt), '15:30');
  assert.equal(hm(p('내일 9시 회의').startsAt), '09:00', '8시 이후는 그대로 오전');
});

test('오전·오후를 붙이면 그대로 따른다', () => {
  assert.equal(hm(p('내일 오전 3시 새벽 배포').startsAt), '03:00');
  assert.equal(hm(p('내일 오후 3시 회의').startsAt), '15:00');
  assert.equal(hm(p('내일 오후 9시 통화').startsAt), '21:00');
  assert.equal(hm(p('내일 오전 11시 회의').startsAt), '11:00');
});

test('애매한 시각은 반드시 알린다 (EV-02)', () => {
  const r = p('내일 3시 회의');
  const note = r.notes.find((n) => n.field === 'time');
  assert.ok(note, '오후로 본 것을 화면이 되물을 수 있어야 한다');
  assert.match(note.msg, /오후/);

  assert.equal(p('내일 오후 3시 회의').notes.filter((n) => n.field === 'time').length, 0, '명시하면 묻지 않는다');
  assert.equal(p('내일 15시 회의').notes.filter((n) => n.field === 'time').length, 0, '24시간제도 묻지 않는다');
});

test('정오·자정', () => {
  assert.equal(hm(p('내일 정오 점심').startsAt), '12:00');
  assert.equal(hm(p('내일 자정 배포').startsAt), '00:00');
});

test('기간 — 1시간 · 90분 · 1시간 30분 · 반나절', () => {
  assert.equal(mins(p('내일 14시 회의 1시간')), 60);
  assert.equal(mins(p('내일 14시 회의 90분')), 90);
  assert.equal(mins(p('내일 14시 회의 1시간 30분')), 90);
  assert.equal(mins(p('내일 14시 워크숍 반나절')), 240);
  assert.equal(mins(p('내일 14시 회의')), DEFAULT_MINUTES, '없으면 기본 1시간');
});

test('~까지로 끝 시각을 직접 준다', () => {
  const r = p('내일 14시 ~17시까지 워크숍');
  assert.equal(hm(r.startsAt), '14:00');
  assert.equal(hm(r.endsAt), '17:00');
});

test('시각이 없으면 종일 일정이다', () => {
  const r = p('내일 건강검진');
  assert.equal(r.allDay, true);
  assert.equal(r.endsAt, null);
  assert.equal(r.title, '건강검진');
});

test('날짜가 없으면 오늘이고, 지난 시각이면 내일로 넘긴다', () => {
  const r1 = p('14시 회의'); // 지금 10시니 오늘 14시
  assert.equal(ymd(r1.startsAt), '2026-09-17');
  assert.equal(r1.notes.filter((n) => n.field === 'date').length, 0);

  const late = new Date(2026, 8, 17, 23, 0, 0);
  const r2 = p('9시 회의', late);
  assert.equal(ymd(r2.startsAt), '2026-09-18', '밤 11시에 9시라고 하면 내일 아침이다');
  assert.ok(r2.notes.some((n) => n.field === 'date'));
});

test('제목에 숫자와 콜론이 있어도 시각으로 먹지 않는다', () => {
  const r = p('내일 15시 1:1 미팅');
  assert.equal(hm(r.startsAt), '15:00');
  assert.equal(r.title, '1:1 미팅', '분이 한 자리면 시각이 아니다');
});

test('제목이 여러 낱말이어도 그대로 남는다', () => {
  assert.equal(p('내일 14시 스프린트 계획 회의 2시간').title, '스프린트 계획 회의');
  assert.equal(p('다음주 월 10시 고객사 방문').title, '고객사 방문');
});

test('제목만 있으면 ok=false — 거절하지 않고 구조화 입력으로 넘긴다 (EV-03)', () => {
  const r = p('내일 3시');
  assert.equal(r.ok, false, '제목이 없으면 확정하지 않는다');
  assert.ok(r.startsAt, '다만 읽어낸 날짜·시각은 살려 준다');
  assert.equal(hm(r.startsAt), '15:00');
});

test('빈 입력은 아무것도 만들지 않는다', () => {
  const r = p('   ');
  assert.equal(r.ok, false);
  assert.equal(r.startsAt, null);
});

test('요일 없이 다음주만 말하면 월요일로 보고 알린다', () => {
  const r = p('다음주 워크숍');
  assert.equal(ymd(r.startsAt), '2026-09-21');
  assert.ok(r.notes.some((n) => n.field === 'date'));
});

test('해석 결과를 사람이 읽는 한 줄로 (EV-02)', () => {
  assert.equal(describeParsed(p('내일 15시 치과 30분')), '9월 18일 (금) 15:00 – 15:30');
  assert.equal(describeParsed(p('내일 건강검진')), '9월 18일 (금) · 종일');
});

test('실제로 칠 법한 문장들', () => {
  const cases = [
    ['담주 화 3시 김부장 미팅 1시간', '2026-09-22', '15:00', '김부장 미팅', 60],
    ['9/25 오전 10시 스프린트 리뷰 2시간', '2026-09-25', '10:00', '스프린트 리뷰', 120],
    ['모레 저녁 7시 회식', '2026-09-19', '19:00', '회식', 60],
    ['금요일 9시반 주간회의 30분', '2026-09-18', '09:30', '주간회의', 30],
  ];
  for (const [input, day, time, title, dur] of cases) {
    const r = p(input);
    assert.equal(ymd(r.startsAt), day, input);
    assert.equal(hm(r.startsAt), time, input);
    assert.equal(r.title, title, input);
    assert.equal(mins(r), dur, input);
  }
});

test('오전·저녁은 시각 바로 앞에 붙었을 때만 떼어낸다', () => {
  // "저녁 7시"의 저녁은 시각 힌트 — 떼어내야 제목이 깔끔하다
  const a = p('모레 저녁 7시 회식');
  assert.equal(hm(a.startsAt), '19:00');
  assert.equal(a.title, '회식');

  // "8시반 저녁 약속"의 저녁은 제목의 일부 — 시각 해석에는 쓰되 글자는 남긴다
  const b = p('오늘 8시반 저녁 약속 2시간');
  assert.equal(hm(b.startsAt), '20:30', '뒤에 있어도 오후 힌트로는 쓴다');
  assert.equal(b.title, '저녁 약속', '제목에서 지우지는 않는다');
  assert.equal(mins(b), 120);

  // 같은 규칙이 아침에도
  assert.equal(p('내일 7시 아침 운동').title, '아침 운동');
  assert.equal(hm(p('내일 7시 아침 운동').startsAt), '07:00');
  assert.equal(p('내일 아침 7시 운동').title, '운동');
});

// ── 반복 (EV-07)
import { describeRrule } from '../main/parse.mjs';

test('매주·격주·매일·매달을 규칙으로 읽는다', () => {
  assert.equal(p('매주 화 3시 주간회의').rrule, 'FREQ=WEEKLY;BYDAY=TU');
  assert.equal(p('격주 월 10시 격주회의').rrule, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
  assert.equal(p('매일 9시 스탠드업').rrule, 'FREQ=DAILY');
  assert.equal(p('매달 15일 10시 정산').rrule, 'FREQ=MONTHLY;BYMONTHDAY=15');
  assert.equal(p('매년 3월 2일 기념일').rrule, 'FREQ=YEARLY');
});

test('반복이 아니면 rrule이 없다', () => {
  assert.equal(p('내일 3시 회의').rrule, null);
});

test('반복을 먼저 떼어내야 요일이 날짜로 먹히지 않는다', () => {
  // "매주 화"에서 화를 날짜로 먹으면 이번 주 화요일 한 건이 되고 반복이 사라진다
  const r = p('매주 화 3시 주간회의');
  assert.equal(r.rrule, 'FREQ=WEEKLY;BYDAY=TU');
  assert.equal(r.title, '주간회의');
  assert.equal(hm(r.startsAt), '15:00');
  assert.equal(new Date(r.startsAt).getDay(), 2, '가장 가까운 화요일부터 시작');
});

test('반복 일정의 제목에서 반복 낱말이 빠진다', () => {
  assert.equal(p('매일 9시 스탠드업 15분').title, '스탠드업');
  assert.equal(p('매달 15일 10시 정산 회의').title, '정산 회의');
});

test('규칙을 사람 말로 되돌린다', () => {
  assert.equal(describeRrule('FREQ=WEEKLY;BYDAY=TU'), '매주 화');
  assert.equal(describeRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), '2주마다 월');
  assert.equal(describeRrule('FREQ=DAILY'), '매일');
  assert.equal(describeRrule('FREQ=MONTHLY;BYMONTHDAY=15'), '매달 15일');
  assert.equal(describeRrule('FREQ=WEEKLY;COUNT=3'), '매주 · 3번');
  assert.equal(describeRrule('FREQ=WEEKLY;UNTIL=20261231T000000Z'), '매주 · 12월 31일까지');
  assert.equal(describeRrule(null), '');
});

test('해석 요약에 반복이 함께 보인다 (EV-02)', () => {
  assert.match(describeParsed(p('매주 화 3시 주간회의 1시간')), /^매주 화 · /);
});
