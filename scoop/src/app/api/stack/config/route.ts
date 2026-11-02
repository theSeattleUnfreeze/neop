import { NextResponse } from "next/server";
import { loadStackConfig, normalizeStackConfig, saveStackConfig } from "@/lib/stack/config";
import type { StackConfig } from "@/lib/stack/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localOnly(req: Request): NextResponse | null {
  if (req.headers.get("x-scoop-local") !== "1") {
    return NextResponse.json({ error: "missing local header" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    return NextResponse.json({ config: loadStackConfig() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as StackConfig;
    const config = normalizeStackConfig(body);
    saveStackConfig(config);
    return NextResponse.json({ config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
