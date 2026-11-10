export type WatchlistKind = 'domain' | 'ip' | 'mastodon-hashtag' | 'telegram-channel';

export interface WatchlistEntry {
  id: string;
  kind: WatchlistKind;
  target: string;
  /** Re-check interval in ms. Default chosen per-kind in engine.ts. */
  intervalMs: number;
  createdAt: string;
  lastCheckedAt?: string;
  nextRunAt: number;
  /** Fingerprint from the last check — opaque IDs used to detect "new since last time". */
  lastFingerprint: string[];
}

export interface Alert {
  id: string;
  watchlistId: string;
  kind: WatchlistKind;
  target: string;
  timestamp: string;
  summary: string;
  /** The new fingerprint items that triggered this alert, plus whatever detail the check captured. */
  detail: Record<string, unknown>;
}

/** What a per-kind check function returns: a fresh fingerprint plus enough
 * detail to explain an alert without re-querying the source.
 *
 * `error` matters more than it looks: when set, the engine must NOT persist
 * `fingerprint` as the new baseline. A transient upstream failure (crt.sh,
 * OTX, etc. — all observed to be flaky in practice) must never be allowed to
 * overwrite a real fingerprint with an empty one, or the next successful
 * check sees everything as "new" and fires a false alert for the entire
 * watched state. */
export interface CheckResult {
  fingerprint: string[];
  detail: Record<string, unknown>;
  error?: string;
}
