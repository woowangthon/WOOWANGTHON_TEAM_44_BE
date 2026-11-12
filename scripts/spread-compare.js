// 묶기·번진 곳 규칙 비교: 저장된 감사 원문(data/ledgers/*.audits.json)으로 v1(합집합)과 v2(교집합 + 후보)를 메모리에서 만들어 견준다.
// 모델 호출 없음. data/ledgers는 읽기만 하고, 결과는 reports/spread-compare.{md,json}에만 쓴다.
//   node scripts/spread-compare.js [--store <저장소 사본> --answer <답안 id>]   (답안을 주면 그 빨간 줄이 어느 항목 칸에 걸리는지도 본다)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMission, loadDocs, finalKeys } from '../src/mission.js';
import { buildLedger, ledgerCounts, auditUnits } from '../src/audit.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const D = join(process.cwd(), 'data');
const answer = arg('store') ? new Map(JSON.parse(readFileSync(arg('store'), 'utf8')).kv).get(`ss2:ans:${arg('answer')}`) : null;
const refs = (it) => [it.origin, ...it.spread];
const rows = [];
let g1 = null;
for (const f of readdirSync(join(D, 'ledgers')).filter((x) => x.endsWith('.audits.json')).sort()) {
  const id = f.replace(/\.audits\.json$/, '');
  const run = JSON.parse(readFileSync(join(D, 'runs', `${id}.json`), 'utf8'));
  const m = loadMission(run.missionId);
  const docs = loadDocs(m);
  const audits = JSON.parse(readFileSync(join(D, 'ledgers', f), 'utf8'));
  const total = auditUnits(run.stages).flatMap((s) => s.units).length;
  const fk = finalKeys(run.stages);
  const one = (rule) => {
    const L = buildLedger(run, m, docs, audits, { rule });
    const c = ledgerCounts(L, fk);
    const cover = new Set(L.items.flatMap(refs));
    const sizes = L.items.map((x) => x.spread.length);
    return { L, items: L.items.length, both: L.items.filter((x) => x.source === 'both').length, A: c.A, Aboth: c.Aboth, Afinal: c.Afinal, spreadSum: sizes.reduce((s, x) => s + x, 0), spreadMax: Math.max(0, ...sizes), cover: cover.size, cand: L.items.reduce((s, x) => s + (x.spreadCandidates?.length ?? 0), 0) };
  };
  const a = one('v1'), b = one('v2');
  rows.push({ id, style: run.style, worker: run.workerCompany, audits: audits.map((x) => `${x.company[0]}${x.errors.length}`).join(' '), total, v1: { ...a, L: undefined }, v2: { ...b, L: undefined } });
  if (answer && answer.runId === id) {
    const hit = (L, uid) => L.items.filter((it) => refs(it).includes(uid)).map((it) => `${it.id}(${it.grade})`);
    const candHit = (L, uid) => L.items.filter((it) => (it.spreadCandidates ?? []).includes(uid)).map((it) => it.id);
    g1 = { id, marks: answer.marks.map((mk) => ({ uid: mk.uid, note: mk.note.slice(0, 40), v1: hit(a.L, mk.uid), v2: hit(b.L, mk.uid), v2cand: candHit(b.L, mk.uid) })),
      v1Items: a.L.items.map((x) => ({ id: x.id, grade: x.grade, origin: x.origin, n: x.spread.length, src: Object.keys(x.byAudit).join('+'), w: x.wrongText.slice(0, 30) })),
      v2Items: b.L.items.map((x) => ({ id: x.id, grade: x.grade, origin: x.origin, n: x.spread.length, cand: x.spreadCandidates.length, src: Object.keys(x.byAudit).join('+'), w: x.wrongText.slice(0, 30) })) };
  }
}
const sum = (k, v) => rows.reduce((s, r) => s + r[v][k], 0);
const md = [
  '# 묶기·번진 곳 규칙 비교 (모델 호출 없음, 저장된 감사 원문 재적용)',
  '',
  `만든 때: ${new Date().toISOString()} · 판 ${rows.length}개 · 모두 **AI 감사 기준, 사람 확인 전**`,
  '- v1(11/12까지): 가리키는 칸이 하나라도 겹치면 같은 묶음, 묶음의 칸 집합이 커지며 이어 붙음. 번진 곳 = 묶음 안 모든 감사 칸의 합집합.',
  '- v2(새 장부 기본): 근원이 같거나 한쪽 근원이 다른 쪽 칸에 있고 틀린 구절이 겹쳐야 묶음(점수 2.5 이상, 짝은 점수 높은 순으로 한 번씩). 번진 곳 = 두 감사 이상이 함께 댄 칸. 한 감사만 댄 칸은 「후보」(채점에 안 씀, 검수 때 사람이 고름).',
  '',
  '| 합계 | v1 | v2 |', '|---|---|---|',
  `| 장부 항목 | ${sum('items', 'v1')} | ${sum('items', 'v2')} |`,
  `| 두 감사 이상이 묶인 항목 | ${sum('both', 'v1')} | ${sum('both', 'v2')} |`,
  `| A 항목 | ${sum('A', 'v1')} | ${sum('A', 'v2')} |`,
  `| 최종본에 닿은 A | ${sum('Afinal', 'v1')} | ${sum('Afinal', 'v2')} |`,
  `| 번진 곳 칸 수 합 | ${sum('spreadSum', 'v1')} | ${sum('spreadSum', 'v2')} (후보 ${sum('cand', 'v2')}) |`,
  `| 장부가 덮는 칸(빨간 줄이 「찾음」 또는 「B·C」로 잡히는 칸) | ${sum('cover', 'v1')} / ${rows.reduce((s, r) => s + r.total, 0)} | ${sum('cover', 'v2')} |`,
  '',
  '| 판 | 감사(회사·항목 수) | 칸 | 항목 v1→v2 | 묶음(둘 이상) | A | 최종본 A | 번진 곳 합(최대) | 덮는 칸 |', '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.audits} | ${r.total} | ${r.v1.items}→${r.v2.items} | ${r.v1.both}→${r.v2.both} | ${r.v1.A}→${r.v2.A} | ${r.v1.Afinal}→${r.v2.Afinal} | ${r.v1.spreadSum}(${r.v1.spreadMax})→${r.v2.spreadSum}(${r.v2.spreadMax}) | ${r.v1.cover}→${r.v2.cover} |`),
];
if (g1) {
  md.push('', `## G1 판 ${g1.id}: 만든 사람 풀이의 빨간 줄이 걸리는 장부 항목`, '', '실제 채점이 아니다(장부는 검수 전). 같은 빨간 줄이 규칙에 따라 어느 항목 칸에 걸리는지만 본다. G1 판의 v1 파일과 검수 초안은 바꾸지 않았다.', '',
    '| 빨간 줄 | 메모(앞부분) | v1에서 걸린 항목 | v2에서 걸린 항목 | v2 후보 칸인 항목 |', '|---|---|---|---|---|',
    ...g1.marks.map((x) => `| ${x.uid} | ${x.note} | ${x.v1.join(', ') || '없음(헛짚음)'} | ${x.v2.join(', ') || '없음(헛짚음)'} | ${x.v2cand.join(', ') || '—'} |`),
    '', 'v1 항목', '', ...g1.v1Items.map((x) => `- ${x.id} ${x.grade} 근원 ${x.origin} · 번진 곳 ${x.n}칸 · ${x.src} · 「${x.w}」`),
    '', 'v2 항목', '', ...g1.v2Items.map((x) => `- ${x.id} ${x.grade} 근원 ${x.origin} · 번진 곳 ${x.n}칸(후보 ${x.cand}) · ${x.src} · 「${x.w}」`));
}
writeFileSync(join('reports', 'spread-compare.md'), md.join('\n') + '\n');
writeFileSync(join('reports', 'spread-compare.json'), JSON.stringify({ rows, g1 }, null, 2));
console.log(md.slice(6, 14).join('\n'));
if (g1) console.log(md.slice(md.indexOf(md.find((l) => l.startsWith('## G1')))).join('\n'));
