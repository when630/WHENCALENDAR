import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, schemaTables, nextColor, COLOR_ORDER, MIGRATIONS, NewerSchemaError } from '../main/store.mjs';

function tmpFile(name = 'store.sqlite') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whencal-'));
  return { dir, file: path.join(dir, name) };
}

const ISO = (h, m = 0) => new Date(2026, 8, 17, h, m, 0).toISOString();

test('새 DB는 v1 스키마로 열리고 표가 전부 선다 (STOR-01)', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  assert.equal(s.ok, true);
  s.close();

  const db = new DatabaseSync(file);
  const got = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(got, schemaTables());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  db.close();
});

test('두 번 열어도 같은 상태다 — 마이그레이션은 멱등이다', () => {
  const { file } = tmpFile();
  createStore(file).close();
  const s = createStore(file);
  assert.equal(s.ok, true);
  assert.equal(s.state.reason, null);
  s.close();
});

test('앱보다 높은 스키마 버전은 열지 않는다 (STOR-03)', () => {
  const { file } = tmpFile();
  createStore(file).close();

  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5}`);
  db.close();

  const s = createStore(file);
  assert.equal(s.ok, false);
  assert.equal(s.state.reason, 'newer-schema');
  assert.equal(s.state.quarantined, null, '건강한 파일을 옆으로 밀지 않는다');
  assert.ok(fs.existsSync(file), '파일은 그대로 있어야 한다');
});

test('손상된 파일은 지우지 않고 옆에 보관한 뒤 새로 시작한다 (STOR-03)', () => {
  const { dir, file } = tmpFile();
  fs.writeFileSync(file, 'this is definitely not a sqlite database');

  const s = createStore(file);
  assert.equal(s.ok, true, '손상돼도 앱은 뜬다');
  assert.equal(s.state.reason, 'recovered');
  assert.ok(s.state.quarantined, '격리 파일 이름이 남는다');
  assert.ok(fs.existsSync(path.join(dir, s.state.quarantined)), '원본이 보관돼 있다');
  s.close();
});

test('직접 등록용 달력은 없으면 만들어진다 (PLAT-01)', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  const a = s.localCalendarId();
  const b = s.localCalendarId();
  assert.equal(a, b, '두 번 불러도 하나만 만든다');
  assert.equal(s.listCalendars().length, 1);
  s.close();
});

test('범위와 겹치는 일정만 가져온다', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  const cal = s.localCalendarId();

  s.addEvent({ calendarId: cal, title: '아침', startsAt: ISO(9), endsAt: ISO(10) });
  s.addEvent({ calendarId: cal, title: '점심 회의', startsAt: ISO(12), endsAt: ISO(13) });
  s.addEvent({ calendarId: cal, title: '저녁', startsAt: ISO(19), endsAt: ISO(20) });

  const mid = s.listBetween(ISO(11), ISO(15)).map((e) => e.title);
  assert.deepEqual(mid, ['점심 회의']);

  // 경계에 걸친 일정도 잡힌다 — 09:30에 시작하는 창은 09:00~10:00 일정과 겹친다
  const edge = s.listBetween(ISO(9, 30), ISO(9, 45)).map((e) => e.title);
  assert.deepEqual(edge, ['아침']);

  assert.equal(s.listBetween(ISO(10), ISO(12)).length, 0, '맞닿기만 한 것은 겹친 게 아니다');
  s.close();
});

test('결과에 달력 색과 이름이 함께 온다', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  const cal = s.addCalendar({ kind: 'subscription', name: '회사', url: 'https://x/y.ics' });
  s.addEvent({ calendarId: cal, title: '스크럼', startsAt: ISO(9, 30), endsAt: ISO(10) });

  const [row] = s.listBetween(ISO(9), ISO(11));
  assert.equal(row.calendarName, '회사');
  assert.equal(row.calendarKind, 'subscription');
  assert.ok(COLOR_ORDER.includes(row.color));
  s.close();
});

test('꺼둔 달력의 일정은 빠진다 (SUB-06)', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  const cal = s.addCalendar({ kind: 'subscription', name: '가족', url: 'https://x/f.ics' });
  s.addEvent({ calendarId: cal, title: '가족 저녁', startsAt: ISO(19), endsAt: ISO(20) });
  assert.equal(s.listBetween(ISO(18), ISO(21)).length, 1);

  s.close();
  // enabled를 직접 끈다 — 토글 API는 Phase 2에서 붙는다
  const db = new DatabaseSync(file);
  db.exec('UPDATE calendar SET enabled = 0');
  db.close();

  const s2 = createStore(file);
  assert.equal(s2.listBetween(ISO(18), ISO(21)).length, 0);
  s2.close();
});

test('삭제는 소프트 삭제다 (EV-06)', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  const cal = s.localCalendarId();
  const id = s.addEvent({ calendarId: cal, title: '치과', startsAt: ISO(19) });

  assert.equal(s.countEvents(), 1);
  s.softDeleteEvent(id);
  assert.equal(s.countEvents(), 0, '목록에서는 사라지고');
  assert.equal(s.listBetween(ISO(18), ISO(21)).length, 0);

  const db = new DatabaseSync(file);
  assert.equal(db.prepare('SELECT count(*) AS n FROM event').get().n, 1, '행은 남아 있다');
  db.close();
  s.close();
});

test('같은 달력에 같은 uid는 한 번만 들어간다 (구독 갱신 멱등)', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  const cal = s.addCalendar({ kind: 'subscription', name: '회사', url: 'https://x/y.ics' });
  s.addEvent({ calendarId: cal, title: '스크럼', startsAt: ISO(9, 30), uid: 'abc@google.com' });
  assert.throws(() => s.addEvent({ calendarId: cal, title: '스크럼', startsAt: ISO(9, 30), uid: 'abc@google.com' }));
  s.close();
});

test('색은 상태색과 겹치는 것을 뒤로 미뤄 배정한다 (D-09)', () => {
  assert.equal(nextColor([]), 1, '파랑 먼저');
  assert.equal(nextColor([1]), 3, '그 다음 보라');
  assert.equal(nextColor([1, 3]), 6, '그 다음 하늘');
  assert.deepEqual(COLOR_ORDER.slice(0, 3), [1, 3, 6], '구독 3개까지는 상태색과 안 겹친다');
  assert.equal(nextColor([1, 3, 6]), 2, '네 번째부터 초록(=success와 같은 값)');
  assert.ok(COLOR_ORDER.includes(nextColor(COLOR_ORDER)), '여섯을 다 써도 색은 나온다');
});

test('설정은 값을 그대로 돌려준다', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  assert.equal(s.getSetting('ringSize', 20), 20, '없으면 기본값');
  s.setSetting('ringSize', 26);
  s.setSetting('overlay', { position: 'top-center', allDisplays: false });
  assert.equal(s.getSetting('ringSize'), 26);
  assert.deepEqual(s.getSetting('overlay'), { position: 'top-center', allDisplays: false });
  s.setSetting('ringSize', 16);
  assert.equal(s.getSetting('ringSize'), 16, '덮어쓰기가 된다');
  s.close();
});

test('일정을 고칠 수 있다 (EV-05)', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  const cal = s.localCalendarId();
  const id = s.addEvent({ calendarId: cal, title: '치과', startsAt: ISO(19), endsAt: ISO(19, 30) });

  assert.equal(s.updateEvent(id, { title: '치과 스케일링' }), true);
  assert.equal(s.getEvent(id).title, '치과 스케일링');

  s.updateEvent(id, { startsAt: ISO(20), endsAt: ISO(20, 30) });
  assert.equal(s.getEvent(id).startsAt, ISO(20));
  s.close();
});

test('구독으로 들어온 일정은 고칠 수 없다 (EV-05)', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  const sub = s.addCalendar({ kind: 'subscription', name: '회사', url: 'https://x/y.ics' });
  const id = s.addEvent({ calendarId: sub, title: '스크럼', startsAt: ISO(9, 30), uid: 'a' });

  assert.equal(s.updateEvent(id, { title: '바꿔보기' }), false, '고쳐지는 척하면 안 된다');
  assert.equal(s.getEvent(id).title, '스크럼', '다음 갱신에 어차피 덮인다');
  s.close();
});

test('없는 일정을 고치려 하면 false', () => {
  const { file } = tmpFile();
  const s = createStore(file);
  assert.equal(s.updateEvent(9999, { title: 'x' }), false);
  s.close();
});
