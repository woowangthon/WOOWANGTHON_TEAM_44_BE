// POST /api/play
//   { action:'answer', runId, deviceId, maker, marks, decision, reason, elapsedSec, sourceViews, trace? }
//        trace = { v:1, dropped, events:[[t, type, ref, ms?]…] }  F2 근거 대조 이벤트(최대 2,000개). 틀린 이벤트는 버리고 partial로 표시
//   { action:'result', answerId }                         장부가 바뀌었으면 두 판으로 다시 계산(evidenceUse도 판마다)
//   { action:'objection', answerId?, runId, deviceId, kind:'missing'|'notError', uid, item?, evidence:[pid], reason, from?:'drill' }
//   { action:'history', deviceId }                        내 기록 + skill(패턴별 찾음/놓침, 베이즈 평균)
// 결재 뒤 응답(answer·result)의 ledger.items에는 provenance(F8 출처)·crowd(F7 집단 신호)가 붙는다. 결재 전 응답에는 장부가 없다
//   { action:'triage', answerId }                         AI 1차 판정(표시만, 점수 무관). 한 답안에 한 번만 호출한다
import { handler, body, deviceOk, err } from './_lib.js';
import { getRun, latestLedger, ledgerVersions, addObjection } from '../src/ledger.js';
import { scoreAnswer, rescore, docsOf } from '../src/score.js';
import { saveAnswer, getAnswer, getTrace, deviceHistory, firstAnswers, getAnswers } from '../src/record.js';
import { provenanceOf, crowdOf, patternSkill } from '../src/insight.js';
import { sanitizeTrace } from '../src/trace.js';
import { habitOf } from '../src/patterns.js';
import { triageAnswer, getTriage } from '../src/triage.js';
import { loadMission, loadDocs } from '../src/mission.js';

/** 결과 화면에 내보내는 장부(채점 뒤에만). extra = { prov, crowd } 항목 id별 */
const revealLedger = (L, extra = {}) => ({
  version: L.version, status: L.status, at: L.at, audits: L.audits,
  items: L.items.map((it) => ({ id: it.id, origin: it.origin, originConfirmed: !!it.originConfirmed, spread: it.spread ?? [], wrongText: it.wrongText, pattern: it.pattern, grade: it.grade,
    why: it.why, fix: it.fix, prevent: it.prevent, habit: habitOf(it), evidence: it.evidence ?? [], source: it.source,
    byAudit: Object.fromEntries(Object.entries(it.byAudit ?? {}).map(([c, b]) => [c, { model: b.model, grade: b.grade, why: b.why }])),
    provenance: extra.prov?.[it.id] ?? null, crowd: extra.crowd?.[it.id] ?? null })),
  changes: summarizeChanges(L),
});
const summarizeChanges = (L) => {
  const log = L.reviewLog ?? [];
  const items = new Set(log.map((l) => l.item));
  const kinds = (re) => new Set(log.filter((l) => re.test(l.action)).map((l) => l.item)).size;
  return { touched: items.size, approved: kinds(/^approve$/), edited: kinds(/^edit/), deleted: kinds(/^delete$/), added: kinds(/^add$/) };
};

/** 출처 칩(F8)과 집단 신호(F7)를 붙인 장부. vs = 이 판의 장부 판 전부 */
async function revealFull(run, L, vs) {
  return revealLedger(L, { prov: provenanceOf(L, vs, docsOf(run), run), crowd: crowdOf(L, await firstAnswers(run.id), run) });
}

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
      const rec = await saveAnswer({ ...b, trace: sanitizeTrace(b.trace, run, docsOf(run)), deviceId, result: null });
      return { answerId: rec.id, pending: true, message: '풀이를 저장했습니다. 장부를 검수해 확정하면 결과가 나옵니다.' };
    }
    const trace = sanitizeTrace(b.trace, run, docsOf(run));
    const result = scoreAnswer(run, L, { ...b, trace });
    const rec = await saveAnswer({ ...b, trace, deviceId, ledgerVersion: L.version, result });
    return { answerId: rec.id, result, ledger: await revealFull(run, L, await ledgerVersions(run.id)) };
  }
  if (b.action === 'result') {
    const a = await getAnswer(b.answerId);
    if (!a) throw err('없는 답안', 404);
    const run = await getRun(a.runId);
    const vs = await ledgerVersions(run.id);
    if (!vs.some((l) => l.status === 'reviewed')) return { pending: true, answer: a };
    // 이벤트 원본은 따로 읽어 채점에만 쓴다. 응답의 answer에는 싣지 않는다
    const trace = a.hasTrace ? await getTrace(a.id) : null;
    const r = rescore(run, vs, trace ? { ...a, trace } : a);
    return { answer: a, result: r.now, before: r.before ?? null, changed: r.changed, ledger: await revealFull(run, vs.filter((l) => l.status === 'reviewed').at(-1), vs), triage: await getTriage(a.id) };
  }
  if (b.action === 'triage') {
    // 채점이 끝난 답안만(사람 검수 장부가 있어야 「장부에 없는 칸」이 정해진다). 실패해도 결과 화면은 그대로다
    const a = await getAnswer(b.answerId);
    if (!a) throw err('없는 답안', 404);
    const run = await getRun(a.runId);
    const L = await latestLedger(run.id, { reviewed: true });
    if (!L) return { triage: { status: 'skipped', reason: '사람 검수 전' } };
    const m = loadMission(run.missionId);
    return { triage: await triageAnswer({ answer: a, run, mission: m, docs: loadDocs(m), ledger: L }) };
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
      kind: b.kind, uid: b.uid, item: b.item ?? null, evidence: (b.evidence ?? []).slice(0, 5).map(String), reason: reason.slice(0, 800), from: b.from === 'drill' ? 'drill' : 'play' });
    return { objectionId: rec.id, message: '이의를 접수했습니다. 만든 사람이 원자료와 대조해 판정합니다. 받아들이면 장부 새 판이 나오고 결과가 다시 계산됩니다.' };
  }
  if (b.action === 'history') {
    if (!deviceOk(b.deviceId)) throw err('기기 ID가 없습니다');
    const history = await deviceHistory(b.deviceId);
    // F5 내 실력: 판마다 이 기기의 첫 답안만(정답을 본 뒤 다시 푼 것은 빼고), 최신 사람 검수 장부로 다시 채점해 패턴별로 센다
    const firstOf = new Map();
    for (const h of history) if (h.kind === 'shadow' && !firstOf.has(h.runId)) firstOf.set(h.runId, h.id);
    const answers = (await getAnswers([...firstOf.values()])).filter(Boolean);
    const scored = [];
    for (const a of answers) {
      try {
        const L = await latestLedger(a.runId, { reviewed: true });
        if (L) scored.push(scoreAnswer(await getRun(a.runId), L, a));
      } catch { /* 지워진 판 등은 건너뛴다 */ }
    }
    return { history, skill: patternSkill(scored) };
  }
  throw err('모르는 동작');
});
