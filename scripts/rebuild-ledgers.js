// 저장된 감사 원문(data/ledgers/<id>.audits.json)으로 장부 1판을 다시 만든다(모델 호출 없음). 코드 대조 규칙을 고친 뒤에 쓴다.
// 사람 검수 판(v2 이상)은 건드리지 않는다.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMission, loadDocs, finalKeys } from '../src/mission.js';
import { buildLedger, ledgerCounts } from '../src/audit.js';

const D = join(process.cwd(), 'data');
for (const f of readdirSync(join(D, 'ledgers')).filter((x) => x.endsWith('.audits.json'))) {
  const id = f.replace(/\.audits\.json$/, '');
  const run = JSON.parse(readFileSync(join(D, 'runs', `${id}.json`), 'utf8'));
  const m = loadMission(run.missionId);
  const audits = JSON.parse(readFileSync(join(D, 'ledgers', f), 'utf8'));
  const L = buildLedger(run, m, loadDocs(m), audits);
  writeFileSync(join(D, 'ledgers', `${id}.v1.json`), JSON.stringify(L, null, 2));
  const c = ledgerCounts(L, finalKeys(run.stages));
  console.log(`${id}: 감사 ${audits.map((a) => `${a.company}(${a.errors.length})`).join(' ')} · 묶음 ${L.items.length}(둘 이상 ${L.items.filter((x) => x.source === 'both').length}) · A ${c.A}(둘 이상 A ${c.Aboth}, 최종본 ${c.Afinal}) B ${c.B} C ${c.C} · 코드만 ${L.codeOnly.length}`);
}
