import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchText, settleAll } from '../lib/http.js';
import { TtlCache } from '../lib/cache.js';

interface SatellitePayload {
  name: string;
  alt_km: number;
  mission: string;
}

const MISSION_CLASSIFY: Record<string, string> = {
  USA: 'Military Recon', NROL: 'NRO Classified', LACROSSE: 'SAR Imaging',
  MENTOR: 'SIGINT', ORION: 'SIGINT', TRUMPET: 'SIGINT',
  GPS: 'Navigation', NAVSTAR: 'Navigation', GLONASS: 'Navigation', GALILEO: 'Navigation', BEIDOU: 'Navigation',
  SBIRS: 'Early Warning', DSP: 'Early Warning',
  STARLINK: 'Commercial Comms', ONEWEB: 'Commercial Comms',
  PLANET: 'Earth Imaging', WORLDVIEW: 'Commercial Imaging',
  ISS: 'Space Station', TIANGONG: 'Space Station',
  COSMOS: 'Russian Military', YAOGAN: 'Chinese Recon',
  FENGYUN: 'Weather', GOES: 'Weather', NOAA: 'Weather', METEOSAT: 'Weather',
  LANDSAT: 'Earth Observation', SENTINEL: 'Earth Observation', TERRA: 'Earth Science', AQUA: 'Earth Science',
  HUBBLE: 'Space Telescope', 'JAMES WEBB': 'Space Telescope',
};

const TLE_GROUPS = ['stations', 'visual', 'weather', 'resource', 'sarsat', 'gps-ops', 'glo-ops', 'galileo', 'beidou', 'military', 'science', 'geodetic', 'engineering', 'education', 'starlink', 'active'];
const cache = new TtlCache<SourceResult<SatellitePayload>>(120_000);

function classifySatellite(name: string): string {
  const upper = name.toUpperCase();
  for (const [keyword, mission] of Object.entries(MISSION_CLASSIFY)) {
    if (upper.includes(keyword)) return mission;
  }
  return 'Unknown';
}

function gmst(jd: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  const gmstSec = 67310.54841 + (876600.0 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  return ((gmstSec % 86400) / 86400.0) * 2 * Math.PI;
}

function parseTLE(tleText: string): Array<{ name: string; line1: string; line2: string }> {
  const lines = tleText.trim().split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const sats: Array<{ name: string; line1: string; line2: string }> = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1?.startsWith('1 ') || !line2?.startsWith('2 ')) continue;
    if (name.startsWith('1 ') || name.startsWith('2 ')) continue;
    sats.push({ name, line1, line2 });
    i += 2;
  }
  return sats;
}

/**
 * Simplified Keplerian propagation — NOT a full SGP4 implementation (no drag,
 * no perturbation terms). Ported as-is from the original route; good enough
 * for a map visualization, not for anything requiring real orbital precision.
 */
function propagateSimplified(line1: string, line2: string): { lat: number; lng: number; alt: number } | null {
  try {
    const incDeg = parseFloat(line2.substring(8, 16));
    const raanDeg = parseFloat(line2.substring(17, 25));
    const ecc = parseFloat('0.' + line2.substring(26, 33).trim());
    const argPerDeg = parseFloat(line2.substring(34, 42));
    const meanAnomDeg = parseFloat(line2.substring(43, 51));
    const meanMotion = parseFloat(line2.substring(52, 63));
    if (isNaN(meanMotion) || meanMotion === 0) return null;

    const now = new Date();
    const epochYear = parseInt(line1.substring(18, 20));
    const epochDay = parseFloat(line1.substring(20, 32));
    const fullYear = epochYear > 56 ? 1900 + epochYear : 2000 + epochYear;
    const epochDate = new Date(fullYear, 0, 1);
    epochDate.setDate(epochDate.getDate() + epochDay - 1);
    const elapsedMin = (now.getTime() - epochDate.getTime()) / 60000;
    if (Math.abs(elapsedMin) > 43200) return null; // stale TLE (>30 days)

    const n = (meanMotion * 2 * Math.PI) / 1440;
    const M = ((meanAnomDeg * Math.PI) / 180 + n * elapsedMin) % (2 * Math.PI);

    let E = M;
    for (let j = 0; j < 10; j++) E = M + ecc * Math.sin(E);

    const sinV = (Math.sqrt(1 - ecc * ecc) * Math.sin(E)) / (1 - ecc * Math.cos(E));
    const cosV = (Math.cos(E) - ecc) / (1 - ecc * Math.cos(E));
    const v = Math.atan2(sinV, cosV);

    const a = Math.pow(398600.4418 / ((meanMotion * 2 * Math.PI) / 86400) ** 2, 1 / 3);
    const r = a * (1 - ecc * Math.cos(E));

    const inc = (incDeg * Math.PI) / 180;
    const raan = (raanDeg * Math.PI) / 180;
    const argPer = (argPerDeg * Math.PI) / 180;
    const u = v + argPer;

    const x = r * (Math.cos(raan) * Math.cos(u) - Math.sin(raan) * Math.sin(u) * Math.cos(inc));
    const y = r * (Math.sin(raan) * Math.cos(u) + Math.cos(raan) * Math.sin(u) * Math.cos(inc));
    const z = r * Math.sin(u) * Math.sin(inc);

    const jd = 2440587.5 + now.getTime() / 86400000;
    const theta = gmst(jd);
    const xRot = x * Math.cos(theta) + y * Math.sin(theta);
    const yRot = -x * Math.sin(theta) + y * Math.cos(theta);

    const lng = (Math.atan2(yRot, xRot) * 180) / Math.PI;
    const lat = (Math.atan2(z, Math.sqrt(xRot * xRot + yRot * yRot)) * 180) / Math.PI;
    const alt = r - 6371;

    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90) return null;
    if (alt < 100 || alt > 50000) return null;

    return {
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round((((lng + 540) % 360) - 180) * 10000) / 10000,
      alt: Math.round(alt),
    };
  } catch {
    return null;
  }
}

async function fetchSatellites(): Promise<SourceResult<SatellitePayload>> {
  const texts = await settleAll(
    TLE_GROUPS.map((group) =>
      fetchText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, {
        timeoutMs: 12_000,
        headers: { 'User-Agent': 'IntelCore/0.1' },
      }).then((text) => (text && text.length > 100 && !text.includes('<html') ? text : null)),
    ),
  );

  const seen = new Set<string>();
  const allSats: Array<{ name: string; line1: string; line2: string }> = [];
  for (const text of texts) {
    if (!text) continue;
    for (const sat of parseTLE(text)) {
      if (!seen.has(sat.name)) {
        seen.add(sat.name);
        allSats.push(sat);
      }
    }
  }

  // Sample for performance (max 2000)
  const sampled = allSats.length > 2000 ? allSats.filter((_, i) => i % Math.ceil(allSats.length / 2000) === 0) : allSats;

  const now = new Date().toISOString();
  const items: IntelItem<SatellitePayload>[] = [];
  for (const sat of sampled) {
    const pos = propagateSimplified(sat.line1, sat.line2);
    if (!pos) continue;
    items.push({
      type: 'satellite',
      id: sat.name,
      lat: pos.lat,
      lng: pos.lng,
      timestamp: now,
      source: 'celestrak',
      confidence: 'derived', // position is propagated, not directly observed
      payload: { name: sat.name, alt_km: pos.alt, mission: classifySatellite(sat.name) },
    });
  }

  return { source: 'celestrak', fetchedAt: now, items, error: items.length === 0 ? 'No satellite data available' : undefined };
}

export const satellitesSource: SourceDefinition = {
  name: 'satellites',
  tier: 'keep',
  fetch: () => cache.get(fetchSatellites),
};
