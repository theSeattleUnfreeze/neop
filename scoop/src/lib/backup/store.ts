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

/** Stay under Postgres' 65535 bind-parameter cap, with room for the statement itself. */
export const MAX_INSERT_BINDS = 60_000;

export function rowChunks<T extends Record<string, unknown>>(rows: T[], maxBinds = MAX_INSERT_BINDS): T[][] {
  if (!rows.length) return [];
  const columns = rows.reduce((count, row) => Math.max(count, Object.keys(row).length), 1);
  const size = Math.max(1, Math.floor(maxBinds / columns));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

export async function exportSnapshot(db: ScoopDb): Promise<ScoopSnapshot> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const tables = emptyTables();
    for (const name of INSERT_ORDER) {
      const rows = await tx.select().from(TABLE[name]);
      tables[name] = rows.map((row) => jsonSafe(row)) as unknown[];
    }
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      tables,
    };
  });
}

async function resetSequences(db: { execute: ScoopDb["execute"] }): Promise<void> {
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
      for (const chunk of rowChunks(rows)) {
        await tx.insert(TABLE[name]).values(chunk as never);
      }
    }
    await resetSequences(tx);
  });
  return { wallets: parsed.tables.organizerAccounts.length };
}
