// POST /api/drill  F4 짧은 연습(문장 드릴). 기기 ID가 주소에 남지 않게 모두 POST 본문으로 받는다
//   { action:'next', deviceId, n? }          오늘의 문항(정답 없이, 필드 허용 목록). pattern을 보내면 400(패턴 필터 없음)
//   { action:'answer', deviceId, maker, qid, verdict:'ok'|'error', pick?, pattern?, trace?:{elapsedMs, paraMs, openedFull} }
//   { action:'history', deviceId }           내 드릴 기록(매번 다시 채점)
// 복습형(승인 4): 이 기기가 결재까지 마친 판(ss2:seen:<runId>)의 문항만 낸다
import { handler, body, deviceOk, err } from './_lib.js';
import { getRun, fixedRunIds, ledgerVersions } from '../src/ledger.js';
import { docsOf } from '../src/score.js';
import { smembers, sismember, getJsonMany } from '../src/store.js';
import { deviceHistory } from '../src/record.js';
import { eligible, publicQuestion, pickQuestions, gradeDrill, regradeDrill } from '../src/drill.js';
import { currentSets, saveDrillAnswer } from '../src/drillstore.js';

const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const label = (set) => `이 판 정답표(사람 검수 ${set.ledgerVersion}판) 기준 · 이의 제기 가능`;
const OK_NOTE = '사람 검수에서 이 문장은 오류로 보지 않았습니다. 다르게 보면 이의를 제기할 수 있습니다.';

/** qid로 문항 찾기(각 판의 지금 세트에서) */
async function findQuestion(qid) {
  for (const runId of fixedRunIds()) {
    const sets = await currentSets(runId);
    const set = sets.at(-1);
    const q = set?.questions.find((x) => x.qid === qid);
    if (q) return { runId, set, q };
  }
  return null;
}

export default handler(async (req) => {
  if (req.method !== 'POST') throw err('POST만 받습니다', 405);
  const b = body(req);
  if (!deviceOk(b.deviceId)) throw err('기기 ID가 없습니다');
  if (b.action === 'next') {
    // 패턴으로 고르면 나오는 문항이 모두 틀린 문장이 되어 정답이 샌다
    if ('pattern' in b) throw err('패턴으로 문항을 고르는 기능은 없습니다');
    const n = Math.min(5, Math.max(1, Number.parseInt(b.n, 10) || 3));
    const pool = []; const metas = []; let locked = false;
    for (const runId of fixedRunIds()) {
      const set = (await currentSets(runId)).at(-1);
      if (!set || !eligible(set)) continue;
      if (!(await sismember(`ss2:seen:${runId}`, b.deviceId))) { locked = true; continue; }
      pool.push(...set.questions.map((q) => ({ ...q, runId })));
      metas.push({ runId, ledgerVersion: set.ledgerVersion, drillsetVersion: set.version, label: label(set) });
    }
    if (!pool.length) {
      return { mode: 'none', locked, reason: locked ? '판을 먼저 풀면 그 판 문장으로 짧은 연습이 열립니다' : '문항 준비 중', set: null, sets: [], questions: [], left: 0 };
    }
    const seen = new Set(await smembers(`ss2:dseen:${b.deviceId}`));
    const p = pickQuestions(pool, { deviceId: b.deviceId, day: kstDay(), seen, n });
    const questions = [];
    for (const q of p.questions) { const run = await getRun(q.runId); questions.push(publicQuestion(q, run, docsOf(run))); }
    return { mode: p.mode, set: metas[0], sets: metas, questions, left: p.left, note: '셋 다 맞을 수도, 셋 다 틀릴 수도 있습니다.' };
  }
  if (b.action === 'answer') {
    if (!['ok', 'error'].includes(b.verdict)) throw err('맞다 또는 틀렸다를 골라 주세요');
    const found = /^q-[0-9a-f]{8}$/.test(b.qid ?? '') ? await findQuestion(b.qid) : null;
    if (!found) throw err('없는 문항', 404);
    // 복습형: 결재하지 않은 판의 문항은 채점하지 않는다(채점 응답이 그 판의 정답을 알려 주므로)
    if (!(await sismember(`ss2:seen:${found.runId}`, b.deviceId))) throw err('판을 먼저 결재하면 이 문항을 풀 수 있습니다', 403);
    const L = (await ledgerVersions(found.runId)).find((l) => l.version === found.set.ledgerVersion);
    const g = gradeDrill(found.set, { qid: b.qid, verdict: b.verdict, pick: b.pick, pattern: b.pattern }, L);
    const rec = await saveDrillAnswer({ deviceId: b.deviceId, maker: b.maker, q: found.q, set: found.set, verdict: b.verdict, pick: b.pick, pattern: b.pattern, trace: b.trace });
    return {
      drillAnswerId: rec.id, correct: g.correct, truth: g.truth, ledgerVersion: g.ledgerVersion, items: g.items,
      pickFeedback: g.pickFeedback, patternFeedback: g.patternFeedback, repeat: rec.repeat,
      ...(g.truth === 'ok' ? { note: OK_NOTE } : {}),
      objection: { runId: found.runId, uid: found.q.uid },
    };
  }
  if (b.action === 'history') {
    const entries = (await deviceHistory(b.deviceId)).filter((x) => x.kind === 'drill');
    const recs = (await getJsonMany(entries.map((x) => `ss2:dans:${x.id}`))).filter(Boolean);
    const ctx = new Map();
    const answers = [];
    for (const a of recs) {
      if (!ctx.has(a.runId)) ctx.set(a.runId, { sets: await currentSets(a.runId), ledgers: await ledgerVersions(a.runId) });
      const { sets, ledgers } = ctx.get(a.runId);
      const r = regradeDrill(sets, a, ledgers);
      answers.push({ qid: a.qid, runId: a.runId, at: a.at, verdict: a.verdict, truth: r.now.dropped ? null : r.now.truth, correct: r.now.dropped ? null : r.now.correct, changed: r.changed, dropped: r.now.dropped, repeat: a.repeat });
    }
    const counted = answers.filter((x) => !x.repeat && !x.dropped);
    return { answers, summary: { n: counted.length, correct: counted.filter((x) => x.correct).length, okAsError: counted.filter((x) => x.truth === 'ok' && x.verdict === 'error').length, errorAsOk: counted.filter((x) => x.truth === 'error' && x.verdict === 'ok').length } };
  }
  throw err('모르는 동작');
});
