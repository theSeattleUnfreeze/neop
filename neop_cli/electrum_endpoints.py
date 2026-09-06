"""Electrum endpoint + wallet pairing hints."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

SHRIKE_RELEASES = "https://github.com/privkeyio/shrike/releases"
SPARROW_HOME = "https://sparrowwallet.com"
FULCRUM_REPO = "https://github.com/cculianu/Fulcrum"
SHULCRUM_REPO = "https://github.com/Kilombino/Shulcrum"


@dataclass(frozen=True)
class ElectrumPorts:
    core: int
    knots: int


PORTS_BY_NETWORK = {
    "testnet4": ElectrumPorts(15001, 15011),
    "regtest": ElectrumPorts(25001, 25011),
    "main": ElectrumPorts(50001, 50011),
}


def ports_for_network(network: str) -> ElectrumPorts:
    key = network.strip().lower()
    if key not in PORTS_BY_NETWORK:
        raise ValueError(f"unknown network {network!r}; expected one of {sorted(PORTS_BY_NETWORK)}")
    return PORTS_BY_NETWORK[key]


def resolve_host(
    *,
    host: Optional[str] = None,
    env: Optional[dict] = None,
) -> str:
    env = env if env is not None else os.environ
    return (host or env.get("NEOP_ELECTRUM_HOST") or env.get("ELECTRUM_HOST") or "127.0.0.1").strip()


def format_endpoints(
    *,
    network: str = "testnet4",
    host: Optional[str] = None,
    env: Optional[dict] = None,
    tls: bool = False,
) -> str:
    """Human-readable pairing for operators (no wallet config mutation)."""
    h = resolve_host(host=host, env=env)
    ports = ports_for_network(network)
    scheme = "ssl" if tls else "tcp"
    lines = [
        f"network: {network}",
        f"host: {h}",
        "",
        "Core chain (SHA-256d)",
        f"  server: Fulcrum ({FULCRUM_REPO}) — not electrs",
        f"  endpoint: {scheme}://{h}:{ports.core}",
        f"  wallet: Sparrow ({SPARROW_HOME})",
        "",
        "Knots chain (Blake2b)",
        f"  server: Shulcrum ({SHULCRUM_REPO})",
        f"  endpoint: {scheme}://{h}:{ports.knots}",
        f"  wallet: Shrike ({SHRIKE_RELEASES})",
        "",
        "Toggle = open Sparrow vs Shrike. Do not point stock Sparrow at Shulcrum.",
        "neop orchestrates these servers; it does not own the Electrum ports.",
    ]
    return "\n".join(lines) + "\n"
