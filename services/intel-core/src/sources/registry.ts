import type { SourceDefinition } from '../types.js';

import { earthquakesSource } from './earthquakes.js';
import { firesSource } from './fires.js';
import { spaceWeatherSource } from './spaceWeather.js';
import { airQualitySource } from './airQuality.js';
import { flightsSource } from './flights.js';
import { satellitesSource } from './satellites.js';
import { maritimeSource } from './maritime.js';
import { regionDossierSource } from './regionDossier.js';
import { dnsSource } from './osint/dns.js';
import { whoisSource } from './osint/whois.js';
import { certsSource } from './osint/certs.js';
import { bgpSource } from './osint/bgp.js';
import { cveSource } from './osint/cve.js';
import { newsSource } from './news.js';
import { threatIntelSource } from './threatIntel.js';
import { ucdpSource } from './ucdp.js';
import { mosdacSource } from './mosdac.js';
import { mastodonSource } from './social/mastodon.js';
import { telegramSource } from './social/telegram.js';

/**
 * Every extracted source, keyed by name. `tier` + `reworkNote` carry forward
 * the scoping decision from the fork review: 'keep' sources are ports of
 * already-solid logic, 'rework' sources are functional but have a known,
 * named gap that should be closed before a product depends on them.
 */
export const SOURCES: Record<string, SourceDefinition> = {
  earthquakes: earthquakesSource,
  fires: firesSource,
  'space-weather': spaceWeatherSource,
  'air-quality': airQualitySource,
  flights: flightsSource,
  satellites: satellitesSource,
  maritime: maritimeSource,
  'region-dossier': regionDossierSource,
  'osint-dns': dnsSource,
  'osint-whois': whoisSource,
  'osint-certs': certsSource,
  'osint-bgp': bgpSource,
  'osint-cve': cveSource,
  news: newsSource,
  'threat-intel': threatIntelSource,
  'conflict-events': ucdpSource,
  mosdac: mosdacSource,
  'social-mastodon': mastodonSource,
  'social-telegram': telegramSource,
};

export function listSources(): Array<{ name: string; tier: string; reworkNote?: string }> {
  return Object.values(SOURCES).map((s) => ({ name: s.name, tier: s.tier, reworkNote: s.reworkNote }));
}
