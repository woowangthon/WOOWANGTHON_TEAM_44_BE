import { handler, allTasks, badgeOf } from './_lib.js';
import { playCount } from '../src/record.js';

// 과제 목록: 트랙, 길이, 푼 횟수, 배지. 오류 수는 싣지 않는다.
export default handler(async () => {
  const tasks = allTasks().filter((t) => t.origin === 'bank');
  const rows = await Promise.all(tasks.map(async (t) => ({
    id: t.id, track: t.track, title: t.title, mini: !!t.mini, difficulty: t.difficulty,
    sourceChars: t.source.paragraphs.reduce((a, p) => a + p.text.length, 0), sentences: t.sentences.length,
    timeLimitSec: t.timeLimitSec, publisher: t.source.publisher, badge: badgeOf(t), plays: await playCount(t),
  })));
  rows.sort((a, b) => Number(b.mini) - Number(a.mini) || a.id.localeCompare(b.id));
  return { tasks: rows };
});
