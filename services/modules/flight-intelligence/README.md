# flight-intelligence

Third module under "One Foundation, Multiple Modules." TG-facing first
(flight tracking / asset intelligence as a product), also used by Ardhan's
Spearhead and Rakesh programs. Two pieces, both built on foundation already
in place before this module existed:

1. **Watchlist/alerting** on tail numbers and callsign patterns — same
   fingerprint-diff pattern as `trust-safety/src/watchlist`.
2. **Asset correlation** — links identifiers already present in the live
   ADS-B feed (registration, icao24, operator/callsign code) across
   sightings via `entity-resolution`, writing the result into
   `../graph-store`.

## Honest scope — what this is NOT

- **Not a flight-plan/route database.** `intel-core`'s `flights` source
  (adsb.lol) is a live ADS-B position feed: current callsign, registration,
  icao24, lat/lng/alt/speed. It carries no origin/destination. "Route"
  watchlists here are a callsign-prefix match (an airline or flight-number
  code, e.g. `"AIC"` or `"AIC440"`) — a real but partial stand-in for a true
  city-pair, which would need a licensed flight-schedule source.
- **Not an owner/operator identity lookup.** Asset correlation here only
  links identifiers the live feed itself already carries (an icao24 seen
  under more than one registration, or vice versa) — it does NOT resolve
  "who legally owns tail number X." That would need a licensed civil
  aviation registry. A real attempt was made to add the FAA's public
  releasable aircraft registry (`registry.faa.gov`) as a foundation source;
  the request was blocked by this session's own anti-bot-circumvention
  safeguard before a working integration existed (a plain HTTPS request to
  that host returned 403, and retrying with a spoofed User-Agent to get
  past it was correctly refused as evasion). This is a genuine gap, not a
  deferred nice-to-have — flag it before promising owner-identity lookups
  to a TG.

## Run it

```bash
npm install
INTEL_CORE_URL=http://localhost:4100 ENTITY_RESOLUTION_URL=http://localhost:4400 npm run dev
```

- `GET /health`
- `GET /v1/asset?registration=<tail>` or `?icao24=<hex>` — correlates the
  queried identifier against everything logged before and returns the
  resolved asset's known registrations/operators.
- `GET /v1/watchlist` / `POST /v1/watchlist` (`{"kind":"tail-number","target":"VT-ABC"}` or `{"kind":"callsign-pattern","target":"AIC"}`) / `DELETE /v1/watchlist/<id>`
- `POST /v1/watchlist/<id>/check` — run immediately, bypassing the schedule
- `GET /v1/alerts` (optional `?since=<ISO timestamp>`)

## Verified working (live, against real traffic)

- Watchlist baseline-then-diff: added a `tail-number` entry for a real,
  currently-airborne registration (`N113AX`), confirmed the first check
  only establishes a baseline (no alert), confirmed a genuinely different
  fingerprint produces a real alert with accurate sighting detail
  (`callsign`, `icao24`, `model`), and confirmed the error short-circuit —
  with the foundation deliberately taken down, the check correctly
  returned no alert and left the real fingerprint untouched rather than
  overwriting it with an empty one (same invariant as trust-safety's
  watchlist, re-verified here independently).
- Asset correlation end-to-end: `/v1/asset?registration=N113AX` found the
  aircraft live, logged it, resolved it via `entity-resolution`, wrote
  `registration`/`icao24`/`operator_code` identifiers into the graph, and
  returned the correct `entity_id` — confirmed directly via `cypher-shell`.
- The actual point of this correlation — an icao24 flying under more than
  one registration/operator — confirmed directly against `entity-resolution`:
  two records sharing one icao24 but different registration/operator_code
  matched at probability 1.0 and merged onto one Entity, with
  `/v1/entity/lookup?type=icao24` correctly returning both registrations
  and both operator codes as linked identifiers on that one Entity.

## Known limitations

- `flights` is a global snapshot across six fixed broad regions (see
  `intel-core/src/sources/flights.ts`), not a guaranteed-complete picture —
  an aircraft genuinely leaving coverage between two calls looks identical
  to "not found," and was observed doing exactly that live while testing.
- `assetLog` is dedupe-only against its own history, same limitation as
  trust-safety's `investigationLog` (no incremental linking in
  `entity-resolution` yet) — fine at current scale.
- `operator_code` is deliberately excluded from blocking rules and the
  deterministic-fallback match criteria (same reasoning as `father_name` in
  `entity-resolution`): shared by many unrelated aircraft, too weak alone
  to prove two records are the same airframe.
