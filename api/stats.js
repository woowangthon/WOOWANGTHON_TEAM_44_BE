// GET /api/stats  공개 수치: 사용(만든 사람 제외), 이의 결과, 장부가 사람 검수에서 바뀐 정도(AI 1판 → 최신 검수 판)
import { handler } from './_lib.js';
import { publicCounts } from '../src/record.js';
import { objections, fixedRunIds, ledgerVersions } from '../src/ledger.js';
import { capLeft, spentToday } from '../src/llm.js';

export default handler(async () => {
  const obs = (await objections()).filter((o) => !o.maker);
  const ledgers = [];
  for (const id of fixedRunIds()) {
    const vs = await ledgerVersions(id);
    const v1 = vs.find((v) => v.version === 1); const rv = vs.filter((v) => v.status === 'reviewed').at(-1);
    if (!v1 || !rv) continue;
    const log = rv.reviewLog ?? [];
    const by = (re) => new Set(log.filter((l) => re.test(l.action)).map((l) => l.item)).size;
    ledgers.push({ runId: id, aiItems: v1.items.length, aiA: v1.items.filter((x) => x.grade === 'A').length, finalItems: rv.items.length, finalA: rv.items.filter((x) => x.grade === 'A').length, deleted: by(/^delete$/), gradeChanged: by(/^edit:grade$/), added: by(/^add$/), version: rv.version });
  }
  return { usage: await publicCounts(), objections: { total: obs.length, accepted: obs.filter((o) => o.status === 'accepted').length, rejected: obs.filter((o) => o.status === 'rejected').length, open: obs.filter((o) => o.status === 'open').length }, ledgers, capLeft: await capLeft(), spentToday: await spentToday() };
});
