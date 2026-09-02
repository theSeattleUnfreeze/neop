import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { serializeBigints } from "@/lib/catalog/balances";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json(
      { error: "SCOOP_DATABASE_URL required" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "unread";
  const accountId = url.searchParams.get("accountId");

  const { createDb } = await import("@/lib/db/client");
  const { organizerNotifications } = await import("@/lib/db/schema");
  const db = createDb();

  const conditions = [];
  if (filter === "unread") {
    conditions.push(isNull(organizerNotifications.readAt));
    conditions.push(isNull(organizerNotifications.dismissedAt));
  } else if (filter === "active") {
    conditions.push(isNull(organizerNotifications.dismissedAt));
  }
  if (accountId) {
    conditions.push(eq(organizerNotifications.accountId, Number(accountId)));
  }

  const rows = await db
    .select()
    .from(organizerNotifications)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(organizerNotifications.detectedAt))
    .limit(100);

  return NextResponse.json({ notifications: serializeBigints(rows) });
}
