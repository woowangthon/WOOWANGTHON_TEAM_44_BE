// V1 파이프라인 통계: reports/pipeline/<id>.json(은행 과제를 만들 때 남긴 단계별 기록)을 모아 센다.
// 사용법: node scripts/v1-stats.js  → reports/v1-pipeline.md
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const files = readdirSync('reports/pipeline').filter((f) => f.endsWith('.json') && !f.endsWith('.p1.json'));
const rows = [];
const tot = { tries: 0, ok: 0, p1Kept: 0, p1Dropped: 0, p2Pass: 0, p2Fail: 0, p3Tries: 0, p3Code: 0, p4Model: 0, p4ModelOk: 0, planted: 0, blindCaught: 0, blindExtra: 0, calls: 0 };
for (const f of files) {
  const r = JSON.parse(readFileSync(`reports/pipeline/${f}`, 'utf8'));
  for (const a of r.attempts) {
    tot.tries++;
    if (a.result === 'ok') tot.ok++;
    tot.p1Kept += a.p1?.kept ?? 0; tot.p1Dropped += a.p1?.dropped?.length ?? 0;
    tot.p2Pass += a.p2?.passed ?? 0; tot.p2Fail += a.p2?.failed?.length ?? 0;
    const log = a.p3p4?.log ?? [];
    tot.p3Tries += log.filter((x) => x.step === 'P3').length;
    tot.p3Code += log.filter((x) => x.step === 'P4 코드' && x.ok).length;
    tot.p4Model += log.filter((x) => x.step === 'P4 점검').length;
    tot.p4ModelOk += log.filter((x) => x.step === 'P4 점검' && x.ok).length;
    if (a.result === 'ok') {
      tot.planted += a.p3p4?.planted ?? 0;
      tot.blindCaught += a.p5?.caught?.length ?? a.p5?.caught ?? 0;
      tot.blindExtra += a.p5?.extra?.length ?? 0;
    }
  }
  tot.calls += (r.usage ?? []).length;
  rows.push(`| ${r.id} | ${r.difficulty} | ${r.attempts.length} | ${r.attempts.map((a) => a.result).join(' / ')} | ${(r.usage ?? []).length} |`);
}
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const md = [
  '# V1 파이프라인 통계',
  '',
  `만든 때: ${new Date().toISOString().slice(0, 16)} · 기록 파일 ${files.length}개(은행 과제를 마지막으로 만든 실행만 남는다. 11/12 새벽 G1의 앞선 시도 6번은 작업기록에 따로 적었다)`,
  '',
  '| 단계 | 수 |',
  '|---|---|',
  `| 과제 시도 / 성공 | ${tot.tries} / ${tot.ok} (${pct(tot.ok, tot.tries)}) |`,
  `| P1 작성 문장(코드 통과 / 코드 검사에 두 번 걸려 뺌) | ${tot.p1Kept} / ${tot.p1Dropped} |`,
  `| P2 점검 모델 통과 / 실패 | ${tot.p2Pass} / ${tot.p2Fail} (통과율 ${pct(tot.p2Pass, tot.p2Pass + tot.p2Fail)}) |`,
  `| P3 심기 시도 / 코드 검사 통과 | ${tot.p3Tries} / ${tot.p3Code} |`,
  `| P4 점검 모델 판정 / 「틀렸다」 판정 | ${tot.p4Model} / ${tot.p4ModelOk} (${pct(tot.p4ModelOk, tot.p4Model)}) |`,
  `| 성공한 과제에 심은 오류 | ${tot.planted} |`,
  `| P5 눈 가린 풀이가 찾은 오류 / 심지 않은 곳을 짚은 수 | ${tot.blindCaught} / ${tot.blindExtra} |`,
  `| 모델 호출(기록이 남은 실행) | ${tot.calls} |`,
  '',
  '| 과제 | 난이도 | 시도 | 결과 | 호출 |',
  '|---|---|---|---|---|',
  ...rows,
].join('\n');
writeFileSync('reports/v1-pipeline.md', md + '\n');
console.log(md);
