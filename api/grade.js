import { handler, getTask, body, deviceOk } from './_lib.js';
import { gradeRounds, interim, TENDENCY_TEXT } from '../src/grade.js';
import { recordPlay, peerStats } from '../src/record.js';
import { REASONS } from '../src/plant.js';

const cleanMarks = (marks) => (Array.isArray(marks) ? marks : []).slice(0, 50)
  .filter((m) => typeof m?.sid === 'string')
  .map((m) => ({ sid: m.sid, reason: REASONS.includes(m.reason) ? m.reason : null }));

// 채점. 결재는 두 번까지 간다(src/grade.js).
//  rounds 1개 + 반려 → 신입의 중간 답과 수정본(기록하지 않는다. 남은 오류 수는 싣지 않는다)
//  rounds 1개 + 승인, 또는 rounds 2개 → 최종 채점, 기록, 같은 과제를 푼 사람들의 비율
// 예전 형식 { marks, decision }도 받는다(한 번 결재).
export default handler(async (req) => {
  if (req.method !== 'POST') throw Object.assign(new Error('POST만 받습니다'), { status: 405 });
  const b = body(req);
  const task = await getTask(b.id);
  const rounds = (Array.isArray(b.rounds) ? b.rounds : [{ marks: b.marks, decision: b.decision }])
    .slice(0, 2).map((r) => ({ marks: cleanMarks(r?.marks), decision: r?.decision }));
  if (rounds.length === 1 && rounds[0].decision === '반려' && b.final !== true) return interim(task, rounds[0].marks);
  const g = gradeRounds(task, rounds);
  const before = await peerStats(task);
  const allMarks = [...rounds[0].marks, ...(rounds[1]?.marks ?? [])];
  const { first } = await recordPlay(task, g, { deviceId: deviceOk(b.deviceId) ? b.deviceId : null, elapsedSec: Number(b.elapsedSec), marks: allMarks, maker: b.maker === true });
  const peers = await peerStats(task);
  return {
    ...g, tendencyText: TENDENCY_TEXT[g.tendency], first,
    peers, peersBefore: before.firstPlays,
    source: { paragraphs: task.source.paragraphs },
    verification: task.verification, origin: task.origin, liveLog: task.liveLog ?? null,
  };
});
