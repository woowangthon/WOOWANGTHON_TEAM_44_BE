// 감사 출력이 길이 상한에서 잘렸을 때: 같은 요청을 반복하지 않고, 그래도 잘리면 끝까지 받은 항목만 살린다(11/14 운영에서 Google 감사가 잘린 일)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salvageAudit, auditMaxTokens, TRUNCATE_NOTE } from '../src/audit.js';
import { auditLabel } from '../src/lead.js';

const item = (o) => ({ origin: o, wrong_text: '「예정」이 빠짐', pattern: '한정어·조건 탈락', grade: 'A', spread: [], evidence: [{ ref: 'A-p1', quote: '예정' }], why: '왜 "따옴표" \\ 역슬래시', fix: '고침', prevent: '막기' });

test('잘린 JSON에서 끝까지 온 항목만 살린다(반쪽 항목·문자열 속 괄호는 무시)', () => {
  const full = JSON.stringify({ errors: [item('S1.e1'), item('S2.r3'), { ...item('S3.i1'), why: '괄호 { } [ ] 가 든 설명' }], overall: '평' });
  const cut = full.slice(0, full.lastIndexOf('"prevent"') + 5); // 세 번째 항목 중간에서 잘림
  const out = salvageAudit(cut);
  assert.deepEqual(out.errors.map((e) => e.origin), ['S1.e1', 'S2.r3']);
  assert.equal(out.errors[0].why, '왜 "따옴표" \\ 역슬래시');
  assert.equal(salvageAudit('{"overall": "생각만 하다 잘림'), null);
  assert.deepEqual(salvageAudit('{"errors": [').errors, []);
});

test('라이브 Google 감사 상한은 28k(옛 16k에서 반려 붙은 판이 잘림, 실측 20.6k), 나머지 32k, 잘린 뒤 다시 요청은 짧게', () => {
  assert.equal(auditMaxTokens('gemini-3.8-flash', true), 28000);
  assert.equal(auditMaxTokens('gpt-6.1-sol', true), 32000);
  assert.equal(auditMaxTokens('gemini-4-argon', false), 32000);
  assert.match(TRUNCATE_NOTE, /최대 12개/);
});

test('잘려 받은 항목만 살린 감사는 꼬리표에 그렇게 적는다', () => {
  const s = { phase: 'done', audits: [{ company: 'OpenAI', errors: [] }, { company: 'Google', errors: [], partial: true }], auditFailed: [], auditErrors: [] };
  assert.equal(auditLabel(s), 'AI 감사(2회사: OpenAI·Google) · Google 감사는 잘려 받은 항목만 · 사람 확인 전');
});
