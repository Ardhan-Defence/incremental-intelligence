import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchJson, fetchText } from '../lib/http.js';
import { isRateLimited, getClientIp } from '../lib/ssrf-guard.js';

interface CvePayload {
  name: string;
  vendor: string;
  product: string;
  severity: string;
  due: string;
}

interface PulsePayload {
  name: string;
  description: string;
  tags: string[];
  indicators_count: number;
}

interface IpReputationPayload {
  query: string;
  tor_exit_node: boolean | null;
  pulse_count: number;
  reputation?: number;
}

/**
 * REWORK NEEDED: this merges the original app's two separate, overlapping
 * routes (`cyber-threats` — CISA KEV feed, and `osint/threats` — AlienVault
 * OTX + Tor exit list) into one source rather than shipping both. Still
 * missing: CISA's feed and OTX's "activity" feed are global/unscoped, so a
 * product surfacing this needs its own relevance filtering layer on top —
 * none exists yet.
 */
async function fetchThreatIntel(params: Record<string, string> = {}, req?: Request): Promise<SourceResult<CvePayload | PulsePayload | IpReputationPayload>> {
  const now = new Date().toISOString();
  const items: IntelItem<CvePayload | PulsePayload | IpReputationPayload>[] = [];

  if (req) {
    const clientIp = getClientIp(req);
    if (isRateLimited(clientIp, 20, 60_000)) {
      return { source: 'cisa+otx', fetchedAt: now, items: [], error: 'Rate limit exceeded' };
    }
  }

  const kev = await fetchJson<any>('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', { timeoutMs: 10_000 });
  if (kev) {
    const recent = (kev.vulnerabilities || []).filter((v: any) => (Date.now() - new Date(v.dateAdded).getTime()) / 86_400_000 <= 30);
    for (const v of recent.slice(0, 10)) {
      items.push({
        type: 'cve-known-exploited',
        id: v.cveID,
        timestamp: v.dateAdded,
        source: 'cisa-kev',
        confidence: 'live',
        payload: { name: v.vulnerabilityName, vendor: v.vendorProject, product: v.product, severity: 'CRITICAL', due: v.dueDate },
      });
    }
  }

  const otxActivity = await fetchJson<any>('https://otx.alienvault.com/api/v1/pulses/activity?limit=10', { timeoutMs: 8000 });
  if (otxActivity) {
    for (const p of (otxActivity.results || []).slice(0, 10)) {
      items.push({
        type: 'threat-pulse',
        id: `otx-${p.id ?? p.name}`,
        timestamp: p.created ?? now,
        source: 'alienvault-otx',
        confidence: 'live',
        payload: { name: p.name, description: (p.description || '').slice(0, 200), tags: (p.tags || []).slice(0, 5), indicators_count: p.indicator_count },
      });
    }
  }

  const query = params.query;
  if (query) {
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(query);
    const payload: IpReputationPayload = { query, tor_exit_node: null, pulse_count: 0 };

    if (isIp) {
      const torList = await fetchText('https://check.torproject.org/torbulkexitlist', { timeoutMs: 5000 });
      if (torList) payload.tor_exit_node = torList.includes(query);

      const otx = await fetchJson<any>(`https://otx.alienvault.com/api/v1/indicators/IPv4/${query}/general`, { timeoutMs: 5000 });
      if (otx) {
        payload.reputation = otx.reputation;
        payload.pulse_count = otx.pulse_info?.count || 0;
      }
    } else {
      const otx = await fetchJson<any>(`https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(query)}/general`, { timeoutMs: 5000 });
      if (otx) payload.pulse_count = otx.pulse_info?.count || 0;
    }

    items.push({
      type: 'ip-domain-reputation',
      id: `rep-${query}`,
      timestamp: now,
      source: 'alienvault-otx+tor-project',
      confidence: 'live',
      payload,
    });
  }

  return { source: 'cisa+otx', fetchedAt: now, items };
}

export const threatIntelSource: SourceDefinition = {
  name: 'threat-intel',
  tier: 'rework',
  reworkNote: 'Merges two previously-separate routes (CISA KEV + AlienVault OTX); still needs a relevance-filtering layer since both upstream feeds are global/unscoped.',
  fetch: (params) => fetchThreatIntel(params),
};
