// renderer/main.js — 본체 창. 저장소에는 window.cal(preload)로만 닿는다.
'use strict';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const TABS = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '주' },
  { key: 'month', label: '월' },
  { key: 'subs', label: '구독' },
  { key: 'set', label: '설정' },
];
const CAL_COLORS = [1, 2, 3, 4, 5, 6];

const el = {
  tabs: document.getElementById('tabs'),
  body: document.getElementById('body'),
  dateLabel: document.getElementById('dateLabel'),
  led: document.getElementById('led'),
  storeState: document.getElementById('storeState'),
  scrim: document.getElementById('scrim'),
  dlg: document.getElementById('dlg'),
  dlgIn: document.getElementById('dlgIn'),
  dlgParse: document.getElementById('dlgParse'),
  keys: document.getElementById('keys'),
  toast: document.getElementById('toast'),
  toastMsg: document.getElementById('toastMsg'),
  choose: document.getElementById('choose'),
  chooseQ: document.getElementById('chooseQ'),
  chooseSub: document.getElementById('chooseSub'),
  chooseOpts: document.getElementById('chooseOpts'),
  searchbar: document.getElementById('searchbar'),
  searchIn: document.getElementById('searchIn'),
  searchCnt: document.getElementById('searchCnt'),
  footHints: document.getElementById('footHints'),
};

const state = {
  tab: 'today',
  anchor: startOfDay(new Date()), // 보고 있는 날(오늘 탭) 또는 주의 기준일
  events: [],
  cursor: 0,
  undo: [], // 삭제한 id 스택 (EV-06)
  overlay: null, // 'dlg' | 'keys' | null
  dlgMode: 'event', // 'event' | 'sub'
  subs: [],
  syncing: new Set(),
  // 탭 위에 겹쳐 뜨는 화면. 탭을 바꾸는 게 아니라 잠시 덮는다.
  view: null, // null | 'search' | 'find'
  query: '',
  results: [],
  slots: [],
  picked: new Set(),
  findOpts: { minMinutes: 60, anyTime: false },
  copyStyle: 0, // 0 목록 · 1 문장 · 2 표
  detail: false, // 오른쪽 상세 패널 (EV-04)
  settings: null,
  ask: null, // { q, sub, opts, onPick } — 어디까지 바꿀지 묻는 창
  askCursor: 0,
};

const COPY_STYLES = [
  { key: 'list', label: '목록' },
  { key: 'sentence', label: '문장' },
  { key: 'table', label: '표' },
];
const LENGTHS = [
  { m: 30, label: '30분' },
  { m: 60, label: '1시간' },
  { m: 120, label: '2시간' },
  { m: 240, label: '반나절' },
];

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function mondayOf(d) {
  const x = startOfDay(d);
  const dow = x.getDay();
  return addDays(x, dow === 0 ? -6 : 1 - dow);
}
function hm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// 종일 일정의 끝은 배타적이다(마지막 날 + 1일). 끝을 적지 않은 하루짜리는 그날 자정까지로
// 본다 — 그러지 않으면 오늘 종일 일정이 0시를 넘긴 순간 "끝남"이 된다.
function eventEnd(ev) {
  const e = ev.endsAt ? new Date(ev.endsAt) : null;
  if (!ev.allDay) return e;
  return e ?? addDays(startOfDay(new Date(ev.startsAt)), 1);
}

function dayDiff(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

// 종일 일정에는 "3시간 12분 뒤"가 어울리지 않는다. 날 단위로 말한다.
function allDayLead(start, now) {
  const d = dayDiff(now, start);
  return d <= 0 ? '오늘' : d === 1 ? '내일' : `${d}일 뒤`;
}

function relTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 0) return '';
  const m = Math.floor(s / 60);
  if (m >= 1440) return `${Math.floor(m / 1440)}일`;
  if (m >= 60) return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${Math.floor(m / 60)}시간`;
  if (m >= 1) return `${m}분`;
  return `${s}초`;
}

function toast(msg) {
  el.toastMsg.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

// 본문을 통째로 갈아 끼운다. 상세가 붙는 순간 본문은 스크롤 상자가 아니라 좌우로 나뉜
// 틀이 된다 — 패딩과 스크롤을 목록 쪽으로 넘겨야 패널이 창 오른쪽 끝에 딱 붙는다.
function setBody(node, detail = false) {
  el.body.classList.toggle('with-detail', detail);
  el.body.replaceChildren(node);
  renderHints();
}

function setDateLabel(text, isNow = false) {
  el.dateLabel.replaceChildren(document.createTextNode(text));
  if (!isNow) return;
  const b = document.createElement('span');
  b.className = 'now';
  b.textContent = '오늘';
  el.dateLabel.append(b);
}

// 골라 둔 칸은 늘 화면 안에 있어야 한다 — 키로 내려가다 보면 선택만 화면 밖으로 밀려난다
function keepSelVisible() {
  el.body.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

const HINTS = {
  find: [['Space', '고르기'], ['Y', '복사'], ['F', '형식'], ['Esc', '닫기']],
  search: [['jk', '위아래'], ['Enter', '상세'], ['Esc', '닫기']],
  month: [['hjkl', '날짜'], ['[ ]', '달'], ['Enter', '그날 목록'], ['?', '키']],
  subs: [['A', '주소 추가'], ['Space', '켜기·끄기'], ['R', '받아오기'], ['?', '키']],
  set: [['jk', '고르기'], ['← →', '값 바꾸기'], ['?', '키']],
  list: [['N', '새 일정'], ['Enter', '상세'], ['X', '삭제'], ['?', '키']],
};

function renderHints() {
  const keys = HINTS[state.view === 'find' ? 'find' : state.view === 'search' ? 'search' : state.tab] ?? HINTS.list;
  el.footHints.replaceChildren(
    ...keys.map(([k, label]) => {
      const s = document.createElement('span');
      const kb = document.createElement('kbd');
      kb.textContent = k;
      s.append(kb, document.createTextNode(` ${label}`));
      return s;
    })
  );
}

// ── 그리기
function renderTabs(counts) {
  el.tabs.replaceChildren(
    ...TABS.map((t) => {
      const s = document.createElement('span');
      s.className = 'tab' + (state.tab === t.key ? ' on' : '');
      s.textContent = t.label;
      const n = counts[t.key];
      if (n != null) {
        const b = document.createElement('span');
        b.className = 'n';
        b.textContent = String(n);
        s.append(' ', b);
      }
      s.onclick = () => {
        state.tab = t.key;
        load();
      };
      return s;
    })
  );
}

function eventRow(ev, now, nextId) {
  const s = new Date(ev.startsAt);
  const e = ev.endsAt ? new Date(ev.endsAt) : null;
  const row = document.createElement('div');

  // 종일은 "진행 중"으로 칠하지 않는다 — 하루 내내 초록이면 강조가 아니다
  const until = eventEnd(ev);
  const past = until ? until <= now : s <= now;
  const live = !ev.allDay && until ? s <= now && now < until : false;
  row.className = 'ev' + (past && !live ? ' past' : '') + (live ? ' live' : '') + (ev.id === nextId ? ' next' : '');
  row.dataset.id = String(ev.id);

  const clock = document.createElement('span');
  clock.className = 'clock';
  clock.textContent = ev.allDay ? '종일' : e ? `${hm(s)}–${hm(e)}` : hm(s);

  const bar = document.createElement('span');
  bar.className = 'bar';
  if (ev.color) bar.style.background = `var(--cal-${ev.color})`;

  const main = document.createElement('span');
  main.className = 'main';
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = ev.title;
  main.append(t);
  if (ev.calendarKind === 'subscription') {
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `${ev.calendarName} · 구독`;
    main.append(sub);
  }

  const rt = document.createElement('span');
  rt.className = 'rt';
  rt.textContent = live
    ? `${relTime(until - now)} 뒤 종료`
    : past
      ? '끝남'
      : ev.allDay
        ? allDayLead(s, now)
        : relTime(s - now);

  if (ev.rrule || ev.edited) {
    const sub = main.querySelector('.sub') ?? document.createElement('div');
    if (!sub.className) sub.className = 'sub';
    const mark = [ev.rrule ? rruleText(ev.rrule) : null, ev.edited ? '이 회차만 고침' : null]
      .filter(Boolean)
      .join(' · ');
    sub.textContent = sub.textContent ? `${sub.textContent} · ${mark}` : mark;
    if (!sub.parentNode) main.append(sub);
  }

  row.append(clock, bar, main, rt);
  return row;
}

function renderToday(now) {
  const list = state.events;
  setDateLabel(
    `${state.anchor.getMonth() + 1}월 ${state.anchor.getDate()}일 ${WEEK[state.anchor.getDay()]}`,
    sameDay(state.anchor, now)
  );

  if (list.length === 0) {
    setBody(emptyBox());
    return;
  }

  const frag = document.createDocumentFragment();
  const isToday = sameDay(state.anchor, now);
  const next = list.find((ev) => new Date(ev.startsAt) > now);
  let nowLineDone = !isToday;
  let lastSeg = null;

  list.forEach((ev, i) => {
    const s = new Date(ev.startsAt);

    if (!nowLineDone && s > now) {
      frag.append(nowLine(now));
      nowLineDone = true;
    }

    const seg = ev.allDay ? '종일' : s.getHours() < 12 ? '오전' : '오후';
    if (seg !== lastSeg) {
      frag.append(segHead(seg));
      lastSeg = seg;
    }

    const row = eventRow(ev, now, next?.id);
    if (i === state.cursor) row.classList.add('sel');
    frag.append(row);
  });

  if (!nowLineDone) frag.append(nowLine(now));
  setBody(withDetail(frag), detailOn());
  keepSelVisible();
}

function renderWeek(now) {
  const mon = mondayOf(state.anchor);
  const sun = addDays(mon, 6);
  setDateLabel(
    `${mon.getMonth() + 1}월 ${mon.getDate()}일 – ${sun.getMonth() + 1}월 ${sun.getDate()}일`,
    now >= mon && now < addDays(sun, 1)
  );

  if (state.events.length === 0) {
    setBody(emptyBox());
    return;
  }

  const frag = document.createDocumentFragment();
  const next = state.events.find((ev) => new Date(ev.startsAt) > now);
  let lastDay = null;

  state.events.forEach((ev, i) => {
    const s = new Date(ev.startsAt);
    const key = s.toDateString();
    if (key !== lastDay) {
      const head = document.createElement('div');
      head.className = 'wkday' + (sameDay(s, now) ? ' today' : '');
      const count = state.events.filter((x) => new Date(x.startsAt).toDateString() === key).length;
      const b = document.createElement('b');
      b.textContent = sameDay(s, now)
        ? `오늘 · ${s.getMonth() + 1}/${s.getDate()} ${WEEK[s.getDay()]}`
        : `${s.getMonth() + 1}/${s.getDate()} ${WEEK[s.getDay()]}`;
      const sp = document.createElement('span');
      sp.textContent = `${count}건`;
      const line = document.createElement('i');
      head.append(b, sp, line);
      frag.append(head);
      lastDay = key;
    }
    const row = eventRow(ev, now, next?.id);
    if (i === state.cursor) row.classList.add('sel');
    frag.append(row);
  });

  setBody(withDetail(frag), detailOn());
  keepSelVisible();
}

// 월 격자 (WIN-05·WIN-06)
//
// 조회는 화면에 보이는 6주를 한 번에 한다. 그 안에서 여러 날에 걸친 일정만 따로 뽑아
// 주마다 레인을 배치하고, 하루짜리는 각 칸의 점으로 찍는다.

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// 일정이 덮는 날의 범위. 종일 일정의 끝은 배타적(다음 날 0시)이라 1ms를 빼고 본다.
function daySpan(ev) {
  const s = startOfDay(new Date(ev.startsAt));
  const raw = ev.endsAt ? new Date(ev.endsAt) : new Date(ev.startsAt);
  const endMs = ev.endsAt ? raw.getTime() - (ev.allDay ? 1 : 0) : raw.getTime();
  const e = startOfDay(new Date(Math.max(endMs, s.getTime())));
  return { from: s, to: e, multi: e > s };
}

function monthGridStart(anchor) {
  return mondayOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
}

// 기간 일정은 칸 위를 지나는 3px 선으로 잇는다. 선 넷이 겹쳐도 22px이면 되므로,
// 막대(하나에 36px)가 칸 안을 밀어내던 문제가 사라진다.
const LANE_STEP = 5;
const MAX_LANES = 6;
const LANE_MAX_PX = 34;
// 칸 안쪽 여백 3px + 날짜 줄 16px + 사이 3px — 선은 날짜 바로 아래에서 시작한다
const DNUM_H = 22;

function renderMonth(now) {
  const anchor = state.anchor;
  setDateLabel(
    `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`,
    now.getFullYear() === anchor.getFullYear() && now.getMonth() === anchor.getMonth()
  );

  const gridStart = monthGridStart(anchor);
  const byDay = new Map();
  const multi = [];
  for (const ev of state.events) {
    const sp = daySpan(ev);
    if (sp.multi) {
      multi.push({ ev, ...sp });
      continue;
    }
    const k = dayKey(sp.from);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(ev);
  }

  const wrap = document.createElement('div');
  wrap.className = 'mon';

  const dow = document.createElement('div');
  dow.className = 'dow';
  ['월', '화', '수', '목', '금', '토', '일'].forEach((d, i) => {
    const sp = document.createElement('span');
    if (i >= 5) sp.className = 'we';
    sp.textContent = d;
    dow.append(sp);
  });
  wrap.append(dow);

  const cells = document.createElement('div');
  cells.className = 'cells';

  for (let w = 0; w < 6; w++) {
    const rowStart = addDays(gridStart, w * 7);
    const rowEnd = addDays(rowStart, 6);
    const row = document.createElement('div');
    row.className = 'wkrow';

    // 이 주와 겹치는 다중일 일정을 **먼저** 눕힌다 — 칸이 비울 위 여백과 칸 안에 적을
    // 이름이 여기서 정해진다. 긴 것이 위 줄로 간다(D-10).
    const inWeek = multi
      .filter((m) => m.from <= rowEnd && m.to >= rowStart)
      .sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from)
      .map((m) => ({
        ...m,
        col0: Math.max(0, Math.round((m.from - rowStart) / 86400000)),
        col1: Math.min(6, Math.round((m.to - rowStart) / 86400000)),
        contL: m.from < rowStart,
      }));

    const lanes = [];
    for (const m of inWeek) {
      const lane = lanes.findIndex((L) => L.every((x) => x.col1 < m.col0 || x.col0 > m.col1));
      if (lane >= 0) lanes[lane].push(m);
      else if (lanes.length < MAX_LANES) lanes.push([m]);
      // 줄이 모자라면 선은 못 긋는다. 이름은 그대로 칸에 적으므로 사라지지는 않는다.
    }
    const reserve = lanes.length ? Math.min(lanes.length * LANE_STEP + 2, LANE_MAX_PX) : 0;

    for (let d = 0; d < 7; d++) {
      const day = addDays(rowStart, d);
      const c = document.createElement('div');
      c.className = 'c';
      // 열을 명시해야 한다. 자동 배치에 맡기면 grid-column이 박힌 선이 칸을 점유하면서
      // **뒤 날짜들이 옆으로 밀려 사라진다** — 실제로 18~20일이 없어졌다.
      c.style.gridColumn = `${d + 1} / ${d + 2}`;
      if (day.getMonth() !== anchor.getMonth()) c.classList.add('out');
      if (d >= 5) c.classList.add('we');
      if (sameDay(day, now)) c.classList.add('today');
      if (sameDay(day, state.anchor)) c.classList.add('sel');
      c.dataset.day = day.toISOString();

      const head = document.createElement('div');
      head.className = 'chead';
      const num = document.createElement('span');
      num.className = 'dnum';
      num.textContent = String(day.getDate());
      head.append(num);
      // 선이 날짜 아래로 지나가므로 날짜 자리는 주마다 흔들리지 않는다
      if (reserve) head.style.marginBottom = `${reserve}px`;
      c.append(head);

      // 여기서 시작하는 기간의 이름. 주를 넘어온 것은 그 주 첫 칸에 "…"를 달고 다시 적는다 —
      // 선만 보고는 무슨 일정인지 알 수 없고, 이름을 찾으러 지난 주로 돌아갈 수는 없다.
      for (const m of inWeek) {
        if (m.col0 !== d) continue;
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.style.color = `var(--cal-${m.ev.color ?? 1})`;
        if (m.contL) {
          const b = document.createElement('b');
          b.textContent = '…';
          nm.append(b);
        }
        nm.append(document.createTextNode(m.ev.title));
        c.append(nm);
      }

      const list = byDay.get(dayKey(day)) ?? [];
      c.dataset.total = String(list.length);
      list.slice(0, 3).forEach((ev) => {
        const pin = document.createElement('span');
        pin.className = 'pin';
        const i = document.createElement('i');
        i.style.background = `var(--cal-${ev.color ?? 1})`;
        pin.append(i, document.createTextNode(ev.title));
        c.append(pin);
      });
      row.append(c);
    }

    // 칸 위를 지나는 얇은 선. 칸과 칸 사이 틈도 건너므로 이어짐이 끊기지 않는다.
    lanes.forEach((lane, li) => {
      for (const m of lane) {
        const line = document.createElement('div');
        line.className = 'spanline';
        line.style.gridColumn = `${m.col0 + 1}/${m.col1 + 2}`;
        line.style.background = `var(--cal-${m.ev.color ?? 1})`;
        line.style.marginTop = `${DNUM_H + li * LANE_STEP}px`;
        row.append(line);
      }
    });

    cells.append(row);
  }
  wrap.append(cells);

  // 칸에는 두 건까지만 적으므로, 고른 날의 전체는 아래 한 줄에 펼친다
  const bar = document.createElement('div');
  bar.className = 'daybar';
  const b = document.createElement('b');
  b.textContent = `${state.anchor.getMonth() + 1}월 ${state.anchor.getDate()}일 (${WEEK[state.anchor.getDay()]})`;
  const sp = document.createElement('span');
  sp.className = 's';
  const picked = startOfDay(state.anchor);
  const ofDay = state.events
    .filter((ev) => {
      const s2 = daySpan(ev);
      return picked >= s2.from && picked <= s2.to;
    })
    .map((ev) => (ev.allDay ? ev.title : `${ev.title} ${hm(new Date(ev.startsAt))}`));
  sp.textContent = ofDay.length ? ofDay.join(' · ') : '일정 없음';
  bar.append(b, sp);
  wrap.append(bar);

  setBody(wrap);
  fitMonthCells();
}

// 칸 높이는 창 크기를 따라간다. 들어가지 못한 줄이 반쯤 잘려 보이면 지저분하므로,
// 그린 뒤 실제 높이를 재서 넘치는 줄을 지우고 "+n"으로 합친다.
function fitMonthCells() {
  for (const c of el.body.querySelectorAll('.mon .c')) {
    const total = Number(c.dataset.total ?? 0);
    const pins = [...c.querySelectorAll('.pin')];
    const names = [...c.querySelectorAll('.nm')];
    c.querySelector('.plus')?.remove();

    const over = () => c.scrollHeight > c.clientHeight;
    // 그날 하나짜리 일정부터 접는다. 기간 이름은 그 칸에서만 볼 수 있으므로 끝까지 남긴다.
    let shownPins = pins.length;
    let shownNames = names.length;
    while (shownPins > 0 && over()) pins[--shownPins].remove();
    while (shownNames > 0 && over()) names[--shownNames].remove();

    const hidden = () => total - shownPins + (names.length - shownNames);
    if (hidden() <= 0) continue;

    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.textContent = `+${hidden()}`;
    c.querySelector('.chead').append(plus);
    // "+n" 한 줄을 넣느라 또 넘치면 한 줄 더 줄인다
    while (over() && (shownPins > 0 || shownNames > 0)) {
      if (shownPins > 0) pins[--shownPins].remove();
      else names[--shownNames].remove();
      plus.textContent = `+${hidden()}`;
    }
  }
}

// ── 검색 (SRCH)
//
// 강조 자리를 찾는 규칙은 main/search.mjs와 같아야 한다. 렌더러는 main 모듈을 import할 수
// 없어(번들러가 없다) 초성 변환만 여기 한 번 더 적는다. 검색 자체는 main이 하고, 여기서는
// 이미 찾은 결과의 어디를 칠할지만 정한다.
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
function choOf(t) {
  let out = '';
  for (const ch of String(t ?? '')) {
    const c = ch.codePointAt(0);
    out += c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }
  return out;
}
function hitRange(text, query) {
  const raw = String(text ?? '');
  const q = String(query ?? '').toLowerCase().replace(/\s+/g, '');
  if (!q) return null;
  const map = [];
  let packed = '';
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) continue;
    packed += raw[i].toLowerCase();
    map.push(i);
  }
  let at = packed.indexOf(q);
  if (at === -1 && [...q].every((c) => CHO.includes(c))) at = choOf(packed).indexOf(q);
  if (at === -1) return null;
  return [map[at], map[Math.min(at + q.length - 1, map.length - 1)] + 1];
}

function markHit(text, query) {
  const frag = document.createDocumentFragment();
  const r = hitRange(text, query);
  if (!r) {
    frag.append(document.createTextNode(text));
    return frag;
  }
  const [a, b] = r;
  frag.append(document.createTextNode(text.slice(0, a)));
  const em = document.createElement('span');
  em.className = 'hit';
  em.textContent = text.slice(a, b);
  frag.append(em, document.createTextNode(text.slice(b)));
  return frag;
}

function renderSearch(now) {
  el.searchCnt.textContent = state.query ? `${state.results.length}건` : '';
  if (!state.query) {
    setBody(hintBox('제목 일부나 초성을 치세요', '예) 리뷰 · ㄷㅈㅇ'));
    return;
  }
  if (!state.results.length) {
    setBody(hintBox('찾은 일정이 없습니다', state.query));
    return;
  }

  const frag = document.createDocumentFragment();
  const upcoming = state.results.filter((e) => new Date(e.startsAt) >= now);
  const past = state.results.filter((e) => new Date(e.startsAt) < now).reverse();

  const section = (label, list) => {
    if (!list.length) return;
    frag.append(segHead(label));
    list.forEach((ev, i) => {
      const row = searchRow(ev, now);
      if (state.results.indexOf(ev) === state.cursor) row.classList.add('sel');
      frag.append(row);
    });
  };
  section('앞으로', upcoming);
  section('지난 일정', past);
  setBody(frag);
  keepSelVisible();
}

function searchRow(ev, now) {
  const s = new Date(ev.startsAt);
  const row = document.createElement('div');
  const past = s < now;
  row.className = 'ev' + (past ? ' past' : '');

  const clock = document.createElement('span');
  clock.className = 'clock';
  clock.textContent = `${s.getMonth() + 1}/${s.getDate()} ${WEEK[s.getDay()]}`;

  const bar = document.createElement('span');
  bar.className = 'bar';
  if (ev.color) bar.style.background = `var(--cal-${ev.color})`;

  const main = document.createElement('span');
  main.className = 'main';
  const t = document.createElement('div');
  t.className = 't';
  t.append(markHit(ev.title, state.query));
  main.append(t);
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = [ev.calendarName, ev.rrule ? '반복' : null, ev.allDay ? '종일' : hm(s)]
    .filter(Boolean)
    .join(' · ');
  main.append(sub);

  const rt = document.createElement('span');
  rt.className = 'rt';
  const days = Math.round((startOfDay(s) - startOfDay(now)) / 86400000);
  rt.textContent = days === 0 ? '오늘' : days > 0 ? `${days}일 뒤` : `${-days}일 전`;

  row.append(clock, bar, main, rt);
  return row;
}

function hintBox(big, small) {
  const d = document.createElement('div');
  d.className = 'empty';
  const b = document.createElement('div');
  b.className = 'big';
  b.textContent = big;
  const h = document.createElement('div');
  h.className = 'hint';
  h.textContent = small;
  d.append(b, h);
  return d;
}

// ── 빈 시간 찾기 (FIND)
function renderFind() {
  setDateLabel('빈 시간 찾기');
  const frag = document.createDocumentFragment();

  const bar = document.createElement('div');
  bar.className = 'askbar';
  bar.append(document.createTextNode('얼마나'));
  bar.append(seg(LENGTHS.map((l) => l.label), LENGTHS.findIndex((l) => l.m === state.findOpts.minMinutes)));
  bar.append(document.createTextNode('시간대'));
  bar.append(seg(['업무 시간', '아무 때나'], state.findOpts.anyTime ? 1 : 0));
  const right = document.createElement('span');
  right.style.marginLeft = 'auto';
  right.textContent = `${state.slots.length}곳 · 고른 ${state.picked.size}곳`;
  bar.append(right);
  frag.append(bar);

  if (!state.slots.length) {
    frag.append(hintBox('조건에 맞는 빈 시간이 없습니다', '길이를 줄이거나 시간대를 넓혀 보세요'));
  }

  state.slots.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'slot' + (i === state.cursor ? ' sel' : '');

    const ck = document.createElement('span');
    ck.className = 'ck' + (state.picked.has(i) ? ' on' : '');

    const when = document.createElement('span');
    when.className = 'when';
    const a = new Date(s.from);
    const b = new Date(s.to);
    when.textContent = `${a.getMonth() + 1}/${a.getDate()} (${WEEK[a.getDay()]}) ${hm(a)}–${hm(b)}`;

    const gap = document.createElement('span');
    gap.className = 'gap';
    gap.textContent = [s.beforeTitle ? `${s.beforeTitle} 뒤` : '하루 시작', s.afterTitle ? `${s.afterTitle} 앞` : '하루 끝']
      .join(' · ');

    const len = document.createElement('span');
    len.className = 'len';
    len.textContent = s.minutes >= 60 ? `${Math.floor(s.minutes / 60)}시간${s.minutes % 60 ? ` ${s.minutes % 60}분` : ''}` : `${s.minutes}분`;

    row.append(ck, when, gap, len);
    frag.append(row);
  });

  if (state.picked.size) {
    const box = document.createElement('div');
    box.className = 'copybox';
    const hd = document.createElement('div');
    hd.className = 'hd';
    hd.textContent = `클립보드에 들어갈 내용 · ${COPY_STYLES[state.copyStyle].label} (F로 바꿈) · 일정 제목은 넣지 않습니다`;
    box.append(hd, document.createTextNode(state.copyPreview ?? ''));
    frag.append(box);
  }

  setBody(frag);
  keepSelVisible();
}

function seg(labels, active) {
  const d = document.createElement('span');
  d.className = 'segbtn';
  labels.forEach((l, i) => {
    const it = document.createElement('i');
    if (i === active) it.className = 'on';
    it.textContent = l;
    d.append(it);
  });
  return d;
}

async function loadFind() {
  const res = await window.cal.freeSlots({ ...state.findOpts, days: 14 });
  state.slots = res.slots ?? [];
  state.picked = new Set();
  state.cursor = 0;
  state.copyPreview = '';
  renderFind();
}

async function refreshCopyPreview() {
  const chosen = [...state.picked].sort((a, b) => a - b).map((i) => state.slots[i]);
  state.copyPreview = chosen.length
    ? await window.cal.formatSlots({ slots: chosen, style: COPY_STYLES[state.copyStyle].key, polite: true })
    : '';
  renderFind();
}

// ── 상세 (EV-04·EV-05)
//
// 목록을 밀어내지 않고 오른쪽에 붙인다. 목록이 사라지면 "다음이 뭐였지"를 다시 찾아야 한다.
function detailOn() {
  return state.detail && !!currentEvent();
}

function withDetail(listNode) {
  if (!detailOn()) return listNode;

  const split = document.createElement('div');
  split.className = 'split';
  const left = document.createElement('div');
  left.className = 'list';
  left.append(listNode);
  split.append(left, detailPane(currentEvent()));
  return split;
}

function currentEvent() {
  return state.events[state.cursor] ?? null;
}

const DOW_KR = { MO: '월', TU: '화', WE: '수', TH: '목', FR: '금', SA: '토', SU: '일' };

// RRULE을 사람 말로 옮긴다. 읽지 못하는 규칙은 원문 그대로 둔다 — 틀리게 요약하느니 낫다.
function rruleText(rrule) {
  const body = String(rrule).replace(/^RRULE:/i, '');
  const p = Object.fromEntries(
    body
      .split(';')
      .filter(Boolean)
      .map((kv) => {
        const [k, v] = kv.split('=');
        return [k.toUpperCase(), v ?? ''];
      })
  );
  const unit = { DAILY: '일', WEEKLY: '주', MONTHLY: '개월', YEARLY: '년' }[p.FREQ];
  if (!unit) return body;

  const every = Number(p.INTERVAL ?? 1);
  let out =
    every > 1 ? `${every}${unit}마다` : { DAILY: '매일', WEEKLY: '매주', MONTHLY: '매월', YEARLY: '매년' }[p.FREQ];
  if (p.BYDAY) out += ` ${p.BYDAY.split(',').map((x) => DOW_KR[x.replace(/^[-\d]+/, '')] ?? x).join('·')}`;
  if (p.COUNT) out += ` · ${p.COUNT}회`;
  if (p.UNTIL) out += ` · ${p.UNTIL.replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1.$2.$3')}까지`;
  return out;
}

function durText(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

function detailPane(ev) {
  const d = document.createElement('div');
  d.className = 'detail';

  const s = new Date(ev.startsAt);
  const e = ev.endsAt ? new Date(ev.endsAt) : null;
  const now = new Date();
  const fromSub = ev.calendarKind === 'subscription';

  // 어느 달력에서 왔는지. 색이 목록의 세로 막대와 같아야 같은 일정으로 읽힌다.
  const cal = document.createElement('div');
  cal.className = 'dcal';
  const dot = document.createElement('i');
  dot.style.background = `var(--cal-${ev.color ?? 1})`;
  const nm = document.createElement('span');
  nm.textContent = ev.calendarName ?? '이 PC';
  cal.append(dot, nm);
  if (fromSub) {
    const ro = document.createElement('em');
    ro.textContent = '읽기 전용';
    cal.append(ro);
  }

  const t = document.createElement('div');
  t.className = 'dt';
  t.textContent = ev.title;
  d.append(cal, t);

  // 언제 — 여기서 가장 먼저 읽는 것이다. 날짜 한 줄, 시각 한 줄.
  const when = document.createElement('div');
  when.className = 'dwhen';
  // 종일 일정의 끝은 배타적이다(마지막 날 + 1일) — 1ms를 빼야 사람이 말하는 마지막 날이 된다
  const lastDay = ev.allDay && e ? new Date(e.getTime() - 1) : null;
  const spans = lastDay && !sameDay(s, lastDay);

  const d1 = document.createElement('div');
  d1.className = 'd1';
  d1.textContent = spans
    ? `${s.getMonth() + 1}월 ${s.getDate()}일 (${WEEK[s.getDay()]}) – ${lastDay.getMonth() + 1}월 ${lastDay.getDate()}일 (${WEEK[lastDay.getDay()]})`
    : `${s.getMonth() + 1}월 ${s.getDate()}일 (${WEEK[s.getDay()]})`;
  const d2 = document.createElement('div');
  d2.className = 'd2';
  if (ev.allDay) {
    d2.append(document.createTextNode('종일'));
    if (spans) {
      const dur = document.createElement('span');
      dur.className = 'dur';
      dur.textContent = `${Math.round((startOfDay(lastDay) - startOfDay(s)) / 86400000) + 1}일간`;
      d2.append(dur);
    }
  } else {
    d2.append(document.createTextNode(e ? `${hm(s)} – ${hm(e)}` : hm(s)));
    if (e) {
      const dur = document.createElement('span');
      dur.className = 'dur';
      dur.textContent = durText(Math.round((e - s) / 60000));
      d2.append(dur);
    }
  }
  when.append(d1, d2);
  d.append(when);

  // 목록 오른쪽 끝에 작게 적힌 말을 여기서 한 번 더, 크게.
  const until = eventEnd(ev);
  const live = until ? s <= now && now < until : false;
  const past = until ? until <= now : s <= now;
  const st = document.createElement('div');
  st.className = 'dstate' + (live && !ev.allDay ? ' live' : past ? ' past' : '');
  if (past) {
    st.textContent = '지났습니다';
  } else if (ev.allDay) {
    const total = lastDay ? dayDiff(s, lastDay) + 1 : 1;
    st.textContent = live
      ? total > 1
        ? `진행 중 · ${total}일 중 ${dayDiff(s, now) + 1}일째`
        : '오늘'
      : total > 1
        ? `${allDayLead(s, now)}부터`
        : allDayLead(s, now);
  } else {
    st.textContent = live ? `진행 중 · ${relTime(until - now)} 남음` : `${relTime(s - now)} 뒤 시작`;
  }
  d.append(st);

  const meta = document.createElement('div');
  meta.className = 'dmeta';
  const line = (label, value) => {
    const row = document.createElement('div');
    row.className = 'dl';
    const b = document.createElement('b');
    b.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    row.append(b, v);
    meta.append(row);
  };
  if (ev.location) line('장소', ev.location);
  if (ev.rrule) line('반복', rruleText(ev.rrule) + (ev.edited ? ' · 이 회차만 고침' : ''));
  else if (ev.edited) line('변경', '이 회차만 고침');
  if (meta.children.length) d.append(meta);

  if (fromSub) {
    const ro = document.createElement('div');
    ro.className = 'ro';
    ro.textContent =
      '구독으로 들어온 일정입니다. 여기서 고치면 다음 갱신에 되돌아가므로 고칠 수 없게 두었습니다. 원래 캘린더에서 바꾸세요.';
    d.append(ro);
    return d;
  }

  const acts = document.createElement('div');
  acts.className = 'acts';
  const items = [['E', '제목 고치기'], ['D', '날짜·시각 옮기기'], ['X', '삭제'], ['U', '되돌리기']];
  if (ev.rrule) items.splice(2, 0, ['R', '이 회차부터 반복 끊기']);
  for (const [k, label] of items) {
    const row = document.createElement('div');
    const kbd = document.createElement('kbd');
    kbd.textContent = k;
    const sp = document.createElement('span');
    sp.textContent = label;
    row.append(kbd, sp);
    acts.append(row);
  }
  d.append(acts);
  return d;
}

// ── 설정 (OVL-12·PLAT-03·DATA)
//
// 값을 바꾸면 위 미리보기가 같이 바뀐다. "펼치기 30분 전"이 무슨 뜻인지는 글로 설명할 수 없다.

const REVEAL_START = [60, 45, 30, 20, 10];
const REVEAL_FULL = [20, 15, 10, 5, 2];
const RING_SIZES = [16, 20, 26];

function settingRows() {
  const st = state.settings ?? {};
  return [
    { grp: '오버레이' },
    {
      key: 'revealStartSec',
      label: '펼치기 시작',
      sub: '이 시간부터 이름과 남은 시간이 나온다',
      opts: REVEAL_START.map((m) => ({ v: m * 60, label: `${m}분 전` })),
    },
    {
      key: 'revealFullSec',
      label: '완전히 펼침',
      opts: REVEAL_FULL.map((m) => ({ v: m * 60, label: `${m}분 전` })),
    },
    { key: 'ringSize', label: '링 크기', opts: RING_SIZES.map((n) => ({ v: n, label: String(n) })) },
    {
      key: 'endSoonEnabled',
      label: '끝나기 5분 전 알리기',
      sub: '회의가 길어질 때 마무리 신호',
      opts: [{ v: true, label: '켬' }, { v: false, label: '끔' }],
    },
    {
      key: 'osNotify',
      label: 'OS 알림도 띄우기',
      sub: '기본은 아일랜드가 커지는 것이고, 이건 그 위에 더한다',
      opts: [{ v: true, label: '켬' }, { v: false, label: '끔' }],
    },
    {
      key: 'remindMin',
      label: '몇 분 전에',
      opts: [5, 10, 15, 30, 60].map((m) => ({ v: m, label: `${m}분` })),
    },
    { grp: '일반' },
    {
      key: 'autoStart',
      label: '로그인할 때 자동 시작',
      sub: '설치본에서만 동작합니다',
      opts: [{ v: true, label: '켬' }, { v: false, label: '끔' }],
    },
    { action: 'openDir', label: '데이터 폴더', sub: st.dataDir ?? '', val: '열기' },
    { grp: '데이터' },
    { action: 'exportJson', label: '전체 내보내기', sub: 'JSON 한 파일', val: 'Enter' },
    { action: 'exportIcs', label: '.ics로 내보내기', sub: '다른 캘린더가 읽는 표준 형식', val: 'Enter' },
    { action: 'importJson', label: '가져오기', sub: '지금 데이터를 갈아끼웁니다 · 직전 상태는 자동 백업', val: 'Enter' },
  ];
}

const settingItems = () => settingRows().filter((r) => !r.grp);

function renderSettings() {
  setDateLabel('');
  const st = state.settings ?? {};
  const wrap = document.createElement('div');
  wrap.className = 'set';

  // 미리보기 — 지금 설정대로 그린 아일랜드
  const prev = document.createElement('div');
  prev.className = 'ovprev';
  const isle = document.createElement('span');
  isle.className = 'isle';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(st.ringSize ?? 20));
  svg.setAttribute('height', String(st.ringSize ?? 20));
  svg.innerHTML =
    '<circle cx="12" cy="12" r="9" fill="none" stroke="rgba(140,148,160,.26)" stroke-width="2.6"/>' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="#e0af68" stroke-width="2.6" stroke-linecap="round" ' +
    'stroke-dasharray="56.5" stroke-dashoffset="34" transform="rotate(-90 12 12)"/>';
  const t1 = document.createElement('span');
  t1.className = 'rt';
  t1.textContent = '1:1 미팅';
  const t2 = document.createElement('span');
  t2.className = 'rl';
  t2.textContent = '18분 남음';
  isle.append(svg, t1, t2);
  prev.append(isle);
  wrap.append(prev);

  let idx = -1;
  for (const r of settingRows()) {
    if (r.grp) {
      const g = document.createElement('div');
      g.className = 'grp';
      g.textContent = r.grp;
      wrap.append(g);
      continue;
    }
    idx++;
    const row = document.createElement('div');
    row.className = 'row' + (idx === state.cursor ? ' sel' : '');

    const lb = document.createElement('span');
    lb.className = 'lb';
    lb.append(document.createTextNode(r.label));
    if (r.sub) {
      const sm = document.createElement('small');
      sm.textContent = r.sub;
      lb.append(sm);
    }
    row.append(lb);

    if (r.opts) {
      const cur = st[r.key];
      const active = r.opts.findIndex((o) => o.v === cur);
      row.append(seg(r.opts.map((o) => o.label), active));
    } else {
      const v = document.createElement('span');
      v.className = 'val';
      v.textContent = r.val ?? '';
      row.append(v);
    }
    wrap.append(row);
  }

  setBody(wrap);
  keepSelVisible();
}

async function loadSettings() {
  state.settings = await window.app.settings();
  renderSettings();
}

async function settingAction(item, dir) {
  if (item.opts) {
    const cur = state.settings[item.key];
    const i = item.opts.findIndex((o) => o.v === cur);
    const next = item.opts[(i + (dir || 1) + item.opts.length) % item.opts.length];
    const r = await window.app.set(item.key, next.v);
    if (item.key === 'autoStart' && r && r.packaged === false) {
      toast('개발 실행에서는 자동 시작을 걸지 않습니다');
    }
    await loadSettings();
    return;
  }
  if (item.action === 'openDir') return void window.app.openDataDir();
  if (item.action === 'exportJson') {
    const r = await window.app.exportJson();
    if (r.ok) toast('내보냈습니다');
    else if (!r.canceled) toast(r.error ?? '내보내지 못했습니다');
    return;
  }
  if (item.action === 'exportIcs') {
    const r = await window.app.exportIcs();
    if (r.ok) toast(`.ics로 내보냈습니다 — ${r.count}건`);
    else if (!r.canceled) toast(r.error ?? '내보내지 못했습니다');
    return;
  }
  if (item.action === 'importJson') {
    const r = await window.app.importJson();
    if (r.ok) {
      await loadSettings();
      toast(`가져왔습니다 — 일정 ${r.events}건${r.backup ? ' · 직전 상태는 백업됨' : ''}`);
    } else if (!r.canceled) {
      toast(r.error ?? '가져오지 못했습니다');
    }
  }
}

// ── 어디까지 바꿀지 묻기 (EV-07)
//
// 반복 일정을 고치거나 지울 때 "이 회차만"인지 "이후 전부"인지 묻지 않으면,
// 사용자가 의도한 것과 다른 일이 조용히 일어난다.
const SERIES_OPTS = [
  { scope: 'one', label: '이 회차만', hint: '나머지는 그대로' },
  { scope: 'after', label: '이 회차부터 뒤 전부', hint: '앞의 회차는 남는다' },
  { scope: 'all', label: '전체', hint: '시리즈 통째로' },
];

function askScope(q, sub, onPick) {
  state.ask = { q, sub, opts: SERIES_OPTS, onPick };
  state.askCursor = 0;
  state.overlay = 'choose';
  el.scrim.classList.remove('hidden');
  el.choose.classList.remove('hidden');
  renderAsk();
}

function renderAsk() {
  const a = state.ask;
  if (!a) return;
  el.chooseQ.textContent = a.q;
  el.chooseSub.textContent = a.sub ?? '';
  el.chooseOpts.replaceChildren(
    ...a.opts.map((o, i) => {
      const d = document.createElement('div');
      d.className = 'opt' + (i === state.askCursor ? ' sel' : '');
      d.append(document.createTextNode(o.label));
      const sm = document.createElement('small');
      sm.textContent = o.hint;
      d.append(sm);
      d.onclick = () => pickAsk(i);
      return d;
    })
  );
}

async function pickAsk(i) {
  const a = state.ask;
  if (!a) return;
  const opt = a.opts[i];
  closeOverlay();
  state.ask = null;
  await a.onPick(opt.scope);
}

function renderSubs() {
  setDateLabel('');
  const frag = document.createDocumentFragment();

  const subs = state.subs.filter((c) => c.kind === 'subscription');
  const local = state.subs.filter((c) => c.kind === 'local');

  if (subs.length === 0) {
    const d = document.createElement('div');
    d.className = 'empty';
    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = '구독한 달력이 없습니다';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML =
      '구글 캘린더 설정 → 캘린더 통합 → <b>비공개 주소(iCal 형식)</b>를 복사해 붙이면<br>' +
      '회사·개인 일정이 그대로 들어옵니다. 로그인은 필요 없습니다.<br><br>A 로 추가';
    d.append(big, hint);
    frag.append(d);
  }

  subs.forEach((c, i) => {
    frag.append(subRow(c, i === state.cursor));
    if (i === state.cursor) {
      frag.append(palette(c));
      if (c.lastError) {
        const e = document.createElement('div');
        e.className = 'errbox';
        e.textContent = c.lastError;
        frag.append(e);
      }
    }
  });

  if (local.length) {
    const head = document.createElement('div');
    head.className = 'seghead';
    const b = document.createElement('b');
    b.textContent = '이 PC';
    const line = document.createElement('i');
    head.append(b, line);
    frag.append(head);
    for (const c of local) frag.append(subRow(c, false));
  }

  setBody(frag);
  keepSelVisible();
}

function subRow(c, selected) {
  const row = document.createElement('div');
  row.className = 'sub' + (selected ? ' sel' : '');

  const sw = document.createElement('span');
  sw.className = 'sw';
  sw.style.background = `var(--cal-${c.color})`;

  const main = document.createElement('span');
  main.className = 'main';
  const nm = document.createElement('div');
  nm.className = 'nm';
  nm.textContent = c.name;
  const url = document.createElement('div');
  url.className = 'url';
  url.textContent = c.kind === 'local' ? '직접 등록한 일정' : c.url;
  main.append(nm, url);

  const st = document.createElement('span');
  st.className = 'st';
  if (c.kind === 'local') {
    st.textContent = '항상 사용';
  } else if (state.syncing.has(c.id)) {
    st.className = 'st load';
    st.textContent = '받는 중…';
  } else if (c.lastError) {
    st.className = 'st err';
    st.textContent = '실패 · ' + ago(c.lastSyncAt);
  } else {
    st.textContent = '읽기 전용 · ' + ago(c.lastSyncAt);
  }

  row.append(sw, main, st);

  if (c.kind === 'subscription') {
    const tg = document.createElement('span');
    tg.className = 'toggle' + (c.enabled ? ' on' : '');
    row.append(tg);
  }
  return row;
}

function palette(c) {
  const d = document.createElement('div');
  d.className = 'pal';
  const lb = document.createElement('span');
  lb.className = 'lb';
  lb.textContent = 'C 색';
  d.append(lb);
  for (const n of CAL_COLORS) {
    const sw = document.createElement('span');
    sw.className = 'sw2' + (n === c.color ? ' on' : '');
    sw.style.background = `var(--cal-${n})`;
    d.append(sw);
  }
  return d;
}

function ago(iso) {
  if (!iso) return '아직 없음';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function segHead(label) {
  const d = document.createElement('div');
  d.className = 'seghead';
  const b = document.createElement('b');
  b.textContent = label;
  const i = document.createElement('i');
  d.append(b, i);
  return d;
}

function nowLine(now) {
  const d = document.createElement('div');
  d.className = 'nowline';
  const bead = document.createElement('span');
  bead.className = 'bead';
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = hm(now);
  const ln = document.createElement('span');
  ln.className = 'ln';
  d.append(bead, lbl, ln);
  return d;
}

function emptyBox() {
  const d = document.createElement('div');
  d.className = 'empty';
  const big = document.createElement('div');
  big.className = 'big';
  big.textContent = state.tab === 'today' ? '이 날은 일정이 없습니다' : '이번 주는 일정이 없습니다';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.innerHTML = 'N 을 눌러 한 줄로 적으세요<br>예) 담주 화 3시 김부장 미팅 1시간';
  d.append(big, hint);
  return d;
}

// ── 데이터
async function load() {
  const now = new Date();

  if (state.view === 'find') return renderFind();
  if (state.view === 'search') return renderSearch(now);

  if (state.tab === 'set') {
    const today = await window.cal.list({ day: new Date().toISOString(), days: 1 });
    const week = await window.cal.list({ day: mondayOf(new Date()).toISOString(), days: 7 });
    state.subs = await window.subs.list();
    renderTabs({
      today: today.events?.length ?? 0,
      week: week.events?.length ?? 0,
      subs: state.subs.filter((c) => c.kind === 'subscription').length,
    });
    if (state.cursor >= settingItems().length) state.cursor = 0;
    await loadSettings();
    return;
  }

  state.subs = await window.subs.list();
  if (state.tab === 'subs') {
    const subs = state.subs.filter((c) => c.kind === 'subscription');
    if (state.cursor >= subs.length) state.cursor = Math.max(0, subs.length - 1);
    const today = await window.cal.list({ day: new Date().toISOString(), days: 1 });
    const week = await window.cal.list({ day: mondayOf(new Date()).toISOString(), days: 7 });
    renderTabs({ today: today.events?.length ?? 0, week: week.events?.length ?? 0, subs: subs.length });
    renderSubs();
    return;
  }

  const opts =
    state.tab === 'today'
      ? { day: state.anchor.toISOString(), days: 1 }
      : state.tab === 'month'
        ? { day: monthGridStart(state.anchor).toISOString(), days: 42 }
        : { day: mondayOf(state.anchor).toISOString(), days: 7 };

  const res = await window.cal.list(opts);
  state.events = res.events ?? [];
  if (state.cursor >= state.events.length) state.cursor = Math.max(0, state.events.length - 1);

  // 탭 배지 — 오늘은 오늘 건수, 주는 이번 주 건수
  const today = await window.cal.list({ day: new Date().toISOString(), days: 1 });
  const week = await window.cal.list({ day: mondayOf(new Date()).toISOString(), days: 7 });
  renderTabs({
    today: today.events?.length ?? 0,
    week: week.events?.length ?? 0,
    subs: state.subs.filter((c) => c.kind === 'subscription').length,
  });

  if (state.tab === 'today') renderToday(now);
  else if (state.tab === 'month') renderMonth(now);
  else renderWeek(now);
}

async function refreshInfo() {
  const info = await window.cal.info();
  el.led.classList.toggle('err', !info.storeOk);
  el.storeState.textContent = info.storeOk ? '이 PC에 저장됨' : `저장소 오류 (${info.reason})`;
}

// ── 한 줄 입력
let parseTimer = null;

const DLG = {
  event: { label: '새 일정 — 한 줄로 적으세요', ph: '담주 화 3시 김부장 미팅 1시간', hint: '날짜·시각·제목을 알아서 읽습니다' },
  sub: {
    label: '구독 추가 — .ics 주소를 붙여 넣으세요',
    ph: 'https://calendar.google.com/calendar/ical/…/basic.ics',
    hint: '구글 캘린더 설정 → 캘린더 통합 → 비공개 주소(iCal 형식)',
  },
  title: { label: '제목 고치기', ph: '', hint: '엔터로 저장합니다' },
  when: { label: '날짜·시각 옮기기 — 한 줄로', ph: '담주 화 3시 1시간', hint: '제목은 그대로 두고 시간만 바꿉니다' },
};

function openDialog(mode = 'event', preset = '') {
  state.overlay = 'dlg';
  state.dlgMode = mode;
  el.scrim.classList.remove('hidden');
  el.dlg.classList.remove('hidden');
  const cfg = DLG[mode] ?? DLG.event;
  el.dlg.querySelector('label').textContent = cfg.label;
  el.dlgIn.placeholder = cfg.ph;
  el.dlgParse.innerHTML = `<span class="no">${cfg.hint}</span>`;
  el.dlgIn.value = preset;
  el.dlgIn.focus();
  el.dlgIn.setSelectionRange(preset.length, preset.length);
}

function closeOverlay() {
  state.overlay = null;
  el.scrim.classList.add('hidden');
  el.dlg.classList.add('hidden');
  el.keys.classList.add('hidden');
  el.choose.classList.add('hidden');
  el.dlgIn.blur();
}

async function previewParse() {
  if (state.dlgMode === 'sub' || state.dlgMode === 'title') return; // 주소와 제목은 미리 볼 것이 없다
  const line = el.dlgIn.value.trim();
  if (!line) {
    el.dlgParse.innerHTML = '<span class="no">날짜·시각·제목을 알아서 읽습니다</span>';
    return;
  }
  const p = await window.cal.parse(line);
  const bits = [];
  if (p.summary) bits.push(`<b>${escapeHtml(p.summary)}</b>`);
  if (p.title) bits.push(escapeHtml(p.title));
  let html = bits.join(' · ') || '<span class="no">아직 읽을 것이 없습니다</span>';
  if (!p.ok && p.startsAt) html += '<br><span class="q">＊ 제목이 없습니다</span>';
  for (const n of p.notes ?? []) html += `<br><span class="q">＊ ${escapeHtml(n.msg)}</span>`;
  el.dlgParse.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function submitDialog() {
  const line = el.dlgIn.value.trim();
  if (!line) return;

  if (state.dlgMode === 'title') {
    const ev = currentEvent();
    if (!ev) return closeOverlay();
    closeOverlay();

    if (ev.rrule) {
      askScope(`제목을 "${line}"으로 — 어디까지 바꿀까요?`, '반복하는 일정입니다', async (scope) => {
        const r = await window.cal.series({
          id: ev.occurrenceOf ?? ev.id,
          recurrenceId: ev.recurrenceId ?? ev.startsAt,
          scope,
          op: 'edit',
          patch: { title: line },
        });
        if (!r.ok) return toast('고치지 못했습니다');
        await load();
        toast('제목을 바꿨습니다');
      });
      return;
    }

    const r = await window.cal.update(ev.id, { title: line });
    if (!r.ok) return toast(r.reason === 'readonly' ? '구독 일정은 고칠 수 없습니다' : '고치지 못했습니다');
    await load();
    toast('제목을 바꿨습니다');
    return;
  }

  if (state.dlgMode === 'when') {
    const ev = currentEvent();
    if (!ev) return closeOverlay();
    const r = await window.cal.reschedule(ev.id, line);
    if (!r.ok) {
      if (r.reason === 'parse') {
        el.dlgParse.innerHTML = '<span class="q">＊ 날짜·시각을 읽지 못했습니다</span>';
        return;
      }
      closeOverlay();
      return toast(r.reason === 'readonly' ? '구독 일정은 옮길 수 없습니다' : '옮기지 못했습니다');
    }
    closeOverlay();
    await load();
    toast(`옮겼습니다 — ${r.summary}`);
    return;
  }

  if (state.dlgMode === 'sub') {
    el.dlgParse.innerHTML = '<span class="no">받는 중…</span>';
    const r = await window.subs.add(line);
    if (!r.ok) {
      el.dlgParse.innerHTML = `<span class="q">＊ ${escapeHtml(r.error)}</span>`;
      return;
    }
    closeOverlay();
    await load();
    const sync = r.sync ?? {};
    toast(sync.ok ? `구독을 추가했습니다 — 일정 ${sync.added ?? 0}건` : `추가했지만 받아오지 못했습니다`);
    return;
  }

  const res = await window.cal.add(line);
  if (!res.ok) {
    if (res.reason === 'parse') {
      el.dlgParse.innerHTML = '<span class="q">＊ 제목이 없어 등록하지 않았습니다. 무엇을 하는 일정인가요?</span>';
      return;
    }
    toast('저장소에 쓸 수 없습니다');
    return;
  }
  closeOverlay();
  await load();
  toast(`추가했습니다 — ${res.parsed.title}`);
}

// ── 키
function openSearch() {
  state.view = 'search';
  state.query = '';
  state.results = [];
  state.cursor = 0;
  el.searchbar.classList.remove('hidden');
  el.searchIn.value = '';
  el.searchIn.focus();
  rerender();
}

function closeView() {
  state.view = null;
  state.query = '';
  el.searchbar.classList.add('hidden');
  el.searchIn.blur();
  state.cursor = 0;
  load();
}

let searchTimer = null;
el.searchIn.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    state.query = el.searchIn.value.trim();
    state.results = state.query ? await window.cal.search(state.query) : [];
    state.cursor = 0;
    renderSearch(new Date());
  }, 120);
});

el.searchIn.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeView();
  }
});

document.addEventListener('keydown', async (e) => {
  // 검색은 입력창이 포커스를 가지므로 여기서는 Esc만 본다
  if (state.view === 'search' && document.activeElement === el.searchIn) return;

  // 빈 시간 찾기 화면 (FIND)
  if (state.view === 'find' && state.overlay === null) {
    const k0 = e.key;
    if (k0 === 'Escape' || k0 === 'g' || k0 === 'G' || k0 === 'ㅎ') {
      e.preventDefault();
      closeView();
      return;
    }
    if (k0 === 'j' || k0 === 'ArrowDown' || k0 === 'k' || k0 === 'ArrowUp') {
      e.preventDefault();
      const d = k0 === 'j' || k0 === 'ArrowDown' ? 1 : -1;
      state.cursor = Math.max(0, Math.min(state.cursor + d, Math.max(0, state.slots.length - 1)));
      renderFind();
      return;
    }
    if (k0 === ' ') {
      e.preventDefault();
      if (state.picked.has(state.cursor)) state.picked.delete(state.cursor);
      else state.picked.add(state.cursor);
      await refreshCopyPreview();
      return;
    }
    if (k0 === 'f' || k0 === 'F' || k0 === 'ㄹ') {
      state.copyStyle = (state.copyStyle + 1) % COPY_STYLES.length;
      await refreshCopyPreview();
      return;
    }
    if (k0 === 'y' || k0 === 'Y' || k0 === 'ㅛ') {
      if (!state.picked.size) {
        toast('Space로 먼저 고르세요');
        return;
      }
      await navigator.clipboard.writeText(state.copyPreview ?? '');
      toast(`복사했습니다 · ${state.picked.size}곳 · 일정 제목은 빠졌습니다`);
      return;
    }
    if (k0 === 'Enter') {
      e.preventDefault();
      const slot = state.slots[state.cursor];
      if (!slot) return;
      const a = new Date(slot.from);
      const when = `${a.getMonth() + 1}/${a.getDate()} ${a.getHours()}시${a.getMinutes() ? ` ${a.getMinutes()}분` : ''}`;
      closeView();
      openDialog('event');
      el.dlgIn.value = `${when} `;
      el.dlgIn.setSelectionRange(el.dlgIn.value.length, el.dlgIn.value.length);
      previewParse();
      return;
    }
    // 길이·시간대 바꾸기
    if (k0 === '1' || k0 === '2' || k0 === '3' || k0 === '4') {
      state.findOpts.minMinutes = LENGTHS[Number(k0) - 1].m;
      await loadFind();
      return;
    }
    if (k0 === 'a' || k0 === 'A' || k0 === 'ㅁ') {
      state.findOpts.anyTime = !state.findOpts.anyTime;
      await loadFind();
      return;
    }
    return;
  }

  // 입력 중에는 글자가 명령이 되면 안 된다
  if (state.overlay === 'dlg') {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeOverlay();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      await submitDialog();
    } else {
      clearTimeout(parseTimer);
      parseTimer = setTimeout(previewParse, 120);
    }
    return;
  }

  if (state.overlay === 'choose') {
    e.preventDefault();
    if (e.key === 'Escape') {
      state.ask = null;
      closeOverlay();
    } else if (e.key === 'ArrowDown' || e.key === 'j') {
      state.askCursor = Math.min(state.askCursor + 1, (state.ask?.opts.length ?? 1) - 1);
      renderAsk();
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      state.askCursor = Math.max(0, state.askCursor - 1);
      renderAsk();
    } else if (e.key === 'Enter') {
      await pickAsk(state.askCursor);
    } else if (['1', '2', '3'].includes(e.key)) {
      await pickAsk(Number(e.key) - 1);
    }
    return;
  }

  if (state.overlay === 'keys') {
    if (e.key === 'Escape' || e.key === '?' || e.key === '/') {
      e.preventDefault();
      closeOverlay();
    }
    return;
  }

  const k = e.key;

  if (k === 'Escape') {
    if (state.detail) {
      state.detail = false;
      rerender();
      return;
    }
    window.cal.hide();
    return;
  }
  if (k === '?') {
    e.preventDefault();
    state.overlay = 'keys';
    el.scrim.classList.remove('hidden');
    el.keys.classList.remove('hidden');
    return;
  }
  // ── 월 탭에서만 듣는 키 — 격자는 목록이 아니라 날짜를 옮긴다 (WIN-05)
  if (state.tab === 'month' && k !== 'Tab' && k !== '?' && k !== 'Escape' && k !== 'n' && k !== 'N' && k !== 'ㅜ') {
    // 달 넘기기는 [ ] · PageUp/Down · Shift+←→ 로만 한다. 방향키 한 번에 달이 통째로
    // 바뀌면 "옆 칸으로 가려다 어디 있는지 잃어버린다" — 격자에서는 hjkl과 같아야 한다.
    const jump = k === ']' || k === 'PageDown' || (e.shiftKey && k === 'ArrowRight') ? 1
      : k === '[' || k === 'PageUp' || (e.shiftKey && k === 'ArrowLeft') ? -1
      : 0;
    if (jump) {
      e.preventDefault();
      state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + jump, 1);
      await load();
      return;
    }

    const step = { h: -1, l: 1, ArrowLeft: -1, ArrowRight: 1, j: 7, k: -7, ArrowDown: 7, ArrowUp: -7 }[k];
    if (step != null) {
      e.preventDefault();
      // 보이는 6주 밖으로 나갈 때만 다시 읽는다 — 칸을 옮길 때마다 저장소를 부르면 커서가 끈적거린다
      const grid = monthGridStart(state.anchor).getTime();
      state.anchor = addDays(state.anchor, step);
      if (monthGridStart(state.anchor).getTime() === grid) rerender();
      else await load();
      return;
    }
    if (k === 't' || k === 'T' || k === 'ㅅ') {
      state.anchor = startOfDay(new Date());
      await load();
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      state.tab = 'today';
      state.cursor = 0;
      await load();
      return;
    }
    return;
  }

  if (k === 'Tab') {
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === state.tab);
    state.tab = TABS[(i + (e.shiftKey ? -1 : 1) + TABS.length) % TABS.length].key;
    state.cursor = 0;
    await load();
    return;
  }
  if (k === 'n' || k === 'N' || k === 'ㅜ') {
    e.preventDefault();
    openDialog();
    return;
  }
  if (k === '/') {
    e.preventDefault();
    openSearch();
    return;
  }
  if (k === 'g' || k === 'G' || k === 'ㅎ') {
    e.preventDefault();
    state.view = 'find';
    await loadFind();
    return;
  }
  if (k === 'j' || k === 'ArrowDown') {
    e.preventDefault();
    state.cursor = Math.min(state.cursor + 1, Math.max(0, state.events.length - 1));
    rerender();
    return;
  }
  if (k === 'k' || k === 'ArrowUp') {
    e.preventDefault();
    state.cursor = Math.max(0, state.cursor - 1);
    rerender();
    return;
  }
  if (k === 'ArrowRight') {
    state.anchor = addDays(state.anchor, state.tab === 'today' ? 1 : 7);
    state.cursor = 0;
    await load();
    return;
  }
  if (k === 'ArrowLeft') {
    state.anchor = addDays(state.anchor, state.tab === 'today' ? -1 : -7);
    state.cursor = 0;
    await load();
    return;
  }
  if (k === 't' || k === 'T' || k === 'ㅅ') {
    state.anchor = startOfDay(new Date());
    state.cursor = 0;
    await load();
    return;
  }
  // ── 설정 탭에서만 듣는 키
  if (state.tab === 'set') {
    const items = settingItems();
    const item = items[state.cursor];
    if (k === 'j' || k === 'ArrowDown' || k === 'k' || k === 'ArrowUp') {
      e.preventDefault();
      const d = k === 'j' || k === 'ArrowDown' ? 1 : -1;
      state.cursor = Math.max(0, Math.min(state.cursor + d, items.length - 1));
      renderSettings();
      return;
    }
    if (k === 'ArrowRight' || k === 'ArrowLeft' || k === ' ' || k === 'Enter') {
      e.preventDefault();
      if (item) await settingAction(item, k === 'ArrowLeft' ? -1 : 1);
      return;
    }
    return;
  }

  // ── 구독 탭에서만 듣는 키
  if (state.tab === 'subs') {
    const cal = selectedSub();
    if (k === 'a' || k === 'A' || k === 'ㅁ') {
      e.preventDefault();
      openDialog('sub');
      return;
    }
    if (k === 'r' || k === 'R' || k === 'ㄱ') {
      toast('받는 중…');
      state.subs.filter((c) => c.kind === 'subscription').forEach((c) => state.syncing.add(c.id));
      rerender();
      const res = await window.subs.sync(null);
      state.syncing.clear();
      await load();
      const failed = (res.results ?? []).filter((r) => !r.ok).length;
      toast(failed ? `${failed}개 실패` : '최신 상태입니다');
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      if (cal) {
        await window.subs.toggle(cal.id);
        await load();
      }
      return;
    }
    if (k === 'c' || k === 'C' || k === 'ㅊ') {
      if (cal) {
        const next = CAL_COLORS[(CAL_COLORS.indexOf(cal.color) + 1) % CAL_COLORS.length];
        await window.subs.color(cal.id, next);
        await load();
      }
      return;
    }
    if (k === 'x' || k === 'X' || k === 'ㅌ') {
      if (cal) {
        await window.subs.remove(cal.id);
        await load();
        toast(`구독을 지웠습니다 — ${cal.name}`);
      }
      return;
    }
    if (k === 'j' || k === 'ArrowDown' || k === 'k' || k === 'ArrowUp') {
      e.preventDefault();
      const n = state.subs.filter((c) => c.kind === 'subscription').length;
      const d = k === 'j' || k === 'ArrowDown' ? 1 : -1;
      state.cursor = Math.max(0, Math.min(state.cursor + d, Math.max(0, n - 1)));
      rerender();
      return;
    }
    return;
  }

  if (k === 'Enter') {
    e.preventDefault();
    if (state.events.length) {
      state.detail = !state.detail;
      rerender();
    }
    return;
  }
  if (k === 'e' || k === 'E' || k === 'ㄷ') {
    const ev = currentEvent();
    if (!ev) return;
    if (ev.calendarKind === 'subscription') return toast('구독 일정은 고칠 수 없습니다');
    e.preventDefault();
    openDialog('title', ev.title);
    return;
  }
  if (k === 'd' || k === 'D' || k === 'ㅇ') {
    const ev = currentEvent();
    if (!ev) return;
    if (ev.calendarKind === 'subscription') return toast('구독 일정은 옮길 수 없습니다');
    e.preventDefault();
    openDialog('when');
    return;
  }
  if (k === 'x' || k === 'X' || k === 'ㅌ') {
    const ev = state.events[state.cursor];
    if (!ev) return;
    if (ev.calendarKind === 'subscription') {
      toast('구독으로 들어온 일정은 지울 수 없습니다');
      return;
    }
    e.preventDefault();

    // 반복 일정은 어디까지 지울지 묻는다 — 묻지 않으면 시리즈가 통째로 날아간다 (EV-07)
    if (ev.rrule) {
      askScope(`"${ev.title}" — 어디까지 지울까요?`, '반복하는 일정입니다', async (scope) => {
        const r = await window.cal.series({
          id: ev.occurrenceOf ?? ev.id,
          recurrenceId: ev.recurrenceId ?? ev.startsAt,
          scope,
          op: 'delete',
        });
        if (!r.ok) return toast('지우지 못했습니다');
        if (scope === 'all') state.undo.push(ev.occurrenceOf ?? ev.id);
        await load();
        toast(scope === 'all' ? `시리즈를 지웠습니다 · U로 되돌리기` : '지웠습니다');
      });
      return;
    }

    await window.cal.remove(ev.id);
    state.undo.push(ev.id);
    await load();
    toast(`지웠습니다 — ${ev.title} · U로 되돌리기`);
    return;
  }
  // 반복 끊기 — 이 회차부터 뒤를 없앤다
  if (k === 'r' || k === 'R' || k === 'ㄱ') {
    const ev = currentEvent();
    if (!ev?.rrule) return;
    if (ev.calendarKind === 'subscription') return toast('구독 일정은 바꿀 수 없습니다');
    e.preventDefault();
    const r = await window.cal.series({
      id: ev.occurrenceOf ?? ev.id,
      recurrenceId: ev.recurrenceId ?? ev.startsAt,
      scope: 'after',
      op: 'delete',
    });
    if (!r.ok) return toast('끊지 못했습니다');
    await load();
    toast('이 회차부터 반복을 끊었습니다');
    return;
  }
  if (k === 'u' || k === 'U' || k === 'ㅠ') {
    const id = state.undo.pop();
    if (id == null) {
      toast('되돌릴 것이 없습니다');
      return;
    }
    await window.cal.restore(id);
    await load();
    toast('되돌렸습니다');
    return;
  }
});

function rerender() {
  const now = new Date();
  if (state.view === 'search') return renderSearch(now);
  if (state.view === 'find') return renderFind();
  if (state.tab === 'set') renderSettings();
  else if (state.tab === 'subs') renderSubs();
  else if (state.tab === 'month') renderMonth(now);
  else if (state.tab === 'today') renderToday(now);
  else renderWeek(now);
}

const selectedSub = () => state.subs.filter((c) => c.kind === 'subscription')[state.cursor] ?? null;

el.body.addEventListener('click', async (e) => {
  // 빈 시간 한 칸을 눌러 고른다
  const slot = e.target.closest('.slot');
  if (slot && state.view === 'find') {
    const i = [...el.body.querySelectorAll('.slot')].indexOf(slot);
    if (i >= 0) {
      state.cursor = i;
      if (state.picked.has(i)) state.picked.delete(i);
      else state.picked.add(i);
      await refreshCopyPreview();
    }
    return;
  }
  const setRow = e.target.closest('.set .row');
  if (setRow && state.tab === 'set') {
    const i = [...el.body.querySelectorAll('.set .row')].indexOf(setRow);
    if (i >= 0) {
      state.cursor = i;
      await settingAction(settingItems()[i], 1);
    }
    return;
  }
  const cell = e.target.closest('.mon .c');
  if (cell?.dataset.day) {
    state.anchor = new Date(cell.dataset.day);
    rerender();
    return;
  }
  const row = e.target.closest('.ev');
  if (!row) return;
  const i = [...el.body.querySelectorAll('.ev')].indexOf(row);
  if (i >= 0) {
    state.cursor = i;
    rerender();
  }
});

document.getElementById('winMin').addEventListener('click', () => window.cal.minimize());
document.getElementById('winClose').addEventListener('click', () => window.cal.hide());

el.dlgIn.addEventListener('input', () => {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(previewParse, 120);
});

window.cal.onChanged(() => load());

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (state.tab !== 'month' || state.view) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => rerender(), 120);
});

// 화면에 "몇 분 남음"이 떠 있으므로 가만히 둬도 낡지 않게 한다
setInterval(() => {
  if (!state.overlay) rerender();
}, 30_000);

refreshInfo();
load();
