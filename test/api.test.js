// /api 핸들러 형태 확인 (AI 호출 없는 경로만)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import scenarios from '../api/scenarios.js';
import session from '../api/session.js';

function call(fn, { method = 'GET', query = {}, body } = {}) {
  return new Promise((resolve) => {
    const res = {
      code: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(x) { resolve({ code: this.code, body: x }); },
      end() { resolve({ code: this.code }); },
    };
    fn({ method, query, body }, res);
  });
}

test('시나리오 목록과 상세(정답 제외)', async () => {
  const list = await call(scenarios);
  assert.ok(list.body.some((s) => s.id === 'gaon-202607-demo'));
  const one = await call(scenarios, { query: { id: 'gaon-202607-demo' } });
  assert.equal(one.body.expected, undefined);
  assert.equal(one.body.synthetic, true);
  assert.equal((await call(scenarios, { query: { id: '../x' } })).code, 400);
});

test('세션 시작 → 결정 검증 오류는 400', async () => {
  const s = await call(session, { method: 'POST', body: { op: 'start', scenario_id: 'gaon-202607-demo' } });
  assert.equal(s.body.state.cursor, 0);
  const bad = await call(session, { method: 'POST', body: { op: 'decide', scenario_id: 'gaon-202607-demo', state: s.body.state, incident_id: 'I1', action: 'report', reason: 'x', recipients: ['K2'] } });
  assert.equal(bad.code, 400);
  assert.match(bad.body.error, /없는 사건/);
});
