import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { serializeBigints } from "@/lib/catalog/balances";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
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
  const body = (await req.json()) as { read?: boolean; dismissed?: boolean };
  const { createDb } = await import("@/lib/db/client");
  const { organizerNotifications } = await import("@/lib/db/schema");
  const db = createDb();

  const patch: Record<string, Date | null> = {};
  if (body.read === true) patch.readAt = new Date();
  if (body.read === false) patch.readAt = null;
  if (body.dismissed === true) {
    patch.dismissedAt = new Date();
    patch.readAt = patch.readAt ?? new Date();
  }
  if (body.dismissed === false) patch.dismissedAt = null;

  const [row] = await db
    .update(organizerNotifications)
    .set(patch)
    .where(eq(organizerNotifications.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ notification: serializeBigints(row) });
}
