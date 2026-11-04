import { NextResponse } from "next/server";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Host the browser used, without the port. Fetch hides Host, so fall back to the URL. */
export function requestHost(req: Request): string {
  const header = req.headers.get("host");
  const raw = (header && header.length > 0 ? header : new URL(req.url).host).trim().toLowerCase();
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 1 ? raw.slice(1, end) : "";
  }
  return raw.replace(/:\d+$/, "");
}

/**
 * Scoop v1 has no auth. The UI sends the header, and the Host must be loopback
 * so a DNS-rebound page cannot call these routes.
 */
export function localOnly(req: Request): NextResponse | null {
  if (req.headers.get("x-scoop-local") !== "1") {
    return NextResponse.json({ error: "missing local header" }, { status: 403 });
  }
  if (!LOOPBACK_HOSTS.has(requestHost(req))) {
    return NextResponse.json({ error: "scoop is local only" }, { status: 403 });
  }
  return null;
}
