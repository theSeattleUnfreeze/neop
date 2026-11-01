import { NextResponse } from "next/server";
import { normalizeScripthash } from "@/lib/electrum/scripthash";
import { coinRowFromTips } from "@/lib/sync/buildRows";
import { envElectrumUrls, fetchScriptTip } from "@/lib/sync/fetchTip";

export const runtime = "nodejs";

type Body = {
  scripts?: { id?: number; scripthash: string; address?: string }[];
};

/** Pull Fulcrum + Shulcrum state for given scripthashes (or all DB scripts). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const urls = envElectrumUrls();
  const health = {
    fulcrum: Boolean(urls.fulcrum),
    shulcrum: Boolean(urls.shulcrum),
    fulcrumError: urls.fulcrum ? null : "FULCRUM_URL unset",
    shulcrumError: urls.shulcrum ? null : "SHULCRUM_URL unset",
  };

  type ScriptIn = {
    id?: number;
    scripthash: string;
    address?: string;
    accountId?: number;
    watchAccountId?: number;
  };
  let scripts: ScriptIn[] = (body.scripts ?? []) as ScriptIn[];
  if (scripts.length) {
    try {
      scripts = scripts.map((s) => ({
        ...s,
        scripthash: normalizeScripthash(s.scripthash),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }
  if (!scripts.length && process.env.SCOOP_DATABASE_URL) {
    const { createDb } = await import("@/lib/db/client");
    const { watchedScripts } = await import("@/lib/db/schema");
    const db = createDb();
    const dbRows = await db.select().from(watchedScripts);
    scripts = dbRows.map((r) => ({
      id: r.id,
      scripthash: r.electrumScripthash,
      address: r.address ?? undefined,
      accountId: r.accountId,
      watchAccountId: r.accountId,
    }));
  }

  const rows = [];
  for (const s of scripts) {
    const core = urls.fulcrum
      ? await fetchScriptTip("core", urls.fulcrum, s.scripthash)
      : undefined;
    const knots = urls.shulcrum
      ? await fetchScriptTip("knots", urls.shulcrum, s.scripthash)
      : undefined;
    rows.push(
      coinRowFromTips(s.id ?? 0, s.address, core, knots, {
        accountId: s.accountId ?? null,
        watchAccountId: s.watchAccountId ?? s.accountId ?? null,
      })
    );
    if (core && !core.ok) health.fulcrumError = core.error ?? "fulcrum error";
    if (knots && !knots.ok) health.shulcrumError = knots.error ?? "shulcrum error";
  }

  return NextResponse.json({ health, rows });
}
