"""Tests for shared store layout and header routing."""

from __future__ import annotations

import os
import tempfile
import unittest

from neopd.store import (
    HEADER_V2_VERSION_BIT,
    BlockIndexRecord,
    HeaderVersion,
    Shard,
    StoreLayout,
    classify_header,
    shard_for_header,
)


class ClassifyHeaderTests(unittest.TestCase):
    def test_v1_by_length(self):
        self.assertEqual(classify_header(header_len=80), HeaderVersion.V1)

    def test_v2_by_length(self):
        self.assertEqual(classify_header(header_len=164), HeaderVersion.V2)

    def test_v2_by_version_bit(self):
        self.assertEqual(
            classify_header(n_version=HEADER_V2_VERSION_BIT),
            HeaderVersion.V2,
        )

    def test_v1_by_version(self):
        self.assertEqual(classify_header(n_version=0x20000000), HeaderVersion.V1)

    def test_bad_length(self):
        with self.assertRaises(ValueError):
            classify_header(header_len=100)


class StoreLayoutTests(unittest.TestCase):
    def test_ensure_creates_tree(self):
        root = tempfile.mkdtemp()
        store = StoreLayout(root, "testnet4")
        store.ensure()
        for path in (
            store.blocks,
            store.blake2b_shard,
            store.rdts_shard,
            store.chainstate_legacy,
            store.chainstate_blake2b,
            store.electrum,
            os.path.join(store.electrum, "delta-legacy"),
            os.path.join(store.electrum, "delta-blake2b"),
        ):
            self.assertTrue(os.path.isdir(path), path)
        self.assertTrue(os.path.isfile(store.index_path))

    def test_index_roundtrip(self):
        root = tempfile.mkdtemp()
        store = StoreLayout(root, "regtest")
        version = classify_header(header_len=164)
        record = BlockIndexRecord(
            block_hash="ab" * 32,
            header_version=version,
            shard=shard_for_header(version),
            offset=10,
            size=164,
        )
        self.assertEqual(record.shard, Shard.BLAKE2B)
        store.put_index_record(record)
        loaded = store.load_index()
        self.assertEqual(loaded[record.block_hash], record)


if __name__ == "__main__":
    unittest.main()
