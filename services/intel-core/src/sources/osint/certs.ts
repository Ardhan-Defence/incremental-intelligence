import type { IntelItem, SourceDefinition, SourceResult } from '../../types.js';
import { fetchJson } from '../../lib/http.js';

interface CertPayload {
  domain: string;
  subdomains: string[];
  total_certs: number;
}

const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

async function fetchCerts(params: Record<string, string> = {}): Promise<SourceResult<CertPayload>> {
  const domain = params.domain;
  const now = new Date().toISOString();
  if (!domain || !DOMAIN_RE.test(domain)) {
    return { source: 'crt.sh', fetchedAt: now, items: [], error: 'Missing or invalid domain parameter' };
  }

  const certs = await fetchJson<any[]>(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, {
    timeoutMs: 10_000,
    headers: { 'User-Agent': 'IntelCore/0.1' },
  });
  if (!certs) {
    return { source: 'crt.sh', fetchedAt: now, items: [], error: 'crt.sh unavailable' };
  }

  const subdomains = new Set<string>();
  for (const cert of certs.slice(0, 200)) {
    (cert.name_value || '').split('\n').forEach((n: string) => {
      const clean = n.trim().replace(/^\*\./, '');
      if (clean.endsWith(domain)) subdomains.add(clean);
    });
  }

  const item: IntelItem<CertPayload> = {
    type: 'cert-transparency',
    id: `certs-${domain}`,
    timestamp: now,
    source: 'crt.sh',
    confidence: 'live',
    payload: { domain, subdomains: Array.from(subdomains).sort(), total_certs: certs.length },
  };

  return { source: 'crt.sh', fetchedAt: now, items: [item] };
}

export const certsSource: SourceDefinition = { name: 'osint-certs', tier: 'keep', fetch: fetchCerts };
