// 11/13 오전: 후보 칸(spreadCandidates)은 B·C 칸처럼 찾음에도 헛짚음에도 넣지 않는다(「판단이 갈리는 칸」)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnswer } from '../src/score.js';

const run = { id: 'mt-base-x-1', stages: [
  { key: 'S1', kind: 'list', units: [{ uid: 'S1.e1', text: 'a' }, { uid: 'S1.e2', text: 'b' }] },
  { key: 'S2', kind: 'table', units: [{ uid: 'S2.r1', text: 'c' }, { uid: 'S2.r2', text: 'd' }] },
  { key: 'S3', kind: 'lines', units: [{ uid: 'S3.n1', text: 'e' }, { uid: 'S3.n2', text: 'f' }, { uid: 'S3.n3', text: 'g' }] },
] };
// L1(A): 처음 생긴 곳 S1.e1, 확정된 옮겨진 칸 S2.r1, 후보 칸 S3.n1
// L2(A): 처음 생긴 곳 S1.e2, 후보 칸 S2.r1(L1의 확정 칸이라 후보로 세지 않음)·S3.n2
const ledger = { status: 'reviewed', version: 2, items: [
  { id: 'L1', grade: 'A', origin: 'S1.e1', spread: ['S2.r1'], spreadCandidates: ['S3.n1'] },
  { id: 'L2', grade: 'A', origin: 'S1.e2', spread: [], spreadCandidates: ['S2.r1', 'S3.n2'] },
] };
const ans = (uids) => ({ marks: uids.map((uid) => ({ uid })), decision: 'reject', reason: '반려 사유' });

test('후보 칸에 그은 줄: 찾음도 헛짚음도 아니고 판단이 갈리는 칸으로 따로 센다', () => {
  const r = scoreAnswer(run, ledger, ans(['S3.n1']));
  assert.deepEqual(r.falseMarks, []);
  assert.deepEqual(r.splitMarks, [{ uid: 'S3.n1', items: ['L1'] }]);
  assert.equal(r.counts.splitMarks, 1);
  assert.equal(r.counts.foundA, 0);
  assert.equal(r.perItem.find((p) => p.id === 'L1').found, false);
  // B·C 칸처럼 정확도에서 깎지 않는다(줄 하나뿐이고 헛짚음 0 → 정확도 1)
  assert.equal(r.score, Math.round(50 * 0 + 20 * 1 + 20 + 10));
});

test('확정된 옮겨진 칸에 그은 줄은 그대로 찾음(다른 항목의 후보 칸이어도)', () => {
  const r = scoreAnswer(run, ledger, ans(['S2.r1']));
  assert.equal(r.perItem.find((p) => p.id === 'L1').found, true);
  assert.deepEqual(r.perItem.find((p) => p.id === 'L1').hitUnits, ['S2.r1']);
  assert.equal(r.perItem.find((p) => p.id === 'L2').found, false);
  assert.deepEqual(r.splitMarks, []);
  assert.deepEqual(r.falseMarks, []);
});

test('장부 밖 칸에 그은 줄은 그대로 헛짚음', () => {
  const r = scoreAnswer(run, ledger, ans(['S3.n3', 'S3.n2', 'S1.e2']));
  assert.deepEqual(r.falseMarks, ['S3.n3']);
  assert.deepEqual(r.splitMarks, [{ uid: 'S3.n2', items: ['L2'] }]);
  assert.equal(r.counts.foundA, 1);
  assert.equal(r.counts.falseMarks, 1);
  // 정확도 = (줄 3 - 헛짚음 1) / 3
  assert.equal(r.score, Math.round(50 * 0.5 + 20 * (2 / 3) + 20 + 10));
});

test('후보 칸이 없는 장부(v1·G1)는 전과 같다', () => {
  const v1 = { status: 'reviewed', version: 3, items: ledger.items.map(({ spreadCandidates, ...x }) => x) };
  const r = scoreAnswer(run, v1, ans(['S3.n1']));
  assert.deepEqual(r.falseMarks, ['S3.n1']);
  assert.deepEqual(r.splitMarks, []);
});
