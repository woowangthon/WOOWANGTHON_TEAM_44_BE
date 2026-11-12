// 오류 심기 중 코드가 직접 바꾸는 유형: 숫자, 단위·자릿수, 방향. 모델이 쓰는 유형(원자료에 없는 주장,
// 근거보다 큰 결론)은 pipeline.js에서 모델을 부르고, 여기의 검사 함수로 확인한다.
import { numbers, hasNumber, sourceText, norm } from './text.js';

/** 화면에서 고르는 사유. 오류 유형 → 사유 */
export const REASONS = ['숫자·단위', '원자료에 없음', '방향·주체가 바뀜', '계산', '근거보다 큰 결론', '기타'];
export const REASON_OF = {
  number: '숫자·단위', unit: '숫자·단위', direction: '방향·주체가 바뀜',
  unsupported: '원자료에 없음', overclaim: '근거보다 큰 결론', calc: '계산',
};

const withCommas = (intStr) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function formatLike(original, value) {
  const [i, d] = value.split('.');
  const intPart = /,/.test(original) ? withCommas(i) : i;
  return d !== undefined ? `${intPart}.${d}` : intPart;
}

/** 값 하나에 대해 그럴듯한 다른 값 후보들 */
export function altValues(value, kind) {
  const out = new Set();
  const [i, d] = value.split('.');
  if (kind === 'year') {
    const y = Number(i);
    [y - 1, y + 1, y - 2].filter((v) => v >= 0).forEach((v) => out.add(String(v).padStart(i.length, '0')));
    out.delete(value);
    return [...out];
  }
  if (d) {
    const last = Number(d.at(-1));
    for (const k of [2, 3, 1, 4]) {
      for (const n of [last + k, last - k]) if (n >= 0 && n <= 9) out.add(`${i}.${d.slice(0, -1)}${n}`);
    }
    if (i.length >= 2 && i[0] !== i[1]) out.add(`${i[1]}${i[0]}${i.slice(2)}.${d}`);
  } else {
    // 100, 3,000처럼 끝이 0인 수는 102 같은 어색한 값을 만들지 않는다. 세 자리 이상은 둘째 자리를 먼저 바꾼다
    // (100 → 110). 100 → 200은 한눈에 보여 너무 쉬웠다(G1 풀이, 11/12)
    const n0 = Number(i);
    if (n0 >= 10 && n0 % 10 === 0) {
      const lead = 10 ** (i.length - 1);
      if (i.length >= 3) out.add(String(n0 + lead / 10)), n0 - lead / 10 > 0 && out.add(String(n0 - lead / 10));
      out.add(String(n0 + lead));
      if (n0 - lead > 0) out.add(String(n0 - lead));
    }
    if (i.length >= 2 && i.at(-1) !== i.at(-2)) out.add(i.slice(0, -2) + i.at(-1) + i.at(-2));
    const n = Number(i);
    if (n >= 3) for (const k of [2, 3, 1]) out.add(String(n + k)), n - k > 0 && out.add(String(n - k));
    if (i.length >= 3) out.add(i[0] + String((Number(i[1]) + 3) % 10) + i.slice(2));
  }
  out.delete(value);
  const max = kind === 'month' ? 12 : kind === 'day' ? 28 : Infinity;
  return [...out].filter((v) => !/^0\d/.test(v) && (max === Infinity || (Number(v) >= 1 && Number(v) <= max)));
}

const replaceAt = (s, index, from, to) => s.slice(0, index) + to + s.slice(index + from.length);

/**
 * 숫자 바꿈. 문장의 숫자 가운데 근거 문단에 있는 것 하나를 골라, 원자료 어디에도 같은 표기로 없는 값으로 바꾼다.
 * 돌려주는 값: { after, detail } 또는 null
 */
export function plantNumber(sentence, source, rand) {
  const all = sourceText(source);
  const toks = numbers(sentence).filter((t) => ['n', 'pct', 'pctp', 'year', 'years', 'months', 'month', 'day'].includes(t.kind) && hasNumber(t, all));
  if (!toks.length) return null;
  const order = toks.map((t) => [rand(), t]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  for (const t of order) {
    for (const v of altValues(t.value, t.kind)) {
      const cand = { ...t, value: v };
      if (hasNumber(cand, all)) continue;
      const numStr = t.raw.match(/^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/)[0];
      const newRaw = formatLike(numStr, v) + t.raw.slice(numStr.length);
      return { after: replaceAt(sentence, t.index, t.raw, newRaw), detail: `${t.raw.trim()} → ${newRaw.trim()}` };
    }
  }
  return null;
}

/** 단위·자릿수: 만↔천, %↔%p. 바꾼 표기가 원자료에 없을 때만 */
export function plantUnit(sentence, source, rand) {
  const all = sourceText(source);
  const swaps = [];
  for (const t of numbers(sentence)) {
    if (!hasNumber(t, all)) continue;
    if ((t.mag === '만' || t.mag === '천') && !t.value.includes('.')) {
      // 정수는 자릿수 단위를 바꾼다(3만 명 → 3천 명)
      const mag = t.mag === '만' ? '천' : '만';
      swaps.push({ t, newTok: { ...t, mag }, newRaw: t.raw.replace(t.mag, mag) });
    } else if (t.mag && t.value.includes('.')) {
      // 소수는 소수점을 한 자리 옮긴다(21.1만 → 211만). 21.1천 같은 어색한 표기를 만들지 않는다
      const [i, d] = t.value.split('.');
      const shifted = d.length === 1 ? `${i}${d}` : `${i}${d[0]}.${d.slice(1)}`;
      const numStr = t.raw.match(/^[\d,]+(\.\d+)?/)[0];
      swaps.push({ t, newTok: { ...t, value: shifted }, newRaw: shifted + t.raw.slice(numStr.length) });
    }
    if (t.kind === 'pctp') swaps.push({ t, newTok: { ...t, kind: 'pct' }, newRaw: t.raw.replace(/%p|%포인트|퍼센트포인트/, '%') });
    if (t.kind === 'pct') swaps.push({ t, newTok: { ...t, kind: 'pctp' }, newRaw: t.raw.replace(/%|퍼센트/, '%p') });
  }
  const ok = swaps.filter((s) => !hasNumber(s.newTok, all));
  if (!ok.length) return null;
  const s = ok[Math.floor(rand() * ok.length)];
  return { after: replaceAt(sentence, s.t.index, s.t.raw, s.newRaw), detail: `${s.t.raw.trim()} → ${s.newRaw.trim()}` };
}

// [증가 쪽, 감소 쪽]. 긴 것부터 맞춘다.
export const DIRECTION_PAIRS = [
  ['늘어났', '줄어들었'], ['늘어난', '줄어든'], ['늘어나', '줄어들'], ['늘었', '줄었'], ['늘고', '줄고'], ['늘어', '줄어'],
  ['급증', '급감'], ['증가', '감소'], ['상승', '하락'], ['확대', '축소'], ['개선', '악화'],
  ['올랐', '내렸'], ['오른', '내린'], ['높아졌', '낮아졌'], ['높아', '낮아'], ['높았', '낮았'], ['높은', '낮은'],
  ['웃돌', '밑돌'], ['상회', '하회'], ['흑자', '적자'],
].sort((a, b) => Math.max(b[0].length, b[1].length) - Math.max(a[0].length, a[1].length));

const NO_PLANT = new Set(['개선', '악화']);

/** 글에 나오는 방향 낱말 목록 [{word, pol: +1|-1, index, to}] (겹치는 것은 긴 것만) */
export function directionWords(text) {
  const s = String(text ?? '');
  const hits = [];
  const taken = new Array(s.length).fill(false);
  for (const [up, down] of DIRECTION_PAIRS) {
    for (const [w, pol, to] of [[up, 1, down], [down, -1, up]]) {
      let i = s.indexOf(w);
      while (i >= 0) {
        if (!taken.slice(i, i + w.length).some(Boolean)) {
          hits.push({ word: w, pol, index: i, to });
          for (let k = i; k < i + w.length; k++) taken[k] = true;
        }
        i = s.indexOf(w, i + 1);
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * 방향 뒤바꿈. 문장의 방향 낱말을 반대말로 바꾼다. 근거 인용이 한쪽 방향만 말하고(양쪽이 섞이지 않고)
 * 문장의 방향과 같을 때만 쓴다. 뜻이 실제로 뒤집혔는지는 점검 모델이 한 번 더 본다(P4).
 */
export function plantDirection(sentence, quotes, rand) {
  const q = quotes.join(' ');
  const qPols = new Set(directionWords(q).map((h) => h.pol));
  if (qPols.size !== 1) return null;
  const [pol] = qPols;
  // 개선↔악화는 「관행을 악화하는 데 중점」처럼 원자료 없이도 티 나는 문장을 만들기 쉬워 심지 않는다
  const cands = directionWords(sentence).filter((h) => h.pol === pol && !NO_PLANT.has(h.word));
  if (!cands.length) return null;
  const h = cands[Math.floor(rand() * cands.length)];
  return { after: replaceAt(sentence, h.index, h.word, h.to), detail: `${h.word} → ${h.to}` };
}

// 근거보다 큰 결론의 재료: 원자료 인용에 있는 한정어
export const HEDGES = ['추정', '전망', '예상', '계획', '예정', '가능성', '검토', '일부', '방침', '목표', '잠정', '추진', '약 ', '최대 ', '까지', '수 있', '것으로 보', '안팎', '내외', '중 하나'];
export const hedgesIn = (text) => HEDGES.filter((h) => norm(text).includes(h.trim()) && (h.endsWith(' ') ? norm(text).includes(h) : true));

/** 바꾼 문장에서 원래 문장의 한정어가 빠졌는가 */
export const droppedHedges = (before, after) => hedgesIn(before).filter((h) => !hedgesIn(after).includes(h));
