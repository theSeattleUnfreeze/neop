import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** One-hop split forks. Optional accountId limits parents to that wallet. */
export async function GET(req: Request) {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({ error: "SCOOP_DATABASE_URL required" }, { status: 503 });
  }
  const accountRaw = new URL(req.url).searchParams.get("accountId");
  let accountId: number | undefined;
  if (accountRaw != null && accountRaw !== "") {
    accountId = Number(accountRaw);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
    }
  }

  const { createDb } = await import("@/lib/db/client");
  const { loadCoinForks } = await import("@/lib/fork/loadForks");
  const db = createDb();
  const forks = await loadCoinForks(db, accountId);
  return NextResponse.json({ forks });
}
