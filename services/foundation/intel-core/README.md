# intel-core

Foundation service: the normalized, multi-source intelligence aggregation
layer. Every source here returns the same `IntelItem` envelope (see
`src/types.ts`), so any module (currently `../../modules/trust-safety`,
eventually `gov-intelligence`) can consume one stable API instead of forking
its own fetch logic.

This is foundation per the **"One Foundation, Multiple Modules"**
principle: nothing module-specific lives here — no profile synthesis, no
watchlist, no analyst-facing logic. Those moved to
`../../modules/trust-safety`, which calls this service over HTTP (never
imports it directly — that HTTP boundary *is* the module boundary, so a
second module can depend on the same foundation independently).

## Run it

```bash
npm install
npm run dev     # tsx watch, http://localhost:4100
```

- `GET /v1/sources` — list every registered source, its tier (`keep`/`rework`), and its rework note if any.
- `GET /v1/all` — fetch every source in parallel.
- `GET /v1/<name>` — fetch one source, e.g. `/v1/earthquakes`, `/v1/osint-dns?domain=example.com`.

## Correlation tools: built vs. evaluated-and-held

Six tools were reviewed as candidates for a cross-platform enrichment layer:

- **Maigret** (MIT, actively maintained) — **built.** Lives in
  `../../foundation/enrichment-runners` (separate Python/FastAPI service,
  called over HTTP — keeps its dependency tree and the five held-tools'
  licensing concerns below fully isolated). Called by trust-safety's
  `investigate()` for the `username` case.
- **Google libphonenumber** — built, integrated directly into
  `trust-safety` (it's a parsing library, not a recon tool, so it doesn't
  belong in the sources registry).
- **Maltego CE** — not something to embed; its license forbids commercial
  use. Better fit: expose a module's output *to* Maltego as a custom
  transform later.
- **Social-Analyzer** — AGPL-3.0, likely stale — holding pending a license
  decision (AGPL's network-use clause is a real conflict with a commercial
  product; get this confirmed with counsel before building on it).
- **PhoneInfoga** — GPL-3.0, and historically fragile against Google's
  anti-scraping (its own docs note getting blocked/captcha'd) — holding.
- **Ignorant** — deliberately **not** building this. It works by probing
  platforms' own password-reset/account-recovery endpoints to infer
  registration — a materially different (and riskier) mechanism than
  anything else evaluated, not just a licensing question. This exclusion
  was scoped to the trust-safety module specifically — a law-enforcement
  module operating under actual legal authority may have a different,
  legitimate answer here; that's a separate decision, not inherited.

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
  extend `INSTANCES` to broaden coverage. (Account lookup, as opposed to
  hashtag search, is trust-safety-specific and lives there instead.)
- **`social-telegram`** (`src/sources/social/telegram.ts`) — `rework` tier,
  **on legal grounds, not technical ones.** There is no official API for a
  third party to read an arbitrary public channel's history; this scrapes
  the `t.me/s/<channel>` web preview, which works mechanically but has no
  confirmed ToS standing — read Telegram's current terms yourself before
  using this in a product, and scope it to specific named channels, never
  bulk harvesting.

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
  expose publicly as-is. This is foundation-wide governance work (auth,
  OPA/ABAC, audit log), relevant to every module, not something to bolt onto
  one module at a time.
- `region-dossier` and `news` send a placeholder User-Agent to third-party
  APIs (Nominatim, Wikidata) that ask for a real contact string — set one
  before any non-trivial traffic.
