#!/usr/bin/env python
"""Manual publisher for Fragility Brief archive releases."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any, Dict


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Publish a Fragility Brief release to the server-side archive."
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("WSSI_API_BASE_URL", "https://polycrisis-intelligence-production.up.railway.app"),
        help="Base API URL (default: %(default)s)",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("WSSI_BRIEF_PUBLISH_TOKEN", ""),
        help="Publish token. If omitted, reads WSSI_BRIEF_PUBLISH_TOKEN.",
    )
    parser.add_argument("--release-date", default="", help="Optional release date (YYYY-MM-DD)")
    parser.add_argument("--notes", default="", help="Optional release notes")
    parser.add_argument("--created-by", default="script", help="Creator label stored with release metadata")
    return parser


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
    with urllib.request.urlopen(request, timeout=45) as response:
        body = response.read().decode("utf-8")
        return json.loads(body)


def main() -> int:
    args = build_parser().parse_args()
    base_url = args.base_url.rstrip("/")
    token = str(args.token or "").strip()
    if not token:
        print("ERROR: missing publish token. Provide --token or set WSSI_BRIEF_PUBLISH_TOKEN.", file=sys.stderr)
        return 2

    payload: Dict[str, Any] = {"created_by": args.created_by}
    if args.release_date:
        payload["release_date"] = args.release_date
    if args.notes:
        payload["notes"] = args.notes

    endpoint = f"{base_url}/api/v1/briefs/releases/publish"
    try:
        result = post_json(
            endpoint,
            headers={"X-Brief-Publish-Token": token},
            payload=payload,
        )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"ERROR: publish failed ({exc.code})", file=sys.stderr)
        print(body, file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"ERROR: request failed: {exc}", file=sys.stderr)
        return 1

    release = result.get("release", {})
    links = release.get("links", {})
    print("DAY11_5_PUBLISH_START")
    print(f"release_id: {release.get('release_id', 'unknown')}")
    print(f"release_date: {release.get('release_date', 'unknown')}")
    print(f"published_at: {release.get('published_at', 'unknown')}")
    print(f"archive_page_url: {result.get('archive_page_url', '')}")
    print(f"free_view_url: {links.get('free', {}).get('view_url', '')}")
    print(f"paid_view_url: {(links.get('paid') or {}).get('view_url', '')}")
    print("DAY11_5_PUBLISH_END")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
