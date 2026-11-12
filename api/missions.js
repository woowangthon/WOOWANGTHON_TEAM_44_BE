// GET /api/missions            미션과 고정 판 목록(정답 없이)
// GET /api/missions?run=<id>   판 하나(원자료·단계별 산출물). 장부 내용은 싣지 않고 상태만
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handler, err } from './_lib.js';
import { allMissions, loadMission, loadDocs } from '../src/mission.js';
import { getRun, latestLedger, fixedRunIds } from '../src/ledger.js';
import { baselines } from '../src/baseline.js';

const fixedList = () => {
  const f = join(process.cwd(), 'data', 'fixed.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
};

async function runMeta(runId) {
  const r = await getRun(runId);
  const reviewed = await latestLedger(runId, { reviewed: true });
  const any = await latestLedger(runId);
  const same = fixedRunIds().length ? (await Promise.all(fixedRunIds().map(getRun))).filter((x) => x.missionId === r.missionId && x.style === r.style) : [];
  return { runId, missionId: r.missionId, worker: r.worker, company: r.workerCompany, at: r.at, style: r.style, of: same.length,
    ledger: reviewed ? { status: 'reviewed', version: reviewed.version, at: reviewed.at } : any ? { status: 'ai', version: any.version } : { status: 'none' }, playable: !!reviewed };
}

export default handler(async (req) => {
  const runId = req.query?.run;
  if (runId) {
    const r = await getRun(runId);
    if (r.origin === 'live') throw err('라이브 판은 팀장 모드에서 엽니다', 404);
    const m = loadMission(r.missionId);
    return {
      meta: await runMeta(runId),
      mission: { id: m.id, title: m.title, brief: m.brief, today: m.today, postDateISO: m.postDateISO },
      docs: loadDocs(m),
      stages: r.stages.map(({ key, name, kind, inputs, instruction, units, together }) => ({ key, name, kind, inputs, instruction, units, together: !!together })),
    };
  }
  const fixed = fixedList();
  return {
    missions: await Promise.all(allMissions().map(async (m) => ({
      id: m.id, title: m.title, brief: m.brief, today: m.today, sources: Object.keys(m.sources).length, stages: m.stages.map((s) => ({ key: s.key, name: s.name, kind: s.kind, inputs: s.inputs })),
      fixed: await Promise.all(fixed.filter((f) => f.missionId === m.id).map((f) => runMeta(f.runId))),
      baseline: await baselines(m.id),
    }))),
  };
});
