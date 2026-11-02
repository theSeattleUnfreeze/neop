import { NextResponse } from "next/server";
import { inspectSparrowWallet } from "@/lib/sparrow/parseWallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  let body: { fileBase64?: string; password?: string };
  try {
    body = (await req.json()) as { fileBase64?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400 });
  }
  if (!body.fileBase64 || typeof body.fileBase64 !== "string") {
    return NextResponse.json({ error: "fileBase64 is required" }, { status: 400 });
  }
  const bytes = Buffer.from(body.fileBase64, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "wallet file is empty or larger than 8MB" }, { status: 400 });
  }
  try {
    const view = await inspectSparrowWallet(bytes, typeof body.password === "string" ? body.password : undefined);
    return NextResponse.json(view);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
