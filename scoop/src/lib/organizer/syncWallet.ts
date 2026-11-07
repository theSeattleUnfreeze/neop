import { eq } from "drizzle-orm";
import { aggregateAccountBalances } from "@/lib/catalog/balances";
import {
  outpointRowsFromTips,
  witnessExposureFromTips,
  witnessFromTips,
} from "@/lib/catalog/outpoints";
import { createBlockTimeResolver, type BlockTimeResolver } from "@/lib/electrum/blockTime";
import { ElectrumClient } from "@/lib/electrum/client";
import { anyElectrumReachable } from "@/lib/electrum/discoverXpub";
import { recordScriptSpends } from "@/lib/fork/recordSpends";
import { envElectrumUrls, fetchScriptTip } from "@/lib/sync/fetchTip";
import {
  applyReplayReceiveSync,
  replaceTipUnspent,
} from "@/lib/organizer/replayNotifications";
import { suggestTasksFromRows } from "@/lib/organizer/suggestTasks";
import { recordTipSync } from "@/lib/organizer/tipHealth";
import type { ScoopDb } from "@/lib/db/client";
import {
  organizerAccounts,
  organizerTasks,
  watchedScripts,
} from "@/lib/db/schema";

function cachedTxGetter(
  client: ElectrumClient | null
): (txid: string) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (txid) => {
    const key = txid.toLowerCase();
    if (cache.has(key)) return cache.get(key) ?? null;
    if (!client) {
      cache.set(key, null);
      return null;
    }
    try {
      const hex = await client.getTransaction(key);
      cache.set(key, hex);
      return hex;
    } catch {
      cache.set(key, null);
      return null;
    }
  };
}

function tipTimes(url: string | undefined): { client: ElectrumClient; times: BlockTimeResolver } | null {
  if (!url) return null;
  const client = ElectrumClient.fromUrl(url);
  return {
    client,
    times: createBlockTimeResolver((height) => client.getBlockHeader(height)),
  };
}

export async function syncOrganizerWallet(db: ScoopDb, id: number) {
  const [account] = await db
    .select()
    .from(organizerAccounts)
    .where(eq(organizerAccounts.id, id))
    .limit(1);
  if (!account) {
    return { error: "not found" as const, status: 404 as const };
  }
  if (!account.watchAccountId) {
    return {
      error: "manual wallet has no Electrum watches; update estimates instead" as const,
      status: 400 as const,
    };
  }

  const scripts = await db
    .select()
    .from(watchedScripts)
    .where(eq(watchedScripts.accountId, account.watchAccountId));

  const urls = envElectrumUrls();
  const health = {
    fulcrum: Boolean(urls.fulcrum),
    shulcrum: Boolean(urls.shulcrum),
    fulcrumError: urls.fulcrum ? null : ("FULCRUM_URL unset" as string | null),
    shulcrumError: urls.shulcrum ? null : ("SHULCRUM_URL unset" as string | null),
  };
  const configured = [urls.fulcrum, urls.shulcrum].filter(Boolean) as string[];
  if (configured.length && !(await anyElectrumReachable(configured))) {
    if (urls.fulcrum) await recordTipSync(db, "core", false, "Electrum unreachable");
    if (urls.shulcrum) await recordTipSync(db, "knots", false, "Electrum unreachable");
    return { pending: true as const, health, rows: [], newNotifications: [], suggestedTasks: 0 };
  }

  const rows = [];
  const newNotifications = [];
  let tipAnswered = false;
  let coreOk: boolean | null = null;
  let knotsOk: boolean | null = null;
  let coreError: string | null = null;
  let knotsError: string | null = null;
  const coreTip = tipTimes(urls.fulcrum);
  const knotsTip = tipTimes(urls.shulcrum);
  const coreTx = cachedTxGetter(coreTip?.client ?? null);
  const knotsTx = cachedTxGetter(knotsTip?.client ?? null);
  try {
    for (const s of scripts) {
      const core = urls.fulcrum
        ? await fetchScriptTip("core", urls.fulcrum, s.electrumScripthash)
        : undefined;
      const knots = urls.shulcrum
        ? await fetchScriptTip("knots", urls.shulcrum, s.electrumScripthash)
        : undefined;
      if (core) {
        coreOk = coreOk === false ? false : core.ok;
        if (!core.ok) coreError = core.error ?? "fulcrum error";
      }
      if (knots) {
        knotsOk = knotsOk === false ? false : knots.ok;
        if (!knots.ok) knotsError = knots.error ?? "shulcrum error";
      }
      if (core?.ok || knots?.ok) tipAnswered = true;
      else if (!tipAnswered) {
        // First watched script failed on every configured tip — stop before the gap.
        if (urls.fulcrum) await recordTipSync(db, "core", false, coreError ?? "unreachable");
        if (urls.shulcrum) await recordTipSync(db, "knots", false, knotsError ?? "unreachable");
        return {
          pending: true as const,
          health,
          rows: [],
          newNotifications: [],
          suggestedTasks: 0,
        };
      }
      const coreSpends = core?.ok
        ? await recordScriptSpends({
            db,
            scriptId: s.id,
            tip: "core",
            scriptPubKeyHex: s.scriptPubKeyHex,
            address: s.address,
            history: core.history,
            unspent: core.unspent,
            getTxHex: coreTx,
          })
        : new Map<string, string>();
      const knotsSpends = knots?.ok
        ? await recordScriptSpends({
            db,
            scriptId: s.id,
            tip: "knots",
            scriptPubKeyHex: s.scriptPubKeyHex,
            address: s.address,
            history: knots.history,
            unspent: knots.unspent,
            getTxHex: knotsTx,
          })
        : new Map<string, string>();
      const live = outpointRowsFromTips(s.id, s.address, core, knots, {
        accountId: s.accountId,
        watchAccountId: s.accountId,
        resolvedSpends: { core: coreSpends, knots: knotsSpends },
      });
      rows.push(...live);
      const witnessState = witnessFromTips(core, knots);
      const exposure = witnessState === "published" ? witnessExposureFromTips(core, knots) : null;
      let exposedAt: Date | null = null;
      if (exposure?.height != null && exposure.height > 0) {
        const times = exposure.tip === "core" ? coreTip?.times : knotsTip?.times;
        exposedAt = times ? await times.timeForHeight(exposure.height) : null;
      }
      await db
        .update(watchedScripts)
        .set({
          witnessState,
          witnessExposedTxid: exposure?.txid ?? null,
          witnessExposedTip: exposure?.tip ?? null,
          witnessExposedHeight: exposure?.height ?? null,
          witnessExposedAt: exposedAt,
        })
        .where(eq(watchedScripts.id, s.id));
      if (core && !core.ok) health.fulcrumError = core.error ?? "fulcrum error";
      if (knots && !knots.ok) health.shulcrumError = knots.error ?? "shulcrum error";

      if (core?.ok && knots?.ok) {
        const replay = await applyReplayReceiveSync({
          db,
          organizerAccountId: account.id,
          scriptId: s.id,
          scripthash: s.electrumScripthash,
          address: s.address,
          coreUnspent: core.unspent,
          knotsUnspent: knots.unspent,
          coreHistory: core.history,
          knotsHistory: knots.history,
          coreTimes: coreTip?.times,
          knotsTimes: knotsTip?.times,
          liveOutpoints: live,
        });
        newNotifications.push(...replay.newNotifications);
      } else {
        if (core?.ok) {
          await replaceTipUnspent(db, s.id, "core", core.unspent, coreTip?.times, core.history);
        }
        if (knots?.ok) {
          await replaceTipUnspent(db, s.id, "knots", knots.unspent, knotsTip?.times, knots.history);
        }
      }
    }

    const suggestions = suggestTasksFromRows(rows).filter(
      (s) => s.kind !== "auto_replay_receive"
    );
    let suggestedCount = 0;
    for (const s of suggestions) {
      const existing = await db
        .select()
        .from(organizerTasks)
        .where(eq(organizerTasks.dedupeKey, s.dedupeKey))
        .limit(1);
      if (existing.length) continue;
      await db.insert(organizerTasks).values({
        accountId: account.id,
        scriptId: s.scriptId,
        kind: s.kind,
        status: "open",
        title: s.title,
        body: s.body,
        dedupeKey: s.dedupeKey,
        metadata: s.metadata ?? null,
      });
      suggestedCount += 1;
    }

    await db
      .update(organizerAccounts)
      .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizerAccounts.id, id));

    if (urls.fulcrum) {
      await recordTipSync(db, "core", coreOk === true, coreError);
    }
    if (urls.shulcrum) {
      await recordTipSync(db, "knots", knotsOk === true, knotsError);
    }

    const balances = aggregateAccountBalances(
      [
        {
          id: account.id,
          source: account.source,
          watchAccountId: account.watchAccountId,
          manualCoreSats: account.manualCoreSats,
          manualKnotsSats: account.manualKnotsSats,
          synced: true,
        },
      ],
      rows,
      {
        core: coreOk === true,
        knots: knotsOk === true,
        coreError,
        knotsError,
      }
    );

    const { loadAccountActivity, serializeActivityStamp } = await import(
      "@/lib/organizer/accountActivity"
    );
    const activity = (
      await loadAccountActivity(db, [
        { id: account.id, watchAccountId: account.watchAccountId },
      ])
    ).get(account.id);

    return {
      health,
      rows,
      balance: balances[0],
      lastReceived: serializeActivityStamp(activity?.lastReceived ?? { height: null, at: null }),
      lastSent: serializeActivityStamp(activity?.lastSent ?? { height: null, at: null }),
      newNotifications,
      suggestedTasks: suggestedCount,
    };
  } finally {
    coreTip?.client.close();
    knotsTip?.client.close();
  }
}
