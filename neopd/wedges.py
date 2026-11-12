"""Detect embedded replay wedges in raw transaction hex (stdlib only)."""

from __future__ import annotations

from typing import List, Tuple

# Knots datacarriersize counts full scriptPubKey length; Core-bound wedge is > 83.
MIN_CORE_WEDGE_SCRIPT_PUBKEY_LEN = 84
# SIGHASH_ALL | SIGHASH_UNIFIED. Knots #357. Parsing the byte is not sighash crypto.
SIGHASH_ALL_UNIFIED = 0x21


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


def _walk_tx(raw: bytes) -> Tuple[List[bytes], List[bytes]]:
    """Output scripts and witness items. Witness items are empty when the tx is not segwit."""
    if len(raw) < 10:
        raise ValueError("tx too short")
    i = 4  # version
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

    witness: List[bytes] = []
    if segwit:
        for _ in range(vin_count):
            n_items, i = _read_compact_size(raw, i)
            for _item in range(n_items):
                item_len, i = _read_compact_size(raw, i)
                if i + item_len > len(raw):
                    raise ValueError("truncated tx (witness)")
                witness.append(raw[i : i + item_len])
                i += item_len
    return scripts, witness


def iter_tx_output_scripts(raw: bytes) -> List[bytes]:
    """Return each output scriptPubKey from a non-segwit or segwit tx serialization."""
    scripts, _witness = _walk_tx(raw)
    return scripts


def iter_witness_items(raw: bytes) -> List[bytes]:
    """Return witness stack items. Empty for a transaction that is not segwit."""
    _scripts, witness = _walk_tx(raw)
    return witness


def _tx_bytes(tx_hex: str) -> bytes:
    hx = tx_hex.strip().lower()
    if hx.startswith("0x"):
        hx = hx[2:]
    try:
        return bytes.fromhex(hx)
    except ValueError as exc:
        raise ValueError("tx hex is not valid") from exc


def has_core_bound_op_return_wedge(
    tx_hex: str,
    *,
    min_script_pubkey_len: int = MIN_CORE_WEDGE_SCRIPT_PUBKEY_LEN,
) -> bool:
    """True if any output is OP_RETURN with scriptPubKey length > 83 (default)."""
    for script in iter_tx_output_scripts(_tx_bytes(tx_hex)):
        if not script:
            continue
        if script[0] == 0x6A and len(script) >= min_script_pubkey_len:
            return True
    return False


def has_knots_bound_unified_sighash(tx_hex: str) -> bool:
    """True when a witness item is a 65-byte signature ending in 0x21.

    That byte is SIGHASH_ALL|UNIFIED from Knots #357. This only reads the
    sighash byte. It does not check the signature or reimplement consensus.
    """
    for item in iter_witness_items(_tx_bytes(tx_hex)):
        if len(item) == 65 and item[-1] == SIGHASH_ALL_UNIFIED:
            return True
    return False
