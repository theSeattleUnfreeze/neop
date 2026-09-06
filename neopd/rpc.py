"""Minimal stdlib JSON-RPC HTTP server for neopd."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from neopd.catalog import Catalog, SendDecision, build_receipt, evaluate_send
from neopd.config import Config, parse_flavor
from neopd.engines import EngineClient, EngineError
from neopd.store import StoreLayout

JsonDict = Dict[str, Any]


class RpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super(RpcError, self).__init__(message)
        self.code = code
        self.message = message


class NeopdService:
    """RPC methods: store, engines, and replay-safe send."""

    def __init__(
        self,
        config: Config,
        store: StoreLayout,
        legacy: Optional[EngineClient] = None,
        blake2b: Optional[EngineClient] = None,
        catalog: Optional[Catalog] = None,
    ) -> None:
        self.config = config
        self.store = store
        self.legacy = legacy or EngineClient(
            config.legacy_rpc_url,
            config.legacy_rpc_user,
            config.legacy_rpc_password,
            flavor="legacy",
        )
        self.blake2b = blake2b or EngineClient(
            config.blake2b_rpc_url,
            config.blake2b_rpc_user,
            config.blake2b_rpc_password,
            flavor="blake2b",
        )
        self.catalog = catalog or Catalog()
        self._methods = {
            "getnetwork": self.getnetwork,
            "getstoreinfo": self.getstoreinfo,
            "getflavors": self.getflavors,
            "getblockchaininfo": self.getblockchaininfo,
            "listcoins": self.listcoins,
            "sendrawtransaction": self.sendrawtransaction,
            "help": self.help,
        }

    def _engine(self, flavor: str) -> EngineClient:
        if flavor == "legacy":
            return self.legacy
        return self.blake2b

    def help(self, _params: JsonDict) -> Any:
        return sorted(self._methods.keys())

    def getnetwork(self, _params: JsonDict) -> Any:
        return {"network": self.config.network}

    def getstoreinfo(self, _params: JsonDict) -> Any:
        self.store.ensure()
        index = self.store.load_index()
        return {
            "network": self.config.network,
            "datadir": self.store.base,
            "paths": {
                "blocks": self.store.blocks,
                "blake2b_shard": self.store.blake2b_shard,
                "rdts_shard": self.store.rdts_shard,
                "chainstate_legacy": self.store.chainstate_legacy,
                "chainstate_blake2b": self.store.chainstate_blake2b,
                "electrum": self.store.electrum,
            },
            "indexed_blocks": len(index),
        }

    def getflavors(self, _params: JsonDict) -> Any:
        leg = self.legacy.health()
        b2b = self.blake2b.health()
        return {
            "network": self.config.network,
            "flavors": {
                "legacy": {
                    "engine": "bitcoin-core",
                    "status": leg["status"],
                    "blocks": leg["blocks"],
                    "headers": leg["headers"],
                    "error": leg["error"],
                },
                "blake2b": {
                    "engine": "bitcoin-knots-blake2b",
                    "status": b2b["status"],
                    "blocks": b2b["blocks"],
                    "headers": b2b["headers"],
                    "error": b2b["error"],
                },
            },
        }

    def getblockchaininfo(self, params: JsonDict) -> Any:
        flavor = parse_flavor(params.get("flavor"))
        try:
            info = self._engine(flavor).getblockchaininfo()
        except EngineError as exc:
            raise RpcError(-32010, exc.message)
        if "header_version" not in info:
            info = dict(info)
            info["header_version_note"] = (
                "engine did not report header_version; "
                "use Knots HeaderV2 RPC (#363) when available"
            )
        info["flavor"] = flavor
        return info

    def listcoins(self, _params: JsonDict) -> Any:
        return [c.to_dict() for c in self.catalog.list_coins()]

    def sendrawtransaction(self, params: JsonDict) -> Any:
        flavor = parse_flavor(params.get("flavor"))
        hexstring = params.get("hex")
        if not isinstance(hexstring, str) or not hexstring:
            raise RpcError(-32602, "hex is required")
        allow_dual = bool(params.get("allow_dual_effect", False))
        outpoints = params.get("inputs") or []
        if not isinstance(outpoints, list):
            raise RpcError(-32602, "inputs must be a list of {txid,vout}")
        try:
            coins = self.catalog.resolve_inputs(outpoints)
        except KeyError as exc:
            raise RpcError(-32020, str(exc))
        decision = evaluate_send(
            flavor,
            coins,
            allow_dual_effect=allow_dual,
            raw_tx_hex=hexstring,
        )
        if decision is SendDecision.REPLAY_RISK_UNRESOLVED:
            raise RpcError(
                -32021,
                "replay_risk_unresolved: spend still valid on other tip "
                "(use unique inputs, Core OP_RETURN wedge >83 when flavor=legacy, "
                "ceremony, or allow_dual_effect; Knots #357 wedge not wired yet)",
            )
        try:
            txid = self._engine(flavor).sendrawtransaction(hexstring)
        except EngineError as exc:
            raise RpcError(-32011, exc.message)
        return build_receipt(flavor, txid, allow_dual_effect=allow_dual).to_dict()

    def dispatch(self, method: str, params: JsonDict) -> Any:
        if method not in self._methods:
            raise RpcError(-32601, "method not found: {0}".format(method))
        return self._methods[method](params)


def _normalize_params(params: Any) -> JsonDict:
    if params is None:
        return {}
    if isinstance(params, dict):
        return params
    if isinstance(params, list):
        if not params:
            return {}
        if len(params) == 1 and isinstance(params[0], dict):
            return params[0]
        raise RpcError(-32602, "params must be an object")
    raise RpcError(-32602, "params must be an object")


def make_handler(service: NeopdService) -> type:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            if urlparse(self.path).path not in ("/", "/rpc"):
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            try:
                req = json.loads(body.decode("utf-8") or "{}")
            except ValueError:
                self._write_rpc(
                    None,
                    error={"code": -32700, "message": "parse error"},
                )
                return
            req_id = req.get("id")
            method = req.get("method")
            if not isinstance(method, str):
                self._write_rpc(
                    req_id,
                    error={"code": -32600, "message": "invalid request"},
                )
                return
            try:
                params = _normalize_params(req.get("params"))
                result = service.dispatch(method, params)
                self._write_rpc(req_id, result=result)
            except RpcError as exc:
                self._write_rpc(
                    req_id,
                    error={"code": exc.code, "message": exc.message},
                )
            except Exception as exc:  # noqa: BLE001
                self._write_rpc(
                    req_id,
                    error={"code": -32000, "message": str(exc)},
                )

        def _write_rpc(
            self,
            req_id: Any,
            result: Any = None,
            error: Optional[JsonDict] = None,
        ) -> None:
            payload = {"jsonrpc": "2.0", "id": req_id}  # type: JsonDict
            if error is not None:
                payload["error"] = error
            else:
                payload["result"] = result
            data = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


def serve(config: Config, service: Optional[NeopdService] = None) -> None:
    store = StoreLayout(config.datadir, config.network)
    store.ensure()
    svc = service or NeopdService(config, store)
    server = HTTPServer((config.bind, config.port), make_handler(svc))
    print(
        "neopd listening on http://{0}:{1} network={2} datadir={3}".format(
            config.bind, config.port, config.network, store.base
        )
    )
    server.serve_forever()
