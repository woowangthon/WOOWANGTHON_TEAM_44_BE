// ③-b 매뉴얼 조항 인용(원문 부분 문자열 검증), ④ 권고 근거·수신처·전화 스크립트·문자 초안(숫자 검증)
import { callTool } from '../llm.js';
import { GRADE_KO, CHANNEL_KO, isSubstring, corpusClaims, unsupportedClaims, numericClaims, internalCodes, norm } from '../util.js';

const citeTool = {
  name: 'cite_manual',
  description: '이 사건에서 당직자가 따라야 할 매뉴얼 조항을 원문 그대로 인용한다.',
  input_schema: {
    type: 'object',
    required: ['citations'],
    properties: {
      citations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['clause_id', 'quote', 'why'],
          properties: {
            clause_id: { type: 'string' },
            quote: { type: 'string', description: '조항 본문에서 글자 그대로 복사한 구절' },
            why: { type: 'string', description: '이 사건에 해당하는 이유 한 문장' },
          },
        },
      },
      none_reason: { type: 'string', description: '해당 조항이 없으면 그 이유' },
    },
  },
};

const CITE_SYSTEM = `너는 당직 매뉴얼을 찾아 주는 동료다. 주어진 매뉴얼 조항 중 이 사건에서 당직자가 지금 따라야 할 조항만 골라 cite_manual로 답한다.
quote는 조항 본문을 한 글자도 바꾸지 않고 복사한다(요약·의역 금지). 최대 3개. 해당 조항이 없으면 citations를 비우고 none_reason을 쓴다.
한 조항에 문장이 여러 개면 문장마다 이 사건에 해당하는지 따로 판단하고, 해당하는 문장은 모두 quote에 넣는다(예: 「전달한다」와 「~한 경우에는 보고한다」가 둘 다 해당하면 둘 다).
판단 근거는 주어진 신호와 기준 판정뿐이다.
why는 당직자가 읽는 문장이다. 기준·조항·연락처 id(C1, M3-1 같은 것)나 met, approaching 같은 영문 판정 코드를 쓰지 말고, 기준 이름(label)과 「도달」, 「접근」 같은 우리말로 쓴다.
why에 수위 같은 수치를 쓸 때는 기준판정의 observed(지금 값)를 쓴다. 신호에 같은 관측소의 수위가 여러 번 있으면 가장 늦은 시각의 값이 지금 값이고, 앞선 값을 지금처럼 쓰지 않는다.`;

function incidentBrief(scn, state, inc) {
  return {
    사건: inc.title,
    시설: scn.facilities.find((f) => f.id === inc.facility_id)?.name ?? '연결된 시설 없음',
    권고등급: GRADE_KO[inc.grade],
    등급근거: inc.grade_why,
    기준판정: inc.criteria.map(({ id, label, status, observed, threshold }) => ({ id, label, status, observed, threshold })),
    신호: inc.signal_ids.map((sid) => {
      const s = state.byId[sid];
      return { id: s.id, 시각: s.t, 채널: CHANNEL_KO[s.channel], 발신: s.from, 본문: s.body };
    }),
  };
}

// 문장 중간에서 잘린 인용은 그 문장 전체로 넓힌다(원문 그대로라 검증은 유지)
export function wholeSentences(quote, text) {
  const sents = text.split(/(?<=다\.)\s+/);
  const q = norm(quote);
  const hit = sents.filter((x) => norm(x).includes(q) || q.includes(norm(x)));
  if (!hit.length) {
    const i = sents.findIndex((x) => norm(x).includes(q.slice(0, 10)));
    return i >= 0 ? sents[i] : quote;
  }
  return hit.join(' ');
}

export async function cite(scn, state, inc) {
  const clauses = Object.fromEntries(scn.manual.clauses.map((c) => [c.id, c]));
  const user = JSON.stringify({ 매뉴얼: scn.manual.clauses, ...incidentBrief(scn, state, inc) }, null, 1);
  const bad = (c) => (!clauses[c.clause_id] ? '없는 조항 id' : !isSubstring(c.quote, clauses[c.clause_id].text) ? '원문과 글자가 다름' : null);
  const codeIn = (c) => internalCodes(c.why);
  const r = await callTool({
    // 관찰 등급(초안 없음)은 가벼운 모델로 조항을 찾는다. 검증(원문 부분 문자열)은 같다
    tier: inc.grade === 'observe' ? 'light' : 'main', system: CITE_SYSTEM, user, tool: citeTool,
    check: (o) => o.citations.flatMap((c, i) => [
      bad(c) && `citations[${i}](${c.clause_id}): ${bad(c)}`,
      codeIn(c).length && `citations[${i}].why에 내부 코드: ${codeIn(c).join(', ')} (기준 이름과 우리말로 쓸 것)`,
    ]).filter(Boolean),
  });
  const shown = [];
  const blocked = [];
  for (const c of r.output.citations) {
    const why = bad(c);
    if (why) blocked.push({ ...c, why_blocked: why });
    else shown.push({ ...c, quote: wholeSentences(c.quote, clauses[c.clause_id].text), heading: clauses[c.clause_id].heading, verified: true });
  }
  return { citations: shown, blocked, none_reason: shown.length ? null : r.output.none_reason ?? '해당 조항 없음', cached: r.cached, attempts: r.attempts };
}

const draftTool = {
  name: 'draft_brief',
  description: '당직자가 전화나 메신저로 연락할 때 보고 말할 전달 사항을 정리한다. 연락은 사람이 한다.',
  input_schema: {
    type: 'object',
    required: ['rationale', 'evidence_signal_ids', 'recipients', 'headline', 'facts', 'ask'],
    properties: {
      rationale: { type: 'string', description: '왜 이 권고인지 두 문장 이내' },
      evidence_signal_ids: { type: 'array', items: { type: 'string' } },
      recipients: { type: 'array', items: { type: 'string' }, description: '연락처 id' },
      headline: { type: 'string', description: '무엇이 어디서 일어났는지 한 줄. 40자 이내' },
      facts: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, description: '받은 사실을 한 줄씩(2~3줄, 한 줄 50자 안팎). 「시각 출처: 내용」 꼴, 수치는 관측 시각과 함께' },
      ask: { type: 'string', description: '받는 기관에 요청할 것 한 문장' },
    },
  },
};

const DRAFT_SYSTEM = `너는 야간 당직자의 동료다. 결정과 연락은 당직자가 하고, 너는 당직자가 전화나 메신저로 연락하면서 보고 말할 전달 사항을 짧게 정리한다. draft_brief 도구로 답한다.
- 전달 사항은 읽는 대본이 아니라 한눈에 보는 메모다. headline 한 줄, facts 두세 줄(한 줄에 사실 하나, 50자 안팎), ask 한 문장으로 쓴다. 인사말, 「당직실입니다」, 「~라고 알려 옴」 같은 군더더기는 줄이고 「13:06 사직동 주민 전화: …」처럼 시각과 출처를 앞에 둔다.
- 수치와 시각은 주어진 신호·기준 판정에 있는 것만 쓴다. 추정하거나 반올림하지 않는다. 같은 관측소 수위가 여럿이면 가장 늦은 값을 쓴다.
- 수신처는 주어진 연락처 id 중에서만 고른다. 통제 검토 요청 권고면 시설 관리주체를 반드시 넣는다.
- 출처 기관을 밝힌다(누가 언제 알려 왔는지). 단정하지 말고 받은 정보로 쓴다. 확인되지 않은 것은 확인되지 않았다고 쓴다.
- 「조치하겠습니다」처럼 당직자가 하지 않은 일을 약속하지 않는다.
- 연락처·기준·조항 id(K1, C2, M3-1 같은 것)와 met 같은 영문 판정 코드는 글에 쓰지 않는다. 기관명과 기준 이름으로 쓴다.`;

const TEXT_KEYS = ['rationale', 'headline', 'ask'];
/** 전달 사항에서 수치·시각 검증을 할 글: 근거, 한 줄 요약, 사실 줄들, 요청 */
export const briefTexts = (o) => [...TEXT_KEYS.map((k) => [k, o[k] ?? '']), ...(o.facts ?? []).map((f, i) => [`facts[${i}]`, f])];

export function evidenceCorpus(scn, state, inc, extra = []) {
  const fac = scn.facilities.find((f) => f.id === inc.facility_id);
  return corpusClaims([
    ...inc.signal_ids.map((s) => `${state.byId[s].t} ${state.byId[s].body}`),
    ...inc.criteria.map((c) => `${c.observed} ${c.threshold}`),
    ...(fac ? scn.manual.clauses.map((c) => c.text) : []),
    ...scn.gauges.map((g) => Object.values(g.levels).map((v) => `${v}m`).join(' ')),
    `${state.now}`,
    ...extra,
  ]);
}

export async function draft(scn, state, inc) {
  const fac = scn.facilities.find((f) => f.id === inc.facility_id);
  const contactIds = new Set(scn.contacts.map((c) => c.id));
  const sigIds = new Set(inc.signal_ids);
  const corpus = evidenceCorpus(scn, state, inc);
  const user = JSON.stringify({
    현재시각: state.now,
    당직실: scn.duty.office,
    시설관리주체: fac ? fac.manager_contact : null,
    연락처: scn.contacts,
    // 조항 찾기와 동시에 쓰므로 고른 인용 대신 매뉴얼 전체를 준다(인용 검증은 cite가 따로 한다)
    매뉴얼: scn.manual.clauses.map(({ heading, text }) => ({ heading, text })),
    ...incidentBrief(scn, state, inc),
  }, null, 1);
  const problemsOf = (o) => {
    const p = [];
    o.recipients.forEach((id) => !contactIds.has(id) && p.push(`recipients에 없는 연락처 id: ${id}`));
    o.evidence_signal_ids.forEach((id) => !sigIds.has(id) && p.push(`evidence_signal_ids에 이 사건에 없는 신호: ${id}`));
    if (inc.grade === 'control_review' && fac && !o.recipients.includes(fac.manager_contact)) p.push(`통제 검토 요청 권고인데 관리주체(${fac.manager_contact})가 수신처에 없음`);
    for (const [k, text] of briefTexts(o)) {
      const u = unsupportedClaims(text, corpus);
      if (u.length) p.push(`${k}에 근거 자료에 없는 수치·시각: ${u.join(', ').replace(/[TN]/g, '')}`);
      const codes = internalCodes(text);
      if (codes.length) p.push(`${k}에 내부 코드: ${codes.join(', ')} (기관명·기준 이름으로 쓸 것)`);
    }
    if ((o.headline ?? '').length > 60) p.push('headline이 너무 김');
    if ((o.facts ?? []).length > 4) p.push('facts는 4줄 이내');
    return p;
  };
  const r = await callTool({ tier: 'main', system: DRAFT_SYSTEM, user, tool: draftTool, check: problemsOf });
  const o = r.output;
  const problems = problemsOf(o);
  return {
    rationale: o.rationale,
    evidence_signal_ids: o.evidence_signal_ids.filter((id) => sigIds.has(id)),
    recipients: o.recipients.filter((id) => contactIds.has(id)),
    headline: o.headline,
    facts: (o.facts ?? []).slice(0, 4),
    ask: o.ask,
    warnings: problems,
    // 화면에 «수치·시각 N개 근거 확인»으로 보이는 값: 최종 전달 사항에서 검사한 수치·시각 토큰 수
    claims_checked: briefTexts(o).reduce((a, [, t]) => a + numericClaims(t).size, 0),
    attempts: r.attempts,
    cached: r.cached,
  };
}
