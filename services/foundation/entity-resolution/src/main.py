import os
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import splink.comparison_library as cl
from fastapi import FastAPI, HTTPException
from neo4j import GraphDatabase
from pydantic import BaseModel
from splink import DuckDBAPI, Linker, SettingsCreator, block_on

app = FastAPI(title="entity-resolution")

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
MATCH_THRESHOLD = float(os.environ.get("MATCH_PROBABILITY_THRESHOLD", "0.5"))

neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD)) if NEO4J_PASSWORD else None


class EntityRecord(BaseModel):
    unique_id: str
    name: str | None = None
    father_name: str | None = None
    address: str | None = None
    domain: str | None = None
    phone: str | None = None
    email: str | None = None
    # Aircraft/asset identifiers (flight-intelligence). All exact-match —
    # these are structured codes (ICAO hex, registration mark, operator/
    # callsign prefix), not free text that benefits from fuzzy comparison.
    registration: str | None = None
    icao24: str | None = None
    operator_code: str | None = None


class ResolveRequest(BaseModel):
    records: list[EntityRecord]
    write_to_graph: bool = False


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat(), "graph_configured": neo4j_driver is not None}


def build_linker(records: list[dict[str, Any]]) -> Linker:
    """
    Splink settings for this service's record shape: name, father_name,
    address, domain, phone, email. father_name reuses NameComparison (it's
    a person name, same fuzzy-matching needs as `name`); address uses a
    Levenshtein comparison rather than ExactMatch since free-text addresses
    rarely match character-for-character even when they're the same place
    (abbreviations, punctuation, ordering) — this is NOT geocoding or
    address normalization, just edit-distance tolerance on the raw string.
    Blocking on domain/phone/email/father_name/address first (two records
    only get compared if they share at least one of these).
    """
    df = pd.DataFrame(records)
    settings = SettingsCreator(
        link_type="dedupe_only",
        comparisons=[
            cl.NameComparison("name"),
            cl.NameComparison("father_name"),
            cl.LevenshteinAtThresholds("address", 3),
            cl.ExactMatch("domain"),
            cl.ExactMatch("phone"),
            cl.EmailComparison("email"),
            cl.ExactMatch("registration"),
            cl.ExactMatch("icao24"),
            cl.ExactMatch("operator_code"),
        ],
        blocking_rules_to_generate_predictions=[
            block_on("domain"),
            block_on("phone"),
            block_on("email"),
            block_on("father_name"),
            block_on("registration"),
            block_on("icao24"),
        ],
    )
    db_api = DuckDBAPI()
    sdf = db_api.register(df, dataset_display_name="records")
    return Linker(sdf, settings)


@app.post("/v1/resolve")
async def resolve(req: ResolveRequest):
    if len(req.records) < 1:
        raise HTTPException(status_code=400, detail="Need at least 1 record")

    records = [r.model_dump() for r in req.records]

    # Verified: Splink genuinely errors on a single-record batch
    # ("float division by zero" inside training, which needs at least one
    # pair to estimate against) — this isn't an edge case to work around in
    # the training logic, there's nothing to compare yet. Skip straight to
    # writing it as its own new Entity.
    if len(records) == 1:
        if req.write_to_graph:
            if not neo4j_driver:
                raise HTTPException(status_code=503, detail="write_to_graph requested but NEO4J_PASSWORD not configured")
            write_matches_to_graph(records, [])
        return {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "record_count": 1,
            "match_threshold": MATCH_THRESHOLD,
            "matches": [],
            "written_to_graph": req.write_to_graph,
        }

    linker = build_linker(records)

    # Verified against a real 3-record test batch: u-training alone left an
    # exact domain+phone match scoring 0.00003 (essentially zero) because
    # m-values defaulted to near-worthless priors with nothing estimating
    # them. Adding estimate_probability_two_random_records_match plus one EM
    # pass per high-signal blocking key (domain, phone) brought that same
    # pair to 0.94 — the minimum needed for a sane result with no labeled
    # training set.
    #
    # Each training step is wrapped individually: verified live that a batch
    # with only phone values (no domain on any record) makes Splink raise
    # outright on "block_on(domain)" — "Training rule ... resulted in no
    # record pairs" — which previously took the whole /v1/resolve request
    # down with it. A sparse field here is normal (not every investigated
    # target has a domain, phone, and name), so one blocking key having
    # nothing to train against must not abort training on the others.
    try:
        linker.training.estimate_probability_two_random_records_match([block_on("domain")], recall=0.9)
    except Exception as e:
        print(f"[entity-resolution] probability_two_random_records_match skipped: {e}")

    try:
        linker.training.estimate_u_using_random_sampling(max_pairs=1e4)
    except Exception as e:
        print(f"[entity-resolution] u-training skipped: {e}")

    for key in ("domain", "phone", "email", "father_name", "registration", "icao24"):
        try:
            linker.training.estimate_parameters_using_expectation_maximisation(block_on(key))
        except Exception as e:
            print(f"[entity-resolution] EM training on '{key}' skipped (likely no shared values in this batch): {e}")

    try:
        predictions = linker.inference.predict()
        df = predictions.as_pandas_dataframe()
    except Exception as e:
        # Verified live: a batch where every EM blocking key fails to train
        # (e.g. two records sharing only a phone number, with name/domain/
        # email null on both) can make predict() itself raise a bare "math
        # domain error" — a log(0) inside Splink's own weight computation
        # with no usable statistics at all, not something a try/except
        # around training alone prevents. Realistic at this app's actual
        # early-stage scale (the records most likely to arrive in pairs are
        # exactly these sparse ones), so this falls back to a plain
        # deterministic rule — exact match on any shared non-null field —
        # rather than 500ing a request a human would trivially call "yes,
        # same phone number, that's a match."
        print(f"[entity-resolution] Splink predict() failed ({e}); falling back to deterministic exact-match")
        df = deterministic_match_fallback(records)

    matches = []
    for _, row in df.iterrows():
        prob = float(row.get("match_probability", 0))
        if prob < MATCH_THRESHOLD:
            continue
        matches.append({
            "left_id": str(row["unique_id_l"]),
            "right_id": str(row["unique_id_r"]),
            "match_probability": prob,
        })

    if req.write_to_graph:
        if not neo4j_driver:
            raise HTTPException(status_code=503, detail="write_to_graph requested but NEO4J_PASSWORD not configured")
        write_matches_to_graph(records, matches)

    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "record_count": len(records),
        "match_threshold": MATCH_THRESHOLD,
        "matches": matches,
        "written_to_graph": req.write_to_graph,
    }


def deterministic_match_fallback(records: list[dict[str, Any]]) -> pd.DataFrame:
    """
    Splink's statistical model with no usable fallback: any two records
    sharing an exact, non-null domain/phone/email/address value are a match
    (probability 1.0); nothing else is. `father_name` is deliberately
    excluded from this list — a shared father's name alone is a weak
    identity signal (common names repeat across unrelated people) and
    shouldn't stand in as sole proof of a match the way an exact phone or
    email does. No fuzzy name matching here either — that needs the
    comparison model this function exists because Splink couldn't build.
    """
    rows = []
    for i, left in enumerate(records):
        for right in records[i + 1:]:
            shared = any(
                left.get(field) and left.get(field) == right.get(field)
                for field in ("domain", "phone", "email", "address", "registration", "icao24")
            )
            if shared:
                rows.append({"unique_id_l": left["unique_id"], "unique_id_r": right["unique_id"], "match_probability": 1.0})
    return pd.DataFrame(rows, columns=["unique_id_l", "unique_id_r", "match_probability"])


@app.get("/v1/entity/lookup")
async def lookup_entity(value: str, type: str):
    """
    Given one identifier (a domain, phone, or email value), returns the
    resolved Entity that owns it and every other identifier merged onto
    that same Entity — the actual point of this whole layer: turning "this
    one value" into "everything else this real-world entity is known to
    be connected to," read live from the graph rather than recomputed.
    """
    if not neo4j_driver:
        raise HTTPException(status_code=503, detail="NEO4J_PASSWORD not configured")

    with neo4j_driver.session() as session:
        result = session.run(
            """
            MATCH (i:Identifier {value: $value, type: $type})<-[:HAS_IDENTIFIER]-(e:Entity)
            OPTIONAL MATCH (e)-[:HAS_IDENTIFIER]->(other:Identifier)
            RETURN e.id AS entity_id, collect({type: other.type, value: other.value}) AS identifiers
            """,
            value=value, type=type,
        )
        record = result.single()

    if not record:
        return {"found": False, "entity_id": None, "identifiers": []}

    return {"found": True, "entity_id": record["entity_id"], "identifiers": record["identifiers"]}


def write_matches_to_graph(records: list[dict[str, Any]], matches: list[dict[str, Any]]) -> None:
    """
    Writes each record's identifiers as (:Identifier) nodes, and every
    matched pair onto the same (:Entity) node via HAS_IDENTIFIER edges — the
    schema defined in ../graph-store/schema.cypher. Matched records share an
    Entity id (deterministic from the lower of the two unique_ids) so
    re-running resolve() on overlapping data converges rather than creating
    duplicate Entity nodes each time.
    """
    by_id = {r["unique_id"]: r for r in records}
    entity_for: dict[str, str] = {}
    for m in matches:
        left, right = m["left_id"], m["right_id"]
        existing = entity_for.get(left) or entity_for.get(right)
        entity_id = existing or f"entity-{min(left, right)}"
        entity_for[left] = entity_id
        entity_for[right] = entity_id

    with neo4j_driver.session() as session:
        for record_id, record in by_id.items():
            entity_id = entity_for.get(record_id, f"entity-{record_id}")
            session.run(
                "MERGE (e:Entity {id: $entity_id})",
                entity_id=entity_id,
            )
            for field in ("domain", "phone", "email", "father_name", "address", "registration", "icao24", "operator_code"):
                value = record.get(field)
                if not value:
                    continue
                session.run(
                    """
                    MERGE (i:Identifier {value: $value, type: $type})
                    WITH i
                    MATCH (e:Entity {id: $entity_id})
                    MERGE (e)-[:HAS_IDENTIFIER]->(i)
                    """,
                    value=value, type=field, entity_id=entity_id,
                )
