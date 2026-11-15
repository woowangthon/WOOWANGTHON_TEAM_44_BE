// 다른 사람들의 누적 기록(만든 사람 제외, 같은 기기·같은 판은 첫 풀이만). 순위표가 아니라 「남들은 어땠나」를 보여 주는 분포다.
// 점수는 저장해 둔 요약이 아니라 최신 사람 검수 장부로 다시 매긴다(장부가 바뀌어도 같은 잣대로 견주게).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lrange, getJsonMany } from './store.js';
import { getRun, latestLedger, ledgerVersions } from './ledger.js';
import { scoreAnswer } from './score.js';
import { patternSkill } from './insight.js';
import { gradeDrill } from './drill.js';
import { currentSets } from './drillstore.js';
import { makerSolved, getAnswer } from './record.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

/** 처음 푼 답안(만든 사람 제외). exceptDevice가 있으면 그 기기는 뺀다 */
async function firstIdx({ runId = null, exceptDevice = null } = {}) {
  return (await lrange('ss2:answers', 0, -1)).filter((a) => a.first && !a.maker && (!runId || a.runId === runId) && (!exceptDevice || a.deviceId !== exceptDevice));
}

/** 한 판의 분포: A를 몇 개 찾았나, 결재를 맞혔나. 만든 사람이 정답 보기 전에 푼 첫 풀이도 따로 붙인다 */
export async function runCrowd(runId) {
  const run = await getRun(runId);
  const L = await latestLedger(runId, { reviewed: true });
  if (!L) return null;
  const A = L.items.filter((x) => x.grade === 'A').length;
  const recs = (await getJsonMany((await firstIdx({ runId })).map((a) => `ss2:ans:${a.id}`))).filter(Boolean);
  const rows = [];
  for (const a of recs) { try { const g = scoreAnswer(run, L, a); rows.push({ foundA: g.counts.foundA, decisionOk: g.decisionOk, falseMarks: g.counts.falseMarks, approved: a.decision === 'approve' }); } catch { /* 옛 답안 */ } }
  const hist = Array.from({ length: A + 1 }, (_, k) => rows.filter((r) => r.foundA === k).length);
  let maker = null;
  const ms = await makerSolved(runId);
  if (ms) { const a = await getAnswer(ms.answerId); if (a) { try { const g = scoreAnswer(run, L, a); maker = { foundA: g.counts.foundA, decisionOk: g.decisionOk }; } catch { /* */ } } }
  return {
    n: rows.length, A, hist,
    avgFound: rows.length ? Math.round((rows.reduce((s, r) => s + r.foundA, 0) / rows.length) * 10) / 10 : null,
    decisionOk: rows.filter((r) => r.decisionOk).length,
    approvedWrongly: L.items.some((x) => x.grade === 'A') ? rows.filter((r) => r.approved).length : 0,
    maker,
  };
}

/** 내 실력 화면용: 나를 뺀 다른 사람들의 유형별 찾은 비율과 요약 */
export async function othersSkill(deviceId) {
  const idx = await firstIdx({ exceptDevice: deviceId });
  const recs = (await getJsonMany(idx.map((a) => `ss2:ans:${a.id}`))).filter(Boolean);
  const cache = new Map();
  const scored = [];
  for (const a of recs) {
    try {
      if (!cache.has(a.runId)) cache.set(a.runId, { run: await getRun(a.runId), L: await latestLedger(a.runId, { reviewed: true }) });
      const { run, L } = cache.get(a.runId);
      if (L) scored.push(scoreAnswer(run, L, a));
    } catch { /* */ }
  }
  const people = new Set(recs.map((a) => a.deviceId).filter(Boolean)).size;
  const found = scored.reduce((s, g) => s + g.counts.foundA, 0); const all = scored.reduce((s, g) => s + g.counts.A, 0);
  return { people, plays: scored.length, foundRate: pct(found, all), decisionOkRate: pct(scored.filter((g) => g.decisionOk).length, scored.length), patterns: patternSkill(scored).patterns.map(({ pattern, found: f, n }) => ({ pattern, found: f, n, rate: pct(f, n) })) };
}

const ROOT = process.env.DATA_ROOT || process.cwd();
/** data/mock.json(없으면 null) */
export function loadMock() {
  const f = join(ROOT, 'data', 'mock.json');
  try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; }
}

// ── 모의 문제집: 판을 풀지 않아도 되는 고정 문항(data/mock.json). 문항은 사람 검수 장부로 만든 짧은 연습 세트에서 고른다
export async function mockQuestions(mock) {
  const out = [];
  for (const m of mock.questions) {
    const set = (await currentSets(m.runId)).at(-1);
    const q = set?.questions.find((x) => x.uid === m.uid);
    if (q) out.push({ ...q, runId: m.runId, set });
  }
  return out;
}

/** 모의 문제집 분포: 문항별 맞힌 비율, 다 푼 사람의 맞힌 개수 분포(만든 사람 제외, 문항마다 첫 답만) */
export async function mockCrowd(qs, exceptDevice = null) {
  const qids = new Set(qs.map((q) => q.qid));
  const idx = (await lrange('ss2:drill:answers', 0, -1)).filter((a) => qids.has(a.qid) && a.first && !a.maker && a.deviceId && a.deviceId !== exceptDevice);
  const recs = (await getJsonMany(idx.map((a) => `ss2:dans:${a.id}`))).filter(Boolean);
  const ledgers = new Map();
  const byQ = Object.fromEntries(qs.map((q) => [q.qid, { n: 0, correct: 0 }]));
  const byDev = new Map();
  for (const r of recs) {
    const q = qs.find((x) => x.qid === r.qid);
    if (!ledgers.has(q.runId)) ledgers.set(q.runId, (await ledgerVersions(q.runId)).find((l) => l.version === q.set.ledgerVersion));
    const g = gradeDrill(q.set, { qid: r.qid, verdict: r.verdict }, ledgers.get(q.runId));
    if (g.dropped) continue;
    byQ[r.qid].n++; if (g.correct) byQ[r.qid].correct++;
    const d = byDev.get(r.deviceId) ?? new Map(); d.set(r.qid, g.correct); byDev.set(r.deviceId, d);
  }
  const full = [...byDev.values()].filter((d) => d.size === qs.length).map((d) => [...d.values()].filter(Boolean).length);
  return {
    people: byDev.size, finished: full.length,
    hist: Array.from({ length: qs.length + 1 }, (_, k) => full.filter((x) => x === k).length),
    byQuestion: Object.fromEntries(Object.entries(byQ).map(([k, v]) => [k, { ...v, rate: pct(v.correct, v.n) }])),
  };
}

