"""Minimal JSON-RPC client for bitcoind (stdlib)."""

from __future__ import annotations

import base64
import json
import os
import ssl
import urllib.error
import urllib.request
from typing import Any, Mapping, Optional, Sequence
from urllib.parse import urlparse


class RpcError(RuntimeError):
    def __init__(self, code: Optional[int], message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class BitcoinRpc:
    def __init__(
        self,
        url: str,
        *,
        user: Optional[str] = None,
        password: Optional[str] = None,
        timeout: float = 60.0,
        insecure_tls: bool = False,
    ):
        self.url = url.rstrip("/")
        parsed = urlparse(self.url)
        self.user = user if user is not None else parsed.username
        self.password = password if password is not None else parsed.password
        self.timeout = timeout
        self.insecure_tls = insecure_tls
        self._id = 0

    @classmethod
    def from_env(
        cls,
        *,
        url_env: str = "BITCOIN_RPC_URL",
        alt_url_env: str = "BITCOIN_NODE_SERVER",
        user_env: str = "BITCOIN_RPC_USER",
        password_env: str = "BITCOIN_RPC_PASSWORD",
        env: Optional[Mapping[str, str]] = None,
    ) -> "BitcoinRpc":
        e = env if env is not None else os.environ
        url = e.get(url_env) or e.get(alt_url_env)
        if not url:
            raise ValueError(f"set {url_env} or {alt_url_env}")
        return cls(
            url,
            user=e.get(user_env),
            password=e.get(password_env),
            insecure_tls=e.get("BITCOIN_RPC_INSECURE_TLS", "").lower() in ("1", "true", "yes"),
        )

    def call(self, method: str, params: Optional[Sequence[Any]] = None) -> Any:
        self._id += 1
        body = json.dumps(
            {"jsonrpc": "1.0", "id": self._id, "method": method, "params": list(params or [])}
        ).encode("utf-8")
        req = urllib.request.Request(self.url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        if self.user is not None and self.password is not None:
            token = base64.b64encode(f"{self.user}:{self.password}".encode()).decode()
            req.add_header("Authorization", f"Basic {token}")

        ctx = None
        if self.url.lower().startswith("https"):
            ctx = ssl.create_default_context()
            host = urlparse(self.url).hostname or ""
            if self.insecure_tls or host.endswith(".local"):
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE

        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=ctx) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as decode_exc:
                raise RpcError(exc.code, raw or str(exc)) from decode_exc
        else:
            payload = json.loads(raw)

        if payload.get("error"):
            err = payload["error"]
            raise RpcError(err.get("code"), err.get("message", str(err)))
        return payload.get("result")
