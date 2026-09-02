import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { serializeBigints } from "@/lib/catalog/balances";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function requireDb() {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json(
      { error: "SCOOP_DATABASE_URL required" },
      { status: 503 }
    );
  }
  return null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const err = requireDb();
  if (err) return err;
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
  let scripts: unknown[] = [];
  if (account.watchAccountId) {
    scripts = await db
      .select()
      .from(watchedScripts)
      .where(eq(watchedScripts.accountId, account.watchAccountId));
  }
  return NextResponse.json({ account: serializeBigints(account), scripts });
}

type PatchBody = {
  label?: string;
  notes?: string;
  reminder?: string;
  watchAccountId?: number | null;
  manualCoreSats?: string | number | null;
  manualKnotsSats?: string | number | null;
  sortOrder?: number;
};

export async function PATCH(req: Request, ctx: Ctx) {
  const err = requireDb();
  if (err) return err;
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await req.json()) as PatchBody;
  const { createDb } = await import("@/lib/db/client");
  const { organizerAccounts } = await import("@/lib/db/schema");
  const db = createDb();

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.label !== undefined) patch.label = body.label;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.reminder !== undefined) patch.reminder = body.reminder;
  if (body.watchAccountId !== undefined) patch.watchAccountId = body.watchAccountId;
  if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
  if (body.manualCoreSats !== undefined) {
    patch.manualCoreSats =
      body.manualCoreSats === null || body.manualCoreSats === ""
        ? null
        : BigInt(body.manualCoreSats);
  }
  if (body.manualKnotsSats !== undefined) {
    patch.manualKnotsSats =
      body.manualKnotsSats === null || body.manualKnotsSats === ""
        ? null
        : BigInt(body.manualKnotsSats);
  }

  const [account] = await db
    .update(organizerAccounts)
    .set(patch)
    .where(eq(organizerAccounts.id, id))
    .returning();
  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: serializeBigints(account) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const err = requireDb();
  if (err) return err;
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const { createDb } = await import("@/lib/db/client");
  const { organizerAccounts } = await import("@/lib/db/schema");
  const db = createDb();
  const deleted = await db
    .delete(organizerAccounts)
    .where(eq(organizerAccounts.id, id))
    .returning();
  if (!deleted.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
