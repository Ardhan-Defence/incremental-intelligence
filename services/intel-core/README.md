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
- `GET /v1/watchlist` / `POST /v1/watchlist` / `DELETE /v1/watchlist/<id>` — manage watchlist entries.
- `POST /v1/watchlist/<id>/check` — run a check immediately instead of waiting for its schedule.
- `GET /v1/alerts` (optional `?since=<ISO timestamp>`) — list alerts generated so far.

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

- **`social-mastodon`** (`src/sources/social/mastodon.ts`) — hashtag timeline,
  genuinely free and keyless on most instances (unlike X/Reddit, whose APIs
  are now effectively paid-only as of 2026, or the federated/public timeline,
  which large instances like mastodon.social gate behind auth). Defaults to
  `mastodon.social` only — a single instance misses most of the fediverse;
  extend `INSTANCES` to broaden coverage.
- **`social-telegram`** (`src/sources/social/telegram.ts`) — `rework` tier,
  **on legal grounds, not technical ones.** There is no official API for a
  third party to read an arbitrary public channel's history; this scrapes
  the `t.me/s/<channel>` web preview, which works mechanically but has no
  confirmed ToS standing — read Telegram's current terms yourself before
  using this in a product, and scope it to specific named channels, never
  bulk harvesting.

## Watchlist / alerting

`src/watchlist/` adds the layer that was missing before: point a source at a
*target* (a domain, IP, hashtag, or channel) once, and get notified only when
something changes, instead of re-querying lookups by hand.

- **Kinds supported today:** `domain` (new subdomains via `osint-certs` +
  registration/expiry via `osint-whois`), `ip` (Tor exit status + OTX pulse
  count via `threat-intel`), `mastodon-hashtag`, `telegram-channel`.
- **How it works:** each watchlist entry stores a "fingerprint" — a flat list
  of opaque IDs representing current state (subdomain names, post IDs,
  message IDs). A 30-second global tick (`src/watchlist/engine.ts`) checks
  which entries are due, re-runs their check, and diffs the new fingerprint
  against the stored one. New IDs → an alert in `/v1/alerts`; nothing new →
  silence. The first-ever check on a new entry never alerts (establishes the
  baseline).
- **Storage:** `src/lib/jsonStore.ts` — a flat JSON-file-backed array,
  loaded once at startup. Fine for this scale, not for multiple replicas or
  serious write volume; swap for a real DB before this matters in production.
  Files live under `data/` (gitignored) or `$INTEL_CORE_DATA_DIR`.
- **Verified working** (see conversation history / commit for the manual
  test): baseline-no-alert, diff-detection on a forced state change, and
  alert retrieval all confirmed against live Mastodon and Tor-exit-node data.
- **Not yet built:** notification delivery (webhook/email/Slack push) —
  right now an alert only becomes visible by polling `GET /v1/alerts`. No
  per-user/per-team watchlist ownership either — this is a single shared
  list, fine for scaffolding, not for a multi-tenant product.

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
