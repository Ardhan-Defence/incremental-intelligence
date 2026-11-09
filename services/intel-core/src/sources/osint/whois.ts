import type { IntelItem, SourceDefinition, SourceResult } from '../../types.js';
import { fetchJson } from '../../lib/http.js';
import { safeFetch } from '../../lib/ssrf-guard.js';

interface WhoisPayload {
  domain: string;
  registration?: string;
  expiration?: string;
  nameservers?: string[];
  http_security_score?: { score: number; max: number; grade: string };
}

const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

async function fetchWhois(params: Record<string, string> = {}): Promise<SourceResult<WhoisPayload>> {
  const domain = params.domain;
  const now = new Date().toISOString();
  if (!domain || !DOMAIN_RE.test(domain)) {
    return { source: 'rdap', fetchedAt: now, items: [], error: 'Missing or invalid domain parameter' };
  }

  const payload: WhoisPayload = { domain };

  const rdap = await fetchJson<any>(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { timeoutMs: 8000 });
  if (rdap) {
    const events = (rdap.events || []).map((e: any) => ({ action: e.eventAction, date: e.eventDate }));
    payload.registration = events.find((e: any) => e.action === 'registration')?.date;
    payload.expiration = events.find((e: any) => e.action === 'expiration')?.date;
    payload.nameservers = (rdap.nameservers || []).map((ns: any) => ns.ldhName);
  }

  // Goes through safeFetch (SSRF guard): this is the one lookup here that
  // turns user input directly into an outbound request to an arbitrary host.
  try {
    const res = await safeFetch(`https://${domain}`, { method: 'HEAD', signal: AbortSignal.timeout(5000), maxRedirects: 3 });
    const headers: Record<string, string> = {};
    ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy'].forEach((h) => {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    });
    let score = 0;
    if (headers['strict-transport-security']) score += 2;
    if (headers['content-security-policy']) score += 2;
    if (headers['x-frame-options']) score += 1;
    if (headers['x-content-type-options']) score += 1;
    if (headers['referrer-policy']) score += 1;
    payload.http_security_score = { score, max: 7, grade: score >= 5 ? 'A' : score >= 3 ? 'B' : score >= 1 ? 'C' : 'F' };
  } catch {
    // leave http_security_score unset
  }

  const item: IntelItem<WhoisPayload> = {
    type: 'whois-lookup',
    id: `whois-${domain}`,
    timestamp: now,
    source: 'rdap',
    confidence: 'live',
    payload,
  };

  return { source: 'rdap', fetchedAt: now, items: [item] };
}

export const whoisSource: SourceDefinition = { name: 'osint-whois', tier: 'keep', fetch: fetchWhois };
