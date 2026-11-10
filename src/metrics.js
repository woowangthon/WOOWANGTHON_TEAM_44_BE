// 재생 결과를 시나리오 expected와 비교하는 검증 지표 (README·발표 부록용)
import { isSubstring, gradeRank, unsupportedClaims, internalCodes } from './util.js';
import { evidenceCorpus, briefTexts } from './stages/advise.js';

export function scoreRun(scn, state, report) {
  const exp = scn.expected;
  const byId = Object.fromEntries(state.signals.map((s) => [s.id, s]));
  const clauses = Object.fromEntries(scn.manual.clauses.map((c) => [c.id, c.text]));

  // 사건 결합: 예상 사건마다 겹침이 가장 큰 예측 사건을 짝짓고, 신호 단위로 맞았는지 센다
  const pairs = {};
  for (const e of exp.incidents) {
    const counts = {};
    e.signals.forEach((s) => byId[s]?.incident_id && (counts[byId[s].incident_id] = (counts[byId[s].incident_id] ?? 0) + 1));
    pairs[e.id] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  const used = Object.values(pairs).filter(Boolean);
  const dupPairs = used.length - new Set(used).size;
  let correct = 0;
  let total = 0;
  const wrong = [];
  for (const e of exp.incidents) for (const s of e.signals) {
    total++;
    if (byId[s]?.incident_id && byId[s].incident_id === pairs[e.id]) correct++;
    else wrong.push(s);
  }
  for (const s of exp.background ?? []) {
    total++;
    if (byId[s]?.status === 'background') correct++;
    else wrong.push(s);
  }

  // 권고 시점: 기대 시그널까지(포함) 해당 등급 이상이 나왔는가
  const timing = (exp.min_grade_by ?? []).map((m) => {
    const inc = state.incidents.find((i) => i.id === pairs[m.incident]);
    const deadline = scn.signals.findIndex((s) => s.id === m.not_later_than);
    const hit = inc?.grade_history.find((h) => gradeRank(h.grade) >= gradeRank(m.grade));
    const hitIdx = hit ? scn.signals.findIndex((s) => s.id === hit.signal_id) : -1;
    return { ...m, at_signal: hit?.signal_id ?? null, ok: hitIdx >= 0 && hitIdx <= deadline };
  });

  // 인용: 화면에 올라간 인용을 독립적으로 다시 원문과 대조
  const shown = state.incidents.flatMap((i) => i.citations);
  const hallucinated = shown.filter((c) => !isSubstring(c.quote, clauses[c.clause_id] ?? ''));

  // 초안 숫자: 마지막 초안의 수치·시각이 근거 자료에 있는가
  const draftIssues = state.incidents.filter((i) => i.draft).flatMap((i) => {
    const corpus = evidenceCorpus(scn, { ...state, byId }, i);
    return briefTexts(i.draft).flatMap(([k, t]) => unsupportedClaims(t, corpus).map((u) => `${i.id}.${k}:${u}`));
  });

  // 화면 문장(인용 이유, 초안) 속 내부 코드(C3, met 등)
  const codeLeaks = [
    ...shown.flatMap((c) => internalCodes(c.why).map((x) => `cite.why:${x}`)),
    ...state.incidents.filter((i) => i.draft).flatMap((i) => briefTexts(i.draft).flatMap(([k, t]) => internalCodes(t).map((x) => `${i.id}.${k}:${x}`))),
  ];

  return {
    association_accuracy: +(correct / total).toFixed(3),
    association_wrong: wrong,
    merged_expected_incidents: dupPairs,
    predicted_incidents: state.incidents.length,
    expected_incidents: exp.incidents.length,
    grade_timing: timing,
    citations_shown: shown.length,
    citations_hallucinated: hallucinated.length,
    citations_blocked_by_verifier: state.metrics.citations_blocked,
    facts_rejected_by_verifier: state.metrics.facts_rejected,
    draft_unsupported_numbers: draftIssues,
    internal_codes_on_screen: codeLeaks,
    answers_failed_check: state.metrics.check_failures ?? 0,
    handover_summary_verified: report.summary_verified,
    ai_errors: state.metrics.ai_errors,
    llm_calls: state.metrics.llm_calls,
  };
}
