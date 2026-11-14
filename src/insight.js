// 결과 화면에 붙는 지표(모두 순수 함수, 결재 뒤 응답에서만 쓴다). 점수에는 넣지 않는다.
//  F8 provenanceOf: 장부 항목마다 출처(어느 감사가 짚었나·코드 대조·사람 검수·등급/처음 생긴 곳 변경 이력)
//  F7 crowdOf: 처음 푼 사람(만든 사람 제외) 가운데 그 항목을 찾은 비율. 5명 미만이면 숫자를 내지 않는다
//  F5 patternSkill: 패턴별 찾음/놓침과 베이즈 평균(사전 평균 1/2, 무게 2)
import { norm, quoteIn } from './text.js';

const refsOf = (it) => [it.origin, ...(it.spread ?? [])];
const logKey = (l) => `${l.at}|${l.item}|${l.action}`;
export const CROWD_MIN = 5;

/** L = 보여 줄 장부 판, versions = 이 판의 장부 판 전부(오래된 것부터), docs = 원자료, run = 작업 기록 */
export function provenanceOf(L, versions, docs, run) {
  const paras = new Map(Object.values(docs ?? {}).flatMap((d) => d.paragraphs.map((p) => [p.pid, p.text])));
  const units = new Map(run.stages.flatMap((s) => s.units.map((u) => [u.uid, u.text])));
  // 검수 이력 한 줄이 처음 들어간 장부 판(초안은 앞 판의 이력을 이어 쓰므로, 처음 나타난 판이 그 변경이 확정된 판이다)
  const firstIn = new Map();
  for (const v of versions) for (const l of v.reviewLog ?? []) if (!firstIn.has(logKey(l))) firstIn.set(logKey(l), v.version);
  const since = (id) => versions.find((v) => v.items.some((x) => x.id === id))?.version ?? L.version;
  const log = L.reviewLog ?? [];
  const audits = (L.audits ?? []).map((a) => a.company);
  return Object.fromEntries(L.items.map((it) => {
    const by = Object.keys(it.byAudit ?? {});
    const quotes = (it.evidence ?? []).map((e) => {
      const ref = String(typeof e === 'string' ? e : e?.ref ?? '');
      const text = paras.get(ref) ?? units.get(ref);
      const quote = typeof e === 'string' ? '' : String(e?.quote ?? '');
      return { ref, exists: text != null, verbatim: quote ? (text != null && quoteIn(quote, text)) : null };
    });
    const withQuote = quotes.filter((q) => q.verbatim !== null);
    const unitText = units.get(it.origin);
    const conf = log.filter((l) => l.item === it.id && /^(confirmOrigin|autoConfirmOrigin)$/.test(l.action)).at(-1);
    const changes = log.filter((l) => l.item === it.id && /^edit:(grade|origin)$/.test(l.action))
      .map((l) => ({ field: l.action.slice(5), before: l.before, after: l.after, at: l.at, inVersion: firstIn.get(logKey(l)) ?? L.version }));
    return [it.id, {
      audits: { by, n: by.length, of: audits.length, companies: audits, grades: Object.fromEntries(by.map((c) => [c, it.byAudit[c].grade ?? null])) },
      codeCheck: {
        // 지금 장부의 근거 인용이 원자료(또는 앞 단계 글)에 글자 그대로 있나. 문단만 지정한 근거는 verbatim null
        quotes, quotesVerbatim: withQuote.length ? withQuote.every((q) => q.verbatim) : null,
        refsExist: quotes.every((q) => q.exists),
        // 틀린 구절이 처음 생긴 곳 글에 그대로 있나(구절이 비었으면 null)
        wrongInUnit: norm(it.wrongText).length >= 2 ? (unitText != null && norm(unitText).includes(norm(it.wrongText))) : null,
        // 감사가 낸 원래 항목의 코드 대조(장부를 만들 때 이미 한 것)
        byAudit: Object.fromEntries(by.filter((c) => it.byAudit[c].code).map((c) => {
          const k = it.byAudit[c].code;
          return [c, { wrongInUnit: !!k.wrongInUnit, evidenceFound: (k.evidence ?? []).filter((e) => e.found).length, evidenceTotal: (k.evidence ?? []).length, badRefs: (k.badRefs ?? []).length, numNotInSource: (k.numNotInSource ?? []).length }];
        })),
      },
      human: {
        review: it.review ?? null, source: it.source ?? null,
        // 처음 생긴 곳 확정: 사람이 고름(human, 사람이 추가한 항목 포함) / 감사 둘 이상이 같은 칸이라 자동(auto) / 확정 안 됨(null)
        originConfirmed: it.originConfirmed ? (conf?.action === 'confirmOrigin' || (!conf && it.review === 'added') ? 'human' : conf?.action === 'autoConfirmOrigin' ? 'auto' : 'yes') : null,
      },
      changes, since: since(it.id), ledgerVersion: L.version,
    }];
  }));
}

/** answers = 처음 푼 답안 원문(만든 사람 제외). 항목마다 { n, found, rate } — n < 5이면 found·rate는 null */
export function crowdOf(L, answers, run) {
  const units = new Set(run.stages.flatMap((s) => s.units.map((u) => u.uid)));
  const sets = answers.map((a) => new Set((a.marks ?? []).map((m) => m.uid).filter((u) => units.has(u))));
  const n = sets.length;
  return Object.fromEntries(L.items.map((it) => {
    const k = sets.filter((s) => refsOf(it).some((u) => s.has(u))).length;
    return [it.id, n >= CROWD_MIN ? { n, found: k, rate: Math.round((k / n) * 100) / 100 } : { n, found: null, rate: null }];
  }));
}

/** scored = scoreAnswer 결과 목록(판마다 하나). A 항목만 센다. mastery = (찾음 + 1) / (n + 2) */
export function patternSkill(scored) {
  const by = new Map();
  for (const r of scored) for (const p of r.perItem) {
    if (p.grade !== 'A') continue;
    const x = by.get(p.pattern) ?? { pattern: p.pattern, found: 0, missed: 0 };
    x[p.found ? 'found' : 'missed']++;
    by.set(p.pattern, x);
  }
  const patterns = [...by.values()].map((x) => {
    const n = x.found + x.missed;
    return { ...x, n, mastery: Math.round(((x.found + 1) / (n + 2)) * 100) / 100, early: n < 3 };
  }).sort((a, b) => a.mastery - b.mastery || b.n - a.n || a.pattern.localeCompare(b.pattern));
  return { runs: scored.length, prior: { mean: 0.5, weight: 2 }, patterns };
}
