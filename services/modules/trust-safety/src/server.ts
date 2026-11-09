import { createServer } from 'node:http';
import { investigate } from './profile/investigate.js';
import { addWatchlistEntry, listAlerts, listWatchlist, removeWatchlistEntry, runCheck, startScheduler } from './watchlist/engine.js';
import type { WatchlistKind } from './watchlist/types.js';

const PORT = Number(process.env.PORT || 4300);
const VALID_KINDS: WatchlistKind[] = ['domain', 'ip', 'mastodon-hashtag', 'telegram-channel'];

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
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

  if (url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', module: 'trust-safety', timestamp: new Date().toISOString() });
  }

  if (url.pathname === '/v1/investigate' && req.method === 'GET') {
    if (!params.target) return sendJson(res, 400, { error: 'target query parameter is required' });
    try {
      const profile = await investigate(params.target);
      return sendJson(res, 200, profile);
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  }

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

  return sendJson(res, 404, { error: 'Not found' });
});

startScheduler();

server.listen(PORT, () => {
  console.log(`trust-safety module listening on :${PORT}`);
  console.log(`  foundation (intel-core) at ${process.env.INTEL_CORE_URL || 'http://localhost:4100'}`);
  console.log(`  enrichment-runners at ${process.env.ENRICHMENT_RUNNERS_URL || 'http://localhost:4200'}`);
  console.log(`  GET  /v1/investigate?target=<anything> — single-input profile synthesis`);
  console.log(`  GET  /v1/watchlist           — list watchlist entries`);
  console.log(`  POST /v1/watchlist           — add one: {"kind":"domain","target":"example.com"}`);
  console.log(`  DEL  /v1/watchlist/<id>      — remove one`);
  console.log(`  POST /v1/watchlist/<id>/check — run a check immediately, bypassing the schedule`);
  console.log(`  GET  /v1/alerts              — list alerts (optional ?since=<ISO timestamp>)`);
});
