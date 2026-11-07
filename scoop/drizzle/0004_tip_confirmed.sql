ALTER TABLE script_tip_state ADD COLUMN IF NOT EXISTS confirmed_height INTEGER;
ALTER TABLE script_tip_state ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
