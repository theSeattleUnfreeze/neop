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
  valueSats?: bigint;
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
 * Spill: same prior outpoint (or script) spent on both tips.
 * Prefer matching spend of the same prev outpoint when known.
 */
export function isSpill(core: TipView, knots: TipView): boolean {
  if (core.status !== "spent" || knots.status !== "spent") return false;
  if (
    core.txid !== undefined &&
    knots.txid !== undefined &&
    core.vout !== undefined &&
    knots.vout !== undefined &&
    core.txid === knots.txid &&
    core.vout === knots.vout
  ) {
    return true;
  }
  // Both tips show spent for this script lineage without shared unspent residue
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
