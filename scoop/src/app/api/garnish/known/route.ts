import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { addressCoverage } from "@/lib/broadcast/catalogNeed";

export const runtime = "nodejs";

/** How many dropped inputs Scoop already watches. Addresses are not echoed back. */
export async function POST(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({ error: "SCOOP_DATABASE_URL required" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { addresses?: unknown } | null;
  const addresses = Array.isArray(body?.addresses)
    ? body.addresses.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length < 120)
    : [];
  try {
    const coverage = await addressCoverage(addresses);
    return NextResponse.json(coverage);
  } catch {
    return NextResponse.json({ error: "Scoop could not read the catalog." }, { status: 503 });
  }
}
