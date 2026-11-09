import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchJson, settleAll } from '../lib/http.js';
import { TtlCache } from '../lib/cache.js';

interface FlightPayload {
  callsign: string;
  alt: number;
  heading: number;
  speed_knots: number | null;
  model: string;
  icao24: string;
  registration: string;
  squawk: string;
  airline_code: string;
  aircraft_category: 'heli' | 'plane';
  category: 'commercial' | 'private' | 'jet' | 'military';
  grounded: boolean;
}

const REGIONS = [
  { lat: 39.8, lon: -98.5, dist: 2000 },
  { lat: 50.0, lon: 15.0, dist: 2000 },
  { lat: 35.0, lon: 105.0, dist: 2000 },
  { lat: -25.0, lon: 133.0, dist: 2000 },
  { lat: 0.0, lon: 20.0, dist: 2500 },
  { lat: -15.0, lon: -60.0, dist: 2000 },
];

const HELI_TYPES = new Set([
  'R22', 'R44', 'R66', 'B06', 'B06T', 'B204', 'B205', 'B206', 'B212', 'B222', 'B230',
  'B407', 'B412', 'B427', 'B429', 'B430', 'B505', 'B525',
  'AS32', 'AS35', 'AS50', 'AS55', 'AS65',
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75',
  'H125', 'H130', 'H135', 'H145', 'H155', 'H160', 'H175', 'H215', 'H225',
  'S55', 'S58', 'S61', 'S64', 'S70', 'S76', 'S92',
  'A109', 'A119', 'A139', 'A169', 'A189', 'AW09',
]);

const PRIVATE_JET_TYPES = new Set([
  'G150', 'G200', 'G280', 'GLEX', 'G500', 'G550', 'G600', 'G650', 'G700',
  'GLF2', 'GLF3', 'GLF4', 'GLF5', 'GLF6', 'GL5T', 'GL7T', 'GV', 'GIV',
  'CL30', 'CL35', 'CL60', 'BD70', 'BD10',
  'C25A', 'C25B', 'C25C', 'C500', 'C510', 'C525', 'C550', 'C560', 'C56X', 'C680', 'C700', 'C750',
  'FA50', 'FA7X', 'FA8X', 'F900', 'F2TH',
  'LJ35', 'LJ40', 'LJ45', 'LJ60', 'LJ70', 'LJ75',
]);

const MILITARY_INDICATORS = new Set([
  'C17', 'C5M', 'C130', 'C30J', 'KC10', 'KC46', 'KC35', 'E3CF', 'E3TF', 'E8A',
  'B1B', 'B2', 'B52', 'F16', 'F15', 'F18', 'F22', 'F35', 'A10', 'F117',
  'RC135', 'E6B', 'P8A', 'P3', 'MQ9', 'RQ4', 'U2', 'EP3', 'RC12',
  'V22', 'CH47', 'UH60', 'AH64', 'AH1Z', 'MV22',
]);

const COMMERCIAL_TYPES = new Set([
  'A319', 'A320', 'A321', 'A332', 'A333', 'A339', 'A343', 'A359', 'A388',
  'B737', 'B738', 'B739', 'B38M', 'B39M', 'B752', 'B753', 'B763', 'B764', 'B772', 'B77L', 'B77W', 'B788', 'B789', 'B78X',
  'E170', 'E175', 'E190', 'E195', 'CRJ7', 'CRJ9', 'AT43', 'AT72', 'DH8D',
]);

const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;
const JAMMING_NACAP_THRESHOLD = 4;
const cache = new TtlCache<SourceResult<FlightPayload | { severity: number; aircraft_count: number }>>(45_000);

async function fetchRegion(region: typeof REGIONS[0]): Promise<any[]> {
  const url = `https://api.adsb.lol/v2/lat/${region.lat}/lon/${region.lon}/dist/${region.dist}`;
  const data = await fetchJson<any>(url, { timeoutMs: 12_000 });
  return data?.ac || [];
}

function classifyFlight(f: any): IntelItem<FlightPayload> | null {
  const modelUpper = (f.t || '').toUpperCase();
  if (modelUpper === 'TWR') return null;
  if (f.lat == null || f.lon == null) return null;

  const flightStr = (f.flight || '').trim().toUpperCase();
  const callsign = flightStr || f.hex || 'UNKNOWN';
  const altMeters = typeof f.alt_baro === 'number' ? f.alt_baro * 0.3048 : 0;
  const isGrounded = typeof f.alt_baro === 'number' && f.alt_baro < 100;
  const airlineMatch = AIRLINE_CODE_RE.exec(callsign);
  const airlineCode = airlineMatch ? airlineMatch[1] : '';

  let category: FlightPayload['category'] = 'commercial';
  if ((f.dbFlags || 0) & 1 || MILITARY_INDICATORS.has(modelUpper) || /^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i.test(f.flight || '')) {
    category = 'military';
  } else if (PRIVATE_JET_TYPES.has(modelUpper)) {
    category = 'jet';
  } else if (!airlineCode && modelUpper && !COMMERCIAL_TYPES.has(modelUpper)) {
    category = 'private';
  }

  return {
    type: 'flight',
    id: f.hex || callsign,
    lat: Math.round(f.lat * 100000) / 100000,
    lng: Math.round(f.lon * 100000) / 100000,
    timestamp: new Date().toISOString(),
    source: 'adsb.lol',
    confidence: 'live',
    payload: {
      callsign,
      alt: Math.round(altMeters),
      heading: Math.round(f.track || 0),
      speed_knots: typeof f.gs === 'number' ? Math.round(f.gs * 10) / 10 : null,
      model: f.t || 'Unknown',
      icao24: f.hex || '',
      registration: f.r || 'N/A',
      squawk: f.squawk || '',
      airline_code: airlineCode,
      aircraft_category: HELI_TYPES.has(modelUpper) ? 'heli' : 'plane',
      category,
      grounded: isGrounded,
      // nac_p kept off the normalized payload (jamming is derived separately below)
    },
  };
}

interface JammingZonePayload {
  severity: number;
  aircraft_count: number;
}

function aggregateJammingZones(flights: Array<{ lat: number; lng: number; nac_p: number }>): IntelItem<JammingZonePayload>[] {
  const grid = new Map<string, { lat: number; lng: number; count: number; total_nac_p: number }>();
  const GRID_SIZE = 2;
  for (const p of flights) {
    const gLat = Math.floor(p.lat / GRID_SIZE) * GRID_SIZE;
    const gLng = Math.floor(p.lng / GRID_SIZE) * GRID_SIZE;
    const key = `${gLat},${gLng}`;
    const cell = grid.get(key) ?? { lat: gLat + GRID_SIZE / 2, lng: gLng + GRID_SIZE / 2, count: 0, total_nac_p: 0 };
    cell.count++;
    cell.total_nac_p += p.nac_p;
    grid.set(key, cell);
  }
  const now = new Date().toISOString();
  return Array.from(grid.entries())
    .filter(([, z]) => z.count >= 3)
    .map(([key, z]) => ({
      type: 'gps-jamming-zone',
      id: `jamming-${key}`,
      lat: z.lat,
      lng: z.lng,
      timestamp: now,
      source: 'adsb.lol-derived',
      confidence: 'derived' as const,
      payload: { severity: Math.round((1 - z.total_nac_p / z.count / JAMMING_NACAP_THRESHOLD) * 100), aircraft_count: z.count },
    }));
}

async function fetchFlights(): Promise<SourceResult<FlightPayload | JammingZonePayload>> {
  const regionResults = await settleAll(REGIONS.map(fetchRegion));
  const now = new Date().toISOString();
  const seenHex = new Set<string>();
  const items: IntelItem<FlightPayload>[] = [];
  const jammingCandidates: Array<{ lat: number; lng: number; nac_p: number }> = [];

  for (const raw of regionResults.flat()) {
    const hex = (raw.hex || '').toLowerCase().trim();
    if (!hex || seenHex.has(hex)) continue;
    seenHex.add(hex);

    const flight = classifyFlight(raw);
    if (!flight) continue;
    items.push(flight);

    if (typeof raw.nac_p === 'number' && raw.nac_p <= JAMMING_NACAP_THRESHOLD && !flight.payload.grounded) {
      jammingCandidates.push({ lat: flight.lat!, lng: flight.lng!, nac_p: raw.nac_p });
    }
  }

  return {
    source: 'adsb.lol',
    fetchedAt: now,
    items: [...items, ...aggregateJammingZones(jammingCandidates)],
    error: items.length === 0 ? 'No flight data available' : undefined,
  };
}

export const flightsSource: SourceDefinition = {
  name: 'flights',
  tier: 'keep',
  fetch: () => cache.get(fetchFlights),
};
