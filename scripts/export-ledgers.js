// 검수·이의로 생긴 장부 판(KV 또는 로컬 STORE_FILE)을 저장소 data/ledgers/<id>.v<n>.json으로 내보낸다. 이력(reviewLog)이 함께 간다.
// 로컬: STORE_FILE=.local-store.json node scripts/export-ledgers.js / 운영 KV: KV_REST_API_URL·TOKEN을 주고 실행
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixedRunIds, ledgerVersions } from '../src/ledger.js';

let n = 0;
for (const id of fixedRunIds()) {
  for (const L of await ledgerVersions(id)) {
    if (L.version === 1) continue;
    const f = join(process.cwd(), 'data', 'ledgers', `${id}.v${L.version}.json`);
    const had = existsSync(f);
    writeFileSync(f, JSON.stringify(L, null, 2));
    console.log(`${had ? '덮어씀' : '새로'} ${id} ${L.version}판(${L.status}, 항목 ${L.items.length}, 이력 ${L.reviewLog?.length ?? 0})`);
    n++;
  }
}
console.log(`내보낸 판 ${n}개`);
