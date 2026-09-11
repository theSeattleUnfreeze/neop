import { eq } from "drizzle-orm";
import { aggregateAccountBalances } from "@/lib/catalog/balances";
import { coinRowFromTips } from "@/lib/sync/buildRows";
import { envElectrumUrls, fetchScriptTip } from "@/lib/sync/fetchTip";
import {
  applyReplayReceiveSync,
  replaceTipUnspent,
} from "@/lib/organizer/replayNotifications";
import { suggestTasksFromRows } from "@/lib/organizer/suggestTasks";
import type { ScoopDb } from "@/lib/db/client";
import {
  organizerAccounts,
  organizerTasks,
  watchedScripts,
} from "@/lib/db/schema";

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

  const rows = [];
  const newNotifications = [];
  for (const s of scripts) {
    const core = urls.fulcrum
      ? await fetchScriptTip("core", urls.fulcrum, s.electrumScripthash)
      : undefined;
    const knots = urls.shulcrum
      ? await fetchScriptTip("knots", urls.shulcrum, s.electrumScripthash)
      : undefined;
    rows.push(
      coinRowFromTips(s.id, s.address, core, knots, {
        accountId: s.accountId,
        watchAccountId: s.accountId,
      })
    );
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
      });
      newNotifications.push(...replay.newNotifications);
    } else {
      if (core?.ok) await replaceTipUnspent(db, s.id, "core", core.unspent);
      if (knots?.ok) await replaceTipUnspent(db, s.id, "knots", knots.unspent);
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

  const balances = aggregateAccountBalances(
    [
      {
        id: account.id,
        source: account.source,
        watchAccountId: account.watchAccountId,
        manualCoreSats: account.manualCoreSats,
        manualKnotsSats: account.manualKnotsSats,
      },
    ],
    rows
  );

  return {
    health,
    rows,
    balance: balances[0],
    newNotifications,
    suggestedTasks: suggestedCount,
  };
}
