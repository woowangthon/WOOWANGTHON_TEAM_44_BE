// F2 근거 대조 추적(설계안 6.2-B2·B3, 6.3 이벤트 경계, API). 모델 호출 없음, 메모리 저장소
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, getJson } from '../src/store.js';
import { getRun, ledgerVersions, saveLedgerVersion } from '../src/ledger.js';
import { scoreAnswer, rescore, docsOf } from '../src/score.js';
import { sanitizeTrace, evidenceUseOf, srcRefs, stageRefs, WINDOW_MS, MAX_EVENTS } from '../src/trace.js';
import { G1, fakeV4, EXAMPLE_TRACE, EXAMPLE_ANSWER } from './golden-cases.js';

process.env.REVIEW_CODE = 'test-code';
for (const k of ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
const play = (await import('../api/play.js')).default;
function call(fn, { method = 'POST', query = {}, body } = {}) {
  return new Promise((ok) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { ok({ status: this.code, body: x }); }, end() { ok({ status: this.code }); } };
    fn({ method, query, body, headers: {} }, res);
  });
}

const run = await getRun(G1);
const vs = await ledgerVersions(G1);
const L = (v) => vs.find((l) => l.version === v);
const eu = (ledger, ans, trace) => scoreAnswer(run, ledger, { ...ans, trace }).evidenceUse;
const item = (e, id) => e.items.find((x) => x.id === id);

test('시간 범위 상수: 긋기 전 언제든(승인 1)', () => {
  assert.equal(WINDOW_MS, Infinity);
  assert.equal(MAX_EVENTS, 2000);
});

test('F2 골든 B2: 계산 예는 v2·v3 모두 found {1,1}, missed {4,4}이고 두 판이 같다', () => {
  const a = eu(L(2), EXAMPLE_ANSWER, EXAMPLE_TRACE); const b = eu(L(3), EXAMPLE_ANSWER, EXAMPLE_TRACE);
  assert.deepEqual(a, b);
  assert.deepEqual([b.found.n, b.found.checked, b.missed.n, b.missed.neverLooked], [1, 1, 4, 4]);
  assert.deepEqual(item(b, 'L1'), { id: 'L1', found: true, checked: 'source', refs: ['D-p7'], seen: ['D-p7'] });
  assert.deepEqual(item(b, 'L2'), { id: 'L2', found: false, looked: false, refs: ['F-p4'], seen: [] });
  assert.deepEqual(b.items.filter((x) => !x.found).flatMap((x) => x.refs).sort(), ['B-p1', 'E-p2', 'F-p4', 'F-p4']);
  assert.equal(b.engaged, true); assert.equal(b.partial, false); assert.equal(b.seenParas, 1);
  assert.equal(b.totalParas, 33);
});

test('F2 B3: 가짜 v4에서 L1 근거가 D-p8로 바뀌면 checked null, A가 4개라 missed 3, S2.r4 줄은 헛짚음 → 찾음', () => {
  const v4 = fakeV4(L(3));
  const e = eu(v4, EXAMPLE_ANSWER, EXAMPLE_TRACE);
  assert.equal(item(e, 'L1').checked, null);
  assert.equal(e.missed.n, 3);
  const withR4 = { ...EXAMPLE_ANSWER, marks: [...EXAMPLE_ANSWER.marks, { uid: 'S2.r4' }] };
  assert.deepEqual(scoreAnswer(run, L(3), withR4).falseMarks, ['S2.r4']);
  assert.deepEqual(scoreAnswer(run, v4, withR4).falseMarks, []);
  assert.ok(scoreAnswer(run, v4, withR4).perItem.find((p) => p.id === 'L1').hitUnits.includes('S2.r4'));
  // rescore가 before(v3)·now(v4)의 evidenceUse를 각각 돌려준다
  const r = rescore(run, [L(2), L(3), v4], { ...EXAMPLE_ANSWER, trace: EXAMPLE_TRACE, ledgerVersion: 3 });
  assert.equal(r.changed, true);
  assert.equal(item(r.before.evidenceUse, 'L1').checked, 'source');
  assert.equal(item(r.now.evidenceUse, 'L1').checked, null);
});

test('trace가 없으면 evidenceUse는 null, 나머지는 같다(옛 답안)', () => {
  const a = scoreAnswer(run, L(3), EXAMPLE_ANSWER); const b = scoreAnswer(run, L(3), { ...EXAMPLE_ANSWER, trace: EXAMPLE_TRACE });
  assert.equal(a.evidenceUse, null);
  const strip = (x) => { const { evidenceUse, ...rest } = x; return rest; };
  assert.deepEqual(strip(a), strip(b));
  assert.equal(scoreAnswer(run, L(3), { ...EXAMPLE_ANSWER, trace: '문자열' }).evidenceUse, null);
});

test('이벤트 경계: 2,001개면 2,000개만, 틀린 튜플·음수 t·모르는 type·없는 ref는 버리고 partial', () => {
  const many = { events: Array.from({ length: 2001 }, (_, i) => [i, 'tap', 'D-p7']) };
  const s = sanitizeTrace(many, run, null);
  assert.equal(s.events.length, 2000); assert.equal(s.partial, true); assert.equal(s.dropped, 1);
  const bad = sanitizeTrace({ events: [[1, 'view', 'D-p7', 1600], [-1, 'tap', 'D-p7'], [2, 'jump', 'D-p7'], [3, 'tap', 'Z-p99'], [4, 'mark', 'S9.x1'], 'x', [5], [6, 'view', 'D-p7', -3], [7, 'tab', 'D']] }, run, docsOf(run));
  assert.deepEqual(bad.events, [[1, 'view', 'D-p7', 1600], [7, 'tab', 'D']]);
  assert.equal(bad.dropped, 7); assert.equal(bad.partial, true);
  assert.equal(sanitizeTrace('문자열', run, null), null);
  assert.equal(sanitizeTrace([1, 2], run, null), null);
  assert.equal(sanitizeTrace({ events: [], dropped: 3 }, run, null).partial, true);
});

test('이벤트 경계: t 순서가 뒤섞여 와도 같은 결과', () => {
  const shuffled = { ...EXAMPLE_TRACE, events: [...EXAMPLE_TRACE.events].reverse() };
  assert.deepEqual(eu(L(3), EXAMPLE_ANSWER, shuffled), eu(L(3), EXAMPLE_ANSWER, EXAMPLE_TRACE));
});

test('긋고 지운 뒤 다시 그으면 다시 그은 시각으로 판정(그 사이에 근거를 봤으면 checked)', () => {
  const t = { events: [[100, 'mark', 'S4.b7'], [200, 'unmark', 'S4.b7'], [300, 'view', 'D-p7', 2000], [400, 'mark', 'S4.b7']] };
  assert.equal(item(eu(L(3), EXAMPLE_ANSWER, t), 'L1').checked, 'source');
  // 긋고 난 뒤에만 보면 checked가 아니다(봤지만 긋기 전은 아님)
  const late = { events: [[100, 'mark', 'S4.b7'], [300, 'view', 'D-p7', 2000]] };
  assert.equal(item(eu(L(3), EXAMPLE_ANSWER, late), 'L1').checked, null);
});

test('mark 이벤트가 없는 표시(복원된 draft)는 제출 시각으로 본다', () => {
  const t = { events: [[5000, 'view', 'D-p7', 2000]] };
  assert.equal(item(eu(L(3), EXAMPLE_ANSWER, t), 'L1').checked, 'source');
});

test('한 단위에 항목이 둘(S1.e7 = L2·L6)이면 항목마다 따로 판정한다', () => {
  const ans = { marks: [{ uid: 'S1.e7' }], decision: 'reject', reason: '조건을 다시 보세요' };
  const e = eu(L(3), ans, { events: [[10, 'view', 'F-p4', 1600], [20, 'mark', 'S1.e7']] });
  assert.equal(item(e, 'L2').checked, 'source'); assert.equal(item(e, 'L6').checked, 'source');
  assert.equal(e.found.n, 2); assert.equal(e.found.checked, 2);
});

test('근거가 문자열 배열(H1)이어도 읽고, 앞 단계 근거뿐이면 stage 또는 n/a', () => {
  const h1 = L(3).items.find((x) => x.id === 'H1');
  assert.deepEqual(srcRefs(h1), ['E-p2', 'E-p3', 'E-p5']);
  assert.deepEqual(stageRefs(L(3).items.find((x) => x.id === 'L1')), ['S1']);
  const fake = { version: 9, status: 'reviewed', items: [{ id: 'X1', grade: 'A', origin: 'S4.b7', spread: [], evidence: [{ ref: 'S1.e4', quote: 'q' }] }, { id: 'X2', grade: 'A', origin: 'S1.e1', spread: [], evidence: ['E-p2'] }] };
  const ans = { marks: [{ uid: 'S4.b7' }, { uid: 'S1.e1' }], decision: 'reject', reason: '대조해 주세요' };
  const opened = evidenceUseOf(run, fake, ans.marks, { events: [[1, 'stage', 'S1'], [2, 'view', 'E-p2', 1500], [5, 'mark', 'S4.b7'], [6, 'mark', 'S1.e1']] }, null);
  assert.equal(item(opened, 'X1').checked, 'stage'); assert.equal(item(opened, 'X2').checked, 'source');
  assert.deepEqual([opened.found.n, opened.found.checked, opened.found.stage, opened.found.na], [1, 1, 1, 1]);
  const closed = evidenceUseOf(run, fake, ans.marks, { events: [[5, 'mark', 'S4.b7']] }, null);
  assert.equal(item(closed, 'X1').checked, 'n/a');
  // 원자료 문단을 근거로 가진 항목이 아니라 앞 단계뿐이면 놓쳤을 때 looked는 null(분모에서 뺌)
  const missed = evidenceUseOf(run, fake, [], { events: [] }, null);
  assert.equal(item(missed, 'X1').looked, null); assert.equal(missed.missed.na, 1); assert.equal(missed.engaged, false);
});

test('API: answer가 trace를 받아 evidenceUse를 돌려주고, 원본은 ss2:ev에만 두며 result의 answer에 싣지 않는다', async () => {
  _memReset();
  const a = await call(play, { body: { action: 'answer', runId: G1, deviceId: 'dev-trace-0001', ...EXAMPLE_ANSWER, elapsedSec: 300, sourceViews: 1, trace: EXAMPLE_TRACE } });
  assert.equal(a.status, 200);
  assert.deepEqual([a.body.result.evidenceUse.found.checked, a.body.result.evidenceUse.missed.neverLooked], [1, 4]);
  assert.equal(a.body.result.score, scoreAnswer(run, L(3), EXAMPLE_ANSWER).score); // 점수는 그대로
  const rec = await getJson(`ss2:ans:${a.body.answerId}`);
  assert.equal(rec.hasTrace, true); assert.ok(!('trace' in rec));
  assert.equal((await getJson(`ss2:ev:${a.body.answerId}`)).events.length, 6);
  const r = await call(play, { body: { action: 'result', answerId: a.body.answerId } });
  assert.equal(r.status, 200);
  assert.ok(!('trace' in r.body.answer)); assert.ok(!JSON.stringify(r.body.answer).includes('"events"'));
  assert.deepEqual(r.body.result.evidenceUse, a.body.result.evidenceUse);
  // 내 기록 요약에 근거 대조 수가 붙는다
  const h = await call(play, { body: { action: 'history', deviceId: 'dev-trace-0001' } });
  assert.deepEqual(h.body.history[0].evidence, { found: 1, checked: 1, missed: 4, neverLooked: 4 });
});

test('API: trace가 문자열이거나 없으면 정상 채점, evidenceUse null', async () => {
  _memReset();
  for (const trace of ['문자열', undefined]) {
    const a = await call(play, { body: { action: 'answer', runId: G1, deviceId: 'dev-trace-0002', ...EXAMPLE_ANSWER, trace } });
    assert.equal(a.status, 200); assert.equal(a.body.result.evidenceUse, null);
    assert.equal((await getJson(`ss2:ans:${a.body.answerId}`)).hasTrace, undefined);
  }
});

test('API: 장부 새 판(가짜 v4)이 나오면 result가 before·now 두 판의 evidenceUse를 함께 낸다', async () => {
  _memReset();
  const a = await call(play, { body: { action: 'answer', runId: G1, deviceId: 'dev-trace-0003', ...EXAMPLE_ANSWER, trace: EXAMPLE_TRACE } });
  const { version, parent, at, ...rest } = fakeV4(L(3));
  await saveLedgerVersion(G1, rest);
  const r = await call(play, { body: { action: 'result', answerId: a.body.answerId } });
  assert.equal(r.body.changed, true); assert.equal(r.body.result.ledgerVersion, 4);
  assert.equal(item(r.body.before.evidenceUse, 'L1').checked, 'source');
  assert.equal(item(r.body.result.evidenceUse, 'L1').checked, null);
});
