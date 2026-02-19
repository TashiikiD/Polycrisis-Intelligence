#!/usr/bin/env python
"""Push local analytics artifacts to the API canonical runtime store."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict

ALLOWED_FILES = [
    "wssi-latest.json",
    "wssi-history.json",
    "alerts.json",
    "correlations.json",
    "network.json",
    "patterns.json",
    "indicators-latest.json",
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Push analytics JSON bundle to /api/v1/analytics/ingest.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("WSSI_API_BASE_URL", "https://polycrisis-intelligence-production.up.railway.app"),
        help="Base API URL",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("WSSI_ANALYTICS_INGEST_TOKEN", os.getenv("WSSI_BRIEF_PUBLISH_TOKEN", "")),
        help="Analytics ingest token (defaults to env).",
    )
    parser.add_argument(
        "--input-dir",
        default=os.getenv("WSSI_LOCAL_ANALYTICS_DIR", "output/analytics"),
        help="Directory containing analytics JSON artifacts.",
    )
    parser.add_argument("--source", default="manual-script", help="Source label written by ingest endpoint.")
    parser.add_argument("--dry-run", action="store_true", help="Validate files and print payload summary without POST.")
    return parser


def load_bundle(input_dir: Path) -> Dict[str, Any]:
    files: Dict[str, Any] = {}
    for filename in ALLOWED_FILES:
        target = input_dir / filename
        if not target.exists():
            continue
        with target.open("r", encoding="utf-8") as handle:
            files[filename] = json.load(handle)
    return files


def post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> Dict[str, Any]:
    request = urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            **headers,
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    args = build_parser().parse_args()
    token = str(args.token or "").strip()
    if not token:
        print("ERROR: missing ingest token. Set --token or WSSI_ANALYTICS_INGEST_TOKEN.", file=sys.stderr)
        return 2

    input_dir = Path(args.input_dir).expanduser().resolve()
    if not input_dir.exists():
        print(f"ERROR: input directory not found: {input_dir}", file=sys.stderr)
        return 2

    files = load_bundle(input_dir)
    if not files:
        print(f"ERROR: no known analytics files found in {input_dir}", file=sys.stderr)
        print(f"Expected one or more of: {', '.join(ALLOWED_FILES)}", file=sys.stderr)
        return 2

    print("DAY11_5_INGEST_BUNDLE_START")
    print(f"input_dir: {input_dir}")
    print(f"file_count: {len(files)}")
    print(f"files: {', '.join(sorted(files.keys()))}")

    if args.dry_run:
        print("mode: dry-run")
        print("DAY11_5_INGEST_BUNDLE_END")
        return 0

    endpoint = f"{args.base_url.rstrip('/')}/api/v1/analytics/ingest"
    payload = {"source": args.source, "files": files}
    try:
        response = post_json(
            endpoint,
            headers={"X-Analytics-Ingest-Token": token},
            payload=payload,
        )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"ERROR: ingest failed ({exc.code})", file=sys.stderr)
        print(body, file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"ERROR: ingest request failed: {exc}", file=sys.stderr)
        return 1

    print(f"status: {response.get('status', 'unknown')}")
    print(f"written_count: {response.get('written_count', 0)}")
    print(f"analytics_dir: {response.get('analytics_dir', '')}")
    print("DAY11_5_INGEST_BUNDLE_END")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

