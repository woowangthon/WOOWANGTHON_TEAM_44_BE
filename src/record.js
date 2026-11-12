// 플레이 기록과 집계. 이름·연락처·자유 입력은 저장하지 않는다. 기기 ID는 브라우저가 만든 무작위 값이다.
// 같은 기기의 같은 과제는 첫 판만 적중률에 넣는다. 만든 사람의 플레이(maker)는 따로 센다.
import { sadd, hincrMany, hgetall, lpushCapped, lrange, incr } from './store.js';
import { REASON_OF } from './plant.js';

const aggKey = (t, maker) => `ss:${maker ? 'aggm' : 'agg'}:${t.id}:v${t.version}`;

export async function recordPlay(task, g, { deviceId, elapsedSec, marks, maker }) {
  const first = deviceId ? await sadd(`ss:seen:${task.id}:v${task.version}`, deviceId) : false;
  const fields = ['plays', `dec:${g.decision}`];
  if (first) {
    fields.push('first', `firstdec:${g.decision}`);
    for (const m of marks) fields.push(`mark:${m.sid}`);
    for (const sid of g.found) fields.push(`found:${sid}`);
    if (g.decisionOk) fields.push('decisionOk');
  }
  await hincrMany(aggKey(task, maker), fields);
  if (first && !maker) {
    const tf = [];
    for (const p of task.answer.planted) {
      tf.push(`planted:${REASON_OF[p.type]}`);
      if (g.found.includes(p.sid)) tf.push(`found:${REASON_OF[p.type]}`);
    }
    tf.push('firstPlays', `fa:${g.falseAlarms.length}`);
    await hincrMany('ss:agg:types', tf);
  }
  await incr(`ss:count:${maker ? 'maker' : 'plays'}`);
  await lpushCapped('ss:plays', {
    at: new Date().toISOString(), taskId: task.id, version: task.version, device: deviceId ?? null, first, maker: !!maker,
    elapsedSec: Number.isFinite(elapsedSec) ? Math.round(elapsedSec) : null,
    marks: marks.map((m) => ({ sid: m.sid, reason: m.reason ?? null })), decision: g.decision,
    found: g.found.length, missed: g.missed.length, falseAlarms: g.falseAlarms.length, score: g.score,
  });
  return { first };
}

/** 이 과제를 처음 푼 사람(만든 사람 제외) 가운데 문장마다 짚은 비율 */
export async function peerStats(task) {
  const h = await hgetall(aggKey(task, false));
  const first = h.first ?? 0;
  const planted = Object.fromEntries(task.answer.planted.map((p) => [p.sid, { found: h[`found:${p.sid}`] ?? 0 }]));
  const marked = Object.fromEntries(task.sentences.map((s) => [s.sid, h[`mark:${s.sid}`] ?? 0]));
  return { firstPlays: first, plays: h.plays ?? 0, planted, marked, approve: h['firstdec:승인'] ?? 0, reject: h['firstdec:반려'] ?? 0 };
}

export async function playCount(task) {
  const h = await hgetall(aggKey(task, false));
  return h.plays ?? 0;
}

export async function overallStats() {
  const t = await hgetall('ss:agg:types');
  const types = {};
  for (const [k, v] of Object.entries(t)) {
    const m = k.match(/^(planted|found):(.+)$/);
    if (!m) continue;
    types[m[2]] ??= { planted: 0, found: 0 };
    types[m[2]][m[1]] = v;
  }
  return {
    plays: Number(await incr('ss:count:plays', 0)), makerPlays: Number(await incr('ss:count:maker', 0)),
    firstPlays: t.firstPlays ?? 0, types,
  };
}

export async function recordFeedback({ taskId, helpful, note, deviceId, maker }) {
  // 만든 사람의 반응은 따로 둔다(사용자 반응 수에 섞지 않는다)
  await hincrMany(maker ? 'ss:fbm' : 'ss:fb', [`${helpful ? 'yes' : 'no'}`, `${helpful ? 'yes' : 'no'}:${taskId}`]);
  if (note && !maker) await lpushCapped('ss:fbnotes', { at: new Date().toISOString(), taskId, helpful, note, device: deviceId ?? null }, 1000);
}

export async function feedbackStats() {
  const h = await hgetall('ss:fb');
  return { yes: h.yes ?? 0, no: h.no ?? 0 };
}

export const recentPlays = (n = 200) => lrange('ss:plays', 0, n - 1);
