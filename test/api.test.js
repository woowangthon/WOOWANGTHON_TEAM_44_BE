import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.env.TASKS_DIR = fileURLToPath(new URL('./fixtures/tasks', import.meta.url));
delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL;
const call = async (mod, req) => {
  const fn = (await import(`../api/${mod}.js`)).default;
  let out;
  const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(x) { out = { status: this.statusCode, body: x }; }, end() { out = { status: this.statusCode }; } };
  await fn({ method: 'GET', headers: {}, query: {}, ...req }, res);
  return out;
};

test('과제 응답에 정답과 오류 수가 없다', async () => {
  const r = await call('task', { query: { id: 'fx-01' } });
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.body);
  for (const k of ['answer', 'planted', 'before', 'plantedVerified', 'correctDecision', 'verification', 'why']) assert.ok(!s.includes(`"${k}"`), k);
  assert.deepEqual(Object.keys(r.body.sentences[0]).sort(), ['sid', 'text']);
});

test('목록 응답에 오류 수가 없다', async () => {
  const r = await call('tasks');
  assert.equal(r.body.tasks.length, 1);
  assert.ok(!JSON.stringify(r.body).includes('planted'));
});

test('채점 → 기록 → 집계', async () => {
  const req = (deviceId, marks) => ({ method: 'POST', body: { id: 'fx-01', rounds: [{ marks, decision: '반려' }, { marks: [], decision: '승인' }], deviceId, elapsedSec: 42 } });
  // 1차 반려만 보내면 중간 답(수정본)이 오고 기록하지 않는다
  const it = await call('grade', { method: 'POST', body: { id: 'fx-01', marks: [{ sid: 's1' }], decision: '반려', deviceId: 'device-zzzz9' } });
  assert.equal(it.body.stage, 'revision');
  assert.ok(!JSON.stringify(it.body).includes('missed'));
  const a = await call('grade', req('device-aaaa1', [{ sid: 's1', reason: '방향·주체가 바뀜' }]));
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.found, ['s1']);
  assert.equal(a.body.replies[0].kind, 'fixed');
  assert.equal(a.body.peers.firstPlays, 1);
  const b = await call('grade', req('device-aaaa1', []));
  assert.equal(b.body.first, false);
  assert.equal(b.body.peers.firstPlays, 1);
  const c = await call('grade', req('device-bbbb2', []));
  assert.equal(c.body.peers.firstPlays, 2);
  assert.equal(c.body.peers.planted.s1.found, 1);
  const st = await call('stats');
  assert.equal(st.body.plays, 3);
  assert.deepEqual(st.body.types['방향·주체가 바뀜'], { planted: 2, found: 1 });
});

test('잘못된 입력', async () => {
  assert.equal((await call('task', { query: { id: '../x' } })).status, 400);
  assert.equal((await call('task', { query: { id: 'nope' } })).status, 404);
  assert.equal((await call('grade', { method: 'POST', body: { id: 'fx-01', marks: [], decision: '보류' } })).status, 400);
  assert.equal((await call('feedback', { method: 'POST', body: { taskId: 'fx-01', helpful: true, note: 'x'.repeat(500) } })).status, 200);
});

test('코칭: 결재가 끝나기 전에는 400, 의견이 없으면 모델을 부르지 않는다', async () => {
  const half = await call('coach', { method: 'POST', body: { id: 'fx-01', rounds: [{ marks: [{ sid: 's1', note: 'x' }], decision: '반려' }] } });
  assert.equal(half.status, 400);
  const none = await call('coach', { method: 'POST', body: { id: 'fx-01', rounds: [{ marks: [{ sid: 's1' }], decision: '승인' }] } });
  assert.equal(none.status, 200);
  assert.equal(none.body.skipped, true);
});

test('라이브 자료 목록은 결재함 원자료와 겹치지 않는다', async () => {
  const { poolSources } = await import('../src/live.js');
  const { readdirSync } = await import('node:fs');
  const bank = new Set(readdirSync('data/sources').map((f) => f.replace(/\.json$/, '')));
  for (const s of poolSources()) assert.ok(!bank.has(s.id), s.id);
});
