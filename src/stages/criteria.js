// ③-a 기준 도달 판정과 권고 등급: 코드(규칙표)만 쓴다
import { toMin } from '../util.js';

function factsOf(state, inc) {
  return inc.signal_ids.flatMap((sid) => state.byId[sid].norm.facts.map((f) => ({ ...f, signal_id: sid, place_ids: state.byId[sid].norm.place_ids })));
}

export function evaluateCriteria(scn, state, inc) {
  const fac = scn.facilities.find((f) => f.id === inc.facility_id);
  if (!fac) return [];
  const facts = factsOf(state, inc);
  return fac.criteria.map((c) => {
    const base = { id: c.id, label: c.label, clause: c.clause };
    if (c.kind === 'inner_depth_cm') {
      const xs = facts.filter((f) => f.type === 'inner_depth' && f.facility_id === fac.id);
      if (!xs.length) return { ...base, status: 'unknown', observed: '자료 없음', threshold: `${c.threshold}cm`, evidence: [] };
      const last = xs.at(-1);
      const status = last.value >= c.threshold ? 'met' : last.value >= c.threshold / 2 ? 'approaching' : 'not_met';
      return { ...base, status, observed: `${last.value}cm (${last.at})`, threshold: `${c.threshold}cm`, evidence: [last.signal_id] };
    }
    if (c.kind === 'river_level_forecast') {
      const g = scn.gauges.find((x) => x.id === c.gauge);
      const plan = g.levels[c.level];
      const warnLv = g.levels['경보'];
      const mine = (f) => f.gauge_id === g.id || (!f.gauge_id && f.place_ids.includes(g.place_id));
      const warning = facts.filter((f) => f.type === 'flood_warning_issued' && mine(f));
      const obs = facts.filter((f) => f.type === 'level_observed' && mine(f) && typeof f.value === 'number');
      const fc = facts.filter((f) => f.type === 'level_forecast' && mine(f) && typeof f.value === 'number');
      const lastObs = obs.at(-1);
      const maxFc = fc.reduce((a, f) => (!a || f.value > a.value ? f : a), null);
      const parts = [];
      if (warning.length) parts.push('홍수경보 발령');
      if (lastObs) parts.push(`관측 ${lastObs.value}m (${lastObs.at ?? state.byId[lastObs.signal_id].t})`);
      if (maxFc) parts.push(`예상 ${maxFc.value}m${maxFc.at ? ` (${maxFc.at})` : ''}`);
      const evidence = [...warning, lastObs, maxFc].filter(Boolean).map((f) => f.signal_id);
      const reach = (lastObs && lastObs.value >= plan) || (maxFc && maxFc.value >= plan);
      const nearWarn = (lastObs && lastObs.value >= warnLv) || (maxFc && maxFc.value >= warnLv);
      let status = 'unknown';
      if (warning.length && reach) status = 'met';
      else if (reach || (warning.length && nearWarn) || warning.length) status = 'approaching';
      else if (lastObs || maxFc) status = 'not_met';
      return { ...base, status, observed: parts.join(', ') || '자료 없음', threshold: `홍수경보 + ${c.level} ${plan}m 도달 예상`, evidence: [...new Set(evidence)] };
    }
    if (c.kind === 'levee_report') {
      const xs = facts.filter((f) => f.type === 'levee_concern' && f.place_ids.includes(c.place_id));
      return { ...base, status: xs.length ? 'met' : 'unknown', observed: xs.length ? `신고 ${xs.length}건` : '신고 없음',
        threshold: '유실·월류 우려 신고 접수', evidence: [...new Set(xs.map((f) => f.signal_id))] };
    }
    return { ...base, status: 'unknown', observed: '판정 규칙 없음', threshold: '-', evidence: [] };
  });
}

// 규칙표: 기준 하나라도 met → 통제 검토 요청 권고 / 접근·홍수경보·긴급·통행 차단 요청·통행 막힘·인명 위험 → 보고 권고 / 그 외 관찰
export function gradeFor(state, inc, criteria) {
  const why = [];
  const met = criteria.filter((c) => c.status === 'met');
  if (met.length) return { grade: 'control_review', why: met.map((c) => `기준 도달: ${c.label}`) };
  criteria.filter((c) => c.status === 'approaching').forEach((c) => why.push(`기준 접근: ${c.label}`));
  const sigs = inc.signal_ids.map((s) => state.byId[s]);
  if (sigs.some((s) => s.norm.facts.some((f) => f.type === 'flood_warning_issued'))) why.push('홍수경보 통보');
  if (sigs.some((s) => s.norm.urgency === 'urgent')) why.push('긴급 신호');
  if (sigs.some((s) => s.norm.facts.some((f) => f.type === 'closure_request'))) why.push('통행 차단 요청');
  if (sigs.some((s) => s.norm.facts.some((f) => f.type === 'road_blocked'))) why.push('도로 통행 막힘');
  if (sigs.some((s) => s.norm.facts.some((f) => f.type === 'life_risk'))) why.push('인명 위험');
  if (why.length) return { grade: 'report', why };
  return { grade: 'observe', why: ['기준 미도달, 긴급 신호 없음'] };
}

export const minutesSince = (a, b) => toMin(b) - toMin(a);
