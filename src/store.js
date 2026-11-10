// 당직실 인계함 저장소. Vercel에 연결한 Upstash Redis(REST)를 쓰고, 없으면 이 서버 프로세스 메모리에 둔다(로컬·테스트용).
// 키: dm:handoff:<함>  값: 인계 목록 JSON(최근 것부터 20개)
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = new Map();

export const storeKind = () => (URL_() && TOKEN() ? 'redis' : 'memory');

async function redis(cmd) {
  const r = await fetch(URL_(), { method: 'POST', headers: { Authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw Object.assign(new Error(`인계함 저장소 오류(${r.status})`), { status: 503 });
  return (await r.json()).result;
}

export async function getJson(key, fallback) {
  if (storeKind() === 'memory') return mem.has(key) ? structuredClone(mem.get(key)) : fallback;
  const v = await redis(['GET', key]);
  return v ? JSON.parse(v) : fallback;
}

export async function setJson(key, value) {
  if (storeKind() === 'memory') { mem.set(key, structuredClone(value)); return; }
  // 심사 기간이 지나도 몇 주는 남도록 60일 뒤 지운다
  await redis(['SET', key, JSON.stringify(value), 'EX', String(60 * 24 * 3600)]);
}

export const _memReset = () => mem.clear();
