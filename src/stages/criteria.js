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
    if (c.kind === 'river_alert') {
      // 하천변 도로·둔치: 해당 관측소에 홍수특보가 나오거나 관측 수위가 기준 수위에 닿으면 도달
      const g = scn.gauges.find((x) => x.id === c.gauge);
      const lv = g.levels[c.level];
      const near = c.near_level ? g.levels[c.near_level] : undefined;
      const mine = (f) => f.gauge_id === g.id || (!f.gauge_id && f.place_ids.includes(g.place_id));
      const alert = facts.filter((f) => ['flood_watch_issued', 'flood_warning_issued'].includes(f.type) && mine(f));
      const obs = facts.filter((f) => f.type === 'level_observed' && mine(f) && typeof f.value === 'number');
      const lastObs = obs.at(-1);
      const parts = [];
      if (alert.length) parts.push(alert.some((f) => f.type === 'flood_warning_issued') ? '홍수경보 발령' : '홍수주의보 발령');
      if (lastObs) parts.push(`관측 ${lastObs.value}m (${lastObs.at ?? state.byId[lastObs.signal_id].t})`);
      let status = 'unknown';
      if (alert.length || (lastObs && typeof lv === 'number' && lastObs.value >= lv)) status = 'met';
      else if (lastObs && typeof near === 'number' && lastObs.value >= near) status = 'approaching';
      else if (lastObs) status = 'not_met';
      return { ...base, status, observed: parts.join(', ') || '자료 없음', threshold: `${g.name} 홍수특보 또는 ${c.level} 수위${typeof lv === 'number' ? ` ${lv}m` : ''}`,
        evidence: [...new Set([...alert, lastObs].filter(Boolean).map((f) => f.signal_id))] };
    }
    if (c.kind === 'fact_report') {
      // 지정한 장소에서 지정한 종류의 사실(물 고임, 통행 막힘 등)이 신고되면 도달
      const xs = facts.filter((f) => c.fact_types.includes(f.type) && f.place_ids.some((p) => c.place_ids.includes(p)));
      return { ...base, status: xs.length ? 'met' : 'unknown', observed: xs.length ? `신고 ${new Set(xs.map((f) => f.signal_id)).size}건` : '신고 없음',
        threshold: c.threshold_label ?? '신고 접수', evidence: [...new Set(xs.map((f) => f.signal_id))] };
    }
    if (c.kind === 'levee_report') {
      const xs = facts.filter((f) => f.type === 'levee_concern' && f.place_ids.includes(c.place_id));
      return { ...base, status: xs.length ? 'met' : 'unknown', observed: xs.length ? `신고 ${new Set(xs.map((f) => f.signal_id)).size}건` : '신고 없음',
        threshold: '유실·월류 우려 신고 접수', evidence: [...new Set(xs.map((f) => f.signal_id))] };
    }
    return { ...base, status: 'unknown', observed: '판정 규칙 없음', threshold: '-', evidence: [] };
  });
}

// 규칙표: 기준 하나라도 met → 통제 검토 요청 권고 / 접근·홍수경보·긴급·통행 차단 요청·통행 막힘·인명 위험·토사·하천 넘침 우려·화재·가스 → 보고 권고
//         / 생활 민원(상수도, 도로 시설, 가로등·신호등, 결빙·제설, 정전, 동물, 소음, 보호가 필요한 사람) → 담당 부서 전달 권고 / 그 외 관찰
export const RELAY_KO = { water_main: '상수도', road_damage: '도로 시설', streetlight: '가로등·신호등', snow_ice: '결빙·제설', outage: '정전',
  animal: '동물', noise: '소음', person: '보호가 필요한 사람' };
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
  if (sigs.some((s) => s.norm.hazard === 'landslide')) why.push('토사·축대 붕괴 신고');
  if (sigs.some((s) => s.norm.facts.some((f) => f.type === 'levee_concern'))) why.push('하천 넘침·제방 우려 신고');
  if (sigs.some((s) => s.norm.hazard === 'fire_gas')) why.push('화재·가스 신고');
  if (why.length) return { grade: 'report', why };
  // 생활 민원: 담당 부서나 관할 기관에 전달할 일
  const relay = [...new Set(sigs.map((s) => RELAY_KO[s.norm.hazard]).filter(Boolean))];
  if (relay.length) return { grade: 'relay', why: relay.map((x) => `생활 불편 신고: ${x}`) };
  return { grade: 'observe', why: ['기준 미도달, 긴급 신호 없음'] };
}

export const minutesSince = (a, b) => toMin(b) - toMin(a);
