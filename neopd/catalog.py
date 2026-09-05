"""Replay-safe UTXO catalog labels and default-deny send policy."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, List, Optional, Sequence

from neopd.wedges import has_core_bound_op_return_wedge


class FlavorPresence(str, Enum):
    LEGACY_ONLY = "legacy_only"
    BLAKE2B_ONLY = "blake2b_only"
    BOTH = "both"


class ReplayRisk(str, Enum):
    NONE = "none"
    EXPOSED = "exposed"


class SendDecision(str, Enum):
    ALLOW = "allow"
    REPLAY_RISK_UNRESOLVED = "replay_risk_unresolved"


@dataclass(frozen=True)
class Coin:
    txid: str
    vout: int
    flavor_presence: FlavorPresence

    @property
    def replay_risk(self) -> ReplayRisk:
        if self.flavor_presence is FlavorPresence.BOTH:
            return ReplayRisk.EXPOSED
        return ReplayRisk.NONE

    def to_dict(self) -> dict:
        return {
            "txid": self.txid,
            "vout": self.vout,
            "flavor_presence": self.flavor_presence.value,
            "replay_risk": self.replay_risk.value,
        }


@dataclass(frozen=True)
class ConfidenceReceipt:
    flavor: str
    txid: str
    other_flavor_affected: bool

    def to_dict(self) -> dict:
        return {
            "flavor": self.flavor,
            "txid": self.txid,
            "other_flavor_affected": self.other_flavor_affected,
        }


def presence_for_flavor(flavor: str) -> FlavorPresence:
    if flavor == "legacy":
        return FlavorPresence.LEGACY_ONLY
    if flavor == "blake2b":
        return FlavorPresence.BLAKE2B_ONLY
    raise ValueError("unknown flavor: {0!r}".format(flavor))


def coin_spendable_only_on(coin: Coin, flavor: str) -> bool:
    return coin.flavor_presence is presence_for_flavor(flavor)


def evaluate_send(
    flavor: str,
    inputs: Sequence[Coin],
    allow_dual_effect: bool = False,
    raw_tx_hex: Optional[str] = None,
) -> SendDecision:
    """Default-deny spends that remain valid on the other tip.

    Allow when:
    - allow_dual_effect is True (explicit dual-effect escape), or
    - at least one input is spendable only on the selected flavor (unique-input), or
    - flavor is legacy (Core) and raw_tx_hex embeds an OP_RETURN scriptPubKey > 83 bytes.

    Knots #357 sighash wedge detection is not implemented yet.
    """
    if flavor not in ("legacy", "blake2b"):
        raise ValueError("flavor must be legacy|blake2b")
    if not inputs:
        return SendDecision.REPLAY_RISK_UNRESOLVED
    if allow_dual_effect:
        return SendDecision.ALLOW
    if any(coin_spendable_only_on(c, flavor) for c in inputs):
        return SendDecision.ALLOW
    if (
        flavor == "legacy"
        and raw_tx_hex
        and has_core_bound_op_return_wedge(raw_tx_hex)
    ):
        return SendDecision.ALLOW
    if all(c.flavor_presence is FlavorPresence.BOTH for c in inputs):
        return SendDecision.REPLAY_RISK_UNRESOLVED
    return SendDecision.REPLAY_RISK_UNRESOLVED


def build_receipt(
    flavor: str,
    txid: str,
    allow_dual_effect: bool = False,
) -> ConfidenceReceipt:
    return ConfidenceReceipt(
        flavor=flavor,
        txid=txid,
        other_flavor_affected=bool(allow_dual_effect),
    )


class Catalog:
    """In-memory coin catalog until watch/scan is wired."""

    def __init__(self, coins: Optional[Iterable[Coin]] = None) -> None:
        self._coins: List[Coin] = list(coins or [])

    def list_coins(self) -> List[Coin]:
        return list(self._coins)

    def add(self, coin: Coin) -> None:
        self._coins.append(coin)

    def resolve_inputs(self, outpoints: Sequence[dict]) -> List[Coin]:
        by_key = {(c.txid, c.vout): c for c in self._coins}
        resolved = []
        for op in outpoints:
            key = (str(op["txid"]), int(op["vout"]))
            if key not in by_key:
                raise KeyError("unknown outpoint {0}:{1}".format(*key))
            resolved.append(by_key[key])
        return resolved
