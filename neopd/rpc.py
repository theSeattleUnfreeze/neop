"""Minimal stdlib JSON-RPC HTTP server for neopd (shared-store slice)."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from neopd.config import Config
from neopd.store import StoreLayout

JsonDict = Dict[str, Any]


class RpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super(RpcError, self).__init__(message)
        self.code = code
        self.message = message


class NeopdService:
    """RPC method implementations for the shared-store slice."""

    def __init__(self, config: Config, store: StoreLayout) -> None:
        self.config = config
        self.store = store
        self._methods = {
            "getnetwork": self.getnetwork,
            "getstoreinfo": self.getstoreinfo,
            "help": self.help,
        }

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
