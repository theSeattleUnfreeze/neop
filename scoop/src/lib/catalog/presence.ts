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
  /** Confirming block height (0 / omitted = mempool or unknown). */
  confirmedHeight?: number;
  /** ISO time of that block header when Scoop resolved it. */
  confirmedAt?: string;
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

/** Unspent on that tip. A spent coin is history on that chain, not part of its filter. */
export function filterByFlavor(row: CoinRow, flavor: Tip): boolean {
  const tip = flavor === "core" ? row.core : row.knots;
  return tip.status === "unspent";
}

export type CatalogFilter = "all" | "core" | "knots" | "spills" | "replay";

export function sameUnspentOutpoint(core: TipView, knots: TipView): boolean {
  return (
    core.status === "unspent" &&
    knots.status === "unspent" &&
    core.txid !== undefined &&
    knots.txid !== undefined &&
    core.vout !== undefined &&
    knots.vout !== undefined &&
    core.txid.toLowerCase() === knots.txid.toLowerCase() &&
    core.vout === knots.vout
  );
}

export function filterCatalogRows<
  T extends CoinRow & { spill: boolean; replayRisk?: boolean },
>(rows: T[], mode: CatalogFilter): T[] {
  if (mode === "all") return rows;
  return catalogViews(rows)[mode];
}

/**
 * One pass over the catalog. The wallet page keeps this from the latest watch
 * poll and only swaps which slice is on screen when the filter changes.
 */
export function catalogViews<
  T extends CoinRow & { spill: boolean; replayRisk?: boolean },
>(rows: T[]): Record<CatalogFilter, T[]> {
  const core: T[] = [];
  const knots: T[] = [];
  const spills: T[] = [];
  const replay: T[] = [];
  for (const row of rows) {
    if (row.core.status === "unspent") core.push(row);
    if (row.knots.status === "unspent") knots.push(row);
    if (row.spill) spills.push(row);
    if (row.replayRisk === true || sameUnspentOutpoint(row.core, row.knots)) replay.push(row);
  }
  return { all: rows, core, knots, spills, replay };
}

export function annotate(row: CoinRow) {
  return {
    ...row,
    presence: presenceOf(row.core, row.knots),
    coreBoundOk: isCoreBoundSuccess(row.core, row.knots),
    spill: isSpill(row.core, row.knots),
  };
}
