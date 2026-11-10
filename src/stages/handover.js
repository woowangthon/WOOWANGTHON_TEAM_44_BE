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
권고와 당직자 결정을 구분해 쓴다. 권고 등급은 규칙표가 정한 것이므로 「AI가 권고했다」고 쓰지 않고 「~ 권고가 올라갔고 당직자가 ~를 결정했다」처럼 쓴다. 평가나 책임 판단은 하지 않는다. write_summary로 답한다.`;

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function pendingItems(state, scn) {
  const items = [];
  const org = (id) => scn?.contacts.find((c) => c.id === id)?.org ?? id;
  for (const inc of state.incidents) {
    for (const d of inc.decisions) {
      for (const c of d.contacts ?? []) if (c.status === 'pending') items.push(`사건 #${inc.no} ${inc.title}: ${org(c.id)} 회신 대기(${d.at} 연락)${c.note ? ` — ${c.note}` : ''}`);
    }
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
    lines.push(`- 최종 권고 등급(규칙표): ${GRADE_KO[inc.grade]} (${inc.grade_why.join(', ')})`);
    if (inc.criteria.length) {
      lines.push('- 통제 기준 판정:');
      inc.criteria.forEach((c) => lines.push(`  - ${c.label}: ${({ met: '도달', approaching: '접근', not_met: '미도달', unknown: '자료 없음' })[c.status]} — ${c.observed}`));
    }
    lines.push('', '| 시각 | 구분 | 내용 |', '|---|---|---|');
    for (const e of state.log.filter((x) => x.incident_id === inc.id)) {
      if (e.type === 'signal') lines.push(`| ${e.t} | 신호 ${e.signal_id} (${CHANNEL_KO[e.channel]}) | ${esc(e.text)} |`);
      if (e.type === 'grade') lines.push(`| ${e.t} | 권고 상향(규칙표) | ${esc(GRADE_KO[e.grade])} — ${esc(e.why.join(', '))} |`);
      if (e.type === 'nudge') lines.push(`| ${e.t} | 재촉(규칙) | ${esc(e.text)} |`);
      if (e.type === 'decision') {
        const who = (e.contacts ?? e.recipients.map((id) => ({ id, status: 'reached' }))).map((c) => `${contact(c.id)}(${c.status === 'pending' ? '회신 대기' : '전달함'}${c.note ? `: ${c.note}` : ''})`);
        lines.push(`| ${e.t} | **당직자 결정: ${ACTION_KO[e.action]}** | ${esc(e.reason)}${who.length ? ` → ${esc(who.join(', '))}` : ''} |`);
      }
      if (e.type === 'contact') lines.push(`| ${e.t} | 연락 결과 | ${esc(contact(e.contact_id))}: ${e.status === 'pending' ? '회신 대기' : '회신 받음'}${e.note ? `, ${esc(e.note)}` : ''} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// 이전 근무에서 인계함으로 넘겨받은 것(받은 근무자가 이어받았는지)
export function receivedLines(rc) {
  if (!rc?.items?.length) return [];
  const t = (x) => esc(String(x ?? '').slice(0, 200));
  return ['## 이전 근무에서 넘겨받은 것', `${t(rc.from)}, ${t(rc.period)}`,
    ...rc.items.slice(0, 20).map((i) => `- ${i.taken ? '이어받음' : '확인만'}: ${t(i.title)} — ${t(i.text)}`), ''];
}

// 이 세션에서 검증기가 한 일. 수는 모두 세션 상태의 실제 집계다(보고서 요약 호출은 아래 줄에 따로 적는다).
export function verificationLines(state, summaryOk) {
  const m = state.metrics;
  const n = (k) => m[k] ?? 0;
  return [
    `- AI 호출 ${n('llm_calls')}회(이 보고서 요약 제외), 검증에 걸린 AI 답 ${n('check_failures')}건 — 걸리면 사유를 붙여 한 번 다시 묻습니다`,
    `- 매뉴얼 인용: 원문과 글자 일치를 확인해 화면에 올린 인용 ${n('citations_shown')}건(갱신 포함 누적), 원문과 달라 막은 인용 ${n('citations_blocked')}건`,
    `- 신호에서 뽑은 사실: 본문 구절과 대조해 쓴 사실 ${n('facts_verified')}건, 본문에 근거가 없어 버린 사실 ${n('facts_rejected')}건`,
    `- 전달 사항: 수치·시각 ${n('draft_claims_checked')}개를 근거 신호와 대조, 근거 없는 수치·시각 경고 ${n('draft_warnings')}건`,
    `- AI 실패 ${n('ai_errors')}건(실패해도 기준 판정과 권고 등급은 규칙표 결과로 유지)`,
    `- 이 보고서 요약: ${summaryOk ? '수치·시각이 모두 기록에 있어 실음' : '검증을 통과하지 못해 싣지 않음'}`,
  ];
}

export async function handover(scn, state, { officer = '당직원', received = null } = {}) {
  const tables = handoverTables(scn, state);
  const pending = pendingItems(state, scn);
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
    ...receivedLines(received),
    '## 다음 근무자 확인 사항',
    ...(open.length ? open.map((x) => `- ${x}`) : ['- 없음']),
    '',
    '## 사건별 기록',
    tables,
    '## 사건과 무관하게 분류된 신호',
    ...(bg.length ? bg.map((x) => `- ${x}`) : ['- 없음']),
    '',
    '## AI 검증 기록',
    ...verificationLines(state, !!summary),
    ...warn.map((w) => `\n> ${w}`),
  ].join('\n');
  return { markdown: md, summary_verified: !!summary, warnings: warn };
}
