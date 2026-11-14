// 장부 판별 재채점 골든 테스트(설계안 6.2-B1·B4). 기능을 더하기 전 채점을 고정한다.
// golden-score.json은 2dfb3be의 score.js로 만든 스냅샷이다. 새 필드(evidenceUse 등)를 더해도 나머지는 바이트 단위로 같아야 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getRun, ledgerVersions } from '../src/ledger.js';
import { scoreAnswer, rescore } from '../src/score.js';
import { CASES, TABLE, G1 } from './golden-cases.js';

const SNAP = JSON.parse(readFileSync(new URL('./fixtures/golden-score.json', import.meta.url), 'utf8'));
// 나중에 더한 필드는 빼고 견준다(옛 답안 호환)
const ADDED = ['evidenceUse', 'calibration'];
const base = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !ADDED.includes(k)));
const run = await getRun(G1);
const vs = await ledgerVersions(G1);
const L = (v) => vs.find((l) => l.version === v);

test('골든 B1: G1 v2·v3 채점 표(A·찾음·헛짚음·bcSeen·처음 생긴 곳·결재·점수)', () => {
  for (const [k, ans] of Object.entries(CASES)) for (const v of [2, 3]) {
    const r = scoreAnswer(run, L(v), ans);
    const [A, foundA, falseMarks, bcSeen, originHits, originable, decisionOk, score] = TABLE[k][v];
    assert.deepEqual([r.counts.A, r.counts.foundA, r.falseMarks, r.bcSeen, r.counts.originHits, r.counts.originable, r.decisionOk, r.score],
      [A, foundA, falseMarks, bcSeen, originHits, originable, decisionOk, score], `${k}@v${v}`);
  }
});

test('골든 B1: S4.b5 줄은 v2에서 헛짚음, v3에서 B·C 참고(H1 추가)', () => {
  const r = rescore(run, vs, { ...CASES.bcSplit, ledgerVersion: 2 });
  assert.equal(r.changed, true);
  assert.equal(r.before.score, 20); assert.equal(r.now.score, 30);
  assert.deepEqual(r.before.falseMarks, ['S4.b5', 'S5.n2']); assert.deepEqual(r.now.bcSeen, ['S4.b5']);
});

test('골든 B1: 처음 생긴 곳 분모는 4(L4b는 originConfirmed가 아님)', () => {
  const r = scoreAnswer(run, L(3), CASES.origins4);
  assert.equal(r.counts.originable, 4);
  assert.equal(r.perItem.find((p) => p.id === 'L4b').originConfirmed, false);
});

test('골든 B4: 스냅샷과 깊은 비교(나중에 더한 필드만 빼고)', () => {
  for (const [k, ans] of Object.entries(CASES)) for (const v of [2, 3]) assert.deepEqual(base(scoreAnswer(run, L(v), ans)), SNAP[`${k}@v${v}`], `${k}@v${v}`);
});

test('골든 B7: 사람 검수 전(ai) 장부로는 채점하지 않는다(409)', () => {
  assert.throws(() => scoreAnswer(run, L(1), CASES.emptyReject), (e) => e.status === 409);
});
