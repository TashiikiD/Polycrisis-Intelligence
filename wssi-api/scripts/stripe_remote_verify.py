#!/usr/bin/env python3
"""
Remote Stripe verification for Day 10 setup.
Requires STRIPE_SECRET_KEY + configured price/coupon IDs in env.
Does not print secrets.
"""

from __future__ import annotations

import os
import sys


def mask(value: str) -> str:
    if not value:
        return "<missing>"
    if len(value) <= 8:
        return value[0] + "***"
    return value[:6] + "..." + value[-4:]


def main() -> int:
    try:
        import stripe
    except Exception:
        print("stripe_module_available: no")
        return 1

    secret_key = os.getenv("STRIPE_SECRET_KEY", "")
    if not secret_key:
        print("STRIPE_SECRET_KEY missing")
        return 1

    stripe.api_key = secret_key

    targets = {
        "price_basic": os.getenv("STRIPE_PRICE_BASIC", ""),
        "price_pro": os.getenv("STRIPE_PRICE_PRO", ""),
        "coupon_basic": os.getenv("STRIPE_COUPON_BASIC_INTRO", ""),
        "coupon_pro": os.getenv("STRIPE_COUPON_PRO_INTRO", ""),
    }

    failures = 0
    print("DAY10_STRIPE_REMOTE_VERIFY_START")

    for name, value in targets.items():
        if not value:
            print(f"{name}: missing")
            failures += 1
            continue
        try:
            if name.startswith("price_"):
                stripe.Price.retrieve(value)
            else:
                stripe.Coupon.retrieve(value)
            print(f"{name}: ok ({mask(value)})")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"{name}: error ({mask(value)}) [{exc.__class__.__name__}]")

    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    print(f"webhook_secret_present: {'yes' if webhook_secret else 'no'}")
    print("DAY10_STRIPE_REMOTE_VERIFY_END")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
