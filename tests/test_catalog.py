"""Unit tests for replay-safe catalog policy."""

from __future__ import annotations

import unittest

from neopd.catalog import (
    Catalog,
    Coin,
    FlavorPresence,
    SendDecision,
    build_receipt,
    evaluate_send,
)


def _coin(presence: FlavorPresence, txid="aa" * 32, vout=0) -> Coin:
    return Coin(txid=txid, vout=vout, flavor_presence=presence)


class EvaluateSendTests(unittest.TestCase):
    def test_refuse_both_without_ceremony(self):
        decision = evaluate_send(
            "legacy",
            [_coin(FlavorPresence.BOTH)],
            allow_dual_effect=False,
        )
        self.assertEqual(decision, SendDecision.REPLAY_RISK_UNRESOLVED)

    def test_unique_input_allows_legacy(self):
        decision = evaluate_send(
            "legacy",
            [
                _coin(FlavorPresence.BOTH, vout=0),
                _coin(FlavorPresence.LEGACY_ONLY, vout=1),
            ],
        )
        self.assertEqual(decision, SendDecision.ALLOW)

    def test_unique_input_allows_blake2b(self):
        decision = evaluate_send(
            "blake2b",
            [_coin(FlavorPresence.BLAKE2B_ONLY)],
        )
        self.assertEqual(decision, SendDecision.ALLOW)

    def test_dual_effect_escape(self):
        decision = evaluate_send(
            "blake2b",
            [_coin(FlavorPresence.BOTH)],
            allow_dual_effect=True,
        )
        self.assertEqual(decision, SendDecision.ALLOW)

    def test_wrong_flavor_only_refused(self):
        decision = evaluate_send(
            "legacy",
            [_coin(FlavorPresence.BLAKE2B_ONLY)],
        )
        self.assertEqual(decision, SendDecision.REPLAY_RISK_UNRESOLVED)

    def test_receipt_shape(self):
        receipt = build_receipt("blake2b", "ab" * 32, allow_dual_effect=False)
        self.assertEqual(
            receipt.to_dict(),
            {
                "flavor": "blake2b",
                "txid": "ab" * 32,
                "other_flavor_affected": False,
            },
        )
        dual = build_receipt("legacy", "cd" * 32, allow_dual_effect=True)
        self.assertTrue(dual.other_flavor_affected)


class CatalogTests(unittest.TestCase):
    def test_list_and_resolve(self):
        c = _coin(FlavorPresence.LEGACY_ONLY)
        cat = Catalog([c])
        self.assertEqual(cat.list_coins()[0].to_dict()["replay_risk"], "none")
        resolved = cat.resolve_inputs([{"txid": c.txid, "vout": c.vout}])
        self.assertEqual(resolved, [c])


if __name__ == "__main__":
    unittest.main()
