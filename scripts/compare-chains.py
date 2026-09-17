#!/usr/bin/env python3
"""Compare a local tip to a reference tip (hash sweep + tip UTXO hash).

Does not print RPC credentials. Historical muhash is not available from a
tip node; UTXO hashes are compared only when both tips are at the same height.

Example (cookie files stay on the host; do not commit them):

  python scripts/compare-chains.py \\
    --left-url http://127.0.0.1:8332 --left-cookie E:/Bitcoin/.cookie \\
    --right-url http://SSH_HOST:8332 --right-cookie /path/to/knots.cookie
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from neop_cli.compare_chains import (  # noqa: E402
    DEFAULT_DENSE_FROM,
    DEFAULT_STRIDE,
    compare_block_hashes,
    core_isolation_snapshot,
    sample_heights,
    utxo_hash,
)
from neop_cli.rpc import BitcoinRpc  # noqa: E402


def rpc_from_args(url: str, cookie: Optional[str], user: Optional[str], password: Optional[str]) -> BitcoinRpc:
    if cookie:
        raw = Path(cookie).read_text(encoding="ascii").strip()
        cookie_user, cookie_pass = raw.split(":", 1)
        user = user or cookie_user
        password = password or cookie_pass
    return BitcoinRpc(url, user=user, password=password, timeout=120)


def main(argv: Optional[list] = None) -> int:
    p = argparse.ArgumentParser(description="Compare two Bitcoin tips by block hash.")
    p.add_argument("--left-url", required=True)
    p.add_argument("--right-url", required=True)
    p.add_argument("--left-cookie")
    p.add_argument("--right-cookie")
    p.add_argument("--left-user")
    p.add_argument("--left-password")
    p.add_argument("--right-user")
    p.add_argument("--right-password")
    p.add_argument("--stride", type=int, default=DEFAULT_STRIDE)
    p.add_argument("--dense-from", type=int, default=DEFAULT_DENSE_FROM)
    p.add_argument("--json", action="store_true")
    p.add_argument(
        "--isolation-url",
        help="Optional third RPC (usually Core) snapshotted before and after the sweep",
    )
    p.add_argument("--isolation-cookie")
    args = p.parse_args(argv)

    left = rpc_from_args(args.left_url, args.left_cookie, args.left_user, args.left_password)
    right = rpc_from_args(args.right_url, args.right_cookie, args.right_user, args.right_password)

    isolation_before = None
    isolation = None
    if args.isolation_url:
        isolation = rpc_from_args(args.isolation_url, args.isolation_cookie, None, None)
        isolation_before = core_isolation_snapshot(
            isolation.call("getblockchaininfo"),
            isolation.call("getindexinfo"),
        )

    left_info = left.call("getblockchaininfo")
    right_info = right.call("getblockchaininfo")
    left_tip = int(left_info["blocks"])
    right_tip = int(right_info["blocks"])
    tip = min(left_tip, right_tip)
    heights = sample_heights(tip, stride=args.stride, dense_from=args.dense_from)
    mismatches = compare_block_hashes(
        heights,
        lambda h: left.call("getblockhash", [h]),
        lambda h: right.call("getblockhash", [h]),
    )

    left_mu = right_mu = None
    muhash_match = None
    if left_tip == right_tip:
        left_mu = utxo_hash(left.call("gettxoutsetinfo", ["muhash"]))
        right_mu = utxo_hash(right.call("gettxoutsetinfo", ["muhash"]))
        muhash_match = left_mu == right_mu and left_mu is not None

    isolation_after = None
    isolation_ok = None
    if isolation is not None and isolation_before is not None:
        isolation_after = core_isolation_snapshot(
            isolation.call("getblockchaininfo"),
            isolation.call("getindexinfo"),
        )
        isolation_ok = isolation_before == isolation_after

    ok = left_tip == right_tip and not mismatches and muhash_match is not False and isolation_ok is not False
    report = {
        "ok": ok,
        "left_tip": left_tip,
        "right_tip": right_tip,
        "compared": len(heights),
        "mismatches": [{"height": m.height, "left": m.left, "right": m.right} for m in mismatches[:20]],
        "mismatch_count": len(mismatches),
        "muhash_match": muhash_match,
        "isolation_ok": isolation_ok,
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"left_tip={left_tip} right_tip={right_tip} compared={len(heights)} mismatches={len(mismatches)}")
        if muhash_match is not None:
            print(f"muhash_match={muhash_match}")
        if isolation_ok is not None:
            print(f"isolation_ok={isolation_ok}")
        if not ok:
            print("compare failed", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
