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
    domain: str | None = None
    phone: str | None = None
    email: str | None = None


class ResolveRequest(BaseModel):
    records: list[EntityRecord]
    write_to_graph: bool = False


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat(), "graph_configured": neo4j_driver is not None}


def build_linker(records: list[dict[str, Any]]) -> Linker:
    """
    Splink settings for this service's record shape: name, domain, phone,
    email. Blocking on domain/phone/email first (two records only get
    compared if they share at least one of these — necessary for
    performance at real scale, though at this service's current size it
    mostly keeps the demo from comparing everything to everything).
    """
    df = pd.DataFrame(records)
    settings = SettingsCreator(
        link_type="dedupe_only",
        comparisons=[
            cl.NameComparison("name"),
            cl.ExactMatch("domain"),
            cl.ExactMatch("phone"),
            cl.EmailComparison("email"),
        ],
        blocking_rules_to_generate_predictions=[
            block_on("domain"),
            block_on("phone"),
            block_on("email"),
        ],
    )
    db_api = DuckDBAPI()
    sdf = db_api.register(df, dataset_display_name="records")
    return Linker(sdf, settings)


@app.post("/v1/resolve")
async def resolve(req: ResolveRequest):
    if len(req.records) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 records to compare")

    records = [r.model_dump() for r in req.records]
    linker = build_linker(records)

    try:
        # Verified against a real 3-record test batch: u-training alone
        # left an exact domain+phone match scoring 0.00003 (essentially
        # zero) because m-values defaulted to near-worthless priors with
        # nothing estimating them. Also running
        # estimate_probability_two_random_records_match plus one EM pass
        # per high-signal blocking key (domain, phone) brought that same
        # pair to 0.94 — this is the minimum needed for a sane result with
        # no labeled training set, not EM's full iterative convergence
        # (unrealistic at this record volume regardless).
        linker.training.estimate_probability_two_random_records_match([block_on("domain")], recall=0.9)
        linker.training.estimate_u_using_random_sampling(max_pairs=1e4)
        linker.training.estimate_parameters_using_expectation_maximisation(block_on("domain"))
        linker.training.estimate_parameters_using_expectation_maximisation(block_on("phone"))
        predictions = linker.inference.predict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Splink resolution failed: {e}")

    df = predictions.as_pandas_dataframe()
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
            for field in ("domain", "phone", "email"):
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
