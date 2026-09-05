"""Ceremony flow tests with mock RPC (no live bitcoind)."""

from __future__ import annotations

import unittest
from typing import Any, List, Optional, Sequence

from neop_cli.core_bound import MIN_WEDGE_SCRIPT_PUBKEY_LEN, script_pubkey_len
from neop_cli.protect import check_signed_hex, protect_psbt


class MockRpc:
    def __init__(self):
        self.calls: List[tuple] = []
        self.createpsbt_result = "cHNidP8BAFakePsbtForUnitTest"
        self.mempool_core = [{"txid": "aa" * 32, "allowed": True}]
        self.mempool_knots = [
            {
                "txid": "aa" * 32,
                "allowed": False,
                "reject-reason": "scriptpubkey",
                "reject-details": "scriptpubkey",
            }
        ]

    def __call__(self, method: str, params: Optional[Sequence[Any]] = None) -> Any:
        self.calls.append((method, list(params or [])))
        if method == "createpsbt":
            return self.createpsbt_result
        if method == "testmempoolaccept":
            # Distinguish by which mock instance — set on subclass wrappers
            return getattr(self, "_accept", self.mempool_core)
        raise AssertionError(f"unexpected method {method}")


class TestProtectPsbt(unittest.TestCase):
    def test_builds_psbt_with_wedge_data_output(self):
        core = MockRpc()
        quote = (
            "It is unwise to underestimate the forces of the adversaries [evil], "
            "especially when their beloved Kali Yuga comes to its end. "
            "Certainly it is a decisive battle and one should take care..."
        )
        result = protect_psbt(
            core_rpc=core,
            txid="65c17e8886bdb2dbb072a2bf94770bc2ad5f01f531658fd00e71a309bf623c28",
            vout=0,
            payee_address="bc1qvpyz37mpg5dm4gj4zhahe59cl8syl473vdsqt3",
            utxo_sats=1_663_494,
            fee_sats=701,
            memo=quote,
        )
        self.assertEqual(result.psbt, core.createpsbt_result)
        self.assertGreaterEqual(result.script_pubkey_len, MIN_WEDGE_SCRIPT_PUBKEY_LEN)
        self.assertEqual(result.fee_sats, 701)
        self.assertEqual(len(core.calls), 1)
        method, params = core.calls[0]
        self.assertEqual(method, "createpsbt")
        inputs, outputs = params
        self.assertEqual(inputs[0]["vout"], 0)
        self.assertIn("data", outputs[1])
        data = bytes.fromhex(outputs[1]["data"])
        self.assertEqual(data, quote.encode("utf-8"))
        self.assertGreaterEqual(script_pubkey_len(data), MIN_WEDGE_SCRIPT_PUBKEY_LEN)
        # payment 0.01662793
        self.assertEqual(outputs[0]["bc1qvpyz37mpg5dm4gj4zhahe59cl8syl473vdsqt3"], "0.01662793")
        self.assertTrue(any("neopd sendrawtransaction" in n for n in result.notes))
        self.assertTrue(any(">83" in n for n in result.notes))

    def test_derived_fee_when_only_utxo_sats(self):
        core = MockRpc()
        result = protect_psbt(
            core_rpc=core,
            txid="11" * 32,
            vout=1,
            payee_address="bc1qtest",
            utxo_sats=100_000,
            base_vsize=82,
            feerate_sat_vb=2.45,
            memo="derive-fee",
        )
        self.assertIsNotNone(result.fee_sats)
        self.assertGreater(result.fee_sats, 200)
        self.assertIsNotNone(result.estimated_total_vsize)
        self.assertGreater(result.estimated_total_vsize, 82)

    def test_rejects_bad_txid_before_rpc(self):
        core = MockRpc()
        with self.assertRaises(ValueError):
            protect_psbt(
                core_rpc=core,
                txid="nope",
                vout=0,
                payee_address="bc1q",
                payment_btc="0.01",
                memo="x",
            )
        self.assertEqual(core.calls, [])


class TestCheckSignedHex(unittest.TestCase):
    def test_knots_reject_is_success_path(self):
        core = MockRpc()
        core._accept = [{"allowed": True}]
        knots = MockRpc()
        knots._accept = [{"allowed": False, "reject-reason": "scriptpubkey"}]
        out = check_signed_hex(raw_hex="00", core_rpc=core, knots_rpc=knots)
        self.assertTrue(out.get("knots_reject_ok"))
        self.assertEqual(out.get("knots_reject_reason"), "scriptpubkey")

    def test_knots_allow_raises(self):
        core = MockRpc()
        core._accept = [{"allowed": True}]
        knots = MockRpc()
        knots._accept = [{"allowed": True}]
        with self.assertRaises(RuntimeError) as ctx:
            check_signed_hex(raw_hex="00", core_rpc=core, knots_rpc=knots)
        self.assertIn("wedge", str(ctx.exception).lower())

    def test_core_reject_warns(self):
        core = MockRpc()
        core._accept = [{"allowed": False, "reject-reason": "datacarrier"}]
        out = check_signed_hex(raw_hex="00", core_rpc=core, knots_rpc=None)
        self.assertIn("core_warning", out)


class TestCliSmoke(unittest.TestCase):
    def test_electrum_endpoints_exit_zero(self):
        from neop_cli.__main__ import main

        self.assertEqual(main(["electrum-endpoints", "--network", "testnet4"]), 0)


if __name__ == "__main__":
    unittest.main()
