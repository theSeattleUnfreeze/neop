import { NextResponse } from "next/server";
import { serializeBigints } from "@/lib/catalog/balances";

export const runtime = "nodejs";

function requireDb() {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json(
      { error: "SCOOP_DATABASE_URL required for organizer accounts" },
      { status: 503 }
    );
  }
  return null;
}

export async function GET() {
  const err = requireDb();
  if (err) return err;
  const { createDb } = await import("@/lib/db/client");
  const { organizerAccounts } = await import("@/lib/db/schema");
  const db = createDb();
  const rows = await db.select().from(organizerAccounts).orderBy(organizerAccounts.sortOrder);
  return NextResponse.json({ accounts: serializeBigints(rows) });
}

type CreateBody = {
  label?: string;
  notes?: string;
  reminder?: string;
  source?: "manual" | "electrum";
  watchAccountId?: number | null;
  manualCoreSats?: string | number | null;
  manualKnotsSats?: string | number | null;
  sortOrder?: number;
  /** When creating electrum-linked: also register watch scripts */
  scripts?: { scripthash: string; address?: string; path?: string }[];
  watchKey?: string;
};

export async function POST(req: Request) {
  const err = requireDb();
  if (err) return err;
  const body = (await req.json()) as CreateBody;
  const label = (body.label ?? "").trim() || "Untitled wallet";
  const source = body.source === "electrum" ? "electrum" : "manual";

  const { createDb } = await import("@/lib/db/client");
  const { organizerAccounts, watchedAccounts, watchedScripts } = await import(
    "@/lib/db/schema"
  );
  const { normalizeScripthash } = await import("@/lib/electrum/scripthash");
  const db = createDb();

  let watchAccountId = body.watchAccountId ?? null;
  if (source === "electrum" && !watchAccountId && body.scripts?.length) {
    const scripts = body.scripts.map((s) => ({
      ...s,
      scripthash: normalizeScripthash(s.scripthash),
    }));
    const [watch] = await db
      .insert(watchedAccounts)
      .values({
        label,
        watchKey: body.watchKey ?? scripts.map((s) => s.scripthash).join(","),
        kind: "address_list",
      })
      .returning();
    await db.insert(watchedScripts).values(
      scripts.map((s) => ({
        accountId: watch.id,
        address: s.address,
        electrumScripthash: s.scripthash,
        path: s.path,
      }))
    );
    watchAccountId = watch.id;
  }

  const [account] = await db
    .insert(organizerAccounts)
    .values({
      label,
      notes: body.notes ?? "",
      reminder: body.reminder ?? "",
      source,
      watchAccountId,
      manualCoreSats:
        body.manualCoreSats != null && body.manualCoreSats !== ""
          ? BigInt(body.manualCoreSats)
          : null,
      manualKnotsSats:
        body.manualKnotsSats != null && body.manualKnotsSats !== ""
          ? BigInt(body.manualKnotsSats)
          : null,
      sortOrder: body.sortOrder ?? 0,
      updatedAt: new Date(),
    })
    .returning();

  return NextResponse.json({ account: serializeBigints(account) }, { status: 201 });
}
