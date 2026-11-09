# One Foundation, Multiple Modules

```
services/
  foundation/           # shared by every module — nothing module-specific
    intel-core/            normalized multi-source aggregation (25 sources)
    enrichment-runners/     Maigret (Python) — cross-platform username discovery
    entity-resolution/      Splink — probabilistic record linkage across profiles
    graph-store/            Neo4j CE — relationships between resolved entities
    [planned] governance/    auth, OPA/ABAC, audit log — needed by every module
  modules/
    trust-safety/         background verification, fraud/risk, platform T&S, cybersec
    [planned] gov-intelligence/   government / law enforcement — the Gotham-alternative surface
```

**The rule:** before building module-specific logic, check whether the
foundation needs to grow first, and build there. A module never imports
another service's source code directly — it calls over HTTP (see
`trust-safety/src/lib/foundationClient.ts` for the pattern). That boundary
is what makes "multiple modules" real rather than aspirational: a second
module can depend on the same foundation independently, with its own
deploy cycle, without forking or coupling to the first module's code.

**Policy is not shared automatically.** The foundation's code paths are
shared; decisions about what's *enabled* for a given module are not. The
clearest example so far: the Ignorant tool was excluded from
`enrichment-runners` on ethical/legal grounds scoped to the trust-safety
module's commercial context. A `gov-intelligence` module operating under
actual legal authority may have a legitimately different answer — that
needs its own explicit decision, never inherited silently from another
module's policy.

See each service's own README for what's built, what's a verified-working
stub, and what's evaluated-and-held.

**Status note (entity-resolution + graph-store):** both run and are
verified end-to-end against each other — a real Splink match-probability
call writing real `Entity`/`Identifier` nodes into a real running Neo4j
instance, confirmed via `cypher-shell`. Neither is wired into `trust-safety`
or `investigate()` yet; that's the natural next step, not done here.
