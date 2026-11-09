import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { TtlCache } from '../lib/cache.js';

interface ConflictEventPayload {
  conflict_name: string;
  dyad_name: string;
  side_a: string;
  side_b: string;
  type_of_violence: number; // 1=state-based, 2=non-state, 3=one-sided
  deaths_best: number;
  date_start: string;
  date_end: string;
  country: string;
  region: string;
  source_headline?: string;
}

// UCDP Georeferenced Event Dataset — global, not Ukraine-specific like the
// dropped DeepState source. Requires an access token (request one from the
// UCDP API maintainer: https://ucdp.uu.se/apidocs/). Free, CC BY 4.0.
const UCDP_API_BASE = 'https://ucdpapi.pcr.uu.se/api';
const GED_VERSION = '26.1'; // UCDP requires a version on every call — bump when UCDP ships a new one
const PAGE_SIZE = 200;
const ACCESS_TOKEN = process.env.UCDP_ACCESS_TOKEN || '';

const cache = new TtlCache<SourceResult<ConflictEventPayload>>(3_600_000); // UCDP GED updates are not sub-hourly

async function fetchUcdp(): Promise<SourceResult<ConflictEventPayload>> {
  const now = new Date().toISOString();

  if (!ACCESS_TOKEN) {
    return {
      source: 'ucdp-ged',
      fetchedAt: now,
      items: [],
      error: 'UCDP_ACCESS_TOKEN not set — request a token at https://ucdp.uu.se/apidocs/ (describe your use case to the maintainer) and set it as an env var.',
    };
  }

  // Last 30 days of events, newest first via StartDate filter — UCDP GED
  // filters on date_end. Pull one page; UCDP's quota is 5,000 req/day so
  // paginating further is viable later but unnecessary for a first pass.
  const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const url = `${UCDP_API_BASE}/gedevents/${GED_VERSION}?pagesize=${PAGE_SIZE}&StartDate=${startDate}`;

  const data = await fetchJson<any>(url, {
    timeoutMs: 15_000,
    headers: { 'x-ucdp-access-token': ACCESS_TOKEN },
  });

  if (!data) {
    return { source: 'ucdp-ged', fetchedAt: now, items: [], error: 'UCDP API unavailable' };
  }

  const items: IntelItem<ConflictEventPayload>[] = (data.Result || []).map((e: any) => ({
    type: 'conflict-event',
    id: `ucdp-${e.id}`,
    lat: e.latitude,
    lng: e.longitude,
    timestamp: e.date_end ?? now,
    source: 'ucdp-ged',
    confidence: 'live',
    payload: {
      conflict_name: e.conflict_name,
      dyad_name: e.dyad_name,
      side_a: e.side_a,
      side_b: e.side_b,
      type_of_violence: e.type_of_violence,
      deaths_best: e.best,
      date_start: e.date_start,
      date_end: e.date_end,
      country: e.country,
      region: e.region,
      source_headline: e.source_headline,
    },
  }));

  return { source: 'ucdp-ged', fetchedAt: now, items };
}

export const ucdpSource: SourceDefinition = {
  name: 'conflict-events',
  tier: 'keep',
  fetch: () => cache.get(fetchUcdp),
};
