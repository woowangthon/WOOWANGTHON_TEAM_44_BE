// 만든 사람 검수(머리글 x-review-code = REVIEW_CODE). 계정은 없다.
// GET  /api/review                     대기열: 고정 판(장부 상태, 만든 사람 풀이 여부), 이의
// GET  /api/review?run=<id>[&force=1]  판 하나: 원자료·단계·장부 초안(없으면 최신 판에서 만듦)·이 판의 이의
// POST { runId, op:{action:'approve'|'delete'|'edit'|'add'|'confirmOrigin', …} }   초안에 검수 동작 하나
// POST { runId, finalize:true }        초안 → 장부 새 판(reviewed)
// POST { objectionId, accept:bool, note, op? }   이의 판정. 받아들이면 op를 최신 검수 판에 적용해 새 판
import { handler, body, err, requireReviewer } from './_lib.js';
import { getRun, fixedRunIds, ledgerVersions, latestLedger, getDraft, setDraft, applyReview, finalizeDraft, objections, decideObjection } from '../src/ledger.js';
import { loadMission, loadDocs } from '../src/mission.js';
import { makerSolved } from '../src/record.js';

async function draftOf(runId) {
  const d = await getDraft(runId);
  if (d) return d;
  const L = await latestLedger(runId);
  if (!L) throw err('장부가 없습니다', 404);
  const fresh = { ...structuredClone(L), status: 'draft', base: L.version, reviewLog: [...(L.reviewLog ?? [])] };
  // 검수 판에서 이어 고칠 때는 이미 판정한 항목을 그대로 둔다. AI 판에서 시작하면 모두 pending
  if (L.status !== 'reviewed') fresh.items = fresh.items.map((x) => ({ ...x, review: 'pending' }));
  await setDraft(runId, fresh);
  return fresh;
}

export default handler(async (req) => {
  requireReviewer(req);
  if (req.method === 'GET') {
    const runId = req.query?.run;
    if (!runId) {
      const runs = await Promise.all(fixedRunIds().map(async (id) => {
        const r = await getRun(id); const vs = await ledgerVersions(id);
        return { runId: id, missionId: r.missionId, style: r.style, role: r.role, worker: r.worker, versions: vs.map((v) => ({ version: v.version, status: v.status, items: v.items.length })), makerSolved: !!(await makerSolved(id)), draft: !!(await getDraft(id)) };
      }));
      return { runs, objections: await objections() };
    }
    const run = await getRun(runId);
    // 정답을 보기 전에 풀어야 한다: 만든 사람 풀이가 없으면 열지 않는다(force=1로 열 수는 있다)
    if (run.origin !== 'live' && !(await makerSolved(runId)) && req.query?.force !== '1') throw err('먼저 이 판을 정답 없이 풀어 주세요(?maker=1로 풀이). 그래도 열려면 force=1', 423);
    const m = loadMission(run.missionId);
    return { run, mission: m, docs: loadDocs(m), versions: await ledgerVersions(runId), draft: await draftOf(runId), objections: (await objections()).filter((o) => o.runId === runId) };
  }
  const b = body(req);
  if (b.objectionId) {
    const o = (await objections()).find((x) => x.id === b.objectionId);
    if (!o) throw err('없는 이의', 404);
    let newVersion = null;
    if (b.accept) {
      if (!b.op) throw err('받아들이면 장부에 무엇을 바꿀지(op)가 필요합니다');
      const L = await latestLedger(o.runId, { reviewed: true }) ?? await latestLedger(o.runId);
      const d = { ...structuredClone(L), reviewLog: [...(L.reviewLog ?? [])] };
      applyReview(d, { ...b.op, fromObjection: true, note: `이의 ${o.id}: ${b.note ?? ''}` });
      newVersion = (await finalizeDraft(o.runId, d, { reason: `이의 ${o.id} 받아들임` })).version;
    }
    return { decision: await decideObjection(o.id, { accept: !!b.accept, note: b.note, newVersion }), newVersion };
  }
  if (!b.runId) throw err('runId가 필요합니다');
  const d = await draftOf(b.runId);
  if (b.finalize) return { ledger: await finalizeDraft(b.runId, d) };
  if (!b.op) throw err('op가 필요합니다');
  const it = applyReview(d, b.op);
  await setDraft(b.runId, d);
  return { item: it, progress: { done: d.items.filter((x) => x.review !== 'pending').length, of: d.items.length } };
});
