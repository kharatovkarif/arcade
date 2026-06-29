-- Apply via Supabase Dashboard → SQL Editor
-- Adds tier subscription columns and atomic purchase function

ALTER TABLE users ADD COLUMN IF NOT EXISTS tier text DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier_bonus_date date;

CREATE OR REPLACE FUNCTION try_buy_tier(p_tg_id bigint, p_price numeric, p_tier text, p_days int)
RETURNS timestamptz AS $$
DECLARE
  v_balance numeric;
  v_until   timestamptz;
BEGIN
  SELECT balance_ton INTO v_balance FROM users WHERE tg_id = p_tg_id FOR UPDATE;
  IF v_balance < p_price THEN RETURN NULL; END IF;
  v_until := now() + (p_days || ' days')::interval;
  UPDATE users SET
    balance_ton = balance_ton - p_price,
    tier        = p_tier,
    tier_until  = v_until
  WHERE tg_id = p_tg_id;
  RETURN v_until;
END;
$$ LANGUAGE plpgsql;
