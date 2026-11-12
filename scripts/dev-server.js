// 로컬 확인용: /api/* 를 Vercel 함수와 같은 형태로 띄운다. 사용법: npm run dev (기본 3001)
import http from 'node:http';
import { URL } from 'node:url';
import { readdirSync } from 'node:fs';

const port = Number(process.env.PORT || 3001);
const routes = {};
for (const f of readdirSync('api').filter((f) => f.endsWith('.js') && !f.startsWith('_'))) routes[`/api/${f.replace(/\.js$/, '')}`] = (await import(`../api/${f}`)).default;

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const fn = routes[u.pathname];
  if (!fn) return res.writeHead(404).end();
  let raw = '';
  for await (const c of req) raw += c;
  const vreq = { method: req.method, headers: req.headers, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : undefined };
  const vres = {
    statusCode: 200,
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { this.statusCode = c; return this; },
    json(x) { res.writeHead(this.statusCode, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(x)); },
    end() { res.writeHead(this.statusCode).end(); },
  };
  fn(vreq, vres);
}).listen(port, () => console.log(`api on http://localhost:${port}`));
