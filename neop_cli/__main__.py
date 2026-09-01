"""CLI entry: python -m neop_cli …"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional, Sequence

from neop_cli import __version__
from neop_cli.electrum_endpoints import format_endpoints
from neop_cli.protect import check_signed_hex, protect_psbt
from neop_cli.rpc import BitcoinRpc, RpcError


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="neop_cli",
        description="Neapolitan helpers: Core-bound protect PSBT and Electrum pairing hints.",
    )
    p.add_argument("--version", action="version", version=f"neop_cli {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    ep = sub.add_parser("electrum-endpoints", help="Print Fulcrum/Shulcrum host:ports + wallet pairing")
    ep.add_argument("--network", default="testnet4", choices=["testnet4", "regtest", "main"])
    ep.add_argument("--host", default=None, help="Override NEOP_ELECTRUM_HOST / ELECTRUM_HOST")
    ep.add_argument("--tls", action="store_true", help="Print ssl:// endpoints")

    pp = sub.add_parser("protect-psbt", help="Build Core-bound OP_RETURN>83 PSBT via createpsbt")
    pp.add_argument("--rpc-url", default=None, help="Core/legacy bitcoind RPC URL")
    pp.add_argument("--rpc-user", default=None)
    pp.add_argument("--rpc-password", default=None)
    pp.add_argument("--knots-rpc-url", default=None, help="Optional Knots reject-oracle RPC")
    pp.add_argument("--txid", required=True)
    pp.add_argument("--vout", type=int, required=True)
    pp.add_argument("--to", required=True, dest="payee", help="Payee address")
    pp.add_argument("--amount", default=None, help="Payment BTC (omit with --utxo-sats for whole spend)")
    pp.add_argument("--utxo-sats", type=int, default=None)
    pp.add_argument("--fee-sats", type=int, default=None)
    pp.add_argument("--base-vsize", type=int, default=82)
    pp.add_argument("--feerate", type=float, default=2.45, help="sat/vB when deriving fee")
    pp.add_argument("--memo", default=None)
    pp.add_argument("--data-hex", default=None)
    pp.add_argument("--json", action="store_true", dest="as_json")

    ck = sub.add_parser(
        "check-signed-hex",
        help="testmempoolaccept on Core (+ optional Knots) for a signed raw tx",
    )
    ck.add_argument("--rpc-url", default=None)
    ck.add_argument("--rpc-user", default=None)
    ck.add_argument("--rpc-password", default=None)
    ck.add_argument("--knots-rpc-url", default=None)
    ck.add_argument("--hex", required=True, dest="raw_hex")
    ck.add_argument("--json", action="store_true", dest="as_json")

    return p


def _core_rpc(args: argparse.Namespace) -> BitcoinRpc:
    if args.rpc_url:
        return BitcoinRpc(args.rpc_url, user=args.rpc_user, password=args.rpc_password)
    return BitcoinRpc.from_env()


def _knots_rpc(args: argparse.Namespace) -> Optional[BitcoinRpc]:
    url = getattr(args, "knots_rpc_url", None)
    if not url:
        return None
    return BitcoinRpc(url, user=args.rpc_user, password=args.rpc_password)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.cmd == "electrum-endpoints":
        sys.stdout.write(
            format_endpoints(network=args.network, host=args.host, tls=args.tls)
        )
        return 0

    if args.cmd == "protect-psbt":
        try:
            core = _core_rpc(args)
            knots = _knots_rpc(args)
            result = protect_psbt(
                core_rpc=core.call,
                txid=args.txid,
                vout=args.vout,
                payee_address=args.payee,
                payment_btc=args.amount,
                utxo_sats=args.utxo_sats,
                fee_sats=args.fee_sats,
                base_vsize=args.base_vsize,
                feerate_sat_vb=args.feerate,
                memo=args.memo,
                data_hex=args.data_hex,
                knots_rpc=knots.call if knots else None,
            )
        except (RpcError, ValueError, RuntimeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        if args.as_json:
            print(
                json.dumps(
                    {
                        "psbt": result.psbt,
                        "payload_hex": result.payload_hex,
                        "script_pubkey_len": result.script_pubkey_len,
                        "op_return_vout_vbytes": result.op_return_vout_vbytes,
                        "fee_sats": result.fee_sats,
                        "estimated_total_vsize": result.estimated_total_vsize,
                        "notes": result.notes,
                    },
                    indent=2,
                )
            )
        else:
            print(result.psbt)
            print(file=sys.stderr)
            for note in result.notes:
                print(f"# {note}", file=sys.stderr)
            print(
                f"# scriptPubKey_len={result.script_pubkey_len} "
                f"op_return_vb={result.op_return_vout_vbytes} "
                f"fee_sats={result.fee_sats} est_vsize={result.estimated_total_vsize}",
                file=sys.stderr,
            )
        return 0

    if args.cmd == "check-signed-hex":
        try:
            core = _core_rpc(args)
            knots = _knots_rpc(args)
            out = check_signed_hex(
                raw_hex=args.raw_hex,
                core_rpc=core.call,
                knots_rpc=knots.call if knots else None,
            )
        except (RpcError, ValueError, RuntimeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        if args.as_json:
            print(json.dumps(out, indent=2))
        else:
            print(json.dumps(out, indent=2))
        return 0

    parser.error(f"unknown command {args.cmd}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
