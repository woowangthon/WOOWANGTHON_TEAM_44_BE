// 검수 초안 정리(코드가 알아서 하는 일). 사람에게는 「이 글이 원자료와 견줘 틀렸나요?」만 묻는다.
//  1) 두 감사가 서로 다른 문장을 짚었는데 한 항목으로 묶였으면 나눈다. 사람이 이미 답한 항목은 그때 화면에 보인 문장(항목의 처음 생긴 곳) 쪽에 답을 남기고,
//     나머지 문장은 새 질문(review pending)으로 만든다.
//  2) 같은 문장의 같은 구절을 다른 감사가 따로 올렸으면 하나로 합친다(뒤 항목을 앞 항목에 합침, 「오류 아님」으로 세지 않음).
//  3) 옮겨진 칸: 감사 둘 이상이 함께 댄 칸, 한 감사뿐이면 그 감사가 댄 칸. 사람이 직접 고친 항목은 건드리지 않는다.
// 바꾼 것은 모두 검수 이력에 action 'auto:*'로 남긴다. 여러 번 불러도 결과가 같다.
import { auditSpreadOf } from './audit.js';
import { norm } from './text.js';

const bigr = (x) => { const t = norm(x).replace(/\s/g, ''); const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
const overlap = (a, b) => { const A = bigr(a), B = bigr(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.min(A.size, B.size); };
const RANK = { A: 0, B: 1, C: 2 };
const touchedBy = (draft, id, re) => draft.reviewLog.some((l) => l.item === id && re.test(l.action) && !String(l.action).startsWith('auto:'));

export function tidyDraft(runId, draft) {
  const at = new Date().toISOString();
  const log = (item, action, before, after, note) => draft.reviewLog.push({ at, item, action: `auto:${action}`, before, after, note });
  let changed = false;
  const sp = auditSpreadOf(runId, draft);

  // 1) 나누기
  for (const it of [...draft.items]) {
    if (it.deleted || it.mergedInto) continue;
    const parts = sp[it.id]?.parts ?? [];
    const origins = [...new Set(parts.map((p) => p.origin))];
    if (origins.length < 2) continue;
    const keep = parts.filter((p) => p.origin === it.origin);
    const lead = keep[0] ?? parts[0];
    const others = parts.filter((p) => p.origin !== lead.origin);
    const before = { origin: it.origin, byAudit: Object.keys(it.byAudit ?? {}) };
    const decided = it.review !== 'pending';
    it.byAudit = Object.fromEntries(Object.entries(it.byAudit).filter(([c]) => parts.find((p) => p.company === c)?.origin === lead.origin));
    it.origin = lead.origin; it.wrongText = lead.wrongText || it.wrongText; it.why = lead.why; it.pattern = lead.pattern;
    if (lead.evidence?.length) it.evidence = lead.evidence;
    if (!decided) it.grade = keep.map((p) => p.grade).sort((x, y) => RANK[x] - RANK[y])[0] ?? lead.grade;
    it.source = Object.keys(it.byAudit).length >= 2 ? 'both' : 'one';
    if (!touchedBy(draft, it.id, /^edit:spread$/)) it.spread = lead.spread;
    log(it.id, 'split', before, { origin: it.origin, byAudit: Object.keys(it.byAudit) }, '두 감사가 서로 다른 문장을 짚어 나눔(사람의 답은 그때 보인 문장 쪽에 남김)');
    // 다른 문장마다 새 질문(같은 문장을 짚은 감사끼리 한 항목)
    const byOrigin = new Map();
    for (const p of others) byOrigin.set(p.origin, [...(byOrigin.get(p.origin) ?? []), p]);
    let n = 0;
    for (const [origin, ps] of byOrigin) {
      const id = `${it.id}${'bcdef'[n++]}`;
      if (draft.items.some((x) => x.id === id)) continue;
      const p = ps[0];
      draft.items.push({ id, origin, spread: p.spread, wrongText: p.wrongText, pattern: p.pattern, grade: ps.map((x) => x.grade).sort((x, y) => RANK[x] - RANK[y])[0],
        why: p.why, fix: '', prevent: '', evidence: p.evidence ?? [], byAudit: Object.fromEntries(ps.map((x) => [x.company, { model: x.model, origin: x.origin, grade: x.grade, pattern: x.pattern, why: x.why }])),
        source: ps.length >= 2 ? 'both' : 'one', review: 'pending', splitFrom: it.id });
      log(id, 'splitNew', null, { origin, from: it.id }, `${it.id}에 묶여 있던 다른 문장`);
    }
    changed = true;
  }

  // 2) 합치기: 같은 처음 생긴 곳, 같은 구절(글자쌍 70% 이상 겹침), 서로 다른 감사
  const live = () => draft.items.filter((x) => !x.deleted && !x.mergedInto);
  for (const b of live()) {
    if (b.source === 'human' || b.source === 'objection') continue;
    const a = live().find((x) => x !== b && draft.items.indexOf(x) < draft.items.indexOf(b) && x.origin === b.origin && x.source !== 'human'
      && Object.keys(x.byAudit ?? {}).every((c) => !(c in (b.byAudit ?? {}))) && overlap(x.wrongText, b.wrongText) >= 0.7);
    if (!a || touchedBy(draft, b.id, /^(approve|edit|delete)/)) continue;
    a.byAudit = { ...a.byAudit, ...b.byAudit };
    a.source = 'both';
    if (a.review === 'pending') a.grade = [a.grade, b.grade].sort((x, y) => RANK[x] - RANK[y])[0];
    b.mergedInto = a.id; b.review = 'merged';
    log(b.id, 'merge', null, a.id, `${a.id}와 같은 문장의 같은 구절이라 합침`);
    changed = true;
  }

  // 3) 옮겨진 칸: 감사 둘 이상이면 함께 댄 칸만
  const sp2 = auditSpreadOf(runId, draft);
  for (const it of live()) {
    const s = sp2[it.id];
    if (!s || touchedBy(draft, it.id, /^edit:spread$/)) continue;
    const sameParts = s.parts.filter((p) => p.origin === it.origin);
    if (sameParts.length < 2) continue;
    const cnt = new Map();
    for (const p of sameParts) for (const r of new Set(p.spread)) cnt.set(r, (cnt.get(r) ?? 0) + 1);
    const both = [...cnt].filter(([, k]) => k >= 2).map(([r]) => r);
    const want = both.length ? both : (it.spread ?? []);
    if (JSON.stringify([...want].sort()) !== JSON.stringify([...(it.spread ?? [])].sort())) {
      log(it.id, 'spread', it.spread, want, '옮겨진 칸을 두 감사가 함께 댄 칸으로');
      it.spread = want; changed = true;
    }
  }
  return changed;
}

/** 사람에게 남은 질문(판정 안 한 항목) */
export const openQuestions = (draft) => draft.items.filter((x) => !x.deleted && !x.mergedInto && x.review === 'pending');
