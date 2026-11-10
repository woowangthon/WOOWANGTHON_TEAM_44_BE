// 다음 근무자에게 넘기는 인계. 인계 보고서와 같은 상태에서 코드로 미결 항목을 뽑아 당직실 인계함에 넣는다.
import { getJson, setJson } from './store.js';
import { GRADE_KO, ACTION_KO, gradeRank } from './util.js';

const MAX = 20;
const boxKey = (box) => `dm:handoff:${box}`;
// 실제 근무는 기관 인계함 하나, 연습은 브라우저마다 따로(심사위원끼리 섞이지 않게)
export function boxFor({ practice, client, office }) {
  if (practice) {
    if (!/^[a-z0-9]{8,40}$/.test(client ?? '')) throw Object.assign(new Error('연습 인계함 id가 잘못됐습니다'), { status: 400 });
    return `practice:${client}`;
  }
  return `live:${(office ?? '').replace(/\s+/g, '')}`;
}

/** 미결 항목: 결정 전 사건, 보류한 사건, 결정 뒤 권고가 오른 사건, 회신 대기 */
export function openItems(scn, state) {
  const org = (id) => scn.contacts.find((c) => c.id === id)?.org ?? id;
  const out = [];
  for (const inc of state.incidents) {
    const last = inc.decisions.at(-1);
    const base = { incident_no: inc.no, title: inc.title, grade: inc.grade, place: inc.place_name, hazard: inc.hazard, signals: inc.signal_ids.length };
    if (gradeRank(inc.grade) >= 1 && !last) out.push({ ...base, key: `${inc.id}:undecided`, kind: 'undecided', text: `${GRADE_KO[inc.grade]}, 결정 전` });
    else if (last?.action === 'hold') out.push({ ...base, key: `${inc.id}:held`, kind: 'held', text: `${last.at} 보류: ${last.reason}` });
    else if (last && gradeRank(inc.grade) > gradeRank(last.action)) out.push({ ...base, key: `${inc.id}:raised`, kind: 'raised', text: `${ACTION_KO[last.action]} 뒤 ${GRADE_KO[inc.grade]}로 오름` });
    for (const d of inc.decisions) {
      for (const c of d.contacts ?? []) {
        if (c.status === 'pending') out.push({ ...base, key: `${inc.id}:${c.id}`, kind: 'pending', text: `${org(c.id)} 회신 대기(${d.at} 연락)${c.note ? `: ${c.note}` : ''}`, contact: org(c.id) });
      }
    }
  }
  return out;
}

export async function sendHandoff(scn, state, { box, from, note, summary, period }) {
  const list = await getJson(boxKey(box), []);
  const h = {
    id: `H${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    office: scn.duty.office, from: (from ?? '').trim().slice(0, 30) || '당직원', note: (note ?? '').trim().slice(0, 300),
    period: period ?? `${scn.clock.date} ${scn.clock.start}~${state.now}`, sent_at: new Date().toISOString(),
    scenario_id: scn.id, practice: box.startsWith('practice:'),
    counts: { signals: state.signals.length, incidents: state.incidents.length, decisions: state.incidents.reduce((a, i) => a + i.decisions.length, 0) },
    summary: (summary ?? '').slice(0, 1200),
    items: openItems(scn, state),
    taken: [], received_at: null,
  };
  list.unshift(h);
  await setJson(boxKey(box), list.slice(0, MAX));
  return h;
}

export async function inbox(box) {
  const list = await getJson(boxKey(box), []);
  return { latest: list[0] ?? null, earlier: list.slice(1, 5).map(({ id, from, period, sent_at, items, taken }) => ({ id, from, period, sent_at, open: items.length - taken.length })) };
}

/** 다음 근무자가 항목을 이어받거나(take) 인계를 받았다고 표시(receive) */
export async function markHandoff(box, { id, take, receive }) {
  const list = await getJson(boxKey(box), []);
  const h = list.find((x) => x.id === id);
  if (!h) throw Object.assign(new Error('없는 인계입니다'), { status: 404 });
  if (take) {
    if (!h.items.some((i) => i.key === take)) throw Object.assign(new Error('없는 인계 항목입니다'), { status: 400 });
    if (!h.taken.includes(take)) h.taken.push(take);
  }
  if (receive && !h.received_at) h.received_at = new Date().toISOString();
  await setJson(boxKey(box), list);
  return h;
}
