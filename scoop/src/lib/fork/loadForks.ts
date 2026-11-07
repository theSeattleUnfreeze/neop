import { eq, isNotNull } from "drizzle-orm";
import type { ScoopDb } from "@/lib/db/client";
import {
  organizerAccounts,
  spendEvents,
  spendOutputs,
  watchedScripts,
} from "@/lib/db/schema";
import {
  buildForks,
  indexWalletsByAddress,
  type CoinFork,
  type SpendSide,
} from "@/lib/fork/forks";

function satsString(value: bigint | null | undefined): string | null {
  if (value == null) return null;
  return value.toString();
}

/** One-hop forks. Pass an organizer account id to keep parents on that wallet. */
export async function loadCoinForks(
  db: ScoopDb,
  organizerAccountId?: number
): Promise<CoinFork[]> {
  let watchAccountId: number | null = null;
  if (organizerAccountId != null) {
    const [account] = await db
      .select()
      .from(organizerAccounts)
      .where(eq(organizerAccounts.id, organizerAccountId))
      .limit(1);
    if (!account?.watchAccountId) return [];
    watchAccountId = account.watchAccountId;
  }

  const eventQuery = db
    .select({
      scriptId: spendEvents.scriptId,
      tip: spendEvents.tip,
      spendTxid: spendEvents.txid,
      prevTxid: spendEvents.prevTxid,
      prevVout: spendEvents.prevVout,
      valueSats: spendEvents.valueSats,
      parentAddress: watchedScripts.address,
      outputVout: spendOutputs.vout,
      outputValue: spendOutputs.valueSats,
      outputAddress: spendOutputs.address,
      outputLabel: spendOutputs.scriptLabel,
    })
    .from(spendEvents)
    .innerJoin(watchedScripts, eq(watchedScripts.id, spendEvents.scriptId))
    .leftJoin(spendOutputs, eq(spendOutputs.spendEventId, spendEvents.id));

  const events =
    watchAccountId == null
      ? await eventQuery
      : await eventQuery.where(eq(watchedScripts.accountId, watchAccountId));

  const sides = new Map<string, SpendSide>();
  for (const row of events) {
    const key = `${row.scriptId}:${row.tip}:${row.prevTxid.toLowerCase()}:${row.prevVout}`;
    let side = sides.get(key);
    if (!side) {
      side = {
        scriptId: row.scriptId,
        tip: row.tip,
        prevTxid: row.prevTxid.toLowerCase(),
        prevVout: row.prevVout,
        spendTxid: row.spendTxid.toLowerCase(),
        valueSats: satsString(row.valueSats),
        parentAddress: row.parentAddress,
        outputs: [],
      };
      sides.set(key, side);
    }
    if (row.outputVout == null || row.outputValue == null || !row.outputLabel) continue;
    side.outputs.push({
      vout: row.outputVout,
      valueSats: row.outputValue.toString(),
      address: row.outputAddress,
      scriptLabel: row.outputLabel,
    });
  }

  const links = await db
    .select({
      address: watchedScripts.address,
      id: organizerAccounts.id,
      label: organizerAccounts.label,
    })
    .from(watchedScripts)
    .innerJoin(organizerAccounts, eq(organizerAccounts.watchAccountId, watchedScripts.accountId))
    .where(isNotNull(watchedScripts.address));

  const wallets = indexWalletsByAddress(
    links.flatMap((row) =>
      row.address ? [{ address: row.address, id: row.id, label: row.label }] : []
    )
  );

  return buildForks([...sides.values()], wallets);
}
