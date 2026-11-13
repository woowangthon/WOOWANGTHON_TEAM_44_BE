// 11/13 오후: 팀장 모드 장부의 같은 구절 합치기(다른 감사 사이에만). 같은 감사가 같은 칸에서 짚은 다른 문제는 그대로 둔다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mergeSamePhrase } from '../src/tidy.js';
import { buildLedger } from '../src/audit.js';
import { loadMission, loadDocs } from '../src/mission.js';

const it = (o) => ({ spread: [], spreadCandidates: [], pattern: '기타', why: 'w', ...o });

test('다른 감사가 같은 칸의 같은 구절을 따로 올렸으면 하나로, 옮겨진 칸은 v2 규칙으로 다시 나눔', () => {
  const L = { items: [
    it({ id: 'L1', origin: 'S2.r1', wrongText: '마감까지 10일 남음', grade: 'B', spread: [], spreadCandidates: ['S3.n1', 'S4.b1'], byAudit: { Anthropic: { grade: 'B' } }, source: 'one' }),
    it({ id: 'L2', origin: 'S2.r1', wrongText: '마감까지 10일 남음(11월 22일)', grade: 'A', spreadCandidates: ['S3.n1'], byAudit: { OpenAI: { grade: 'A' } }, source: 'one' }),
    // 같은 감사(Anthropic)가 같은 칸에서 짚은 다른 문제: 합치지 않는다
    it({ id: 'L3', origin: 'S2.r1', wrongText: '마감까지 10일', grade: 'A', byAudit: { Anthropic: { grade: 'A' } }, source: 'one' }),
  ] };
  assert.equal(mergeSamePhrase(L), 1);
  assert.deepEqual(L.items.map((x) => x.id), ['L1', 'L3']);
  const a = L.items[0];
  assert.equal(a.grade, 'A'); assert.equal(a.source, 'both'); assert.equal(a.gradeSplit, true);
  assert.deepEqual(Object.keys(a.byAudit).sort(), ['Anthropic', 'OpenAI']);
  assert.deepEqual(a.spread, ['S3.n1']); // 두 감사가 함께 댄 칸
  assert.deepEqual(a.spreadCandidates, ['S4.b1']); // 한쪽만
  assert.deepEqual(L.merged, [{ from: 'L2', into: 'L1', wrongText: '마감까지 10일 남음(11월 22일)' }]);
});

test('다른 칸이거나 구절이 다르면 합치지 않는다', () => {
  const L = { items: [
    it({ id: 'L1', origin: 'S2.r1', wrongText: '마감까지 10일 남음', grade: 'A', byAudit: { Anthropic: {} } }),
    it({ id: 'L2', origin: 'S2.r2', wrongText: '마감까지 10일 남음', grade: 'A', byAudit: { OpenAI: {} } }),
    it({ id: 'L3', origin: 'S2.r1', wrongText: '만 34세 이하 청년이면 누구나', grade: 'A', byAudit: { OpenAI: {} } }),
  ] };
  assert.equal(mergeSamePhrase(L), 0);
  assert.equal(L.items.length, 3);
  assert.equal(L.merged, undefined);
});

test('기존 판 감사(작업 회사를 뺀 두 감사, v2)로 만든 장부는 합칠 것이 없다: 지금 팀장 모드 결과가 바뀌지 않음(파일은 읽기만)', () => {
  let n = 0, runs = 0;
  for (const f of readdirSync('data/runs').filter((x) => x.endsWith('.json'))) {
    const run = JSON.parse(readFileSync(`data/runs/${f}`, 'utf8'));
    let audits; try { audits = JSON.parse(readFileSync(`data/ledgers/${run.id}.audits.json`, 'utf8')); } catch { continue; }
    audits = audits.filter((a) => a.company !== run.workerCompany);
    if (audits.length < 2) continue;
    const m = loadMission(run.missionId);
    n += mergeSamePhrase(buildLedger(run, m, loadDocs(m), audits, { rule: 'v2' }));
    runs++;
  }
  assert.ok(runs >= 10);
  assert.equal(n, 0);
});
