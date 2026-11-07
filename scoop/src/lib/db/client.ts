import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as {
  scoopSql?: Sql;
  scoopSqlUrl?: string;
};

/**
 * One shared postgres.js pool for the Scoop process.
 * createDb used to open a new pool per request; with wallet watch polling that
 * exhausted Postgres ("too many clients already") and hung the wallets page.
 */
function sharedSql(url: string): Sql {
  if (globalForDb.scoopSql && globalForDb.scoopSqlUrl === url) {
    return globalForDb.scoopSql;
  }
  if (globalForDb.scoopSql) {
    void globalForDb.scoopSql.end({ timeout: 1 }).catch(() => undefined);
  }
  const client = postgres(url, {
    max: 8,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  });
  globalForDb.scoopSql = client;
  globalForDb.scoopSqlUrl = url;
  return client;
}

export function createDb(url = process.env.SCOOP_DATABASE_URL) {
  if (!url) {
    throw new Error("SCOOP_DATABASE_URL is required");
  }
  return drizzle(sharedSql(url), { schema });
}

export type ScoopDb = ReturnType<typeof createDb>;
