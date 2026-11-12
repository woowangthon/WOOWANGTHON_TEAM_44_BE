import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.TASKS_DIR || join(process.cwd(), 'data', 'tasks');
const cache = new Map();

export function loadTask(id) {
  if (!/^[a-z0-9-]+$/.test(id ?? '')) throw Object.assign(new Error('잘못된 과제 id'), { status: 400 });
  if (!cache.has(id)) {
    try { cache.set(id, JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'))); }
    catch { throw Object.assign(new Error('없는 과제'), { status: 404 }); }
  }
  return cache.get(id);
}

export const allTasks = () => readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => loadTask(f.replace(/\.json$/, '')));

/** 과제 배지. 사전 생성 과제와 방금 만든 과제를 구분한다 */
export const badgeOf = (t) =>
  t.origin === 'live' ? '방금 만든 과제 · 자동 검증만' : t.verification?.humanChecked ? '사전 생성 · 검증 · 사람 확인' : '사전 생성 · 자동 검증';

/**
 * 브라우저로 보내는 과제. 정답(answer)과, 오류 수를 드러내는 검증 수치(verification)는 싣지 않는다.
 * 채점 응답(/api/grade)에서만 나간다.
 */
export function publicTask(t) {
  return {
    id: t.id, version: t.version, track: t.track, difficulty: t.difficulty, mini: !!t.mini,
    title: t.title, brief: t.brief, criteria: t.criteria, timeLimitSec: t.timeLimitSec,
    origin: t.origin, badge: badgeOf(t),
    models: t.verification?.models ?? null,
    source: t.source,
    sentences: t.sentences.map(({ sid, text }) => ({ sid, text })),
  };
}

export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
      res.status(200).json(await fn(req));
    } catch (e) {
      const cap = /상한/.test(e.message);
      if (!e.status && !cap && e.name !== 'LlmError') console.error(e);
      res.status(e.status ?? (cap ? 429 : e.name === 'LlmError' ? 503 : 500)).json({ error: e.message, ...(cap ? { cap: true } : {}) });
    }
  };
}

export const body = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {});
export const deviceOk = (d) => typeof d === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(d);
