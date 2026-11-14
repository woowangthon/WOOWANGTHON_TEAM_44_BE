// F4 드릴 저장. 세트 ss2:drillset:<runId>(오래된 것부터 쌓은 배열), 답안 ss2:dans:<id>, 이 기기가 답한 qid 집합 ss2:dseen:<deviceId>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getJson, setJson, sadd, lpushCapped, incr } from './store.js';
import { getRun, latestLedger } from './ledger.js';
import { docsOf } from './score.js';
import { drillCandidates, carrySet } from './drill.js';

const LONG = 400 * 24 * 3600;
const ROOT = process.env.DATA_ROOT || process.cwd();
const rid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** 감사 원문(읽기만). 없으면 [] */
export function auditsRaw(runId) {
  const f = join(ROOT, 'data', 'ledgers', `${runId}.audits.json`);
  try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []; } catch { return []; }
}

export const getSets = async (runId) => (await getJson(`ss2:drillset:${runId}`)) ?? [];
export async function saveSet(runId, set) {
  const sets = await getSets(runId);
  const next = { ...set, version: (sets.at(-1)?.version ?? 0) + 1 };
  sets.push(next);
  await setJson(`ss2:drillset:${runId}`, sets, LONG);
  return next;
}

/** 이 판의 세트 전부. 사람 검수 장부에 새 판이 나왔는데 그 판의 세트가 없으면 자동으로 이어받은 세트를 만들어 둔다 */
export async function currentSets(runId) {
  const sets = await getSets(runId);
  if (!sets.length) return sets;
  const L = await latestLedger(runId, { reviewed: true });
  if (L && L.version > sets.at(-1).ledgerVersion) {
    const run = await getRun(runId);
    const next = carrySet(sets.at(-1), run, L, drillCandidates(run, L, auditsRaw(runId), docsOf(run)));
    sets.push(next);
    await setJson(`ss2:drillset:${runId}`, sets, LONG);
  }
  return sets;
}

/** 드릴 답안 저장. 정답 여부는 저장하지 않고 읽을 때 계산한다(판 답안과 같은 원칙) */
export async function saveDrillAnswer({ deviceId, maker, q, set, verdict, pick, pattern, trace }) {
  const id = rid('dan');
  const repeat = !(await sadd(`ss2:dseen:${deviceId}`, q.qid, LONG));
  const num = (x) => (Number.isFinite(x) && x >= 0 ? Math.round(Math.min(x, 36e5)) : null);
  const rec = {
    id, at: new Date().toISOString(), deviceId, maker: !!maker, qid: q.qid, runId: set.runId, uid: q.uid,
    drillsetVersion: set.version, ledgerVersion: set.ledgerVersion, verdict,
    pick: String(pick ?? '').slice(0, 200), pattern: pattern ? String(pattern).slice(0, 40) : null,
    trace: trace && typeof trace === 'object' ? { elapsedMs: num(trace.elapsedMs), paraMs: num(trace.paraMs), openedFull: !!trace.openedFull } : null,
    repeat, first: !repeat,
  };
  await setJson(`ss2:dans:${id}`, rec, LONG);
  await lpushCapped('ss2:drill:answers', { id, qid: q.qid, at: rec.at, maker: rec.maker, first: rec.first, deviceId });
  await lpushCapped(`ss2:dev:${deviceId}`, { kind: 'drill', id, qid: q.qid, runId: set.runId, at: rec.at, ledgerVersion: set.ledgerVersion }, 200);
  await incr(`ss2:count:${maker ? 'drillMaker' : 'drill'}`);
  return rec;
}
