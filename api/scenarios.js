// GET /api/scenarios → 목록, GET /api/scenarios?id=... → 시나리오(정답 제외)
import { handler, listScenarios, loadScenario, publicScenario } from './_lib.js';

export default handler(async (req) => (req.query.id ? publicScenario(loadScenario(req.query.id)) : listScenarios()));
