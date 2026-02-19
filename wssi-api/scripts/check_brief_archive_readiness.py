#!/usr/bin/env python
"""Check brief archive readiness from the API readiness endpoint."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any, Dict


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read /api/v1/briefs/releases/readiness and print operator summary.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("WSSI_API_BASE_URL", "https://polycrisis-intelligence-production.up.railway.app"),
        help="Base API URL",
    )
    return parser


def fetch_json(url: str) -> Dict[str, Any]:
    request = urllib.request.Request(url=url, method="GET", headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    args = build_parser().parse_args()
    endpoint = f"{args.base_url.rstrip('/')}/api/v1/briefs/releases/readiness"
    try:
        payload = fetch_json(endpoint)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"ERROR: readiness check failed ({exc.code})", file=sys.stderr)
        print(body, file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"ERROR: readiness request failed: {exc}", file=sys.stderr)
        return 1

    status = str(payload.get("status") or "unknown")
    blocked = bool(payload.get("publish_blocked"))
    core_missing = payload.get("core_missing") if isinstance(payload.get("core_missing"), list) else []
    dataset_status = payload.get("dataset_status") if isinstance(payload.get("dataset_status"), dict) else {}
    publish_health = payload.get("publish_health") if isinstance(payload.get("publish_health"), dict) else {}
    missing_sections = publish_health.get("missing_sections") if isinstance(publish_health.get("missing_sections"), list) else []
    stale_sections = publish_health.get("stale_sections") if isinstance(publish_health.get("stale_sections"), list) else []

    print("DAY11_5_READINESS_START")
    print(f"status: {status}")
    print(f"publish_blocked: {'yes' if blocked else 'no'}")
    print(f"core_missing: {', '.join(core_missing) if core_missing else 'none'}")
    print(f"missing_sections: {', '.join(missing_sections) if missing_sections else 'none'}")
    print(f"stale_sections: {', '.join(stale_sections) if stale_sections else 'none'}")

    for key in sorted(dataset_status.keys()):
        row = dataset_status.get(key) if isinstance(dataset_status.get(key), dict) else {}
        available = "yes" if row.get("available") else "no"
        freshness = str(row.get("freshness") or "unknown")
        source = str(row.get("source_path") or "--")
        print(f"dataset[{key}]: available={available} freshness={freshness} source={source}")

    print("DAY11_5_READINESS_END")
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())

