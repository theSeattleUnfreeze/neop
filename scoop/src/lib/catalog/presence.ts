/**
 * Pure catalog helpers: presence labels and spill detection.
 * Tips are "core" (SHA-256d / Fulcrum) and "knots" (Blake2b / Shulcrum).
 */

export type Tip = "core" | "knots";
export type Presence = "core_only" | "knots_only" | "both" | "none";
export type UtxoStatus = "unspent" | "spent";

export type TipView = {
  status: UtxoStatus | "absent";
  txid?: string;
  vout?: number;
  /** Satoshis from Electrum listunspent (number for JSON-safe API responses). */
  valueSats?: number;
  spendTxid?: string;
};

export type CoinRow = {
  scriptId: number;
  address?: string | null;
  core: TipView;
  knots: TipView;
};

export function presenceOf(core: TipView, knots: TipView): Presence {
  const c = core.status !== "absent";
  const k = knots.status !== "absent";
  if (c && k) return "both";
  if (c) return "core_only";
  if (k) return "knots_only";
  return "none";
}

/** Core spent, Knots still unspent — expected after Core-bound OP_RETURN ceremony. */
export function isCoreBoundSuccess(core: TipView, knots: TipView): boolean {
  return core.status === "spent" && knots.status === "unspent";
}

/**
 * Spill: the same outpoint spent on both tips (dual-effect / replay exposure).
 * When outpoint metadata is complete and differs, this is not a spill.
 */
export function isSpill(core: TipView, knots: TipView): boolean {
  if (core.status !== "spent" || knots.status !== "spent") return false;
  const coreOut =
    core.txid !== undefined && core.vout !== undefined
      ? `${core.txid}:${core.vout}`
      : undefined;
  const knotsOut =
    knots.txid !== undefined && knots.vout !== undefined
      ? `${knots.txid}:${knots.vout}`
      : undefined;
  if (coreOut !== undefined && knotsOut !== undefined) {
    return coreOut === knotsOut;
  }
  // Dual-spent without comparable outpoints — conservative spill signal
  return true;
}

export function filterByFlavor(row: CoinRow, flavor: Tip): boolean {
  if (flavor === "core") return row.core.status !== "absent";
  return row.knots.status !== "absent";
}

export function annotate(row: CoinRow) {
  return {
    ...row,
    presence: presenceOf(row.core, row.knots),
    coreBoundOk: isCoreBoundSuccess(row.core, row.knots),
    spill: isSpill(row.core, row.knots),
  };
}
