// 저장소: Vercel에 연결한 Upstash Redis(REST). 환경 변수가 없으면 이 프로세스 메모리에 둔다(로컬·테스트용).
// 키는 모두 ss: 로 시작한다(같은 Redis에 남아 있는 당직메이트 키 dm:* 와 섞이지 않게).
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = String(90 * 24 * 3600); // 심사가 끝나고도 한참 남도록 90일

export const storeKind = () => (URL_() && TOKEN() ? 'redis' : 'memory');

async function redis(cmd) {
  const r = await fetch(URL_(), { method: 'POST', headers: { Authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw Object.assign(new Error(`기록 저장소 오류(${r.status})`), { status: 503 });
  return (await r.json()).result;
}

async function pipeline(cmds) {
  const r = await fetch(`${URL_()}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw Object.assign(new Error(`기록 저장소 오류(${r.status})`), { status: 503 });
  return (await r.json()).map((x) => x.result);
}

// ---- 메모리 대체 ----
const mem = { kv: new Map(), hash: new Map(), set: new Map(), list: new Map() };
export const _memReset = () => Object.values(mem).forEach((m) => m.clear());

export async function getJson(key, fallback = null) {
  if (storeKind() === 'memory') return mem.kv.has(key) ? structuredClone(mem.kv.get(key)) : fallback;
  const v = await redis(['GET', key]);
  return v ? JSON.parse(v) : fallback;
}

export async function setJson(key, value, ttlSec = TTL) {
  if (storeKind() === 'memory') { mem.kv.set(key, structuredClone(value)); return; }
  await redis(['SET', key, JSON.stringify(value), 'EX', String(ttlSec)]);
}

export async function del(key) {
  if (storeKind() === 'memory') { mem.kv.delete(key); return; }
  await redis(['DEL', key]);
}

/** 정수 카운터 +n, 새 값을 돌려준다 */
export async function incr(key, n = 1, ttlSec = TTL) {
  if (storeKind() === 'memory') { const v = (mem.kv.get(key) ?? 0) + n; mem.kv.set(key, v); return v; }
  const [v] = await pipeline([['INCRBY', key, String(n)], ['EXPIRE', key, String(ttlSec)]]);
  return Number(v);
}

/** 집합에 넣고, 새로 들어갔으면 true */
export async function sadd(key, member) {
  if (storeKind() === 'memory') { const s = mem.set.get(key) ?? new Set(); const isNew = !s.has(member); s.add(member); mem.set.set(key, s); return isNew; }
  const [v] = await pipeline([['SADD', key, member], ['EXPIRE', key, TTL]]);
  return Number(v) === 1;
}

/** 해시 필드 여러 개를 한 번에 +1 */
export async function hincrMany(key, fields) {
  if (!fields.length) return;
  if (storeKind() === 'memory') {
    const h = mem.hash.get(key) ?? {};
    for (const f of fields) h[f] = (h[f] ?? 0) + 1;
    mem.hash.set(key, h);
    return;
  }
  await pipeline([...fields.map((f) => ['HINCRBY', key, f, '1']), ['EXPIRE', key, TTL]]);
}

export async function hgetall(key) {
  if (storeKind() === 'memory') return { ...(mem.hash.get(key) ?? {}) };
  const arr = (await redis(['HGETALL', key])) ?? [];
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]);
  return o;
}

/** 목록 앞에 넣고 최근 max개만 남긴다 */
export async function lpushCapped(key, value, max = 5000) {
  const s = JSON.stringify(value);
  if (storeKind() === 'memory') { const l = mem.list.get(key) ?? []; l.unshift(s); mem.list.set(key, l.slice(0, max)); return; }
  await pipeline([['LPUSH', key, s], ['LTRIM', key, '0', String(max - 1)], ['EXPIRE', key, TTL]]);
}

export async function lrange(key, start = 0, stop = -1) {
  if (storeKind() === 'memory') return (mem.list.get(key) ?? []).slice(start, stop === -1 ? undefined : stop + 1).map((x) => JSON.parse(x));
  return ((await redis(['LRANGE', key, String(start), String(stop)])) ?? []).map((x) => JSON.parse(x));
}
