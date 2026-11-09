# enrichment-runners

Separate Python service for OSINT recon tools that don't fit `intel-core`'s
Node/TypeScript runtime or license profile — per the correlation-tool review,
kept as its own deployable unit, called over HTTP, not imported into
`intel-core` directly. This isolates license exposure (several tools in that
review are AGPL/GPL) and lets each tool run in its own container with its
own dependency tree.

## What's here

- **Maigret** (MIT, actively maintained) — username → cross-platform account
  discovery across 3,000+ sites. The only tool from the review built so far;
  it was the clear first pick (permissive license, real maintenance activity).

Not built yet, per the review in `intel-core/README.md`: Social-Analyzer
(AGPL, holding on a license decision), PhoneInfoga (GPL + documented
fragility against Google's anti-scraping), Ignorant (deliberately excluded —
works by probing platforms' own auth/account-recovery endpoints, a different
risk tier from account-existence checking).

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 4200
```

Or via Docker: `docker build -t enrichment-runners . && docker run -p 4200:4200 enrichment-runners`

- `GET /health`
- `GET /v1/username/<username>` — runs Maigret against the username, returns normalized matches

`intel-core`'s `username` classification in `src/profile/investigate.ts`
calls this service's `/v1/username/<username>` endpoint — set
`ENRICHMENT_RUNNERS_URL` there once this is deployed (defaults to
`http://localhost:4200`).

## Known limitations

- Maigret's full site list (3,000+) takes minutes per username — this
  service caps the check to a configurable top-N most-popular sites
  (`MAIGRET_TOP_SITES`, default set in `src/main.py`) to keep response times
  usable for an interactive profile lookup. Set it higher for a thorough,
  slower run.
- No rate limiting or auth on this service yet — same caveat as `intel-core`
  at this stage: internal scaffold, not something to expose publicly as-is.
- Each check shells out to the `maigret` CLI as a subprocess rather than
  importing it as a library, specifically so a crash or hang in Maigret's
  async internals can't take down this service's event loop.
