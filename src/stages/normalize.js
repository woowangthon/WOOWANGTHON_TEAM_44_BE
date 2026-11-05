// ① 신호 정규화: 시스템 알림은 규칙, 사람이 쓴 글은 LLM(가벼운 모델) + 근거 문자열 검증
import { callTool } from '../llm.js';
import { isSubstring, norm } from '../util.js';

const HAZARDS = ['river_flood', 'levee', 'road_water', 'urban_flooding', 'underpass', 'tree_fall', 'weather', 'other'];
const FACT_TYPES = ['flood_watch_issued', 'flood_warning_issued', 'level_observed', 'level_forecast', 'levee_concern', 'closure_request', 'road_water', 'road_blocked', 'life_risk', 'other'];

const tool = {
  name: 'record_signal',
  description: '당직실에 들어온 신호 1건을 구조화해 기록한다.',
  input_schema: {
    type: 'object',
    required: ['place_ids', 'other_places', 'hazard', 'scope', 'urgency', 'asks_action', 'one_line', 'facts'],
    properties: {
      place_ids: { type: 'array', items: { type: 'string' }, description: '지명 사전에 있는 장소 id만' },
      other_places: { type: 'array', items: { type: 'string' }, description: '사전에 없는 장소 표현(본문 그대로)' },
      hazard: { type: 'string', enum: HAZARDS },
      scope: { type: 'string', enum: ['local', 'citywide'], description: '특정 장소 문제면 local, 시 전체 특보·안내면 citywide' },
      urgency: { type: 'string', enum: ['info', 'caution', 'urgent'] },
      asks_action: { type: 'boolean', description: '발신자가 시청의 조치·전달을 요청했는가' },
      one_line: { type: 'string', description: '당직자가 한눈에 볼 30자 안팎 요약' },
      facts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'evidence_span'],
          properties: {
            type: { type: 'string', enum: FACT_TYPES },
            gauge_id: { type: 'string' },
            value: { type: 'number', description: '수위(m) 등 수치. 본문에 있는 숫자만' },
            at: { type: 'string', description: 'HH:MM, 본문에 있는 시각만' },
            evidence_span: { type: 'string', description: '이 사실의 근거가 된 본문 구절을 글자 그대로' },
          },
        },
      },
    },
  },
};

const SYSTEM = `너는 지자체 야간 당직실의 신호 정리 담당이다. 들어온 신호 1건을 record_signal 도구로 구조화한다.
규칙: 본문에 없는 사실을 만들지 않는다. evidence_span은 본문을 글자 그대로 복사한다. value와 at도 본문에 적힌 것만 쓴다.
홍수주의보 발령은 flood_watch_issued, 홍수경보 발령은 flood_warning_issued, 관측 수위는 level_observed, 예상 수위는 level_forecast,
제방 유실·월류·넘침 우려는 levee_concern, 통행 차단 요청은 closure_request, 도로 물 고임은 road_water,
도로나 차선이 막힘(한 차선만 막혀도 해당)은 road_blocked, 사람이 다쳤거나 고립·대피가 필요한 인명 위험은 life_risk.`;

function aliasMatch(scn, body) {
  const b = norm(body);
  return scn.places.filter((p) => [p.name, ...p.aliases].some((a) => b.includes(norm(a)))).map((p) => p.id);
}

function ruleNormalize(scn, sig) {
  const d = sig.data;
  if (d.type === 'gauge') {
    const g = scn.gauges.find((x) => x.id === d.gauge);
    const over = Object.entries(g.levels).filter(([, v]) => d.level_m >= v).map(([k]) => k).pop();
    return {
      place_ids: [g.place_id], other_places: [], facility_ids: [], hazard: 'river_flood', scope: 'local',
      urgency: over === '계획홍수위' ? 'urgent' : over ? 'caution' : 'info', asks_action: false,
      one_line: `${g.name} ${d.level_m}m${over ? ` (${over} 이상)` : ''}`,
      facts: [{ type: 'level_observed', gauge_id: g.id, value: d.level_m, at: sig.t, evidence_span: sig.body, verified: true }],
      by: 'rule',
    };
  }
  if (d.type === 'inner_depth') {
    const f = scn.facilities.find((x) => x.id === d.facility);
    return {
      place_ids: [...f.place_ids], other_places: [], facility_ids: [f.id], hazard: 'underpass', scope: 'local',
      urgency: d.depth_cm >= (f.auto_barrier_cm ?? 15) ? 'urgent' : 'caution', asks_action: false,
      one_line: `${f.name} 내부 수위 ${d.depth_cm}cm`,
      facts: [{ type: 'inner_depth', facility_id: f.id, value: d.depth_cm, at: sig.t, evidence_span: sig.body, verified: true }],
      by: 'rule',
    };
  }
  if (d.type === 'weather_warning') {
    return {
      place_ids: [], other_places: [], facility_ids: [], hazard: 'weather', scope: 'citywide', urgency: 'info',
      asks_action: false, one_line: `${d.area} ${d.level} 유지`, facts: [], by: 'rule',
    };
  }
  return null;
}

export async function normalizeSignal(scn, sig) {
  if (sig.data) {
    const r = ruleNormalize(scn, sig);
    if (r) return { norm: r, rejected: [] };
  }
  const placeIds = new Set(scn.places.map((p) => p.id));
  const gaugeIds = new Set(scn.gauges.map((g) => g.id));
  const user = JSON.stringify({
    지명사전: scn.places.map(({ id, name, aliases }) => ({ id, name, aliases })),
    수위관측소: scn.gauges.map(({ id, name, place_id }) => ({ id, name, place_id })),
    신호: { 시각: sig.t, 채널: sig.channel, 발신: sig.from, 본문: sig.body },
  }, null, 1);
  const check = (o) => {
    const p = [];
    o.place_ids.forEach((id) => !placeIds.has(id) && p.push(`place_ids에 사전에 없는 id: ${id}`));
    o.facts.forEach((f, i) => {
      if (!isSubstring(f.evidence_span, sig.body)) p.push(`facts[${i}].evidence_span이 본문에 그대로 없음`);
      if (f.gauge_id && !gaugeIds.has(f.gauge_id)) p.push(`facts[${i}].gauge_id 없음: ${f.gauge_id}`);
    });
    return p;
  };
  const r = await callTool({ tier: 'light', system: SYSTEM, user, tool, check, maxTokens: 1200 });
  const o = r.output;
  // 재시도 뒤에도 남은 문제는 해당 사실만 버린다(근거 없는 사실이 판단에 들어가지 않게)
  const rejected = [];
  const facts = [];
  for (const f of o.facts ?? []) {
    const spanOk = isSubstring(f.evidence_span, sig.body);
    const valOk = f.value === undefined || norm(f.evidence_span).includes(String(f.value)) || norm(sig.body).includes(String(f.value));
    const atOk = f.at === undefined || numericInBody(f.at, sig.body) || f.at === sig.t;
    if (spanOk && valOk && atOk) facts.push({ ...f, verified: true });
    else rejected.push({ ...f, why: !spanOk ? 'evidence_span 불일치' : !valOk ? 'value 불일치' : 'at 불일치' });
  }
  for (const f of facts) {
    if (!f.gauge_id && ['level_observed', 'level_forecast', 'flood_watch_issued', 'flood_warning_issued'].includes(f.type)) {
      const g = scn.gauges.find((x) => (o.place_ids ?? []).includes(x.place_id));
      if (g) f.gauge_id = g.id;
    }
  }
  const ids = new Set([...(o.place_ids ?? []).filter((id) => placeIds.has(id)), ...aliasMatch(scn, sig.body)]);
  return {
    norm: {
      place_ids: [...ids], other_places: o.other_places ?? [], facility_ids: [], hazard: o.hazard, scope: o.scope,
      urgency: o.urgency, asks_action: o.asks_action, one_line: o.one_line, facts, by: 'llm',
    },
    rejected,
  };
}

function numericInBody(at, body) {
  const [h, m] = at.split(':');
  const b = norm(body);
  return b.includes(at) || b.includes(`${h}시 ${m}분`) || b.includes(`${+h}시 ${m}분`) ||
    (m === '00' && (b.includes(`${h}시`) || b.includes(`${+h}시`)));
}
