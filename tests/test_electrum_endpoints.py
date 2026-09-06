"""Unit tests for electrum endpoint formatting."""

from __future__ import annotations

import unittest

from neop_cli.electrum_endpoints import (
    SHRIKE_RELEASES,
    format_endpoints,
    ports_for_network,
    resolve_host,
)


class TestPorts(unittest.TestCase):
    def test_testnet4(self):
        p = ports_for_network("testnet4")
        self.assertEqual(p.core, 15001)
        self.assertEqual(p.knots, 15011)

    def test_unknown_network(self):
        with self.assertRaises(ValueError):
            ports_for_network("testnet3")


class TestFormat(unittest.TestCase):
    def test_includes_fulcrum_not_electrs_and_shrike(self):
        text = format_endpoints(network="testnet4", host="127.0.0.1")
        self.assertIn("Fulcrum", text)
        self.assertIn("not electrs", text)
        self.assertIn("Shulcrum", text)
        self.assertIn(SHRIKE_RELEASES, text)
        self.assertIn("Sparrow", text)
        self.assertIn("tcp://127.0.0.1:15001", text)
        self.assertIn("tcp://127.0.0.1:15011", text)
        self.assertNotIn("electrs", text.lower().replace("not electrs", ""))

    def test_tls_scheme(self):
        text = format_endpoints(network="main", host="node.example", tls=True)
        self.assertIn("ssl://node.example:50001", text)
        self.assertIn("ssl://node.example:50011", text)

    def test_host_from_env(self):
        self.assertEqual(resolve_host(env={"NEOP_ELECTRUM_HOST": "box.local"}), "box.local")


if __name__ == "__main__":
    unittest.main()
