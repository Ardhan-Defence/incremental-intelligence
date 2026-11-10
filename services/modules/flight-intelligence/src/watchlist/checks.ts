import type { CheckResult, WatchlistKind } from './types.js';
import { fetchSource } from '../lib/foundationClient.js';

interface FlightPayload {
  callsign: string;
  registration: string;
  icao24: string;
  airline_code: string;
  category: string;
  aircraft_category: string;
  model: string;
  grounded: boolean;
}

/**
 * Both checks share one call to the foundation's `flights` source — a
 * single global live-position snapshot (not a per-target query; adsb.lol
 * has no "give me this one tail number" endpoint), then filter locally.
 * Honest limitation: this is a live ADS-B position feed, not a filed
 * flight-plan database — there is no origin/destination "route" here, only
 * current callsign/registration. "Route" watchlists are approximated as a
 * callsign-prefix match (an airline or flight-number code), not a true
 * city-pair.
 */
async function fetchLiveFlights(): Promise<{ items: Array<{ id: string; payload: FlightPayload }>; error?: string }> {
  const result = await fetchSource<FlightPayload>('flights');
  if (result.error) return { items: [], error: result.error };
  return { items: result.items.filter((i) => i.type === 'flight') as any };
}

async function checkTailNumber(target: string): Promise<CheckResult> {
  const { items, error } = await fetchLiveFlights();
  if (error) return { fingerprint: [], detail: {}, error: `flights lookup failed: ${error}` };

  const needle = target.trim().toUpperCase();
  const matches = items.filter((i) => (i.payload.registration || '').toUpperCase() === needle);

  return {
    fingerprint: matches.map((i) => `icao24:${i.payload.icao24 || i.id}`),
    detail: {
      airborne_count: matches.length,
      sightings: matches.map((i) => ({
        callsign: i.payload.callsign,
        icao24: i.payload.icao24,
        model: i.payload.model,
        category: i.payload.category,
        grounded: i.payload.grounded,
      })),
    },
  };
}

async function checkCallsignPattern(target: string): Promise<CheckResult> {
  const { items, error } = await fetchLiveFlights();
  if (error) return { fingerprint: [], detail: {}, error: `flights lookup failed: ${error}` };

  const prefix = target.trim().toUpperCase();
  const matches = items.filter((i) => (i.payload.callsign || '').toUpperCase().startsWith(prefix));

  return {
    fingerprint: matches.map((i) => `icao24:${i.payload.icao24 || i.id}`),
    detail: {
      airborne_count: matches.length,
      sightings: matches.map((i) => ({
        callsign: i.payload.callsign,
        registration: i.payload.registration,
        icao24: i.payload.icao24,
        category: i.payload.category,
      })),
    },
  };
}

export const CHECKS: Record<WatchlistKind, (target: string) => Promise<CheckResult>> = {
  'tail-number': checkTailNumber,
  'callsign-pattern': checkCallsignPattern,
};

export const DEFAULT_INTERVAL_MS: Record<WatchlistKind, number> = {
  // adsb.lol's own feed/cache updates on a similar cadence; polling faster
  // just re-reads the same cached snapshot (intel-core's flights source
  // caches for 45s — see foundation/intel-core/src/sources/flights.ts).
  'tail-number': 60_000,
  'callsign-pattern': 60_000,
};
