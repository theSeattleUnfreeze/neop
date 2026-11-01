import { NextResponse } from "next/server";
import { serializeBigints, parseSatsInput } from "@/lib/catalog/balances";

export const runtime = "nodejs";

function requireDb() {
  if (!process.env.SCOOP_DATABASE_URL) {
    return NextResponse.json(
      { error: "SCOOP_DATABASE_URL required for organizer wallets" },
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
  /** When creating electrum-linked: also register watch addresses */
  scripts?: { scripthash?: string; address?: string; path?: string; scriptPubKeyHex?: string }[];
  watchKey?: string;
  /** Wallet-level xpub/ypub/zpub from Sparrow — expands to addresses */
  xpub?: string;
  /** Override derivation path (e.g. m/84'/0'/0') to force address type */
  derivationPath?: string;
  /** Receive addresses to watch (default 50) */
  gapLimit?: number;
  includeChange?: boolean;
  /** Probe common script types on Electrum (default: true for bare xpub) */
  discover?: boolean;
  /** Validate + probe without inserting */
  preview?: boolean;
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
  const { resolveWatch } = await import("@/lib/electrum/address");
  const { clampGapLimit, DEFAULT_GAP_LIMIT } = await import("@/lib/electrum/gap");
  const db = createDb();
  const gapLimit = clampGapLimit(body.gapLimit ?? DEFAULT_GAP_LIMIT);

  let watchAccountId = body.watchAccountId ?? null;
  let discoveryMeta: unknown = null;

  if (source === "electrum" && !watchAccountId && body.xpub?.trim()) {
    const { expandAccountXpub } = await import("@/lib/electrum/xpub");
    const { discoverXpubScriptKind } = await import("@/lib/electrum/discoverXpub");
    const { envElectrumUrls } = await import("@/lib/sync/fetchTip");
    const urls = envElectrumUrls();
    const xpub = body.xpub.trim();
    const wantDiscover =
      body.discover === true ||
      (body.discover !== false &&
        !body.derivationPath &&
        (xpub.startsWith("xpub") || xpub.startsWith("tpub")));

    let scriptKind: import("@/lib/electrum/xpub").ScriptKind | undefined;
    let accountPath = body.derivationPath?.trim() || undefined;
    if (wantDiscover) {
      try {
        const found = await discoverXpubScriptKind({
          extendedKey: xpub,
          fulcrumUrl: urls.fulcrum,
          shulcrumUrl: urls.shulcrum,
          probe: Math.min(gapLimit, 10),
        });
        scriptKind = found.scriptKind;
        accountPath = accountPath || found.accountPath;
        discoveryMeta = {
          discovered: found.discovered,
          scriptKind: found.scriptKind,
          accountPath: found.accountPath,
          hits: found.hits,
        };
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "invalid xpub" },
          { status: 400 }
        );
      }
    }

    let expanded;
    try {
      expanded = expandAccountXpub({
        extendedKey: xpub,
        accountPath,
        scriptKind,
        gapLimit,
        includeChange: body.includeChange === true,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "invalid xpub" },
        { status: 400 }
      );
    }

    if (body.preview) {
      const { probeWatchUsage } = await import("@/lib/electrum/discoverXpub");
      const usage = await probeWatchUsage(expanded.scripts, [urls.fulcrum, urls.shulcrum].filter(Boolean) as string[]);
      return NextResponse.json({
        preview: true,
        gapLimit,
        scriptKind: expanded.scriptKind,
        accountPath: expanded.accountPath,
        addressCount: expanded.scripts.length,
        sampleAddress: expanded.scripts[0]?.address ?? null,
        used: usage.used,
        reachable: usage.reachable,
        emptyWatch: usage.reachable && !usage.used,
      });
    }

    const [watch] = await db
      .insert(watchedAccounts)
      .values({
        label,
        watchKey: expanded.watchKey,
        kind: "xpub",
        derivationHint: expanded.accountPath,
        gapLimit,
      })
      .returning();
    await db.insert(watchedScripts).values(
      expanded.scripts.map((s) => ({
        accountId: watch.id,
        address: s.address,
        electrumScripthash: s.scripthash,
        scriptPubKeyHex: s.scriptPubKeyHex,
        path: s.path,
      }))
    );
    watchAccountId = watch.id;
  } else if (source === "electrum" && !watchAccountId && !body.scripts?.length) {
    return NextResponse.json(
      { error: "electrum wallet requires an xpub or at least one address" },
      { status: 400 }
    );
  } else if (source === "electrum" && !watchAccountId && body.scripts?.length) {
    let scripts;
    try {
      scripts = body.scripts.map((s) => {
        const resolved = resolveWatch({ scripthash: s.scripthash, address: s.address });
        return {
          ...s,
          scripthash: resolved.scripthash,
          address: resolved.address ?? s.address,
          scriptPubKeyHex: s.scriptPubKeyHex ?? resolved.scriptPubKeyHex,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (body.preview) {
      return NextResponse.json({
        preview: true,
        emptyWatch: false,
        address: scripts[0]?.address ?? null,
      });
    }
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
        scriptPubKeyHex: s.scriptPubKeyHex,
        path: s.path,
      }))
    );
    watchAccountId = watch.id;
  }

  let manualCoreSats: bigint | null = null;
  let manualKnotsSats: bigint | null = null;
  try {
    manualCoreSats = parseSatsInput(body.manualCoreSats);
    manualKnotsSats = parseSatsInput(body.manualKnotsSats);
  } catch {
    return NextResponse.json({ error: "invalid manual sats value" }, { status: 400 });
  }

  const [account] = await db
    .insert(organizerAccounts)
    .values({
      label,
      notes: body.notes ?? "",
      reminder: body.reminder ?? "",
      source,
      watchAccountId,
      manualCoreSats,
      manualKnotsSats,
      sortOrder: body.sortOrder ?? 0,
      updatedAt: new Date(),
    })
    .returning();

  let sync: unknown = null;
  if (source === "electrum" && account.watchAccountId) {
    try {
      const { syncOrganizerWallet } = await import("@/lib/organizer/syncWallet");
      const result = await syncOrganizerWallet(db, account.id);
      if (!("error" in result)) sync = serializeBigints(result);
    } catch (e) {
      sync = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(
    { account: serializeBigints(account), discovery: discoveryMeta, sync },
    { status: 201 }
  );
}
