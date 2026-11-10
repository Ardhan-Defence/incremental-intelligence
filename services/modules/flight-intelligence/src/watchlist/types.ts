export type WatchlistKind = 'tail-number' | 'callsign-pattern';

export interface WatchlistEntry {
  id: string;
  kind: WatchlistKind;
  /** tail-number: an exact registration mark (e.g. "VT-ABC"). callsign-pattern:
   * a prefix to match against live callsigns (e.g. "AIC" for Air India, or a
   * specific flight number like "AIC440"). */
  target: string;
  intervalMs: number;
  createdAt: string;
  lastCheckedAt?: string;
  nextRunAt: number;
  /** icao24 hex codes seen airborne as of the last check — the fingerprint
   * for this watchlist kind. A tail number/pattern going from "absent" to
   * "present" is the alert-worthy event (it started flying); the engine's
   * generic new-item diff gives this for free. */
  lastFingerprint: string[];
}

export interface Alert {
  id: string;
  watchlistId: string;
  kind: WatchlistKind;
  target: string;
  timestamp: string;
  summary: string;
  detail: Record<string, unknown>;
}

/** Same contract as trust-safety's CheckResult: `error` must short-circuit
 * before the engine overwrites `lastFingerprint`, so a transient adsb.lol
 * outage can't be read as "every tracked aircraft stopped flying" and then
 * "they're all airborne again" on the next successful poll. */
export interface CheckResult {
  fingerprint: string[];
  detail: Record<string, unknown>;
  error?: string;
}
