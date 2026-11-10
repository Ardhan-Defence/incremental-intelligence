import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { TtlCache } from '../lib/cache.js';

interface SpaceWeatherPayload {
  kp_index?: number;
  storm_level?: string;
  alert_message?: string;
  flare_class?: string;
  flare_begin?: string;
  flare_peak?: string;
}

const cache = new TtlCache<SourceResult<SpaceWeatherPayload>>(120_000);

function stormLevel(kp: number): string {
  if (kp >= 8) return 'Extreme (G5)';
  if (kp >= 7) return 'Severe (G4)';
  if (kp >= 6) return 'Strong (G3)';
  if (kp >= 5) return 'Moderate (G2)';
  if (kp >= 4) return 'Minor (G1)';
  if (kp >= 3) return 'Unsettled';
  return 'Quiet';
}

async function fetchSpaceWeather(): Promise<SourceResult<SpaceWeatherPayload>> {
  const [kpData, alertsData, flareData] = await Promise.all([
    fetchJson<any[]>('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json'),
    fetchJson<any[]>('https://services.swpc.noaa.gov/json/alerts.json'),
    fetchJson<any[]>('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json'),
  ]);

  const now = new Date().toISOString();
  const items: IntelItem<SpaceWeatherPayload>[] = [];

  if (Array.isArray(kpData) && kpData.length > 0) {
    const latest = kpData[kpData.length - 1];
    const kp = parseFloat(latest.kp_index ?? latest.Kp ?? 0);
    items.push({
      type: 'space-weather-kp',
      id: `kp-${latest.time_tag ?? now}`,
      timestamp: latest.time_tag ?? now,
      source: 'noaa-swpc',
      confidence: 'live',
      payload: { kp_index: kp, storm_level: stormLevel(kp) },
    });
  }

  for (const alert of (Array.isArray(alertsData) ? alertsData : []).slice(0, 10)) {
    items.push({
      type: 'space-weather-alert',
      id: alert.product_id ?? `alert-${Date.now()}-${items.length}`,
      timestamp: alert.issue_datetime ?? now,
      source: 'noaa-swpc',
      confidence: 'live',
      payload: { alert_message: (alert.message || '').substring(0, 200) },
    });
  }

  for (const flare of (Array.isArray(flareData) ? flareData : []).slice(0, 5)) {
    if (!flare.max_class) continue;
    items.push({
      type: 'solar-flare',
      id: `flare-${flare.begin_time ?? items.length}`,
      timestamp: flare.max_time ?? flare.begin_time ?? now,
      source: 'noaa-swpc',
      confidence: 'live',
      payload: { flare_class: flare.max_class, flare_begin: flare.begin_time, flare_peak: flare.max_time },
    });
  }

  return { source: 'noaa-swpc', fetchedAt: now, items };
}

export const spaceWeatherSource: SourceDefinition = {
  name: 'space-weather',
  tier: 'keep',
  fetch: () => cache.get(fetchSpaceWeather),
};
