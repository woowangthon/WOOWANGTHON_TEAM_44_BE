// V4 라이브 모드: 서버와 같은 함수(src/live.js)로 새 보고서를 여러 번 만들어 성공률·걸린 시간·실패 사유를 센다.
// 사용법: node --env-file=.env scripts/v4-live.js [횟수=10] [--text 붙여넣기용.txt ...]
//  - 공공 자료 묶음에서 차례로 고르고, --text로 준 파일은 「내 자료 붙여 넣기」로 넣는다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { startJob, runStep, poolSources } from '../src/live.js';
import { usageLog } from '../src/llm.js';
import { getJson } from '../src/store.js';

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);
const texts = args.flatMap((a, i) => (args[i - 1] === '--text' ? [a] : []));
const pool = poolSources();
const runs = [];
for (let i = 0; i < n + texts.length; i++) {
  const isText = i >= n;
  const start = isText
    ? { mode: 'text', text: readFileSync(texts[i - n], 'utf8'), title: texts[i - n].split('/').at(-1).replace(/\.txt$/, '') }
    : { mode: 'pool', sourceId: pool[i % pool.length].id };
  const t0 = Date.now();
  const calls0 = usageLog.length;
  let v;
  try {
    v = await startJob({ ...start, deviceId: `maker-v4-${Date.now().toString(36)}`, maker: true });
    while (!['done', 'failed'].includes(v.status)) v = await runStep(v.jobId);
  } catch (e) { v = { status: 'failed', error: e.message }; }
  const task = v.taskId ? await getJson(`ss:live:task:${v.taskId}`) : null;
  const row = {
    i: i + 1, mode: start.mode, source: start.sourceId ?? start.title, status: v.status, error: v.error ?? null,
    sec: Math.round((Date.now() - t0) / 100) / 10, calls: usageLog.length - calls0,
    sentences: task?.sentences.length ?? null, planted: task?.answer.planted.length ?? null,
    types: task?.answer.planted.map((p) => p.type) ?? [],
    blind: task?.verification.blind ? { caught: task.verification.blind.caught, extra: task.verification.blind.extraFlags } : null,
    steps: task?.liveLog ?? null,
  };
  runs.push(row);
  console.log(`${row.i} ${row.mode} ${row.source}: ${row.status} ${row.sec}초 호출 ${row.calls}회 · 문장 ${row.sentences} · 오류 ${row.planted} · 눈 가린 풀이 ${row.blind ? `${row.blind.caught}/${row.planted}, 오탐 ${row.blind.extra}` : '-'}${row.error ? ` · ${row.error}` : ''}`);
}
const ok = runs.filter((r) => r.status === 'done');
const summary = {
  at: new Date().toISOString(), runs: runs.length, done: ok.length,
  secMedian: ok.map((r) => r.sec).sort((a, b) => a - b)[Math.floor(ok.length / 2)] ?? null,
  secMax: Math.max(0, ...ok.map((r) => r.sec)),
  zeroError: ok.filter((r) => r.planted === 0).length,
  blindExtra: ok.reduce((a, r) => a + (r.blind?.extra ?? 0), 0),
  calls: usageLog.length,
};
mkdirSync('reports/v4', { recursive: true });
writeFileSync(`reports/v4/live-${summary.at.slice(0, 16).replace(/[:T]/g, '')}.json`, JSON.stringify({ summary, runs }, null, 2));
console.log(JSON.stringify(summary));
