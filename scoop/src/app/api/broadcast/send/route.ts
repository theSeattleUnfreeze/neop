import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { sendDrop } from "@/lib/broadcast/broadcastRoute";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({ error: "SCOOP_DATABASE_URL required" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const result = await sendDrop(body);
  if ("error" in result && !("phase" in result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if ("stopped" in result && result.stopped) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result);
}
