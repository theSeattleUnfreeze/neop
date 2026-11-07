ALTER TABLE spend_events ADD COLUMN IF NOT EXISTS value_sats BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS spend_events_prev_uidx
  ON spend_events (script_id, tip, prev_txid, prev_vout);

CREATE TABLE IF NOT EXISTS spend_outputs (
  id SERIAL PRIMARY KEY,
  spend_event_id INTEGER NOT NULL REFERENCES spend_events(id) ON DELETE CASCADE,
  vout INTEGER NOT NULL,
  value_sats BIGINT NOT NULL,
  address TEXT,
  script_label TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS spend_outputs_event_vout_uidx
  ON spend_outputs (spend_event_id, vout);
