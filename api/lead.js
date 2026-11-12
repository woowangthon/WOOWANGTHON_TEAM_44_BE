// POST /api/lead  팀장 모드. 한 요청에 한 단계(또는 감사 하나)
//   { action:'start', missionId, plan:[{kind, name, inputs, instruction}], workerCompany?, deviceId, maker }
//   { action:'stage', id } · { action:'verdict', id, verdict:'ok'|'reject', reason, sourceViews } · { action:'signoff', id, checked, unchecked, sourceViews }
//   { action:'audit', id } · { action:'get', id }
import { handler, body, deviceOk, err } from './_lib.js';
import { start, stage, verdict, signoff, auditStep, getLead } from '../src/lead.js';
import { saveLeadRecord } from '../src/record.js';

export default handler(async (req) => {
  const b = body(req);
  if (b.action === 'start') {
    if (!deviceOk(b.deviceId)) throw err('기기 ID가 없습니다');
    return start(b);
  }
  if (b.action === 'stage') return stage(b.id);
  if (b.action === 'verdict') return verdict(b.id, b);
  if (b.action === 'signoff') return signoff(b.id, b);
  if (b.action === 'audit') {
    const v = await auditStep(b.id);
    if (v.justFinished) {
      await saveLeadRecord(b.deviceId, b.maker, { id: v.id, at: new Date().toISOString(), missionId: v.missionId, worker: v.worker, Afinal: v.result.counts.Afinal, A: v.result.counts.A, blocked: v.result.blocked, sourceViews: v.result.sourceViews, calls: v.result.calls, minutes: v.result.minutes, habits: Object.fromEntries(Object.entries(v.result.habits).map(([k, x]) => [k, x.ok])) });
    }
    return v;
  }
  if (b.action === 'get') return getLead(b.id);
  throw err('모르는 동작');
});
