// renderer/main.js — 본체 창. 저장소에는 window.cal(preload)로만 닿는다.
'use strict';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const TABS = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '주' },
  { key: 'month', label: '월' },
  { key: 'subs', label: '구독' },
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
};

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

function relTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 0) return '';
  const m = Math.floor(s / 60);
  if (m >= 1440) return `${Math.floor(m / 1440)}일 뒤`;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  if (m >= 1) return `${m}분`;
  return `${s}초`;
}

function toast(msg) {
  el.toastMsg.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), 2200);
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

  const past = e ? e <= now : s <= now;
  const live = e ? s <= now && now < e : false;
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
  rt.textContent = live ? `${relTime(e - now)} 뒤 종료` : past ? '끝남' : relTime(s - now);

  row.append(clock, bar, main, rt);
  return row;
}

function renderToday(now) {
  const list = state.events;
  el.dateLabel.textContent = `${state.anchor.getMonth() + 1}월 ${state.anchor.getDate()}일 ${WEEK[state.anchor.getDay()]}`;

  if (list.length === 0) {
    el.body.replaceChildren(emptyBox());
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
  el.body.replaceChildren(frag);
  el.body.querySelector('.ev.sel')?.scrollIntoView({ block: 'nearest' });
}

function renderWeek(now) {
  const mon = mondayOf(state.anchor);
  const sun = addDays(mon, 6);
  el.dateLabel.textContent = `${mon.getMonth() + 1}월 ${mon.getDate()}일 – ${sun.getMonth() + 1}월 ${sun.getDate()}일`;

  if (state.events.length === 0) {
    el.body.replaceChildren(emptyBox());
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

  el.body.replaceChildren(frag);
  el.body.querySelector('.ev.sel')?.scrollIntoView({ block: 'nearest' });
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

function renderMonth(now) {
  const anchor = state.anchor;
  el.dateLabel.textContent = `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;

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

    for (let d = 0; d < 7; d++) {
      const day = addDays(rowStart, d);
      const c = document.createElement('div');
      c.className = 'c';
      // 열을 명시해야 한다. 자동 배치에 맡기면 grid-column이 박힌 가로 막대가 칸을
      // 점유하면서 **뒤 날짜들이 옆으로 밀려 사라진다** — 실제로 18~20일이 없어졌다.
      c.style.gridColumn = `${d + 1} / ${d + 2}`;
      if (day.getMonth() !== anchor.getMonth()) c.classList.add('out');
      if (d >= 5) c.classList.add('we');
      if (sameDay(day, now)) c.classList.add('today');
      if (sameDay(day, state.anchor)) c.classList.add('sel');
      c.dataset.day = day.toISOString();

      const num = document.createElement('span');
      num.className = 'dnum';
      num.textContent = String(day.getDate());
      c.append(num);

      const list = byDay.get(dayKey(day)) ?? [];
      list.slice(0, 2).forEach((ev) => {
        const pin = document.createElement('span');
        pin.className = 'pin';
        const i = document.createElement('i');
        i.style.background = `var(--cal-${ev.color ?? 1})`;
        pin.append(i, document.createTextNode(ev.title));
        c.append(pin);
      });
      if (list.length > 2) {
        const plus = document.createElement('span');
        plus.className = 'plus';
        plus.textContent = `+${list.length - 2}`;
        c.append(plus);
      }
      row.append(c);
    }

    // 이 주와 겹치는 다중일 일정 — 긴 것이 위 레인으로 간다(D-10)
    const inWeek = multi
      .filter((m) => m.from <= rowEnd && m.to >= rowStart)
      .sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);

    const lanes = [[], []];
    let overflow = 0;
    for (const m of inWeek) {
      const col0 = Math.max(0, Math.round((m.from - rowStart) / 86400000));
      const col1 = Math.min(6, Math.round((m.to - rowStart) / 86400000));
      const lane = lanes.findIndex((L) => L.every((x) => x.col1 < col0 || x.col0 > col1));
      if (lane === -1) {
        overflow++;
        continue;
      }
      lanes[lane].push({ ...m, col0, col1 });
    }

    const used = lanes.filter((L) => L.length).length;
    if (used) row.classList.add(used >= 2 || overflow ? 'lane2' : 'lane1');

    lanes.forEach((lane, li) => {
      for (const m of lane) {
        const bar = document.createElement('div');
        bar.className = 'span' + (li === 1 ? ' l2' : '');
        bar.style.gridColumn = `${m.col0 + 1}/${m.col1 + 2}`;
        bar.style.background = `var(--cal-${m.ev.color ?? 1})`;
        // 주 경계를 넘으면 잘린 쪽 모서리를 각지게 해 이어짐을 알린다
        if (m.from < rowStart) {
          bar.classList.add('contL');
          const ar = document.createElement('span');
          ar.className = 'ar';
          ar.textContent = '◂';
          bar.append(ar);
        }
        bar.append(document.createTextNode(m.ev.title));
        if (m.to > rowEnd) {
          bar.classList.add('contR');
          const ar = document.createElement('span');
          ar.className = 'ar';
          ar.textContent = '▸';
          bar.append(ar);
        }
        row.append(bar);
      }
    });

    if (overflow) {
      const more = document.createElement('div');
      more.className = 'morespan';
      more.style.gridColumn = '7/8';
      const sp = document.createElement('span');
      sp.textContent = `+${overflow}`;
      more.append(sp);
      row.append(more);
    }

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

  el.body.replaceChildren(wrap);
}

function renderSubs() {
  el.dateLabel.textContent = '';
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

  el.body.replaceChildren(frag);
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

function openDialog(mode = 'event') {
  state.overlay = 'dlg';
  state.dlgMode = mode;
  el.scrim.classList.remove('hidden');
  el.dlg.classList.remove('hidden');
  el.dlgIn.value = '';
  const isSub = mode === 'sub';
  el.dlg.querySelector('label').textContent = isSub
    ? '구독 추가 — .ics 주소를 붙여 넣으세요'
    : '새 일정 — 한 줄로 적으세요';
  el.dlgIn.placeholder = isSub
    ? 'https://calendar.google.com/calendar/ical/…/basic.ics'
    : '담주 화 3시 김부장 미팅 1시간';
  el.dlgParse.innerHTML = isSub
    ? '<span class="no">구글 캘린더 설정 → 캘린더 통합 → 비공개 주소(iCal 형식)</span>'
    : '<span class="no">날짜·시각·제목을 알아서 읽습니다</span>';
  el.dlgIn.focus();
}

function closeOverlay() {
  state.overlay = null;
  el.scrim.classList.add('hidden');
  el.dlg.classList.add('hidden');
  el.keys.classList.add('hidden');
  el.dlgIn.blur();
}

async function previewParse() {
  if (state.dlgMode === 'sub') return; // 주소는 미리 볼 것이 없다
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
document.addEventListener('keydown', async (e) => {
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

  if (state.overlay === 'keys') {
    if (e.key === 'Escape' || e.key === '?' || e.key === '/') {
      e.preventDefault();
      closeOverlay();
    }
    return;
  }

  const k = e.key;

  if (k === 'Escape') {
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
    const step = { h: -1, ArrowLeft: null, l: 1, j: 7, k: -7, ArrowDown: 7, ArrowUp: -7 }[k];
    if (step != null) {
      e.preventDefault();
      state.anchor = addDays(state.anchor, step);
      await load();
      return;
    }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      const d = k === 'ArrowRight' ? 1 : -1;
      state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + d, 1);
      await load();
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

  if (k === 'x' || k === 'X' || k === 'ㅌ') {
    const ev = state.events[state.cursor];
    if (!ev) return;
    if (ev.calendarKind === 'subscription') {
      toast('구독으로 들어온 일정은 지울 수 없습니다');
      return;
    }
    await window.cal.remove(ev.id);
    state.undo.push(ev.id);
    await load();
    toast(`지웠습니다 — ${ev.title} · U로 되돌리기`);
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
  if (state.tab === 'subs') renderSubs();
  else if (state.tab === 'month') renderMonth(now);
  else if (state.tab === 'today') renderToday(now);
  else renderWeek(now);
}

const selectedSub = () => state.subs.filter((c) => c.kind === 'subscription')[state.cursor] ?? null;

el.body.addEventListener('click', (e) => {
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

// 화면에 "몇 분 남음"이 떠 있으므로 가만히 둬도 낡지 않게 한다
setInterval(() => {
  if (!state.overlay) rerender();
}, 30_000);

refreshInfo();
load();
