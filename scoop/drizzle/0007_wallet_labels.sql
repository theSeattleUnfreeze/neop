CREATE TABLE IF NOT EXISTS wallet_labels (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES organizer_accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  label TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_labels_account_ref_uidx
  ON wallet_labels (account_id, kind, ref);
