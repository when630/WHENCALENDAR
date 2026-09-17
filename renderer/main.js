// renderer/main.js — 본체 창. 저장소에는 window.cal(preload)로만 닿는다.
'use strict';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const TABS = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '주' },
];

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
  const opts =
    state.tab === 'today'
      ? { day: state.anchor.toISOString(), days: 1 }
      : { day: mondayOf(state.anchor).toISOString(), days: 7 };

  const res = await window.cal.list(opts);
  state.events = res.events ?? [];
  if (state.cursor >= state.events.length) state.cursor = Math.max(0, state.events.length - 1);

  // 탭 배지 — 오늘은 오늘 건수, 주는 이번 주 건수
  const today = await window.cal.list({ day: new Date().toISOString(), days: 1 });
  const week = await window.cal.list({ day: mondayOf(new Date()).toISOString(), days: 7 });
  renderTabs({ today: today.events?.length ?? 0, week: week.events?.length ?? 0 });

  if (state.tab === 'today') renderToday(now);
  else renderWeek(now);
}

async function refreshInfo() {
  const info = await window.cal.info();
  el.led.classList.toggle('err', !info.storeOk);
  el.storeState.textContent = info.storeOk ? '이 PC에 저장됨' : `저장소 오류 (${info.reason})`;
}

// ── 한 줄 입력
let parseTimer = null;

function openDialog() {
  state.overlay = 'dlg';
  el.scrim.classList.remove('hidden');
  el.dlg.classList.remove('hidden');
  el.dlgIn.value = '';
  el.dlgParse.innerHTML = '<span class="no">날짜·시각·제목을 알아서 읽습니다</span>';
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
  if (state.tab === 'today') renderToday(now);
  else renderWeek(now);
}

el.body.addEventListener('click', (e) => {
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
