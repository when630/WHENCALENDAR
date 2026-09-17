// 검색 (SRCH-01~03)
import test from 'node:test';
import assert from 'node:assert/strict';
import { matches, matchRange, toChoseong, isChoseongQuery } from '../main/search.mjs';

test('부분 문자열로 찾는다 (SRCH-01)', () => {
  assert.equal(matches('디자인 리뷰', '리뷰'), true);
  assert.equal(matches('디자인 리뷰', '자인'), true, '단어 경계에 기대지 않는다');
  assert.equal(matches('디자인 리뷰', '회의'), false);
});

test('공백을 무시한다', () => {
  assert.equal(matches('디자인 리뷰', '디자인리뷰'), true);
  assert.equal(matches('1:1 미팅', '1:1미팅'), true);
});

test('대소문자를 가리지 않는다', () => {
  assert.equal(matches('Sprint Review', 'sprint'), true);
  assert.equal(matches('sprint review', 'REVIEW'), true);
});

test('초성으로 찾는다 (SRCH-01)', () => {
  assert.equal(matches('디자인 리뷰', 'ㄷㅈㅇ'), true);
  assert.equal(matches('디자인 리뷰', 'ㄹㅂ'), true);
  assert.equal(matches('주간 회의', 'ㅈㄱㅎㅇ'), true);
  assert.equal(matches('주간 회의', 'ㄷㅈㅇ'), false);
});

test('초성 검색은 검색어가 초성만일 때만 — 안 그러면 아무 데나 걸린다', () => {
  assert.equal(isChoseongQuery('ㄷㅈㅇ'), true);
  assert.equal(isChoseongQuery('디자인'), false);
  assert.equal(isChoseongQuery('ㄷ자인'), false);
  assert.equal(isChoseongQuery(''), false);
  // "가"는 초성이 아니라 완성 글자다 — 초성 규칙을 태우면 안 된다
  assert.equal(matches('회의', '가'), false);
});

test('초성 변환', () => {
  assert.equal(toChoseong('디자인 리뷰'), 'ㄷㅈㅇ ㄹㅂ');
  assert.equal(toChoseong('1:1 미팅'), '1:1 ㅁㅌ');
  assert.equal(toChoseong('Sprint'), 'Sprint', '한글이 아니면 그대로');
  assert.equal(toChoseong('넋'), 'ㄴ', '받침이 겹쳐도 초성만');
});

test('빈 검색어는 아무것도 찾지 않는다', () => {
  assert.equal(matches('회의', ''), false);
  assert.equal(matches('회의', '   '), false);
});

test('강조할 자리를 알려준다 (SRCH-03)', () => {
  const [a, b] = matchRange('디자인 리뷰', '리뷰');
  assert.equal('디자인 리뷰'.slice(a, b), '리뷰');

  const [c, d] = matchRange('스펙 리뷰 회의', '리뷰');
  assert.equal('스펙 리뷰 회의'.slice(c, d), '리뷰');
});

test('공백을 건너뛴 검색어도 원문 좌표로 돌려준다', () => {
  const r = matchRange('디자인 리뷰', '디자인리');
  assert.ok(r);
  const [a, b] = r;
  assert.equal('디자인 리뷰'.slice(a, b), '디자인 리');
});

test('초성으로 찾은 것도 강조된다', () => {
  const r = matchRange('디자인 리뷰', 'ㄷㅈㅇ');
  assert.ok(r);
  const [a, b] = r;
  assert.equal('디자인 리뷰'.slice(a, b), '디자인');
});

test('못 찾으면 null', () => {
  assert.equal(matchRange('회의', '없는말'), null);
});
