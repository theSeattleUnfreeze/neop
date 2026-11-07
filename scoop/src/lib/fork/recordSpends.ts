import { and, eq } from "drizzle-orm";
import type { ScoopDb } from "@/lib/db/client";
import { scriptTipState, spendEvents, spendOutputs } from "@/lib/db/schema";
import { decodeTransaction } from "@/lib/fork/decodeTx";
import {
  discoverSpends,
  outpointKey,
  txidsToFetch,
  type HistoryTx,
} from "@/lib/fork/discoverSpends";
import type { HistoryItem, UnspentItem } from "@/lib/sync/fetchTip";

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

function satsToBigint(value: number | null): bigint | null {
  if (value == null || !Number.isFinite(value)) return null;
  return BigInt(Math.trunc(value));
}

/**
 * Resolve spends of one watched script on one tip and store any that are new.
 * Returns prev-outpoint → spend txid, including rows already stored.
 */
export async function recordScriptSpends(args: {
  db: ScoopDb;
  scriptId: number;
  tip: "core" | "knots";
  scriptPubKeyHex: string | null;
  address: string | null;
  history: HistoryItem[];
  unspent: UnspentItem[];
  getTxHex: (txid: string) => Promise<string | null>;
}): Promise<Map<string, string>> {
  const existing = await args.db
    .select()
    .from(spendEvents)
    .where(and(eq(spendEvents.scriptId, args.scriptId), eq(spendEvents.tip, args.tip)));

  const resolved = new Map<string, string>();
  const knownSpendTxids = new Set<string>();
  const knownPrevTxids = new Set<string>();
  for (const row of existing) {
    resolved.set(outpointKey(row.prevTxid, row.prevVout), row.txid.toLowerCase());
    knownSpendTxids.add(row.txid.toLowerCase());
    knownPrevTxids.add(row.prevTxid.toLowerCase());
  }

  const prior = await args.db
    .select()
    .from(scriptTipState)
    .where(and(eq(scriptTipState.scriptId, args.scriptId), eq(scriptTipState.tip, args.tip)));

  let unresolvedSpent = 0;
  const knownOutpoints = prior.map((row) => {
    const key = outpointKey(row.outpointTxid, row.outpointVout);
    if (row.status === "spent" && !resolved.has(key)) unresolvedSpent += 1;
    return {
      txid: row.outpointTxid,
      vout: row.outpointVout,
      valueSats: row.valueSats == null ? null : Number(row.valueSats),
    };
  });
  for (const utxo of args.unspent) {
    knownOutpoints.push({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      valueSats: utxo.value,
    });
  }

  const txids = txidsToFetch({
    history: args.history,
    unspent: args.unspent,
    knownSpendTxids,
    knownPrevTxids,
    unresolvedSpent,
  });
  if (!txids.length) return resolved;

  const heightByTx = new Map(
    args.history.map((item) => [item.tx_hash.toLowerCase(), item.height])
  );
  const txs: HistoryTx[] = [];
  for (const txid of txids) {
    const hex = await args.getTxHex(txid);
    if (!hex) continue;
    try {
      const decoded = decodeTransaction(hex, args.address);
      txs.push({ ...decoded, height: heightByTx.get(txid) ?? 0 });
    } catch {
      /* skip a tx this tip could not decode */
    }
  }

  const found = discoverSpends({
    scriptPubKeyHex: args.scriptPubKeyHex,
    address: args.address,
    txs,
    knownOutpoints,
  });

  for (const spend of found) {
    const key = outpointKey(spend.prevTxid, spend.prevVout);
    if (resolved.has(key)) continue;
    try {
      const inserted = await args.db
        .insert(spendEvents)
        .values({
          scriptId: args.scriptId,
          tip: args.tip,
          txid: spend.spendTxid,
          prevTxid: spend.prevTxid,
          prevVout: spend.prevVout,
          valueSats: satsToBigint(spend.valueSats),
        })
        .returning({ id: spendEvents.id });
      const spendEventId = inserted[0]?.id;
      if (spendEventId == null) continue;
      if (spend.outputs.length) {
        await args.db.insert(spendOutputs).values(
          spend.outputs.map((output) => ({
            spendEventId,
            vout: output.vout,
            valueSats: satsToBigint(output.valueSats) ?? 0n,
            address: output.address,
            scriptLabel: output.scriptLabel,
          }))
        );
      }
      resolved.set(key, spend.spendTxid);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }

  return resolved;
}
