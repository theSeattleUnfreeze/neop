import { NextResponse } from "next/server";
import { serializeBigints } from "@/lib/catalog/balances";
import { syncOrganizerWallet } from "@/lib/organizer/syncWallet";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Sync Electrum for a wallet's watched addresses.
 * Persists each tip that succeeds; replay-receive still requires both tips.
 */
export async function POST(_req: Request, ctx: Ctx) {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({ error: "SCOOP_DATABASE_URL required" }, { status: 503 });
  }
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const { createDb } = await import("@/lib/db/client");
  const db = createDb();
  const result = await syncOrganizerWallet(db, id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(serializeBigints(result));
}
