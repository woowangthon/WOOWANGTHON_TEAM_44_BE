// 사수 모드 채점. 사람 검수가 끝난 장부(reviewed)의 A등급 항목으로만 점수를 매긴다. B·C는 피드백으로만 쓴다.
// 근원 가점은 미영이 근원을 확정한(originConfirmed) 항목에서만 준다.
// 후보 칸(spreadCandidates)에 그은 줄은 「판단이 갈리는 칸」(splitMarks): 찾음도 헛짚음도 아니다(B·C 칸과 같이 정확도에서 깎지 않는다).
// F2 근거 대조(evidenceUse)는 지표로만 더한다. 점수 공식(50·20·20·10)은 바꾸지 않는다.
import { finalKeys, loadMission, loadDocs } from './mission.js';
import { evidenceUseOf } from './trace.js';

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const refsOf = (it) => [it.origin, ...(it.spread ?? [])];
const docsCache = new Map();
/** 판의 원자료(근거 대조에 씀). 가짜 판(미션 없음)이면 null */
export function docsOf(run) {
  if (!run?.missionId) return null;
  if (!docsCache.has(run.missionId)) { try { docsCache.set(run.missionId, loadDocs(loadMission(run.missionId))); } catch { docsCache.set(run.missionId, null); } }
  return docsCache.get(run.missionId);
}

/**
 * answer = { marks: [{ uid, pattern?, origin?: bool, note? }], decision: 'approve'|'reject', reason, trace? }
 * 반환: 찾음·놓침·헛짚음·판정·근원, 항목별 결과, 점수(기록용), evidenceUse(trace가 있을 때만, 없으면 null)
 */
export function scoreAnswer(run, ledger, answer, { docs } = {}) {
  if (!ledger || ledger.status !== 'reviewed') throw err('사람 검수가 끝나지 않은 장부로는 채점하지 않습니다', 409);
  const units = new Set(run.stages.flatMap((s) => s.units.map((u) => u.uid)));
  const seen = new Set();
  const marks = (answer.marks ?? []).filter((m) => units.has(m.uid) && !seen.has(m.uid) && seen.add(m.uid));
  const marked = new Map(marks.map((m) => [m.uid, m]));
  const items = ledger.items.filter((x) => !x.deleted);
  const A = items.filter((x) => x.grade === 'A');
  const fk = finalKeys(run.stages);

  const perItem = items.map((it) => {
    const hitUnits = refsOf(it).filter((u) => marked.has(u));
    return {
      id: it.id, grade: it.grade, pattern: it.pattern, origin: it.origin, spread: it.spread ?? [],
      found: hitUnits.length > 0, hitUnits,
      originHit: !!it.originConfirmed && !!marked.get(it.origin)?.origin,
      originConfirmed: !!it.originConfirmed,
      reachedFinal: refsOf(it).some((u) => fk.includes(u.split('.')[0])),
      // 어디서 멈췄어야 했나: 근원 단위(그 단계에서 원자료와 대조했으면 뒤로 번지지 않았다)
      stopAt: it.origin,
    };
  });
  const inLedger = new Set(items.flatMap(refsOf));
  // 후보 칸(spreadCandidates: 한 감사만 옮겨졌다고 본 칸, 사람이 옮겨진 칸으로 올리지 않음): B·C 칸처럼 찾음에도 헛짚음에도 넣지 않는다.
  // 다른 항목의 처음 생긴 곳·옮겨진 칸이면 그쪽 규칙이 먼저다
  const candOf = new Map();
  for (const it of items) for (const u of it.spreadCandidates ?? []) if (!inLedger.has(u)) candOf.set(u, [...(candOf.get(u) ?? []), it.id]);
  const splitMarks = marks.filter((m) => candOf.has(m.uid)).map((m) => ({ uid: m.uid, items: candOf.get(m.uid) }));
  const falseMarks = marks.filter((m) => !inLedger.has(m.uid) && !candOf.has(m.uid)).map((m) => m.uid);
  const bcSeen = marks.filter((m) => items.some((it) => it.grade !== 'A' && refsOf(it).includes(m.uid))).map((m) => m.uid);

  const foundA = perItem.filter((x) => x.grade === 'A' && x.found);
  const aFinal = A.filter((it) => refsOf(it).some((u) => fk.includes(u.split('.')[0])));
  const shouldReject = aFinal.length > 0;
  const decisionOk = answer.decision === (shouldReject ? 'reject' : 'approve');
  const originable = perItem.filter((x) => x.grade === 'A' && x.originConfirmed);
  const originHits = originable.filter((x) => x.originHit).length;

  const recall = A.length ? foundA.length / A.length : 1;
  const precision = marks.length ? (marks.length - falseMarks.length) / marks.length : A.length ? 0 : 1;
  const score = Math.round(50 * recall + 20 * precision + 20 * (decisionOk ? 1 : 0) + 10 * (originable.length ? originHits / originable.length : 1));
  return {
    ledgerVersion: ledger.version,
    counts: { A: A.length, foundA: foundA.length, falseMarks: falseMarks.length, splitMarks: splitMarks.length, marks: marks.length, aFinal: aFinal.length, originable: originable.length, originHits, B: items.filter((x) => x.grade === 'B').length, C: items.filter((x) => x.grade === 'C').length },
    decision: answer.decision, shouldReject, decisionOk,
    falseMarks, bcSeen, splitMarks, perItem, score,
    evidenceUse: answer.trace ? evidenceUseOf(run, ledger, marks, answer.trace, docs ?? docsOf(run)) : null,
  };
}

/** 장부가 바뀌었으면 두 판으로 다시 계산해 함께 보인다 */
export function rescore(run, ledgers, answer) {
  const reviewed = ledgers.filter((l) => l.status === 'reviewed');
  const latest = reviewed.at(-1);
  const at = reviewed.find((l) => l.version === answer.ledgerVersion) ?? latest;
  const now = scoreAnswer(run, latest, answer);
  return at && at.version !== latest.version ? { now, before: scoreAnswer(run, at, answer), changed: true } : { now, changed: false };
}
