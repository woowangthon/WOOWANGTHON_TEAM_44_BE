// GET /api/live → 충북 실제 수위·기상특보·긴급재난문자 요약(참고용, 60초 캐시)
import { handler } from './_lib.js';
import { liveSnapshot } from '../src/live.js';

export default handler(async () => liveSnapshot());
