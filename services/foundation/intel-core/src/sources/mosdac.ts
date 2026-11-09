import type { SourceDefinition, SourceResult } from '../types.js';

/**
 * REWORK NEEDED — this is a stub, not a working integration.
 *
 * MOSDAC (ISRO's Meteorological & Oceanographic Satellite Data Archival
 * Centre) is the India-fidelity source you asked for — INSAT-3D/3DR/3DS,
 * Oceansat-2, SCATSAT-1, Megha-Tropiques, SARAL data — but unlike every
 * other source in this service, it does NOT expose a plain, documented
 * HTTP/REST endpoint for its "Open Data" products. What's actually
 * documented (mosdac.gov.in/node/2070, /node/2052):
 *
 *   - A desktop tool ("mdapi.py") that authenticates with your MOSDAC
 *     account username/password (not an API key/token) via a config.json
 *     file, then runs as a local script to pull files.
 *   - Browsing/searching the catalog needs no login; downloading does.
 *   - No published base URL, request shape, or response schema for calling
 *     it as a remote HTTP API — it's built to run on a user's machine.
 *   - Rate limits: max 100 results per query, 5,000 files/day, account
 *     locks for 1 hour after 3 failed logins.
 *
 * To make this real, one of:
 *   1. Register a MOSDAC account, get support (admin@mosdac.gov.in) to
 *      confirm whether mdapi.py's underlying calls can be replayed directly
 *      with a session cookie from this service (unverified — would need
 *      reverse-engineering mdapi.py's actual HTTP traffic).
 *   2. Run mdapi.py as a scheduled subprocess on a box with stored
 *      credentials, writing results to a shared location this service reads
 *      — architecturally different from every other source here (push vs.
 *      pull), and credential handling needs its own security review before
 *      doing this.
 *   3. Treat MOSDAC as a batch/offline ingestion job outside intel-core's
 *      request-response model entirely, and only surface its output through
 *      intel-core once it's already normalized somewhere else.
 *
 * None of this is wired up. This module registers the source so it shows up
 * in `/v1/sources` with the gap stated, rather than being silently absent.
 */
async function fetchMosdac(): Promise<SourceResult> {
  return {
    source: 'mosdac',
    fetchedAt: new Date().toISOString(),
    items: [],
    error:
      'Not implemented: MOSDAC has no documented public HTTP API for Open Data products — only a credentialed desktop download tool (mdapi.py). See top-of-file comment for the real integration paths to evaluate.',
  };
}

export const mosdacSource: SourceDefinition = {
  name: 'mosdac',
  tier: 'rework',
  reworkNote:
    'Stub only — MOSDAC requires MOSDAC account credentials via a local script (mdapi.py), not a callable HTTP API. Needs an architecture decision (see file comment) before this can return real data.',
  fetch: fetchMosdac,
};
