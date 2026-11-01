#!/usr/bin/env python3
"""Compare two Electrum servers (and optional DB tip stats) for fork-height snapshot tests.

Samples blockchain.scripthash.get_history / listunspent for the given scripthashes
against a left and right Electrum endpoint. Does not print credentials.

Example:

  python scripts/compare-electrum-index.py \\
    --left tcp://127.0.0.1:50001 --right tcp://127.0.0.1:50011 \\
    --scripthash HEX [--scripthash HEX ...]
"""

from __future__ import annotations

import argparse
import json
import socket
import ssl
import sys
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse


def parse_endpoint(url: str) -> Tuple[str, str, int, bool]:
    u = urlparse(url)
    scheme = (u.scheme or "tcp").lower()
    if scheme not in ("tcp", "ssl", "tls"):
        raise ValueError(f"unsupported scheme: {scheme}")
    host = u.hostname or "127.0.0.1"
    default_port = 50002 if scheme in ("ssl", "tls") else 50001
    port = u.port or default_port
    return scheme, host, port, scheme in ("ssl", "tls")


class ElectrumClient:
    def __init__(self, url: str, *, timeout: float = 60.0, tls_insecure: bool = False):
        scheme, host, port, use_tls = parse_endpoint(url)
        self._id = 0
        raw = socket.create_connection((host, port), timeout=timeout)
        if use_tls:
            ctx = ssl.create_default_context()
            if tls_insecure:
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            self.sock = ctx.wrap_socket(raw, server_hostname=host)
        else:
            self.sock = raw
        self.sock.settimeout(timeout)
        self._buf = b""

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def call(self, method: str, params: Optional[list] = None) -> Any:
        self._id += 1
        req = json.dumps({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or []})
        self.sock.sendall(req.encode("utf-8") + b"\n")
        while True:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError(f"EOF waiting for {method}")
            self._buf += chunk
            if b"\n" in self._buf:
                line, self._buf = self._buf.split(b"\n", 1)
                msg = json.loads(line.decode("utf-8"))
                if "error" in msg and msg["error"]:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result")


def compare_scripthash(left: ElectrumClient, right: ElectrumClient, sh: str) -> Dict[str, Any]:
    lh = left.call("blockchain.scripthash.get_history", [sh])
    rh = right.call("blockchain.scripthash.get_history", [sh])
    lu = left.call("blockchain.scripthash.listunspent", [sh])
    ru = right.call("blockchain.scripthash.listunspent", [sh])
    return {
        "scripthash": sh,
        "history_match": lh == rh,
        "unspent_match": lu == ru,
        "left_history_len": len(lh) if isinstance(lh, list) else None,
        "right_history_len": len(rh) if isinstance(rh, list) else None,
        "left_unspent_len": len(lu) if isinstance(lu, list) else None,
        "right_unspent_len": len(ru) if isinstance(ru, list) else None,
    }


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Compare Electrum scripthash views on two servers.")
    p.add_argument("--left", required=True, help="tcp:// or ssl:// Electrum URL")
    p.add_argument("--right", required=True, help="tcp:// or ssl:// Electrum URL")
    p.add_argument("--scripthash", action="append", default=[], help="Hex scripthash (repeatable)")
    p.add_argument("--tls-insecure", action="store_true")
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)

    if not args.scripthash:
        print("at least one --scripthash is required", file=sys.stderr)
        return 2

    left = ElectrumClient(args.left, tls_insecure=args.tls_insecure)
    right = ElectrumClient(args.right, tls_insecure=args.tls_insecure)
    try:
        rows = [compare_scripthash(left, right, sh) for sh in args.scripthash]
    finally:
        left.close()
        right.close()

    ok = all(r["history_match"] and r["unspent_match"] for r in rows)
    report = {"ok": ok, "compared": len(rows), "results": rows}
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"ok={ok} compared={len(rows)}")
        for r in rows:
            print(
                f"  {r['scripthash'][:12]}… history_match={r['history_match']} "
                f"unspent_match={r['unspent_match']}"
            )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
