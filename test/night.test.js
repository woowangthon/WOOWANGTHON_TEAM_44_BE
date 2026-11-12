// 11/13 야간: 묶기 v2(번진 곳 교집합), AI 1차 판정(표시만), 고정 판 보호
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _memReset } from '../src/store.js';
import { clusterV2, buildLedger, pairScore, PAIR_MIN } from '../src/audit.js';
import { loadMission, loadDocs } from '../src/mission.js';
import { splitMarks, shapeJudgments, triageAnswer, getTriage } from '../src/triage.js';
import { objections } from '../src/ledger.js';
import { scoreAnswer } from '../src/score.js';

for (const k of ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
const mission = { id: 'mt', today: '2026년 11월 12일(목)', todayISO: '2026-11-12', postDateISO: '2026-11-16', brief: 'b', stages: [] };
const docs = { A: { key: 'A', title: 't', publisher: 'p', paragraphs: [{ pid: 'A-p1', text: '11월 9일부터 11월 22일까지 모집한다. 25명 내외를 선발한다.' }, { pid: 'A-p2', text: '만 19세 이상 34세 이하 청년' }] } };
const run = { id: 'mt-base-x-1', workerCompany: 'Anthropic', origin: 'fixed', stages: [
  { key: 'S1', name: '추출', kind: 'list', inputs: ['sources'], instruction: 'i', units: [{ uid: 'S1.e1', text: '모집 11월 9일~11월 22일' }, { uid: 'S1.e2', text: '25명 선발, 만 19~39세' }] },
  { key: 'S2', name: '표', kind: 'table', inputs: ['S1'], instruction: 'i', units: [{ uid: 'S2.h', text: '사업 | 마감' }, { uid: 'S2.r1', text: '자문단 | 11월 22일(10일 남음)' }, { uid: 'S2.r2', text: '응시료 | 만 39세까지' }] },
  { key: 'S3', name: '공지', kind: 'lines', inputs: ['S2'], instruction: 'i', units: [{ uid: 'S3.n1', text: '자문단 25명, 11/22 마감(D-10)' }, { uid: 'S3.n2', text: '응시료 지원 만 39세까지' }] },
] };
const E = (o) => ({ evidence: [], why: 'w', fix: 'f', prevent: 'p', spread: [], ...o });

test('묶기 v2: 번진 곳만 겹치는 다른 오류는 묶지 않는다, 번진 곳은 두 감사 교집합·한쪽만은 후보', () => {
  const a1 = { model: 'claude-opus-5-5', company: 'Anthropic', errors: [
    E({ origin: 'S2.r1', wrong_text: '10일 남음', pattern: '날짜·기간 오류', grade: 'A', spread: ['S3.n1'] }),
    E({ origin: 'S1.e2', wrong_text: '만 19~39세', pattern: '숫자·계산 틀림', grade: 'A', spread: ['S2.r2', 'S3.n2'] }),
  ] };
  // OpenAI는 나이 오류를 같은 근원에서 짚고, 번진 곳을 넓게 댔다(S3.n1까지). 날짜 오류는 못 봤다
  const a2 = { model: 'gpt-6.1-sol', company: 'OpenAI', errors: [
    E({ origin: 'S1.e2', wrong_text: '만 19~39세', pattern: '한정어·조건 탈락', grade: 'A', spread: ['S2.r2', 'S3.n1', 'S3.n2'] }),
  ] };
  assert.ok(pairScore(a1.errors[0], a2.errors[0]) < PAIR_MIN);
  const cl = clusterV2([a1, a2]);
  assert.equal(cl.length, 2);
  const L = buildLedger(run, mission, docs, [a1, a2]);
  assert.equal(L.rule, 'v2');
  const age = L.items.find((x) => x.origin === 'S1.e2');
  assert.equal(age.source, 'both');
  assert.deepEqual(age.spread, ['S2.r2', 'S3.n2']);
  assert.deepEqual(age.spreadCandidates, ['S3.n1']);
  const date = L.items.find((x) => x.origin === 'S2.r1');
  assert.equal(date.source, 'one'); assert.deepEqual(date.spread, []); assert.deepEqual(date.spreadCandidates, ['S3.n1']);
  // v1은 칸이 겹친다고 묶어 한 항목이 된다(11/12까지 만든 장부를 그대로 다시 만들 때만 씀)
  const L1 = buildLedger(run, mission, docs, [a1, a2], { rule: 'v1' });
  assert.equal(L1.rule, 'v1');
  assert.ok(L1.items.some((x) => x.source === 'both' && x.spread.length >= 2));
});

test('v1 규칙으로 다시 만들면 G1 판 장부 1판과 같은 묶음이 나온다(파일은 읽기만)', () => {
  const id = 'm4-base-anthropic-11121636-2';
  const r = JSON.parse(readFileSync(`data/runs/${id}.json`, 'utf8'));
  const m = loadMission(r.missionId);
  const old = JSON.parse(readFileSync(`data/ledgers/${id}.v1.json`, 'utf8'));
  const L = buildLedger(r, m, loadDocs(m), JSON.parse(readFileSync(`data/ledgers/${id}.audits.json`, 'utf8')), { rule: 'v1' });
  assert.deepEqual(L.items.map((x) => [x.origin, x.spread, x.grade]), old.items.map((x) => [x.origin, x.spread, x.grade]));
});

test('AI 1차 판정: 장부에 없는 칸과 같은 칸을 나누고, 원자료 인용이 안 맞으면 근거 있음을 낮춘다', () => {
  const ledger = { version: 2, status: 'reviewed', items: [{ id: 'L1', origin: 'S1.e2', spread: ['S2.r2'], grade: 'A', pattern: '숫자·계산 틀림', why: '34세를 39세로' }] };
  const marks = [{ uid: 'S2.r2', note: '39세가 아니라 34세' }, { uid: 'S1.e1' }, { uid: 'S3.n1', note: 'D-10은 오늘 기준', quote: 'D-10' }, { uid: 'S1.e2' }];
  const sp = splitMarks(ledger, marks);
  assert.deepEqual(sp.fresh.map((m) => m.uid), ['S1.e1', 'S3.n1']);
  assert.deepEqual(sp.same.map((m) => m.uid), ['S2.r2']); // 메모 없는 S1.e2는 견줄 거리가 없어 묻지 않는다
  const out = shapeJudgments({ judgments: [
    { uid: 'S1.e1', verdict: 'grounded', evidence: [{ ref: 'A-p1', quote: '원자료에 없는 문장' }], why: 'x' },
    { uid: 'S3.n1', verdict: 'grounded', evidence: [{ ref: 'A-p1', quote: '11월 22일까지 모집한다' }], why: '게시일 기준 6일' },
    { uid: 'S2.r2', verdict: 'same', evidence: [], why: '같음' },
  ] }, sp, docs);
  assert.equal(out.find((j) => j.uid === 'S1.e1').verdict, 'unclear');
  assert.equal(out.find((j) => j.uid === 'S1.e1').modelVerdict, 'grounded');
  assert.equal(out.find((j) => j.uid === 'S3.n1').verdict, 'grounded');
  assert.equal(out.find((j) => j.uid === 'S2.r2').verdict, 'same');
  // 점수는 판정과 무관하다
  const g = scoreAnswer(run, ledger, { marks, decision: 'reject' });
  assert.deepEqual(g.falseMarks.sort(), ['S1.e1', 'S3.n1']);
});

test('AI 1차 판정 저장: 근거 있음은 이의 대기열에 자동(source auto)으로 한 번만, 실패해도 던지지 않는다', async () => {
  _memReset();
  const ledger = { version: 2, status: 'reviewed', items: [] };
  const judge = async ({ marks }) => ({ model: 'gpt-6.1-sol', company: 'OpenAI', sec: 1, judgments: marks.map((m) => ({ uid: m.uid, kind: 'new', verdict: m.uid === 'S3.n1' ? 'grounded' : 'ungrounded', why: '게시일 기준', evidence: [{ ref: 'A-p1', quote: 'q', found: true }], note: m.note ?? '' })) });
  const a1 = { id: 'ans-a1', runId: run.id, deviceId: 'dev-1', marks: [{ uid: 'S3.n1', note: 'D-10' }, { uid: 'S1.e1' }] };
  const t = await triageAnswer({ answer: a1, run, mission, docs, ledger, judge });
  assert.equal(t.status, 'done'); assert.equal(t.label, 'AI 1차 판정 · 사람 확인 전');
  let obs = await objections();
  assert.equal(obs.length, 1); assert.equal(obs[0].source, 'auto'); assert.equal(obs[0].kind, 'missing'); assert.equal(obs[0].uid, 'S3.n1');
  // 같은 답안을 다시 부르면 저장된 것, 다른 답안이 같은 칸을 짚어도 대기열에는 한 번만
  assert.equal((await triageAnswer({ answer: a1, run, mission, docs, ledger, judge: async () => { throw new Error('다시 부르면 안 됨'); } })).status, 'done');
  await triageAnswer({ answer: { ...a1, id: 'ans-a2' }, run, mission, docs, ledger, judge });
  obs = await objections();
  assert.equal(obs.length, 1);
  const f = await triageAnswer({ answer: { ...a1, id: 'ans-a3' }, run, mission, docs, ledger, judge: async () => { throw Object.assign(new Error('상한'), { httpStatus: 429 }); } });
  assert.equal(f.status, 'failed'); assert.equal(f.cap, true);
  assert.equal((await getTriage('ans-a3')).status, 'failed');
});
