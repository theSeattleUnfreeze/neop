import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { loadStackConfig } from "@/lib/stack/config";
import { discoverStackPaths } from "@/lib/stack/discover";
import { revealInExplorer } from "@/lib/stack/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  if (!body?.path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  try {
    await revealInExplorer(await discoverStackPaths(loadStackConfig()), body.path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
