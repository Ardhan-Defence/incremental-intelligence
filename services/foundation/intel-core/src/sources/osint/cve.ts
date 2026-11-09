import type { IntelItem, SourceDefinition, SourceResult } from '../../types.js';
import { fetchJson } from '../../lib/http.js';

interface CvePayload {
  id: string;
  description: string;
  cvss: number | null;
  severity: string | null;
  references: string[];
}

const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;

async function fetchFromMitre(cve: string): Promise<CvePayload | null> {
  const data = await fetchJson<any>(`https://cveawg.mitre.org/api/cve/${encodeURIComponent(cve)}`, { timeoutMs: 8000 });
  if (!data) return null;

  const cna = data.containers?.cna;
  const description = cna?.descriptions?.find((d: any) => d.lang === 'en')?.value || cna?.descriptions?.[0]?.value || 'No description available.';

  let cvss: number | null = null;
  let severity: string | null = null;
  for (const m of cna?.metrics || []) {
    const v31 = m.cvssV3_1 || m.cvssV3_0 || m.cvssV31;
    if (v31) {
      cvss = v31.baseScore ?? null;
      severity = v31.baseSeverity ?? null;
      break;
    }
    const v2 = m.cvssV2_0 || m.cvssV2;
    if (v2) {
      cvss = v2.baseScore ?? null;
      break;
    }
  }

  return {
    id: data.cveMetadata?.cveId || cve,
    description,
    cvss,
    severity: severity || (cvss !== null ? (cvss >= 9 ? 'CRITICAL' : cvss >= 7 ? 'HIGH' : cvss >= 4 ? 'MEDIUM' : 'LOW') : null),
    references: (cna?.references || []).slice(0, 5).map((r: any) => r.url),
  };
}

async function fetchFromCircl(cve: string): Promise<CvePayload | null> {
  const data = await fetchJson<any>(`https://cve.circl.lu/api/cve/${encodeURIComponent(cve)}`, { timeoutMs: 8000 });
  if (!data) return null;
  return {
    id: data.id || cve,
    description: data.summary || 'No description available.',
    cvss: data.cvss ?? null,
    severity: null,
    references: (data.references || []).slice(0, 5),
  };
}

async function fetchCve(params: Record<string, string> = {}): Promise<SourceResult<CvePayload>> {
  const cveRaw = params.cve;
  const now = new Date().toISOString();
  if (!cveRaw || !CVE_RE.test(cveRaw)) {
    return { source: 'mitre+circl', fetchedAt: now, items: [], error: 'Invalid CVE format. Expected CVE-YYYY-NNNNN' };
  }
  const cve = cveRaw.toUpperCase();

  const payload = (await fetchFromMitre(cve)) ?? (await fetchFromCircl(cve)) ?? {
    id: cve,
    description: 'CVE details could not be retrieved at this time.',
    cvss: null,
    severity: null,
    references: [],
  };

  const item: IntelItem<CvePayload> = {
    type: 'cve-lookup',
    id: cve,
    timestamp: now,
    source: 'mitre+circl',
    confidence: 'live',
    payload,
  };

  return { source: 'mitre+circl', fetchedAt: now, items: [item] };
}

export const cveSource: SourceDefinition = { name: 'osint-cve', tier: 'keep', fetch: fetchCve };
