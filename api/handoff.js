// 당직실 인계함
// GET  /api/handoff?practice=1&client=…  또는 ?office=청주시청 당직실   → { latest, earlier, store }
// POST /api/handoff { op: 'take', id, item, practice?, client?, office? }  항목 이어받기
// POST /api/handoff { op: 'receive', id, … }                              받았다고 표시
// 넘기기는 /api/session의 op 'handoff'(상태와 시나리오가 있어야 미결 항목을 코드로 뽑는다)
import { handler } from './_lib.js';
import { boxFor, inbox, markHandoff } from '../src/handoff.js';
import { storeKind } from '../src/store.js';

export default handler(async (req) => {
  const q = req.method === 'GET' ? req.query : (req.body ?? {});
  const box = boxFor({ practice: q.practice === '1' || q.practice === true, client: q.client, office: q.office || '청주시청 당직실' });
  if (req.method === 'GET') return { ...(await inbox(box)), store: storeKind() };
  if (req.method !== 'POST') throw Object.assign(new Error('GET, POST만 지원'), { status: 405 });
  if (q.op === 'take') return { handoff: await markHandoff(box, { id: q.id, take: q.item }) };
  if (q.op === 'receive') return { handoff: await markHandoff(box, { id: q.id, receive: true }) };
  throw new Error(`알 수 없는 op: ${q.op}`);
});
