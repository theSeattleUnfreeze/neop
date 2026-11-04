import { NextResponse } from "next/server";

/** Scoop v1 has no auth; localhost UI sends this header on sensitive routes. */
export function localOnly(req: Request): NextResponse | null {
  if (req.headers.get("x-scoop-local") !== "1") {
    return NextResponse.json({ error: "missing local header" }, { status: 403 });
  }
  return null;
}
