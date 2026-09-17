// 렌더러가 강조를 위해 들고 있는 초성 복사본이 main/search.mjs와 어긋나지 않는지 본다.
// 번들러가 없어 코드를 공유할 수 없으므로, 대신 테스트가 둘을 붙여 놓고 비교한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchRange, toChoseong } from '../main/search.mjs';

const src = fs.readFileSync(new URL('../renderer/main.js', import.meta.url), 'utf8');
const pick = (name) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name}을 렌더러에서 찾지 못했다`);
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error('괄호가 안 닫힌다');
};

const CHO_LINE = src.slice(src.indexOf('const CHO ='), src.indexOf('\n', src.indexOf('const CHO =')) + 1);
const sandbox = new Function(`${CHO_LINE}${pick('choOf')}${pick('hitRange')}return { choOf, hitRange };`)();

const CASES = [
  ['디자인 리뷰', '리뷰'],
  ['디자인 리뷰', 'ㄷㅈㅇ'],
  ['디자인 리뷰', '디자인리'],
  ['주간 회의', 'ㅈㄱ'],
  ['1:1 미팅', '미팅'],
  ['Sprint Review', 'sprint'],
  ['회의', '없는말'],
];

test('렌더러의 초성 변환이 main과 같다', () => {
  for (const [text] of CASES) assert.equal(sandbox.choOf(text), toChoseong(text), text);
});

test('렌더러의 강조 범위가 main과 같다', () => {
  for (const [text, q] of CASES) {
    assert.deepEqual(sandbox.hitRange(text, q), matchRange(text, q), `${text} / ${q}`);
  }
});
