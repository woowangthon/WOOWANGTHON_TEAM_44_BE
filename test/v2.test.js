import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _memReset } from '../src/store.js';
import { ddayChecks, normDates, unitMissingNumbers, cluster, buildLedger, ledgerCounts, codeScan } from '../src/audit.js';
import { checkPlan, unitsOf, plainOfUnits, planOf, finalKeys, loadMission } from '../src/mission.js';
import { scoreAnswer, rescore } from '../src/score.js';
import { applyReview, finalizeDraft, saveLedgerVersion, ledgerVersions, latestLedger } from '../src/ledger.js';
import { auditorsFor, companyOf } from '../src/llm.js';

const mission = { id: 'mt', today: '2026년 11월 12일(목)', todayISO: '2026-11-12', postDateISO: '2026-11-16', brief: '팀장: 「학생은 만 21~25세」', stages: [], baselines: { rough: 'r', careful: [] } };
const docs = { A: { key: 'A', title: 't', publisher: 'p', paragraphs: [{ pid: 'A-p1', text: '11월 9일부터 11월 22일까지 모집한다. 25명 내외를 선발한다.' }] } };
const run = {
  id: 'mt-base-x-1', stages: [
    { key: 'S1', name: '추출', kind: 'list', inputs: ['sources'], instruction: 'i', units: [{ uid: 'S1.e1', text: '모집 11월 9일~11월 22일' }, { uid: 'S1.e2', text: '25명 선발' }] },
    { key: 'S2', name: '표', kind: 'table', inputs: ['S1'], instruction: 'i', units: [{ uid: 'S2.h', text: '사업 | 마감' }, { uid: 'S2.r1', text: '자문단 | 11월 22일(10일 남음)' }] },
    { key: 'S3', name: '공지', kind: 'lines', inputs: ['S2'], instruction: 'i', units: [{ uid: 'S3.n1', text: '자문단 30명 모집, 11/22 마감(D-10)' }] },
  ],
};

test('날짜 표기 맞추기와 남은 날 검산(오늘·게시일 기준)', () => {
  assert.equal(normDates('2026-11-01부터 11/22까지'), '2026년 11월 1일부터 11월 22일까지');
  const [d] = ddayChecks('11월 22일(일) 마감, 10일 남음', mission);
  assert.equal(d.fromToday, 10); assert.equal(d.fromPost, 6); assert.ok(d.ok); assert.ok(d.todayBased);
  const [w] = ddayChecks('11월 22일 마감까지 12일 남음', mission);
  assert.equal(w.ok, false);
  const [y] = ddayChecks('2027년 2월 27일 시행(107일 남음)', mission);
  assert.equal(y.fromToday, 107); assert.ok(y.ok);
});

test('원자료에 없는 숫자: 남은 날·한 자리 수·날짜 표기 차이는 빼고 본다', () => {
  const src = '11월 9일부터 11월 22일까지 모집한다. 25명 내외 학생은 만 21~25세';
  assert.deepEqual(unitMissingNumbers('자문단 30명 모집, 11/22 마감(D-10), 1) 항목', src), ['30명']);
  assert.deepEqual(unitMissingNumbers('2026-11-22 마감, 10일 남음', src + ' 2026년'), []);
});

test('감사 묶기: 같은 단위를 가리키면 한 묶음, 장부 1판에 근원은 가장 앞 단계', () => {
  const a1 = { model: 'claude-opus-5-5', company: 'Anthropic', errors: [
    { origin: 'S3.n1', wrong_text: '30명', pattern: '숫자·계산 틀림', grade: 'A', spread: [], evidence: [{ ref: 'A-p1', quote: '25명 내외를 선발한다' }], why: 'w', fix: 'f', prevent: 'p' },
    { origin: 'S2.r1', wrong_text: '10일 남음', pattern: '단위·기준 시점 혼동', grade: 'B', spread: ['S3.n1'], evidence: [], why: 'w', fix: 'f', prevent: 'p' },
  ] };
  const a2 = { model: 'gpt-6.1-sol', company: 'OpenAI', errors: [
    { origin: 'S3.n1', wrong_text: '자문단 30명 모집', pattern: '숫자·계산 틀림', grade: 'A', spread: [], evidence: [], why: 'w2', fix: 'f', prevent: 'p' },
  ] };
  const cl = cluster([a1, a2]);
  assert.equal(cl.length, 2);
  const L = buildLedger(run, mission, docs, [a1, a2]);
  const num = L.items.find((x) => x.pattern === '숫자·계산 틀림');
  assert.equal(num.source, 'both'); assert.equal(num.grade, 'A'); assert.equal(num.byAudit.Anthropic.code.wrongInUnit, true);
  assert.equal(num.byAudit.Anthropic.code.evidence[0].found, true);
  const c = ledgerCounts(L, ['S2', 'S3']);
  assert.equal(c.A, 1); assert.equal(c.Aboth, 1); assert.equal(c.Afinal, 1);
  // 코드 후보: S2.r1(게시일이 있는데 오늘 기준 남은 날)은 감사가 이미 짚어 codeOnly에 없다
  assert.ok(codeScan(mission, docs, run.stages).some((x) => x.uid === 'S2.r1'));
  assert.ok(!L.codeOnly.some((x) => x.uid === 'S2.r1'));
});

test('팀장 계획 검사: 받을 수 없는 것·빈 지시는 막는다', () => {
  assert.throws(() => checkPlan(mission, [{ kind: 'list', inputs: ['S2'], instruction: 'a' }, { kind: 'lines', inputs: ['S1'], instruction: 'b' }]), /받을 수 없는/);
  assert.throws(() => checkPlan(mission, [{ kind: 'list', inputs: ['sources'], instruction: '' }, { kind: 'lines', inputs: ['S1'], instruction: 'b' }]), /지시/);
  const p = checkPlan(mission, [{ kind: 'list', inputs: ['sources', 'brief'], instruction: 'a' }, { kind: 'check', inputs: ['S1', 'sources'], instruction: '대조' }, { kind: 'lines', inputs: ['S2'], instruction: 'b' }]);
  assert.equal(p[1].kind, 'list'); assert.equal(p[1].check, true); assert.equal(p[2].key, 'S3');
});

test('단위와 넘기는 모양: 표는 머리행·행, 다음 단계에는 번호 없이', () => {
  const u = unitsOf('S2', 'table', { columns: ['a', 'b'], rows: [{ cells: ['1', '2'] }] });
  assert.deepEqual(u.map((x) => x.uid), ['S2.h', 'S2.r1']);
  assert.ok(!plainOfUnits('table', u).includes('S2.'));
});

test('실제 미션 파일: 잘 맡긴 판은 모든 단계에 원자료가 간다', () => {
  const m = loadMission('m4');
  const careful = planOf(m, 'careful');
  assert.ok(careful.every((s) => s.inputs.includes('sources')));
  assert.equal(planOf(m, 'rough').length, 1);
  assert.deepEqual(finalKeys(m.stages), ['S4', 'S5']);
});

test('감사는 작업 모델과 다른 회사', () => {
  process.env.ANTHROPIC_API_KEY ||= 'x'; process.env.OPENAI_API_KEY ||= 'x'; process.env.GEMINI_API_KEY ||= 'x';
  assert.ok(auditorsFor('OpenAI').every((m) => companyOf(m) !== 'OpenAI'));
  assert.equal(auditorsFor('OpenAI').length, 2);
  assert.equal(auditorsFor('OpenAI', { all: true }).length, 3);
});

const reviewed = (items) => ({ version: 2, status: 'reviewed', items });
test('채점: 검수 안 된 장부는 거절, A만 점수, B·C 단위는 헛짚음 아님', () => {
  assert.throws(() => scoreAnswer(run, { status: 'ai', items: [] }, { marks: [] }), /사람 검수/);
  const L = reviewed([
    { id: 'L1', origin: 'S3.n1', spread: [], grade: 'A', pattern: '숫자·계산 틀림', originConfirmed: true },
    { id: 'L2', origin: 'S2.r1', spread: [], grade: 'B', pattern: '단위·기준 시점 혼동' },
  ]);
  const g = scoreAnswer(run, L, { marks: [{ uid: 'S3.n1', origin: true }, { uid: 'S2.r1' }, { uid: 'S1.e1' }], decision: 'reject' });
  assert.equal(g.counts.foundA, 1); assert.deepEqual(g.falseMarks, ['S1.e1']); assert.deepEqual(g.bcSeen, ['S2.r1']);
  assert.equal(g.decisionOk, true); assert.equal(g.counts.originHits, 1);
  const clean = scoreAnswer(run, reviewed([]), { marks: [], decision: 'approve' });
  assert.equal(clean.score, 100); assert.equal(clean.shouldReject, false);
});

test('장부 판: 검수 초안 → 확정(판 올림), 판정 안 한 항목이 있으면 막음, 재채점은 두 판을 함께', async () => {
  _memReset();
  const v1 = { runId: run.id, version: 1, status: 'ai', items: [{ id: 'L1', origin: 'S3.n1', spread: [], grade: 'A', pattern: '숫자·계산 틀림', review: 'pending' }, { id: 'L2', origin: 'S1.e2', spread: [], grade: 'B', pattern: '기타', review: 'pending' }], reviewLog: [], deleted: [] };
  await saveLedgerVersion(run.id, v1);
  const draft = structuredClone(v1);
  applyReview(draft, { action: 'approve', item: 'L1', note: '맞음' });
  await assert.rejects(() => finalizeDraft(run.id, draft), /판정하지 않은/);
  applyReview(draft, { action: 'delete', item: 'L2', note: '원자료와 같음' });
  applyReview(draft, { action: 'add', origin: 'S2.r1', grade: 'A', pattern: '날짜·기간 오류', why: '게시일 기준 6일', note: '직접 대조' });
  const v2 = await finalizeDraft(run.id, draft);
  assert.equal(v2.version, 2); assert.equal(v2.status, 'reviewed'); assert.equal(v2.items.length, 2); assert.equal(v2.deleted[0].id, 'L2');
  assert.ok(v2.reviewLog.length >= 3);
  const ans = { marks: [{ uid: 'S3.n1' }], decision: 'reject', ledgerVersion: 2 };
  // 이의로 한 판 더(항목 하나 삭제)
  const d3 = structuredClone(v2); applyReview(d3, { action: 'delete', item: 'H1', note: '이의 받아들임' });
  await finalizeDraft(run.id, d3);
  const vs = await ledgerVersions(run.id);
  assert.equal(vs.length, 3); assert.equal((await latestLedger(run.id, { reviewed: true })).version, 3);
  const r = rescore(run, vs, ans);
  assert.equal(r.changed, true); assert.equal(r.before.counts.A, 2); assert.equal(r.now.counts.A, 1);
});
