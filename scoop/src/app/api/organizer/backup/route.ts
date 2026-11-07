import { NextResponse } from "next/server";
import { localOnly } from "@/lib/api/localOnly";
import { BackupCryptoError, encryptBackup } from "@/lib/backup/crypto";

export const runtime = "nodejs";

const MAX_PASSWORD = 1024;

/** Download the catalog as a password-encrypted file. The password is not stored. */
export async function POST(req: Request) {
  const denied = localOnly(req);
  if (denied) return denied;
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({ error: "SCOOP_DATABASE_URL required" }, { status: 503 });
  }
  let password: unknown;
  try {
    const body = (await req.json()) as { password?: unknown };
    password = body.password;
  } catch {
    return NextResponse.json({ error: "expected a password" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > MAX_PASSWORD) {
    return NextResponse.json(
      { error: "Use a backup password of at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    const { createDb } = await import("@/lib/db/client");
    const { exportSnapshot } = await import("@/lib/backup/store");
    const snapshot = await exportSnapshot(createDb());
    const envelope = await encryptBackup(JSON.stringify(snapshot), password);
    const day = snapshot.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(envelope), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="scoop-backup-${day}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof BackupCryptoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "backup failed" }, { status: 500 });
  }
}
