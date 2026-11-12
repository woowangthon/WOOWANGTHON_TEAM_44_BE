// 채점과 신입의 답장. 모델을 부르지 않는다. 과제 파일에 기록해 둔 값(바꾸기 전 문장, 근거 인용)만으로 만든다.
import { REASON_OF } from './plant.js';

const pidLabel = (pid) => `${String(pid).replace(/^p/, '')}문단`;

/**
 * @param task  서버의 과제 전체(answer 포함)
 * @param marks [{ sid, reason }] 사용자가 표시한 문장
 * @param decision '승인' | '반려'
 */
export function grade(task, marks, decision) {
  if (!['승인', '반려'].includes(decision)) throw Object.assign(new Error('판정은 승인 또는 반려'), { status: 400 });
  const sids = new Set(task.sentences.map((s) => s.sid));
  const markBy = new Map();
  for (const m of marks ?? []) if (sids.has(m?.sid) && !markBy.has(m.sid)) markBy.set(m.sid, m.reason ?? null);
  const planted = new Map(task.answer.planted.map((p) => [p.sid, p]));
  const clean = new Map(task.answer.clean.map((c) => [c.sid, c]));

  const found = [], missed = [], falseAlarms = [];
  for (const [sid, p] of planted) (markBy.has(sid) ? found : missed).push(sid);
  for (const sid of markBy.keys()) if (!planted.has(sid)) falseAlarms.push(sid);

  const P = planted.size, F = markBy.size;
  const correctDecision = P === 0 ? '승인' : '반려';
  const decisionOk = decision === correctDecision;
  const recall = P === 0 ? 1 : found.length / P;
  const precision = F === 0 ? (P === 0 ? 1 : 0) : found.length / F;
  const score = Math.round(recall * 50 + precision * 30 + (decisionOk ? 20 : 0));

  // 신입의 답장: 표시한 문장마다 한 줄, 놓친 문장은 「이대로 나갔습니다」
  const replies = [];
  for (const s of task.sentences) {
    const p = planted.get(s.sid);
    if (markBy.has(s.sid) && p) {
      const reason = markBy.get(s.sid);
      replies.push({
        sid: s.sid, kind: 'fixed', said: '고쳤습니다.', before: p.after, after: p.before,
        evidence: p.evidence, evidenceLabel: pidLabel(p.evidence.pid), why: p.why,
        reasonGiven: reason, reasonExpected: REASON_OF[p.type], reasonMatch: reason === REASON_OF[p.type],
      });
    } else if (markBy.has(s.sid)) {
      const c = clean.get(s.sid);
      const sup = c?.support?.[0];
      replies.push({
        sid: s.sid, kind: 'defended',
        said: sup ? `이 문장은 원자료 ${pidLabel(sup.pid)}과 같습니다. 그대로 두었습니다.` : '이 문장은 원자료와 같습니다. 그대로 두었습니다.',
        text: s.text, support: c?.support ?? [], reasonGiven: markBy.get(s.sid),
      });
    } else if (p) {
      replies.push({
        sid: s.sid, kind: 'shipped', said: '이대로 나갔습니다.', text: p.after, correct: p.before,
        evidence: p.evidence, evidenceLabel: pidLabel(p.evidence.pid), why: p.why, type: REASON_OF[p.type],
      });
    }
  }

  // 최종본: 고친 문장은 고친 대로, 놓친 문장은 틀린 채로
  const final = task.sentences.map((s) => {
    const p = planted.get(s.sid);
    if (p && markBy.has(s.sid)) return { sid: s.sid, text: p.before, status: 'fixed' };
    if (p) return { sid: s.sid, text: p.after, status: 'shipped_error' };
    return { sid: s.sid, text: s.text, status: markBy.has(s.sid) ? 'kept' : 'ok' };
  });

  let headline;
  if (decision === '승인' && P > 0) headline = `오류 ${P}개가 든 보고가 승인됐습니다.`;
  else if (decision === '승인') headline = '틀린 곳이 없는 보고였습니다. 승인이 맞았습니다.';
  else if (P === 0) headline = '틀린 곳이 없는 보고였는데 반려됐습니다.';
  else if (missed.length) headline = `${found.length}곳은 고쳐 왔고, ${missed.length}곳은 그대로 나갔습니다.`;
  else headline = '틀린 곳을 모두 짚었습니다. 고친 보고가 나갔습니다.';

  // 유형별: 이 과제에서 심은 유형마다 찾았는지
  const byType = {};
  for (const [sid, p] of planted) {
    const t = REASON_OF[p.type];
    byType[t] ??= { planted: 0, found: 0 };
    byType[t].planted++;
    if (markBy.has(sid)) byType[t].found++;
  }

  let tendency = '균형';
  if (missed.length > found.length || (decision === '승인' && P > 0)) tendency = '승인 쪽';
  else if (falseAlarms.length >= 2 || falseAlarms.length > found.length) tendency = '의심 쪽';

  return {
    taskId: task.id, decision, correctDecision, decisionOk,
    counts: { planted: P, marked: F, found: found.length, missed: missed.length, falseAlarms: falseAlarms.length },
    found, missed, falseAlarms, score, recall, precision, byType, tendency, headline, replies, final,
  };
}

/** 성향 한 줄. 사람을 평가하지 않고 이번 검수의 모양만 말한다 */
export const TENDENCY_TEXT = {
  '승인 쪽': '이번 검수는 놓친 곳이 짚은 곳보다 많았습니다. 승인 쪽으로 기운 검수입니다.',
  '의심 쪽': '이번 검수는 멀쩡한 문장을 짚은 곳이 많았습니다. 의심 쪽으로 기운 검수입니다.',
  균형: '놓친 곳과 잘못 짚은 곳이 적은, 균형 잡힌 검수였습니다.',
};
