import {
  bigint,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const tipEnum = pgEnum("scoop_tip", ["core", "knots"]);
export const utxoStatusEnum = pgEnum("scoop_utxo_status", ["unspent", "spent"]);
export const tipStateStatusEnum = pgEnum("scoop_tip_state_status", [
  "unspent",
  "spent",
  "absent",
]);
export const organizerSourceEnum = pgEnum("scoop_organizer_source", [
  "manual",
  "electrum",
]);
export const taskKindEnum = pgEnum("scoop_task_kind", [
  "manual",
  "auto_both",
  "auto_spill",
  "auto_core_bound",
  "auto_replay_receive",
]);
export const taskStatusEnum = pgEnum("scoop_task_status", [
  "open",
  "done",
  "dismissed",
]);
export const notificationKindEnum = pgEnum("scoop_notification_kind", [
  "replay_receive",
]);

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
    /** hashed | published | unknown. Set on sync. Not replay risk. */
    witnessState: text("witness_state"),
    /** Most recent Electrum history tx that is not a live funding (pubkey exposure). */
    witnessExposedTxid: text("witness_exposed_txid"),
    /** Tip that saw that exposure: core | knots. */
    witnessExposedTip: text("witness_exposed_tip"),
    witnessExposedHeight: integer("witness_exposed_height"),
    witnessExposedAt: timestamp("witness_exposed_at", { withTimezone: true }),
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

export const spendEvents = pgTable(
  "spend_events",
  {
    id: serial("id").primaryKey(),
    scriptId: integer("script_id")
      .notNull()
      .references(() => watchedScripts.id, { onDelete: "cascade" }),
    tip: tipEnum("tip").notNull(),
    txid: text("txid").notNull(),
    prevTxid: text("prev_txid").notNull(),
    prevVout: integer("prev_vout").notNull(),
    /** Parent output value, when the funding output was decoded or already stored. */
    valueSats: bigint("value_sats", { mode: "bigint" }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("spend_events_prev_uidx").on(t.scriptId, t.tip, t.prevTxid, t.prevVout),
  ]
);

/** Outputs of a recorded spend. One hop from the parent outpoint on that tip. */
export const spendOutputs = pgTable(
  "spend_outputs",
  {
    id: serial("id").primaryKey(),
    spendEventId: integer("spend_event_id")
      .notNull()
      .references(() => spendEvents.id, { onDelete: "cascade" }),
    vout: integer("vout").notNull(),
    valueSats: bigint("value_sats", { mode: "bigint" }).notNull(),
    address: text("address"),
    scriptLabel: text("script_label").notNull(),
  },
  (t) => [uniqueIndex("spend_outputs_event_vout_uidx").on(t.spendEventId, t.vout)]
);

export const syncState = pgTable("sync_state", {
  id: serial("id").primaryKey(),
  tip: tipEnum("tip").notNull().unique(),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

/** User-facing wallet / location on the Scoop dashboard. */
export const organizerAccounts = pgTable("organizer_accounts", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().default(""),
  notes: text("notes").notNull().default(""),
  reminder: text("reminder").notNull().default(""),
  source: organizerSourceEnum("source").notNull().default("manual"),
  watchAccountId: integer("watch_account_id").references(() => watchedAccounts.id, {
    onDelete: "set null",
  }),
  manualCoreSats: bigint("manual_core_sats", { mode: "bigint" }),
  manualKnotsSats: bigint("manual_knots_sats", { mode: "bigint" }),
  sortOrder: integer("sort_order").notNull().default(0),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizerTasks = pgTable(
  "organizer_tasks",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => organizerAccounts.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    kind: taskKindEnum("kind").notNull().default("manual"),
    status: taskStatusEnum("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key"),
    scriptId: integer("script_id").references(() => watchedScripts.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("organizer_tasks_dedupe_uidx").on(t.dedupeKey)]
);

export const organizerNotifications = pgTable(
  "organizer_notifications",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => organizerAccounts.id, {
      onDelete: "cascade",
    }),
    scriptId: integer("script_id").references(() => watchedScripts.id, {
      onDelete: "set null",
    }),
    kind: notificationKindEnum("kind").notNull().default("replay_receive"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    outpointTxid: text("outpoint_txid").notNull(),
    outpointVout: integer("outpoint_vout").notNull(),
    valueSats: bigint("value_sats", { mode: "bigint" }),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organizer_notifications_dedupe_uidx").on(t.dedupeKey)]
);

/** Prior tip outpoints for delta-based replay-receive detection. */
export const scriptTipState = pgTable(
  "script_tip_state",
  {
    id: serial("id").primaryKey(),
    scriptId: integer("script_id")
      .notNull()
      .references(() => watchedScripts.id, { onDelete: "cascade" }),
    tip: tipEnum("tip").notNull(),
    outpointTxid: text("outpoint_txid").notNull(),
    outpointVout: integer("outpoint_vout").notNull(),
    status: tipStateStatusEnum("status").notNull(),
    valueSats: bigint("value_sats", { mode: "bigint" }),
    /** Confirming block height from Electrum (0 = mempool). */
    confirmedHeight: integer("confirmed_height"),
    /** Wall time of that block header, when Scoop resolved it. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("script_tip_state_outpoint_uidx").on(
      t.scriptId,
      t.tip,
      t.outpointTxid,
      t.outpointVout
    ),
  ]
);

/** BIP-329 notes for one wallet. Refs are txids, outpoints, or addresses. Never an xpub. */
export const walletLabels = pgTable(
  "wallet_labels",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => organizerAccounts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    ref: text("ref").notNull(),
    label: text("label").notNull(),
  },
  (t) => [uniqueIndex("wallet_labels_account_ref_uidx").on(t.accountId, t.kind, t.ref)]
);
