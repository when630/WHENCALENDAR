// main/free.mjs — 빈 시간 찾기와 가능 시간 문구 (FIND-01~FIND-06).
//
// "다음 주에 2시간 연속으로 비는 데"는 할 일 앱이 원리적으로 답할 수 없는 질문이고,
// 캘린더를 따로 만드는 이유에 가장 가깝다.
//
// 내보내는 문구에 **일정 제목을 넣지 않는다**(FIND-05). 상대에게 "13:00 김부장 미팅"이
// 새어 나가면 안 된다. 빈 시간만 적는다.
//
// Electron을 import하지 않는 순수 모듈이라 node --test로 검증한다.

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const MS = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

export const DEFAULT_OPTS = {
  minMinutes: 60,
  workStartHour: 9,
  workEndHour: 18,
  workdaysOnly: true, // 주말은 빼고 본다
  anyTime: false, // true면 업무 시간 제한 없이 하루 전체
  maxSlots: 12,
  bufferMinutes: 0, // 앞뒤 일정에 붙여 잡지 않으려면 늘린다
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/**
 * 범위 안에서 비어 있는 구간을 찾는다.
 *
 * @param events 이미 펼쳐진 일정들 (반복은 recur가 펼친 뒤)
 * @returns [{ from, to, minutes, beforeTitle, afterTitle }] — 제목은 화면에서만 쓰고 복사에는 넣지 않는다
 */
export function findFreeSlots(events, from, to, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const out = [];
  const fromMs = MS(from);
  const toMs = MS(to);
  if (!(toMs > fromMs)) return out;

  // 종일 일정은 그 날을 통째로 막는다 — 휴가에 회의를 잡을 수는 없다
  const busy = (events ?? [])
    .map((e) => {
      const s = MS(e.startsAt);
      const t = e.endsAt ? MS(e.endsAt) : s;
      return { s, e: Math.max(t, s), title: e.title, allDay: !!e.allDay };
    })
    .filter((b) => Number.isFinite(b.s))
    .sort((a, b) => a.s - b.s);

  for (let day = startOfDay(new Date(fromMs)); day.getTime() < toMs; day = addDays(day, 1)) {
    const dow = day.getDay();
    if (o.workdaysOnly && (dow === 0 || dow === 6)) continue;

    const dayStart = o.anyTime
      ? day.getTime()
      : new Date(day.getFullYear(), day.getMonth(), day.getDate(), o.workStartHour).getTime();
    const dayEnd = o.anyTime
      ? addDays(day, 1).getTime()
      : new Date(day.getFullYear(), day.getMonth(), day.getDate(), o.workEndHour).getTime();

    let cursor = Math.max(dayStart, fromMs);
    const limit = Math.min(dayEnd, toMs);
    if (cursor >= limit) continue;

    // 그날 겹치는 일정만 추려 시간순으로 훑는다
    const todays = busy.filter((b) => b.s < limit && b.e > cursor);
    let blockedAllDay = false;
    let before = null;

    for (const b of todays) {
      if (b.allDay) {
        blockedAllDay = true;
        break;
      }
      if (b.s > cursor) {
        pushSlot(out, cursor, Math.min(b.s, limit), before, b.title, o);
      }
      if (b.e > cursor) {
        cursor = b.e;
        before = b.title;
      }
      if (cursor >= limit) break;
    }
    if (blockedAllDay) continue;
    if (cursor < limit) pushSlot(out, cursor, limit, before, null, o);
  }

  return out.slice(0, o.maxSlots);
}

function pushSlot(out, s, e, beforeTitle, afterTitle, o) {
  const from = s + o.bufferMinutes * 60_000;
  const to = e - o.bufferMinutes * 60_000;
  const minutes = Math.floor((to - from) / 60_000);
  if (minutes < o.minMinutes) return;
  out.push({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    minutes,
    beforeTitle: beforeTitle ?? null,
    afterTitle: afterTitle ?? null,
  });
}

// ── 내보낼 문구 (FIND-04·FIND-06)

const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function dayLabel(d) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}

export function formatSlot(slot) {
  const s = new Date(slot.from);
  const e = new Date(slot.to);
  return `${dayLabel(s)} ${hm(s)} – ${hm(e)}`;
}

/**
 * 고른 빈 시간을 클립보드에 넣을 글로 만든다.
 *
 * **일정 제목은 절대 들어가지 않는다**(FIND-05). 이 함수는 slot의 from·to만 읽는다.
 */
export function formatSlots(slots, { style = 'list', polite = true, tail = true } = {}) {
  const lines = (slots ?? []).map(formatSlot);
  if (!lines.length) return '';

  if (style === 'sentence') {
    const joined = lines.join(', ');
    return polite
      ? `안녕하세요, ${joined} 중에 편하신 때를 알려주시면 맞추겠습니다.`
      : `${joined} 중에 편한 때 알려줘.`;
  }

  if (style === 'table') {
    const rows = (slots ?? []).map((s) => {
      const d = new Date(s.from);
      return `| ${dayLabel(d)} | ${hm(d)} – ${hm(new Date(s.to))} |`;
    });
    return ['| 날짜 | 시간 |', '|---|---|', ...rows].join('\n');
  }

  const head = polite ? '안녕하세요, 아래 시간 중에 편하신 때를 알려주시면 맞추겠습니다.' : '아래 시간 중에 편한 때 알려줘.';
  const body = lines.map((l) => `• ${l}`).join('\n');
  const foot = tail ? (polite ? '\n\n감사합니다.' : '') : '';
  return `${head}\n\n${body}${foot}`;
}
