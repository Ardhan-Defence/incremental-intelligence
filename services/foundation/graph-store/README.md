# graph-store

Neo4j Community Edition, run as a standalone process (no Docker — this
sandbox had a Docker client but no daemon; Neo4j CE ships as a plain
tarball that only needs a JRE, which made it the realistic choice over
Apache AGE here, since AGE would need compiling a Postgres extension from
source). License: GPLv3 — fine for self-hosted internal use since GPL's
obligations trigger on distributing modified code, not on running it
in-house; confirm with counsel for your specific deployment regardless.

## Setup

```bash
NEO4J_PASSWORD=<your-password> ./setup.sh
./neo4j/bin/neo4j console
```

`neo4j/` (the ~775MB extracted distribution) is gitignored — same principle
as `node_modules`/`.venv`: a binary distribution isn't source, it's
reproducible from `setup.sh`.

- Bolt (driver protocol): `bolt://localhost:7687`
- HTTP browser UI: `http://localhost:7474`
- CLI: `./neo4j/bin/cypher-shell -u neo4j -p "$NEO4J_PASSWORD"`

Load the schema once, after the first start:

```bash
./neo4j/bin/cypher-shell -u neo4j -p "$NEO4J_PASSWORD" --file schema.cypher
```

## Schema (`schema.cypher`)

Two node types for this first slice:
- `(:Entity)` — a resolved real-world identity, output of `../entity-resolution`
- `(:Identifier)` — one raw identifier (`domain`, `phone`, `email` today)
  seen in the data, the kind of thing profile synthesis and the watchlist
  already work with

`(:Entity)-[:HAS_IDENTIFIER]->(:Identifier)`. Two identifiers that
entity-resolution scores as a likely match get linked to the same `Entity`
node — turning "these five separate lookups happen to share a phone number"
into one queryable node with five edges, instead of five disconnected
profiles a human has to notice are related.

## Verified working

- Downloaded, installed, started, and confirmed up via its own startup log
  ("Started.", Bolt on 7687, HTTP on 7474).
- Schema constraints applied and confirmed via `SHOW CONSTRAINTS`.
- A real Cypher write (`CREATE ... -[:OWNS]-> ...`) and read round-tripped
  correctly through `cypher-shell`.
- `../entity-resolution`'s `/v1/resolve?write_to_graph=true` writes real
  `Entity`/`Identifier` nodes here — see that service's README for the
  verified end-to-end run.

## Known limitations

- Single instance, no clustering, no backup strategy — this is a
  development-grade setup, not a production deployment.
- No auth beyond the single `neo4j` user's password — same foundation-wide
  governance gap noted in `intel-core`'s README (auth/OPA/ABAC/audit is
  cross-cutting work, not specific to this piece).
- Nothing currently queries this graph except entity-resolution's writer —
  no module reads from it yet.
