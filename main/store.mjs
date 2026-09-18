// main/store.mjs — node:sqlite 단일 파일 저장소. 열기·손상 판정·마이그레이션·백업 체계는
// WHENNOTE main/store.mjs에서 그대로 가져왔고(STOR-02·STOR-03 승계), 스키마와 CRUD만 일정용이다.
//
// DatabaseSync는 동기 API라 이 파일의 모든 함수도 동기다. Electron을 import하지 않는 순수
// Node 모듈이라 node --test로 검증한다.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { expand } from './recur.mjs';
import { matches } from './search.mjs';

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

// 내보내기 형식 버전. 읽을 수 없는 파일로 기존 데이터를 지우는 일이 없어야 한다.
export const EXPORT_VERSION = 1;

export function validateExport(data) {
  if (!data || typeof data !== 'object') return '읽을 수 있는 JSON이 아닙니다.';
  if (data.app !== 'whencalendar') return 'WHENCALENDAR가 내보낸 파일이 아닙니다.';
  if (!Number.isInteger(data.version)) return '형식 버전이 없습니다.';
  if (data.version > EXPORT_VERSION) {
    return `더 새로운 버전(v${data.version})의 파일입니다. 앱을 먼저 업데이트해 주세요.`;
  }
  if (!Array.isArray(data.calendars) || !Array.isArray(data.events)) return '달력·일정 목록이 없습니다.';
  for (const e of data.events) {
    if (!e || typeof e.title !== 'string' || !e.startsAt) return '일정 하나가 제목이나 시작 시각을 잃었습니다.';
    if (!Number.isFinite(Date.parse(e.startsAt))) return `읽을 수 없는 시각이 있습니다: ${e.startsAt}`;
  }
  return null;
}

// 밖으로 나가는 일정의 모양. SQL 컬럼명은 여기서 끝난다(D-15).
const EVENT_COLS = `e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.note,
                    e.rrule, e.exdates, e.uid,
                    c.id AS cal_id, c.color AS color, c.name AS calendar_name, c.kind AS calendar_kind`;

function toDomain(r) {
  return {
    id: r.id,
    uid: r.uid,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    allDay: !!r.all_day,
    location: r.location,
    note: r.note,
    rrule: r.rrule,
    exdates: r.exdates ? JSON.parse(r.exdates) : null,
    calendarId: r.cal_id,
    color: r.color,
    calendarName: r.calendar_name,
    calendarKind: r.calendar_kind,
  };
}

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
      // 반복 일정은 시작 시각이 범위보다 한참 앞이라 SQL 범위 조건으로는 걸리지 않는다.
      // 그래서 두 번에 나눠 가져온다 — 범위와 겹치는 단발 일정, 그리고 반복 규칙이 있는 것 전부.
      // 후자는 recur.expand가 범위만큼만 펼친다(D-07).
      const plain = q(
        `SELECT ${EVENT_COLS}
           FROM event e JOIN calendar c ON c.id = e.calendar_id
          WHERE e.deleted_at IS NULL AND c.enabled = 1 AND e.rrule IS NULL
            AND e.starts_at < ? AND COALESCE(e.ends_at, e.starts_at) > ?`
      )
        .all(toISO, fromISO)
        .map(toDomain);

      const repeating = q(
        `SELECT ${EVENT_COLS}
           FROM event e JOIN calendar c ON c.id = e.calendar_id
          WHERE e.deleted_at IS NULL AND c.enabled = 1 AND e.rrule IS NOT NULL
            AND e.starts_at < ?`
      )
        .all(toISO)
        .map(toDomain)
        .map((ev) => ({ ...ev, overrides: this.listOverrides(ev.id) }));

      return [...plain, ...expand(repeating, fromISO, toISO)].sort(
        (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)
      );
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

    // ── 구독 (SUB)
    updateCalendar(id, patch) {
      const cols = {
        name: 'name',
        url: 'url',
        color: 'color',
        enabled: 'enabled',
        lastSyncAt: 'last_sync_at',
        lastError: 'last_error',
        etag: 'etag',
      };
      const sets = [];
      const vals = [];
      for (const [k, col] of Object.entries(cols)) {
        if (!(k in patch)) continue;
        sets.push(`${col} = ?`);
        vals.push(typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : patch[k]);
      }
      if (!sets.length) return;
      q(`UPDATE calendar SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    },

    // 구독을 지우면 그 일정도 함께 사라진다. 직접 등록한 것은 다른 달력에 있으므로 남는다(STOR-04).
    deleteCalendar(id) {
      withTransaction(db, () => {
        q('DELETE FROM event WHERE calendar_id = ?').run(id);
        q('DELETE FROM calendar WHERE id = ?').run(id);
      });
    },

    /**
     * 구독에서 받아온 일정으로 그 달력을 통째로 맞춘다 (SUB-02).
     *
     * 구독은 원격이 진실이다 — 여기 있고 저기 없는 것은 지운다. 다만 **이 함수가 불리는 것 자체가
     * 성공적으로 받아왔다는 뜻**이어야 한다. 실패했을 때 빈 배열로 부르면 일정이 전부 사라진다(SUB-03).
     */
    replaceCalendarEvents(calendarId, incoming) {
      const t = now();
      return withTransaction(db, () => {
        const before = q('SELECT uid, source_hash FROM event WHERE calendar_id = ?').all(calendarId);
        const seen = new Set();
        let added = 0;
        let updated = 0;

        const ins = q(
          `INSERT INTO event (calendar_id, uid, title, starts_at, ends_at, all_day, tzid, rrule, exdates,
                              location, source_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const upd = q(
          `UPDATE event SET title = ?, starts_at = ?, ends_at = ?, all_day = ?, tzid = ?, rrule = ?,
                            exdates = ?, location = ?, source_hash = ?, deleted_at = NULL, updated_at = ?
            WHERE calendar_id = ? AND uid = ?`
        );

        const known = new Map(before.map((r) => [r.uid, r.source_hash]));

        for (const e of incoming) {
          const uid = e.uid || `${e.title}@${e.startsAt}`;
          if (seen.has(uid)) continue; // 같은 uid가 두 번 오면(수정 회차 등) 첫 것만
          seen.add(uid);

          const ex = e.exdates ? JSON.stringify(e.exdates) : null;
          const hash = [e.title, e.startsAt, e.endsAt, e.allDay, e.rrule, ex, e.location].join('|');
          if (!known.has(uid)) {
            ins.run(calendarId, uid, e.title, e.startsAt, e.endsAt, e.allDay ? 1 : 0, e.tzid ?? null,
                    e.rrule ?? null, ex, e.location ?? null, hash, t, t);
            added++;
          } else if (known.get(uid) !== hash) {
            upd.run(e.title, e.startsAt, e.endsAt, e.allDay ? 1 : 0, e.tzid ?? null, e.rrule ?? null,
                    ex, e.location ?? null, hash, t, calendarId, uid);
            updated++;
          }
        }

        // 원격에서 사라진 것은 여기서도 지운다
        let removed = 0;
        const del = q('DELETE FROM event WHERE calendar_id = ? AND uid = ?');
        for (const r of before) {
          if (!seen.has(r.uid)) {
            del.run(calendarId, r.uid);
            removed++;
          }
        }
        return { added, updated, removed, total: seen.size };
      });
    },

    // 제목으로 찾는다 (SRCH). 지난 일정도 함께 본다 — 실제 쓰임이 "그 회의 언제였지"다.
    // 반복 일정은 펼치지 않고 원본 한 줄로 낸다. 회차마다 같은 제목이 수십 줄 서면 못 읽는다.
    searchEvents(query, limit = 80) {
      if (!String(query ?? '').trim()) return [];
      return q(
        `SELECT ${EVENT_COLS}
           FROM event e JOIN calendar c ON c.id = e.calendar_id
          WHERE e.deleted_at IS NULL AND c.enabled = 1`
      )
        .all()
        .map(toDomain)
        .filter((e) => matches(e.title, query))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .slice(0, limit);
    },

    /**
     * 일정을 고친다 (EV-05).
     *
     * 구독으로 들어온 일정은 고칠 수 없다 — 다음 갱신에 원격 값으로 덮여 되돌아가므로,
     * 고쳐지는 척하는 것이 더 나쁘다. 호출한 쪽이 알 수 있게 false를 돌려준다.
     */
    updateEvent(id, patch) {
      const row = q('SELECT e.id, c.kind FROM event e JOIN calendar c ON c.id = e.calendar_id WHERE e.id = ?').get(id);
      if (!row) return false;
      if (row.kind === 'subscription') return false;

      const cols = {
        title: 'title',
        startsAt: 'starts_at',
        endsAt: 'ends_at',
        allDay: 'all_day',
        location: 'location',
        note: 'note',
        remindMin: 'remind_min',
        rrule: 'rrule',
        calendarId: 'calendar_id',
      };
      const sets = [];
      const vals = [];
      for (const [k, col] of Object.entries(cols)) {
        if (!(k in patch)) continue;
        sets.push(`${col} = ?`);
        vals.push(typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : patch[k]);
      }
      if (!sets.length) return true;
      sets.push('updated_at = ?');
      vals.push(now());
      q(`UPDATE event SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      return true;
    },

    // ── 반복 일정의 회차 다루기 (EV-07)
    listOverrides(eventId) {
      return q('SELECT * FROM override WHERE event_id = ?')
        .all(eventId)
        .map((r) => ({
          recurrenceId: r.recurrence_id,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          title: r.title,
          cancelled: !!r.cancelled,
        }));
    },

    // 이 회차만 고친다. 규칙은 그대로 두고 예외를 하나 남기는 것이 RFC 5545 방식이다.
    setOverride(eventId, recurrenceId, patch) {
      const ev = q('SELECT e.id, c.kind FROM event e JOIN calendar c ON c.id = e.calendar_id WHERE e.id = ?').get(eventId);
      if (!ev || ev.kind === 'subscription') return false;
      q(
        `INSERT INTO override (event_id, recurrence_id, starts_at, ends_at, title, cancelled)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id, recurrence_id) DO UPDATE SET
           starts_at = COALESCE(excluded.starts_at, override.starts_at),
           ends_at   = COALESCE(excluded.ends_at,   override.ends_at),
           title     = COALESCE(excluded.title,     override.title),
           cancelled = excluded.cancelled`
      ).run(
        eventId,
        recurrenceId,
        patch.startsAt ?? null,
        patch.endsAt ?? null,
        patch.title ?? null,
        patch.cancelled ? 1 : 0
      );
      return true;
    },

    // 이 회차만 뺀다. EXDATE에 넣는 것과 같다 — 표준으로 내보낼 때 그대로 나간다.
    excludeOccurrence(eventId, recurrenceId) {
      const row = q('SELECT e.exdates, c.kind FROM event e JOIN calendar c ON c.id = e.calendar_id WHERE e.id = ?').get(eventId);
      if (!row || row.kind === 'subscription') return false;
      const list = row.exdates ? JSON.parse(row.exdates) : [];
      if (!list.includes(recurrenceId)) list.push(recurrenceId);
      q('UPDATE event SET exdates = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(list), now(), eventId);
      return true;
    },

    /**
     * 이 회차부터 뒤를 끊는다 (EV-07).
     *
     * 규칙에 UNTIL을 박아 **직전 회차까지만** 살린다. 회차들을 하나씩 지우지 않는 이유는,
     * 그러면 규칙과 실제가 갈라져 `.ics`로 내보낼 때 원래 규칙이 그대로 나가기 때문이다.
     */
    truncateSeries(eventId, fromRecurrenceId) {
      const row = q('SELECT e.rrule, c.kind FROM event e JOIN calendar c ON c.id = e.calendar_id WHERE e.id = ?').get(eventId);
      if (!row || row.kind === 'subscription' || !row.rrule) return false;

      const until = new Date(Date.parse(fromRecurrenceId) - 1000);
      const stamp =
        `${until.getUTCFullYear()}${String(until.getUTCMonth() + 1).padStart(2, '0')}${String(until.getUTCDate()).padStart(2, '0')}` +
        `T${String(until.getUTCHours()).padStart(2, '0')}${String(until.getUTCMinutes()).padStart(2, '0')}${String(until.getUTCSeconds()).padStart(2, '0')}Z`;

      const cleaned = String(row.rrule)
        .replace(/^RRULE:/, '')
        .split(';')
        .filter((part) => !/^(UNTIL|COUNT)=/.test(part))
        .join(';');

      q('UPDATE event SET rrule = ?, updated_at = ? WHERE id = ?').run(`${cleaned};UNTIL=${stamp}`, now(), eventId);
      return true;
    },

    // 되돌리기(EV-06). 소프트 삭제라 지웠던 행을 되살리기만 하면 된다.
    restoreEvent(id) {
      q('UPDATE event SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
    },

    getEvent(id) {
      const r = q(`SELECT ${EVENT_COLS} FROM event e JOIN calendar c ON c.id = e.calendar_id WHERE e.id = ?`).get(id);
      return r ? toDomain(r) : null;
    },

    countEvents() {
      return q('SELECT count(*) AS n FROM event WHERE deleted_at IS NULL').get().n;
    },

    // ── 내보내기·가져오기 (DATA)
    //
    // 사람이 읽을 수 있는 JSON 하나로 낸다. 구독은 주소와 색만 담고 받아온 일정은 담지 않는다 —
    // 어차피 다음 갱신에 원격에서 다시 온다. 담으면 파일만 커지고 원본과 어긋난다.
    exportAll() {
      const cals = q('SELECT * FROM calendar ORDER BY id').all();
      const local = new Set(cals.filter((c) => c.kind === 'local').map((c) => c.id));
      const events = q('SELECT * FROM event WHERE deleted_at IS NULL ORDER BY id')
        .all()
        .filter((e) => local.has(e.calendar_id));
      const settings = Object.fromEntries(q('SELECT key, value FROM setting').all().map((r) => [r.key, JSON.parse(r.value)]));
      return {
        app: 'whencalendar',
        version: EXPORT_VERSION,
        exportedAt: now(),
        calendars: cals.map((c) => ({
          kind: c.kind,
          name: c.name,
          url: c.url,
          color: c.color,
          enabled: !!c.enabled,
        })),
        events: events.map((e) => ({
          calendarName: cals.find((c) => c.id === e.calendar_id)?.name ?? '이 PC',
          title: e.title,
          startsAt: e.starts_at,
          endsAt: e.ends_at,
          allDay: !!e.all_day,
          rrule: e.rrule,
          exdates: e.exdates ? JSON.parse(e.exdates) : null,
          location: e.location,
          note: e.note,
          remindMin: e.remind_min,
        })),
        settings,
      };
    },

    /**
     * 내보낸 JSON으로 되돌린다 (DATA-02).
     *
     * **지금 데이터를 갈아끼운다.** 그래서 부르기 전에 호출한 쪽이 백업을 남긴다.
     * 형식이 아니면 아무것도 건드리지 않고 돌아간다 — 반쯤 들어간 상태가 제일 나쁘다.
     */
    importAll(data) {
      const bad = validateExport(data);
      if (bad) return { ok: false, error: bad };

      return withTransaction(db, () => {
        q('DELETE FROM override').run();
        q('DELETE FROM event').run();
        q('DELETE FROM calendar').run();
        q('DELETE FROM setting').run();

        const byName = new Map();
        for (const c of data.calendars ?? []) {
          const info = q(
            'INSERT INTO calendar (kind, name, url, color, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(c.kind, c.name, c.url ?? null, c.color ?? 1, c.enabled === false ? 0 : 1, now());
          byName.set(c.name, Number(info.lastInsertRowid));
        }
        // 직접 등록용 달력이 없으면 만든다 — 가져온 일정이 갈 곳이 필요하다
        let localId = [...byName.entries()].find(([, id]) =>
          (data.calendars ?? []).find((c) => c.name === [...byName.keys()].find((k) => byName.get(k) === id))?.kind === 'local'
        )?.[1];
        if (!localId) {
          const info = q('INSERT INTO calendar (kind, name, color, created_at) VALUES (?, ?, ?, ?)').run(
            'local', '이 PC', 1, now()
          );
          localId = Number(info.lastInsertRowid);
        }

        let added = 0;
        for (const e of data.events ?? []) {
          const t = now();
          q(
            `INSERT INTO event (calendar_id, title, starts_at, ends_at, all_day, rrule, exdates, location, note, remind_min, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            byName.get(e.calendarName) ?? localId,
            e.title,
            e.startsAt,
            e.endsAt ?? null,
            e.allDay ? 1 : 0,
            e.rrule ?? null,
            e.exdates ? JSON.stringify(e.exdates) : null,
            e.location ?? null,
            e.note ?? null,
            e.remindMin ?? null,
            t,
            t
          );
          added++;
        }

        for (const [k, v] of Object.entries(data.settings ?? {})) {
          q('INSERT INTO setting (key, value) VALUES (?, ?)').run(k, JSON.stringify(v));
        }
        return { ok: true, calendars: (data.calendars ?? []).length, events: added };
      });
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
