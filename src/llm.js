// 모델 호출은 이 파일 하나로만 한다. 회사 셋(Anthropic·OpenAI·Google)을 같은 모양으로 부른다.
// - 출력은 JSON 스키마로 받는다(구조화 출력). 스키마에 안 맞으면 사유를 붙여 한 번 다시 요청한다. 내용은 고치지 않는다.
// - 429·5xx·연결 오류는 잠시 뒤 다시 보낸다(최대 3번). Gemini 무료 등급 할당량 초과는 바로 멈춘다.
// - 회사별 하루 금액 상한과 전체 하루 호출 상한을 KV에서 센다(서버 인스턴스가 여러 개여도 함께 센다).
// - 호출마다 회사·모델·토큰·추정 비용·시간·용도를 남긴다. 키 값은 어디에도 내지 않는다.
import { validate } from './schema.js';
import { incr } from './store.js';

/** 공식 가격표(2026-11-12 확인), 백만 토큰당 [입력, 출력] 달러 */
export const PRICE = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
  'gpt-6-astra': [10, 50], 'gpt-6.1-sol': [2, 10], 'gpt-6.1-terra': [1, 5],
  'gemini-4-argon': [2, 10], 'gemini-4-carbon': [2, 10], 'gemini-3.8-flash': [0.75, 3.75],
};
export const companyOf = (model) => (/^claude/.test(model) ? 'Anthropic' : /^(gpt|o\d)/.test(model) ? 'OpenAI' : /^gemini/.test(model) ? 'Google' : '?');
export const COMPANIES = ['Anthropic', 'OpenAI', 'Google'];

/** 역할별 모델. 작업 = 사람들이 실제로 쓰는 수준, 감사 = 회사마다 하나 */
export const WORKERS = () => ({
  Anthropic: process.env.WORKER_ANTHROPIC || 'claude-sonnet-5-5',
  OpenAI: process.env.WORKER_OPENAI || 'gpt-6.1-sol',
  Google: process.env.WORKER_GOOGLE || 'gemini-3.8-flash',
});
export const AUDITORS = () => ({
  Anthropic: process.env.AUDITOR_ANTHROPIC || 'claude-opus-5-5',
  OpenAI: process.env.AUDITOR_OPENAI || 'gpt-6.1-sol',
  Google: process.env.AUDITOR_GOOGLE || 'gemini-4-argon',
});
/** 키가 있는 회사만 */
export const available = (company) => !!{ Anthropic: process.env.ANTHROPIC_API_KEY, OpenAI: process.env.OPENAI_API_KEY, Google: process.env.GEMINI_API_KEY }[company];
/** 작업 모델과 다른 회사의 감사들(키가 있는 것만). 고정 판은 셋 다, 라이브는 작업 회사를 뺀 둘 */
export function auditorsFor(workerCompany, { all = false } = {}) {
  const A = AUDITORS();
  return COMPANIES.filter((c) => (all || c !== workerCompany) && available(c)).map((c) => A[c]);
}

export class LlmError extends Error { constructor(m, status, retry = false) { super(m); this.name = 'LlmError'; this.httpStatus = status; this.retry = retry; } }

const kstDate = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
export const dailyCap = () => Number(process.env.LLM_DAILY_CALL_CAP || 400);
const DAY_USD = { Anthropic: () => Number(process.env.CAP_USD_ANTHROPIC || 10), OpenAI: () => Number(process.env.CAP_USD_OPENAI || 6), Google: () => Number(process.env.CAP_USD_GOOGLE || 6) };
const UNIT = 1e5; // 금액은 1/100000달러 정수로 센다
const costKey = (c) => `ss2:cost:${c}:${kstDate()}`;

export async function capLeft() {
  const used = await incr(`ss2:llm:${kstDate()}`, 0, 3 * 24 * 3600);
  return Math.max(0, dailyCap() - used);
}
export async function spentToday() {
  const o = {};
  for (const c of COMPANIES) o[c] = (await incr(costKey(c), 0, 3 * 24 * 3600)) / UNIT;
  return o;
}

async function takeCall(company) {
  const used = await incr(`ss2:llm:${kstDate()}`, 1, 3 * 24 * 3600);
  if (used > dailyCap()) throw new LlmError('오늘의 AI 호출 상한에 닿았습니다', 429);
  const usd = (await incr(costKey(company), 0, 3 * 24 * 3600)) / UNIT;
  if (usd >= DAY_USD[company]()) throw new LlmError(`오늘 ${company} 사용 상한($${DAY_USD[company]()})에 닿았습니다`, 429);
}

// ---------------- 회사별 호출 ----------------
let anthropic;
async function anthropicCall(model, { system, user, schema, maxTokens, effort, timeoutMs }) {
  if (!anthropic) { const { default: A } = await import('@anthropic-ai/sdk'); anthropic = new A({ maxRetries: 0 }); }
  try {
    const res = await anthropic.messages.create({
      model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) },
    }, { timeout: timeoutMs });
    if (res.stop_reason === 'refusal') throw new LlmError('모델이 응답을 거절했습니다', 502);
    return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0, stop: res.stop_reason };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(`Anthropic ${e.status ?? '연결'}: ${String(e.message).slice(0, 160)}`, e.status ?? 0, !e.status || e.status === 429 || e.status >= 500);
  }
}

async function openaiCall(model, { system, user, schema, maxTokens, effort, timeoutMs }) {
  // 스트리밍으로 받는다: 추론이 길면(감사 high 4~5분) 머리글이 늦게 와서 Node fetch의 기본 대기 한도(300초)에 끊기기 때문이다
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model, max_completion_tokens: maxTokens, stream: true, stream_options: { include_usage: true },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name: 'out', strict: true, schema } },
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
  }).catch((e) => { throw new LlmError(`OpenAI 연결: ${e.message}`, 0, true); });
  if (!r.ok) { const t = (await r.text()).replace(/\s+/g, ' ').slice(0, 200); throw new LlmError(`OpenAI ${r.status}: ${t}`, r.status, r.status === 429 || r.status >= 500); }
  let text = '', usage = {}, stop = null, refusal = '', buf = '';
  const dec = new TextDecoder();
  try {
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        const j = JSON.parse(data);
        if (j.usage) usage = j.usage;
        const c = j.choices?.[0];
        if (c?.delta?.content) text += c.delta.content;
        if (c?.delta?.refusal) refusal += c.delta.refusal;
        if (c?.finish_reason) stop = c.finish_reason;
      }
    }
  } catch (e) { throw new LlmError(`OpenAI 스트림 끊김: ${e.message}`, 0, true); }
  if (refusal) throw new LlmError('모델이 응답을 거절했습니다', 502);
  return { text, input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0, stop };
}

async function geminiCall(model, { system, user, schema, maxTokens, effort, timeoutMs }) {
  // 스트리밍(SSE)으로 받는다: 긴 감사가 Node fetch의 기본 대기 한도(300초)에 끊기지 않게
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: maxTokens, ...(effort ? { thinkingConfig: { thinkingLevel: effort } } : {}) },
    }),
  }).catch((e) => { throw new LlmError(`Gemini 연결: ${e.message}`, 0, true); });
  if (!r.ok) {
    const t = (await r.text()).replace(/\s+/g, ' ').slice(0, 200);
    const quota = r.status === 429 && /RESOURCE_EXHAUSTED|quota/i.test(t);
    throw new LlmError(`Gemini ${r.status}: ${t}`, r.status, !quota && (r.status === 429 || r.status >= 500));
  }
  let text = '', meta = {}, stop = null, buf = '';
  const dec = new TextDecoder();
  try {
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const j = JSON.parse(line.slice(5).trim());
        if (j.usageMetadata) meta = j.usageMetadata;
        const c = j.candidates?.[0];
        for (const p of c?.content?.parts ?? []) if (!p.thought && p.text) text += p.text;
        if (c?.finishReason) stop = c.finishReason;
      }
    }
  } catch (e) { throw new LlmError(`Gemini 스트림 끊김: ${e.message}`, 0, true); }
  return { text, input: meta.promptTokenCount ?? 0, output: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0), stop };
}

const CALL = { Anthropic: anthropicCall, OpenAI: openaiCall, Google: geminiCall };

// 이번 프로세스에서 쓴 양(스크립트 보고용)
export const usageLog = [];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * JSON 하나를 받는다. check(output) → 문제 목록(비면 통과).
 * 두 번째에도 문제가 있으면 { output, problems }를 그대로 돌려 호출한 쪽이 버릴지 정한다. 형식부터 깨지면 던진다.
 */
// timeoutMs: 서버(Vercel 함수 300초) 안에서는 기본 270초. 스크립트는 길게 줄 수 있다(G0: 감사 high는 4~5분)
export async function callJson({ model, system, user, schema, check = () => [], maxTokens = 8000, effort, label = '', retryWait = 4000, timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 270e3), retries = 3 }) {
  const company = companyOf(model);
  const fn = CALL[company];
  if (!fn) throw new LlmError(`모르는 모델 ${model}`, 500);
  if (!available(company)) throw new LlmError(`${company} 키가 없습니다`, 503);
  let prompt = user;
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await takeCall(company);
    let res;
    const t0 = Date.now();
    for (let net = 0; ; net++) {
      try { res = await fn(model, { system, user: prompt, schema, maxTokens, effort, timeoutMs }); break; }
      catch (e) {
        usageLog.push({ label, model, company, attempt, failed: String(e.message).slice(0, 160), ms: Date.now() - t0 });
        if (!e.retry || net >= retries) throw e;
        await sleep(retryWait * 2 ** net);
      }
    }
    const ms = Date.now() - t0;
    const p = PRICE[model] ?? [0, 0];
    const cost = (res.input * p[0] + res.output * p[1]) / 1e6;
    await incr(costKey(company), Math.ceil(cost * UNIT), 3 * 24 * 3600);
    usageLog.push({ label, model, company, attempt, input: res.input, output: res.output, cost, ms, stop: res.stop });
    let output = null, problems;
    try { const s = res.text.indexOf('{'); output = JSON.parse(res.text.slice(s, res.text.lastIndexOf('}') + 1)); } catch { problems = ['JSON 아님']; }
    if (output) { const errs = validate(schema, output); problems = errs.length ? errs : check(output); }
    if (/max_tokens|length|MAX_TOKENS/.test(String(res.stop))) problems = [...(problems ?? []), '길이 상한에서 잘림'];
    last = { output, problems, attempts: attempt, model, company, ms, cost };
    if (!problems.length) return last;
    prompt = `${user}\n\n[앞선 답의 형식 문제 — 고쳐서 같은 형식으로 다시 답하세요]\n- ${problems.slice(0, 10).join('\n- ')}`;
  }
  if (!last.output) throw new LlmError(`AI 출력 형식 오류: ${last.problems.join('; ')}`, 502);
  return last;
}
