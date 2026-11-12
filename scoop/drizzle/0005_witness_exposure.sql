ALTER TABLE watched_scripts ADD COLUMN IF NOT EXISTS witness_exposed_txid TEXT;
ALTER TABLE watched_scripts ADD COLUMN IF NOT EXISTS witness_exposed_tip TEXT;
ALTER TABLE watched_scripts ADD COLUMN IF NOT EXISTS witness_exposed_height INTEGER;
ALTER TABLE watched_scripts ADD COLUMN IF NOT EXISTS witness_exposed_at TIMESTAMPTZ;
