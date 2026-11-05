// ② 사건 결합: 장소·시설이 겹치면 규칙으로 결합, 후보가 없거나 둘 이상이면 LLM
import { callTool } from '../llm.js';
import { toMin } from '../util.js';

const WINDOW_MIN = 180;

// 신호의 장소 키 + 그 장소에 걸린 시설의 장소·인접 하천까지 확장
export function anchorKeys(scn, n) {
  const keys = new Set([...n.place_ids, ...n.other_places.map((s) => `txt:${s}`)]);
  for (const f of scn.facilities) {
    const fk = [...f.place_ids, ...(f.near ?? []).map((x) => x.place_id)];
    if (n.facility_ids.includes(f.id) || fk.some((k) => keys.has(k))) fk.forEach((k) => keys.add(k));
  }
  return keys;
}

export function facilityFor(scn, keys) {
  return scn.facilities.find((f) => [...f.place_ids, ...(f.near ?? []).map((x) => x.place_id)].some((k) => keys.has(k)));
}

const tool = {
  name: 'link_signal',
  description: '새 신호를 열린 사건에 붙일지, 새 사건으로 열지, 무관으로 둘지 정한다.',
  input_schema: {
    type: 'object',
    required: ['action', 'reason'],
    properties: {
      action: { type: 'string', enum: ['attach', 'new', 'unrelated'] },
      incident_id: { type: 'string', description: 'attach일 때 붙일 사건 id' },
      reason: { type: 'string', description: '한 문장' },
    },
  },
};

const SYSTEM = `너는 야간 당직실에서 흩어진 신호를 같은 사건으로 묶는 담당이다.
같은 장소·같은 위험(같은 하천의 범람, 같은 시설)이면 attach, 다른 장소의 별개 문제면 new, 시 전체 안내처럼 특정 사건이 아니면 unrelated.
확실하지 않으면 과하게 묶지 말고 new를 고른다. link_signal 도구로 답한다.`;

export async function associate(scn, state, sig, n) {
  if (n.scope === 'citywide' && !n.place_ids.length && !n.other_places.length) {
    return { action: 'background', by: 'rule', reason: '시 전체 대상 안내·특보' };
  }
  const keys = anchorKeys(scn, n);
  const open = state.incidents.filter((i) => toMin(sig.t) - toMin(i.last_t) <= WINDOW_MIN);
  const hits = open.filter((i) => i.keys.some((k) => keys.has(k)));
  if (hits.length === 1) return { action: 'attach', incident_id: hits[0].id, by: 'rule', reason: '같은 장소·시설' };
  if (hits.length === 0 && n.place_ids.length) return { action: 'new', by: 'rule', reason: '열린 사건과 겹치는 장소 없음' };
  if (!open.length) return { action: 'new', by: 'rule', reason: '열린 사건 없음' };

  const cands = (hits.length ? hits : open).map((i) => ({ id: i.id, 제목: i.title, 신호요약: i.signal_ids.map((s) => state.byId[s].norm.one_line) }));
  const ids = new Set(cands.map((c) => c.id));
  const user = JSON.stringify({ 새신호: { 시각: sig.t, 발신: sig.from, 본문: sig.body, 요약: n.one_line }, 열린사건: cands }, null, 1);
  const r = await callTool({
    tier: 'main', system: SYSTEM, user, tool, maxTokens: 400,
    check: (o) => (o.action === 'attach' && !ids.has(o.incident_id) ? [`incident_id는 ${[...ids].join(', ')} 중 하나`] : []),
  });
  const o = r.output;
  if (o.action === 'attach' && !ids.has(o.incident_id)) return { action: 'new', by: 'rule', reason: 'AI 결합 결과 검증 실패로 새 사건' };
  return { ...o, by: 'llm' };
}
