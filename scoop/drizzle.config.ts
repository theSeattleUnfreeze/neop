import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.SCOOP_DATABASE_URL ?? "postgres://scoop:scoop@127.0.0.1:5432/scoop",
  },
});
