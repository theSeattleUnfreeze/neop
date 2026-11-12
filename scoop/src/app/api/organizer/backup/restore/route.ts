import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { BackupCryptoError, decryptBackup, parseEnvelope } from "@/lib/backup/crypto";
import { parseSnapshot } from "@/lib/backup/snapshot";

export const runtime = "nodejs";

const MAX_PASSWORD = 1024;
const MAX_FILE = 20_000_000;

/** Replace the local catalog with a password-encrypted backup file. */
export async function POST(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({ error: "SCOOP_DATABASE_URL required" }, { status: 503 });
  }
  let password: unknown;
  let file: unknown;
  try {
    const body = (await req.json()) as { password?: unknown; file?: unknown };
    password = body.password;
    file = body.file;
  } catch {
    return NextResponse.json({ error: "expected a password and a backup file" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > MAX_PASSWORD) {
    return NextResponse.json(
      { error: "Use the backup password (at least 8 characters)." },
      { status: 400 }
    );
  }
  if (typeof file !== "string" || file.length === 0 || file.length > MAX_FILE) {
    return NextResponse.json({ error: "backup file is missing or too large" }, { status: 400 });
  }

  try {
    const plaintext = await decryptBackup(parseEnvelope(file), password);
    const snapshot = parseSnapshot(JSON.parse(plaintext));
    const { createDb } = await import("@/lib/db/client");
    const { importSnapshot } = await import("@/lib/backup/store");
    const result = await importSnapshot(createDb(), snapshot);
    return NextResponse.json({ ok: true, wallets: result.wallets });
  } catch (err) {
    if (err instanceof BackupCryptoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error && err.message === "unrecognized backup") {
      return NextResponse.json({ error: "unrecognized backup file" }, { status: 400 });
    }
    return NextResponse.json({ error: "restore failed" }, { status: 500 });
  }
}
