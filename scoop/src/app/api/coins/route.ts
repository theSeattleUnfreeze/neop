import { NextResponse } from "next/server";
import { annotate, filterByFlavor } from "@/lib/catalog/presence";
import { detectSpills } from "@/lib/sync/buildRows";

export const runtime = "nodejs";

type AnnotatedRow = ReturnType<typeof annotate>;

/**
 * Filter annotated sync rows for Neapolitan / Flavor / Spills views.
 * Clients POST rows from `/api/sync` (or DB-backed sync).
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    mode?: string;
    rows?: AnnotatedRow[];
  };
  const mode = body.mode ?? "neapolitan";
  let rows = body.rows ?? [];
  if (mode === "core") {
    rows = rows.filter((r) => filterByFlavor(r, "core"));
  } else if (mode === "knots") {
    rows = rows.filter((r) => filterByFlavor(r, "knots"));
  } else if (mode === "spills") {
    rows = detectSpills(rows);
  }
  return NextResponse.json({ mode, rows });
}
