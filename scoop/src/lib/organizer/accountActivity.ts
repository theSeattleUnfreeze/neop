import { inArray } from "drizzle-orm";
import { activityFromTipStates, type ActivityStamp } from "@/lib/catalog/activity";
import type { ScoopDb } from "@/lib/db/client";
import { scriptTipState, watchedScripts } from "@/lib/db/schema";

export type AccountActivity = {
  accountId: number;
  lastReceived: ActivityStamp;
  lastSent: ActivityStamp;
};

/** Last receive / send from stored tip state for each organizer wallet. */
export async function loadAccountActivity(
  db: ScoopDb,
  accounts: { id: number; watchAccountId: number | null }[]
): Promise<Map<number, AccountActivity>> {
  const watchIds = [
    ...new Set(accounts.map((a) => a.watchAccountId).filter((id): id is number => id != null && id > 0)),
  ];
  const empty = new Map<number, AccountActivity>();
  for (const account of accounts) {
    empty.set(account.id, {
      accountId: account.id,
      lastReceived: { height: null, at: null },
      lastSent: { height: null, at: null },
    });
  }
  if (!watchIds.length) return empty;

  const scripts = await db
    .select({ id: watchedScripts.id, accountId: watchedScripts.accountId })
    .from(watchedScripts)
    .where(inArray(watchedScripts.accountId, watchIds));
  if (!scripts.length) return empty;

  const scriptIds = scripts.map((s) => s.id);
  const tipRows = await db
    .select({
      scriptId: scriptTipState.scriptId,
      status: scriptTipState.status,
      confirmedHeight: scriptTipState.confirmedHeight,
      confirmedAt: scriptTipState.confirmedAt,
    })
    .from(scriptTipState)
    .where(inArray(scriptTipState.scriptId, scriptIds));

  const byWatch = new Map<number, typeof tipRows>();
  const scriptWatch = new Map(scripts.map((s) => [s.id, s.accountId]));
  for (const row of tipRows) {
    const watchId = scriptWatch.get(row.scriptId);
    if (watchId == null) continue;
    const list = byWatch.get(watchId) ?? [];
    list.push(row);
    byWatch.set(watchId, list);
  }

  for (const account of accounts) {
    if (!account.watchAccountId) continue;
    const states = byWatch.get(account.watchAccountId) ?? [];
    const activity = activityFromTipStates(
      states.map((row) => ({
        status: row.status,
        confirmedHeight: row.confirmedHeight,
        confirmedAt: row.confirmedAt,
      }))
    );
    empty.set(account.id, { accountId: account.id, ...activity });
  }
  return empty;
}

export function serializeActivityStamp(stamp: ActivityStamp): {
  height: number | null;
  at: string | null;
} {
  return {
    height: stamp.height,
    at: stamp.at?.toISOString() ?? null,
  };
}
