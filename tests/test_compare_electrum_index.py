"""Unit tests for Electrum endpoint parsing used by compare-electrum-index."""

from __future__ import annotations

import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

# Import after path tweak — script is not a package module.
import importlib.util

spec = importlib.util.spec_from_file_location(
    "compare_electrum_index", ROOT / "scripts" / "compare-electrum-index.py"
)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


class EndpointTests(unittest.TestCase):
    def test_tcp_default_port(self):
        scheme, host, port, tls = mod.parse_endpoint("tcp://127.0.0.1")
        self.assertEqual((scheme, host, port, tls), ("tcp", "127.0.0.1", 50001, False))

    def test_ssl_default_port(self):
        scheme, host, port, tls = mod.parse_endpoint("ssl://example.local")
        self.assertEqual((scheme, host, port, tls), ("ssl", "example.local", 50002, True))

    def test_explicit_port(self):
        _, _, port, tls = mod.parse_endpoint("tcp://127.0.0.1:15011")
        self.assertEqual(port, 15011)
        self.assertFalse(tls)


if __name__ == "__main__":
    unittest.main()
