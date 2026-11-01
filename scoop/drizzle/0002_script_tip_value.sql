-- Persist satoshi values on tip-state rows for post-sync dashboard balances.
ALTER TABLE script_tip_state ADD COLUMN IF NOT EXISTS value_sats BIGINT;
