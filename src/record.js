// 답안·기록. 이름·연락처는 저장하지 않는다. 기기 ID는 브라우저가 만든 무작위 값이다.
// 만든 사람 기기(maker)의 기록은 통계에서 뺀다. 같은 기기의 같은 판은 첫 판만 「처음 푼 기록」으로 센다.
import { getJson, setJson, sadd, lpushCapped, lrange, incr } from './store.js';

const LONG = 400 * 24 * 3600;
const rid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** 사수 모드 답안 저장. 채점은 장부가 바뀌면 다시 하므로 답안 원문을 남긴다 */
export async function saveAnswer({ runId, deviceId, maker, marks, decision, reason, elapsedSec, sourceViews, ledgerVersion, result }) {
  const id = rid('ans');
  const first = deviceId ? await sadd(`ss2:seen:${runId}`, deviceId) : false;
  const rec = {
    id, at: new Date().toISOString(), runId, deviceId: deviceId ?? null, maker: !!maker, first,
    marks: marks.map((m) => ({ uid: m.uid, pattern: m.pattern ?? null, origin: !!m.origin, note: String(m.note ?? '').slice(0, 200) })),
    decision, reason: String(reason ?? '').slice(0, 500), elapsedSec: Number.isFinite(elapsedSec) ? Math.round(elapsedSec) : null,
    sourceViews: Number.isFinite(sourceViews) ? Math.round(sourceViews) : 0, ledgerVersion: ledgerVersion ?? null,
    summary: result ? { foundA: result.counts.foundA, A: result.counts.A, falseMarks: result.counts.falseMarks, decisionOk: result.decisionOk, score: result.score } : null,
  };
  await setJson(`ss2:ans:${id}`, rec, LONG);
  await lpushCapped(`ss2:answers`, { id, runId, at: rec.at, maker: rec.maker, first, deviceId: rec.deviceId });
  if (deviceId) await lpushCapped(`ss2:dev:${deviceId}`, { kind: 'shadow', id, runId, at: rec.at, ...rec.summary, marks: rec.marks.length, sourceViews: rec.sourceViews, elapsedSec: rec.elapsedSec }, 200);
  if (maker) await setJson(`ss2:makerSolved:${runId}`, { at: rec.at, answerId: id }, LONG);
  await incr(`ss2:count:${maker ? 'maker' : 'answers'}`);
  return rec;
}
export const getAnswer = (id) => getJson(`ss2:ans:${id}`);
export const makerSolved = (runId) => getJson(`ss2:makerSolved:${runId}`);

/** 팀장 모드 기록(결과 지표만) */
export async function saveLeadRecord(deviceId, maker, rec) {
  await lpushCapped('ss2:leads', { ...rec, maker: !!maker, deviceId: deviceId ?? null }, 2000);
  if (deviceId) await lpushCapped(`ss2:dev:${deviceId}`, { kind: 'lead', ...rec }, 200);
}

/** 내 기록(기기별, 오래된 것부터) */
export async function deviceHistory(deviceId) {
  return (await lrange(`ss2:dev:${deviceId}`, 0, 199)).reverse();
}

/** 공개 통계: 만든 사람 제외 */
export async function publicCounts() {
  const answers = await lrange('ss2:answers', 0, -1);
  const leads = await lrange('ss2:leads', 0, -1);
  const users = new Set([...answers.filter((a) => !a.maker).map((a) => a.deviceId), ...leads.filter((l) => !l.maker).map((l) => l.deviceId)].filter(Boolean));
  return { answers: answers.filter((a) => !a.maker).length, firstAnswers: answers.filter((a) => !a.maker && a.first).length, leads: leads.filter((l) => !l.maker).length, devices: users.size, makerAnswers: answers.filter((a) => a.maker).length, makerLeads: leads.filter((l) => l.maker).length };
}
