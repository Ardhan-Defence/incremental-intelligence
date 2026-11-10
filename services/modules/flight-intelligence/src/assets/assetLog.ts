import { randomUUID } from 'node:crypto';
import { JsonStore } from '../lib/jsonStore.js';

/**
 * A flat log of every DISTINCT (icao24, registration, operator_code)
 * combination ever seen — same dedupe_only-against-the-whole-log pattern
 * as trust-safety's investigationLog (entity-resolution has no incremental
 * mode; see its README).
 *
 * Deliberately NOT deduped/overwritten by icao24 alone: the actual
 * correlation value here is catching an icao24 that has flown under more
 * than one registration/operator over time (re-registration, resale,
 * repaint) or a registration that has appeared under more than one icao24
 * (re-assignment, or a conflicting/duplicate broadcast worth flagging).
 * Splink's blocking on icao24 and on registration separately is what
 * surfaces either direction — a 1:1-only log would hide exactly the cases
 * this exists to find.
 */
export interface LoggedAsset {
  unique_id: string;
  icao24: string;
  registration?: string;
  operator_code?: string;
}

const DATA_DIR = process.env.FLIGHT_INTELLIGENCE_DATA_DIR || new URL('../../data', import.meta.url).pathname;
const store = new JsonStore<LoggedAsset>(`${DATA_DIR}/assets.json`);

export function appendAsset(asset: Omit<LoggedAsset, 'unique_id'>): void {
  const already = store.all().some(
    (a) => a.icao24 === asset.icao24 && a.registration === asset.registration && a.operator_code === asset.operator_code,
  );
  if (already) return;
  store.add({ unique_id: randomUUID(), ...asset });
}

export function allAssets(): LoggedAsset[] {
  return store.all();
}
