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
 * detail to explain an alert without re-querying the source. */
export interface CheckResult {
  fingerprint: string[];
  detail: Record<string, unknown>;
}
