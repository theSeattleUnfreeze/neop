import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { localOnly } from "@/lib/api/localOnly";
import { acceptLabelRecords } from "@/lib/labels/bip329";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function requireDb() {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({ error: "SCOOP_DATABASE_URL required" }, { status: 503 });
  }
  return null;
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = localOnly(req);
  if (denied) return denied;
  const err = requireDb();
  if (err) return err;
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const { createDb } = await import("@/lib/db/client");
  const { walletLabels } = await import("@/lib/db/schema");
  const db = createDb();
  const rows = await db.select().from(walletLabels).where(eq(walletLabels.accountId, id));
  return NextResponse.json({
    labels: rows.map((row) => ({ type: row.kind, ref: row.ref, label: row.label })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = localOnly(req);
  if (denied) return denied;
  const err = requireDb();
  if (err) return err;
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = acceptLabelRecords(body && typeof body === "object" ? (body as { records?: unknown }).records : null);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { createDb } = await import("@/lib/db/client");
  const { organizerAccounts, walletLabels } = await import("@/lib/db/schema");
  const db = createDb();
  const [account] = await db.select({ id: organizerAccounts.id }).from(organizerAccounts).where(eq(organizerAccounts.id, id));
  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.delete(walletLabels).where(eq(walletLabels.accountId, id));
  if (parsed.records.length) {
    await db.insert(walletLabels).values(
      parsed.records.map((record) => ({
        accountId: id,
        kind: record.type,
        ref: record.ref,
        label: record.label,
      }))
    );
  }
  return NextResponse.json({ saved: parsed.records.length });
}
