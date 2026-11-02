import { NextResponse } from "next/server";
import { loadStackConfig } from "@/lib/stack/config";
import { revealInExplorer } from "@/lib/stack/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (req.headers.get("x-scoop-local") !== "1") {
    return NextResponse.json({ error: "missing local header" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  if (!body?.path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  try {
    await revealInExplorer(loadStackConfig(), body.path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
