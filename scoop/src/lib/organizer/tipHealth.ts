import { eq } from "drizzle-orm";
import type { ScoopDb } from "@/lib/db/client";
import { syncState } from "@/lib/db/schema";

export type TipName = "core" | "knots";

export type TipHealth = {
  tip: TipName;
  ok: boolean;
  error: string | null;
  lastSyncedAt: Date | null;
};

export type TipKnowledge = {
  core: boolean;
  knots: boolean;
  coreError: string | null;
  knotsError: string | null;
};

/** Persist whether the last Electrum sync for this tip answered. */
export async function recordTipSync(
  db: ScoopDb,
  tip: TipName,
  ok: boolean,
  error: string | null = null
): Promise<void> {
  const existing = await db.select().from(syncState).where(eq(syncState.tip, tip)).limit(1);
  const values = {
    tip,
    lastStatus: ok ? "ok" : "error",
    lastError: ok ? null : error || "unreachable",
    lastSyncedAt: new Date(),
  };
  if (existing.length) {
    await db.update(syncState).set(values).where(eq(syncState.tip, tip));
  } else {
    await db.insert(syncState).values(values);
  }
}

export async function loadTipKnowledge(db: ScoopDb): Promise<TipKnowledge> {
  const rows = await db.select().from(syncState);
  const byTip = new Map(rows.map((row) => [row.tip, row]));
  const core = byTip.get("core");
  const knots = byTip.get("knots");
  return {
    core: core?.lastStatus === "ok",
    knots: knots?.lastStatus === "ok",
    coreError: core?.lastStatus === "ok" ? null : (core?.lastError ?? null),
    knotsError: knots?.lastStatus === "ok" ? null : (knots?.lastError ?? null),
  };
}
