// API 없이 도는 검증기·규칙 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isSubstring, numericClaims, unsupportedClaims, corpusClaims } from '../src/util.js';
import { validate } from '../src/schema.js';
import { evaluateCriteria, gradeFor } from '../src/stages/criteria.js';
import { createSession, decide } from '../src/engine.js';

const scn = JSON.parse(readFileSync(new URL('../scenarios/gaon-202607-demo.json', import.meta.url)));

test('인용 검증: 공백 차이는 통과, 한 글자라도 바뀌면 막는다', () => {
  const t = scn.manual.clauses.find((c) => c.id === 'M3-1-2').text;
  assert.ok(isSubstring('홍수경보가  발령되고 계획홍수위 도달이 예상되는 경우', t));
  assert.ok(!isSubstring('홍수경보가 발령되고 계획홍수위 도달이 우려되는 경우', t));
  assert.ok(!isSubstring('', t));
});

test('수치·시각 추출과 근거 대조', () => {
  assert.deepEqual([...numericClaims('06시경 9.5m, 04시 47분 접수, 05:12 전화, 15센티미터')].sort(),
    ['N15cm', 'N9.5m', 'T4:47', 'T5:12', 'T6:00'].sort());
  const corpus = corpusClaims(['미르천교 06시경 계획홍수위 9.5m 도달 예상']);
  assert.deepEqual(unsupportedClaims('06:00 9.5m 도달 예상', corpus), []);
  assert.deepEqual(unsupportedClaims('06:30 9.7m 도달 예상', corpus), ['T6:30', 'N9.7m']);
});

test('스키마 검증기', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'string', enum: ['x'] }, b: { type: 'array', items: { type: 'number' } } } };
  assert.deepEqual(validate(s, { a: 'x', b: [1] }), []);
  assert.equal(validate(s, { b: ['1'] }).length, 2);
});

function fakeState(norms) {
  const st = createSession(scn);
  norms.forEach(([id, n]) => st.signals.push({ ...scn.signals.find((s) => s.id === id), norm: n }));
  return st;
}
const base = { place_ids: ['P1'], other_places: [], facility_ids: [], hazard: 'river_flood', scope: 'local', urgency: 'caution', asks_action: false, one_line: '' };

test('기준 판정과 권고 등급은 규칙표대로', () => {
  const st = fakeState([
    ['S06', { ...base, facts: [{ type: 'flood_warning_issued', gauge_id: 'G1', evidence_span: '홍수경보' }, { type: 'level_forecast', gauge_id: 'G1', value: 8.5, evidence_span: '8.5m' }] }],
  ]);
  const inc = { facility_id: 'F1', signal_ids: ['S06'] };
  let c = evaluateCriteria(scn, st, inc);
  assert.equal(c.find((x) => x.id === 'C2').status, 'approaching');
  assert.equal(gradeFor(st, inc, c).grade, 'report');

  st.signals.push({ ...scn.signals.find((s) => s.id === 'S10'), norm: { ...base, facts: [{ type: 'level_forecast', gauge_id: 'G1', value: 9.5, at: '06:00', evidence_span: '9.5m' }] } });
  inc.signal_ids.push('S10');
  c = evaluateCriteria(scn, st, inc);
  assert.equal(c.find((x) => x.id === 'C2').status, 'met');
  assert.equal(gradeFor(st, inc, c).grade, 'control_review');
});

test('결정: 사유 필수, 없는 수신처 거부, 보류는 수신처 없어도 됨', () => {
  const st = createSession(scn);
  st.incidents.push({ id: 'I1', decisions: [], grade: 'report', draft: null });
  assert.throws(() => decide(scn, st, { incident_id: 'I1', action: 'report', reason: ' ', recipients: ['K2'] }), /사유/);
  assert.throws(() => decide(scn, st, { incident_id: 'I1', action: 'report', reason: '경보', recipients: ['K99'] }), /수신처/);
  assert.equal(decide(scn, st, { incident_id: 'I1', action: 'hold', reason: '현장 확인 대기' }).sent, false);
  assert.equal(st.log.at(-1).type, 'decision');
});

for (const file of readdirSync(new URL('../scenarios/', import.meta.url)).filter((f) => f.endsWith('.json'))) {
  test(`시나리오 파일 무결성: ${file}`, () => {
    const s = JSON.parse(readFileSync(new URL(`../scenarios/${file}`, import.meta.url)));
    const ids = s.signals.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    const times = s.signals.map((x) => x.t);
    assert.deepEqual(times, [...times].sort());
    assert.equal(typeof s.synthetic, 'boolean');
    for (const e of s.expected.incidents) e.signals.forEach((x) => assert.ok(ids.includes(x), x));
    for (const x of s.expected.background ?? []) assert.ok(ids.includes(x), x);
    for (const f of s.facilities) {
      assert.ok(s.contacts.some((k) => k.id === f.manager_contact));
      f.criteria.forEach((c) => assert.ok(s.manual.clauses.some((m) => m.id === c.clause), c.clause));
    }
    for (const x of s.signals.filter((y) => y.data?.gauge)) assert.ok(s.gauges.some((g) => g.id === x.data.gauge));
  });
}

test('잘린 인용은 원문 문장 전체로 넓힌다', async () => {
  const { wholeSentences } = await import('../src/stages/advise.js');
  const t = scn.manual.clauses.find((c) => c.id === 'M4').text;
  assert.equal(wholeSentences('통행이 막힌 경우에는', t), '인명 위험이 있거나 통행이 막힌 경우에는 당직사령에게 보고한다.');
  assert.equal(wholeSentences(t, t), t);
});

test('통행 막힘은 보고 권고(매뉴얼 제4조)', () => {
  const st = fakeState([['S12', { ...base, place_ids: ['P4'], hazard: 'tree_fall', facts: [{ type: 'road_blocked', evidence_span: '한 차선을 막고 있음' }] }]]);
  const g = gradeFor(st, { signal_ids: ['S12'] }, []);
  assert.equal(g.grade, 'report');
  assert.ok(g.why.includes('도로 통행 막힘'));
});
