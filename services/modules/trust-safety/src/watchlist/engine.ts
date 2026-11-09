import { randomUUID } from 'node:crypto';
import { JsonStore } from '../lib/jsonStore.js';
import { CHECKS, DEFAULT_INTERVAL_MS } from './checks.js';
import type { Alert, WatchlistEntry, WatchlistKind } from './types.js';

const DATA_DIR = process.env.TRUST_SAFETY_DATA_DIR || new URL('../../data', import.meta.url).pathname;

const watchlistStore = new JsonStore<WatchlistEntry>(`${DATA_DIR}/watchlist.json`);
const alertStore = new JsonStore<Alert>(`${DATA_DIR}/alerts.json`);

export function addWatchlistEntry(kind: WatchlistKind, target: string, intervalMs?: number): WatchlistEntry {
  const entry: WatchlistEntry = {
    id: randomUUID(),
    kind,
    target,
    intervalMs: intervalMs ?? DEFAULT_INTERVAL_MS[kind],
    createdAt: new Date().toISOString(),
    nextRunAt: Date.now(), // check immediately on creation
    lastFingerprint: [],
  };
  return watchlistStore.add(entry);
}

export function listWatchlist(): WatchlistEntry[] {
  return watchlistStore.all();
}

export function removeWatchlistEntry(id: string): boolean {
  return watchlistStore.remove((e) => e.id === id);
}

export function listAlerts(sinceIso?: string): Alert[] {
  const all = alertStore.all();
  if (!sinceIso) return all;
  return all.filter((a) => a.timestamp >= sinceIso);
}

/**
 * Runs one entry's check now, diffs against its stored fingerprint, and
 * records an alert if anything new showed up. First-ever run never alerts
 * (nothing to compare against) — it just establishes the baseline.
 */
export async function runCheck(entry: WatchlistEntry): Promise<Alert | null> {
  const checkFn = CHECKS[entry.kind];
  const result = await checkFn(entry.target);

  // A failed check must never overwrite a real fingerprint with an empty
  // one — that would make every real item look "new" on the next successful
  // check. Reschedule and leave lastFingerprint untouched; the next tick
  // just retries against the same baseline.
  if (result.error) {
    watchlistStore.update(
      (e) => e.id === entry.id,
      (e) => {
        e.lastCheckedAt = new Date().toISOString();
        e.nextRunAt = Date.now() + e.intervalMs;
      },
    );
    return null;
  }

  const previous = new Set(entry.lastFingerprint);
  const newItems = result.fingerprint.filter((f) => !previous.has(f));
  const isFirstRun = entry.lastFingerprint.length === 0 && !entry.lastCheckedAt;

  watchlistStore.update(
    (e) => e.id === entry.id,
    (e) => {
      e.lastFingerprint = result.fingerprint;
      e.lastCheckedAt = new Date().toISOString();
      e.nextRunAt = Date.now() + e.intervalMs;
    },
  );

  if (isFirstRun || newItems.length === 0) return null;

  const alert: Alert = {
    id: randomUUID(),
    watchlistId: entry.id,
    kind: entry.kind,
    target: entry.target,
    timestamp: new Date().toISOString(),
    summary: `${newItems.length} new item(s) for ${entry.kind} "${entry.target}"`,
    detail: { newItems, ...result.detail },
  };
  alertStore.add(alert);
  return alert;
}

const TICK_MS = 30_000;
let schedulerHandle: NodeJS.Timeout | null = null;

/** Single global tick checks which entries are due, rather than one timer
 * per entry — simpler lifecycle, no leaked timers when entries are removed. */
export function startScheduler(): void {
  if (schedulerHandle) return;
  schedulerHandle = setInterval(async () => {
    const due = watchlistStore.all().filter((e) => e.nextRunAt <= Date.now());
    for (const entry of due) {
      try {
        await runCheck(entry);
      } catch (err) {
        console.error(`[watchlist] check failed for ${entry.kind}:${entry.target}`, err);
      }
    }
  }, TICK_MS);
}

export function stopScheduler(): void {
  if (schedulerHandle) clearInterval(schedulerHandle);
  schedulerHandle = null;
}
