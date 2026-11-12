// 저장된 감사 원문(data/ledgers/<id>.audits.json)으로 장부 1판을 다시 만든다(모델 호출 없음). 코드 대조 규칙을 고친 뒤에 쓴다.
// 사람 검수 판(v2 이상)은 건드리지 않는다. 묶기 규칙은 지금 1판에 적힌 것을 그대로 쓴다(없으면 v1). 바꾸려면 --rule v2.
// 고정 판(data/fixed.json, 사람이 풀고 검수 중인 판)은 건너뛴다. 꼭 다시 만들려면 --include-fixed.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadMission, loadDocs, finalKeys } from '../src/mission.js';
import { buildLedger, ledgerCounts } from '../src/audit.js';

const D = join(process.cwd(), 'data');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const fixed = new Set(existsSync(join(D, 'fixed.json')) ? JSON.parse(readFileSync(join(D, 'fixed.json'), 'utf8')).map((f) => f.runId) : []);
for (const f of readdirSync(join(D, 'ledgers')).filter((x) => x.endsWith('.audits.json'))) {
  const id = f.replace(/\.audits\.json$/, '');
  if (fixed.has(id) && !process.argv.includes('--include-fixed')) { console.log(`${id}: 고정 판이라 건너뜀`); continue; }
  const v1f = join(D, 'ledgers', `${id}.v1.json`);
  const rule = arg('rule') ?? (existsSync(v1f) ? JSON.parse(readFileSync(v1f, 'utf8')).rule : null) ?? 'v1';
  const run = JSON.parse(readFileSync(join(D, 'runs', `${id}.json`), 'utf8'));
  const m = loadMission(run.missionId);
  const audits = JSON.parse(readFileSync(join(D, 'ledgers', f), 'utf8'));
  const L = buildLedger(run, m, loadDocs(m), audits, { rule });
  writeFileSync(join(D, 'ledgers', `${id}.v1.json`), JSON.stringify(L, null, 2));
  const c = ledgerCounts(L, finalKeys(run.stages));
  console.log(`${id}: 감사 ${audits.map((a) => `${a.company}(${a.errors.length})`).join(' ')} · 묶음 ${L.items.length}(둘 이상 ${L.items.filter((x) => x.source === 'both').length}) · A ${c.A}(둘 이상 A ${c.Aboth}, 최종본 ${c.Afinal}) B ${c.B} C ${c.C} · 코드만 ${L.codeOnly.length}`);
}
