// API 흐름(모델 호출 없음, 메모리 저장소): 만든 사람 풀이 → 검수 → 확정 → 채점 → 이의 → 새 판 → 재채점
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { _memReset } from '../src/store.js';

process.env.REVIEW_CODE = 'test-code';
for (const k of ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
const missions = (await import('../api/missions.js')).default;
const play = (await import('../api/play.js')).default;
const review = (await import('../api/review.js')).default;
const stats = (await import('../api/stats.js')).default;

function call(fn, { method = 'POST', query = {}, body, code } = {}) {
  return new Promise((ok) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { ok({ status: this.code, body: x }); }, end() { ok({ status: this.code }); } };
    fn({ method, query, body, headers: code ? { 'x-review-code': code } : {} }, res);
  });
}

const runId = readdirSync('data/runs').filter((f) => f.endsWith('.json'))[0]?.replace(/\.json$/, '');

test('판 공개 응답에는 장부 내용이 없다', { skip: !runId }, async () => {
  _memReset();
  const r = await call(missions, { method: 'GET', query: { run: runId } });
  assert.equal(r.status, 200);
  assert.ok(r.body.stages.length >= 2);
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes('"items"') && !s.includes('"why"') && !s.includes('byAudit'));
  assert.equal(r.body.meta.playable, false);
});

test('검수 전: 일반 사용자 답안은 409, 만든 사람 풀이는 저장(채점 보류), 풀기 전 검수 화면은 423', { skip: !runId }, async () => {
  _memReset();
  const ans = { action: 'answer', runId, deviceId: 'dev-user-0001', marks: [], decision: 'approve' };
  assert.equal((await call(play, { body: ans })).status, 409);
  assert.equal((await call(review, { method: 'GET', query: { run: runId }, code: 'test-code' })).status, 423);
  assert.equal((await call(review, { method: 'GET', query: { run: runId }, code: 'wrong' })).status, 403);
  const m = await call(play, { body: { ...ans, deviceId: 'dev-maker-001', maker: true, decision: 'reject', reason: '조건이 바뀜', marks: [{ uid: 'S1.e1' }] } });
  assert.equal(m.status, 200); assert.equal(m.body.pending, true);
  // AI 1차 판정: 사람 검수 장부가 없으면 부르지 않는다(모델 호출 없음)
  const tr = await call(play, { body: { action: 'triage', answerId: m.body.answerId } });
  assert.equal(tr.status, 200); assert.equal(tr.body.triage.status, 'skipped');
  // 검수 대기열: 판정 진행률이 붙는다(초안 없으면 null)
  const qq = await call(review, { method: 'GET', code: 'test-code' });
  assert.ok(qq.body.runs.every((r) => 'progress' in r));

  // 검수: 모든 항목 판정 + 직접 추가 → 확정
  const g = await call(review, { method: 'GET', query: { run: runId }, code: 'test-code' });
  assert.equal(g.status, 200);
  for (const it of g.body.draft.items) {
    const r = await call(review, { body: { runId, op: { action: it.grade === 'C' ? 'delete' : 'approve', item: it.id, note: '확인' } }, code: 'test-code' });
    assert.equal(r.status, 200);
  }
  const add = await call(review, { body: { runId, op: { action: 'add', origin: 'S1.e1', grade: 'A', pattern: '한정어·조건 탈락', why: '직접 대조로 추가', originConfirmed: true } }, code: 'test-code' });
  assert.equal(add.status, 200);
  const fin = await call(review, { body: { runId, finalize: true }, code: 'test-code' });
  assert.equal(fin.status, 200); assert.equal(fin.body.ledger.status, 'reviewed');

  // 만든 사람 답안 결과가 이제 나온다(추가한 S1.e1을 짚었다)
  const res = await call(play, { body: { action: 'result', answerId: m.body.answerId } });
  assert.equal(res.status, 200); assert.ok(res.body.result.counts.foundA >= 1); assert.equal(res.body.result.counts.originHits, 0);

  // 일반 사용자 답안 채점 + 장부 공개
  const u = await call(play, { body: { ...ans, marks: [{ uid: 'S1.e1', origin: true }], decision: 'reject', reason: '조건이 바뀜' } });
  assert.equal(u.status, 200); assert.ok(u.body.ledger.items.some((x) => x.id === 'H1' && x.habit));
  assert.equal(u.body.result.counts.originHits, 1);

  // 이의 → 받아들임(H1 삭제) → 새 판 → 재채점에 두 판
  const ob = await call(play, { body: { action: 'objection', runId, answerId: u.body.answerId, deviceId: 'dev-user-0001', kind: 'notError', uid: 'S1.e1', item: 'H1', reason: '원자료 문장과 뜻이 같습니다' } });
  assert.equal(ob.status, 200);
  const d = await call(review, { body: { objectionId: ob.body.objectionId, accept: true, note: '맞음', op: { action: 'delete', item: 'H1' } }, code: 'test-code' });
  assert.equal(d.status, 200); assert.ok(d.body.newVersion >= 3);
  const again = await call(play, { body: { action: 'result', answerId: u.body.answerId } });
  assert.equal(again.body.changed, true);
  assert.equal(again.body.before.counts.A - again.body.result.counts.A, 1);

  const st = await call(stats, { method: 'GET' });
  assert.equal(st.body.objections.accepted, 1);
  assert.equal(st.body.usage.makerAnswers, 1);
});
