import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeFor } from '../src/stages/criteria.js';
import { compatible } from '../src/stages/associate.js';
import { routeFor } from '../src/stages/advise.js';

const sig = (hazard, facts = [], urgency = 'caution') => ({ norm: { hazard, facts, urgency } });
const st = (...ss) => ({ byId: Object.fromEntries(ss.map((s, i) => [`S${i}`, s])) });
const inc = (n) => ({ signal_ids: Array.from({ length: n }, (_, i) => `S${i}`) });

test('규칙표: 생활 민원은 담당 부서 전달, 화재·가스와 인명 위험은 보고', () => {
  assert.equal(gradeFor(st(sig('water_main')), inc(1), []).grade, 'relay');
  assert.match(gradeFor(st(sig('streetlight')), inc(1), []).why[0], /가로등·신호등/);
  assert.equal(gradeFor(st(sig('fire_gas')), inc(1), []).grade, 'report');
  assert.equal(gradeFor(st(sig('snow_ice', [{ type: 'road_blocked' }])), inc(1), []).grade, 'report');
  assert.equal(gradeFor(st(sig('other')), inc(1), []).grade, 'observe');
  assert.equal(gradeFor(st(sig('water_main')), inc(1), [{ status: 'met', label: 'x' }]).grade, 'control_review');
});

test('같은 장소라도 다른 종류의 생활 민원은 규칙으로 묶지 않는다', () => {
  assert.equal(compatible('road_water', 'urban_flooding'), true);
  assert.equal(compatible('landslide', 'outage'), true);
  assert.equal(compatible('streetlight', 'water_main'), false);
  assert.equal(compatible('water_main', 'water_main'), true);
  assert.equal(compatible('other', 'water_main'), true);
});

test('실제 근무 시나리오: 생활 민원마다 담당 부서 연락처가 있다', () => {
  const scn = JSON.parse(readFileSync(new URL('../scenarios/cheongju-live.json', import.meta.url)));
  const ids = new Set(scn.contacts.map((c) => c.id));
  for (const h of ['water_main', 'road_damage', 'streetlight', 'snow_ice', 'animal', 'fire_gas', 'noise', 'person', 'outage']) {
    const r = routeFor(scn, { hazard: h });
    assert.ok(r.length && r.every((id) => ids.has(id)), h);
  }
  assert.ok(scn.manual.clauses.some((c) => /상수도사업본부/.test(c.text)));
});
