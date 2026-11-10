import { fetchJson } from './http.js';

export const ENTITY_RESOLUTION_URL = process.env.ENTITY_RESOLUTION_URL || 'http://localhost:4400';

export interface EntityRecord {
  unique_id: string;
  name?: string;
  father_name?: string;
  address?: string;
  domain?: string;
  phone?: string;
  email?: string;
}

export interface ResolveResult {
  checked_at: string;
  record_count: number;
  matches: Array<{ left_id: string; right_id: string; match_probability: number }>;
  written_to_graph: boolean;
}

export interface EntityLookupResult {
  found: boolean;
  entity_id: string | null;
  identifiers: Array<{ type: string; value: string }>;
}

export async function resolveRecords(records: EntityRecord[], writeToGraph: boolean): Promise<ResolveResult | null> {
  try {
    const res = await fetch(`${ENTITY_RESOLUTION_URL}/v1/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000), // Splink's EM training takes real time as the log grows
      body: JSON.stringify({ records, write_to_graph: writeToGraph }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ResolveResult;
  } catch {
    return null;
  }
}

export async function lookupEntity(value: string, type: 'domain' | 'phone' | 'email' | 'name' | 'father_name' | 'address'): Promise<EntityLookupResult | null> {
  return fetchJson<EntityLookupResult>(`${ENTITY_RESOLUTION_URL}/v1/entity/lookup?value=${encodeURIComponent(value)}&type=${type}`, { timeoutMs: 10_000 });
}
