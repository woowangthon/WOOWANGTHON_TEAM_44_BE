import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numbers, hasNumber, missingNumbers, quoteIn, checkSentence, rng } from '../src/text.js';
import { plantNumber, plantUnit, plantDirection, droppedHedges, altValues } from '../src/plant.js';
import { grade, gradeRounds, interim, pidLabel } from '../src/grade.js';

const source = {
  paragraphs: [
    { pid: 'p1', text: '청년층 일자리는 3년간 21.1만 개 줄었다. 이 가운데 20.8만 개가 AI 노출도가 높은 업종에서 감소했다.' },
    { pid: 'p2', text: '고용률은 전년 대비 0.5%p 상승한 62.3%로 집계됐다. 정부는 내년에 1,385억 원을 투입할 계획이다.' },
  ],
};
const paraById = new Map(source.paragraphs.map((p) => [p.pid, p]));

test('숫자 토큰: 값·자릿수·범주', () => {
  const t = numbers('3년간 21.1만 개, 0.5%p 상승한 62.3%, 1,385억 원, 2025년');
  assert.deepEqual(t.map((x) => [x.value, x.mag, x.kind]), [
    ['3', '', 'years'], ['21.1', '만', 'n'], ['0.5', '', 'pctp'], ['62.3', '', 'pct'], ['1385', '억', 'n'], ['2025', '', 'year'],
  ]);
});

test('숫자 대조: 같은 표기만 통과, 1은 21.1 속에서 찾지 않음', () => {
  assert.ok(hasNumber(numbers('21.1만 개')[0], source.paragraphs[0].text));
  assert.ok(!hasNumber(numbers('21.1천 개')[0], source.paragraphs[0].text));
  assert.ok(!hasNumber(numbers('1만 개')[0], source.paragraphs[0].text));
  assert.ok(!hasNumber(numbers('0.5% 상승')[0], source.paragraphs[1].text));
  assert.deepEqual(missingNumbers('고용률 62.3%, 1,385억 원', source.paragraphs[1].text), []);
});

test('인용 대조와 문장 검사', () => {
  assert.ok(quoteIn('0.5%p  상승한 62.3%', source.paragraphs[1].text));
  assert.ok(!quoteIn('0.6%p 상승', source.paragraphs[1].text));
  assert.deepEqual(checkSentence('고용률은 0.5%p 올라 62.3%였다.', [{ pid: 'p2', quote: '0.5%p 상승한 62.3%' }], paraById), []);
  assert.equal(checkSentence('고용률은 0.6%p 올랐다.', [{ pid: 'p2', quote: '0.5%p 상승한 62.3%' }], paraById).length, 1);
});

test('숫자 바꿈: 바뀐 값은 원자료 어디에도 없다', () => {
  for (let i = 0; i < 20; i++) {
    const r = plantNumber('청년층 일자리는 3년간 21.1만 개 줄었다.', source, rng(`s${i}`));
    assert.ok(r);
    assert.ok(missingNumbers(r.after, source.paragraphs.map((p) => p.text).join('\n')).length === 1, r.after);
  }
  assert.ok(!altValues('2025', 'year').includes('2025'));
  assert.equal(numbers("’25년 1,846시간")[0].kind, 'year');
  assert.deepEqual(altValues('25', 'year'), ['24', '26', '23']);
  assert.equal(altValues('100', 'n')[0], '110');
  assert.ok(altValues('100', 'n').includes('200'));
});

test('단위 바꿈: %p→%, 만→천', () => {
  const r = plantUnit('고용률은 0.5%p 상승했다.', source, rng('u'));
  assert.equal(r.after, '고용률은 0.5% 상승했다.');
  const r2 = plantUnit('일자리가 21.1만 개 줄었다.', source, rng('u'));
  assert.equal(r2.after, '일자리가 211만 개 줄었다.');
  const r3 = plantUnit('1,385억 원을 투입한다.', { paragraphs: [{ pid: 'p1', text: '1,385억 원' }] }, rng('u'));
  assert.equal(r3, null);
  const r4 = plantUnit('3만 명이 참여했다.', { paragraphs: [{ pid: 'p1', text: '3만 명' }] }, rng('u'));
  assert.equal(r4.after, '3천 명이 참여했다.');
});

test('방향 바꿈: 인용이 한쪽 방향일 때만', () => {
  const r = plantDirection('청년층 일자리가 21.1만 개 줄었다.', ['3년간 21.1만 개 줄었다'], rng('d'));
  assert.equal(r.after, '청년층 일자리가 21.1만 개 늘었다.');
  assert.equal(plantDirection('고용률이 상승했다.', ['상승했으나 일부는 감소했다'], rng('d')), null);
});

test('한정어 빠짐 검사', () => {
  assert.deepEqual(droppedHedges('1,385억 원을 투입할 계획이다.', '1,385억 원을 투입한다.'), ['계획']);
  assert.deepEqual(droppedHedges('투입할 계획이다.', '투입할 계획이다.'), []);
});

const task = {
  id: 't1',
  sentences: [{ sid: 's1', text: 'A' }, { sid: 's2', text: 'B틀림' }, { sid: 's3', text: 'C' }, { sid: 's4', text: 'D틀림' }],
  answer: {
    planted: [
      { sid: 's2', type: 'number', before: 'B', after: 'B틀림', evidence: { pid: 'p1', quote: 'q' }, why: 'w' },
      { sid: 's4', type: 'direction', before: 'D', after: 'D틀림', evidence: { pid: 'p2', quote: 'q' }, why: 'w' },
    ],
    clean: [{ sid: 's1', support: [{ pid: 'p1', quote: 'a' }] }, { sid: 's3', support: [{ pid: 'p2', quote: 'c' }] }],
  },
};

test('채점: 찾음·놓침·오탐과 점수', () => {
  const g = grade(task, [{ sid: 's2', reason: '숫자·단위' }, { sid: 's3', reason: '기타' }], '반려');
  assert.deepEqual(g.found, ['s2']);
  assert.deepEqual(g.missed, ['s4']);
  assert.deepEqual(g.falseAlarms, ['s3']);
  assert.equal(g.score, Math.round(0.5 * 50 + 0.5 * 30 + 20));
  assert.equal(g.decisionOk, true);
  const kinds = Object.fromEntries(g.replies.map((r) => [r.sid, r.kind]));
  assert.deepEqual(kinds, { s2: 'fixed', s3: 'defended', s4: 'shipped' });
  assert.equal(g.replies.find((r) => r.sid === 's2').after, 'B');
  assert.equal(g.replies.find((r) => r.sid === 's2').reasonMatch, true);
  assert.deepEqual(g.final.map((f) => f.status), ['ok', 'fixed', 'kept', 'shipped_error']);
});

test('채점: 오류 없는 과제는 아무것도 짚지 않고 승인하면 100', () => {
  const cleanTask = { ...task, answer: { planted: [], clean: task.sentences.map((s) => ({ sid: s.sid, support: [] })) } };
  assert.equal(grade(cleanTask, [], '승인').score, 100);
  assert.equal(grade(cleanTask, [], '반려').decisionOk, false);
});

test('채점: 오류가 있는데 승인하고 하나도 못 찾으면 0', () => {
  const g = grade(task, [], '승인');
  assert.equal(g.score, 0);
  assert.match(g.headline, /틀린 문장 2개가 든 보고가 그대로 승인됐습니다/);
  assert.equal(g.tendency, '승인 쪽');
});

test('채점: 없는 sid와 중복 표시는 무시', () => {
  const g = grade(task, [{ sid: 's9' }, { sid: 's2' }, { sid: 's2' }], '반려');
  assert.equal(g.counts.marked, 1);
});

test('2차 결재: 1차 반려 뒤 수정본에는 놓친 오류만 남고, 남은 수는 알려 주지 않는다', () => {
  const it = interim(task, [{ sid: 's2', reason: '숫자·단위' }, { sid: 's3' }]);
  assert.equal(it.stage, 'revision');
  assert.deepEqual(it.revision.map((s) => s.text), ['A', 'B', 'C', 'D틀림']);
  assert.deepEqual(it.replies.map((r) => r.kind), ['fixed', 'defended']);
  assert.doesNotMatch(JSON.stringify(it), /shipped|missed|D"/);
});

test('2차 결재: 남은 오류를 2차에서 잡으면 절반 점수, 판정은 반려·반려가 맞다', () => {
  const g = gradeRounds(task, [{ marks: [{ sid: 's2' }], decision: '반려' }, { marks: [{ sid: 's4' }], decision: '반려' }]);
  assert.deepEqual(g.found1, ['s2']);
  assert.deepEqual(g.found2, ['s4']);
  assert.deepEqual(g.missed, []);
  assert.deepEqual(g.correctDecisions, ['반려', '반려']);
  assert.equal(g.decisionOk, true);
  assert.equal(g.score, Math.round(((1 + 0.5) / 2) * 50 + 30 + 20));
  assert.deepEqual(g.final.map((f) => f.status), ['ok', 'fixed', 'ok', 'fixed']);
});

test('2차 결재: 1차에 다 잡았으면 수정본은 승인이 맞고, 고친 문장을 다시 짚으면 잘못 짚음', () => {
  const ok = gradeRounds(task, [{ marks: [{ sid: 's2' }, { sid: 's4' }], decision: '반려' }, { marks: [], decision: '승인' }]);
  assert.deepEqual(ok.correctDecisions, ['반려', '승인']);
  assert.equal(ok.score, 100);
  const bad = gradeRounds(task, [{ marks: [{ sid: 's2' }, { sid: 's4' }], decision: '반려' }, { marks: [{ sid: 's2' }], decision: '반려' }]);
  assert.equal(bad.counts.falseAlarms, 1);
  assert.equal(bad.decisionOks[1], false);
  assert.equal(bad.replies.filter((r) => r.round === 2)[0].kind, 'defended');
});

test('2차 결재: 1차 승인 뒤 2차는 없다', () => {
  assert.throws(() => gradeRounds(task, [{ marks: [], decision: '승인' }, { marks: [], decision: '승인' }]), /1차 반려 뒤/);
});

test('표 행 번호 표기', () => {
  assert.equal(pidLabel('p3'), '3문단');
  assert.equal(pidLabel('r2'), '표 2행');
});

test('라이브: 붙여 넣은 글을 원자료 모양으로, 길이 제한', async () => {
  const { textSource, view, STEPS } = await import('../src/live.js');
  assert.throws(() => textSource('짧다'), /300자/);
  const s = textSource(`${'가'.repeat(200)}\n\n${'나'.repeat(150)}\n짧음`, '테스트');
  assert.equal(s.paragraphs.length, 2);
  assert.equal(s.paragraphs[1].pid, 'p2');
  const v = view({ id: 'live-abc123', status: 'p2', public: [], source: s, n: 3, planted: [{ sid: 's1' }] });
  assert.doesNotMatch(JSON.stringify(v), /planted|"n"/);
  assert.equal(STEPS.length, 4);
});

test('방향 바꿈: 부호가 붙은 숫자가 있는 문장에는 심지 않는다(문장 안 모순으로 티가 남)', () => {
  assert.equal(plantDirection('하향 이동은 전년 대비 -0.5%p로 가장 적게 감소했다.', ['-0.5%p 감소'], rng('d')), null);
});

test('숫자 뒤 조사 맞추기', async () => {
  const { fixParticle } = await import('../src/plant.js');
  const f = (text, num) => fixParticle(text, text.indexOf(num) + num.length, num);
  assert.equal(f('40.4에서 39.5으로 감소했다', '39.5'), '40.4에서 39.5로 감소했다');
  assert.equal(f('수치가 37로 늘었다', '37'), '수치가 37로 늘었다');
  assert.equal(f('수치가 36로 늘었다', '36'), '수치가 36으로 늘었다');
  assert.equal(f('값 2이 크다', '2'), '값 2가 크다');
  assert.equal(f('값 2이다', '2'), '값 2이다');
});
