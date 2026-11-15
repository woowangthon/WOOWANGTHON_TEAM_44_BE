// 선택 계정: 가입하면 기록 코드(deviceId)가 아이디에 묶이고, 로그인하면 그 기록 코드를 돌려준다. 모델 호출 없음, 메모리 저장소
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, getJson, lpushCapped } from '../src/store.js';

for (const k of ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
const account = (await import('../api/account.js')).default;
function call(fn, body, method = 'POST') {
  return new Promise((ok) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { ok({ status: this.code, body: x }); }, end() { ok({ status: this.code }); } };
    fn({ method, query: {}, body, headers: {} }, res);
  });
}
const DEV = 'dev-guest-0001-aaaa';

test('가입: 기록 코드를 그대로 계정에 묶고, 비밀번호 원문은 저장하지 않는다', async () => {
  _memReset();
  const r = await call(account, { action: 'signup', username: 'Miyoung_1', password: 'correct horse', code: DEV });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { username: 'miyoung_1', deviceId: DEV });
  const a = await getJson('ss2:account:miyoung_1');
  assert.equal(a.deviceId, DEV); assert.ok(a.salt && a.hash); assert.ok(!JSON.stringify(a).includes('correct horse'));
  assert.equal((await call(account, { action: 'status', deviceId: DEV })).body.account, true);
});

test('가입 거절: 같은 아이디, 이미 묶인 기록 코드, 짧은 비밀번호, 아이디 형식', async () => {
  _memReset();
  await call(account, { action: 'signup', username: 'abc', password: '12345678', code: DEV });
  assert.equal((await call(account, { action: 'signup', username: 'ABC', password: '12345678', code: 'dev-other-0002' })).status, 409);
  assert.equal((await call(account, { action: 'signup', username: 'other', password: '12345678', code: DEV })).status, 409);
  assert.equal((await call(account, { action: 'signup', username: 'shortpw', password: '1234567', code: 'dev-x-00000003' })).status, 400);
  assert.equal((await call(account, { action: 'signup', username: '한글', password: '12345678', code: 'dev-x-00000004' })).status, 400);
});

test('로그인: 맞으면 기록 코드를 돌려주고, 틀리면 401, 10번 틀리면 429', async () => {
  _memReset();
  await call(account, { action: 'signup', username: 'user1', password: 'pass-word-1', code: DEV });
  const ok = await call(account, { action: 'login', username: 'USER1', password: 'pass-word-1' });
  assert.equal(ok.status, 200); assert.equal(ok.body.deviceId, DEV);
  assert.equal((await call(account, { action: 'login', username: 'user1', password: 'wrong-pass' })).status, 401);
  assert.equal((await call(account, { action: 'login', username: 'nobody', password: 'pass-word-1' })).status, 401);
  for (let i = 0; i < 9; i++) await call(account, { action: 'login', username: 'user1', password: 'wrong-pass' });
  assert.equal((await call(account, { action: 'login', username: 'user1', password: 'pass-word-1' })).status, 429);
});

test('기록 코드로 이어 보기: 기록이 있는 비회원 코드만, 계정에 묶인 코드는 403', async () => {
  _memReset();
  assert.equal((await call(account, { action: 'code', code: DEV })).status, 404);
  await lpushCapped(`ss2:dev:${DEV}`, { kind: 'shadow', id: 'ans-1', runId: 'r' });
  const r = await call(account, { action: 'code', code: DEV });
  assert.equal(r.status, 200); assert.equal(r.body.deviceId, DEV);
  await call(account, { action: 'signup', username: 'bound', password: '12345678', code: DEV });
  assert.equal((await call(account, { action: 'code', code: DEV })).status, 403);
});
