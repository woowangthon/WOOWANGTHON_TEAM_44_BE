import { handler, getTask, body, deviceOk } from './_lib.js';
import { coachNotes } from '../src/coach.js';
import { incr } from '../src/store.js';

const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const COACH_PER_DEVICE = 20;

// AI 사수의 코칭: 결재가 끝난 뒤, 사용자가 쓴 검토 의견을 읽고 판정·조언한다(점수에는 넣지 않는다).
// rounds는 채점 때와 같은 모양이고 marks마다 note(150자까지)를 붙인다.
export default handler(async (req) => {
  if (req.method !== 'POST') throw Object.assign(new Error('POST만 받습니다'), { status: 405 });
  const b = body(req);
  const task = await getTask(b.id);
  const rounds = Array.isArray(b.rounds) ? b.rounds.slice(0, 2) : [];
  const finished = (rounds.length === 1 && rounds[0]?.decision === '승인') || rounds.length === 2;
  if (!finished) throw Object.assign(new Error('결재가 끝난 뒤에 코칭을 받을 수 있습니다'), { status: 400 });
  const sids = new Set(task.sentences.map((s) => s.sid));
  const found1 = new Set((rounds[0].marks ?? []).map((m) => m?.sid).filter((s) => task.answer.planted.some((p) => p.sid === s)));
  const notes = [];
  rounds.forEach((r, i) => {
    for (const m of Array.isArray(r?.marks) ? r.marks : []) {
      const note = typeof m?.note === 'string' ? m.note.replace(/\s+/g, ' ').trim().slice(0, 150) : '';
      if (!note || !sids.has(m.sid)) continue;
      // 2차에서 1차에 이미 고친 문장을 다시 짚은 것은 같은 문장의 두 번째 의견이므로 뺀다
      if (i === 1 && found1.has(m.sid)) continue;
      if (!notes.some((n) => n.sid === m.sid)) notes.push({ sid: m.sid, note, round: i + 1 });
    }
  });
  if (!notes.length) return { items: [], overall: '', skipped: true };
  if (deviceOk(b.deviceId)) {
    const used = await incr(`ss:coach:${kstDate()}:${b.deviceId}`, 1, 2 * 24 * 3600);
    if (used > COACH_PER_DEVICE) throw Object.assign(new Error(`코칭은 하루 ${COACH_PER_DEVICE}번까지입니다`), { status: 429 });
  }
  return coachNotes(task, notes.slice(0, 10));
});
