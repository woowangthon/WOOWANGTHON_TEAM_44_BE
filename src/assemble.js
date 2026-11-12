// 파이프라인 결과로 과제 파일 하나를 짓는다. 은행 과제(scripts/build-task.js)와 라이브 과제(api/live.js)가 같이 쓴다.
import { CRITERIA } from './pipeline.js';
import { numbers, quoteIn, missingNumbers } from './text.js';

/**
 * @param source  원자료(P0)
 * @param clean   P2를 통과한 문장 [{ sid, text, support }]
 * @param planted P3·P4를 통과한 오류
 * @param blind   P5 결과({ flags, decision }) 또는 null
 */
export function assembleTask({ source, id = source.id, difficulty, n, clean, planted, blind, models, origin = 'bank', timeLimitSec }) {
  const plantedBy = new Map(planted.map((p) => [p.sid, p]));
  const sentences = clean.map((s) => ({ sid: s.sid, text: plantedBy.get(s.sid)?.after ?? s.text }));
  const untouched = clean.filter((s) => !plantedBy.has(s.sid)).every((s) => sentences.find((x) => x.sid === s.sid).text === s.text);
  const paraText = (pid) => source.paragraphs.find((p) => p.pid === pid)?.text ?? '';
  const numTotal = clean.reduce((a, s) => a + numbers(s.text).length, 0);
  const numOk = clean.reduce((a, s) => a + numbers(s.text).length - missingNumbers(s.text, s.support.map((q) => paraText(q.pid)).join('\n')).length, 0);
  const allQuotes = clean.flatMap((s) => s.support);
  const flagged = new Set((blind?.flags ?? []).map((f) => f.sid));
  const extra = (blind?.flags ?? []).filter((f) => !plantedBy.has(f.sid));
  const caught = planted.filter((p) => flagged.has(p.sid)).map((p) => p.sid);
  const mini = difficulty === 'mini';
  return {
    id, version: 1, track: source.track ?? 'document', difficulty: mini ? 1 : Number(difficulty), mini,
    title: source.taskTitle ?? source.title, brief: source.brief, criteria: CRITERIA,
    timeLimitSec: timeLimitSec ?? (mini ? 60 : 240), origin,
    source: {
      title: source.title, publisher: source.publisher, url: source.url ?? '', license: source.license, retrievedAt: source.retrievedAt,
      excerptNote: source.excerptNote ?? '', paragraphs: source.paragraphs, ...(source.columns ? { columns: source.columns } : {}),
    },
    sentences,
    answer: {
      planted: planted.map((p) => ({ sid: p.sid, type: p.type, before: p.before, after: p.after, evidence: p.evidence, why: p.why, detail: p.detail, guarantee: p.guarantee, checkerSaid: p.checkerSaid })),
      clean: clean.filter((s) => !plantedBy.has(s.sid)).map((s) => ({ sid: s.sid, support: s.support })),
      correctDecision: n ? '반려' : '승인',
    },
    verification: {
      models,
      numbersMatched: `${numOk}/${numTotal}`,
      quotesMatched: `${allQuotes.filter((q) => quoteIn(q.quote, paraText(q.pid))).length}/${allQuotes.length}`,
      plantedVerified: `${planted.length}/${n}`,
      othersUntouched: untouched,
      blind: blind ? { caught: caught.length, of: n, extraFlags: extra.length, extra: extra.map((e) => ({ sid: e.sid, reason: e.reason, note: e.note })), decision: blind.decision } : null,
      humanChecked: null,
    },
  };
}
