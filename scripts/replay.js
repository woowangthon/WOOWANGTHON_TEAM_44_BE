// 사용법: npm run replay -- [시나리오 id] → eval/out/에 상태·인계 보고서 저장
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { replayScenario } from '../src/replay.js';
import { getUsage } from '../src/llm.js';
import { GRADE_KO } from '../src/util.js';

const id = process.argv[2] || 'gaon-202607-demo';
const scn = JSON.parse(readFileSync(new URL(`../scenarios/${id}.json`, import.meta.url)));
const t0 = Date.now();
const { state, report } = await replayScenario(scn, {
  onStep: ({ signal, incident }) =>
    console.log(`${signal.t} ${signal.id} → ${incident ? `#${incident.no} ${GRADE_KO[incident.grade]}` : '배경'} | ${signal.norm.one_line}`),
});
mkdirSync(new URL('../eval/out/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../eval/out/${id}.state.json`, import.meta.url), JSON.stringify(state, null, 1));
writeFileSync(new URL(`../eval/out/${id}.handover.md`, import.meta.url), report.markdown);
console.log({ secs: Math.round((Date.now() - t0) / 1000), metrics: state.metrics, usage: getUsage() });
