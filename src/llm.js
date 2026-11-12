// 모델 호출은 이 파일 하나로만 한다. 작성(writer)과 점검(checker)은 반드시 다른 모델이다.
// 출력은 JSON 스키마로 받고(구조화 출력), 스키마 검사·추가 검사에 걸리면 사유를 붙여 한 번 다시 요청한다.
// 하루 호출 상한은 KV의 날짜별 카운터로 센다(서버 인스턴스가 여러 개여도 함께 센다).
import Anthropic from '@anthropic-ai/sdk';
import { validate } from './schema.js';
import { incr } from './store.js';

export const ROLES = {
  writer: () => ({ provider: 'anthropic', model: process.env.MODEL_WRITER || 'claude-opus-5-5' }),
  checker: () =>
    process.env.CHECKER_PROVIDER === 'gemini'
      ? { provider: 'gemini', model: process.env.MODEL_CHECKER || 'gemini-unset' }
      : { provider: 'anthropic', model: process.env.MODEL_CHECKER || 'claude-sonnet-5-5' },
};

export class LlmError extends Error { constructor(m, status) { super(m); this.name = 'LlmError'; this.httpStatus = status; } }

// Gemini가 혼잡(503)이면 그 호출만 이 모델로 넘긴다. 작성 모델과는 다른 모델이다. 429(할당량)는 넘기지 않고 멈춘다
const CHECKER_FALLBACK = () => process.env.MODEL_CHECKER_FALLBACK || 'claude-sonnet-5-5';

const kstDate = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
export const dailyCap = () => Number(process.env.LLM_DAILY_CALL_CAP || 300);

/** 오늘 남은 호출 수(조회만) */
export async function capLeft() {
  const used = await incr(`ss:llm:${kstDate()}`, 0, 3 * 24 * 3600);
  return Math.max(0, dailyCap() - used);
}

async function takeCall() {
  const used = await incr(`ss:llm:${kstDate()}`, 1, 3 * 24 * 3600);
  if (used > dailyCap()) throw new LlmError('오늘의 AI 호출 상한에 닿았습니다');
}

// 이번 프로세스에서 쓴 양(파이프라인 보고서용)
export const usageLog = [];

let anthropic;
async function callAnthropic(model, { system, user, schema, maxTokens, effort }) {
  anthropic ??= new Anthropic();
  let res;
  try {
    res = await anthropic.messages.create({
      model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) },
    });
  } catch (e) {
    throw new LlmError(`AI 호출 실패(${e.status ?? '연결'}): ${String(e.message).slice(0, 200)}`);
  }
  if (res.stop_reason === 'refusal') throw new LlmError('모델이 응답을 거절했습니다');
  if (res.stop_reason === 'max_tokens') throw new LlmError('응답이 길이 상한에서 잘렸습니다');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 } };
}

async function callGemini(model, { system, user, schema }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LlmError('GEMINI_API_KEY 없음');
  // 503(혼잡)은 잠시 뒤 두 번까지 다시 보낸다. 429(할당량)는 다시 보내지 않고 멈춘다
  for (let i = 0; ; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS || 50000)),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema },
      }),
    });
    if (r.status === 503 && i < 2) { await new Promise((ok) => setTimeout(ok, 8000 * (i + 1))); continue; }
    if (!r.ok) {
      // 429(할당량)·결제 안내를 알아볼 수 있게 메시지 앞부분만 남긴다. 키는 응답에 들어 있지 않다
      const msg = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      throw new LlmError(`점검 모델 호출 실패(${r.status}) ${msg}`, r.status);
    }
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
    return { text, usage: { input: j.usageMetadata?.promptTokenCount ?? 0, output: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0) } };
  }
}

/**
 * 역할(role)의 모델에 JSON을 요청한다.
 * check(output) → 문제 목록. 비어 있으면 통과. 두 번째에도 문제가 있으면 { output, problems }를 그대로 돌려
 * 호출한 쪽이 버릴지 정한다.
 */
export async function callJson({ role, system, user, schema, check = () => [], maxTokens = 8000, effort, label = '' }) {
  let { provider, model } = ROLES[role]();
  let prompt = user;
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await takeCall();
    const t0 = Date.now();
    let res;
    if (provider === 'gemini') {
      try { res = await callGemini(model, { system, user: prompt, schema }); }
      catch (e) {
        if (e.httpStatus !== 503) throw e;
        usageLog.push({ label, role, model, attempt, ms: Date.now() - t0, input: 0, output: 0, failed: 503 });
        provider = 'anthropic'; model = CHECKER_FALLBACK();
        await takeCall();
      }
    }
    res ??= await callAnthropic(model, { system, user: prompt, schema, maxTokens, effort });
    const { text, usage } = res;
    usageLog.push({ label, role, model, attempt, ms: Date.now() - t0, ...usage });
    let output = null;
    let problems;
    try { output = JSON.parse(text); } catch { problems = ['JSON 아님']; }
    if (output) {
      const errs = validate(schema, output);
      problems = errs.length ? errs : check(output);
    }
    last = { output, problems, attempts: attempt, model };
    if (!problems.length) return last;
    prompt = `${user}\n\n[앞선 답의 문제 — 고쳐서 같은 형식으로 다시 답하세요]\n- ${problems.slice(0, 12).join('\n- ')}`;
  }
  if (!last.output) throw new LlmError(`AI 출력 형식 오류: ${last.problems.join('; ')}`);
  return last;
}
