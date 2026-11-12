import type { ScoopDb } from "@/lib/db/client";
import {
  organizerNotifications,
  organizerTasks,
  scriptTipState,
} from "@/lib/db/schema";
import {
  isReplayReceive,
  persistedSpentMarkers,
  replayDedupeKey,
  spentMarkersFromOutpoints,
  shouldCreateReplayAlert,
  type PriorTipOutpoint,
} from "@/lib/catalog/replayReceive";
import type { BlockTimeResolver } from "@/lib/electrum/blockTime";
import type { HistoryItem, UnspentItem } from "@/lib/sync/fetchTip";
import { and, eq } from "drizzle-orm";

export type ReplaySyncInput = {
  db: ScoopDb;
  organizerAccountId: number;
  scriptId: number;
  scripthash: string;
  address?: string | null;
  coreUnspent: UnspentItem[];
  knotsUnspent: UnspentItem[];
  coreHistory?: HistoryItem[];
  knotsHistory?: HistoryItem[];
  /** Prefer tip-specific resolvers so post-fork heights map to the right chain. */
  coreTimes?: BlockTimeResolver;
  knotsTimes?: BlockTimeResolver;
  /** @deprecated use coreTimes / knotsTimes */
  times?: BlockTimeResolver;
  /** Live outpoint rows for this script, so a Core spend is kept even on the first sync that sees it. */
  liveOutpoints?: { txid: string; vout: number; core: { status: string }; knots: { status: string } }[];
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

async function stampForHeight(
  height: number | null | undefined,
  times?: BlockTimeResolver
): Promise<{ confirmedHeight: number | null; confirmedAt: Date | null }> {
  if (height == null || height <= 0) return { confirmedHeight: height ?? null, confirmedAt: null };
  const confirmedAt = times ? await times.timeForHeight(height) : null;
  return { confirmedHeight: height, confirmedAt };
}

function outpointKey(txid: string, vout: number): string {
  return `${txid.toLowerCase()}:${vout}`;
}

/**
 * Replace tip state for one tip. Live unspent rows are rewritten from Electrum;
 * spent markers are kept (and newly detected) so Last Sent can survive a sync.
 */
export async function replaceTipUnspent(
  db: ScoopDb,
  scriptId: number,
  tip: "core" | "knots",
  unspent: UnspentItem[],
  times?: BlockTimeResolver,
  history: HistoryItem[] = []
): Promise<void> {
  const prior = await db
    .select()
    .from(scriptTipState)
    .where(and(eq(scriptTipState.scriptId, scriptId), eq(scriptTipState.tip, tip)));
  const liveKeys = new Set(unspent.map((u) => outpointKey(u.tx_hash, u.tx_pos)));

  const spentByKey = new Map<
    string,
    { txid: string; vout: number; confirmedHeight: number | null; confirmedAt: Date | null }
  >();
  for (const row of prior) {
    const key = outpointKey(row.outpointTxid, row.outpointVout);
    if (liveKeys.has(key)) continue;
    if (row.status === "spent") {
      spentByKey.set(key, {
        txid: row.outpointTxid,
        vout: row.outpointVout,
        confirmedHeight: row.confirmedHeight,
        confirmedAt: row.confirmedAt,
      });
    } else if (row.status === "unspent") {
      // Newly spent on this tip since the last sync.
      spentByKey.set(key, {
        txid: row.outpointTxid,
        vout: row.outpointVout,
        confirmedHeight: null,
        confirmedAt: null,
      });
    }
  }

  const rows = [];
  for (const u of unspent) {
    const stamp = await stampForHeight(u.height, times);
    rows.push({
      scriptId,
      tip,
      outpointTxid: u.tx_hash.toLowerCase(),
      outpointVout: u.tx_pos,
      status: "unspent" as const,
      valueSats: BigInt(u.value),
      confirmedHeight: stamp.confirmedHeight,
      confirmedAt: stamp.confirmedAt,
    });
  }
  for (const spent of spentByKey.values()) {
    let height = spent.confirmedHeight;
    let at = spent.confirmedAt;
    if (height == null || height <= 0 || !at) {
      const stamp = await stampForHeight(spendHeightForOutpoint(history, spent.txid), times);
      if (height == null || height <= 0) height = stamp.confirmedHeight;
      if (!at) at = stamp.confirmedAt;
    }
    rows.push({
      scriptId,
      tip,
      outpointTxid: spent.txid.toLowerCase(),
      outpointVout: spent.vout,
      status: "spent" as const,
      valueSats: null,
      confirmedHeight: height,
      confirmedAt: at,
    });
  }
  // Header lookups finish before the delete, and the rewrite is one transaction,
  // so a reader never sees an empty tip and a second sync cannot insert the same outpoint in between.
  await db.transaction(async (tx) => {
    await tx
      .delete(scriptTipState)
      .where(and(eq(scriptTipState.scriptId, scriptId), eq(scriptTipState.tip, tip)));
    if (rows.length) await tx.insert(scriptTipState).values(rows);
  });
}

/**
 * Confirm height of a spend only when history has exactly one other confirmed tx.
 * Electrum history is every fund and spend on the script, so a reused address
 * cannot tell which later tx spent this outpoint.
 */
export function spendHeightForOutpoint(
  history: HistoryItem[],
  fundingTxid: string
): number | null {
  const funding = fundingTxid.toLowerCase();
  const fundingHeight =
    history.find((h) => h.tx_hash.toLowerCase() === funding)?.height ?? 0;
  const candidates = history.filter(
    (h) =>
      h.tx_hash.toLowerCase() !== funding &&
      h.height > 0 &&
      (fundingHeight <= 0 || h.height >= fundingHeight)
  );
  if (candidates.length !== 1) return null;
  return candidates[0].height;
}

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

  const coreTimes = input.coreTimes ?? input.times;
  const knotsTimes = input.knotsTimes ?? input.times;
  await replaceTipUnspent(
    db,
    scriptId,
    "core",
    input.coreUnspent,
    coreTimes,
    input.coreHistory ?? []
  );
  await replaceTipUnspent(
    db,
    scriptId,
    "knots",
    input.knotsUnspent,
    knotsTimes,
    input.knotsHistory ?? []
  );
  // Cross-tip spent markers (e.g. Core spent / Knots still live) that single-tip
  // preservation above may not have seen yet on a fresh dual sync.
  const markers = [
    ...persistedSpentMarkers(prior, input.coreUnspent, input.knotsUnspent),
    ...spentMarkersFromOutpoints(input.liveOutpoints ?? []),
  ].filter((marker, index, all) => {
    const id = `${marker.tip}:${marker.txid}:${marker.vout}`;
    return all.findIndex((other) => `${other.tip}:${other.txid}:${other.vout}` === id) === index;
  });
  for (const marker of markers) {
    const exists = await db
      .select({ id: scriptTipState.id })
      .from(scriptTipState)
      .where(
        and(
          eq(scriptTipState.scriptId, scriptId),
          eq(scriptTipState.tip, marker.tip),
          eq(scriptTipState.outpointTxid, marker.txid),
          eq(scriptTipState.outpointVout, marker.vout)
        )
      )
      .limit(1);
    if (exists.length) continue;
    const history = marker.tip === "core" ? input.coreHistory ?? [] : input.knotsHistory ?? [];
    const tipTimes = marker.tip === "core" ? coreTimes : knotsTimes;
    const stamp = await stampForHeight(spendHeightForOutpoint(history, marker.txid), tipTimes);
    await db.insert(scriptTipState).values({
      scriptId,
      tip: marker.tip,
      outpointTxid: marker.txid,
      outpointVout: marker.vout,
      status: "spent",
      valueSats: null,
      confirmedHeight: stamp.confirmedHeight,
      confirmedAt: stamp.confirmedAt,
    });
  }

  return { hits, newNotifications };
}
