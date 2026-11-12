// POST /api/play
//   { action:'answer', runId, deviceId, maker, marks, decision, reason, elapsedSec, sourceViews }
//   { action:'result', answerId }                         장부가 바뀌었으면 두 판으로 다시 계산
//   { action:'objection', answerId?, runId, deviceId, kind:'missing'|'notError', uid, item?, evidence:[pid], reason }
//   { action:'history', deviceId }                        내 기록
import { handler, body, deviceOk, err } from './_lib.js';
import { getRun, latestLedger, ledgerVersions, addObjection } from '../src/ledger.js';
import { scoreAnswer, rescore } from '../src/score.js';
import { saveAnswer, getAnswer, deviceHistory } from '../src/record.js';
import { habitOf } from '../src/patterns.js';

/** 결과 화면에 내보내는 장부(채점 뒤에만) */
const revealLedger = (L) => ({
  version: L.version, status: L.status, at: L.at, audits: L.audits,
  items: L.items.map((it) => ({ id: it.id, origin: it.origin, originConfirmed: !!it.originConfirmed, spread: it.spread ?? [], wrongText: it.wrongText, pattern: it.pattern, grade: it.grade,
    why: it.why, fix: it.fix, prevent: it.prevent, habit: habitOf(it), evidence: it.evidence ?? [], source: it.source,
    byAudit: Object.fromEntries(Object.entries(it.byAudit ?? {}).map(([c, b]) => [c, { model: b.model, grade: b.grade, why: b.why }])) })),
  changes: summarizeChanges(L),
});
const summarizeChanges = (L) => {
  const log = L.reviewLog ?? [];
  const items = new Set(log.map((l) => l.item));
  const kinds = (re) => new Set(log.filter((l) => re.test(l.action)).map((l) => l.item)).size;
  return { touched: items.size, approved: kinds(/^approve$/), edited: kinds(/^edit/), deleted: kinds(/^delete$/), added: kinds(/^add$/) };
};

export default handler(async (req) => {
  const b = body(req);
  if (b.action === 'answer') {
    const run = await getRun(b.runId);
    if (!['approve', 'reject'].includes(b.decision)) throw err('승인 또는 반려를 골라 주세요');
    if (b.decision === 'reject' && String(b.reason ?? '').trim().length < 4) throw err('반려 사유를 적어 주세요');
    if (!Array.isArray(b.marks) || b.marks.length > 200) throw err('표시가 잘못됐습니다');
    const deviceId = deviceOk(b.deviceId) ? b.deviceId : null;
    const L = await latestLedger(run.id, { reviewed: true });
    if (!L) {
      // 장부가 사람 검수 전이면 만든 사람만 풀 수 있다(풀이가 검수보다 먼저). 채점은 검수 뒤에 한다
      if (!b.maker) throw err('이 판은 아직 사람 검수 전이라 채점할 수 없습니다', 409);
      const rec = await saveAnswer({ ...b, deviceId, result: null });
      return { answerId: rec.id, pending: true, message: '풀이를 저장했습니다. 장부를 검수해 확정하면 결과가 나옵니다.' };
    }
    const result = scoreAnswer(run, L, b);
    const rec = await saveAnswer({ ...b, deviceId, ledgerVersion: L.version, result });
    return { answerId: rec.id, result, ledger: revealLedger(L) };
  }
  if (b.action === 'result') {
    const a = await getAnswer(b.answerId);
    if (!a) throw err('없는 답안', 404);
    const run = await getRun(a.runId);
    const vs = await ledgerVersions(run.id);
    if (!vs.some((l) => l.status === 'reviewed')) return { pending: true, answer: a };
    const r = rescore(run, vs, a);
    return { answer: a, result: r.now, before: r.before ?? null, changed: r.changed, ledger: revealLedger(vs.filter((l) => l.status === 'reviewed').at(-1)) };
  }
  if (b.action === 'objection') {
    if (!['missing', 'notError'].includes(b.kind)) throw err('이의 종류가 잘못됐습니다');
    const run = await getRun(b.runId);
    const units = new Set(run.stages.flatMap((s) => [...s.units, ...(s.attempts ?? []).flatMap((x) => x.units)]).map((u) => u.uid));
    if (!units.has(b.uid) && !String(b.uid).includes('#')) throw err('없는 단위');
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 8) throw err('이유를 한 문장 이상 적어 주세요');
    const L = await latestLedger(run.id);
    const rec = await addObjection({ runId: run.id, origin: run.origin, ledgerVersion: L?.version ?? null, answerId: b.answerId ?? null, deviceId: deviceOk(b.deviceId) ? b.deviceId : null, maker: !!b.maker,
      kind: b.kind, uid: b.uid, item: b.item ?? null, evidence: (b.evidence ?? []).slice(0, 5).map(String), reason: reason.slice(0, 800) });
    return { objectionId: rec.id, message: '이의를 접수했습니다. 만든 사람이 원자료와 대조해 판정합니다. 받아들이면 장부 새 판이 나오고 결과가 다시 계산됩니다.' };
  }
  if (b.action === 'history') {
    if (!deviceOk(b.deviceId)) throw err('기기 ID가 없습니다');
    return { history: await deviceHistory(b.deviceId) };
  }
  throw err('모르는 동작');
});
