--
-- WHAT
--   Creates the three application roles (nl_web, nl_admin, nl_worker) if missing, sets their
--   passwords from transaction-local settings supplied by scripts/roles.ts, pins per-role GUCs
--   (search_path, statement/lock/idle timeouts), and applies the COMPLETE, EXPLICIT grant matrix.
--   Idempotent: every run starts with REVOKE ALL and re-grants exactly what is listed, so a table
--   added by a migration has NO privileges until this file is updated and re-run. nl_migrate is the
--   executing role (owner of every object) and is created by the DBA / compose (README.md §2).
--
-- CONTRACT - grant matrix (S = SELECT, I = INSERT, U = UPDATE, D = DELETE; "(cols)" = column-level)
--   ┌──────────────────────────┬──────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
--   │ table                    │ nl_web                       │ nl_admin                     │ nl_worker                    │
--   ├──────────────────────────┼──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
--   │ brands, categories,      │ S                            │ S I U   (no D - URL-bearing) │ S                            │
--   │ collections, posts, pages│                              │                              │                              │
--   │ products                 │ S(all but cost_price)        │ S I U(all but id, stock_qty, │ S U(price, compare_at_price, │
--   │                          │ U(view_count) [row-lock only]│   generated, created/updated)│   instalment_price,          │
--   │                          │                              │   (no D)                     │   price_updated_at, rating_*,│
--   │                          │                              │                              │   view_count)                │
--   │ product_models,attributes│ S                            │ S I U D                      │ S                            │
--   │ collection_products,     │ S                            │ S I U D                      │ S                            │
--   │ product_categories,      │                              │                              │                              │
--   │ product_images,          │                              │                              │                              │
--   │ product_specs,           │                              │                              │                              │
--   │ product_attribute_values,│                              │                              │                              │
--   │ product_relations        │                              │                              │                              │
--   │ price_history            │ - │ S I                          │ S I                          │
--   │ media                    │ S                            │ S I U D                      │ S I U                        │
--   │ customers                │ S I U                        │ S I U   (no D - anonymize)   │ S U                          │
--   │ addresses                │ S I U D                      │ S I U D                      │ - │
--   │ otp_codes                │ S I U                        │ - │ S D (prune)                  │
--   │ sessions                 │ S I U                        │ S U (revoke)                 │ S D (prune)                  │
--   │ staff_roles              │ - │ S I U                        │ - │
--   │ staff_users              │ - │ S I U D (owner deletes staff)│ - │
--   │ staff_sessions,          │ - │ S I U D                      │ - │
--   │ webauthn_credentials     │                              │                              │                              │
--   │ audit_log                │ I                            │ S I                          │ I                            │
--   │ carts, cart_items,       │ S I U D                      │ S                            │ S D (idle prune)             │
--   │ wishlists                │                              │                              │                              │
--   │ shipping_methods         │ S                            │ S I U D                      │ S                            │
--   │ coupons                  │ S U(updated_at) [row-lock]   │ S I U   (no D)               │ S                            │
--   │ coupon_redemptions       │ S I                          │ S                            │ S                            │
--   │ orders                   │ S I U   (no D)               │ S I U   (no D)               │ S U                          │
--   │ order_items              │ S I                          │ S I U D (edit before process)│ S                            │
--   │ order_events             │ S I                          │ S I                          │ S I                          │
--   │ payments                 │ S I U(status, authority,     │ S I U(same cols)             │ S U(same cols)               │
--   │                          │   ref_id, card_pan_masked,   │                              │                              │
--   │                          │   fee, raw_json, verified_at)│                              │                              │
--   │ refunds                  │ S                            │ S I U(status, provider_ref,  │ S U(same cols)               │
--   │                          │                              │   done_at)                   │                              │
--   │ shipments                │ S                            │ S I U                        │ S                            │
--   │ inventory_movements      │ S I                          │ S I                          │ S I                          │
--   │ inventory_reservations   │ S I U                        │ S I U                        │ S U                          │
--   │ loyalty_ledger           │ S I                          │ S I                          │ S I                          │
--   │ referrals                │ S I U                        │ S U                          │ S U                          │
--   │ back_in_stock_requests,  │ S I U                        │ S U                          │ S U                          │
--   │ price_alerts             │                              │                              │                              │
--   │ reviews                  │ S I U(helpful_count)         │ S U                          │ S                            │
--   │ questions                │ S I                          │ S U                          │ S                            │
--   │ faqs, banners            │ S                            │ S I U D                      │ S                            │
--   │ menus                    │ S                            │ S I U                        │ S                            │
--   │ redirects                │ S U(hits, last_hit_at)       │ S I U   (no D - is_active)   │ S                            │
--   │ seo_snapshots            │ - │ S I U D                      │ S I                          │
--   │ settings                 │ S                            │ S I U                        │ S                            │
--   │ jobs                     │ S I                          │ S I U D                      │ S I U D                      │
--   │ sms_log                  │ I                            │ S                            │ S I U                        │
--   │ rate_limits              │ S I U D                      │ S D                          │ S D                          │
--   │ security_events          │ I                            │ S I                          │ S I                          │
--   │ events                   │ I                            │ S                            │ S I                          │
--   │ metrics_daily            │ S (M1: bestselling sort)     │ S                            │ S I U D                      │
--   │ view brand_product_counts│ S                            │ S                            │ S                            │
--   │ sequences (all)          │ USAGE, SELECT                │ USAGE, SELECT                │ USAGE, SELECT                │
--   │ fn nl_fa_norm            │ EXECUTE                      │ EXECUTE                      │ EXECUTE                      │
--   │ fn nl_events_*           │ - │ - │ EXECUTE                      │
--   │ schema public            │ USAGE                        │ USAGE                        │ USAGE                        │
--   │ schema drizzle           │ - │ - │ - │
--   └──────────────────────────┴──────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
--   Role attributes: LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--   CONNECTION LIMIT nl_web 40 · nl_admin 15 · nl_worker 15 (two web containers × pool 10 + headroom).
--   Role GUCs: search_path=public; statement_timeout 5s/30s/5min; lock_timeout 3s/5s/10s;
--   idle_in_transaction_session_timeout 10s/30s/5min (same values client.ts sends per connection).
--
-- RULES
--   - Column-level SELECT on products for nl_web excludes cost_price (the spec "never sent to web").
--   - `orders.channel` and `carts.channel` (0003) need no new grant: both tables are granted at
--     TABLE level to every role that writes them, so a new column is covered automatically.
--     Consequence: web-side code must project columns explicitly (schema/catalog.ts productWebColumns).
--   - `SELECT … FOR UPDATE/SHARE` requires UPDATE privilege on at least one column: nl_web gets
--     UPDATE(view_count) on products and UPDATE(updated_at) on coupons for that reason only.
--   - stock_qty and points_balance are written by nobody but the SECURITY DEFINER triggers.
--   - Append-only tables: audit_log, price_history, order_events, inventory_movements,
--     loyalty_ledger, security_events have no UPDATE/DELETE for any app role; payments/refunds get
--     column-limited UPDATE for their status transitions.
--   - URL-bearing tables (products, categories, brands, collections, posts, pages) and
--     customers/orders/payments have no DELETE for any app role.
--   - Passwords are never in this file: scripts/roles.ts does `SELECT set_config('nl.pw_<role>', $1, true)`
--     inside the same transaction before running this file; when unset, the ALTER is skipped.
--   - This file runs AFTER migrations (grants need the objects). Re-run it after every migration.
--
-- EDGE CASES
--   - A role already exists → CREATE skipped, password still (re)set when provided, grants re-applied.
--   - Run before tables exist → fails on the first GRANT (documented: run `pnpm db:migrate` first).
--   - Executed by a non-owner without CREATEROLE → fails at CREATE ROLE / ALTER ROLE (README.md §2).
--   - REVOKE ALL … IN SCHEMA public also strips privileges on partitions created later; re-run
--     grants after the worker creates monthly partitions? NOT needed: privileges are checked on the
--     parent table "events" for statements addressed to it (partition routing does not re-check).
--
-- TESTS
--   packages/db/src/__tests__/roles.test.ts (entire file - one `it` per matrix cell that matters)
--
-- DEPENDS ON
--   migrations/0000_extensions.sql, migrations/0001_init.sql (objects must exist)

-- ═══ A. roles (idempotent; passwords from transaction-local settings) ═══════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl_web') THEN
    CREATE ROLE nl_web LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl_admin') THEN
    CREATE ROLE nl_admin LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 15;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl_worker') THEN
    CREATE ROLE nl_worker LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 15;
  END IF;

  IF coalesce(current_setting('nl.pw_web', true), '') <> '' THEN
    EXECUTE format('ALTER ROLE nl_web PASSWORD %L', current_setting('nl.pw_web', true));
  END IF;
  IF coalesce(current_setting('nl.pw_admin', true), '') <> '' THEN
    EXECUTE format('ALTER ROLE nl_admin PASSWORD %L', current_setting('nl.pw_admin', true));
  END IF;
  IF coalesce(current_setting('nl.pw_worker', true), '') <> '' THEN
    EXECUTE format('ALTER ROLE nl_worker PASSWORD %L', current_setting('nl.pw_worker', true));
  END IF;
END
$$;

-- ═══ B. per-role GUCs (defence in depth; client.ts also sends them per connection) ══════════════
ALTER ROLE nl_web    SET search_path = public;
ALTER ROLE nl_admin  SET search_path = public;
ALTER ROLE nl_worker SET search_path = public;

ALTER ROLE nl_web    SET statement_timeout = '5s';
ALTER ROLE nl_admin  SET statement_timeout = '30s';
ALTER ROLE nl_worker SET statement_timeout = '5min';

ALTER ROLE nl_web    SET lock_timeout = '3s';
ALTER ROLE nl_admin  SET lock_timeout = '5s';
ALTER ROLE nl_worker SET lock_timeout = '10s';

ALTER ROLE nl_web    SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE nl_admin  SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE nl_worker SET idle_in_transaction_session_timeout = '5min';

-- ═══ C. database / schema level ════════════════════════════════════════════════════════════════
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO nl_web, nl_admin, nl_worker', current_database());
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM nl_web, nl_admin, nl_worker;
GRANT USAGE ON SCHEMA public TO nl_web, nl_admin, nl_worker;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA drizzle FROM nl_web, nl_admin, nl_worker';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM nl_web, nl_admin, nl_worker';
  END IF;
END
$$;

-- ═══ D. reset - every run starts from zero ══════════════════════════════════════════════════════
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM nl_web, nl_admin, nl_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM nl_web, nl_admin, nl_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM nl_web, nl_admin, nl_worker;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nl_web, nl_admin, nl_worker;
GRANT EXECUTE ON FUNCTION nl_fa_norm(text) TO nl_web, nl_admin, nl_worker;
GRANT EXECUTE ON FUNCTION nl_ulid_check(text) TO nl_web, nl_admin, nl_worker;
GRANT EXECUTE ON FUNCTION nl_events_ensure_partitions(integer) TO nl_worker;
GRANT EXECUTE ON FUNCTION nl_events_drop_old_partitions(integer) TO nl_worker;
GRANT EXECUTE ON FUNCTION nl_next_invoice_no(integer) TO nl_web, nl_admin, nl_worker;  -- [M8] gapless invoice numbers from any app (migration 0002)
GRANT EXECUTE ON FUNCTION nl_media_fold(text, text) TO nl_worker;  -- folds a duplicate upload into its twin (migration 0009); the worker still may not DELETE from media

-- ═══ E. nl_web - storefront ═════════════════════════════════════════════════════════════════════
-- catalogue & content: read
GRANT SELECT ON brands, categories, collections, collection_products, product_models,
  product_categories, product_images, product_specs, attributes, product_attribute_values,
  product_relations, media, shipping_methods, posts, pages, faqs, menus, banners, settings,
  brand_product_counts
  TO nl_web;

-- products: every column except cost_price; UPDATE(view_count) only to permit SELECT … FOR UPDATE/SHARE
-- instalment_price / instalment_price_manual: the instalment storefront is nl_web too (the same
-- code, the same role, a different SITE_MODE), so it must be able to read the price it shows.
-- instalment_eligible (0006): read by the instalment quote, placeOrder and the eligibility
-- endpoint to refuse a basket holding a product the admin switched off. SELECT only.
GRANT SELECT (
  id, model_id, slug, name, display_name, brand_id, sku, model_code, color_name, color_hex,
  swatch_media_id, status, visibility, price, compare_at_price, instalment_price,
  instalment_price_manual, instalment_eligible, price_basis, base_price,
  base_currency, price_updated_at, stock_policy, stock_qty, allow_backorder, low_stock_threshold,
  max_per_order, short_html, description_html, warranty_months, warranty_text, weight_g, length_mm,
  width_mm, height_mm, video_media_id, seo_title, seo_description, robots, legacy_lastmod,
  rating_avg, rating_count, view_count, is_on_request, search_text, published_at, created_at, updated_at
) ON products TO nl_web;
GRANT UPDATE (view_count) ON products TO nl_web;

-- coupons: read + row-lock only
GRANT SELECT ON coupons TO nl_web;
GRANT UPDATE (updated_at) ON coupons TO nl_web;

-- redirects: read + hit counters
GRANT SELECT ON redirects TO nl_web;
GRANT UPDATE (hits, last_hit_at) ON redirects TO nl_web;

-- identity & personal state
GRANT SELECT, INSERT, UPDATE ON customers TO nl_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON addresses, carts, cart_items, wishlists, rate_limits TO nl_web;
GRANT SELECT, INSERT, UPDATE ON otp_codes, sessions TO nl_web;

-- commerce
GRANT SELECT, INSERT, UPDATE ON orders TO nl_web;
GRANT SELECT, INSERT ON order_items, order_events, coupon_redemptions, inventory_movements, loyalty_ledger TO nl_web;
GRANT SELECT, INSERT ON payments TO nl_web;
GRANT UPDATE (status, authority, ref_id, card_pan_masked, fee, raw_json, verified_at) ON payments TO nl_web;
GRANT SELECT ON refunds, shipments TO nl_web;
GRANT SELECT, INSERT, UPDATE ON inventory_reservations, referrals, back_in_stock_requests, price_alerts TO nl_web;

-- requests
GRANT SELECT, INSERT ON reviews TO nl_web;
GRANT UPDATE (helpful_count) ON reviews TO nl_web;
GRANT SELECT, INSERT ON questions TO nl_web;

-- system
GRANT INSERT ON audit_log, security_events, events, sms_log TO nl_web;
GRANT SELECT, INSERT ON jobs TO nl_web;
-- DECISION (M1): the storefront reads metrics_daily. The PLP sort «پرفروش‌ترین» (F-009) is a public
-- control, and `catalog/products.repo.queryCards` joins metrics_daily for `sold_90d` whenever that
-- sort is chosen; without this grant nl_web gets 42501 on a link any shopper can click. The table is
-- aggregate only - (day, metric, dim, value) - so it carries no PII and no per-customer row. SELECT
-- only: the rollup stays the worker's. The matrix row above was ` - ` for nl_web; recorded in
-- the spec.
GRANT SELECT ON metrics_daily TO nl_web;

-- DECISION: nl_web also reads seo_snapshots. Ten of the 752 legacy heads describe routes that are
-- not entities (`/`, `/blog/`, `/cart/`, …), so the seed had nowhere to put their titles and kept
-- them here (packages/seed/src/importers/seo.ts warns about it on every run); the spec requires
-- those titles verbatim, and core/seo/legacy-head.ts is the reader. The table holds nothing but the
-- head the previous site already published to the whole internet: no PII, no per-customer row.
-- SELECT only - writing a crawl run stays the worker's and the admin's. The matrix row above was
-- ` - ` for nl_web; recorded in the spec.
GRANT SELECT ON seo_snapshots TO nl_web;

-- ═══ F. nl_admin - back-office ══════════════════════════════════════════════════════════════════
-- URL-bearing entities: never DELETE
GRANT SELECT, INSERT, UPDATE ON brands, categories, collections, posts, pages TO nl_admin;

-- products: full read; UPDATE on every column except id, stock_qty (trigger-owned), generated columns, timestamps
GRANT SELECT, INSERT ON products TO nl_admin;
GRANT UPDATE (
  model_id, slug, name, display_name, brand_id, sku, model_code, color_name, color_hex,
  swatch_media_id, status, visibility, price, compare_at_price, instalment_price,
  instalment_price_manual, instalment_eligible, cost_price, price_basis, base_price,
  base_currency, price_updated_at, stock_policy, allow_backorder, low_stock_threshold, max_per_order,
  short_html, description_html, warranty_months, warranty_text, weight_g, length_mm, width_mm,
  height_mm, video_media_id, seo_title, seo_description, robots, legacy_lastmod, rating_avg,
  rating_count, view_count, published_at
) ON products TO nl_admin;

-- catalogue child/join tables and media: full DML
GRANT SELECT, INSERT, UPDATE, DELETE ON product_models, attributes, collection_products,
  product_categories, product_images, product_specs, product_attribute_values, product_relations,
  media
  TO nl_admin;
GRANT SELECT, INSERT ON price_history TO nl_admin;
GRANT SELECT ON brand_product_counts TO nl_admin;

-- customers & staff
GRANT SELECT, INSERT, UPDATE ON customers TO nl_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON addresses TO nl_admin;
GRANT SELECT, UPDATE ON sessions TO nl_admin;
GRANT SELECT, INSERT, UPDATE ON staff_roles TO nl_admin;
-- staff_users gained DELETE with the owner/admin split: the head admin removes a staff
-- member outright (the six history columns that point at one are ON DELETE SET NULL since
-- migration 0004), while `is_active = false` stays the everyday "switch them off" path.
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_users TO nl_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_sessions, webauthn_credentials TO nl_admin;
GRANT SELECT, INSERT ON audit_log TO nl_admin;

-- commerce
GRANT SELECT ON carts, cart_items, wishlists, coupon_redemptions TO nl_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON shipping_methods TO nl_admin;
GRANT SELECT, INSERT, UPDATE ON coupons, orders, shipments TO nl_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO nl_admin;
GRANT SELECT, INSERT ON order_events, inventory_movements, loyalty_ledger TO nl_admin;
GRANT SELECT, INSERT ON payments TO nl_admin;
GRANT UPDATE (status, authority, ref_id, card_pan_masked, fee, raw_json, verified_at) ON payments TO nl_admin;
GRANT SELECT, INSERT ON refunds TO nl_admin;
GRANT UPDATE (status, provider_ref, done_at) ON refunds TO nl_admin;
-- DECISION (M8 e2e): manual orders sent as a payment link reserve stock from the admin app (orders/manual.ts →
-- inventory.reserve), so nl_admin needs INSERT on inventory_reservations too.
GRANT SELECT, INSERT, UPDATE ON inventory_reservations TO nl_admin;
GRANT SELECT, UPDATE ON referrals, back_in_stock_requests, price_alerts, reviews, questions TO nl_admin;

-- content & seo
GRANT SELECT, INSERT, UPDATE, DELETE ON faqs, banners, seo_snapshots TO nl_admin;
GRANT SELECT, INSERT, UPDATE ON menus, redirects TO nl_admin;

-- system
GRANT SELECT, INSERT, UPDATE ON settings TO nl_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO nl_admin;
GRANT SELECT ON sms_log, events, metrics_daily TO nl_admin;
GRANT SELECT, DELETE ON rate_limits TO nl_admin;
GRANT SELECT, INSERT ON security_events TO nl_admin;

-- ═══ G. nl_worker - background jobs ═════════════════════════════════════════════════════════════
-- catalogue & content: read (+ limited product updates for bulk price / rating / view rollups)
GRANT SELECT ON brands, categories, collections, collection_products, product_models,
  product_categories, product_images, product_specs, attributes, product_attribute_values,
  product_relations, posts, pages, faqs, menus, banners, redirects, settings, shipping_methods,
  coupons, coupon_redemptions, brand_product_counts
  TO nl_worker;
GRANT SELECT ON products TO nl_worker;
-- instalment_price travels with price: every price write re-derives it in the SAME statement
-- (core: updatePrice), so a role that may move a price must be able to move the derived one.
GRANT UPDATE (price, compare_at_price, instalment_price, price_updated_at, rating_avg, rating_count, view_count) ON products TO nl_worker;
GRANT SELECT, INSERT ON price_history TO nl_worker;
GRANT SELECT, INSERT, UPDATE ON media TO nl_worker;

-- customers: counters/tiers; prune OTP & sessions
GRANT SELECT, UPDATE ON customers TO nl_worker;
GRANT SELECT, DELETE ON otp_codes, sessions, carts, cart_items, wishlists, rate_limits TO nl_worker;
GRANT INSERT ON audit_log TO nl_worker;

-- commerce: expiries, notifications, consistency
GRANT SELECT, UPDATE ON orders, inventory_reservations, referrals, back_in_stock_requests, price_alerts TO nl_worker;
GRANT SELECT ON order_items, shipments, reviews, questions TO nl_worker;
GRANT SELECT, INSERT ON order_events, inventory_movements, loyalty_ledger TO nl_worker;
GRANT SELECT ON payments TO nl_worker;
GRANT UPDATE (status, authority, ref_id, card_pan_masked, fee, raw_json, verified_at) ON payments TO nl_worker;
GRANT SELECT ON refunds TO nl_worker;
GRANT UPDATE (status, provider_ref, done_at) ON refunds TO nl_worker;

-- system
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs, metrics_daily TO nl_worker;
GRANT SELECT, INSERT, UPDATE ON sms_log TO nl_worker;
GRANT SELECT, INSERT ON security_events, seo_snapshots TO nl_worker;
GRANT SELECT, INSERT ON events TO nl_worker;
