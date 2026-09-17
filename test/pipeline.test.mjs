// 저장소 → 상태 계산 경계. 두 모듈은 각자 잘 돌아도 사이가 어긋나면 화면이 통째로 빈다.
//
// 실제로 그랬다: store가 SQL 컬럼명(starts_at)을 그대로 내보내는데 clock은 startsAt을 봐서,
// 조회는 6건인데 상태는 idle이었다. 두 모듈의 단위 테스트는 각자 자기 모양만 써서 전부 통과했다.
// 이 파일은 그 사이를 붙여 놓고 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../main/store.mjs';
import { stateAt } from '../main/clock.mjs';

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whencal-pipe-'));
  return createStore(path.join(dir, 'store.sqlite'));
}

// lifecycle.dayRange와 같은 규칙 — 오늘 00:00부터 24시간
function dayRange(d) {
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return [from.toISOString(), new Date(from.getTime() + 86_400_000).toISOString()];
}

test('저장소에서 읽은 일정이 상태 계산에 그대로 들어간다', () => {
  const s = freshStore();
  const cal = s.localCalendarId();
  const now = Date.now();
  const at = (min) => new Date(now + min * 60_000).toISOString();

  s.addEvent({ calendarId: cal, title: '다가오는 회의', startsAt: at(15), endsAt: at(60) });
  s.addEvent({ calendarId: cal, title: '그 다음', startsAt: at(120), endsAt: at(150) });

  const [from, to] = dayRange(new Date(now));
  const events = s.listBetween(from, to);
  assert.equal(events.length, 2, '조회가 먼저 돼야 한다');

  const st = stateAt(now, events);
  assert.equal(st.mode, 'upcoming', '조회된 일정이 상태 계산에서 버려지면 안 된다');
  assert.equal(st.event.title, '다가오는 회의');
  assert.equal(Math.round(st.leftSec), 15 * 60);
  assert.equal(st.next.title, '그 다음');
  assert.equal(st.restCount ?? st.rest.length, 2);
  s.close();
});

test('저장소가 내보내는 행에 clock이 읽는 키가 들어 있다', () => {
  const s = freshStore();
  const cal = s.localCalendarId();
  s.addEvent({ calendarId: cal, title: 'x', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 6e5).toISOString() });

  const [row] = s.listBetween(new Date(Date.now() - 6e5).toISOString(), new Date(Date.now() + 6e5).toISOString());
  for (const key of ['startsAt', 'endsAt', 'title', 'id']) {
    assert.ok(key in row, `listBetween 결과에 ${key}가 있어야 한다`);
  }
  assert.ok(!('starts_at' in row), 'SQL 컬럼명이 밖으로 새지 않는다');
  assert.ok(Number.isFinite(Date.parse(row.startsAt)), 'startsAt은 파싱되는 시각이어야 한다');
  s.close();
});

test('진행 중인 일정도 경계를 넘어 전달된다', () => {
  const s = freshStore();
  const cal = s.localCalendarId();
  const now = Date.now();
  s.addEvent({
    calendarId: cal,
    title: '진행 중 회의',
    startsAt: new Date(now - 10 * 60_000).toISOString(),
    endsAt: new Date(now + 20 * 60_000).toISOString(),
  });

  const [from, to] = dayRange(new Date(now));
  const st = stateAt(now, s.listBetween(from, to));
  assert.equal(st.mode, 'during');
  assert.equal(st.event.title, '진행 중 회의');
  assert.equal(Math.round(st.leftSec), 20 * 60);
  s.close();
});

test('오늘 일정이 전부 지났으면 idle이다 — 이건 정상이다', () => {
  const s = freshStore();
  const cal = s.localCalendarId();
  const now = Date.now();
  s.addEvent({
    calendarId: cal,
    title: '끝난 회의',
    startsAt: new Date(now - 120 * 60_000).toISOString(),
    endsAt: new Date(now - 60 * 60_000).toISOString(),
  });

  const [from, to] = dayRange(new Date(now));
  const events = s.listBetween(from, to);
  assert.equal(events.length, 1, '지난 일정도 오늘 범위에는 잡힌다');
  assert.equal(stateAt(now, events).mode, 'idle', '다만 보여 줄 것은 없다');
  s.close();
});
