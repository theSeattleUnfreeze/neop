import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  aggregateAccountBalances,
  portfolioTotals,
  serializeBigints,
} from "@/lib/catalog/balances";
import { coinRowFromTips } from "@/lib/sync/buildRows";
import { envElectrumUrls, fetchScriptTip } from "@/lib/sync/fetchTip";
import { applyReplayReceiveSync } from "@/lib/organizer/replayNotifications";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Sync Electrum for an organizer account's watched scripts.
 * Writes replay-receive notifications when a shared outpoint newly appears on both tips.
 */
export async function POST(_req: Request, ctx: Ctx) {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json(
      { error: "SCOOP_DATABASE_URL required" },
      { status: 503 }
    );
  }
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const { createDb } = await import("@/lib/db/client");
  const { organizerAccounts, watchedScripts } = await import("@/lib/db/schema");
  const db = createDb();
  const [account] = await db
    .select()
    .from(organizerAccounts)
    .where(eq(organizerAccounts.id, id))
    .limit(1);
  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!account.watchAccountId) {
    return NextResponse.json(
      { error: "manual account has no Electrum watches; update estimates instead" },
      { status: 400 }
    );
  }

  const scripts = await db
    .select()
    .from(watchedScripts)
    .where(eq(watchedScripts.accountId, account.watchAccountId));

  const urls = envElectrumUrls();
  const health = {
    fulcrum: Boolean(urls.fulcrum),
    shulcrum: Boolean(urls.shulcrum),
    fulcrumError: urls.fulcrum ? null : "FULCRUM_URL unset",
    shulcrumError: urls.shulcrum ? null : "SHULCRUM_URL unset",
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
    }
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

  return NextResponse.json(
    serializeBigints({
      health,
      rows,
      balance: balances[0],
      newNotifications,
    })
  );
}
