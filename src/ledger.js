// 작업 기록(판)과 오류 장부(판本). 고정 판은 저장소 data/runs·data/ledgers가 씨앗이고, 검수·이의로 생긴 새 판은 KV에 쌓는다.
// 1판 = AI 감사 그대로(status ai). 미영 검수를 마치면 새 판(status reviewed). 이의를 받아들이면 그다음 판.
// 채점은 reviewed 판으로만 한다(score.js가 막는다).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getJson, setJson, lpushCapped, lrange } from './store.js';

const ROOT = process.env.DATA_ROOT || process.cwd();
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const LONG = 400 * 24 * 3600;
export const idOk = (id) => /^[a-z0-9][a-z0-9.-]{3,80}$/.test(id ?? '');

const runCache = new Map();
/** 고정 판(파일) 또는 라이브 판(KV) */
export async function getRun(id) {
  if (!idOk(id)) throw err('잘못된 판 id');
  if (id.startsWith('live-')) {
    const r = await getJson(`ss2:run:${id}`);
    if (!r) throw err('없는 판', 404);
    return r;
  }
  if (!runCache.has(id)) {
    const f = join(ROOT, 'data', 'runs', `${id}.json`);
    if (!existsSync(f)) throw err('없는 판', 404);
    runCache.set(id, JSON.parse(readFileSync(f, 'utf8')));
  }
  return runCache.get(id);
}
export const fixedRunIds = () => (existsSync(join(ROOT, 'data', 'runs')) ? readdirSync(join(ROOT, 'data', 'runs')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);
export const saveLiveRun = (run) => setJson(`ss2:run:${run.id}`, run, 30 * 24 * 3600);

/** 저장소에 있는 장부 판들 */
function fileLedgers(runId) {
  const dir = join(ROOT, 'data', 'ledgers');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(`${runId}.v`) && f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/** 이 판의 장부 판 전부(오래된 것부터). 파일 판과 KV 판을 합치고 같은 번호는 KV가 이긴다 */
export async function ledgerVersions(runId) {
  const kv = (await getJson(`ss2:ledger:${runId}`)) ?? [];
  const byV = new Map(fileLedgers(runId).map((l) => [l.version, l]));
  for (const l of kv) byV.set(l.version, l);
  return [...byV.values()].sort((a, b) => a.version - b.version);
}
export async function latestLedger(runId, { reviewed = false } = {}) {
  const vs = await ledgerVersions(runId);
  const pick = reviewed ? vs.filter((l) => l.status === 'reviewed') : vs;
  return pick.at(-1) ?? null;
}
export async function ledgerVersion(runId, v) {
  return (await ledgerVersions(runId)).find((l) => l.version === v) ?? null;
}

/** 새 판 저장(앞 판을 바탕으로). KV에만 쓴다. 저장소에는 scripts/export-ledgers.js로 내보낸다 */
export async function saveLedgerVersion(runId, ledger) {
  const kv = (await getJson(`ss2:ledger:${runId}`)) ?? [];
  const all = await ledgerVersions(runId);
  const version = (all.at(-1)?.version ?? 0) + 1;
  const next = { ...ledger, runId, version, parent: all.at(-1)?.version ?? null, at: new Date().toISOString() };
  kv.push(next);
  await setJson(`ss2:ledger:${runId}`, kv, LONG);
  await lpushCapped('ss2:ledger:changes', { runId, version, status: next.status, at: next.at });
  return next;
}

/** 검수 초안(장부 다음 판을 만들기 전 작업 상태). 검수 화면이 항목마다 고친 것을 쌓는다 */
export const getDraft = (runId) => getJson(`ss2:draft:${runId}`);
export const setDraft = (runId, d) => setJson(`ss2:draft:${runId}`, d, LONG);

/** 검수 동작 하나를 초안에 적용한다. 이력(언제·무엇을·전→후·왜)을 남긴다 */
export function applyReview(draft, op) {
  const at = new Date().toISOString();
  const log = (item, action, before, after, note) => draft.reviewLog.push({ at, item, action, before, after, note: String(note ?? '').slice(0, 300) });
  if (op.action === 'add') {
    const id = op.split && op.splitFrom && !draft.items.some((x) => x.id === `${op.splitFrom}b`) ? `${op.splitFrom}b` : `H${draft.items.filter((x) => x.id.startsWith('H')).length + 1}`;
    const it = {
      id, origin: op.origin, spread: op.spread ?? [], wrongText: op.wrongText ?? '', pattern: op.pattern, grade: op.grade,
      why: op.why ?? '', fix: op.fix ?? '', prevent: op.prevent ?? '', evidence: op.evidence ?? [],
      // split: 두 감사가 다른 문장을 짚어 묶인 항목에서 떼어 낸 것(감사가 찾은 오류라 「사람이 추가」로 세지 않는다)
      byAudit: op.split ? (op.byAudit ?? {}) : {}, source: op.fromObjection ? 'objection' : op.split ? 'one' : 'human',
      review: op.split ? 'edited' : 'added', originConfirmed: !!op.originConfirmed,
    };
    if (!it.origin || !['A', 'B', 'C'].includes(it.grade)) throw err('추가할 항목에 근원 단위와 등급이 필요합니다');
    draft.items.push(it);
    log(id, op.split ? 'split' : 'add', null, { origin: it.origin, grade: it.grade, pattern: it.pattern }, op.note);
    return it;
  }
  const it = draft.items.find((x) => x.id === op.item);
  if (!it) throw err('없는 항목');
  if (op.action === 'approve') { log(it.id, 'approve', it.review, 'approved', op.note); it.review = it.review === 'edited' ? 'edited' : 'approved'; it.deleted = false; }
  else if (op.action === 'delete') { log(it.id, 'delete', it.review, 'deleted', op.note); it.deleted = true; it.review = 'deleted'; }
  else if (op.action === 'edit') {
    // byAudit·source·evidence: 두 감사가 다른 문장을 짚어 묶인 항목을 나눌 때, 남는 쪽 감사 기록만 두려고 고친다
    const fields = ['grade', 'pattern', 'origin', 'spread', 'why', 'fix', 'prevent', 'wrongText', 'habit', 'byAudit', 'source', 'evidence'];
    for (const f of fields) if (op[f] !== undefined && JSON.stringify(op[f]) !== JSON.stringify(it[f])) { log(it.id, `edit:${f}`, it[f], op[f], op.note); it[f] = op[f]; }
    it.review = 'edited'; it.deleted = false;
  } else if (op.action === 'confirmOrigin') { log(it.id, 'confirmOrigin', !!it.originConfirmed, !!op.value, op.note); it.originConfirmed = !!op.value; }
  else throw err('모르는 검수 동작');
  return it;
}

/** 초안 → 확정(다음 판, reviewed). 아직 판정하지 않은 항목이 있으면 막는다 */
export async function finalizeDraft(runId, draft, { reason = '사람 검수' } = {}) {
  const pending = draft.items.filter((x) => x.review === 'pending' && x.grade);
  if (pending.length) throw err(`판정하지 않은 항목 ${pending.length}개: ${pending.map((x) => x.id).join(', ')}`);
  // 처음 생긴 곳: 사람이 따로 정하지 않은 항목은, 감사 둘 이상이 같은 칸을 처음 생긴 곳으로 댔으면 자동으로 확정한다(근원 가점에 씀)
  for (const it of draft.items.filter((x) => !x.deleted)) {
    if (draft.reviewLog.some((l) => l.item === it.id && l.action === 'confirmOrigin')) continue;
    const origins = Object.values(it.byAudit ?? {}).map((b) => b.origin);
    if (!it.originConfirmed && origins.length >= 2 && origins.every((o) => o === it.origin)) {
      it.originConfirmed = true;
      draft.reviewLog.push({ at: new Date().toISOString(), item: it.id, action: 'autoConfirmOrigin', before: false, after: true, note: '감사 둘 이상이 같은 칸을 처음 생긴 곳으로 댐' });
    }
  }
  const items = draft.items.filter((x) => !x.deleted);
  const deleted = draft.items.filter((x) => x.deleted).map((x) => ({ id: x.id, origin: x.origin, why: draft.reviewLog.filter((l) => l.item === x.id && l.action === 'delete').at(-1)?.note ?? '' }));
  const saved = await saveLedgerVersion(runId, { ...draft, status: 'reviewed', reason, items, deleted: [...(draft.deleted ?? []), ...deleted], codeOnly: draft.codeOnly ?? [] });
  await setJson(`ss2:draft:${runId}`, null, 60);
  return saved;
}

// ---------------- 이의 제기 ----------------
/** { runId, ledgerVersion, deviceId, kind: 'missing'|'notError', uid, item?, evidence:[pid], reason } */
export async function addObjection(o) {
  const id = `ob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const rec = { id, at: new Date().toISOString(), status: 'open', ...o };
  await lpushCapped('ss2:objections', rec, 2000);
  return rec;
}
export async function objections() {
  const all = await lrange('ss2:objections', 0, -1);
  const decided = (await getJson('ss2:objections:decided')) ?? {};
  return all.map((o) => ({ ...o, ...(decided[o.id] ?? {}) }));
}
export async function decideObjection(id, decision) {
  const decided = (await getJson('ss2:objections:decided')) ?? {};
  decided[id] = { status: decision.accept ? 'accepted' : 'rejected', decidedAt: new Date().toISOString(), decisionNote: String(decision.note ?? '').slice(0, 300), newVersion: decision.newVersion ?? null };
  await setJson('ss2:objections:decided', decided, LONG);
  return decided[id];
}
