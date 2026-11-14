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

// 로컬 개발: STORE_FILE을 주면 메모리 저장소를 파일에 남긴다(서버를 다시 띄워도 풀이·검수가 남게). 배포에서는 쓰지 않는다
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
const FILE = process.env.STORE_FILE;
if (FILE && existsSync(FILE)) {
  const j = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const [k, v] of j.kv ?? []) mem.kv.set(k, v);
  for (const [k, v] of j.hash ?? []) mem.hash.set(k, v);
  for (const [k, v] of j.set ?? []) mem.set.set(k, new Set(v));
  for (const [k, v] of j.list ?? []) mem.list.set(k, v);
}
function persist() {
  if (!FILE) return;
  const j = { kv: [...mem.kv], hash: [...mem.hash], set: [...mem.set].map(([k, v]) => [k, [...v]]), list: [...mem.list] };
  writeFileSync(`${FILE}.tmp`, JSON.stringify(j)); renameSync(`${FILE}.tmp`, FILE);
}

export async function getJson(key, fallback = null) {
  if (storeKind() === 'memory') return mem.kv.has(key) ? structuredClone(mem.kv.get(key)) : fallback;
  const v = await redis(['GET', key]);
  return v ? JSON.parse(v) : fallback;
}

export async function setJson(key, value, ttlSec = TTL) {
  if (storeKind() === 'memory') { mem.kv.set(key, structuredClone(value)); persist(); return; }
  await redis(['SET', key, JSON.stringify(value), 'EX', String(ttlSec)]);
}

export async function del(key) {
  if (storeKind() === 'memory') { mem.kv.delete(key); persist(); return; }
  await redis(['DEL', key]);
}

/** 정수 카운터 +n, 새 값을 돌려준다 */
export async function incr(key, n = 1, ttlSec = TTL) {
  if (storeKind() === 'memory') { const v = (mem.kv.get(key) ?? 0) + n; mem.kv.set(key, v); if (n) persist(); return v; }
  const [v] = await pipeline([['INCRBY', key, String(n)], ['EXPIRE', key, String(ttlSec)]]);
  return Number(v);
}

/** 키 여러 개를 한 번에 읽는다(없는 키는 null). 같은 순서로 돌려준다 */
export async function getJsonMany(keys) {
  if (!keys.length) return [];
  if (storeKind() === 'memory') return keys.map((k) => (mem.kv.has(k) ? structuredClone(mem.kv.get(k)) : null));
  const vs = (await redis(['MGET', ...keys])) ?? [];
  return keys.map((_, i) => (vs[i] ? JSON.parse(vs[i]) : null));
}

/** 집합에 넣고, 새로 들어갔으면 true */
export async function sadd(key, member, ttlSec = TTL) {
  if (storeKind() === 'memory') { const s = mem.set.get(key) ?? new Set(); const isNew = !s.has(member); s.add(member); mem.set.set(key, s); persist(); return isNew; }
  const [v] = await pipeline([['SADD', key, member], ['EXPIRE', key, String(ttlSec)]]);
  return Number(v) === 1;
}

/** 집합의 원소 전부 */
export async function smembers(key) {
  if (storeKind() === 'memory') return [...(mem.set.get(key) ?? [])];
  return (await redis(['SMEMBERS', key])) ?? [];
}

/** 집합에 있나 */
export async function sismember(key, member) {
  if (storeKind() === 'memory') return !!mem.set.get(key)?.has(member);
  return Number(await redis(['SISMEMBER', key, member])) === 1;
}

/** 해시 필드 여러 개를 한 번에 +1 */
export async function hincrMany(key, fields) {
  if (!fields.length) return;
  if (storeKind() === 'memory') {
    const h = mem.hash.get(key) ?? {};
    for (const f of fields) h[f] = (h[f] ?? 0) + 1;
    mem.hash.set(key, h);
    persist();
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
  if (storeKind() === 'memory') { const l = mem.list.get(key) ?? []; l.unshift(s); mem.list.set(key, l.slice(0, max)); persist(); return; }
  await pipeline([['LPUSH', key, s], ['LTRIM', key, '0', String(max - 1)], ['EXPIRE', key, TTL]]);
}

export async function lrange(key, start = 0, stop = -1) {
  if (storeKind() === 'memory') return (mem.list.get(key) ?? []).slice(start, stop === -1 ? undefined : stop + 1).map((x) => JSON.parse(x));
  return ((await redis(['LRANGE', key, String(start), String(stop)])) ?? []).map((x) => JSON.parse(x));
}
