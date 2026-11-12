// 고정 미션 판과 기준 판(대충·기본·잘)을 만든다: 작업 → 감사(세 회사, 키가 있는 것만) → 코드 대조 → 장부 1판(AI).
// 결과물은 손대지 않는다. 판 파일 data/runs/<id>.json, 장부 data/ledgers/<id>.v1.json. 사람 검수는 검수 화면에서.
//
//   node --env-file=.env scripts/make-runs.js --mission m4 --style base --workers Anthropic,OpenAI,Google --runs 2
//   node --env-file=.env scripts/make-runs.js --mission m4 --audit-only m4-base-openai-11121700-1   (감사만 다시)
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadMission, loadDocs, runAll } from '../src/mission.js';
import { audit, buildLedger, ledgerCounts } from '../src/audit.js';
import { WORKERS, auditorsFor, usageLog, available } from '../src/llm.js';
import { finalKeys } from '../src/mission.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const mission = loadMission(arg('mission', 'm4'));
const style = arg('style', 'base');
const runs = Number(arg('runs', 1));
const companies = arg('workers', 'Anthropic').split(',').filter(available);
const role = arg('role', style === 'base' ? 'candidate' : 'baseline');
const PAR = Number(arg('parallel', 3));
const RUNS = join(process.cwd(), 'data', 'runs');
const LEDGERS = join(process.cwd(), 'data', 'ledgers');
mkdirSync(RUNS, { recursive: true }); mkdirSync(LEDGERS, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 16).replace(/[-T:]/g, '');

// --redo OpenAI,Google: 그 회사 감사만 다시 하고 나머지는 저장된 감사 원문을 쓴다
const REDO = arg('redo', '').split(',').filter(Boolean);
async function auditRun(run) {
  const docs = loadDocs(mission);
  const f = join(LEDGERS, `${run.id}.audits.json`);
  // --fill: 저장된 감사는 두고 빠진 회사만 채운다
  const saved = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  const kept = REDO.length ? saved.filter((a) => !REDO.includes(a.company)) : process.argv.includes('--fill') ? saved : [];
  const auditors = auditorsFor(run.workerCompany, { all: true }).filter((m) => !kept.some((a) => a.model === m));
  const settled = await Promise.allSettled(auditors.map((m) => audit(m, mission, docs, run.stages, `audit ${m} ${run.id}`)));
  const audits = [...kept, ...settled.filter((s) => s.status === 'fulfilled').map((s) => s.value)];
  settled.filter((s) => s.status === 'rejected').forEach((s, i) => console.log(`  감사 실패 ${run.id}: ${s.reason.message}`));
  const ledger = buildLedger(run, mission, docs, audits);
  // 감사 원문도 남긴다(검증 수치·재계산용)
  writeFileSync(join(LEDGERS, `${run.id}.audits.json`), JSON.stringify(audits, null, 2));
  writeFileSync(join(LEDGERS, `${run.id}.v1.json`), JSON.stringify(ledger, null, 2));
  const c = ledgerCounts(ledger, finalKeys(run.stages));
  console.log(`  장부 1판 ${run.id}: 감사 ${audits.map((a) => `${a.company}(${a.errors.length})`).join(' ')} · A ${c.A}(둘 이상 A ${c.Aboth}, 최종본 ${c.Afinal}) B ${c.B} C ${c.C} · 코드만 ${ledger.codeOnly.length}`);
}

async function one(company, n) {
  const worker = WORKERS()[company];
  const id = `${mission.id}-${style}-${company.toLowerCase()}-${stamp}-${n}`;
  try {
    const r = await runAll(mission, { style, worker, label: id });
    const run = { id, role, origin: 'fixed', ...r };
    writeFileSync(join(RUNS, `${id}.json`), JSON.stringify(run, null, 2));
    console.log(`작업 끝 ${id} (${run.sec}초)`);
    await auditRun(run);
  } catch (e) { console.log(`실패 ${id}: ${e.message}`); }
}

const only = arg('audit-only');
if (only) {
  // 쉼표로 여러 판, 또는 접두어(예: m4-base-)
  const ids = only.includes(',') ? only.split(',') : readdirSync(RUNS).filter((x) => x.startsWith(only) && x.endsWith('.json')).map((x) => x.slice(0, -5));
  const q = [...ids];
  await Promise.all(Array.from({ length: Math.min(PAR, q.length) }, async () => { while (q.length) { const id = q.shift(); await auditRun(JSON.parse(readFileSync(join(RUNS, `${id}.json`), 'utf8'))); } }));
} else {
  const jobs = companies.flatMap((c) => Array.from({ length: runs }, (_, i) => [c, i + 1]));
  const q = [...jobs];
  await Promise.all(Array.from({ length: Math.min(PAR, q.length) }, async () => { while (q.length) { const [c, n] = q.shift(); await one(c, n); } }));
}
const cost = usageLog.reduce((s, u) => s + (u.cost ?? 0), 0);
writeFileSync(join(process.cwd(), 'reports', `usage-make-runs-${stamp}-${process.pid}.json`), JSON.stringify(usageLog, null, 2));
console.log(`추정 비용 $${cost.toFixed(3)}, 호출 ${usageLog.filter((u) => !u.failed).length}, 실패 ${usageLog.filter((u) => u.failed).length}`);
