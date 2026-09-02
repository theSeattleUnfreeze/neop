-- Scoop organizer: accounts, tasks, replay notifications, tip-state deltas
CREATE TYPE scoop_organizer_source AS ENUM ('manual', 'electrum');
CREATE TYPE scoop_task_kind AS ENUM (
  'manual',
  'auto_both',
  'auto_spill',
  'auto_core_bound',
  'auto_replay_receive'
);
CREATE TYPE scoop_task_status AS ENUM ('open', 'done', 'dismissed');
CREATE TYPE scoop_notification_kind AS ENUM ('replay_receive');
CREATE TYPE scoop_tip_state_status AS ENUM ('unspent', 'spent', 'absent');

CREATE TABLE organizer_accounts (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  reminder TEXT NOT NULL DEFAULT '',
  source scoop_organizer_source NOT NULL DEFAULT 'manual',
  watch_account_id INTEGER REFERENCES watched_accounts(id) ON DELETE SET NULL,
  manual_core_sats BIGINT,
  manual_knots_sats BIGINT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organizer_tasks (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES organizer_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kind scoop_task_kind NOT NULL DEFAULT 'manual',
  status scoop_task_status NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ,
  dedupe_key TEXT,
  script_id INTEGER REFERENCES watched_scripts(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX organizer_tasks_dedupe_uidx ON organizer_tasks (dedupe_key);

CREATE TABLE organizer_notifications (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES organizer_accounts(id) ON DELETE CASCADE,
  script_id INTEGER REFERENCES watched_scripts(id) ON DELETE SET NULL,
  kind scoop_notification_kind NOT NULL DEFAULT 'replay_receive',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  outpoint_txid TEXT NOT NULL,
  outpoint_vout INTEGER NOT NULL,
  value_sats BIGINT,
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX organizer_notifications_dedupe_uidx ON organizer_notifications (dedupe_key);

CREATE TABLE script_tip_state (
  id SERIAL PRIMARY KEY,
  script_id INTEGER NOT NULL REFERENCES watched_scripts(id) ON DELETE CASCADE,
  tip scoop_tip NOT NULL,
  outpoint_txid TEXT NOT NULL,
  outpoint_vout INTEGER NOT NULL,
  status scoop_tip_state_status NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX script_tip_state_outpoint_uidx
  ON script_tip_state (script_id, tip, outpoint_txid, outpoint_vout);
