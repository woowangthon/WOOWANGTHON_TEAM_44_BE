// AI 1차 판정 점검: 저장된 답안 하나(저장소 파일에서 읽기만)를 장부 파일 하나에 대고 판정을 돌려 결과를 보고서로 남긴다.
// 운영 저장소에는 쓰지 않는다: STORE_FILE 없이(메모리) 돌고, 답안·장부 파일은 읽기만 한다. 이의 대기열에도 넣지 않는다.
//   node --env-file=.env scripts/triage-check.js --store <저장소 파일 사본> --answer <답안 id> --ledger data/ledgers/<판>.v1.json [--model claude-sonnet-5-5]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMission, loadDocs } from '../src/mission.js';
import { judgeMarks } from '../src/triage.js';
import { usageLog } from '../src/llm.js';

if (process.env.STORE_FILE) { console.error('STORE_FILE을 비우고 돌리세요(운영 저장소에 쓰지 않게)'); process.exit(1); }
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const store = JSON.parse(readFileSync(arg('store'), 'utf8'));
const answer = new Map(store.kv).get(`ss2:ans:${arg('answer')}`);
if (!answer) { console.error('답안이 없습니다'); process.exit(1); }
const ledger = JSON.parse(readFileSync(arg('ledger'), 'utf8'));
const run = JSON.parse(readFileSync(join('data', 'runs', `${answer.runId}.json`), 'utf8'));
const mission = loadMission(run.missionId);
const docs = loadDocs(mission);
const r = await judgeMarks({ mission, docs, run, ledger, marks: answer.marks, model: arg('model') });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 16).replace(/[-T:]/g, '');
const out = { at: new Date().toISOString(), answerId: answer.id, runId: run.id, ledger: { file: arg('ledger'), version: ledger.version, status: ledger.status }, model: r.model, sec: r.sec, cost: r.cost, judgments: r.judgments };
writeFileSync(join('reports', `triage-check-${stamp}.json`), JSON.stringify(out, null, 2));
writeFileSync(join('reports', `usage-triage-check-${stamp}-${process.pid}.json`), JSON.stringify(usageLog, null, 2));
const KO = { grounded: '근거 있음(새 오류 후보)', ungrounded: '근거 못 찾음', unclear: '판단 어려움', same: '장부 이유와 같음', different: '장부 이유와 다름' };
console.log(`모델 ${r.model} · ${r.sec}초 · 추정 $${(r.cost ?? 0).toFixed(4)}`);
for (const j of r.judgments) console.log(`${j.uid}\t${j.kind === 'new' ? '장부에 없는 칸' : `같은 칸(${j.items.join(',')})`}\t${KO[j.verdict]}${j.verdict !== j.modelVerdict ? `(모델은 ${KO[j.modelVerdict]}, 인용 불일치로 낮춤)` : ''}\t${j.why}\t${j.evidence.map((e) => `${e.ref}${e.found ? '' : '(인용 안 맞음)'}`).join(',')}`);
