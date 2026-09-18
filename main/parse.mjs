// main/parse.mjs — 한 줄로 받은 일정을 해석한다 (EV-01).
//
// 문서에는 chrono 위에 한국어를 얹는다고 썼는데, 실제로 짜 보니 그럴 이유가 없었다(D-17).
// 의존성 없이 여기서 끝난다. Electron을 import하지 않는 순수 모듈이라 node --test로 검증한다.
//
// 해석한 결과를 바로 등록하지 않는다. 무엇을 어떻게 읽었는지 돌려주고, 애매한 것은 notes에
// 담아 화면이 되묻게 한다(EV-02) — 잘못 읽은 채로 조용히 들어가는 것이 가장 나쁘다.

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const REL_DAY = [
  [/(그저께|그제)/, -2],
  [/어제/, -1],
  [/오늘/, 0],
  [/(내일|낼)/, 1],
  [/모레/, 2],
  [/글피/, 3],
];

// "담주"·"차주"는 사전에 없는 말이지만 실제로 이렇게 쓴다
const WEEK_OFFSET = [
  [/(다다음\s*주|다다음주)/, 2],
  [/(다음\s*주|다음주|담주|차주)/, 1],
  [/(이번\s*주|이번주|금주)/, 0],
  [/(지난\s*주|지난주|저번\s*주)/, -1],
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// 그 주의 월요일. 한국에서 주는 월요일에 시작한다.
function mondayOf(d) {
  const x = startOfDay(d);
  const dow = x.getDay(); // 0=일
  return addDays(x, dow === 0 ? -6 : 1 - dow);
}

function cut(text, re) {
  const m = text.match(re);
  if (!m) return { text, hit: null };
  return { text: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(), hit: m };
}

// ── 반복 (EV-07)
//
// 날짜보다 **먼저** 떼어낸다. "매주 화 3시"에서 takeDate가 "화"를 먼저 먹으면 그냥 이번 주
// 화요일 한 건이 되고 반복이라는 사실이 사라진다.
const DOW_RRULE = { 일: 'SU', 월: 'MO', 화: 'TU', 수: 'WE', 목: 'TH', 금: 'FR', 토: 'SA' };

function takeRepeat(text, now) {
  const m = text.match(/(매일|날마다|매주|주마다|격주|매달|매월|달마다|매년|해마다)\s*([월화수목금토일])?\s*요?일?/);
  if (!m) return { text, rrule: null, date: null };

  const word = m[1];
  const dow = m[2] ?? null;
  const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();

  // 며칠인지 따로 말했으면(매달 15일) 그것도 규칙에 넣는다
  let monthDay = null;
  const dm = rest.match(/(\d{1,2})\s*일(?!\s*간)/);

  let rrule = null;
  let date = null;

  if (/매일|날마다/.test(word)) {
    rrule = 'FREQ=DAILY';
  } else if (/매주|주마다|격주/.test(word)) {
    const every2 = word === '격주';
    rrule = `FREQ=WEEKLY${every2 ? ';INTERVAL=2' : ''}${dow ? `;BYDAY=${DOW_RRULE[dow]}` : ''}`;
  } else if (/매달|매월|달마다/.test(word)) {
    if (dm) monthDay = Number(dm[1]);
    rrule = `FREQ=MONTHLY${monthDay ? `;BYMONTHDAY=${monthDay}` : ''}`;
  } else {
    rrule = 'FREQ=YEARLY';
  }

  // 시작일 — 요일을 말했으면 가장 가까운 그 요일부터
  if (dow) {
    const target = WEEK.indexOf(dow);
    date = addDays(startOfDay(now), (target - now.getDay() + 7) % 7);
  } else if (monthDay) {
    const d = new Date(now.getFullYear(), now.getMonth(), monthDay);
    date = d < startOfDay(now) ? new Date(now.getFullYear(), now.getMonth() + 1, monthDay) : d;
  }

  const cleaned = monthDay ? rest.replace(dm[0], ' ').replace(/\s+/g, ' ').trim() : rest;
  return { text: cleaned, rrule, date };
}

// ── 날짜
function takeDate(text, now) {
  const notes = [];
  let date = null;

  // 9/23 · 9월 23일 · 23일
  let r = cut(text, /(?:^|\s)(\d{1,2})\s*[/.]\s*(\d{1,2})(?=\s|$)/);
  if (r.hit) {
    const [, mo, dd] = r.hit;
    const y = now.getFullYear();
    date = new Date(y, Number(mo) - 1, Number(dd));
    // 이미 지난 날짜면 내년으로 본다 — 12월에 "1/5"라고 쓰면 다음 해다
    if (date < startOfDay(now)) date = new Date(y + 1, Number(mo) - 1, Number(dd));
    return { text: r.text, date, notes };
  }

  r = cut(text, /(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (r.hit) {
    const [, mo, dd] = r.hit;
    const y = now.getFullYear();
    date = new Date(y, Number(mo) - 1, Number(dd));
    if (date < startOfDay(now)) date = new Date(y + 1, Number(mo) - 1, Number(dd));
    return { text: r.text, date, notes };
  }

  // 주 오프셋 + 요일 ("다음주 화", "이번주 금요일")
  let weekOff = null;
  let rest = text;
  for (const [re, off] of WEEK_OFFSET) {
    const c = cut(rest, re);
    if (c.hit) {
      weekOff = off;
      rest = c.text;
      break;
    }
  }

  const dowHit = rest.match(/(?:^|\s)([월화수목금토일])요?일?(?=\s|$)/);
  if (dowHit) {
    const target = WEEK.indexOf(dowHit[1]);
    rest = (rest.slice(0, dowHit.index) + ' ' + rest.slice(dowHit.index + dowHit[0].length)).replace(/\s+/g, ' ').trim();
    const base = mondayOf(now);
    const offsetInWeek = target === 0 ? 6 : target - 1; // 월=0 … 일=6
    if (weekOff === null) {
      // 요일만 말했으면 가장 가까운 앞으로의 그 요일이다 — 오늘이면 오늘
      let d = addDays(startOfDay(now), (target - now.getDay() + 7) % 7);
      date = d;
    } else {
      date = addDays(base, weekOff * 7 + offsetInWeek);
    }
    return { text: rest, date, notes };
  }

  if (weekOff !== null) {
    // 요일 없이 "다음주"만 — 그 주 월요일로 본다
    date = addDays(mondayOf(now), weekOff * 7);
    notes.push({ field: 'date', msg: `요일이 없어 ${weekOff > 0 ? '다음 주' : '이번 주'} 월요일로 봤습니다` });
    return { text: rest, date, notes };
  }

  // 오늘·내일·모레
  for (const [re, off] of REL_DAY) {
    const c = cut(text, re);
    if (c.hit) return { text: c.text, date: addDays(startOfDay(now), off), notes };
  }

  return { text, date: null, notes };
}

// ── 시각
//
// 오전·저녁 같은 말은 **시각 바로 앞에 붙었을 때만** 떼어낸다.
//   "저녁 7시 회식"     → 저녁은 시각 힌트다. 떼어내야 제목이 "회식"이 된다
//   "8시반 저녁 약속"   → 저녁은 제목의 일부다. 떼어내면 제목이 "약속"이 되어 버린다
// 둘 다 시각 해석에는 쓰되, 제거는 앞에 붙은 경우만 한다.
const AMPM_AM = '오전|아침|새벽';
const AMPM_PM = '오후|저녁|밤';
const HHMM_KO = String.raw`(\d{1,2})\s*시(?!\s*간)\s*(?:(\d{1,2})\s*분|(반))?`;
const HHMM_COLON = String.raw`(\d{1,2}):(\d{2})`;

function ampmOf(word) {
  return new RegExp(AMPM_AM).test(word) ? 'am' : 'pm';
}

function takeTime(text) {
  const notes = [];
  const drop = (t, m) => (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();

  const named = cut(text, /(정오|자정)/);
  if (named.hit) {
    const h = named.hit[1] === '정오' ? 12 : 0;
    return { text: named.text, h, m: 0, notes, explicit: true };
  }

  // 1) 오전/오후가 시각 바로 앞에 붙은 형태 — 둘 다 떼어낸다
  let m = text.match(new RegExp(String.raw`(${AMPM_AM}|${AMPM_PM})\s*${HHMM_KO}`));
  if (m) {
    const h = Number(m[2]);
    const mm = m[4] ? 30 : m[3] ? Number(m[3]) : 0;
    return { text: drop(text, m), h: applyAmPm(h, ampmOf(m[1]), notes), m: mm, notes, explicit: true };
  }
  m = text.match(new RegExp(String.raw`(${AMPM_AM}|${AMPM_PM})\s*${HHMM_COLON}`));
  if (m) {
    const h = Number(m[2]);
    const mm = Number(m[3]);
    if (h <= 23 && mm <= 59) {
      return { text: drop(text, m), h: applyAmPm(h, ampmOf(m[1]), notes), m: mm, notes, explicit: true };
    }
  }

  // 2) 시각만 있는 형태 — 시각만 떼고, 오전/오후는 문장 어디에 있든 힌트로만 쓴다
  const loose = text.match(new RegExp(`(${AMPM_AM})`)) ? 'am' : text.match(new RegExp(`(${AMPM_PM})`)) ? 'pm' : null;

  m = text.match(new RegExp(HHMM_KO));
  if (m) {
    const h = Number(m[1]);
    const mm = m[3] ? 30 : m[2] ? Number(m[2]) : 0;
    return { text: drop(text, m), h: applyAmPm(h, loose, notes), m: mm, notes, explicit: true };
  }

  // 분은 두 자리여야 한다. "1:1 미팅"을 시각으로 먹지 않기 위해서다.
  m = text.match(new RegExp(String.raw`(?:^|\s)` + HHMM_COLON + String.raw`(?=\s|$)`));
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h <= 23 && mm <= 59) {
      return { text: drop(text, m), h: applyAmPm(h, loose, notes), m: mm, notes, explicit: true };
    }
  }

  return { text, h: null, m: null, notes, explicit: false };
}

// "3시"가 오전인지 오후인지는 글에 없다. 업무 시간대를 기본으로 보되 반드시 알린다(EV-02).
function applyAmPm(h, ampm, notes) {
  if (ampm === 'am') return h === 12 ? 0 : h;
  if (ampm === 'pm') return h < 12 ? h + 12 : h;
  if (h >= 1 && h <= 7) {
    notes.push({ field: 'time', msg: `"${h}시"를 오후로 봤습니다`, flip: { h: h } });
    return h + 12;
  }
  return h;
}

// ── 기간
function takeDuration(text) {
  // ~5시까지 · 5시까지
  let m = text.match(/~?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*까지/);
  if (m) {
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { text, until: { h: Number(m[1]), m: m[2] ? Number(m[2]) : 0 }, minutes: null };
  }

  // 1시간 30분 · 1시간 · 90분 · 반나절
  m = text.match(/(\d{1,2})\s*시간\s*(?:(\d{1,2})\s*분)?/);
  if (m) {
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { text, until: null, minutes: Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0) };
  }

  m = text.match(/(\d{1,3})\s*분\s*(?:짜리|동안)?(?=\s|$)/);
  if (m) {
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { text, until: null, minutes: Number(m[1]) };
  }

  const half = cut(text, /반나절/);
  if (half.hit) return { text: half.text, until: null, minutes: 240 };

  return { text, until: null, minutes: null };
}

export const DEFAULT_MINUTES = 60;

/**
 * 한 줄을 일정으로 읽는다.
 *
 * @returns {{
 *   ok: boolean, title: string, startsAt: string|null, endsAt: string|null,
 *   allDay: boolean, notes: Array<{field:string,msg:string}>
 * }}
 */
export function parseLine(input, now = new Date()) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, title: '', startsAt: null, endsAt: null, allDay: false, notes: [] };

  let text = raw;
  const notes = [];

  const rep = takeRepeat(text, now);
  text = rep.text;

  const d = takeDate(text, now);
  text = d.text;
  notes.push(...d.notes);

  const t = takeTime(text);
  text = t.text;
  notes.push(...t.notes);

  const dur = takeDuration(text);
  text = dur.text;

  // 남은 것이 제목이다. 조사 부스러기(에, 에서)는 떼어 준다.
  const title = text.replace(/^[\s,·]+|[\s,·]+$/g, '').replace(/\s+/g, ' ');

  const baseDate = d.date ?? rep.date ?? startOfDay(now);
  const allDay = t.h === null;

  let start;
  if (allDay) {
    start = new Date(baseDate);
  } else {
    start = new Date(baseDate);
    start.setHours(t.h, t.m, 0, 0);
    // 날짜를 말하지 않았는데 그 시각이 이미 지났으면 내일로 본다 —
    // 밤 11시에 "9시 회의"라고 적으면 오늘 아침이 아니라 내일 아침이다
    if (!d.date && start < now) {
      start = addDays(start, 1);
      notes.push({ field: 'date', msg: '오늘은 이미 지난 시각이라 내일로 봤습니다' });
    }
  }

  let end = null;
  if (!allDay) {
    if (dur.until) {
      end = new Date(start);
      end.setHours(dur.until.h < start.getHours() ? dur.until.h + 12 : dur.until.h, dur.until.m, 0, 0);
      if (end <= start) end = addDays(end, 1);
    } else {
      end = new Date(start.getTime() + (dur.minutes ?? DEFAULT_MINUTES) * 60_000);
    }
  }

  return {
    ok: title.length > 0,
    title,
    startsAt: start.toISOString(),
    endsAt: end ? end.toISOString() : null,
    allDay,
    rrule: rep.rrule,
    notes,
  };
}

// 해석 결과를 사람이 읽는 한 줄로. 등록 전에 이걸 보여 준다(EV-02).
export function describe(parsed) {
  if (!parsed.startsAt) return '';
  const s = new Date(parsed.startsAt);
  const day = `${s.getMonth() + 1}월 ${s.getDate()}일 (${WEEK[s.getDay()]})`;
  const rep = parsed.rrule ? `${describeRrule(parsed.rrule)} · ` : '';
  if (parsed.allDay) return `${rep}${day} · 종일`;
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const e = parsed.endsAt ? new Date(parsed.endsAt) : null;
  return e ? `${rep}${day} ${hm(s)} – ${hm(e)}` : `${rep}${day} ${hm(s)}`;
}

// RRULE을 사람 말로. 화면과 상세 패널이 같은 문구를 쓴다.
export function describeRrule(rrule) {
  if (!rrule) return '';
  const r = String(rrule).replace(/^RRULE:/, '');
  const get = (k) => (r.match(new RegExp(`${k}=([^;]+)`)) ?? [])[1] ?? null;
  const freq = get('FREQ');
  const interval = Number(get('INTERVAL') ?? 1);
  const byday = get('BYDAY');
  const bymonthday = get('BYMONTHDAY');
  const count = get('COUNT');
  const until = get('UNTIL');

  const dowKo = byday
    ? byday
        .split(',')
        .map((c) => Object.entries(DOW_RRULE).find(([, v]) => v === c)?.[0])
        .filter(Boolean)
        .join('·')
    : '';

  let base;
  if (freq === 'DAILY') base = interval > 1 ? `${interval}일마다` : '매일';
  else if (freq === 'WEEKLY') base = `${interval > 1 ? `${interval}주마다` : '매주'}${dowKo ? ` ${dowKo}` : ''}`;
  else if (freq === 'MONTHLY') base = `매달${bymonthday ? ` ${bymonthday}일` : ''}`;
  else if (freq === 'YEARLY') base = '매년';
  else base = '반복';

  if (count) return `${base} · ${count}번`;
  if (until) {
    const y = until.slice(0, 4);
    const mo = until.slice(4, 6);
    const dd = until.slice(6, 8);
    return `${base} · ${Number(mo)}월 ${Number(dd)}일까지`;
  }
  return base;
}
