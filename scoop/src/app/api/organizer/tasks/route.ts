import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
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
  const status = url.searchParams.get("status") ?? "open";
  const accountId = url.searchParams.get("accountId");

  const { createDb } = await import("@/lib/db/client");
  const { organizerTasks } = await import("@/lib/db/schema");
  const db = createDb();

  const conditions = [];
  if (status !== "all") {
    conditions.push(eq(organizerTasks.status, status as "open" | "done" | "dismissed"));
  }
  if (accountId) {
    conditions.push(eq(organizerTasks.accountId, Number(accountId)));
  }

  const tasks = await db
    .select()
    .from(organizerTasks)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(organizerTasks.createdAt))
    .limit(200);

  return NextResponse.json({ tasks: serializeBigints(tasks) });
}

export async function POST(req: Request) {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json(
      { error: "SCOOP_DATABASE_URL required" },
      { status: 503 }
    );
  }
  const body = (await req.json()) as {
    title?: string;
    body?: string;
    accountId?: number;
    dueAt?: string | null;
  };
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const { createDb } = await import("@/lib/db/client");
  const { organizerTasks } = await import("@/lib/db/schema");
  const db = createDb();
  const [task] = await db
    .insert(organizerTasks)
    .values({
      title: body.title.trim(),
      body: body.body ?? "",
      accountId: body.accountId ?? null,
      kind: "manual",
      status: "open",
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
    })
    .returning();
  return NextResponse.json({ task: serializeBigints(task) }, { status: 201 });
}
