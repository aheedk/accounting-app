DO $$
DECLARE
  r record;
  v_year int := EXTRACT(year FROM CURRENT_DATE)::int;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    PERFORM seed_default_coa(r.id);
    PERFORM seed_calendar_year_periods(r.id, v_year);
  END LOOP;
END $$;
