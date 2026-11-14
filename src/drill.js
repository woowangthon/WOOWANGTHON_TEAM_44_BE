// F4 짧은 연습(문장 드릴). 실제 판의 단위 하나를 「맞다 / 틀렸다」로 고르게 한다. 오류를 심지 않는다. 모두 순수 함수다(저장은 drillstore.js).
// 문항 = 판 하나(runId)의 단위 하나(uid). error 문항은 사람 검수 장부의 A 항목 칸에서 자동으로, ok 문항은 만든 사람이 확정한 것만 쓴다(승인 5).
// 세트는 만들 때의 장부 판(ledgerVersion)에 묶인다. 장부 새 판이 나오면 carrySet으로 자동 이어받는다.
import { rng, norm } from './text.js';
import { srcRefs } from './trace.js';
import { habitOf } from './patterns.js';

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const refsOf = (it) => [it.origin, ...(it.spread ?? [])];
const normRef = (r) => String(r ?? '').trim().replace(/^\[|\]$/g, '');
const bigr = (x) => { const t = norm(x).replace(/\s/g, ''); const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
/** 구절 a의 글자쌍 가운데 글 b에 있는 비율(lead.js coverOf와 같은 판정) */
const coverOf = (a, b) => { const A = bigr(a), B = bigr(b); let n = 0; for (const x of A) if (B.has(x)) n++; return A.size ? n / A.size : 0; };
/** 머리행·제목은 문항으로 쓰지 않는다 */
export const SKIP_UNIT = /\.(h|title)$/;
/** 한 세트에서 ok·error가 각각 이 비율 아래면 문항을 내지 않는다(답을 미루어 짐작하지 못하게) */
export const MIN_SHARE = 0.3;
export const PICK_OVERLAP = 0.7;

/** 문항 id: 정답 종류나 uid를 드러내지 않고, 장부 판이 바뀌어도 그대로다(FNV-1a 시드 해시, text.js rng) */
export const qidOf = (runId, uid) => `q-${Math.floor(rng(`${runId}|${uid}`)() * 2 ** 32).toString(16).padStart(8, '0')}`;

const unitsOf = (run) => run.stages.flatMap((s) => s.units.map((u) => ({ ...u, stage: s.key })));

/**
 * 검수 화면용 후보. audits = 감사 원문(data/ledgers/<판>.audits.json, 없으면 []).
 * 반환 { error:[{uid, stage, text, items, paras, group}], ok:[{uid, stage, text, flags, suggest}], excluded:[{uid, reason, items}] }
 */
export function drillCandidates(run, ledger, audits = [], docs = null) {
  if (!ledger || ledger.status !== 'reviewed') throw err('사람 검수가 끝나지 않은 장부로는 드릴 문항을 만들지 않습니다', 409);
  const items = ledger.items.filter((x) => !x.deleted && !x.mergedInto);
  const add = (m, k, v) => m.set(k, [...new Set([...(m.get(k) ?? []), v])]);
  const aUnits = new Map(); const other = new Map(); const cand = new Map(); const deleted = new Map();
  for (const it of items) for (const u of refsOf(it)) add(it.grade === 'A' ? aUnits : other, u, it.id);
  for (const it of items) for (const u of it.spreadCandidates ?? []) add(cand, u, it.id);
  for (const d of ledger.deleted ?? []) if (d.origin) add(deleted, d.origin, d.id);
  const paras = docs ? Object.values(docs).flatMap((d) => d.paragraphs) : [];
  const byId = new Map(items.map((x) => [x.id, x]));
  const error = []; const ok = []; const excluded = [];
  for (const u of unitsOf(run).filter((x) => !SKIP_UNIT.test(x.uid))) {
    if (aUnits.has(u.uid)) {
      const ids = aUnits.get(u.uid);
      error.push({ uid: u.uid, stage: u.stage, text: u.text, items: ids, paras: [...new Set(ids.flatMap((id) => srcRefs(byId.get(id))))], group: ids[0] });
    } else if (other.has(u.uid)) excluded.push({ uid: u.uid, reason: 'B·C 항목에만 걸린 칸(판단이 갈림)', items: other.get(u.uid) });
    else if (cand.has(u.uid)) excluded.push({ uid: u.uid, reason: '옮겨진 칸 후보(판단이 갈림)', items: cand.get(u.uid) });
    else if (deleted.has(u.uid)) excluded.push({ uid: u.uid, reason: '사람이 지운 항목의 칸(다툼이 있었음)', items: deleted.get(u.uid) });
    else {
      // 감사 표시: 어느 감사가 이 칸을 처음 생긴 곳·옮겨진 곳으로 댔고 이유가 무엇이었나
      const marks = [];
      for (const a of audits ?? []) for (const e of a.errors ?? []) {
        if (normRef(e.origin) === u.uid) marks.push({ company: a.company, as: 'origin', grade: e.grade ?? null, why: e.why ?? '' });
        else if ((e.spread ?? []).map(normRef).includes(u.uid)) marks.push({ company: a.company, as: 'spread', grade: e.grade ?? null, why: e.why ?? '' });
      }
      const suggest = paras.map((p) => ({ pid: p.pid, score: Math.round(coverOf(u.text, p.text) * 100) / 100 }))
        .sort((a, b) => b.score - a.score || a.pid.localeCompare(b.pid)).slice(0, 3);
      ok.push({ uid: u.uid, stage: u.stage, text: u.text,
        flags: { auditOrigin: [...new Set(marks.filter((m) => m.as === 'origin').map((m) => m.company))], auditSpread: [...new Set(marks.filter((m) => m.as === 'spread').map((m) => m.company))], audits: marks },
        suggest });
    }
  }
  return { ledgerVersion: ledger.version, error, ok, excluded };
}

const errorQ = (runId, e) => ({ qid: qidOf(runId, e.uid), uid: e.uid, truth: 'error', items: e.items, paras: e.paras.slice(0, 2), group: e.group });
const okQ = (runId, uid, paras) => ({ qid: qidOf(runId, uid), uid, truth: 'ok', items: [], paras, group: 'ok' });

/**
 * 만든 사람이 확정한 세트. confirm = { ok:[{uid, paras:[pid]}], skipError:[uid], skip:[{uid, reason}] }
 * error 문항은 후보 전부(skipError 제외), ok 문항은 confirm.ok만. ok 문항의 문단은 사람이 고른 1~2개
 */
export function buildSet(run, ledger, confirm, cands, docs, { version = 1, at = new Date().toISOString() } = {}) {
  const c = cands ?? drillCandidates(run, ledger, [], docs);
  const errU = new Set(c.error.map((e) => e.uid)); const okU = new Set(c.ok.map((o) => o.uid));
  const pids = docs ? new Set(Object.values(docs).flatMap((d) => d.paragraphs.map((p) => p.pid))) : null;
  const skipError = [...new Set((confirm?.skipError ?? []).map(String))];
  for (const u of skipError) if (!errU.has(u)) throw err(`틀린 문장 후보가 아닌 칸: ${u}`);
  const ok = Array.isArray(confirm?.ok) ? confirm.ok : [];
  const okSeen = new Set();
  for (const o of ok) {
    if (!okU.has(o?.uid)) throw err(`맞는 문장 후보가 아닌 칸: ${o?.uid}`);
    if (okSeen.has(o.uid)) throw err(`같은 칸이 두 번: ${o.uid}`);
    okSeen.add(o.uid);
    if (!Array.isArray(o.paras) || o.paras.length < 1 || o.paras.length > 2 || o.paras.some((p) => (pids ? !pids.has(p) : !/^[A-Z]-p\d+$/.test(p)))) throw err(`${o.uid}: 보여 줄 문단은 원자료 문단 1~2개입니다`);
  }
  const skip = (Array.isArray(confirm?.skip) ? confirm.skip : []).map((s) => ({ uid: String(s?.uid ?? ''), reason: String(s?.reason ?? '').slice(0, 200) }));
  for (const s of skip) {
    if (!okU.has(s.uid)) throw err(`맞는 문장 후보가 아닌 칸: ${s.uid}`);
    if (okSeen.has(s.uid)) throw err(`씀과 뺌을 함께 고른 칸: ${s.uid}`);
  }
  const questions = [...c.error.filter((e) => !skipError.includes(e.uid)).map((e) => errorQ(run.id, e)), ...ok.map((o) => okQ(run.id, o.uid, [...new Set(o.paras)]))]
    .sort((a, b) => a.qid.localeCompare(b.qid));
  return { version, runId: run.id, ledgerVersion: ledger.version, at, by: 'maker', carried: false, questions, skipped: skip, skipError, pending: [] };
}

/**
 * 장부 새 판으로 자동 이어받기(사람이 다시 확정하지 않아도 되게).
 *  - error 문항은 새 판의 A 항목으로 다시 만든다(앞 세트에서 뺀 skipError는 계속 뺀다)
 *  - ok 문항은 그 칸이 새 판의 어느 항목에도 없을 때만 남긴다
 *  - 장부에서 새로 빠져 ok 후보가 된 칸은 대기열(pending)로 돌린다(만든 사람이 다시 확정할 때까지 내지 않는다)
 */
export function carrySet(prev, run, newLedger, cands, { at = new Date().toISOString() } = {}) {
  const c = cands ?? drillCandidates(run, newLedger);
  const okU = new Set(c.ok.map((o) => o.uid)); const errU = new Set(c.error.map((e) => e.uid));
  const skipError = (prev.skipError ?? []).filter((u) => errU.has(u));
  const keepOk = prev.questions.filter((q) => q.truth === 'ok' && okU.has(q.uid));
  const pending = [...new Set([...(prev.pending ?? []), ...prev.questions.filter((q) => q.truth === 'error').map((q) => q.uid)])].filter((u) => okU.has(u) && !keepOk.some((q) => q.uid === u));
  const questions = [...c.error.filter((e) => !skipError.includes(e.uid)).map((e) => errorQ(run.id, e)), ...keepOk.map((q) => okQ(run.id, q.uid, q.paras))]
    .sort((a, b) => a.qid.localeCompare(b.qid));
  return { version: prev.version + 1, runId: run.id, ledgerVersion: newLedger.version, at, by: 'carry', carried: true, from: prev.version, questions, skipped: (prev.skipped ?? []).filter((s) => okU.has(s.uid)), skipError, pending };
}

/** 세트가 문항을 낼 만한가: ok·error가 각각 30% 이상 */
export function eligible(set) {
  const n = set?.questions?.length ?? 0;
  if (!n) return false;
  const ok = set.questions.filter((q) => q.truth === 'ok').length;
  return ok / n >= MIN_SHARE && (n - ok) / n >= MIN_SHARE;
}

/** 화면에 내보내는 문항. 허용 목록에 있는 필드만 만든다(금지 목록에 기대지 않는다) */
export function publicQuestion(q, run, docs) {
  const st = run.stages.find((s) => s.units.some((u) => u.uid === q.uid));
  const unit = st.units.find((u) => u.uid === q.uid);
  return {
    qid: q.qid, runId: run.id,
    stage: { key: st.key, name: st.name, inputs: [...(st.inputs ?? [])] },
    text: unit.text,
    paras: q.paras.map((pid) => {
      const d = docs?.[pid.split('-')[0]]; const p = d?.paragraphs.find((x) => x.pid === pid);
      return { pid, doc: d?.key ?? pid.split('-')[0], docTitle: d?.title ?? '', text: p?.text ?? '' };
    }),
  };
}

/**
 * 오늘의 문항. pool = 문항 배열(runId 포함). 시드 = deviceId|day라 같은 기기·같은 날엔 같은 순서다.
 * 아직 안 푼 문항(seen에 없는 qid)부터, 같은 장부 항목이 걸린 문항은 하루 하나만. 다 풀었으면 review(다시 풀기)
 */
export function pickQuestions(pool, { deviceId, day, seen = new Set(), n = 3 }) {
  const r = rng(`${deviceId}|${day}`);
  const order = [...pool].sort((a, b) => `${a.runId}|${a.qid}`.localeCompare(`${b.runId}|${b.qid}`));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const fresh = order.filter((q) => !seen.has(q.qid));
  const mode = fresh.length ? 'new' : 'review';
  const used = new Set(); const out = [];
  for (const q of fresh.length ? fresh : order) {
    if (out.length >= n) break;
    const keys = q.items.map((id) => `${q.runId}:${id}`);
    if (keys.some((k) => used.has(k))) continue;
    keys.forEach((k) => used.add(k)); out.push(q);
  }
  return { mode, questions: out, left: mode === 'new' ? fresh.length - out.length : 0 };
}

/**
 * 한 문항 채점. ans = { qid, verdict:'ok'|'error', pick?, pattern? }, ledger = 세트가 묶인 장부 판.
 * 지금 세트에 그 qid가 없으면 dropped(정답표가 바뀌어 채점에서 뺌). 응답에는 그 문항의 칸에 걸친 항목만 싣는다
 */
export function gradeDrill(set, ans, ledger) {
  const q = set?.questions.find((x) => x.qid === ans.qid);
  if (!q) return { dropped: true, ledgerVersion: set?.ledgerVersion ?? null, drillsetVersion: set?.version ?? null };
  const its = q.items.map((id) => ledger?.items.find((x) => x.id === id)).filter(Boolean);
  const pick = String(ans.pick ?? '').trim();
  const origins = its.filter((it) => it.origin === q.uid && norm(it.wrongText).length >= 2);
  const pickFeedback = q.truth !== 'error' || !pick || !origins.length ? 'none' : origins.some((it) => coverOf(pick, it.wrongText) >= PICK_OVERLAP) ? 'overlap' : 'different';
  const patternFeedback = q.truth !== 'error' || !ans.pattern ? 'none' : its.some((it) => it.pattern === ans.pattern) ? 'same' : 'different';
  return {
    dropped: false, correct: ans.verdict === q.truth, truth: q.truth, uid: q.uid, ledgerVersion: set.ledgerVersion, drillsetVersion: set.version,
    items: its.map((it) => ({ id: it.id, pattern: it.pattern, why: it.why ?? '', fix: it.fix ?? '', habit: habitOf(it), wrongText: it.wrongText ?? '', evidence: it.evidence ?? [] })),
    pickFeedback, patternFeedback,
  };
}

/** 답할 때의 세트와 지금 세트가 다르면 두 판으로 채점해 함께 낸다. ledgers = 이 판의 장부 판 전부 */
export function regradeDrill(sets, ans, ledgers) {
  const latest = sets.at(-1);
  const at = sets.find((s) => s.version === ans.drillsetVersion) ?? latest;
  const L = (v) => ledgers.find((l) => l.version === v);
  const now = gradeDrill(latest, ans, L(latest?.ledgerVersion));
  if (!at || at === latest) return { now, changed: false };
  const before = gradeDrill(at, ans, L(at.ledgerVersion));
  return { now, before, changed: now.dropped !== before.dropped || now.correct !== before.correct };
}
