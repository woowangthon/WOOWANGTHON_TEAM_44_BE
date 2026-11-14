// 정답 비노출(설계안 6.1). 결재 전 응답에 장부 내용(items·why·evidence·quote·byAudit 등)이 실리지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset } from '../src/store.js';

process.env.REVIEW_CODE = 'test-code';
for (const k of ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
const missions = (await import('../api/missions.js')).default;
const play = (await import('../api/play.js')).default;

function call(fn, { method = 'POST', query = {}, body, code } = {}) {
  return new Promise((ok) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { ok({ status: this.code, body: x }); }, end() { ok({ status: this.code }); } };
    fn({ method, query, body, headers: code ? { 'x-review-code': code } : {} }, res);
  });
}
const G1 = 'm4-base-anthropic-11121636-2';
const FORBIDDEN = ['"items"', '"why"', '"byAudit"', '"evidence"', '"quote"', '"wrongText"', '"prevent"', '"fix"', '"grade"', '"provenance"', '"crowd"', '"evidenceUse"', '"calibration"'];

test('비노출 6.1-7: G1 판 공개 응답(missions?run=)에 장부 내용이 없다', async () => {
  _memReset();
  const r = await call(missions, { method: 'GET', query: { run: G1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.playable, true);
  const s = JSON.stringify(r.body);
  for (const f of FORBIDDEN) assert.ok(!s.includes(f), f);
  // 장부 항목의 이유 문장도 실리지 않는다
  assert.ok(!s.includes('단톡방 공지는 2026-11-16(월)에 올라갑니다'));
});

test('비노출: 미션 목록에도 장부 내용이 없다', async () => {
  _memReset();
  const r = await call(missions, { method: 'GET' });
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.body.missions.map((m) => m.fixed));
  for (const f of ['"why"', '"byAudit"', '"evidence"', '"quote"', '"wrongText"']) assert.ok(!s.includes(f), f);
});

test('비노출: 결재 전에 결과를 물으면 없는 답안(404)이고 장부를 싣지 않는다', async () => {
  _memReset();
  const r = await call(play, { body: { action: 'result', answerId: 'ans-none' } });
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r.body).includes('"items"'));
});
