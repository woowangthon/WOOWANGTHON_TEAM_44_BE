// POST /api/session  상태는 클라이언트가 들고 다닌다(서버 저장소 없음)
// { op: 'start', scenario_id }
// { op: 'advance', scenario_id, state, until: 'HH:MM', max?: 1 }   재생 시계 진행(한 번에 max건)
// { op: 'memo', scenario_id, state, body, from? }                 당직자가 직접 넣은 전화 메모
// { op: 'decide', scenario_id, state, incident_id, action, reason, recipients, call_script?, sms? }
// { op: 'redraft', scenario_id, state, incident_id }               초안 다시 만들기
// { op: 'handover', scenario_id, state }
import { handler, loadScenario } from './_lib.js';
import { createSession, hydrate, ingest, decide, makeHandover, redraft } from '../src/engine.js';
import { getUsage } from '../src/llm.js';
import { toMin } from '../src/util.js';

export const config = { maxDuration: 60 };

export default handler(async (req) => {
  if (req.method !== 'POST') throw Object.assign(new Error('POST만 지원'), { status: 405 });
  const b = req.body ?? {};
  const scn = loadScenario(b.scenario_id);
  if (b.op === 'start') return { state: createSession(scn) };
  const state = hydrate(b.state);
  if (state?.scenario_id !== scn.id) throw new Error('상태와 시나리오가 맞지 않음');

  if (b.op === 'advance') {
    const max = Math.min(Number(b.max ?? 1), 3);
    const processed = [];
    while (processed.length < max && state.cursor < scn.signals.length && toMin(scn.signals[state.cursor].t) <= toMin(b.until)) {
      const r = await ingest(scn, state, scn.signals[state.cursor++]);
      processed.push(r.signal.id);
    }
    const more = state.cursor < scn.signals.length && toMin(scn.signals[state.cursor].t) <= toMin(b.until);
    if (!more && toMin(b.until) > toMin(state.now)) state.now = b.until;
    return { state, processed, more, done: state.cursor >= scn.signals.length };
  }
  if (b.op === 'memo') {
    if (!b.body?.trim()) throw new Error('메모 내용이 비었습니다');
    const n = state.signals.filter((s) => s.id.startsWith('L')).length + 1;
    const sig = { id: `L${String(n).padStart(2, '0')}`, t: state.now, channel: 'phone_memo', from: b.from?.trim() || '당직자 입력', body: b.body.trim().slice(0, 500), live: true };
    const r = await ingest(scn, state, sig);
    return { state, signal_id: r.signal.id };
  }
  if (b.op === 'decide') {
    const d = decide(scn, state, b);
    return { state, decision: d };
  }
  if (b.op === 'redraft') {
    const inc = state.incidents.find((i) => i.id === b.incident_id);
    if (!inc) throw new Error(`없는 사건: ${b.incident_id}`);
    const before = getUsage().calls;
    await redraft(scn, state, inc);
    state.metrics.llm_calls += getUsage().calls - before;
    return { state };
  }
  if (b.op === 'handover') return { state, ...(await makeHandover(scn, state)) };
  throw new Error(`알 수 없는 op: ${b.op}`);
});
