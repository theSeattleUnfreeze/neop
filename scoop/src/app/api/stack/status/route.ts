import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { loadStackConfig } from "@/lib/stack/config";
import { probeStack } from "@/lib/stack/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  try {
    const config = loadStackConfig();
    const status = await probeStack(config);
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
