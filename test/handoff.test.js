import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openItems, sendHandoff, inbox, markHandoff, boxFor } from '../src/handoff.js';
import { _memReset } from '../src/store.js';

const scn = JSON.parse(readFileSync(new URL('../scenarios/cheongju-live.json', import.meta.url)));
const inc = (no, grade, decisions = []) => ({ id: `I${no}`, no, title: `사건${no}`, grade, place_name: '용암동', hazard: 'water_main', signal_ids: ['L01'], decisions });
const state = {
  now: '02:10', signals: [{ id: 'L01', t: '00:42' }],
  incidents: [
    inc(1, 'relay'),
    inc(2, 'report', [{ action: 'hold', at: '01:00', reason: '현장 확인 기다림', contacts: [] }]),
    inc(3, 'relay', [{ action: 'relay', at: '01:20', reason: '전달', contacts: [{ id: 'K11', status: 'pending', note: '복구반 출동 확인 중' }, { id: 'K5', status: 'reached' }] }]),
    inc(4, 'report', [{ action: 'relay', at: '01:30', reason: '전달', contacts: [{ id: 'K13', status: 'reached' }] }]),
    inc(5, 'observe'),
  ],
};

test('인계 미결 항목: 결정 전, 보류, 결정 뒤 오름, 회신 대기', () => {
  const items = openItems(scn, state);
  assert.deepEqual(items.map((i) => i.kind), ['undecided', 'held', 'pending', 'raised']);
  assert.match(items.find((i) => i.kind === 'pending').text, /상수도사업본부 야간 비상연락 회신 대기\(01:20 연락\): 복구반 출동 확인 중/);
});

test('인계함: 넘기기 → 받기 → 이어받기, 연습과 실제 근무는 다른 함', async () => {
  _memReset();
  const live = boxFor({ office: '청주시청 당직실' });
  const pr = boxFor({ practice: true, client: 'abcd1234ef' });
  assert.notEqual(live, pr);
  assert.throws(() => boxFor({ practice: true, client: 'x' }));
  const h = await sendHandoff(scn, state, { box: live, from: '박당직', summary: '요약' });
  assert.equal(h.items.length, 4);
  assert.equal((await inbox(pr)).latest, null);
  const got = await inbox(live);
  assert.equal(got.latest.id, h.id);
  const after = await markHandoff(live, { id: h.id, take: h.items[0].key });
  assert.deepEqual(after.taken, [h.items[0].key]);
  await assert.rejects(markHandoff(live, { id: h.id, take: 'nope' }));
  const rec = await markHandoff(live, { id: h.id, receive: true });
  assert.ok(rec.received_at);
});
