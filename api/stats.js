// GET /api/stats  공개 수치: 사용(만든 사람 제외), 이의 결과, 장부가 사람 검수에서 바뀐 정도(AI 1판 → 최신 검수 판)
import { handler } from './_lib.js';
import { publicCounts } from '../src/record.js';
import { objections, fixedRunIds, ledgerVersions, getRun } from '../src/ledger.js';
import { HABITS } from '../src/patterns.js';
import { capLeft, spentToday } from '../src/llm.js';

/** 패턴 집계와 장부 변화. 예문은 사람 검수 판에서만(최대 3개) */
export async function patternTable() {
  const ledgers = [];
  const patterns = {}; // 패턴 → { n, byCompany, byStyle, examples } (사람 검수 판 우선, 없으면 AI 판은 따로 셈)
  for (const id of fixedRunIds()) {
    const vs = await ledgerVersions(id);
    const v1 = vs.find((v) => v.version === 1); const rv = vs.filter((v) => v.status === 'reviewed').at(-1);
    const run = await getRun(id);
    const src = rv ?? vs.at(-1);
    for (const it of src?.items ?? []) {
      if (it.grade !== 'A') continue;
      const P = (patterns[it.pattern] ??= { pattern: it.pattern, habit: HABITS[it.pattern] ?? '', reviewed: 0, ai: 0, byCompany: {}, byStyle: {}, examples: [] });
      P[src.status === 'reviewed' ? 'reviewed' : 'ai']++;
      P.byCompany[run.workerCompany] = (P.byCompany[run.workerCompany] ?? 0) + 1;
      P.byStyle[run.style] = (P.byStyle[run.style] ?? 0) + 1;
      if (src.status === 'reviewed' && P.examples.length < 3) P.examples.push({ runId: id, origin: it.origin, spread: it.spread ?? [], wrongText: it.wrongText, why: it.why, prevent: it.prevent, worker: run.worker });
    }
    if (!v1 || !rv) continue;
    const log = rv.reviewLog ?? [];
    const by = (re) => new Set(log.filter((l) => re.test(l.action)).map((l) => l.item)).size;
    ledgers.push({ runId: id, aiItems: v1.items.length, aiA: v1.items.filter((x) => x.grade === 'A').length, finalItems: rv.items.length, finalA: rv.items.filter((x) => x.grade === 'A').length, split: by(/^auto:splitNew$/), merged: by(/^auto:merge$/), deleted: by(/^delete$/), gradeChanged: by(/^edit:grade$/), added: by(/^add$/), version: rv.version });
  }
  return { patterns: Object.values(patterns).sort((a, b) => b.reviewed + b.ai - a.reviewed - a.ai), ledgers };
}

export default handler(async () => {
  const all = (await objections()).filter((o) => !o.maker);
  // 사람이 건 이의와 AI 1차 판정이 자동으로 넣은 후보는 따로 센다(자동 후보는 감사 한계 수치에 넣지 않는다)
  const obs = all.filter((o) => o.source !== 'auto');
  const auto = all.filter((o) => o.source === 'auto');
  const { patterns, ledgers } = await patternTable();
  // 예문(틀린 구절·처음 생긴 칸)은 그 판의 정답이라 공개 수치에서는 빼고 수만 둔다. 결재한 기기는 /api/play patterns로 받는다
  const open = patterns.map(({ examples, ...p }) => ({ ...p, examples: [], lockedExamples: examples.length }));
  return { patterns: open, usage: await publicCounts(), objections: { total: obs.length, accepted: obs.filter((o) => o.status === 'accepted').length, rejected: obs.filter((o) => o.status === 'rejected').length, open: obs.filter((o) => o.status === 'open').length }, autoCandidates: { total: auto.length, accepted: auto.filter((o) => o.status === 'accepted').length, rejected: auto.filter((o) => o.status === 'rejected').length, open: auto.filter((o) => o.status === 'open').length }, ledgers, capLeft: await capLeft(), spentToday: await spentToday() };
});
