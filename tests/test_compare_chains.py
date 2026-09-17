"""Unit tests for chain-compare sampling and mismatch reporting."""

from __future__ import annotations

import unittest

from neop_cli.compare_chains import (
    compare_block_hashes,
    core_isolation_snapshot,
    isolation_unchanged,
    sample_heights,
    utxo_hash,
)


class SampleHeightsTests(unittest.TestCase):
    def test_stride_and_dense_tail(self):
        heights = sample_heights(100, stride=50, dense_from=90)
        self.assertEqual(heights, [0, 50, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100])

    def test_dense_from_past_tip_still_includes_tip(self):
        self.assertEqual(sample_heights(10, stride=10, dense_from=961_600), [0, 10])


class CompareTests(unittest.TestCase):
    def test_mismatch_recorded(self):
        bad = compare_block_hashes(
            [1, 2],
            lambda h: f"L{h}",
            lambda h: "L1" if h == 1 else "OTHER",
        )
        self.assertEqual(len(bad), 1)
        self.assertEqual(bad[0].height, 2)

    def test_muhash_prefers_muhash_field(self):
        self.assertEqual(utxo_hash({"muhash": "aa", "hash_serialized_2": "bb"}), "aa")

    def test_isolation_snapshot_round_trip(self):
        snap = core_isolation_snapshot(
            {"blocks": 5, "headers": 5, "bestblockhash": "ab"},
            {"txindex": {"synced": True, "best_block_height": 5}},
        )
        self.assertTrue(isolation_unchanged(snap, dict(snap)))
        changed = dict(snap)
        changed["blocks"] = 6
        self.assertFalse(isolation_unchanged(snap, changed))


if __name__ == "__main__":
    unittest.main()
