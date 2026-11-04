-- Whether a watched script's witness has been published by a spend on either tip.
ALTER TABLE watched_scripts ADD COLUMN IF NOT EXISTS witness_state TEXT;
