// 습관 도감 예문(틀린 구절·처음 생긴 칸)은 그 판의 정답이다. 공개 수치에는 없고, 결재한 기기에만 나온다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset } from '../src/store.js';

for (const k of ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
const stats = (await import('../api/stats.js')).default;
const play = (await import('../api/play.js')).default;
const call = (fn, { method = 'POST', body } = {}) => new Promise((ok) => {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { ok({ status: this.code, body: x }); }, end() { ok({ status: this.code }); } };
  fn({ method, query: {}, body, headers: {} }, res);
});
const G1 = 'm4-base-anthropic-11121636-2';

test('공개 수치와 결재 전 기기에는 예문이 없고, 결재한 기기에는 나온다', async () => {
  _memReset();
  const st = await call(stats, { method: 'GET' });
  const s = JSON.stringify(st.body.patterns);
  assert.ok(!s.includes('wrongText') && !s.includes('"origin"'));
  assert.ok(st.body.patterns.some((p) => p.lockedExamples > 0));
  const before = await call(play, { body: { action: 'patterns', deviceId: 'dev-pat-00001' } });
  assert.equal(before.body.patterns.flatMap((p) => p.examples).length, 0);
  assert.ok(before.body.patterns.some((p) => p.lockedRuns.includes(G1)));
  const a = await call(play, { body: { action: 'answer', runId: G1, deviceId: 'dev-pat-00001', marks: [{ uid: 'S5.n5' }], decision: 'reject', reason: '근거 확인 필요', elapsedSec: 60, sourceViews: 0 } });
  assert.equal(a.status, 200);
  const after = await call(play, { body: { action: 'patterns', deviceId: 'dev-pat-00001' } });
  assert.ok(after.body.patterns.flatMap((p) => p.examples).some((e) => e.runId === G1 && e.wrongText));
});
