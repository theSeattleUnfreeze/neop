import { and, eq, inArray } from "drizzle-orm";
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

/** What to do when a prevout already has a stored spend. */
export function spendWritePlan(
  prior: { txid: string; outputCount: number } | undefined,
  nextTxid: string,
  nextOutputCount: number
): "insert" | "replace" | "backfill" | "skip" {
  if (!prior) return "insert";
  if (prior.txid.toLowerCase() !== nextTxid.toLowerCase()) return "replace";
  if (prior.outputCount === 0 && nextOutputCount > 0) return "backfill";
  return "skip";
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

  const outputIds = existing.length
    ? await args.db
        .select({ spendEventId: spendOutputs.spendEventId })
        .from(spendOutputs)
        .where(inArray(spendOutputs.spendEventId, existing.map((row) => row.id)))
    : [];
  const eventsWithOutputs = new Set(outputIds.map((row) => row.spendEventId));

  const resolved = new Map<string, string>();
  const knownSpendTxids = new Set<string>();
  const knownPrevTxids = new Set<string>();
  const byPrev = new Map<string, (typeof existing)[number]>();
  let missingOutputs = 0;
  for (const row of existing) {
    const key = outpointKey(row.prevTxid, row.prevVout);
    resolved.set(key, row.txid.toLowerCase());
    byPrev.set(key, row);
    if (!eventsWithOutputs.has(row.id)) {
      missingOutputs += 1;
      continue;
    }
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
    unresolvedSpent: unresolvedSpent + missingOutputs,
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
    const prior = byPrev.get(key);
    const outputCount = prior && eventsWithOutputs.has(prior.id) ? 1 : 0;
    const plan = spendWritePlan(
      prior ? { txid: prior.txid, outputCount } : undefined,
      spend.spendTxid,
      spend.outputs.length
    );
    if (plan === "skip") continue;
    const outputValues = spend.outputs.map((output) => ({
      vout: output.vout,
      valueSats: satsToBigint(output.valueSats) ?? 0n,
      address: output.address,
      scriptLabel: output.scriptLabel,
    }));
    try {
      if (plan === "backfill" && prior) {
        await args.db.insert(spendOutputs).values(
          outputValues.map((output) => ({ ...output, spendEventId: prior.id }))
        );
        eventsWithOutputs.add(prior.id);
        resolved.set(key, prior.txid.toLowerCase());
        continue;
      }
      await args.db.transaction(async (tx) => {
        if (prior) await tx.delete(spendEvents).where(eq(spendEvents.id, prior.id));
        const inserted = await tx
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
        if (spendEventId == null || outputValues.length === 0) return;
        await tx.insert(spendOutputs).values(
          outputValues.map((output) => ({ ...output, spendEventId }))
        );
      });
      resolved.set(key, spend.spendTxid.toLowerCase());
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }

  return resolved;
}
