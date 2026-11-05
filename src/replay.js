// 시나리오를 처음부터 끝까지 재생하고, expected.demo_decisions가 있으면 해당 시점에 당직자 결정을 넣는다(테스트·평가용)
import { createSession, advanceTo, decide, makeHandover } from './engine.js';

export async function replayScenario(scn, { decisions = scn.expected?.demo_decisions ?? [], onStep } = {}) {
  const state = createSession(scn);
  const decisionLog = [];
  for (const s of scn.signals) {
    const steps = await advanceTo(scn, state, s.t);
    for (const st of steps) {
      onStep?.(st, state);
      for (const d of decisions.filter((x) => x.after === st.signal.id)) {
        const inc = state.incidents.find((i) => i.signal_ids.includes(d.incident_of));
        if (!inc) {
          decisionLog.push({ ...d, skipped: '사건 없음' });
          continue;
        }
        decide(scn, state, { incident_id: inc.id, action: d.action, reason: d.reason, recipients: d.recipients });
        decisionLog.push({ ...d, incident_id: inc.id });
      }
    }
  }
  await advanceTo(scn, state, scn.clock.end);
  const report = await makeHandover(scn, state);
  return { state, report, decisionLog };
}
