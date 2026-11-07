/** JSON-safe catalog snapshot. Dates and sats stay tagged so a restore can rebuild them. */

export const SNAPSHOT_TABLES = [
  "watchedAccounts",
  "watchedScripts",
  "organizerAccounts",
  "organizerTasks",
  "organizerNotifications",
  "scriptTipState",
  "utxoSnapshots",
  "spendEvents",
  "spendOutputs",
  "syncState",
] as const;

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

export type ScoopSnapshot = {
  version: 1;
  exportedAt: string;
  tables: Record<SnapshotTable, unknown[]>;
};

export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = jsonSafe(inner);
    return out;
  }
  return value;
}

export function jsonRevive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonRevive);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (keys.length === 1 && keys[0] === "$bigint" && typeof rec.$bigint === "string") {
      return BigInt(rec.$bigint);
    }
    if (keys.length === 1 && keys[0] === "$date" && typeof rec.$date === "string") {
      return new Date(rec.$date);
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(rec)) out[key] = jsonRevive(inner);
    return out;
  }
  return value;
}

export function emptyTables(): Record<SnapshotTable, unknown[]> {
  return {
    watchedAccounts: [],
    watchedScripts: [],
    organizerAccounts: [],
    organizerTasks: [],
    organizerNotifications: [],
    scriptTipState: [],
    utxoSnapshots: [],
    spendEvents: [],
    spendOutputs: [],
    syncState: [],
  };
}

export function parseSnapshot(raw: unknown): ScoopSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("unrecognized backup");
  const rec = raw as Record<string, unknown>;
  if (rec.version !== 1 || typeof rec.exportedAt !== "string" || !rec.tables || typeof rec.tables !== "object") {
    throw new Error("unrecognized backup");
  }
  const tables = emptyTables();
  const incoming = rec.tables as Record<string, unknown>;
  for (const name of SNAPSHOT_TABLES) {
    const rows = incoming[name];
    if (!Array.isArray(rows)) throw new Error("unrecognized backup");
    tables[name] = rows;
  }
  return { version: 1, exportedAt: rec.exportedAt, tables };
}
