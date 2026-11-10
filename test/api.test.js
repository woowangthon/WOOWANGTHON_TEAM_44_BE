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
  assert.ok(list.body.some((s) => s.id === 'cheongju-20260709'));
  const one = await call(scenarios, { query: { id: 'cheongju-20260709' } });
  assert.equal(one.body.expected, undefined);
  assert.equal(one.body.synthetic, true);
  assert.equal((await call(scenarios, { query: { id: '../x' } })).code, 400);
});

test('세션 시작 → 결정 검증 오류는 400', async () => {
  const s = await call(session, { method: 'POST', body: { op: 'start', scenario_id: 'cheongju-20260709' } });
  assert.equal(s.body.state.cursor, 0);
  const bad = await call(session, { method: 'POST', body: { op: 'decide', scenario_id: 'cheongju-20260709', state: s.body.state, incident_id: 'I1', action: 'report', reason: 'x', recipients: ['K2'] } });
  assert.equal(bad.code, 400);
  assert.match(bad.body.error, /없는 사건/);
});

test('체험 접속 기간과 접속 코드', async () => {
  const { default: access } = await import('../api/access.js');
  const { openAccess } = await import('../api/_lib.js');
  const keep = { u: process.env.OPEN_ACCESS_UNTIL, c: process.env.DEMO_ACCESS_CODE };
  process.env.DEMO_ACCESS_CODE = 'test-code';
  process.env.OPEN_ACCESS_UNTIL = '2099-01-01';
  assert.equal(openAccess().open, true);
  assert.equal((await call(access)).body.open, true);
  // 체험 기간에는 코드 없이 AI 경로가 열린다(start는 AI를 부르지 않는다)
  assert.equal((await call(session, { method: 'POST', body: { op: 'start', scenario_id: 'cheongju-live' } })).code, 200);
  process.env.OPEN_ACCESS_UNTIL = '2020-01-01';
  assert.equal(openAccess().open, false);
  assert.equal((await call(session, { method: 'POST', body: { op: 'start', scenario_id: 'cheongju-live' } })).code, 401);
  assert.equal((await call(access, { method: 'POST', body: { code: 'nope' } })).code, 401);
  process.env.OPEN_ACCESS_UNTIL = '2099-01-01';
  assert.equal((await call(access, { method: 'POST', body: { code: 'nope' } })).code, 401);
  assert.equal((await call(access, { method: 'POST', body: { code: 'test-code' } })).body.ok, true);
  for (const [k, v] of [['OPEN_ACCESS_UNTIL', keep.u], ['DEMO_ACCESS_CODE', keep.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('실시간 기지는 신호 없이 시작하고 목록에 live로 표시된다', async () => {
  const list = await call(scenarios);
  const live = list.body.find((s) => s.id === 'cheongju-live');
  assert.equal(live.live, true);
  assert.equal(live.signals, 0);
  const s = await call(session, { method: 'POST', body: { op: 'start', scenario_id: 'cheongju-live' } });
  assert.equal(s.body.state.signals.length, 0);
});
