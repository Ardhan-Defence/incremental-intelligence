import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { TtlCache } from '../lib/cache.js';

interface AirQualityPayload {
  name: string;
  city: string;
  country: string;
  pm25: number;
  unit: string;
  level: string;
}

const OPENAQ_URL = 'https://api.openaq.org/v2/latest?limit=500&parameter=pm25&order_by=lastUpdated&sort=desc';
const cache = new TtlCache<SourceResult<AirQualityPayload>>(600_000);

function aqiLevel(pm25: number): string {
  if (pm25 > 150) return 'Hazardous';
  if (pm25 > 100) return 'Unhealthy';
  if (pm25 > 55) return 'Unhealthy (Sensitive)';
  if (pm25 > 35) return 'Moderate';
  return 'Good';
}

async function fetchAirQuality(): Promise<SourceResult<AirQualityPayload>> {
  const data = await fetchJson<any>(OPENAQ_URL);
  const now = new Date().toISOString();
  if (!data) return { source: 'openaq', fetchedAt: now, items: [], error: 'OpenAQ unavailable' };

  const items: IntelItem<AirQualityPayload>[] = [];
  for (const loc of data.results || []) {
    if (!loc.coordinates?.latitude || !loc.coordinates?.longitude) continue;
    const pm25 = loc.measurements?.find((m: any) => m.parameter === 'pm25');
    if (!pm25) continue;

    items.push({
      type: 'air-quality-station',
      id: `aq-${loc.location}`,
      lat: loc.coordinates.latitude,
      lng: loc.coordinates.longitude,
      timestamp: pm25.lastUpdated ?? now,
      source: 'openaq',
      confidence: 'live',
      payload: {
        name: loc.location,
        city: loc.city || 'Unknown',
        country: loc.country,
        pm25: pm25.value,
        unit: pm25.unit,
        level: aqiLevel(pm25.value),
      },
    });
  }

  return { source: 'openaq', fetchedAt: now, items };
}

export const airQualitySource: SourceDefinition = {
  name: 'air-quality',
  tier: 'keep',
  fetch: () => cache.get(fetchAirQuality),
};
