-- =====================================================================
-- Demo-data helpers (used only by the 0008+ demo seed files).
--
-- seed_post_je: insert a balanced, POSTED journal entry from a JSON array of
-- legs ([{code, debit, credit}, ...]) and return its id. Looks up the fiscal
-- period that contains p_date, and attributes the entry to the seed admin user.
-- Legs reference chart_of_accounts by code within the same business.
-- =====================================================================
CREATE OR REPLACE FUNCTION seed_post_je(
  p_biz uuid,
  p_date date,
  p_memo text,
  p_source_type journal_entry_source_type,
  p_source_id uuid,
  p_legs jsonb
) RETURNS uuid AS $$
DECLARE
  v_period uuid;
  v_je uuid;
  v_user uuid;
  v_leg jsonb;
  v_acct uuid;
  v_line int := 1;
BEGIN
  SELECT id INTO v_period FROM fiscal_periods
   WHERE business_id = p_biz AND starts_on <= p_date AND ends_on >= p_date
   ORDER BY starts_on LIMIT 1;
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'seed_post_je: no fiscal period for business % on %', p_biz, p_date;
  END IF;

  SELECT id INTO v_user FROM users WHERE email = 'admin@example.com' LIMIT 1;

  INSERT INTO journal_entries (
    business_id, period_id, entry_date, memo, status, source_type, source_id,
    posted_at, posted_by_user_id, created_by_user_id
  ) VALUES (
    p_biz, v_period, p_date, p_memo, 'posted', p_source_type, p_source_id,
    now(), v_user, v_user
  ) RETURNING id INTO v_je;

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    SELECT id INTO v_acct FROM chart_of_accounts
     WHERE business_id = p_biz AND code = (v_leg->>'code');
    IF v_acct IS NULL THEN
      RAISE EXCEPTION 'seed_post_je: no account % for business %', v_leg->>'code', p_biz;
    END IF;
    INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, debit, credit)
    VALUES (
      v_je, v_line, v_acct,
      COALESCE((v_leg->>'debit')::numeric, 0),
      COALESCE((v_leg->>'credit')::numeric, 0)
    );
    v_line := v_line + 1;
  END LOOP;

  RETURN v_je;
END;
$$ LANGUAGE plpgsql;
