import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { watchDrop } from "@/lib/broadcast/broadcastRoute";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const result = await watchDrop(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 503 });
  return NextResponse.json(result);
}
