// V7 견줄 기준: 「챗봇에게 한 번에 시키기」와 이 파이프라인의 정답지가 얼마나 맞는지 같은 심판으로 잰다.
//
//  1) gen   : 원자료마다 작성 모델(Opus)에게 한 번에 「요약을 쓰고 일부러 오류 셋을 넣고 정답표를 달라」고 한다(사용자가 챗봇에 시키는 방식).
//  2) judge : 심판 모델이 두 쪽(한 번에 만든 과제, 파이프라인 은행 과제)의 문장을 하나하나 원자료와 대조한다. 심판은 정답표를 보지 않는다.
//     - 가짜 오류: 정답표가 「틀렸다」고 한 문장인데 심판은 원자료가 뒷받침한다고 판정
//     - 숨은 오류: 정답표가 「맞다」고 한 문장인데 심판은 뒷받침하지 않는다고 판정
//  심판은 --judge gemini(작성·점검과 다른 회사) 또는 --judge sonnet. 결과가 기대와 달라도 그대로 싣는다.
//
// 사용법: node --env-file=.env scripts/v7-baseline.js gen
//         node --env-file=.env scripts/v7-baseline.js judge --judge gemini
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { callJson, usageLog } from '../src/llm.js';
import { judgeSentences } from '../src/pipeline.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = 'reports/v7';
mkdirSync(OUT, { recursive: true });
const sources = readdirSync('data/sources').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`data/sources/${f}`, 'utf8')))
  .filter((s) => s.difficulty !== 'mini');
const block = (s) => `<원자료 제목="${s.title}">\n${s.paragraphs.map((p) => `[${p.pid}] ${p.text}`).join('\n')}\n</원자료>`;

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const NAIVE_SCHEMA = obj({
  sentences: { type: 'array', items: { type: 'string' } },
  answer: { type: 'array', items: obj({ index: { type: 'integer' }, wrong: { type: 'string' }, correct: { type: 'string' }, why: { type: 'string' } }) },
});

if (args[0] === 'gen') {
  const out = [];
  for (const s of sources) {
    // 사용자가 챗봇에 그대로 칠 법한 요청 하나
    const user = `${block(s)}\n\n이 자료로 AI 결과물 검수 연습 문제를 만들어 줘. 자료를 일곱 문장으로 요약하되, 그중 세 문장에 원자료와 다른 오류(숫자, 단위, 증감 방향, 원자료에 없는 내용, 지나친 단정 등)를 일부러 하나씩 넣어 줘. 나머지 문장은 원자료와 정확히 맞아야 해. 문장 목록(sentences)과 정답표(answer: 오류 문장 번호 index는 1부터, 틀린 부분 wrong, 원래 맞는 내용 correct, 이유 why)를 줘.`;
    try {
      const r = await callJson({ role: 'writer', system: '당신은 도움이 되는 AI 비서입니다.', user, schema: NAIVE_SCHEMA, label: 'V7 한 번에', effort: 'medium' });
      out.push({ id: s.id, sentences: r.output.sentences, answer: r.output.answer, model: r.model });
      console.log(`${s.id}: ${r.output.sentences.length}문장, 정답표 ${r.output.answer.length}개`);
    } catch (e) { console.error(`${s.id}: ${e.message}`); out.push({ id: s.id, error: e.message }); }
  }
  writeFileSync(`${OUT}/naive.json`, JSON.stringify(out, null, 2));
  console.log(`호출 ${usageLog.length}회`);
} else if (args[0] === 'judge') {
  const judge = opt('judge', 'sonnet');
  if (judge === 'gemini') { process.env.CHECKER_PROVIDER = 'gemini'; process.env.MODEL_CHECKER = opt('model', 'gemini-3.5-flash'); }
  const naive = JSON.parse(readFileSync(`${OUT}/naive.json`, 'utf8')).filter((x) => !x.error);
  const bank = readdirSync('data/tasks').map((f) => JSON.parse(readFileSync(`data/tasks/${f}`, 'utf8'))).filter((t) => !t.mini);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const rows = [];
  const run = async (kind, id, source, sentences, wrongSet) => {
    const items = sentences.map((text, i) => ({ sid: `s${i + 1}`, text }));
    const before = usageLog.length;
    const v = await judgeSentences(source, items, `V7 심판 ${kind}`);
    const models = [...new Set(usageLog.slice(before).filter((u) => !u.failed).map((u) => u.model))];
    let fake = 0, hidden = 0;
    const detail = [];
    items.forEach((it, i) => {
      const supported = v.get(it.sid)?.supported;
      const claimedWrong = wrongSet.has(i);
      if (claimedWrong && supported === true) { fake++; detail.push({ n: i + 1, kind: '가짜 오류', text: it.text }); }
      if (!claimedWrong && supported === false) { hidden++; detail.push({ n: i + 1, kind: '숨은 오류', text: it.text, judge: v.get(it.sid)?.problem }); }
    });
    rows.push({ kind, id, sentences: items.length, claimed: wrongSet.size, fake, hidden, models, detail });
    console.log(`${kind} ${id}: 문장 ${items.length}, 정답표 오류 ${wrongSet.size}, 가짜 오류 ${fake}, 숨은 오류 ${hidden} (${models.join('+')})`);
  };
  for (const x of naive) {
    try { await run('한 번에', x.id, srcById.get(x.id), x.sentences, new Set(x.answer.map((a) => a.index - 1))); }
    catch (e) { console.error(`한 번에 ${x.id}: ${e.message}`); if (/429/.test(e.message)) break; }
  }
  for (const t of bank) {
    const idx = new Map(t.sentences.map((s, i) => [s.sid, i]));
    try { await run('파이프라인', t.id, srcById.get(t.id) ?? t.source, t.sentences.map((s) => s.text), new Set(t.answer.planted.map((p) => idx.get(p.sid)))); }
    catch (e) { console.error(`파이프라인 ${t.id}: ${e.message}`); if (/429/.test(e.message)) break; }
  }
  const sum = (k) => {
    const r = rows.filter((x) => x.kind === k);
    const tasksBad = r.filter((x) => x.fake || x.hidden).length;
    return { tasks: r.length, sentences: r.reduce((a, x) => a + x.sentences, 0), claimed: r.reduce((a, x) => a + x.claimed, 0), fake: r.reduce((a, x) => a + x.fake, 0), hidden: r.reduce((a, x) => a + x.hidden, 0), tasksBad };
  };
  const result = { judge, at: new Date().toISOString(), naive: sum('한 번에'), pipeline: sum('파이프라인'), rows };
  writeFileSync(`${OUT}/judge-${judge}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ naive: result.naive, pipeline: result.pipeline }));
  console.log(`호출 ${usageLog.length}회`);
} else {
  console.error('gen 또는 judge');
  process.exit(1);
}
