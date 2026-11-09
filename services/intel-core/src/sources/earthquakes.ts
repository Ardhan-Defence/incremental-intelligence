import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchJson } from '../lib/http.js';
import { TtlCache } from '../lib/cache.js';

interface EarthquakePayload {
  depth: number;
  magnitude: number;
  place: string;
  time: number;
  url: string;
  tsunami: number;
  quakeType: string;
  felt: number | null;
  alert: string | null;
}

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
const cache = new TtlCache<SourceResult<EarthquakePayload>>(60_000);

async function fetchEarthquakes(): Promise<SourceResult<EarthquakePayload>> {
  const data = await fetchJson<any>(USGS_URL, { timeoutMs: 10_000 });
  if (!data) return { source: 'usgs', fetchedAt: new Date().toISOString(), items: [], error: 'USGS unavailable' };

  const items: IntelItem<EarthquakePayload>[] = (data.features || []).map((f: any) => {
    const coords = f.geometry?.coordinates || [0, 0, 0];
    const props = f.properties || {};
    return {
      type: 'earthquake',
      id: f.id,
      lat: coords[1],
      lng: coords[0],
      timestamp: new Date(props.time ?? Date.now()).toISOString(),
      source: 'usgs',
      confidence: 'live',
      payload: {
        depth: coords[2],
        magnitude: props.mag,
        place: props.place,
        time: props.time,
        url: props.url,
        tsunami: props.tsunami,
        quakeType: props.type,
        felt: props.felt ?? null,
        alert: props.alert ?? null,
      },
    };
  });

  return { source: 'usgs', fetchedAt: new Date().toISOString(), items };
}

export const earthquakesSource: SourceDefinition = {
  name: 'earthquakes',
  tier: 'keep',
  fetch: () => cache.get(fetchEarthquakes),
};
