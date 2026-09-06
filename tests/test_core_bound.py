"""Unit tests for Core-bound OP_RETURN wedge helpers."""

from __future__ import annotations

import math
import unittest

from neop_cli.core_bound import (
    MIN_WEDGE_SCRIPT_PUBKEY_LEN,
    assert_wedge,
    build_createpsbt_inputs,
    build_createpsbt_outputs,
    estimate_fee_sats,
    estimate_op_return_vout_vbytes,
    op_return_script_pubkey,
    pad_payload_to_wedge,
    payment_btc_for_whole_utxo,
    resolve_op_return_payload,
    script_pubkey_len,
)


class TestOpReturnScript(unittest.TestCase):
    def test_short_push(self):
        data = b"hi"
        spk = op_return_script_pubkey(data)
        self.assertEqual(spk[0], 0x6A)
        self.assertEqual(spk[1], 2)
        self.assertEqual(spk[2:], data)
        self.assertEqual(script_pubkey_len(data), 4)

    def test_pushdata1_for_large(self):
        data = bytes([0x41]) * 80
        spk = op_return_script_pubkey(data)
        self.assertEqual(spk[0], 0x6A)
        self.assertEqual(spk[1], 0x4C)
        self.assertEqual(spk[2], 80)
        self.assertEqual(len(spk), 83)

    def test_eighty_one_bytes_clears_wedge(self):
        data = bytes([0x42]) * 81
        self.assertGreaterEqual(script_pubkey_len(data), MIN_WEDGE_SCRIPT_PUBKEY_LEN)
        assert_wedge(data)

    def test_eighty_byte_payload_is_not_wedge(self):
        data = bytes([0x42]) * 80
        self.assertEqual(script_pubkey_len(data), 83)
        with self.assertRaises(ValueError):
            assert_wedge(data)


class TestResolvePayload(unittest.TestCase):
    def test_memo_padded_to_wedge(self):
        payload = resolve_op_return_payload(memo="short")
        self.assertGreaterEqual(script_pubkey_len(payload), MIN_WEDGE_SCRIPT_PUBKEY_LEN)
        self.assertTrue(payload.startswith(b"short"))

    def test_long_quote_unpadded_still_wedge(self):
        quote = (
            "It is unwise to underestimate the forces of the adversaries [evil], "
            "especially when their beloved Kali Yuga comes to its end. "
            "Certainly it is a decisive battle and one should take care..."
        )
        payload = resolve_op_return_payload(memo=quote, pad=False)
        self.assertEqual(payload, quote.encode("utf-8"))
        self.assertGreaterEqual(script_pubkey_len(payload), MIN_WEDGE_SCRIPT_PUBKEY_LEN)

    def test_data_hex_wins_over_memo(self):
        payload = resolve_op_return_payload(memo="ignored", data_hex="010203", pad=True)
        self.assertTrue(payload.startswith(bytes.fromhex("010203")))

    def test_data_hex_odd_length_errors(self):
        with self.assertRaises(ValueError):
            resolve_op_return_payload(data_hex="abc", pad=False)

    def test_no_pad_short_errors(self):
        with self.assertRaises(ValueError):
            resolve_op_return_payload(memo="x", pad=False)

    def test_default_marker_pads(self):
        payload = resolve_op_return_payload()
        self.assertTrue(payload.startswith(b"neop-core-bound"))
        assert_wedge(payload)


class TestPad(unittest.TestCase):
    def test_pad_increments_until_threshold(self):
        base = b"x"
        padded = pad_payload_to_wedge(base)
        self.assertGreaterEqual(script_pubkey_len(padded), MIN_WEDGE_SCRIPT_PUBKEY_LEN)
        # Removing last pad byte should drop below threshold for this small base
        if len(padded) > 1:
            shorter = padded[:-1]
            self.assertLess(script_pubkey_len(shorter), MIN_WEDGE_SCRIPT_PUBKEY_LEN)


class TestFeeEstimate(unittest.TestCase):
    def test_op_return_vout_includes_value_and_script(self):
        payload = bytes([0x01]) * 81
        vb = estimate_op_return_vout_vbytes(payload)
        # 8 value + 1 scriptlen + (1+1+1+81)=84 script → 93
        self.assertEqual(vb, 8 + 1 + script_pubkey_len(payload))

    def test_fee_scales_with_added_vbytes(self):
        payload = resolve_op_return_payload(memo="fee-test")
        fee = estimate_fee_sats(base_vsize=82, payload=payload, feerate_sat_vb=2.45)
        total_v = 82 + estimate_op_return_vout_vbytes(payload)
        self.assertEqual(fee, int(math.ceil(total_v * 2.45)))
        # Must exceed fee for base alone
        base_only = int(math.ceil(82 * 2.45))
        self.assertGreater(fee, base_only)
        # Roughly +200 vB class for large OP_RETURN
        self.assertGreaterEqual(estimate_op_return_vout_vbytes(payload), 90)


class TestCreatepsbtShapes(unittest.TestCase):
    def test_inputs_validate_txid(self):
        with self.assertRaises(ValueError):
            build_createpsbt_inputs("dead", 0)
        txid = "ab" * 32
        self.assertEqual(build_createpsbt_inputs(txid, 0), [{"txid": txid, "vout": 0}])

    def test_outputs_include_data(self):
        payload = resolve_op_return_payload(memo="out")
        outs = build_createpsbt_outputs(
            payee_address="bc1qexample", payment_btc="0.01662793", payload=payload
        )
        self.assertEqual(outs[0], {"bc1qexample": "0.01662793"})
        self.assertEqual(outs[1], {"data": payload.hex()})

    def test_whole_utxo_payment(self):
        # 1663494 - 701 = 1662793 sats = 0.01662793
        self.assertEqual(payment_btc_for_whole_utxo(utxo_sats=1_663_494, fee_sats=701), "0.01662793")
        with self.assertRaises(ValueError):
            payment_btc_for_whole_utxo(utxo_sats=100, fee_sats=100)


if __name__ == "__main__":
    unittest.main()
