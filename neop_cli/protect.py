"""Protect-psbt flow: build Core-bound PSBT via createpsbt; optional Knots reject check."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, List, Mapping, Optional, Sequence, Union

from neop_cli.core_bound import (
    MIN_WEDGE_SCRIPT_PUBKEY_LEN,
    assert_wedge,
    build_createpsbt_inputs,
    build_createpsbt_outputs,
    estimate_fee_sats,
    estimate_op_return_vout_vbytes,
    payment_btc_for_whole_utxo,
    resolve_op_return_payload,
    script_pubkey_len,
)


RpcCall = Callable[[str, Optional[Sequence[Any]]], Any]


@dataclass
class ProtectPsbtResult:
    psbt: str
    payload_hex: str
    script_pubkey_len: int
    op_return_vout_vbytes: int
    fee_sats: Optional[int]
    estimated_total_vsize: Optional[int]
    core_mempool: Optional[Mapping[str, Any]]
    knots_mempool: Optional[Mapping[str, Any]]
    notes: List[str]


def protect_psbt(
    *,
    core_rpc: RpcCall,
    txid: str,
    vout: int,
    payee_address: str,
    payment_btc: Optional[Union[str, float]] = None,
    utxo_sats: Optional[int] = None,
    fee_sats: Optional[int] = None,
    base_vsize: int = 82,
    feerate_sat_vb: float = 2.45,
    memo: Optional[str] = None,
    data_hex: Optional[str] = None,
    knots_rpc: Optional[RpcCall] = None,
    skip_mempool_check: bool = False,
) -> ProtectPsbtResult:
    """
    Create an unsigned Core-bound PSBT (payment + OP_RETURN wedge).

    Does not sign or broadcast. If knots_rpc is set, unsigned raw extraction is not
    available from createpsbt alone — mempool checks run only when a signed hex is
    later provided via check_signed_hex (see helpers below). Here we still build the
    PSBT and record wedge sizes; optional testmempoolaccept requires signed hex.
    """
    notes: List[str] = []
    payload = resolve_op_return_payload(memo=memo, data_hex=data_hex)
    assert_wedge(payload)
    spk_len = script_pubkey_len(payload)
    opreturn_vb = estimate_op_return_vout_vbytes(payload)

    if payment_btc is None:
        if utxo_sats is None:
            raise ValueError("provide payment_btc or utxo_sats")
        fee = fee_sats
        if fee is None:
            fee = estimate_fee_sats(
                base_vsize=base_vsize, payload=payload, feerate_sat_vb=feerate_sat_vb
            )
            notes.append(
                f"fee_sats derived from base_vsize={base_vsize} + OP_RETURN "
                f"~{opreturn_vb} vB @ {feerate_sat_vb} sat/vB → {fee}"
            )
        payment_btc = payment_btc_for_whole_utxo(utxo_sats=utxo_sats, fee_sats=fee)
        fee_sats = fee
    elif fee_sats is None and utxo_sats is not None:
        # Infer fee from whole-UTXO spend
        from neop_cli.core_bound import btc_to_sats

        fee_sats = utxo_sats - btc_to_sats(payment_btc)

    estimated_total = base_vsize + opreturn_vb
    inputs = build_createpsbt_inputs(txid, vout)
    outputs = build_createpsbt_outputs(
        payee_address=payee_address, payment_btc=payment_btc, payload=payload
    )
    psbt = core_rpc("createpsbt", [inputs, outputs])
    if not isinstance(psbt, str) or not psbt:
        raise RuntimeError("createpsbt did not return a PSBT string")

    notes.append(
        f"OP_RETURN scriptPubKey length={spk_len} (wedge requires >={MIN_WEDGE_SCRIPT_PUBKEY_LEN})"
    )
    notes.append("Open PSBT in Sparrow (Fulcrum / Core path), sign, then broadcast Core-only.")
    notes.append("Do not broadcast via Knots / Shrike for this Core-bound ceremony tx.")
    if knots_rpc is not None and not skip_mempool_check:
        notes.append(
            "Knots reject oracle: after signing, run check_signed_hex(...) "
            "or bitcoin-cli testmempoolaccept on both engines."
        )

    return ProtectPsbtResult(
        psbt=psbt,
        payload_hex=payload.hex(),
        script_pubkey_len=spk_len,
        op_return_vout_vbytes=opreturn_vb,
        fee_sats=fee_sats,
        estimated_total_vsize=estimated_total,
        core_mempool=None,
        knots_mempool=None,
        notes=notes,
    )


def check_signed_hex(
    *,
    raw_hex: str,
    core_rpc: RpcCall,
    knots_rpc: Optional[RpcCall] = None,
) -> Mapping[str, Any]:
    """
    Run testmempoolaccept on Core and optionally Knots.

    Expect Core allowed=true (may fail if Core datacarriersize still 83 — raise note).
    Expect Knots allowed=false with scriptpubkey / datacarrier style reject.
    """
    core = core_rpc("testmempoolaccept", [[raw_hex]])
    knots = knots_rpc("testmempoolaccept", [[raw_hex]]) if knots_rpc else None
    out: dict = {"core": core, "knots": knots}

    core0 = _first_accept(core)
    if core0 is not None and core0.get("allowed") is False:
        out["core_warning"] = (
            "Core rejected the tx — raise -datacarriersize on the Core engine "
            "(or use Core v30+) before broadcasting the OP_RETURN wedge."
        )
    if knots is not None:
        knots0 = _first_accept(knots)
        if knots0 is not None and knots0.get("allowed") is True:
            raise RuntimeError(
                "Knots allowed the ceremony tx — OP_RETURN wedge did not reject; "
                "check scriptPubKey length and Knots datacarriersize"
            )
        if knots0 is not None and knots0.get("allowed") is False:
            out["knots_reject_ok"] = True
            out["knots_reject_reason"] = knots0.get("reject-reason") or knots0.get("reject-details")
    return out


def _first_accept(result: Any) -> Optional[Mapping[str, Any]]:
    if isinstance(result, list) and result and isinstance(result[0], dict):
        return result[0]
    return None
