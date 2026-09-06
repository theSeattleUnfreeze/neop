import type { ScoopDb } from "@/lib/db/client";
import { annotate, type CoinRow, type TipView } from "@/lib/catalog/presence";
import type { AnnotatedRow } from "@/lib/catalog/balances";
import { scriptTipState, watchedScripts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

type StoredTip = {
  scriptId: number;
  tip: "core" | "knots";
  outpointTxid: string;
  outpointVout: number;
  status: "unspent" | "spent" | "absent";
  valueSats: bigint | null;
};

function tipViewFromStored(rows: StoredTip[], tip: "core" | "knots"): TipView {
  const unspent = rows.filter((r) => r.tip === tip && r.status === "unspent");
  if (!unspent.length) return { status: "absent" };
  const valueSats = unspent.reduce((acc, u) => acc + (u.valueSats ?? 0n), 0n);
  return {
    status: "unspent",
    txid: unspent[0].outpointTxid,
    vout: unspent[0].outpointVout,
    valueSats: Number(valueSats),
  };
}

export function coinRowFromStoredTipState(
  scriptId: number,
  address: string | null | undefined,
  states: StoredTip[],
  watchAccountId: number
): AnnotatedRow {
  const row: CoinRow = {
    scriptId,
    address,
    core: tipViewFromStored(states, "core"),
    knots: tipViewFromStored(states, "knots"),
  };
  return {
    ...annotate(row),
    accountId: watchAccountId,
    watchAccountId,
  };
}

/** Build annotated catalog rows from persisted script_tip_state (post-sync dashboard). */
export async function loadOrganizerRowsFromTipState(
  db: ScoopDb,
  watchAccountIds: number[]
): Promise<AnnotatedRow[]> {
  const ids = [...new Set(watchAccountIds.filter((id) => id > 0))];
  if (!ids.length) return [];

  const scripts = await db
    .select()
    .from(watchedScripts)
    .where(inArray(watchedScripts.accountId, ids));
  if (!scripts.length) return [];

  const scriptIds = scripts.map((s) => s.id);
  const tipRows = await db
    .select()
    .from(scriptTipState)
    .where(inArray(scriptTipState.scriptId, scriptIds));

  const byScript = new Map<number, StoredTip[]>();
  for (const r of tipRows) {
    const list = byScript.get(r.scriptId) ?? [];
    list.push({
      scriptId: r.scriptId,
      tip: r.tip,
      outpointTxid: r.outpointTxid,
      outpointVout: r.outpointVout,
      status: r.status,
      valueSats: r.valueSats,
    });
    byScript.set(r.scriptId, list);
  }

  return scripts.map((s) =>
    coinRowFromStoredTipState(s.id, s.address, byScript.get(s.id) ?? [], s.accountId)
  );
}
