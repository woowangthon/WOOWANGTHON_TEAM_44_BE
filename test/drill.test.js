// F4 짧은 연습(문장 드릴): 정답 비노출(설계안 6.1), 드릴 재채점·이어받기(6.2-B5·B6·B7), 경계 사례(6.3). 모델 호출 없음, 메모리 저장소
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset, getJson } from '../src/store.js';
import { getRun, ledgerVersions, saveLedgerVersion } from '../src/ledger.js';
import { docsOf } from '../src/score.js';
import { drillCandidates, buildSet, carrySet, gradeDrill, regradeDrill, pickQuestions, publicQuestion, eligible, qidOf } from '../src/drill.js';
import { auditsRaw } from '../src/drillstore.js';
import { G1, fakeV4, EXAMPLE_ANSWER } from './golden-cases.js';

process.env.REVIEW_CODE = 'test-code';
for (const k of ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
const play = (await import('../api/play.js')).default;
const review = (await import('../api/review.js')).default;
const drill = (await import('../api/drill.js')).default;
function call(fn, { method = 'POST', query = {}, body, code } = {}) {
  return new Promise((ok) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { ok({ status: this.code, body: x }); }, end() { ok({ status: this.code }); } };
    fn({ method, query, body, headers: code ? { 'x-review-code': code } : {} }, res);
  });
}

const run = await getRun(G1);
const docs = docsOf(run);
const vs = await ledgerVersions(G1);
const L = (v) => vs.find((l) => l.version === v);
const v4 = fakeV4(L(3));
// 승인 6: ok 후보 15개 가운데 5개를 뺀다. 보여 줄 문단은 테스트에서는 추천 1위로 고른다(실제로는 만든 사람이 고른다)
const SKIP = ['S2.r4', 'S3.i3', 'S4.b2', 'S5.n3', 'S5.n1'];
const cands3 = drillCandidates(run, L(3), auditsRaw(G1), docs);
const confirmOf = (c, skip = SKIP) => ({ ledgerVersion: c.ledgerVersion, ok: c.ok.filter((o) => !skip.includes(o.uid)).map((o) => ({ uid: o.uid, paras: [o.suggest[0].pid] })), skipError: [], skip: skip.map((uid) => ({ uid, reason: '판단이 갈림' })) });
const set3 = buildSet(run, L(3), confirmOf(cands3), cands3, docs);
const FORBIDDEN_KEYS = ['"grade"', '"pattern"', '"why"', '"fix"', '"wrongText"', '"prevent"', '"evidence"', '"byAudit"', '"truth"', '"items"', '"quote"', '"group"', '"uid"', '"habit"', '"provenance"', '"crowd"'];
const ITEM_IDS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L4b', 'H1', 'L1b', 'L2b'];

async function setup() {
  _memReset();
  // 만든 사람이 먼저 정답 없이 풀어야 드릴 확정이 열린다(423)
  const early = await call(review, { body: { runId: G1, drillset: confirmOf(cands3) }, code: 'test-code' });
  assert.equal(early.status, 423);
  await call(play, { body: { action: 'answer', runId: G1, deviceId: 'dev-maker-0001', maker: true, ...EXAMPLE_ANSWER } });
  const r = await call(review, { body: { runId: G1, drillset: confirmOf(cands3) }, code: 'test-code' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.drillset;
}
const solve = (deviceId) => call(play, { body: { action: 'answer', runId: G1, deviceId, ...EXAMPLE_ANSWER } });

test('후보(G1 v3): 틀린 문장 12 · 맞는 문장 후보 15, v2는 ok 16(S4.b5가 아직 장부 밖)', () => {
  assert.equal(cands3.error.length, 12); assert.equal(cands3.ok.length, 15);
  assert.deepEqual(cands3.error.find((e) => e.uid === 'S5.n5').items, ['L1', 'L4b']);
  assert.deepEqual(cands3.error.find((e) => e.uid === 'S5.n5').paras, ['D-p7', 'B-p1']);
  assert.deepEqual(cands3.excluded.map((x) => x.uid).sort(), ['S1.e2', 'S1.e3', 'S2.r2', 'S4.b5', 'S5.n2']);
  const c2 = drillCandidates(run, L(2), [], docs);
  assert.equal(c2.error.length, 12); assert.equal(c2.ok.length, 16);
  // 감사 표시: S2.r4는 OpenAI가 처음 생긴 곳으로 댔다
  assert.deepEqual(cands3.ok.find((o) => o.uid === 'S2.r4').flags.auditOrigin, ['OpenAI']);
  assert.equal(cands3.ok[0].suggest.length, 3);
  assert.equal(set3.questions.length, 22); assert.ok(eligible(set3));
});

test('B7: 사람 검수 전(ai) 장부로는 드릴 후보도 409', () => {
  assert.throws(() => drillCandidates(run, L(1)), (e) => e.status === 409);
});

test('비노출 6.1-2: qid는 q-8자리 16진수, qid 순서와 정답 종류가 엮이지 않는다', () => {
  for (const q of set3.questions) assert.match(q.qid, /^q-[0-9a-f]{8}$/);
  assert.equal(qidOf(G1, 'S4.b7'), qidOf(G1, 'S4.b7')); assert.notEqual(qidOf(G1, 'S4.b7'), qidOf(G1, 'S4.b6'));
  const seq = [...set3.questions].sort((a, b) => a.qid.localeCompare(b.qid)).map((q) => q.truth);
  const switches = seq.slice(1).filter((t, i) => t !== seq[i]).length;
  assert.ok(switches >= 4, `qid 순서에서 정답 종류가 ${switches}번만 바뀜`);
});

test('비노출 6.1-1: publicQuestion은 허용 목록 필드만', () => {
  for (const q of set3.questions) {
    const p = publicQuestion(q, run, docs);
    assert.deepEqual(Object.keys(p).sort(), ['paras', 'qid', 'runId', 'stage', 'text']);
    assert.deepEqual(Object.keys(p.stage).sort(), ['inputs', 'key', 'name']);
    for (const x of p.paras) assert.deepEqual(Object.keys(x).sort(), ['doc', 'docTitle', 'pid', 'text']);
  }
});

test('비노출 6.1-1·3·5: 결재 전엔 문항이 없고(복습형), 결재 뒤 next는 허용 목록뿐, pattern을 보내면 400', async () => {
  const s = await setup();
  assert.deepEqual([s.n, s.error, s.ok, s.eligible], [22, 12, 10, true]);
  const before = await call(drill, { body: { action: 'next', deviceId: 'dev-user-0001' } });
  assert.equal(before.status, 200); assert.equal(before.body.mode, 'none'); assert.equal(before.body.locked, true); assert.deepEqual(before.body.questions, []);
  // 결재 전에는 qid를 알아도 채점(=정답)을 받지 못한다
  const probe = await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0001', qid: set3.questions[0].qid, verdict: 'ok' } });
  assert.equal(probe.status, 403);
  assert.equal((await call(drill, { body: { action: 'next', deviceId: 'dev-user-0001', pattern: '한정어·조건 탈락' } })).status, 400);
  await solve('dev-user-0001');
  const r = await call(drill, { body: { action: 'next', deviceId: 'dev-user-0001', n: 3 } });
  assert.equal(r.status, 200); assert.equal(r.body.mode, 'new'); assert.equal(r.body.questions.length, 3);
  assert.equal(r.body.left, 19);
  assert.match(r.body.set.label, /사람 검수 3판/);
  for (const q of r.body.questions) {
    assert.deepEqual(Object.keys(q).sort(), ['paras', 'qid', 'runId', 'stage', 'text']);
    for (const x of q.paras) assert.deepEqual(Object.keys(x).sort(), ['doc', 'docTitle', 'pid', 'text']);
  }
  const str = JSON.stringify(r.body.questions);
  for (const k of FORBIDDEN_KEYS) assert.ok(!str.includes(k), k);
  for (const id of ITEM_IDS) assert.ok(!str.includes(`"${id}"`), id);
  // 같은 기기·같은 날에는 같은 문항, 같은 장부 항목은 하루 하나
  const again = await call(drill, { body: { action: 'next', deviceId: 'dev-user-0001', n: 3 } });
  assert.deepEqual(again.body.questions.map((q) => q.qid), r.body.questions.map((q) => q.qid));
  const byQ = new Map(set3.questions.map((q) => [q.qid, q]));
  const five = await call(drill, { body: { action: 'next', deviceId: 'dev-user-0001', n: 5 } });
  const items = five.body.questions.flatMap((q) => byQ.get(q.qid).items);
  assert.equal(new Set(items).size, items.length);
});

test('비노출 6.1-4: ok를 확정하지 않은 세트(error만)는 문항을 내지 않는다', async () => {
  _memReset();
  await call(play, { body: { action: 'answer', runId: G1, deviceId: 'dev-maker-0001', maker: true, ...EXAMPLE_ANSWER } });
  const r = await call(review, { body: { runId: G1, drillset: { ledgerVersion: 3, ok: [] } }, code: 'test-code' });
  assert.equal(r.status, 200); assert.equal(r.body.drillset.eligible, false);
  await solve('dev-user-0002');
  const n = await call(drill, { body: { action: 'next', deviceId: 'dev-user-0002' } });
  assert.equal(n.body.mode, 'none'); assert.equal(n.body.locked, false); assert.equal(n.body.reason, '문항 준비 중');
});

test('비노출 6.1-6: answer는 그 문항의 칸에 걸친 항목만, 없는 qid는 404 「없는 문항」', async () => {
  await setup(); await solve('dev-user-0003');
  const q = (uid) => set3.questions.find((x) => x.uid === uid).qid;
  const a = await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0003', qid: q('S4.b7'), verdict: 'error', pick: '3·4학년 전체에게는', pattern: '한정어·조건 탈락', trace: { elapsedMs: 21000, paraMs: 4200, openedFull: false } } });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.items.map((x) => x.id), ['L1']);
  assert.equal(a.body.correct, true); assert.equal(a.body.truth, 'error'); assert.equal(a.body.ledgerVersion, 3);
  assert.equal(a.body.pickFeedback, 'none'); // L1은 wrongText가 비었다
  assert.equal(a.body.patternFeedback, 'different');
  assert.deepEqual(a.body.objection, { runId: G1, uid: 'S4.b7' });
  assert.ok(a.body.items[0].why && a.body.items[0].habit);
  const b = await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0003', qid: q('S5.n5'), verdict: 'ok' } });
  assert.deepEqual(b.body.items.map((x) => x.id), ['L1', 'L4b']); assert.equal(b.body.correct, false);
  const okq = set3.questions.find((x) => x.truth === 'ok');
  const c = await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0003', qid: okq.qid, verdict: 'error' } });
  assert.deepEqual(c.body.items, []); assert.equal(c.body.truth, 'ok'); assert.match(c.body.note, /이의를 제기/);
  const none = await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0003', qid: 'q-00000000', verdict: 'ok' } });
  assert.equal(none.status, 404); assert.equal(none.body.error, '없는 문항');
  assert.equal((await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0003', qid: 'S4.b7', verdict: 'ok' } })).status, 404);
  // 처음 생긴 곳이고 틀린 구절이 있는 칸이면 고른 어절을 견준다(글자쌍 70%)
  const l2 = L(3).items.find((x) => x.id === 'L2');
  const s1 = set3.questions.find((x) => x.uid === 'S1.e7');
  assert.equal(gradeDrill(set3, { qid: s1.qid, verdict: 'error', pick: '현재 접수 중인 사업은 아니며' }, L(3)).pickFeedback, 'overlap');
  assert.equal(gradeDrill(set3, { qid: s1.qid, verdict: 'error', pick: '5급·외교관후보자' }, L(3)).pickFeedback, 'different');
  assert.equal(gradeDrill(set3, { qid: s1.qid, verdict: 'error', pattern: l2.pattern }, L(3)).patternFeedback, 'same');
  // 이의 제기는 기존 play objection(from: drill)
  const ob = await call(play, { body: { action: 'objection', runId: G1, answerId: null, from: 'drill', deviceId: 'dev-user-0003', kind: 'notError', uid: 'S4.b7', item: 'L1', reason: '원자료와 뜻이 같다고 봅니다' } });
  assert.equal(ob.status, 200);
});

test('드릴 경계: deviceId 없으면 400, 같은 문항 두 번째는 repeat(집계 제외), 만든 사람 표시, 기록 요약', async () => {
  await setup(); await solve('dev-user-0004');
  assert.equal((await call(drill, { body: { action: 'next' } })).status, 400);
  assert.equal((await call(drill, { body: { action: 'answer', qid: set3.questions[0].qid, verdict: 'ok' } })).status, 400);
  const okq = set3.questions.find((x) => x.truth === 'ok'); const erq = set3.questions.find((x) => x.truth === 'error');
  const a1 = await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0004', qid: okq.qid, verdict: 'error' } });
  const a2 = await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0004', qid: okq.qid, verdict: 'ok' } });
  await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0004', qid: erq.qid, verdict: 'ok' } });
  assert.equal(a1.body.repeat, false); assert.equal(a2.body.repeat, true);
  const rec = await getJson(`ss2:dans:${a1.body.drillAnswerId}`);
  assert.equal(rec.first, true); assert.ok(!('correct' in rec)); assert.equal(rec.maker, false);
  const h = await call(drill, { body: { action: 'history', deviceId: 'dev-user-0004' } });
  assert.equal(h.body.answers.length, 3);
  assert.deepEqual(h.body.summary, { n: 2, correct: 0, okAsError: 1, errorAsOk: 1 });
  // 만든 사람 기기의 드릴은 maker로 남고 따로 센다
  const m = await call(drill, { body: { action: 'answer', deviceId: 'dev-maker-0001', maker: true, qid: okq.qid, verdict: 'ok' } });
  assert.equal((await getJson(`ss2:dans:${m.body.drillAnswerId}`)).maker, true);
  assert.equal(await getJson('ss2:count:drillMaker'), 1);
});

test('드릴 경계: 다 풀면 review(다시 풀기), 그 답은 repeat', async () => {
  await setup(); await solve('dev-user-0005');
  for (const q of set3.questions) await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0005', qid: q.qid, verdict: 'ok' } });
  const r = await call(drill, { body: { action: 'next', deviceId: 'dev-user-0005' } });
  assert.equal(r.body.mode, 'review'); assert.equal(r.body.left, 0); assert.ok(r.body.questions.length >= 1);
  const a = await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0005', qid: r.body.questions[0].qid, verdict: 'ok' } });
  assert.equal(a.body.repeat, true);
});

test('pickQuestions: 같은 시드면 같은 순서, 다른 날이면 바뀔 수 있고, 같은 장부 항목은 하루 하나', () => {
  const pool = set3.questions.map((q) => ({ ...q, runId: G1 }));
  const a = pickQuestions(pool, { deviceId: 'dev-x-00000001', day: '2026-11-15', n: 5 });
  const b = pickQuestions(pool, { deviceId: 'dev-x-00000001', day: '2026-11-15', n: 5 });
  assert.deepEqual(a, b);
  const days = new Set(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'].map((day) => pickQuestions(pool, { deviceId: 'dev-x-00000001', day, n: 3 }).questions.map((q) => q.qid).join()));
  assert.ok(days.size > 1);
  for (const day of ['2026-11-15', '2026-11-16', '2026-11-17']) {
    const items = pickQuestions(pool, { deviceId: 'dev-x-00000002', day, n: 8 }).questions.flatMap((q) => q.items);
    assert.equal(new Set(items).size, items.length);
  }
});

test('B6: v3 세트를 가짜 v4로 이어받으면 error 11(S3.i4·S4.b4 빠지고 S2.r4 더함), ok에서 S2.r4가 빠짐', () => {
  const c4 = drillCandidates(run, v4, [], docs);
  const carried = carrySet(set3, run, v4, c4);
  const err = carried.questions.filter((q) => q.truth === 'error').map((q) => q.uid).sort();
  assert.equal(err.length, 11);
  assert.ok(!err.includes('S3.i4') && !err.includes('S4.b4') && err.includes('S2.r4'));
  assert.equal(carried.carried, true); assert.equal(carried.ledgerVersion, 4); assert.equal(carried.questions.filter((q) => q.truth === 'ok').length, 10);
  // S2.r4를 ok에 넣은 가짜 세트였다면 이어받을 때 ok에서 빠진다
  const withR4 = buildSet(run, L(3), confirmOf(cands3, SKIP.filter((u) => u !== 'S2.r4')), cands3, docs);
  const c2 = carrySet(withR4, run, v4, c4);
  assert.ok(!c2.questions.some((q) => q.truth === 'ok' && q.uid === 'S2.r4'));
  assert.ok(c2.questions.some((q) => q.truth === 'error' && q.uid === 'S2.r4'));
  assert.ok(!c2.skipped.some((s) => s.uid === 'S2.r4'));
  // 장부에서 새로 빠진 칸은 ok 대기열로(L3을 지운 판이면 S3.i4·S4.b4가 장부 밖)
  const v5 = structuredClone(v4); v5.version = 5; v5.items = v5.items.filter((x) => x.id !== 'L3');
  const c5 = carrySet(set3, run, v5, drillCandidates(run, v5, [], docs));
  assert.deepEqual(c5.pending.sort(), ['S3.i4', 'S4.b4']);
  assert.ok(!c5.questions.some((q) => c5.pending.includes(q.uid)));
});

test('B5: 드릴 재채점 — 장부 판이 바뀌면 맞음/틀림·제외가 함께 바뀐다', () => {
  const withR4 = buildSet(run, L(3), confirmOf(cands3, SKIP.filter((u) => u !== 'S2.r4')), cands3, docs);
  const r4 = { qid: qidOf(G1, 'S2.r4'), verdict: 'ok', drillsetVersion: 1 };
  // v3 세트(S2.r4를 뺌)에서는 dropped, S2.r4를 넣은 세트에서는 맞음
  assert.equal(gradeDrill(set3, r4, L(3)).dropped, true);
  assert.equal(gradeDrill(withR4, r4, L(3)).correct, true);
  const carried = { ...carrySet(withR4, run, v4, drillCandidates(run, v4, [], docs)), version: 2 };
  const ledgers = [...vs, v4];
  const g = regradeDrill([withR4, carried], r4, ledgers);
  assert.equal(g.before.correct, true); assert.equal(g.now.correct, false); assert.equal(g.changed, true);
  assert.deepEqual(g.now.items.map((x) => x.id), ['L1']);
  const i4 = { qid: qidOf(G1, 'S3.i4'), verdict: 'error', drillsetVersion: 1 };
  const h = regradeDrill([withR4, carried], i4, ledgers);
  assert.equal(h.before.correct, true); assert.equal(h.now.dropped, true); assert.equal(h.changed, true);
});

test('API: 장부 새 판이 나오면 세트를 자동으로 이어받고, 기록은 다시 채점한다', async () => {
  await setup(); await solve('dev-user-0006');
  const i4 = set3.questions.find((q) => q.uid === 'S3.i4');
  await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0006', qid: i4.qid, verdict: 'error' } });
  const { version, parent, at, ...rest } = v4;
  await saveLedgerVersion(G1, rest);
  const h = await call(drill, { body: { action: 'history', deviceId: 'dev-user-0006' } });
  assert.equal(h.body.answers[0].dropped, true); assert.equal(h.body.answers[0].changed, true);
  assert.deepEqual(h.body.summary, { n: 0, correct: 0, okAsError: 0, errorAsOk: 0 });
  const sets = await getJson(`ss2:drillset:${G1}`);
  assert.equal(sets.length, 2); assert.equal(sets[1].carried, true); assert.equal(sets[1].ledgerVersion, 4);
  // 이어받은 세트에서 빠진 문항은 404
  assert.equal((await call(drill, { body: { action: 'answer', deviceId: 'dev-user-0006', qid: i4.qid, verdict: 'error' } })).status, 404);
});

test('비노출 6.1-9: 검수 드릴 API는 코드가 없으면 403, 만든 사람이 풀지 않았으면 423, 후보 모양', async () => {
  _memReset();
  assert.equal((await call(review, { method: 'GET', query: { run: G1, drill: '1' } })).status, 403);
  assert.equal((await call(review, { method: 'GET', query: { run: G1, drill: '1' }, code: 'test-code' })).status, 423);
  assert.equal((await call(review, { body: { runId: G1, drillset: { ledgerVersion: 3, ok: [] } }, code: 'test-code' })).status, 423);
  await call(play, { body: { action: 'answer', runId: G1, deviceId: 'dev-maker-0001', maker: true, ...EXAMPLE_ANSWER } });
  const g = await call(review, { method: 'GET', query: { run: G1, drill: '1' }, code: 'test-code' });
  assert.equal(g.status, 200);
  assert.equal(g.body.candidates.error.length, 12); assert.equal(g.body.candidates.ok.length, 15); assert.deepEqual(g.body.drillsets, []);
  assert.deepEqual(Object.keys(g.body.candidates.ok[0].flags).sort(), ['auditOrigin', 'auditSpread', 'audits']);
  // 확정 검사: 옛 장부 판·후보가 아닌 칸·문단 수
  assert.equal((await call(review, { body: { runId: G1, drillset: { ledgerVersion: 2, ok: [] } }, code: 'test-code' })).status, 409);
  assert.equal((await call(review, { body: { runId: G1, drillset: { ledgerVersion: 3, ok: [{ uid: 'S4.b7', paras: ['D-p7'] }] } }, code: 'test-code' })).status, 400);
  assert.equal((await call(review, { body: { runId: G1, drillset: { ledgerVersion: 3, ok: [{ uid: 'S1.e5', paras: [] }] } }, code: 'test-code' })).status, 400);
  assert.equal((await call(review, { body: { runId: G1, drillset: { ledgerVersion: 3, ok: [{ uid: 'S1.e5', paras: ['Z-p1'] }] } }, code: 'test-code' })).status, 400);
  assert.equal((await call(review, { body: { runId: G1, drillset: { ledgerVersion: 3, ok: [{ uid: 'S1.e5', paras: ['D-p8'] }], skip: [{ uid: 'S1.e5', reason: 'x' }] } }, code: 'test-code' })).status, 400);
  const ok = await call(review, { body: { runId: G1, drillset: { ledgerVersion: 3, ok: [{ uid: 'S1.e5', paras: ['D-p8'] }], skipError: ['S4.b8'] } }, code: 'test-code' });
  assert.equal(ok.status, 200); assert.deepEqual([ok.body.drillset.version, ok.body.drillset.error, ok.body.drillset.ok], [1, 11, 1]);
});
