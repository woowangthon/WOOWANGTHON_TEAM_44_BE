export const GRADES = ['observe', 'report', 'control_review'];
export const GRADE_KO = { observe: '관찰', report: '보고 권고', control_review: '통제 검토 요청 권고' };
export const ACTION_KO = { report: '보고', control_review: '통제 검토 요청', hold: '보류' };
export const CHANNEL_KO = {
  phone_memo: '전화 메모', disaster_sms: '재난문자', agency_notice: '기관 통보문',
  police_112: '112 공조', fire_119: '119 공동대응', system_alert: '시스템 알림',
};

export const gradeRank = (g) => GRADES.indexOf(g);
export const maxGrade = (a, b) => (gradeRank(a) >= gradeRank(b) ? a : b);

export function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 공백·따옴표 차이만 흡수한 비교용 문자열
export function norm(s) {
  return String(s ?? '')
    .replace(/[“”「」『』"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const isSubstring = (part, whole) => {
  const p = norm(part);
  return p.length > 0 && norm(whole).includes(p);
};

// 초안·요약 속 검증 대상 토큰: 시각(HH:MM, HH시 MM분, HH시), 단위가 붙은 수
export function numericClaims(text) {
  const s = String(text ?? '');
  const out = new Set();
  for (const m of s.matchAll(/(\d{1,2}):(\d{2})/g)) out.add(`T${+m[1]}:${m[2]}`);
  for (const m of s.matchAll(/(\d{1,2})시\s?(\d{1,2})분/g)) out.add(`T${+m[1]}:${m[2].padStart(2, '0')}`);
  for (const m of s.matchAll(/(\d{1,2})시(?!\s?\d{1,2}분)(?![간])/g)) out.add(`T${+m[1]}:00`);
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s?(m|cm|mm|센티미터|미터|건|%)(?![a-z])/g)) {
    const unit = { 센티미터: 'cm', 미터: 'm' }[m[2]] ?? m[2];
    out.add(`N${parseFloat(m[1])}${unit}`);
  }
  return out;
}

export function corpusClaims(texts) {
  const all = new Set();
  for (const t of texts) for (const c of numericClaims(t)) all.add(c);
  // "06시경"은 06:00으로 이미 들어감. 시각은 정시 근사도 허용하지 않는다.
  return all;
}

export function unsupportedClaims(text, corpus) {
  return [...numericClaims(text)].filter((c) => !corpus.has(c));
}

// 화면 문장에 섞이면 안 되는 내부 코드: 기준(C1)·조항(M3-1-2)·연락처(K1)·시설(F1)·장소(P1)·관측소(G1) id, 판정 영문 코드
export function internalCodes(text) {
  const s = String(text ?? '');
  const ids = s.match(/(?<![A-Za-z0-9])[CMKFPG]\d+(?:-\d+)*(?![A-Za-z0-9])/g) ?? [];
  const codes = s.match(/(?<![A-Za-z_])(?:met|not_met|approaching|unknown|observe|control_review)(?![A-Za-z_])/g) ?? [];
  return [...new Set([...ids, ...codes])];
}

export const clone = (x) => structuredClone(x);
