// 은행 과제 하나를 P0 원자료 파일에서 끝까지 만든다.
// 사용법: node --env-file=.env scripts/build-task.js data/sources/<id>.json [--difficulty 2] [--seed abc] [--tries 2]
// 결과: data/tasks/<id>.json(과제), reports/pipeline/<id>.json(단계별 기록, 실패 포함), reports/human-check/<id>.md(사람 확인용 한 장)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { p1Write, p2Verify, p3p4Plant, p5Blind, ERRORS_BY_DIFFICULTY } from '../src/pipeline.js';
import { assembleTask } from '../src/assemble.js';
import { ROLES, usageLog } from '../src/llm.js';
import { REASON_OF } from '../src/plant.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const srcPath = args.find((a) => a.endsWith('.json'));
if (!srcPath) { console.error('원자료 파일 경로가 필요합니다'); process.exit(1); }

const source = JSON.parse(readFileSync(srcPath, 'utf8'));
const difficulty = opt('difficulty', String(source.difficulty ?? 2));
const n = ERRORS_BY_DIFFICULTY[difficulty];
if (n === undefined) { console.error(`난이도는 ${Object.keys(ERRORS_BY_DIFFICULTY).join('·')} 가운데 하나입니다`); process.exit(1); }
const count = Number(opt('sentences', difficulty === 'mini' ? 4 : 7));
const tries = Number(opt('tries', 2));
const seedBase = opt('seed', source.id);

const report = { id: source.id, startedAt: new Date().toISOString(), difficulty, plannedErrors: n, models: { writer: ROLES.writer().model, checker: ROLES.checker().model }, attempts: [] };
const save = () => {
  mkdirSync('reports/pipeline', { recursive: true });
  writeFileSync(`reports/pipeline/${source.id}.json`, JSON.stringify({ ...report, usage: usageLog }, null, 2));
};

let task = null;
for (let t = 1; t <= tries && !task; t++) {
  const at = { try: t, seed: `${seedBase}-${t}` };
  report.attempts.push(at);
  try {
    // P1 (--reuse-p1이면 지난번 P1 결과를 다시 쓴다. 심기·검증만 다시 할 때 작성 모델 호출을 아낀다)
    const p1Path = `reports/pipeline/${source.id}.p1.json`;
    let w;
    if (args.includes('--reuse-p1') && existsSync(p1Path)) w = JSON.parse(readFileSync(p1Path, 'utf8'));
    else {
      w = await p1Write(source, { count });
      mkdirSync('reports/pipeline', { recursive: true });
      writeFileSync(p1Path, JSON.stringify(w, null, 2));
    }
    at.p1 = { kept: w.sentences.length, dropped: w.dropped, modelAttempts: w.attempts };
    console.log(`[${t}] P1 ${w.sentences.length}문장 통과(코드), 뺀 문장 ${w.dropped.length}`);
    // P2
    const v = await p2Verify(source, w.sentences);
    at.p2 = { passed: v.passed.length, failed: v.failed.map((f) => ({ text: f.text, problem: f.problem })) };
    console.log(`[${t}] P2 점검 통과 ${v.passed.length}, 실패 ${v.failed.length}`);
    const min = difficulty === 'mini' ? 3 : 5;
    if (v.passed.length < min) { at.result = `P2 뒤 문장 ${v.passed.length}개(최소 ${min})`; continue; }
    const clean = v.passed.map((s, i) => ({ sid: `s${i + 1}`, text: s.text, support: s.support }));
    // P3·P4
    const pl = await p3p4Plant(source, clean, { n, seed: at.seed });
    at.p3p4 = { planted: pl.planted.length, log: pl.log };
    console.log(`[${t}] P3·P4 심음 ${pl.planted.length}/${n}`);
    if (pl.planted.length < n) { at.result = `오류 ${pl.planted.length}/${n}개만 검증 통과`; continue; }
    const plantedBy = new Map(pl.planted.map((p) => [p.sid, p]));
    const sentences = clean.map((s) => ({ sid: s.sid, text: plantedBy.get(s.sid)?.after ?? s.text }));
    // P5
    const blind = await p5Blind(source, source.brief, sentences);
    // 실제로 판정한 모델(혼잡으로 대체 모델이 쓰였으면 함께 적는다)
    const used = (r) => [...new Set(usageLog.filter((u) => u.role === r && !u.failed).map((u) => u.model))].join(' + ');
    report.models = { writer: used('writer') || report.models.writer, checker: used('checker') || report.models.checker };
    task = assembleTask({ source, difficulty, n, clean, planted: pl.planted, blind, models: report.models });
    const vb = task.verification.blind;
    at.p5 = { flags: blind.flags, decision: blind.decision, caught: vb.caught, extra: vb.extra };
    console.log(`[${t}] P5 눈 가린 풀이: 심은 ${n}개 중 ${vb.caught}개 짚음, 심지 않은 곳 ${vb.extraFlags}곳 짚음, 판정 ${blind.decision}`);
    at.result = 'ok';
  } catch (e) {
    at.result = `오류: ${e.message}`;
    console.error(`[${t}] ${e.message}`);
  }
  save();
}

report.finishedAt = new Date().toISOString();
save();
if (!task) { console.error('과제를 만들지 못했습니다. reports/pipeline을 보세요'); process.exit(2); }

mkdirSync('data/tasks', { recursive: true });
writeFileSync(`data/tasks/${task.id}.json`, JSON.stringify(task, null, 2));

// 사람 확인용 한 장
const pmap = new Map(task.answer.planted.map((p) => [p.sid, p]));
const cmap = new Map(task.answer.clean.map((c) => [c.sid, c]));
const md = [
  `# 사람 확인: ${task.id} — ${task.title}`,
  '',
  `- 원자료: ${task.source.title} (${task.source.publisher}) ${task.source.url}`,
  `- 이용 조건: ${task.source.license}`,
  `- 맡긴 일: ${task.brief}`,
  `- 모델: 작성 ${report.models.writer}, 점검 ${report.models.checker}`,
  `- 검증: 숫자 ${task.verification.numbersMatched}, 인용 ${task.verification.quotesMatched}, 심은 오류 ${task.verification.plantedVerified}, 나머지 문장 그대로 ${task.verification.othersUntouched ? '예' : '아니오'}`,
  `- 눈 가린 풀이: 심은 ${n}개 중 ${task.verification.blind.caught}개 짚음, 심지 않은 곳 ${task.verification.blind.extraFlags}곳 짚음, 판정 ${task.verification.blind.decision}`,
  '',
  '## 원자료',
  ...task.source.paragraphs.map((p) => `- **[${p.pid}]** ${p.text}`),
  '',
  '## 결과물과 정답표',
  ...task.sentences.flatMap((s) => {
    const p = pmap.get(s.sid);
    if (p) return [`- **${s.sid} ❌ ${REASON_OF[p.type]}** ${s.text}`, `  - 원래: ${p.before}`, `  - 근거 [${p.evidence.pid}] 「${p.evidence.quote}」`, `  - 까닭: ${p.why}`, `  - 점검 모델: ${p.checkerSaid}`];
    const c = cmap.get(s.sid);
    return [`- **${s.sid} ○** ${s.text}`, ...c.support.map((x) => `  - 근거 [${x.pid}] 「${x.quote}」`)];
  }),
  '',
  '## 눈 가린 풀이가 심지 않은 곳을 짚은 것(뜻하지 않은 오류인지 볼 것)',
  ...(task.verification.blind.extra.length ? task.verification.blind.extra.map((e) => `- ${e.sid} (${e.reason}): ${e.note}`) : ['- 없음']),
  '',
  '## 확인',
  '- [ ] 심은 오류가 원자료만 보고 가려진다',
  '- [ ] 심지 않은 문장에 틀린 곳이 없다',
  '- [ ] 승인',
].join('\n');
mkdirSync('reports/human-check', { recursive: true });
writeFileSync(`reports/human-check/${task.id}.md`, md);
console.log(`완료: data/tasks/${task.id}.json, reports/human-check/${task.id}.md`);
const tok = usageLog.reduce((a, u) => ({ in: a.in + u.input, out: a.out + u.output }), { in: 0, out: 0 });
console.log(`호출 ${usageLog.length}회, 입력 ${tok.in} 토큰, 출력 ${tok.out} 토큰`);
