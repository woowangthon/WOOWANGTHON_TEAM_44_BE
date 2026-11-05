// 사용법: npm run eval -- [시나리오 id] [반복 횟수=5]
// 같은 시나리오를 N회 재생해 결합 정확도·권고 시점·인용 환각·초안 수치 일치를 집계한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { replayScenario } from '../src/replay.js';
import { scoreRun } from '../src/metrics.js';
import { getUsage, resetUsage, MODELS } from '../src/llm.js';

const id = process.argv[2] || 'gaon-202607-demo';
const n = Number(process.argv[3] || 5);
const scn = JSON.parse(readFileSync(new URL(`../scenarios/${id}.json`, import.meta.url)));
const runs = [];
for (let i = 0; i < n; i++) {
  resetUsage();
  const t0 = Date.now();
  const { state, report } = await replayScenario(scn);
  const m = scoreRun(scn, state, report);
  runs.push({ run: i + 1, secs: Math.round((Date.now() - t0) / 1000), ...m, usage: getUsage() });
  console.log(`run ${i + 1}/${n}`, JSON.stringify(runs.at(-1)));
}
const sum = (k) => runs.reduce((a, r) => a + (typeof r[k] === 'number' ? r[k] : r[k].length), 0);
const agg = {
  scenario: id, runs: n, models: MODELS, at: new Date().toISOString(),
  association_accuracy_mean: +(sum('association_accuracy') / n).toFixed(3),
  runs_with_merged_incidents: runs.filter((r) => r.merged_expected_incidents > 0).length,
  grade_timing_ok_runs: runs.filter((r) => r.grade_timing.every((g) => g.ok)).length,
  citations_shown_total: sum('citations_shown'),
  citations_hallucinated_total: sum('citations_hallucinated'),
  citations_blocked_total: sum('citations_blocked_by_verifier'),
  facts_rejected_total: sum('facts_rejected_by_verifier'),
  draft_unsupported_total: sum('draft_unsupported_numbers'),
  handover_summary_verified_runs: runs.filter((r) => r.handover_summary_verified).length,
  ai_errors_total: sum('ai_errors'),
  llm_calls_mean: +(sum('llm_calls') / n).toFixed(1),
  tokens_mean: Math.round(runs.reduce((a, r) => a + r.usage.input_tokens + r.usage.output_tokens, 0) / n),
  secs_mean: Math.round(sum('secs') / n),
};
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./out/${id}.eval.json`, import.meta.url), JSON.stringify({ agg, runs }, null, 1));
console.log(JSON.stringify(agg, null, 1));
