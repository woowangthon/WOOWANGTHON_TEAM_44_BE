import { handler, body, deviceOk } from './_lib.js';
import { recordFeedback } from '../src/record.js';

// 「도움이 됐나요」 한 번 누르기와 선택 한 줄(200자까지). 이름·연락처는 받지 않는다.
export default handler(async (req) => {
  if (req.method !== 'POST') throw Object.assign(new Error('POST만 받습니다'), { status: 405 });
  const b = body(req);
  if (typeof b.helpful !== 'boolean' || !/^[a-z0-9-]+$/.test(b.taskId ?? '')) throw Object.assign(new Error('잘못된 반응'), { status: 400 });
  const note = typeof b.note === 'string' ? b.note.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  await recordFeedback({ taskId: b.taskId, helpful: b.helpful, note, deviceId: deviceOk(b.deviceId) ? b.deviceId : null, maker: b.maker === true });
  return { ok: true };
});
