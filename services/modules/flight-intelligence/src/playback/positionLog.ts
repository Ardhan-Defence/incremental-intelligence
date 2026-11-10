import { JsonStore } from '../lib/jsonStore.js';

/**
 * Position history, scoped deliberately: only recorded for aircraft on a
 * `tail-number` watchlist entry, piggybacked on that entry's existing poll
 * tick — NOT a bulk recorder of the full live feed (~6,800+ aircraft per
 * snapshot globally; a flat JSON append of that every poll would be
 * unbounded and pointless for a module whose actual subjects are specific
 * watched tails). `callsign-pattern` entries can match many aircraft at
 * once and are excluded from history for the same reason.
 *
 * Retained for `RETENTION_MS` (default 7 days) and pruned on every append —
 * bounded growth without a separate cleanup job.
 */
export interface PositionPoint {
  id: string;
  registration: string;
  icao24: string;
  timestamp: string;
  lat: number;
  lng: number;
  alt_m?: number;
  heading?: number;
  speed_knots?: number | null;
  callsign?: string;
  grounded?: boolean;
}

const DATA_DIR = process.env.FLIGHT_INTELLIGENCE_DATA_DIR || new URL('../../data', import.meta.url).pathname;
const store = new JsonStore<PositionPoint>(`${DATA_DIR}/position_history.json`);

const RETENTION_MS = Number(process.env.PLAYBACK_RETENTION_MS || 7 * 24 * 60 * 60 * 1000);

export function recordPosition(point: Omit<PositionPoint, 'id'>): void {
  const id = `${point.registration}:${point.timestamp}`;
  // A tail-number check can run more than once within the same live
  // snapshot's cache window (intel-core caches `flights` for 45s) — same
  // timestamp means the same upstream snapshot, not a new sighting, so
  // skip rather than log an identical duplicate point.
  if (store.all().some((p) => p.id === id)) return;

  store.add({ id, ...point });

  const cutoff = Date.now() - RETENTION_MS;
  store.remove((p) => new Date(p.timestamp).getTime() < cutoff);
}

export function getTrack(registration: string, sinceIso?: string, untilIso?: string): PositionPoint[] {
  const needle = registration.trim().toUpperCase();
  return store
    .all()
    .filter((p) => p.registration.toUpperCase() === needle)
    .filter((p) => (sinceIso ? p.timestamp >= sinceIso : true))
    .filter((p) => (untilIso ? p.timestamp <= untilIso : true))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
