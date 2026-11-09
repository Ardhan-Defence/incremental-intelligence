# entity-resolution

Separate Python/FastAPI service wrapping Splink (MIT, UK Ministry of
Justice, actively maintained — the recommended pick from the correlation
tool review over Zingg, which needs Spark infra this scale doesn't
justify). Takes a batch of records (name/domain/phone/email) and returns
probabilistic match pairs — "these two records likely describe the same
real-world entity" — optionally writing the result into `../graph-store`.

Every class name and API call here (`DuckDBAPI`, `Linker`, `SettingsCreator`,
`splink.comparison_library`, `block_on`) was confirmed against the actually
installed `splink==5.0.0` package (`dir(cl)`), not assumed from docs or
memory — Splink's API has changed across major versions, and the installed
version's class list was checked directly before writing against it.

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
NEO4J_PASSWORD=<your-password> .venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 4400
```

`NEO4J_PASSWORD` is only required if you use `write_to_graph: true` — the
service works standalone (match-probability only, no write) without it.

- `GET /health`
- `POST /v1/resolve` — body: `{"records": [{"unique_id": "1", "name": "...", "domain": "...", "phone": "...", "email": "..."}, ...], "write_to_graph": false}`

## How it works

Splink needs a DuckDB-backed `Linker` (in-process, no external database —
this is Splink's lightweight default, distinct from the Spark backend
Zingg would have required), comparisons per field
(`NameComparison`/`ExactMatch`/`EmailComparison`), and blocking rules so it
only compares record pairs that share at least one field (`domain`,
`phone`, or `email`) — necessary at real scale, though at this service's
current size it mainly keeps the demo from doing a full cross-product
comparison.

**Training, honestly stated:** `estimate_u_using_random_sampling` gives a
usable baseline straight from the input data, without requiring a labeled
training set — the realistic starting point before any real volume of
records exists to train against. This is *not* a fully EM-trained model;
match probabilities here are a reasonable first signal, not a tuned
production scoring model. Revisit once there's enough real data volume to
train against properly.

**Graph write (`write_matches_to_graph`):** each record's `domain`/`phone`/
`email` fields become `(:Identifier)` nodes; every matched pair gets merged
onto the same `(:Entity)` node via `HAS_IDENTIFIER` edges (schema in
`../graph-store/schema.cypher`). Entity IDs are deterministic from the
lower of the two matched `unique_id`s, so re-running `/v1/resolve` against
overlapping data converges onto the same entities rather than duplicating
them.

## Verified working

Ran a real resolve call against three hand-crafted records — two
plausible matches sharing a domain and phone ("John Smith" /
"Jon Smith" at the same domain/phone) and one clear non-match — and
confirmed the match came back above threshold while the non-match
didn't, then confirmed `write_to_graph: true` produced the expected
`Entity`/`Identifier` nodes in a running `../graph-store` instance,
checked directly via `cypher-shell`. See commit history for the exact
request/response.

## Known limitations

- Dedupe-only (`link_type="dedupe_only"`) — compares records within one
  batch, not incrementally against an existing graph. A record submitted
  today isn't automatically compared against yesterday's entities; that's
  the natural next piece once there's a real pipeline feeding this.
- No caller in `trust-safety` or anywhere else wires profiles into this yet
  — it's a working, verified standalone service, not yet an automatic step
  in the `investigate()` flow.
- Match threshold (`MATCH_PROBABILITY_THRESHOLD`, default 0.5) is a
  reasonable starting guess, not a validated cutoff — tune it against real
  labeled data before trusting it for anything consequential.
