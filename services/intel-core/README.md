# intel-core

Extracted, normalized intelligence aggregation service. This replaces the
per-product pattern of forking OSIRIS's map UI just to reuse its API routes:
every source here returns the same `IntelItem` envelope (see `src/types.ts`),
so any TG-facing product — internal or external — can consume one stable API
instead of a copy of the dashboard.

## Run it

```bash
npm install
npm run dev     # tsx watch, http://localhost:4100
```

- `GET /v1/sources` — list every registered source, its tier (`keep`/`rework`), and its rework note if any.
- `GET /v1/all` — fetch every source in parallel.
- `GET /v1/<name>` — fetch one source, e.g. `/v1/earthquakes`, `/v1/osint-dns?domain=example.com`.

## Scope of this pass

Per the extraction review, only two of the four tiers were ported here:

- **`keep`** — earthquakes, fires, space-weather, air-quality, flights,
  satellites, maritime, region-dossier, and the five `osint-*` network
  lookups (dns, whois, certs, bgp, cve). Logic ported close to verbatim from
  the original Next.js routes; the risk-bearing parts (SGP4-simplified
  propagation, flight classification, the SSRF guard) were kept faithful
  rather than rewritten.
- **`rework`** — `news` (merges the original `news`/`gdelt`/`live-news`
  routes), `threat-intel` (merges `cyber-threats`/`osint/threats`), and
  `mosdac` (stub only — see below). Each carries a named, unresolved gap —
  see the file's top-of-file comment and the `reworkNote` field returned by
  `/v1/sources`.

## Added after the diversification review

- **`conflict-events`** (`src/sources/ucdp.ts`) — Uppsala Conflict Data
  Program's Georeferenced Event Dataset. Global, not Ukraine-specific like
  the dropped `frontlines`/DeepState source. Real, working integration
  against UCDP's documented REST API — but it needs an access token: request
  one from the UCDP API maintainer (describe your use case) at
  https://ucdp.uu.se/apidocs/, then set `UCDP_ACCESS_TOKEN`. Without it, the
  source returns a clear error rather than failing silently. CC BY 4.0,
  5,000 requests/day.
- **`mosdac`** (`src/sources/mosdac.ts`) — **stub, not a working
  integration.** ISRO's MOSDAC was the requested India-fidelity source
  (INSAT, Oceansat-2, SCATSAT-1, Megha-Tropiques, SARAL), but unlike every
  other source here it has no documented public HTTP/REST API — only a
  desktop tool (`mdapi.py`) that authenticates with MOSDAC account
  username/password and runs locally. Wiring this up for real needs an
  architecture decision (reverse-engineer `mdapi.py`'s HTTP calls, run it as
  a scheduled subprocess writing to a shared location, or treat MOSDAC as an
  offline batch job outside this service's request/response model) — see
  the file's top comment for the three options weighed. This module exists
  so the gap is visible in `/v1/sources` rather than silently absent.

**Deliberately not ported** (per the fork review — see conversation history,
not reproduced here): the CCTV aggregator (scraped border-camera sources of
unclear licensing), `country-risk` (unsourced hardcoded risk scores),
`markets` (scrapes Yahoo Finance's undocumented endpoint), `frontlines`
(single-purpose Ukraine conflict data), `infrastructure` (uncited nuclear
facility dataset), and `osint/scanner` + `osint/sweep` (depend on a scanner
backend that doesn't exist yet).

## Known limitations

- `TtlCache` (src/lib/cache.ts) is process-local — fine for one instance,
  not for multiple replicas behind a load balancer. Swap for Redis/KV if
  this ever runs horizontally scaled.
- No auth/API-key layer yet — this is an internal scaffold, not something to
  expose publicly as-is.
- `region-dossier` and `news` send a placeholder User-Agent to third-party
  APIs (Nominatim, Wikidata) that ask for a real contact string — set one
  before any non-trivial traffic.
