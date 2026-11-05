import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { validate } from './schema.js';

export const MODELS = {
  light: process.env.MODEL_LIGHT || 'claude-haiku-5-5',
  main: process.env.MODEL_MAIN || 'claude-sonnet-5-5',
};

const usage = { calls: 0, input_tokens: 0, output_tokens: 0, schema_retries: 0, failures: 0, cache_hits: 0 };
export const getUsage = () => ({ ...usage });
export const resetUsage = () => Object.keys(usage).forEach((k) => (usage[k] = 0));

let client;
const cache = new Map();

export class LlmError extends Error {}

// 도구 강제(tool_choice: tool)를 지원하지 않는 모델은 auto로 부르고, 도구를 안 쓰면 재요청 루프가 처리한다
const noForce = new Set();
async function create(model, body, toolName) {
  if (!noForce.has(model)) {
    try {
      return await client.messages.create({ model, ...body, tool_choice: { type: 'tool', name: toolName } });
    } catch (e) {
      if (!(e.status === 400 && /tool_choice/.test(e.message))) throw e;
      noForce.add(model);
    }
  }
  return client.messages.create({
    model, ...body, tool_choice: { type: 'auto' },
    system: `${body.system}\n\n반드시 ${toolName} 도구를 한 번 호출해 답한다. 도구 밖에 글을 쓰지 않는다.`,
  });
}

/**
 * 도구 호출을 강제해 구조화 출력을 받는다. 스키마·추가 검사 실패 시 사유를 붙여 1회 재요청.
 * check(output) → 문제 목록(빈 배열이면 통과). 두 번째도 실패하면 { output, problems }를 돌려
 * 호출 측이 차단·표시를 정한다.
 */
export async function callTool({ tier = 'main', system, user, tool, check = () => [], useCache = false, maxTokens = 2000 }) {
  const cap = Number(process.env.LLM_DAILY_CALL_CAP || 2000);
  const model = MODELS[tier];
  const key = createHash('sha256').update(JSON.stringify([model, system, user, tool.name])).digest('hex');
  if (useCache && cache.has(key)) {
    usage.cache_hits++;
    return { ...cache.get(key), cached: true };
  }
  client ??= new Anthropic();
  const messages = [{ role: 'user', content: user }];
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (usage.calls >= cap) throw new LlmError('AI 호출 상한 도달');
    usage.calls++;
    let res;
    try {
      res = await create(model, { max_tokens: maxTokens, system, tools: [tool], messages }, tool.name);
    } catch (e) {
      usage.failures++;
      throw new LlmError(`AI 호출 실패: ${e.status ?? ''} ${e.message}`);
    }
    usage.input_tokens += res.usage?.input_tokens ?? 0;
    usage.output_tokens += res.usage?.output_tokens ?? 0;
    const block = res.content.find((b) => b.type === 'tool_use');
    const output = block?.input;
    let problems = ['도구 출력 없음'];
    if (output) {
      const schemaErrs = validate(tool.input_schema, output);
      problems = schemaErrs.length ? schemaErrs : check(output);
    }
    last = { output, problems, attempts: attempt + 1, model };
    if (!problems.length) break;
    usage.schema_retries++;
    messages.push(
      { role: 'assistant', content: res.content },
      ...(block ? [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, is_error: true,
        content: `다음 문제를 고쳐 같은 도구로 다시 답하세요:\n- ${problems.join('\n- ')}` }] }] : [{ role: 'user', content: '도구로 답하세요.' }]),
    );
  }
  if (!last.output) {
    usage.failures++;
    throw new LlmError('AI 판단 실패(구조화 출력 없음)');
  }
  if (useCache && !last.problems.length) cache.set(key, last);
  return { ...last, cached: false };
}
