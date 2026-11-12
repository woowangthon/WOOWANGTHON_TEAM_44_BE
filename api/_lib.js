// API 공통: CORS, 오류 응답, 본문 읽기, 기기 ID·만든 사람 확인
export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-review-code');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
      res.status(200).json(await fn(req));
    } catch (e) {
      const status = e.status ?? e.httpStatus ?? 500;
      if (status >= 500) console.error(e);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: e.message, ...(status === 429 ? { cap: true } : {}) });
    }
  };
}
export const body = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {});
export const deviceOk = (d) => typeof d === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(d);
export const err = (m, status = 400) => Object.assign(new Error(m), { status });
/** 검수 화면 접근: 환경 변수 REVIEW_CODE와 같은 값을 머리글로 보낸다. 값이 없으면 검수 기능은 닫힌다 */
export function requireReviewer(req) {
  const code = process.env.REVIEW_CODE;
  if (!code || req.headers['x-review-code'] !== code) throw err('검수 코드가 맞지 않습니다', 403);
}
