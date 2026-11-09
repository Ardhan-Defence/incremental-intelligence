# entity-resolution

Separate Python/FastAPI service wrapping Splink (MIT, UK Ministry of
Justice, actively maintained — the recommended pick from the correlation
tool review over Zingg, which needs Spark infra this scale doesn't
justify). Takes a batch of records (name/father_name/address/domain/phone/
email) and returns probabilistic match pairs — "these two records likely
describe the same real-world entity" — optionally writing the result into
`../graph-store`.

`father_name` and `address` are correlation fields only — nothing in this
system looks them up from an external source. A caller that already has
them (a case file, a form) passes them in for better matching; there is no
`investigate()` input kind that derives them on its own.

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
- `POST /v1/resolve` — body: `{"records": [{"unique_id": "1", "name": "...", "father_name": "...", "address": "...", "domain": "...", "phone": "...", "email": "..."}, ...], "write_to_graph": false}`
- `GET /v1/entity/lookup?value=<x>&type=<domain|phone|email|name|father_name|address>` — returns the resolved Entity owning that identifier and every other identifier merged onto it, read live from the graph.

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
`email`/`father_name`/`address` fields become `(:Identifier)` nodes; every matched pair gets merged
onto the same `(:Entity)` node via `HAS_IDENTIFIER` edges (schema in
`../graph-store/schema.cypher`). Entity IDs are deterministic from the
lower of the two matched `unique_id`s, so re-running `/v1/resolve` against
overlapping data converges onto the same entities rather than duplicating
them.

## Verified working

- A real resolve call against three hand-crafted records — two plausible
  matches sharing a domain and phone ("John Smith" / "Jon Smith" at the
  same domain/phone) and one clear non-match — confirmed the match came
  back above threshold while the non-match didn't, and `write_to_graph:
  true` produced the expected `Entity`/`Identifier` nodes, checked
  directly via `cypher-shell`.
- Now wired into `../../modules/trust-safety`'s `investigate()` — see that
  module's README for the real end-to-end run (two differently-formatted
  phone numbers correlating to the same entity) and the two bugs that
  surfaced and got fixed doing it, one of them in this service:
  **`/v1/entity/lookup` returning "not found" for any entity with only one
  identifier** — the Cypher pattern required a *second*, distinct
  identifier node to exist (`(e)-[:HAS_IDENTIFIER]->(other:Identifier)` as
  a hard `MATCH`), so a solo entity never matched the whole pattern. Fixed
  by making that part an `OPTIONAL MATCH`.
- Two more robustness bugs, found while wiring this up for real with sparse
  data (not every investigated target has a domain, phone, *and* name —
  most have exactly one):
  - A batch with only `phone` populated (no `domain`/`email` on any record)
    made Splink raise outright during EM training on the `domain` blocking
    key — `"Training rule ... resulted in no record pairs"`. Fixed by
    wrapping each training step (`estimate_probability_two_random_records_match`,
    each per-field EM pass) individually, so one sparse field doesn't abort
    training on the others.
  - Even past that, `predict()` itself could still raise a bare `"math
    domain error"` when every comparison column besides the matched one was
    null on both records — Splink's weight computation has nothing to
    compute from. Added a deterministic exact-match fallback
    (`deterministic_match_fallback`) for exactly this case: any two records
    sharing a non-null domain/phone/email score 1.0, nothing else does.
    Verified this fallback actually fires and resolves correctly for the
    phone-only pair that broke the first fix.
- `father_name`/`address` correlation fields, verified live end-to-end:
  two records with identical `name`/`father_name`/exact-identical `address`
  correctly matched at probability 1.0 and merged onto one `Entity`; a
  second pair with identical `name`/`father_name` but a *non-identical*
  address string ("12 MG Road, Bengaluru" vs. "12, MG Road, Bangalore" —
  same place, different punctuation/spelling) correctly stayed unmerged,
  confirming `deterministic_match_fallback` really is exact-string-only on
  `address` and doesn't silently fuzzy-match it. Both outcomes confirmed
  directly via `cypher-shell`, and `/v1/entity/lookup?type=father_name` and
  `?type=address` both resolved correctly against the written graph.

## Known limitations

- Dedupe-only (`link_type="dedupe_only"`) — compares records within one
  batch, not incrementally against an existing graph. `trust-safety`
  resends its *entire* logged-target history on every investigation to
  work around this; fine at current scale, won't scale past a few thousand
  logged targets without a real incremental-linking rework.
- Match threshold (`MATCH_PROBABILITY_THRESHOLD`, default 0.5) is a
  reasonable starting guess, not a validated cutoff — tune it against real
  labeled data before trusting it for anything consequential.
- The deterministic fallback is exact-match only — no fuzzy name matching
  when it's in effect, since that's precisely the case Splink's statistical
  model couldn't handle with the data on hand.
