import { createServer } from 'node:http';
import { SOURCES, listSources } from './sources/registry.js';

const PORT = Number(process.env.PORT || 4100);

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function toWebRequest(req: import('node:http').IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  return new Request(url.toString(), { method: req.method, headers });
}

const server = createServer(async (req, res) => {
  if (!req.url) return sendJson(res, 400, { error: 'Bad request' });
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const params = Object.fromEntries(url.searchParams.entries());

  if (url.pathname === '/v1/health') {
    return sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  if (url.pathname === '/v1/sources') {
    return sendJson(res, 200, { sources: listSources() });
  }

  if (url.pathname === '/v1/all') {
    const webReq = toWebRequest(req, url);
    const results = await Promise.allSettled(
      Object.values(SOURCES).map((s) => s.fetch(params, webReq)),
    );
    return sendJson(res, 200, {
      fetchedAt: new Date().toISOString(),
      results: Object.keys(SOURCES).map((name, i) => {
        const r = results[i];
        return r.status === 'fulfilled' ? { name, ...r.value } : { name, error: String(r.reason) };
      }),
    });
  }

  const match = url.pathname.match(/^\/v1\/([a-z0-9-]+)$/);
  if (match) {
    const source = SOURCES[match[1]];
    if (!source) return sendJson(res, 404, { error: `Unknown source: ${match[1]}` });
    try {
      const webReq = toWebRequest(req, url);
      const result = await source.fetch(params, webReq);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`intel-core listening on :${PORT}`);
  console.log(`  GET /v1/sources — list registered sources`);
  console.log(`  GET /v1/all     — fetch every source in parallel`);
  console.log(`  GET /v1/<name>  — fetch one source, e.g. /v1/earthquakes`);
});
