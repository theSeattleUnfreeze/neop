"""Unit tests for Core-bound OP_RETURN wedge detection in raw txs."""

from __future__ import annotations

import unittest

from neopd.wedges import has_core_bound_op_return_wedge, has_knots_bound_unified_sighash


WEDGE_TX = (
    "01000000010000000000000000000000000000000000000000000000000000000000000000"
    "000000000100ffffffff02e803000000000000000000000000000000546a4c51"
    + ("41" * 81)
    + "00000000"
)


class WedgeDetectTests(unittest.TestCase):
    def test_detects_op_return_gt_83(self):
        self.assertTrue(has_core_bound_op_return_wedge(WEDGE_TX))

    def test_short_op_return_not_wedge(self):
        # OP_RETURN "hi" — scriptPubKey length 3
        short = (
            "01000000010000000000000000000000000000000000000000000000000000000000000000"
            "000000000100ffffffff01"
            "0000000000000000"  # value
            "03"  # script len
            "6a026869"  # OP_RETURN hi
            "00000000"
        )
        self.assertFalse(has_core_bound_op_return_wedge(short))

    def test_unified_sighash_byte(self):
        self.assertTrue(has_knots_bound_unified_sighash(_keypath(0x21)))
        self.assertFalse(has_knots_bound_unified_sighash(_keypath(0x01)))
        self.assertFalse(has_knots_bound_unified_sighash(_keypath(None)))
        self.assertFalse(has_knots_bound_unified_sighash(WEDGE_TX))


def _keypath(sighash):
    sig = b"\x11" * 64
    if sighash is not None:
        sig += bytes([sighash])
    raw = bytearray()
    raw += b"\x02\x00\x00\x00"
    raw += b"\x00\x01"
    raw += b"\x01"
    raw += b"\x22" * 32
    raw += b"\x00\x00\x00\x00"
    raw += b"\x00"
    raw += b"\xff\xff\xff\xff"
    raw += b"\x01"
    raw += (1000).to_bytes(8, "little")
    raw += b"\x01\x6a"
    raw += b"\x01"
    raw += bytes([len(sig)]) + sig
    raw += b"\x00\x00\x00\x00"
    return raw.hex()


if __name__ == "__main__":
    unittest.main()
