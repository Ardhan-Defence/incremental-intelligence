import asyncio
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException

app = FastAPI(title="enrichment-runners")

MAIGRET_TOP_SITES = int(os.environ.get("MAIGRET_TOP_SITES", "500"))
MAIGRET_TIMEOUT_S = int(os.environ.get("MAIGRET_TIMEOUT_S", "60"))
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _resolve_maigret_binary() -> str:
    """
    `maigret` is a console-script installed into whichever environment ran
    `pip install`. A bare "maigret" subprocess call resolves against the
    *calling process's* $PATH — which, if this service was started via an
    absolute interpreter path (e.g. `.venv/bin/uvicorn ...`) without
    activating that venv, does NOT include the venv's bin/ dir, even though
    pip installed maigret right there. Found this the hard way: the service
    started fine, /health worked, and every username check 500'd with
    FileNotFoundError.
    Fix: check $PATH first (covers an activated venv or a normal install),
    then fall back to the same bin/ directory as the running Python
    interpreter (covers an unactivated venv — the common case for anything
    started by a process manager rather than a human's shell).
    """
    found = shutil.which("maigret")
    if found:
        return found
    candidate = os.path.join(os.path.dirname(sys.executable), "maigret")
    if os.path.exists(candidate):
        return candidate
    raise RuntimeError("maigret executable not found on PATH or next to the running interpreter")


MAIGRET_BIN = _resolve_maigret_binary()


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/v1/username/{username}")
async def check_username(username: str):
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Invalid username format")

    with tempfile.TemporaryDirectory() as tmp_dir:
        report_path = os.path.join(tmp_dir, f"report_{username}_ndjson.json")

        # Maigret's CLI writes its JSON report to a file (no stdout JSON
        # mode), so we point --folderoutput at a scratch dir and read the
        # file back rather than parsing stdout.
        cmd = [
            MAIGRET_BIN,
            username,
            "--json", "ndjson",
            "--folderoutput", tmp_dir,
            "--timeout", str(MAIGRET_TIMEOUT_S),
            "--top-sites", str(MAIGRET_TOP_SITES),
            "--no-color",
            "--no-progressbar",
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=MAIGRET_TIMEOUT_S + 15)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Maigret scan timed out")

        if not os.path.exists(report_path):
            # Maigret may name the file differently depending on version —
            # fall back to scanning the temp dir for any ndjson report it wrote.
            candidates = [f for f in os.listdir(tmp_dir) if f.endswith(".json")]
            if not candidates:
                raise HTTPException(
                    status_code=502,
                    detail=f"Maigret produced no report file. stderr: {stderr.decode('utf-8', errors='replace')[:500]}",
                )
            report_path = os.path.join(tmp_dir, candidates[0])

        # Per-line shape confirmed against maigret's own source
        # (MaigretCheckResult.json(), maigret/result.py): the top-level
        # entry is a SiteResult dict; entry["status"] is itself a dict with
        # username/site_name/url/status/ids/tags/keywords.
        matches = []
        with open(report_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                status = entry.get("status") or {}
                if status.get("status") != "Claimed":
                    continue
                matches.append({
                    "site_name": status.get("site_name"),
                    "url": status.get("url"),
                    "tags": status.get("tags"),
                })

        return {
            "username": username,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "sites_checked": MAIGRET_TOP_SITES,
            "matches": matches,
            "match_count": len(matches),
        }
