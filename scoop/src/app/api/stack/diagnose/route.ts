import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { loadStackConfig } from "@/lib/stack/config";
import { discoverStackPaths } from "@/lib/stack/discover";
import { diagnoseStack } from "@/lib/stack/diagnose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  try {
    const config = await discoverStackPaths(loadStackConfig());
    const diagnoses = await diagnoseStack(config.services);
    return NextResponse.json({ platform: diagnoses[0]?.platform ?? process.platform, diagnoses });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
