// ⑤ 인계 보고서: 표·타임라인은 코드, 요약 한 단락만 LLM(수치·시각 검증)
import { callTool } from '../llm.js';
import { GRADE_KO, ACTION_KO, CHANNEL_KO, corpusClaims, unsupportedClaims, gradeRank } from '../util.js';

const tool = {
  name: 'write_summary',
  description: '아침 인계용 요약 한 단락을 쓴다.',
  input_schema: {
    type: 'object',
    required: ['summary', 'open_items'],
    properties: {
      summary: { type: 'string', description: '4문장 이내. 무엇이 있었고 당직자가 언제 무엇을 결정했는지' },
      open_items: { type: 'array', items: { type: 'string' }, description: '아침 담당자가 이어서 확인할 것' },
    },
  },
};

const SYSTEM = `너는 야간 당직 인계 보고서의 요약을 쓴다. 주어진 결정 로그에 있는 사실·시각·수치만 쓴다.
AI 권고와 당직자 결정을 구분해 쓴다(「AI가 권고했고 당직자가 결정했다」). 평가나 책임 판단은 하지 않는다. write_summary로 답한다.`;

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function pendingItems(state) {
  const items = [];
  for (const inc of state.incidents) {
    const last = inc.decisions.at(-1);
    if (gradeRank(inc.grade) >= 1 && !last) items.push(`사건 #${inc.no} ${inc.title}: ${GRADE_KO[inc.grade]} 상태에서 결정 없음`);
    else if (last?.action === 'hold') items.push(`사건 #${inc.no} ${inc.title}: ${last.at} 보류 — ${last.reason}`);
    else if (last && gradeRank(inc.grade) > gradeRank(last.action)) items.push(`사건 #${inc.no} ${inc.title}: 마지막 결정(${ACTION_KO[last.action]}) 뒤 ${GRADE_KO[inc.grade]}로 올라감`);
  }
  return items;
}

export function handoverTables(scn, state) {
  const lines = [];
  const contact = (id) => scn.contacts.find((c) => c.id === id)?.org ?? id;
  for (const inc of state.incidents) {
    lines.push(`### 사건 #${inc.no} ${inc.title}`);
    const fac = scn.facilities.find((f) => f.id === inc.facility_id);
    lines.push(`- 시설: ${fac ? `${fac.name} (관리주체: ${contact(fac.manager_contact)})` : '없음'}`);
    lines.push(`- 최종 AI 권고: ${GRADE_KO[inc.grade]} (${inc.grade_why.join(', ')})`);
    if (inc.criteria.length) {
      lines.push('- 통제 기준 판정:');
      inc.criteria.forEach((c) => lines.push(`  - ${c.label}: ${({ met: '도달', approaching: '접근', not_met: '미도달', unknown: '자료 없음' })[c.status]} — ${c.observed}`));
    }
    lines.push('', '| 시각 | 구분 | 내용 |', '|---|---|---|');
    for (const e of state.log.filter((x) => x.incident_id === inc.id)) {
      if (e.type === 'signal') lines.push(`| ${e.t} | 신호 ${e.signal_id} (${CHANNEL_KO[e.channel]}) | ${esc(e.text)} |`);
      if (e.type === 'grade') lines.push(`| ${e.t} | AI 권고 | ${esc(GRADE_KO[e.grade])} — ${esc(e.why.join(', '))} |`);
      if (e.type === 'nudge') lines.push(`| ${e.t} | AI 재촉 | ${esc(e.text)} |`);
      if (e.type === 'decision') lines.push(`| ${e.t} | **당직자 결정: ${ACTION_KO[e.action]}** | ${esc(e.reason)}${e.recipients.length ? ` → ${e.recipients.map(contact).join(', ')}` : ''} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function handover(scn, state, { officer = '당직원' } = {}) {
  const tables = handoverTables(scn, state);
  const pending = pendingItems(state);
  const bg = state.signals.filter((s) => s.status === 'background').map((s) => `${s.t} ${s.norm.one_line}`);
  const corpus = corpusClaims([tables, ...pending, ...bg, ...state.signals.map((s) => `${s.t} ${s.body}`)]);
  const user = JSON.stringify({ 당직실: scn.duty.office, 결정로그: tables, 미결: pending, 배경신호: bg }, null, 1);
  let summary;
  let open = pending;
  let warn = [];
  try {
    const r = await callTool({
      tier: 'main', system: SYSTEM, user, tool,
      check: (o) => {
        const u = [o.summary, ...o.open_items].flatMap((t) => unsupportedClaims(t, corpus));
        return u.length ? [`로그에 없는 수치·시각: ${u.join(', ').replace(/[TN]/g, '')}`] : [];
      },
    });
    const u = [r.output.summary, ...r.output.open_items].flatMap((t) => unsupportedClaims(t, corpus));
    if (u.length) warn = [`요약 검증 실패로 AI 요약을 싣지 않음: ${u.join(', ')}`];
    else {
      summary = r.output.summary;
      open = r.output.open_items.length ? r.output.open_items : pending;
    }
  } catch (e) {
    warn = [`AI 요약 실패: ${e.message}`];
  }
  const md = [
    `# 야간 당직 인계 보고서 — ${scn.duty.office}`,
    '',
    `${scn.clock.date} ${scn.clock.start}~${state.now} · 작성: ${officer} · AI 동료 초안, 결정은 당직자`,
    scn.synthetic ? `\n> 재생 모드 · 합성 신호. ${scn.disclaimer}` : '',
    '',
    '## 요약',
    summary ?? '(AI 요약 없음 — 아래 기록을 확인하세요)',
    '',
    '## 아침 담당자 확인 사항',
    ...(open.length ? open.map((x) => `- ${x}`) : ['- 없음']),
    '',
    '## 사건별 기록',
    tables,
    '## 사건과 무관하게 분류된 신호',
    ...(bg.length ? bg.map((x) => `- ${x}`) : ['- 없음']),
    '',
    `AI 호출 ${state.metrics.llm_calls}회 · 화면에 올린 인용 ${state.metrics.citations_shown}건(원문 일치 검증) · 검증기가 막은 인용 ${state.metrics.citations_blocked}건`,
    ...warn.map((w) => `\n> ${w}`),
  ].join('\n');
  return { markdown: md, summary_verified: !!summary, warnings: warn };
}
