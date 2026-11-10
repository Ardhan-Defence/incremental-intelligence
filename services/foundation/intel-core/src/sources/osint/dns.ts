import type { IntelItem, SourceDefinition, SourceResult } from '../../types.js';
import { fetchJson, settleAll } from '../../lib/http.js';

interface DnsPayload {
  domain: string;
  records: Record<string, Array<{ name: string; type: number; ttl: number; data: string }>>;
}

const RECORD_TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA'];
const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

async function fetchDns(params: Record<string, string> = {}): Promise<SourceResult<DnsPayload>> {
  const domain = params.domain;
  const now = new Date().toISOString();
  if (!domain || !DOMAIN_RE.test(domain)) {
    return { source: 'google-doh', fetchedAt: now, items: [], error: 'Missing or invalid domain parameter' };
  }

  const lookups = await settleAll(
    RECORD_TYPES.map(async (type) => {
      const data = await fetchJson<any>(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`, { timeoutMs: 5000 });
      return { type, answers: data?.Answer || [] };
    }),
  );

  const records: DnsPayload['records'] = {};
  for (const { type, answers } of lookups) {
    records[type] = answers.map((a: any) => ({ name: a.name, type: a.type, ttl: a.TTL, data: a.data }));
  }

  const item: IntelItem<DnsPayload> = {
    type: 'dns-lookup',
    id: `dns-${domain}`,
    timestamp: now,
    source: 'google-doh',
    confidence: 'live',
    payload: { domain, records },
  };

  return { source: 'google-doh', fetchedAt: now, items: [item] };
}

export const dnsSource: SourceDefinition = { name: 'osint-dns', tier: 'keep', fetch: fetchDns };
