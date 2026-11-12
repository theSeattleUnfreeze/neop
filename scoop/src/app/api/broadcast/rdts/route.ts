import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { nodeRpc } from "@/lib/broadcast/nodeRpc";
import { rdtsWarning } from "@/lib/broadcast/pairWave";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  let median: number | null = null;
  try {
    const info = await nodeRpc("knots", "getblockchaininfo");
    if (info && typeof info === "object" && typeof (info as { mediantime?: unknown }).mediantime === "number") {
      median = (info as { mediantime: number }).mediantime;
    }
  } catch {
    median = null;
  }
  return NextResponse.json(rdtsWarning(Date.now(), median));
}
