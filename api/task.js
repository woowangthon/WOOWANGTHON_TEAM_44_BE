import { handler, loadTask, publicTask } from './_lib.js';

// 과제 하나: 원자료와 결과물만. 정답과 오류 수는 싣지 않는다.
export default handler(async (req) => publicTask(loadTask(req.query?.id)));
