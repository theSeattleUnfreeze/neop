"""Core-bound OP_RETURN wedge helpers (no RPC)."""

from __future__ import annotations

from typing import List, Mapping, MutableMapping, Optional, Sequence, Union

# Knots datacarriersize default counts full scriptPubKey length.
MIN_WEDGE_SCRIPT_PUBKEY_LEN = 84
# Typical non-witness vout overhead for OP_RETURN: 8 (value) + 1 (script len) + script.
OP_RETURN_VOUT_OVERHEAD = 9


def op_return_script_pubkey(data: bytes) -> bytes:
    """Serialize OP_RETURN <data> as a scriptPubKey."""
    if len(data) <= 75:
        return bytes([0x6A, len(data)]) + data
    if len(data) <= 255:
        return bytes([0x6A, 0x4C, len(data)]) + data
    if len(data) <= 65535:
        return bytes([0x6A, 0x4D, len(data) & 0xFF, (len(data) >> 8) & 0xFF]) + data
    raise ValueError("OP_RETURN data too large")


def script_pubkey_len(data: bytes) -> int:
    return len(op_return_script_pubkey(data))


def pad_payload_to_wedge(
    payload: bytes,
    *,
    min_script_pubkey_len: int = MIN_WEDGE_SCRIPT_PUBKEY_LEN,
) -> bytes:
    """Pad payload with 0x00 so scriptPubKey length is at least min_script_pubkey_len."""
    out = bytearray(payload)
    while script_pubkey_len(bytes(out)) < min_script_pubkey_len:
        out.append(0x00)
    return bytes(out)


def resolve_op_return_payload(
    *,
    memo: Optional[str] = None,
    data_hex: Optional[str] = None,
    min_script_pubkey_len: int = MIN_WEDGE_SCRIPT_PUBKEY_LEN,
    pad: bool = True,
) -> bytes:
    """
    Build OP_RETURN payload bytes from memo and/or data_hex.

    If both are set, data_hex wins. If neither, use a short default marker then pad.
    """
    if data_hex is not None and data_hex != "":
        hx = data_hex.strip().lower()
        if hx.startswith("0x"):
            hx = hx[2:]
        if len(hx) % 2:
            raise ValueError("data_hex must have even length")
        try:
            payload = bytes.fromhex(hx)
        except ValueError as exc:
            raise ValueError("data_hex is not valid hex") from exc
    elif memo is not None:
        payload = memo.encode("utf-8")
    else:
        payload = b"neop-core-bound"

    if pad:
        payload = pad_payload_to_wedge(payload, min_script_pubkey_len=min_script_pubkey_len)
    elif script_pubkey_len(payload) < min_script_pubkey_len:
        raise ValueError(
            f"OP_RETURN scriptPubKey length {script_pubkey_len(payload)} "
            f"< {min_script_pubkey_len}; pass a longer memo/data_hex or leave pad enabled"
        )
    return payload


def assert_wedge(payload: bytes, *, min_script_pubkey_len: int = MIN_WEDGE_SCRIPT_PUBKEY_LEN) -> None:
    length = script_pubkey_len(payload)
    if length < min_script_pubkey_len:
        raise ValueError(
            f"wedge assert failed: scriptPubKey length {length} < {min_script_pubkey_len}"
        )


def estimate_op_return_vout_vbytes(payload: bytes) -> int:
    """Non-witness vbytes added by a 0-value OP_RETURN output."""
    script = op_return_script_pubkey(payload)
    # CompactSize for script length: 1 byte when len < 253
    script_len_bytes = 1 if len(script) < 253 else 3
    return 8 + script_len_bytes + len(script)


def estimate_fee_sats(
    *,
    base_vsize: int,
    payload: bytes,
    feerate_sat_vb: float,
) -> int:
    """Fee for base_vsize plus OP_RETURN output at feerate (ceil)."""
    total_v = base_vsize + estimate_op_return_vout_vbytes(payload)
    import math

    return int(math.ceil(total_v * feerate_sat_vb))


def btc_to_sats(btc: Union[str, float]) -> int:
    # Avoid float drift for common decimal strings
    if isinstance(btc, str):
        from decimal import Decimal, ROUND_DOWN

        return int((Decimal(btc) * Decimal(100_000_000)).to_integral_value(rounding=ROUND_DOWN))
    return int(round(btc * 100_000_000))


def sats_to_btc_str(sats: int) -> str:
    return f"{sats / 1e8:.8f}".rstrip("0").rstrip(".") if sats % 100_000_000 else f"{sats / 1e8:.8f}"


def build_createpsbt_outputs(
    *,
    payee_address: str,
    payment_btc: Union[str, float],
    payload: bytes,
) -> List[Mapping[str, Union[str, float]]]:
    """Outputs array for bitcoin-cli createpsbt (payment + data)."""
    assert_wedge(payload)
    amount: Union[str, float]
    if isinstance(payment_btc, str):
        amount = payment_btc
    else:
        amount = float(f"{payment_btc:.8f}")
    return [
        {payee_address: amount},
        {"data": payload.hex()},
    ]


def build_createpsbt_inputs(txid: str, vout: int) -> List[MutableMapping[str, Union[str, int]]]:
    txid = txid.strip().lower()
    if len(txid) != 64 or any(c not in "0123456789abcdef" for c in txid):
        raise ValueError("txid must be 64 hex characters")
    if vout < 0:
        raise ValueError("vout must be >= 0")
    return [{"txid": txid, "vout": vout}]


def payment_btc_for_whole_utxo(*, utxo_sats: int, fee_sats: int) -> str:
    if fee_sats < 0:
        raise ValueError("fee_sats must be >= 0")
    if utxo_sats <= fee_sats:
        raise ValueError("utxo_sats must exceed fee_sats")
    return f"{(utxo_sats - fee_sats) / 1e8:.8f}"
