import test from 'node:test';
import assert from 'node:assert/strict';
import { stateAt, tierOf, revealOf, msUntilNextChange, DEFAULTS } from '../main/clock.mjs';

const T = (h, m = 0) => new Date(2026, 8, 17, h, m, 0).getTime(); // 2026-09-17 로컬
const ev = (title, from, to) => ({ id: title, title, startsAt: from, endsAt: to });

const AGENDA = [
  ev('주간 회의', T(14), T(15)),
  ev('디자인 리뷰', T(15, 30), T(16, 15)),
  ev('1:1 미팅', T(17), T(17, 30)),
];

test('일정 전에는 upcoming, 남은 시간과 다음 일정을 센다', () => {
  const st = stateAt(T(13, 45), AGENDA);
  assert.equal(st.mode, 'upcoming');
  assert.equal(st.event.title, '주간 회의');
  assert.equal(st.leftSec, 15 * 60);
  assert.equal(st.rest.length, 3);
  assert.equal(st.next.title, '디자인 리뷰');
});

test('일정 중에는 during, 링은 끝날 때까지를 센다', () => {
  const st = stateAt(T(14, 30), AGENDA);
  assert.equal(st.mode, 'during');
  assert.equal(st.event.title, '주간 회의');
  assert.equal(st.leftSec, 30 * 60);
  assert.equal(st.spanSec, 60 * 60);
  assert.equal(st.ratio, 0.5);
  assert.equal(st.reveal, 1, '진행 중에는 늘 펼쳐져 있다');
  assert.equal(st.next.title, '디자인 리뷰', 'during에서도 다음을 안다');
});

test('종료 5분 전이면 endingSoon (OVL-09)', () => {
  assert.equal(stateAt(T(14, 50), AGENDA).endingSoon, false);
  const soon = stateAt(T(14, 56), AGENDA);
  assert.equal(soon.endingSoon, true);
  assert.notEqual(soon.tier, 'live', '곧 종료면 중립색에서 벗어난다');
});

test('endSoonEnabled를 끄면 곧 종료를 알리지 않는다 (OVL-09 설정)', () => {
  const st = stateAt(T(14, 56), AGENDA, { endSoonEnabled: false });
  assert.equal(st.endingSoon, false);
  assert.equal(st.tier, 'live');
});

test('오늘 남은 일정이 없으면 idle (OVL-10)', () => {
  const st = stateAt(T(18), AGENDA);
  assert.equal(st.mode, 'idle');
  assert.equal(st.event, null);
  assert.equal(st.next, null);
  assert.equal(st.reveal, 0);
});

test('일정 사이 빈 시간에는 다음 것을 본다', () => {
  const st = stateAt(T(15, 10), AGENDA);
  assert.equal(st.mode, 'upcoming');
  assert.equal(st.event.title, '디자인 리뷰');
  assert.equal(st.leftSec, 20 * 60);
  assert.equal(st.rest.length, 2);
});

test('진행 중인 것이 겹치면 먼저 끝나는 쪽을 잡는다', () => {
  const overlapping = [ev('종일 워크숍', T(9), T(18)), ev('짧은 통화', T(14), T(14, 20))];
  const st = stateAt(T(14, 10), overlapping);
  assert.equal(st.mode, 'during');
  assert.equal(st.event.title, '짧은 통화', '다음 행동을 요구하는 쪽이 먼저 끝나는 것이다');
});

test('입력이 정렬돼 있지 않아도 된다', () => {
  const shuffled = [AGENDA[2], AGENDA[0], AGENDA[1]];
  const st = stateAt(T(13, 45), shuffled);
  assert.equal(st.event.title, '주간 회의');
  assert.deepEqual(st.rest.map((e) => e.title), ['주간 회의', '디자인 리뷰', '1:1 미팅']);
});

test('ISO 문자열과 Date도 받는다', () => {
  const iso = [{ id: 'a', title: 'ISO', startsAt: new Date(T(14)).toISOString(), endsAt: new Date(T(15)).toISOString() }];
  const dt = [{ id: 'b', title: 'Date', startsAt: new Date(T(14)), endsAt: new Date(T(15)) }];
  assert.equal(stateAt(T(13, 45), iso).leftSec, 15 * 60);
  assert.equal(stateAt(T(13, 45), dt).leftSec, 15 * 60);
});

test('끝 시각이 없는 일정은 시작만으로 판정한다', () => {
  const st = stateAt(T(13, 45), [{ id: 'x', title: '치과', startsAt: T(14) }]);
  assert.equal(st.mode, 'upcoming');
  assert.equal(st.leftSec, 15 * 60);
});

test('tier 경계 (OVL-05)', () => {
  assert.equal(tierOf(90 * 60), 'calm');
  assert.equal(tierOf(60 * 60), 'faint', '정확히 60분이면 이미 잠잠에서 벗어난다');
  assert.equal(tierOf(31 * 60), 'faint');
  assert.equal(tierOf(30 * 60), 'aware');
  assert.equal(tierOf(11 * 60), 'aware');
  assert.equal(tierOf(10 * 60), 'alert');
  assert.equal(tierOf(6 * 60), 'alert');
  assert.equal(tierOf(5 * 60), 'urge');
  assert.equal(tierOf(61), 'urge');
  assert.equal(tierOf(60), 'beat');
  assert.equal(tierOf(0), 'beat');
});

test('reveal은 30분에서 10분 사이를 선형으로 잇는다 (OVL-05)', () => {
  assert.equal(revealOf(31 * 60), 0);
  assert.equal(revealOf(30 * 60), 0);
  assert.equal(revealOf(20 * 60), 0.5, '중간이면 절반');
  assert.equal(revealOf(10 * 60), 1);
  assert.equal(revealOf(0), 1);
});

test('설정으로 펼침 시점을 바꿀 수 있다 (OVL-12)', () => {
  const o = { revealStartSec: 10 * 60, revealFullSec: 2 * 60 };
  assert.equal(revealOf(30 * 60, { ...DEFAULTS, ...o }), 0);
  assert.equal(revealOf(6 * 60, { ...DEFAULTS, ...o }), 0.5);
  assert.equal(revealOf(2 * 60, { ...DEFAULTS, ...o }), 1);
});

test('펼쳐진 뒤에는 1초마다, 그 전에는 다음 경계까지 기다린다', () => {
  assert.equal(msUntilNextChange(T(13, 55), AGENDA), 1000, '펼쳐졌으면 초가 바뀌므로 1초');
  const far = msUntilNextChange(T(13, 0), AGENDA);
  assert.ok(far > 1000, '아직 접혀 있으면 더 오래 잔다');
  assert.ok(far <= 60_000, '그래도 1분은 넘기지 않는다');
  assert.equal(msUntilNextChange(T(18), AGENDA), null, '오늘 끝났으면 깨울 이유가 없다');
});

test('일정이 없으면 idle이고 틱도 멈춘다', () => {
  assert.equal(stateAt(T(12), []).mode, 'idle');
  assert.equal(msUntilNextChange(T(12), []), null);
});
