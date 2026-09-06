"""JSON-RPC client for pinned Core / Knots validation engines."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

JsonDict = Dict[str, Any]


class EngineError(Exception):
    def __init__(self, message: str, code: Optional[int] = None) -> None:
        super(EngineError, self).__init__(message)
        self.code = code
        self.message = message


class EngineClient:
    """Thin HTTP JSON-RPC wrapper. Does not implement consensus or PoW."""

    def __init__(
        self,
        url: str,
        user: str = "",
        password: str = "",
        flavor: str = "",
        timeout: float = 30.0,
    ) -> None:
        self.url = url.rstrip("/")
        self.user = user
        self.password = password
        self.flavor = flavor
        self.timeout = timeout
        self._id = 0

    def call(self, method: str, params=None) -> Any:
        self._id += 1
        payload = {
            "jsonrpc": "1.0",
            "id": self._id,
            "method": method,
            "params": params if params is not None else [],
        }
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        req = Request(self.url, data=data, headers=headers, method="POST")
        if self.user or self.password:
            import base64

            token = base64.b64encode(
                "{0}:{1}".format(self.user, self.password).encode("utf-8")
            ).decode("ascii")
            req.add_header("Authorization", "Basic {0}".format(token))
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except HTTPError as exc:
            raise EngineError(
                "engine HTTP {0}: {1}".format(exc.code, exc.reason)
            )
        except URLError as exc:
            raise EngineError("engine unreachable: {0}".format(exc.reason))
        except ValueError as exc:
            raise EngineError("engine returned invalid JSON: {0}".format(exc))
        if body.get("error"):
            err = body["error"]
            raise EngineError(
                str(err.get("message", err)),
                code=err.get("code"),
            )
        return body.get("result")

    def getblockchaininfo(self) -> JsonDict:
        return self.call("getblockchaininfo")

    def getblockheader(self, blockhash: str, verbose: bool = True) -> Any:
        return self.call("getblockheader", [blockhash, verbose])

    def sendrawtransaction(self, hexstring: str) -> str:
        return self.call("sendrawtransaction", [hexstring])

    def getrawmempool(self) -> Any:
        return self.call("getrawmempool")

    def health(self) -> JsonDict:
        try:
            info = self.getblockchaininfo()
            return {
                "status": "ok",
                "blocks": info.get("blocks"),
                "headers": info.get("headers"),
                "chain": info.get("chain"),
                "error": None,
            }
        except EngineError as exc:
            return {
                "status": "unreachable",
                "blocks": None,
                "headers": None,
                "chain": None,
                "error": exc.message,
            }
