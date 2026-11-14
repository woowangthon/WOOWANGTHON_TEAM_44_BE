// F6 막아 보기: 코드 판정(틀린 구절이 남았나)과 감사 판정을 합치는 규칙, 입력 검사(모델 호출 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainScore, patchVerdict, patch, REMAIN, patchJudgeUser, patchJudgeSystem } from '../src/patch.js';

test('틀린 구절이 새 결과에 70% 이상 남으면 남음, 짧은 구절은 판단하지 않음', () => {
  const units = [{ text: '공직적격성평가는 현재 접수 중인 사업은 아니며 확인이 필요합니다' }];
  assert.ok(remainScore('현재 접수 중인 사업은 아니며', units) >= REMAIN);
  assert.ok(remainScore('현재 접수 중인 사업은 아니며', [{ text: '원서 접수 기간은 자료에 없어 확인 필요' }]) < REMAIN);
  assert.equal(remainScore('없음', units), null);
});

test('판정 합치기: 코드가 남음이면 남음, 감사가 no·partly면 남음, 새 오류면 new, 아니면 막음', () => {
  assert.equal(patchVerdict(0.9, { fixed: 'yes', new_error: false }), 'remained');
  assert.equal(patchVerdict(0.2, { fixed: 'no', new_error: false }), 'remained');
  assert.equal(patchVerdict(0.2, { fixed: 'partly', new_error: false }), 'remained');
  assert.equal(patchVerdict(0.2, { fixed: 'yes', new_error: true }), 'new');
  assert.equal(patchVerdict(0.1, { fixed: 'yes', new_error: false }), 'blocked');
  assert.equal(patchVerdict(0.2, { fixed: 'partly', new_error: true }), 'remained');
  assert.equal(patchVerdict(0.2, null), 'blocked');
  assert.equal(patchVerdict(null, null), 'unjudged');
});

test('입력 검사: 없는 판, 짧은 지시, A가 아닌 항목은 모델을 부르기 전에 막는다', async () => {
  await assert.rejects(patch({ runId: 'nope', itemId: 'L1', instruction: '원자료를 다시 대조해 주세요', deviceId: 'dev-test-0001' }), /없는 판/);
  await assert.rejects(patch({ runId: 'm4-base-anthropic-11121636-2', itemId: 'L1', instruction: '짧음', deviceId: 'dev-test-0001' }), /8자/);
  await assert.rejects(patch({ runId: 'm4-base-anthropic-11121636-2', itemId: 'L4', instruction: '원자료를 다시 대조해 주세요', deviceId: 'dev-test-0001' }), /A등급/);
});

test('막아 보기 감사는 팀장 지시도 받는다(지시에 적힌 나이·게시일을 새 오류로 보지 않게)', () => {
  const u = patchJudgeUser({}, { origin: 'S4.b7', wrongText: '', why: 'x', evidence: [] }, '전', '후', { brief: '우리 학생은 만 21~25세', today: '2026-11-12' });
  assert.match(u, /<팀장 지시>\n우리 학생은 만 21~25세/);
  assert.match(patchJudgeSystem, /팀장 지시에 적힌 사실/);
  assert.doesNotMatch(patchJudgeUser({}, { origin: 'S1.e1', evidence: [] }, 'a', 'b'), /<팀장 지시>/);
});
