// 채점과 신입의 답장. 모델을 부르지 않는다. 과제 파일에 기록해 둔 값(바꾸기 전 문장, 근거 인용)만으로 만든다.
//
// 결재는 두 번까지 간다.
//  1차: 처음 올라온 보고서. 승인하면 그대로 나가고 끝난다.
//  1차 반려 → 신입이 짚은 문장을 고치고(멀쩡한 문장은 근거를 들어 그대로 두고) 수정본을 다시 올린다.
//            이때 놓친 오류는 알려 주지 않는다. 수정본에 그대로 남아 있다.
//  2차: 수정본을 다시 결재한다. 남은 오류가 없으면 승인이 맞고, 남아 있으면 반려가 맞다.
//       2차에서 짚은 곳도 고쳐서 나가고, 끝까지 못 짚은 오류는 틀린 채 나간다.
import { REASON_OF } from './plant.js';

export const pidLabel = (pid) => {
  const m = String(pid).match(/^([pr])(\d+)$/);
  if (!m) return String(pid);
  return m[1] === 'r' ? `표 ${m[2]}행` : `${m[2]}문단`;
};

const DECISIONS = ['승인', '반려'];

function cleanMarks(task, marks) {
  const sids = new Set(task.sentences.map((s) => s.sid));
  const by = new Map();
  for (const m of marks ?? []) if (sids.has(m?.sid) && !by.has(m.sid)) by.set(m.sid, m.reason ?? null);
  return by;
}

/** 1차 반려 뒤 신입이 다시 올리는 수정본. 짚은 오류만 고친다(놓친 것은 그대로 남는다) */
export function revisionOf(task, marks1) {
  const by = cleanMarks(task, marks1);
  const planted = new Map(task.answer.planted.map((p) => [p.sid, p]));
  return task.sentences.map((s) => {
    const p = planted.get(s.sid);
    if (p && by.has(s.sid)) return { sid: s.sid, text: p.before, changed: true };
    return { sid: s.sid, text: s.text, changed: false };
  });
}

/** 표시 하나하나에 대한 신입의 답(고침 / 근거를 들어 그대로 둠) */
function answerMarks(task, by, round, alreadyFixed = new Set()) {
  const planted = new Map(task.answer.planted.map((p) => [p.sid, p]));
  const clean = new Map(task.answer.clean.map((c) => [c.sid, c]));
  const out = [];
  for (const s of task.sentences) {
    if (!by.has(s.sid)) continue;
    const p = planted.get(s.sid);
    const reason = by.get(s.sid);
    if (p && !alreadyFixed.has(s.sid)) {
      out.push({
        sid: s.sid, round, kind: 'fixed', said: '고쳤습니다.', before: p.after, after: p.before,
        evidence: p.evidence, evidenceLabel: pidLabel(p.evidence.pid), why: p.why,
        reasonGiven: reason, reasonExpected: REASON_OF[p.type], reasonMatch: reason === REASON_OF[p.type],
      });
    } else {
      // 멀쩡한 문장, 또는 1차에서 이미 고친 문장을 다시 짚은 경우
      const sup = p ? [p.evidence] : clean.get(s.sid)?.support ?? [];
      const first = sup[0];
      out.push({
        sid: s.sid, round, kind: 'defended',
        said: first ? `이 문장은 원자료 ${pidLabel(first.pid)}과 같습니다. 그대로 두었습니다.` : '이 문장은 원자료와 같습니다. 그대로 두었습니다.',
        text: p ? p.before : s.text, support: sup, reasonGiven: reason,
      });
    }
  }
  return out;
}

/** 1차 반려에 대한 중간 답: 고친 곳과 그대로 둔 곳, 수정본. 남은 오류 수는 알려 주지 않는다 */
export function interim(task, marks1) {
  const by = cleanMarks(task, marks1);
  const replies = answerMarks(task, by, 1);
  const fixed = replies.filter((r) => r.kind === 'fixed').length;
  const kept = replies.length - fixed;
  const parts = [];
  if (fixed) parts.push(`${fixed}곳을 고쳤습니다`);
  if (kept) parts.push(`${kept}곳은 원자료와 같아 그대로 두었습니다`);
  return {
    stage: 'revision',
    headline: `${parts.join(', ')}. 수정본을 다시 올립니다.`,
    replies,
    revision: revisionOf(task, marks1),
  };
}

/**
 * @param rounds [{ marks:[{sid,reason}], decision }] 1개(1차에서 끝) 또는 2개(1차 반려 → 2차)
 */
export function gradeRounds(task, rounds) {
  if (!Array.isArray(rounds) || rounds.length < 1 || rounds.length > 2) throw Object.assign(new Error('결재는 한 번 또는 두 번입니다'), { status: 400 });
  for (const r of rounds) if (!DECISIONS.includes(r?.decision)) throw Object.assign(new Error('판정은 승인 또는 반려'), { status: 400 });
  if (rounds.length === 2 && rounds[0].decision !== '반려') throw Object.assign(new Error('2차 결재는 1차 반려 뒤에만 있습니다'), { status: 400 });

  const planted = new Map(task.answer.planted.map((p) => [p.sid, p]));
  const P = planted.size;
  const by1 = cleanMarks(task, rounds[0].marks);
  const by2 = rounds[1] ? cleanMarks(task, rounds[1].marks) : new Map();

  const found1 = [...planted.keys()].filter((sid) => by1.has(sid));
  const remaining = [...planted.keys()].filter((sid) => !by1.has(sid));
  const found2 = rounds[1] ? remaining.filter((sid) => by2.has(sid)) : [];
  const found = [...found1, ...found2];
  const missed = [...planted.keys()].filter((sid) => !found.includes(sid));
  const fa1 = [...by1.keys()].filter((sid) => !planted.has(sid));
  // 2차의 잘못 짚음: 남은 오류가 아닌 곳(멀쩡한 문장, 1차에서 이미 고친 문장)
  const fa2 = [...by2.keys()].filter((sid) => !remaining.includes(sid));
  const falseAlarms = [...fa1, ...fa2.map((sid) => `${sid}@2`)];

  const correct1 = P ? '반려' : '승인';
  const ok1 = rounds[0].decision === correct1;
  const correct2 = remaining.length ? '반려' : '승인';
  const ok2 = rounds[1] ? rounds[1].decision === correct2 : null;
  const decision = rounds.at(-1).decision;
  const decisionOk = rounds[1] ? ok1 && ok2 : ok1;

  const markCount = by1.size + by2.size;
  const recall = P === 0 ? 1 : (found1.length + 0.5 * found2.length) / P;
  const precision = markCount === 0 ? (P === 0 ? 1 : 0) : found.length / markCount;
  const decisionPts = rounds[1] ? (ok1 ? 10 : 0) + (ok2 ? 10 : 0) : ok1 ? 20 : 0;
  const score = Math.round(recall * 50 + precision * 30 + decisionPts);

  // 신입의 답: 1차·2차 표시에 대한 답, 끝까지 못 짚은 오류는 「이대로 나갔습니다」
  const replies = [...answerMarks(task, by1, 1)];
  if (rounds[1]) replies.push(...answerMarks(task, by2, 2, new Set(found1)));
  for (const sid of missed) {
    const p = planted.get(sid);
    replies.push({
      sid, round: rounds.length, kind: 'shipped', said: '이대로 나갔습니다.', text: p.after, correct: p.before,
      evidence: p.evidence, evidenceLabel: pidLabel(p.evidence.pid), why: p.why, type: REASON_OF[p.type],
    });
  }
  const order = new Map(task.sentences.map((s, i) => [s.sid, i]));
  replies.sort((a, b) => order.get(a.sid) - order.get(b.sid) || a.round - b.round);

  // 최종본: 고친 문장은 고친 대로, 놓친 문장은 틀린 채로
  const final = task.sentences.map((s) => {
    const p = planted.get(s.sid);
    if (p && found1.includes(s.sid)) return { sid: s.sid, text: p.before, status: 'fixed', round: 1 };
    if (p && found2.includes(s.sid)) return { sid: s.sid, text: p.before, status: 'fixed', round: 2 };
    if (p) return { sid: s.sid, text: p.after, status: 'shipped_error' };
    return { sid: s.sid, text: s.text, status: by1.has(s.sid) || by2.has(s.sid) ? 'kept' : 'ok' };
  });

  let headline;
  if (P === 0 && decisionOk) headline = '틀린 곳이 없는 보고였습니다. 승인이 맞았습니다.';
  else if (P === 0) headline = '틀린 곳이 없는 보고였는데 반려됐습니다. 한 번 더 돌았습니다.';
  else if (!rounds[1] && rounds[0].decision === '승인') headline = `틀린 문장 ${P}개가 든 보고가 그대로 승인됐습니다.`;
  else if (missed.length) headline = `${found.length}곳은 고쳐 나갔고, ${missed.length}곳은 틀린 채 팀장에게 올라갔습니다.`;
  else if (found2.length) headline = `1차에 놓친 ${found2.length}곳을 수정본에서 잡았습니다. 고친 보고가 나갔습니다.`;
  else headline = '틀린 곳을 1차에서 모두 짚었습니다. 고친 보고가 나갔습니다.';

  // 유형별: 이 과제에서 심은 유형마다 찾았는지
  const byType = {};
  for (const [sid, p] of planted) {
    const t = REASON_OF[p.type];
    byType[t] ??= { planted: 0, found: 0 };
    byType[t].planted++;
    if (found.includes(sid)) byType[t].found++;
  }

  let tendency = '균형';
  if (missed.length > found.length || (!rounds[1] && rounds[0].decision === '승인' && P > 0)) tendency = '승인 쪽';
  else if (falseAlarms.length >= 2 || falseAlarms.length > found.length) tendency = '의심 쪽';

  return {
    stage: 'final', taskId: task.id, rounds: rounds.length,
    decision, decisions: rounds.map((r) => r.decision), correctDecisions: rounds[1] ? [correct1, correct2] : [correct1],
    correctDecision: rounds[1] ? correct2 : correct1, decisionOk, decisionOks: rounds[1] ? [ok1, ok2] : [ok1],
    counts: { planted: P, marked: markCount, found: found.length, found1: found1.length, found2: found2.length, missed: missed.length, falseAlarms: falseAlarms.length },
    found, found1, found2, missed, falseAlarms, score, recall, precision, byType, tendency, headline, replies, final,
  };
}

/** 한 번 결재로 끝나는 채점(예전 호출과 테스트용) */
export const grade = (task, marks, decision) => gradeRounds(task, [{ marks, decision }]);

/** 성향 한 줄. 사람을 평가하지 않고 이번 검수의 모양만 말한다 */
export const TENDENCY_TEXT = {
  '승인 쪽': '이번 검수는 놓친 곳이 짚은 곳보다 많았습니다. 승인 쪽으로 기운 검수입니다.',
  '의심 쪽': '이번 검수는 멀쩡한 문장을 짚은 곳이 많았습니다. 의심 쪽으로 기운 검수입니다.',
  균형: '놓친 곳과 잘못 짚은 곳이 적은, 균형 잡힌 검수였습니다.',
};
