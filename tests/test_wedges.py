"""Unit tests for Core-bound OP_RETURN wedge detection in raw txs."""

from __future__ import annotations

import unittest

from neopd.wedges import has_core_bound_op_return_wedge


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


if __name__ == "__main__":
    unittest.main()
