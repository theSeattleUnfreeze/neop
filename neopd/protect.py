"""Dry-run partition plan and replay counts. neopd does not build or sign PSBTs."""

from __future__ import annotations

from typing import Sequence

from neopd.catalog import Coin, FlavorPresence


def replay_status(coins: Sequence[Coin]) -> dict:
    """Counts only. There is no ceremony ledger, so protected stays zero."""
    both = 0
    legacy_only = 0
    blake2b_only = 0
    for coin in coins:
        if coin.flavor_presence is FlavorPresence.BOTH:
            both += 1
        elif coin.flavor_presence is FlavorPresence.LEGACY_ONLY:
            legacy_only += 1
        elif coin.flavor_presence is FlavorPresence.BLAKE2B_ONLY:
            blake2b_only += 1
    return {
        "both": both,
        "legacy_only": legacy_only,
        "blake2b_only": blake2b_only,
        "pending_knots_pass": both,
        "protected": 0,
        "other_flavor_affected": False,
    }


def protect_plan(coins: Sequence[Coin], *, dry_run: bool) -> dict:
    """Order for partitioning both-coins. No transaction is built or broadcast."""
    steps = []
    for coin in coins:
        if coin.flavor_presence is not FlavorPresence.BOTH:
            continue
        steps.append(
            {
                "txid": coin.txid,
                "vout": coin.vout,
                "order": ["knots", "core"],
                "knots": "Sign with sighash 0x21 and broadcast on Knots only.",
                "core": "After that Knots spend is in a block, spend the Core twin.",
            }
        )
    return {
        "dry_run": bool(dry_run),
        "broadcast": False,
        "psbts": [],
        "both": len(steps),
        "steps": steps,
        "other_flavor_affected": False,
        "note": "neopd does not build or sign PSBTs.",
    }
