// F2 근거 대조 추적. 풀이 동안 「어느 원자료 문단이 언제 화면에 보였나」 이벤트를 받아, 채점할 때 장부 evidence와 맞춘다.
// 점수에는 넣지 않는다(설계안 4.1, 승인 3). 장부 판마다 다시 계산하므로 결과는 저장하지 않고 이벤트 원본만 저장한다(ss2:ev:<answerId>, 90일).
// 이벤트 = [t, type, ref, ms?]. t는 풀이 시작부터 잰 밀리초. view의 t는 「보이기 시작한 시각」, ms는 보인 시간이다.
export const TYPES = ['open', 'close', 'tab', 'view', 'tap', 'stage', 'mark', 'unmark', 'decide'];
export const MAX_EVENTS = 2000;
// 「근거를 보고 그었다」의 시간 범위(승인 1: 긋기 전 언제든). 바꿀 수 있게만 둔다. 골든 테스트가 값을 고정한다
export const WINDOW_MS = Infinity;

export const SRC_RE = /^[A-Z]-p\d+$/;
export const STAGE_RE = /^S\d+\./;
const refOf = (e) => String(typeof e === 'string' ? e : e?.ref ?? '').trim();
/** 장부 항목 evidence에서 원자료 문단만(문자열 배열·{ref} 배열 둘 다 받음) */
export const srcRefs = (it) => [...new Set((it.evidence ?? []).map(refOf).filter((r) => SRC_RE.test(r)))];
/** 장부 항목 evidence에서 앞 단계 단위가 속한 단계 키(S1.e4 → S1) */
export const stageRefs = (it) => [...new Set((it.evidence ?? []).map(refOf).filter((r) => STAGE_RE.test(r)).map((r) => r.split('.')[0]))];

/**
 * 받은 trace 검사. 객체가 아니면 null(답안은 정상 채점). 형식이 틀린 튜플·음수 t·모르는 type·이 판에 없는 ref는 버리고 partial로 표시한다.
 * docs가 없으면(가짜 판) 문단 ref는 형식만 본다.
 */
export function sanitizeTrace(trace, run, docs) {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace) || !Array.isArray(trace.events)) return null;
  const units = new Set(run.stages.flatMap((s) => s.units.map((u) => u.uid)));
  const stageKeys = new Set(run.stages.map((s) => s.key));
  const pids = docs ? new Set(Object.values(docs).flatMap((d) => d.paragraphs.map((p) => p.pid))) : null;
  const docKeys = docs ? new Set(Object.keys(docs)) : null;
  const okRef = (type, ref) => {
    if (type === 'open' || type === 'close') return ref === '';
    if (type === 'tab') return docKeys ? docKeys.has(ref) : /^[A-Z]$/.test(ref);
    if (type === 'view' || type === 'tap') return pids ? pids.has(ref) : SRC_RE.test(ref);
    if (type === 'stage') return stageKeys.has(ref);
    if (type === 'mark' || type === 'unmark') return units.has(ref);
    if (type === 'decide') return ref === 'approve' || ref === 'reject';
    return false;
  };
  const raw = trace.events.slice(0, MAX_EVENTS);
  let bad = trace.events.length - raw.length;
  const events = [];
  for (const e of raw) {
    if (!Array.isArray(e) || e.length < 3 || e.length > 4) { bad++; continue; }
    const [t, type, ref, ms] = e;
    if (!Number.isFinite(t) || t < 0 || !TYPES.includes(type) || typeof ref !== 'string' || !okRef(type, ref)) { bad++; continue; }
    if (e.length === 4 && !(Number.isFinite(ms) && ms >= 0)) { bad++; continue; }
    events.push(e.length === 4 ? [Math.round(t), type, ref, Math.round(ms)] : [Math.round(t), type, ref]);
  }
  events.sort((a, b) => a[0] - b[0]); // 같은 t는 들어온 순서를 지킨다(안정 정렬)
  const dropped = (Number.isFinite(trace.dropped) && trace.dropped > 0 ? Math.round(trace.dropped) : 0) + bad;
  return { v: 1, events, dropped, partial: dropped > 0 || !!trace.partial };
}

/**
 * 채점 때 계산(순수 함수). marks = 채점에 쓴 표시(중복·없는 칸을 뺀 것).
 * 반환: { v, partial, engaged, seenParas, totalParas, found:{n, checked, stage, na}, missed:{n, neverLooked, na}, items:[…] }
 *  - 찾은 A 항목: 그 항목에 그은 줄의 「살아남은 마지막 mark 시각」 전에 근거 문단을 봤으면 checked 'source',
 *    원자료는 아니어도 근거의 앞 단계를 펼쳤으면 'stage', 아니면 null. 근거 문단이 없는 항목은 'n/a'(분모에서 뺌)
 *  - 놓친 A 항목: 풀이 동안 근거 문단이 한 번이라도 보였으면 looked true
 */
export function evidenceUseOf(run, ledger, marks, trace, docs) {
  const s = sanitizeTrace(trace, run, docs);
  if (!s) return null;
  const ev = s.events;
  const markedUids = new Set((marks ?? []).map((m) => m.uid));
  // 단위마다 살아남은 마지막 mark 시각. mark 이벤트가 없으면(복원된 draft 등) 제출 시각(=끝)으로 본다
  const lastMark = new Map();
  for (const [t, type, ref] of ev) {
    if (type === 'mark') lastMark.set(ref, t);
    else if (type === 'unmark') lastMark.set(ref, null);
  }
  const markTime = (uid) => lastMark.get(uid) ?? Infinity;
  // te가 줄 긋기 시각 t 이전이고 범위 안(WINDOW_MS가 Infinity이면 범위 없음)
  const inWindow = (te, t) => te <= t && (!Number.isFinite(WINDOW_MS) || !Number.isFinite(t) || te >= t - WINDOW_MS);
  const sawBefore = (pidSet, t) => ev.some(([te, type, ref]) => (type === 'view' || type === 'tap') && pidSet.has(ref) && inWindow(te, t));
  const openedBefore = (keys, t) => ev.some(([te, type, ref]) => type === 'stage' && keys.has(ref) && inWindow(te, t));
  const seen = new Set(ev.filter(([, type]) => type === 'view' || type === 'tap').map((e) => e[2]));
  const A = ledger.items.filter((x) => !x.deleted && x.grade === 'A');
  const items = A.map((it) => {
    const refs = srcRefs(it); const stages = stageRefs(it);
    const hit = [it.origin, ...(it.spread ?? [])].filter((u) => markedUids.has(u));
    const seenRefs = refs.filter((r) => seen.has(r));
    if (hit.length) {
      const t = Math.max(...hit.map(markTime));
      const checked = refs.length && sawBefore(new Set(refs), t) ? 'source' : stages.length && openedBefore(new Set(stages), t) ? 'stage' : refs.length ? null : 'n/a';
      return { id: it.id, found: true, checked, refs, seen: seenRefs };
    }
    return { id: it.id, found: false, looked: refs.length ? seenRefs.length > 0 : null, refs, seen: seenRefs };
  });
  const f = items.filter((x) => x.found); const m = items.filter((x) => !x.found);
  const totalParas = docs ? Object.values(docs).reduce((n, d) => n + d.paragraphs.length, 0) : null;
  return {
    v: 1, partial: s.partial,
    engaged: ev.some(([, type]) => ['open', 'tab', 'view', 'tap'].includes(type)),
    seenParas: seen.size, totalParas,
    found: { n: f.filter((x) => x.refs.length).length, checked: f.filter((x) => x.checked === 'source').length, stage: f.filter((x) => x.checked === 'stage').length, na: f.filter((x) => !x.refs.length).length },
    missed: { n: m.filter((x) => x.refs.length).length, neverLooked: m.filter((x) => x.looked === false).length, na: m.filter((x) => !x.refs.length).length },
    items,
  };
}
