import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchText, fetchJson } from '../lib/http.js';
import { TtlCache } from '../lib/cache.js';

interface FirePayload {
  brightness: number;
  confidence: string;
  frp: number;
  kind: 'fire' | 'volcano';
}

const FIRMS_SOURCES = [
  { url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv', source: 'nasa-firms-viirs' },
  { url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv', source: 'nasa-firms-modis' },
];
const EONET_VOLCANO_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes&limit=50';
const cache = new TtlCache<SourceResult<FirePayload>>(600_000);

function parseFirmsCsv(csv: string, source: string, now: string): IntelItem<FirePayload>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split(',');
  const idx = (name: string) => header.indexOf(name);
  const latIdx = idx('latitude');
  const lngIdx = idx('longitude');
  const brightIdx = idx('bright_ti4') !== -1 ? idx('bright_ti4') : idx('brightness');
  const confIdx = idx('confidence');
  const dateIdx = idx('acq_date');
  const timeIdx = idx('acq_time');
  const frpIdx = idx('frp');

  const items: IntelItem<FirePayload>[] = [];
  // Cap at ~2000 points globally so a consumer isn't handed an unbounded feed.
  const maxPoints = 2000;
  const step = lines.length > maxPoints ? Math.ceil(lines.length / maxPoints) : 1;

  for (let i = 1; i < lines.length; i += step) {
    const cols = lines[i].split(',');
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);
    if (isNaN(lat) || isNaN(lng)) continue;

    items.push({
      type: 'fire',
      id: `${source}-${i}`,
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      timestamp: cols[dateIdx] && cols[timeIdx] ? `${cols[dateIdx]}T${cols[timeIdx]}` : now,
      source,
      confidence: 'live',
      payload: {
        brightness: parseFloat(cols[brightIdx]) || 0,
        confidence: cols[confIdx] || 'unknown',
        frp: parseFloat(cols[frpIdx]) || 0,
        kind: 'fire',
      },
    });
  }
  return items;
}

async function fetchFires(): Promise<SourceResult<FirePayload>> {
  const now = new Date().toISOString();
  let items: IntelItem<FirePayload>[] = [];
  let primarySource = '';

  for (const { url, source } of FIRMS_SOURCES) {
    const text = await fetchText(url, { timeoutMs: 15_000 });
    if (text && text.includes('latitude') && text.length > 200) {
      const parsed = parseFirmsCsv(text, source, now);
      if (parsed.length > 0) {
        items = parsed;
        primarySource = source;
        break;
      }
    }
  }

  const volcanoData = await fetchJson<any>(EONET_VOLCANO_URL, { timeoutMs: 10_000 });
  if (volcanoData) {
    for (const e of volcanoData.events || []) {
      const geo = e.geometry?.[e.geometry.length - 1];
      if (!geo?.coordinates) continue;
      items.push({
        type: 'volcano',
        id: `eonet-${e.id}`,
        lat: geo.coordinates[1],
        lng: geo.coordinates[0],
        timestamp: geo.date ?? now,
        source: 'nasa-eonet',
        confidence: 'live',
        payload: { brightness: 500, confidence: 'high', frp: 100, kind: 'volcano' },
      });
    }
    if (!primarySource) primarySource = 'nasa-eonet';
  }

  return { source: primarySource || 'unknown', fetchedAt: now, items, error: items.length === 0 ? 'No fire data available' : undefined };
}

export const firesSource: SourceDefinition = {
  name: 'fires',
  tier: 'keep',
  fetch: () => cache.get(fetchFires),
};
