// main/ics.mjs — `.ics` 텍스트를 일정으로 읽는다 (SUB-01·SUB-07·SUB-08).
//
// 파싱만 하고 **반복은 펼치지 않는다.** RRULE은 원문 그대로 들고 나가고 펼치는 것은
// recur.mjs의 일이다(D-07) — 저장소에는 원문이 남아야 `.ics`가 바뀔 때 비교가 된다.
//
// Electron을 import하지 않는 순수 모듈이라 node --test로 검증한다.
import ICAL from 'ical.js';

// 구독 하나가 깨졌다고 나머지를 버리지 않는다. 읽은 만큼 돌려주고 못 읽은 것은 세어서 알린다.
export function parseIcs(text) {
  const events = [];
  const errors = [];

  let root;
  try {
    root = new ICAL.Component(ICAL.parse(String(text ?? '')));
  } catch (err) {
    return { ok: false, events, errors: [{ kind: 'parse', msg: String(err?.message ?? err) }], name: null };
  }

  // 달력 이름이 들어 있으면 쓴다 — 사용자가 URL만 붙여도 이름이 생긴다
  const name =
    root.getFirstPropertyValue('x-wr-calname') ??
    root.getFirstPropertyValue('name') ??
    null;

  for (const vevent of root.getAllSubcomponents('vevent')) {
    try {
      const e = readEvent(vevent);
      if (e) events.push(e);
    } catch (err) {
      errors.push({ kind: 'event', msg: String(err?.message ?? err) });
    }
  }

  return { ok: true, events, errors, name: name ? String(name) : null };
}

function readEvent(vevent) {
  const dtstart = vevent.getFirstPropertyValue('dtstart');
  if (!dtstart) return null;

  const dtend = vevent.getFirstPropertyValue('dtend');
  const duration = vevent.getFirstPropertyValue('duration');

  // 종일 일정은 DATE(시각 없음)로 온다. isDate가 그 표시다.
  const allDay = !!dtstart.isDate;

  let end = null;
  if (dtend) end = dtend;
  else if (duration) {
    end = dtstart.clone();
    end.addDuration(duration);
  }

  const rrule = vevent.getFirstPropertyValue('rrule');
  const exdates = vevent
    .getAllProperties('exdate')
    .flatMap((p) => p.getValues())
    .map((v) => toIso(v));

  // 반복 중 한 건만 바꾼 것. 원본 시각(RECURRENCE-ID)으로 어느 회차인지 가리킨다.
  const recId = vevent.getFirstPropertyValue('recurrence-id');

  return {
    uid: str(vevent.getFirstPropertyValue('uid')),
    title: str(vevent.getFirstPropertyValue('summary')) || '(제목 없음)',
    startsAt: toIso(dtstart),
    endsAt: end ? toIso(end) : null,
    allDay,
    tzid: dtstart.zone?.tzid ?? null,
    rrule: rrule ? rrule.toString() : null,
    exdates: exdates.length ? exdates : null,
    recurrenceId: recId ? toIso(recId) : null,
    location: str(vevent.getFirstPropertyValue('location')) || null,
    status: str(vevent.getFirstPropertyValue('status')) || null,
  };
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

// ICAL.Time → ISO8601. 종일(DATE)은 그 날 자정으로, 나머지는 실제 시각으로 옮긴다.
// toJSDate()가 VTIMEZONE·UTC를 이미 반영하므로 여기서 다시 계산하지 않는다(SUB-08).
export function toIso(t) {
  if (!t) return null;
  if (typeof t === 'string') return t;
  return t.toJSDate().toISOString();
}

// 취소된 일정은 화면에 세우지 않는다.
export function isCancelled(e) {
  return (e.status ?? '').toUpperCase() === 'CANCELLED';
}


// ── 내보내기 (DATA-03)
//
// 표준 형식이라 다른 캘린더가 읽는다. 받아온 구독 일정은 내보내지 않는다 — 원본이 따로 있다.

const pad = (n) => String(n).padStart(2, '0');

// 로컬 시각을 UTC 기본형으로. 종일 일정은 DATE(시각 없음)로 낸다.
function icsTime(iso, allDay) {
  const d = new Date(iso);
  if (allDay) return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const u = new Date(d.getTime());
  return (
    `${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}` +
    `T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}${pad(u.getUTCSeconds())}Z`
  );
}

// RFC 5545는 쉼표·세미콜론·역슬래시·줄바꿈을 이스케이프하라고 한다.
function esc(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// 75옥텟을 넘는 줄은 접어야 한다. 안 접으면 읽는 쪽이 줄을 잘라 버린다.
function fold(line) {
  if (line.length <= 73) return line;
  const out = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    out.push(' ' + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest) out.push(' ' + rest);
  return out.join('\r\n');
}

export function buildIcs(events, { name = 'WHENCALENDAR' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//when630//WHENCALENDAR//KO',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(name)}`,
  ];
  const stamp = icsTime(new Date().toISOString(), false);

  for (const e of events ?? []) {
    if (!e?.startsAt) continue;
    const uid = e.uid || `${e.id ?? Math.random().toString(36).slice(2)}@whencalendar`;
    lines.push('BEGIN:VEVENT', `UID:${esc(uid)}`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsTime(e.startsAt, true)}`);
      if (e.endsAt) lines.push(`DTEND;VALUE=DATE:${icsTime(e.endsAt, true)}`);
    } else {
      lines.push(`DTSTART:${icsTime(e.startsAt, false)}`);
      if (e.endsAt) lines.push(`DTEND:${icsTime(e.endsAt, false)}`);
    }
    lines.push(`SUMMARY:${esc(e.title ?? '')}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.note) lines.push(`DESCRIPTION:${esc(e.note)}`);
    if (e.rrule) lines.push(`RRULE:${String(e.rrule).replace(/^RRULE:/, '')}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
