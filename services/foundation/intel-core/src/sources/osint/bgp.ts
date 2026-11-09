import type { IntelItem, SourceDefinition, SourceResult } from '../../types.js';
import { fetchJson } from '../../lib/http.js';

interface BgpPayload {
  query: string;
  queryType: 'ip' | 'asn';
  asn?: Record<string, unknown>;
  ip?: Record<string, unknown>;
  prefixes?: { total_v4: number; total_v6: number };
}

async function fetchBgp(params: Record<string, string> = {}): Promise<SourceResult<BgpPayload>> {
  const query = params.query;
  const now = new Date().toISOString();
  if (!query) return { source: 'bgpview.io', fetchedAt: now, items: [], error: 'Missing query parameter (IP, ASN, or prefix)' };

  const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(query);
  const isAsn = /^(AS)?\d+$/i.test(query);
  const payload: BgpPayload = { query, queryType: isIp ? 'ip' : 'asn' };

  if (isIp) {
    const data = await fetchJson<any>(`https://api.bgpview.io/ip/${query}`, { timeoutMs: 8000 });
    if (data?.status === 'ok') payload.ip = data.data;
  } else if (isAsn) {
    const asnNum = query.replace(/^AS/i, '');
    const [asnData, prefixData] = await Promise.all([
      fetchJson<any>(`https://api.bgpview.io/asn/${asnNum}`, { timeoutMs: 8000 }),
      fetchJson<any>(`https://api.bgpview.io/asn/${asnNum}/prefixes`, { timeoutMs: 8000 }),
    ]);
    if (asnData?.status === 'ok') payload.asn = asnData.data;
    if (prefixData?.status === 'ok') {
      payload.prefixes = { total_v4: prefixData.data?.ipv4_prefixes?.length || 0, total_v6: prefixData.data?.ipv6_prefixes?.length || 0 };
    }
  } else {
    return { source: 'bgpview.io', fetchedAt: now, items: [], error: 'Unrecognized query format' };
  }

  const item: IntelItem<BgpPayload> = {
    type: 'bgp-lookup',
    id: `bgp-${query}`,
    timestamp: now,
    source: 'bgpview.io',
    confidence: 'live',
    payload,
  };

  return { source: 'bgpview.io', fetchedAt: now, items: [item] };
}

export const bgpSource: SourceDefinition = { name: 'osint-bgp', tier: 'keep', fetch: fetchBgp };
