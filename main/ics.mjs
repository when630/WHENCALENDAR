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
