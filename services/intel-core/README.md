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
  routes) and `threat-intel` (merges `cyber-threats`/`osint/threats`). Both
  are functional today but carry a named, unresolved gap — see each file's
  top-of-file comment and the `reworkNote` field returned by `/v1/sources`.

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
