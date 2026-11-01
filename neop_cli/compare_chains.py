"""Compare two Bitcoin tips by block hash, plus a tip UTXO hash when heights match.

Historical muhash is not available from a tip RPC. Isolation checks compare
snapshots of one engine (blocks + txindex) so a shared-archive ceremony can
prove it did not rewrite the other flavor.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence

# Last common mainnet block is 961631. Sample every block from just before it.
DEFAULT_DENSE_FROM = 961_600
DEFAULT_STRIDE = 10_000


def sample_heights(tip: int, *, stride: int = DEFAULT_STRIDE, dense_from: int = DEFAULT_DENSE_FROM) -> List[int]:
    if tip < 0:
        raise ValueError("tip must be >= 0")
    if stride < 1:
        raise ValueError("stride must be >= 1")
    heights = list(range(0, tip + 1, stride))
    dense_start = min(dense_from, tip)
    heights.extend(range(dense_start, tip + 1))
    if tip not in heights:
        heights.append(tip)
    return sorted(set(heights))


@dataclass
class HashMismatch:
    height: int
    left: str
    right: str


@dataclass
class CompareReport:
    left_tip: int
    right_tip: int
    compared: int
    mismatches: List[HashMismatch] = field(default_factory=list)
    left_muhash: Optional[str] = None
    right_muhash: Optional[str] = None
    muhash_match: Optional[bool] = None

    @property
    def ok(self) -> bool:
        tips = self.left_tip == self.right_tip
        hashes = not self.mismatches
        utxo = self.muhash_match is not False
        return tips and hashes and utxo


def compare_block_hashes(
    heights: Sequence[int],
    left_hash: Callable[[int], str],
    right_hash: Callable[[int], str],
) -> List[HashMismatch]:
    bad: List[HashMismatch] = []
    for height in heights:
        left = left_hash(height)
        right = right_hash(height)
        if left != right:
            bad.append(HashMismatch(height=height, left=left, right=right))
    return bad


def utxo_hash(info: Dict[str, Any]) -> Optional[str]:
    for key in ("muhash", "hash_serialized_2", "hash_serialized"):
        value = info.get(key)
        if value:
            return str(value)
    return None


def core_isolation_snapshot(chain: Dict[str, Any], index: Dict[str, Any]) -> Dict[str, Any]:
    txindex = index.get("txindex") or {}
    return {
        "blocks": chain.get("blocks"),
        "headers": chain.get("headers"),
        "bestblockhash": chain.get("bestblockhash"),
        "txindex_synced": txindex.get("synced"),
        "txindex_height": txindex.get("best_block_height"),
    }


def isolation_unchanged(before: Dict[str, Any], after: Dict[str, Any]) -> bool:
    return before == after
