// 재생 e2e: 실제 Claude API로 가상 시나리오를 끝까지 재생 (키가 없으면 건너뜀)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayScenario } from '../src/replay.js';
import { scoreRun } from '../src/metrics.js';

const scn = JSON.parse(readFileSync(new URL('../scenarios/gaon-202607-demo.json', import.meta.url)));

test('재생 e2e: 신호 → 사건 → 인용 → 권고 → 결정 → 로그 → 인계 보고서', { skip: !process.env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY 없음', timeout: 600_000 }, async () => {
  const { state, report, decisionLog } = await replayScenario(scn);
  const m = scoreRun(scn, state, report);
  console.log(JSON.stringify(m));

  assert.equal(m.ai_errors, 0, 'AI 호출 오류');
  assert.equal(m.citations_hallucinated, 0, '원문과 다른 인용이 화면에 올라감');
  assert.ok(m.citations_shown > 0, '인용이 하나도 없음');
  assert.ok(m.association_accuracy >= 0.9, `사건 결합 정확도 ${m.association_accuracy}`);
  assert.equal(m.merged_expected_incidents, 0, '서로 다른 사건이 하나로 묶임');
  m.grade_timing.forEach((g) => assert.ok(g.ok, `${g.incident} ${g.grade} 권고가 ${g.not_later_than}까지 안 나옴`));
  assert.deepEqual(m.draft_unsupported_numbers, [], '초안에 근거 없는 수치·시각');

  assert.equal(decisionLog.filter((d) => !d.skipped).length, scn.expected.demo_decisions.length);
  assert.ok(state.log.some((e) => e.type === 'decision' && e.action === 'hold'));
  const i1 = state.incidents.find((i) => i.signal_ids.includes('S10'));
  assert.ok(i1.draft.recipients.includes('K1'), '관리주체가 수신처 초안에 없음');
  assert.ok(i1.decisions.every((d) => d.sent === false), '실제 발송 표시가 있으면 안 됨');

  assert.match(report.markdown, /## 요약/);
  assert.match(report.markdown, /당직자 결정: 통제 검토 요청/);
  assert.match(report.markdown, /재생 모드 · 합성 신호/);
});
