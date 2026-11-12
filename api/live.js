import { handler, body, deviceOk } from './_lib.js';
import { startJob, runStep, poolSources, LIVE_PER_DEVICE } from '../src/live.js';

// 라이브 모드(새 보고서 받기). GET: 고를 수 있는 공공 자료 목록 / POST op=start: 작업 시작 / POST op=step: 다음 단계 하나
export default handler(async (req) => {
  if (req.method === 'GET') {
    return {
      perDevice: LIVE_PER_DEVICE,
      pool: poolSources().map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, track: s.track ?? 'document', chars: s.paragraphs.reduce((a, p) => a + p.text.length, 0) })),
    };
  }
  if (req.method !== 'POST') throw Object.assign(new Error('GET·POST만 받습니다'), { status: 405 });
  const b = body(req);
  if (b.op === 'start') {
    if (!deviceOk(b.deviceId)) throw Object.assign(new Error('기기 번호가 없습니다'), { status: 400 });
    return startJob({ mode: b.mode, sourceId: b.sourceId, text: b.text, title: b.title, deviceId: b.deviceId, maker: b.maker === true });
  }
  if (b.op === 'step') return runStep(b.jobId);
  throw Object.assign(new Error('op는 start 또는 step'), { status: 400 });
});
