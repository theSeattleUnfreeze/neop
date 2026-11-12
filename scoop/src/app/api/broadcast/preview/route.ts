import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { previewDrop, readDroppedFiles } from "@/lib/broadcast/broadcastRoute";
import { parseSplitMethod } from "@/lib/split/method";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({ error: "SCOOP_DATABASE_URL required" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const files = readDroppedFiles(body);
  if ("error" in files) return NextResponse.json({ error: files.error }, { status: 400 });
  const method = body && typeof body === "object" && "method" in body ? parseSplitMethod((body as { method?: unknown }).method) : null;
  if (method && typeof method === "object") return NextResponse.json({ error: method.error }, { status: 400 });
  const queueRaw = body && typeof body === "object" ? (body as { queue?: unknown }).queue : undefined;
  const queue = Array.isArray(queueRaw) ? queueRaw.filter((item): item is string => typeof item === "string") : null;
  const preview = await previewDrop(files, { method, queue });
  if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: 503 });
  return NextResponse.json(preview);
}
