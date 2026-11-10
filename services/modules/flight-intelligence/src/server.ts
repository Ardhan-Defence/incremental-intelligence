import { createServer } from 'node:http';
import { addWatchlistEntry, listAlerts, listWatchlist, removeWatchlistEntry, runCheck, startScheduler } from './watchlist/engine.js';
import type { WatchlistKind } from './watchlist/types.js';
import { correlateAsset } from './assets/correlate.js';
import { getTrack } from './playback/positionLog.js';

const PORT = Number(process.env.PORT || 4500);
const VALID_KINDS: WatchlistKind[] = ['tail-number', 'callsign-pattern'];

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
    return sendJson(res, 200, { status: 'ok', module: 'flight-intelligence', timestamp: new Date().toISOString() });
  }

  if (url.pathname === '/v1/asset' && req.method === 'GET') {
    if (!params.registration && !params.icao24) {
      return sendJson(res, 400, { error: 'registration or icao24 query parameter is required' });
    }
    try {
      const result = await correlateAsset({ registration: params.registration, icao24: params.icao24 });
      return sendJson(res, 200, result);
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

  if (url.pathname === '/v1/playback' && req.method === 'GET') {
    if (!params.registration) return sendJson(res, 400, { error: 'registration query parameter is required' });
    const track = getTrack(params.registration, params.since, params.until);
    return sendJson(res, 200, { registration: params.registration.toUpperCase(), point_count: track.length, track });
  }

  return sendJson(res, 404, { error: 'Not found' });
});

startScheduler();

server.listen(PORT, () => {
  console.log(`flight-intelligence module listening on :${PORT}`);
  console.log(`  foundation (intel-core) at ${process.env.INTEL_CORE_URL || 'http://localhost:4100'}`);
  console.log(`  entity-resolution at ${process.env.ENTITY_RESOLUTION_URL || 'http://localhost:4400'}`);
  console.log(`  GET  /v1/asset?registration=<tail>|icao24=<hex> — asset correlation across identifiers seen in the live feed`);
  console.log(`  GET  /v1/watchlist            — list watchlist entries`);
  console.log(`  POST /v1/watchlist            — add one: {"kind":"tail-number","target":"VT-ABC"} or {"kind":"callsign-pattern","target":"AIC"}`);
  console.log(`  DEL  /v1/watchlist/<id>       — remove one`);
  console.log(`  POST /v1/watchlist/<id>/check — run a check immediately, bypassing the schedule`);
  console.log(`  GET  /v1/alerts               — list alerts (optional ?since=<ISO timestamp>)`);
  console.log(`  GET  /v1/playback?registration=<tail>[&since=][&until=] — recorded position history for a tail-number watchlist entry`);
});
