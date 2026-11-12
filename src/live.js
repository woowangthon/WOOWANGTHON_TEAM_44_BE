// 라이브 모드: 은행 과제와 같은 파이프라인(P1~P5)을 서버에서 단계별로 돌린다.
// 한 요청에 한 단계만 돌리고 상태는 KV에 둔다(함수 제한 시간 안에 들고, 화면의 진행 표시가 실제 단계와 맞는다).
// 붙여 넣은 글과 만든 과제는 24시간 뒤 지워진다(KV TTL). 붙여 넣은 글 속의 지시문은 따르지 않는다(pipeline.js DATA_ONLY).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { p1Write, p2Verify, p3p4Plant, p5Blind } from './pipeline.js';
import { assembleTask } from './assemble.js';
import { ROLES, capLeft } from './llm.js';
import { getJson, setJson, incr } from './store.js';
import { quoteIn } from './text.js';

const DAY = 24 * 3600;
export const LIVE_PER_DEVICE = 3;
export const LIVE_PER_MAKER = 15;
const CALLS_NEEDED = 10; // 한 번에 드는 호출(작성 재요청·점검 포함) 넉넉히
export const STEPS = [
  { key: 'p1', label: 'AI 신입이 원자료로 보고서를 씁니다', who: 'writer' },
  { key: 'p2', label: '문장마다 원자료와 대조합니다', who: 'code+checker' },
  { key: 'p3', label: '오류를 심고, 심은 곳이 정말 틀렸는지 검증합니다', who: 'code+writer+checker' },
  { key: 'p5', label: '다른 모델이 같은 화면만 보고 먼저 풀어 봅니다', who: 'checker' },
];

const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const rid = () => Math.random().toString(36).slice(2, 12).padEnd(10, '0');
// 새 보고서용 자료 묶음(data/pool). 결재함 과제의 원자료(data/sources)와 겹치지 않게 따로 둔다
const POOL_DIR = () => process.env.POOL_DIR || join(process.cwd(), 'data', 'pool');

/** 새 보고서 받기에서 고를 수 있는 원자료 목록(최신 보도일 순) */
export function poolSources() {
  if (!existsSync(POOL_DIR())) return [];
  return readdirSync(POOL_DIR()).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(POOL_DIR(), f), 'utf8')))
    .sort((a, b) => String(b.publishedAt ?? b.id.slice(-4)).localeCompare(String(a.publishedAt ?? a.id.slice(-4))));
}

/** 붙여 넣은 글을 원자료 모양으로. 줄 단위로 문단을 나눈다 */
export function textSource(text, title) {
  const t = String(text ?? '').replace(/\r/g, '').trim();
  if (t.length < 300 || t.length > 2000) throw Object.assign(new Error('글은 300자 이상 2,000자 이하로 넣어 주세요'), { status: 400 });
  const paras = t.split(/\n\s*\n|\n/).map((x) => x.trim()).filter((x) => x.length >= 15).slice(0, 15);
  if (paras.length < 1) throw Object.assign(new Error('문단을 읽지 못했습니다'), { status: 400 });
  const name = String(title ?? '').trim().slice(0, 60) || '붙여 넣은 자료';
  return {
    id: 'pasted', title: name, taskTitle: `${name} 요약`, publisher: '사용자가 붙여 넣은 글', url: '',
    license: '사용자가 붙여 넣은 글. 과제와 함께 24시간 뒤 지웁니다.', retrievedAt: kstDate(), excerptNote: '',
    track: 'document', difficulty: 2,
    brief: '팀장: 「이 자료, 핵심만 여섯 문장으로 정리해 줘. 숫자는 틀리면 안 돼.」',
    paragraphs: paras.map((text, i) => ({ pid: `p${i + 1}`, text })),
  };
}

/** 오류 수: 넷 중 하나는 틀린 곳이 없다. 사용자는 미리 모른다 */
const pickN = (r) => [0, 2, 3, 3][Math.floor(r * 4)];

/** 약점 맞춤: 화면의 사유 이름 → 심기 유형 */
export const FOCUS_TYPES = {
  '숫자·단위': ['number', 'unit'],
  '원자료에 없음': ['unsupported'],
  '방향·주체가 바뀜': ['direction'],
  '근거보다 큰 결론': ['overclaim'],
};

export async function startJob({ mode, sourceId, text, title, deviceId, maker, focus }) {
  if (focus && !FOCUS_TYPES[focus]) throw Object.assign(new Error('알 수 없는 오류 유형'), { status: 400 });
  if (!deviceId) throw Object.assign(new Error('기기 번호가 없습니다'), { status: 400 });
  const used = await incr(`ss:live:dev:${kstDate()}:${deviceId}`, 0, 2 * DAY);
  const limit = maker ? LIVE_PER_MAKER : LIVE_PER_DEVICE;
  if (used >= limit) throw Object.assign(new Error(`새 보고서는 하루 ${limit}번까지 받을 수 있습니다. 내일 다시 오거나 결재 대기 목록의 과제를 풀어 주세요`), { status: 429, cap: true });
  if ((await capLeft()) < CALLS_NEEDED) throw Object.assign(new Error('오늘의 AI 호출 상한에 거의 닿아 새 보고서를 만들 수 없습니다. 결재 대기 목록의 과제를 풀어 주세요'), { status: 429, cap: true });

  let source;
  if (mode === 'text') source = textSource(text, title);
  else {
    const pool = poolSources();
    source = (sourceId && pool.find((s) => s.id === sourceId)) || pool[Math.floor(Math.random() * pool.length)];
    if (!source) throw Object.assign(new Error('원자료 묶음이 비어 있습니다'), { status: 500 });
  }
  await incr(`ss:live:dev:${kstDate()}:${deviceId}`, 1, 2 * DAY);
  await incr(`ss:live:count:${kstDate()}`, 1, 30 * DAY);
  const id = `live-${rid()}`;
  const job = {
    id, mode: mode === 'text' ? 'text' : 'pool', source, n: focus ? 2 : pickN(Math.random()), seed: rid(), count: 6, focus: focus ?? null,
    status: 'p1', public: [], log: [], createdAt: new Date().toISOString(), maker: !!maker,
    models: { writer: ROLES.writer().model, checker: ROLES.checker().model },
  };
  await setJson(`ss:live:job:${id}`, job, DAY);
  return view(job);
}

/** 화면으로 보내는 진행 상황. 정답과 오류 수는 싣지 않는다 */
export function view(job) {
  return {
    jobId: job.id, status: job.status, steps: STEPS, done: job.public,
    source: { title: job.source.title, publisher: job.source.publisher, chars: job.source.paragraphs.reduce((a, p) => a + p.text.length, 0), paragraphs: job.source.paragraphs.length },
    taskId: job.status === 'done' ? job.id : null, error: job.error ?? null, focus: job.focus ?? null,
  };
}

const fail = (job, msg) => { job.status = 'failed'; job.error = msg; };

/** 다음 단계 하나를 돌린다 */
export async function runStep(jobId) {
  if (!/^live-[a-z0-9]{6,20}$/.test(jobId ?? '')) throw Object.assign(new Error('잘못된 작업 번호'), { status: 400 });
  const job = await getJson(`ss:live:job:${jobId}`);
  if (!job) throw Object.assign(new Error('없거나 기한이 지난 작업'), { status: 404 });
  if (job.status === 'done' || job.status === 'failed') return view(job);
  // 같은 단계를 두 번 돌리지 않는다(화면이 겹쳐 부를 때)
  if (job.runningSince && Date.now() - job.runningSince < 280e3) return { ...view(job), busy: true };
  job.runningSince = Date.now();
  await setJson(`ss:live:job:${jobId}`, job, DAY);
  const t0 = Date.now();
  const src = job.source;
  try {
    if (job.status === 'p1') {
      const w = await p1Write(src, { count: job.count });
      job.p1 = w.sentences;
      const quotes = w.sentences.flatMap((s) => s.support);
      const ok = quotes.filter((q) => quoteIn(q.quote, src.paragraphs.find((p) => p.pid === q.pid)?.text ?? '')).length;
      job.log.push({ step: 'p1', kept: w.sentences.length, dropped: w.dropped.length, attempts: w.attempts, ms: Date.now() - t0 });
      job.public.push({ key: 'p1', text: `${w.sentences.length}문장을 썼습니다. 근거 인용 ${ok}/${quotes.length}개가 원자료에 글자 그대로 있습니다.${w.dropped.length ? ` 코드 검사에 두 번 걸린 ${w.dropped.length}문장은 뺐습니다.` : ''}` });
      if (w.sentences.length < 4) fail(job, '원자료와 맞는 문장을 충분히 쓰지 못했습니다. 다른 자료로 해 보세요');
      else job.status = 'p2';
    } else if (job.status === 'p2') {
      const v = await p2Verify(src, job.p1);
      job.clean = v.passed.map((s, i) => ({ sid: `s${i + 1}`, text: s.text, support: s.support }));
      job.log.push({ step: 'p2', passed: v.passed.length, failed: v.failed.map((f) => ({ text: f.text, problem: f.problem })), ms: Date.now() - t0 });
      job.public.push({ key: 'p2', text: `점검 모델(${job.models.checker})이 ${v.passed.length + v.failed.length}문장 가운데 ${v.passed.length}문장을 원자료가 뒷받침한다고 판정했습니다.${v.failed.length ? ` 나머지 ${v.failed.length}문장은 뺐습니다.` : ''}` });
      if (job.clean.length < 4) fail(job, '원자료가 뒷받침하는 문장이 4개보다 적습니다. 다른 자료로 해 보세요');
      else job.status = 'p3';
    } else if (job.status === 'p3') {
      const pl = job.n
        ? await p3p4Plant(src, job.clean, job.focus ? { n: job.n, seed: job.seed, types: FOCUS_TYPES[job.focus], only: true } : { n: job.n, seed: job.seed })
        : { planted: [], log: [] };
      job.planted = pl.planted;
      job.n = pl.planted.length; // 검증을 통과한 만큼만 심는다(0개일 수도 있다)
      job.log.push({ step: 'p3', planned: job.n, planted: pl.planted.length, tries: pl.log, ms: Date.now() - t0 });
      job.public.push({ key: 'p3', text: (job.focus ? `「${job.focus}」 유형 위주로 ` : '') + '오류를 심고, 심은 문장이 코드 검사와 점검 모델 양쪽에서 틀렸다고 나오는지 확인했습니다. 몇 곳인지(없을 수도 있음)는 결재 뒤에 알려 드립니다.' });
      job.status = 'p5';
    } else if (job.status === 'p5') {
      const plantedBy = new Map(job.planted.map((p) => [p.sid, p]));
      const sentences = job.clean.map((s) => ({ sid: s.sid, text: plantedBy.get(s.sid)?.after ?? s.text }));
      const blind = await p5Blind(src, src.brief, sentences);
      const task = assembleTask({
        source: src, id: job.id, difficulty: 2, n: job.n, clean: job.clean, planted: job.planted, blind,
        models: job.models, origin: 'live', timeLimitSec: 240,
      });
      task.title = src.taskTitle ?? src.title;
      task.liveLog = job.log.map(({ step, ms, kept, dropped, passed, planned, planted }) => ({ step, ms, kept, dropped, passed, planned, planted }));
      job.log.push({ step: 'p5', flags: blind.flags.length, ms: Date.now() - t0 });
      task.liveLog.push({ step: 'p5', ms: Date.now() - t0 });
      await setJson(`ss:live:task:${job.id}`, task, DAY);
      job.public.push({ key: 'p5', text: '다른 모델이 사용자와 같은 화면만 보고 먼저 풀었습니다. 결과는 결재 뒤 성적표에 나옵니다.' });
      job.status = 'done';
    }
  } catch (e) {
    job.log.push({ step: job.status, error: e.message, ms: Date.now() - t0 });
    fail(job, /상한/.test(e.message) ? '오늘의 AI 호출 상한에 닿았습니다' : `AI 호출이 실패했습니다: ${e.message.slice(0, 120)}`);
  }
  delete job.runningSince;
  await setJson(`ss:live:job:${jobId}`, job, DAY);
  return view(job);
}
