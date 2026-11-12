// G0 실험용 모델 호출 한 곳: Anthropic·OpenAI·Google. 제품 src/llm.js로 옮길 모양을 미리 시험한다.
// - 모델 이름 앞부분으로 회사를 정한다(claude-*, gpt-*/o*, gemini-*).
// - 출력은 JSON 스키마로 받고, 스키마 검사에 걸리면 사유를 붙여 한 번 다시 요청한다.
// - 429·5xx는 잠시 뒤 다시 보낸다. 단, Gemini 무료 등급 할당량(429 RESOURCE_EXHAUSTED)은 바로 멈춘다.
// - 비용은 공식 가격표(2026-11-12 확인)로 추정한다. 키 값은 어디에도 출력하지 않는다.
import { validate } from '../../src/schema.js';

export const PRICE = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
  'gpt-6-astra': [10, 50], 'gpt-6.1-sol': [2, 10], 'gpt-6.1-terra': [1, 5], 'gpt-6-sol': [2, 10], 'gpt-5.6-sol': [4, 20],
  'gemini-4-argon': [2, 10], 'gemini-4-carbon': [2, 10], 'gemini-3.8-flash': [0.75, 3.75], 'gemini-3.6-flash': [0.75, 3.75],
};
export const companyOf = (model) => (/^claude/.test(model) ? 'Anthropic' : /^(gpt|o\d)/.test(model) ? 'OpenAI' : /^gemini/.test(model) ? 'Google' : '?');

export const usage = [];
let spent = 0;
const BUDGET = Number(process.env.G0_BUDGET_USD || 15);
export const spentUsd = () => spent;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
class CallError extends Error { constructor(m, status, retry = false) { super(m); this.status = status; this.retry = retry; } }

let anthropic;
async function anthropicCall(model, { system, user, schema, maxTokens, effort }) {
  if (!anthropic) { const { default: A } = await import('@anthropic-ai/sdk'); anthropic = new A({ maxRetries: 0, timeout: 600e3 }); }
  try {
    const res = await anthropic.messages.create({
      model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) },
    });
    return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0, stop: res.stop_reason };
  } catch (e) {
    throw new CallError(`Anthropic ${e.status ?? '연결'}: ${String(e.message).slice(0, 160)}`, e.status, !e.status || e.status === 429 || e.status >= 500);
  }
}

async function openaiCall(model, { system, user, schema, maxTokens, effort }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new CallError('OPENAI_API_KEY 없음', 0);
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(600e3),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name: 'out', strict: true, schema } },
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
  }).catch((e) => { throw new CallError(`OpenAI 연결: ${e.message}`, 0, true); });
  if (!r.ok) { const t = (await r.text()).replace(/\s+/g, ' ').slice(0, 200); throw new CallError(`OpenAI ${r.status}: ${t}`, r.status, r.status === 429 || r.status >= 500); }
  const j = await r.json();
  const c = j.choices?.[0];
  return { text: c?.message?.content ?? '', input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, stop: c?.finish_reason };
}

async function geminiCall(model, { system, user, schema, maxTokens, effort }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new CallError('GEMINI_API_KEY 없음', 0);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal: AbortSignal.timeout(600e3),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: maxTokens, ...(effort ? { thinkingConfig: { thinkingLevel: effort } } : {}) },
    }),
  }).catch((e) => { throw new CallError(`Gemini 연결: ${e.message}`, 0, true); });
  if (!r.ok) {
    const t = (await r.text()).replace(/\s+/g, ' ').slice(0, 200);
    const quota = r.status === 429 && /RESOURCE_EXHAUSTED|quota/i.test(t);
    throw new CallError(`Gemini ${r.status}: ${t}`, r.status, !quota && (r.status === 429 || r.status >= 500));
  }
  const j = await r.json();
  const c = j.candidates?.[0];
  return { text: c?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '', input: j.usageMetadata?.promptTokenCount ?? 0, output: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0), stop: c?.finishReason };
}

const CALL = { Anthropic: anthropicCall, OpenAI: openaiCall, Google: geminiCall };

/** JSON 하나를 받는다. 형식이 틀리면 사유를 붙여 한 번 다시 요청한다. 내용은 고치지 않는다. */
export async function callJson({ model, system, user, schema, maxTokens = 8000, effort, label }) {
  const fn = CALL[companyOf(model)];
  if (!fn) throw new Error(`모르는 모델 ${model}`);
  let prompt = user;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (spent > BUDGET) throw new Error(`실험 예산 $${BUDGET}을 넘었습니다`);
    let res;
    for (let net = 0; ; net++) {
      const t0 = Date.now();
      try { res = await fn(model, { system, user: prompt, schema, maxTokens, effort }); res.ms = Date.now() - t0; break; }
      catch (e) {
        usage.push({ label, model, attempt, failed: e.message.slice(0, 160), ms: Date.now() - t0 });
        if (!e.retry || net >= 3) throw e;
        await sleep(5000 * 2 ** net);
      }
    }
    const p = PRICE[model] ?? [0, 0];
    const cost = (res.input * p[0] + res.output * p[1]) / 1e6;
    spent += cost;
    usage.push({ label, model, attempt, input: res.input, output: res.output, ms: res.ms, stop: res.stop, cost });
    let out = null, probs;
    try { const s = res.text.indexOf('{'); out = JSON.parse(res.text.slice(s, res.text.lastIndexOf('}') + 1)); probs = validate(schema, out); } catch { probs = ['JSON 아님']; }
    if (!probs.length) return { out, model, ms: res.ms };
    if (/max_tokens|length|MAX_TOKENS/.test(String(res.stop))) probs.push('길이 상한에서 잘림');
    prompt = `${user}\n\n[앞선 답의 형식 문제. 내용은 그대로 두고 형식만 고쳐 다시 답하세요]\n- ${probs.slice(0, 8).join('\n- ')}`;
  }
  throw new Error(`${label}: 두 번 모두 형식이 맞지 않았습니다`);
}
