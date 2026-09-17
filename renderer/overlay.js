// renderer/overlay.js — 아일랜드를 그린다. 상태 계산은 하지 않는다(main/clock.mjs가 단일 진실).
// 여기가 정하는 것은 "그 상태를 어떤 색·두께·글자로 보일 것인가"뿐이다.
'use strict';

const R = 9;
const CIRC = 2 * Math.PI * R;

// 다가옴은 청록 → 호박 → 적으로 흐르고, 진행 중은 그 흐름 밖의 중립색이다.
const CALM = [110, 196, 255];
const WARN = [255, 194, 86];
const URGE = [255, 72, 72];
const LIVE = [110, 206, 175]; // --live
const GRAY = [150, 160, 175];

const isle = document.getElementById('isle');
const arc = document.getElementById('arc');
const elTitle = document.getElementById('title');
const elLeft = document.getElementById('left');
const elDots = document.getElementById('dots');
const elBadge = document.getElementById('badge');
const elMore = document.getElementById('more');

let hovering = false;
let last = null;

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [0, 1, 2].map((i) => Math.round(lerp(c1[i], c2[i], t)));
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const cssA = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// 임박도 0(여유) → 1(임박). 60분을 한 구간으로 본다 — 링이 도는 범위와 같다.
function urgency(leftSec) {
  return 1 - Math.min(1, Math.max(0, leftSec) / 3600);
}

function colorFor(p) {
  return p < 0.5 ? mix(CALM, WARN, p / 0.5) : mix(WARN, URGE, (p - 0.5) / 0.5);
}

function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtLeft(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  if (m >= 1) return `${m}분 남음`;
  return `${s}초 남음`;
}

function fmtEnd(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  if (m >= 1) return `${m}분 뒤 종료`;
  return `${s}초 뒤 종료`;
}

function render(p) {
  last = p;
  const root = document.documentElement.style;
  root.setProperty('--rsz', `${p.ringSize ?? 20}px`);

  let col;
  let visible = true;
  let title = p.title;
  let leftTxt = '';
  let badge = '';

  if (p.mode === 'during') {
    // 진행 중에는 중립색으로 물러나 있다가, 끝나기 5분 전에 다시 색이 들어온다 (OVL-08·09)
    col = p.endingSoon ? colorFor(0.78) : LIVE;
    leftTxt = fmtEnd(p.leftSec);
    badge = p.endingSoon ? '곧 종료' : '진행 중';
  } else if (p.mode === 'upcoming') {
    col = colorFor(urgency(p.leftSec));
    leftTxt = fmtLeft(p.leftSec);
  } else {
    // 오늘 남은 일정이 없으면 조용히 숨는다. 마우스를 올리면 다시 보인다 (OVL-10)
    col = GRAY;
    visible = hovering;
    title = '오늘 일정 끝';
  }

  const reveal = p.mode === 'idle' && hovering ? 1 : p.reveal;

  root.setProperty('--rv', reveal.toFixed(3));
  root.setProperty('--vis', visible ? '1' : '0');
  root.setProperty('--col', css(col));
  root.setProperty('--glow', cssA(col, 0.45));
  root.setProperty('--bdg', badge ? cssA(col, 0.18) : 'transparent');

  arc.style.strokeDasharray = CIRC;
  arc.style.strokeDashoffset = CIRC * (1 - (p.ratio ?? 0));

  elTitle.textContent = title;
  elLeft.textContent = leftTxt;
  elBadge.textContent = badge;
  elBadge.style.display = badge ? '' : 'none';

  elDots.replaceChildren(
    ...Array.from({ length: p.restCount ?? 0 }, (_, i) => {
      const dot = document.createElement('i');
      if (i === 0) dot.className = 'next';
      return dot;
    })
  );

  elMore.textContent = p.next ? `그 다음 ${p.next.title} · ${hhmm(p.next.startsAt)}` : '오늘 남은 일정 없음';

  document.body.classList.toggle('beat', !!p.beat);
}

// 창이 클릭을 통과시키므로 CSS :hover가 걸리지 않는다 — 직접 판정해 main에 알린다(D-04).
document.addEventListener('mousemove', (e) => {
  const r = isle.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (inside === hovering) return;
  hovering = inside;
  isle.classList.toggle('hover', inside);
  window.overlay.setHover(inside);
  if (last) render(last);
});

window.overlay.onState(render);
