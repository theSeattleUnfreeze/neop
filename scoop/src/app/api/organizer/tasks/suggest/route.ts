import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { serializeBigints } from "@/lib/catalog/balances";
import { suggestTasksFromRows } from "@/lib/organizer/suggestTasks";
import type { AnnotatedRow } from "@/lib/catalog/balances";

export const runtime = "nodejs";

/**
 * Upsert auto-suggested tasks from annotated sync rows (or re-suggest after sync).
 * Body: { accountId?, rows: AnnotatedRow[] }
 */
export async function POST(req: Request) {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json(
      { error: "SCOOP_DATABASE_URL required" },
      { status: 503 }
    );
  }
  const body = (await req.json()) as {
    accountId?: number;
    rows?: AnnotatedRow[];
  };
  const rows = body.rows ?? [];
  const suggestions = suggestTasksFromRows(rows);

  const { createDb } = await import("@/lib/db/client");
  const { organizerTasks } = await import("@/lib/db/schema");
  const db = createDb();

  const upserted = [];
  for (const s of suggestions) {
    const existing = await db
      .select()
      .from(organizerTasks)
      .where(eq(organizerTasks.dedupeKey, s.dedupeKey))
      .limit(1);
    if (existing.length) {
      if (existing[0].status === "dismissed" || existing[0].status === "done") {
        continue;
      }
      upserted.push(existing[0]);
      continue;
    }
    const [task] = await db
      .insert(organizerTasks)
      .values({
        accountId: body.accountId ?? null,
        scriptId: s.scriptId,
        kind: s.kind,
        status: "open",
        title: s.title,
        body: s.body,
        dedupeKey: s.dedupeKey,
        metadata: s.metadata ?? null,
      })
      .returning();
    upserted.push(task);
  }

  return NextResponse.json({
    suggested: suggestions.length,
    tasks: serializeBigints(upserted),
  });
}
