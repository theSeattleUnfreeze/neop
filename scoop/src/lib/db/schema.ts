import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const tipEnum = pgEnum("scoop_tip", ["core", "knots"]);
export const utxoStatusEnum = pgEnum("scoop_utxo_status", ["unspent", "spent"]);

export const watchedAccounts = pgTable("watched_accounts", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().default(""),
  /** xpub, descriptor, or opaque watch id — never a private key */
  watchKey: text("watch_key").notNull(),
  kind: text("kind").notNull().default("address_list"),
  derivationHint: text("derivation_hint"),
  gapLimit: integer("gap_limit").notNull().default(20),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watchedScripts = pgTable(
  "watched_scripts",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => watchedAccounts.id, { onDelete: "cascade" }),
    address: text("address"),
    scriptPubKeyHex: text("script_pubkey_hex"),
    electrumScripthash: text("electrum_scripthash").notNull(),
    path: text("path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watched_scripts_scripthash_uidx").on(t.electrumScripthash)]
);

export const utxoSnapshots = pgTable(
  "utxo_snapshots",
  {
    id: serial("id").primaryKey(),
    scriptId: integer("script_id")
      .notNull()
      .references(() => watchedScripts.id, { onDelete: "cascade" }),
    tip: tipEnum("tip").notNull(),
    txid: text("txid").notNull(),
    vout: integer("vout").notNull(),
    valueSats: bigint("value_sats", { mode: "bigint" }).notNull(),
    status: utxoStatusEnum("status").notNull(),
    tipHeight: integer("tip_height"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("utxo_snapshots_tip_outpoint_uidx").on(t.tip, t.txid, t.vout)]
);

export const spendEvents = pgTable("spend_events", {
  id: serial("id").primaryKey(),
  scriptId: integer("script_id")
    .notNull()
    .references(() => watchedScripts.id, { onDelete: "cascade" }),
  tip: tipEnum("tip").notNull(),
  txid: text("txid").notNull(),
  prevTxid: text("prev_txid").notNull(),
  prevVout: integer("prev_vout").notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncState = pgTable("sync_state", {
  id: serial("id").primaryKey(),
  tip: tipEnum("tip").notNull().unique(),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});
