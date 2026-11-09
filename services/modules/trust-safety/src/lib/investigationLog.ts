import { JsonStore } from './jsonStore.js';

/**
 * A flat log of every investigation that produced a correlatable
 * identifier (domain, phone, or name) — entity-resolution's /v1/resolve
 * is dedupe_only and compares a batch against itself, not incrementally
 * against the graph (see entity-resolution's README), so correlating a new
 * investigation against everything seen before means resending this whole
 * log each time. Fine at this scale; revisit if this log grows into the
 * thousands and resolve() calls get slow.
 */
export interface LoggedRecord {
  unique_id: string;
  name?: string;
  domain?: string;
  phone?: string;
  email?: string;
}

const DATA_DIR = process.env.TRUST_SAFETY_DATA_DIR || new URL('../../data', import.meta.url).pathname;
const store = new JsonStore<LoggedRecord>(`${DATA_DIR}/investigations.json`);

export function appendRecord(record: LoggedRecord): void {
  const already = store.all().some((r) => r.unique_id === record.unique_id);
  if (already) return; // re-investigating the same target shouldn't duplicate the log entry
  store.add(record);
}

export function allRecords(): LoggedRecord[] {
  return store.all();
}
