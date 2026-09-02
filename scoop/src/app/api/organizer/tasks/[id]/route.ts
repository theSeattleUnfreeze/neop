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
  const body = (await req.json()) as {
    status?: "open" | "done" | "dismissed";
    title?: string;
    body?: string;
    dueAt?: string | null;
  };

  const { createDb } = await import("@/lib/db/client");
  const { organizerTasks } = await import("@/lib/db/schema");
  const db = createDb();

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.body !== undefined) patch.body = body.body;
  if (body.dueAt !== undefined) {
    patch.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  }
  if (body.status !== undefined) {
    patch.status = body.status;
    patch.completedAt =
      body.status === "done" || body.status === "dismissed" ? new Date() : null;
  }

  const [task] = await db
    .update(organizerTasks)
    .set(patch)
    .where(eq(organizerTasks.id, id))
    .returning();
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ task: serializeBigints(task) });
}
