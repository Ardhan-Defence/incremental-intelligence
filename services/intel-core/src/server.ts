import { createServer } from 'node:http';
import { SOURCES, listSources } from './sources/registry.js';
import { addWatchlistEntry, listAlerts, listWatchlist, removeWatchlistEntry, runCheck, startScheduler } from './watchlist/engine.js';
import type { WatchlistKind } from './watchlist/types.js';

const PORT = Number(process.env.PORT || 4100);
const VALID_KINDS: WatchlistKind[] = ['domain', 'ip', 'mastodon-hashtag', 'telegram-channel'];

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

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
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

  // ── Watchlist / alerting ──
  if (url.pathname === '/v1/watchlist' && req.method === 'GET') {
    return sendJson(res, 200, { entries: listWatchlist() });
  }

  if (url.pathname === '/v1/watchlist' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!VALID_KINDS.includes(body.kind)) {
        return sendJson(res, 400, { error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
      }
      if (!body.target || typeof body.target !== 'string') {
        return sendJson(res, 400, { error: 'target (string) is required' });
      }
      const entry = addWatchlistEntry(body.kind, body.target, body.intervalMs);
      return sendJson(res, 201, entry);
    } catch (err) {
      return sendJson(res, 400, { error: `Invalid request body: ${err}` });
    }
  }

  const watchlistMatch = url.pathname.match(/^\/v1\/watchlist\/([^/]+)$/);
  if (watchlistMatch && req.method === 'DELETE') {
    const removed = removeWatchlistEntry(watchlistMatch[1]);
    return sendJson(res, removed ? 200 : 404, { removed });
  }

  const checkNowMatch = url.pathname.match(/^\/v1\/watchlist\/([^/]+)\/check$/);
  if (checkNowMatch && req.method === 'POST') {
    const entry = listWatchlist().find((e) => e.id === checkNowMatch[1]);
    if (!entry) return sendJson(res, 404, { error: 'Unknown watchlist entry' });
    try {
      const alert = await runCheck(entry);
      return sendJson(res, 200, { alert });
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  }

  if (url.pathname === '/v1/alerts' && req.method === 'GET') {
    return sendJson(res, 200, { alerts: listAlerts(params.since) });
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

startScheduler();

server.listen(PORT, () => {
  console.log(`intel-core listening on :${PORT}`);
  console.log(`  GET  /v1/sources             — list registered sources`);
  console.log(`  GET  /v1/all                 — fetch every source in parallel`);
  console.log(`  GET  /v1/<name>              — fetch one source, e.g. /v1/earthquakes`);
  console.log(`  GET  /v1/watchlist           — list watchlist entries`);
  console.log(`  POST /v1/watchlist           — add one: {"kind":"domain","target":"example.com"}`);
  console.log(`  DEL  /v1/watchlist/<id>      — remove one`);
  console.log(`  POST /v1/watchlist/<id>/check — run a check immediately, bypassing the schedule`);
  console.log(`  GET  /v1/alerts              — list alerts (optional ?since=<ISO timestamp>)`);
});
