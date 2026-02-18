#!/usr/bin/env python3
"""
Safe Stripe readiness check for Day 10.
Prints only presence/format metadata, never secret values.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


REQUIRED_KEYS = [
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_BASIC",
    "STRIPE_PRICE_PRO",
    "STRIPE_COUPON_BASIC_INTRO",
    "STRIPE_COUPON_PRO_INTRO",
    "STRIPE_SUCCESS_URL",
    "STRIPE_CANCEL_URL",
]


def key_prefix_ok(name: str, value: str) -> bool:
    if not value:
        return False
    if name == "STRIPE_PUBLISHABLE_KEY":
        return value.startswith(("pk_live_", "pk_test_"))
    if name == "STRIPE_SECRET_KEY":
        return value.startswith(("sk_live_", "sk_test_"))
    if name == "STRIPE_WEBHOOK_SECRET":
        return value.startswith("whsec_")
    if name in {"STRIPE_PRICE_BASIC", "STRIPE_PRICE_PRO"}:
        return value.startswith("price_")
    if name in {"STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL"}:
        return value.startswith(("http://", "https://"))
    return True


def main() -> int:
    print("DAY10_STRIPE_READINESS_START")
    all_present = True
    all_format_ok = True

    for key in REQUIRED_KEYS:
        value = os.getenv(key, "")
        present = bool(value)
        format_ok = key_prefix_ok(key, value) if present else False
        if not present:
            all_present = False
        if present and not format_ok:
            all_format_ok = False
        print(f"{key}: present={'yes' if present else 'no'} format_ok={'yes' if format_ok else 'no'} len={len(value)}")

    try:
        import stripe  # noqa: F401
        stripe_module = True
    except Exception:
        stripe_module = False

    print(f"stripe_module_available: {'yes' if stripe_module else 'no'}")

    checkout_ready = (
        stripe_module
        and all(
            os.getenv(k, "")
            for k in [
                "STRIPE_PUBLISHABLE_KEY",
                "STRIPE_SECRET_KEY",
                "STRIPE_PRICE_BASIC",
                "STRIPE_PRICE_PRO",
            ]
        )
    )
    webhook_ready = stripe_module and bool(os.getenv("STRIPE_SECRET_KEY", "")) and bool(os.getenv("STRIPE_WEBHOOK_SECRET", ""))
    print(f"ready_for_checkout: {'yes' if checkout_ready else 'no'}")
    print(f"ready_for_webhook: {'yes' if webhook_ready else 'no'}")
    print("DAY10_STRIPE_READINESS_END")

    if checkout_ready and webhook_ready and all_format_ok and all_present:
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
