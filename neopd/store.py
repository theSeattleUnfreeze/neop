"""Shared datadir layout for dual-flavor storage.

neopd owns path mux and index metadata only. PoW / consensus validation stays
in pinned Core and Knots engines — never reimplemented here.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Dict, Optional


# nVersion bit 31 marks Knots HeaderV2 (Blake2b) per #359.
HEADER_V2_VERSION_BIT = 1 << 31
HEADER_V1_SIZE = 80
HEADER_V2_SIZE = 164


class HeaderVersion(str, Enum):
    V1 = "v1"
    V2 = "v2"


class Shard(str, Enum):
    SHARED_BLOCKS = "blocks"
    BLAKE2B = "blake2b-shard"
    RDTS = "rdts-shard"


@dataclass(frozen=True)
class BlockIndexRecord:
    """Index row: hash -> location + header family (routing only)."""

    block_hash: str
    header_version: HeaderVersion
    shard: Shard
    offset: int = 0
    size: int = 0

    def to_dict(self) -> Dict[str, object]:
        d = asdict(self)
        d["header_version"] = self.header_version.value
        d["shard"] = self.shard.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "BlockIndexRecord":
        return cls(
            block_hash=str(data["block_hash"]),
            header_version=HeaderVersion(str(data["header_version"])),
            shard=Shard(str(data["shard"])),
            offset=int(data.get("offset", 0)),
            size=int(data.get("size", 0)),
        )


def classify_header(
    n_version: Optional[int] = None,
    header_len: Optional[int] = None,
) -> HeaderVersion:
    """Route-only classification. Does not verify PoW."""
    if header_len is not None:
        if header_len == HEADER_V2_SIZE:
            return HeaderVersion.V2
        if header_len == HEADER_V1_SIZE:
            return HeaderVersion.V1
        raise ValueError("unsupported header length: {0}".format(header_len))
    if n_version is None:
        raise ValueError("need n_version or header_len")
    if n_version & HEADER_V2_VERSION_BIT:
        return HeaderVersion.V2
    return HeaderVersion.V1


def shard_for_header(version: HeaderVersion) -> Shard:
    if version is HeaderVersion.V2:
        return Shard.BLAKE2B
    return Shard.SHARED_BLOCKS


class StoreLayout:
    """Network-scoped dual-flavor datadir."""

    def __init__(self, root: str, network: str) -> None:
        self.root = os.path.abspath(root)
        self.network = network
        self.base = os.path.join(self.root, network)

    @property
    def blocks(self) -> str:
        return os.path.join(self.base, Shard.SHARED_BLOCKS.value)

    @property
    def blake2b_shard(self) -> str:
        return os.path.join(self.base, Shard.BLAKE2B.value)

    @property
    def rdts_shard(self) -> str:
        return os.path.join(self.base, Shard.RDTS.value)

    @property
    def chainstate_legacy(self) -> str:
        return os.path.join(self.base, "chainstate-legacy")

    @property
    def chainstate_blake2b(self) -> str:
        return os.path.join(self.base, "chainstate-blake2b")

    @property
    def electrum(self) -> str:
        return os.path.join(self.base, "electrum")

    @property
    def index_path(self) -> str:
        return os.path.join(self.base, "block-index.json")

    def ensure(self) -> None:
        for path in (
            self.blocks,
            self.blake2b_shard,
            self.rdts_shard,
            self.chainstate_legacy,
            self.chainstate_blake2b,
            self.electrum,
            os.path.join(self.electrum, "delta-legacy"),
            os.path.join(self.electrum, "delta-blake2b"),
        ):
            os.makedirs(path, exist_ok=True)
        if not os.path.exists(self.index_path):
            self._write_index({})

    def path_for_shard(self, shard: Shard) -> str:
        return {
            Shard.SHARED_BLOCKS: self.blocks,
            Shard.BLAKE2B: self.blake2b_shard,
            Shard.RDTS: self.rdts_shard,
        }[shard]

    def load_index(self) -> Dict[str, BlockIndexRecord]:
        self.ensure()
        with open(self.index_path, "r") as fh:
            raw = json.load(fh)
        return {k: BlockIndexRecord.from_dict(v) for k, v in raw.items()}

    def put_index_record(self, record: BlockIndexRecord) -> None:
        index = self.load_index()
        index[record.block_hash] = record
        self._write_index({k: r.to_dict() for k, r in index.items()})

    def _write_index(self, data: Dict[str, object]) -> None:
        os.makedirs(self.base, exist_ok=True)
        tmp = self.index_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, self.index_path)
