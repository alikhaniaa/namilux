--
-- WHAT
--   Prerequisites every later migration relies on: the two extensions (pg_trgm for trigram search,
--   pgcrypto for gen_random_bytes) and the three helper functions the schema references - 
--   nl_fa_norm (the SQL twin of core faNorm, used by GENERATED search_text columns),
--   nl_set_updated_at (BEFORE UPDATE trigger body for every mutable table) and nl_ulid_check
--   (cheap ULID shape check). Hand-written; registered in drizzle's journal at M0 via
--   `pnpm --filter @namilux/db generate:custom --name extensions` (see migrations/README.md).
--
-- CONTRACT
--   CREATE EXTENSION IF NOT EXISTS pg_trgm, pgcrypto            -- both are "trusted" in PG13+, so the DB owner (nl_migrate) may install them
--   FUNCTION nl_fa_norm(input text) RETURNS text  IMMUTABLE STRICT PARALLEL SAFE
--     1. strip Arabic diacritics U+064B–U+0652, U+0670, ZWNJ U+200C, ZWJ U+200D, LRM/RLM U+200E/F, soft hyphen U+00AD
--     2. fold ي→ی, ك→ک, ى→ی ; Persian digits ۰–۹ and Arabic-Indic digits ٠–٩ → 0–9
--     3. collapse runs of whitespace to one space, trim, lower-case Latin
--     (byte-identical to core faNorm on the characters both handle; core additionally handles
--      a few compatibility forms - the tests in packages/core assert parity on the shared table)
--   FUNCTION nl_set_updated_at() RETURNS trigger
--     BEFORE UPDATE FOR EACH ROW; TG_ARGV = column names to IGNORE when deciding whether the row changed
--     (products/posts use ('stock_qty','view_count','rating_avg','rating_count') so a sale does not move the
--      sitemap lastmod - the spec). If any non-ignored column changed → NEW.updated_at := now();
--     else NEW.updated_at := OLD.updated_at (application writes to updated_at are discarded).
--   FUNCTION nl_ulid_check(s text) RETURNS boolean IMMUTABLE STRICT   -- '^[0-9A-HJKMNP-TV-Z]{26}$'
--
-- RULES
--   - Functions are `CREATE OR REPLACE` so re-running is safe; changing nl_fa_norm's behaviour
--     after launch requires rebuilding every generated search_text column (DROP + ADD COLUMN in a
--     new migration) - document it in the migration header when it happens.
--   - No table DDL in this file; tables come from drizzle-kit in 0001.
--   - Statement separators use drizzle's breakpoint marker line (migrations/README.md §3).
--     DECISION: the literal marker text must never appear inside a header - readMigrationFiles
--     splits the WHOLE file on it, comments included, so a quoted marker cuts a comment in half
--     and turns its remainder into a syntax error. Only the wording of this bullet changed.
--
-- EDGE CASES
--   - nl_fa_norm(NULL) → NULL (STRICT); nl_fa_norm('') → ''
--   - nl_set_updated_at with no TG_ARGV → ignores only updated_at itself
--
-- TESTS
--   packages/db/src/__tests__/migrations.test.ts: "pg_trgm and pgcrypto are installed",
--     "nl_fa_norm folds ي→ی and ك→ک", "nl_fa_norm folds Persian and Arabic-Indic digits to Latin",
--     "nl_fa_norm strips ZWNJ, diacritics and bidi marks", "nl_fa_norm collapses whitespace and lowercases Latin",
--     "nl_fa_norm is IMMUTABLE and STRICT", "nl_set_updated_at sets NEW.updated_at"
--
-- DEPENDS ON
-- - (first migration)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION nl_fa_norm(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  -- Byte-identical to core faNorm (packages/core/src/persian/normalize.ts). Change both together;
  -- packages/core/src/persian/__tests__/normalize.test.ts asserts the parity table against this
  -- function. Steps, in core's order:
  --   1. delete  harakat U+064B-0652, superscript alef U+0670, tatweel U+0640,
  --              LRM/RLM U+200E/200F, soft hyphen U+00AD
  --   2. to a space  ZWNJ U+200C and ZWJ U+200D (so «ویژگی‌ها» matches «ویژگی ها» - LIFT v1),
  --              plus every character JS \s treats as whitespace but Postgres in the C locale
  --              may not (NBSP, U+2000-200A, U+2028/2029, U+202F, U+205F, U+3000, BOM)
  --   3. fold    ي U+064A and ى U+0649 -> ی · ك U+0643 -> ک · ۀ U+06C0 and ة U+0629 -> ه ·
  --              Persian U+06F0-06F9 and Arabic-Indic U+0660-0669 digits -> 0-9
  --   4. collapse whitespace runs, trim, lower-case Latin
  SELECT lower(
    btrim(
      regexp_replace(
        translate(
          translate(
            regexp_replace(input, U&'[\064B-\0652\0670\0640\200E\200F\00AD]', '', 'g'),
            U&'\200C\200D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',
            '                     '
          ),
          U&'\064A\0643\0649\06C0\0629\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669',
          U&'\06CC\06A9\06CC\0647\0647' || '01234567890123456789'
        ),
        '[[:space:]]+', ' ', 'g'
      )
    )
  )
$$;
--> statement-breakpoint
COMMENT ON FUNCTION nl_fa_norm(text) IS 'SQL twin of @namilux/core faNorm: strip diacritics/ZWNJ/bidi marks, fold ي ك ى and digits, collapse spaces, lower Latin. Used by GENERATED search_text columns.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION nl_set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  excluded text[] := coalesce(TG_ARGV, '{}'::text[]) || 'updated_at'::text;
BEGIN
  IF (to_jsonb(NEW) - excluded) IS DISTINCT FROM (to_jsonb(OLD) - excluded) THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION nl_set_updated_at() IS 'BEFORE UPDATE trigger: bumps updated_at only when a non-ignored column changed; TG_ARGV lists ignored columns.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION nl_ulid_check(s text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT s ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
$$;
