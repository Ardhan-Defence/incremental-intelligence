import { fetchJson } from './http.js';

/**
 * This module's only link back to the foundation: an HTTP call to
 * intel-core, never a direct import of its source code — same "One
 * Foundation, Multiple Modules" boundary as trust-safety's foundationClient.
 */
export const INTEL_CORE_URL = process.env.INTEL_CORE_URL || 'http://localhost:4100';

export interface IntelItem<P = Record<string, unknown>> {
  type: string;
  id: string;
  lat?: number;
  lng?: number;
  timestamp: string;
  source: string;
  confidence: 'live' | 'static' | 'derived';
  payload: P;
}

export interface SourceResult<P = Record<string, unknown>> {
  source: string;
  fetchedAt: string;
  items: IntelItem<P>[];
  error?: string;
}

/** Calls one foundation source by its registered name, e.g. "flights". */
export async function fetchSource<P = Record<string, unknown>>(name: string, params: Record<string, string> = {}): Promise<SourceResult<P>> {
  const qs = new URLSearchParams(params).toString();
  const url = `${INTEL_CORE_URL}/v1/${name}${qs ? `?${qs}` : ''}`;
  const result = await fetchJson<SourceResult<P>>(url, { timeoutMs: 15_000 });
  if (!result) {
    return { source: name, fetchedAt: new Date().toISOString(), items: [], error: `foundation unreachable at ${url}` };
  }
  return result;
}
