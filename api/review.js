// 만든 사람 검수(머리글 x-review-code = REVIEW_CODE). 계정은 없다.
// GET  /api/review                     대기열: 고정 판(장부 상태, 만든 사람 풀이 여부), 이의
// GET  /api/review?run=<id>[&force=1]  판 하나: 원자료·단계·장부 초안(없으면 최신 판에서 만듦)·이 판의 이의
// POST { runId, op:{action:'approve'|'delete'|'edit'|'add'|'confirmOrigin', …} }   초안에 검수 동작 하나
// POST { runId, finalize:true }        초안 → 장부 새 판(reviewed)
// POST { objectionId, accept:bool, note, op? }   이의 판정. 받아들이면 op를 최신 검수 판에 적용해 새 판
import { handler, body, err, requireReviewer } from './_lib.js';
import { getRun, fixedRunIds, ledgerVersions, latestLedger, getDraft, setDraft, applyReview, finalizeDraft, objections, decideObjection } from '../src/ledger.js';
import { loadMission, loadDocs } from '../src/mission.js';
import { makerSolved, getAnswer } from '../src/record.js';
import { auditSpreadOf } from '../src/audit.js';
import { getTriage } from '../src/triage.js';

/** 검수 진행: 판정한 수, 전체, 남은 항목 id */
const progressOf = (d) => (d ? { done: d.items.filter((x) => x.review !== 'pending').length, of: d.items.length, left: d.items.filter((x) => x.review === 'pending').map((x) => x.id) } : null);
/** 이의 하나에 판정에 필요한 것을 붙인다: 그 칸의 글, 그 칸에 걸친 장부 항목 */
async function enrich(o) {
  try {
    const run = await getRun(o.runId);
    const unit = run.stages.flatMap((s) => [...s.units, ...(s.attempts ?? []).flatMap((a) => a.units)]).find((u) => u.uid === o.uid);
    const L = run.origin === 'live' ? run.ledgerV1 : (await latestLedger(o.runId, { reviewed: true })) ?? (await latestLedger(o.runId));
    const at = (L?.items ?? []).filter((it) => !it.deleted && [it.origin, ...(it.spread ?? [])].includes(o.uid)).map((it) => ({ id: it.id, grade: it.grade, pattern: it.pattern, why: it.why }));
    return { ...o, unitText: unit?.text ?? null, itemsAt: at, missionId: run.missionId };
  } catch { return o; }
}

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
        const d = await getDraft(id);
        return { runId: id, missionId: r.missionId, style: r.style, role: r.role, worker: r.worker, versions: vs.map((v) => ({ version: v.version, status: v.status, items: v.items.length })), makerSolved: !!(await makerSolved(id)), draft: !!d, progress: progressOf(d) };
      }));
      // 사람이 건 이의와 AI 1차 판정이 넣은 후보를 한 대기열로(source로 구분)
      return { runs, objections: await Promise.all((await objections()).map(enrich)) };
    }
    const run = await getRun(runId);
    // 정답을 보기 전에 풀어야 한다: 만든 사람 풀이가 없으면 열지 않는다(force=1로 열 수는 있다)
    if (run.origin !== 'live' && !(await makerSolved(runId)) && req.query?.force !== '1') throw err('먼저 이 판을 정답 없이 풀어 주세요(?maker=1로 풀이). 그래도 열려면 force=1', 423);
    const m = loadMission(run.missionId);
    // 만든 사람이 정답 없이 풀 때 그은 빨간 줄: 검수 화면에서 항목 옆에 보여 주고, 장부에 없는 것은 추가 후보로 띄운다
    const solved = await makerSolved(runId);
    const makerAnswer = solved ? await getAnswer(solved.answerId) : null;
    const draft = await draftOf(runId);
    // 번진 곳을 감사별로 나눠 보인다(두 감사가 함께 댄 칸 / 한 감사만 댄 칸). 장부·초안은 바꾸지 않는다. 고칠지는 사람이 정한다
    const auditSpread = auditSpreadOf(runId, draft);
    return { run, mission: m, docs: loadDocs(m), versions: await ledgerVersions(runId), draft, progress: progressOf(draft), auditSpread, objections: await Promise.all((await objections()).filter((o) => o.runId === runId).map(enrich)), makerMarks: makerAnswer?.marks ?? [], makerTriage: makerAnswer ? await getTriage(makerAnswer.id) : null };
  }
  const b = body(req);
  if (b.objectionId) {
    const o = (await objections()).find((x) => x.id === b.objectionId);
    if (!o) throw err('없는 이의', 404);
    let newVersion = null;
    // 팀장 모드(라이브) 판의 장부는 AI 감사뿐이고 채점에 쓰지 않는다: 판정만 남기고 새 판은 만들지 않는다
    if (String(o.runId).startsWith('live-')) return { decision: await decideObjection(o.id, { accept: !!b.accept, note: b.note, newVersion: null }), newVersion: null, live: true };
    if (b.accept && !(await latestLedger(o.runId, { reviewed: true }))) throw err('이 판은 장부를 먼저 검수해 확정해야 이의를 받아들일 수 있습니다', 409);
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
