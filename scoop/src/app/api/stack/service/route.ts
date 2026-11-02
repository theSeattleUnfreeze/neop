import { NextResponse } from "next/server";
import { loadStackConfig, serviceById } from "@/lib/stack/config";
import { controlService, isServiceId } from "@/lib/stack/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (req.headers.get("x-scoop-local") !== "1") {
    return NextResponse.json({ error: "missing local header" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { id?: string; action?: string } | null;
  if (!body?.id || !isServiceId(body.id)) {
    return NextResponse.json({ error: "unknown service" }, { status: 400 });
  }
  if (body.action !== "start" && body.action !== "stop") {
    return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });
  }
  try {
    const message = await controlService(serviceById(loadStackConfig(), body.id), body.action);
    return NextResponse.json({ ok: true, message });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
