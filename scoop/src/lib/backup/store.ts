import { sql } from "drizzle-orm";
import type { ScoopDb } from "@/lib/db/client";
import {
  organizerAccounts,
  organizerNotifications,
  organizerTasks,
  scriptTipState,
  spendEvents,
  spendOutputs,
  syncState,
  utxoSnapshots,
  watchedAccounts,
  watchedScripts,
} from "@/lib/db/schema";
import {
  emptyTables,
  jsonRevive,
  jsonSafe,
  parseSnapshot,
  SNAPSHOT_TABLES,
  type ScoopSnapshot,
  type SnapshotTable,
} from "@/lib/backup/snapshot";

const TABLE = {
  watchedAccounts,
  watchedScripts,
  organizerAccounts,
  organizerTasks,
  organizerNotifications,
  scriptTipState,
  utxoSnapshots,
  spendEvents,
  spendOutputs,
  syncState,
} as const;

const INSERT_ORDER: SnapshotTable[] = [...SNAPSHOT_TABLES];

export async function exportSnapshot(db: ScoopDb): Promise<ScoopSnapshot> {
  const tables = emptyTables();
  for (const name of INSERT_ORDER) {
    const rows = await db.select().from(TABLE[name]);
    tables[name] = rows.map((row) => jsonSafe(row)) as unknown[];
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

async function resetSequences(db: ScoopDb): Promise<void> {
  const names = [
    "watched_accounts",
    "watched_scripts",
    "organizer_accounts",
    "organizer_tasks",
    "organizer_notifications",
    "script_tip_state",
    "utxo_snapshots",
    "spend_events",
    "spend_outputs",
    "sync_state",
  ];
  for (const name of names) {
    await db.execute(sql.raw(
      `SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM ${name}), 1), (SELECT COUNT(*) > 0 FROM ${name}))`
    ));
  }
}

/** Replace the local catalog with a snapshot. Rolls back if any insert fails. */
export async function importSnapshot(db: ScoopDb, snapshot: ScoopSnapshot): Promise<{ wallets: number }> {
  const parsed = parseSnapshot(snapshot);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      TRUNCATE TABLE
        spend_outputs,
        spend_events,
        utxo_snapshots,
        script_tip_state,
        organizer_notifications,
        organizer_tasks,
        organizer_accounts,
        watched_scripts,
        watched_accounts,
        sync_state
      RESTART IDENTITY CASCADE
    `);
    for (const name of INSERT_ORDER) {
      const rows = (jsonRevive(parsed.tables[name]) as Record<string, unknown>[]).filter(
        (row) => row && typeof row === "object"
      );
      if (!rows.length) continue;
      await tx.insert(TABLE[name]).values(rows as never);
    }
  });
  await resetSequences(db);
  return { wallets: parsed.tables.organizerAccounts.length };
}
