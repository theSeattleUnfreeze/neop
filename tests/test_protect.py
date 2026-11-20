"""protectwallet plan and getreplaystatus counts."""

from __future__ import annotations

import unittest

from neopd.catalog import Catalog, Coin, FlavorPresence, evaluate_send, SendDecision
from neopd.protect import protect_plan, replay_status


def _coin(presence: FlavorPresence, vout: int = 0) -> Coin:
    return Coin(txid="ab" * 32, vout=vout, flavor_presence=presence)


class ProtectTests(unittest.TestCase):
    def test_status_counts_both_as_pending(self):
        status = replay_status(
            [
                _coin(FlavorPresence.BOTH, 0),
                _coin(FlavorPresence.LEGACY_ONLY, 1),
                _coin(FlavorPresence.BLAKE2B_ONLY, 2),
            ]
        )
        self.assertEqual(status["both"], 1)
        self.assertEqual(status["pending_knots_pass"], 1)
        self.assertEqual(status["protected"], 0)
        self.assertFalse(status["other_flavor_affected"])
        self.assertNotIn("psbt", status)

    def test_plan_orders_knots_then_core_and_does_not_broadcast(self):
        plan = protect_plan(
            [_coin(FlavorPresence.BOTH, 0), _coin(FlavorPresence.LEGACY_ONLY, 1)],
            dry_run=True,
        )
        self.assertEqual(plan["both"], 1)
        self.assertEqual(plan["steps"][0]["order"], ["knots", "core"])
        self.assertEqual(plan["psbts"], [])
        self.assertFalse(plan["broadcast"])
        self.assertFalse(plan["other_flavor_affected"])

    def test_live_request_still_builds_nothing(self):
        plan = protect_plan([_coin(FlavorPresence.BOTH)], dry_run=False)
        self.assertFalse(plan["dry_run"])
        self.assertEqual(plan["psbts"], [])
        self.assertFalse(plan["broadcast"])
        decision = evaluate_send("blake2b", [_coin(FlavorPresence.BOTH)])
        self.assertEqual(decision, SendDecision.REPLAY_RISK_UNRESOLVED)

    def test_rpc_methods_do_not_touch_engines(self):
        from neopd.config import Config
        from neopd.rpc import NeopdService
        from neopd.store import StoreLayout
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            config = Config(network="testnet4", datadir=tmp)
            service = NeopdService(
                config,
                StoreLayout(tmp, "testnet4"),
                catalog=Catalog([_coin(FlavorPresence.BOTH)]),
            )
            service.legacy = None  # type: ignore[assignment]
            service.blake2b = None  # type: ignore[assignment]
            status = service.getreplaystatus({})
            plan = service.protectwallet({"dry_run": False})
        self.assertEqual(status["both"], 1)
        self.assertEqual(plan["psbts"], [])
        self.assertFalse(plan["broadcast"])


if __name__ == "__main__":
    unittest.main()
