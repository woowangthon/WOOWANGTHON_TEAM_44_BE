// 청사진 4절의 작은 BE 몫: F3 확신도 보정, F8 출처 칩, F7 집단 신호, F5 패턴별 실력. 모두 점수에 넣지 않는다. 모델 호출 없음, 메모리 저장소
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, getJson } from '../src/store.js';
import { getRun, ledgerVersions } from '../src/ledger.js';
import { scoreAnswer, docsOf } from '../src/score.js';
import { provenanceOf, crowdOf, patternSkill, CROWD_MIN } from '../src/insight.js';
import { G1, CASES, EXAMPLE_ANSWER } from './golden-cases.js';

process.env.REVIEW_CODE = 'test-code';
for (const k of ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
const play = (await import('../api/play.js')).default;
const missions = (await import('../api/missions.js')).default;
function call(fn, { method = 'POST', query = {}, body } = {}) {
  return new Promise((ok) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { ok({ status: this.code, body: x }); }, end() { ok({ status: this.code }); } };
    fn({ method, query, body, headers: {} }, res);
  });
}
const run = await getRun(G1);
const vs = await ledgerVersions(G1);
const L3 = vs.find((l) => l.version === 3);
const answer = (deviceId, extra = {}) => call(play, { body: { action: 'answer', runId: G1, deviceId, ...EXAMPLE_ANSWER, ...extra } });

test('F3 확신도: 확실/의심별 그은 수·맞은 수·헛짚음, 없으면 확실, 점수는 그대로', () => {
  const marks = [{ uid: 'S4.b7', confidence: 'sure' }, { uid: 'S1.e1', confidence: 'unsure' }, { uid: 'S4.b5', confidence: 'unsure' }, { uid: 'S1.e7' }];
  const r = scoreAnswer(run, L3, { marks, decision: 'reject', reason: '대조해 주세요' });
  assert.deepEqual(r.calibration, { sure: { n: 2, correct: 2, falseMarks: 0 }, unsure: { n: 2, correct: 0, falseMarks: 1 } });
  const plain = scoreAnswer(run, L3, { marks: marks.map(({ uid }) => ({ uid })), decision: 'reject', reason: '대조해 주세요' });
  assert.equal(r.score, plain.score);
  assert.deepEqual(plain.calibration, { sure: { n: 4, correct: 2, falseMarks: 1 }, unsure: { n: 0, correct: 0, falseMarks: 0 } });
  // 모르는 값은 확실로 본다
  assert.equal(scoreAnswer(run, L3, { marks: [{ uid: 'S4.b7', confidence: 'maybe' }], decision: 'reject' }).calibration.sure.n, 1);
});

test('F3 API: 빨간 줄의 confidence를 저장하고 result가 calibration을 다시 계산한다', async () => {
  _memReset();
  const a = await answer('dev-cal-00001', { marks: [{ uid: 'S4.b7', confidence: 'unsure' }, { uid: 'S2.r1' }] });
  assert.deepEqual(a.body.result.calibration, { sure: { n: 1, correct: 0, falseMarks: 1 }, unsure: { n: 1, correct: 1, falseMarks: 0 } });
  const rec = await getJson(`ss2:ans:${a.body.answerId}`);
  assert.deepEqual(rec.marks.map((m) => m.confidence), ['unsure', 'sure']);
  const r = await call(play, { body: { action: 'result', answerId: a.body.answerId } });
  assert.deepEqual(r.body.result.calibration, a.body.result.calibration);
});

test('F8 출처 칩(G1 v3): 감사 수·코드 대조·사람 검수·등급과 처음 생긴 곳 변경 이력', () => {
  const p = provenanceOf(L3, vs, docsOf(run), run);
  assert.deepEqual(Object.keys(p).sort(), L3.items.map((x) => x.id).sort());
  assert.deepEqual([p.L1.audits.by, p.L1.audits.n, p.L1.audits.of], [['OpenAI'], 1, 3]);
  assert.deepEqual(p.L2.audits.by, ['Anthropic', 'OpenAI']);
  // 등급 B→A는 사람 검수 2판에서
  assert.deepEqual(p.L6.changes.map(({ field, before, after, inVersion }) => ({ field, before, after, inVersion })), [{ field: 'grade', before: 'B', after: 'A', inVersion: 2 }]);
  assert.deepEqual(p.L1.changes.map((c) => [c.field, c.before, c.after, c.inVersion]), [['origin', 'S2.r4', 'S4.b7', 2]]);
  assert.equal(p.L1.human.review, 'edited'); assert.equal(p.L1.human.originConfirmed, 'human');
  assert.equal(p.L2.human.review, 'approved'); assert.equal(p.L2.human.originConfirmed, 'auto');
  assert.equal(p.L4b.human.originConfirmed, null); assert.equal(p.L4b.since, 2);
  assert.deepEqual([p.H1.human.review, p.H1.human.source, p.H1.audits.n, p.H1.since], ['added', 'human', 0, 3]);
  // 코드 대조: 근거 인용이 원자료에 글자 그대로, 문단만 지정한 근거(H1)는 null
  assert.equal(p.L2.codeCheck.quotesVerbatim, true); assert.equal(p.L2.codeCheck.wrongInUnit, true);
  assert.equal(p.H1.codeCheck.quotesVerbatim, null); assert.equal(p.L1.codeCheck.wrongInUnit, null);
  assert.equal(p.L2.codeCheck.byAudit.OpenAI.evidenceTotal, 3);
  assert.ok(Object.values(p).every((x) => x.ledgerVersion === 3));
  // 인용을 바꾸면 verbatim이 false
  const bad = structuredClone(L3); bad.items[0].evidence[0].quote = '원자료에 없는 문장입니다';
  assert.equal(provenanceOf(bad, vs, docsOf(run), run).L1.codeCheck.quotesVerbatim, false);
});

test('F7 집단 신호: 처음 푼 사람(만든 사람 제외)만, 5명 미만이면 숫자 대신 null과 n', () => {
  const ans = (uids) => ({ marks: uids.map((uid) => ({ uid })) });
  const four = [ans(['S4.b7']), ans(['S5.n5']), ans([]), ans(['S1.e1'])];
  assert.deepEqual(crowdOf(L3, four, run).L1, { n: 4, found: null, rate: null });
  const five = [...four, ans(['S1.e7'])];
  const c = crowdOf(L3, five, run);
  assert.equal(CROWD_MIN, 5);
  assert.deepEqual(c.L1, { n: 5, found: 2, rate: 0.4 });
  assert.deepEqual(c.L2, { n: 5, found: 1, rate: 0.2 });
  assert.deepEqual(c.L3, { n: 5, found: 0, rate: 0 });
});

test('F7·F8 API: 결재 뒤 answer·result의 장부 항목마다 provenance·crowd, 만든 사람과 두 번째 풀이는 세지 않는다', async () => {
  _memReset();
  await answer('dev-maker-0001', { maker: true });
  for (let i = 1; i <= 4; i++) await answer(`dev-crowd-000${i}`, i === 1 ? {} : { marks: [{ uid: 'S1.e7' }] });
  await answer('dev-crowd-0001', { marks: [{ uid: 'S1.e7' }] }); // 같은 기기의 두 번째 풀이
  let a = await answer('dev-crowd-0004', { marks: [] });
  assert.deepEqual(a.body.ledger.items.find((x) => x.id === 'L1').crowd, { n: 4, found: null, rate: null });
  a = await answer('dev-crowd-0005', { marks: [{ uid: 'S4.b7' }] });
  const L1 = a.body.ledger.items.find((x) => x.id === 'L1');
  assert.deepEqual(L1.crowd, { n: 5, found: 2, rate: 0.4 });
  assert.equal(L1.provenance.ledgerVersion, 3); assert.deepEqual(L1.provenance.audits.by, ['OpenAI']);
  const r = await call(play, { body: { action: 'result', answerId: a.body.answerId } });
  assert.deepEqual(r.body.ledger.items.find((x) => x.id === 'L2').crowd, { n: 5, found: 3, rate: 0.6 });
  assert.ok(r.body.ledger.items.every((x) => x.provenance && x.crowd));
  // 결재 전 응답(판 공개)에는 없다
  const m = await call(missions, { method: 'GET', query: { run: G1 } });
  assert.ok(!JSON.stringify(m.body).includes('"provenance"') && !JSON.stringify(m.body).includes('"crowd"'));
});

test('F5 패턴별 실력: 찾음/놓침과 베이즈 평균(사전 1/2), 표본이 적으면 early', () => {
  const s = patternSkill([scoreAnswer(run, L3, EXAMPLE_ANSWER)]);
  assert.equal(s.runs, 1); assert.deepEqual(s.prior, { mean: 0.5, weight: 2 });
  const by = Object.fromEntries(s.patterns.map((p) => [p.pattern, p]));
  assert.deepEqual(by['기타'], { pattern: '기타', found: 1, missed: 1, n: 2, mastery: 0.5, early: true });
  assert.deepEqual(by['근거보다 큰 결론'], { pattern: '근거보다 큰 결론', found: 0, missed: 1, n: 1, mastery: 0.33, early: true });
  assert.equal(s.patterns.reduce((n, p) => n + p.n, 0), 5); // A 항목만
  assert.equal(s.patterns.at(-1).pattern, '기타'); // 낮은 것부터
  const all = patternSkill([scoreAnswer(run, L3, CASES.origins4), scoreAnswer(run, L3, CASES.origins4)]);
  assert.deepEqual(all.patterns.find((p) => p.pattern === '기타'), { pattern: '기타', found: 4, missed: 0, n: 4, mastery: 0.83, early: false });
  assert.deepEqual(patternSkill([]), { runs: 0, prior: { mean: 0.5, weight: 2 }, patterns: [] });
});

test('F5 API: history에 skill이 붙고, 판마다 이 기기의 첫 답안만 센다', async () => {
  _memReset();
  await answer('dev-skill-0001');
  await call(play, { body: { action: 'answer', runId: G1, deviceId: 'dev-skill-0001', ...CASES.origins4 } }); // 정답을 본 뒤 다시 푼 것
  const h = await call(play, { body: { action: 'history', deviceId: 'dev-skill-0001' } });
  assert.equal(h.status, 200); assert.equal(h.body.history.length, 2);
  assert.equal(h.body.skill.runs, 1);
  assert.deepEqual(h.body.skill.patterns.find((p) => p.pattern === '기타'), { pattern: '기타', found: 1, missed: 1, n: 2, mastery: 0.5, early: true });
});
