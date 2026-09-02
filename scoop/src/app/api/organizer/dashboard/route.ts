import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  aggregateAccountBalances,
  portfolioTotals,
  serializeBigints,
} from "@/lib/catalog/balances";

export const runtime = "nodejs";

/** Portfolio headline + account cards + open task / unread notification counts. */
export async function GET() {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json(
      { error: "SCOOP_DATABASE_URL required for dashboard" },
      { status: 503 }
    );
  }
  const { createDb } = await import("@/lib/db/client");
  const {
    organizerAccounts,
    organizerTasks,
    organizerNotifications,
    syncState,
  } = await import("@/lib/db/schema");
  const db = createDb();

  const accounts = await db
    .select()
    .from(organizerAccounts)
    .orderBy(organizerAccounts.sortOrder);

  // Live rows not loaded here — electrum balances come from last sync via manual
  // estimates or a follow-up sync. Dashboard uses stored manual sats + zeros for
  // electrum until client syncs (balances filled after sync endpoint).
  const balances = aggregateAccountBalances(
    accounts.map((a) => ({
      id: a.id,
      source: a.source,
      watchAccountId: a.watchAccountId,
      manualCoreSats: a.manualCoreSats,
      manualKnotsSats: a.manualKnotsSats,
    })),
    []
  );

  const openTasks = await db
    .select({
      accountId: organizerTasks.accountId,
      count: sql<number>`count(*)::int`,
    })
    .from(organizerTasks)
    .where(eq(organizerTasks.status, "open"))
    .groupBy(organizerTasks.accountId);

  const unreadNotifs = await db
    .select({
      accountId: organizerNotifications.accountId,
      count: sql<number>`count(*)::int`,
    })
    .from(organizerNotifications)
    .where(
      and(
        isNull(organizerNotifications.readAt),
        isNull(organizerNotifications.dismissedAt)
      )
    )
    .groupBy(organizerNotifications.accountId);

  const taskCountByAccount = new Map(
    openTasks.map((t) => [t.accountId, Number(t.count)])
  );
  const notifCountByAccount = new Map(
    unreadNotifs.map((n) => [n.accountId, Number(n.count)])
  );

  const cards = accounts.map((a, i) => ({
    account: a,
    balance: balances[i],
    openTaskCount: taskCountByAccount.get(a.id) ?? 0,
    unreadNotificationCount: notifCountByAccount.get(a.id) ?? 0,
  }));

  const unreadTotal = [...notifCountByAccount.values()].reduce((a, b) => a + b, 0);
  const openTaskTotal = [...taskCountByAccount.values()].reduce((a, b) => a + b, 0);

  const tipHealth = await db.select().from(syncState);

  return NextResponse.json(
    serializeBigints({
      portfolio: portfolioTotals(balances),
      cards,
      unreadNotificationCount: unreadTotal,
      openTaskCount: openTaskTotal,
      tipHealth,
    })
  );
}
