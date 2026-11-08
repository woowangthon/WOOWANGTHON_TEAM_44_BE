// 시나리오 엔진 + 파이프라인 오케스트레이션. 상태는 JSON 직렬화 가능(서버리스에서 주고받기 위해).
import { normalizeSignal } from './stages/normalize.js';
import { associate, anchorKeys, facilityFor } from './stages/associate.js';
import { evaluateCriteria, gradeFor } from './stages/criteria.js';
import { cite, draft } from './stages/advise.js';
import { handover } from './stages/handover.js';
import { getUsage } from './llm.js';
import { GRADE_KO, ACTION_KO, gradeRank, maxGrade, toMin } from './util.js';

const HAZARD_KO = {
  river_flood: '하천 범람 우려', levee: '제방 위험', road_water: '도로 침수', urban_flooding: '맨홀·배수 역류',
  underpass: '지하차도 침수 우려', tree_fall: '가로수 쓰러짐', weather: '기상', other: '기타',
};
const STATUS_RANK = { unknown: 0, not_met: 0, approaching: 1, met: 2 };

export function hydrate(state) {
  Object.defineProperty(state, 'byId', {
    enumerable: false, configurable: true,
    get() { return Object.fromEntries(this.signals.map((s) => [s.id, s])); },
  });
  return state;
}

export function createSession(scn) {
  return hydrate({
    scenario_id: scn.id,
    synthetic: !!scn.synthetic,
    now: scn.clock.start,
    cursor: 0,
    signals: [],
    incidents: [],
    log: [],
    next_no: 1,
    metrics: { llm_calls: 0, check_failures: 0, citations_shown: 0, citations_blocked: 0, facts_verified: 0, facts_rejected: 0, draft_claims_checked: 0, draft_warnings: 0, ai_errors: 0 },
  });
}

const log = (state, e) => state.log.push({ t: state.now, ...e });

// 이전 버전 상태(화면에 저장된 진행)에는 없는 지표가 있으므로 0부터 더한다
const bump = (state, k, n = 1) => { state.metrics[k] = (state.metrics[k] ?? 0) + n; };
const usageMark = () => { const u = getUsage(); return { calls: u.calls, retries: u.schema_retries }; };
/** 이번 요청에서 쓴 AI 호출 수와 검증에 걸린 AI 답 수(걸리면 사유를 붙여 한 번 다시 묻는다)를 상태에 더한다 */
export function addUsage(state, mark) {
  const u = getUsage();
  bump(state, 'llm_calls', u.calls - mark.calls);
  bump(state, 'check_failures', u.schema_retries - mark.retries);
}
export { usageMark };

function undecidedAt(inc) {
  const best = Math.max(-1, ...inc.decisions.filter((d) => d.action !== 'hold').map((d) => gradeRank(d.action)));
  return best < gradeRank(inc.grade);
}

async function refreshAdvice(scn, state, inc, { skipAi }) {
  if (skipAi) return;
  try {
    const c = await cite(scn, state, inc);
    inc.citations = c.citations;
    inc.citations_blocked = c.blocked;
    inc.none_reason = c.none_reason;
    state.metrics.citations_shown += c.citations.length;
    state.metrics.citations_blocked += c.blocked.length;
    if (gradeRank(inc.grade) >= 1) {
      inc.draft = await draft(scn, state, inc);
      bump(state, 'draft_warnings', inc.draft.warnings.length);
      bump(state, 'draft_claims_checked', inc.draft.claims_checked);
    }
    inc.ai_error = null;
  } catch (e) {
    inc.ai_error = e.message;
    state.metrics.ai_errors++;
  }
  inc.advice_at = state.now;
}

const isPressing = (n) => n.urgency === 'urgent' || n.asks_action || n.facts.some((f) => ['closure_request', 'life_risk'].includes(f.type));

export async function redraft(scn, state, inc) {
  hydrate(state);
  try {
    inc.draft = await draft(scn, state, inc);
    bump(state, 'draft_warnings', inc.draft.warnings.length);
    bump(state, 'draft_claims_checked', inc.draft.claims_checked);
    inc.ai_error = null;
  } catch (e) {
    inc.ai_error = e.message;
    state.metrics.ai_errors++;
  }
  inc.advice_at = state.now;
}

/** 신호 1건 처리. 시나리오 신호와 당직자가 직접 넣은 전화 메모 모두 같은 경로. */
export async function ingest(scn, state, raw, { skipAi = false } = {}) {
  hydrate(state);
  const sig = { ...raw, status: 'pending', incident_id: null };
  state.now = sig.t;
  state.signals.push(sig);
  const before = usageMark();
  try {
    const r = await normalizeSignal(scn, sig);
    sig.norm = r.norm;
    sig.facts_rejected = r.rejected;
    bump(state, 'facts_rejected', r.rejected.length);
    if (r.norm.by === 'llm') bump(state, 'facts_verified', r.norm.facts.length);
  } catch (e) {
    sig.norm = { place_ids: [], other_places: [], facility_ids: [], hazard: 'other', scope: 'local', urgency: 'caution', asks_action: false, one_line: sig.body.slice(0, 30), facts: [], by: 'fallback' };
    sig.ai_error = e.message;
    state.metrics.ai_errors++;
  }
  const a = await associate(scn, state, sig, sig.norm).catch((e) => ({ action: 'new', by: 'fallback', reason: e.message }));
  sig.link = a;

  if (a.action === 'background' || a.action === 'unrelated') {
    sig.status = 'background';
    log(state, { type: 'signal', signal_id: sig.id, channel: sig.channel, text: sig.norm.one_line, link: a });
    addUsage(state, before);
    return { signal: sig, incident: null };
  }

  let inc;
  const keys = anchorKeys(scn, sig.norm);
  if (a.action === 'attach') {
    inc = state.incidents.find((i) => i.id === a.incident_id);
    inc.keys = [...new Set([...inc.keys, ...keys])];
  } else {
    const no = state.next_no++;
    const place = scn.places.find((p) => sig.norm.place_ids.includes(p.id))?.name ?? sig.norm.other_places[0] ?? '위치 미상';
    inc = {
      id: `I${no}`, no, title: `${place} ${HAZARD_KO[sig.norm.hazard] ?? '기타'}`, keys: [...keys],
      facility_id: null, signal_ids: [], opened_at: sig.t, last_t: sig.t,
      criteria: [], grade: 'observe', grade_why: [], grade_history: [], citations: [], citations_blocked: [],
      none_reason: null, draft: null, decisions: [], nudges: [], sig_key: null,
    };
    state.incidents.push(inc);
    log(state, { type: 'incident_open', incident_id: inc.id, title: inc.title });
  }
  sig.status = 'incident';
  sig.incident_id = inc.id;
  inc.signal_ids.push(sig.id);
  inc.last_t = sig.t;
  inc.facility_id ??= facilityFor(scn, new Set(inc.keys))?.id ?? null;
  log(state, { type: 'signal', incident_id: inc.id, signal_id: sig.id, channel: sig.channel, text: sig.norm.one_line, link: a });

  const prevCriteria = inc.criteria;
  const prevGrade = inc.grade;
  inc.criteria = evaluateCriteria(scn, state, inc);
  const g = gradeFor(state, inc, inc.criteria);
  inc.grade = maxGrade(inc.grade, g.grade); // 권고는 내려가지 않는다(내리는 건 사람의 보류 결정)
  if (inc.grade === g.grade) inc.grade_why = g.why;
  const gradeUp = inc.grade !== prevGrade;
  if (gradeUp) {
    inc.grade_history.push({ grade: inc.grade, at: sig.t, signal_id: sig.id, why: inc.grade_why });
    log(state, { type: 'grade', incident_id: inc.id, grade: inc.grade, why: inc.grade_why });
  }

  // 재촉: 결정이 권고를 따라오지 못했는데 상황이 더 나빠졌을 때만
  const newlyMet = inc.criteria.filter((c) => STATUS_RANK[c.status] > STATUS_RANK[prevCriteria.find((p) => p.id === c.id)?.status ?? 'unknown']);
  // 처음 권고가 올라온 순간은 재촉하지 않는다(당직자가 아직 볼 시간이 없었으므로)
  if (gradeRank(prevGrade) >= 1 && undecidedAt(inc)) {
    const last = inc.decisions.at(-1);
    const held = !last ? '아직 결정 전입니다. '
      : last.action === 'hold' ? '보류 이후 상황이 바뀌었습니다. '
        : `${last.at} ${ACTION_KO[last.action]} 이후 상황이 바뀌었습니다. `;
    let text = null;
    if (gradeUp) text = `${held}권고가 「${GRADE_KO[inc.grade]}」로 올라갔습니다: ${inc.grade_why[0]}.`;
    else if (newlyMet.some((c) => c.status === 'met')) text = `${held}${newlyMet.find((c) => c.status === 'met').label} 기준에 도달했습니다.`;
    else if (sig.norm.urgency === 'urgent') text = `${held}${sig.norm.one_line}.`;
    if (text) {
      inc.nudges.push({ at: sig.t, text });
      log(state, { type: 'nudge', incident_id: inc.id, text });
    }
  }

  const key = `${inc.grade}|${inc.criteria.map((c) => c.status).join(',')}`;
  if (key !== inc.sig_key) {
    inc.sig_key = key;
    await refreshAdvice(scn, state, inc, { skipAi });
  } else if (!skipAi && gradeRank(inc.grade) >= 1 && undecidedAt(inc) && isPressing(sig.norm)) {
    // 등급은 그대로지만 급한 신호가 붙으면 초안만 새로 쓴다(인용은 유지)
    await redraft(scn, state, inc);
  }
  addUsage(state, before);
  return { signal: sig, incident: inc };
}

/** 재생 시계를 time까지 진행하며 그 사이 시나리오 신호를 순서대로 처리 */
export async function advanceTo(scn, state, time, opts) {
  hydrate(state);
  const out = [];
  while (state.cursor < scn.signals.length && toMin(scn.signals[state.cursor].t) <= toMin(time)) {
    const raw = scn.signals[state.cursor++];
    out.push(await ingest(scn, state, raw, opts));
  }
  if (toMin(time) > toMin(state.now)) state.now = time;
  return out;
}

export function decide(scn, state, { incident_id, action, reason, recipients = [], call_script, sms, by = '당직원', at }) {
  hydrate(state);
  const inc = state.incidents.find((i) => i.id === incident_id);
  if (!inc) throw new Error(`없는 사건: ${incident_id}`);
  if (!['report', 'control_review', 'hold'].includes(action)) throw new Error(`알 수 없는 결정: ${action}`);
  if (!reason || !reason.trim()) throw new Error('사유는 필수입니다');
  const ids = new Set(scn.contacts.map((c) => c.id));
  const bad = recipients.filter((r) => !ids.has(r));
  if (bad.length) throw new Error(`없는 수신처: ${bad.join(', ')}`);
  if (action !== 'hold' && !recipients.length) throw new Error('보고·요청은 수신처가 필요합니다');
  const d = {
    action, reason: reason.trim(), recipients, by, at: at ?? state.now,
    ai_grade_at_decision: inc.grade,
    followed_ai: action === 'hold' ? null : gradeRank(action) >= gradeRank(inc.grade),
    call_script: call_script ?? inc.draft?.call_script ?? null,
    sms: sms ?? inc.draft?.sms ?? null,
    sent: false, // 실제 발송 없음. 「보냈다고 기록」
  };
  inc.decisions.push(d);
  log(state, { type: 'decision', incident_id: inc.id, action, reason: d.reason, recipients, by, t: d.at });
  return d;
}

export async function makeHandover(scn, state, opts) {
  hydrate(state);
  const before = usageMark();
  const r = await handover(scn, state, opts);
  addUsage(state, before);
  return r;
}
