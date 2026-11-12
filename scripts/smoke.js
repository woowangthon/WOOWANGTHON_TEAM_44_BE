// 배포(또는 로컬) 주소에서 목록 → 과제 → 채점 → 반응이 끝까지 도는지 본다. 모델은 부르지 않는다.
// 사용법: node scripts/smoke.js https://<BE 주소>   (기본 http://localhost:3001)
// 기록은 만든 사람(maker)으로 남겨 실제 사용자 집계에 섞이지 않게 한다.
const base = (process.argv[2] || 'http://localhost:3001').replace(/\/$/, '');
const device = `smoke-${Date.now().toString(36)}`;
let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '통과' : '실패'}  ${msg}`); if (!cond) fail++; };
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const post = async (p, b) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};

const list = await get('/api/tasks');
ok(list.status === 200 && list.body.tasks?.length >= 1, `과제 목록 ${list.body.tasks?.length ?? 0}개`);
const leaks = JSON.stringify(list.body).match(/"(answer|planted|correctDecision)"/);
ok(!leaks, '목록에 정답 정보 없음');

for (const row of list.body.tasks ?? []) {
  const t = await get(`/api/task?id=${row.id}`);
  const raw = JSON.stringify(t.body);
  ok(t.status === 200 && t.body.sentences?.length > 0, `${row.id}: 과제 ${t.body.sentences?.length ?? 0}문장, 원자료 ${t.body.source?.paragraphs?.length ?? 0}문단`);
  ok(!/"(answer|planted|correctDecision|verification|before|why)"/.test(raw), `${row.id}: 채점 전 응답에 정답·검증 수치 없음`);
  // 첫 문장만 표시하고 반려
  const g = await post('/api/grade', { id: row.id, marks: [{ sid: t.body.sentences[0].sid, reason: '기타' }], decision: '반려', elapsedSec: 30, deviceId: device, maker: true });
  ok(g.status === 200 && typeof g.body.score === 'number' && Array.isArray(g.body.replies) && g.body.final?.length === t.body.sentences.length,
    `${row.id}: 채점 점수 ${g.body.score}, 답장 ${g.body.replies?.length}줄, 최종본 ${g.body.final?.length}문장`);
}
const bad = await post('/api/grade', { id: list.body.tasks?.[0]?.id, marks: [], decision: '보류' });
ok(bad.status === 400, '잘못된 판정은 400');
const fb = await post('/api/feedback', { taskId: list.body.tasks?.[0]?.id, helpful: true, deviceId: device, maker: true });
ok(fb.status === 200, '반응 저장');
const st = await get('/api/stats');
ok(st.status === 200 && typeof st.body.makerPlays === 'number', `집계: 사용자 ${st.body.plays}판, 만든 사람 ${st.body.makerPlays}판`);
console.log(fail ? `실패 ${fail}건` : '모두 통과');
process.exit(fail ? 1 : 0);
