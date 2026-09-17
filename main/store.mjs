// main/store.mjs — node:sqlite 단일 파일 저장소. 열기·손상 판정·마이그레이션·백업 체계는
// WHENNOTE main/store.mjs에서 그대로 가져왔고(STOR-02·STOR-03 승계), 스키마와 CRUD만 일정용이다.
//
// DatabaseSync는 동기 API라 이 파일의 모든 함수도 동기다. Electron을 import하지 않는 순수
// Node 모듈이라 node --test로 검증한다.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// 앱이 자신보다 높은 user_version의 DB를 만나면 열지 않는다(STOR-03) — 구버전으로 되돌린
// 사용자가 최신 스키마에 실수로 쓰지 않게 막는 신호다.
export class NewerSchemaError extends Error {
  constructor(found, known) {
    super(`store schema v${found}, this app only knows up to v${known}`);
    this.name = 'NewerSchemaError';
    this.found = found;
    this.known = known;
  }
}

// v1 스키마(03_기술_스펙 §4).
//
// starts_at·ends_at은 ISO8601 문자열이다. 정렬과 범위 질의가 문자열 비교로 그대로 되고,
// 사람이 DB를 열어 봐도 읽힌다 — 캘린더에서 이 둘은 계속 눈으로 확인하게 되는 값이다.
//
// rrule은 RFC 5545 원문을 그대로 담는다(D-07). 펼치는 것은 recur.mjs의 일이고 저장소는
// 원문을 잃지 않는 것만 책임진다.
const V1_SQL = `
CREATE TABLE calendar (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  url          TEXT,
  color        INTEGER NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_error   TEXT,
  etag         TEXT,
  created_at   TEXT    NOT NULL
);

CREATE TABLE event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  calendar_id INTEGER NOT NULL REFERENCES calendar(id),
  uid         TEXT,
  title       TEXT    NOT NULL,
  starts_at   TEXT    NOT NULL,
  ends_at     TEXT,
  all_day     INTEGER NOT NULL DEFAULT 0,
  tzid        TEXT,
  rrule       TEXT,
  exdates     TEXT,
  location    TEXT,
  note        TEXT,
  remind_min  INTEGER,
  source_hash TEXT,
  deleted_at  TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE UNIQUE INDEX event_uid ON event (calendar_id, uid) WHERE uid IS NOT NULL;
CREATE INDEX event_starts ON event (starts_at) WHERE deleted_at IS NULL;

CREATE TABLE override (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES event(id),
  recurrence_id TEXT    NOT NULL,
  starts_at     TEXT,
  ends_at       TEXT,
  title         TEXT,
  cancelled     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX override_at ON override (event_id, recurrence_id);

CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// PRAGMA user_version 순번 마이그레이션(WHENWORK D-12 승계). 새 DB도 v0에서 이 배열을 처음부터
// 끝까지 밟아 올라간다 — 경로가 하나다. 한 번 배포된 함수는 절대 고치지 않는다.
export const MIGRATIONS = [(db) => db.exec(V1_SQL)];
const MIGRATION_SQL = [V1_SQL];

// 스키마가 실제로 만드는 표 이름 — 가드 테스트가 이것과 대조한다.
export function schemaTables() {
  const names = new Set();
  for (const sql of MIGRATION_SQL) {
    for (const m of sql.matchAll(/CREATE TABLE (\w+)/g)) names.add(m[1]);
  }
  return [...names].sort();
}

function withTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── 이행 전 백업 (WHENWORK D-16 승계)
const BACKUP_KEEP = 5;

function todayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function pruneOldBackups(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => /^store-v\d+-\d{8}\.sqlite$/.test(f));
    if (files.length <= BACKUP_KEEP) return;
    const withTimes = files
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    for (const { f } of withTimes.slice(0, withTimes.length - BACKUP_KEEP)) {
      fs.unlinkSync(path.join(dir, f));
    }
  } catch {
    // 정리 실패는 무시 — 이행을 막을 이유가 아니다
  }
}

function backupBeforeMigrate(db, file, fromVersion) {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const dir = path.join(path.dirname(file), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, `store-v${fromVersion}-${todayStamp()}.sqlite`));
    pruneOldBackups(dir);
  } catch {
    // 백업 실패가 이행을 막지 않는다
  }
}

function migrate(db, file) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  if (current > MIGRATIONS.length) throw new NewerSchemaError(current, MIGRATIONS.length);
  if (current === MIGRATIONS.length) return;
  if (current > 0) backupBeforeMigrate(db, file, current);
  for (let v = current; v < MIGRATIONS.length; v++) {
    withTransaction(db, () => {
      MIGRATIONS[v](db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// ── 손상 판정·격리 (WHENWORK D-15 승계)
class IntegrityCheckFailedError extends Error {}

function checkIntegrity(db) {
  const row = db.prepare('PRAGMA integrity_check').get();
  if (row?.integrity_check !== 'ok') {
    throw new IntegrityCheckFailedError(`integrity_check: ${row?.integrity_check}`);
  }
}

// errcode 26(SQLITE_NOTADB)·11(SQLITE_CORRUPT) 또는 integrity_check 불합격만 손상이다.
// 잠김·권한 오류는 손상이 아니다 — 건강한 파일을 옆으로 미는 일이 절대 없어야 한다.
function isCorruptError(err) {
  if (err instanceof IntegrityCheckFailedError) return true;
  return !!err && (err.errcode === 26 || err.errcode === 11);
}

function quarantine(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  const name = `store.corrupt-${stamp}.sqlite`;
  const dir = path.dirname(file);
  for (const suffix of ['', '-wal', '-shm']) {
    const src = file + suffix;
    if (!fs.existsSync(src)) continue;
    try {
      fs.renameSync(src, path.join(dir, name + suffix));
    } catch {
      // 옆 파일 이동 실패는 본 파일 격리를 막지 않는다
    }
  }
  return name;
}

const now = () => new Date().toISOString();

// 달력 색은 상태색(성공·경고·실패)과 같은 값을 뒤로 미뤄 배정한다(D-09).
// 파랑 → 보라 → 하늘 → 초록 → 노랑 → 분홍.
export const COLOR_ORDER = [1, 3, 6, 2, 4, 5];

export function nextColor(used = []) {
  for (const c of COLOR_ORDER) if (!used.includes(c)) return c;
  // 여섯을 다 쓰면 가장 적게 쓰인 색을 다시 준다
  const count = new Map(COLOR_ORDER.map((c) => [c, 0]));
  for (const c of used) if (count.has(c)) count.set(c, count.get(c) + 1);
  return [...count.entries()].sort((a, b) => a[1] - b[1] || COLOR_ORDER.indexOf(a[0]) - COLOR_ORDER.indexOf(b[0]))[0][0];
}

export function createStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let db = null;
  const state = { ok: false, reason: null, quarantined: null };

  function open() {
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    checkIntegrity(db);
    migrate(db, file);
  }

  try {
    open();
    state.ok = true;
  } catch (err) {
    try {
      db?.close();
    } catch {}
    db = null;

    if (err instanceof NewerSchemaError) {
      // 여기서는 새로 만들지 않는다 — 최신 스키마 DB를 구버전 앱이 덮어쓰면 데이터를 잃는다
      state.reason = 'newer-schema';
      state.detail = err.message;
    } else if (isCorruptError(err)) {
      state.quarantined = quarantine(file);
      try {
        open();
        state.ok = true;
        state.reason = 'recovered';
      } catch (again) {
        state.reason = 'corrupt';
        state.detail = String(again?.message ?? again);
      }
    } else {
      state.reason = 'open-failed';
      state.detail = String(err?.message ?? err);
    }
  }

  const q = (sql) => db.prepare(sql);

  return {
    state,
    get ok() {
      return state.ok;
    },
    file,

    close() {
      try {
        db?.close();
      } catch {}
      db = null;
    },

    // ── 달력
    listCalendars() {
      return q('SELECT * FROM calendar ORDER BY id').all();
    },

    addCalendar({ kind, name, url = null, color = null }) {
      const used = q('SELECT color FROM calendar').all().map((r) => r.color);
      const c = color ?? nextColor(used);
      const info = q(
        'INSERT INTO calendar (kind, name, url, color, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(kind, name, url, c, now());
      return Number(info.lastInsertRowid);
    },

    // 직접 등록한 일정이 들어갈 곳. 없으면 만든다 — 첫 실행에 설정을 요구하지 않는다(PLAT-01).
    localCalendarId() {
      const row = q("SELECT id FROM calendar WHERE kind = 'local' ORDER BY id LIMIT 1").get();
      if (row) return row.id;
      return this.addCalendar({ kind: 'local', name: '이 PC', color: 1 });
    },

    // ── 일정
    addEvent({ calendarId, title, startsAt, endsAt = null, allDay = 0, location = null, note = null, uid = null, rrule = null }) {
      const t = now();
      const info = q(
        `INSERT INTO event (calendar_id, uid, title, starts_at, ends_at, all_day, location, note, rrule, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(calendarId, uid, title, startsAt, endsAt, allDay ? 1 : 0, location, note, rrule, t, t);
      return Number(info.lastInsertRowid);
    },

    // 범위와 겹치는 일정. 끝이 없는 일정은 시작만으로 판정한다.
    // 반복(rrule)은 아직 펼치지 않는다 — recur.mjs가 붙는 Phase 2의 일이다.
    //
    // 스네이크 케이스는 여기서 끝난다. SQL 컬럼명은 저장소의 내부 사정이고,
    // 밖으로 나가는 것은 clock.mjs가 그대로 먹을 수 있는 모양이어야 한다 —
    // 이 변환이 빠져 있어서 조회는 되는데 상태 계산이 통째로 비는 버그가 있었다.
    listBetween(fromISO, toISO) {
      return q(
        `SELECT e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.note,
                c.color AS color, c.name AS calendar_name, c.kind AS calendar_kind
           FROM event e JOIN calendar c ON c.id = e.calendar_id
          WHERE e.deleted_at IS NULL
            AND c.enabled = 1
            AND e.starts_at < ?
            AND COALESCE(e.ends_at, e.starts_at) > ?
          ORDER BY e.starts_at`
      )
        .all(toISO, fromISO)
        .map((r) => ({
          id: r.id,
          title: r.title,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          allDay: !!r.all_day,
          location: r.location,
          note: r.note,
          color: r.color,
          calendarName: r.calendar_name,
          calendarKind: r.calendar_kind,
        }));
    },

    softDeleteEvent(id) {
      q('UPDATE event SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
    },

    // 검증용 시드만 지운다(--seed 재실행). 소프트 삭제가 아니라 실제로 지운다 —
    // 쌓이면 검증이 흐려지고, 사람이 만든 일정이 아니라 지워도 잃을 것이 없다.
    clearSeed() {
      const info = q("DELETE FROM event WHERE uid LIKE 'seed-%'").run();
      return Number(info.changes ?? 0);
    },

    // 되돌리기(EV-06). 소프트 삭제라 지웠던 행을 되살리기만 하면 된다.
    restoreEvent(id) {
      q('UPDATE event SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
    },

    getEvent(id) {
      const r = q(
        `SELECT e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.note,
                c.color AS color, c.name AS calendar_name, c.kind AS calendar_kind
           FROM event e JOIN calendar c ON c.id = e.calendar_id WHERE e.id = ?`
      ).get(id);
      if (!r) return null;
      return {
        id: r.id,
        title: r.title,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        allDay: !!r.all_day,
        location: r.location,
        note: r.note,
        color: r.color,
        calendarName: r.calendar_name,
        calendarKind: r.calendar_kind,
      };
    },

    countEvents() {
      return q('SELECT count(*) AS n FROM event WHERE deleted_at IS NULL').get().n;
    },

    // ── 설정 (창 위치 같은 UI 상태는 settings.json, 여기는 앱 동작 값)
    getSetting(key, fallback = null) {
      const row = q('SELECT value FROM setting WHERE key = ?').get(key);
      return row ? JSON.parse(row.value) : fallback;
    },

    setSetting(key, value) {
      q('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
        key,
        JSON.stringify(value)
      );
    },
  };
}
