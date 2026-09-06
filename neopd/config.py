"""Configuration for neopd."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


NETWORKS = ("testnet4", "regtest", "main")
FLAVORS = ("legacy", "blake2b")
ARCHIVE_FLAVORS = ("rdts_sha256",)


@dataclass(frozen=True)
class Config:
    """Runtime configuration (env + CLI)."""

    network: str = "testnet4"
    datadir: str = "./data"
    bind: str = "127.0.0.1"
    port: int = 18334
    legacy_rpc_url: str = "http://127.0.0.1:18332"
    legacy_rpc_user: str = "neop_legacy"
    legacy_rpc_password: str = ""
    blake2b_rpc_url: str = "http://127.0.0.1:18333"
    blake2b_rpc_user: str = "neop_blake2b"
    blake2b_rpc_password: str = ""

    def __post_init__(self) -> None:
        if self.network not in NETWORKS:
            raise ValueError(
                "network must be one of {0}, got {1!r}".format(
                    NETWORKS, self.network
                )
            )

    @classmethod
    def from_env(cls, **overrides: object) -> "Config":
        def env(key: str, default: str) -> str:
            return os.environ.get(key, default)

        values = {
            "network": env("NEOP_NETWORK", "testnet4"),
            "datadir": env("NEOP_DATADIR", "./data"),
            "bind": env("NEOP_BIND", "127.0.0.1"),
            "port": int(env("NEOP_PORT", "18334")),
            "legacy_rpc_url": env("LEGACY_RPC_URL", "http://127.0.0.1:18332"),
            "legacy_rpc_user": env("LEGACY_RPC_USER", "neop_legacy"),
            "legacy_rpc_password": env("LEGACY_RPC_PASSWORD", ""),
            "blake2b_rpc_url": env("BLAKE2B_RPC_URL", "http://127.0.0.1:18333"),
            "blake2b_rpc_user": env("BLAKE2B_RPC_USER", "neop_blake2b"),
            "blake2b_rpc_password": env("BLAKE2B_RPC_PASSWORD", ""),
        }
        values.update({k: v for k, v in overrides.items() if v is not None})
        return cls(**values)  # type: ignore[arg-type]


def parse_flavor(value: Optional[str]) -> str:
    if value not in FLAVORS:
        raise ValueError(
            "flavor must be one of {0}, got {1!r}".format(FLAVORS, value)
        )
    return value
