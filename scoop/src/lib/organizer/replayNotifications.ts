import type { ScoopDb } from "@/lib/db/client";
import {
  organizerNotifications,
  organizerTasks,
  scriptTipState,
} from "@/lib/db/schema";
import {
  isReplayReceive,
  replayDedupeKey,
  shouldCreateReplayAlert,
  type PriorTipOutpoint,
} from "@/lib/catalog/replayReceive";
import type { UnspentItem } from "@/lib/sync/fetchTip";
import { eq } from "drizzle-orm";

export type ReplaySyncInput = {
  db: ScoopDb;
  organizerAccountId: number;
  scriptId: number;
  scripthash: string;
  address?: string | null;
  coreUnspent: UnspentItem[];
  knotsUnspent: UnspentItem[];
};

export type ReplaySyncResult = {
  hits: ReturnType<typeof isReplayReceive>;
  newNotifications: {
    id: number;
    dedupeKey: string;
    title: string;
    body: string;
  }[];
};

/**
 * Detect replay receives, persist new notifications + auto tasks, refresh tip state.
 */
export async function applyReplayReceiveSync(
  input: ReplaySyncInput
): Promise<ReplaySyncResult> {
  const { db, organizerAccountId, scriptId, scripthash, address } = input;
  const hits = isReplayReceive(input.coreUnspent, input.knotsUnspent);

  const priorRows = await db
    .select()
    .from(scriptTipState)
    .where(eq(scriptTipState.scriptId, scriptId));
  const prior: PriorTipOutpoint[] = priorRows.map((r) => ({
    tip: r.tip,
    txid: r.outpointTxid,
    vout: r.outpointVout,
    status: r.status,
  }));

  const newNotifications: ReplaySyncResult["newNotifications"] = [];

  for (const hit of hits) {
    if (!shouldCreateReplayAlert(hit, prior)) continue;
    const dedupeKey = replayDedupeKey(scripthash, hit.txid, hit.vout);
    const label = address?.trim() || scripthash.slice(0, 12) + "…";
    const title = `Replay received — ${label}`;
    const body = `${hit.valueSats.toString()} sats unspent on Core and Knots (tx ${hit.txid.slice(0, 8)}…:${hit.vout}). Split before spending.`;

    const existing = await db
      .select()
      .from(organizerNotifications)
      .where(eq(organizerNotifications.dedupeKey, dedupeKey))
      .limit(1);
    if (existing.length) continue;

    const [notif] = await db
      .insert(organizerNotifications)
      .values({
        accountId: organizerAccountId,
        scriptId,
        kind: "replay_receive",
        title,
        body,
        outpointTxid: hit.txid,
        outpointVout: hit.vout,
        valueSats: hit.valueSats,
        dedupeKey,
      })
      .returning();
    newNotifications.push({
      id: notif.id,
      dedupeKey,
      title,
      body,
    });

    const taskDedupe = `task:${dedupeKey}`;
    const existingTask = await db
      .select()
      .from(organizerTasks)
      .where(eq(organizerTasks.dedupeKey, taskDedupe))
      .limit(1);
    if (!existingTask.length) {
      await db.insert(organizerTasks).values({
        accountId: organizerAccountId,
        scriptId,
        kind: "auto_replay_receive",
        status: "open",
        title: `Replay received — split before spending (${label})`,
        body,
        dedupeKey: taskDedupe,
        metadata: {
          txid: hit.txid,
          vout: hit.vout,
          valueSats: hit.valueSats.toString(),
        },
      });
    } else if (existingTask[0].status === "dismissed") {
      await db
        .update(organizerTasks)
        .set({ status: "open", completedAt: null })
        .where(eq(organizerTasks.id, existingTask[0].id));
    }
  }

  // Refresh tip state for this script from current unspent sets
  await db.delete(scriptTipState).where(eq(scriptTipState.scriptId, scriptId));
  const tipRows = [
    ...input.coreUnspent.map((u) => ({
      scriptId,
      tip: "core" as const,
      outpointTxid: u.tx_hash.toLowerCase(),
      outpointVout: u.tx_pos,
      status: "unspent" as const,
    })),
    ...input.knotsUnspent.map((u) => ({
      scriptId,
      tip: "knots" as const,
      outpointTxid: u.tx_hash.toLowerCase(),
      outpointVout: u.tx_pos,
      status: "unspent" as const,
    })),
  ];
  if (tipRows.length) {
    await db.insert(scriptTipState).values(tipRows);
  }

  return { hits, newNotifications };
}
