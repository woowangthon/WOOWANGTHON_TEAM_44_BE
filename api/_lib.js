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
    return { id: s.id, title: s.title, synthetic: s.synthetic };
  });

// 화면에 내려보낼 때 정답(expected)은 뺀다
export const publicScenario = ({ expected, ...rest }) => rest;

export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-demo-code');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    // 시연 코드(선택): DEMO_ACCESS_CODE가 있으면 AI를 부르는 요청에만 요구한다
    const code = process.env.DEMO_ACCESS_CODE;
    if (code && req.method === 'POST' && req.headers?.['x-demo-code'] !== code) {
      return res.status(401).json({ error: '시연 코드가 필요합니다', need_code: true });
    }
    try {
      res.status(200).json(await fn(req));
    } catch (e) {
      res.status(e.status ?? (e.name === 'LlmError' ? 503 : 400)).json({ error: e.message });
    }
  };
}
