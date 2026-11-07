// 공공 API 응답 파서 (네트워크 없이)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickStation, parseWater, parseWeather, parseSms } from '../src/live.js';

test('수위 관측소 고르기와 최신값', () => {
  const st = pickStation([{ obsnm: '청주시(미호강교)', wlobscd: '3011665', attwl: '', wrnwl: '7.5', almwl: '8.5', srswl: '9.0', pfh: '9.65' }, { obsnm: '세종시(미호강합류)', wlobscd: 'x' }]);
  assert.equal(st.wlobscd, '3011665');
  const w = parseWater(st, [{ ymdhm: '202611071450', wl: '1.23' }, { ymdhm: '202611071500', wl: '1.25' }]);
  assert.deepEqual(w.latest, { t: '2026-11-07 15:00', wl: 1.25 });
  assert.equal(w.levels.관심, null);
  assert.equal(w.levels.계획홍수위, 9.65);
});

test('기상특보: 정상, 자료 없음, 오류', () => {
  const ok = parseWeather({ response: { header: { resultCode: '00' }, body: { items: { item: { tmFc: 202611070500, title: '[특보] 제11-5호 : 2026.11.07.05:00 / 강풍주의보 발표' } } } } });
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].t, '2026-11-07 05:00');
  assert.deepEqual(parseWeather({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } } }).items, []);
  assert.throws(() => parseWeather({ response: { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } }), /30/);
});

test('재난문자: 원문 그대로', () => {
  const msg = '[청주시] 오늘 15시 호우경보 발효 중. 하천변 산책로 출입을 자제하시기 바랍니다.';
  const r = parseSms({ header: { resultCode: '00' }, body: [{ CRT_DT: '2026/11/07 15:01:00', MSG_CN: msg, RCPTN_RGN_NM: '충청북도 청주시', EMRG_STEP_NM: '안전안내', DST_SE_NM: '호우' }] });
  assert.equal(r.items[0].text, msg);
  assert.equal(r.items[0].region, '충청북도 청주시');
});
