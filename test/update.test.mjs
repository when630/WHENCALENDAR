// 업데이트 문구 (REL-03). electron을 부르지 않는 순수 부분만 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLine, shortError, createUpdateState } from '../main/update-text.mjs';

test('상태마다 사람이 읽는 한 줄', () => {
  const s = createUpdateState();
  assert.match(updateLine(s, '0.1.0'), /최신 버전 \(0\.1\.0\)/);

  assert.match(updateLine({ ...s, status: 'checking' }), /확인 중/);
  assert.match(updateLine({ ...s, status: 'available', version: '0.2.0' }), /0\.2\.0/);
  assert.match(updateLine({ ...s, status: 'downloading', version: '0.2.0', percent: 42.7 }), /43%/);
  assert.match(updateLine({ ...s, status: 'ready', version: '0.2.0' }), /종료할 때 설치/);
  assert.match(updateLine({ ...s, status: 'unsupported' }), /설치본에서만/);
  assert.match(updateLine({ ...s, status: 'error', error: '네트워크에 닿지 못했습니다' }), /네트워크/);
});

test('오류는 한 줄로 줄이고 내부 경로를 내보내지 않는다', () => {
  assert.equal(shortError(new Error('getaddrinfo ENOTFOUND github.com')), '네트워크에 닿지 못했습니다');
  assert.match(shortError(new Error('HttpError: 404 Not Found')), /공개된 릴리스가 없습니다/);
  assert.match(shortError(new Error('API rate limit exceeded')), /한도/);

  // 스택이 붙은 오류를 그대로 보여 주면 사용자에게 내부 경로가 새어 나간다
  const stacky = new Error(['무언가 실패', '    at /repo/main/update.mjs:12:34'].join('\n'));
  const line = shortError(stacky);
  assert.ok(!line.includes('\n'), '여러 줄이 새어 나가면 안 된다');
  assert.ok(!line.includes('/repo/main'), '내부 경로가 보이면 안 된다');
  assert.equal(line, '무언가 실패');
});

test('아주 긴 오류도 잘린다', () => {
  assert.ok(shortError(new Error('x'.repeat(500))).length <= 120);
});

test('빈 오류에도 뭔가는 말한다', () => {
  assert.ok(shortError(null).length > 0);
  assert.ok(shortError(new Error('')).length > 0);
});
