import { annotate, type CoinRow, type TipView } from "@/lib/catalog/presence";
import { sumUnspent } from "@/lib/catalog/balances";
import type { ScriptTipSnapshot, UnspentItem } from "@/lib/sync/fetchTip";

function tipViewFromSnapshot(snap: ScriptTipSnapshot | undefined): TipView {
  if (!snap || !snap.ok) {
    return { status: "absent" };
  }
  if (snap.unspent.length > 0) {
    const u = snap.unspent[0] as UnspentItem;
    return {
      status: "unspent",
      txid: u.tx_hash,
      vout: u.tx_pos,
      // Total of all unspent outputs; number for JSON-safe API responses
      valueSats: Number(sumUnspent(snap.unspent)),
    };
  }
  if (snap.history.length > 0) {
    const last = snap.history[snap.history.length - 1];
    return {
      status: "spent",
      spendTxid: last.tx_hash,
    };
  }
  return { status: "absent" };
}

export type CoinRowOpts = {
  accountId?: number | null;
  watchAccountId?: number | null;
};

export function coinRowFromTips(
  scriptId: number,
  address: string | null | undefined,
  core: ScriptTipSnapshot | undefined,
  knots: ScriptTipSnapshot | undefined,
  opts: CoinRowOpts = {}
) {
  const row: CoinRow = {
    scriptId,
    address,
    core: tipViewFromSnapshot(core),
    knots: tipViewFromSnapshot(knots),
  };
  return {
    ...annotate(row),
    accountId: opts.accountId ?? null,
    watchAccountId: opts.watchAccountId ?? null,
  };
}

export function detectSpills(
  rows: ReturnType<typeof coinRowFromTips>[]
): ReturnType<typeof coinRowFromTips>[] {
  return rows.filter((r) => r.spill);
}
