import type { ScoopDb } from "@/lib/db/client";
import { annotate, type CoinRow, type TipView } from "@/lib/catalog/presence";
import type { OutpointRow, WitnessState } from "@/lib/catalog/outpoints";
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

function asWitness(value: string | null | undefined): WitnessState {
  if (value === "hashed" || value === "published" || value === "unknown") return value;
  return "unknown";
}

/** One catalog row per stored unspent outpoint. Replay risk is that outpoint on both tips. */
export function outpointRowsFromStored(
  scriptId: number,
  address: string | null | undefined,
  states: StoredTip[],
  watchAccountId: number,
  witness: WitnessState = "unknown"
): OutpointRow[] {
  const map = new Map<string, { txid: string; vout: number; core?: StoredTip; knots?: StoredTip }>();
  for (const state of states) {
    if (state.status !== "unspent") continue;
    const txid = state.outpointTxid.toLowerCase();
    const key = `${txid}:${state.outpointVout}`;
    const row = map.get(key) ?? { txid, vout: state.outpointVout };
    row[state.tip] = state;
    map.set(key, row);
  }
  return [...map.values()]
    .sort((a, b) => a.txid.localeCompare(b.txid) || a.vout - b.vout)
    .map((side) => {
      const core: TipView = side.core
        ? {
            status: "unspent",
            txid: side.txid,
            vout: side.vout,
            valueSats: Number(side.core.valueSats ?? 0n),
          }
        : { status: "absent" };
      const knots: TipView = side.knots
        ? {
            status: "unspent",
            txid: side.txid,
            vout: side.vout,
            valueSats: Number(side.knots.valueSats ?? 0n),
          }
        : { status: "absent" };
      const coin: CoinRow = { scriptId, address, core, knots };
      const annotated = annotate(coin);
      return {
        ...annotated,
        txid: side.txid,
        vout: side.vout,
        replayRisk: annotated.presence === "both",
        classified: true,
        witness,
        accountId: watchAccountId,
        watchAccountId,
      };
    });
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

  return scripts.flatMap((s) =>
    outpointRowsFromStored(
      s.id,
      s.address,
      byScript.get(s.id) ?? [],
      s.accountId,
      asWitness(s.witnessState)
    )
  );
}
