"""Detect embedded replay wedges in raw transaction hex (stdlib only)."""

from __future__ import annotations

from typing import List, Tuple

# Knots datacarriersize counts full scriptPubKey length; Core-bound wedge is > 83.
MIN_CORE_WEDGE_SCRIPT_PUBKEY_LEN = 84


def _read_compact_size(buf: bytes, i: int) -> Tuple[int, int]:
    if i >= len(buf):
        raise ValueError("truncated tx (compact size)")
    first = buf[i]
    i += 1
    if first < 0xFD:
        return first, i
    if first == 0xFD:
        if i + 2 > len(buf):
            raise ValueError("truncated tx (compact size fd)")
        return int.from_bytes(buf[i : i + 2], "little"), i + 2
    if first == 0xFE:
        if i + 4 > len(buf):
            raise ValueError("truncated tx (compact size fe)")
        return int.from_bytes(buf[i : i + 4], "little"), i + 4
    if i + 8 > len(buf):
        raise ValueError("truncated tx (compact size ff)")
    return int.from_bytes(buf[i : i + 8], "little"), i + 8


def iter_tx_output_scripts(raw: bytes) -> List[bytes]:
    """Return each output scriptPubKey from a non-segwit or segwit tx serialization."""
    if len(raw) < 10:
        raise ValueError("tx too short")
    i = 4  # version
    # Optional segwit marker/flag
    if i + 2 <= len(raw) and raw[i] == 0x00 and raw[i + 1] == 0x01:
        i += 2
        segwit = True
    else:
        segwit = False

    vin_count, i = _read_compact_size(raw, i)
    for _ in range(vin_count):
        if i + 36 > len(raw):
            raise ValueError("truncated tx (vin prevout)")
        i += 36
        script_len, i = _read_compact_size(raw, i)
        i += script_len
        if i + 4 > len(raw):
            raise ValueError("truncated tx (vin sequence)")
        i += 4

    vout_count, i = _read_compact_size(raw, i)
    scripts: List[bytes] = []
    for _ in range(vout_count):
        if i + 8 > len(raw):
            raise ValueError("truncated tx (vout value)")
        i += 8
        script_len, i = _read_compact_size(raw, i)
        if i + script_len > len(raw):
            raise ValueError("truncated tx (vout script)")
        scripts.append(raw[i : i + script_len])
        i += script_len

    if segwit:
        # Skip witness stacks; not needed for scriptPubKey wedge detection.
        for _ in range(vin_count):
            n_items, i = _read_compact_size(raw, i)
            for _item in range(n_items):
                item_len, i = _read_compact_size(raw, i)
                i += item_len

    return scripts


def has_core_bound_op_return_wedge(
    tx_hex: str,
    *,
    min_script_pubkey_len: int = MIN_CORE_WEDGE_SCRIPT_PUBKEY_LEN,
) -> bool:
    """True if any output is OP_RETURN with scriptPubKey length > 83 (default)."""
    hx = tx_hex.strip().lower()
    if hx.startswith("0x"):
        hx = hx[2:]
    try:
        raw = bytes.fromhex(hx)
    except ValueError as exc:
        raise ValueError("tx hex is not valid") from exc
    for script in iter_tx_output_scripts(raw):
        if not script:
            continue
        if script[0] == 0x6A and len(script) >= min_script_pubkey_len:
            return True
    return False
