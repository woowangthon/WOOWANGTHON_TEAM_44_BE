// 라이브 패널용 공공 API 조회(참고 표시만, 시나리오 판단에는 쓰지 않는다)
// 수위: 한강홍수통제소 Open API, 특보: 기상청 기상특보 조회서비스(data.go.kr), 재난문자: 재난안전데이터공유플랫폼 DSSP-IF-00247
const TIMEOUT = 8000;
const STATION_HINT = process.env.LIVE_WL_STATION || '미호강교';
const WEATHER_STN = process.env.LIVE_WEATHER_STN || '131'; // 청주
const SMS_REGION = process.env.LIVE_SMS_REGION || '충청북도';

const kstDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + 9 * 3600e3 - offsetDays * 86400e3);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};
const fmtYmdhm = (s) => (s && s.length >= 12 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : s);
const num = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : Number(v));
const keyParam = (k) => (k.includes('%') ? k : encodeURIComponent(k)); // 인코딩 키·디코딩 키 모두 허용

// 오류 메시지에 키가 섞여 나가지 않게
function scrub(msg) {
  let m = String(msg);
  for (const k of [process.env.DATA_GO_KR_KEY, process.env.HRFCO_KEY, process.env.SAFETYDATA_KEY].filter(Boolean)) {
    m = m.split(k).join('***').split(encodeURIComponent(k)).join('***');
  }
  return m.slice(0, 200);
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON 아님: ${text.slice(0, 80)}`);
  }
}

let stationCache = null;
export function pickStation(list, hint = STATION_HINT) {
  const xs = (list ?? []).filter((s) => String(s.obsnm ?? '').includes(hint));
  return xs.find((s) => /교\)?$/.test(s.obsnm)) ?? xs[0] ?? null;
}
export function parseWater(info, rows) {
  const latest = [...(rows ?? [])].filter((r) => num(r.wl) !== null).sort((a, b) => String(b.ymdhm).localeCompare(String(a.ymdhm)))[0];
  return {
    station: info.obsnm,
    code: info.wlobscd,
    latest: latest ? { t: fmtYmdhm(latest.ymdhm), wl: num(latest.wl) } : null,
    levels: { 관심: num(info.attwl), 주의: num(info.wrnwl), 경계: num(info.almwl), 심각: num(info.srswl), 계획홍수위: num(info.pfh) },
  };
}
async function water() {
  const k = process.env.HRFCO_KEY;
  if (!k) throw new Error('HRFCO_KEY 없음');
  if (!stationCache) {
    const j = await getJson(`https://api.hrfco.go.kr/${k}/waterlevel/info.json`);
    stationCache = pickStation(j.content);
    if (!stationCache) throw new Error(`「${STATION_HINT}」 관측소를 찾지 못함`);
  }
  const j = await getJson(`https://api.hrfco.go.kr/${k}/waterlevel/list/10M/${stationCache.wlobscd}.json`);
  return parseWater(stationCache, j.content);
}

export function parseWeather(j) {
  const h = j?.response?.header;
  if (h && h.resultCode !== '00') {
    if (h.resultCode === '03') return { items: [] }; // NODATA
    throw new Error(`${h.resultCode} ${h.resultMsg}`);
  }
  let items = j?.response?.body?.items?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return { items: items.slice(0, 5).map((x) => ({ t: fmtYmdhm(String(x.tmFc)), title: x.title })) };
}
async function weather() {
  const k = process.env.DATA_GO_KR_KEY;
  if (!k) throw new Error('DATA_GO_KR_KEY 없음');
  const url = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?serviceKey=${keyParam(k)}&pageNo=1&numOfRows=5&dataType=JSON&stnId=${WEATHER_STN}&fromTmFc=${kstDate(5)}&toTmFc=${kstDate(0)}`;
  return parseWeather(await getJson(url));
}

export function parseSms(j) {
  const code = j?.header?.resultCode;
  if (code && !['00', '0', 'INFO-0'].includes(String(code))) {
    if (/NODATA|03/.test(String(code))) return { items: [] };
    throw new Error(`${code} ${j.header.resultMsg ?? ''}`);
  }
  const rows = Array.isArray(j?.body) ? j.body : j?.body?.items ?? j?.response?.body?.items?.item ?? [];
  const when = (x) => String(x.CRT_DT ?? x.REG_YMD ?? '').replace(/\D/g, '');
  return {
    items: [...rows].sort((a, b) => when(b).localeCompare(when(a))).slice(0, 5).map((x) => ({
      t: x.CRT_DT ?? x.REG_YMD ?? '',
      region: x.RCPTN_RGN_NM ?? '',
      step: x.EMRG_STEP_NM ?? '',
      kind: x.DST_SE_NM ?? '',
      text: x.MSG_CN ?? '', // 공공누리 4유형: 원문 그대로
    })),
  };
}
async function sms() {
  const k = process.env.SAFETYDATA_KEY;
  if (!k) throw new Error('SAFETYDATA_KEY 없음');
  const url = `https://www.safetydata.go.kr/V2/api/DSSP-IF-00247?serviceKey=${keyParam(k)}&returnType=json&pageNo=1&numOfRows=30&crtDt=${kstDate(6)}&rgnNm=${encodeURIComponent(SMS_REGION)}`;
  return parseSms(await getJson(url));
}

let cache = null;
export async function liveSnapshot({ maxAgeMs = 60_000 } = {}) {
  if (cache && Date.now() - cache.fetched < maxAgeMs) return { ...cache.data, cached: true };
  const wrap = async (fn) => {
    try {
      return { ok: true, ...(await fn()) };
    } catch (e) {
      return { ok: false, error: scrub(e.name === 'TimeoutError' ? '응답 시간 초과' : e.message === 'fetch failed' ? '서버에 접속하지 못함' : e.message) };
    }
  };
  const [w, wx, m] = await Promise.all([wrap(water), wrap(weather), wrap(sms)]);
  const data = {
    at: new Date().toISOString(),
    region: '충청북도(실제 데이터, 참고용)',
    water: { source: '한강홍수통제소 수위 Open API', ...w },
    weather: { source: '기상청 기상특보 조회서비스(공공데이터포털)', stn: WEATHER_STN, ...wx },
    sms: { source: '행정안전부 긴급재난문자(재난안전데이터공유플랫폼), 공공누리 제4유형 — 원문을 바꾸지 않고 표시', region: SMS_REGION, ...m },
  };
  cache = { fetched: Date.now(), data };
  return { ...data, cached: false };
}
