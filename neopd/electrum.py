"""Electrum port configuration — dialect lives in Fulcrum / Shulcrum."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ElectrumPorts:
    legacy: int
    blake2b: int


# testnet4 defaults — never collide with mainnet Electrum defaults.
TESTNET4_PORTS = ElectrumPorts(legacy=15001, blake2b=15011)
REGTEST_PORTS = ElectrumPorts(legacy=25001, blake2b=25011)
MAIN_PORTS = ElectrumPorts(legacy=50001, blake2b=50011)


def ports_for_network(network: str) -> ElectrumPorts:
    if network == "testnet4":
        return TESTNET4_PORTS
    if network == "regtest":
        return REGTEST_PORTS
    if network == "main":
        return MAIN_PORTS
    raise ValueError("unknown network: {0!r}".format(network))
