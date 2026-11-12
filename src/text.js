// 글자 다루기: 정규화, 숫자 토큰 뽑기와 대조, 인용 대조. 모델 없이 코드로만 판정하는 부분이다.

/** 비교용 정규화: 유니코드 NFC, 따옴표·가운뎃점 통일, 공백 한 칸 */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[ㆍ・･]/g, '·')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAG = '조|억|만|천';
// 숫자(쉼표·소수점) + 선택 공백 + 선택 자릿수 단위 + 선택 공백 + 선택 %/%p/세는 말
const NUM_RE = new RegExp(
  String.raw`(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?` +
    String.raw`(?:\s?(${MAG}))?` +
    String.raw`(?:\s?(%p|%포인트|퍼센트포인트|%|퍼센트|개월|년|월|일|시간|명|개|건|곳|원|배|세|위|회|가구|개사|개소|호|주|분기))?`,
  'g',
);

function kindOf(value, unit) {
  if (!unit) return 'n';
  if (/^(%p|%포인트|퍼센트포인트)$/.test(unit)) return 'pctp';
  if (/^(%|퍼센트)$/.test(unit)) return 'pct';
  if (unit === '년') return Number(value) >= 1900 && Number(value) <= 2100 && !value.includes('.') ? 'year' : 'years';
  if (unit === '월') return 'month';
  if (unit === '개월') return 'months';
  if (unit === '일') return 'day';
  if (unit === '분기') return 'quarter';
  return 'n';
}

/**
 * 숫자 토큰 목록. value는 쉼표를 뺀 숫자 문자열(소수점 유지), mag는 자릿수 단위, kind는 대조 범주.
 * 세는 말(명, 개, 건…)은 표기 차이가 흔하므로 범주를 'n' 하나로 묶고, %·%p·연도·월·일은 따로 본다.
 */
export function numbers(text) {
  const s = String(text ?? '').normalize('NFC');
  const out = [];
  for (const m of s.matchAll(NUM_RE)) {
    const value = m[1].replace(/,/g, '') + (m[2] ?? '');
    const unit = m[4] ?? '';
    // ’25년처럼 앞을 줄인 연도는 연도로 본다
    const short = unit === '년' && /^\d{2}$/.test(value) && /[‘’'`]/.test(s[m.index - 1] ?? '');
    out.push({ raw: m[0], index: m.index, value, mag: m[3] ?? '', unit, kind: short ? 'year' : kindOf(value, unit) });
  }
  return out;
}

const sameNum = (a, b) => a.value === b.value && a.mag === b.mag && a.kind === b.kind;

/** 토큰 하나가 글(근거 문단)에 같은 값·자릿수·범주로 있는가 */
export const hasNumber = (token, text) => numbers(text).some((t) => sameNum(t, token));

/** 문장의 숫자 가운데 근거 글에 없는 것 */
export const missingNumbers = (sentence, evidenceText) =>
  numbers(sentence).filter((t) => !hasNumber(t, evidenceText));

/** 인용이 문단에 글자 그대로 있는가(정규화 뒤 부분 문자열) */
export const quoteIn = (quote, paragraph) => {
  const q = norm(quote);
  return q.length >= 4 && norm(paragraph).includes(q);
};

/** 결과물 문장 하나의 깨끗함 검사: 인용이 모두 문단에 있고, 숫자가 모두 인용한 문단에 있다 */
export function checkSentence(sentence, support, paraById) {
  const problems = [];
  if (!support?.length) problems.push('근거 인용 없음');
  for (const s of support ?? []) {
    const p = paraById.get(s.pid);
    if (!p) problems.push(`없는 문단 ${s.pid}`);
    else if (!quoteIn(s.quote, p.text)) problems.push(`인용이 ${s.pid}에 그대로 없음: "${s.quote}"`);
  }
  const evidence = (support ?? []).map((s) => paraById.get(s.pid)?.text ?? '').join('\n');
  for (const t of missingNumbers(sentence, evidence)) problems.push(`숫자 "${t.raw.trim()}"가 근거 문단에 같은 표기로 없음`);
  return problems;
}

/** 원자료 전체 글 */
export const sourceText = (source) => source.paragraphs.map((p) => p.text).join('\n');

/** 결정적 난수(시드). 같은 시드면 같은 과제가 나온다 */
export function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
