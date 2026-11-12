import { handler, loadTask, body, deviceOk } from './_lib.js';
import { grade, TENDENCY_TEXT } from '../src/grade.js';
import { recordPlay, peerStats } from '../src/record.js';
import { REASONS } from '../src/plant.js';

// 채점: 표시와 판정을 받아 코드로 채점하고, 신입의 답장·최종본·성적·같은 과제를 푼 사람들의 비율을 돌려준다.
export default handler(async (req) => {
  if (req.method !== 'POST') throw Object.assign(new Error('POST만 받습니다'), { status: 405 });
  const b = body(req);
  const task = loadTask(b.id);
  const marks = (Array.isArray(b.marks) ? b.marks : []).slice(0, 50)
    .filter((m) => typeof m?.sid === 'string')
    .map((m) => ({ sid: m.sid, reason: REASONS.includes(m.reason) ? m.reason : null }));
  const g = grade(task, marks, b.decision);
  const before = await peerStats(task);
  const { first } = await recordPlay(task, g, { deviceId: deviceOk(b.deviceId) ? b.deviceId : null, elapsedSec: Number(b.elapsedSec), marks, maker: b.maker === true });
  const peers = await peerStats(task);
  return {
    ...g, tendencyText: TENDENCY_TEXT[g.tendency], first,
    peers, peersBefore: before.firstPlays,
    source: { paragraphs: task.source.paragraphs },
    verification: task.verification,
  };
});
