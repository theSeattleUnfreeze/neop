-- Scoop initial schema
CREATE TYPE scoop_tip AS ENUM ('core', 'knots');
CREATE TYPE scoop_utxo_status AS ENUM ('unspent', 'spent');

CREATE TABLE watched_accounts (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  watch_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'address_list',
  derivation_hint TEXT,
  gap_limit INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE watched_scripts (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES watched_accounts(id) ON DELETE CASCADE,
  address TEXT,
  script_pubkey_hex TEXT,
  electrum_scripthash TEXT NOT NULL,
  path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX watched_scripts_scripthash_uidx ON watched_scripts (electrum_scripthash);

CREATE TABLE utxo_snapshots (
  id SERIAL PRIMARY KEY,
  script_id INTEGER NOT NULL REFERENCES watched_scripts(id) ON DELETE CASCADE,
  tip scoop_tip NOT NULL,
  txid TEXT NOT NULL,
  vout INTEGER NOT NULL,
  value_sats BIGINT NOT NULL,
  status scoop_utxo_status NOT NULL,
  tip_height INTEGER,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX utxo_snapshots_tip_outpoint_uidx ON utxo_snapshots (tip, txid, vout);

CREATE TABLE spend_events (
  id SERIAL PRIMARY KEY,
  script_id INTEGER NOT NULL REFERENCES watched_scripts(id) ON DELETE CASCADE,
  tip scoop_tip NOT NULL,
  txid TEXT NOT NULL,
  prev_txid TEXT NOT NULL,
  prev_vout INTEGER NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sync_state (
  id SERIAL PRIMARY KEY,
  tip scoop_tip NOT NULL UNIQUE,
  last_status TEXT,
  last_error TEXT,
  last_synced_at TIMESTAMPTZ
);
