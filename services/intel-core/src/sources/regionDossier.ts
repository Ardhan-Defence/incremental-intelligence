import type { IntelItem, SourceDefinition, SourceResult } from '../types.js';
import { fetchJson, settleAll } from '../lib/http.js';

interface DossierPayload {
  location: Record<string, unknown>;
  country: Record<string, unknown> | null;
  head_of_state: Record<string, unknown> | null;
  wikipedia: Record<string, unknown> | null;
}

// TODO(rework-tracked-separately): replace with a real contact string once
// the platform has one (e.g. `IntelCore/<version> (contact@<yourdomain>)`).
// Nominatim and Wikidata both ask for an identifying UA; a generic one risks
// a ban once traffic is non-trivial.
const USER_AGENT = 'IntelCore/0.1 (set a real contact before production use)';

async function fetchDossier(params: Record<string, string> = {}): Promise<SourceResult<DossierPayload>> {
  const now = new Date().toISOString();

  // Unlike the original OSIRIS route this was ported from, missing/invalid
  // coordinates are rejected rather than silently defaulting to 0,0 (Null
  // Island) and returning a dossier for the Gulf of Guinea as if it were a
  // real answer.
  if (params.lat === undefined || params.lng === undefined) {
    return { source: 'region-dossier', fetchedAt: now, items: [], error: 'Missing lat/lng parameters' };
  }
  const lat = parseFloat(params.lat);
  const lng = parseFloat(params.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { source: 'region-dossier', fetchedAt: now, items: [], error: 'Invalid lat/lng parameters' };
  }

  const geoData = await fetchJson<any>(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=5&addressdetails=1`,
    { timeoutMs: 8000, headers: { 'User-Agent': USER_AGENT } },
  );

  const addr = geoData?.address || {};
  const countryName = addr.country || '';
  const countryCode = addr.country_code?.toUpperCase() || '';
  const locationInfo = {
    city: addr.city || addr.town || addr.village || '',
    state: addr.state || addr.region || '',
    country: countryName,
    country_code: countryCode,
    display_name: geoData?.display_name,
  };

  const [countryData, wikiSummary, headOfState] = await settleAll([
    (async () => {
      if (!countryCode) return null;
      return fetchJson<any>(
        `https://restcountries.com/v3.1/alpha/${countryCode}?fields=name,capital,population,area,region,subregion,languages,currencies,flag,flags,timezones`,
        { timeoutMs: 5000 },
      );
    })(),
    (async () => {
      const wikiQuery = locationInfo.city || countryName;
      if (!wikiQuery) return null;
      const wiki = await fetchJson<any>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiQuery)}`, { timeoutMs: 5000 });
      if (!wiki) return null;
      return { title: wiki.title, extract: wiki.extract?.substring(0, 500), thumbnail: wiki.thumbnail?.source };
    })(),
    (async () => {
      if (!countryName) return null;
      const safe = countryName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const sparql = `SELECT ?leader ?leaderLabel ?positionLabel WHERE {
        ?country wdt:P31 wd:Q6256;
                 rdfs:label "${safe}"@en;
                 wdt:P6 ?leader.
        OPTIONAL { ?leader wdt:P39 ?position. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } LIMIT 1`;
      const wd = await fetchJson<any>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, {
        timeoutMs: 5000,
        headers: { 'User-Agent': USER_AGENT },
      });
      const binding = wd?.results?.bindings?.[0];
      if (!binding) return null;
      return { name: binding.leaderLabel?.value, position: binding.positionLabel?.value || 'Head of State' };
    })(),
  ]);

  const item: IntelItem<DossierPayload> = {
    type: 'region-dossier',
    id: `dossier-${lat}-${lng}`,
    lat,
    lng,
    timestamp: now,
    source: 'nominatim+restcountries+wikipedia+wikidata',
    confidence: 'derived',
    payload: {
      location: locationInfo,
      country: countryData ?? null,
      head_of_state: headOfState ?? null,
      wikipedia: wikiSummary ?? null,
    },
  };

  return { source: 'region-dossier', fetchedAt: now, items: [item] };
}

export const regionDossierSource: SourceDefinition = {
  name: 'region-dossier',
  tier: 'keep',
  fetch: fetchDossier,
};
