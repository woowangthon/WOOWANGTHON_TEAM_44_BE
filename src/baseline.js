// 기준 지시 분포: 같은 미션을 대충·기본·잘 맡긴 판들의 최종본 A 수(AI 감사 기준, 사람 검수한 판은 검수 장부 기준).
// 팀장 모드 결과에서 「내 판 하나」를 운이 아니라 분포와 견주게 한다.
import { fixedRunIds, getRun, latestLedger } from './ledger.js';
import { ledgerCounts } from './audit.js';
import { finalKeys } from './mission.js';

const cache = new Map();
export async function baselines(missionId) {
  if (cache.has(missionId)) return cache.get(missionId);
  const by = {};
  for (const id of fixedRunIds()) {
    const r = await getRun(id);
    if (r.missionId !== missionId) continue;
    const L = (await latestLedger(id, { reviewed: true })) ?? (await latestLedger(id));
    if (!L) continue;
    const c = ledgerCounts(L, finalKeys(r.stages));
    (by[r.style] ??= []).push({ runId: id, worker: r.worker, company: r.workerCompany, A: c.A, Afinal: c.Afinal, reviewed: L.status === 'reviewed' });
  }
  const out = Object.fromEntries(Object.entries(by).map(([style, list]) => [style, { n: list.length, meanAfinal: Math.round((10 * list.reduce((s, x) => s + x.Afinal, 0)) / list.length) / 10, runs: list }]));
  cache.set(missionId, out);
  return out;
}
