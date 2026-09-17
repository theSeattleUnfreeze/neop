import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url = process.env.SCOOP_DATABASE_URL) {
  if (!url) {
    throw new Error("SCOOP_DATABASE_URL is required");
  }
  const client = postgres(url, { max: 5 });
  return drizzle(client, { schema });
}

export type ScoopDb = ReturnType<typeof createDb>;
