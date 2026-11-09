# trust-safety

Module: background verification, fraud/risk, platform trust & safety,
cybersec/SOC teams — vetting a domain, IP, phone number, or social account
before a decision, or watching one over time.

Per **"One Foundation, Multiple Modules"**: this never imports foundation
source code directly. Everything it needs from `../../foundation/intel-core`
goes over HTTP via `src/lib/foundationClient.ts`'s `fetchSource(name,
params)` — the same way `../../foundation/enrichment-runners` is called.
That HTTP boundary is deliberate: a second module (e.g. `gov-intelligence`)
can depend on the same foundation independently, without sharing this
module's build, deploy cycle, or data store.

## Run it

```bash
npm install
npm run dev     # tsx watch, http://localhost:4300
```

Requires `../../foundation/intel-core` running (default
`INTEL_CORE_URL=http://localhost:4100`) and, for the `username` profile
case, `../../foundation/enrichment-runners` (default
`ENRICHMENT_RUNNERS_URL=http://localhost:4200`).

- `GET /v1/investigate?target=<anything>` — single-input profile synthesis. See below.
- `GET /v1/watchlist` / `POST /v1/watchlist` / `DELETE /v1/watchlist/<id>` — manage watchlist entries.
- `POST /v1/watchlist/<id>/check` — run a check immediately instead of waiting for its schedule.
- `GET /v1/alerts` (optional `?since=<ISO timestamp>`) — list alerts generated so far.

## Profile synthesis (`src/profile/`)

The single entry point: give it anything — an IP, a domain, a phone number,
an email, a `t.me/<channel>` or `https://<instance>/@<handle>` URL, a bare
username — and it classifies the input, fans out to whichever foundation
sources apply (over HTTP), and returns one normalized `Profile`: sections of
labeled claims, each tagged `confirmed` / `reported` / `unavailable`, plus an
explicit `gaps` array naming what this profile does *not* cover for that
target kind. The gaps array is the important part — it's there so a missing
capability is a visible field in the response, not a silent omission.

**What's wired up today, by classified kind:**
- `ip` → foundation's `osint-bgp` (network/ASN ownership) + `threat-intel` (Tor exit, OTX pulses)
- `domain` / `email` (profiles the domain half) → foundation's `osint-whois` + `osint-certs` + `osint-dns` + `threat-intel`
- `phone` → `libphonenumber-js`, integrated directly here (validity, country, line type, formatting only — no carrier or account linkage; see the gap it reports)
- `mastodon-profile` (a `/@handle` URL) → `src/lib/mastodonAccount.ts` (`/api/v1/accounts/lookup` + recent public statuses — both public, keyless Mastodon endpoints, called directly, not via the foundation — this is profile-specific enrichment, not a generic registered source)
- `telegram-channel` (a `t.me/...` URL) → foundation's `social-telegram` source
- `username` (no platform given) → `enrichment-runners`'s Maigret endpoint for cross-platform account discovery; if that service isn't deployed, the profile reports it as unreachable rather than silently returning nothing

## Watchlist / alerting (`src/watchlist/`)

Point a check at a *target* (a domain, IP, hashtag, or channel) once, and
get notified only when something changes, instead of re-querying lookups by
hand.

- **Kinds supported today:** `domain` (new subdomains via foundation's
  `osint-certs` + registration/expiry via `osint-whois`), `ip` (Tor exit
  status + OTX pulse count via `threat-intel`), `mastodon-hashtag`,
  `telegram-channel`.
- **How it works:** each watchlist entry stores a "fingerprint" — a flat list
  of opaque IDs representing current state (subdomain names, post IDs,
  message IDs). A 30-second global tick (`src/watchlist/engine.ts`) checks
  which entries are due, re-runs their check (over HTTP to the foundation),
  and diffs the new fingerprint against the stored one. New IDs → an alert
  in `/v1/alerts`; nothing new → silence. The first-ever check on a new
  entry never alerts (establishes the baseline).
- **Error handling matters here:** a failed foundation call never overwrites
  a real fingerprint with an empty one — `CheckResult.error` short-circuits
  the engine before it touches stored state, specifically to prevent a
  transient upstream failure (crt.sh, OTX — both observed flaky in practice)
  from making every real item look "new" on the next successful check.
- **Storage:** `src/lib/jsonStore.ts` — a flat JSON-file-backed array,
  loaded once at startup. Fine for this scale, not for multiple replicas or
  serious write volume; swap for the planned graph store once it exists.
  Files live under `data/` (gitignored) or `$TRUST_SAFETY_DATA_DIR`.
- **Not yet built:** notification delivery (webhook/email/Slack push) —
  right now an alert only becomes visible by polling `GET /v1/alerts`. No
  per-user/per-team watchlist ownership either — this is a single shared
  list, fine for scaffolding, not for a multi-tenant product.

## Known limitations

- No auth/API-key layer yet, same caveat as the foundation — internal
  scaffold, not for public exposure as-is.
- Every foundation call here assumes `intel-core` is reachable and healthy;
  there's no retry/circuit-breaker logic beyond each individual fetch's
  timeout.
