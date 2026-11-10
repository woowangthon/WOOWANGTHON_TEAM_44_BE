import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'scenarios');
const cache = new Map();

export function loadScenario(id) {
  if (!/^[a-z0-9-]+$/.test(id ?? '')) throw Object.assign(new Error('잘못된 시나리오 id'), { status: 400 });
  if (!cache.has(id)) cache.set(id, JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')));
  return cache.get(id);
}

export const listScenarios = () =>
  readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const s = loadScenario(f.replace(/\.json$/, ''));
    return { id: s.id, title: s.title, synthetic: !!s.synthetic, live: !!s.live, basis: s.basis ?? null, signals: s.signals.length, clock: s.clock };
  });

// 화면에 내려보낼 때 정답(expected)은 뺀다
export const publicScenario = ({ expected, ...rest }) => rest;

/**
 * 체험 계정 허용 기간. OPEN_ACCESS_UNTIL(YYYY-MM-DD, 한국 시각 그날 끝까지) 전에는
 * 접속 코드 없이도 AI를 부를 수 있다. 기간이 지나면 DEMO_ACCESS_CODE가 있어야 한다.
 */
export function openAccess(now = Date.now()) {
  const u = process.env.OPEN_ACCESS_UNTIL;
  if (!u || !/^\d{4}-\d{2}-\d{2}$/.test(u)) return { open: false, until: null };
  return { open: now <= Date.parse(`${u}T23:59:59+09:00`), until: u };
}

export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-demo-code');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    // 접속 코드: DEMO_ACCESS_CODE가 있으면 AI를 부르는 요청(POST)에 요구한다. 체험 기간에는 없어도 된다.
    const code = process.env.DEMO_ACCESS_CODE;
    if (code && req.method === 'POST' && req.headers?.['x-demo-code'] !== code && !openAccess().open) {
      return res.status(401).json({ error: '기관 접속 코드가 필요합니다', need_code: true });
    }
    try {
      res.status(200).json(await fn(req));
    } catch (e) {
      const cap = /상한/.test(e.message);
      res.status(e.status ?? (cap ? 429 : e.name === 'LlmError' ? 503 : 400)).json({ error: e.message, ...(cap ? { cap: true } : {}) });
    }
  };
}
