// main/search.mjs — 일정 제목 찾기 (SRCH-01~03).
//
// 부분 문자열과 한글 초성 둘 다 받는다. "ㄷㅈㅇ"로 "디자인 리뷰"가 찾아져야 한다 —
// WHENNOTE와 같은 규칙이다. 형제 앱을 오가며 검색 감각이 달라지면 안 된다.
//
// Electron을 import하지 않는 순수 모듈이라 node --test로 검증한다.

const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

// 한 글자를 초성으로. 한글이 아니면 그대로 둔다(숫자·영문도 검색어가 된다).
export function toChoseong(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    const c = ch.codePointAt(0);
    out += c >= HANGUL_BASE && c <= HANGUL_LAST ? CHO[Math.floor((c - HANGUL_BASE) / 588)] : ch;
  }
  return out;
}

// 검색어가 초성으로만 되어 있는가. "ㄷㅈㅇ"는 초성 검색, "디자인"은 그냥 부분 문자열이다.
export function isChoseongQuery(q) {
  const s = String(q ?? '').replace(/\s+/g, '');
  return s.length > 0 && [...s].every((ch) => CHO.includes(ch));
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

export function matches(text, query) {
  const q = norm(query);
  if (!q) return false;
  const t = norm(text);
  if (t.includes(q)) return true;
  // 초성 검색은 검색어가 초성으로만 되어 있을 때만 — 그러지 않으면 "가"가 온갖 것에 걸린다
  if (isChoseongQuery(query)) return toChoseong(t).includes(q);
  return false;
}

// 강조할 구간 [start, end). 못 찾으면 null.
export function matchRange(text, query) {
  const raw = String(text ?? '');
  const q = norm(query);
  if (!q) return null;

  // 공백을 지운 좌표에서 찾은 뒤 원문 좌표로 되돌린다
  const map = [];
  let packed = '';
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) continue;
    packed += raw[i].toLowerCase();
    map.push(i);
  }

  let at = packed.indexOf(q);
  if (at === -1 && isChoseongQuery(query)) at = toChoseong(packed).indexOf(q);
  if (at === -1) return null;
  return [map[at], map[Math.min(at + q.length - 1, map.length - 1)] + 1];
}
