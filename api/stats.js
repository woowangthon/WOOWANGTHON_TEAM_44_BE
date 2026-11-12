import { handler } from './_lib.js';
import { overallStats, feedbackStats } from '../src/record.js';

export default handler(async () => ({ ...(await overallStats()), feedback: await feedbackStats() }));
