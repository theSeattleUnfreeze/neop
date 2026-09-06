"""CLI entry: python -m neopd"""

from __future__ import annotations

import argparse
import sys

from neopd import __version__
from neopd.config import NETWORKS, Config
from neopd.rpc import serve
from neopd.store import StoreLayout


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="neopd",
        description=(
            "Neapolitan dual-flavor mux daemon. "
            "Validation engines are pinned Core/Knots — neopd does not "
            "reimplement Blake2b PoW."
        ),
    )
    p.add_argument("--version", action="version", version=__version__)
    p.add_argument(
        "--network",
        choices=NETWORKS,
        default=None,
        help="Network profile (default: testnet4 or NEOP_NETWORK)",
    )
    p.add_argument(
        "--datadir",
        default=None,
        help="Data root containing <network>/ layout",
    )
    p.add_argument("--bind", default=None, help="RPC bind address")
    p.add_argument("--port", type=int, default=None, help="RPC port")
    p.add_argument(
        "--ensure-store",
        action="store_true",
        help="Create datadir layout and exit",
    )
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    config = Config.from_env(
        network=args.network,
        datadir=args.datadir,
        bind=args.bind,
        port=args.port,
    )
    store = StoreLayout(config.datadir, config.network)
    if args.ensure_store:
        store.ensure()
        print(store.base)
        return 0
    serve(config)
    return 0


if __name__ == "__main__":
    sys.exit(main())
