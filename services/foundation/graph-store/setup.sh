#!/bin/bash
# Downloads and configures Neo4j Community Edition as a standalone process —
# no Docker required, just a JRE (tested against OpenJDK 21). Matches how
# this was actually verified working: a real download, a real initial
# password set, a real started server, a real Cypher write/read.
set -euo pipefail
cd "$(dirname "$0")"

NEO4J_VERSION="${NEO4J_VERSION:-2026.10.2}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:?Set NEO4J_PASSWORD before running this script}"

if [ ! -d neo4j ]; then
  echo "Downloading Neo4j Community ${NEO4J_VERSION}..."
  curl -sL -o neo4j.tar.gz "https://dist.neo4j.org/neo4j-community-${NEO4J_VERSION}-unix.tar.gz"
  tar xzf neo4j.tar.gz
  mv neo4j-community-* neo4j
  rm neo4j.tar.gz
  ./neo4j/bin/neo4j-admin dbms set-initial-password "$NEO4J_PASSWORD"
  echo "Neo4j installed. Password must be set before the first start — done above."
else
  echo "neo4j/ already present — skipping download. Delete it to re-fetch."
fi

echo ""
echo "Start it with:   ./neo4j/bin/neo4j console"
echo "Bolt:             bolt://localhost:7687"
echo "HTTP browser UI:  http://localhost:7474"
echo "Query from CLI:   ./neo4j/bin/cypher-shell -u neo4j -p \"\$NEO4J_PASSWORD\""
