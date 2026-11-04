import { annotate, type CoinRow, type TipView } from "@/lib/catalog/presence";
import { outpointRowsFromTips, type OutpointRow } from "@/lib/catalog/outpoints";
import type { ScriptTipSnapshot } from "@/lib/sync/fetchTip";

function historyView(snap: ScriptTipSnapshot | undefined): TipView {
  if (!snap || !snap.ok) return { status: "absent" };
  if (snap.history.length > 0) {
    const last = snap.history[snap.history.length - 1];
    return { status: "spent", spendTxid: last.tx_hash };
  }
  return { status: "absent" };
}

export type CoinRowOpts = {
  accountId?: number | null;
  watchAccountId?: number | null;
};

/**
 * One row per script for the import harness.
 * Live coins are summed. Presence follows the outpoints when they agree.
 * History on a tip does not mark a different live outpoint as replay-exposed.
 * Wallet screens use outpointRowsFromTips instead of this rollup.
 */
export function coinRowFromTips(
  scriptId: number,
  address: string | null | undefined,
  core: ScriptTipSnapshot | undefined,
  knots: ScriptTipSnapshot | undefined,
  opts: CoinRowOpts = {}
) {
  const live = outpointRowsFromTips(scriptId, address, core, knots, opts);
  if (!live.length) {
    const row: CoinRow = {
      scriptId,
      address,
      core: historyView(core),
      knots: historyView(knots),
    };
    return {
      ...annotate(row),
      accountId: opts.accountId ?? null,
      watchAccountId: opts.watchAccountId ?? null,
    };
  }
  const rollupTip = (tip: "core" | "knots"): TipView => {
    const unspent = live.filter((r) => r[tip].status === "unspent");
    if (unspent.length) {
      const sats = unspent.reduce((acc, r) => acc + (r[tip].valueSats ?? 0), 0);
      return {
        status: "unspent",
        txid: unspent[0].txid,
        vout: unspent[0].vout,
        valueSats: sats,
      };
    }
    const spent = live.find((r) => r[tip].status === "spent");
    if (spent) return spent[tip];
    return { status: "absent" };
  };
  const row: CoinRow = {
    scriptId,
    address,
    core: rollupTip("core"),
    knots: rollupTip("knots"),
  };
  return {
    ...annotate(row),
    accountId: opts.accountId ?? null,
    watchAccountId: opts.watchAccountId ?? null,
  };
}

export function detectSpills<T extends { spill: boolean }>(rows: T[]): T[] {
  return rows.filter((r) => r.spill);
}

export type { OutpointRow };
export { outpointRowsFromTips };
