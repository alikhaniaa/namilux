-- 0002_invoice_counter - nl_next_invoice_no(year): the gapless per-Jalali-year invoice counter as a
-- SECURITY DEFINER function (the spec grant matrix).
--   [M8] MANUAL: the counter row lives in `settings` (key invoice.seq.<year>), which nl_web may only read;
--   the paid transition is reached from the gateway callback under nl_web, so the allocation runs here
--   as the table owner. A transaction-scoped advisory lock on the key serialises callers (SELECT … FOR
--   UPDATE cannot lock a row that does not exist yet). EXECUTE is granted in roles.sql.
CREATE OR REPLACE FUNCTION nl_next_invoice_no(p_year integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  k text := 'invoice.seq.' || p_year::text;
  v integer;
BEGIN
  IF p_year < 1300 OR p_year > 1600 THEN
    RAISE EXCEPTION 'nl_next_invoice_no: year out of range (%)', p_year;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(k));
  INSERT INTO settings (key, value_json) VALUES (k, to_jsonb(1))
    ON CONFLICT (key) DO UPDATE SET value_json = to_jsonb((settings.value_json)::text::int + 1), updated_at = now()
    RETURNING (value_json)::text::int INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION nl_next_invoice_no(integer) FROM PUBLIC;
