/** Catalog buckets for broadcast pairing. No addresses or txids leave this module. */

import { inArray } from "drizzle-orm";
import { createDb } from "@/lib/db/client";
import { scriptTipState, watchedScripts } from "@/lib/db/schema";
import { coinNeedFromStatus, type CoinNeed } from "@/lib/broadcast/pairWave";

function pointKey(txid: string, vout: number): string {
  return `${txid.toLowerCase()}:${vout}`;
}

export async function catalogNeeds(outpoints: string[]): Promise<Record<string, CoinNeed>> {
  const wanted = new Set(outpoints.map((point) => point.toLowerCase()));
  const txids = [...new Set([...wanted].map((point) => point.split(":")[0]).filter((txid) => txid.length > 0))];
  const found: Record<string, CoinNeed> = {};
  if (txids.length === 0) return found;
  const db = createDb();
  const rows = await db
    .select({
      txid: scriptTipState.outpointTxid,
      vout: scriptTipState.outpointVout,
      tip: scriptTipState.tip,
      status: scriptTipState.status,
    })
    .from(scriptTipState)
    .where(inArray(scriptTipState.outpointTxid, txids));
  const grouped = new Map<string, { core?: string; knots?: string }>();
  for (const row of rows) {
    const key = pointKey(row.txid, row.vout);
    if (!wanted.has(key)) continue;
    const slot = grouped.get(key) ?? {};
    slot[row.tip] = row.status;
    grouped.set(key, slot);
  }
  for (const key of wanted) {
    const slot = grouped.get(key);
    found[key] = coinNeedFromStatus(slot?.core, slot?.knots);
  }
  return found;
}

export async function addressCoverage(addresses: string[]): Promise<{ known: number; unknown: number }> {
  const unique = [...new Set(addresses.map((value) => value.trim()).filter((value) => value.length > 0))];
  if (unique.length === 0) return { known: 0, unknown: 0 };
  const db = createDb();
  const rows = await db
    .select({ address: watchedScripts.address })
    .from(watchedScripts)
    .where(inArray(watchedScripts.address, unique));
  const knownSet = new Set(rows.map((row) => row.address).filter((value): value is string => Boolean(value)));
  const known = unique.filter((value) => knownSet.has(value)).length;
  return { known, unknown: unique.length - known };
}
