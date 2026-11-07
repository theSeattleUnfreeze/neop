import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { previewDrop, readDroppedFiles } from "@/lib/broadcast/broadcastRoute";

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
  const preview = await previewDrop(files);
  if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: 503 });
  return NextResponse.json(preview);
}
