// 팀장 모드(라이브 위임). 한 요청에 한 단계만 돌린다(함수 시간 상한 300초 안에 들게). 상태는 KV에 둔다.
// 흐름: start(계획) → stage → verdict(승인/반려, 반려면 재작업 1회) … → signoff → audit(감사마다 한 요청) → 결과
// 장부는 「AI 감사(두 회사), 사람 확인 전」이다. 점수는 매기지 않고 결과 지표만 낸다.
import { getJson, setJson, incr } from './store.js';
import { loadMission, loadDocs, planOf, runStage, ctxOf, finalKeys } from './mission.js';
import { audit, buildLedger, ledgerCounts } from './audit.js';
import { WORKERS, auditorsFor, available, COMPANIES, companyOf, downCompanies } from './llm.js';
import { saveLiveRun, latestLedger, fixedRunIds, getRun } from './ledger.js';
import { baselines } from './baseline.js';
import { norm } from './text.js';
import { mergeSamePhrase } from './tidy.js';

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const TTL = 3 * 24 * 3600;
const key = (id) => `ss2:lead:${id}`;
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const LIMITS = { device: () => Number(process.env.LEAD_PER_DEVICE || 2), maker: () => Number(process.env.LEAD_PER_MAKER || 15), all: () => Number(process.env.LEAD_PER_DAY || 30) };

async function load(id) {
  if (!/^live-[a-z0-9]{6,24}$/.test(id ?? '')) throw err('잘못된 작업 id');
  const s = await getJson(key(id));
  if (!s) throw err('없거나 기한(3일)이 지난 작업', 404);
  return s;
}
const save = (s) => setJson(key(s.id), s, TTL);

/** 지시 습관 점검(코드). 점수에 넣지 않는다. 길이·말투는 보지 않는다 */
export function habits(plan) {
  const all = plan.map((s) => s.instruction).join('\n');
  const has = (re) => re.test(all);
  const laterWithSources = plan.slice(1).filter((s) => s.inputs.includes('sources')).length;
  return {
    sourcesToLater: { ok: laterWithSources > 0, n: laterWithSources, of: plan.length - 1, label: '뒤 단계에도 원자료를 넘김' },
    checkStage: { ok: plan.some((s) => s.check), label: '확인 단계를 넣음' },
    evidence: { ok: has(/근거|출처|\[[A-F]\]|문단|어디서/), label: '근거(출처) 표시를 요구함' },
    verbatim: { ok: has(/원문|그대로|표기|바꾸지/), label: '숫자·조건을 원문 표기대로 옮기라고 함' },
    date: { ok: has(/오늘|날짜|기준일|게시|올리는 날|11월\s?1[0-9]일/), label: '오늘·게시일 기준을 알려 줌' },
    unknown: { ok: has(/확인 필요|모르면|없으면|추측|지어내|없는 내용/), label: '자료에 없으면 「확인 필요」로 두라고 함' },
  };
}

export async function start({ missionId, plan, workerCompany, deviceId, maker }) {
  const mission = loadMission(missionId);
  const steps = planOf(mission, 'lead', plan);
  const used = await incr(`ss2:leadcount:${kst()}`, 0, TTL);
  if (used >= LIMITS.all()) throw err('오늘 전체 라이브 상한에 닿았습니다. 사수 모드는 계속 쓸 수 있습니다', 429);
  const mine = await incr(`ss2:leadcount:${kst()}:${deviceId}`, 1, TTL);
  if (mine > (maker ? LIMITS.maker() : LIMITS.device())) throw err(`이 기기의 오늘 라이브 횟수(${maker ? LIMITS.maker() : LIMITS.device()}번)를 다 썼습니다`, 429);
  await incr(`ss2:leadcount:${kst()}`, 1, TTL);
  const down = await downCompanies();
  const companies = COMPANIES.filter(available).filter((c) => !down.has(c)).filter((c) => auditorsFor(c, { live: true }).filter((m) => !down.has(companyOf(m))).length >= 1);
  const company = workerCompany && companies.includes(workerCompany) ? workerCompany : companies[Math.floor(Math.random() * companies.length)];
  if (!company) throw err('쓸 수 있는 작업 모델이 없습니다', 503);
  const id = `live-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const s = { id, missionId, missionVersion: mission.version, deviceId, maker: !!maker, worker: WORKERS()[company], workerCompany: company, plan: steps, cursor: 0, pending: null, stages: [], calls: 0, sourceViews: 0, startedAt: new Date().toISOString(), signoff: null, audits: [], phase: 'work' };
  await save(s);
  return view(s);
}

/** 지금 단계 실행(처음 또는 반려 뒤 재작업) */
export async function stage(id) {
  const s = await load(id);
  if (s.phase !== 'work') throw err('작업 단계가 아닙니다');
  if (s.pending?.units) throw err('이 단계 결과에 먼저 승인·반려를 해 주세요');
  const mission = loadMission(s.missionId);
  const st = { ...s.plan[s.cursor] };
  const prior = s.pending?.rejected;
  if (prior) st.feedback = { reason: prior.reason, previous: prior.units.map((u) => u.text).join('\n') };
  const [out] = await runStage(mission, loadDocs(mission), st, ctxOf(s.stages), s.worker, `${id} ${st.key}`);
  s.calls++;
  s.pending = { ...(s.pending ?? {}), attempt: prior ? 2 : 1, units: out.units, model: out.model };
  await save(s);
  return view(s);
}

export async function verdict(id, { verdict: v, reason, sourceViews }) {
  const s = await load(id);
  if (!s.pending?.units) throw err('판정할 결과가 없습니다');
  s.sourceViews += Math.max(0, Math.min(500, Number(sourceViews) || 0));
  const st = s.plan[s.cursor];
  const attempts = [...(s.pending.attempts ?? [])];
  if (v === 'reject') {
    if (s.pending.attempt >= 2) throw err('재작업은 단계마다 한 번입니다. 승인하고 다음으로 가거나, 서명 때 「확인 못 한 것」에 적어 주세요');
    const r = String(reason ?? '').trim();
    if (r.length < 4) throw err('반려 사유를 적어 주세요');
    attempts.push({ n: 1, verdict: 'reject', reason: r.slice(0, 600), units: s.pending.units });
    s.pending = { attempts, rejected: { reason: r, units: s.pending.units } };
  } else {
    attempts.push({ n: s.pending.attempt, verdict: 'ok', units: s.pending.units });
    s.stages.push({ key: st.key, name: st.name, kind: st.kind, inputs: st.inputs, instruction: st.instruction, ...(st.check ? { check: true } : {}), model: s.pending.model, attempts, units: s.pending.units });
    s.pending = null;
    s.cursor++;
    if (s.cursor >= s.plan.length) s.phase = 'sign';
  }
  await save(s);
  return view(s);
}

export async function signoff(id, { checked, unchecked, sourceViews }) {
  const s = await load(id);
  if (s.phase !== 'sign') throw err('아직 서명할 때가 아닙니다');
  s.sourceViews += Math.max(0, Math.min(500, Number(sourceViews) || 0));
  s.signoff = { checked: String(checked ?? '').slice(0, 800), unchecked: String(unchecked ?? '').slice(0, 800), at: new Date().toISOString() };
  s.phase = 'audit';
  const down = await downCompanies();
  const ok = auditorsFor(s.workerCompany, { live: true }).filter((m) => !down.has(companyOf(m)));
  s.auditors = ok.length ? ok : auditorsFor(s.workerCompany, { live: true });
  await save(s);
  return view(s);
}

/** 감사 하나를 돌린다(요청 하나에 감사 하나). 다 끝나면 장부를 만들고 결과를 낸다 */
export async function auditStep(id) {
  const s = await load(id);
  if (s.phase === 'done') return view(s);
  if (s.phase !== 'audit') throw err('서명 뒤에 감사합니다');
  const mission = loadMission(s.missionId);
  const docs = loadDocs(mission);
  const nextModel = s.auditors.find((m) => !s.audits.some((a) => a.model === m) && !(s.auditFailed ?? []).includes(m));
  if (nextModel) {
    try { s.audits.push(await audit(nextModel, mission, docs, s.stages, `${id} audit ${nextModel}`, { live: true })); }
    catch (e) { (s.auditFailed ??= []).push(nextModel); s.auditErrors = [...(s.auditErrors ?? []), `${companyOf(nextModel)}: ${failKind(e)} (${e.message.slice(0, 100)})`]; }
    await save(s);
    if (s.auditors.some((m) => !s.audits.some((a) => a.model === m) && !(s.auditFailed ?? []).includes(m))) return view(s);
  }
  if (!s.audits.length) throw err('감사가 모두 실패했습니다. 잠시 뒤 다시 눌러 주세요', 503);
  const run = { id: s.id, role: 'live', origin: 'live', missionId: s.missionId, missionVersion: s.missionVersion, style: 'lead', worker: s.worker, workerCompany: s.workerCompany, at: s.startedAt, stages: s.stages, plan: s.plan };
  const ledger = buildLedger(run, mission, docs, s.audits);
  // 다른 감사가 같은 칸의 같은 구절을 따로 올린 것이 묶기에서 빠졌으면 하나로(결과 A 목록에 같은 구절이 두 번 나오지 않게)
  mergeSamePhrase(ledger);
  const fk = finalKeys(s.stages);
  const counts = ledgerCounts(ledger, fk);
  const inFinal = (x, keys) => [x.origin, ...x.spread].some((u) => keys.includes(u.split('.')[0]));
  // 반려로 막은 A: 반려된 시도에서 나왔고, 최종 산출물 어디에도 같은 칸이 걸리지 않으며 틀린 구절도 남지 않은 것.
  // 감사가 다시 한 결과에서 같은 문장을 다시 짚지 않을 수 있어(11/13 시험에서 4건) 구절이 남았는지는 코드로 본다
  for (const it of ledger.items) {
    const fromRejected = /#\d+\./.test(it.origin);
    const inFinalUnits = [it.origin, ...it.spread].some((u) => !u.includes('#'));
    // 같은 단계를 다시 한 결과에 틀린 구절의 글자쌍이 70% 이상 남아 있으면 「비슷한 문장이 남음」(막은 것으로 세지 않는다)
    const st = s.stages.find((x) => x.key === it.origin.split('#')[0]);
    const textRemains = fromRejected && norm(it.wrongText).length >= 4 && (st?.units ?? []).some((u) => coverOf(it.wrongText, u.text) >= 0.7);
    it.fate = !fromRejected ? (inFinal(it, fk) ? 'final' : 'earlier') : inFinalUnits || textRemains ? 'remained' : 'blocked';
  }
  const blocked = ledger.items.filter((x) => x.grade === 'A' && x.fate === 'blocked').length;
  const remained = ledger.items.filter((x) => x.grade === 'A' && x.fate === 'remained').length;
  // 사람이 확인한 함정과 같은가: 같은 미션의 사람 검수 장부에서, 같은 패턴이면서 같은 원자료 문단을 근거로 든 항목
  const anchors = await humanAnchors(s.missionId);
  for (const it of ledger.items) {
    const pids = new Set((it.evidence ?? []).map((e) => e.ref).filter((r) => /^[A-F]-p/.test(r)));
    it.matchesHuman = anchors.some((a) => a.pattern === it.pattern && a.pids.some((p) => pids.has(p)));
  }
  s.result = {
    counts, blocked, remainedAfterReject: remained, humanMatchedA: ledger.items.filter((x) => x.grade === 'A' && x.matchesHuman).length,
    sourceViews: s.sourceViews, calls: s.calls + s.audits.length, minutes: Math.round((Date.now() - Date.parse(s.startedAt)) / 6e4),
    habits: habits(s.plan), baseline: await baselines(s.missionId), auditors: s.audits.map((a) => ({ model: a.model, company: a.company, sec: a.sec, count: a.errors.length })), auditErrors: s.auditErrors ?? [],
  };
  await saveLiveRun({ ...run, ledgerV1: ledger });
  s.ledger = ledger;
  s.phase = 'done';
  await save(s);
  return { ...view(s), justFinished: true };
}

async function humanAnchors(missionId) {
  const out = [];
  for (const rid of fixedRunIds()) {
    const r = await getRun(rid);
    if (r.missionId !== missionId) continue;
    const L = await latestLedger(rid, { reviewed: true });
    for (const it of L?.items ?? []) if (it.grade === 'A') out.push({ pattern: it.pattern, pids: (it.evidence ?? []).map((e) => e.ref).filter((x) => /^[A-F]-p/.test(x)) });
  }
  return out;
}

const bigr = (x) => { const t = norm(x).replace(/\s/g, ''); const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
/** 구절 a의 글자쌍 가운데 글 b에 있는 비율 */
export const coverOf = (a, b) => { const A = bigr(a), B = bigr(b); let n = 0; for (const x of A) if (B.has(x)) n++; return A.size ? n / A.size : 0; };

/** 감사 실패 종류: 시간 초과 / 출력이 길어 잘림 / 응답 실패 */
export const failKind = (e) => (/시간 초과|abort|timeout/i.test(e.message) ? '시간 초과' : /잘림|MAX_TOKENS|length/i.test(e.message) ? '출력이 길어 잘림' : '응답 실패');
/** 실제로 끝난 감사 수대로 표시한다(하나가 실패하면 그 회사와 실패 종류를 적는다) */
export function auditLabel(s) {
  const done = (s.audits ?? []).map((a) => a.company);
  const failed = (s.auditFailed ?? []).map(companyOf);
  if (s.phase !== 'done') return 'AI 감사(두 회사) · 사람 확인 전';
  const head = done.length >= 2 ? `AI 감사(${done.length}회사: ${done.join('·')})` : `AI 감사(한 회사: ${done.join('') || '없음'})`;
  const kindOf = (c) => (s.auditErrors ?? []).find((x) => x.startsWith(`${c}:`))?.split(':')[1]?.trim().split(' (')[0] || '응답 실패';
  const partial = (s.audits ?? []).filter((a) => a.partial).map((a) => `${a.company} 감사는 잘려 받은 항목만`);
  return `${head}${failed.length ? ` · ${failed.map((c) => `${c} 감사 ${kindOf(c)}`).join(' · ')}` : ''}${partial.length ? ` · ${partial.join(' · ')}` : ''} · 사람 확인 전`;
}

/** 브라우저로 보내는 상태 */
function view(s) {
  return {
    id: s.id, missionId: s.missionId, worker: s.worker, workerCompany: s.workerCompany, phase: s.phase, cursor: s.cursor,
    plan: s.plan.map(({ key, name, kind, inputs, check }) => ({ key, name, kind, inputs, check: !!check })),
    pending: s.pending ? { attempt: s.pending.attempt ?? 1, units: s.pending.units ?? null, rejected: s.pending.rejected ? { reason: s.pending.rejected.reason } : null } : null,
    stages: s.stages.map(({ key, name, kind, units, attempts }) => ({ key, name, kind, units, attempts: attempts.map((a) => ({ n: a.n, verdict: a.verdict, reason: a.reason ?? null })) })),
    signoff: s.signoff, auditors: s.auditors ?? auditorsFor(s.workerCompany, { live: true }), auditsDone: (s.audits ?? []).map((a) => ({ model: a.model, company: a.company, count: a.errors.length, sec: a.sec, ...(a.partial ? { partial: true } : {}) })), auditErrors: s.auditErrors ?? [],
    result: s.result ?? null, ledger: s.phase === 'done' ? s.ledger : null,
    label: auditLabel(s),
  };
}
export const getLead = async (id) => view(await load(id));
