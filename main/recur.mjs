// main/recur.mjs — 저장된 RRULE을 창(window) 범위만큼 펼친다 (SUB-07).
//
// 미리 펼쳐서 저장하지 않는 이유는 03_기술_스펙 §4에 적었다 — 조회 범위가 늘 좁고(오늘·이번 주),
// 미리 펼치면 `.ics`가 바뀔 때마다 지우고 다시 만들어야 한다.
//
// Electron을 import하지 않는 순수 모듈이라 node --test로 검증한다.
import ICAL from 'ical.js';

const MS = (iso) => new Date(iso).getTime();

// 한 번 조회에 펼칠 수 있는 최대 회차. 잘못 만들어진 무한 반복(`FREQ=SECONDLY` 같은)에
// 걸려 앱이 멈추는 것을 막는다 — 오늘 하루에 5천 건이 필요한 캘린더는 없다.
const MAX_OCCURRENCES = 5000;

/**
 * 반복 일정 하나를 범위 안의 회차들로 펼친다.
 *
 * @param ev   { id, title, startsAt, endsAt, rrule, exdates, ... }
 * @param from ISO — 범위 시작
 * @param to   ISO — 범위 끝 (미포함)
 * @returns 펼쳐진 일정 배열. 원본과 같은 모양이고 occurrenceOf·recurrenceId가 붙는다.
 */
export function expandOne(ev, from, to) {
  if (!ev?.rrule) return overlaps(ev, from, to) ? [ev] : [];

  const fromMs = MS(from);
  const toMs = MS(to);
  const startMs = MS(ev.startsAt);
  if (!Number.isFinite(startMs)) return [];

  const durMs = ev.endsAt ? Math.max(0, MS(ev.endsAt) - startMs) : 0;

  // 시작 전에 끝나는 범위면 볼 것이 없다
  if (toMs <= startMs) return [];

  const skip = new Set((ev.exdates ?? []).map((d) => MS(d)));
  // 이 회차만 고치거나 취소한 것 (EV-07). 키는 원래 시작 시각이다.
  const overrides = new Map((ev.overrides ?? []).map((o) => [MS(o.recurrenceId), o]));

  let iterator;
  try {
    const dtstart = ICAL.Time.fromJSDate(new Date(startMs), false);
    const recur = ICAL.Recur.fromString(ev.rrule);
    iterator = recur.iterator(dtstart);
  } catch {
    // 규칙을 못 읽으면 반복을 포기하고 원본 한 건만 본다 — 일정이 사라지는 것보다 낫다
    return overlaps(ev, from, to) ? [ev] : [];
  }

  const out = [];
  let guard = 0;
  for (let next = iterator.next(); next; next = iterator.next()) {
    if (++guard > MAX_OCCURRENCES) break;

    const s = next.toJSDate().getTime();
    if (s >= toMs) break; // 범위를 지났다 — 반복은 시간순이므로 여기서 끝
    const e = s + durMs;
    if (e <= fromMs) continue; // 아직 범위 앞이다
    if (skip.has(s)) continue; // EXDATE

    const ov = overrides.get(s);
    if (ov?.cancelled) continue; // 이 회차만 취소

    out.push({
      ...ev,
      title: ov?.title ?? ev.title,
      startsAt: ov?.startsAt ?? new Date(s).toISOString(),
      endsAt: ov?.endsAt ?? (ev.endsAt ? new Date(e).toISOString() : null),
      occurrenceOf: ev.id ?? ev.uid ?? null,
      recurrenceId: new Date(s).toISOString(),
      edited: !!ov,
    });
  }
  return out;
}

// 여러 건을 한꺼번에. 반복이 없는 것은 그대로 지나간다.
export function expand(events, from, to) {
  const out = [];
  for (const ev of events ?? []) out.push(...expandOne(ev, from, to));
  return out.sort((a, b) => MS(a.startsAt) - MS(b.startsAt));
}

// 범위와 겹치는가. 끝이 없는 일정은 시작 시각만으로 본다 — store.listBetween과 같은 규칙이다.
export function overlaps(ev, from, to) {
  if (!ev?.startsAt) return false;
  const s = MS(ev.startsAt);
  const e = ev.endsAt ? MS(ev.endsAt) : s;
  return s < MS(to) && Math.max(e, s) > MS(from);
}
