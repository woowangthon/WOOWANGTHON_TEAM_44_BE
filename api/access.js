// GET /api/access → { open, until, code_required }  로그인 화면이 체험 계정 버튼을 보일지 정한다
// POST /api/access { code } → 코드가 맞으면 { ok: true }, 틀리면 401
import { handler, openAccess } from './_lib.js';

export default handler(async (req) => {
  const code = process.env.DEMO_ACCESS_CODE;
  if (req.method === 'GET') return { ...openAccess(), code_required: !!code };
  if (req.method !== 'POST') throw Object.assign(new Error('GET, POST만 지원'), { status: 405 });
  if (code && req.body?.code !== code) throw Object.assign(new Error('접속 코드가 맞지 않습니다'), { status: 401 });
  return { ok: true };
});
