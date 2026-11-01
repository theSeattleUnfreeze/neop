import { NextResponse } from "next/server";
import { normalizeScripthash } from "@/lib/electrum/scripthash";

export const runtime = "nodejs";

type Body = {
  label?: string;
  /** One or more electrum scripthashes (64 hex) and optional addresses */
  scripts?: { scripthash: string; address?: string; path?: string }[];
  watchKey?: string;
};

/**
 * Register watched scripts. Persistence requires SCOOP_DATABASE_URL;
 * without it, returns validated payload for dry-run.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const scripts = (body.scripts ?? []).map((s) => ({
    ...s,
    scripthash: normalizeScripthash(s.scripthash),
  }));
  if (!scripts.length) {
    return NextResponse.json({ error: "scripts required" }, { status: 400 });
  }

  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json({
      dryRun: true,
      label: body.label ?? "",
      watchKey: body.watchKey ?? scripts.map((s) => s.scripthash).join(","),
      scripts,
      note: "Set SCOOP_DATABASE_URL to persist watched accounts",
    });
  }

  const { createDb } = await import("@/lib/db/client");
  const { watchedAccounts, watchedScripts } = await import("@/lib/db/schema");
  const db = createDb();
  const [account] = await db
    .insert(watchedAccounts)
    .values({
      label: body.label ?? "",
      watchKey: body.watchKey ?? scripts.map((s) => s.scripthash).join(","),
      kind: "address_list",
    })
    .returning();
  const inserted = await db
    .insert(watchedScripts)
    .values(
      scripts.map((s) => ({
        accountId: account.id,
        address: s.address,
        electrumScripthash: s.scripthash,
        path: s.path,
      }))
    )
    .returning();
  return NextResponse.json({ account, scripts: inserted });
}
