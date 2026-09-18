// main/clock.mjs — "지금 몇 시고 다음이 뭔가"를 계산하는 단 하나의 자리(03_기술_스펙 §3).
//
// 오버레이와 본체 창이 각자 시각을 계산하면 둘이 어긋난다. 계산은 여기서만 하고 결과를 뿌린다.
// Electron을 import하지 않는 순수 모듈이라 node --test로 검증한다.

// 기본 임계값(초). 설정에서 덮어쓴다(OVL-12).
export const DEFAULTS = {
  revealStartSec: 30 * 60, // 펼치기 시작
  revealFullSec: 10 * 60, // 완전히 펼침
  urgeSec: 5 * 60, // 색이 붉어지고 번짐
  beatSec: 60, // 테두리 맥동
  ringSpanSec: 60 * 60, // 링 한 바퀴가 덮는 시간
  endSoonSec: 5 * 60, // 진행 중 — 곧 종료 (OVL-09)
  endSoonEnabled: true,
};

// 단계 이름. 색·두께가 아니라 "지금 얼마나 급한가"만 말한다 — 표현은 렌더러가 정한다.
export const TIERS = ['calm', 'faint', 'aware', 'alert', 'urge', 'beat'];

export function tierOf(leftSec, o = DEFAULTS) {
  if (leftSec > o.ringSpanSec) return 'calm';
  if (leftSec > o.revealStartSec) return 'faint';
  if (leftSec > o.revealFullSec) return 'aware';
  if (leftSec > o.urgeSec) return 'alert';
  if (leftSec > o.beatSec) return 'urge';
  return 'beat';
}

// 펼침 정도 0..1. revealStart에서 시작해 revealFull에서 1이 된다.
// 사이를 선형으로 잇는 이유는 단계가 바뀌는 순간 화면이 튀지 않게 하기 위해서다.
export function revealOf(leftSec, o = DEFAULTS) {
  if (leftSec > o.revealStartSec) return 0;
  if (leftSec <= o.revealFullSec) return 1;
  const span = o.revealStartSec - o.revealFullSec;
  if (span <= 0) return 1;
  return (o.revealStartSec - leftSec) / span;
}

// 링이 채워진 비율 0..1. upcoming은 남은 시간을, during은 남은 회의 시간을 센다.
function ratioUpcoming(leftSec, o) {
  return Math.max(0, Math.min(1, leftSec / o.ringSpanSec));
}
function ratioDuring(leftSec, spanSec) {
  if (!(spanSec > 0)) return 0;
  return Math.max(0, Math.min(1, leftSec / spanSec));
}

const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : v);

/**
 * 지금 시각에서 오버레이가 보여야 할 상태를 만든다.
 *
 * @param nowMs  기준 시각(ms)
 * @param events [{ id, title, startsAt, endsAt }] — ms·ISO·Date 아무거나. 정렬돼 있지 않아도 된다
 * @param opts   DEFAULTS를 덮어쓸 값
 */
export function stateAt(nowMs, events = [], opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const now = toMs(nowMs);

  // 종일 일정은 세지 않는다. 시각이 없으니 "몇 분 남았다"가 성립하지 않고, 자정부터 자정까지
  // 이어지는 탓에 **하루 종일 '진행 중'으로 잡혀 정작 다가오는 회의의 카운트다운을 덮어 버린다**
  // — 종일 일정이 하루만 있어도 OVL-05가 통째로 죽는다. 종일은 본체 창에서 본다(D-29).
  const list = events
    .filter((e) => !e.allDay)
    .map((e) => ({ ...e, _s: toMs(e.startsAt), _e: toMs(e.endsAt ?? e.startsAt) }))
    .filter((e) => Number.isFinite(e._s))
    .sort((a, b) => a._s - b._s);

  // 진행 중인 것이 여럿이면 먼저 끝나는 것을 잡는다 — 다음 행동을 요구하는 쪽이 그것이다.
  const during = list.filter((e) => now >= e._s && now < e._e).sort((a, b) => a._e - b._e)[0] ?? null;
  const rest = list.filter((e) => e._s > now);

  if (during) {
    const leftSec = (during._e - now) / 1000;
    const spanSec = (during._e - during._s) / 1000;
    const endingSoon = o.endSoonEnabled && leftSec <= o.endSoonSec;
    return {
      mode: 'during',
      event: during,
      leftSec,
      spanSec,
      ratio: ratioDuring(leftSec, spanSec),
      reveal: 1,
      tier: endingSoon ? tierOf(leftSec, o) : 'live',
      endingSoon,
      beat: leftSec <= o.beatSec,
      rest,
      next: rest[0] ?? null,
    };
  }

  if (rest.length === 0) {
    return {
      mode: 'idle',
      event: null,
      leftSec: 0,
      spanSec: 0,
      ratio: 0,
      reveal: 0,
      tier: 'calm',
      endingSoon: false,
      beat: false,
      rest: [],
      next: null,
    };
  }

  const ev = rest[0];
  const leftSec = (ev._s - now) / 1000;
  return {
    mode: 'upcoming',
    event: ev,
    leftSec,
    spanSec: (ev._e - ev._s) / 1000,
    ratio: ratioUpcoming(leftSec, o),
    reveal: revealOf(leftSec, o),
    tier: tierOf(leftSec, o),
    endingSoon: false,
    beat: leftSec <= o.beatSec,
    rest,
    next: rest[1] ?? null,
  };
}

// 다음으로 화면이 바뀌어야 하는 시각까지 남은 ms. 틱 주기를 줄이는 데 쓴다.
// 1초마다 무조건 그리지 않고, 실제로 바뀔 때까지 기다린다.
export function msUntilNextChange(nowMs, events = [], opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const st = stateAt(nowMs, events, o);
  if (st.mode === 'idle') return null;

  const marks =
    st.mode === 'during'
      ? [o.endSoonSec, o.beatSec, 0]
      : [o.ringSpanSec, o.revealStartSec, o.revealFullSec, o.urgeSec, o.beatSec, 0];

  // 초 단위 숫자가 바뀌는 것도 화면 변화다 — 펼쳐져 있으면 1초, 아니면 다음 경계까지.
  if (st.reveal > 0) return 1000;

  let best = null;
  for (const m of marks) {
    const d = (st.leftSec - m) * 1000;
    if (d > 0 && (best === null || d < best)) best = d;
  }
  return best === null ? 1000 : Math.max(250, Math.min(best, 60_000));
}


// ── 알림 (EV-08)
//
// 기본은 오버레이 단계 변화다. OS 알림은 설정에서 켠 사람에게만, 일정마다 한 번만 간다.
//
// "지금이 알릴 때인가"는 순수 계산이라 여기 둔다 — 실제로 알림을 띄우는 것은 lifecycle의 일이다.

export const REMIND_CHOICES = [null, 5, 10, 15, 30, 60];

/**
 * 지금 알려야 할 일정을 고른다.
 *
 * @param sent 이미 알린 열쇠들(Set). 같은 일정을 두 번 알리지 않기 위해 호출한 쪽이 들고 있는다.
 * @returns [{ key, event, leftSec }]
 */
export function dueReminders(nowMs, events = [], { defaultMin = null, sent = new Set() } = {}) {
  // stateAt과 같은 변환을 쓴다 — ms·ISO·Date 아무거나 받는다.
  // Date.parse만 쓰면 ms 숫자가 NaN이 되어 알림이 통째로 조용해진다.
  const now = toMs(nowMs);
  const out = [];

  for (const ev of events) {
    // 종일 일정은 알리지 않는다 — 자정 기준이라 "10분 전"이 전날 23:50에 울린다(D-29)
    if (ev.allDay) continue;

    const min = ev.remindMin ?? defaultMin;
    if (!min) continue;

    const start = toMs(ev.startsAt);
    if (!Number.isFinite(start)) continue;

    const leftSec = (start - now) / 1000;
    // 이미 시작한 일정은 알리지 않는다 — 늦은 알림은 도움이 안 되고 성가시기만 하다
    if (leftSec <= 0) continue;
    if (leftSec > min * 60) continue;

    // 회차마다 따로 센다. 반복 일정이 한 번 알렸다고 다음 주에 안 알리면 안 된다.
    const key = `${ev.id ?? ev.uid ?? ev.title}@${ev.recurrenceId ?? ev.startsAt}`;
    if (sent.has(key)) continue;
    out.push({ key, event: ev, leftSec });
  }
  return out;
}

// 알림 문구. 몇 분 남았는지를 제목보다 먼저 말한다.
export function remindText(ev, leftSec) {
  const m = Math.max(1, Math.round(leftSec / 60));
  return { title: `${m}분 뒤 · ${ev.title}`, body: ev.location ? `${ev.location}` : '' };
}
