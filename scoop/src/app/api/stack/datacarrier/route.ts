import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { datacarrierAssist } from "@/lib/stack/datacarrier";
import { loadStackConfig, serviceById } from "@/lib/stack/config";
import { discoverStackPaths } from "@/lib/stack/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  try {
    const core = serviceById(await discoverStackPaths(loadStackConfig()), "core-node");
    return NextResponse.json(
      datacarrierAssist({
        platform: process.platform,
        binary: core.binary,
        datadir: core.datadir,
        configFile: core.configFile,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read the stack file.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
