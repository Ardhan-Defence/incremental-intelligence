// Minimal entity-relationship schema. Two node types for a first slice:
//   (:Entity)       — a resolved real-world identity (output of entity-resolution)
//   (:Identifier)   — one raw identifier seen in the data: domain, phone,
//                     email, father_name, or address (person-name/location
//                     fields added as correlation inputs only — nothing
//                     currently looks these up from an external source,
//                     they're passed in by whatever already has them)
// (:Entity)-[:HAS_IDENTIFIER]->(:Identifier)
// Two Identifiers that Splink scores as a likely match get linked to the
// same Entity node — that's the entire point of this layer: turning
// "these five separate lookups happen to share a phone number" into one
// queryable node with five edges.

CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT identifier_value_type IF NOT EXISTS FOR (i:Identifier) REQUIRE (i.value, i.type) IS UNIQUE;
CREATE INDEX identifier_type IF NOT EXISTS FOR (i:Identifier) ON (i.type);
